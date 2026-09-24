import { TrackingResult, HistoryItem } from './types.js';

export async function trackPostEx(trackingNumber: string): Promise<TrackingResult> {
  const url = "https://postex.pk/api/tracking-order";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://postex.pk",
        "Referer": `https://postex.pk/tracking?cn=${encodeURIComponent(trackingNumber)}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ trackingNumber }),
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

    if (String(data?.statusCode) !== "200") {
      const msg = data?.statusMessage || "Unknown error";
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `API error: ${msg}`
      };
    }

    const dist = data.dist;
    if (!dist) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `Package not found: ${trackingNumber}`
      };
    }

    const customer = dist.customerName || "";
    const statusHistory = Array.isArray(dist.transactionStatusHistory) ? dist.transactionStatusHistory : [];

    let status = "Unknown";
    const location = "N/A";
    const history: HistoryItem[] = [];

    for (const entry of statusHistory) {
      const statusMsg = entry.transactionStatusMessage || "";
      const modified = entry.modifiedDatetime || "";
      history.push({
        timestamp: modified,
        status: statusMsg,
        location: ""
      });
    }

    if (history.length > 0) {
      status = history[0].status;
    }

    const statusLower = status.toLowerCase();
    const delivered = statusLower.includes("delivered") || statusLower.includes("received");

    return {
      status,
      location,
      timestamp: new Date().toISOString(),
      history,
      delivered,
      customer
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
