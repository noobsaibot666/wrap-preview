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
    // 1. Try to find as a Tauri Sidecar first (recommended for App Store)
    if let Some(handle) = APP_HANDLE.get() {
        if let Ok(_sidecar) = handle.shell().sidecar(name) {
            // We need to get the path of the sidecar. 
            // In Tauri 2, sidecar() returns a Command builder, but we want the path for some logic.
            // However, most of our logic uses Command::new(path).
            // Sidecars are special. Let's try to resolve the path manually if sidecar(name) exists.
            
            // For now, let's just use the name and hope the sidecar logic handles it, 
            // OR we can return a special token.
        }
    }

    // 2. Try which
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }

    // 3. Check common macOS paths
    let common_paths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    for path in common_paths {
        let full_path = PathBuf::from(path).join(name);
        if full_path.exists() {
            return full_path.to_string_lossy().to_string();
        }
    }

    // Fallback to name and hope it's in PATH anyway
    name.to_string()
}

/// Helper to run a command that might be a sidecar
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
