#!/usr/bin/env python3
"""
Trigger the GitHub Actions 'Track Parcels' workflow via repository_dispatch.
Used by third-party cron services (cron-job.org, etc.) to bypass GitHub's
unreliable built-in `schedule` trigger.

NOTE: The GitHub token is read from the GITHUB_TOKEN environment variable
(NEVER hardcode it). Create a Personal Access Token (fine-grained or classic)
with 'Actions' write permission and set it in the cron service.
"""

import os
import sys
import requests

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
if not GITHUB_TOKEN:
    print("ERROR: GITHUB_TOKEN environment variable is not set.")
    sys.exit(1)

OWNER = "rehanbabar17-art"
REPO = "parcel-tracker"
EVENT_TYPE = "hourly-track"

url = f"https://api.github.com/repos/{OWNER}/{REPO}/dispatches"
headers = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

resp = requests.post(url, json={"event_type": EVENT_TYPE}, headers=headers, timeout=30)

if resp.status_code == 204:
    print(f"Workflow triggered successfully for {OWNER}/{REPO} (event: {EVENT_TYPE})")
else:
    print(f"Failed: HTTP {resp.status_code}")
    print(resp.text)
    sys.exit(1)
