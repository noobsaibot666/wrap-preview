use std::path::Path;
use walkdir::WalkDir;

/// Video file extensions we recognize
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mxf", "avi", "mkv", "prores", "r3d", "braw", "mts", "m4v", "webm", "wmv", "flv",
    "ts", "m2ts", "mpg", "mpeg", "3gp", "ogv",
];

/// Scan a directory recursively and return all video file paths
pub fn scan_folder(root: &str, cancel_flag: Option<&std::sync::atomic::AtomicBool>) -> Vec<String> {
    let mut video_files: Vec<String> = Vec::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if let Some(cf) = cancel_flag {
            if cf.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
        }
        let path = entry.path();
        if path.is_file() && is_video_file(path) {
            if let Some(path_str) = path.to_str() {
                video_files.push(path_str.to_string());
            }
        }
    }

    video_files.sort();
    video_files
}

fn is_video_file(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with("._") {
            return false;
        }
    }
    if let Some(ext) = path.extension() {
        let ext_lower = ext.to_string_lossy().to_lowercase();
        VIDEO_EXTENSIONS.contains(&ext_lower.as_str())
    } else {
        false
    }
}
