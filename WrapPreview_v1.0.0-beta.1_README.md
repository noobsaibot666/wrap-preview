# Wrap Preview  
## v1.0.0-beta.1  
On-Set Media Control System for macOS (Apple Silicon)

---

## What This Is

Wrap Preview is a modular, offline-first macOS application designed to control and accelerate your on-set workflow from data verification to editorial handoff.

It combines:

- Data integrity verification
- Visual contact sheet generation
- Clip rating and selection
- Audio waveform analysis
- Scene/moment clustering
- Structured DaVinci Resolve export
- Director Pack export for professional handoff

This is a **beta release** intended for real-world testing and feedback.

---

# System Requirements

- macOS (Apple Silicon / arm64)
- Tested on MacBook Air M4
- DaVinci Resolve 18.x / 19.x (for XML import validation)

---

# Installation (Beta Build)

1. Open the `.dmg` file.
2. Drag `Wrap Preview.app` into the Applications folder.
3. First launch:
   - Right-click the app → **Open**
   - Confirm the security dialog (unsigned beta build).

No internet connection required for normal operation.

---

# Recommended Workflow

Wrap Preview is designed to follow a logical production flow.

---

## 1. Copy & Verify (Data Integrity)

Module: **Safe Copy**

Purpose:
Ensure copied footage is bit-accurate and complete.

Steps:
- Select Source and Destination folders.
- Run `SOLID` mode for full BLAKE3 verification.
- Review results.
- Export verification JSON report if required.

Do not proceed to editing before verification passes.

---

## 2. Contact Sheet Review

Module: **Contact Sheet**

Purpose:
Visually review captured footage.

Features:
- Recursive folder scan
- Smart thumbnail sampling
- Clip metadata summary
- Rating filters (All / Picks / Rating ≥ N)
- PDF export

Use this to:
- Confirm coverage
- Review framing
- Share visual summaries with clients

---

## 3. Rate & Flag Clips

Module: Integrated in Contact Sheet

Purpose:
Create director/editor selections.

Keyboard shortcuts:
- `1–5` → Set star rating
- `0` → Clear rating
- `P` → Pick
- `X` → Reject

Selections are persistent and affect:
- Contact Sheet filtering
- Resolve export
- Director Pack export

---

## 4. Audio Review

Module: Audio Waveform Summary

Purpose:
Quickly identify audio issues.

Indicators:
- NO AUDIO
- POSSIBLE CLIP
- VERY LOW
- AUDIO OK

Waveforms generate in the background.
No manual configuration required.

---

## 5. Scene Blocks

Module: **Blocks**

Purpose:
Automatically group clips into meaningful moments.

Features:
- Time-gap based block creation
- Multi-camera grouping
- Rename / Merge / Split blocks

Use blocks to structure your edit before exporting.

---

## 6. Resolve Export

Module: **Resolve Export**

Purpose:
Prepare structured import for DaVinci Resolve.

Supported export scopes:
- All clips
- Picks only
- Rating ≥ N
- Selected blocks
- Current view filter

Structured output includes:
- Block-based stringouts
- Camera-based groupings
- Selects
- Rating markers
- Optional master timeline

Import the generated FCPXML into DaVinci Resolve.

---

## 7. Director Pack Export

Module: **Director Pack**

Purpose:
Generate a complete professional handoff package.

Output structure:
DirectorPack/
ContactSheet/
*.pdf
Resolve/
*.fcpxml
Reports/
*.json

Includes:
- Contact Sheet PDF
- Structured Resolve XML
- Deterministic JSON summary

---

# Jobs & Background Processing

Open the **Jobs Panel** to:

- Track thumbnail generation
- Monitor waveform extraction
- Observe verification progress
- Monitor export progress
- Cancel running operations

All heavy tasks run in background threads.
The UI should remain responsive at all times.

---

# About & Diagnostics

Open **About** to view:

- App version
- Build date
- macOS version
- Architecture (arm64)
- FFmpeg/ffprobe versions

Use **Send Feedback** to export a diagnostics bundle containing:

- App metadata
- Recent job state
- Last export metadata
- Optional verification summary

Include this bundle when reporting issues.

---

# Known Beta Limitations

- Director Pack Contact Sheet PDF is a backend summary PDF and may not be pixel-identical to the UI print layout.
- Resolve bin hierarchy rendering may vary slightly depending on Resolve version.
- Job state does not persist across app restarts.
- App is unsigned (Gatekeeper warning expected).

See `KNOWN_ISSUES.md` for details.

---

# What to Report

When testing, please report:

- Crashes or freezes
- Incorrect job states
- Export errors (include scope + folder path)
- Resolve import discrepancies
- Verification mismatches
- Unexpected UI behavior

Always attach the diagnostics bundle.

---

# Vision

Wrap Preview is designed to evolve into a full on-set media and editorial control system.

This beta validates:

- Stability
- Resolve integration
- Export determinism
- Real-world usability

Thank you for testing.