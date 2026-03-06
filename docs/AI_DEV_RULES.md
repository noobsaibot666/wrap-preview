# Wrap Preview – AI Development Rules

This repository is maintained with assistance from AI coding agents.

AI must follow strict rules to maintain stability.

---

# Rule 1 – Preserve Architecture

Do not change the application architecture unless explicitly requested.

Never rewrite core modules without approval.

---

# Rule 2 – Prefer Extension Over Refactoring

When implementing new features:

extend existing components instead of replacing them.

Avoid rewriting working systems.

---

# Rule 3 – Avoid UI Drift

Do not:

- redesign layouts
- introduce new color systems
- change typography scales
- alter grid structures

Use the existing design system.

---

# Rule 4 – Respect Production Stability

Production tools are used during real shoots.

Changes must prioritize reliability.

Avoid risky changes to:

- media pipeline
- proxy generation
- frame extraction
- export system

---

# Rule 5 – Small Changes Only

Prefer minimal code modifications.

Avoid large refactors unless required.

---

# Rule 6 – No Breaking Changes

Existing workflows must continue to function.

Match Lab must always support:

- BRAW
- MP4
- MOV
- cached runs
- export

---

# Rule 7 – Deterministic Behavior

All media analysis must remain deterministic.

Do not introduce randomness or unstable heuristics.

---

# Rule 8 – Validate Before Finishing

Before completing a task:

Ensure:

npm run build passes  
cargo check passes  

UI layout remains stable.

---

# Rule 9 – Preserve Branding

All styling must use tokens from:

src/branding

Do not invent new visual systems.

---

# Rule 10 – Professional Output

Exports must remain readable and usable by:

- DIT
- colorist
- cinematographer