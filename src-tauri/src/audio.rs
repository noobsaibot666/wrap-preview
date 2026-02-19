use std::process::{Command, Stdio};
use std::io::{Read, BufReader};

pub struct AudioEnvelope {
    pub envelope: Vec<u8>,
    pub max_peak: f32,
    pub avg_rms: f32,
}

pub fn extract_envelope(file_path: &str, points: usize) -> Result<AudioEnvelope, String> {
    // ffmpeg -i input -f s16le -ac 1 -ar 8000 -
    // -f s16le: signed 16-bit little-endian
    // -ac 1: mono
    // -ar 8000: 8kHz sampling rate (plenty for envelope)
    
    let mut child = Command::new("ffmpeg")
        .args(&[
            "-i", file_path,
            "-f", "s16le",
            "-ac", "1",
            "-ar", "8000",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut reader = BufReader::new(stdout);
    
    let mut pcm_data = Vec::new();
    reader.read_to_end(&mut pcm_data).map_err(|e| e.to_string())?;

    if pcm_data.is_empty() {
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
    let mut max_peak: f32 = 0.0;
    let mut sum_sq: f64 = 0.0;

    for chunk in samples.chunks(chunk_size.max(1)) {
        let mut peak: i16 = 0;
        for &s in chunk {
            let abs_s = s.abs();
            if abs_s > peak { peak = abs_s; }
            sum_sq += (s as f64) * (s as f64);
        }
        // Normalize to 0-255 for storage
        let normalized = ((peak as f32 / 32768.0) * 255.0) as u8;
        envelope.push(normalized);
        
        let p_f32 = peak as f32 / 32768.0;
        if p_f32 > max_peak { max_peak = p_f32; }
    }

    let avg_rms = ((sum_sq / samples.len() as f64).sqrt() / 32768.0) as f32;

    Ok(AudioEnvelope {
        envelope,
        max_peak,
        avg_rms,
    })
}
