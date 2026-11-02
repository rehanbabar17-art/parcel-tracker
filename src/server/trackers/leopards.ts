import type { TrackingResult, HistoryItem } from './types.ts';

export async function trackLeopards(trackingNumber: string): Promise<TrackingResult> {
  const baseUrls = [
    "https://pk.leopardscourier.com",
    "https://www.leopardscourier.com"
  ];

  for (const baseUrl of baseUrls) {
    try {
      const result = await trackWithUrl(baseUrl, trackingNumber);
      if (!result.error && result.status !== "Unknown") {
        return result;
      }
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
    error: `Tracking failed: Could not retrieve info for ${trackingNumber}`
  };
}

async function trackWithUrl(baseUrl: string, trackingNumber: string): Promise<TrackingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const cookieMap = new Map<string, string>();
  const updateCookies = (resp: Response) => {
    const rawCookies = typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')!] : []);
    for (const c of rawCookies) {
      const [kv] = c.split(';');
      if (!kv) continue;
      const eqIdx = kv.indexOf('=');
      if (eqIdx > 0) {
        const k = kv.slice(0, eqIdx).trim();
        const v = kv.slice(eqIdx + 1).trim();
        cookieMap.set(k, v);
      }
    }
  };
  const getCookieHeader = () =>
    Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  try {
    // Step 1: get tracking page, session cookies, and CSRF token
    const pageResp = await fetch(`${baseUrl}/tracking`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: controller.signal
    });
    updateCookies(pageResp);
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

    // Step 2: call tracking API with session cookies so shipment data is stored in session
    const apiResp = await fetch(
      `${baseUrl}/shipment_tracking-new?cn_number=${encodeURIComponent(trackingNumber)}&_token=${encodeURIComponent(token)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${baseUrl}/tracking`,
          "Cookie": getCookieHeader()
        },
        signal: controller.signal
      }
    );
    updateCookies(apiResp);
    const apiData = await apiResp.json() as any;

    if (!apiData?.success) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: "Tracking API returned failure"
      };
    }

    // Step 3: View page with session cookies
    const viewResp = await fetch(`${baseUrl}/shipment_tracking_view?cn_number=${encodeURIComponent(trackingNumber)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${baseUrl}/tracking`,
        "Cookie": getCookieHeader()
      },
      signal: controller.signal
    });
    const viewHtml = await viewResp.text();

    let status = "Unknown";
    let location = "N/A";

    // Parse active step in progress bar if present
    const activeStepMatch = viewHtml.match(/<div\s+class=["'][^"']*step-active[^"']*["'][^>]*>[\s\S]*?<\/span>\s*<\/span>\s*([^<]+?)\s*<\/div>/i);
    if (activeStepMatch && activeStepMatch[1]) {
      status = activeStepMatch[1].replace(/\s+/g, " ").trim();
    }

    // Parse checkpoint tracking items
    const history: HistoryItem[] = [];
    const itemRegex = /<div\s+class=["']tracking-item["'][^>]*>[\s\S]*?<div\s+class=["']tracking-date["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<div\s+class=["']tracking-content["'][^>]*>([\s\S]*?)<\/div>/gi;
    let itemMatch: RegExpExecArray | null;
    let stepIdx = 1;
    while ((itemMatch = itemRegex.exec(viewHtml)) !== null) {
      const rawDate = itemMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const rawContent = itemMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (rawContent) {
        history.push({
          step: stepIdx++,
          status: rawContent,
          timestamp: rawDate
        });
      }
    }

    if ((status === "Unknown" || !status) && history.length > 0) {
      status = history[0].status.toLowerCase().includes("delivered") ? "Delivered" : history[0].status;
    }

    const cleanText = viewHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    if (status === "Unknown") {
      const statusMatch = cleanText.match(/Current Status(?:\/Reason)?\s*:\s*([^:]+?)(?:Origin|Destination|Consignee|$)/i);
      if (statusMatch && statusMatch[1]) {
        status = statusMatch[1].trim();
      }
    }

    const originMatch = cleanText.match(/Origin\s*:\s*([A-Za-z0-9\s-]+?)\s+Destination\s*:\s*([A-Za-z0-9\s-]+?)\s+(?:Shipper|Consignee|Reference)/i);
    if (originMatch && originMatch[1] && originMatch[2]) {
      location = `${originMatch[1].trim()} -> ${originMatch[2].trim()}`;
    }

    const delivered =
      status.toLowerCase().includes("delivered") ||
      (history.length > 0 && history[0].status.toLowerCase().includes("delivered"));

    if (delivered && status === "Unknown") {
      status = "Delivered";
    }

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
