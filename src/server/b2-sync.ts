import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import type { AppConfig, TrackingState } from './trackers/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

export const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
export const STATE_FILE = path.join(ROOT_DIR, 'state.json');

export const CONFIG_KEY = 'parcel-tracker/config.json';
export const STATE_KEY = 'parcel-tracker/state.json';

export class SyncFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncFailure';
  }
}

export function isB2Configured(): boolean {
  return Boolean(
    process.env.B2_KEY_ID &&
    process.env.B2_APPLICATION_KEY &&
    process.env.B2_BUCKET
  );
}

export function getB2Client(): { client: S3Client; bucket: string } {
  if (!isB2Configured()) {
    throw new SyncFailure('Backblaze B2 credentials (B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET) are not set.');
  }

  const endpoint = process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
  let region = 'us-east-005';
  const match = endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/);
  if (match) region = match[1];

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID!,
      secretAccessKey: process.env.B2_APPLICATION_KEY!
    }
  });

  return { client, bucket: process.env.B2_BUCKET! };
}

export async function fetchB2Config(): Promise<AppConfig> {
  const { client, bucket } = getB2Client();
  try {
    const res = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: CONFIG_KEY
    }));
    const body = await res.Body!.transformToString();
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.trackers)) {
      throw new SyncFailure('B2 parcel-tracker/config.json has invalid structure.');
    }
    return parsed as AppConfig;
  } catch (error: any) {
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure(`Failed to fetch B2 config: ${error?.message || error}`);
  }
}

export async function fetchB2State(): Promise<TrackingState> {
  const { client, bucket } = getB2Client();
  try {
    const res = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: STATE_KEY
    }));
    const body = await res.Body!.transformToString();
    return JSON.parse(body) as TrackingState;
  } catch (error: any) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return {};
    }
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure(`Failed to fetch B2 state: ${error?.message || error}`);
  }
}

export async function putB2Config(config: AppConfig): Promise<void> {
  const { client, bucket } = getB2Client();
  if (!config || !Array.isArray(config.trackers)) {
    throw new SyncFailure('Cannot upload invalid config structure to B2.');
  }
  const body = JSON.stringify(config, null, 2) + '\n';
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: CONFIG_KEY,
    Body: Buffer.from(body, 'utf-8'),
    ContentType: 'application/json'
  }));
}

export async function putB2State(state: TrackingState): Promise<void> {
  const { client, bucket } = getB2Client();
  const body = JSON.stringify(state, null, 2) + '\n';
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: STATE_KEY,
    Body: Buffer.from(body, 'utf-8'),
    ContentType: 'application/json'
  }));
}

export function pruneStateForConfig(config: AppConfig, state: TrackingState): number {
  if (!config || !Array.isArray(config.trackers) || !state || typeof state !== 'object') {
    return 0;
  }

  const activeKeys = new Set(
    config.trackers
      .filter((t) => t && t.courier && t.tracking_number && !String(t.tracking_number).startsWith('YOUR_'))
      .map((t) => `${String(t.courier).trim().toLowerCase()}:${String(t.tracking_number).trim().toLowerCase()}`)
  );

  let prunedCount = 0;
  for (const key of Object.keys(state)) {
    const [rawCourier, ...rest] = key.split(':');
    const rawTracking = rest.join(':');
    const normalizedKey = `${(rawCourier || '').trim().toLowerCase()}:${(rawTracking || '').trim().toLowerCase()}`;
    if (!activeKeys.has(normalizedKey) || state[key]?.removed) {
      delete state[key];
      prunedCount++;
    }
  }

  return prunedCount;
}

export async function downloadB2(): Promise<boolean> {
  try {
    console.log('[B2] Downloading parcel-tracker config and state from B2...');
    const config = await fetchB2Config();
    const state = await fetchB2State();

    const pruned = pruneStateForConfig(config, state);
    if (pruned > 0) {
      console.log(`[B2] Pruned ${pruned} deleted/old tracking record(s) from state.`);
      await putB2State(state).catch((err) => {
        console.warn(`[B2] Warning: could not push pruned state during download: ${err?.message || err}`);
      });
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    console.log(`[B2] Downloaded ${config.trackers.length} trackers and ${Object.keys(state).length} state items.`);
    return true;
  } catch (err: any) {
    console.error(`[B2] Download failed: ${err.message}`);
    return false;
  }
}

export async function uploadB2(): Promise<boolean> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      throw new SyncFailure('Local config.json does not exist.');
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) : {};
    const pruned = pruneStateForConfig(config, state);
    if (pruned > 0) {
      console.log(`[B2] Pruned ${pruned} deleted/old tracking record(s) before B2 upload.`);
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    }
    await putB2Config(config);
    await putB2State(state);
    console.log(`[B2] Uploaded ${config.trackers.length} trackers and ${Object.keys(state).length} state items.`);
    return true;
  } catch (err: any) {
    console.error(`[B2] Upload failed: ${err.message}`);
    return false;
  }
}

export async function verifyB2(): Promise<boolean> {
  try {
    const config = await fetchB2Config();
    const state = await fetchB2State();
    console.log(`[B2-VERIFY] B2 Connection successful. Active trackers: ${config.trackers.length}, States: ${Object.keys(state).length}`);
    return true;
  } catch (err: any) {
    console.error(`[B2-VERIFY] Verification failed: ${err.message}`);
    return false;
  }
}

export function clearLocalHistory(): boolean {
  try {
    fs.writeFileSync(STATE_FILE, '{}\n', { mode: 0o600 });
    console.log('[B2] Cleared local parcel history state.');
    return true;
  } catch (err: any) {
    console.error(`[B2] History reset failed: ${err.message}`);
    return false;
  }
}

// CLI handler
if (process.argv[1] && (process.argv[1].endsWith('b2-sync.ts') || process.argv[1].endsWith('b2-sync.js'))) {
  const command = process.argv[2];
  const task =
    command === 'download' ? downloadB2() :
    command === 'upload' ? uploadB2() :
    command === 'verify' ? verifyB2() :
    command === 'clear-history' ? Promise.resolve(clearLocalHistory()) :
    Promise.reject(new Error('Usage: tsx b2-sync.ts <download|upload|verify|clear-history>'));

  task.then((ok) => {
    if (!ok) process.exitCode = 1;
  }).catch((err) => {
    console.error(`[B2 CLI] Error: ${err.message}`);
    process.exitCode = 1;
  });
}
