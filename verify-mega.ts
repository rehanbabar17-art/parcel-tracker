import { Storage } from 'megajs';
import { parseConfigJson, parseStateJson } from './src/server/mega-sync.ts';

type MegaFolder = Storage['root'];
type MegaNode = NonNullable<MegaFolder['children']>[number];

const EMAIL = process.env.MEGA_EMAIL;
const PASSWORD = process.env.MEGA_PASSWORD;

function findChild(folder: MegaFolder, name: string, directory: boolean): MegaNode | undefined {
  return (folder.children ?? []).find((node) => node.directory === directory && node.name === name);
}

function newestFile(folder: MegaFolder, name: string): MegaNode | undefined {
  const files = (folder.children ?? []).filter((node) => !node.directory && node.name === name);
  return files.reduce<MegaNode | undefined>((latest, node) => {
    if (!latest) return node;
    return Number(node.timestamp ?? 0) >= Number(latest.timestamp ?? 0) ? node : latest;
  }, undefined);
}

async function verify(): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Required MEGA Actions secrets are missing.');
  }

  const storage = await new Storage({ email: EMAIL, password: PASSWORD }).ready;
  try {
    await storage.reload(true);
    const rootFolder = findChild(storage.root, 'github-data', true);
    const trackerFolder = rootFolder ? findChild(rootFolder, 'parcel-tracker', true) : undefined;
    if (!trackerFolder) {
      throw new Error('The private MEGA tracker folder is missing.');
    }

    const configFile = newestFile(trackerFolder, 'config.json');
    const stateFile = newestFile(trackerFolder, 'state.json');
    if (!configFile || !stateFile) {
      throw new Error('config.json or state.json is missing from the private MEGA folder.');
    }

    const configData = await configFile.downloadBuffer({});
    const stateData = await stateFile.downloadBuffer({});
    const config = parseConfigJson(configData);
    const state = parseStateJson(stateData);

    console.log('[MEGA-VERIFY] Authentication succeeded; private files are present and valid.');
    console.log(`[MEGA-VERIFY] config.json: valid (${configData.length} bytes; ${config.trackers.length} tracker entries).`);
    console.log(`[MEGA-VERIFY] state.json: valid (${stateData.length} bytes; ${Object.keys(state).length} state entries).`);
  } finally {
    await storage.close().catch(() => undefined);
  }
}

verify().catch(() => {
  console.error('[MEGA-VERIFY] Verification failed. Check account access, folder contents, and file validity.');
  process.exitCode = 1;
});
