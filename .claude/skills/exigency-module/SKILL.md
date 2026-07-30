---
name: exigency-module
description: Resume, run, debug, or configure the standalone Exigency Management System module (Node.js + Express + SQLite, at Exigency-Management-System/module). Use this whenever the user asks to start/restart the module server, check or change its Settings (mailing on/off, recipient emails, org domain), inspect its schools/departments/exigencies data, troubleshoot the Google Form -> webhook -> module pipeline, or set up/fix a tunnel (localtunnel/cloudflared/ngrok) so the Form can reach localhost. Also trigger this for questions like "why isn't the form submission showing up" or "is mailing on right now" for this project.
---

# Exigency Management Module

This skill captures the working knowledge needed to pick this project back up
without re-deriving it from scratch. The module lives at
`Exigency-Management-System/module` and replaced an earlier Google
Sheets-based version — Google Forms is still the submission entry point, but
all data now lives in a local SQLite database with its own Express API and
dashboard UI.

Read `references/architecture.md` before making non-trivial changes to the
schema, routing logic, or email behavior — it has the full picture. This
file is enough for day-to-day operational tasks (start it, check settings,
debug a stuck pipeline).

## Starting the module

```bash
cd Exigency-Management-System/module
npm install   # only needed once, or after a git pull that touched package.json
npm start
```

Runs on `http://localhost:4000`. `.env` (gitignored, never commit it) holds
`WEBHOOK_SECRET` and `SMTP_*` credentials — if it's missing, copy
`.env.example` and fill in real values, or ask the user for them; don't
invent placeholder credentials and declare it done, since mail silently
fails without real SMTP creds.

If a `node:sqlite`-based server is already running on port 4000 from a
previous session, stop it before starting a new one — check with:
```bash
curl -s http://localhost:4000/api/dashboard   # 200 = already running
```

## Checking/changing Settings

Everything configurable lives in the `settings` table, exposed via
`GET/PUT /api/settings` — never hardcode these values in code:

```bash
curl -s http://localhost:4000/api/settings
```

Key settings to know about:

| Key | Purpose |
|---|---|
| `MailingEnabled` | Master kill-switch. `"false"` = no email goes out to anyone at all (reminders or new-submission notices), even though records still save/update normally. Check this FIRST whenever the user asks "why didn't I get an email" or says mail shouldn't go anywhere. |
| `ForceRecipientEmail` | Comma-separated list. When set, these addresses are ADDED to every outgoing mail alongside the real department recipients (not a replacement — both get it). |
| `OrgDomain` | Comma-separated list of authorized submitter email domains (e.g. `fountainheadschools.org,protego.services`). A submitter whose email doesn't end in one of these gets rejected with `Unauthorized submitter`. |
| `FsGroupEmail` | Comma-separated exact-match authorized submitter emails (alternative/addition to domain matching). |
| `AdminEmail` / `DefaultCC` | Used for critical-error alerts and fallback CC. |
| `ReminderTriggerHour` | Hour (0-23) the daily reminder cron fires — requires a server **restart** to take effect (read once at `server.js` startup). |

As of the last working session in this project: **`MailingEnabled` is set
to `"false"`** (nobody receives any mail, per explicit user instruction),
and every department's recipient list has been overwritten to a single
test address. Don't assume this is still current — always check
`GET /api/settings` and `GET /api/schools` live rather than trusting this
note, since the user may have changed it since.

To update settings:
```bash
curl -s -X PUT http://localhost:4000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"MailingEnabled":"true"}'
```

## The real schema (don't guess a generic one)

This is NOT a generic "Owner / Follow-up Date / Status" ticket system — it
mirrors the actual Google Form's questions and the school's real
operational structure:

- **Schools**: `FSK`, `FSM`, `FALH`, `FP VESU`, `FP Adajan`, `FWGS` — codes
  are case-preserved as stored (not force-uppercased), because some contain
  spaces. `GET /api/schools` returns each school with its department
  recipient rows.
- **Departments** (8, same across every school): Student Safety / Medical
  Emergency, Transport, Kitchen, Events, Infrastructure/Safety,
  Animal/Reptile Issue, Staff Safety & Conduct, Other.
- **Recipient routing is (School, Department) -> {to, cc}**, replacing the
  original per-school "`<CODE> Emails`" Google Sheet tabs. Edit via
  `PUT /api/schools/:code/departments/:department` with `{"to": "...",
  "cc": "..."}` (comma-separated emails).
- **Exigency fields** map 1:1 to the real Form questions: `school_code`,
  `department`, `critical` (0/1), `location`, `date_of_incident`, `issue`,
  `attachments`, `immediate_actions`, `resolved` ("Yes"/"No"),
  `closure_date`, `suggested_changes`, `submitter_email`. There is no
  generic "Owner" or "Status" field — don't reintroduce one without asking.

## The submission pipeline

```
Google Form
  -> Apps Script (bound to the response SPREADSHEET, not the Form itself —
     use FormApp.openById(FORM_ID), NOT FormApp.getActiveForm(), which
     returns nothing in this project's setup)
  -> function sendToExigencyModule(e) in ExigencyModuleWebhook.gs
     (named distinctly from Code.gs's own onFormSubmit to avoid collision)
  -> UrlFetchApp.fetch(WEBHOOK_URL, ...) with header X-Webhook-Secret
  -> a tunnel (localtunnel/cloudflared) forwarding to localhost:4000
  -> POST /api/webhook/form-submit in module/src/routes/webhook.js
  -> validates submitter (OrgDomain/FsGroupEmail), inserts exigency row,
     fires sendNewSubmissionEmail() immediately (subject to MailingEnabled)
```

When the user says "I submitted the form but nothing happened," check in
this order:
1. `curl http://localhost:4000/api/logs` — did the webhook even receive it?
   If nothing new appears, the tunnel is almost certainly dead (see below).
2. If a `SYNC`/`FAILURE` log says "Unauthorized submitter" — their email
   domain isn't in `OrgDomain`/`FsGroupEmail`.
3. If a record was created but no `NEW_SUBMISSION` log, or it says
   `SKIPPED` — check `MailingEnabled` and whether recipients resolved to
   anything (`GET /api/schools` for that school+department).
4. If `NEW_SUBMISSION` says `FAILURE` with an SMTP auth error — the
   `.env` SMTP credentials are wrong/stale; see the tunnel/SMTP notes below.

`ExigencyModuleWebhook.gs`'s `WEBHOOK_URL` constant must exactly match
whatever tunnel URL is currently live — free tunnels rotate their URL on
every restart, so this is the #1 cause of "it stopped working."

## Setting up a tunnel

Google's servers can't reach `localhost:4000` directly. Options, in order
of what's actually worked in this environment:

1. **Cloudflare quick tunnel** (most reliable so far):
   ```bash
   winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
   # find the exe (winget installs to Program Files (x86) via MSI, not on PATH by default)
   "/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --url http://localhost:4000
   ```
   Look for the `https://xxxx.trycloudflare.com` URL in the output. No
   account/authtoken needed for a quick tunnel. If a fresh DNS name doesn't
   resolve immediately on this machine, that's usually THIS machine's local
   resolver being slow — verify with `curl --resolve <host>:443:<ip>` using
   an IP from `nslookup <host> 8.8.8.8`, and trust that Google's own DNS
   infrastructure (which is what actually matters) will resolve it fine
   even if this machine's resolver lags.

2. **localtunnel** (pure JS, no binary — but the free relay disconnects
   unpredictably, sometimes within minutes; treat any silence in
   `/api/logs` as a sign to check `curl -H "bypass-tunnel-reminder: true"
   <url>/api/dashboard` and restart it if it times out):
   ```bash
   cd Exigency-Management-System/module
   npx localtunnel --port 4000
   ```

3. **ngrok** — avoid unless the user already has a paid ngrok account. The
   winget-distributed agent (3.3.1) is below the minimum version ngrok now
   requires for free accounts, and manually downloading a newer binary gets
   silently quarantined by Windows Defender when there's no admin access to
   add an exclusion (the file just vanishes after the first failed run —
   don't waste time re-downloading it, switch to option 1).

Whichever tunnel is used, remember: every time it's restarted, its URL
changes, and `WEBHOOK_URL` in `ExigencyModuleWebhook.gs` must be updated to
match (no need to re-run the trigger installer, just edit the constant and
save).

## Reference

See `references/architecture.md` for: full SQLite schema, the dashboard UI
structure (sidebar/KPI cards/bar charts in `public/`), and the reasoning
behind design decisions like additive vs. replacing recipient overrides.
