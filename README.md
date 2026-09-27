# Parcel Tracker with Private MEGA Storage

A Node.js parcel tracker that treats MEGA as the source of truth for private parcel configuration (`config.json`) and tracking state (`state.json`). GitHub Actions runs the hourly job, but parcel identifiers and state are restored from MEGA at runtime and are never intended to be committed to this public repository.

## Data flow

```text
MEGA: github-data/parcel-tracker/
├── config.json  # parcel names, couriers, tracking IDs, ntfy settings
└── state.json   # last status, location, event history
       │
       ▼
GitHub Actions runner (ephemeral workspace)
  download → validate → track → update state → upload → delete local files
```

The scheduled job fails closed if it cannot authenticate, find a valid `config.json`, or parse the data. A missing `state.json` is initialized to `{}`. Upload only runs after the download step succeeds, and a failed upload makes the Actions run fail rather than reporting a false success. Sync messages do not print parcel identifiers, names, locations, notification topics, or file contents.

## Setup

1. In the repository, open **Settings → Secrets and variables → Actions** and create:
   - `MEGA_EMAIL`: the email address for the MEGA account.
   - `MEGA_PASSWORD`: the MEGA account password.
2. Run **Actions → Initialize Missing MEGA Files → Run workflow** if the `github-data/parcel-tracker/` folder or its initial files do not exist. This operation creates a placeholder config and empty state **only when the corresponding file is absent**; it preserves existing files.
3. In MEGA, privately edit `github-data/parcel-tracker/config.json` to add the real parcel entries and notification settings. Do not put tracking IDs in workflow-dispatch inputs, commits, issues, or public comments. `config.example.json` contains placeholders only.
4. Run **Actions → Verify MEGA Storage → Run workflow**. It validates both JSON files and reports only aggregate counts and sizes.
5. Run **Actions → Track Parcels → Run workflow**, or leave the hourly schedule enabled. A manually started run suppresses ntfy notifications; scheduled and repository-dispatch runs retain normal notification behavior. The workflow downloads the MEGA data, tracks the configured parcels, uploads updated configuration/state to MEGA, and removes the local files from its ephemeral runner.

Example `config.json` shape (use real values only in the private MEGA copy):

```json
{
  "trackers": [
    {
      "name": "Example Parcel",
      "courier": "tcs",
      "tracking_number": "YOUR_TRACKING_NUMBER"
    }
  ],
  "ntfy": {
    "server": "https://ntfy.sh",
    "topic": "YOUR_NTFY_TOPIC",
    "priority": "default",
    "tags": ["package", "delivery"]
  }
}
```

Supported courier names: `tcs`, `leopards`, `postex`, `daraz`, `dex`, and `trax`.

### Legacy config migration

For a one-time migration only, the tracking workflow can bootstrap a missing MEGA `config.json` from the encrypted `TRACKER_CONFIG` Actions secret, if that secret exists and contains valid JSON. MEGA always takes precedence when its file exists. After a successful run, verify the MEGA files and remove the obsolete `TRACKER_CONFIG` secret in repository settings; the ongoing tracker needs only `MEGA_EMAIL` and `MEGA_PASSWORD`.

## Local checks and dashboard safety

- `npm ci` installs the locked dependencies.
- `npm run lint` type-checks the project.
- `npm run build` builds the browser UI.
- `npm run dev` starts the dashboard on `127.0.0.1` by default. Its API returns tracking data and does not provide user authentication; do **not** expose it through a public interface or reverse proxy without adding authentication and access controls.

## Public-repository safeguards

- `config.json`, `state.json`, `.env` files, and temporary copies are ignored by Git. Keep real values out of all tracked files.
- The tracking workflow has no parcel-name, courier, or tracking-number inputs, avoiding private data in public workflow-run metadata.
- Actions logging is intentionally minimized/redacted. Do not add debug output that prints downloaded files, API responses containing parcel details, notification topics, or tracking identifiers.
- `MEGA_EMAIL` and `MEGA_PASSWORD` are required encrypted Actions secrets; never put their values in workflow YAML.
- The repository currently contains no committed `config.json` or `state.json`. Do not assume the dashboard is protected if you deploy it; it is local-only by default and currently has no login system.
