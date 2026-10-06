import type { TrackingResult, HistoryItem } from './types.ts';

export async function trackLeopards(trackingNumber: string): Promise<TrackingResult> {
  const primaryResult = await trackWithLcsTracking(trackingNumber);
  if (!primaryResult.error) {
    return primaryResult;
  }

  const baseUrls = [
    "https://pk.leopardscourier.com",
    "https://www.leopardscourier.com"
  ];
  let lastError = primaryResult.error;

  for (const baseUrl of baseUrls) {
    try {
      const result = await trackWithUrl(baseUrl, trackingNumber);
      if (!result.error) {
        return result;
      }
      lastError = result.error;
    } catch {
      // try next base url
    }
  }

  return {
    status: "Error",
    location: "N/A",
    timestamp: new Date().toISOString(),
    history: [],
    delivered: false,
    error: lastError || `Tracking failed: Could not retrieve info for ${trackingNumber}`
  };
}

async function trackWithLcsTracking(trackingNumber: string): Promise<TrackingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`https://www.lcstracking.pk/api/track/?cn=${encodeURIComponent(trackingNumber)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.lcstracking.pk/"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LCSTracking returned HTTP ${response.status}`);
    }

    const data = await response.json() as {
      found?: boolean;
      status?: string;
      origin?: string;
      destination?: string;
      timeline?: Array<{ date?: string; status?: string }>;
    };

    if (!data.found || !data.status?.trim()) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: "LCSTracking.pk did not return a shipment status."
      };
    }

    const history: HistoryItem[] = (Array.isArray(data.timeline) ? data.timeline : [])
      .filter(event => Boolean(event.status?.trim()))
      .map((event, index) => ({
        step: index + 1,
        status: event.status!.trim(),
        timestamp: event.date?.trim() || ""
      }));

    const statusLocation = data.status.match(/\b(?:to|at|in)\s+(.+)$/i)?.[1]?.trim();
    const location = [data.origin, data.destination].some(value => value && value !== "N/A")
      ? [data.origin, data.destination].filter(value => value && value !== "N/A").join(" -> ")
      : statusLocation || "N/A";

    return {
      status: data.status.trim(),
      location,
      timestamp: new Date().toISOString(),
      history,
      delivered: data.status.toLowerCase().includes("delivered")
    };
  } catch {
    return {
      status: "Error",
      location: "N/A",
      timestamp: new Date().toISOString(),
      history: [],
      delivered: false,
      error: "Could not retrieve status from LCSTracking.pk."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function trackWithUrl(baseUrl: string, trackingNumber: string): Promise<TrackingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    // Step 1: get tracking page and extract CSRF token
    const pageResp = await fetch(`${baseUrl}/tracking`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: controller.signal
    });
    const html = await pageResp.text();

    let token = "";
    const tokenMatch = html.match(/_token:\s*['"]([^'"]+)['"]/);
    if (tokenMatch) {
      token = tokenMatch[1];
    } else {
      const metaToken = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
      if (metaToken) {
        token = metaToken[1];
      }
    }

    if (!token) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: "Could not extract CSRF token"
      };
    }

    // Step 2: call tracking API
    const apiResp = await fetch(`${baseUrl}/shipment_tracking-new?cn_number=${encodeURIComponent(trackingNumber)}&_token=${encodeURIComponent(token)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${baseUrl}/tracking`
      },
      signal: controller.signal
    });
    const apiData = await apiResp.json() as any;

    // Step 3: Read the detail page even if the preliminary API flag is false;
    // the detail page may still contain a usable status or a specific not-found message.
    const viewResp = await fetch(`${baseUrl}/shipment_tracking_view?cn_number=${encodeURIComponent(trackingNumber)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${baseUrl}/tracking`
      },
      signal: controller.signal
    });
    const viewHtml = await viewResp.text();

    let status = "Unknown";
    let location = "N/A";

    const cleanText = viewHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    if (/appeared to be invalid\s*\/\s*record not found|record not found/i.test(cleanText)) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: "Leopards reports this consignment number is invalid or was not found."
      };
    }

    const statusMatch = cleanText.match(/Current Status(?:\/Reason)?\s*:\s*([^:]+?)(?:Origin|Destination|Consignee|$)/i);
    if (statusMatch && statusMatch[1]) {
      status = statusMatch[1].trim();
    }

    if (status === "Unknown") {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: apiData?.success
          ? "Could not read a shipment status from Leopards' tracking page."
          : "Leopards did not return a shipment status. Please verify the consignment number with the carrier."
      };
    }

    const originMatch = cleanText.match(/Origin\s*:\s*([^:]+?)(?:Destination|Status|$)/i);
    const destMatch = cleanText.match(/Destination\s*:\s*([^:]+?)(?:Consignee|Origin|$)/i);
    if (originMatch && destMatch) {
      location = `${originMatch[1].trim()} -> ${destMatch[1].trim()}`;
    }

    const delivered = status.toLowerCase().includes("delivered");

    const steps = ['Shipment picked', 'Dispatched', 'Arrived', 'Out for Delivery', 'Pending', 'Delivered'];
    const history: HistoryItem[] = steps.map((step, idx) => ({
      step: idx + 1,
      status: step,
      timestamp: "",
      completed: idx === 0 || (delivered && idx === steps.length - 1)
    }));

    return {
      status,
      location,
      timestamp: new Date().toISOString(),
      history,
      delivered
    };
  } finally {
    clearTimeout(timeout);
  }
}
