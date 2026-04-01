# Equipment List Import Format

This file documents the equipment list import format used by the `Shot List` app.

## Current app behavior

The `Import List` button in `Shot List` imports an equipment list written in Markdown.

Supported file extensions:

- `.md`
- `.markdown`
- `.txt`

The markdown is parsed into internal inventory suggestions for the equipment-driven fields in the Shot List UI.

## Supported categories

The importer maps headings and item text into these internal categories:

- `camera`
- `lens`
- `tripod`
- `motion`
- `sound`
- `light`
- `grip`
- `monitor`
- `power`
- `media`
- `misc`

## Markdown input format

The parser supports:

- headings like `# Camera`, `## Sound`, `## Light`
- bullet lists like `- FX3`
- numbered lists like `1. FX3`

Example equipment list:

```md
# Cameras
- Sony FX3
- Blackmagic Pocket 6K

# Lenses
- 24-70mm
- 50mm Prime

# Sound
- Zoom F6
- Shotgun Mic

# Motion
- Ronin RS4
- Slider
```

## How headings are mapped

The importer infers category from the heading text or item text. Examples:

- `# Cameras` -> `camera`
- `# Lenses` -> `lens`
- `# Sound` -> `sound`
- `# Motion` -> `motion`
- `# Light` -> `light`
- `# Grip` -> `grip`
- `# Media` -> `media`

If no category is recognized, the entry falls back to `misc`.

## Notes

- The current `Import List` button does not import `.json`.
- The correct reference format for equipment or rental imports is markdown.
- If a JSON importer is added later, it should be documented separately.
