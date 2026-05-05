# SP WorkTrack – Phase 4 Development

---

## Phase 4 Status

🚧 Phase 4 development started on separate branch: `phase-4`
### Phase 4 Modules

1. Machine Dashboard
2. Team Dashboard
3. Capacity Planning Page

### Phase 4 Focus Areas

- Improve dashboard UI and machine-wise visibility
- Add better production analytics
- Strengthen attendance and absence tracking
- Improve Google Sheets backend stability
- Keep Phase 3 stable as production-ready backup

---

## Overview
SP WorkTrack is a Production Management System designed to track machine-wise work progress, booking checkpoints, and quality verification in real time.

This Phase 3 version introduces smart controls to prevent duplicate entries, enforce process discipline, and improve data visibility for dashboards.

---

## Key Features

### 1. Booking Points Control
- Booking checkpoints are tracked in BOOKING_STATUS
- Completed checkpoints:
  - Automatically disabled (greyed out in UI)
  - Cannot be selected again
- Prevents duplicate standard time booking

---

### 2. Quality Checkpoints System
- Machine-wise quality tracking implemented
- QUALITY_LOG behaves like PLANNED_WORK

#### Behavior:
- Before check → Status = PENDING
- After check → Status = DONE
- Stores:
  - Result (OK / NOT OK / Reading)
  - Done By
  - Done Date

#### Smart Logic:
- If already checked:
  - Shows previous result
  - Recheck checkbox available
- If recheck selected:
  - Old entry is UPDATED (no duplicate row)

---

### 3. Duplicate Prevention
- Same booking point cannot be used again
- Same quality point updates instead of duplicating
- Clean and reliable data structure

---

### 4. Work Validation
- Standard vs Actual time validation
- If Actual > 120% of Standard:
  → Efficiency reason is mandatory

---

### 5. Work Type Logic
- Booking Points:
  → Only for Normal work
- Rework / Other:
  → No standard booking
  → Optional quality recheck

---

### 6. Dashboard Ready Data
- MACHINE_SUMMARY
- PLANNED_WORK
- DASHBOARD_FEED
- QUALITY_LOG

All structured for future analytics/dashboard integration.

---

### 7. Date Handling
- Unified format support
- Compatible with dashboard and reports

---

## Sheets Structure

- LOG_YYYY → Work entries
- ATT_YYYY → Attendance tracking
- BOOKING_LOG → Booking history
- BOOKING_STATUS → Completed checkpoints
- QUALITY_LOG → Quality tracking (Pending/DONE)
- QUALITY_MACHINE_STATUS → Machine-level quality summary
- STANDARD_TIME → Master data
- MACHINE_LIST → Machine master
- PLANNED_WORK → Planned vs actual tracking
- DASHBOARD_FEED → Dashboard-ready data

---

## Stability

✔ No duplicate entries  
✔ Controlled workflow  
✔ Clean data for reporting  
✔ Operator-friendly UI  


## Status

✅ Phase 3 Final – Production Ready  
