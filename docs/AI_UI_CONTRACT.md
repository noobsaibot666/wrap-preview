You are working inside the Wrap Preview codebase.

This application already has a stable UI system, branding system, and layout architecture.
Your job is to improve functionality WITHOUT breaking visual consistency.

--------------------------------
PRIMARY OBJECTIVE
--------------------------------

Tighten and extend the system while keeping:

• branding consistent
• layout stable
• UI hierarchy unchanged
• component structure predictable
• exports visually consistent

The application must always feel like the same product.

--------------------------------
CRITICAL RULES (DO NOT BREAK)
--------------------------------

1. NEVER introduce new visual styles unless explicitly asked.

Do NOT add:
- new color tokens
- new typography sizes
- new spacing systems
- new component patterns

All styling must reuse existing tokens from:

src/branding

If a style already exists, reuse it.

Consistency overrides creativity.

--------------------------------

2. DO NOT redesign layouts.

Do not:
- move major UI sections
- change component hierarchy
- modify page structure
- create new page layouts

Only refine spacing, sizing, and responsiveness.

--------------------------------

3. Respect existing component architecture.

Prefer extending existing components instead of creating new ones.

Reuse patterns already used in:

- Production modules
- Match Lab UI
- Export views
- Header layouts
- Capsule control groups

--------------------------------

4. Camera Match Lab layout must remain stable.

The layout contract is:

Header
Title + subtitle

Control row
Hero selector
Run selector
Analyze
Export

Main grid
3 camera columns

Each camera column contains:
- file info
- frame preview
- histogram overlay
- metrics
- deltas
- adjustments

Do not change this hierarchy.

--------------------------------

5. Export layout must remain branded.

Match Sheet export must:

• keep the branded header
• maintain camera card structure
• emphasize DELTAS and ADJUSTMENTS
• remain readable as a printed sheet
• preserve consistent spacing

Exports must always look like a professional technical document.

--------------------------------

6. UI spacing rules

Use existing spacing scale.

Never invent new gaps.

Preferred patterns:

section spacing
component padding
card margins
grid gaps

must match other modules.

--------------------------------

7. Text layout rules

Paths must always:
- be one line
- truncate with ellipsis
- never expand layout width

Buttons must:
- remain single line
- never wrap text

--------------------------------

8. Card sizing rules

Camera cards must:

• never overflow container
• never overlap
• always respect the main wrapper width
• scale via grid only

Preview frames must:
- stay inside a fixed aspect container
- never control layout width

--------------------------------

9. Changes must be surgical.

When modifying code:

• change the smallest amount possible
• avoid rewriting large files
• avoid renaming components unnecessarily
• avoid changing interfaces unless required

--------------------------------

10. Verify after changes

Before finishing any task ensure:

UI does not visually shift
Brand tokens are respected
Grid layout remains stable
Exports still render correctly
npm run build passes
cargo check passes

--------------------------------

DESIGN PHILOSOPHY

Consistency > novelty
Clarity > complexity
Stable UI > aesthetic experimentation
Production reliability > refactoring elegance

--------------------------------

OUTPUT EXPECTATION

Make minimal, precise changes that tighten the system
while keeping the visual identity and layout stable.

Never redesign.
Only refine.