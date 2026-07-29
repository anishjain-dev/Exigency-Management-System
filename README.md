# Exigency Management System

A Google Forms + Sheets + Apps Script system for tracking exigencies (urgent
incidents), routing them to the right school, and automatically reminding
owners until each item is closed.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, database
schema, and flow diagrams.

## Existing Resources

- Form: `1kKzEjSfeo76Fl9bkjYTPqX4FVlH8VLD9-WUaEkzo_7w`
- Response Spreadsheet: `1VvgAYFEQVyGWwFdFsldGuaAyO4MhBPhpU_oOCOZaCws`

## Folder Structure

```
Exigency-Management-System/
├── ARCHITECTURE.md
├── README.md
└── src/
    ├── appsscript.json      # Manifest (timezone, scopes)
    ├── Constants.gs         # Fixed system sheet/column names
    ├── Config.gs            # Settings sheet reader/cache
    ├── Utilities.gs         # Generic helpers (IDs, dates, logging, batching)
    ├── Validation.gs        # Row + submitter validation
    ├── SchoolService.gs     # School sheet creation + two-way sync
    ├── FormSubmit.gs        # onFormSubmit handler
    ├── EmailService.gs      # HTML email templating + send
    ├── Reminder.gs          # Daily overdue engine, close/reschedule
    ├── Dashboard.gs         # KPI computation + rendering + chart
    ├── Triggers.gs          # Idempotent trigger installer
    └── Main.gs              # initializeSystem(), onEdit router, custom menu
```

## Deployment Steps

1. **Open the response spreadsheet** (`1VvgAYFEQVyGWwFdFsldGuaAyO4MhBPhpU_oOCOZaCws`).
2. **Extensions → Apps Script** to open the container-bound script editor.
3. Create each file listed above under `src/` (matching names, drop the `src/`
   prefix) and paste in its contents. Replace the default `appsscript.json`
   content with `src/appsscript.json` (use **Project Settings → Show
   "appsscript.json" manifest file**).
4. **Save** all files (`Ctrl+S` / disk icon).
5. In the Apps Script editor, select `initializeSystem` from the function
   dropdown and click **Run**. Grant the requested permissions when prompted
   (Google will show an "unverified app" warning for your own script —
   click **Advanced → Go to (project) (unsafe)**, this is expected for
   private container-bound scripts you own).

`initializeSystem()` will:
- Create the `Settings`, `Logs`, and `Dashboard` sheets with defaults.
- Append the system columns to `Form Responses 3`.
- Create a sheet per configured school (`FSK Emails`, `FSA Emails`, `FSL
  Emails` by default — edit `SchoolCodes` in `Settings` to change this).
- Backfill Exigency IDs and sync any existing rows.
- Install all triggers (form submit, daily reminder, daily dashboard
  refresh, onEdit).
- Build the first Dashboard snapshot.

It is **safe to re-run** `initializeSystem()` any time (e.g. after changing
`Settings`) — all steps are idempotent.

## Installation / Configuration Guide

Open the `Settings` sheet and fill in:

| Key | Example | Notes |
|---|---|---|
| `ReminderTime` | `08:00` | Informational; actual trigger hour below |
| `ReminderTriggerHour` | `8` | Hour (0–23) the daily reminder job runs |
| `DashboardTriggerHour` | `9` | Hour the dashboard refresh runs |
| `AdminEmail` | `admin@yourorg.org` | Receives critical error alerts |
| `DefaultCC` | `coordinator@yourorg.org` | Comma-separated, CC'd on every reminder |
| `SchoolCodes` | `FSK,FSA,FSL` | One sheet `<CODE> Emails` created per code |
| `StatusList` | `Open,In Progress,Snoozed,Closed` | First value = default status on new rows |
| `ClosedStatus` | `Closed` | Must match a value in `StatusList` |
| `StatusColor:<Status>` | `#34A853` | One row per status, drives email color pill |
| `OrgDomain` | `yourorg.org` | Submitter email must end in `@<domain>` |
| `FsGroupEmail` | `fsgroup@yourorg.org` | Alternate exact-match authorized submitter |
| `SpreadsheetUrl` | (auto-filled) | Link used in reminder emails |

After editing `Settings`, run **Exigency Admin → Initialize / Repair System**
from the custom menu (installed automatically) so triggers pick up any
changed hours.

### Restricting Form submissions to the FS Group

In the Form editor: **Settings → Responses → "Restrict to users in
[organization] and collect email addresses"**. This is the preventive
control. `Validation.isAuthorizedSubmitter_` is the detective backstop that
flags anything unexpected in `Logs` instead of silently trusting it.

### Sharing school sheets

Share the response spreadsheet with each school's coordinator group using
**view or comment access to the whole file is not required** — for stricter
isolation, publish each `<CODE> Emails` sheet's Records block via a filtered
view, or migrate to separate output spreadsheets per school (see Future
Enhancements).

## Testing Checklist

- [ ] Submit the Form as an authorized (FS Group) user → row appears in
      `Form Responses 3` with an `Exigency ID` and `Sync Status = Synced`.
- [ ] The same row appears in the correct `<CODE> Emails` sheet's Records
      block, matched by Exigency ID.
- [ ] Submit the Form as an unauthorized user (if testable) → row is flagged
      `Rejected: Unauthorized submitter` and NOT synced to any school sheet;
      confirm an entry appears in `Logs`.
- [ ] Edit `Status`/`Next Due Date`/`Closed Date` directly on a school
      sheet's Records row → confirm the master row updates within seconds
      (onEdit trigger).
- [ ] Set a Follow-up Date to today or earlier on an `Open` row with no Next
      Due Date, then run **Exigency Admin → Run Daily Reminder Job Now** →
      confirm a reminder email arrives, `Last Reminder Date` and `Reminder
      Count` update, and a `Logs` row with `Status = SUCCESS` appears.
- [ ] Re-run the reminder job again the same day → confirm the same row is
      **skipped** (no duplicate email), logged as such in the run summary.
- [ ] Set `Next Due Date` to a future date on an overdue row → confirm the
      next reminder run does **not** email it.
- [ ] Advance/backdate that `Next Due Date` to today → confirm the next run
      clears it and resumes reminding if still open.
- [ ] Set `Status = Closed` → confirm reminders stop permanently for that row.
- [ ] Open `Dashboard` → confirm KPI numbers and the school-wise chart match
      the current data.
- [ ] Change `ReminderTriggerHour` in `Settings`, re-run
      `initializeSystem()`, then **Project Triggers** in the Apps Script
      editor → confirm exactly one trigger per handler (no duplicates).
- [ ] Force an error (e.g. temporarily rename `Form Responses 3`) and run a
      job → confirm `AdminEmail` receives a critical error email and `Logs`
      records it.

## Future Enhancement Suggestions (Stage 2)

- Monthly/weekly summary emails (reuses `EmailService.buildHtmlEmail_`'s
  generic section model).
- School performance analytics: average response time
  (`Timestamp` → first `Last Reminder Date`) and resolution time
  (`Timestamp` → `Closed Date`) — columns already reserved in
  `Constants.DATA_COLUMNS`.
- Management roll-up dashboard across schools with trend charts.
- Per-school output spreadsheets (via `SpreadsheetApp.create` +
  `Sheet.copyTo`) for stricter access isolation than sheet-level sharing.
- Escalation tier: after N reminders with no action, auto-CC a supervisor
  (`REMINDER_TYPE.ESCALATION` is already reserved in `Constants.gs`).

## Security Recommendations

- Enable Form's "Restrict to organization + collect email" setting (see
  above) — this is required, not optional, for the FS Group restriction to
  actually hold.
- Keep `Settings`, `Logs`, and `Dashboard` sheets restricted to admins only
  (Data → Protected sheets and ranges).
- Do not share the whole spreadsheet with non-admin school users; share
  individual school sheets or move to per-school output spreadsheets.
- Review `Logs` periodically for `Rejected: Unauthorized submitter` entries.
- Rotate/verify `AdminEmail` and `DefaultCC` values whenever staff change.

## Performance Optimization

See [ARCHITECTURE.md §10](ARCHITECTURE.md#10-performance-optimization) —
batched reads/writes, cached configuration, in-memory ID maps, and a single
spreadsheet handle per execution.

## Error Handling

See [ARCHITECTURE.md §11](ARCHITECTURE.md#11-error-handling) — every entry
point is wrapped in try/catch, per-row failures are isolated, and critical
failures alert `AdminEmail` in addition to being logged.
