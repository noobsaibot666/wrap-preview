use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

pub fn find_executable(name: &str) -> String {
    // 1. Try to find as a Tauri Sidecar first
    if let Some(handle) = APP_HANDLE.get() {
        let arch = std::env::consts::ARCH;
        let os = if cfg!(target_os = "macos") { "apple-darwin" } else if cfg!(target_os = "windows") { "pc-windows-msvc" } else { "unknown-linux-gnu" };
        let target = format!("{}-{}", arch, os);
        
        // Try local bin directory (Dev mode / Local build)
        // We look for: src-tauri/bin/name-target
        let project_root = handle.path().app_config_dir()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default();
        
        let local_bin = project_root.join("src-tauri").join("bin");

        let sidecar_name = if cfg!(target_os = "windows") {
            format!("{}-{}.exe", name, target)
        } else {
            format!("{}-{}", name, target)
        };

        let dev_path = local_bin.join(&sidecar_name);
        if dev_path.exists() {
            return dev_path.to_string_lossy().to_string();
        }

        // Try standard resource path (Production mode)
        // Sidecars are usually in "resources/bin/..." or similar depending on bundle
        if let Ok(path) = handle.path().resolve(format!("bin/{}", sidecar_name), tauri::path::BaseDirectory::Resource) {
             if path.exists() {
                 return path.to_string_lossy().to_string();
             }
        }
    }

    // 2. Try which (useful for dev environment where tools are in PATH)
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }

    // 3. Check common macOS paths (legacy fallback)
    #[cfg(target_os = "macos")]
    {
        let common_paths = [
            "/usr/local/bin", 
            "/opt/homebrew/bin", 
            "/usr/bin", 
            "/bin",
            "/Applications/Adobe Premiere Pro 2024/Adobe Premiere Pro 2024.app/Contents/Plugins/Common/BRAW_Adobe_Plugin.bundle/Contents/Resources",
            "/Library/Application Support/Blackmagic Design/Blackmagic RAW"
        ];
        for path in common_paths {
            let full_path = std::path::PathBuf::from(path).join(name);
            if full_path.exists() {
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    // Fallback to name and hope it's in PATH anyway
    name.to_string()
}

/// Helper to run a command that might be a sidecar (reserved for future shell migration)
#[allow(dead_code)]
pub fn create_command(name: &str) -> Command {
    if let Some(handle) = APP_HANDLE.get() {
        if let Ok(_sidecar_command) = handle.shell().sidecar(name) {
            // This returns a tauri_plugin_shell::process::Command
            // Our code currently expects std::process::Command.
            // This is a major difference in Tauri 2. 
            // To be truly production-ready, we should migrate to tauri_plugin_shell::process::Command.
        }
    }
    Command::new(find_executable(name))
}
