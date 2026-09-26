import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig, CourierName, ParcelConfig } from './trackers/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');

function maskNumber(num: string): string {
  if (!num || num.length <= 6) return '****';
  return `${num.slice(0, 4)}****${num.slice(-2)}`;
}

export function runManage(): void {
  const action = (process.env.ACTION || 'track').trim().toLowerCase();
  const name = (process.env.PARCEL_NAME || '').trim();
  const courier = (process.env.COURIER || '').trim().toLowerCase() as CourierName;
  const trackingNumber = (process.env.TRACKING_NUMBER || '').trim();
  const trackerConfigEnv = process.env.TRACKER_CONFIG;

  let currentConfig: AppConfig = {
    trackers: [],
    ntfy: {
      server: 'https://ntfy.sh',
      topic: 'CourierTracking_7f3a9c1d82b4e6f5a8d9c0e1f2b3a4',
      priority: 'default',
      tags: ['package', 'delivery']
    }
  };

  // 1. Read existing config.json if already restored from cache
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.trackers)) {
        currentConfig = parsed;
      }
    } catch (e) {
      console.warn('[Manage] Could not read existing cached config.json:', e);
    }
  } else if (trackerConfigEnv) {
    // 2. If not yet in cache, seed from existing TRACKER_CONFIG secret if present
    try {
      const parsed = JSON.parse(trackerConfigEnv);
      if (parsed && Array.isArray(parsed.trackers)) {
        currentConfig = parsed;
        console.log(`[Manage] Seeded ${currentConfig.trackers.length} parcel(s) from TRACKER_CONFIG.`);
      }
    } catch (e) {
      console.warn('[Manage] Could not parse TRACKER_CONFIG secret:', e);
    }
  }

  // Ensure Veggie Cutter and Luna Watch are present if no trackers exist or by default
  const hasVeggie = currentConfig.trackers.some(
    t => t.tracking_number === '421001805332' || t.name.toLowerCase().includes('veggie')
  );
  if (!hasVeggie) {
    currentConfig.trackers.push({
      name: 'Veggie Cutter',
      courier: 'tcs',
      tracking_number: '421001805332'
    });
    console.log('[Manage] Automatically added Veggie Cutter (TCS #4210****32) to tracking list.');
  }

  const hasLunaWatch = currentConfig.trackers.some(
    t => t.tracking_number === '421001815195' || t.name.toLowerCase().includes('luna watch')
  );
  if (!hasLunaWatch) {
    currentConfig.trackers.push({
      name: 'Luna Watch',
      courier: 'tcs',
      tracking_number: '421001815195'
    });
    console.log('[Manage] Automatically added Luna Watch (TCS #4210****95) to tracking list.');
  }

  const hasPamolive = currentConfig.trackers.some(
    t => t.tracking_number === 'PK-DEX211483098' || t.name.toLowerCase().includes('pamolive')
  );
  if (!hasPamolive) {
    currentConfig.trackers.push({
      name: 'Pamolive Shampoo',
      courier: 'dex',
      tracking_number: 'PK-DEX211483098'
    });
    console.log('[Manage] Automatically added Pamolive Shampoo (DEX #PK-DEX****98) to tracking list.');
  }

  // Handle Action
  if (action === 'add_parcel') {
    if (!name || !trackingNumber) {
      console.error('[Manage] Error: Parcel Name and Tracking Number are required to add a parcel.');
    } else {
      const validCouriers: CourierName[] = ['tcs', 'leopards', 'postex', 'daraz', 'dex', 'trax'];
      const chosenCourier = validCouriers.includes(courier) ? courier : 'tcs';
      
      const existingIdx = currentConfig.trackers.findIndex(
        t => t.tracking_number === trackingNumber || t.name.toLowerCase() === name.toLowerCase()
      );

      const newEntry: ParcelConfig = {
        name,
        courier: chosenCourier,
        tracking_number: trackingNumber
      };

      if (existingIdx >= 0) {
        currentConfig.trackers[existingIdx] = newEntry;
        console.log(`[Manage] Updated parcel: ${name} (${chosenCourier.toUpperCase()} #${maskNumber(trackingNumber)})`);
      } else {
        currentConfig.trackers.push(newEntry);
        console.log(`[Manage] Added new parcel: ${name} (${chosenCourier.toUpperCase()} #${maskNumber(trackingNumber)})`);
      }
    }
  } else if (action === 'remove_parcel') {
    const target = (name || trackingNumber).toLowerCase();
    if (!target) {
      console.error('[Manage] Error: Provide parcel name or tracking number to remove.');
    } else {
      const beforeCount = currentConfig.trackers.length;
      currentConfig.trackers = currentConfig.trackers.filter(
        t => t.name.toLowerCase() !== target && t.tracking_number !== target
      );
      if (currentConfig.trackers.length < beforeCount) {
        console.log(`[Manage] Removed parcel matching: "${target}"`);
      } else {
        console.log(`[Manage] No parcel found matching: "${target}"`);
      }
    }
  } else if (action === 'list_parcels') {
    console.log(`\n📋 Currently Stored Parcels (${currentConfig.trackers.length}):`);
    for (const t of currentConfig.trackers) {
      console.log(`  - ${t.name}: ${t.courier.toUpperCase()} #${maskNumber(t.tracking_number)}`);
    }
  }

  // Save the updated configuration to config.json (ready to be cached)
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Manage] Failed to write config.json:', err);
  }
}

runManage();
