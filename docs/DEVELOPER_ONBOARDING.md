# Wrap Preview — Developer Onboarding Guide

Welcome to the **Wrap Preview** project! This document serves as a high-level overview of the application's features, architecture, and modules to help new developers quickly understand the system and start contributing.

## System Overview

Wrap Preview is a professional offline tool designed for directors, cinematographers, and editors to verify, review, and prepare footage for post-production. It emphasizes high performance, data integrity, and a premium visual aesthetic.

### Architecture

- **Frontend:** React, TypeScript, Vite. The UI is built with a focus on a highly customized, premium "dark mode" aesthetic using plain CSS (no structural CSS frameworks like Tailwind).
- **Backend:** Rust, Tauri v2. The backend handles all heavy lifting, including file system operations, media extraction, hashing, and database interactions.
- **Database:** SQLite (persisted locally via Rust backend). Used for caching metadata, job statuses, queue management, and project configurations.
- **Communication:** Tauri IPC (`invoke` for commands, `listen` for real-time events).

---

## Core Workspaces & Features

The application is divided into two primary workspaces: **Pre-Production** and **Media Workspace**.

### 1. Pre-Production Workspace

This workspace focuses on planning and organizing a project before shooting begins.

- **Folder Creator:**
  - **Purpose:** Allows users to generate a standardized directory structure for their project media.
  - **Features:**
    - Interactive UI to add, delete, and rename folders and subfolders.
    - Supports importing a custom JSON schema to instantly populate a deeply nested folder architecture.
    - Exports the generated structure as a `.zip` archive or directly creates it on the local filesystem.

### 2. Media Workspace

This is the core operational area for handling footage during and after production. It provides tools for media review, curation, manipulation, and verification.

- **Contact Sheet (Clip Reviewing & Curation):**
  - **Purpose:** A visual decision engine for reviewing imported media clips.
  - **Features:**
    - **Ingest:** Deep scans directories for supported media files (video/audio).
    - **Thumbnails:** Extracts high-quality thumbnails using `ffmpeg` via the Rust backend.
    - **Review Logging:** Users can rate clips, add operational flags (e.g., "Overexposed", "Audio Issue"), mark them as Selects/Rejects, and input custom metadata (description, scene, take).
    - **Filtering & Sorting:** Robust filtering by camera, resolution, framerate, audio presence, and manual reordering via drag-and-drop or hotkeys (`Ctrl+Number`).
    - **LUT Support:** Allows applying `.cube` LUTs to video clips for accurate color previewing.
- **Safe Copy (Media Verification):**
  - **Purpose:** Ensures deterministic, 1:1 data integrity when transferring footage off memory cards/drives.
  - **Features:**
    - **Queue System:** Supports up to 5 concurrent verification pairs executing sequentially.
    - **Modes:**
      - *FAST Mode:* Compares file metadata (size, timestamp) for rapid checks.
      - *SOLID Mode:* Performs bit-level hashing using Blake3 to guarantee exact parity.
    - **Discrepancy Detection:** Identifies missing files, extra files in the destination, unreadable files, and size/hash mismatches.
- **Lookbook (Visual Storyboarding):**
  - **Purpose:** A fluid canvas for organizing curated 'Selects' into sequences or mood boards.
  - **Features:**
    - Drag-and-drop interface for arranging selected thumbnail frames.
    - Exportable layout for director/DP review.

---

## Shared Systems & Utilities

- **Job Manager (HUD):**
  - An async queue manager running in the Rust backend that handles long-running processes (thumbnail extraction, LUT rendering, Safe Copy hashing).
  - The frontend features an animated, electric-blue progress indicator in the header to show active job states without interrupting the user's workflow.
- **Export Engine Engine & Reporting:**
  - Generates professional PDFs and Markdown reports for various modules.
  - **Contact Sheet Exporter:** Generates visual PDFs of selected footage with applied metadata and LUTs.
  - **Safe Copy Exporter:** Generates pagination-safe PDF audit logs of queue pair transfers.
  - **FCPXML Export:** Allows users to export curated selections directly to Final Cut Pro or DaVinci Resolve timelines.
- **Branding System:**
  - The UI relies heavily on strict CSS tokens defined in `index.css`. The application uses an electric color accent system.
  - Backend logic supports loading external brand profiles (logos, names) to dynamically brand the exported PDFs.

## Developer Quick Start

1. **Environment:** Ensure you have Rust, Node.js, and Tauri dependencies installed.
2. **Run Locally:**
    - Start the development server: `npm run tauri dev`
    - This will compile the Rust backend and start the Vite frontend server.
3. **State Management:** The frontend primarily uses React state and context. Complex state (like the verification queue) is synchronized continuously with the SQLite database via Tauri invokes.
4. **UI Guidelines:**
    - Avoid introducing new UI libraries (Tailwind, Material UI, etc.). Adhere to the existing raw CSS variable structure in `index.css` to maintain the premium dark mode aesthetic.
    - Ensure all new features handle loading states gracefully using the centralized `JobManager`.

Welcome to the team!
