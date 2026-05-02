# CineFlow Distribution & Security Guide

This document outlines the final steps required for the public release of CineFlow Suite, specifically focusing on security compliance for macOS and Windows.

## 1. macOS Code Signing & Notarization

Apple requires all applications distributed outside the App Store to be **Code Signed** and **Notarized**.

### What is Code Signing?
It is a security technology used to certify that the app was created by you (or your organization) and has not been altered by a third party since it was signed.
*   **Requirement**: An Apple Developer Program membership ($99/year).
*   **Asset**: A "Developer ID Application" certificate.

### What is Notarization?
Notarization is an automated system where Apple scans your software for malicious content. Once approved, the macOS Gatekeeper will allow users to open the app without seeing a "Malicious Software" warning.
*   **Process**: You upload the app to Apple's notary service after signing.
*   **Result**: A "ticket" is stapled to the app, confirming its safety.

### Action Plan (macOS)
1.  **Generate Certificate**: Create a "Developer ID Application" certificate in the Apple Developer portal.
2.  **Configure Tauri**: Update `tauri.conf.json` with the bundle identifier and signing settings.
3.  **Run Build**: Use `apple-codesign` or Xcode tools to sign the `.app` or `.pkg`.
4.  **Submit for Notarization**: Use `xcrun notarytool` to submit the bundle.
5.  **Staple**: Run `xcrun stapler staple` on the final DMG/PKG.

---

## 2. Windows Code Signing (EV Certificate)

Windows uses **Microsoft SmartScreen** to protect users from unverified applications.

### Why do we need it?
Without code signing, users will see a "Windows protected your PC" blue screen warning that prevents them from running the app easily.

### Standard vs. EV (Extended Validation)
*   **Standard**: Gradually builds reputation. Users may still see warnings until the app is downloaded many times.
*   **EV Certificate (Recommended)**: Provides **instant reputation**. The SmartScreen warning disappears immediately. It requires a physical USB token (HSM) for the private key, which is why it's more expensive and secure.

### Action Plan (Windows)
1.  **Purchase Certificate**: Buy an EV Code Signing certificate (e.g., from DigiCert or Sectigo).
2.  **Verification**: Complete the identity verification process (requires business documentation).
3.  **Sign Build**: Use `signtool.exe` during the Tauri build process to sign the `.exe` or `.msi`.

---

## 3. Tauri Auto-Updater

The auto-updater ensures that users always have the latest security patches and features.

### Implementation
1.  **Generate Keys**: Use `tauri signer generate` to create a public/private key pair.
2.  **Public Key**: Add the public key to `tauri.conf.json`.
3.  **Update Server**: Host a simple JSON file (or use a service like Gitea/GitHub Releases) that points to the latest signature and download URL.
4.  **Licensing Check**: The licensing server can optionally be pinged before an update is allowed, though usually updates are free for all holders of a valid key.

---

## 4. Final Distribution Checklist

| Task | Platform | Status |
| :--- | :--- | :--- |
| Verified Resend Domain | Cloud | [ ] Pending |
| macOS Developer ID Cert | macOS | [ ] Pending |
| Windows EV Certificate | Windows | [ ] Pending |
| Licensing Server Deployment | TrueNAS | [ ] Pending |
| Updater Public Key | Tauri | [ ] Pending |
