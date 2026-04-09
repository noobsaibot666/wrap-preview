# 📦 CineFlow Suite - Store Submission Checklist

This document tracks all visual and written assets required for the macOS App Store and Microsoft Windows Store.

---

## 🖋️ Marketing Copy (Professional & High-End)

Use this high-impact copy during the onboarding of your store pages.

### **Product Name:** 
CineFlow Suite

### **One-Line Pitch:** 
The high-performance production brain for modern filmmakers.

### **Short Description:** 
CineFlow Suite is a professional-grade ecosystem designed for Directors, DPs, and Editors. From technical pre-production and on-set verification to post-production ingest, CineFlow Suite protects your vision and streamlines your media workflow.

### **Key Value Propositions:**
1. **Absolute Truth:** Professional media verification and safe-copy tools that ensure your footage is protected from set to suite.
2. **Technical Precision:** Precision-engineered modules for lens math, depth-of-field planning, and equipment management.
3. **Infinite Review:** Zero-latency review core with native LUT support and frame-accurate metadata extraction.
4. **Local-First Privacy:** All processing happens on your machine. Your media never leaves your sight.

---

## 🖼️ Visual Assets: macOS App Store

| Asset Name | Required Size | Notes |
| :--- | :--- | :--- |
| **App Icon** | 1024 x 1024 | Handled via `src-tauri/icons/icon.icns` |
| **Screenshots (Primary)** | 1280 x 800 | Minimum required. High-res recommended (2880 x 1800). |
| **Screenshots (Secondary)** | 1440 x 900 | For Retina displays. |
| **Promotional Image** | 3000 x 3000 | Used for featuring on the App Store. |
| **App Preview (Video)** | 1920 x 1080 | 30s max. Highly recommended for CineFlow. |

---

## 🖼️ Visual Assets: Windows Store

| Asset Name | Required Size | Notes |
| :--- | :--- | :--- |
| **App Icon (Square)** | 300 x 300 | Primary store listing icon. |
| **Small Square Logo** | 71 x 71 | Used for Windows Start menu. |
| **Wide Logo/Banner** | 620 x 300 | Displayed in search results and collections. |
| **Store Logo** | 50 x 50 | Minimal logo for badge placement. |
| **High-Res Screenshots** | 1920 x 1080 | Or 3840 x 2160 (4K) for modern high-DPI displays. |

---

## ✅ Final Pre-Submission Task List

- [ ] **Generate Final Build:** Run `npm run tauri build` on both Mac and Windows.
- [ ] **Screenshot Capture:** Target each main module:
    - *Home*: The overall high-level dashboard.
    - *Production*: Frame Preview & Match Lab (displaying LUTs).
    - *Review*: The multi-camera grid layout.
    - *Pre-Prod*: The professional Shot List view.
- [ ] **Version Matching:** Ensure `tauri.conf.json` version matches your App Store Connect draft.
- [ ] **Privacy Link:** Use the `/docs/appstore/PRIVACY_POLICY.md` content for the required Privacy URL.
