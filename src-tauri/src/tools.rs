use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

pub fn find_executable(name: &str) -> String {
    // 1. Try to find as a Tauri Sidecar first
    if let Some(handle) = APP_HANDLE.get() {
        use tauri_plugin_shell::ShellExt;
        if let Ok(_sidecar_command) = handle.shell().sidecar(name) {
            // In Tauri 2, we can't easily get the raw path from the command builder
            // but we can try to resolve it for known sidecars if they are in the bin folder.
            // For production builds, Tauri manages this. 
            // For our internal "exists" checks, we can use this name.
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
        let common_paths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
        for path in common_paths {
            let full_path = PathBuf::from(path).join(name);
            if full_path.exists() {
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    // 4. Check common Windows paths
    #[cfg(target_os = "windows")]
    {
        let common_paths = [
            "C:\\Program Files",
            "C:\\Program Files (x86)",
            "C:\\Windows\\System32",
        ];
        for path in common_paths {
            let full_path = PathBuf::from(path).join(name);
            if full_path.exists() {
                return full_path.to_string_lossy().to_string();
            }
            let exe_path = PathBuf::from(path).join(format!("{}.exe", name));
            if exe_path.exists() {
                return exe_path.to_string_lossy().to_string();
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
