use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

pub fn find_executable(name: &str) -> String {
    let requested_path = std::path::Path::new(name);
    if requested_path.is_absolute() || requested_path.components().count() > 1 {
        if requested_path.exists() {
            return name.to_string();
        }
    }

    // 1. Try to find as a Tauri Sidecar first
    if let Some(handle) = APP_HANDLE.get() {
        // Production bundles can strip the target triple from externalBin sidecars.
        // In that case the binary lands next to the app executable itself.
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join(if cfg!(target_os = "windows") {
                    format!("{}.exe", name)
                } else {
                    name.to_string()
                });
                if candidate.exists() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }

        let arch = std::env::consts::ARCH;
        let os = if cfg!(target_os = "macos") {
            "apple-darwin"
        } else if cfg!(target_os = "windows") {
            "pc-windows-msvc"
        } else {
            "unknown-linux-gnu"
        };
        let target = format!("{}-{}", arch, os);

        // Dev mode: look for the triple-suffixed binary in src-tauri/bin/
        let project_root = handle
            .path()
            .app_config_dir()
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

        // macOS/Linux production: resolve via Tauri resource path
        #[cfg(not(target_os = "windows"))]
        if let Ok(path) = handle.path().resolve(
            format!("bin/{}", sidecar_name),
            tauri::path::BaseDirectory::Resource,
        ) {
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }
    }

    // 2. Try which (Unix only — `which` does not exist on Windows)
    #[cfg(not(target_os = "windows"))]
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

/// Create a process Command with the correct executable path and Windows flags.
/// This is the preferred way to spawn FFmpeg/FFprobe/REDline as it suppresses
/// the console window blizzard on Windows.
pub fn create_command(name: &str) -> Command {
    let executable = find_executable(name);

    #[cfg(not(target_os = "windows"))]
    {
        Command::new(executable)
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new(executable);

        // Windows: suppress console window for child processes
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
}

#[cfg(test)]
mod tests {
    use super::find_executable;

    #[test]
    fn missing_executable_lookup_does_not_recurse() {
        let missing_name = "__cineflow_missing_executable_for_lookup_test__";

        assert_eq!(find_executable(missing_name), missing_name);
    }

    #[test]
    fn absolute_executable_path_is_used_directly() {
        assert_eq!(find_executable("/bin/sh"), "/bin/sh");
    }
}
