use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraMatchRgbMedians {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraMatchFrameMetrics {
    pub frame_index: u32,
    pub timestamp_ms: u64,
    pub frame_path: String,
    pub extraction_strategy: Option<String>,
    pub width: u32,
    pub height: u32,
    pub luma_histogram: Vec<u32>,
    pub rgb_medians: CameraMatchRgbMedians,
    pub luma_median: f64,
    pub highlight_percent: f64,
    pub midtone_density: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraMatchAggregateMetrics {
    pub luma_histogram: Vec<f64>,
    pub rgb_medians: CameraMatchRgbMedians,
    pub luma_median: f64,
    pub highlight_percent: f64,
    pub midtone_density: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraMatchAnalysisResult {
    pub source_path: String,
    pub clip_path: String,
    pub clip_name: String,
    pub representative_frame_path: String,
    pub frame_paths: Vec<String>,
    pub per_frame: Vec<CameraMatchFrameMetrics>,
    pub aggregate: CameraMatchAggregateMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabProxyResult {
    pub proxy_path: String,
    pub reused_proxy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabRunResultInput {
    pub slot: String,
    pub proxy_path: Option<String>,
    pub analysis: CameraMatchAnalysisResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabRunSummary {
    pub run_id: String,
    pub project_id: String,
    pub hero_slot: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabRunResult {
    pub slot: String,
    pub proxy_path: Option<String>,
    pub representative_frame_path: String,
    pub frame_paths: Vec<String>,
    pub analysis: CameraMatchAnalysisResult,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabRun {
    pub run_id: String,
    pub project_id: String,
    pub hero_slot: String,
    pub created_at: String,
    pub results: Vec<ProductionMatchLabRunResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrawDecoderCaps {
    pub found: bool,
    pub executable_path: Option<String>,
    pub supports_stdout: bool,
    pub supports_output_flag: bool,
    pub help_excerpt: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MatchLabProxyAttempt {
    pub job_id: String,
    pub running: bool,
    pub last_failed_at_ms: Option<i64>,
}

#[derive(Default)]
pub struct MatchLabProxyTracker {
    pub attempts: Mutex<HashMap<String, MatchLabProxyAttempt>>,
}

pub fn build_cache_dir(
    cache_root: &str,
    project_id: &str,
    camera_slot: &str,
    clip_path: &str,
) -> PathBuf {
    Path::new(cache_root)
        .join("production")
        .join("cache")
        .join("match_lab")
        .join(project_id)
        .join(camera_slot)
        .join(hash_string(clip_path))
}

pub fn build_proxy_dir(
    cache_root: &str,
    project_id: &str,
    camera_slot: &str,
    clip_path: &str,
) -> PathBuf {
    Path::new(cache_root)
        .join("production")
        .join("cache")
        .join("match_lab")
        .join(project_id)
        .join(camera_slot)
        .join("proxy")
        .join(hash_source_signature(clip_path))
}

pub fn build_proxy_paths(
    cache_root: &str,
    project_id: &str,
    camera_slot: &str,
    clip_path: &str,
) -> (PathBuf, PathBuf, PathBuf) {
    let root = build_proxy_dir(cache_root, project_id, camera_slot, clip_path);
    let final_path = root.join("proxy.mp4");
    let tmp_path = root.join("proxy.tmp.mp4");
    (root, final_path, tmp_path)
}

pub fn build_proxy_decode_path(root: &Path) -> PathBuf {
    root.join("decoded.tmp.mov")
}

pub fn clip_name_from_path(clip_path: &str) -> String {
    Path::new(clip_path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| clip_path.to_string())
}

pub fn is_braw_path(clip_path: &str) -> bool {
    Path::new(clip_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("braw"))
        .unwrap_or(false)
}

pub fn hash_source_signature(clip_path: &str) -> String {
    let mut signature = clip_path.to_string();
    if let Ok(metadata) = std::fs::metadata(clip_path) {
        signature.push_str(&format!("::{}", metadata.len()));
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                signature.push_str(&format!("::{}", duration.as_secs()));
            }
        }
    }
    hash_string(&signature)
}

pub fn build_frame_timestamps(duration_ms: u64, frame_count: u32) -> Vec<u64> {
    let duration_ms = duration_ms.max(1);
    let max_frames_for_duration = ((duration_ms as f64 / 250.0).floor() as u32).max(1);
    let safe_count = frame_count.clamp(1, 12).min(max_frames_for_duration);
    let duration = duration_ms as f64;
    let start = (duration * 0.05).clamp(0.0, duration - 1.0);
    let end = (duration * 0.95).clamp(start, duration - 1.0);

    if safe_count == 1 || end <= start {
        return vec![((start + end) * 0.5).round().clamp(0.0, duration - 1.0) as u64];
    }

    let step = (end - start) / (safe_count.saturating_sub(1) as f64);
    (0..safe_count)
        .map(|index| {
            (start + step * index as f64)
                .round()
                .clamp(0.0, duration - 1.0) as u64
        })
        .collect()
}

pub fn extract_jpeg_frame_with_fallbacks(
    input_path: &str,
    timestamp_ms: u64,
    output_path: &Path,
) -> Result<FrameExtractionSuccess, String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to prepare match lab cache: {}", e))?;
    }
    validate_frame_output_path(output_path)?;

    let tmp_path = build_temp_jpeg_path(output_path);
    if tmp_path.exists() && tmp_path.is_dir() {
        return Err(format!("Match Lab frame temp path is a directory: {}", tmp_path.display()));
    }
    if tmp_path.exists() {
        let _ = std::fs::remove_file(&tmp_path);
    }

    let fallback_timestamp = timestamp_ms.saturating_sub(1000).max(200);
    let attempted_timestamps = if fallback_timestamp == timestamp_ms {
        vec![timestamp_ms]
    } else {
        vec![timestamp_ms, fallback_timestamp]
    };
    let strategies = build_extraction_strategies();
    let mut attempted_labels = Vec::new();
    let mut last_stderr_tail = String::new();

    for timestamp in attempted_timestamps.iter().copied() {
        for strategy in strategies.iter() {
            attempted_labels.push(format!("{} @ {}ms", strategy.label, timestamp));
            let attempt = run_frame_extraction_attempt(input_path, &tmp_path, timestamp, strategy);
            match attempt {
                Ok(()) => {
                    if output_path.exists() {
                        let _ = std::fs::remove_file(output_path);
                    }
                    std::fs::rename(&tmp_path, output_path).map_err(|e| {
                        format!(
                            "Failed to finalize extracted frame.\nInput: {}\nOutput: {}\n{}",
                            input_path,
                            output_path.display(),
                            e
                        )
                    })?;
                    return Ok(FrameExtractionSuccess {
                        used_timestamp_ms: timestamp,
                        strategy_label: strategy.label.to_string(),
                    });
                }
                Err(stderr_tail) => {
                    last_stderr_tail = stderr_tail;
                    let _ = std::fs::remove_file(&tmp_path);
                }
            }
        }
    }

    Err(format!(
        "Could not decode frames from this clip. Try generating a proxy (H.264/H.265) and re-run.\nInput: {}\nAttempted timestamps: {}\nStrategies: {}\nDetails:\n{}",
        input_path,
        attempted_timestamps
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(", "),
        attempted_labels.join(" | "),
        if last_stderr_tail.is_empty() {
            "ffmpeg did not return stderr output".to_string()
        } else {
            last_stderr_tail
        }
    ))
}

pub fn choose_source_path_for_analysis(clip_path: &str) -> Result<String, String> {
    let extension = Path::new(clip_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if extension == "braw" {
        return Err("BRAW analysis requires a proxy (MP4). Generate proxy first.".to_string());
    }

    if is_ffmpeg_reliable_extension(&extension) {
        return Ok(clip_path.to_string());
    }

    Err(format!(
        "Analysis source is not supported directly for .{} files. Provide an MP4 proxy first.",
        extension
    ))
}

pub fn analysis_timeout() -> Duration {
    Duration::from_secs(45)
}

fn is_ffmpeg_reliable_extension(extension: &str) -> bool {
    matches!(extension, "mp4" | "mov" | "mxf" | "mkv" | "avi" | "webm" | "m4v")
}

#[derive(Clone, Copy)]
struct ExtractionStrategy {
    label: &'static str,
    seek_mode: SeekMode,
    hwaccel_none: bool,
    ignore_decode_errors: bool,
    force_pixel_format: bool,
}

#[derive(Clone, Copy)]
enum SeekMode {
    Fast,
    Accurate,
}

pub struct FrameExtractionSuccess {
    pub used_timestamp_ms: u64,
    pub strategy_label: String,
}

fn build_extraction_strategies() -> [ExtractionStrategy; 5] {
    [
        ExtractionStrategy {
            label: "primary",
            seek_mode: SeekMode::Fast,
            hwaccel_none: false,
            ignore_decode_errors: false,
            force_pixel_format: false,
        },
        ExtractionStrategy {
            label: "software-decode",
            seek_mode: SeekMode::Fast,
            hwaccel_none: true,
            ignore_decode_errors: false,
            force_pixel_format: false,
        },
        ExtractionStrategy {
            label: "ignore-corrupt",
            seek_mode: SeekMode::Fast,
            hwaccel_none: false,
            ignore_decode_errors: true,
            force_pixel_format: false,
        },
        ExtractionStrategy {
            label: "safe-seek-order",
            seek_mode: SeekMode::Accurate,
            hwaccel_none: false,
            ignore_decode_errors: false,
            force_pixel_format: false,
        },
        ExtractionStrategy {
            label: "force-yuv420p",
            seek_mode: SeekMode::Fast,
            hwaccel_none: false,
            ignore_decode_errors: false,
            force_pixel_format: true,
        },
    ]
}

fn run_frame_extraction_attempt(
    input_path: &str,
    output_path: &Path,
    timestamp_ms: u64,
    strategy: &ExtractionStrategy,
) -> Result<(), String> {
    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let timestamp = format!("{:.3}", timestamp_ms as f64 / 1000.0);
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    if strategy.hwaccel_none {
        command.args(["-hwaccel", "none"]);
    }
    if strategy.ignore_decode_errors {
        command.args(["-err_detect", "ignore_err", "-fflags", "+discardcorrupt"]);
    }
    match strategy.seek_mode {
        SeekMode::Fast => {
            command.args(["-ss", &timestamp, "-i", input_path]);
        }
        SeekMode::Accurate => {
            command.args(["-i", input_path, "-ss", &timestamp]);
        }
    }
    let vf = if strategy.force_pixel_format {
        "scale=1280:-2:flags=lanczos,format=yuv420p"
    } else {
        "scale='min(1280,iw)':-2:flags=bicubic"
    };
    command.args([
        "-an",
        "-sn",
        "-dn",
        "-frames:v",
        "1",
        "-vf",
        vf,
        "-q:v",
        "2",
        &output_path.to_string_lossy(),
    ]);

    let output = command
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(tail_lines(&stderr, 20));
    }
    if !output_path.exists() {
        return Err("ffmpeg reported success but did not create the frame output".to_string());
    }
    let size = std::fs::metadata(output_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size == 0 {
        return Err("ffmpeg created an empty frame output".to_string());
    }
    Ok(())
}

fn build_temp_jpeg_path(output_path: &Path) -> PathBuf {
    let parent = output_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = output_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "frame".to_string());
    parent.join(format!("{}.tmp.jpg", stem))
}

fn validate_frame_output_path(output_path: &Path) -> Result<(), String> {
    if output_path.exists() && output_path.is_dir() {
        return Err(format!(
            "Match Lab frame output path is a directory: {}",
            output_path.display()
        ));
    }
    Ok(())
}

pub fn analyze_frame(
    frame_index: u32,
    timestamp_ms: u64,
    frame_path: &Path,
    extraction_strategy: Option<String>,
) -> Result<CameraMatchFrameMetrics, String> {
    let image = ::image::open(frame_path)
        .map_err(|e| format!("Failed to read extracted frame {}: {}", frame_path.display(), e))?
        .to_rgb8();
    let (width, height) = image.dimensions();
    let total_pixels = (width as u64).saturating_mul(height as u64).max(1);
    let total_pixels_f64 = total_pixels as f64;

    let mut luma_histogram = vec![0u32; 256];
    let mut red_histogram = vec![0u64; 256];
    let mut green_histogram = vec![0u64; 256];
    let mut blue_histogram = vec![0u64; 256];
    let mut highlight_pixels = 0u64;
    let mut midtone_pixels = 0u64;

    for pixel in image.pixels() {
        let red = pixel[0] as usize;
        let green = pixel[1] as usize;
        let blue = pixel[2] as usize;
        let luma = ((0.2126 * red as f64) + (0.7152 * green as f64) + (0.0722 * blue as f64))
            .round()
            .clamp(0.0, 255.0) as usize;
        let luma_normalized = luma as f64 / 255.0;

        luma_histogram[luma] += 1;
        red_histogram[red] += 1;
        green_histogram[green] += 1;
        blue_histogram[blue] += 1;

        if luma_normalized > 0.95 {
            highlight_pixels += 1;
        }
        if (0.4..=0.7).contains(&luma_normalized) {
            midtone_pixels += 1;
        }
    }

    let luma_median = histogram_median_u32(&image_hist_to_u64(&luma_histogram));

    Ok(CameraMatchFrameMetrics {
        frame_index,
        timestamp_ms,
        frame_path: frame_path.to_string_lossy().to_string(),
        extraction_strategy,
        width,
        height,
        luma_histogram,
        rgb_medians: CameraMatchRgbMedians {
            red: histogram_median(&red_histogram),
            green: histogram_median(&green_histogram),
            blue: histogram_median(&blue_histogram),
        },
        luma_median,
        highlight_percent: highlight_pixels as f64 / total_pixels_f64,
        midtone_density: midtone_pixels as f64 / total_pixels_f64,
    })
}

pub fn aggregate_frames(per_frame: &[CameraMatchFrameMetrics]) -> CameraMatchAggregateMetrics {
    let frame_count = per_frame.len().max(1) as f64;
    let mut mean_histogram = vec![0.0f64; 256];
    let mut red_values = Vec::with_capacity(per_frame.len());
    let mut green_values = Vec::with_capacity(per_frame.len());
    let mut blue_values = Vec::with_capacity(per_frame.len());
    let mut luma_values = Vec::with_capacity(per_frame.len());
    let mut highlight_values = Vec::with_capacity(per_frame.len());
    let mut midtone_values = Vec::with_capacity(per_frame.len());

    for frame in per_frame {
        for (index, bin) in frame.luma_histogram.iter().enumerate() {
            mean_histogram[index] += *bin as f64 / frame_count;
        }
        red_values.push(frame.rgb_medians.red);
        green_values.push(frame.rgb_medians.green);
        blue_values.push(frame.rgb_medians.blue);
        luma_values.push(frame.luma_median);
        highlight_values.push(frame.highlight_percent);
        midtone_values.push(frame.midtone_density);
    }

    CameraMatchAggregateMetrics {
        luma_histogram: mean_histogram,
        rgb_medians: CameraMatchRgbMedians {
            red: median_of_values(&mut red_values),
            green: median_of_values(&mut green_values),
            blue: median_of_values(&mut blue_values),
        },
        luma_median: median_of_values(&mut luma_values),
        highlight_percent: mean_of_values(&highlight_values),
        midtone_density: mean_of_values(&midtone_values),
    }
}

fn histogram_median(histogram: &[u64]) -> f64 {
    let total: u64 = histogram.iter().sum();
    if total == 0 {
        return 0.0;
    }
    let midpoint = total / 2;
    let mut cumulative = 0u64;
    for (index, count) in histogram.iter().enumerate() {
        cumulative += *count;
        if cumulative >= midpoint {
            return index as f64 / 255.0;
        }
    }
    1.0
}

fn histogram_median_u32(histogram: &[u64]) -> f64 {
    histogram_median(histogram)
}

fn image_hist_to_u64(histogram: &[u32]) -> Vec<u64> {
    histogram.iter().map(|value| *value as u64).collect()
}

fn median_of_values(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = values.len() / 2;
    if values.len() % 2 == 0 {
      (values[mid - 1] + values[mid]) * 0.5
    } else {
      values[mid]
    }
}

fn mean_of_values(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

fn hash_string(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

pub fn validate_proxy_output_path(input_path: &str, output_path: &Path) -> Result<(), String> {
    if input_path.contains("file://") {
        return Err(format!("Proxy input path must be a filesystem path, got URI-style path: {}", input_path));
    }
    let output_string = output_path.to_string_lossy();
    if output_string.contains("file://") {
        return Err(format!("Proxy output path must be a filesystem path, got URI-style path: {}", output_string));
    }
    if output_path.exists() && output_path.is_dir() {
        return Err(format!("Proxy output path is a directory: {}", output_path.display()));
    }
    Ok(())
}

pub fn probe_braw_decoder() -> BrawDecoderCaps {
    let executable_path = locate_braw_decoder();
    let Some(executable_path) = executable_path else {
        return BrawDecoderCaps {
            found: false,
            executable_path: None,
            supports_stdout: false,
            supports_output_flag: false,
            help_excerpt: "braw-decode not found".to_string(),
            version: None,
        };
    };

    let help_output = Command::new(&executable_path)
        .arg("--help")
        .output()
        .or_else(|_| Command::new(&executable_path).arg("-h").output());

    let (help_text, help_excerpt) = match help_output {
        Ok(output) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let excerpt = combined
                .lines()
                .filter(|line| !line.trim().is_empty())
                .take(2)
                .collect::<Vec<_>>()
                .join(" | ");
            (combined.to_lowercase(), excerpt)
        }
        Err(error) => (
            String::new(),
            format!("help unavailable: {}", error),
        ),
    };

    let version = Command::new(&executable_path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            combined
                .lines()
                .find(|line| !line.trim().is_empty())
                .map(|line| line.trim().to_string())
        });

    let supports_output_flag = help_text.contains("--output")
        || help_text.contains("-o ")
        || help_text.contains(" output file");
    let supports_stdout = help_text.contains("stdout")
        || help_text.contains("pipe")
        || help_text.contains("ffmpeg")
        || help_text.contains(" -f ");

    BrawDecoderCaps {
        found: true,
        executable_path: Some(executable_path),
        supports_stdout,
        supports_output_flag,
        help_excerpt,
        version,
    }
}

pub fn probe_braw_ffmpeg_format(caps: &BrawDecoderCaps, input_path: &str) -> Result<String, String> {
    let executable = caps
        .executable_path
        .as_ref()
        .ok_or("Decoder executable missing".to_string())?;
    let output = Command::new(executable)
        .args(["-f", input_path])
        .output()
        .map_err(|e| format!("Failed to run braw-decode -f: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "braw-decode format probe failed: {}",
            tail_lines(&stderr, 20)
        ));
    }
    let fmt_args = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if fmt_args.is_empty() {
        return Err("braw-decode returned empty ffmpeg format args".to_string());
    }
    Ok(fmt_args)
}

pub fn create_braw_proxy_via_stdout(
    caps: &BrawDecoderCaps,
    input_path: &str,
    output_path: &Path,
) -> Result<(), String> {
    let executable = caps
        .executable_path
        .as_ref()
        .ok_or("Decoder executable missing".to_string())?;
    let fmt_args = probe_braw_ffmpeg_format(caps, input_path)?;
    validate_proxy_output_path(input_path, output_path)?;

    let mut braw_decode_cmd = Command::new(executable);
    braw_decode_cmd
        .args(["-c", "rgba", input_path])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut braw_child = braw_decode_cmd
        .spawn()
        .map_err(|e| format!("Failed to start braw-decode: {}", e))?;
    let stdout = braw_child
        .stdout
        .take()
        .ok_or("Failed to capture braw-decode stdout".to_string())?;

    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let mut ffmpeg_args: Vec<String> = vec!["-hide_banner".to_string(), "-y".to_string()];
    ffmpeg_args.extend(fmt_args.split_whitespace().map(|value| value.to_string()));
    ffmpeg_args.extend(proxy_ffmpeg_args(output_path));

    let mut ffmpeg_child = Command::new(ffmpeg)
        .args(ffmpeg_args)
        .stdin(Stdio::from(stdout))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let ffmpeg_status = ffmpeg_child
        .wait()
        .map_err(|e| format!("Failed waiting for ffmpeg: {}", e))?;
    let braw_status = braw_child
        .wait()
        .map_err(|e| format!("Failed waiting for braw-decode: {}", e))?;

    let ffmpeg_stderr = read_child_stderr(&mut ffmpeg_child);
    let braw_stderr = read_child_stderr(&mut braw_child);

    if !ffmpeg_status.success() || !braw_status.success() {
        let exit_code = ffmpeg_status
            .code()
            .or_else(|| braw_status.code())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let excerpt = if !ffmpeg_stderr.trim().is_empty() {
            tail_lines(&ffmpeg_stderr, 20)
        } else {
            tail_lines(&braw_stderr, 20)
        };
        return Err(format!(
            "Input: {}\nOutput: {}\nExit code: {}\n{}",
            input_path,
            output_path.display(),
            exit_code,
            excerpt
        ));
    }

    Ok(())
}

pub fn create_braw_proxy_via_file(
    caps: &BrawDecoderCaps,
    input_path: &str,
    decoded_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let executable = caps
        .executable_path
        .as_ref()
        .ok_or("Decoder executable missing".to_string())?;
    validate_proxy_output_path(input_path, decoded_path)?;
    validate_proxy_output_path(input_path, output_path)?;

    let output_flag = if caps.help_excerpt.to_lowercase().contains("--output") {
        "--output"
    } else {
        "-o"
    };
    let decode_output = Command::new(executable)
        .args([input_path, output_flag, &decoded_path.to_string_lossy()])
        .output()
        .map_err(|e| format!("Failed to start braw-decode file output: {}", e))?;
    if !decode_output.status.success() {
        return Err(format!(
            "Input: {}\nOutput: {}\nExit code: {}\n{}",
            input_path,
            decoded_path.display(),
            decode_output
                .status
                .code()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            tail_lines(&String::from_utf8_lossy(&decode_output.stderr), 20)
        ));
    }

    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let ffmpeg_output = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-y",
            "-i",
            &decoded_path.to_string_lossy(),
        ])
        .args(proxy_ffmpeg_args(output_path))
        .output()
        .map_err(|e| format!("Failed to run ffmpeg for proxy encode: {}", e))?;
    if !ffmpeg_output.status.success() {
        return Err(format!(
            "Input: {}\nOutput: {}\nExit code: {}\n{}",
            decoded_path.display(),
            output_path.display(),
            ffmpeg_output
                .status
                .code()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            tail_lines(&String::from_utf8_lossy(&ffmpeg_output.stderr), 20)
        ));
    }
    let _ = std::fs::remove_file(decoded_path);
    Ok(())
}

fn read_child_stderr(child: &mut std::process::Child) -> String {
    let mut stderr_output = String::new();
    if let Some(stderr) = child.stderr.as_mut() {
        let _ = stderr.read_to_string(&mut stderr_output);
    }
    stderr_output
}

fn tail_lines(value: &str, limit: usize) -> String {
    let lines: Vec<&str> = value.lines().collect();
    let start = lines.len().saturating_sub(limit);
    lines[start..].join("\n")
}

fn locate_braw_decoder() -> Option<String> {
    if let Ok(output) = Command::new("which").arg("braw-decode").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    let common_paths = [
        "/usr/local/bin/braw-decode",
        "/opt/homebrew/bin/braw-decode",
        "/usr/bin/braw-decode",
    ];
    common_paths
        .into_iter()
        .find(|path| Path::new(path).exists())
        .map(|path| path.to_string())
}

fn proxy_ffmpeg_args(output_path: &Path) -> Vec<String> {
    vec![
        "-vf".to_string(),
        "scale=min(1920\\,iw):-2".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-crf".to_string(),
        "18".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "160k".to_string(),
        output_path.to_string_lossy().to_string(),
    ]
}
