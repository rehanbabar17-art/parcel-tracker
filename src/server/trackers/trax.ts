import type { TrackingResult, HistoryItem } from './types.ts';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface TraxTrackingEvent {
  timestamp?: string;
  status?: string;
  rawStatus?: string;
  location?: string;
  description?: string;
}

interface TraxInitialShipment {
  trackingNumber?: string;
  carrier?: string;
  status?: string;
  isTerminal?: boolean;
  historyAvailable?: boolean;
  origin?: string;
  destination?: string;
  events?: TraxTrackingEvent[];
  lastEventAt?: string;
  displayStatusText?: string;
  hubDetails?: {
    courierName?: string;
    trackingNumber?: string;
    lastEventDate?: string;
    lastEventTime?: string;
    statusCategory?: string;
    currentStatus?: string;
    steps?: Array<{
      status?: string;
      rawStatus?: string;
      reason?: string;
      statusCategory?: string;
    }>;
  };
}

function isDeliveredStatus(status: string, category?: string): boolean {
  if (category && category.trim().toLowerCase() === 'delivered') {
    return true;
  }
  const lower = status.toLowerCase();
  if (
    lower.includes('undelivered') ||
    lower.includes('not delivered') ||
    lower.includes('failed') ||
    lower.includes('out for delivery') ||
    lower.includes('return')
  ) {
    return false;
  }
  return lower.includes('delivered');
}

function formatEventTimestamp(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  // Format ISO strings like "2026-11-26T23:06:00+05:00" -> "2026-11-26 23:06" preserving local time
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]} ${isoMatch[2]}`;
  }
  return trimmed;
}

function cleanLocationValue(val?: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === 'not provided' || trimmed === '$undefined' || trimmed === 'N/A') {
    return '';
  }
  return trimmed;
}

function extractBalancedJsonObject(source: string, startBraceIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startBraceIndex, i + 1);
      }
    }
  }
  return null;
}

function parseInitialShipmentFromHtml(html: string): TraxInitialShipment | null {
  const chunkRegex = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let match: RegExpExecArray | null;

  while ((match = chunkRegex.exec(html)) !== null) {
    const rawChunk = match[1];
    if (!rawChunk.includes('initialShipment')) continue;

    let decoded = rawChunk;
    try {
      decoded = JSON.parse(`"${rawChunk}"`);
    } catch {
      decoded = rawChunk.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    const marker = '"initialShipment":';
    const markerIdx = decoded.indexOf(marker);
    if (markerIdx === -1) continue;

    const braceStart = decoded.indexOf('{', markerIdx + marker.length);
    if (braceStart === -1) continue;

    const jsonStr = extractBalancedJsonObject(decoded, braceStart);
    if (!jsonStr) continue;

    try {
      const parsed = JSON.parse(jsonStr) as TraxInitialShipment;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Try next chunk or HTML fallback
    }
  }

  return null;
}

function parseHtmlFallback(html: string): TrackingResult | null {
  const cleanText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n');

  if (
    /Temporarily Unavailable/i.test(cleanText) ||
    /Tracking information is temporarily unavailable/i.test(cleanText) ||
    /No shipment record found/i.test(cleanText)
  ) {
    return null;
  }

  let status = '';
  const statusMatch = cleanText.match(/Current Status\/Reason\s*:\s*\n?([^\n]+)(?:\n([^\n]+))?/i);
  if (statusMatch) {
    const line1 = (statusMatch[1] || '').trim();
    const line2 = (statusMatch[2] || '').trim();
    if (line2 && !/^Dated\s*:/i.test(line2) && !/^Last updated/i.test(line2)) {
      status = line2;
    } else if (line1) {
      status = line1;
    }
  }

  const history: HistoryItem[] = [];
  const timelineStart = html.indexOf('Shipment Timeline');
  if (timelineStart !== -1) {
    const timelineSlice = html.slice(timelineStart, timelineStart + 15000);
    const cardRegex =
      /<span[^>]*class="[^"]*font-bold[^"]*rounded-full[^"]*"[^>]*>([^<]+)<\/span>[\s\S]*?<div[^>]*class="[^"]*font-mono[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m: RegExpExecArray | null;
    while ((m = cardRegex.exec(timelineSlice)) !== null) {
      const evStatus = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const evTime = m[2]
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[•·]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (evStatus) {
        history.push({
          timestamp: evTime,
          status: evStatus,
          location: ''
        });
      }
    }
  }

  if (!status && history.length > 0) {
    status = history[0].status;
  }

  if (!status || status.toLowerCase() === 'unknown') {
    return null;
  }

  const originMatch = cleanText.match(/Origin\s*:\s*\n?([^\n]+)/i);
  const destMatch = cleanText.match(/Destination\s*:\s*\n?([^\n]+)/i);
  const origin = cleanLocationValue(originMatch?.[1]);
  const dest = cleanLocationValue(destMatch?.[1]);
  const location = origin && dest ? `${origin} -> ${dest}` : dest || origin || 'N/A';

  return {
    status,
    location,
    timestamp: new Date().toISOString(),
    history,
    delivered: isDeliveredStatus(status)
  };
}

async function trackTraxPrimary(trackingNumber: string): Promise<TrackingResult> {
  const cleanTracking = trackingNumber.trim();
  const url = `https://traxtracking.pk/track/${encodeURIComponent(cleanTracking)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': BROWSER_UA
      },
      signal: controller.signal
    });

    if (!resp.ok) {
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `Primary HTTP ${resp.status} ${resp.statusText}`
      };
    }

    const html = await resp.text();

    if (
      html.includes('TRAX Tracking Temporarily Unavailable') ||
      html.includes('Tracking information is temporarily unavailable')
    ) {
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: 'Primary source (traxtracking.pk) temporarily unavailable'
      };
    }

    const shipment = parseInitialShipmentFromHtml(html);
    if (shipment) {
      const rawEvents = Array.isArray(shipment.events) ? shipment.events : [];

      const enrichedEvents = rawEvents.map((ev, idx) => {
        const parsedMs = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
        return {
          idx,
          ms: Number.isFinite(parsedMs) ? parsedMs : null,
          timestamp: formatEventTimestamp(ev.timestamp),
          status: (ev.rawStatus || ev.description || ev.status || '').trim(),
          location: cleanLocationValue(ev.location)
        };
      });

      // Sort newest-first when timestamps are parseable
      if (enrichedEvents.length > 1 && enrichedEvents.every((e) => e.ms !== null)) {
        enrichedEvents.sort((a, b) => (b.ms! - a.ms!) || (a.idx - b.idx));
      }

      const history: HistoryItem[] = enrichedEvents
        .filter((e) => Boolean(e.status))
        .map((e) => ({
          timestamp: e.timestamp,
          status: e.status,
          location: e.location
        }));

      const status = (
        shipment.displayStatusText ||
        shipment.hubDetails?.currentStatus ||
        history[0]?.status ||
        shipment.status ||
        ''
      ).trim();

      if (!status || status.toLowerCase() === 'unknown') {
        return {
          status: 'Error',
          location: 'N/A',
          timestamp: new Date().toISOString(),
          history: [],
          delivered: false,
          error: 'Primary source returned empty status'
        };
      }

      const origin = cleanLocationValue(shipment.origin);
      const destination = cleanLocationValue(shipment.destination);
      const latestEventLoc = history.find((h) => h.location)?.location || '';
      const location =
        latestEventLoc ||
        (origin && destination ? `${origin} -> ${destination}` : destination || origin || 'N/A');

      const delivered =
        isDeliveredStatus(status, shipment.hubDetails?.statusCategory || shipment.status);

      return {
        status,
        location,
        timestamp: new Date().toISOString(),
        history,
        delivered
      };
    }

    const htmlResult = parseHtmlFallback(html);
    if (htmlResult) {
      return htmlResult;
    }

    return {
      status: 'Error',
      location: 'N/A',
      timestamp: new Date().toISOString(),
      history: [],
      delivered: false,
      error: 'Could not extract tracking details from traxtracking.pk'
    };
  } catch (err: any) {
    return {
      status: 'Error',
      location: 'N/A',
      timestamp: new Date().toISOString(),
      history: [],
      delivered: false,
      error: `Primary tracking failed: ${err?.message || String(err)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function trackTraxBackup(trackingNumber: string): Promise<TrackingResult> {
  const cleanTracking = trackingNumber.trim();
  const url = `https://sonic.pk/api/shipment/track/consignee/public?tracking_number=${encodeURIComponent(cleanTracking)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': BROWSER_UA
      },
      signal: controller.signal
    });

    if (!resp.ok) {
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `Backup HTTP ${resp.status} ${resp.statusText}`
      };
    }

    const data = (await resp.json()) as any;

    if (data?.status !== 1 || !data?.details) {
      const msg = data?.message || 'Not found';
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `Tracking not found: ${msg}`
      };
    }

    const detailsValues = Object.values(data.details);
    if (detailsValues.length === 0) {
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: 'No shipment details returned'
      };
    }

    const detail: any = detailsValues[0];
    const rawHistory = Array.isArray(detail?.tracking_history) ? detail.tracking_history : [];
    const status = rawHistory.length > 0 ? (rawHistory[0].status || 'Unknown') : 'Unknown';

    const consignee = detail?.consignee || {};
    const location = cleanLocationValue(consignee.destination) || 'N/A';

    const history: HistoryItem[] = [];
    for (const h of rawHistory) {
      history.push({
        timestamp: h.date_time || '',
        status: h.status || '',
        location: ''
      });
    }

    const delivered = isDeliveredStatus(status);

    return {
      status,
      location,
      timestamp: new Date().toISOString(),
      history,
      delivered
    };
  } catch (err: any) {
    return {
      status: 'Error',
      location: 'N/A',
      timestamp: new Date().toISOString(),
      history: [],
      delivered: false,
      error: `Backup tracking failed: ${err?.message || String(err)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function trackTrax(trackingNumber: string): Promise<TrackingResult> {
  // Primary source: traxtracking.pk
  const primaryResult = await trackTraxPrimary(trackingNumber);
  if (!primaryResult.error && primaryResult.status && primaryResult.status.toLowerCase() !== 'unknown') {
    return primaryResult;
  }

  console.warn(
    `[TRAX] Primary source (traxtracking.pk) failed for ${trackingNumber}: ${primaryResult.error || primaryResult.status}. Falling back to sonic.pk...`
  );

  // Backup source: sonic.pk API
  const backupResult = await trackTraxBackup(trackingNumber);
  if (!backupResult.error && backupResult.status && backupResult.status.toLowerCase() !== 'unknown') {
    return backupResult;
  }

  return {
    status: 'Error',
    location: 'N/A',
    timestamp: new Date().toISOString(),
    history: [],
    delivered: false,
    error: primaryResult.error || backupResult.error || `Tracking failed for ${trackingNumber}`
  };
}
