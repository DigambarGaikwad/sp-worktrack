# SP WorkTrack – Phase 4 DB Edition

---

## Current Stable Milestone

✅ Stable checkpoint tag: `v4-db-backup-sync`

This tag confirms the DB Edition backup pipeline is working from PocketBase to Google Sheets through Node API and Google Apps Script.

```text
PocketBase DB → Node API → Google Apps Script Web App → Google Sheet backup
```

---

## DB Backup Sync Status

| Backup Sheet | Source Collection | Status | Duplicate / Update Logic |
|---|---|---|---|
| `LOG_YYYY` | `production_entry_lines` | ✅ Tested | Duplicate skip using `Source Entry No + Source Line No` |
| `ATT_YYYY` | `production_entries` | ✅ Tested | Duplicate skip using `Source Entry No` |
| `QUALITY_LOG` | `quality_logs` | ✅ Tested | Duplicate skip using `Source Entry No + Quality Point` |
| `BOOKING_LOG` | `booking_logs` | ✅ Tested | Duplicate skip using `Source Entry No + Booking Point` |
| `BOOKING_STATUS` | `booking_status` | ✅ Tested | Upsert/update using `Machine + Department + Sub Work + Booking Point` |

Confirmed test date: `2026-05-11`

Confirmed results:

```text
LOG_2026        ✅ synced and duplicate protected
ATT_2026        ✅ synced and duplicate protected
QUALITY_LOG     ✅ synced and duplicate protected
BOOKING_LOG     ✅ synced and duplicate protected
BOOKING_STATUS  ✅ inserted first time, then updated without duplicate rows
```

---

## Apps Script Deployment Notes

Apps Script code is stored in:

```text
google_apps_script/SheetBackupReceiver.gs
```

Deployment workflow:

```powershell
cd "C:\SP WorkTrack-Dev\google_apps_script"
clasp.cmd push
```

Then deploy a new version from Apps Script:

```text
Deploy → Manage deployments → Edit → New version → Deploy
```

Important: `BACKUP_SECRET` is stored in Apps Script Project Settings as a Script Property. Do not hardcode secrets in GitHub.

---

## Phase 4 DB Edition Modules

1. Machine Dashboard
2. Team Dashboard
3. Capacity Planning Page
4. Google Sheet backup/reporting sync
5. Admin-controlled validation rules

---

## Phase 4 Focus Areas

- Improve dashboard UI and machine-wise visibility
- Use PocketBase as the primary database
- Keep Google Sheets as backup/reporting mirror
- Add better production analytics
- Strengthen attendance and absence tracking
- Improve admin-controlled validation logic
- Keep stable Git tags after each major milestone

---

## Overview

SP WorkTrack is a Production Management System designed to track machine-wise work progress, booking checkpoints, quality verification, manpower attendance, and production productivity in real time.

The DB Edition uses PocketBase as the main database, with Google Sheets maintained as a backup/reporting layer.

---

## Key Features

### 1. Booking Points Control

- Booking checkpoints are tracked in `booking_status`
- Booking transactions are stored in `booking_logs`
- Completed checkpoints are tracked with consumed time, remaining time, completion percentage, and status
- Prevents duplicate standard time booking
- Supports extra booking / overbooking reason logic through admin control

---

### 2. Quality Checkpoints System

- Machine-wise quality tracking implemented
- Quality records stored in `quality_logs`
- Synced to Google Sheet `QUALITY_LOG`

Stores:

- Quality point
- Input type
- Reading/status
- Result
- Done by
- Done date / timestamp
- Source entry number

---

### 3. Duplicate Prevention

- Same production entry lines are not duplicated in `LOG_YYYY`
- Same attendance entry is not duplicated in `ATT_YYYY`
- Same quality point is not duplicated in `QUALITY_LOG`
- Same booking point transaction is not duplicated in `BOOKING_LOG`
- `BOOKING_STATUS` updates existing rows instead of creating duplicate rows

---

### 4. Work Validation

- Standard vs actual time validation
- Efficiency reason capture for high overrun
- Booking extra reason can be controlled from admin settings
- Rework and Other Work are treated separately from standard booking logic

---

### 5. Work Type Logic

- Normal work uses booking points and standard time logic
- Rework captures root area and actual time
- Other Work captures actual time without standard booking consumption
- Quality checkpoints can be logged where configured

---

### 6. Dashboard Ready Data

Current DB and backup sheets support:

- Machine-wise work progress
- Department-wise standard vs actual
- Booking point completion
- Quality checklist visibility
- Attendance and productivity summary
- Rework and other work analysis

---

## Google Sheet Backup Structure

- `LOG_YYYY` → Work entry line-level backup
- `ATT_YYYY` → Attendance / entry header summary
- `QUALITY_LOG` → Quality checkpoint log
- `BOOKING_LOG` → Booking transaction history
- `BOOKING_STATUS` → Current booking point status
- `SYNC_STATUS` → Future sync status tracking

---

## Stability

✔ Google Sheet backup tested  
✔ Duplicate entries controlled  
✔ Booking status upsert working  
✔ Secret removed from code and stored in Script Properties  
✔ `clasp` workflow working  
✔ Stable Git tag created: `v4-db-backup-sync`  

---

## Status

✅ Phase 4 DB Backup Sync Milestone Complete
