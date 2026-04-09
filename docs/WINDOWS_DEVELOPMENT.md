# CineFlow Suite - Windows Development Guide

This document outlines the requirements and procedures for building and deploying the native Windows version of CineFlow Suite.

## 1. Prerequisites (Building on Windows)

Tauri requires a Windows machine (or VM) with the following installed:

- **Rust**: Use `rustup` to install the `stable-x86_64-pc-windows-msvc` toolchain.
- **Node.js**: v18 or higher for the frontend.
- **Visual Studio Build Tools**: 2022 or newer with C++ desktop development.
- **WebView2 Runtime**: Standard on Windows 10/11, but required for older systems.

## 2. Sidecar Binaries (MANDATORY)

The application relies on external filmmaking tools. For the Windows version, you must place the following `.exe` files in `src-tauri/bin/`:

| Binary Name | Required Target File Name | Source |
| :--- | :--- | :--- |
| **FFmpeg** | `ffmpeg-x86_64-pc-windows-msvc.exe` | gyan.dev/ffmpeg/builds |
| **FFprobe** | `ffprobe-x86_64-pc-windows-msvc.exe` | gyan.dev/ffmpeg/builds |
| **BRAW Bridge** | `braw_bridge-x86_64-pc-windows-msvc.exe` | Compiled from source |
| **REDline** | `REDline-x86_64-pc-windows-msvc.exe` | RED Digital Cinema SDK |

> [!CAUTION]
> If these exact files are missing, the Windows build will fail. Ensure they are the **x86_64** versions, as Windows ARM support is currently experimental for this project.

## 3. Platform Configuration

The Windows version uses the **NSIS (Nullsoft Scriptable Install System)** for its installer.

- **Installer Path**: `src-tauri/target/release/bundle/nsis/`
- **Icon**: `src-tauri/icons/icon.ico` (A 256x256 multi-layer ICO file).
- **Style**: Windows Native Window Frames are enabled to match the OS aesthetic.

## 4. Maintenance Guidelines

- **Do NOT duplicate the codebase.**
- Use `#[cfg(target_os = "windows")]` in Rust for Windows-only logic.
- Use `#[cfg(target_os = "macos")]` to shield Mac-only features (like Vibrancy or Menu Services).
- In CSS, use media queries for specific styles if scrollbars or fonts look off on Windows.

---

## Changelog
*Last Updated: 2026-04-08*
