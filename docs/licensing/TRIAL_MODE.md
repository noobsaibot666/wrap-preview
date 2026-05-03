# CineFlow Suite — Trial Mode

## Overview

The direct-distribution build includes a **14-day offline trial** that lets users experience a subset of features before purchasing a full license. No account, no server call, and no re-download required — the trial binary is the full app.

---

## How It Works

### Trial Lifecycle

```
First launch (no license, no trial)
  → ActivationScreen: "Activate License" + "Start 14-Day Free Trial" button

User clicks Start Trial
  → init_trial() writes trial.json (one time only — cannot be reset)
  → App loads in trial mode with TrialBanner visible

Day 1–14: full access to trial features, banner counts down
  → TrialBanner changes color: lavender → amber (≤7 days) → red (≤2 days)

Day 15+: trial expired
  → ActivationScreen: "Trial Expired" headline, license form only, no trial button

User buys license and enters key
  → activate_license() returns signed token → saved as license.json
  → licenseMode becomes 'full' → all features unlock, banner disappears
```

### State Machine

The frontend `licenseMode` state drives all gating:

| Value | Condition | UI |
|---|---|---|
| `'loading'` | Startup, license check pending | Spinner |
| `'inactive'` | No license, no trial | ActivationScreen (with trial CTA) |
| `'trial'` | trial.json exists, HWID matches, within 14 days | Full app + TrialBanner + locked modules |
| `'expired'` | trial.json exists, past 14 days | ActivationScreen (expired message) |
| `'full'` | Valid license | Full app, no restrictions |

---

## Feature Access

### Unlocked in Trial (first 3 cards of each module page)

| Module | Feature |
|---|---|
| Pre-Production | Folder Creator, Duplicate Finder, Shot List |
| Production | Project Manager, Look Setup, Camera Match Lab |
| Post-Production | Safe Copy, Media Review, Scene Blocks |

### Locked in Trial (Full License required)

| Module | Feature |
|---|---|
| Pre-Production | Shot Planner, Grid Mosaic, Starter Setup |
| Production | On-Set Coach, Match & Normalize, Frame Preview |
| Post-Production | Delivery |

Locked cards show a **"Full License" badge** (lock icon, pill shape, top-right corner) and are non-clickable.

---

## Backend Implementation

**File:** `src-tauri/src/license.rs`

### Trial State Storage

```
{app_config_dir}/trial.json   ← XOR-obfuscated (key: 0x55), same as license.json
```

Struct stored:
```rust
struct TrialState {
    started_at: i64,  // Unix timestamp — written once, never overwritten
    hwid: String,     // Locks trial to the machine that started it
}
```

### `init_trial()` Tauri Command

Idempotent. If `trial.json` already exists, does nothing and returns the current license status. This is the primary anti-reset mechanism — once written, the file is never updated.

### `check_license()` Decision Tree

1. If `license.json` exists and passes HWID + expiry + Ed25519 checks → **full**
2. If `trial.json` exists, HWID matches, within 14 days → **trial** (returns `trial_days_remaining`)
3. If `trial.json` exists, HWID matches, expired → **trial_expired**
4. If `trial.json` exists, HWID mismatch → **inactive** (prevents copying trial state to another machine)
5. Neither file exists → **inactive**

### `LicenseStatus` Fields (extended)

```rust
pub struct LicenseStatus {
    pub active: bool,
    pub key: Option<String>,
    pub hwid: String,
    pub message: Option<String>,
    pub is_trial: bool,               // true when in active trial
    pub trial_days_remaining: Option<i64>,
    pub trial_expired: bool,
}
```

### Trial Duration

```rust
const TRIAL_DURATION_DAYS: i64 = 14;
```

To change trial length, update this constant in `license.rs` and the button label string in `ActivationScreen.tsx`.

### Feature Flag Isolation

All trial logic (including `init_trial`) is behind `#[cfg(feature = "direct-dist")]`. The App Store build compiles stubs that always return `active: true, is_trial: false` — store builds are completely unaffected.

---

## Frontend Implementation

**Key files:**

| File | Role |
|---|---|
| `src/App.tsx` | `licenseMode` state, `isModuleLocked()`, gate logic, TrialBanner placement |
| `src/components/ActivationScreen.tsx` | `mode` prop (`inactive` \| `expired`), trial CTA button |
| `src/components/TrialBanner.tsx` | Persistent countdown bar above the app |
| `src/components/TrialLockBadge.tsx` | Lock pill badge on locked module cards |
| `src/components/Production/ProductionHome.tsx` | `lockedModuleIds` prop wired to ModuleCard |

### Trial Feature Constants (`App.tsx`)

```typescript
const TRIAL_ALLOWED_MODULES = new Set([
  'folder-creator', 'duplicate-finder', 'shot-list',      // Pre-production
  'project-manager', 'look-setup', 'camera-match-lab',    // Production
  'safe-copy', 'media-review', 'scene-blocks',            // Post-production
]);
```

To unlock or lock a different module, add or remove its ID from this set. No backend changes required.

---

## Upgrading from Trial

The trial binary is the full binary. After purchase:

1. User receives a license key by email (via the licensing server)
2. In the app: click **Upgrade** in the TrialBanner → `alan-design.com/buy` (or use the ActivationScreen during expiry)
3. Enter email + license key → `activate_license()` hits the licensing server
4. A signed `ActivationToken` is returned and saved as `license.json`
5. `licenseMode` becomes `'full'` → all modules unlock, TrialBanner disappears

No re-download. No reinstall.

---

## Security Notes

- Trial state is XOR-obfuscated (same key as `license.json`), not cryptographically sealed. A determined user could edit `trial.json` to reset the timestamp. This is acceptable — the trial is a business mechanism, not a security boundary.
- The HWID check in `trial.json` prevents copying the config directory to a different machine to clone a trial.
- Full license validation (Ed25519 signature + HWID + expiry) remains cryptographically enforced and unrelated to trial logic.
