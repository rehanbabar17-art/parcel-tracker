import { Storage } from 'megajs';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, TrackingState } from './trackers/types.ts';

type MegaFolder = Storage['root'];
type MegaNode = NonNullable<MegaFolder['children']>[number];

const EMAIL = process.env.MEGA_EMAIL;
const PASSWORD = process.env.MEGA_PASSWORD;
const ROOT_DIR = process.cwd();
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
const STATE_FILE = path.join(ROOT_DIR, 'state.json');
const EXAMPLE_CONFIG_FILE = path.join(ROOT_DIR, 'config.example.json');
const COURIERS = new Set(['tcs', 'leopards', 'postex', 'daraz', 'dex', 'trax']);

class SyncFailure extends Error {}

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
    isRecord(tracker) &&
    typeof tracker.name === 'string' && tracker.name.trim().length > 0 &&
    typeof tracker.courier === 'string' && COURIERS.has(tracker.courier.toLowerCase()) &&
    typeof tracker.tracking_number === 'string' && tracker.tracking_number.trim().length > 0
  );
  if (!validTrackers) {
    throw new SyncFailure('config.json contains an invalid tracker entry.');
  }
  if (
    typeof value.ntfy.server !== 'string' ||
    typeof value.ntfy.topic !== 'string' ||
    typeof value.ntfy.priority !== 'string' ||
    !Array.isArray(value.ntfy.tags) ||
    !value.ntfy.tags.every((tag) => typeof tag === 'string')
  ) {
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
  if (!isRecord(value) || Object.values(value).some((entry) => !isRecord(entry))) {
    throw new SyncFailure('state.json must be a JSON object of tracking-state entries.');
  }
  return value as TrackingState;
}

function newestFile(folder: MegaFolder, name: string): MegaNode | undefined {
  const matches = (folder.children ?? []).filter((node) => !node.directory && node.name === name);
  return matches.reduce<MegaNode | undefined>((newest, node) => {
    if (!newest) return node;
    return Number(node.timestamp ?? 0) >= Number(newest.timestamp ?? 0) ? node : newest;
  }, undefined);
}

function findFolder(folder: MegaFolder, name: string): MegaFolder | undefined {
  return (folder.children ?? []).find((node) => node.directory && node.name === name);
}

async function getTrackerFolder(storage: Storage, create: boolean): Promise<MegaFolder | undefined> {
  let rootData = findFolder(storage.root, 'github-data');
  if (!rootData && create) rootData = await storage.root.mkdir('github-data');
  if (!rootData) return undefined;

  let trackerFolder = findFolder(rootData, 'parcel-tracker');
  if (!trackerFolder && create) trackerFolder = await rootData.mkdir('parcel-tracker');
  return trackerFolder;
}

async function openStorage(): Promise<Storage> {
  if (!EMAIL || !PASSWORD) {
    throw new SyncFailure('MEGA_EMAIL and MEGA_PASSWORD Actions secrets are required.');
  }
  const storage = await new Storage({ email: EMAIL, password: PASSWORD }).ready;
  await storage.reload(true);
  return storage;
}

function writePrivateFile(filePath: string, data: Buffer | string): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, data, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function safeFailure(operation: string, error: unknown): void {
  const reason = error instanceof SyncFailure ? error.message : 'MEGA service, account, or network error.';
  console.error(`[MEGA] ${operation} failed: ${reason}`);
}

async function downloadRemoteFile(folder: MegaFolder, name: string): Promise<Buffer | undefined> {
  const node = newestFile(folder, name);
  return node ? node.downloadBuffer({}) : undefined;
}

async function uploadRemoteFile(folder: MegaFolder, name: string, data: Buffer): Promise<void> {
  const previousFiles = (folder.children ?? []).filter((node) => !node.directory && node.name === name);
  const uploaded = await folder.upload({ name, size: data.length }, data).complete;

  // Upload first. Only remove prior copies after MEGA confirms the replacement exists.
  for (const previous of previousFiles) {
    if (previous === uploaded) continue;
    try {
      await previous.delete();
    } catch {
      // The newest timestamp is used on download, so an older duplicate is safe but should be cleaned later.
      console.warn(`[MEGA] ${name} uploaded; an older duplicate could not be removed.`);
    }
  }
}

export async function syncFromMega(): Promise<boolean> {
  let storage: Storage | undefined;
  try {
    storage = await openStorage();
    const folder = await getTrackerFolder(storage, false);
    if (!folder) {
      throw new SyncFailure('MEGA folder github-data/parcel-tracker was not found.');
    }

    const remoteConfig = await downloadRemoteFile(folder, 'config.json');
    let configData: Buffer;
    if (remoteConfig) {
      parseConfigJson(remoteConfig);
      configData = remoteConfig;
    } else if (process.env.TRACKER_CONFIG) {
      // One-time migration path for the old encrypted GitHub Actions secret.
      // It is only used when MEGA has no config.json; the normal source of truth is MEGA.
      parseConfigJson(process.env.TRACKER_CONFIG);
      configData = Buffer.from(process.env.TRACKER_CONFIG, 'utf8');
      console.log('[MEGA] No remote config.json; validated the protected legacy bootstrap for migration.');
    } else {
      throw new SyncFailure('MEGA config.json is missing; no parcel data was downloaded.');
    }

    const remoteState = await downloadRemoteFile(folder, 'state.json');
    const stateData = remoteState ?? Buffer.from('{}\n', 'utf8');
    parseStateJson(stateData);

    // Validate both documents before writing either private local file.
    writePrivateFile(CONFIG_FILE, configData);
    writePrivateFile(STATE_FILE, stateData);
    console.log(remoteState
      ? '[MEGA] Restored config.json and state.json from the private MEGA folder.'
      : '[MEGA] Restored config.json; state.json was absent and has been initialized empty.');
    return true;
  } catch (error) {
    safeFailure('Download', error);
    return false;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

export async function syncToMega(): Promise<boolean> {
  let storage: Storage | undefined;
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      throw new SyncFailure('Local config.json is missing; refusing to upload incomplete data.');
    }
    const configData = fs.readFileSync(CONFIG_FILE);
    parseConfigJson(configData);

    let stateData: Buffer;
    if (fs.existsSync(STATE_FILE)) {
      stateData = fs.readFileSync(STATE_FILE);
      parseStateJson(stateData);
    } else {
      stateData = Buffer.from('{}\n', 'utf8');
      writePrivateFile(STATE_FILE, stateData);
    }

    storage = await openStorage();
    const folder = await getTrackerFolder(storage, true);
    if (!folder) throw new SyncFailure('Could not create MEGA folder github-data/parcel-tracker.');

    await uploadRemoteFile(folder, 'config.json', configData);
    console.log('[MEGA] Uploaded validated config.json.');
    await uploadRemoteFile(folder, 'state.json', stateData);
    console.log('[MEGA] Uploaded validated state.json.');
    return true;
  } catch (error) {
    safeFailure('Upload', error);
    return false;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

export async function initializeMega(): Promise<boolean> {
  let storage: Storage | undefined;
  try {
    if (!fs.existsSync(EXAMPLE_CONFIG_FILE)) {
      throw new SyncFailure('config.example.json is missing from the checkout.');
    }
    const configData = fs.readFileSync(EXAMPLE_CONFIG_FILE);
    parseConfigJson(configData);

    storage = await openStorage();
    const folder = await getTrackerFolder(storage, true);
    if (!folder) throw new SyncFailure('Could not create MEGA folder github-data/parcel-tracker.');

    if (newestFile(folder, 'config.json')) {
      console.log('[MEGA] Existing config.json found; preserved without modification.');
    } else {
      await uploadRemoteFile(folder, 'config.json', configData);
      console.log('[MEGA] Initialized config.json from the placeholder template. Add real parcels privately in MEGA.');
    }
    if (newestFile(folder, 'state.json')) {
      console.log('[MEGA] Existing state.json found; preserved without modification.');
    } else {
      await uploadRemoteFile(folder, 'state.json', Buffer.from('{}\n', 'utf8'));
      console.log('[MEGA] Initialized empty state.json.');
    }
    return true;
  } catch (error) {
    safeFailure('Initialization', error);
    return false;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

const command = process.argv[2];
const commandTask = command === 'download'
  ? syncFromMega()
  : command === 'upload'
    ? syncToMega()
    : command === 'initialize'
      ? initializeMega()
      : undefined;

if (commandTask) {
  commandTask.then((ok) => {
    if (!ok) process.exitCode = 1;
  }).catch(() => {
    console.error('[MEGA] Unexpected sync failure.');
    process.exitCode = 1;
  });
}
