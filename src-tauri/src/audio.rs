use std::io::{BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};

pub struct AudioEnvelope {
    pub envelope: Vec<u8>,
}

/// R3D files store audio in a companion .RWA file alongside the .R3D file inside the .RDC
/// directory. Returns the .RWA path if one exists next to the given .R3D path.
fn find_r3d_companion_audio(r3d_path: &Path) -> Option<String> {
    let stem = r3d_path.file_stem()?.to_str()?;
    let parent = r3d_path.parent()?;
    for ext in &["RWA", "rwa"] {
        let candidate = parent.join(format!("{}.{}", stem, ext));
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

fn run_ffmpeg_extract(source: &str) -> Result<Vec<u8>, String> {
    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let mut child = Command::new(ffmpeg)
        .args(&["-i", source, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut pcm_data = Vec::new();
    reader.read_to_end(&mut pcm_data).map_err(|e| e.to_string())?;
    Ok(pcm_data)
}

pub fn extract_envelope(file_path: &str, points: usize) -> Result<AudioEnvelope, String> {
    // ffmpeg -i input -f s16le -ac 1 -ar 8000 -
    // -f s16le: signed 16-bit little-endian
    // -ac 1: mono
    // -ar 8000: 8kHz sampling rate (plenty for envelope)

    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let is_r3d = ext == "r3d";

    // For R3D, prefer the companion .RWA audio file; the .R3D itself carries no decodable audio.
    let audio_source = if is_r3d {
        find_r3d_companion_audio(path).unwrap_or_else(|| file_path.to_string())
    } else {
        file_path.to_string()
    };

    let pcm_data = run_ffmpeg_extract(&audio_source)?;

    if pcm_data.is_empty() {
        // R3D without a companion .RWA is normal — the clip genuinely has no audio.
        if is_r3d {
            return Ok(AudioEnvelope { envelope: vec![] });
        }
        return Err("No audio data extracted".to_string());
    }

    // Convert bytes to i16
    let samples: Vec<i16> = pcm_data
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    if samples.is_empty() {
        return Err("No audio samples found".to_string());
    }

    // Downsample to `points`
    let chunk_size = samples.len() / points;
    let mut envelope = Vec::with_capacity(points);

    for chunk in samples.chunks(chunk_size.max(1)) {
        let mut peak: i16 = 0;
        for &s in chunk {
            let abs_s = s.abs();
            if abs_s > peak {
                peak = abs_s;
            }
        }
        // Normalize to 0-255 for storage
        let normalized = ((peak as f32 / 32768.0) * 255.0) as u8;
        envelope.push(normalized);
    }

    Ok(AudioEnvelope { envelope })
}
