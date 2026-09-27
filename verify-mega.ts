import { Storage } from 'megajs';

const EMAIL = process.env.MEGA_EMAIL;
const PASSWORD = process.env.MEGA_PASSWORD;

async function verify() {
  if (!EMAIL || !PASSWORD) {
    console.error('[MEGA-VERIFY] Error: MEGA_EMAIL or MEGA_PASSWORD not set.');
    process.exit(1);
  }
  console.log(`[MEGA-VERIFY] Connecting as ${EMAIL}...`);
  const storage = await new Storage({ email: EMAIL, password: PASSWORD }).ready;
  console.log('[MEGA-VERIFY] Connected successfully.');

  await new Promise((resolve, reject) => {
    storage.reload(err => err ? reject(err) : resolve(true));
  });

  const rootFolder: any = (storage.root.children || []).find((f: any) => f.directory && f.name === 'github-data');
  if (!rootFolder) {
    console.log('[MEGA-VERIFY] Folder "github-data" not found.');
    return;
  }

  const trackerFolder: any = (rootFolder.children || []).find((f: any) => f.directory && f.name === 'parcel-tracker');
  if (!trackerFolder) {
    console.log('[MEGA-VERIFY] Folder "parcel-tracker" not found under "github-data".');
    return;
  }

  console.log('[MEGA-VERIFY] Contents of github-data/parcel-tracker:');
  for (const child of (trackerFolder.children || [])) {
    console.log(`- Name: ${child.name}, Directory: ${child.directory}, Size: ${child.size || 0} bytes`);
  }
}

verify().catch(err => {
  console.error('[MEGA-VERIFY] Failed:', err);
  process.exit(1);
});
