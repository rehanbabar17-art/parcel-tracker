import os
import json
import warnings
from datetime import datetime
from abc import ABC, abstractmethod

warnings.filterwarnings('ignore')


class BaseTracker(ABC):
    """Base class for all courier trackers."""

    def __init__(self):
        import requests
        self.session = requests.Session()
        self.session.verify = False
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/html, */*',
            'Accept-Language': 'en-US,en;q=0.9',
        })

    @abstractmethod
    def track(self, tracking_number):
        """
        Track a parcel by tracking number.
        Returns dict with:
            - status: Current status string
            - location: Current location
            - timestamp: Last update time
            - history: List of status updates
            - delivered: Boolean
        """
        pass

    def format_update(self, name, tracking_number, result):
        """Format tracking result into a readable message."""
        if 'error' in result:
            return f"[ERROR] {name} ({tracking_number})\nError: {result['error']}"

        status = result.get('status', 'Unknown')
        location = result.get('location', 'N/A')
        delivered = result.get('delivered', False)

        icon = "[DELIVERED]" if delivered else "[PARCEL]"

        message = f"{icon} {name}\n"
        message += f"Tracking: {tracking_number}\n"
        message += f"Status: {status}\n"
        message += f"Location: {location}\n"
        message += f"Updated: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"

        if result.get('history'):
            message += "\nHistory:\n"
            for entry in result['history'][:5]:
                message += f"  - {entry.get('timestamp', '')}: {entry.get('status', '')}\n"

        return message
