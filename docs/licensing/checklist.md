# Licensing Implementation Checklist

## Phase 1: Infrastructure Setup
- [x] Set up Stripe Product and Price for CineFlow Suite
- [x] **Phase 3: Automation & Infrastructure**
    - [x] Stripe Webhook integration (`checkout.session.completed`)
    - [x] Automated Email delivery (Resend integration)
    - [x] Manual Admin CLI for key management
    - [x] Verified end-to-end flow with Stripe CLI
    - [x] HWID activation tracking (Max 2 machines)
    - [x] Activation Token signing (Ed25519)
- [x] Deploy Server to TrueNAS (Docker)
- [x] Expose Server API (Cloudflare Tunnel/Tailscale)

## Phase 2: App Integration (Direct Build Only)
- [x] Define `direct-dist` feature in `Cargo.toml`
- [x] Implement HWID generation in Rust
- [x] Create `license.rs` module (Feature-gated)
    - [x] Activation command (API call to TrueNAS)
    - [x] Local token storage (Encrypted/Obfuscated)
    - [x] Startup verification logic
- [x] Implement Activation UI in Frontend
- [x] License key input screen
- [x] Activation status feedback

## Phase 3: Security & Hardening
- [x] Implement String Obfuscation for API endpoints
- [x] Configure Release Profile (LTO, Stripping)
- [x] Set up Direct Distribution build script (`npm run build:direct`)

## Phase 4: Distribution & Security
- [x] Refined Activation UI (Lavender Accent, 4:5 Card Ratio)
- [x] Visual Admin Dashboard implementation (web_three)
- [ ] macOS Code Signing & Notarization (Apple Developer ID)
- [ ] Windows Code Signing (EV Certificate)
- [ ] Tauri Auto-Updater implementation
- [ ] Dockerize and Deploy Licensing Server to TrueNAS

---
*Last Updated: 2026-05-02*
