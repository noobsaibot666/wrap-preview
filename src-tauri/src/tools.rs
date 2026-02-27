use std::path::PathBuf;
use std::process::Command;

pub fn find_executable(name: &str) -> String {
    // 1. Try which
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }

    // 2. Check common macOS paths
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
