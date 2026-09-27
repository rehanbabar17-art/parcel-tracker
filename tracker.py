#!/usr/bin/env python3
"""
Parcel Tracker - Automated tracking with ntfy notifications.
Only sends notifications when parcel status actually changes.
Each notification includes the latest status of ALL tracked parcels.
Delivered parcels are removed after 48 hours but shown in notifications until then.
"""

import json
import os
import sys
import requests
from datetime import datetime, timedelta
from trackers import get_tracker


def load_config():
    # In CI, config comes from the TRACKER_CONFIG env var (GitHub Actions secret).
    env_config = os.environ.get('TRACKER_CONFIG')
    if env_config:
        return json.loads(env_config)

    # Local fallback: config.json (ignored by git) or config.example.json
    base = os.path.dirname(__file__)
    for name in ('config.json', 'config.example.json'):
        config_path = os.path.join(base, name)
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                return json.load(f)

    raise RuntimeError(
        "No configuration found. Set TRACKER_CONFIG env var or create config.json."
    )


def load_state():
    state_path = os.path.join(os.path.dirname(__file__), 'state.json')
    if os.path.exists(state_path):
        with open(state_path, 'r') as f:
            return json.load(f)
    return {}


def save_state(state):
    state_path = os.path.join(os.path.dirname(__file__), 'state.json')
    with open(state_path, 'w') as f:
        json.dump(state, f, indent=2)


def send_ntfy(config, title, message, priority=None, tags=None):
    # TRACKER_SILENT=1 skips actually sending (used to seed CI cache on first run).
    if os.environ.get('TRACKER_SILENT') == '1':
        print(f"  -> [SILENT] Would send notification: {title}")
        return

    server = config['ntfy']['server']
    topic = config['ntfy']['topic']
    priority = priority or config['ntfy'].get('priority', 'default')
    tags = tags or config['ntfy'].get('tags', ['package'])

    url = f"{server}/{topic}"
    headers = {
        'Title': title,
        'Priority': priority,
        'Tags': ','.join(tags)
    }

    response = requests.post(
        url,
        data=message.encode('utf-8'),
        headers=headers,
        timeout=30
    )
    response.raise_for_status()
    print(f"  -> Notification sent: {title}")


def build_summary(config, state):
    """Build a summary line for every tracked parcel (including delivered ones)."""
    lines = []
    for parcel in config['trackers']:
        name = parcel['name']
        courier = parcel['courier']
        tracking_number = parcel['tracking_number']
        if tracking_number.startswith('YOUR_'):
            continue

        parcel_key = f"{courier}:{tracking_number}"
        entry = state.get(parcel_key, {})
        if entry.get('removed'):
            continue
        status = entry.get('status', 'Unknown')
        location = entry.get('location', '')
        loc = f" @ {location}" if location and location != 'N/A' else ''
        
        # Mark delivered parcels
        delivered_at = entry.get('delivered_at')
        if delivered_at and 'delivered' in status.lower():
            lines.append(f"  • {name}: {status}{loc} [Delivered]")
        else:
            lines.append(f"  • {name}: {status}{loc}")

    return "\n".join(lines)


def remove_delivered_parcels(config, state):
    """Remove parcels delivered more than 48 hours ago."""
    parcels_to_remove = []
    now = datetime.now()

    for parcel in config['trackers']:
        name = parcel['name']
        courier = parcel['courier']
        tracking_number = parcel['tracking_number']

        parcel_key = f"{courier}:{tracking_number}"
        entry = state.get(parcel_key, {})

        if entry.get('delivered_at'):
            delivered_time = datetime.fromisoformat(entry['delivered_at'])
            hours_since_delivery = (now - delivered_time).total_seconds() / 3600

            if hours_since_delivery >= 48:
                print(f"  [REMOVING] {name} - delivered {hours_since_delivery:.1f} hours ago")
                parcels_to_remove.append(parcel)
            else:
                remaining = 48 - hours_since_delivery
                print(f"  [DELIVERED] {name} - {remaining:.1f} hours until removal")

    # Mark expired parcels as removed in state (config is read-only in CI,
    # so we tombstone in state to avoid re-tracking/re-notifying them).
    if parcels_to_remove:
        for parcel in parcels_to_remove:
            parcel_key = f"{parcel['courier']}:{parcel['tracking_number']}"
            state[parcel_key] = {
                'status': state.get(parcel_key, {}).get('status', 'Delivered'),
                'last_checked': datetime.now().isoformat(),
                'removed': True,
                'delivered_at': state.get(parcel_key, {}).get('delivered_at')
            }
            print(f"  [REMOVED] Marked {parcel['name']} as removed")

    return len(parcels_to_remove)


def track_all():
    config = load_config()
    state = load_state()
    changes = []
    errors = []

    print(f"=== Parcel Tracker - {datetime.now().strftime('%Y-%m-%d %H:%M')} ===\n")

    # Check for and remove delivered parcels older than 48 hours
    print("[CHECKING] Looking for delivered parcels to remove...")
    removed = remove_delivered_parcels(config, state)
    if removed:
        print(f"  [CLEANUP] Removed {removed} delivered parcel(s)\n")

    for parcel in config['trackers']:
        name = parcel['name']
        courier = parcel['courier']
        tracking_number = parcel['tracking_number']

        if tracking_number.startswith('YOUR_'):
            continue

        parcel_key = f"{courier}:{tracking_number}"
        if state.get(parcel_key, {}).get('removed'):
            print(f"[SKIPPED] {name} - already removed (delivered >48h ago)")
            continue

        print(f"[TRACKING] {name} ({courier}: {tracking_number})")

        try:
            tracker = get_tracker(courier)
            result = tracker.track(tracking_number)

            previous_status = state.get(parcel_key, {}).get('status', '')
            current_status = result.get('status', '')
            is_delivered = result.get('delivered', False)

            if 'error' in result:
                print(f"  [ERROR] {result['error']}")
                if previous_status != f"ERROR:{result['error']}":
                    errors.append({
                        'name': name,
                        'tracking_number': tracking_number,
                        'error': result['error']
                    })
                    state[parcel_key] = {
                        'status': f"ERROR:{result['error']}",
                        'last_checked': datetime.now().isoformat()
                    }
                else:
                    print(f"  [KNOWN ERROR - no notification]")
            elif current_status != previous_status:
                if previous_status == '':
                    print(f"  [FIRST SEEN] {current_status}")
                    changes.append({
                        'name': name,
                        'tracking_number': tracking_number,
                        'result': result,
                        'previous_status': 'New Parcel',
                        'courier': courier
                    })
                else:
                    print(f"  [STATUS CHANGED] {previous_status} -> {current_status}")
                    changes.append({
                        'name': name,
                        'tracking_number': tracking_number,
                        'result': result,
                        'previous_status': previous_status,
                        'courier': courier
                    })

                state[parcel_key] = {
                    'status': current_status,
                    'last_checked': datetime.now().isoformat(),
                    'location': result.get('location', 'N/A')
                }

                # Record delivery time if delivered
                if is_delivered and not state[parcel_key].get('delivered_at'):
                    state[parcel_key]['delivered_at'] = datetime.now().isoformat()
            else:
                print(f"  [NO CHANGE] {current_status}")

        except Exception as e:
            print(f"  [FAILED] {str(e)}")
            if previous_status != f"ERROR:{str(e)}":
                errors.append({
                    'name': name,
                    'tracking_number': tracking_number,
                    'error': str(e)
                })
                state[parcel_key] = {
                    'status': f"ERROR:{str(e)}",
                    'last_checked': datetime.now().isoformat()
                }

        print()

    save_state(state)

    # Build the full status summary from the updated state
    summary = build_summary(config, state)

    # Send notifications ONLY for actual status changes
    if changes:
        print(f"--- {len(changes)} status change(s) detected ---\n")
        for change in changes:
            result = change['result']
            status = result.get('status', 'Unknown')
            location = result.get('location', 'N/A')
            history = result.get('history', [])

            message = f"Tracking: {change['tracking_number']}\n"
            message += f"Status: {status}\n"
            if location and location != 'N/A':
                message += f"Location: {location}\n"
            if history:
                message += f"\nRecent:\n"
                for h in history[:2]:
                    message += f"  {h.get('timestamp', '')}: {h.get('status', '')}\n"

            message += f"\n--- All Parcels ---\n{summary}"

            # Set priority based on status
            priority = 'default'
            tags = ['package', 'delivery']
            status_lower = status.lower()

            if 'delivered' in status_lower:
                priority = 'high'
                tags.append('white_check_mark')
                title = f"DELIVERED: {change['name']}"
            elif 'out for delivery' in status_lower or 'about to deliver' in status_lower:
                priority = 'high'
                tags.append('truck')
                title = f"OUT FOR DELIVERY: {change['name']}"
            elif 'departing' in status_lower or 'dispatched' in status_lower:
                title = f"IN TRANSIT: {change['name']}"
            else:
                title = f"UPDATE: {change['name']}"

            send_ntfy(config, title, message, priority, tags)

    if errors:
        print(f"\n--- {len(errors)} error(s) ---")
        for err in errors:
            message = (
                f"Tracking: {err['tracking_number']}\n"
                f"Error: {err['error']}\n"
                f"\n--- All Parcels ---\n{summary}"
            )
            send_ntfy(
                config,
                title=f"TRACKING ERROR: {err['name']}",
                message=message,
                priority='high',
                tags=['warning', 'package']
            )

    if not changes and not errors:
        print("No updates to report")

    return changes


def main():
    try:
        changes = track_all()
    except Exception as e:
        print(f"Fatal error: {str(e)}")
        try:
            config = load_config()
            state = load_state()
            summary = build_summary(config, state)
            send_ntfy(
                config,
                title="PARCEL TRACKER ERROR",
                message=f"Fatal error: {str(e)}\n\n--- All Parcels ---\n{summary}",
                priority='urgent',
                tags=['warning']
            )
        except:
            pass
        sys.exit(1)


if __name__ == '__main__':
    main()
