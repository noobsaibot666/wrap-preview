# Wrap Preview Certification Report

## What Was Found
- The app already had a real two-domain shell in `src/App.tsx`, a persistent SQLite-backed clip metadata model in `src-tauri/src/db.rs`, a Safe Copy queue backend in `src-tauri/src/commands.rs`, a review/contact-sheet surface in `src/components/ClipList.tsx`, a Scene Blocks surface in `src/components/BlocksView.tsx`, a Delivery modal in `src/components/ExportPanel.tsx`, and global jobs plumbing in `src/components/JobsPanel.tsx`.
- State persistence across rescans was already largely preserved by `build_clip_from_file()` and `upsert_clip()` in `src-tauri/src/commands.rs` and `src-tauri/src/db.rs`.
- Extra features found and preserved:
  - `Folder Creator` pre-production tool in `src/components/FolderCreator.tsx`
  - LUT infrastructure and LUT thumbnail generation in `src-tauri/src/commands.rs`
  - BRAW bridge diagnostics in `get_app_info()` in `src-tauri/src/commands.rs`
  - Tour/onboarding guidance in `src/components/TourGuide.tsx`
  - Feedback bundle export in `src/App.tsx`

## Fixes Applied Summary
- Tightened domain separation in `src/App.tsx`:
  - Home chooser remains the `Modules` destination.
  - Domain tabs are hidden on the home chooser and only show `Modules` plus the current domain.
  - Media Workspace launcher now uses a coherent 2x2 grid with `Safe Copy`, `Open Workspace / Review`, `Scene Blocks`, and `Delivery`.
  - Dependent Media Workspace cards now stay disabled until a workspace is loaded.
- Improved Shot Planner behavior in `src/App.tsx`:
  - Added a proper empty state with `Load References`.
  - Renamed the pre-production launcher card from `Shot Index` to `Shot Planner`.
  - Added `0` rating shortcut support and limited keyboard shortcuts to actual review surfaces.
- Improved Scene Blocks handoff in `src/components/BlocksView.tsx`:
  - Added clear next-step CTA buttons for `Back to Review` and `Send to Delivery`.
- Improved Safe Copy coherence in `src/components/SafeCopy.tsx`:
  - Added editable per-check labels.
  - Added queue summary rows showing each check and result state.
- Improved Delivery guidance in `src/components/ExportPanel.tsx`:
  - Added explicit step-missing hints.
  - Renamed preset CTA to `Most common preset`.
  - Added disabled-state titles for final export CTAs.
- Improved export/report branding and naming:
  - `src/utils/ExportUtils.ts` now injects app version and the required branded copy line into PDF/image contact-sheet exports and uses `© Alan Alves. All rights reserved.` in the footer.
  - `src-tauri/src/commands.rs` now uses collision-safe filenames for Safe Copy markdown/PDF exports and normalizes branded copy/footer wording.
- Improved global Jobs HUD styling in `src/App.tsx` and `src/index.css`:
  - Added running/success/error visual states.
  - Kept the electric-blue loading bar and made the running state more explicit.

## Certification Matrix

### A) Modules / Home
- `[PASS]` `Modules` returns to the chooser.
  - Evidence: `src/App.tsx`, home-nav handlers around the header `Modules` button and app logo click.
- `[PASS]` Home chooser stays separate from sub-app surfaces.
  - Evidence: `src/App.tsx`, conditional rendering for `activeTab === 'home'`.
- `[PASS]` Post-production launcher items are not shown inside the pre-production workspace.
  - Evidence: `src/App.tsx`, domain-specific nav and separate pre/post render branches.

### B) Pre-Production Workspace / Shot Planner
- `[PASS]` Opening Shot Planner from the launcher opens the folder picker when no pre-production project exists.
  - Evidence: `src/App.tsx`, pre-production launcher card click handler uses `handleSelectFolder('shot-planner')`.
- `[PASS]` Shot Planner now has a clear `Load References` CTA when empty.
  - Evidence: `src/App.tsx`, `workspace-empty-state` branch for `activePreproductionApp === 'shot-planner'`.
- `[PASS]` Reject clips are excluded from selection and export.
  - Evidence: `toggleClipSelection()`, `handleUpdateMetadata()`, `getExportClips()` in `src/App.tsx`.
- `[PASS]` Export uses only selected clips.
  - Evidence: `getExportClips()` in `src/App.tsx`.
- `[PASS]` Keyboard shortcuts implemented: Arrow focus, `S`, `R`, `0-5`, `P`, `I`.
  - Evidence: keydown handler in `src/App.tsx`.
- `[PASS]` LUT controls are hidden in Shot Planner.
  - Evidence: `hideLutControls={true}` passed to `ClipList` in `src/App.tsx`.
- `[PASS]` Selection and manual tags persist through rescans/navigation.
  - Evidence: `projectStates` in `src/App.tsx`, `build_clip_from_file()` in `src-tauri/src/commands.rs`, `upsert_clip()` in `src-tauri/src/db.rs`.
- `[FAIL]` Multi-page PDF export for 50+ clips was not runtime-soak-tested in this pass.
  - Action: run a manual export against a 50+ clip pre-production folder and inspect generated pages.

### C) Media Workspace Launcher
- `[PASS]` Clicking Media Workspace opens an internal launcher grid rather than the file picker.
  - Evidence: `src/App.tsx`, default `media-workspace` branch.
- `[PASS]` Grid is centered and uses equal-size cards in two rows.
  - Evidence: `workspace-apps-grid` in `src/index.css`.
- `[PASS]` Dependent apps stay disabled until a workspace exists.
  - Evidence: `src/App.tsx`, disabled `Scene Blocks` and `Delivery` cards plus launcher hint.
- `[PASS]` Naming/order are coherent and duplicate review entry points were collapsed.
  - Evidence: `src/App.tsx`, card order and rename to `Open Workspace / Review`.
- `[PASS]` No Jobs app card exists.
  - Evidence: `src/App.tsx`, launcher cards list.

### D) Safe Copy
- `[PASS]` Queue supports up to 5 pairs and runs sequentially.
  - Evidence: `MAX_QUEUE` in `src/components/SafeCopy.tsx`, `start_verification_queue()` in `src-tauri/src/commands.rs`.
- `[PASS]` FAST and SOLID modes are wired.
  - Evidence: mode toggle in `src/components/SafeCopy.tsx`, validation in `start_verification_queue()` in `src-tauri/src/commands.rs`.
- `[PASS]` Verification detects missing/extra/size/hash/unreadable states.
  - Evidence: report generation counters in `src-tauri/src/commands.rs`.
- `[PASS]` Markdown and PDF exports exist for per-check and combined queue reports.
  - Evidence: `export_verification_report_*` and `export_verification_queue_report_*` in `src-tauri/src/commands.rs`.
- `[PASS]` Queue labels are now editable, persisted, and used in queue exports.
  - Evidence: `src/components/SafeCopy.tsx`, queue export sections in `src-tauri/src/commands.rs`.
- `[PASS]` Export filenames are deterministic and collision-safe.
  - Evidence: `collision_safe_path()` in `src-tauri/src/commands.rs`.
- `[PASS]` No JSON export is exposed in the Safe Copy UI.
  - Evidence: `src/components/SafeCopy.tsx`.
- `[FAIL]` Exact PDF branding requirement is only partially satisfied.
  - Implemented: Wrap Preview name, version/date line, branded copy line, footer copyright.
  - Missing: explicit use of `src/assets/Icon_square_rounded.svg` inside the Rust-generated Safe Copy PDF.

### E) Contact Sheet / Review
- `[PASS]` Export is multi-page PDF and includes filmstrip thumbnails.
  - Evidence: `exportPdf()` in `src/utils/ExportUtils.ts`.
- `[PASS]` Export excludes rejected clips and uses current selected clips.
  - Evidence: `getExportClips()` in `src/App.tsx`.
- `[PASS]` Two-line metadata pattern exists in PDF/image exports.
  - Evidence: `exportPdf()` and `exportImage()` in `src/utils/ExportUtils.ts`.
- `[PASS]` Image export uses thumbnail data URLs rather than UI screenshots.
  - Evidence: `readThumbAsDataUrl()` and canvas render path in `src/utils/ExportUtils.ts`.
- `[PASS]` Branded copy/footer now exist in contact-sheet exports.
  - Evidence: `src/utils/ExportUtils.ts`.
- `[FAIL]` Exact logo-asset usage is not implemented in the exported contact-sheet PDF/image.
  - Missing: explicit placement of `src/assets/Icon_square_rounded.svg` in generated output.
- `[FAIL]` Audio preview still relies on `convertFileSrc(file_path)` playback and was not hardened to a backend data-URL path in this pass.
  - Evidence: `handlePlayClip()` in `src/App.tsx`.

### F) Scene Blocks
- `[PASS]` Build modes exist: `time_gap`, `scene_change`, `multicam_overlap`.
  - Evidence: `src/components/BlocksView.tsx`, `build_scene_blocks()` in `src-tauri/src/commands.rs`.
- `[PASS]` Scene-change cache clear command exists.
  - Evidence: `clear_scene_detection_cache()` in `src-tauri/src/commands.rs`.
- `[PASS]` Health chips exist for duration, camera count, audio %, mixed FPS, missing timecode.
  - Evidence: `blockStats()` and metadata tags in `src/components/BlocksView.tsx`.
- `[PASS]` Filters exist for camera, audio, fps, resolution, codec, day, selects.
  - Evidence: `src/components/BlocksView.tsx`.
- `[PASS]` Group modes exist for block, camera, day, tech, selects.
  - Evidence: `src/components/BlocksView.tsx`.
- `[PASS]` Timeline tab exists.
  - Evidence: `TimelineView` in `src/components/BlocksView.tsx`.
- `[PASS]` Next-step CTA into Delivery was added.
  - Evidence: `scene-blocks-next-step` in `src/components/BlocksView.tsx`.
- `[FAIL]` Camera filter is still single-select, not multi-select.
  - Action: replace the camera `<select>` with multi-select chip state and adapt `filterClip()`.

### G) Delivery
- `[PASS]` Guided 3-step UX exists and now gives clearer disabled hints.
  - Evidence: `src/components/ExportPanel.tsx`.
- `[PASS]` No default delivery/scope preselection exists.
  - Evidence: `deliveryType` and `scope` initialize to `null` in `src/components/ExportPanel.tsx`.
- `[PASS]` Output folder naming uses ordered prefixes.
  - Evidence: `export_director_pack()` in `src-tauri/src/commands.rs`.
- `[PASS]` Opener failures are warnings only.
  - Evidence: `handleExport()` and `handleDirectorPack()` in `src/components/ExportPanel.tsx`.
- `[PASS]` `Copy Path` is available after export.
  - Evidence: `src/components/ExportPanel.tsx`.
- `[PASS]` Resolve export / Director Pack scope respects reject filtering and selected block scope.
  - Evidence: `resolve_clips_for_scope()` in `src-tauri/src/commands.rs`.
- `[FAIL]` Safe Copy verification stamp artifact was not added to Director Pack in this pass.
  - Action: generate a small raster badge in Rust and write it into `03_Reports` during `export_director_pack()`.

## Shared Systems
- `[PASS]` Jobs HUD is global and not an app card.
  - Evidence: header button in `src/App.tsx`, drawer in `src/components/JobsPanel.tsx`.
- `[PASS]` Jobs HUD now shows running/success/error states with electric-blue running bar.
  - Evidence: `jobHudState` in `src/App.tsx`, `.btn-jobs` state styles in `src/index.css`.
- `[PASS]` Metadata persistence across rescans/navigation is preserved.
  - Evidence: `projectStates` in `src/App.tsx`, `build_clip_from_file()` in `src-tauri/src/commands.rs`, `upsert_clip()` in `src-tauri/src/db.rs`.
- `[FAIL]` `src/branding` does not currently expose an actual token source consumed by the UI.
  - Current state: UI still relies on CSS variables in `src/index.css`; `src/branding` only contains a raster asset in this repo snapshot.

## Validation Performed
- `npm run build` — PASS
- `cargo check` — PASS
- `cargo test` — PASS (`6` Rust tests passed)

## Known Limitations / Followups
- Add exact logo placement from `src/assets/Icon_square_rounded.svg` to Safe Copy PDF exports and contact-sheet exports.
- Add a backend-safe audio preview source path for browser playback instead of direct `convertFileSrc(file_path)`.
- Add Director Pack verification stamp artifact output in `03_Reports`.
- Manually validate 50+ clip PDF export for both Shot Planner and Review.
- Convert Scene Blocks camera filter from single-select to multi-select if that behavior is still required.
