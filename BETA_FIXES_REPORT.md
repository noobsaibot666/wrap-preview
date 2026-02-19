# BETA_FIXES_REPORT

## Scope
This sprint addressed beta feedback issues in UI/UX, thumbnail/export reliability, module navigation, blocks rendering, and Tauri opener ACL behavior. No new feature domains were added.

## Environment Baseline
- Frontend build: `npm run build` ✅
- Rust backend check: `cargo check` ✅
- Rust tests: `cargo test -q` ✅ (5 passed)

## Fixes by Issue

### 1) Clip thumbnails not loading reliably
- Root cause:
  - UI depended primarily on live thumbnail progress events; previously generated thumbnails were not fully rehydrated into UI/cache on reload.
  - Empty thumbnail states were ambiguous (spinner forever) and did not explain failure/no-data.
- Fix:
  - Added project clip rehydration from DB via `get_clips` and thumbnail cache hydration via `read_thumbnail`.
  - On `thumbnail-complete`, app refreshes clip rows again to ensure DB/file-state sync.
  - FilmStrip now shows explicit empty-state text (`No thumbnails`) when not extracting.
- Key files:
  - `src/App.tsx`
  - `src/components/FilmStrip.tsx`

### 2) Contact Sheet image export / missing image reliability
- Root cause:
  - Export image path used plugin-fs write path that could fail in some ACL/runtime contexts.
  - Capture could run before all `<img>` nodes in print area were fully loaded.
- Fix:
  - Added backend command `save_image_data_url` to write exported image bytes directly from Rust.
  - Updated frontend export utility to call backend command instead of plugin-fs direct write.
  - Added pre-capture wait for all images in export element to finish load/error.
  - Print metadata now includes rating/flag when present.
- Key files:
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/lib.rs`
  - `src/utils/ExportUtils.ts`
  - `src/components/PrintLayout.tsx`

### 3) “Check clips” labeling clarity
- Root cause:
  - Primary folder action did not reflect the user mental model from feedback.
- Fix:
  - Renamed header action label to `Check Clips` and added tooltip/title explaining behavior.
- Key files:
  - `src/App.tsx`

### 4) Pick/Reject controls too small / low contrast
- Root cause:
  - Flag controls were icon-only, low-padding, and low contrast against card header.
- Fix:
  - Enlarged controls to >=36px min height.
  - Added text labels (`Pick`, `Reject`) and stronger contrast styles.
  - Added aria labels for accessibility.
- Key files:
  - `src/components/ClipList.tsx`
  - `src/index.css`

### 5) Top menu confusion around Safe Copy and module access
- Root cause:
  - Navigation relied heavily on onboarding + project context and did not expose a clear persistent module home.
- Fix:
  - Added persistent `Modules` (home) tab in header navigation.
  - Persisted last visited module tab in localStorage.
  - Maintained direct tab switching across `Contact Sheet`, `Blocks`, `Safe Copy`.
- Key files:
  - `src/App.tsx`

### 6) Crowded selection/sort/filter/export controls
- Root cause:
  - Toolbar mixed view controls and export actions in one dense row.
- Fix:
  - Split into two toolbar rows:
    - Row A: layout/sort/filter controls
    - Row B: selection + export naming + save image
  - Improved export name helper tooltip with explicit example.
- Key files:
  - `src/App.tsx`
  - `src/index.css`

### 7) In-app module navigation without returning onboarding
- Root cause:
  - Navigation was present but lacked explicit “home/modules” mode and persisted context.
- Fix:
  - Added `home` tab and persistent module state.
  - Switching modules now remains available from header at all times.
- Key files:
  - `src/App.tsx`

### 8) Blocks should show thumbnails
- Root cause:
  - Blocks list rendered filenames only; no film-strip integration.
- Fix:
  - Integrated `FilmStrip` into each block clip row.
  - Added `Generate thumbnails` CTA when block clip has no thumbnails.
  - Passed `thumbnailCache` + `thumbnailsByClipId` from App to Blocks view.
- Key files:
  - `src/components/BlocksView.tsx`
  - `src/App.tsx`

### 9) Resolve/Director Pack ACL error (`plugin:opener|open_path not allowed by ACL`)
- Root cause:
  - Missing explicit opener ACL permissions for open-path style actions.
  - Frontend treated post-export auto-open failure as full export failure.
- Fix:
  - Added opener permissions:
    - `opener:allow-open-path`
    - `opener:allow-reveal-item-in-dir`
  - Wrapped `openPath` calls so export success is preserved even if auto-open is blocked.
  - Added user-facing fallback hint with saved path.
- Key files:
  - `src-tauri/capabilities/default.json`
  - `src/components/ExportPanel.tsx`
  - `src/App.tsx`

### 10) Resolve export controls clustered
- Root cause:
  - Export action row lacked spacing/hierarchy and weak disabled affordances.
- Fix:
  - Increased action row spacing, added section separation, and clearer primary/secondary emphasis.
  - Added disabled opacity states on export buttons.
- Key files:
  - `src/components/ExportPanel.tsx`

## Validation Checklist
1. Scan a project and confirm clip thumbnails progressively appear in Contact Sheet.
2. Switch to Blocks and confirm clip thumbnails are visible there too.
3. For clips without thumbs, confirm placeholder text/CTA appears.
4. Export image from Contact Sheet and confirm output contains thumbnails + metadata.
5. Export PDF (print flow) and confirm selected clips and metadata render.
6. Switch modules from header (`Modules`/`Contact Sheet`/`Blocks`/`Safe Copy`) without onboarding lock-in.
7. Confirm Pick/Reject controls are readable, larger, and clickable.
8. Run Resolve FCPXML export and Director Pack export; confirm no ACL failure when auto-open runs.
9. If auto-open is blocked, confirm export still succeeds and UI provides saved path hint.

## Notes
- Existing compile warnings unrelated to this sprint remain in Rust (`dead_code`/unused fields/functions).
- No cloud/network dependencies were introduced.
