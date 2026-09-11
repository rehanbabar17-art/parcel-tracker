from datetime import datetime
from bs4 import BeautifulSoup
from .base import BaseTracker


class LeopardsTracker(BaseTracker):
    """Tracker for Leopards Courier parcels."""

    # Primary URL (pk subdomain) - works with new API
    PRIMARY_URL = "https://pk.leopardscourier.com"
    # Fallback URL (old domain)
    FALLBACK_URL = "https://www.leopardscourier.com"

    def _get_tracking_page(self, base_url):
        """Get the tracking page and extract CSRF token."""
        url = f"{base_url}/tracking"
        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Extract CSRF token from script
        token = None
        for script in soup.find_all('script'):
            text = script.string or ''
            if '_token' in text and 'trackShipment' in text:
                idx = text.find('_token:')
                if idx >= 0:
                    snippet = text[idx:idx+100]
                    if "'" in snippet:
                        token = snippet.split("'")[1]
                        break

        return token

    def _track_with_url(self, base_url, tracking_number):
        """Track using a specific base URL."""
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': f'{base_url}/tracking',
        }

        # Step 1: Get CSRF token
        token = self._get_tracking_page(base_url)
        if not token:
            return {"error": "Could not extract CSRF token"}

        # Step 2: Call tracking API (stores result in session)
        api_url = f"{base_url}/shipment_tracking-new"
        resp = self.session.get(api_url, params={
            'cn_number': tracking_number,
            '_token': token
        }, headers=headers, timeout=30)
        resp.raise_for_status()

        result = resp.json()
        if not result.get('success'):
            return {"error": "Tracking API returned failure"}

        # Step 3: Follow to view page
        view_url = f"{base_url}/shipment_tracking_view"
        resp = self.session.get(view_url, params={
            'cn_number': tracking_number
        }, headers=headers, timeout=30)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Extract tracking details
        status = "Unknown"
        location = "N/A"
        history = []
        delivered = False

        # Find the tracking card
        card = soup.find(class_=lambda x: x and 'card' in str(x))
        if card:
            text = card.get_text(separator='|', strip=True)

            # Extract key fields
            fields = {}
            parts = text.split('|')
            for i, part in enumerate(parts):
                part = part.strip()
                if part.endswith(':') and i + 1 < len(parts):
                    key = part.rstrip(':').strip()
                    value = parts[i + 1].strip()
                    fields[key] = value

            # Map fields
            status = fields.get('Current Status/Reason', 'N/A')
            if status == 'N/A':
                status = 'Pending - Awaiting Scan'

            origin = fields.get('Origin', '')
            destination = fields.get('Destination', '')
            if origin and destination:
                location = f"{origin} -> {destination}"

            # Check if delivered
            delivered = 'delivered' in status.lower()

            # Build history from step indicators
            steps = ['Shipment picked', 'Dispatched', 'Arrived', 'Out for Delivery', 'Pending', 'Unknown Status']
            for i, step in enumerate(steps, 1):
                history.append({
                    'step': i,
                    'status': step,
                    'completed': i <= 2  # First two steps typically done when booked
                })

        return {
            'status': status,
            'location': location,
            'timestamp': datetime.now().isoformat(),
            'history': history,
            'delivered': delivered
        }

    def track(self, tracking_number):
        """Track a Leopards parcel, trying primary URL first then fallback."""
        # Try primary URL first
        try:
            result = self._track_with_url(self.PRIMARY_URL, tracking_number)
            if 'error' not in result:
                return result
        except Exception as e:
            pass

        # Try fallback URL
        try:
            result = self._track_with_url(self.FALLBACK_URL, tracking_number)
            if 'error' not in result:
                return result
        except Exception as e:
            return {"error": f"Tracking failed on both URLs: {e}"}

        return {"error": "Tracking failed: No working URL found"}
