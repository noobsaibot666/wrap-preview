# Licensing Implementation Checklist

## Phase 1: Infrastructure Setup
- [ ] Set up Stripe Product and Price for CineFlow Suite
- [ ] Develop Lightweight License Server (Node.js/Rust)
    - [ ] Stripe Webhook integration (`checkout.session.completed`)
    - [ ] License key generation logic
    - [ ] HWID activation tracking (Max 2 machines)
    - [ ] Activation Token signing (Ed25519)
- [ ] Deploy Server to TrueNAS (Docker)
- [ ] Expose Server API (Cloudflare Tunnel/Tailscale)

## Phase 2: App Integration (Direct Build Only)
- [ ] Define `direct-dist` feature in `Cargo.toml`
- [ ] Implement HWID generation in Rust
- [ ] Create `license.rs` module (Feature-gated)
    - [ ] Activation command (API call to TrueNAS)
    - [ ] Local token storage (Encrypted/Obfuscated)
    - [ ] Startup verification logic
- [ ] Implement Activation UI in Frontend
    - [ ] License key input screen
    - [ ] Activation status feedback

## Phase 3: Security & Hardening
- [ ] Implement String Obfuscation for API endpoints
- [ ] Configure Release Profile (LTO, Stripping)
- [ ] Set up Direct Distribution build script (`npm run build:direct`)

## Phase 4: Distribution
- [ ] macOS Notarization workflow for Direct Distribution
- [ ] Windows Code Signing (Standard/EV)
- [ ] Configure Tauri Updater for non-store builds

---
*Last Updated: 2026-05-01*
