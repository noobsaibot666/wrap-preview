# Resolve Structure Behavior Report

## What We Encode
- `01_BLOCKS`: block timelines (stringouts)
- `02_CAMERAS`: camera timelines (stringouts)
- `03_SELECTS`: picks and per-rating timelines
- `04_MASTER`: optional master stringout
- Clip-level keyword + marker metadata for pick/reject/rating/notes

## Expected Resolve Display
- Resolve imports each encoded project/sequence as importable timeline containers.
- Event naming should be preserved from FCPXML project/event names.
- Marker values should appear exactly as encoded (`PICK`, `REJECT`, `★N`, notes).

## Practical Compromises
- FCPXML does not guarantee identical visual hierarchy semantics across NLEs. Resolve may flatten or reinterpret some event organization.
- We prioritize deterministic naming + timeline generation and metadata stability over strict bin-visual parity.

## Path Behavior
- Current export uses absolute file URI form (`file://localhost...`).
- Requirement for relocated media is documented as: preserve relative folder structure or relink in Resolve when root path changes.
