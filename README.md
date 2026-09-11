# 📦 Parcel Tracker

Automated parcel tracking with hourly updates via ntfy.sh. Tracks TCS, Leopards,
PostEx, Daraz, DEX, and Trax parcels, and sends a notification whenever a status
changes. Every notification includes the latest status of **all** tracked parcels.

## Supported Couriers

| Courier  | Name in Config |
|----------|----------------|
| TCS      | `tcs`          |
| Leopards | `leopards`     |
| PostEx   | `postex`       |
| Daraz    | `daraz`        |
| DEX      | `dex`          |
| Trax     | `trax`         |

## How It Works

1. A GitHub Actions workflow runs every hour (`schedule`) and can also be
   triggered manually or via third-party cron (`repository_dispatch`).
2. The workflow reads the parcel list from the `TRACKER_CONFIG` Actions secret
   (never stored in the repo, so the repo can be public).
3. Tracking state (`state.json`) is persisted between runs using the GitHub
   Actions cache, so you only get notified on real status changes.
4. Notifications are sent to your ntfy topic. Delivered parcels stay visible in
   the summary for 48 hours, then are removed automatically.

## Private Setup (before making the repo public)

### 1. Set the config secret

1. Edit `config.json` with your tracking numbers (see `config.example.json`).
2. Add it as a GitHub Actions secret:

```bash
gh secret set TRACKER_CONFIG --repo <owner>/<repo> --body "$(cat config.json)"
```

Optional legacy secrets (still supported by nothing in code — config now comes
only from `TRACKER_CONFIG`): ignore.

### 2. Set up ntfy.sh

1. Install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) /
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. Subscribe to a unique topic (e.g., `my-parcel-tracker-12345`).
3. Put that topic inside the `TRACKER_CONFIG` JSON.

### 3. Enable workflows

1. Go to the **Actions** tab of the repo.
2. Click **"I understand my workflows, go ahead and enable them"**.
3. The tracker runs every hour; a run can also be started manually from the
   Actions tab.

## Local Usage

```bash
pip install -r requirements.txt

# With a local config.json (ignored by git):
python tracker.py

# Or with config in an env var (same as CI):
TRACKER_CONFIG="$(cat config.json)" python tracker.py
```

`state.json` is created locally to avoid duplicate notifications.

## Adding / Removing Parcels

- Add a parcel: edit the `trackers` list in the config JSON, then update the
  `TRACKER_CONFIG` secret:

```bash
gh secret set TRACKER_CONFIG --repo <owner>/<repo> --body "$(cat config.json)"
```

- Delivered parcels are kept in the summary for 48 hours and then automatically
  skipped (tombstoned in `state.json`) so they stop appearing in notifications.

## Notifications

- ✅ **Delivered** — high priority
- 🚚 **Out for Delivery** — high priority
- 📦 **Status Changed** — any update
- ❌ **Tracking errors** — high priority
- Every notification includes the latest status of all tracked parcels.

## State Management

`state.json` is **not** committed to the repo. In CI it is restored from and
saved to the GitHub Actions cache (`parcel-state-*`), so status history survives
between runs without exposing tracking numbers in a public repo.

## Third-Party Cron Setup (reliable hourly triggers)

GitHub's built-in `schedule` trigger can be delayed or not fire on new repos.
Use **cron-job.org** (free) to trigger the workflow every hour instead.

### 1. Create a Personal Access Token (PAT)

1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Generate a token with scope **`repo`** (or fine-grained with Actions write).

### 2. Set up cron-job.org

1. Sign up at https://cron-job.org (free).
2. Create a cron job with:
   - **URL:** `https://api.github.com/repos/<owner>/<repo>/dispatches`
   - **Method:** POST
   - **Headers:**
     - `Authorization: Bearer <YOUR_PAT>`
     - `Accept: application/vnd.github+json`
     - `Content-Type: application/json`
   - **Body:** `{"event_type":"hourly-track"}`
   - **Schedule:** Every hour (e.g., at minute 0)
3. Enable the job.

The repo workflow accepts `schedule`, `workflow_dispatch`, and
`repository_dispatch` (`hourly-track`) triggers. `trigger_github.py` is included
for local/manual triggering with a `GITHUB_TOKEN` env var.

## Making the Repo Public Safely

Before making the repo public, ensure:

- [ ] `config.json` and `state.json` are in `.gitignore` (never committed).
- [ ] The `TRACKER_CONFIG` secret is set (contains real tracking numbers + ntfy topic).
- [ ] Git history has been rewritten to remove any earlier commits that contained
      `config.json` / `state.json` (see `git filter-repo` or an orphan-branch
      rewrite), then `git push --force`.
- [ ] You are not using unauthenticated ntfy topics that you want to keep private
      (a public repo doesn't expose secrets, but the ntfy topic itself must stay
      secret if it's unauthenticated).

## License

MIT
