# Microsoft Store MSI Submission Runbook

This document records the Windows MSI build and Microsoft Partner Center submission flow for CineFlow Suite.

## Current Submission Files

Local submission folder:

```text
C:\Users\cyrus\Documents\Workgroup\APPS\wrap-preview\microsoft-store-submission
```

Files:

```text
CineFlow Suite_1.0.0_x64_en-US.msi
CineFlowSuite-MSI-localfix-unwind-2.xml
```

Public package URL for Partner Center:

```text
https://expose-u.com/apps/microsoft/CineFlow%20Suite_1.0.0_x64_en-US.msi
```

Expected MSI verification:

```text
Length: 187715584
SHA256: 4CF101A6798C315980D7361C06B3435D9D1802C8E13CD07C96866ACEBD162EE3
```

## Build MSI On Windows

Run from the project root:

```powershell
cd C:\Users\cyrus\Documents\Workgroup\APPS\wrap-preview

git pull --ff-only

Copy-Item "WIN\BlackmagicRawAPI.dll" "src-tauri\bin\BlackmagicRawAPI.dll" -Force
Copy-Item "WIN\ffmpeg-x86_64-pc-windows-msvc.exe" "src-tauri\bin\ffmpeg-x86_64-pc-windows-msvc.exe" -Force
Copy-Item "WIN\ffprobe-x86_64-pc-windows-msvc.exe" "src-tauri\bin\ffprobe-x86_64-pc-windows-msvc.exe" -Force
Copy-Item "WIN\braw_bridge-x86_64-pc-windows-msvc.exe" "src-tauri\bin\braw_bridge-x86_64-pc-windows-msvc.exe" -Force
Copy-Item "WIN\REDline-x86_64-pc-windows-msvc.exe" "src-tauri\bin\REDline-x86_64-pc-windows-msvc.exe" -Force

npm run tauri -- build --bundles msi
```

The MSI output is:

```text
src-tauri\target\release\bundle\msi\CineFlow Suite_1.0.0_x64_en-US.msi
```

## Prepare Submission Folder

Copy the MSI and latest WACK report into the submission folder:

```powershell
New-Item -ItemType Directory -Force "microsoft-store-submission"

Copy-Item "src-tauri\target\release\bundle\msi\CineFlow Suite_1.0.0_x64_en-US.msi" "microsoft-store-submission\" -Force
Copy-Item "store-cert-reports\CineFlowSuite-MSI-localfix-unwind-2.xml" "microsoft-store-submission\" -Force
```

## Host The MSI

The MSI is hosted on the website in:

```text
Y:\www\exposeu\public\apps\microsoft\CineFlow Suite_1.0.0_x64_en-US.msi
```

Copy command:

```powershell
Copy-Item "microsoft-store-submission\CineFlow Suite_1.0.0_x64_en-US.msi" "Y:\www\exposeu\public\apps\microsoft\" -Force
Copy-Item "microsoft-store-submission\CineFlowSuite-MSI-localfix-unwind-2.xml" "Y:\www\exposeu\public\apps\microsoft\" -Force
```

Important: after Microsoft Store submission, do not replace the MSI at the same URL. For the next version, use a new file name and a new versioned URL.

## Verify Public Download

Run this before adding the package in Partner Center:

```powershell
$Url = "https://expose-u.com/apps/microsoft/CineFlow%20Suite_1.0.0_x64_en-US.msi"

Invoke-WebRequest $Url -OutFile "$env:TEMP\cineflow-test.msi"

Get-Item "$env:TEMP\cineflow-test.msi"

Get-FileHash "$env:TEMP\cineflow-test.msi" -Algorithm SHA256
```

The result must match:

```text
Length: 187715584
SHA256: 4CF101A6798C315980D7361C06B3435D9D1802C8E13CD07C96866ACEBD162EE3
```

If the downloaded file is very small or contains HTML, the server is serving the website app instead of the MSI. Fix the website static file path before submitting.

## Partner Center Package Settings

In Microsoft Partner Center:

1. Go to `Packages`.
2. Click `Add package`.
3. Add package URL:

```text
https://expose-u.com/apps/microsoft/CineFlow%20Suite_1.0.0_x64_en-US.msi
```

4. Set architecture to `x64`.
5. Set package type to `MSI` if asked.
6. Installer parameters:

```text
/quiet /norestart
```

7. Do not check `Installer runs in silent mode but does not require switches`.
8. Save and continue.

## WACK Status

Latest accepted local report:

```text
store-cert-reports\CineFlowSuite-MSI-localfix-unwind-2.xml
```

Status:

```text
WARNING, not FAIL
```

The previous `Crashes and hangs` failure was cleared by the Windows Tauri teardown hardening.

Remaining warnings:

```text
Unsigned binaries / MSI
ffmpeg / ffprobe WXCheck
SystemTemp writes
Uninstall cleanup
```

Follow-up plan:

```text
Unsigned binaries / MSI: resolve later with EV/OV certificate and signtool.exe.
ffmpeg / ffprobe WXCheck: replace with NX-compatible FFmpeg builds when ready.
SystemTemp writes: treat as Windows Installer / WACK warning unless Microsoft rejects it.
Uninstall cleanup: monitor; it may improve after signing and avoiding AV file locks.
```
