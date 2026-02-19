# WRAP_PREVIEW_FEATURE_STATUS

## 1. Executive Summary
Wrap Preview is currently beyond a simple contact-sheet prototype, but not yet a complete modular on-set media control system.

Current state in code:
- Strong base is present: Tauri + Rust + React/TS + SQLite + ffmpeg/ffprobe, recursive scan, metadata extraction, thumbnail pipeline, contact-sheet print/export flow, and Safe Copy verification workflow.
- Ratings/flags and waveform summaries exist and persist.
- Scene block clustering is implemented with persistence and editing operations (build/get/rename/merge/split).
- Resolve export exists via FCPXML with scopes and rating/flag markers, but advanced bin/timeline structure is not implemented.
- Director Pack combined export is not implemented.

## 2. Architecture Overview
### App Structure
- Shell/runtime: Tauri v2 app with command invoke bridge.
- Backend: Rust modules under `src-tauri/src/`.
- Frontend: React + TypeScript under `src/`.

### Backend Modules
- Core command surface: `src-tauri/src/commands.rs`
- DB/cache layer: `src-tauri/src/db.rs`
- Scan: `src-tauri/src/scanner.rs`
- Metadata probing: `src-tauri/src/ffprobe.rs`
- Thumbnail generation: `src-tauri/src/thumbnail.rs`
- Audio envelope extraction: `src-tauri/src/audio.rs`
- Verification pipeline: `src-tauri/src/verification.rs`
- Scene clustering: `src-tauri/src/clustering.rs`
- Resolve export generator: `src-tauri/src/export.rs`
- Job manager scaffold: `src-tauri/src/jobs.rs`

### Frontend Modules
- Main app orchestration + onboarding: `src/App.tsx`
- Contact-sheet clip list + metadata controls: `src/components/ClipList.tsx`
- Film strip UI: `src/components/FilmStrip.tsx`
- Waveform sparkline: `src/components/Waveform.tsx`
- Print/PDF layout view: `src/components/PrintLayout.tsx`
- Safe Copy UI: `src/components/SafeCopy.tsx`
- Blocks view: `src/components/BlocksView.tsx`
- Resolve export panel: `src/components/ExportPanel.tsx`

### Job System
- Verification uses background execution (`tokio::spawn`) and parallel file processing via Rayon thread pool (4 threads).
- Thumbnail extraction uses Tokio semaphore bounded concurrency (`Semaphore::new(3)`).
- Generic cancellable job manager exists as scaffold but is not actively used by major pipelines.

### Media Processing Pipeline
1. Recursive file scan (`scanner`).
2. Per-file ffprobe metadata extraction.
3. Thumbnail extraction with black-frame rejection + fallback offsets.
4. Optional waveform extraction per clip via ffmpeg PCM envelope.
5. Optional scene block clustering by timestamp gaps + camera label inference.
6. Export paths: print/PDF flow, Safe Copy JSON report, Resolve FCPXML.

## 3. Feature Status Matrix
| Area | Feature | Status | Evidence / Notes |
|---|---|---|---|
| CORE FOUNDATION | Tauri macOS shell | ✅ Implemented | Tauri builder and plugins in `src-tauri/src/lib.rs`. |
| CORE FOUNDATION | Rust backend engine | ✅ Implemented | Command + module architecture in `src-tauri/src/`. |
| CORE FOUNDATION | React + TypeScript frontend | ✅ Implemented | Main app and components in `src/`. |
| CORE FOUNDATION | SQLite local cache | ✅ Implemented | Rusqlite database layer in `src-tauri/src/db.rs`. |
| CORE FOUNDATION | FFmpeg + ffprobe integration (arm64) | ✅ Implemented | ffprobe metadata and ffmpeg thumbnail/audio extraction in `ffprobe.rs`, `thumbnail.rs`, `audio.rs`. |
| CORE FOUNDATION | Background job runner (cancellable) | 🟡 Partially Implemented | Verification and thumbnail jobs are background/non-blocking, but shared cancellable runner in `jobs.rs` is scaffold and not integrated. |
| CORE FOUNDATION | Bounded concurrency (2–4 workers) | ✅ Implemented | Thumbnail semaphore 3; verification Rayon pool 4. |
| CORE FOUNDATION | Progressive UI updates | ✅ Implemented | Thumbnail and verification progress events emitted and consumed in UI. |
| CORE FOUNDATION | Stable Clip UID system | ⚠ Modified / Different Approach | UID is hash(relative_path + size + mtime) in `generate_clip_id`, but `source_root_id` persistence is not implemented as separate field. |
| MODULE 1 | Folder scan (recursive) | ✅ Implemented | `WalkDir` recursive scan in `scanner.rs`. |
| MODULE 1 | Essential metadata extraction | ✅ Implemented | ffprobe parses codec/resolution/fps/audio/timecode/creation time. |
| MODULE 1 | Smart sampling: skip first ~0.5s | ✅ Implemented | `SKIP_SECONDS = 0.5` in `thumbnail.rs`. |
| MODULE 1 | Smart sampling: 10%,35%,60%,85%,95% | ⚠ Modified / Different Approach | Uses evenly distributed positions in [0.1..0.9] over usable segment; not fixed exact 10/35/60/85/95 set. |
| MODULE 1 | Black frame rejection (basic threshold) | ✅ Implemented | `is_black_frame` with YAVG threshold in `thumbnail.rs`. |
| MODULE 1 | Thumbnail extraction (max 640px width) | ✅ Implemented | ffmpeg scale uses `MAX_WIDTH=640`. |
| MODULE 1 | Film-strip preview UI | ✅ Implemented | `FilmStrip` component. |
| MODULE 1 | A4 Landscape PDF export | ⚠ Modified / Different Approach | Print layout is A4 landscape CSS and exported via `window.print()` path, not a dedicated backend PDF generator. |
| MODULE 1 | Branding integration (logo + profile.json tokens) | 🟡 Partially Implemented | Logo/profile load/save commands exist; dynamic brand color + logo in print layout. Tokenized profile application is limited. |
| MODULE 1 | Export works with failed clips (placeholders) | ✅ Implemented | Placeholder frames shown for failed clips in print layout. |
| MODULE 1 | Filtering by rating/flag | ❌ Not Implemented | No contact-sheet filter controls by rating/flag in current UI state. |
| MODULE 2 | Source + Destination selection | ✅ Implemented | Safe Copy folder pickers. |
| MODULE 2 | File pairing by relative path | ✅ Implemented | Pairing uses relative path map in verification pipeline. |
| MODULE 2 | Missing file detection | ✅ Implemented | `MISSING` status. |
| MODULE 2 | Size mismatch detection | ✅ Implemented | `SIZE_MISMATCH` status. |
| MODULE 2 | Full-file hash verification (BLAKE3 or SHA-256) | ✅ Implemented | BLAKE3 hashing in SOLID mode. |
| MODULE 2 | Extra file detection | ✅ Implemented | Remaining destination map -> `EXTRA_IN_DEST`. |
| MODULE 2 | Unreadable file handling | ✅ Implemented | `UNREADABLE_SOURCE` / `UNREADABLE_DEST`. |
| MODULE 2 | Verification progress tracking | ✅ Implemented | Event emission and UI progress bar/status. |
| MODULE 2 | JSON verification export | ✅ Implemented | `export_verification_report_json` command + UI action. |
| MODULE 2 | PDF verification summary export | ⚠ Modified / Different Approach | UI triggers `window.print()` report; no dedicated structured PDF generator command. |
| MODULE 2 | Per-file status classification | ✅ Implemented | Multiple explicit status codes in DB/UI. |
| MODULE 3 | 0–5 star rating per clip | ✅ Implemented | Clip cards and DB column `rating`. |
| MODULE 3 | Pick / Reject flags | ✅ Implemented | Clip cards and DB column `flag`. |
| MODULE 3 | Keyboard shortcuts 1–5 | ✅ Implemented | Key handlers in `App.tsx`. |
| MODULE 3 | Keyboard shortcut 0 clear | ✅ Implemented | `0` sets rating to 0. |
| MODULE 3 | Keyboard shortcut P pick | ✅ Implemented | `p` key updates flag. |
| MODULE 3 | Keyboard shortcut X reject | ✅ Implemented | `x` key updates flag. |
| MODULE 3 | Persist ratings in SQLite | ✅ Implemented | `update_clip_metadata` persists. |
| MODULE 3 | Filtering clips by rating / flag | ❌ Not Implemented | Sorting exists; filtering controls by rating/flag are not present. |
| MODULE 3 | Ratings integrated into export system | ✅ Implemented | Resolve export scopes and markers use rating/flag. |
| MODULE 4 | Audio presence detection | ✅ Implemented | ffprobe audio stream summary + no-audio branch. |
| MODULE 4 | Low-resolution waveform envelope generation | ✅ Implemented | ffmpeg PCM decode + envelope extraction (`audio.rs`). |
| MODULE 4 | Envelope stored in database | ✅ Implemented | `audio_envelope` BLOB in clips table. |
| MODULE 4 | Sparkline waveform rendering in UI | ✅ Implemented | `Waveform` component and clip rendering. |
| MODULE 4 | Audio health detection: No audio | ✅ Implemented | Badge logic in `ClipList.tsx`. |
| MODULE 4 | Audio health detection: Possible clipping | ✅ Implemented | Peak threshold badge in `ClipList.tsx`. |
| MODULE 4 | Audio health detection: Mostly silent | ✅ Implemented | Silence ratio badge in `ClipList.tsx`. |
| MODULE 4 | Background generation | 🟡 Partially Implemented | Generation triggered asynchronously from UI, but executed sequentially per clip in current loop (not explicitly worker-pooled for waveform jobs). |
| MODULE 4 | Cached results | ✅ Implemented | Uses DB-cached envelope and skips existing values. |
| MODULE 5 | Timestamp-based sorting | ✅ Implemented | Clips sorted by parsed timestamp in clustering. |
| MODULE 5 | Time-gap block creation | ✅ Implemented | Gap-threshold clustering implemented. |
| MODULE 5 | Camera grouping via filename regex | 🟡 Partially Implemented | Camera label inference exists (token-based patterns), but not configurable regex rules UI/config. |
| MODULE 5 | Persist block entities in DB | ✅ Implemented | `blocks` + `block_clips` with CRUD methods. |
| MODULE 5 | Blocks UI view | ✅ Implemented | `BlocksView` component. |
| MODULE 5 | Merge blocks | ✅ Implemented | `merge_scene_blocks` command + UI action. |
| MODULE 5 | Split blocks | ✅ Implemented | `split_scene_block` command + UI action. |
| MODULE 5 | Rename blocks | ✅ Implemented | `rename_scene_block` command + UI prompt action. |
| MODULE 5 | Block confidence scoring | ✅ Implemented | Confidence values computed and persisted. |
| MODULE 6 | Resolve-compatible export (FCPXML or EDL) | ✅ Implemented | FCPXML export implemented. EDL not implemented. |
| MODULE 6 | Bin structure: Blocks/Cameras/Picks/Ratings | ❌ Not Implemented | Current FCPXML emits assets/sequence/keywords/markers only; no explicit bin hierarchy construction. |
| MODULE 6 | Marker mapping: Picks green / Reject red / Ratings labeled | 🟡 Partially Implemented | Labeled markers (`PICK`, `REJECT`, `★N`) are emitted. Color mapping is not explicitly encoded. |
| MODULE 6 | Timeline creation: Stringout per block | ❌ Not Implemented | Single sequence stringout is generated from selected clip set; not one timeline per block. |
| MODULE 6 | Export scope: All clips | ✅ Implemented | `scope=all`. |
| MODULE 6 | Export scope: Picks only | ✅ Implemented | `scope=picks`. |
| MODULE 6 | Export scope: Rating >= N | ✅ Implemented | `scope=rated_min` + `min_rating`. |
| MODULE 6 | Export scope: Selected blocks | ✅ Implemented | `scope=selected_blocks` + block IDs. |
| MODULE 6 | Director’s selection preserved in Resolve | 🟡 Partially Implemented | Ratings/flags/notes are embedded as keywords/markers; advanced bin/timeline organization not present. |
| MODULE 7 | Combined export: PDF Contact Sheet + Resolve XML/FCPXML/EDL + JSON summary | ❌ Not Implemented | No single “Director Pack” combined command/workflow. |
| MODULE 7 | Export respects filters and selections | ❌ Not Implemented | No unified pack export pipeline. |
| MODULE 7 | Export pack folder structure | ❌ Not Implemented | No pack folder generation logic. |

## 4. Database Schema Summary
### `projects`
- `id` (PK)
- `root_path`
- `name`
- `created_at`

### `clips`
- Identity / media: `id` (PK), `project_id`, `filename`, `file_path`, `size_bytes`, `created_at`, `duration_ms`, `fps`, `width`, `height`, `video_codec`, `audio_summary`, `timecode`, `status`
- Rating/selection: `rating`, `flag`, `notes`
- Waveform: `audio_envelope` (BLOB)

### `thumbnails`
- `clip_id`, `idx` (composite PK)
- `timestamp_ms`
- `file_path`

### `blocks`
- `id` (PK), `project_id`, `name`
- `start_time`, `end_time`
- `clip_count`, `camera_list`, `confidence`

### `block_clips`
- `block_id`, `clip_id` (composite PK)
- `camera_label`, `sort_index`

### `verification_jobs`
- Job metadata + aggregate counters:
- `id` (PK), `created_at`, `source_root`, `dest_root`, `mode`, `status`
- `total_files`, `total_bytes`
- `verified_ok_count`, `missing_count`, `size_mismatch_count`, `hash_mismatch_count`, `unreadable_count`, `extra_in_dest_count`

### `verification_items`
- `job_id`, `rel_path` (composite PK)
- `source_size`, `dest_size`
- `source_mtime`, `dest_mtime`
- `source_hash`, `dest_hash`
- `status`, `error_message`

### `file_hash_cache`
- `abs_path` (PK)
- `size`, `mtime`, `algo`, `hash`, `computed_at`

### Exports Table Presence
- No dedicated export-set/export-history table currently exists.

## 5. Background Job System Summary
### Concurrency Model
- Thumbnails: async loop with semaphore-limited concurrency (`3`).
- Verification: background `tokio::spawn`, heavy work on Rayon pool with `4` threads.
- Waveform extraction: invoked asynchronously but currently processed per clip in a sequential frontend loop.

### Cancellation
- Generic cancellation scaffolding exists in `jobs.rs` (`oneshot` channels + manager map), but active production pipelines do not expose cancellation controls.

### Progress Emission
- Thumbnails: `thumbnail-progress`, `thumbnail-complete` events.
- Verification: `verification-progress` events for indexing/hashing/done phases.
- No unified progress channel abstraction across all modules.

### Error Handling
- Command-level `Result<_, String>` with mapped errors.
- Verification loop handles unreadable files as classified statuses.
- Some internal DB operations in verification use `unwrap()` and can panic on DB write errors.

## 6. Export Capabilities
### PDF Export (Contact Sheet)
- Implemented via print layout (`PrintLayout`) and browser/Tauri print flow (`window.print()`).
- Supports thumbnails, metadata rows, failed clip placeholders, and basic branding visuals.
- Not a dedicated backend-rendered PDF file pipeline.

### Verification Export
- JSON report export implemented (`export_verification_report_json`).
- Report/print action exists in UI via `window.print()`.

### Resolve Export
- Implemented as FCPXML output.
- Supports scopes: all, picks, rated, rated_min, selected_blocks.
- Includes keywords and markers for picks/rejects/ratings/notes.
- Does not implement full bin hierarchy or per-block timeline generation.

### Combined Export
- Director Pack combined export (PDF + Resolve + JSON in one operation) is not implemented.

## 7. Known Gaps / Missing Features
1. No full integrated cancellable job framework across modules; cancellation exists as scaffold only.
2. No explicit `source_root_id` field/persistence in clip identity model.
3. Contact-sheet filtering by rating/flag is missing.
4. Waveform generation is backgrounded but not worker-pooled with bounded concurrency.
5. Camera grouping uses simple token inference, not configurable regex rules.
6. Resolve export lacks explicit bin structures (Blocks/Cameras/Picks/Ratings) and per-block timeline generation.
7. Marker color mapping is not explicitly represented.
8. No export-set data model/table.
9. Director Pack combined export is entirely missing.
10. Verification/report PDF path is print-based, not dedicated document export logic.
11. Verification pipeline contains `unwrap()` calls in DB writes (stability risk under DB failure scenarios).

## 8. Recommended Next Steps
1. Implement a unified `JobManager` integration for thumbnails, waveform, clustering, and verification with explicit cancel commands and job state table.
2. Add `source_root_id` to clip identity model and migration path; use it consistently in UID/path resolution.
3. Add UI filters for rating/flag in Contact Sheet and apply same filters to export selection.
4. Move waveform extraction to bounded worker concurrency (2–4 tasks) with progress events.
5. Expand clustering camera logic to configurable regex rules (persisted config).
6. Upgrade FCPXML export to include structured bin/timeline strategy per block and camera grouping.
7. Implement a dedicated Director Pack exporter producing: contact-sheet PDF, FCPXML, JSON summary, deterministic folder layout.
8. Replace `unwrap()` in verification persistence with error-propagating/recording behavior to avoid background panic failure modes.
