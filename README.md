# Parcel Tracker with Private MEGA Storage

An automated, serverless parcel tracking system built with Node.js and GitHub Actions, using **MEGA** as the single source of truth for private configuration (`config.json`) and tracking state (`state.json`).

---

## 1. Architecture Overview

To ensure absolute privacy and security, this public repository contains **zero tracking numbers, courier credentials, or notification topics**. Instead, all sensitive runtime data is stored securely in private **MEGA** cloud storage.

```text
MEGA
├── github-data/
    └── parcel-tracker/
        ├── config.json  (Tracking list & ntfy notification settings)
        └── state.json   (Last known status & delivery history)
```

### How Each Run Works (GitHub Actions)
1. **Login**: GitHub Actions securely authenticates with MEGA using encrypted repository secrets (`MEGA_EMAIL` and `MEGA_PASSWORD`).
2. **Download**: Downloads both `config.json` and `state.json` into the runner's ephemeral environment.
3. **Run**: Executes the tracker and update engines.
4. **Update**: Updates `state.json` (and `config.json` if management workflows add/remove parcels).
5. **Upload & Clean**: Uploads both updated files back to MEGA, deletes local copies, and logs out.

---

## 2. Setup Instructions

### Step 1: Prepare MEGA Storage
1. Log into your private MEGA account.
2. Create the following folder structure:
   ```text
   github-data/
   └── parcel-tracker/
   ```
3. Upload your initial `config.json` (you can use `config.example.json` as a template) and `state.json` into `github-data/parcel-tracker/`.

### Step 2: Configure `config.json`
Your `config.json` in MEGA should follow this format:
```json
{
  "trackers": [
    {
      "name": "My Parcel",
      "courier": "tcs",
      "tracking_number": "YOUR_TRACKING_NUMBER"
    }
  ],
  "ntfy": {
    "server": "https://ntfy.sh",
    "topic": "YOUR_NTFY_SECRET_TOPIC",
    "priority": "default",
    "tags": ["package", "delivery"]
  }
}
```

---

## 3. GitHub Actions Requirements

The repository requires only two GitHub Secrets to access your private MEGA storage.

Navigate to your GitHub repository **Settings > Secrets and variables > Actions** and add:
- **`MEGA_EMAIL`**: Your private MEGA account email address.
- **`MEGA_PASSWORD`**: Your private MEGA account password.

---

## 4. Security Notes

- **Zero Hardcoded Secrets**: The public repository code contains no tracking numbers, API keys, or notification topics.
- **Ephemeral Runners**: GitHub Actions runners process credentials and decrypted config data only in memory during execution.
- **Always Cleanup**: The workflow includes an `always()` cleanup step (`rm -f config.json state.json`) to guarantee local files are wiped after every run.
- **Clean Git History**: The repository history is maintained free of sensitive leaks.
