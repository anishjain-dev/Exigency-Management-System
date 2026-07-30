# Exigency Module — Architecture Reference

Read this when a task requires changing the schema, the recipient-routing
logic, or the email-sending behavior — not needed for routine
start/check/tunnel operations (those are covered in SKILL.md).

## Why this exists

The original design (see `Exigency-Management-System/ARCHITECTURE.md` and
`src/*.gs` at the repo root) was a Google Sheets + Apps Script system. The
user asked to move off Google Sheets entirely while keeping the Google Form
as the entry point, with data stored in the module's own database instead —
hence "module" as a self-contained replacement, not an extension of the
Sheets version.

## Database schema (`module/src/db.js`, SQLite via `node:sqlite`)

```
schools               (code PK, name)
departments            (name PK)
department_recipients (id PK, school_code, department, to_emails, cc_emails)
                        UNIQUE(school_code, department) — one row per pair
exigencies             (id PK — format EX-<CODE>-<YYYYMMDD>-<seq>,
                         school_code, school_raw, department, critical,
                         location, date_of_incident, issue, attachments,
                         immediate_actions, resolved, closure_date,
                         resolved_date, suggested_changes, submitter_email,
                         created_at, last_reminder_date, reminder_count,
                         sync_status, raw_json)
settings               (key PK, value)  -- see SKILL.md for the key list
logs                   (id PK, timestamp, record_id, recipient, type,
                         status, message)
```

`seedDepartmentRecipients.json` seeds the real school/department/recipient
data extracted from the original spreadsheet export on first run only
(`INSERT OR IGNORE`). If you need to re-seed from scratch, delete
`data/exigency.db*` before restarting the server — but confirm with the
user first, since this destroys any exigencies/settings they've since
created (the user has explicitly asked in past sessions to preserve live
data across restarts rather than wipe it casually).

## Why recipient override is additive, not a replacement

Earlier in this project, `ForceRecipientEmail` fully replaced the
computed `to` list. The user later clarified they wanted the real
concerned department person to ALSO get the mail, not be silently
excluded from it — so `emailService.applyRecipientOverride()` now unions
`ForceRecipientEmail` into `to` (deduped) rather than swapping it out. If
asked to add another override-style setting, default to additive
behavior unless the user explicitly asks for exclusive/test-only routing.

## Why `MailingEnabled` exists as a separate switch from recipients

Even with recipients narrowed to a single test address, the user wanted a
way to guarantee literally zero email leaves the system (including to that
test address) without having to clear out `ForceRecipientEmail`/
`department_recipients` data every time. `isMailingEnabled()` in
`emailService.js` is checked at the very top of both `sendReminderEmail`
and `sendNewSubmissionEmail`, before any recipient resolution — treat this
as the source of truth over reasoning about recipient lists when
diagnosing "no mail is being sent."

## Authorization: multi-domain support

`isAuthorizedSubmitter()` in `webhook.js` splits both `OrgDomain` and
`FsGroupEmail` on commas and checks for ANY match — this was added after a
real submitter (`@protego.services`) got wrongly rejected when `OrgDomain`
only had `fountainheadschools.org`. If a legitimate submitter is rejected,
the fix is almost always adding their domain to `OrgDomain` via the
Settings API, not touching the matching logic itself.

## Frontend structure (`module/public/`)

- `index.html` — sidebar nav (Dashboard / Exigencies / Schools & Recipients
  / Settings / Logs), KPI card grid, panel-grid bar charts.
- `css/style.css` — CSS custom properties for theming (light + dark via
  `prefers-color-scheme`), accent classes (`accent-critical`,
  `accent-warning`, `accent-success`) on KPI cards, `pill-*` classes for
  status badges.
- `js/app.js` — vanilla JS, no framework or build step. `renderBarList()`
  draws the stacked unresolved/resolved bars scaled to the largest total in
  the set — reuse this pattern rather than adding a charting library if
  asked for more visualizations.

## Apps Script side (`module/AppsScriptWebhook.gs` + the live project)

The live Apps Script project (opened via the Form's "Extensions > Apps
Script") turned out to be bound to the response **spreadsheet**, not the
Form — this is why `installExigencyModuleTrigger()` must call
`FormApp.openById(FORM_ID)` rather than `FormApp.getActiveForm()` (which
silently returns something that fails deep inside `ScriptApp`'s builder
chain with a confusing "Unexpected error... on object
ScriptApp.FormTriggerBuilder" rather than a clear null-reference error).
If this project is ever reattached to a different Form/spreadsheet, check
this binding assumption again before debugging trigger installation
further.

The handler function is named `sendToExigencyModule`, deliberately
different from the pre-existing `onFormSubmit` in that project's own
`Code.gs` (which does something unrelated, writing to a sheet) — don't
rename it back to `onFormSubmit`, as V8 Apps Script runtime lets two
same-named top-level functions across files silently shadow each other
based on load order, which is exactly the kind of bug that's invisible
until it isn't.
