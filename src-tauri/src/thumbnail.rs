use std::path::Path;
use std::process::Command;

/// Minimum skip time in seconds (skip first 0.5s)
const SKIP_SECONDS: f64 = 0.5;

/// Max width for thumbnails
const MAX_WIDTH: u32 = 640;

/// Luminance threshold for black frame rejection (0-255)
const BLACK_THRESHOLD: f64 = 15.0;

/// Calculate smart sampling timestamps for a clip
pub fn calculate_timestamps(duration_ms: u64, count: u32, range_secs: Option<u32>) -> Vec<u64> {
    let duration_secs = duration_ms as f64 / 1000.0;
    let sampling_duration = match range_secs {
        Some(r) if r > 0 => (r as f64).min(duration_secs),
        _ => duration_secs,
    };

    if sampling_duration <= SKIP_SECONDS * 2.0 {
        // Very short sampling window or clip — just sample the middle of it
        return vec![(sampling_duration * 500.0) as u64];
    }

    let usable_start = SKIP_SECONDS;
    let usable_duration = (sampling_duration - usable_start * 2.0).max(0.1);

    if count <= 1 {
        return vec![(sampling_duration * 500.0) as u64];
    }

    let mut timestamps = Vec::new();
    for i in 0..count {
        // Evenly space samples across the usable duration
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

    let status = if is_braw(input_path) {
        extract_braw_thumbnail(input_path, output_path, timestamp_ms)?
    } else {
        let ffmpeg = crate::tools::find_executable("ffmpeg");
        Command::new(ffmpeg)
            .args([
                "-ss",
                &ts_str,
                "-i",
                input_path,
                "-vframes",
                "1",
                "-vf",
                &format!("scale={}:-1", MAX_WIDTH),
                "-pix_fmt",
                "yuv420p",
                "-q:v",
                "6",
                "-y",
                output_path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {}", e))?
    };

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

fn is_braw(input_path: &str) -> bool {
    Path::new(input_path)
        .extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("braw"))
        .unwrap_or(false)
}

fn shell_quote(value: &str) -> String {
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

fn probe_fps(input_path: &str) -> Option<f64> {
    let ffprobe = crate::tools::find_executable("ffprobe");
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=r_frame_rate",
            "-of",
            "default=nw=1:nk=1",
            input_path,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let rate = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if rate.is_empty() {
        return None;
    }
    if let Some((a, b)) = rate.split_once('/') {
        let num = a.trim().parse::<f64>().ok()?;
        let den = b.trim().parse::<f64>().ok()?;
        if den > 0.0 {
            return Some(num / den);
        }
        return None;
    }
    rate.parse::<f64>().ok()
}

fn extract_braw_thumbnail(
    input_path: &str,
    output_path: &str,
    timestamp_ms: u64,
) -> Result<std::process::Output, String> {
    let ff_fmt = Command::new("braw-decode")
        .args(["-f", input_path])
        .output()
        .map_err(|e| format!("Failed to run braw-decode -f: {}", e))?;
    if !ff_fmt.status.success() {
        return Err(format!(
            "braw-decode format probe failed: {}",
            String::from_utf8_lossy(&ff_fmt.stderr)
        ));
    }

    let fmt_args = String::from_utf8_lossy(&ff_fmt.stdout).trim().to_string();
    if fmt_args.is_empty() {
        return Err("braw-decode returned empty ffmpeg format args".to_string());
    }

    let fps = probe_fps(input_path).unwrap_or(24.0);
    let frame_index = ((timestamp_ms as f64 / 1000.0) * fps).round().max(0.0) as u64;
    let frame_end = frame_index.saturating_add(1);
    let cmd = format!(
        "braw-decode -c rgba -i {frame} -o {frame_end} {input} | ffmpeg {fmt} -vframes 1 -vf scale={w}:-1 -f image2 -vcodec png -update 1 -y {output}",
        frame = frame_index,
        frame_end = frame_end,
        input = shell_quote(input_path),
        fmt = fmt_args,
        w = MAX_WIDTH,
        output = shell_quote(output_path)
    );

    Command::new("sh")
        .args(["-lc", &cmd])
        .output()
        .map_err(|e| format!("Failed to run BRAW thumbnail pipeline: {}", e))
}

/// Check if a thumbnail image is mostly black by sampling its mean luminance
fn is_black_frame(image_path: &str) -> bool {
    let ffprobe = crate::tools::find_executable("ffprobe");
    // Escape path for lavfi filter: ' -> \', , -> \, : -> \:
    let escaped_path = image_path
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace(",", "\\,")
        .replace(":", "\\:");

    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-f",
            "lavfi",
            "-i",
            &format!("movie='{}',signalstats", escaped_path),
            "-show_entries",
            "frame_tags=lavfi.signalstats.YAVG",
            "-of",
            "csv=p=0",
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
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
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
        if let Some(cf) = cancel_flag {
            if cf.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Cancelled".to_string());
            }
        }
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
    extract_thumbnail(input_path, output_path, target_ms).map(|_| target_ms)
}
