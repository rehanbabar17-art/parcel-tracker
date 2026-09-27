import { Storage } from 'megajs';
import fs from 'fs';
import path from 'path';

const EMAIL = process.env.MEGA_EMAIL;
const PASSWORD = process.env.MEGA_PASSWORD;
const ROOT_DIR = process.cwd();

export async function syncFromMega(): Promise<boolean> {
  if (!EMAIL || !PASSWORD) {
    console.log('[MEGA] MEGA_EMAIL or MEGA_PASSWORD not set. Skipping MEGA sync.');
    return false;
  }

  try {
    console.log('[MEGA] Connecting to MEGA...');
    const storage = await new Storage({ email: EMAIL, password: PASSWORD }).ready;
    console.log('[MEGA] Connected successfully.');

    // Find or create folder structure: github-data -> parcel-tracker
    let rootFolder = storage.root.children.find(c => c.name === 'github-data' && c.directory);
    if (!rootFolder) {
      rootFolder = await storage.root.mkdir('github-data');
    }

    let trackerFolder = rootFolder.children.find(c => c.name === 'parcel-tracker' && c.directory);
    if (!trackerFolder) {
      trackerFolder = await rootFolder.mkdir('parcel-tracker');
    }

    // Download config.json and state.json if present
    const configNode = trackerFolder.children.find(c => c.name === 'config.json' && !c.directory);
    if (configNode) {
      const data = await configNode.downloadBuffer();
      fs.writeFileSync(path.join(ROOT_DIR, 'config.json'), data);
      console.log('[MEGA] Downloaded config.json successfully.');
    }

    const stateNode = trackerFolder.children.find(c => c.name === 'state.json' && !c.directory);
    if (stateNode) {
      const data = await stateNode.downloadBuffer();
      fs.writeFileSync(path.join(ROOT_DIR, 'state.json'), data);
      console.log('[MEGA] Downloaded state.json successfully.');
    }

    storage.logout();
    return true;
  } catch (err) {
    console.error('[MEGA] Error syncing from MEGA:', err);
    return false;
  }
}

export async function syncToMega(): Promise<boolean> {
  if (!EMAIL || !PASSWORD) {
    console.log('[MEGA] MEGA_EMAIL or MEGA_PASSWORD not set. Skipping MEGA upload.');
    return false;
  }

  try {
    console.log('[MEGA] Connecting to MEGA for upload...');
    const storage = await new Storage({ email: EMAIL, password: PASSWORD }).ready;
    console.log('[MEGA] Connected successfully.');

    let rootFolder = storage.root.children.find(c => c.name === 'github-data' && c.directory);
    if (!rootFolder) {
      rootFolder = await storage.root.mkdir('github-data');
    }

    let trackerFolder = rootFolder.children.find(c => c.name === 'parcel-tracker' && c.directory);
    if (!trackerFolder) {
      trackerFolder = await rootFolder.mkdir('parcel-tracker');
    }

    // Upload config.json if exists
    const configPath = path.join(ROOT_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const existing = trackerFolder.children.find(c => c.name === 'config.json' && !c.directory);
      if (existing) {
        await existing.delete();
      }
      const stream = fs.createReadStream(configPath);
      await trackerFolder.upload('config.json', stream).complete;
      console.log('[MEGA] Uploaded config.json successfully.');
    }

    // Upload state.json if exists
    const statePath = path.join(ROOT_DIR, 'state.json');
    if (fs.existsSync(statePath)) {
      const existing = trackerFolder.children.find(c => c.name === 'state.json' && !c.directory);
      if (existing) {
        await existing.delete();
      }
      const stream = fs.createReadStream(statePath);
      await trackerFolder.upload('state.json', stream).complete;
      console.log('[MEGA] Uploaded state.json successfully.');
    }

    storage.logout();
    return true;
  } catch (err) {
    console.error('[MEGA] Error syncing to MEGA:', err);
    return false;
  }
}

// Allow running via CLI if executed directly
if (process.argv[2] === 'download') {
  syncFromMega().then(() => process.exit(0));
} else if (process.argv[2] === 'upload') {
  syncToMega().then(() => process.exit(0));
}
