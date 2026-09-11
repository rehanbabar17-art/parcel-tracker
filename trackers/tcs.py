from datetime import datetime
from .base import BaseTracker


class TCSTracker(BaseTracker):
    """Tracker for TCS Express parcels."""

    API_URL = "https://www.tcsexpress.com/apibridge"

    def track(self, tracking_number):
        """Track a TCS parcel using their API."""
        try:
            headers = {
                'Content-Type': 'application/json; charset=UTF-8',
                'Origin': 'https://www.tcsexpress.com',
                'Referer': f'https://www.tcsexpress.com/track/{tracking_number}',
            }

            # TCS uses apibridge with specific format
            # Headers field encodes the tracking number as characters
            headers_dict = {}
            for i, char in enumerate(tracking_number):
                headers_dict[str(i)] = char

            payload = {
                "body": {
                    "url": "trackapinew",
                    "type": "GET",
                    "headers": headers_dict,
                    "payload": {},
                    "param": f"consignee={tracking_number}"
                }
            }

            resp = self.session.post(
                self.API_URL,
                json=payload,
                headers=headers,
                timeout=30
            )
            resp.raise_for_status()
            data = resp.json()

            if not data.get('isSuccess'):
                msg = data.get('responseData', 'Unknown error')
                return {"error": f"API error: {msg}"}

            response_data = data.get('responseData', {})

            # Check for no data
            if isinstance(response_data, str):
                if 'No Data Found' in response_data or 'Invalid' in response_data:
                    return {"error": f"No data or invalid tracking: {tracking_number}"}
                return {"error": f"API error: {response_data}"}

            shipment_info_raw = response_data.get('shipmentinfo')
            shipment_info = shipment_info_raw[0] if isinstance(shipment_info_raw, list) and shipment_info_raw else shipment_info_raw or {}
            delivery_info_raw = response_data.get('deliveryinfo')
            delivery_info = delivery_info_raw[0] if isinstance(delivery_info_raw, list) and delivery_info_raw else delivery_info_raw or {}
            checkpoints = response_data.get('checkpoints') or []

            # Extract status
            status = delivery_info.get('currentStatus', '') or \
                     shipment_info.get('status', '') or \
                     response_data.get('shipmentsummary', 'Unknown')

            if not status or status == 'Unknown':
                # Try to get status from checkpoints
                if checkpoints:
                    status = checkpoints[0].get('status', 'Unknown')

            # Extract location
            location = delivery_info.get('currentLocation', '') or \
                       shipment_info.get('destination', 'N/A')

            # Parse history from checkpoints
            history = []
            for cp in checkpoints:
                history.append({
                    'timestamp': cp.get('datetime', cp.get('statusDate', '')),
                    'status': cp.get('status', ''),
                    'location': cp.get('location', '')
                })

            delivered = 'delivered' in str(status).lower() or 'received' in str(status).lower()

            return {
                'status': status,
                'location': location,
                'timestamp': datetime.now().isoformat(),
                'history': history,
                'delivered': delivered
            }

        except Exception as e:
            return {"error": f"Tracking failed: {str(e)}"}
