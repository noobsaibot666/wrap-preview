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
    pub avg_frame_rate: Option<String>,
    pub r_frame_rate: Option<String>,
    pub is_vfr: bool,
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub video_bitrate: u64,
    pub format_name: String,
    pub audio_codec: String,
    pub audio_channels: u32,
    pub audio_sample_rate: u32,
    pub camera_iso: Option<String>,
    pub camera_lens: Option<String>,
    pub camera_white_balance: Option<String>,
    pub camera_aperture: Option<String>,
    pub camera_angle: Option<String>,
    pub audio_summary: String,
    pub timecode: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
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
    codec_long_name: Option<String>,
    codec_tag_string: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    bit_rate: Option<String>,
    color_space: Option<String>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    tags: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
    tags: Option<serde_json::Value>,
}

/// Run ffprobe on a file and parse the JSON output into ClipMetadata
pub fn probe_file(file_path: &str) -> Result<ClipMetadata, String> {
    let ffprobe = crate::tools::find_executable("ffprobe");
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
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
    let probe: FfprobeOutput = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    let format = probe.format.ok_or("No format info from ffprobe")?;
    let streams = probe.streams.unwrap_or_default();

    // Find video stream
    let video_stream = streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"));

    // Find audio streams
    let audio_streams: Vec<&FfprobeStream> = streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .collect();

    // Parse FPS from r_frame_rate (e.g., "24000/1001")
    let fps = video_stream
        .and_then(|s| s.avg_frame_rate.as_ref().or(s.r_frame_rate.as_ref()))
        .map(|r| parse_frame_rate(r))
        .unwrap_or(0.0);
    let avg_frame_rate = video_stream.and_then(|s| s.avg_frame_rate.clone());
    let r_frame_rate = video_stream.and_then(|s| s.r_frame_rate.clone());
    let is_vfr = match (&avg_frame_rate, &r_frame_rate) {
        (Some(avg), Some(raw)) => {
            let avg_value = parse_frame_rate(avg);
            let raw_value = parse_frame_rate(raw);
            avg != raw && (avg_value - raw_value).abs() > 0.01
        }
        _ => false,
    };

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

    let extension = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    // Video codec
    let video_codec = video_stream
        .and_then(|s| {
            s.codec_name
                .clone()
                .or_else(|| s.codec_tag_string.clone())
                .or_else(|| s.codec_long_name.clone())
        })
        .or_else(|| {
            if extension.as_deref() == Some("braw") {
                Some("braw".to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Resolution & Rotation
    let mut width = video_stream.and_then(|s| s.width).unwrap_or(0);
    let mut height = video_stream.and_then(|s| s.height).unwrap_or(0);
    
    let rotation = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| get_tag_value_ci(tags, &["rotate", "com.apple.quicktime.rotation"]))
        .and_then(|r| r.parse::<i32>().ok())
        .unwrap_or(0);

    if rotation == 90 || rotation == 270 || rotation == -90 || rotation == -270 {
        std::mem::swap(&mut width, &mut height);
    }

    // Audio summary
    let audio_summary = if audio_streams.is_empty() {
        "No audio".to_string()
    } else {
        let track_count = audio_streams.len();
        let first_codec = audio_streams[0].codec_name.as_deref().unwrap_or("unknown");
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
            format!(
                "{} tracks, {} ({})",
                track_count,
                first_codec.to_uppercase(),
                ch_label
            )
        }
    };

    let audio_codec = audio_streams
        .first()
        .and_then(|s| s.codec_name.clone())
        .unwrap_or_else(|| "none".to_string());
    let audio_channels = audio_streams.first().and_then(|s| s.channels).unwrap_or(0);
    let audio_sample_rate = audio_streams
        .first()
        .and_then(|s| s.sample_rate.as_ref())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let video_bitrate = video_stream
        .and_then(|s| s.bit_rate.as_ref())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| format.bit_rate.as_ref().and_then(|s| s.parse::<u64>().ok()))
        .unwrap_or(0);
    let format_name = if extension.as_deref() == Some("braw") {
        "braw".to_string()
    } else {
        format
            .format_name
            .as_deref()
            .and_then(|name| {
                name.split(',')
                    .map(|part| part.trim())
                    .find(|part| !part.is_empty())
            })
            .map(|part| part.to_ascii_lowercase())
            .or(extension.clone())
            .unwrap_or_else(|| "unknown".to_string())
    };

    let camera_iso = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| {
            get_tag_value_ci(
                tags,
                &["iso", "com.apple.quicktime.iso", "ISO", "camera_iso"],
            )
        })
        .or_else(|| {
            format.tags.as_ref().and_then(|tags| {
                get_tag_value_ci(
                    tags,
                    &["iso", "com.apple.quicktime.iso", "ISO", "camera_iso"],
                )
            })
        })
        .and_then(|raw| extract_numeric_like(&raw));

    let camera_lens = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| get_tag_value_ci(tags, &["lens", "LensModel", "com.apple.quicktime.lens"]))
        .or_else(|| {
            format.tags.as_ref().and_then(|tags| {
                get_tag_value_ci(tags, &["lens", "LensModel", "com.apple.quicktime.lens"])
            })
        });

    let camera_aperture = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| {
            get_tag_value_ci(
                tags,
                &["aperture", "f-number", "com.apple.quicktime.aperture"],
            )
        })
        .or_else(|| {
            format.tags.as_ref().and_then(|tags| {
                get_tag_value_ci(
                    tags,
                    &["aperture", "f-number", "com.apple.quicktime.aperture"],
                )
            })
        });

    let camera_angle = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| {
            get_tag_value_ci(
                tags,
                &[
                    "shutter_angle",
                    "angle",
                    "com.apple.quicktime.shutter_angle",
                ],
            )
        })
        .or_else(|| {
            format.tags.as_ref().and_then(|tags| {
                get_tag_value_ci(
                    tags,
                    &[
                        "shutter_angle",
                        "angle",
                        "com.apple.quicktime.shutter_angle",
                    ],
                )
            })
        });

    let camera_white_balance = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| {
            get_tag_value_ci(
                tags,
                &[
                    "white_balance",
                    "wb",
                    "com.apple.quicktime.whitebalance",
                    "kelvin",
                ],
            )
        })
        .or_else(|| {
            format.tags.as_ref().and_then(|tags| {
                get_tag_value_ci(
                    tags,
                    &[
                        "white_balance",
                        "wb",
                        "com.apple.quicktime.whitebalance",
                        "kelvin",
                    ],
                )
            })
        })
        .and_then(|raw| extract_numeric_like(&raw));

    // Timecode — check video stream tags, then any stream tags, then format tags
    let timecode = video_stream
        .and_then(|s| s.tags.as_ref())
        .and_then(|tags| get_tag_value_ci(tags, &["timecode", "com.apple.quicktime.timecode"]))
        .or_else(|| {
            streams.iter().find_map(|stream| {
                stream.tags.as_ref().and_then(|tags| {
                    get_tag_value_ci(tags, &["timecode", "com.apple.quicktime.timecode"])
                })
            })
        })
        .or_else(|| {
            format.tags.as_ref().and_then(|tags| {
                get_tag_value_ci(tags, &["timecode", "com.apple.quicktime.timecode"])
            })
        });

    // Created date — check format tags for creation_time
    let created_at = format
        .tags
        .as_ref()
        .and_then(|t| {
            t.get("creation_time")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
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
        avg_frame_rate,
        r_frame_rate,
        is_vfr,
        width,
        height,
        video_codec,
        video_bitrate,
        format_name,
        audio_codec,
        audio_channels,
        audio_sample_rate,
        camera_iso,
        camera_white_balance,
        camera_lens,
        camera_aperture,
        camera_angle,
        audio_summary,
        timecode,
        color_space: video_stream.and_then(|s| s.color_space.clone()),
        color_transfer: video_stream.and_then(|s| s.color_transfer.clone()),
        color_primaries: video_stream.and_then(|s| s.color_primaries.clone()),
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

fn get_tag_value_ci(tags: &serde_json::Value, aliases: &[&str]) -> Option<String> {
    let object = tags.as_object()?;
    for alias in aliases {
        let alias_lower = alias.to_ascii_lowercase();
        for (key, value) in object {
            if key.to_ascii_lowercase() == alias_lower {
                if let Some(s) = value.as_str() {
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                } else if let Some(n) = value.as_i64() {
                    return Some(n.to_string());
                } else if let Some(n) = value.as_u64() {
                    return Some(n.to_string());
                } else if let Some(n) = value.as_f64() {
                    return Some(n.round().to_string());
                }
            }
        }
    }
    None
}

fn extract_numeric_like(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut digits = String::new();
    let mut started = false;
    for ch in trimmed.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            started = true;
        } else if started {
            break;
        }
    }
    if !digits.is_empty() {
        Some(digits)
    } else {
        Some(trimmed.to_string())
    }
}
