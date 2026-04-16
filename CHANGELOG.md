# Changelog

## 1.0.0-rc.1 — macOS App Store Readiness

### Added
- **Production Entitlements**: Added `com.apple.security.files.bookmarks.app-scope` for persistent filesystem access within the Sandbox.
- **Privacy Metadata**: Initialized `src-tauri/Info.plist` with mandatory App Store privacy descriptions (Camera, Microphone, Photo Library).
- **Embedded Libraries**: Added a dedicated `libs/` and `Frameworks/` strategy to bundle the RED SDK and Qt frameworks.

### Fixed
- **Sidecar Sandboxing**: Hardened `REDline` sidecar by bundling 40+ missing `.dylib` dependencies and 19 Qt frameworks. 
- **RPATH Patching**: Relinked `REDline` binaries (`aarch64` and `x86_64`) to look for dependencies internally using `@loader_path`, bypassing global system paths blocked by the Mac App Store sandbox.

### Changed
- Updated `tauri.conf.json` with production identifier `com.cineflow.suite` and Mac App Store category `public.app-category.video`.

## 1.0.0-beta.1

### Added
- Unified JobManager tracking across thumbnails, waveform, verification, clustering, Resolve export, and Director Pack export.
- Jobs panel with progress and cancellation.
- About panel with app/build/ffmpeg/system metadata.
- Feedback diagnostics bundle export (`.zip`).
- Director Pack unified export command and deterministic folder structure.
- Structured Resolve FCPXML generation with block/camera/select/master organization.
- Contact Sheet filter controls (All, Picks, Rating >= N).
- Resolve export scope: Current View Filter.

### Improved
- Verification background pipeline error handling and logging (no panic-style unwrap paths in background processing).
- Export confirmation prompts and output-folder opening behavior.
- XML escaping and deterministic export tests.
- Filmstrip metadata tags now include RAW-oriented fields with graceful fallback: `FMT`, `CODEC`, `ISO`, `WB`, and `TC`, plus unified metadata-row rendering in print/export layouts.
- Media Workspace launcher order and disabled-state hints were aligned; Jobs is now globally accessible in header with live status indicator.
- Review keyboard flow is scoped to review tabs and now includes focused clip ring + scroll-into-view.
- Rejected clips are now excluded from selection/export consistently in UI and backend export scope resolution.
- Review toolbar was streamlined to `Sort → Filter → Layout → View → Selection → Export`, and export-name input was removed from that toolbar row.
- Backend verification/contact PDF exports now include branded header/footer + smart-copy line.
- Safe Copy now supports a persisted 5-row verification queue per project with sequential execution, queue cancellation, per-row report exports, and combined branded Markdown/PDF queue reports.

### Changed
- Version bumped to `1.0.0-beta.1` across app metadata.
