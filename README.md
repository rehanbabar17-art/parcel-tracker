# 📦 Parcel Tracker

Automated package tracking for Pakistani couriers with hourly status checks and
push notifications via [ntfy.sh](https://ntfy.sh).

Tracks **TCS, Leopards, PostEx, Daraz, DEX, and Trax** parcels. Whenever any
parcel changes status, a notification is pushed to your ntfy topic. Every
notification includes the current status of **all** tracked parcels, so a single
alert gives you the full picture.

The repo ships with two ways to use it:

- **A headless CLI runner** driven by GitHub Actions (the main, "set and forget" mode).
- **An optional web dashboard** (React + Express) for viewing, adding, and
  manually refreshing parcels from a browser.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Supported Couriers](#supported-couriers)
- [Quick Start (GitHub Actions)](#quick-start-github-actions)
- [Configuration Reference](#configuration-reference)
- [Adding & Removing Parcels](#adding--removing-parcels)
- [Local Usage](#local-usage)
- [Web Dashboard](#web-dashboard)
- [Notifications](#notifications)
- [State & Auto-Cleanup](#state--auto-cleanup)
- [Reliable Hourly Triggers (Third-Party Cron)](#reliable-hourly-triggers-third-party-cron)
- [Privacy & Making the Repo Public](#privacy--making-the-repo-public)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## How It Works

The system is built around one idea: **keep all tracking data out of git, and
let GitHub Actions remember it for you.**

```
                 ┌──────────────────────────────┐
   every hour →  │  GitHub Actions: track.yml   │
                 └──────────────┬───────────────┘
                                │
         ┌──────────────────────┼───────────────────────┐
         ▼                      ▼                       ▼
  ┌─────────────┐        ┌─────────────┐         ┌──────────────┐
  │ 1. Restore  │        │ 2. Manage   │         │ 3. Track     │
  │ config.json │───────▶│ parcels     │────────▶│ each parcel  │
  │ state.json  │        │ (add/remove)│         │ via courier  │
  │ from cache  │        └─────────────┘         │ API          │
  └─────────────┘                                └──────┬───────┘
                                                        │
                          ┌─────────────────────────────┘
                          ▼
                 ┌──────────────────┐      ┌─────────────────────┐
                 │ 4. Compare with  │      │ 5. Send ntfy push   │
                 │ previous state   │─────▶│ on any status change│
                 │ (only notify on  │      └─────────────────────┘
                 │  real changes)   │
                 └──────────────────┘
```

1. **Trigger.** The workflow runs hourly on a `schedule`, and can also be started
   manually (`workflow_dispatch`) or by an external cron service
   (`repository_dispatch` with the `hourly-track` event type).

2. **Restore.** `config.json` (the parcel list + ntfy topic) and `state.json`
   (last known status/history per parcel) are restored from the **GitHub Actions
   cache**. Neither file lives in the repository — this is what keeps the repo
   safe to make public.

3. **Manage.** The `manage` step applies an add/remove/list action if one was
   requested (via workflow inputs), then writes the updated config back out to
   the cache.

4. **Track.** Every configured parcel is queried through its courier's tracker
   (`src/server/trackers/*.ts`). The new result is compared against the previous
   status stored in `state.json`.

5. **Notify.** A notification is sent **only when the status actually changed**
   (or when an error appears), which prevents hourly spam. Delivered parcels are
   highlighted with high priority.

> The engine (`src/server/engine.ts`) is the heart of this flow. Both the CLI
> runner and the web dashboard call into the same functions, so behaviour is
> identical in both modes.

---

## Project Structure

```
parcel-tracker/
├── .github/workflows/track.yml   # Hourly GitHub Actions workflow
├── server.ts                     # Express + Vite web dashboard server
├── src/
│   ├── App.tsx                   # React dashboard UI
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Tailwind styles
│   └── server/
│       ├── engine.ts             # Core tracking loop, diffing, ntfy sending
│       ├── manage.ts             # add / remove / list parcels (CI entry point)
│       └── trackers/
│           ├── index.ts          # Courier dispatcher (courier name -> impl)
│           ├── types.ts          # Shared TypeScript types
│           ├── dex.ts            # DEX (also used for Daraz)
│           ├── tcs.ts            # TCS Express
│           ├── leopards.ts       # Leopards
│           ├── postex.ts         # PostEx
│           └── trax.ts           # Trax
├── config.example.json           # Template for your config.json
├── trigger_github.py             # Optional external-cron trigger helper
├── package.json                  # Scripts & dependencies
└── README.md
```

**Key npm scripts**

| Script          | What it does                                                        |
|-----------------|---------------------------------------------------------------------|
| `npm run track` | Track all configured parcels once and send notifications             |
| `npm run manage`| Apply an add/remove/list action from env vars (used by CI)           |
| `npm run dev`   | Start the web dashboard in dev mode (Vite middleware + Express)      |
| `npm run lint`  | Type-check the project (`tsc --noEmit`)                              |
| `npm run build` | Build the dashboard frontend for production                         |

---

## Supported Couriers

| Courier  | Name in Config | Tracker source           | Notes                          |
|----------|----------------|--------------------------|--------------------------------|
| TCS      | `tcs`          | `src/server/trackers/tcs.ts`      | TCS Express                |
| Leopards | `leopards`     | `src/server/trackers/leopards.ts` |                            |
| PostEx   | `postex`       | `src/server/trackers/postex.ts`   |                            |
| Daraz    | `daraz`        | `src/server/trackers/dex.ts`      | Routed through the DEX tracker |
| DEX      | `dex`          | `src/server/trackers/dex.ts`      | Also used for Daraz        |
| Trax     | `trax`         | `src/server/trackers/trax.ts`     |                            |

Each tracker returns a normalized `TrackingResult`:

```ts
{
  status: string;       // human-readable status, e.g. "Out for Delivery"
  location: string;     // last known location, or "N/A"
  timestamp: string;    // ISO timestamp of this check
  delivered: boolean;   // true once the parcel is delivered
  history: HistoryItem[]; // checkpoint timeline
  error?: string;       // present when the check failed
}
```

To add a new courier, create `src/server/trackers/<name>.ts` exporting a
`track<Name>` function, then register it in `src/server/trackers/index.ts` and
add the name to the `CourierName` union in `types.ts`.

---

## Quick Start (GitHub Actions)

This is the recommended way to run the tracker continuously.

### 1. Fork / clone this repo

The repo is designed to be **public-safe**: no tracking numbers or topics are
ever committed.

### 2. Create your config

Copy `config.example.json` to `config.json` and edit it (see
[Configuration Reference](#configuration-reference)).

### 3. Store the config as a GitHub secret

The workflow reads the parcel list from the `TRACKER_CONFIG` secret:

```bash
gh secret set TRACKER_CONFIG --repo <owner>/<repo> --body "$(cat config.json)"
```

### 4. Set up ntfy.sh

1. Install the ntfy app
   ([iOS](https://apps.apple.com/app/ntfy/id1625396347) /
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) or
   just open `https://ntfy.sh/<topic>` in a browser.
2. Subscribe to a **unique, hard-to-guess** topic (e.g.
   `my-parcel-tracker-8f3k2`).
3. Put that topic into your `config.json` under `ntfy.topic`.

### 5. Enable Actions

1. Open the **Actions** tab of your repo.
2. Click **"I understand my workflows, go ahead and enable them"**.
3. Trigger it once manually to verify, then leave it to run hourly.

On the first run the workflow seeds `config.json` from the `TRACKER_CONFIG`
secret. After that, the parcel list lives in the Actions cache and can be
modified through the workflow inputs.

---

## Configuration Reference

`config.json` (never committed — see `.gitignore`):

```json
{
  "trackers": [
    {
      "name": "Mechanical Keyboard",
      "courier": "tcs",
      "tracking_number": "421001805332"
    },
    {
      "name": "Daraz Order",
      "courier": "dex",
      "tracking_number": "PK-DEX208753001"
    }
  ],
  "ntfy": {
    "server": "https://ntfy.sh",
    "topic": "my-parcel-tracker-8f3k2",
    "priority": "default",
    "tags": ["package", "delivery"]
  }
}
```

| Field                     | Required | Description                                             |
|---------------------------|----------|---------------------------------------------------------|
| `trackers[].name`         | ✅       | Friendly label shown in notifications                   |
| `trackers[].courier`      | ✅       | One of `tcs`, `leopards`, `postex`, `daraz`, `dex`, `trax` |
| `trackers[].tracking_number` | ✅    | The courier's tracking / CN number                      |
| `ntfy.server`             | ✅       | ntfy server (use `https://ntfy.sh` or self-hosted)      |
| `ntfy.topic`              | ✅       | Your secret topic name                                  |
| `ntfy.priority`           | ➖       | Default priority (`min`/`low`/`default`/`high`/`urgent`)|
| `ntfy.tags`               | ➖       | Default ntfy tags                                       |

Entries whose tracking number starts with `YOUR_` are treated as placeholders
and skipped, as is `config.example.json` itself.

> **Note:** the engine also contains a hardcoded demo parcel ("Veggie Cutter")
> that is re-added if missing. Remove that block in `src/server/engine.ts` and
> `src/server/manage.ts` if you don't want it.

---

## Adding & Removing Parcels

Parcels live in the Actions cache, not in git, so you manage them through the
workflow rather than by committing files.

### Via GitHub CLI

```bash
# Add a parcel
gh workflow run track.yml --repo <owner>/<repo> \
  -f action=add_parcel \
  -f parcel_name="New Shoes" \
  -f courier=tcs \
  -f tracking_number="421001805332"

# List current parcels
gh workflow run track.yml --repo <owner>/<repo> -f action=list_parcels

# Remove a parcel (by name or tracking number)
gh workflow run track.yml --repo <owner>/<repo> \
  -f action=remove_parcel \
  -f parcel_name="New Shoes"
```

You can also do the same from the **Actions → Track Parcels → Run workflow**
button in the GitHub UI.

### Via the web dashboard

Use the **Add Parcel** button (see [Web Dashboard](#web-dashboard)).

---

## Local Usage

Requires **Node.js 20+**.

```bash
npm install

# Option A: local config.json (git-ignored)
npm run track

# Option B: config passed inline, same as CI
TRACKER_CONFIG="$(cat config.json)" npm run track
```

`state.json` is created locally to avoid duplicate notifications between runs.
To see what *would* be sent without actually pushing to ntfy, set
`TRACKER_SILENT=1`.

---

## Web Dashboard

An optional local UI for browsing and managing parcels.

```bash
npm run dev      # http://localhost:3000
```

Features:

- **Stats cards** — total / in transit / delivered / errors.
- **Parcel list** with per-parcel status, location, expandable checkpoint history.
- **Track All / Track One** — trigger a check immediately.
- **Notify** — send a push notification for a single parcel on demand.
- **Add / remove parcel** — edits `config.json` and starts tracking instantly.
- **Quick lookup** — one-off tracking check without adding the parcel.
- **ntfy settings** — change server/topic/priority and send a test alert.

### API endpoints

| Method | Path                                     | Purpose                              |
|--------|------------------------------------------|--------------------------------------|
| GET    | `/api/health`                            | Health check                         |
| GET    | `/api/config`                            | Read current config                  |
| POST   | `/api/config`                            | Replace config                       |
| GET    | `/api/parcels`                           | List parcels + summary               |
| POST   | `/api/parcels`                           | Add a parcel and track it            |
| DELETE | `/api/parcels/:courier/:trackingNumber`  | Stop tracking a parcel               |
| POST   | `/api/parcels/:courier/:trackingNumber/notify` | Track + notify one parcel      |
| POST   | `/api/track-all`                         | Track every parcel                   |
| POST   | `/api/track-one`                         | Track a single parcel (no config change) |
| POST   | `/api/ntfy/test`                         | Send a test notification             |
| GET    | `/api/state`                             | Raw tracking state                   |

The server also runs an in-process check every **30 minutes** while it is
running.

> ⚠️ The dashboard has **no authentication**. Run it locally only, or put it
> behind auth before exposing it to a network.

---

## Notifications

Notifications are pushed to ntfy and include a per-parcel line plus a full summary.

| Event                        | Title prefix      | Priority |
|------------------------------|-------------------|----------|
| Delivered                    | `DELIVERED:`      | high     |
| Out for delivery / about to deliver | `OUT FOR DELIVERY:` | high |
| In transit (departed/dispatched) | `IN TRANSIT:`  | default  |
| Any other status change      | `UPDATE:`         | default  |
| Tracking error               | `TRACKING ERROR:` | high     |

Example message body:

```
Tracking: PK-DEX208753001
Status: Out for Delivery
Location: Islamabad - Bhara Kahu

Recent:
  2026-09-03 06:26: Out for Delivery
  2026-09-03 06:25: Departing from Logistics Hub

--- All Parcels ---
  • Daraz Order: Out for Delivery @ Islamabad - Bhara Kahu
  • Mechanical Keyboard: Arrived at Logistics Hub @ Karachi
```

Notifications containing non-ASCII characters are sanitized before being sent as
HTTP headers, so emoji in titles won't break delivery.

---

## State & Auto-Cleanup

`state.json` (git-ignored) stores, per parcel:

```ts
{
  "dex:PK-DEX208753001": {
    "status": "Delivered",
    "location": "Islamabad - Bhara Kahu",
    "last_checked": "2026-09-25T17:01:57Z",
    "delivered_at": "2026-09-05T11:22:00Z",
    "history": [ /* checkpoint timeline */ ]
  }
}
```

- **In CI**, `state.json` is restored from and saved to the GitHub Actions cache
  (`parcel-cache-*`), so history survives between runs without ever entering git.
- **De-duplication:** notifications fire only on a real status change.
- **Auto-cleanup:** once a parcel is delivered, it stays in the summary for
  **48 hours**, then is marked `removed` and dropped from active tracking.

> GitHub Actions caches can be evicted after ~7 days of inactivity. The hourly
> schedule keeps the cache warm, but the parcel list is not permanent storage —
> keep a copy of `config.json` somewhere safe.

---

## Reliable Hourly Triggers (Third-Party Cron)

GitHub's built-in `schedule` trigger can be delayed by several minutes, or not
fire at all on repos that see little activity. For precise hourly runs, use a
free external cron service such as [cron-job.org](https://cron-job.org).

### 1. Create a Personal Access Token

Create a token with permission to trigger workflows (`repo` scope for classic
tokens, or **Actions: write** for fine-grained tokens).

### 2. Configure cron-job.org

- **URL:** `https://api.github.com/repos/<owner>/<repo>/dispatches`
- **Method:** `POST`
- **Headers:**
  - `Authorization: Bearer <YOUR_PAT>`
  - `Accept: application/vnd.github+json`
  - `Content-Type: application/json`
- **Body:** `{"event_type":"hourly-track"}`
- **Schedule:** every hour (e.g. at minute 0)

The workflow's `repository_dispatch` trigger listens for the `hourly-track`
event type.

`trigger_github.py` is a small helper for the same thing locally — it reads the
token from the `GITHUB_TOKEN` environment variable (**never hardcode tokens**):

```bash
GITHUB_TOKEN=ghp_xxx python trigger_github.py
```

---

## Privacy & Making the Repo Public

Everything sensitive is kept out of git:

- ✅ `config.json` and `state.json` are in `.gitignore` and are **never committed**.
- ✅ In CI they are stored in the GitHub Actions cache, not in the repository.
- ✅ Tracking numbers are masked in logs (`PK-D****01`).

Before making the repo public, double-check:

- [ ] `config.json` / `state.json` are not tracked (`git ls-files | grep -E 'config|state'`).
- [ ] Git history contains no earlier commits with real tracking numbers
      (use `git filter-repo` or an orphan-branch rewrite, then force-push).
- [ ] Your ntfy topic is treated as a secret — anyone who knows an
      unauthenticated ntfy topic can read your notifications.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| No notifications at all | `ntfy.topic` missing or still `YOUR_...`; check the "Manage"/"Track" step logs |
| Workflow never runs hourly | GitHub schedule delays — set up a third-party cron trigger |
| Parcels "disappeared" | Delivered >48h ago (auto-removed), or the Actions cache was evicted |
| Tracking shows `ERROR: ...` | Courier API rejected the request or timed out; verify the tracking number |
| `Unknown courier` error | Courier name typo — must be `tcs`/`leopards`/`postex`/`daraz`/`dex`/`trax` |
| Deprecation warnings in CI | `actions/cache` `save-always` and Node 20 actions — harmless but worth updating |

---

## License

MIT
