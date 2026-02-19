# Changelog

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

### Changed
- Version bumped to `1.0.0-beta.1` across app metadata.

