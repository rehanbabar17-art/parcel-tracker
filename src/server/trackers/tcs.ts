import type { TrackingResult, HistoryItem } from './types.ts';

export async function trackTCS(trackingNumber: string): Promise<TrackingResult> {
  const url = "https://www.tcsexpress.com/apibridge";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const headersDict: Record<string, string> = {};
    for (let i = 0; i < trackingNumber.length; i++) {
      headersDict[String(i)] = trackingNumber[i];
    }

    const payload = {
      body: {
        url: "trackapinew",
        type: "GET",
        headers: headersDict,
        payload: {},
        param: `consignee=${trackingNumber}`
      }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Origin": "https://www.tcsexpress.com",
        "Referer": `https://www.tcsexpress.com/track/${encodeURIComponent(trackingNumber)}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(payload),
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

    if (!data?.isSuccess) {
      const msg = data?.responseData || "Unknown error";
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `API error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`
      };
    }

    const responseData = data.responseData || {};
    if (typeof responseData === "string") {
      if (responseData.includes("No Data Found") || responseData.includes("Invalid")) {
        return {
          status: "Error",
          location: "N/A",
          timestamp: new Date().toISOString(),
          history: [],
          delivered: false,
          error: `No data or invalid tracking: ${trackingNumber}`
        };
      }
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `API error: ${responseData}`
      };
    }

    const shipmentInfoRaw = responseData.shipmentinfo;
    const shipmentInfo = Array.isArray(shipmentInfoRaw) ? shipmentInfoRaw[0] : (shipmentInfoRaw || {});
    const deliveryInfoRaw = responseData.deliveryinfo;
    const deliveryInfo = Array.isArray(deliveryInfoRaw) ? deliveryInfoRaw[0] : (deliveryInfoRaw || {});
    const checkpoints = Array.isArray(responseData.checkpoints) ? responseData.checkpoints : [];

    let status = deliveryInfo.currentStatus || shipmentInfo.status || "";
    if (!status || status === "Unknown") {
      if (checkpoints.length > 0 && checkpoints[0].status) {
        status = checkpoints[0].status;
      } else {
        const rawSummary = responseData.shipmentsummary || "Unknown";
        if (rawSummary.includes("No Data Found") || rawSummary.includes("Invalid")) {
          status = "Awaiting First Scan (No Data Found yet)";
        } else {
          status = rawSummary;
        }
      }
    } else if (status.includes("No Data Found") || status.includes("Invalid")) {
      status = "Awaiting First Scan (No Data Found yet)";
    }

    let location = deliveryInfo.currentLocation || shipmentInfo.destination || "";
    const history: HistoryItem[] = [];
    for (const cp of checkpoints) {
      history.push({
        timestamp: cp.datetime || cp.statusDate || "",
        status: cp.status || "",
        location: cp.recievedby || ""
      });
    }

    if (!location || location === "N/A") {
      for (const cp of checkpoints) {
        if (cp.recievedby) {
          location = cp.recievedby;
          break;
        }
      }
    }
    if (!location) location = "N/A";

    const statusLower = String(status).toLowerCase();
    const delivered = statusLower.includes("delivered") || statusLower.includes("received");

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
