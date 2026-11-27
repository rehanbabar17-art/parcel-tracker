import type { TrackingResult, HistoryItem } from './types.ts';

interface SpeedafTrackEntry {
  action?: string | number;
  time?: string;
  msgEng?: string;
  msgLoc?: string;
  message?: string;
  desc?: string;
  description?: string;
  actionName?: string;
  siteName?: string;
  stationName?: string;
  location?: string;
  city?: string;
  blExceptionSign?: boolean;
}

interface SpeedafWaybillData {
  mailNo?: string;
  countryCode?: string | null;
  waybillType?: string;
  mainCode?: string | null;
  blExceptionSign?: boolean;
  tracks?: SpeedafTrackEntry[] | null;
}

interface SpeedafApiResponse {
  success?: boolean;
  error?: { code?: string; message?: string } | null;
  data?: SpeedafWaybillData[] | null;
}

const SPEEDAF_HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  'Accept': 'application/json, text/plain, */*',
  'lang': 'en_US',
  'version': '1.0.0',
  'countryCode': 'CN',
  'Origin': 'https://www.speedaf.com',
  'Referer': 'https://www.speedaf.com/cn-en/send-parcel',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

function cleanMessage(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLocation(entry: SpeedafTrackEntry, message: string): string {
  const direct = entry.siteName || entry.stationName || entry.location || entry.city;
  if (direct && direct.trim()) {
    return direct.trim();
  }
  const bracketMatches = [...message.matchAll(/[\[\u3010]([^\]\u3011]{2,80})[\]\u3011]/g)];
  if (bracketMatches.length > 0) {
    const candidate = bracketMatches[0][1].trim();
    if (candidate && !/^\d+$/.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

function isDeliveredTrack(entry: SpeedafTrackEntry | undefined, statusText: string): boolean {
  if (entry && String(entry.action) === '5') {
    return true;
  }
  const lower = statusText.toLowerCase();
  if (
    lower.includes('undelivered') ||
    lower.includes('not delivered') ||
    lower.includes('delivery failed') ||
    lower.includes('failed delivery') ||
    lower.includes('out for delivery') ||
    lower.includes('attempt') ||
    lower.includes('unsuccessful')
  ) {
    return false;
  }
  return (
    lower.includes('delivered') ||
    lower.includes('signed') ||
    lower.includes('has been collected') ||
    statusText.includes('签收')
  );
}

export async function trackSpeedaf(trackingNumber: string): Promise<TrackingResult> {
  const cleanTracking = trackingNumber.trim();
  const listUrl = 'https://www.speedaf.com/publicservice/v1/api/express/track/listExpressTrack';
  const detailsUrl = `https://www.speedaf.com/publicservice/v1/api/express/track/expressTrack/details?mailNo=${encodeURIComponent(cleanTracking)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch(listUrl, {
      method: 'POST',
      headers: SPEEDAF_HEADERS,
      body: JSON.stringify({ mailNoList: [cleanTracking] }),
      signal: controller.signal
    });

    if (!resp.ok) {
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `HTTP ${resp.status} ${resp.statusText}`
      };
    }

    const payload = (await resp.json()) as SpeedafApiResponse;
    if (payload?.success === false) {
      return {
        status: 'Error',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: payload.error?.message || 'Speedaf tracking API returned an error'
      };
    }

    const waybill = Array.isArray(payload?.data) && payload.data.length > 0 ? payload.data[0] : null;
    if (!waybill) {
      return {
        status: 'Pending - Awaiting First Scan',
        location: 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false
      };
    }

    let rawTracks: SpeedafTrackEntry[] = Array.isArray(waybill.tracks) ? waybill.tracks : [];

    // Fallback to sub-waybill / details endpoint if listExpressTrack returned no tracks
    if (rawTracks.length === 0) {
      try {
        const detailResp = await fetch(detailsUrl, {
          method: 'GET',
          headers: SPEEDAF_HEADERS,
          signal: controller.signal
        });
        if (detailResp.ok) {
          const detailJson = (await detailResp.json()) as SpeedafApiResponse;
          const detailTracks = detailJson?.data?.[0]?.tracks;
          if (Array.isArray(detailTracks) && detailTracks.length > 0) {
            rawTracks = detailTracks;
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }

    // Match official Speedaf frontend filter: hide internal action "-2" unless blExceptionSign is true
    const filteredTracks = rawTracks.filter((t) =>
      Boolean(waybill.blExceptionSign) || String(t.action ?? '') !== '-2'
    );

    if (filteredTracks.length === 0) {
      return {
        status: 'Pending - Awaiting First Scan',
        location: waybill.countryCode ? waybill.countryCode.toUpperCase() : 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false
      };
    }

    const history: HistoryItem[] = [];
    for (let i = 0; i < filteredTracks.length; i++) {
      const entry = filteredTracks[i];
      const rawMsg =
        entry.msgEng ||
        entry.msgLoc ||
        entry.message ||
        entry.desc ||
        entry.description ||
        entry.actionName ||
        '';
      const statusText = cleanMessage(rawMsg);
      if (!statusText) continue;

      const loc = extractLocation(entry, statusText);
      history.push({
        step: i + 1,
        timestamp: (entry.time || '').trim(),
        status: statusText,
        location: loc
      });
    }

    if (history.length === 0) {
      return {
        status: 'Pending - Awaiting First Scan',
        location: waybill.countryCode ? waybill.countryCode.toUpperCase() : 'N/A',
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false
      };
    }

    const latest = history[0];
    const latestRaw = filteredTracks[0];
    const location = latest.location || (waybill.countryCode ? waybill.countryCode.toUpperCase() : 'N/A');
    const delivered = isDeliveredTrack(latestRaw, latest.status);

    return {
      status: latest.status,
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
      error: `Tracking failed: ${err?.message || String(err)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}
