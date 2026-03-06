# Wrap Preview – Application Architecture

Wrap Preview is a cross-platform desktop application built with:

- **Tauri** (Rust backend)
- **React + TypeScript** (frontend)
- **Vite** (build system)
- **SQLite** (local persistent data)
- **FFmpeg** (media processing)
- **braw-decode** (Blackmagic RAW decoding)

The application is structured around **production workflows for filmmakers.**

---

# Application Modules

## Modules

Top navigation contains four primary modules:

- Modules (system overview)
- Pre-production
- Production
- Post-production

Each module contains independent tools.

Camera Match Lab belongs to:

Production → Camera Match Lab

---

# Production Module

Production tools assist with on-set camera and media operations.

Tools include:

- Camera Match Lab
- Look Setup
- Media inspection tools
- (future) Shot matching

---

# Camera Match Lab

Camera Match Lab compares clips from multiple cameras and produces exposure/color alignment suggestions.

The tool analyzes **representative frames from each clip** and calculates differences.

Typical use case:

Camera A (Hero)
Camera B
Camera C

The system measures:

- Luma
- RGB averages
- highlight distribution
- midtone distribution
- histogram characteristics

It then calculates:

- delta luma
- delta highlights
- delta midtones

and suggests:

- exposure offset
- white balance correction
- highlight alignment adjustments

---

# Media Processing Pipeline

The pipeline is deterministic.

Input clip
↓
Proxy generation (if needed)
↓
Frame extraction
↓
Metric calculation
↓
Analysis comparison
↓
Suggested adjustments
↓
Saved run

---

# BRAW Handling

Blackmagic RAW files require decoding.

The application:

1. detects `.braw`
2. uses `braw-decode`
3. pipes raw frames to `ffmpeg`
4. produces a temporary proxy
5. runs analysis on the proxy

Fallback options:

- software decode
- MP4 override proxy
- frame extraction fallback ladder

---

# Frame Sampling

Match Lab samples a small set of frames.

Default:

5 frames per clip

Frames are spaced evenly through the clip duration.

Each frame is analyzed independently and averaged.

---

# Run Persistence

Each analysis run is stored in SQLite.

Tables include:

production_matchlab_runs  
production_matchlab_results  
production_matchlab_sources

Saved runs allow:

- reopening analysis
- exporting reports
- comparing earlier tests

---

# Export System

Match Lab exports:

- Match Sheet (PDF)
- Match Sheet (Image)

Exports include:

- project metadata
- camera cards
- frame preview
- metrics
- deltas
- suggested adjustments

Exports must remain **visually consistent and branded**.

---

# Design System

All UI styling must use the existing design tokens.

Brand assets are located in:

src/branding

No new color systems should be introduced.

---

# Performance Rules

Media operations must:

- avoid blocking UI
- run through background jobs
- update job status in the Jobs panel

Proxy generation and frame extraction must always complete with:

done  
failed

Never hang.

---

# Reliability Philosophy

The system must fail safely.

If decoding fails:

- the error is surfaced
- the user can retry
- or provide an MP4 proxy

Analysis must never crash the application.