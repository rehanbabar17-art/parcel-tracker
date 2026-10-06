# Parcel Tracker: simple setup guide

## What this app does

Parcel Tracker checks the delivery progress of the parcels you list. It can send updates to a private channel in the **ntfy** app. It runs automatically once an hour through GitHub Actions, or you can start a run yourself.

## Where your information is kept

Your private Backblaze B2 bucket is the active storage cabinet for the tracker:

Because the bucket is shared with bill-checker, parcel-tracker uses the private object prefix `parcel-tracker/`:

- `parcel-tracker/config.json`
- `parcel-tracker/state.json`

- **`config.json`** says which parcels to follow and contains the ntfy notification settings.
- **`state.json`** remembers the last check and the delivery checkpoints found so far. This helps the app tell what is new and what changed.

GitHub Actions temporarily downloads these files from B2, checks the parcels, uploads the updated files back to B2, and removes its temporary copies when the run ends. Parcel IDs and delivery details are not supposed to be placed in GitHub files, comments, or workflow inputs.

```text
B2 files → GitHub runs the tracker → updated history goes back to B2
```

## Before using it

1. In your repository, open **Settings → Secrets and variables → Actions** and add `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, and `B2_ENDPOINT` as encrypted secrets. The bucket is `GithubRepoSecretRB17` and the endpoint is `https://s3.us-east-005.backblazeb2.com`.
3. Put your real parcel names, courier names, and tracking IDs in the private B2 `config.json`. Set the ntfy server and topic in the same file. Keep this file private.
4. Install/open the ntfy app on your phone and subscribe to the topic configured in `config.json`. The app cannot confirm whether your phone displayed an alert; a successful tracker run can confirm only that ntfy accepted the message.

B2 migration and verification have been completed. The tracker now uses only the namespaced B2 objects.

## Start a tracking run

Open **Actions → Track Parcels → Run workflow**. You will see two optional switches:

- **Clear old parcel status/history before this run** — starts with an empty `state.json`, then writes fresh results after checking the parcels. It keeps `config.json` (your parcel list and notification settings). Use this only when you intentionally want to forget the saved parcel history.
- **Send ntfy notifications during this run** — turn this on when you want the run to send alerts. It is off by default for manual runs. The hourly scheduled run continues to use the normal notification behavior.

For the notification check requested here, turn on **Send ntfy notifications**. If you also clear history, the tracker treats every configured parcel as a first check, so it may send one alert per parcel. That is expected for a reset.

## Check that B2 was updated

Open **Actions → Verify Backblaze B2 Storage → Run workflow** after a tracking run. A successful check confirms the private files can be read and shows only totals—such as how many parcel records and history events were saved. It does not print parcel IDs, names, locations, topic names, or file contents.

The tracking workflow also reports whether its **Upload updated private data to B2** step succeeded. If that step fails, the run is marked as failed; do not assume the new history was saved. You can run the verifier after each successful tracking run to confirm the latest history is present in B2.

## Verified migration run

The parcel tracker was migrated and tested successfully:

- Existing private `config.json` and `state.json` are stored in the `parcel-tracker/` B2 prefix.
- B2 verification confirmed the private objects are readable.
- A live tracking run downloaded from B2, processed **3 parcels**, uploaded updated state back to B2, and cleaned up its local files.
- The B2 history was cleared before the test, so all 3 parcels were treated as first-time checks. Notifications were enabled and ntfy accepted **3 notifications**, one for each parcel.

Bill-checker uses its separate `bill-checker/` B2 folder and is not affected by the parcel-tracker namespace.

Each tracking run writes to the same `parcel-tracker/config.json` and `parcel-tracker/state.json` object keys. Backblaze may show earlier uploads as file versions for recovery, but they are not separate application files; the workflow always reads the current/latest version.

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

For Leopards parcels, the dashboard provides **17TRACK as the primary manual lookup** using the parcel tracking number. The dashboard’s built-in Leopards status check remains available as a backup. The 17TRACK link opens their tracking page; automated 17TRACK API integration is not configured.

## Keep private data private

- Never commit `config.json`, `state.json`, `.env`, real tracking IDs, or the ntfy topic.
- Do not put parcel details in GitHub workflow inputs, issues, pull requests, or comments.
- The tracking workflow reads `config.json` and `state.json` from B2.
