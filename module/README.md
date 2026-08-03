# Exigency Management Module (Standalone, No Google Sheets)

A self-contained Node.js + Express + SQLite version of the Exigency
Management System. Submissions come in through the module's own built-in
form (served at `/report.html`) — no Google Form, Apps Script, or tunnel
needed. All data lives in a local SQLite database.

## Architecture

```
Built-in report form (public/report.html)
        │
        ▼
POST /api/report/submit  ──────────────┐
        │                               │
        ▼                               │
   SQLite database (data/exigency.db)   │
   - exigencies                          │
   - schools / department_recipients     │
   - settings                            │
   - logs                                │
        │                                │
        ▼                                │
   Express API (/api/*)  ◄────────────────┘
        │
        ▼
   Dashboard UI (public/index.html + app.js)
   - view/edit exigencies
   - manage schools & recipients
   - edit settings
   - view logs
   - trigger reminder job manually (all unresolved, or a hand-picked selection)

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

Edit `.env` with real `SMTP_*` credentials (e.g. a Gmail address + [App Password](https://myaccount.google.com/apppasswords)).

## 2. Run

```bash
npm start
```

Open **http://localhost:4000** — you should see the dashboard (empty at first).
Submissions are made at **http://localhost:4000/report.html**.

## 3. Configure Settings

In the dashboard's **Settings** tab, fill in:
- `AdminEmail`, `DefaultCC`
- `OrgDomain` (e.g. `protego.services`) and/or `FsGroupEmail` — used to
  authorize submitters, same rule as before
- `ReminderTriggerHour` — restart the server (`Ctrl+C` then `npm start`)
  after changing this so the cron job picks up the new hour

## 4. Add schools and recipients

In the **Schools** tab: add each school's code + full name (the full name
must exactly match what the report form's dropdown shows, so submissions
route correctly), then add each authorized recipient's email under that
school.

## 5. Daily reminders

The reminder job runs automatically via `node-cron` at `ReminderTriggerHour`,
as long as `npm start` is running. You can also trigger it manually from the
**Exigencies** tab: "Run Reminder Now" sends to every unresolved exigency
eligible under the automatic rules, or tick specific rows and use "Send
Reminder to Selected" to send immediately (with an optional custom message)
regardless of those rules.

## Notes on "live" and localhost

Right now this runs on your machine only — closing the terminal stops the
server. For a permanently "always-on" version later, this same code can be
deployed to any Node.js host (Render, Railway, a VPS, etc.) with the SQLite
file swapped for a persistent volume or Postgres — nothing else in the
architecture needs to change.
