This is designed to:

- Explain the app clearly
- Describe each module
- Show workflow sequence
- Be shareable with collaborators or clients
- Be expandable as features grow

# WRAP PREVIEW SUITE

### On-Set Media Control System

Version: 1.0

Platform: macOS (Apple Silicon)

Offline-first

---

# 1. What Is Wrap Preview?

Wrap Preview is a modular on-set media control system designed to:

- Verify data integrity
- Organize multi-camera shoots
- Assist creative review
- Accelerate post-production
- Deliver professional client-ready documentation

It replaces fragmented tools with one unified workflow.

---

# 2. Core Philosophy

Wrap Preview is built around three pillars:

1. **Data Integrity** – No corrupted or missing files.
2. **Creative Clarity** – Understand what was captured.
3. **Post-Production Acceleration** – Reduce editor prep time.

Each module supports one or more of these pillars.

---

# 3. Modules Overview

## 3.1 Contact Sheet

Purpose:
Create a visual summary of all clips in a shoot.

What it does:

- Scans project folder
- Extracts metadata
- Generates representative thumbnails
- Displays film-strip previews
- Exports A4 Landscape PDF

Best used:

- End of shoot day
- Client review
- Production reports

Output:

- Branded PDF contact sheet

---

## 3.2 Safe Copy / Verification

Purpose:
Guarantee files were copied correctly.

What it does:

- Compares source and destination folders
- Detects missing files
- Detects size mismatches
- Performs full hash verification
- Detects extra files
- Generates verification report

Best used:
Immediately after copying camera media.

Output:

- JSON verification report
- Printable verification summary

---

## 3.3 Ratings & Selection

Purpose:
Rapid on-set clip selection.

What it does:

- 0–5 star rating system
- Pick / Reject flags
- Keyboard shortcuts for speed
- Persisted selections

Best used:
During or immediately after review.

Output:

- Filtered clip sets
- Director's selects
- Resolve export-ready markers

---

## 3.4 Audio Waveform Summary

Purpose:
Quickly evaluate audio quality.

What it does:

- Detects presence of audio
- Displays waveform sparkline
- Flags:
    - No audio
    - Possible clipping
    - Mostly silent

Best used:
Before leaving set to detect audio issues.

---

## 3.5 Scene / Moment Clustering

Purpose:
Turn raw clips into organized “blocks”.

What it does:

- Groups clips by timestamp proximity
- Detects multi-camera overlaps
- Groups by camera label
- Allows merge/split/rename

Best used:
Before export to editor.

Output:

- Structured block organization

---

## 3.6 DaVinci Resolve Export

Purpose:
Prepare editing environment automatically.

What it does:

- Exports FCPXML for Resolve
- Organizes clips into structured bins
- Creates stringout timelines
- Applies markers for:
    - Picks
    - Rejects
    - Ratings
    - Notes

Best used:
Immediately before post-production begins.

Output:

- Resolve-ready XML file

---

## 3.7 Director Pack Export

Purpose:
Deliver complete structured package.

What it includes:

- Contact Sheet PDF
- Resolve XML
- JSON summary report
- Structured export folder

Best used:
When handing over material to editor or client.

---

# 4. Recommended Workflow Sequence

This is the ideal operational order.

---

## STEP 1 — Copy & Verify

Use:
Safe Copy / Verification

Goal:
Ensure no missing or corrupted data.

Do not proceed before verification passes.

---

## STEP 2 — Scan & Generate Contact Sheet

Use:
Contact Sheet

Goal:
Understand what was captured visually.

---

## STEP 3 — Review & Rate

Use:
Ratings & Selection

Goal:
Mark:

- Best takes
- Rejects
- Director’s selects

---

## STEP 4 — Check Audio

Use:
Audio Waveform Summary

Goal:
Confirm audio integrity and detect clipping or silence.

---

## STEP 5 — Build Scene Blocks

Use:
Scene / Moment Clustering

Goal:
Organize clips into meaningful editorial blocks.

---

## STEP 6 — Export to Resolve

Use:
Resolve Export

Goal:
Open structured project in DaVinci Resolve with:

- Bins
- Timelines
- Markers
- Selects

---

## STEP 7 — Generate Director Pack (Optional)

Use:
Director Pack Export

Goal:
Deliver full professional documentation package.

---

# 5. Who Is This For?

- Director of Photography
- DIT
- Creative Director
- Editor
- Post Supervisor
- Art documentation teams
- Multi-camera production environments

---

# 6. What Makes Wrap Preview Different?

- Combines integrity + creative + editorial prep
- Offline and secure
- Designed for real on-set pressure
- Modular system, not a single-purpose tool

---

# 7. Ongoing Development

Wrap Preview is modular and expandable.

Future modules may include:

- Sync suggestions
- LUT preview mode
- Advanced metadata mapping
- Multi-day project management
- AI-assisted moment detection

This document must be updated whenever new modules are added.

---

# 8. Document Maintenance Policy

Whenever new features are implemented:

1. Add module description under “Modules Overview”.
2. Update workflow sequence if necessary.
3. Update version number at top.
4. Maintain clarity and non-technical tone.

This document is the authoritative operational guide for Wrap Preview Suite.

---

# Inspiration Library — Lookbook & Shooting Plan Guide

This module transforms reference footage into a structured **shooting plan**.

It is designed for:

- Pre-production planning
- On-set visual reference
- Structured storytelling flow
- Fast decision-making under pressure

---

# 1. Tagging System (Controlled + Fast)

Each reference clip supports controlled taxonomy fields.

## Shot Size (Canonical Order)

- EWS / ELS
- WS / LS
- FS
- MS
- MCU
- CU
- ECU
- Detail / Insert

These define the narrative scale of the shot.

## Movement

- Static / Locked
- Handheld
- Gimbal follow
- Push-in
- Pull-out
- Pan
- Tilt
- Slide / Truck
- Arc / Orbit
- Crane / Jib
- Zoom in
- Zoom out

Tags are:

- Controlled (dropdown)
- Type-to-search
- Extendable (new tags can be added)
- Stored persistently
- Never overwritten by auto-analysis

---

# 2. Sequencing Modes

Each Lookbook supports three sequencing strategies.

## Canonical (Default)

Classic cinematic escalation:

**Context → Action → Emotion → Detail**

Order:

1. EWS
2. WS
3. FS
4. MS
5. MCU
6. CU
7. ECU
8. Detail

Movement acts as a secondary ordering key.

Best for:

- Narrative storytelling
- Commercial structure
- Documentary flow

---

## Hook-First (Vertical / Social Optimized)

Designed for 9:16 and short-form platforms.

Order:

1. Detail
2. ECU
3. CU
4. MCU
5. MS
6. WS
7. EWS

Starts with high-impact visuals before context.

Best for:

- Instagram Reels
- TikTok
- Short-form storytelling

---

## Custom Manual

User-defined order using the `manual_order` field.

Best for:

- Highly specific shot lists
- Director-driven sequencing

---

# 3. Vertical 9:16 Mode

Lookbooks can be exported in vertical mode.

When enabled:

- 9:16 thumbnails are generated
- Deterministic center crop is applied
- Safe-frame overlays are available:
    - None
    - Center-safe (caption-safe)
    - Top-safe (UI-safe)

This allows accurate composition preview for vertical delivery.

---

# 4. Auto Analyze (Motion + Light)

Auto Analyze runs as a background job.

It generates deterministic (non-ML) visual tags:

- Motion: static / moving / high-motion
- Brightness: low / normal / bright
- Contrast: flat / normal / punchy
- Temperature: warm / cool / neutral

Auto tags:

- Never overwrite manual tags
- Are stored separately
- Can be filtered in-app
- Can be included in Lookbook export

Example filtering:

- CU + Push-in + Warm
- High-motion + Bright
- Static + Low-key

---

# 5. Lookbook Pack (Mobile Export)

Exports an offline mobile-friendly package:

LookbookPack__/
index.html
data.json
assets/
thumbs/
thumbs_9x16/        (if vertical mode enabled)
overlays/
lookbook.pdf          (optional)

The pack works fully offline once unzipped.

---

# 6. Mobile Viewer Experience

The Lookbook Pack includes:

### Tabs

- Sequence
- Tags
- Favorites

### Full-Screen Viewer

- Tap any reference
- Swipe left/right to navigate
- Toggle safe-frame overlays
- View Shot Size + Movement tags
- See Auto tags and notes

Designed for:

- One-hand operation
- Fast browsing on set
- Clear shot planning reference

---

# 7. How to Open on iPhone

1. Export Lookbook Pack as ZIP.
2. Share via:
    - AirDrop
    - iCloud Drive
    - Google Drive
3. On iPhone:
    - Open Files app
    - Tap the ZIP to unzip
    - Open `index.html`

No internet connection required after unzip.

---

# 8. Practical Shooting Example (Restaurant / Chef)

## Canonical Order (Structured Coverage)

1. EWS — Establish restaurant atmosphere
2. WS — Chef in kitchen environment
3. MS — Cooking process
4. MCU — Chef expression
5. CU — Food preparation
6. ECU / Detail — Plating, textures, hands

## Hook-First (Vertical Social Content)

1. Detail / ECU — Plating moment
2. CU — Chef reaction
3. MS — Cooking action
4. WS — Context shown later

This transforms references into an actionable shot plan.

---

# Summary

The Inspiration Library is no longer just a reference storage tool.

It is:

- A structured cinematography planner
- A vertical-aware shot sequencing system
- An on-set mobile reference tool
- A deterministic export engine

It bridges inspiration and execution.