use image::io::Reader as ImageReader;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lut3D {
    pub size: usize,
    pub data: Vec<[f32; 3]>,
    pub domain_min: [f32; 3],
    pub domain_max: [f32; 3],
}

impl Lut3D {
    pub fn parse_cube(content: &str) -> std::result::Result<Self, String> {
        let mut size = 0;
        let mut domain_min = [0.0, 0.0, 0.0];
        let mut domain_max = [1.0, 1.0, 1.0];
        let mut data = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if line.starts_with("LUT_3D_SIZE") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 2 {
                    return Err("Invalid LUT_3D_SIZE".to_string());
                }
                size = parts[1]
                    .parse()
                    .map_err(|_| "Invalid LUT size".to_string())?;
                data.reserve(size * size * size);
            } else if line.starts_with("DOMAIN_MIN") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 {
                    continue; // Skip invalid domain min
                }
                domain_min = [
                    parts[1].parse().unwrap_or(0.0),
                    parts[2].parse().unwrap_or(0.0),
                    parts[3].parse().unwrap_or(0.0),
                ];
            } else if line.starts_with("DOMAIN_MAX") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 {
                    continue; // Skip invalid domain max
                }
                domain_max = [
                    parts[1].parse().unwrap_or(1.0),
                    parts[2].parse().unwrap_or(1.0),
                    parts[3].parse().unwrap_or(1.0),
                ];
            } else if !line.starts_with("TITLE") {
                // Assume RGB values
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let r = parts[0].parse().unwrap_or(0.0);
                    let g = parts[1].parse().unwrap_or(0.0);
                    let b = parts[2].parse().unwrap_or(0.0);
                    data.push([r, g, b]);
                }
            }
        }

        if size == 0 {
            return Err("Missing LUT_3D_SIZE".to_string());
        }
        if data.len() < size * size * size {
            return Err(format!(
                "Not enough data for LUT size {}. Expected {}, got {}",
                size,
                size * size * size,
                data.len()
            ));
        }

        Ok(Lut3D {
            size,
            data,
            domain_min,
            domain_max,
        })
    }

    fn get_value(&self, r: usize, g: usize, b: usize) -> [f32; 3] {
        let idx = r + g * self.size + b * self.size * self.size;
        self.data.get(idx).copied().unwrap_or([0.0, 0.0, 0.0])
    }

    pub fn sample_trilinear(&self, r: f32, g: f32, b: f32) -> [f32; 3] {
        let size_f = (self.size - 1) as f32;

        let r_norm =
            ((r - self.domain_min[0]) / (self.domain_max[0] - self.domain_min[0])).clamp(0.0, 1.0);
        let g_norm =
            ((g - self.domain_min[1]) / (self.domain_max[1] - self.domain_min[1])).clamp(0.0, 1.0);
        let b_norm =
            ((b - self.domain_min[2]) / (self.domain_max[2] - self.domain_min[2])).clamp(0.0, 1.0);

        let rx = r_norm * size_f;
        let gx = g_norm * size_f;
        let bx = b_norm * size_f;

        let r0 = (rx.floor() as usize).min(self.size - 1);
        let r1 = (r0 + 1).min(self.size - 1);
        let g0 = (gx.floor() as usize).min(self.size - 1);
        let g1 = (g0 + 1).min(self.size - 1);
        let b0 = (bx.floor() as usize).min(self.size - 1);
        let b1 = (b0 + 1).min(self.size - 1);

        let rd = rx - r0 as f32;
        let gd = gx - g0 as f32;
        let bd = bx - b0 as f32;

        let c000 = self.get_value(r0, g0, b0);
        let c100 = self.get_value(r1, g0, b0);
        let c010 = self.get_value(r0, g1, b0);
        let c110 = self.get_value(r1, g1, b0);
        let c001 = self.get_value(r0, g0, b1);
        let c101 = self.get_value(r1, g0, b1);
        let c011 = self.get_value(r0, g1, b1);
        let c111 = self.get_value(r1, g1, b1);

        let mut res = [0.0; 3];
        for i in 0..3 {
            let c00 = c000[i] * (1.0 - rd) + c100[i] * rd;
            let c01 = c001[i] * (1.0 - rd) + c101[i] * rd;
            let c10 = c010[i] * (1.0 - rd) + c110[i] * rd;
            let c11 = c011[i] * (1.0 - rd) + c111[i] * rd;

            let c0 = c00 * (1.0 - gd) + c10 * gd;
            let c1 = c01 * (1.0 - gd) + c11 * gd;

            res[i] = c0 * (1.0 - bd) + c1 * bd;
        }

        res
    }
}

pub fn apply_lut_to_image(
    image_path: &str,
    lut: &Lut3D,
    output_path: &str,
) -> std::result::Result<(), String> {
    let img = ImageReader::open(image_path)
        .map_err(|e| format!("Failed to open original image {}: {}", image_path, e))?
        .decode()
        .map_err(|e| format!("Failed to decode original image {}: {}", image_path, e))?;

    let mut rgba_img = img.into_rgba8();

    rgba_img.pixels_mut().for_each(|pixel| {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;

        let sampled = lut.sample_trilinear(r, g, b);

        pixel[0] = (sampled[0] * 255.0).clamp(0.0, 255.0) as u8;
        pixel[1] = (sampled[1] * 255.0).clamp(0.0, 255.0) as u8;
        pixel[2] = (sampled[2] * 255.0).clamp(0.0, 255.0) as u8;
    });

    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create lut_thumbs dir: {}", e))?;
    }

    rgba_img
        .save(output_path)
        .map_err(|e| format!("Failed to save lut image {}: {}", output_path, e))?;

    Ok(())
}
