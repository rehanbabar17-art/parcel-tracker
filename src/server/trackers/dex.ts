import { TrackingResult, HistoryItem } from './types.js';

const STATUS_MAP: Record<string, string> = {
  "package_created": "Package Created",
  "domestic_pickup/sign_in_failure": "Order Not Received",
  "driver_assigned": "Driver Assigned",
  "need_review": "Allocating New Driver",
  "package_ready_to_be_shipped": "Ready for Pick-up",
  "requesting_driver": "Allocating Driver",
  "domestic_handover_accepted": "Received by Delivery Service",
  "domestic_ib_failure_in_sort_center": "Order Collected",
  "domestic_sc_sign_in_success": "Dropped Off at Station",
  "domestic_pickup/sign_in_success": "Order Collected",
  "domestic_ib_success_in_sort_center": "Arrived at Logistics Hub",
  "domestic_ob_success_in_sort_center": "Departing from Logistics Hub",
  "domestic_package_stationed_in": "Arrived at Logistics Hub",
  "domestic_package_stationed_out": "Departing from Logistics Hub",
  "domestic_about_to_deliver": "About to Deliver",
  "domestic_about_to_pickup": "About to Pickup",
  "domestic_out_for_delivery": "Out for Delivery",
  "domestic_handover_to_cp": "Out for Delivery",
  "domestic_last_mile_customer_station_inbound": "At Collection Point",
  "domestic_delivered": "Delivered",
  "domestic_back_to_shipper": "Delivery Failed",
  "domestic_pkg_outbound_attendance": "Outbound Attendance",
  "domestic_last_mile_customer_station_outbound_success": "Delivered",
  "domestic_delivery_failed": "Delivery Failed",
  "domestic_reattempts_failed": "Delivery Attempt Failed",
  "domestic_package_return_attempt_failed": "Return Attempt Failed",
  "domestic_last_mile_customer_station_failed_pickup": "Pickup Failed",
  "domestic_warehouse_returned": "Returned to Warehouse",
  "domestic_return_with_last_mile_3pl": "At Logistic Facility",
  "domestic_return_at_transit_hub": "At Logistic Facility",
  "domestic_1st_attempt_failed": "Delivery Attempt Failed",
};

export async function trackDEX(trackingNumber: string): Promise<TrackingResult> {
  const url = "https://www.dex.com.pk/api/get_package_history";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.dex.com.pk",
        "Referer": `https://www.dex.com.pk/tracking?references=${encodeURIComponent(trackingNumber)}`,
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

    const histData = await resp.json() as any;

    if (!histData?.success) {
      return {
        status: "Error",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false,
        error: `Tracking failed: ${trackingNumber}`
      };
    }

    const data = histData.data;
    if (!data) {
      return {
        status: "Pending - Awaiting First Scan",
        location: "N/A",
        timestamp: new Date().toISOString(),
        history: [],
        delivered: false
      };
    }

    const rawStatus = data.status || "unknown";
    const history: HistoryItem[] = [];
    let location = "N/A";
    const timeline = data.timeline || [];

    for (const entry of timeline) {
      const ts = entry.processTime;
      let tsStr = "";
      if (ts) {
        const dt = new Date(ts);
        tsStr = dt.toISOString().replace("T", " ").substring(0, 16);
      }
      const statusCode = entry.status || "";
      const statusText = STATUS_MAP[statusCode] || statusCode;

      history.push({
        timestamp: tsStr,
        status: statusText,
        location: entry.location || ""
      });
    }

    if (history.length > 0 && history[0].location) {
      location = history[0].location;
    }

    const status = STATUS_MAP[rawStatus] || rawStatus;
    const delivered = rawStatus.toLowerCase().includes("delivered");

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
