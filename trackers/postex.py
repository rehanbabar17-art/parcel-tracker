from datetime import datetime
from .base import BaseTracker


class PostExTracker(BaseTracker):
    """Tracker for PostEx parcels."""

    API_URL = "https://postex.pk/api/tracking-order"

    def track(self, tracking_number):
        """Track a PostEx parcel using their API."""
        try:
            headers = {
                'Content-Type': 'application/json',
                'Origin': 'https://postex.pk',
                'Referer': f'https://postex.pk/tracking?cn={tracking_number}',
            }

            # PostEx uses trackingNumber as key
            payload = {"trackingNumber": tracking_number}

            resp = self.session.post(
                self.API_URL,
                json=payload,
                headers=headers,
                timeout=30
            )
            resp.raise_for_status()
            data = resp.json()

            if data.get('statusCode') != '200':
                msg = data.get('statusMessage', 'Unknown error')
                return {"error": f"API error: {msg}"}

            dist = data.get('dist', {})

            if not dist:
                return {"error": f"Package not found: {tracking_number}"}

            customer = dist.get('customerName', '')
            status_history = dist.get('transactionStatusHistory', [])

            status = "Unknown"
            location = "N/A"
            history = []

            for entry in status_history:
                status_msg = entry.get('transactionStatusMessage', '')
                modified = entry.get('modifiedDatetime', '')

                history.append({
                    'timestamp': modified,
                    'status': status_msg,
                    'location': ''
                })

            if history:
                status = history[0]['status']

            delivered = 'delivered' in status.lower() or 'received' in status.lower()

            result = {
                'status': status,
                'location': location,
                'timestamp': datetime.now().isoformat(),
                'history': history,
                'delivered': delivered
            }

            if customer:
                result['customer'] = customer

            return result

        except Exception as e:
            return {"error": f"Tracking failed: {str(e)}"}
