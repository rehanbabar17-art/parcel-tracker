from datetime import datetime
from .base import BaseTracker


class TraxTracker(BaseTracker):
    """Tracker for Trax courier parcels."""

    API_URL = "https://sonic.pk/api/shipment/track/consignee/public"

    def track(self, tracking_number):
        """Track a Trax parcel using their public API."""
        try:
            resp = self.session.get(
                self.API_URL,
                params={'tracking_number': tracking_number},
                timeout=30
            )
            resp.raise_for_status()
            data = resp.json()

            if data.get('status') != 1 or not data.get('details'):
                msg = data.get('message', 'Not found')
                return {"error": f"Tracking not found: {msg}"}

            # Get the first (and only) shipment detail
            detail = next(iter(data['details'].values()))

            # Current status from first history entry
            history = detail.get('tracking_history', [])
            status = history[0]['status'] if history else 'Unknown'

            # Location
            consignee = detail.get('consignee', {})
            location = consignee.get('destination', 'N/A')

            # Build history list
            history_list = []
            for h in history:
                history_list.append({
                    'timestamp': h.get('date_time', ''),
                    'status': h.get('status', ''),
                    'location': ''
                })

            delivered = 'delivered' in status.lower()

            return {
                'status': status,
                'location': location,
                'timestamp': datetime.now().isoformat(),
                'history': history_list,
                'delivered': delivered
            }

        except Exception as e:
            return {"error": f"Tracking failed: {str(e)}"}
