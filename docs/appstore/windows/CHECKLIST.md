# Microsoft Store (Windows) Asset Requirements

This checklist covers the specific visual and textual assets required for submission to the Microsoft Partner Center for Windows distribution.

## 1. Visual Assets

| Asset Type | Required Size | Format | Notes |
| :--- | :--- | :--- | :--- |
| **Store Logo** | 512 x 512 px | PNG | Displayed in the central store listing. |
| **Square 44x44 Logo** | 44 x 44 px | PNG | Used for taskbar and small app lists. Usually requires a simplified version. |
| **Square 150x150 Logo** | 150 x 150 px | PNG | Primary Tile logo for the Start Menu. |
| **Screenshots (Primary)**| 1920 x 1080 px | PNG/JPG | 16:9 Ratio. High quality UI representation. |
| **Hero Art** | 1920 x 1080 px | PNG | Visual used at the top of the store page. Must NOT contain text. |

> [!TIP]
> **Microsoft Store Asset Kit**: Use the official Figma kit for perfectly aligning these assets. Ensure you run the "Windows App Certification Kit" to verify your package's visual integration.

---

## 2. Store Metadata (Copy)

**App Title**: CineFlow Suite
**Short Description**: Professional Creative Suite for Filmmakers & Photographers.

### **Large Description**
> **CineFlow Suite: Directing Digital Excellence.**
>
> CineFlow Suite is a high-performance, integrated digital suite designed specifically for the needs of modern filmmakers, photographers, art directors, and directors. It provides the speed and accuracy required for elite-level creative support, from storyboard to final asset management.
>
> **Support Your Vision:**
> *   **Better Accuracy**: Our precision calculators and shot list tools ensure that every technical detail—from focal lengths to scene timing—is executed with perfection.
> *   **Work Faster**: Lightning-fast duplicate identification and media management tools designed for high-pressure DIT and photography environments.
> *   **Creative Agency**: Empower directors and art directors with specialized planning modules that simplify complex technical coordination.
>
> **Desktop-Native Performance**
> Built with Rust/Tauri, CineFlow Suite is lightweight, secure, and preserves your privacy by processing all data locally. No cloud latency, no subscription barriers.
>
> *Work better, work faster, and lead your production with CineFlow.*

**Search Keywords**: 
filmmaker, photography, cine, shotlist, DIT tools, photo suite, creative studio, director suite, accurate cinema tools

### Partner Center fields

#### Short description

> CineFlow Suite is a desktop-native production toolkit for filmmakers and creative teams, combining media review, planning utilities, thumbnail generation, duplicate detection, and module-based micro apps for prep, on-set, and post workflows.

#### Default description

> CineFlow Suite is a desktop-native production toolkit for filmmakers, photographers, and creative teams. It helps organize planning, review media locally, generate thumbnails and previews, manage references, and support on-set and post-production workflows from one app.
>
> The app is built for fast local use on desktop hardware. Media, previews, and project data are processed and stored locally so teams can work without requiring a cloud workflow.
>
> CineFlow Suite is designed for practical production tasks such as shot planning, media review, duplicate checking, visual references, export support, and production utilities used across prep, set, and post.

#### What's new in this version?

> Initial Microsoft Store release of CineFlow Suite with desktop-native planning, review, media utility, and production workflow tools.

#### Product features

- Local media review and playback
- Module-based micro apps for prep, review, and production tasks
- Shot planning and production utilities
- Thumbnail and preview generation
- Duplicate media detection
- Reference and layout tools
- Desktop-native local workflow

#### Additional system requirements

> CineFlow Suite works primarily with local files and local app storage. Some workflows such as Review Core require importing local media before playback, thumbnails, and review features become available.

#### Minimum hardware

> Windows 10 or Windows 11, 64-bit system, 4 GB RAM, dual-core CPU, DirectX 11 compatible graphics, keyboard and mouse, local storage for media and generated previews.

#### Recommended hardware

> Windows 11, 8 GB RAM or more, quad-core CPU, DirectX 12 compatible graphics, SSD storage, keyboard and mouse, and additional free space for local media, thumbnails, previews, and proxy files.

#### Additional information

> Built for desktop-first production workflows using local media, local processing, and modular tools for prep, review, and post.

#### Keywords

> filmmaking, production, media review, shot list, thumbnails, duplicate finder, on-set tools, post-production, creative workflow, desktop utility

#### Copyright and trademark info

> CineFlow Suite. All rights reserved.

#### Developed by

> ExposeU

#### Applicable license terms

> CineFlow Suite is licensed, not sold. You may install and use one licensed copy of the app on Windows devices you own or control, subject to Microsoft Store terms. You may not reverse engineer, redistribute, resell, lease, sublicense, or use the app in violation of applicable law. ExposeU retains all rights, title, and interest in the software and related content.

---

## 3. Certification Notes for Microsoft Testers

Use this text in Partner Center under:

`Notes for certification`

### Suggested certification note

> CineFlow Suite is a desktop-native creative workflow app for local media planning, review, and production support.
>
> Tester guidance:
> - No Microsoft account, app-specific login, subscription, or purchase is required.
> - The app uses local files and local app storage only.
> - Internet access is not required for normal use.
> - Open the app and enter any module from the landing screen.
> - Review Core and media playback require importing local media files first.
> - If no media is imported, some review areas will be empty by design.
> - The app may generate local cache/preview files for thumbnails and proxies.
> - No external hardware, companion app, or separate service is required.

### Internal checklist

- Paste the certification note above into Partner Center before submission.
- Keep the wording aligned with the exact build being submitted.
- If a build includes a restricted or unfinished module, mention it explicitly in certification notes.
- If a workflow requires sample media, attach that guidance in certification notes and keep sample files available to testers.
