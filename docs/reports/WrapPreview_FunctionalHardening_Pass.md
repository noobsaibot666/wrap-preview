# Wrap Preview Functional Hardening Pass

## What was broken and how it was fixed

### Review Core + Frame Notes
- Review Core was requesting poster, HLS, and thumbnails before derived media was ready, which caused repeated `404` noise and unstable player startup.
- Media loading is now gated by `processing_status` plus a lightweight finalization probe before the player attaches poster, playlist, or thumbnails.
- Media URLs are now built through one shared helper in `ReviewCore.tsx`, which removes route mismatches between poster, playlist, thumbnail, and share-token/session usage.
- Internal client review flow is now centered on a unified `Feedback` view model derived from existing Review Core comments and frame notes, so both legacy data sources remain supported without splitting the user across multiple surfaces.
- Frame Note export was failing in WebKit/Tauri with `SecurityError: The operation is insecure.` because the canvas background image could become tainted.
- Export now renders from a backend-provided JPEG data URL via `review_core_read_frame_note_image`, which keeps `annotated.jpg` export safe and deterministic.
- Review Core standalone navigation now includes a `Projects` back action in the library header so Review Core can return to its own project picker without touching the separate Open Workspace / Review flow.

### Folder Creator
- Folder Creator only supported ZIP export from the UI, which left the documented create-on-disk workflow unavailable.
- Added `create_folder_structure` so the same structure payload can be materialized directly onto disk.
- Added path sanitizing and traversal guards for folder/file nodes before writing folders on disk.
- Added compact success/error messaging in the Folder Creator surface so JSON import, ZIP export, and create-on-disk failures are visible without opening devtools.

### App-level routing and workspace isolation audit
- Confirmed `Modules` returns to the top-level chooser and is not mixed into the restricted Review Core share route.
- Confirmed `/#/r/{token}` still renders restricted Review Core only.
- Confirmed Review Core remains independently launchable from Media Workspace without requiring Open Workspace / Review.
- Confirmed Scene Blocks and Delivery still show workspace-required gating from the launcher instead of opening into a broken empty state.
- Confirmed Delivery still has no default format/scope selection in `ExportPanel.tsx`.
- Confirmed Review Core share download remains proxy-only and keeps `PROXY_NOT_READY` handling.

## Files touched
- `src/components/ReviewCore.tsx`
- `src/index.css`
- `src/components/FolderCreator.tsx`
- `src-tauri/src/commands.rs`
- `src-tauri/src/folders.rs`
- `src-tauri/src/lib.rs`

## Manual happy path checklist

### Pre-Production
1. Open `Modules -> Pre-production -> Folder Creator`.
2. Import a JSON folder schema and confirm the structure preview updates.
3. Run `Create on disk` and confirm the folder/file tree is written to the selected destination.
4. Run `Export structure` and confirm the ZIP is created.
5. Open `Shot Planner`, load a reference folder, confirm clips load, and export a reference sheet.

### Media Workspace core
1. Open `Modules -> Media Workspace`.
2. Confirm `Review Core` is enabled even when no workspace is open.
3. Confirm `Scene Blocks` and `Delivery` stay disabled until a review workspace is opened.
4. Open `Open Workspace / Review`, load footage, and confirm clip review loads without crashing.

### Review Core
1. Open `Review Core`, create or open a Review Core project, and import media.
2. While a version is processing, confirm the player shows processing/finalizing state without poster/HLS/thumb 404 spam.
3. When ready, confirm poster, playback, comments, annotations, approvals, and share controls work.
4. Add a text note from the video stage, then click its marker to seek.
5. Mark a frame, save markup, and export `annotated.jpg`.
6. In standalone Review Core, click `Projects` in the library header and confirm it returns to the Review Core project picker.
7. Open a share link route and confirm only the restricted Review Core surface is visible.
8. If proxy download is enabled on the share link, confirm the share view button says `Download Proxy`.

### Safe Copy
1. Open `Safe Copy`, add up to five source/destination pairs, and run both `FAST` and `SOLID`.
2. Confirm queue execution is sequential and report export actions are available after completion.

### Scene Blocks + Delivery
1. Open a workspace, then open `Scene Blocks`.
2. Build blocks in at least one mode, switch list/timeline views, and confirm `Open Delivery` routes into the export panel.
3. In Delivery, choose format and scope explicitly, then export FCPXML and Director Pack.

## Known limitations left for UI polish
- The functional pass keeps the current visual structure in non-Review-Core apps unless a layout change was required for stability.
- Folder Creator now supports both outputs, but the surface still uses its existing dense editor layout rather than a simplified wizard.
- Review Core finalization retries are capped, so a very slow proxy/poster write may still require a later status refresh before media attaches.

## Validation
- `npm run build`
- `cargo check`

Both passed for this hardening pass.
