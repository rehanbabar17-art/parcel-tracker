import { TrackingResult, HistoryItem } from './types.js';

export async function trackTrax(trackingNumber: string): Promise<TrackingResult> {
  const url = `https://sonic.pk/api/shipment/track/consignee/public?tracking_number=${encodeURIComponent(trackingNumber)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `HTTP ${resp.status} ${resp.statusText}`
      };
    }

    const data = await resp.json() as any;

    if (data?.status !== 1 || !data?.details) {
      const msg = data?.message || "Not found";
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `Tracking not found: ${msg}`
      };
    }

    const detailsValues = Object.values(data.details);
    if (detailsValues.length === 0) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: "No shipment details returned"
      };
    }

    const detail: any = detailsValues[0];
    const rawHistory = Array.isArray(detail?.tracking_history) ? detail.tracking_history : [];
    const status = rawHistory.length > 0 ? (rawHistory[0].status || "Unknown") : "Unknown";

    const consignee = detail?.consignee || {};
    const location = consignee.destination || "N/A";

    const history: HistoryItem[] = [];
    for (const h of rawHistory) {
      history.push({
        timestamp: h.date_time || "",
        status: h.status || "",
        location: ""
      });
    }

    const delivered = status.toLowerCase().includes("delivered");

    return {
      status,
      location,
      timestamp: new Date().toISOString(),
      history,
      delivered
    };
  } catch (err: any) {
    return {
      status: "Error",
      location: "N/A",
      timestamp: new Date().toISOString(),
      history: [],
      delivered: false,
      error: `Tracking failed: ${err.message || String(err)}`
    };
  }
}
