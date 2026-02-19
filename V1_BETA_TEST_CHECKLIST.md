# V1 Beta Test Checklist

## Build Under Test
- `1.0.0-beta.1`
- macOS Apple Silicon

## Installation
1. Open DMG.
2. Drag `Wrap Preview.app` to Applications.
3. First launch: right-click app -> Open.

## Minimum Workflow Tests
1. Safe Copy
- Run FAST and SOLID modes.
- Confirm progress updates and final status.
- Export JSON report.

2. Contact Sheet
- Scan a footage folder recursively.
- Confirm thumbnails and metadata load.
- Export PDF and image.

3. Ratings/Flags
- Apply ratings and flags with keyboard shortcuts.
- Confirm persistence after navigation.

4. Waveform
- Confirm waveform appears progressively.
- Confirm audio health labels are shown.

5. Scene Blocks
- Build blocks.
- Rename, merge, split.

6. Resolve Export
- Export using:
  - All
  - Picks only
  - Rating >= N
  - Selected blocks
  - Current view filter
- Import XML in Resolve and validate structure.

7. Director Pack
- Export Director Pack.
- Confirm deterministic folder tree and artifacts.

## What to Report
- Crash or freeze
- Incorrect progress/state in Jobs panel
- Export failures (include exact scope and path)
- Resolve import discrepancies
- Data mismatch in verification output

## Diagnostics Export
1. Click **Send Feedback** in app header.
2. Choose output folder.
3. Share generated zip with issue report.
