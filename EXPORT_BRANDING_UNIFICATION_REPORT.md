# Export Branding Unification Report

## What Changed
- Consolidated export branding into one shared module: [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts).
- Rewired contact-sheet PDF and image exports to use shared `drawHeader`, `drawFooter`, `formatExportHeader`, `getBrandingAssets`, and `getSmartCopyLine`.
- Rewired Safe Copy frontend PDF exports to use the same shared branding module instead of maintaining separate header/footer code.
- Added logo fallback handling with warning logging:
  - console log format: `[Wrap Preview] branding logo fallback used: <reason>`
  - UI warning hook support so exports can continue with text branding if logo rasterization fails.
- Kept backend Safe Copy PDF commands intact, and marked them as deprecated/internal in [src-tauri/src/commands.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/commands.rs).

## Spec PASS/FAIL Matrix
- `[PASS]` Header uses logo `src/assets/Icon_square_rounded.svg`.
  - Evidence: `iconSvgRaw` import and `getBrandingAssets()` in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts).
- `[PASS]` Header includes app name + version + local export date/time.
  - Evidence: `formatExportHeader()` in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts).
- `[PASS]` Header includes project name when available.
  - Evidence: `formatExportHeader()` in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts), callers in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts) and [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts).
- `[PASS]` Smart copy line matches the canonical text for Wrap Preview exports.
  - Evidence: `getSmartCopyLine()` in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts), used by `drawHeader()`.
- `[PASS]` Footer is exactly `© Alan Alves. All rights reserved.`
  - Evidence: `drawFooter()` in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts).
- `[PASS]` Logo rasterization failures fall back to text-safe export flow and log `[Wrap Preview] branding logo fallback used: <reason>`.
  - Evidence: `warnWithFallback()` and `getBrandingAssets()` in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts).
- `[PASS]` Shared branding module exists and is the active single source of truth.
  - Evidence: [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts), imported by [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts) and [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts).
- `[PASS]` Shared branding module provides `getBrandingAssets`, `formatExportHeader`, `drawHeader`, `drawFooter`, and `getSmartCopyLine`.
  - Evidence: exported functions in [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts).
- `[PASS]` Contact Sheet PDF uses `App.tsx -> ExportUtils.ts -> exportPdf`.
  - Evidence: `handleExport()` in [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx), `exportPdf()` in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts).
- `[PASS]` Contact Sheet Image uses `App.tsx -> ExportUtils.ts -> exportImage`.
  - Evidence: `handleExportImage()` in [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx), `exportImage()` in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts).
- `[PASS]` Safe Copy single PDF uses `SafeCopy.tsx -> SafeCopyPdf.ts -> saveSafeCopyJobPdf`.
  - Evidence: `exportJobPdf()` in [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx), `saveSafeCopyJobPdf()` in [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts).
- `[PASS]` Safe Copy queue PDF uses `SafeCopy.tsx -> SafeCopyPdf.ts -> saveSafeCopyQueuePdf`.
  - Evidence: `exportQueuePdf()` in [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx), `saveSafeCopyQueuePdf()` in [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts).
- `[PASS]` `PrintLayout` remains preview-only, not the active saved export path.
  - Evidence: [src/components/PrintLayout.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/PrintLayout.tsx) is rendered in [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx), while saved exports route through [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts).
- `[PASS]` Contact Sheet PDF applies shared branding on every page.
  - Evidence: per-page `drawHeader()` / `drawFooter()` calls inside `exportPdf()` in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts).
- `[PASS]` Contact Sheet image applies shared branding.
  - Evidence: `drawHeader()` / `drawFooter()` calls inside `exportImage()` in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts).
- `[PASS]` Safe Copy single PDF applies shared branding.
  - Evidence: `preparePage()` and `finalizePage()` in [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts).
- `[PASS]` Safe Copy queue PDF applies shared branding.
  - Evidence: `preparePage()` and `finalizePage()` in [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts).
- `[PASS]` Backend Safe Copy PDF commands are preserved.
  - Evidence: `export_verification_report_pdf` and `export_verification_queue_report_pdf` in [src-tauri/src/commands.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/commands.rs).
- `[PASS]` Backend Safe Copy PDF commands are marked deprecated/internal.
  - Evidence: `// DEPRECATED: UI uses the frontend jsPDF export path for deterministic branding/logo handling.` comments above both backend PDF commands in [src-tauri/src/commands.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/commands.rs).
- `[PASS]` UI no longer calls backend Safe Copy PDF generation.
  - Evidence: `exportJobPdf()` and `exportQueuePdf()` in [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx) call frontend helpers, not backend PDF commands.
- `[PASS]` No active export path uses DOM capture.
  - Evidence: active exports use jsPDF, canvas, backend `read_thumbnail`, and backend `save_image_data_url` in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts) and [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts); no `html2canvas` or screenshot export calls exist in active export paths.
- `[PASS]` No new dependencies were added for branding unification.
  - Evidence: implementation uses existing jsPDF and browser-native SVG/canvas handling.
- `[FAIL]` Manual in-app validation for Contact Sheet PDF with 50+ clips was not completed in this terminal-only pass.
  - Evidence: code pagination exists in `exportPdf()` in [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts), but visual runtime verification is still pending.
- `[FAIL]` Manual in-app validation for Safe Copy queue PDF multipage readability was not completed in this terminal-only pass.
  - Evidence: code pagination exists in `saveSafeCopyQueuePdf()` in [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts), but visual runtime verification is still pending.

## Active Export Entrypoints
- Contact Sheet PDF: [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx) -> [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts) `exportPdf`
- Contact Sheet Image: [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx) -> [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts) `exportImage`
- Safe Copy single PDF: [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx) -> [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts) `saveSafeCopyJobPdf`
- Safe Copy queue PDF: [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx) -> [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts) `saveSafeCopyQueuePdf`
- Print preview surface: [src/components/PrintLayout.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/PrintLayout.tsx)
  - This remains an on-screen preview surface, not the active saved export path.
- Backend Safe Copy PDF commands still exist in [src-tauri/src/commands.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/commands.rs):
  - `export_verification_report_pdf`
  - `export_verification_queue_report_pdf`
  - They are preserved but no longer used by the UI export buttons.

## Files Changed
- [src/utils/ExportBranding.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportBranding.ts)
- [src/utils/ExportUtils.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/ExportUtils.ts)
- [src/utils/SafeCopyPdf.ts](/Users/alan/_localDEV/exposeu_wrapkit/src/utils/SafeCopyPdf.ts)
- [src/components/SafeCopy.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/components/SafeCopy.tsx)
- [src/App.tsx](/Users/alan/_localDEV/exposeu_wrapkit/src/App.tsx)
- [src-tauri/src/commands.rs](/Users/alan/_localDEV/exposeu_wrapkit/src-tauri/src/commands.rs)

## Dependencies
- No new dependencies added.
- Logo handling uses the bundled SVG asset and browser-native SVG-to-canvas rasterization.

## Branding Rules Now Applied Everywhere
- Header uses the Wrap Preview square logo from `src/assets/Icon_square_rounded.svg`
- Header includes app name + version
- Header includes local export date/time
- Header includes project name where available
- Smart copy line is unified:
  - `Generated by Wrap Preview (vX.Y). Offline media control for creatives — review, verify, and deliver with confidence.`
- Footer is unified:
  - `© Alan Alves. All rights reserved.`

## Multipage Safety Notes
- Contact-sheet PDF still uses the existing page chunking logic and now applies the shared header/footer per page.
- Safe Copy PDF paths now page through a single shared page-preparation/finalization flow so header/footer placement is consistent.
- No export path uses DOM capture.

## Verification Checklist
- Contact Sheet PDF:
  - export with 50+ clips
  - confirm logo appears on every page
  - confirm footer appears on every page
  - confirm last page is present and clip rows do not overlap footer
- Contact Sheet Image:
  - export image
  - confirm logo appears top-left
  - confirm text header and footer are visible
  - confirm no UI controls or overlays appear in the image
- Safe Copy single PDF:
  - run one verification job
  - export single PDF
  - confirm shared logo/header/footer are present
- Safe Copy queue PDF:
  - run multiple queue checks
  - export combined queue PDF
  - confirm logo/header/footer are present
  - confirm each check label is readable
- Fallback behavior:
  - if logo rasterization fails, export should still complete with text branding
  - confirm console warning appears with `[Wrap Preview] branding logo fallback used: ...`

## Validation Run
- `npm run build` — PASS
- `cargo check` — PASS
- `cargo test` — PASS

## Manual Validation Status
- Manual in-app export validation for 50+ clip Contact Sheet PDF: not run in this terminal-only pass.
- Manual Safe Copy queue PDF visual validation: not run in this terminal-only pass.
