use std::process::Command;
use std::path::Path;

/// Minimum skip time in seconds (skip first 0.5s)
const SKIP_SECONDS: f64 = 0.5;

/// Max width for thumbnails
const MAX_WIDTH: u32 = 640;

/// Luminance threshold for black frame rejection (0-255)
const BLACK_THRESHOLD: f64 = 15.0;

/// Calculate smart sampling timestamps for a clip
pub fn calculate_timestamps(duration_ms: u64, count: u32) -> Vec<u64> {
    let duration_secs = duration_ms as f64 / 1000.0;

    if duration_secs <= SKIP_SECONDS * 2.0 {
        // Very short clip — just sample the middle
        return vec![duration_ms / 2];
    }

    let usable_start = SKIP_SECONDS;
    let usable_duration = (duration_secs - usable_start * 2.0).max(0.1);

    if count <= 1 {
        return vec![(duration_ms / 2)];
    }

    let mut timestamps = Vec::new();
    for i in 0..count {
        // Evenly space samples across the usable duration
        // e.g. for count=3, positions [0.1, 0.5, 0.9]
        // for count=5, positions [0.1, 0.3, 0.5, 0.7, 0.9]
        let pos = 0.1 + (0.8 * (i as f64 / (count - 1) as f64));
        let ts = usable_start + (usable_duration * pos);
        timestamps.push((ts * 1000.0) as u64);
    }
    
    timestamps
}

/// Extract a single thumbnail from a video file at a given timestamp
pub fn extract_thumbnail(
    input_path: &str,
    output_path: &str,
    timestamp_ms: u64,
) -> Result<bool, String> {
    let ts_secs = timestamp_ms as f64 / 1000.0;
    let ts_str = format!("{:.3}", ts_secs);

    // Ensure output directory exists
    if let Some(parent) = Path::new(output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create thumbnail directory: {}", e))?;
    }

    let status = Command::new("ffmpeg")
        .args([
            "-ss", &ts_str,
            "-i", input_path,
            "-vframes", "1",
            "-vf", &format!("scale={}:-1", MAX_WIDTH),
            "-pix_fmt", "yuv420p",
            "-q:v", "6",
            "-y",
            output_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !status.status.success() {
        return Err(format!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&status.stderr)
        ));
    }

    // Check if the frame is black
    if is_black_frame(output_path) {
        return Ok(false); // rejected
    }

    Ok(true) // accepted
}

/// Check if a thumbnail image is mostly black by sampling its mean luminance
fn is_black_frame(image_path: &str) -> bool {
    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-f", "lavfi",
            "-i", &format!("movie={},signalstats", image_path),
            "-show_entries", "frame_tags=lavfi.signalstats.YAVG",
            "-of", "csv=p=0",
        ])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = stdout.lines().next() {
                if let Ok(avg) = line.trim().parse::<f64>() {
                    return avg < BLACK_THRESHOLD;
                }
            }
            false // If we can't determine, assume it's not black
        }
        Err(_) => false,
    }
}

/// Try to extract a valid (non-black) thumbnail, with fallback to nearby timestamps
pub fn extract_with_fallback(
    input_path: &str,
    output_path: &str,
    target_ms: u64,
    duration_ms: u64,
) -> Result<u64, String> {
    // Try the target timestamp first
    match extract_thumbnail(input_path, output_path, target_ms) {
        Ok(true) => return Ok(target_ms),
        Ok(false) => {} // black frame, try fallback
        Err(e) => return Err(e),
    }

    // Fallback: try offsets around the target
    let offsets: Vec<i64> = vec![1000, 2000, -1000, -2000, 3000, -3000];
    for offset in offsets {
        let fallback_ms = (target_ms as i64 + offset).max(0).min(duration_ms as i64) as u64;
        if fallback_ms == target_ms {
            continue;
        }
        match extract_thumbnail(input_path, output_path, fallback_ms) {
            Ok(true) => return Ok(fallback_ms),
            _ => continue,
        }
    }

    // Last resort: use the target anyway (even if black)
    extract_thumbnail(input_path, output_path, target_ms)
        .map(|_| target_ms)
}
