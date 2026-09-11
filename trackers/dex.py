import json
from datetime import datetime
from .base import BaseTracker


class DEXTracker(BaseTracker):
    """Tracker for DEX (Daraz Express) parcels."""

    HISTORY_URL = "https://www.dex.com.pk/api/get_package_history"

    STATUS_MAP = {
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
        "domestic_handover_accepted": "Received by Delivery Service",

        "domestic_1st_attempt_failed": "Delivery Attempt Failed",
    }

    def track(self, tracking_number):
        """Track a DEX parcel using their API."""
        try:
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://www.dex.com.pk',
                'Referer': f'https://www.dex.com.pk/tracking?references={tracking_number}',
            }

            # Get package history directly using trackingNumber
            hist_resp = self.session.post(
                self.HISTORY_URL,
                json={"trackingNumber": tracking_number},
                headers=headers,
                timeout=30
            )
            hist_resp.raise_for_status()
            hist_data = hist_resp.json()

            if not hist_data.get('success'):
                return {"error": f"Tracking failed: {tracking_number}"}

            data = hist_data.get('data')
            if not data:
                # Parcel registered but not yet scanned
                return {
                    'status': 'Pending - Awaiting First Scan',
                    'location': 'N/A',
                    'timestamp': datetime.now().isoformat(),
                    'history': [],
                    'delivered': False
                }

            raw_status = data.get('status', 'unknown')

            # Build history from timeline
            history = []
            location = "N/A"
            timeline = data.get('timeline', [])

            for entry in timeline:
                ts = entry.get('processTime', 0)
                if ts:
                    dt = datetime.fromtimestamp(ts / 1000)
                    ts_str = dt.strftime('%Y-%m-%d %H:%M')
                else:
                    ts_str = ''

                status_code = entry.get('status', '')
                status_text = self.STATUS_MAP.get(status_code, status_code)

                history.append({
                    'timestamp': ts_str,
                    'status': status_text,
                    'location': entry.get('location', '')
                })

            if history:
                location = history[0].get('location', 'N/A')

            status = self.STATUS_MAP.get(raw_status, raw_status)
            delivered = 'delivered' in raw_status.lower()

            return {
                'status': status,
                'location': location,
                'timestamp': datetime.now().isoformat(),
                'history': history,
                'delivered': delivered
            }

        except Exception as e:
            return {"error": f"Tracking failed: {str(e)}"}
