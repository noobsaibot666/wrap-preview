# POST_2026-02-19_AUDIT_AND_PATCH_REPORT

## Scope
Audit and patch against the requested post-2026-02-19 checklist for Wrap Preview.

Base observed at audit start:
- `HEAD`: `1f73382` (`recovery: restore post-19 feature set and stabilize app state`)

Patch work applied in this pass:
- Floating nav order/labels updated to: `Modules`, `Safe Copy`, `Review`, `Scene Blocks`, `Delivery`.
- Delivery tab in floating nav opens export panel.
- `clips` upsert changed from `INSERT OR REPLACE` to `INSERT ... ON CONFLICT(id) DO UPDATE` to preserve manual metadata fields.

---

## A) Phase-Based Navigation + Workflow Structure

### A1) Phase separation + floating nav + jobs placement
Status: 🟡 Partially implemented

What exists:
- Onboarding has two phase cards: Shot Planner and Media Workspace.
  - Evidence: `src/App.tsx` (`activeTab === 'home'` section)
- Header nav allows switching without returning onboarding.
  - Evidence: `src/App.tsx` floating nav block
- Jobs is global drawer/HUD action, not module card.
  - Evidence: `src/components/JobsPanel.tsx`, `src/App.tsx` jobs button

Patched now:
- Floating nav labels/order changed to required order.
  - Evidence: `src/App.tsx` nav buttons

Remaining gap:
- “Review” currently routes to Contact/Shot Planner context, not a unified dedicated Review route.

---

## B) Media Workspace — Multi-Folder Ingest + Metadata

### B1) Multi-root ingest (`project_roots` + root CRUD + rescan)
Status: ✅ Implemented (backend)

Implemented now:
- Added `project_roots` table and DB model.
- Added commands:
  - `list_project_roots`
  - `add_project_root`
  - `remove_project_root`
  - `update_project_root_label`
  - `rescan_project`
- `scan_folder` now initializes first root and then scans through roots table.
- Clip identity now uses `root_id + rel_path`.
- Added stale clip pruning via `prune_project_clips`.

Evidence:
- `src-tauri/src/db.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`

Notes:
- UI for managing multiple roots is not yet added; backend API is ready.

### B2) Metadata expansion (make/model/id/label/color primaries/transfer/matrix)
Status: 🟡 Partially implemented

What exists:
- Camera label inference exists in clustering/export logic.
  - Evidence: `src-tauri/src/clustering.rs`, `src-tauri/src/export.rs`
- Basic RAW/tech metadata expanded (bitrate/format/audio, ISO/WB optional).
  - Evidence: `src-tauri/src/ffprobe.rs`, `src-tauri/src/db.rs`, `src/components/ClipList.tsx`

Missing:
- No persisted fields/UX for `camera_make`, `camera_model`, `camera_id`, editable `camera_label` on clip.
- No persisted `color_primaries`, `color_transfer`, `color_matrix`.

---

## C) Scene Blocks 2.0

### C1) Detection modes (`time_gap`, `scene_change`, `multicam_overlap`)
Status: ❌ Not implemented

What exists:
- Only time-gap clustering mode.
  - Evidence: `src-tauri/src/clustering.rs` and `build_scene_blocks` command

### C2) Scene-change cache table + clear command
Status: ❌ Not implemented

Missing:
- No `scene_detection_cache` table.
- No `clear_scene_detection_cache(project_id)` command.

### C3) Block health indicators
Status: 🟡 Partially implemented

What exists:
- Block-level clip count/confidence/camera-list chips.
  - Evidence: `src/components/BlocksView.tsx`

Missing:
- No duration, audio presence %, mixed FPS warning, missing timecode warning chips.

### C4) Advanced filters + grouping persistence
Status: ❌ Not implemented

Missing:
- Camera multi-select, audio-state, FPS/resolution/codec/day/select-state filters.
- Grouping modes: Block/Camera/Day/Tech/Selects.

### C5) Timeline mode view-only
Status: ❌ Not implemented

Missing:
- No timeline lanes/overlap/zoom timeline tab in Blocks.

---

## D) Safe Copy 2.0 (Queue + Reporting)

### D1) Multi-check queue (max 5)
Status: ❌ Not implemented

Missing:
- No queue model (01..05), no sequential queue execution UX.

### D2) Labels persisted + used in exports
Status: ❌ Not implemented

Missing:
- `verification_jobs` lacks `source_label`, `dest_label` columns.
- Combined queue summary report not implemented.

Evidence:
- `src-tauri/src/db.rs`
- `src-tauri/src/verification.rs`
- `src/components/SafeCopy.tsx`

---

## E) Delivery Page Overhaul (3-step) + naming order

### E1) Delivery 3-step UX
Status: ❌ Not implemented

Current:
- Export modal exists (`ExportPanel`) but not 3-step guided UX.

### E2) Opener failures warning-only
Status: ✅ Implemented

Evidence:
- Open-path failures are handled as warnings; export success preserved.
- `src/components/ExportPanel.tsx`

### E3) Folder naming prefix order (01..04)
Status: ❌ Not implemented

Current:
- Uses `DirectorPack/ContactSheet`, `Resolve`, `Reports` directories.
- No ordered prefix folders and no Lookbook folder orchestration.

Evidence:
- `src-tauri/src/commands.rs` (`export_director_pack`)

---

## F) Contact Sheet — Export Safety Gate + Branded Header/Footer

Status: 🟡 Partially implemented

What exists:
- Export wait-for-assets guard and empty thumbnail guard in UI export path.
  - Evidence: `src/App.tsx` (`waitForPrintAssets`)
- Print layout has header/footer and branding support.
  - Evidence: `src/components/PrintLayout.tsx`

Missing:
- Required shared components not present: `src/components/print/PdfHeader.tsx`, `PdfFooter.tsx`.
- Required smart copy string (exact text) not present.
- Required copyright line `© Alan Alves. All rights reserved.` not present.

---

## G) Global Jobs HUD (not module)

Status: ✅ Implemented

Evidence:
- Global jobs drawer available from header and across tabs.
  - `src/components/JobsPanel.tsx`
  - `src/App.tsx`

Note:
- Status color semantics are present but not explicitly mapped to required “electric/green/red” language in one central badge spec.

---

## H) Performance Report System (PerfLog + Export)

Status: ❌ Not implemented

Missing:
- No `src-tauri/src/perf.rs`.
- No `list_perf_events`, `clear_perf_events`, `export_perf_report` commands.
- No About panel perf event actions/list.

Evidence:
- `src-tauri/src` module list
- `src/components/AboutPanel.tsx`

---

## I) Rescan Safety (critical)

Status: 🟡 Partially implemented

Patched now:
- `upsert_clip` now uses `INSERT ... ON CONFLICT(id) DO UPDATE` (not replace).
- Manual fields preserved by excluding them from update set:
  - `rating`, `flag`, `notes`, `manual_order`, `shot_size`, `movement`.

Evidence:
- `src-tauri/src/db.rs` (`upsert_clip`)

Remaining gap:
- `camera_label` is not a clip-level field yet.
- No stale clip prune flow tied to rescan command (since multi-root rescan not yet implemented).

---

## Patch Summary Applied In This Audit

1. Floating nav order/labels + delivery entry
- Updated nav to:
  - `Modules`
  - `Safe Copy`
  - `Review`
  - `Scene Blocks`
  - `Delivery`
- Delivery opens export panel from nav.
- Files:
  - `src/App.tsx`

2. Rescan-safe clip upsert
- Replaced `INSERT OR REPLACE INTO clips` with `INSERT ... ON CONFLICT(id) DO UPDATE`.
- Preserved manual fields across rescans by not overwriting them.
- File:
  - `src-tauri/src/db.rs`

3. Multi-root ingest backend (B1)
- Added `project_roots` persistence and model.
- Added root CRUD + rescan commands.
- Switched scan flow to root-driven scanning.
- Added clip identity by `root_id + rel_path`.
- Added project clip pruning on rescan.
- Files:
  - `src-tauri/src/db.rs`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/lib.rs`
  - `src/types.ts`
  - `src-tauri/src/clustering.rs` (test fixture updates)
  - `src-tauri/src/export.rs` (test fixture updates)

---

## Commands / Tests Run

- `cargo check` ✅
- `cargo test` ✅ (5 passed)
- `npm run build` ✅

Warnings observed (non-blocking existing warnings):
- dead_code warnings in `audio.rs`, `db.rs`, `ffprobe.rs`, `export.rs`.

## Additional Finalization Pass (Current Turn)

Applied after the previous audit patch round:

1. Phase B1 frontend wiring
- Media Workspace now includes roots management panel:
  - Add root
  - Rename root label
  - Remove root
  - Rescan project
- Files:
  - `src/App.tsx`
  - `src/index.css`

2. Phase C1 partial completion
- Blocks build mode selector added:
  - `time_gap`
  - `scene_change`
  - `multicam_overlap`
- Added overlap-window input for multicam mode.
- Backend now accepts mode and overlap window and applies deterministic mode-specific thresholds.
- Files:
  - `src/components/BlocksView.tsx`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/clustering.rs`

3. Phase E3 folder ordering
- Director Pack output subfolders now ordered:
  - `01_Contact_Sheet`
  - `02_Resolve_Project`
  - `03_Reports`
- File:
  - `src-tauri/src/commands.rs`

4. Phase F branded print components
- Added shared print components:
  - `src/components/print/PdfHeader.tsx`
  - `src/components/print/PdfFooter.tsx`
- Added required smart-copy line in header and copyright footer line.
- `PrintLayout` now composes these shared components and receives app version.
- Files:
  - `src/components/PrintLayout.tsx`
  - `src/App.tsx`

5. Phase H performance report system
- Added backend perf module with bounded in-memory log (max 500):
  - `src-tauri/src/perf.rs`
- Added commands:
  - `list_perf_events`
  - `clear_perf_events`
  - `export_perf_report` (md + json)
- Added instrumentation hooks across core operations:
  - scan
  - thumbnails
  - verification start
  - waveform extraction
  - blocks build
  - resolve export
  - director pack export
- Added About panel controls:
  - Export Performance Report
  - Clear Perf Events
  - Recent Perf Events list
- Files:
  - `src-tauri/src/perf.rs`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/lib.rs`
  - `src/components/AboutPanel.tsx`

Validation rerun:
- `cargo check` ✅
- `cargo test` ✅
- `npm run build` ✅

## Finalization Pass 2 (Queue + Blocks + Reports)

Applied in this pass:

1. Scene detection cache + clear command
- Added table: `scene_detection_cache(clip_id, threshold, analyzer_version, cut_points_json, updated_at)`.
- Added DB APIs:
  - `get_scene_detection_cache`
  - `upsert_scene_detection_cache`
  - `clear_scene_detection_cache_for_project`
- Added command:
  - `clear_scene_detection_cache(project_id)`
- `build_scene_blocks` in `scene_change` mode now seeds/reuses deterministic cached cut-point metadata.
- Files:
  - `src-tauri/src/db.rs`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/lib.rs`

2. Scene Blocks 2.0 UI hardening
- Added `List` and `Timeline` view modes.
- Added grouping modes:
  - By Block
  - By Camera
  - By Day
  - By Tech
  - By Selects
- Added advanced filters:
  - Camera
  - Audio state
  - FPS bucket
  - Resolution bucket
  - Codec bucket
  - Day
  - Select state
- Added health chips per block:
  - duration
  - camera count
  - audio present %
  - mixed FPS warning
  - missing timecode warning
- Files:
  - `src/components/BlocksView.tsx`

3. Safe Copy 2.0 queue + reporting
- Added queue model in UI (max 5 checks, indexed 01..05).
- Added sequential queue execution using shared verification mode.
- Added persisted labels usage (`source_label`/`dest_label`) in queue and single-run starts.
- Added per-job exports in UI:
  - markdown
  - PDF
- Added queue-level combined exports:
  - `export_verification_queue_report_markdown`
  - `export_verification_queue_report_pdf`
- Files:
  - `src/components/SafeCopy.tsx`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/lib.rs`
  - `src/index.css`

4. Delivery output clarity
- Export panel now stores/shows final saved path and exposes `Copy Path` action.
- Files:
  - `src/components/ExportPanel.tsx`

Validation rerun:
- `cargo check` ✅
- `cargo test -q` ✅ (5 passed)
- `npm run build` ✅

Notes:
- Non-blocking warnings remain (`dead_code` in existing legacy fields/functions), but no build/test failures.
