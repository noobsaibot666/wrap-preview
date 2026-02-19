# Known Issues

## 1) Job state persistence
- Job state is in-memory only and not persisted across app restarts.

## 2) Resolve hierarchy interpretation
- Resolve may flatten or reinterpret parts of FCPXML event organization depending on import behavior.

## 3) Media path assumptions
- FCPXML currently uses absolute file URIs. If media root changes, relink may be required in Resolve.

## 4) Director Pack PDF fidelity
- Director Pack contact sheet PDF is backend-generated summary PDF and may not exactly match the on-screen print layout styling.

## 5) Long-running cancellation
- Cancellation is cooperative for some compute-heavy loops and may not stop instantly.

