use std::path::Path;

/// Minimum skip time in seconds (skip first 0.5s)
const SKIP_SECONDS: f64 = 0.5;

/// Max width for thumbnails
const MAX_WIDTH: u32 = 640;

/// Luminance threshold for black frame rejection (0-255)
const BLACK_THRESHOLD: u8 = 15;

/// Maximum number of raw pixel bytes to sample for black-frame detection.
/// 640×360×3 (RGB) = 691 200 — fits any thumbnail we generate.
const BLACK_DETECT_MAX_BYTES: usize = 700_000;

/// Image file extensions that need special thumbnail handling
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "tiff", "tif", "bmp", "heic", "heif", "nef", "nrw", "cr2", "cr3", "arw", "orf", "raf", "dng",
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

    let status = crate::tools::create_command("ffmpeg")
        .args([
            "-nostdin",
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

/// Extract a single thumbnail from a video file at a given timestamp.
///
/// Uses input-seeking (`-ss` before `-i`) for speed. Falls back to
/// output-seeking only when input-seeking genuinely fails (not for MKV/MXF
/// seek inaccuracy — those formats already work fine with input-seeking for
/// thumbnail purposes). A final stage drops `-map 0:v` for containers whose
/// first video stream index is ambiguous.
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

    let ext = Path::new(input_path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let is_r3d = ext == "r3d";
    let is_nev = ext == "nev";

    // NEV (Nikon N-RAW) uses a proprietary codec that FFmpeg cannot decode.
    // Every NEV file embeds a full-HD JPEG preview — extract it directly.
    if is_nev {
        return extract_nev_thumbnail(input_path, output_path);
    }

    // R3D (RED REDCODE RAW) is fully proprietary — FFmpeg, AVFoundation, sips
    // and Quick Look all fail without the RED SDK. Route to dedicated handler
    // that tries REDline → embedded JPEG → metadata placeholder.
    if is_r3d {
        return extract_r3d_thumbnail_safe(input_path, output_path, timestamp_ms);
    }
    
    let status = if is_braw(input_path) {
        Some(extract_braw_thumbnail(input_path, output_path, timestamp_ms))
    } else {
        None
    };

    let scale_filter = format!("scale={}:-1", MAX_WIDTH);

    let status = if let Some(res) = status {
        res?
    } else {

        // ── Stage 1: Fast input-seeking ──
        // `-ss` before `-i` makes ffmpeg jump straight to the nearest keyframe,
        // avoiding decoding from the start. `-noautorotate` skips rotation
        // transform. Short `-analyzeduration` / `-probesize` help MKV, TS, MXF.
        let output = crate::tools::create_command("ffmpeg")
            .args([
                "-nostdin",
                "-ss", &ts_str,
                "-noautorotate",
                "-analyzeduration", "5000000",
                "-probesize", "5000000",
                "-i", input_path,
                "-frames:v", "1",
                "-vf", &scale_filter,
                "-q:v", "5",
                "-map", "0:v:0",
                "-an", "-sn", "-dn",
                "-y",
                output_path,
            ])
            .output()
            .map_err(|e| format!("Failed to run ffmpeg Stage 1: {}", e))?;

        if output.status.success() {
            output
        } else {
            // ── Stage 2: Input-seeking without explicit stream map ──
            // Some containers (e.g. MXF with data streams first, some AVI
            // variants) confuse `-map 0:v:0`. Retry without it.
            let output2 = crate::tools::create_command("ffmpeg")
                .args([
                    "-nostdin",
                    "-ss", &ts_str,
                    "-noautorotate",
                    "-analyzeduration", "5000000",
                    "-probesize", "5000000",
                    "-i", input_path,
                    "-frames:v", "1",
                    "-vf", &scale_filter,
                    "-q:v", "5",
                    "-an", "-sn", "-dn",
                    "-y",
                    output_path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffmpeg Stage 2: {}", e))?;

            if output2.status.success() {
                output2
            } else {
                // ── Stage 3: Output-seeking (last resort) ──
                // Only for genuinely broken containers where input-seeking
                // crashes ffmpeg. This must decode from the start so it's slow
                // but at least produces a frame.
                crate::tools::create_command("ffmpeg")
                    .args([
                        "-nostdin",
                        "-noautorotate",
                        "-analyzeduration", "10000000",
                        "-probesize", "10000000",
                        "-i", input_path,
                        "-ss", &ts_str,
                        "-frames:v", "1",
                        "-vf", &scale_filter,
                        "-q:v", "5",
                        "-an", "-sn", "-dn",
                        "-y",
                        output_path,
                    ])
                    .output()
                    .map_err(|e| format!("Failed to run ffmpeg Stage 3: {}", e))?
            }
        }
    };

    if !status.status.success() {
        return Err(format!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&status.stderr)
        ));
    }

    // Check if the frame is black (fast, in-process pixel check)
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

/// Extract a thumbnail from a Nikon NEV (N-RAW) file.
/// NEV files use Nikon's proprietary NRAW codec which FFmpeg cannot decode.
/// However, every NEV file embeds full JPEG preview images in the container.
/// We use the shared embedded JPEG extractor to find the best preview.
fn extract_nev_thumbnail(
    input_path: &str,
    output_path: &str,
) -> Result<bool, String> {
    extract_embedded_jpeg_preview(input_path, output_path)
        .and_then(|found| {
            if found {
                Ok(true)
            } else {
                Err("No embedded JPEG preview found in NEV file".to_string())
            }
        })
}

fn shell_quote(value: &str) -> String {
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

fn probe_fps(input_path: &str) -> Option<f64> {
    let out = crate::tools::create_command("ffprobe")
        .args([
            "-v",
            "error",
            "-nostdin",
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
/// Safe R3D thumbnail extraction — always produces a thumbnail.
/// Tries REDline → embedded JPEG → generates metadata placeholder.
fn extract_r3d_thumbnail_safe(
    input_path: &str,
    output_path: &str,
    timestamp_ms: u64,
) -> Result<bool, String> {
    // Try the standard R3D extraction (REDline → embedded JPEG)
    if let Ok(_output) = extract_r3d_thumbnail(input_path, output_path, timestamp_ms) {
        if Path::new(output_path).exists() {
            let meta = std::fs::metadata(output_path).ok();
            if meta.map(|m| m.len() > 1000).unwrap_or(false) {
                return Ok(true);
            }
        }
    }

    // Fallback to placeholder
    generate_raw_placeholder(input_path, output_path, "RED R3D", "#e94560", "RED SDK required for preview")
}

/// Shared utility to generate a branded metadata placeholder thumbnail.
/// Used for proprietary formats (R3D, BRAW) when native decoders are unavailable.
///
/// Three-stage fallback so a file is always written:
///   1. FFmpeg lavfi + drawtext (nice label — requires freetype in the ffmpeg build)
///   2. FFmpeg lavfi plain color (no freetype needed)
///   3. Pure-Rust solid-color JPEG via the `image` crate (no ffmpeg needed at all)
fn generate_raw_placeholder(
    input_path: &str,
    output_path: &str,
    label: &str,
    accent_color: &str,
    subtext: &str,
) -> Result<bool, String> {
    let filename = Path::new(input_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| label.to_string());

    let display_name = if filename.len() > 28 {
        format!("{}...", &filename[..25])
    } else {
        filename.clone()
    };

    if let Some(parent) = Path::new(output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    

    // Stage 1: with drawtext — requires libfreetype compiled into ffmpeg.
    let filter_text = format!(
        "color=c=#1a1a2e:s=640x360:d=1,\
         drawtext=text='{}':fontsize=36:fontcolor={}:x=(w-text_w)/2:y=(h-text_h)/2-30,\
         drawtext=text='{}':fontsize=16:fontcolor=#cccccc:x=(w-text_w)/2:y=(h-text_h)/2+20,\
         drawtext=text='{}':fontsize=12:fontcolor=#666666:x=(w-text_w)/2:y=(h-text_h)/2+50",
        label,
        accent_color,
        display_name.replace('\'', "").replace(':', "\\:"),
        subtext,
    );
    if let Ok(r) = crate::tools::create_command("ffmpeg")
        .args(["-nostdin", "-f", "lavfi", "-i", &filter_text, "-frames:v", "1", "-update", "1", "-q:v", "3", "-y", output_path])
        .output()
    {
        if r.status.success() && placeholder_valid(output_path) {
            return Ok(true);
        }
    }

    // Stage 2: plain solid color — no drawtext, no freetype dependency.
    if let Ok(r) = crate::tools::create_command("ffmpeg")
        .args(["-nostdin", "-f", "lavfi", "-i", "color=c=#1a1a2e:s=640x360:d=1", "-frames:v", "1", "-update", "1", "-q:v", "3", "-y", output_path])
        .output()
    {
        if r.status.success() && placeholder_valid(output_path) {
            return Ok(true);
        }
    }

    // Stage 3: pure-Rust JPEG — works even when ffmpeg is missing or broken.
    write_solid_jpeg(output_path, [26, 26, 46])?;
    Ok(placeholder_valid(output_path))
}

fn placeholder_valid(path: &str) -> bool {
    std::fs::metadata(path).map(|m| m.len() > 100).unwrap_or(false)
}

fn write_solid_jpeg(output_path: &str, color: [u8; 3]) -> Result<(), String> {
    use image::{RgbImage, Rgb};
    let mut img = RgbImage::new(640, 360);
    for pixel in img.pixels_mut() {
        *pixel = Rgb(color);
    }
    img.save(output_path)
        .map_err(|e| format!("Failed to write placeholder JPEG: {}", e))
}

fn extract_r3d_thumbnail(
    input_path: &str,
    output_path: &str,
    _timestamp_ms: u64,
) -> Result<std::process::Output, String> {
    // Strategy 1: Try to extract embedded JPEG preview from R3D file.
    // R3D files often contain a preview JPEG in the header area.
    if let Ok(result) = extract_embedded_jpeg_preview(input_path, output_path) {
        if result {
        // Return a synthetic "success" Output to satisfy the type
        return crate::tools::create_command("echo")
            .arg("R3D thumbnail extracted from embedded JPEG")
            .output()
            .map_err(|e| format!("echo failed: {}", e));
        }
    }

    // Strategy 2: Try REDline sidecar
    if true {
        let fps = probe_fps(input_path).unwrap_or(23.976);
        let frame = ((_timestamp_ms as f64 / 1000.0) * fps) as u64;

        if let Ok(output) = crate::tools::create_command("REDline")
            .args([
                "--i", input_path,
                "--o", "thumb",
                "--format", "1", // JPG
                "--res", "4",    // 1/16 res for speed
                "--start", &frame.to_string(),
                "--end", &frame.to_string(),
                "--outDir", &Path::new(output_path).parent().unwrap().to_string_lossy(),
            ])
            .output()
        {
            if output.status.success() {
                // REDline names output files with frame numbers — try to find and rename
                let parent = Path::new(output_path).parent().unwrap();
                if let Ok(entries) = std::fs::read_dir(parent) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("thumb") && name.ends_with(".jpg") {
                            let _ = std::fs::rename(entry.path(), output_path);
                            return Ok(output);
                        }
                    }
                }
            }
        }
    }

    // Strategy 3: Fall through to FFmpeg (caller handles this via None return)
    Err("R3D: no embedded preview found and REDline unavailable, falling back to FFmpeg".to_string())
}

/// Generic embedded JPEG extraction for proprietary RAW video containers.
/// Scans the first N MB for the largest JPEG (FFD8..FFD9) and writes it out.
fn extract_embedded_jpeg_preview(
    input_path: &str,
    output_path: &str,
) -> Result<bool, String> {
    use std::io::Read;

    let mut file = std::fs::File::open(input_path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    // Scan first 10MB for embedded JPEG previews
    let scan_size: usize = 10 * 1024 * 1024;
    let mut buffer = vec![0u8; scan_size];
    let bytes_read = file.read(&mut buffer)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    buffer.truncate(bytes_read);

    let mut jpegs: Vec<(usize, usize)> = Vec::new();
    let mut pos = 0;
    while pos + 3 < bytes_read {
        if buffer[pos] == 0xFF && buffer[pos + 1] == 0xD8 && buffer[pos + 2] == 0xFF {
            if let Some(end_rel) = buffer[pos + 3..]
                .windows(2)
                .position(|w| w[0] == 0xFF && w[1] == 0xD9)
            {
                let end = pos + 3 + end_rel + 2;
                let size = end - pos;
                if size > 5000 { // Only consider JPEGs larger than 5KB (skip tiny icons)
                    jpegs.push((pos, size));
                }
                pos = end;
            } else {
                pos += 1;
            }
        } else {
            pos += 1;
        }
    }

    if jpegs.is_empty() {
        return Ok(false);
    }

    let (best_offset, best_size) = jpegs.iter().copied().max_by_key(|(_o, s)| *s).unwrap();

    if let Some(parent) = Path::new(output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create thumbnail directory: {}", e))?;
    }

    std::fs::write(output_path, &buffer[best_offset..best_offset + best_size])
        .map_err(|e| format!("Failed to write thumbnail: {}", e))?;

    Ok(true)
}

fn extract_braw_thumbnail(
    input_path: &str,
    output_path: &str,
    timestamp_ms: u64,
) -> Result<std::process::Output, String> {
    let braw_decoder = "braw_bridge";
    let fallback_decoder = "braw-decode";
    // Try braw_bridge first
    let bridge_result = crate::tools::create_command("braw_bridge")
        .args(["-f", input_path])
        .output();
    
    match bridge_result {
        Ok(ff_fmt) if ff_fmt.status.success() => {
            return process_braw_decode(braw_decoder, &String::from_utf8_lossy(&ff_fmt.stdout), input_path, output_path, timestamp_ms);
        }
        _ => {
            // Try "braw-decode" fallback
            if let Ok(fallback_fmt) = crate::tools::create_command("braw-decode")
                .args(["-f", input_path])
                .output()
            {
                if fallback_fmt.status.success() {
                    return process_braw_decode(fallback_decoder, &String::from_utf8_lossy(&fallback_fmt.stdout), input_path, output_path, timestamp_ms);
                }
            }
        }
    }

    // Final fallback: try embedded JPEG extraction
    if let Ok(true) = extract_embedded_jpeg_preview(input_path, output_path) {
        return crate::tools::create_command("echo")
            .arg("BRAW thumbnail extracted from embedded JPEG")
            .output()
            .map_err(|e| format!("echo failed: {}", e));
    }

    // Last resort: generate a metadata placeholder
    match generate_raw_placeholder(input_path, output_path, "BRAW", "#4a9eff", "Blackmagic SDK required") {
        Ok(true) => {
            crate::tools::create_command("echo")
                .arg("BRAW placeholder generated")
                .output()
                .map_err(|e| format!("echo failed: {}", e))
        }
        _ => Err(format!(
            "BRAW decoder not available ({}) and placeholder generation failed",
            braw_decoder
        ))
    }
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
    
    // On Windows, 'sh -lc' might not be available, so we use a direct command if possible 
    // or cmd.exe. For now, let's keep the shell approach but adapt for platform.
    #[cfg(target_os = "windows")]
    let cmd = format!(
        "\"{}\" -c rgba -i {frame} -o {frame_end} {input} | \"{}\" {fmt} -vframes 1 -vf scale={w}:-1 -f image2 -vcodec png -update 1 -y {output}",
        decoder,
        crate::tools::find_executable("ffmpeg"),
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
        crate::tools::find_executable("ffmpeg"),
        frame = frame_index,
        frame_end = frame_end,
        input = shell_quote(input_path),
        fmt = fmt_args,
        w = MAX_WIDTH,
        output = shell_quote(output_path)
    );

    #[cfg(not(target_os = "windows"))]
    {
        crate::tools::create_command("sh")
            .args(["-lc", &cmd])
            .output()
            .map_err(|e| format!("Failed to run BRAW thumbnail pipeline: {}", e))
    }
    
    #[cfg(target_os = "windows")]
    {
        crate::tools::create_command("cmd")
            .args(["/C", &cmd])
            .output()
            .map_err(|e| format!("Failed to run BRAW thumbnail pipeline (Windows): {}", e))
    }
}

/// Fast, in-process black-frame check.
///
/// Instead of spawning `ffprobe -f lavfi … signalstats` (which alone takes
/// 200-400ms per frame), we decode the thumbnail we just wrote to raw RGB
/// via a single fast ffmpeg call and compute mean luminance ourselves.
/// For a 640-wide JPEG thumbnail this takes ~10-20ms.
fn is_black_frame(image_path: &str) -> bool {
    // Quick sanity — if the file is missing or tiny, skip
    let meta = match std::fs::metadata(image_path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if meta.len() < 500 {
        return true; // degenerate file, treat as black
    }

    let output = crate::tools::create_command("ffmpeg")
        .args([
            "-nostdin",
            "-i", image_path,
            "-frames:v", "1",
            "-vf", "scale=64:-1",   // tiny decode — 64px wide is plenty for luminance
            "-pix_fmt", "gray",     // single-channel luminance
            "-f", "rawvideo",
            "-y",
            "pipe:1",
        ])
        .output();

    match output {
        Ok(out) if out.status.success() && !out.stdout.is_empty() => {
            let pixels = &out.stdout[..out.stdout.len().min(BLACK_DETECT_MAX_BYTES)];
            let sum: u64 = pixels.iter().map(|&p| p as u64).sum();
            let avg = sum / pixels.len().max(1) as u64;
            avg < BLACK_THRESHOLD as u64
        }
        _ => false, // If we can't determine, assume it's not black
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

    // Fallback: try offsets around the target (reduced set — 4 attempts not 6)
    let offsets: Vec<i64> = vec![1000, 2000, -1000, -2000];
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
