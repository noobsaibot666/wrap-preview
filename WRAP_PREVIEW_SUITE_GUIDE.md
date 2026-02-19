# Wrap Preview Suite Guide

## What Wrap Preview Is
Wrap Preview is an offline macOS on-set media control suite for ingest review, verification, selection, and post handoff.

Core modules:
- Safe Copy Verification
- Contact Sheet
- Ratings and Flags
- Audio Waveform Summary
- Scene Blocks
- Resolve Structured Export
- Director Pack Export

## Recommended Workflow
1. Copy and Verify
- Open **Safe Copy**.
- Select source and destination folders.
- Run `SOLID` mode for hash verification.
- Export verification JSON after completion.

2. Contact Sheet Review
- Open **Contact Sheet**.
- Scan footage folder.
- Review film strips and metadata.
- Export PDF/Image as needed.

3. Rate and Flag
- Use stars (0–5) and pick/reject flags.
- Keyboard: `1-5`, `0`, `P`, `X`.

4. Audio Pass
- Waveform previews generate in background.
- Use audio badges (`NO AUDIO`, `POSSIBLE CLIP`, `VERY LOW`, `AUDIO OK`).

5. Scene Blocks
- Open **Blocks** tab.
- Build blocks with gap threshold.
- Rename/merge/split where needed.

6. Resolve Export
- Open export panel.
- Choose scope (All, Picks, Rating >= N, Selected Blocks, or Current View Filter).
- Export structured FCPXML.

7. Director Pack Export
- Export full `DirectorPack` to a destination folder.
- Output contains:
  - `ContactSheet/*.pdf`
  - `Resolve/*.fcpxml`
  - `Reports/*.json`

## Jobs and Progress
- Open **Jobs** from header.
- Track all long operations with status/progress.
- Cancel running jobs when required.

## About and Diagnostics
- **About** shows app/build/ffmpeg/system versions.
- **Send Feedback** exports a diagnostics zip with app info, recent jobs, and latest export metadata.

## Output Interpretation
- Verification JSON: file-level status and mismatch diagnostics.
- Contact Sheet PDF: visual review summary with clip metadata.
- FCPXML: Resolve import package with structured event/timeline organization.
- Director Pack JSON: deterministic export summary and selected scope.
