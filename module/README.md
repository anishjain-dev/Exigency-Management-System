# Exigency Management Module (Standalone, No Google Sheets)

A self-contained Node.js + Express + SQLite version of the Exigency
Management System. Google Form stays as the submission entry point, but all
data now lives in a local SQLite database instead of Google Sheets. Runs
entirely on `localhost` — no Google Sheets, no Apps Script sync logic beyond
a single lightweight webhook forwarder.

## Architecture

```
Google Form (submission only)
        │  Apps Script installable trigger (ExigencyModuleWebhook.gs)
        ▼
   ngrok tunnel (forwards public URL -> your localhost)
        ▼
POST /api/webhook/form-submit  ──────────────┐
        │                                     │
        ▼                                     │
   SQLite database (data/exigency.db)         │
   - exigencies                                │
   - schools / school_users                    │
   - settings                                  │
   - logs                                       │
        │                                      │
        ▼                                      │
   Express API (/api/*)  ◄───────────────────────┘
        │
        ▼
   Dashboard UI (public/index.html + app.js)
   - view/edit exigencies
   - manage schools & recipients
   - edit settings
   - view logs
   - trigger reminder job manually

   node-cron: daily reminder job at Settings.ReminderTriggerHour
        │
        ▼
   SMTP (nodemailer) — sends HTML reminder emails
```

## 1. Install

```bash
cd module
npm install
cp .env.example .env
```

Edit `.env`:
- `WEBHOOK_SECRET` — any random string (this guards the webhook endpoint).
- `SMTP_*` — real SMTP credentials (e.g. a Gmail address + [App Password](https://myaccount.google.com/apppasswords)).

## 2. Run

```bash
npm start
```

Open **http://localhost:4000** — you should see the dashboard (empty at first).

## 3. Expose it to the internet (so Google Forms can reach it)

Google's servers cannot call `http://localhost:4000` directly. Use a tunnel:

```bash
# Install ngrok once: https://ngrok.com/download
ngrok http 4000
```

Copy the `https://xxxx.ngrok-free.app` URL it prints — this changes every
time you restart ngrok on the free tier.

## 4. Wire up the Google Form

1. Open the Form's **response spreadsheet** (not the Form editor).
2. **Extensions → Apps Script**.
3. Create a new file `ExigencyModuleWebhook.gs` and paste in the contents of
   [`ExigencyModuleWebhook.gs`](ExigencyModuleWebhook.gs) from this folder.
4. Set `FORM_ID` to your Form's ID (from its URL), `WEBHOOK_URL` to your
   tunnel URL + `/api/webhook/form-submit`, e.g.:
   `https://xxxx.trycloudflare.com/api/webhook/form-submit`
5. Set `WEBHOOK_SECRET` to the exact same value as `.env`'s `WEBHOOK_SECRET`.
6. Save, then run **`installExigencyModuleTrigger`** once from the function
   dropdown — grant permissions when prompted.
7. Submit the Form — within a second or two, refresh the dashboard's
   **Exigencies** tab and the new row should appear.

Whenever you restart your tunnel, its URL changes — just update `WEBHOOK_URL`
in the Apps Script file and save; no need to reinstall the trigger.

## 5. Configure Settings

In the dashboard's **Settings** tab, fill in:
- `AdminEmail`, `DefaultCC`
- `OrgDomain` (e.g. `protego.services`) and/or `FsGroupEmail` — used to
  authorize submitters, same rule as before
- `ReminderTriggerHour` — restart the server (`Ctrl+C` then `npm start`)
  after changing this so the cron job picks up the new hour

## 6. Add schools and recipients

In the **Schools** tab: add each school's code + full name (the full name
must exactly match what the Form's dropdown shows, so submissions route
correctly), then add each authorized recipient's email under that school.

## 7. Daily reminders

The reminder job runs automatically via `node-cron` at `ReminderTriggerHour`,
as long as `npm start` is running. You can also trigger it manually from the
**Dashboard** tab's "Run Daily Reminder Job Now" button — useful for testing
without waiting for the scheduled hour.

## Notes on "live" and localhost

Right now this runs on your machine only — closing the terminal / restarting
your computer stops the server (and the ngrok tunnel gets a new URL each
restart, needing the Apps Script `WEBHOOK_URL` updated). For a permanently
"always-on" version later, this same code can be deployed to any Node.js
host (Render, Railway, a VPS, etc.) with the SQLite file swapped for a
persistent volume or Postgres — nothing else in the architecture needs to
change.
