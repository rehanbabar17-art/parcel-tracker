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

    // Reload storage to ensure all files/folders are up to date
    await new Promise((resolve, reject) => {
      storage.reload(err => err ? reject(err) : resolve(true));
    });

    // Find or create github-data folder
    let rootFolder = storage.files.find(f => f.directory && f.name === 'github-data');
    if (!rootFolder) {
      rootFolder = await storage.root.mkdir('github-data');
    }

    // Find or create parcel-tracker folder
    let trackerFolder = (rootFolder.children || []).find(f => f.directory && f.name === 'parcel-tracker');
    if (!trackerFolder) {
      trackerFolder = await rootFolder.mkdir('parcel-tracker');
    }

    // Ensure trackerFolder children are loaded
    if (trackerFolder.children) {
      const configNode = trackerFolder.children.find(f => !f.directory && f.name === 'config.json');
      if (configNode) {
        const data = await configNode.downloadBuffer();
        fs.writeFileSync(path.join(ROOT_DIR, 'config.json'), data);
        console.log('[MEGA] Downloaded config.json successfully.');
      }

      const stateNode = trackerFolder.children.find(f => !f.directory && f.name === 'state.json');
      if (stateNode) {
        const data = await stateNode.downloadBuffer();
        fs.writeFileSync(path.join(ROOT_DIR, 'state.json'), data);
        console.log('[MEGA] Downloaded state.json successfully.');
      }
    }
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

    // Reload storage
    await new Promise((resolve, reject) => {
      storage.reload(err => err ? reject(err) : resolve(true));
    });

    // Find or create github-data folder
    let rootFolder = storage.files.find(f => f.directory && f.name === 'github-data');
    if (!rootFolder) {
      rootFolder = await storage.root.mkdir('github-data');
    }

    // Find or create parcel-tracker folder
    let trackerFolder = (rootFolder.children || []).find(f => f.directory && f.name === 'parcel-tracker');
    if (!trackerFolder) {
      trackerFolder = await rootFolder.mkdir('parcel-tracker');
    }

    // Upload config.json if exists
    const configPath = path.join(ROOT_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const existing = (trackerFolder.children || []).find(f => !f.directory && f.name === 'config.json');
      if (existing) {
        await existing.delete();
      }
      const buf = fs.readFileSync(configPath);
      await trackerFolder.upload({ name: 'config.json', size: buf.length }, buf).complete;
      console.log('[MEGA] Uploaded config.json successfully.');
    }

    // Upload state.json if exists
    const statePath = path.join(ROOT_DIR, 'state.json');
    if (fs.existsSync(statePath)) {
      const existing = (trackerFolder.children || []).find(f => !f.directory && f.name === 'state.json');
      if (existing) {
        await existing.delete();
      }
      const buf = fs.readFileSync(statePath);
      await trackerFolder.upload({ name: 'state.json', size: buf.length }, buf).complete;
      console.log('[MEGA] Uploaded state.json successfully.');
    }

    return true;
  } catch (err) {
    console.error('[MEGA] Error syncing to MEGA:', err);
    return false;
  }
}

if (process.argv[2] === 'download') {
  syncFromMega().then(() => process.exit(0));
} else if (process.argv[2] === 'upload') {
  syncToMega().then(() => process.exit(0));
}
