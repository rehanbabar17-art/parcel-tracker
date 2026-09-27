import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Storage } from 'megajs';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, TrackingState } from './trackers/types.ts';

type Folder = Storage['root'];
type Node = NonNullable<Folder['children']>[number];

const ROOT_DIR = process.cwd();
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
const STATE_FILE = path.join(ROOT_DIR, 'state.json');
const B2_PREFIX = 'parcel-tracker/';
const CONFIG_KEY = `${B2_PREFIX}config.json`;
const STATE_KEY = `${B2_PREFIX}state.json`;
const BUCKET = process.env.B2_BUCKET;
const ENDPOINT = (process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com').replace(/\/$/, '');
const TIMEOUT_MS = 20_000;
const COURIERS = new Set(['tcs', 'leopards', 'postex', 'daraz', 'dex', 'trax']);

class SyncFailure extends Error {}

function withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SyncFailure(`B2 ${operation} timed out after ${TIMEOUT_MS / 1000} seconds.`)), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseConfigJson(input: Buffer | string): AppConfig {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  } catch {
    throw new SyncFailure('config.json is not valid JSON.');
  }
  if (!isRecord(value) || !Array.isArray(value.trackers) || !isRecord(value.ntfy)) {
    throw new SyncFailure('config.json must contain a trackers array and an ntfy object.');
  }
  const validTrackers = value.trackers.every((tracker) =>
    isRecord(tracker) && typeof tracker.name === 'string' && tracker.name.trim().length > 0 &&
    typeof tracker.courier === 'string' && COURIERS.has(tracker.courier.toLowerCase()) &&
    typeof tracker.tracking_number === 'string' && tracker.tracking_number.trim().length > 0,
  );
  if (!validTrackers) throw new SyncFailure('config.json contains an invalid tracker entry.');
  if (typeof value.ntfy.server !== 'string' || typeof value.ntfy.topic !== 'string' ||
      typeof value.ntfy.priority !== 'string' || !Array.isArray(value.ntfy.tags) ||
      !value.ntfy.tags.every((tag) => typeof tag === 'string')) {
    throw new SyncFailure('config.json contains invalid notification settings.');
  }
  return value as unknown as AppConfig;
}

export function parseStateJson(input: Buffer | string): TrackingState {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  } catch {
    throw new SyncFailure('state.json is not valid JSON.');
  }
  if (!isRecord(value)) throw new SyncFailure('state.json must be a JSON object.');
  return value as TrackingState;
}

function b2Client(): { bucket: string; client: S3Client } {
  if (!process.env.B2_KEY_ID || !process.env.B2_APPLICATION_KEY || !BUCKET) {
    throw new SyncFailure('B2_KEY_ID, B2_APPLICATION_KEY, and B2_BUCKET Actions secrets are required.');
  }
  return {
    bucket: BUCKET,
    client: new S3Client({
      region: 'us-east-005',
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APPLICATION_KEY },
    }),
  };
}

async function bodyBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (stream.transformToByteArray) return Buffer.from(await stream.transformToByteArray());
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getObject(client: S3Client, bucket: string, key: string, required = true): Promise<Buffer | undefined> {
  try {
    const response = await withTimeout(client.send(new GetObjectCommand({ Bucket: bucket, Key: key })), `read ${key}`);
    return bodyBuffer(response.Body);
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name || '';
    if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') {
      if (!required) return undefined;
      throw new SyncFailure(`B2 object ${key} is missing from bucket ${bucket}.`);
    }
    if (status === 401 || status === 403 || /AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(name)) {
      throw new SyncFailure(`B2 access was denied while reading ${key}; check the B2 key and bucket permissions.`);
    }
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure(`Could not read B2 object ${key}.`);
  }
}

async function putObject(client: S3Client, bucket: string, key: string, body: Buffer): Promise<void> {
  try {
    await withTimeout(client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: key.endsWith('.json') ? 'application/json' : 'text/plain',
    })), `write ${key}`);
  } catch (error) {
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure(`Could not write B2 object ${key}.`);
  }
}

function writePrivate(filePath: string, data: Buffer): void {
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, { mode: 0o600 });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
}

function newestFile(folder: Folder, name: string): Node | undefined {
  return (folder.children ?? []).filter((node) => !node.directory && node.name === name)
    .reduce<Node | undefined>((newest, node) => (!newest || Number(node.timestamp ?? 0) >= Number(newest.timestamp ?? 0) ? node : newest), undefined);
}

function findFolder(folder: Folder, name: string): Folder | undefined {
  return (folder.children ?? []).find((node) => node.directory && node.name === name);
}

async function openMega(): Promise<{ storage: Storage; folder: Folder }> {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) throw new SyncFailure('MEGA_EMAIL and MEGA_PASSWORD Actions secrets are required for migration.');
  let storage: Storage | undefined;
  try {
    storage = await withTimeout(new Storage({ email, password }).ready, 'Mega login');
    await withTimeout(storage.reload(true), 'Mega listing');
    const root = findFolder(storage.root, 'github-data');
    const folder = root ? findFolder(root, 'parcel-tracker') : undefined;
    if (!folder) throw new SyncFailure('MEGA folder github-data/parcel-tracker was not found.');
    return { storage, folder };
  } catch (error) {
    await storage?.close().catch(() => undefined);
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure('Mega login or storage access failed.');
  }
}

async function downloadB2(): Promise<boolean> {
  try {
    const { bucket, client } = b2Client();
    const config = await getObject(client, bucket, CONFIG_KEY);
    const state = await getObject(client, bucket, STATE_KEY);
    parseConfigJson(config!);
    parseStateJson(state!);
    writePrivate(CONFIG_FILE, config!);
    writePrivate(STATE_FILE, state!);
    console.log('[B2] Restored config.json and state.json from private B2 storage.');
    return true;
  } catch (error) {
    console.error(`[B2] Download failed: ${error instanceof SyncFailure ? error.message : 'B2 authentication, storage, or network error.'}`);
    return false;
  }
}

async function uploadB2(): Promise<boolean> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) throw new SyncFailure('Local config.json is missing.');
    const config = fs.readFileSync(CONFIG_FILE);
    const state = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE) : Buffer.from('{}\n', 'utf8');
    parseConfigJson(config);
    parseStateJson(state);
    const { bucket, client } = b2Client();
    await putObject(client, bucket, CONFIG_KEY, config);
    await putObject(client, bucket, STATE_KEY, state);
    console.log('[B2] Uploaded validated parcel config.json and state.json.');
    return true;
  } catch (error) {
    console.error(`[B2] Upload failed: ${error instanceof SyncFailure ? error.message : 'B2 authentication, storage, or network error.'}`);
    return false;
  }
}

async function migrateFromMega(): Promise<boolean> {
  let storage: Storage | undefined;
  try {
    console.log('[B2] Reading parcel config and history from Mega.');
    const mega = await openMega();
    storage = mega.storage;
    const configNode = newestFile(mega.folder, 'config.json');
    const stateNode = newestFile(mega.folder, 'state.json');
    if (!configNode) throw new SyncFailure('MEGA config.json is missing.');
    const config = await withTimeout(configNode.downloadBuffer({}), 'Mega config read');
    const state = stateNode ? await withTimeout(stateNode.downloadBuffer({}), 'Mega state read') : Buffer.from('{}\n', 'utf8');
    parseConfigJson(config);
    parseStateJson(state);
    const { bucket, client } = b2Client();
    await putObject(client, bucket, CONFIG_KEY, config);
    await putObject(client, bucket, STATE_KEY, state);
    await verifyB2();
    console.log('[B2] Parcel config and history migration completed.');
    return true;
  } catch (error) {
    console.error(`[B2] Migration failed: ${error instanceof SyncFailure ? error.message : 'B2 or Mega authentication, storage, or network error.'}`);
    return false;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

async function verifyB2(): Promise<boolean> {
  try {
    const { bucket, client } = b2Client();
    const config = await getObject(client, bucket, CONFIG_KEY);
    const state = await getObject(client, bucket, STATE_KEY);
    const parsedConfig = parseConfigJson(config!);
    const parsedState = parseStateJson(state!);
    console.log(`[B2-VERIFY] Authentication succeeded; ${parsedConfig.trackers.length} parcel trackers and ${Object.keys(parsedState).length} saved state records are present.`);
    return true;
  } catch (error) {
    console.error(`[B2-VERIFY] Verification failed: ${error instanceof SyncFailure ? error.message : 'B2 authentication, storage, or network error.'}`);
    return false;
  }
}

function clearLocalHistory(): boolean {
  try {
    if (!fs.existsSync(CONFIG_FILE)) throw new SyncFailure('Downloaded config.json is required before clearing parcel history.');
    parseConfigJson(fs.readFileSync(CONFIG_FILE));
    writePrivate(STATE_FILE, Buffer.from('{}\n', 'utf8'));
    console.log('[B2] Cleared local parcel history; fresh state will upload after tracking succeeds.');
    return true;
  } catch (error) {
    console.error(`[B2] History reset failed: ${error instanceof SyncFailure ? error.message : 'local history reset failed.'}`);
    return false;
  }
}

const command = process.argv[2];
const task = command === 'download' ? downloadB2()
  : command === 'upload' ? uploadB2()
    : command === 'migrate-from-mega' ? migrateFromMega()
      : command === 'verify' ? verifyB2()
        : command === 'clear-history' ? Promise.resolve(clearLocalHistory())
          : Promise.reject(new Error('Usage: b2-sync.ts <download|upload|migrate-from-mega|verify|clear-history>'));

task.then((ok) => { if (!ok) process.exitCode = 1; }).catch((error) => {
  console.error(`[B2] ${error instanceof SyncFailure ? error.message : 'Unexpected synchronization failure.'}`);
  process.exitCode = 1;
});
