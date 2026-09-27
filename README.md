# Parcel Tracker: simple setup guide

## What this app does

Parcel Tracker checks the delivery progress of the parcels you list. It can send updates to a private channel in the **ntfy** app. It runs automatically once an hour through GitHub Actions, or you can start a run yourself.

## Where your information is kept

Your private MEGA folder is the storage cabinet for the tracker:

- **`config.json`** says which parcels to follow and contains the ntfy notification settings.
- **`state.json`** remembers the last check and the delivery checkpoints found so far. This helps the app tell what is new and what changed.

GitHub Actions temporarily downloads these files, checks the parcels, uploads the updated files back to MEGA, and removes its temporary copies when the run ends. Parcel IDs and delivery details are not supposed to be placed in GitHub files, comments, or workflow inputs.

```text
MEGA files → GitHub runs the tracker → updated history goes back to MEGA
```

## Before using it

1. In your repository, open **Settings → Secrets and variables → Actions**. Add the MEGA account email as `MEGA_EMAIL` and its password as `MEGA_PASSWORD`. These are private GitHub secrets; do not type them into a workflow file.
2. In MEGA, open `github-data/parcel-tracker/config.json`. Put your real parcel names, courier names, and tracking IDs there. Set the ntfy server and topic in the same file. Keep this file private.
3. Install/open the ntfy app on your phone and subscribe to the topic configured in `config.json`. The app cannot confirm whether your phone displayed an alert; a successful tracker run can confirm only that ntfy accepted the message.

If MEGA does not yet have `config.json` or `state.json`, use **Actions → Initialize Missing MEGA Files → Run workflow**. It creates only missing files and will not replace files that already exist. The example file contains placeholders, not real parcel information.

## Start a tracking run

Open **Actions → Track Parcels → Run workflow**. You will see two optional switches:

- **Clear old parcel status/history before this run** — starts with an empty `state.json`, then writes fresh results after checking the parcels. It keeps `config.json` (your parcel list and notification settings). Use this only when you intentionally want to forget the saved parcel history.
- **Send ntfy notifications during this run** — turn this on when you want the run to send alerts. It is off by default for manual runs. The hourly scheduled run continues to use the normal notification behavior.

For the notification check requested here, turn on **Send ntfy notifications**. If you also clear history, the tracker treats every configured parcel as a first check, so it may send one alert per parcel. That is expected for a reset.

## Check that MEGA was updated

Open **Actions → Verify MEGA Storage → Run workflow** after a tracking run. A successful check confirms the files can be read and shows only totals—such as how many parcel records and history events were saved. It does not print parcel IDs, names, locations, topic names, or file contents.

The tracking workflow also reports whether its **Upload updated private data to MEGA** step succeeded. If that step fails, the run is marked as failed; do not assume the new history was saved. You can run the verifier after each successful tracking run to confirm the latest history is present in MEGA.

## Understanding ntfy results

- A log message saying **Notification sent** means the ntfy server accepted the message.
- A message saying **Notification failed** or **topic not configured** means the phone will not receive that alert from this run.
- If ntfy accepted it but nothing appears on your phone, check that the phone is subscribed to the same topic, notifications are allowed for the app, and the correct ntfy server is selected.

The app sends parcel details to the ntfy topic you configured. Treat that topic as private and do not share it publicly.

## Local development

For a developer who wants to run the dashboard on their own computer:

```bash
npm ci
npm run dev
```

The dashboard uses `127.0.0.1` by default and has no login screen. Do not expose it to the public internet unless authentication and access controls are added.

The project supports these courier names: `tcs`, `leopards`, `postex`, `daraz`, `dex`, and `trax`.

## Keep private data private

- Never commit `config.json`, `state.json`, `.env`, real tracking IDs, or the ntfy topic.
- Do not put parcel details in GitHub workflow inputs, issues, pull requests, or comments.
- The old `TRACKER_CONFIG` GitHub secret was used only to migrate settings when MEGA had no `config.json`. Once you confirm the MEGA copy is valid, remove that old secret in repository settings. Future runs read the configuration from MEGA.
