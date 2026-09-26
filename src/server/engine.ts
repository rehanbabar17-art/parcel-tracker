import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppConfig,
  CourierName,
  HistoryItem,
  ParcelConfig,
  StateEntry,
  StatusChange,
  TrackingResult,
  TrackingState
} from './trackers/types.ts';
import { trackParcel } from './trackers/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const STATE_FILE = path.join(ROOT_DIR, 'state.json');
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');

// Default initial config if none exists (safe generic placeholder - secrets belong in config.json or GitHub Secrets)
const DEFAULT_CONFIG: AppConfig = {
  trackers: [],
  ntfy: {
    server: "https://ntfy.sh",
    topic: "parcel-tracker",
    priority: "default",
    tags: ["package", "delivery"]
  }
};

function maskNumber(num: string): string {
  if (!num || num.length <= 6) return '****';
  return `${num.slice(0, 4)}****${num.slice(-2)}`;
}

let inMemoryConfig: AppConfig = loadConfig();
let inMemoryState: TrackingState = loadState();

export function getConfig(): AppConfig {
  return inMemoryConfig;
}

export function saveConfig(newConfig: AppConfig): AppConfig {
  inMemoryConfig = newConfig;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Engine] Failed to write config.json:', err);
  }
  return inMemoryConfig;
}

export function getState(): TrackingState {
  return inMemoryState;
}

export function loadConfig(): AppConfig {
  const trackers: ParcelConfig[] = [];
  let ntfy = {
    server: "https://ntfy.sh",
    topic: "parcel-tracker-rehanbabar",
    priority: "default",
    tags: ["package", "delivery"]
  };

  // 1. Ingest from TRACKER_CONFIG environment variable (from GitHub Secrets)
  if (process.env.TRACKER_CONFIG) {
    try {
      const parsed = JSON.parse(process.env.TRACKER_CONFIG);
      if (parsed?.ntfy?.topic) ntfy = parsed.ntfy;
      if (Array.isArray(parsed?.trackers)) {
        for (const t of parsed.trackers) {
          if (t && t.tracking_number && !String(t.tracking_number).startsWith('YOUR_')) {
            trackers.push(t);
          }
        }
      }
    } catch (e) {
      console.warn('[Engine] Error parsing TRACKER_CONFIG env var:', e);
    }
  }

  // 2. Ingest from config.json (internal cache or local config)
  const configPath = path.join(ROOT_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.ntfy?.topic) ntfy = parsed.ntfy;
      if (Array.isArray(parsed?.trackers)) {
        for (const t of parsed.trackers) {
          if (t && t.tracking_number && !String(t.tracking_number).startsWith('YOUR_')) {
            trackers.push(t);
          }
        }
      }
    } catch (e) {
      console.warn(`[Engine] Error reading config.json:`, e);
    }
  }

  // Deduplicate by courier:tracking_number
  const seen = new Set<string>();
  const mergedTrackers: ParcelConfig[] = [];
  for (const t of trackers) {
    const key = `${t.courier}:${t.tracking_number}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      mergedTrackers.push(t);
    }
  }

  // Ensure Veggie Cutter and Luna Watch are included by default
  const hasVeggie = mergedTrackers.some(
    t => String(t.tracking_number).trim() === '421001805332' || t.name.toLowerCase().includes('veggie')
  );
  if (!hasVeggie) {
    mergedTrackers.push({
      name: 'Veggie Cutter',
      courier: 'tcs',
      tracking_number: '421001805332'
    });
  }

  const hasLunaWatch = mergedTrackers.some(
    t => String(t.tracking_number).trim() === '421001815195' || t.name.toLowerCase().includes('luna watch')
  );
  if (!hasLunaWatch) {
    mergedTrackers.push({
      name: 'Luna Watch',
      courier: 'tcs',
      tracking_number: '421001815195'
    });
  }

  const hasPamolive = mergedTrackers.some(
    t => String(t.tracking_number).trim() === 'PK-DEX211483098' || t.name.toLowerCase().includes('pamolive')
  );
  if (!hasPamolive) {
    mergedTrackers.push({
      name: 'Pamolive Shampoo',
      courier: 'dex',
      tracking_number: 'PK-DEX211483098'
    });
  }

  return {
    trackers: mergedTrackers,
    ntfy
  };
}

export function loadState(): TrackingState {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Engine] Error reading state.json:', e);
    }
  }
  return {};
}

export function saveState(state: TrackingState) {
  inMemoryState = state;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Engine] Failed to write state.json:', err);
  }
}

export function buildSummary(config: AppConfig, state: TrackingState): string {
  const lines: string[] = [];
  for (const parcel of config.trackers) {
    const { name, courier, tracking_number } = parcel;
    if (tracking_number.startsWith('YOUR_')) continue;

    const parcelKey = `${courier}:${tracking_number}`;
    const entry: Partial<StateEntry> = state[parcelKey] || {};
    if (entry.removed) continue;

    const status = entry.status || 'Unknown';
    const location = entry.location || '';
    const loc = location && location !== 'N/A' ? ` @ ${location}` : '';

    const deliveredAt = entry.delivered_at;
    if (deliveredAt && status.toLowerCase().includes('delivered')) {
      lines.push(`  • ${name}: ${status}${loc} [Delivered]`);
    } else {
      lines.push(`  • ${name}: ${status}${loc}`);
    }
  }
  return lines.join('\n');
}

export function removeDeliveredParcels(config: AppConfig, state: TrackingState): number {
  const now = new Date();
  let count = 0;

  const toRemoveIndices: number[] = [];

  for (let i = 0; i < config.trackers.length; i++) {
    const parcel = config.trackers[i];
    const parcelKey = `${parcel.courier}:${parcel.tracking_number}`;
    const entry = state[parcelKey];

    // If parcel is marked delivered but delivered_at wasn't set, initialize it
    if (entry?.status?.toLowerCase().includes('delivered') && !entry.delivered_at) {
      entry.delivered_at = new Date().toISOString();
    }

    if (entry?.delivered_at) {
      const deliveredTime = new Date(entry.delivered_at);
      const hoursSinceDelivery = (now.getTime() - deliveredTime.getTime()) / (1000 * 3600);

      if (hoursSinceDelivery >= 48) {
        state[parcelKey] = {
          ...entry,
          status: entry.status || 'Delivered',
          last_checked: new Date().toISOString(),
          removed: true
        };
        toRemoveIndices.push(i);
        count++;
        console.log(`[Engine] Parcel delivered over 48h ago, auto-removed from active tracking: ${parcel.name} (${parcel.courier.toUpperCase()} #${parcel.tracking_number})`);
      }
    }
  }

  if (toRemoveIndices.length > 0) {
    config.trackers = config.trackers.filter((_, idx) => !toRemoveIndices.includes(idx));
    saveConfig(config);
    saveState(state);
  }

  return count;
}

export async function sendNtfy(
  config: AppConfig,
  title: string,
  message: string,
  priority = 'default',
  tags = ['package']
): Promise<{ success: boolean; error?: string }> {
  if (process.env.TRACKER_SILENT === '1') {
    console.log(`[ntfy SILENT] Would send: ${title}`);
    return { success: true };
  }

  const server = config.ntfy?.server || 'https://ntfy.sh';
  const topic = config.ntfy?.topic;
  if (!topic || topic.startsWith('YOUR_')) {
    console.warn('[ntfy] Skipped: topic not configured.');
    return { success: false, error: 'Topic not configured' };
  }

  // Strip non-ASCII characters from Title/Tags HTTP headers to prevent node fetch header exceptions
  const cleanTitle = title.replace(/[^\x20-\x7E]/g, '').trim() || 'Parcel Update';
  const cleanTags = tags.map(t => t.replace(/[^\x20-\x7E]/g, '')).filter(Boolean).join(',');

  const url = `${server.replace(/\/$/, '')}/${topic}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Title': cleanTitle,
        'Priority': priority,
        'Tags': cleanTags,
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body: message
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let parsedMsg = errText;
      try {
        const json = JSON.parse(errText);
        if (json.error) parsedMsg = json.error;
      } catch {}
      console.warn(`[ntfy] Notification failed (${res.status} ${res.statusText}): ${parsedMsg}`);
      return { success: false, error: `${res.status} ${res.statusText}: ${parsedMsg}` };
    }
    console.log(`[ntfy] Notification successfully sent to topic: ${topic}`);
    return { success: true };
  } catch (err: any) {
    console.error('[ntfy] Error sending notification:', err);
    return { success: false, error: err.message || String(err) };
  }
}

export async function trackAllParcels(options?: { sendNotifications?: boolean }): Promise<{
  changes: StatusChange[];
  errors: Array<{ name: string; tracking_number: string; error: string }>;
  summary: string;
  timestamp: string;
}> {
  const config = getConfig();
  const state = getState();
  const shouldNotify = options?.sendNotifications !== false;

  removeDeliveredParcels(config, state);

  const changes: StatusChange[] = [];
  const errors: Array<{ name: string; tracking_number: string; error: string }> = [];

  console.log(`\n📦 [${new Date().toISOString()}] Tracking ${config.trackers.length} parcel(s)...`);

  for (const parcel of config.trackers) {
    const { name, courier, tracking_number } = parcel;
    if (tracking_number.startsWith('YOUR_')) {
      console.log(`  [SKIP] Placeholder parcel: ${name}`);
      continue;
    }

    const parcelKey = `${courier}:${tracking_number}`;
    if (state[parcelKey]?.removed) {
      console.log(`  [SKIP] Parcel removed from active tracking: ${name}`);
      continue;
    }

    console.log(`\nChecking: ${name} (${courier.toUpperCase()} #${maskNumber(tracking_number)})`);

    try {
      const result = await trackParcel(courier, tracking_number);
      const previousStatus = state[parcelKey]?.status || '';
      const currentStatus = result.status || '';
      const isDelivered = result.delivered;

      if (result.error) {
        console.log(`  [ERROR] ${result.error}`);
        if (previousStatus !== `ERROR:${result.error}`) {
          errors.push({ name, tracking_number, error: result.error });
          state[parcelKey] = {
            status: `ERROR:${result.error}`,
            last_checked: new Date().toISOString()
          };
        }
      } else if (currentStatus !== previousStatus) {
        console.log(`  [STATUS CHANGED] "${previousStatus || 'New'}" -> "${currentStatus}" (Location: ${result.location || 'N/A'})`);
        changes.push({
          name,
          courier,
          tracking_number,
          result,
          previous_status: previousStatus || 'New Parcel'
        });

        state[parcelKey] = {
          status: currentStatus,
          last_checked: new Date().toISOString(),
          location: result.location || 'N/A',
          history: result.history,
          customer: result.customer
        };

        if (isDelivered && !state[parcelKey].delivered_at) {
          state[parcelKey].delivered_at = new Date().toISOString();
        }
      } else {
        console.log(`  [NO CHANGE] Current status: "${currentStatus}" (Location: ${result.location || 'N/A'})`);
        // Updated last checked and refresh history
        state[parcelKey] = {
          ...state[parcelKey],
          last_checked: new Date().toISOString(),
          location: result.location || state[parcelKey]?.location,
          history: result.history || state[parcelKey]?.history,
          customer: result.customer || state[parcelKey]?.customer
        };
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      console.error(`  [EXCEPTION] ${errMsg}`);
      errors.push({ name, tracking_number, error: errMsg });
      state[parcelKey] = {
        status: `ERROR:${errMsg}`,
        last_checked: new Date().toISOString()
      };
    }
  }

  saveState(state);
  const summary = buildSummary(config, state);

  if (shouldNotify && changes.length > 0) {
    for (const change of changes) {
      const { result, name, tracking_number } = change;
      let message = `Tracking: ${tracking_number}\nStatus: ${result.status}\n`;
      if (result.location && result.location !== 'N/A') {
        message += `Location: ${result.location}\n`;
      }
      if (result.history && result.history.length > 0) {
        message += `\nRecent:\n`;
        for (const h of result.history.slice(0, 2)) {
          message += `  ${h.timestamp}: ${h.status}\n`;
        }
      }
      message += `\n--- All Parcels ---\n${summary}`;

      let priority = 'default';
      const tags = ['package', 'delivery'];
      const statusLower = result.status.toLowerCase();
      let title = `UPDATE: ${name}`;

      if (statusLower.includes('delivered')) {
        priority = 'high';
        tags.push('white_check_mark');
        title = `DELIVERED: ${name}`;
      } else if (statusLower.includes('out for delivery') || statusLower.includes('about to deliver')) {
        priority = 'high';
        tags.push('truck');
        title = `OUT FOR DELIVERY: ${name}`;
      } else if (statusLower.includes('departing') || statusLower.includes('dispatched')) {
        title = `IN TRANSIT: ${name}`;
      }

      await sendNtfy(config, title, message, priority, tags);
    }
  }

  if (shouldNotify && errors.length > 0) {
    for (const err of errors) {
      const message = `Tracking: ${err.tracking_number}\nError: ${err.error}\n\n--- All Parcels ---\n${summary}`;
      await sendNtfy(config, `TRACKING ERROR: ${err.name}`, message, 'high', ['warning', 'package']);
    }
  }

  return {
    changes,
    errors,
    summary,
    timestamp: new Date().toISOString()
  };
}

export async function notifyParcel(
  name: string,
  courier: string,
  tracking_number: string,
  status: string,
  location?: string,
  history?: HistoryItem[]
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  const state = getState();
  const summary = buildSummary(config, state);

  let message = `Tracking: ${tracking_number}\nCourier: ${courier.toUpperCase()}\nStatus: ${status}\n`;
  if (location && location !== 'N/A') {
    message += `Location: ${location}\n`;
  }
  if (history && history.length > 0) {
    message += `\nRecent Checkpoints:\n`;
    for (const h of history.slice(0, 3)) {
      message += `  • ${h.timestamp || 'Scan'}: ${h.status}\n`;
    }
  }
  message += `\n--- All Tracked Parcels ---\n${summary}`;

  let priority = 'default';
  const tags = ['package', 'delivery'];
  const statusLower = status.toLowerCase();
  let title = `UPDATE: ${name}`;

  if (statusLower.includes('delivered')) {
    priority = 'high';
    tags.push('white_check_mark');
    title = `DELIVERED: ${name}`;
  } else if (statusLower.includes('out for delivery') || statusLower.includes('about to deliver')) {
    priority = 'high';
    tags.push('truck');
    title = `OUT FOR DELIVERY: ${name}`;
  } else if (statusLower.includes('departing') || statusLower.includes('dispatched')) {
    title = `IN TRANSIT: ${name}`;
  } else if (statusLower.includes('awaiting') || statusLower.includes('no data') || statusLower.includes('booking')) {
    title = `TRACKING ACTIVE: ${name}`;
    tags.push('hourglass');
  }

  return sendNtfy(config, title, message, priority, tags);
}

