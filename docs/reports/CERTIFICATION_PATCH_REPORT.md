# Wrap Preview Certification Patch Report

## What Changed
- Added branded logo embedding for contact-sheet exports in the existing frontend export engine.
- Switched Safe Copy PDF generation to a frontend jsPDF path so logo/header/footer branding is deterministic and matches the required asset.
- Added backend `read_audio_preview` and updated audio playback to use data URLs instead of direct `convertFileSrc(file_path)`.
- Added a Director Pack verification badge artifact in `03_Reports` when a successful verification job exists.
- Replaced the Scene Blocks single camera filter with persistent multi-select camera chips.
- Added a small dev-only export soak helper log for PDF page-count visibility in development builds.

## Files Touched
- [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts)
- [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts)
- [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts)
- [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx)
- [src/components/BlocksView.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/BlocksView.tsx)
- [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx)
- [src/index.css](/Users/alan/_localDEV/exposeu_wrapkit/src/index.css)
- [src-tauri/src/commands.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/commands.rs)
- [src-tauri/src/lib.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/lib.rs)

## Dependencies Added
- None.
- Logo rendering uses browser-native SVG-to-canvas conversion on the frontend.

## Validation Run
- `npm run build` — PASS
- `cargo check` — PASS
- `cargo test` — PASS

## Manual Verification Checklist

### 1) Contact Sheet export logo
- Open Shot Planner or Review with loaded clips.
- Export PDF contact sheet.
- Confirm the Wrap Preview square logo appears at top-left on every page.
- Export image contact sheet.
- Confirm the same logo appears in the image header and the export is not blank.

### 2) Safe Copy PDF logo/header/footer
- Run a Safe Copy check so at least one finished job exists.
- Export single-job PDF from the results panel.
- Confirm:
  - logo appears in the header
  - app name, version, and date appear
  - branded copy line appears
  - footer shows `© Alan Alves. All rights reserved.`
- Export combined queue PDF and confirm the same header/footer treatment across pages.

### 3) Audio preview hardening
- Open Review.
- Play audio from multiple clips in sequence.
- Confirm playback starts without `NotSupportedError` or unsupported URL errors.
- Confirm switching clips stops the previous audio and resets progress cleanly.

### 4) Director Pack verification badge
- Run at least one successful Safe Copy verification for the project.
- Export Director Pack.
- Confirm `03_Reports` contains a `verification_badge_YYYY-MM-DD.svg` file.
- Open the summary JSON and confirm it references the badge path.
- Export another Director Pack without a verification job and confirm export still succeeds without failure.

### 5) Scene Blocks camera multi-select
- Open Scene Blocks on a project with clips from multiple inferred cameras.
- Toggle multiple camera chips on.
- Confirm results include clips from any selected camera.
- Click `All Cameras` and confirm the filter clears.
- Leave the page and return; confirm the selected cameras persist per project.

### 6) Multi-page soak helper
- In a dev build, export a PDF with a large clip set.
- Open the browser console.
- Confirm the exporter logs clip count and page count under `[Wrap Preview] PDF export soak helper`.

## Notes
- Safe Copy markdown export was left untouched.
- Existing backend Safe Copy PDF commands remain in place, but the UI now routes PDF export through the branded frontend path to satisfy the logo requirement without introducing Rust-side image rendering dependencies.
- The Director Pack verification badge is emitted as SVG to avoid heavy rasterization dependencies while remaining deterministic and offline-safe.
