# Exigency Management System — Architecture

## 1. System Overview

The Exigency Management System (EMS) is a serverless workflow built entirely on Google
Workspace. It captures exigency (urgent/incident) reports through a Google Form,
stores them in a master spreadsheet, fans them out to per-school views, and runs a
daily reminder engine that emails owners/schools until each record is closed.

```
                        ┌─────────────────────┐
                        │      Google Form      │
                        │ (FS Group restricted)  │
                        └──────────┬────────────┘
                                   │ submit
                                   ▼
                 ┌────────────────────────────────────┐
                 │   Form Responses 3 (Master Sheet)    │
                 │   - immutable, append-only            │
                 └───────────────┬─────────────────────┘
                                 │ onFormSubmit / onEdit
                                 ▼
        ┌────────────────────────────────────────────────┐
        │                 Apps Script Engine                │
        │  FormSubmit.gs → SchoolService.gs → Validation.gs │
        └───────────────┬───────────────────┬─────────────┘
                         │                   │
                         ▼                   ▼
           ┌─────────────────────┐  ┌─────────────────────┐
           │  School Sheets       │  │   Logs Sheet          │
           │  (FSK, FSA, FSL...)  │  │   (audit trail)        │
           └─────────┬───────────┘  └─────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────┐        Daily Trigger (Time-driven)
        │  Reminder.gs (daily loop)     │◄───────────────────────────────┐
        │  - overdue detection            │                                │
        │  - dedupe by date               │                                │
        └───────────────┬───────────────┘                                │
                         │                                                 │
                         ▼                                                 │
        ┌─────────────────────────────┐                                  │
        │   EmailService.gs             │                                  │
        │   HTML templated mail          │                                  │
        └───────────────┬───────────────┘                                  │
                         │                                                 │
                         ▼                                                 │
        ┌─────────────────────────────┐                                  │
        │   Logs Sheet (mail status)     │                                  │
        └─────────────────────────────┘                                  │
                                                                            │
        ┌─────────────────────────────┐                                  │
        │   Dashboard.gs                 │──────────────────────────────────┘
        │   KPIs / charts / counts       │  (also runs on trigger + on demand)
        └─────────────────────────────┘
```

## 2. Design Principles

1. **Master data is immutable.** `Form Responses 3` is never rewritten by scripts —
   only appended to by the Form itself. All derived data lives elsewhere.
2. **Single source of truth per record.** Every row is tagged with a generated
   `Exigency ID` the moment it lands in the master sheet. All other sheets key off
   this ID — never off row position.
3. **Configuration over hardcoding.** Sheet names, column names, reminder time,
   admin email, CC lists, school code → sheet name mapping, status list and colors
   all live in the `Settings` sheet and are read through `Config.gs`.
4. **Idempotent operations.** Re-running sync or reminder logic must never create
   duplicate rows or duplicate emails (dedupe by ID and by "last reminder date").
5. **Fail loud, fail logged.** Every script entry point is wrapped in try/catch;
   failures are written to the `Logs` sheet and, for critical failures, emailed to
   the Admin.
6. **Batch I/O.** All sheet reads/writes use `getValues()`/`setValues()` batches,
   never cell-by-cell loops, to stay inside Apps Script quotas and execution time
   limits.

## 3. Spreadsheet Structure (Response Spreadsheet)

| Sheet | Purpose |
|---|---|
| `Form Responses 3` | Master database. Raw, untouched form submissions + system columns (Exigency ID, Sync Status) appended by script. |
| `FSK Emails`, `FSA Emails`, `FSL Emails`, … | One per school. Authorized recipient list **and** synced record view (two logical tables, see §5). |
| `Logs` | Every sync action, reminder attempt, and error — timestamped, append-only. |
| `Dashboard` | Computed KPIs, school-wise counts, charts. Rebuilt by `Dashboard.gs`. |
| `Settings` | All configuration: reminder time, admin email, default CC, school→sheet mapping, status list, status colors, trigger settings. |

## 4. Database Design (Master Sheet Columns)

`Form Responses 3` (columns after the raw Form questions):

| Column | Type | Description |
|---|---|---|
| Timestamp | Date | Auto (Form) |
| School | String | Form question — determines routing |
| Issue | String | Form question |
| Owner | String | Form question |
| Follow-up Date | Date | Form question |
| Status | String | Form question or default `Open` |
| Next Due Date | Date | Blank until owner reschedules |
| Closed Date | Date | Blank until closed |
| **Exigency ID** *(system)* | String | `EX-<SCHOOLCODE>-<YYYYMMDD>-<seq>` generated on first sight |
| **Last Reminder Date** *(system)* | Date | Updated by Reminder.gs, used for daily dedupe |
| **Reminder Count** *(system)* | Number | Cumulative reminders sent |
| **Sync Status** *(system)* | String | `Synced` / `Pending` — used by SchoolService |

System columns are appended once, to the right of the form's own columns, so the
Form can keep adding questions without breaking column offsets (all access is by
**header name**, not index — see `Utilities.getColumnMap_`).

## 5. School Sheet Design

Each school sheet (e.g. `FSK Emails`) is split into two regions on the same tab:

- **Block A — Authorized Users** (columns `A:C`): `Email`, `Role`, `Active`
- **Block B — Synced Records** (columns starting `E`): mirrors the master sheet's
  columns plus the Exigency ID, for that school only.

Keeping both in one sheet-per-school matches the naming convention already implied
(`FSK Emails`) while still giving each school a live filtered view of its records.
Sync is one-way: master → school sheet. Edits users make to Status/Next
Due/Closed Date happen in the **school sheet**, and `onEdit` propagates the change
back to the master row located by `Exigency ID` (see `SchoolService.syncEditToMaster_`).

## 6. Apps Script File Map

| File | Responsibility |
|---|---|
| `Constants.gs` | Sheet name/column name literals, enums (nothing configurable lives here — only fixed system keys). |
| `Config.gs` | Reads/caches the `Settings` sheet into a typed config object. |
| `Utilities.gs` | Generic helpers: header/column maps, date math, batch read/write, ID generation, safe logging. |
| `Validation.gs` | Row validation, FS-group email domain enforcement, required-field checks. |
| `SchoolService.gs` | Creates/maintains school sheets, syncs new + edited rows, dedupes by Exigency ID. |
| `FormSubmit.gs` | `onFormSubmit()` — entry point wired to the Form trigger. |
| `EmailService.gs` | HTML email templating and `MailApp`/`GmailApp` send wrapper with logging. |
| `Reminder.gs` | Daily overdue scan, reminder dispatch, `closeExigency()`, `scheduleNextFollowup()`. |
| `Dashboard.gs` | Recomputes KPI/dashboard sheet and charts. |
| `Triggers.gs` | Installs/repairs all triggers (`createTriggers()`), idempotent. |
| `Main.gs` | `initializeSystem()` one-time setup entry point + shared onEdit router. |

## 7. Reminder Logic (State Machine)

```
Open ──(today >= Follow-up Date AND Next Due Date blank)──► Reminder sent daily
  │                                                              │
  │ owner sets Next Due Date                                     │
  ▼                                                              │
Snoozed ──(today >= Next Due Date)───────────────────────────────┘
  │
  │ owner sets Status = Closed (Closed Date auto-stamped)
  ▼
Closed ──(terminal, no further reminders)
```

Daily dedupe: a record is only mailed once per calendar day, enforced by comparing
`Last Reminder Date` (system column) to `today()` before send.

## 8. Trigger Setup

| Trigger | Type | Frequency | Handler |
|---|---|---|---|
| Form submit | Installable | On form submit | `FormSubmit.onFormSubmit` |
| Daily reminder | Time-driven | Every day at `Settings!ReminderTime` (default 08:00) | `Reminder.runDailyReminderJob` |
| Dashboard refresh | Time-driven | Every day, 5 min after reminder | `Dashboard.updateDashboard` |
| Sheet edit | Installable | On edit (any sheet in the spreadsheet) | `Main.onEditRouter` |

All installed idempotently by `Triggers.createTriggers()` — existing triggers for
the same handler are deleted and recreated so re-running setup is always safe.

## 9. Security

- **Form-level:** Form is configured to "Restrict to users in [organization]" plus
  a validation question/email collector; `Validation.isAuthorizedSubmitter_`
  double-checks the submitter's email domain/group server-side and flags
  unauthorized rows in `Logs` rather than silently accepting them (Forms API
  cannot reject after the fact, so this is a detective control — the preventive
  control is the Form's own collect-email + domain restriction setting, which
  must be enabled manually in the Form editor).
- **Script-level:** All spreadsheet/mail operations run under the script owner's
  identity (simple trigger limitations avoided by using **installable** triggers).
- **Access control:** School sheets are the distribution unit — share each school
  sheet (via a **separate, filtered output spreadsheet** if strict isolation is
  required — see §13 Future Enhancements) only with that school's group.
- **No secrets in code.** Admin email, CC lists, etc. are all data in `Settings`,
  never string literals in `.gs` files.
- **Least privilege:** Reminder emails link to the spreadsheet, not to raw data
  dumps in the email body beyond the documented field list.

## 10. Performance Optimization

- Single `getDataRange().getValues()` per sheet per run; all mutations batched via
  `setValues()`/`appendRow`-free `Range.setValues()` on ranges sized to the diff.
- `Config` is cached via `CacheService` (6 min) to avoid re-reading `Settings` on
  every function call within a single execution context.
- Exigency ID → row-number lookups built once per run as an in-memory `Map`.
- Reminder + Dashboard jobs share a single spreadsheet open (`SpreadsheetApp.openById`
  once, passed down) instead of repeated `getActiveSpreadsheet()` calls.
- Email sends batched and rate-checked against `MailApp.getRemainingDailyQuota()`.

## 11. Error Handling

- Every public entry point (`onFormSubmit`, `runDailyReminderJob`, `updateDashboard`,
  `onEditRouter`) is wrapped top-level in try/catch.
- Catch blocks call `Utilities_.logError_(context, error)` which writes a row to
  `Logs` and, if the error is flagged critical, emails `Settings!AdminEmail`.
- Per-row failures (e.g. one bad email address) are caught **inside** the loop so
  one bad record cannot abort the whole batch.

## 12. User Access Flow

```
FS Staff → opens Google Form → must be signed in with FS Group account
        → submits Exigency → Master sheet row created + Exigency ID assigned
        → row synced to that school's sheet automatically

School Coordinator → opens their School Sheet (shared to their group only)
        → sees only their school's records
        → updates Status / Next Due Date / Closed Date
        → onEdit syncs change back to Master sheet

Owner (assigned staff) → receives daily reminder email while overdue & open
        → clicks link → opens spreadsheet → updates record → reminders stop

Admin → owns Settings sheet, Dashboard sheet, Logs sheet
        → configures reminder time, CC lists, school mapping, status colors
```

## 13. Future Enhancements (Stage 2 hooks already reserved)

The architecture reserves these extension points so Stage 2 requires **no**
refactor of Stage 1:

- `Dashboard.gs` already isolates "compute KPIs" from "render sheet" — a
  `computeMonthlyReport_()` function can be added alongside `computeKpis_()`.
- `Constants.gs` reserves column names for `Response Time` and `Resolution Time`
  (derivable from `Timestamp`, `Follow-up Date`, `Closed Date` — no schema change
  needed).
- `EmailService.gs` template engine (`buildHtmlEmail_`) accepts an arbitrary
  section list, so a "Weekly Summary" email is a new caller, not new plumbing.
- `SchoolService.gs`'s per-school sync means school performance analytics can
  read directly from school sheets without touching the master.

## 14. Deployment Model

Single **Container-bound** Apps Script project attached to the Response
Spreadsheet (`1VvgAYFEQVyGWwFdFsldGuaAyO4MhBPhpU_oOCOZaCws`). This keeps
`SpreadsheetApp.getActiveSpreadsheet()` valid everywhere and avoids managing a
separate deployment/OAuth scope. See `README.md` for step-by-step install.
