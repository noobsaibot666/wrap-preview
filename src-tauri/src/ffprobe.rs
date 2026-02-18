use serde::{Deserialize, Serialize};
use std::process::Command;

/// Metadata extracted from a video clip via ffprobe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipMetadata {
    pub filename: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub duration_ms: u64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub audio_summary: String,
    pub timecode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Option<Vec<FfprobeStream>>,
    format: Option<FfprobeFormat>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    tags: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    filename: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    tags: Option<serde_json::Value>,
}

/// Run ffprobe on a file and parse the JSON output into ClipMetadata
pub fn probe_file(file_path: &str) -> Result<ClipMetadata, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            file_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let probe: FfprobeOutput =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    let format = probe.format.ok_or("No format info from ffprobe")?;
    let streams = probe.streams.unwrap_or_default();

    // Find video stream
    let video_stream = streams.iter().find(|s| {
        s.codec_type.as_deref() == Some("video")
    });

    // Find audio streams
    let audio_streams: Vec<&FfprobeStream> = streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .collect();

    // Parse FPS from r_frame_rate (e.g., "24000/1001")
    let fps = video_stream
        .and_then(|s| s.r_frame_rate.as_ref())
        .map(|r| parse_frame_rate(r))
        .unwrap_or(0.0);

    // Parse duration
    let duration_secs: f64 = format
        .duration
        .as_ref()
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);
    let duration_ms = (duration_secs * 1000.0) as u64;

    // Parse file size
    let size_bytes: u64 = format
        .size
        .as_ref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Get filename from path
    let filename = std::path::Path::new(file_path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());

    // Video codec
    let video_codec = video_stream
        .and_then(|s| s.codec_name.clone())
        .unwrap_or_else(|| "unknown".to_string());

    // Resolution
    let width = video_stream.and_then(|s| s.width).unwrap_or(0);
    let height = video_stream.and_then(|s| s.height).unwrap_or(0);

    // Audio summary
    let audio_summary = if audio_streams.is_empty() {
        "No audio".to_string()
    } else {
        let track_count = audio_streams.len();
        let first_codec = audio_streams[0]
            .codec_name
            .as_deref()
            .unwrap_or("unknown");
        let channels = audio_streams[0].channels.unwrap_or(0);
        let ch_label = match channels {
            1 => "Mono",
            2 => "Stereo",
            6 => "5.1",
            8 => "7.1",
            _ => "Multi",
        };
        if track_count == 1 {
            format!("{} ({})", first_codec.to_uppercase(), ch_label)
        } else {
            format!("{} tracks, {} ({})", track_count, first_codec.to_uppercase(), ch_label)
        }
    };

    // Timecode — check video stream tags, then format tags
    let timecode = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|t| t.get("timecode").and_then(|v| v.as_str().map(|s| s.to_string())))
        .or_else(|| {
            format.tags.as_ref().and_then(|t| {
                t.get("timecode")
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
            })
        });

    // Created date — check format tags for creation_time
    let created_at = format
        .tags
        .as_ref()
        .and_then(|t| t.get("creation_time").and_then(|v| v.as_str().map(|s| s.to_string())))
        .unwrap_or_else(|| {
            // Fallback to file modified time
            std::fs::metadata(file_path)
                .and_then(|m| m.modified())
                .map(|t| {
                    let datetime: chrono::DateTime<chrono::Utc> = t.into();
                    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                })
                .unwrap_or_else(|_| "Unknown".to_string())
        });

    Ok(ClipMetadata {
        filename,
        file_path: file_path.to_string(),
        size_bytes,
        created_at,
        duration_ms,
        fps,
        width,
        height,
        video_codec,
        audio_summary,
        timecode,
    })
}

fn parse_frame_rate(rate: &str) -> f64 {
    if let Some((num, den)) = rate.split_once('/') {
        let n: f64 = num.parse().unwrap_or(0.0);
        let d: f64 = den.parse().unwrap_or(1.0);
        if d > 0.0 {
            (n / d * 100.0).round() / 100.0
        } else {
            0.0
        }
    } else {
        rate.parse().unwrap_or(0.0)
    }
}
