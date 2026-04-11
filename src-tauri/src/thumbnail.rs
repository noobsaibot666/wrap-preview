use std::path::Path;
use std::process::Command;

/// Minimum skip time in seconds (skip first 0.5s)
const SKIP_SECONDS: f64 = 0.5;

/// Max width for thumbnails
const MAX_WIDTH: u32 = 640;

/// Luminance threshold for black frame rejection (0-255)
const BLACK_THRESHOLD: f64 = 15.0;

/// Image file extensions that need special thumbnail handling
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "tiff", "tif", "bmp", "heic", "heif", "nef", "nrw", "cr2", "cr3", "arw",
];

/// Check if a file path is a still image (not a video)
pub fn is_image_file(input_path: &str) -> bool {
    Path::new(input_path)
        .extension()
        .map(|e| {
            let ext = e.to_string_lossy().to_lowercase();
            IMAGE_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

/// Calculate fixed jump-based timestamps for a clip.
pub fn calculate_jump_timestamps(duration_ms: u64, jump_seconds: u32) -> Vec<u64> {
    let duration_secs = duration_ms as f64 / 1000.0;
    let usable_start = SKIP_SECONDS;
    let usable_end = (duration_secs - usable_start).max(usable_start);
    let jump = (jump_seconds.max(1)) as f64;

    let mut timestamps = Vec::new();
    let mut current = usable_start;
    while current <= usable_end {
        timestamps.push((current * 1000.0) as u64);
        current += jump;
    }

    if timestamps.is_empty() {
        timestamps.push((((usable_start + usable_end) * 0.5) * 1000.0) as u64);
    }

    timestamps
}

/// Extract a thumbnail from a still image file (resize only, no seek)
pub fn extract_image_thumbnail(
    input_path: &str,
    output_path: &str,
) -> Result<bool, String> {
    // Ensure output directory exists
    if let Some(parent) = Path::new(output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create thumbnail directory: {}", e))?;
    }

    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let status = Command::new(ffmpeg)
        .args([
            "-i",
            input_path,
            "-vframes",
            "1",
            "-vf",
            &format!("scale={}:-1", MAX_WIDTH),
            "-pix_fmt",
            "yuvj420p",
            "-q:v",
            "6",
            "-y",
            output_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg for image thumbnail: {}", e))?;

    if !status.status.success() {
        return Err(format!(
            "ffmpeg image thumbnail failed: {}",
            String::from_utf8_lossy(&status.stderr)
        ));
    }

    Ok(true)
}

/// Extract a single thumbnail from a video file at a given timestamp
pub fn extract_thumbnail(
    input_path: &str,
    output_path: &str,
    timestamp_ms: u64,
) -> Result<bool, String> {
    // For image files, use the dedicated image thumbnail extractor
    if is_image_file(input_path) {
        return extract_image_thumbnail(input_path, output_path);
    }

    let ts_secs = timestamp_ms as f64 / 1000.0;
    let ts_str = format!("{:.3}", ts_secs);

    // Ensure output directory exists
    if let Some(parent) = Path::new(output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create thumbnail directory: {}", e))?;
    }

    let is_nev = Path::new(input_path).extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case("nev")).unwrap_or(false);
    
    let status = if is_braw(input_path) {
        extract_braw_thumbnail(input_path, output_path, timestamp_ms)?
    } else {
        let ffmpeg = crate::tools::find_executable("ffmpeg");
        
        // Stage 1: Fast Input Seeking (seeking before -i)
        let mut cmd = Command::new(&ffmpeg);
        if is_nev {
            cmd.args(["-c:v", "tico_raw"]);
        }
        
        let output = cmd.args([
            "-ss", &ts_str,
            "-i", input_path,
            "-vframes", "1",
            "-vf", &format!("scale={}:-1,format=yuv420p", MAX_WIDTH),
            "-q:v", "5",
            "-map", "0:v:0",
            "-y",
            output_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg Stage 1: {}", e))?;

        if output.status.success() {
            output
        } else {
            // Stage 2: Slower but more robust Output Seeking (seeking after -i)
            // This works better for certain AVI, MKV, and mobile HEVC files with sparse keyframes
            let mut cmd2 = Command::new(&ffmpeg);
            if is_nev {
                cmd2.args(["-c:v", "tico_raw"]);
            }
            cmd2.args([
                "-i", input_path,
                "-ss", &ts_str,
                "-vframes", "1",
                "-vf", &format!("scale={}:-1,format=yuv420p", MAX_WIDTH),
                "-q:v", "5",
                "-map", "0:v:0",
                "-y",
                output_path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffmpeg Stage 2: {}", e))?
        }
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
    let braw_decoder = crate::tools::find_executable("braw_bridge");
    let ff_fmt = Command::new(&braw_decoder)
        .args(["-f", input_path])
        .output()
        .map_err(|e| format!("Failed to run BRAW decoder probe ({}): {}", braw_decoder, e))?;
    if !ff_fmt.status.success() {
        // Fallback to "braw-decode" if braw_bridge failed
        let fallback_decoder = crate::tools::find_executable("braw-decode");
        let fallback_fmt = Command::new(&fallback_decoder)
            .args(["-f", input_path])
            .output()
            .map_err(|e| format!("Failed to run BRAW decoder probe fallback ({}): {}", fallback_decoder, e))?;
        
        if !fallback_fmt.status.success() {
            return Err(format!(
                "BRAW decoder format probe failed (tried {} and {}): {}",
                braw_decoder, fallback_decoder,
                String::from_utf8_lossy(&fallback_fmt.stderr)
            ));
        }
        return process_braw_decode(&fallback_decoder, &String::from_utf8_lossy(&fallback_fmt.stdout), input_path, output_path, timestamp_ms);
    }

    process_braw_decode(&braw_decoder, &String::from_utf8_lossy(&ff_fmt.stdout), input_path, output_path, timestamp_ms)
}

fn process_braw_decode(
    decoder: &str,
    fmt_stdout: &str,
    input_path: &str,
    output_path: &str,
    timestamp_ms: u64,
) -> Result<std::process::Output, String> {
    let fmt_args = fmt_stdout.trim().to_string();
    if fmt_args.is_empty() {
        return Err("BRAW decoder returned empty ffmpeg format args".to_string());
    }

    let fps = probe_fps(input_path).unwrap_or(24.0);
    let frame_index = ((timestamp_ms as f64 / 1000.0) * fps).round().max(0.0) as u64;
    let frame_end = frame_index.saturating_add(1);
    
    let ffmpeg = crate::tools::find_executable("ffmpeg");
    
    // On Windows, 'sh -lc' might not be available, so we use a direct command if possible 
    // or cmd.exe. For now, let's keep the shell approach but adapt for platform.
    #[cfg(target_os = "windows")]
    let cmd = format!(
        "\"{}\" -c rgba -i {frame} -o {frame_end} {input} | \"{}\" {fmt} -vframes 1 -vf scale={w}:-1 -f image2 -vcodec png -update 1 -y {output}",
        decoder,
        ffmpeg,
        frame = frame_index,
        frame_end = frame_end,
        input = shell_quote(input_path),
        fmt = fmt_args,
        w = MAX_WIDTH,
        output = shell_quote(output_path)
    );
    
    #[cfg(not(target_os = "windows"))]
    let cmd = format!(
        "{} -c rgba -i {frame} -o {frame_end} {input} | {} {fmt} -vframes 1 -vf scale={w}:-1 -f image2 -vcodec png -update 1 -y {output}",
        decoder,
        ffmpeg,
        frame = frame_index,
        frame_end = frame_end,
        input = shell_quote(input_path),
        fmt = fmt_args,
        w = MAX_WIDTH,
        output = shell_quote(output_path)
    );

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .args(["-lc", &cmd])
            .output()
            .map_err(|e| format!("Failed to run BRAW thumbnail pipeline: {}", e))
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", &cmd])
            .output()
            .map_err(|e| format!("Failed to run BRAW thumbnail pipeline (Windows): {}", e))
    }
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

/// Try to extract a valid (non-black) thumbnail, with fallback to nearby timestamps.
/// For image files, this simply extracts the image thumbnail (no timestamp seeking).
pub fn extract_with_fallback(
    input_path: &str,
    output_path: &str,
    target_ms: u64,
    duration_ms: u64,
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> Result<u64, String> {
    // For image files, just extract once — no timestamp seeking needed
    if is_image_file(input_path) {
        extract_image_thumbnail(input_path, output_path)?;
        return Ok(0);
    }

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
