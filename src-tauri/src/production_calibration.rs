#[cfg(feature = "calibration")]
use opencv::core::{
    self, Mat, Point, Point2f, Rect, RotatedRect, Scalar, Size, Size2f, Vec3b, Vector, BORDER_REPLICATE,
};
#[cfg(feature = "calibration")]
use opencv::imgcodecs;
#[cfg(feature = "calibration")]
use opencv::imgproc;
#[cfg(feature = "calibration")]
use opencv::prelude::*;

#[cfg(not(feature = "calibration"))]
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatStub;
use serde::{Deserialize, Serialize};
#[cfg(feature = "calibration")]
use sha2::{Digest, Sha256};
#[cfg(feature = "calibration")]
use std::cmp::Ordering;
use std::path::Path;
#[cfg(feature = "calibration")]
use std::path::PathBuf;

#[cfg(feature = "calibration")]
const PATCH_COLUMNS: usize = 6;
#[cfg(feature = "calibration")]
const PATCH_ROWS: usize = 4;
#[cfg(feature = "calibration")]
const TOTAL_PATCHES: usize = PATCH_COLUMNS * PATCH_ROWS;
#[cfg(feature = "calibration")]
const NORMALIZED_WIDTH: i32 = 600;
#[cfg(feature = "calibration")]
const NORMALIZED_HEIGHT: i32 = 400;
#[cfg(feature = "calibration")]
const TARGET_ASPECT_RATIO: f64 = 1.5;
#[cfg(feature = "calibration")]
const MIN_AREA_RATIO: f64 = 0.04;
#[cfg(feature = "calibration")]
const NEUTRAL_PATCHES: [usize; 6] = [18, 19, 20, 21, 22, 23];
#[cfg(feature = "calibration")]
const SKIN_PATCHES: [usize; 3] = [0, 1, 8];

#[cfg(feature = "calibration")]
#[derive(Debug, Clone, Copy)]
enum DetectionMode {
    Edges,
    DarkMask,
}

#[cfg(feature = "calibration")]
#[derive(Debug, Clone, Copy)]
struct DetectionAttemptConfig {
    mode: DetectionMode,
    canny_low: f64,
    canny_high: f64,
    blur_size: i32,
    contrast_normalize: bool,
    downscale_ratio: f64,
    max_dimension: i32,
    aspect_min: f64,
    aspect_max: f64,
    central_bias: bool,
    fallback_used: bool,
    close_kernel: i32,
    dilate_iterations: i32,
}

#[cfg(feature = "calibration")]
#[derive(Debug, Clone, Default)]
struct DetectionDebugInfo {
    detection_attempts: usize,
    candidate_count: usize,
    best_aspect_ratio: Option<f64>,
    best_area_ratio: Option<f64>,
    best_rectangularity: Option<f64>,
    fallback_used: bool,
}

#[cfg(feature = "calibration")]
#[derive(Debug, Clone, Copy)]
struct CandidateGeometry {
    area: f64,
    area_ratio: f64,
    aspect_ratio: f64,
    fill_ratio: f64,
    center_x: f64,
    center_y: f64,
}

#[cfg(feature = "calibration")]
struct CropContext {
    detection_frame: Mat,
    offset: Option<Point2f>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationCropRectNormalized {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationPatchSample {
    pub patch_index: usize,
    pub measured_rgb_mean: [u8; 3],
    pub measured_rgb_median: [u8; 3],
    pub reference_rgb: [u8; 3],
    pub reference_lab: [f64; 3],
    pub delta_e: f64,
    pub center_x: f64,
    pub center_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationChartDetection {
    pub chart_detected: bool,
    #[serde(default)]
    pub detection_attempts: usize,
    #[serde(default)]
    pub candidate_count: usize,
    #[serde(default)]
    pub best_aspect_ratio: Option<f64>,
    #[serde(default)]
    pub best_area_ratio: Option<f64>,
    #[serde(default)]
    pub fallback_used: bool,
    pub frame_width: u32,
    pub frame_height: u32,
    pub chart_corners: Vec<CalibrationPoint>,
    pub patch_samples: Vec<CalibrationPatchSample>,
    pub delta_e: Vec<f64>,
    pub mean_delta_e: f64,
    pub max_delta_e: f64,
    pub neutral_mean_delta_e: f64,
    pub skin_mean_delta_e: f64,
    pub exposure_offset_stops: f64,
    pub wb_kelvin_shift: i32,
    pub tint_shift: i32,
    pub corrected_preview_path: String,
    pub calibration_transform: Option<CalibrationTransform>,
    pub lut_path: Option<String>,
    pub cube_size: Option<u32>,
    pub transform_type: Option<String>,
    pub transform_target_slot: Option<String>,
    pub mean_delta_e_before: f64,
    pub mean_delta_e_after: Option<f64>,
    pub transform_preview_path: Option<String>,
    pub chart_area_ratio: f64,
    pub chart_skew_score: f64,
    pub clipped_patch_count: u32,
    pub crushed_patch_count: u32,
    pub lighting_uniformity_score: f64,
    pub calibration_quality_score: u32,
    pub calibration_quality_level: String,
    pub transform_quality_flag: Option<String>,
    pub warnings: Vec<String>,
    pub detection_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationTransform {
    pub exposure_scalar: f64,
    pub wb_gains_rgb: [f64; 3],
    pub tint_gains_rgb: [f64; 3],
    pub matrix_3x3: Option<[[f64; 3]; 3]>,
    pub source_patch_count: usize,
    pub mean_delta_e_before: f64,
    pub mean_delta_e_after: f64,
}

#[cfg(feature = "calibration")]
#[derive(Debug, Clone, Copy)]
struct SpyderReferencePatch {
    patch_index: usize,
    reference_rgb: [u8; 3],
}

#[cfg(feature = "calibration")]
const SPYDERCHECKR_REFERENCE: [SpyderReferencePatch; TOTAL_PATCHES] = [
    SpyderReferencePatch { patch_index: 0, reference_rgb: [115, 82, 68] },
    SpyderReferencePatch { patch_index: 1, reference_rgb: [194, 150, 130] },
    SpyderReferencePatch { patch_index: 2, reference_rgb: [98, 122, 157] },
    SpyderReferencePatch { patch_index: 3, reference_rgb: [87, 108, 67] },
    SpyderReferencePatch { patch_index: 4, reference_rgb: [133, 128, 177] },
    SpyderReferencePatch { patch_index: 5, reference_rgb: [103, 189, 170] },
    SpyderReferencePatch { patch_index: 6, reference_rgb: [214, 126, 44] },
    SpyderReferencePatch { patch_index: 7, reference_rgb: [80, 91, 166] },
    SpyderReferencePatch { patch_index: 8, reference_rgb: [193, 90, 99] },
    SpyderReferencePatch { patch_index: 9, reference_rgb: [94, 60, 108] },
    SpyderReferencePatch { patch_index: 10, reference_rgb: [157, 188, 64] },
    SpyderReferencePatch { patch_index: 11, reference_rgb: [224, 163, 46] },
    SpyderReferencePatch { patch_index: 12, reference_rgb: [56, 61, 150] },
    SpyderReferencePatch { patch_index: 13, reference_rgb: [70, 148, 73] },
    SpyderReferencePatch { patch_index: 14, reference_rgb: [175, 54, 60] },
    SpyderReferencePatch { patch_index: 15, reference_rgb: [231, 199, 31] },
    SpyderReferencePatch { patch_index: 16, reference_rgb: [187, 86, 149] },
    SpyderReferencePatch { patch_index: 17, reference_rgb: [8, 133, 161] },
    SpyderReferencePatch { patch_index: 18, reference_rgb: [243, 243, 242] },
    SpyderReferencePatch { patch_index: 19, reference_rgb: [200, 200, 200] },
    SpyderReferencePatch { patch_index: 20, reference_rgb: [160, 160, 160] },
    SpyderReferencePatch { patch_index: 21, reference_rgb: [122, 122, 121] },
    SpyderReferencePatch { patch_index: 22, reference_rgb: [85, 85, 85] },
    SpyderReferencePatch { patch_index: 23, reference_rgb: [52, 52, 52] },
];

#[cfg(feature = "calibration")]
pub fn detect_spydercheckr(
    cache_root: &Path,
    project_id: &str,
    slot: &str,
    frame_path: &Path,
    crop_rect: Option<&CalibrationCropRectNormalized>,
    manual_corners: Option<&[CalibrationPoint]>,
) -> Result<CalibrationChartDetection, String> {
    let frame_path_str = frame_path
        .to_str()
        .ok_or("Calibration frame path is not valid UTF-8.".to_string())?;
    let frame = imgcodecs::imread(frame_path_str, imgcodecs::IMREAD_COLOR)
        .map_err(|error| format!("Failed to load calibration frame {}: {}", frame_path.display(), error))?;
    if frame.empty() {
        return Err(format!("Calibration frame is empty: {}", frame_path.display()));
    }

    let frame_width = frame.cols() as u32;
    let frame_height = frame.rows() as u32;
    if frame_width < 240 || frame_height < 160 {
        return Err("Frame is too small for SpyderCHECKR detection.".to_string());
    }

    let crop_context = build_crop_context(&frame, crop_rect)?;
    let (cropped_corners, corners, debug_info) = if let Some(manual_corners) = manual_corners {
        let corners = resolve_manual_corners(manual_corners, frame_width as f64, frame_height as f64)?;
        let cropped = if let Some(offset) = crop_context.offset {
            corners.map(|point| Point2f::new(point.x - offset.x, point.y - offset.y))
        } else {
            corners
        };
        (
            cropped,
            corners,
            DetectionDebugInfo {
                detection_attempts: 1,
                candidate_count: 1,
                best_aspect_ratio: Some(compute_manual_aspect_ratio(&corners)),
                best_area_ratio: Some(compute_chart_area_ratio(&corners, frame_width as f64, frame_height as f64)),
                best_rectangularity: Some(1.0),
                fallback_used: true,
            },
        )
    } else {
        let (cropped_corners, debug_info) = detect_chart_corners(&crop_context.detection_frame)?;
        let corners = if let Some(offset) = crop_context.offset {
            cropped_corners.map(|point| Point2f::new(point.x + offset.x, point.y + offset.y))
        } else {
            cropped_corners
        };
        (cropped_corners, corners, debug_info)
    };
    let normalized = normalize_chart(&crop_context.detection_frame, &cropped_corners)?;
    let patch_samples = sample_patch_colors(&normalized)?;
    let delta_e = patch_samples.iter().map(|patch| patch.delta_e).collect::<Vec<_>>();
    let mean_delta_e = if delta_e.is_empty() {
        0.0
    } else {
        delta_e.iter().sum::<f64>() / delta_e.len() as f64
    };
    let max_delta_e = delta_e.iter().copied().fold(0.0, f64::max);
    let neutral_mean_delta_e = mean_delta_for_patch_group(&patch_samples, &NEUTRAL_PATCHES);
    let skin_mean_delta_e = mean_delta_for_patch_group(&patch_samples, &SKIN_PATCHES);
    let exposure_offset_stops = compute_exposure_offset(&patch_samples);
    let wb_kelvin_shift = compute_wb_shift(&patch_samples);
    let tint_shift = compute_tint_shift(&patch_samples);
    let corrected_preview_path = build_corrected_preview_path(cache_root, project_id, slot, frame_path);
    generate_corrected_preview(
        frame_path,
        &corrected_preview_path,
        exposure_offset_stops,
        wb_kelvin_shift,
        tint_shift,
        &patch_samples,
    )?;
    let detection_width = crop_context.detection_frame.cols() as f64;
    let detection_height = crop_context.detection_frame.rows() as f64;
    let detection_score = score_detection(&cropped_corners, detection_width, detection_height);
    let chart_area_ratio = compute_chart_area_ratio(&cropped_corners, detection_width, detection_height);
    let chart_skew_score = compute_chart_skew_score(&corners);
    let clipped_patch_count = count_clipped_patches(&patch_samples);
    let crushed_patch_count = count_crushed_patches(&patch_samples);
    let lighting_uniformity_score = compute_lighting_uniformity_score(&patch_samples);
    let warnings = build_chart_quality_warnings(
        chart_area_ratio,
        chart_skew_score,
        clipped_patch_count,
        crushed_patch_count,
        lighting_uniformity_score,
    );
    let (calibration_quality_score, calibration_quality_level) = compute_calibration_quality(
        mean_delta_e,
        mean_delta_e,
        chart_area_ratio,
        chart_skew_score,
        clipped_patch_count,
        crushed_patch_count,
        lighting_uniformity_score,
        None,
    );

    Ok(CalibrationChartDetection {
        chart_detected: true,
        detection_attempts: debug_info.detection_attempts,
        candidate_count: debug_info.candidate_count,
        best_aspect_ratio: debug_info.best_aspect_ratio,
        best_area_ratio: debug_info.best_area_ratio,
        fallback_used: debug_info.fallback_used,
        frame_width,
        frame_height,
        chart_corners: corners
            .iter()
            .map(|corner| CalibrationPoint {
                x: corner.x as f64 / frame_width as f64,
                y: corner.y as f64 / frame_height as f64,
            })
            .collect(),
        patch_samples,
        delta_e,
        mean_delta_e,
        max_delta_e,
        neutral_mean_delta_e,
        skin_mean_delta_e,
        exposure_offset_stops,
        wb_kelvin_shift,
        tint_shift,
        corrected_preview_path,
        calibration_transform: None,
        lut_path: None,
        cube_size: None,
        transform_type: None,
        transform_target_slot: None,
        mean_delta_e_before: mean_delta_e,
        mean_delta_e_after: None,
        transform_preview_path: None,
        chart_area_ratio,
        chart_skew_score,
        clipped_patch_count,
        crushed_patch_count,
        lighting_uniformity_score,
        calibration_quality_score,
        calibration_quality_level,
        transform_quality_flag: None,
        warnings,
        detection_score,
    })
}

#[cfg(not(feature = "calibration"))]
pub fn detect_spydercheckr(
    _cache_root: &Path,
    _project_id: &str,
    _slot: &str,
    _frame_path: &Path,
    _crop_rect: Option<&CalibrationCropRectNormalized>,
    _manual_corners: Option<&[CalibrationPoint]>,
) -> Result<CalibrationChartDetection, String> {
    Err("SpyderCHECKR detection is currently only supported on macOS. OpenCV is required for this feature on Windows.".to_string())
}

#[cfg(feature = "calibration")]
pub fn generate_calibration_transform(
    cache_root: &Path,
    project_id: &str,
    slot: &str,
    hero_slot: &str,
    source_frame_path: &Path,
    source_calibration: &CalibrationChartDetection,
    target_calibration: Option<&CalibrationChartDetection>,
) -> Result<CalibrationChartDetection, String> {
    if !source_calibration.chart_detected {
        return Err("Calibration chart has not been detected for this camera.".to_string());
    }
    let is_hero = slot == hero_slot;
    let target_patch_samples = if let Some(target) = target_calibration {
        target.patch_samples
            .iter()
            .map(|patch| patch.measured_rgb_mean)
            .collect::<Vec<_>>()
    } else {
        source_calibration
            .patch_samples
            .iter()
            .map(|patch| patch.reference_rgb)
            .collect::<Vec<_>>()
    };
    let solved = solve_transform(&source_calibration.patch_samples, &target_patch_samples)?;
    let transform_preview_path = build_transform_preview_path(cache_root, project_id, slot);
    generate_transform_preview(source_frame_path, &transform_preview_path, &solved)?;
    let mut updated = source_calibration.clone();
    updated.calibration_transform = Some(solved.clone());
    updated.transform_type = Some(if solved.matrix_3x3.is_some() {
        "gain-plus-matrix".to_string()
    } else {
        "gain-only".to_string()
    });
    updated.transform_target_slot = Some(hero_slot.to_string());
    updated.mean_delta_e_before = solved.mean_delta_e_before;
    updated.mean_delta_e_after = Some(solved.mean_delta_e_after);
    updated.transform_preview_path = Some(transform_preview_path.clone());
    let transform_quality_flag = compute_transform_quality_flag(solved.mean_delta_e_before, solved.mean_delta_e_after);
    updated.transform_quality_flag = transform_quality_flag.clone();
    updated.warnings = build_chart_quality_warnings(
        updated.chart_area_ratio,
        updated.chart_skew_score,
        updated.clipped_patch_count,
        updated.crushed_patch_count,
        updated.lighting_uniformity_score,
    );
    if let Some(flag) = transform_quality_flag {
        updated.warnings.push(flag.clone());
    }
    let (quality_score, quality_level) = compute_calibration_quality(
        updated.mean_delta_e,
        solved.mean_delta_e_after,
        updated.chart_area_ratio,
        updated.chart_skew_score,
        updated.clipped_patch_count,
        updated.crushed_patch_count,
        updated.lighting_uniformity_score,
        updated.transform_quality_flag.as_deref(),
    );
    updated.calibration_quality_score = quality_score;
    updated.calibration_quality_level = quality_level;
    if is_hero {
        updated.lut_path = None;
        updated.cube_size = None;
    } else {
        let lut_path = build_lut_path(cache_root, project_id, slot, hero_slot);
        write_cube_lut(&lut_path, &solved, 17)?;
        updated.lut_path = Some(lut_path);
        updated.cube_size = Some(17);
    }
    Ok(updated)
}

#[cfg(not(feature = "calibration"))]
pub fn generate_calibration_transform(
    _cache_root: &Path,
    _project_id: &str,
    _slot: &str,
    _hero_slot: &str,
    _source_frame_path: &Path,
    _source_calibration: &CalibrationChartDetection,
    _target_calibration: Option<&CalibrationChartDetection>,
) -> Result<CalibrationChartDetection, String> {
    Err("Calibration transform generation is currently only supported on macOS.".to_string())
}

#[cfg(feature = "calibration")]
fn build_corrected_preview_path(
    cache_root: &Path,
    project_id: &str,
    slot: &str,
    frame_path: &Path,
) -> String {
    let signature = format!("{}:{}", project_id, frame_path.display());
    let digest = Sha256::digest(signature.as_bytes());
    let hash = format!("{:x}", digest);
    let path = cache_root
        .join("production")
        .join("cache")
        .join("match_lab")
        .join(project_id)
        .join(slot)
        .join("calibration")
        .join(hash)
        .join("corrected_preview.jpg");
    path.to_string_lossy().to_string()
}

#[cfg(feature = "calibration")]
fn build_transform_preview_path(cache_root: &Path, project_id: &str, slot: &str) -> String {
    cache_root
        .join("production")
        .join("cache")
        .join("match_lab")
        .join(project_id)
        .join(slot)
        .join("calibration")
        .join("transform_preview.jpg")
        .to_string_lossy()
        .to_string()
}

#[cfg(feature = "calibration")]
fn build_transform_preview_tmp_path(path: &str) -> PathBuf {
    let target = PathBuf::from(path);
    let parent = target.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    parent.join("transform_preview.tmp.jpg")
}

#[cfg(feature = "calibration")]
fn build_lut_path(cache_root: &Path, project_id: &str, slot: &str, hero_slot: &str) -> String {
    cache_root
        .join("production")
        .join("cache")
        .join("match_lab")
        .join(project_id)
        .join(slot)
        .join("calibration")
        .join(format!("camera_{}_to_{}.cube", slot.to_lowercase(), hero_slot.to_lowercase()))
        .to_string_lossy()
        .to_string()
}

#[cfg(feature = "calibration")]
fn mean_delta_for_patch_group(patches: &[CalibrationPatchSample], patch_indexes: &[usize]) -> f64 {
    let mut values = Vec::new();
    for patch_index in patch_indexes {
        if let Some(patch) = patches.iter().find(|item| item.patch_index == *patch_index) {
            values.push(patch.delta_e);
        }
    }
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

#[cfg(feature = "calibration")]
fn compute_chart_area_ratio(corners: &[Point2f; 4], frame_width: f64, frame_height: f64) -> f64 {
    let mut area = 0.0;
    for index in 0..4 {
        let current = corners[index];
        let next = corners[(index + 1) % 4];
        area += current.x as f64 * next.y as f64 - next.x as f64 * current.y as f64;
    }
    (area.abs() * 0.5 / (frame_width * frame_height)).clamp(0.0, 1.0)
}

#[cfg(feature = "calibration")]
fn compute_chart_skew_score(corners: &[Point2f; 4]) -> f64 {
    let top = distance(corners[0], corners[1]);
    let right = distance(corners[1], corners[2]);
    let bottom = distance(corners[2], corners[3]);
    let left = distance(corners[3], corners[0]);
    let horizontal_delta = if top.max(bottom) > 0.0 {
        (top - bottom).abs() / top.max(bottom)
    } else {
        0.0
    };
    let vertical_delta = if left.max(right) > 0.0 {
        (left - right).abs() / left.max(right)
    } else {
        0.0
    };
    ((horizontal_delta + vertical_delta) * 0.5).clamp(0.0, 1.0)
}

#[cfg(feature = "calibration")]
fn count_clipped_patches(patches: &[CalibrationPatchSample]) -> u32 {
    NEUTRAL_PATCHES
        .iter()
        .filter_map(|patch_index| patches.iter().find(|patch| patch.patch_index == *patch_index))
        .filter(|patch| patch.measured_rgb_mean.iter().any(|channel| *channel >= 250))
        .count() as u32
}

#[cfg(feature = "calibration")]
fn count_crushed_patches(patches: &[CalibrationPatchSample]) -> u32 {
    [21usize, 22, 23]
        .iter()
        .filter_map(|patch_index| patches.iter().find(|patch| patch.patch_index == *patch_index))
        .filter(|patch| patch.measured_rgb_mean.iter().any(|channel| *channel <= 8))
        .count() as u32
}

#[cfg(feature = "calibration")]
fn compute_lighting_uniformity_score(patches: &[CalibrationPatchSample]) -> f64 {
    let values = NEUTRAL_PATCHES
        .iter()
        .filter_map(|patch_index| patches.iter().find(|patch| patch.patch_index == *patch_index))
        .map(|patch| relative_luma(patch.measured_rgb_mean))
        .collect::<Vec<_>>();
    if values.len() < 2 {
        return 1.0;
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    if mean <= 0.0001 {
        return 0.0;
    }
    let variance = values
        .iter()
        .map(|value| {
            let diff = *value - mean;
            diff * diff
        })
        .sum::<f64>()
        / values.len() as f64;
    (1.0 - (variance.sqrt() / mean).clamp(0.0, 1.0)).clamp(0.0, 1.0)
}

#[cfg(feature = "calibration")]
fn build_chart_quality_warnings(
    chart_area_ratio: f64,
    chart_skew_score: f64,
    clipped_patch_count: u32,
    crushed_patch_count: u32,
    lighting_uniformity_score: f64,
) -> Vec<String> {
    let mut warnings = Vec::new();
    if chart_area_ratio < 0.25 {
        warnings.push("Chart too small in frame.".to_string());
    }
    if chart_skew_score > 0.22 {
        warnings.push("Chart angle is too extreme.".to_string());
    }
    if clipped_patch_count > 0 {
        warnings.push("Highlights clipped on chart.".to_string());
    }
    if crushed_patch_count > 0 {
        warnings.push("Shadows crushed on chart.".to_string());
    }
    if lighting_uniformity_score < 0.82 {
        warnings.push("Uneven lighting across chart.".to_string());
    }
    warnings
}

#[cfg(feature = "calibration")]
fn compute_transform_quality_flag(mean_delta_before: f64, mean_delta_after: f64) -> Option<String> {
    if mean_delta_after > mean_delta_before + 0.1 {
        return Some("Calibration made the match worse. Capture a new reference.".to_string());
    }
    if mean_delta_before <= 0.0 {
        return None;
    }
    let improvement = (mean_delta_before - mean_delta_after) / mean_delta_before;
    if improvement < 0.08 || (mean_delta_before - mean_delta_after) < 0.5 {
        return Some("Calibration produced weak improvement. Recheck chart capture.".to_string());
    }
    None
}

#[cfg(feature = "calibration")]
fn compute_calibration_quality(
    mean_delta_before: f64,
    mean_delta_after: f64,
    chart_area_ratio: f64,
    chart_skew_score: f64,
    clipped_patch_count: u32,
    crushed_patch_count: u32,
    lighting_uniformity_score: f64,
    transform_quality_flag: Option<&str>,
) -> (u32, String) {
    let mut score = 100.0;
    score -= (mean_delta_after * 4.0).clamp(0.0, 32.0);
    score -= ((0.25 - chart_area_ratio).max(0.0) * 120.0).clamp(0.0, 26.0);
    score -= (chart_skew_score * 42.0).clamp(0.0, 24.0);
    score -= (clipped_patch_count as f64 * 8.0).clamp(0.0, 20.0);
    score -= (crushed_patch_count as f64 * 8.0).clamp(0.0, 20.0);
    score -= ((1.0 - lighting_uniformity_score).max(0.0) * 40.0).clamp(0.0, 20.0);
    if transform_quality_flag.is_some() {
        score -= 12.0;
    }
    let improvement = if mean_delta_before > 0.0 {
        (mean_delta_before - mean_delta_after) / mean_delta_before
    } else {
        0.0
    };
    if improvement > 0.18 {
        score += 4.0;
    }
    let clamped = score.round().clamp(0.0, 100.0) as u32;
    let level = if clamped >= 78 {
        "Good"
    } else if clamped >= 52 {
        "Caution"
    } else {
        "Poor"
    };
    (clamped, level.to_string())
}

#[cfg(feature = "calibration")]
fn compute_exposure_offset(patches: &[CalibrationPatchSample]) -> f64 {
    let neutral_measured = mean_luma_for_group(patches, &NEUTRAL_PATCHES, false);
    let neutral_reference = mean_luma_for_group(patches, &NEUTRAL_PATCHES, true);
    if neutral_measured <= 0.0001 || neutral_reference <= 0.0001 {
        return 0.0;
    }
    (neutral_reference / neutral_measured).log2().clamp(-2.0, 2.0)
}

#[cfg(feature = "calibration")]
fn compute_wb_shift(patches: &[CalibrationPatchSample]) -> i32 {
    let (measured_red, measured_blue) = mean_rb_for_group(patches, &NEUTRAL_PATCHES, false);
    let (reference_red, reference_blue) = mean_rb_for_group(patches, &NEUTRAL_PATCHES, true);
    let measured_delta = measured_red - measured_blue;
    let reference_delta = reference_red - reference_blue;
    (((reference_delta - measured_delta) * 5200.0) as i32).clamp(-2000, 2000)
}

#[cfg(feature = "calibration")]
fn compute_tint_shift(patches: &[CalibrationPatchSample]) -> i32 {
    let measured = mean_tint_for_group(patches, &NEUTRAL_PATCHES, false);
    let reference = mean_tint_for_group(patches, &NEUTRAL_PATCHES, true);
    (((reference - measured) * 32.0) as i32).clamp(-12, 12)
}

#[cfg(feature = "calibration")]
fn mean_luma_for_group(patches: &[CalibrationPatchSample], patch_indexes: &[usize], reference: bool) -> f64 {
    let mut values = Vec::new();
    for patch_index in patch_indexes {
        if let Some(patch) = patches.iter().find(|item| item.patch_index == *patch_index) {
            let rgb = if reference {
                patch.reference_rgb
            } else {
                patch.measured_rgb_mean
            };
            values.push(relative_luma(rgb));
        }
    }
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

#[cfg(feature = "calibration")]
fn mean_rb_for_group(patches: &[CalibrationPatchSample], patch_indexes: &[usize], reference: bool) -> (f64, f64) {
    let mut red = Vec::new();
    let mut blue = Vec::new();
    for patch_index in patch_indexes {
        if let Some(patch) = patches.iter().find(|item| item.patch_index == *patch_index) {
            let rgb = if reference {
                patch.reference_rgb
            } else {
                patch.measured_rgb_mean
            };
            red.push(rgb[0] as f64 / 255.0);
            blue.push(rgb[2] as f64 / 255.0);
        }
    }
    (
        if red.is_empty() { 0.0 } else { red.iter().sum::<f64>() / red.len() as f64 },
        if blue.is_empty() { 0.0 } else { blue.iter().sum::<f64>() / blue.len() as f64 },
    )
}

#[cfg(feature = "calibration")]
fn mean_tint_for_group(patches: &[CalibrationPatchSample], patch_indexes: &[usize], reference: bool) -> f64 {
    let mut values = Vec::new();
    for patch_index in patch_indexes {
        if let Some(patch) = patches.iter().find(|item| item.patch_index == *patch_index) {
            let rgb = if reference {
                patch.reference_rgb
            } else {
                patch.measured_rgb_mean
            };
            let red_blue_mean = (rgb[0] as f64 + rgb[2] as f64) * 0.5 / 255.0;
            values.push(rgb[1] as f64 / 255.0 - red_blue_mean);
        }
    }
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

#[cfg(feature = "calibration")]
fn relative_luma(rgb: [u8; 3]) -> f64 {
    let red = rgb[0] as f64 / 255.0;
    let green = rgb[1] as f64 / 255.0;
    let blue = rgb[2] as f64 / 255.0;
    0.2126 * red + 0.7152 * green + 0.0722 * blue
}

#[cfg(feature = "calibration")]
fn generate_corrected_preview(
    frame_path: &Path,
    corrected_preview_path: &str,
    exposure_offset_stops: f64,
    wb_kelvin_shift: i32,
    tint_shift: i32,
    patches: &[CalibrationPatchSample],
) -> Result<(), String> {
    let mut image = image::open(frame_path)
        .map_err(|error| format!("Failed opening calibration preview frame {}: {}", frame_path.display(), error))?
        .to_rgb8();
    let output_path = PathBuf::from(corrected_preview_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed preparing corrected preview cache: {}", error))?;
    }

    let neutral_ref_luma = mean_luma_for_group(patches, &NEUTRAL_PATCHES, true);
    let neutral_measured_luma = mean_luma_for_group(patches, &NEUTRAL_PATCHES, false).max(0.0001);
    let neutral_gain = if neutral_ref_luma > 0.0 {
        (neutral_ref_luma / neutral_measured_luma).clamp(0.75, 1.25)
    } else {
        1.0
    };
    let exposure_gain = 2_f32.powf(exposure_offset_stops as f32);
    let wb_gain_red = (1.0 + wb_kelvin_shift as f32 / 8000.0).clamp(0.75, 1.35);
    let wb_gain_blue = (1.0 - wb_kelvin_shift as f32 / 8000.0).clamp(0.75, 1.35);
    let tint_green_gain = (1.0 + tint_shift as f32 / 40.0).clamp(0.8, 1.25);
    for pixel in image.pixels_mut() {
        let corrected = [
            ((pixel[0] as f32) * exposure_gain * neutral_gain as f32 * wb_gain_red).clamp(0.0, 255.0) as u8,
            ((pixel[1] as f32) * exposure_gain * neutral_gain as f32 * tint_green_gain).clamp(0.0, 255.0) as u8,
            ((pixel[2] as f32) * exposure_gain * neutral_gain as f32 * wb_gain_blue).clamp(0.0, 255.0) as u8,
        ];
        *pixel = image::Rgb(corrected);
    }
    image
        .save(&output_path)
        .map_err(|error| format!("Failed writing corrected calibration preview: {}", error))?;
    Ok(())
}


#[cfg(feature = "calibration")]
fn solve_transform(
    source_patches: &[CalibrationPatchSample],
    target_patch_rgbs: &[[u8; 3]],
) -> Result<CalibrationTransform, String> {
    if source_patches.len() != target_patch_rgbs.len() || source_patches.is_empty() {
        return Err("Calibration transform solve requires matching patch sets.".to_string());
    }
    let exposure_scalar = 2_f64.powf(compute_exposure_offset(source_patches));
    let wb_shift = compute_wb_shift(source_patches) as f64;
    let tint_shift = compute_tint_shift(source_patches) as f64;
    let wb_gains_rgb = [
        (1.0 + wb_shift / 8000.0).clamp(0.75, 1.35),
        1.0,
        (1.0 - wb_shift / 8000.0).clamp(0.75, 1.35),
    ];
    let tint_gains_rgb = [1.0, (1.0 + tint_shift / 40.0).clamp(0.8, 1.25), 1.0];

    let mut xtx = [[0.0f64; 3]; 3];
    let mut xty = [[0.0f64; 3]; 3];
    let mut mean_delta_after = 0.0;

    for (index, patch) in source_patches.iter().enumerate() {
        let src = precondition_rgb(patch.measured_rgb_mean, exposure_scalar, wb_gains_rgb, tint_gains_rgb);
        let target = rgb_to_unit(target_patch_rgbs[index]);
        for row in 0..3 {
            for col in 0..3 {
                xtx[row][col] += src[row] * src[col];
                xty[row][col] += src[row] * target[col];
            }
        }
    }

    let matrix_3x3 = invert_3x3(xtx).map(|inverse| multiply_3x3(inverse, xty));
    for (index, patch) in source_patches.iter().enumerate() {
        let transformed = apply_transform_to_rgb(
            patch.measured_rgb_mean,
            exposure_scalar,
            wb_gains_rgb,
            tint_gains_rgb,
            matrix_3x3.as_ref(),
        );
        let transformed_lab = rgb_to_lab(transformed)?;
        let target_lab = rgb_to_lab(target_patch_rgbs[index])?;
        mean_delta_after += compute_patch_delta(transformed_lab, target_lab);
    }
    mean_delta_after /= source_patches.len() as f64;
    let mean_delta_before = compute_mean_delta_to_target(source_patches, target_patch_rgbs)?;

    Ok(CalibrationTransform {
        exposure_scalar,
        wb_gains_rgb,
        tint_gains_rgb,
        matrix_3x3,
        source_patch_count: source_patches.len(),
        mean_delta_e_before: mean_delta_before,
        mean_delta_e_after: mean_delta_after,
    })
}

#[cfg(feature = "calibration")]
fn compute_mean_delta_to_target(
    source_patches: &[CalibrationPatchSample],
    target_patch_rgbs: &[[u8; 3]],
) -> Result<f64, String> {
    if source_patches.len() != target_patch_rgbs.len() || source_patches.is_empty() {
        return Err("Calibration delta compare requires matching patch sets.".to_string());
    }
    let mut total = 0.0;
    for (index, patch) in source_patches.iter().enumerate() {
        let source_lab = rgb_to_lab(patch.measured_rgb_mean)?;
        let target_lab = rgb_to_lab(target_patch_rgbs[index])?;
        total += compute_patch_delta(source_lab, target_lab);
    }
    Ok(total / source_patches.len() as f64)
}

#[cfg(feature = "calibration")]
fn precondition_rgb(
    rgb: [u8; 3],
    exposure_scalar: f64,
    wb_gains_rgb: [f64; 3],
    tint_gains_rgb: [f64; 3],
) -> [f64; 3] {
    [
        ((rgb[0] as f64 / 255.0) * exposure_scalar * wb_gains_rgb[0] * tint_gains_rgb[0]).clamp(0.0, 1.0),
        ((rgb[1] as f64 / 255.0) * exposure_scalar * wb_gains_rgb[1] * tint_gains_rgb[1]).clamp(0.0, 1.0),
        ((rgb[2] as f64 / 255.0) * exposure_scalar * wb_gains_rgb[2] * tint_gains_rgb[2]).clamp(0.0, 1.0),
    ]
}

#[cfg(feature = "calibration")]
fn rgb_to_unit(rgb: [u8; 3]) -> [f64; 3] {
    [rgb[0] as f64 / 255.0, rgb[1] as f64 / 255.0, rgb[2] as f64 / 255.0]
}

#[cfg(feature = "calibration")]
fn invert_3x3(matrix: [[f64; 3]; 3]) -> Option<[[f64; 3]; 3]> {
    let det =
        matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
        matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
        matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
    if det.abs() < 1e-8 {
        return None;
    }
    let inv_det = 1.0 / det;
    Some([
        [
            (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) * inv_det,
            (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) * inv_det,
            (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) * inv_det,
        ],
        [
            (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) * inv_det,
            (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) * inv_det,
            (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) * inv_det,
        ],
        [
            (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) * inv_det,
            (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) * inv_det,
            (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) * inv_det,
        ],
    ])
}

#[cfg(feature = "calibration")]
fn multiply_3x3(a: [[f64; 3]; 3], b: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut out = [[0.0; 3]; 3];
    for row in 0..3 {
        for col in 0..3 {
            out[row][col] = a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
        }
    }
    out
}

#[cfg(feature = "calibration")]
fn apply_transform_to_rgb(
    rgb: [u8; 3],
    exposure_scalar: f64,
    wb_gains_rgb: [f64; 3],
    tint_gains_rgb: [f64; 3],
    matrix_3x3: Option<&[[f64; 3]; 3]>,
) -> [u8; 3] {
    let base = precondition_rgb(rgb, exposure_scalar, wb_gains_rgb, tint_gains_rgb);
    let transformed = if let Some(matrix) = matrix_3x3 {
        [
            (matrix[0][0] * base[0] + matrix[1][0] * base[1] + matrix[2][0] * base[2]).clamp(0.0, 1.0),
            (matrix[0][1] * base[0] + matrix[1][1] * base[1] + matrix[2][1] * base[2]).clamp(0.0, 1.0),
            (matrix[0][2] * base[0] + matrix[1][2] * base[1] + matrix[2][2] * base[2]).clamp(0.0, 1.0),
        ]
    } else {
        base
    };
    [
        (transformed[0] * 255.0).round().clamp(0.0, 255.0) as u8,
        (transformed[1] * 255.0).round().clamp(0.0, 255.0) as u8,
        (transformed[2] * 255.0).round().clamp(0.0, 255.0) as u8,
    ]
}

#[cfg(feature = "calibration")]
fn generate_transform_preview(
    frame_path: &Path,
    preview_path: &str,
    transform: &CalibrationTransform,
) -> Result<(), String> {
    let mut image = image::open(frame_path)
        .map_err(|error| format!("Failed opening transform preview frame {}: {}", frame_path.display(), error))?
        .to_rgb8();
    let target = PathBuf::from(preview_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed preparing transform preview cache: {}", error))?;
    }
    let tmp_path = build_transform_preview_tmp_path(preview_path);
    for pixel in image.pixels_mut() {
        *pixel = image::Rgb(apply_transform_to_rgb(
            [pixel[0], pixel[1], pixel[2]],
            transform.exposure_scalar,
            transform.wb_gains_rgb,
            transform.tint_gains_rgb,
            transform.matrix_3x3.as_ref(),
        ));
    }
    image
        .save(&tmp_path)
        .map_err(|error| format!("Failed writing temporary transform preview: {}", error))?;
    std::fs::rename(&tmp_path, &target)
        .map_err(|error| format!("Failed finalizing transform preview: {}", error))?;
    Ok(())
}

#[cfg(feature = "calibration")]
fn write_cube_lut(lut_path: &str, transform: &CalibrationTransform, cube_size: u32) -> Result<(), String> {
    let path = PathBuf::from(lut_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed preparing LUT cache: {}", error))?;
    }
    let tmp_path = path.with_extension("tmp.cube");
    let mut body = String::new();
    body.push_str("TITLE \"Wrap Preview Calibration\"\n");
    body.push_str(&format!("LUT_3D_SIZE {}\n", cube_size));
    body.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
    body.push_str("DOMAIN_MAX 1.0 1.0 1.0\n");
    for blue in 0..cube_size {
        for green in 0..cube_size {
            for red in 0..cube_size {
                let input = [
                    ((red as f64) / (cube_size - 1) as f64 * 255.0).round() as u8,
                    ((green as f64) / (cube_size - 1) as f64 * 255.0).round() as u8,
                    ((blue as f64) / (cube_size - 1) as f64 * 255.0).round() as u8,
                ];
                let output = apply_transform_to_rgb(
                    input,
                    transform.exposure_scalar,
                    transform.wb_gains_rgb,
                    transform.tint_gains_rgb,
                    transform.matrix_3x3.as_ref(),
                );
                body.push_str(&format!(
                    "{:.6} {:.6} {:.6}\n",
                    output[0] as f64 / 255.0,
                    output[1] as f64 / 255.0,
                    output[2] as f64 / 255.0
                ));
            }
        }
    }
    std::fs::write(&tmp_path, body).map_err(|error| format!("Failed writing LUT: {}", error))?;
    std::fs::rename(&tmp_path, &path).map_err(|error| format!("Failed finalizing LUT: {}", error))?;
    Ok(())
}


#[cfg(feature = "calibration")]
pub fn render_calibration_overlay_preview(
    frame_path: &Path,
    calibration: &CalibrationChartDetection,
    output_path: &Path,
) -> Result<(), String> {
    let mut image = image::open(frame_path)
        .map_err(|error| format!("Failed opening calibration overlay frame {}: {}", frame_path.display(), error))?
        .to_rgb8();
    let width = image.width() as i32;
    let height = image.height() as i32;
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed preparing calibration overlay path: {}", error))?;
    }
    let tmp_path = output_path.with_extension("tmp.jpg");
    let corners = calibration
        .chart_corners
        .iter()
        .map(|point| ((point.x * width as f64) as i32, (point.y * height as f64) as i32))
        .collect::<Vec<_>>();
    if corners.len() == 4 {
        for index in 0..4 {
            let start = corners[index];
            let end = corners[(index + 1) % 4];
            draw_line(&mut image, start, end, image::Rgb([240, 240, 240]));
        }
    }
    for patch in &calibration.patch_samples {
        let center = (
            (patch.center_x * width as f64) as i32,
            (patch.center_y * height as f64) as i32,
        );
        draw_circle(&mut image, center, 8, delta_color_rgb(patch.delta_e));
    }
    image
        .save(&tmp_path)
        .map_err(|error| format!("Failed writing calibration overlay preview: {}", error))?;
    std::fs::rename(&tmp_path, output_path)
        .map_err(|error| format!("Failed finalizing calibration overlay preview: {}", error))?;
    Ok(())
}

#[cfg(not(feature = "calibration"))]
pub fn render_calibration_overlay_preview(
    _frame_path: &Path,
    _calibration: &CalibrationChartDetection,
    _output_path: &Path,
) -> Result<(), String> {
    Err("Calibration overlay rendering is currently only supported on macOS.".to_string())
}

#[cfg(feature = "calibration")]
fn draw_line(
    image: &mut image::RgbImage,
    start: (i32, i32),
    end: (i32, i32),
    color: image::Rgb<u8>,
) {
    let (mut x0, mut y0) = start;
    let (x1, y1) = end;
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    loop {
        put_pixel_safe(image, x0, y0, color);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
}

#[cfg(feature = "calibration")]
fn draw_circle(
    image: &mut image::RgbImage,
    center: (i32, i32),
    radius: i32,
    color: image::Rgb<u8>,
) {
    for y in -radius..=radius {
        for x in -radius..=radius {
            if x * x + y * y <= radius * radius {
                put_pixel_safe(image, center.0 + x, center.1 + y, color);
            }
        }
    }
}

#[cfg(feature = "calibration")]
fn put_pixel_safe(image: &mut image::RgbImage, x: i32, y: i32, color: image::Rgb<u8>) {
    if x < 0 || y < 0 {
        return;
    }
    let (x, y) = (x as u32, y as u32);
    if x >= image.width() || y >= image.height() {
        return;
    }
    image.put_pixel(x, y, color);
}

#[cfg(feature = "calibration")]
fn delta_color_rgb(delta: f64) -> image::Rgb<u8> {
    if delta <= 2.0 {
        image::Rgb([52, 211, 153])
    } else if delta <= 5.0 {
        image::Rgb([245, 158, 11])
    } else {
        image::Rgb([239, 68, 68])
    }
}

#[cfg(feature = "calibration")]
fn detect_chart_corners(frame: &Mat) -> Result<([Point2f; 4], DetectionDebugInfo), String> {
    let mut gray = Mat::default();
    imgproc::cvt_color(
        frame,
        &mut gray,
        imgproc::COLOR_BGR2GRAY,
        0,
        core::AlgorithmHint::ALGO_HINT_DEFAULT,
    )
    .map_err(|error| format!("Failed converting frame to grayscale: {}", error))?;

    let attempts = [
        DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 75.0,
            canny_high: 180.0,
            blur_size: 5,
            contrast_normalize: false,
            downscale_ratio: 1.0,
            max_dimension: 2200,
            aspect_min: 1.25,
            aspect_max: 1.9,
            central_bias: false,
            fallback_used: false,
            close_kernel: 5,
            dilate_iterations: 1,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 50.0,
            canny_high: 140.0,
            blur_size: 5,
            contrast_normalize: false,
            downscale_ratio: 1.0,
            max_dimension: 1800,
            aspect_min: 1.25,
            aspect_max: 1.9,
            central_bias: false,
            fallback_used: true,
            close_kernel: 7,
            dilate_iterations: 1,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 50.0,
            canny_high: 140.0,
            blur_size: 5,
            contrast_normalize: true,
            downscale_ratio: 1.0,
            max_dimension: 1800,
            aspect_min: 1.25,
            aspect_max: 1.9,
            central_bias: false,
            fallback_used: true,
            close_kernel: 7,
            dilate_iterations: 1,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 55.0,
            canny_high: 150.0,
            blur_size: 7,
            contrast_normalize: false,
            downscale_ratio: 0.8,
            max_dimension: 1600,
            aspect_min: 1.18,
            aspect_max: 2.0,
            central_bias: false,
            fallback_used: true,
            close_kernel: 9,
            dilate_iterations: 2,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 55.0,
            canny_high: 150.0,
            blur_size: 7,
            contrast_normalize: true,
            downscale_ratio: 0.8,
            max_dimension: 1600,
            aspect_min: 1.18,
            aspect_max: 2.0,
            central_bias: true,
            fallback_used: true,
            close_kernel: 9,
            dilate_iterations: 2,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 35.0,
            canny_high: 110.0,
            blur_size: 7,
            contrast_normalize: true,
            downscale_ratio: 0.65,
            max_dimension: 1400,
            aspect_min: 1.12,
            aspect_max: 2.1,
            central_bias: true,
            fallback_used: true,
            close_kernel: 11,
            dilate_iterations: 2,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::DarkMask,
            canny_low: 0.0,
            canny_high: 0.0,
            blur_size: 5,
            contrast_normalize: false,
            downscale_ratio: 0.9,
            max_dimension: 1800,
            aspect_min: 1.05,
            aspect_max: 2.2,
            central_bias: true,
            fallback_used: true,
            close_kernel: 9,
            dilate_iterations: 1,
        },
        DetectionAttemptConfig {
            mode: DetectionMode::DarkMask,
            canny_low: 0.0,
            canny_high: 0.0,
            blur_size: 7,
            contrast_normalize: true,
            downscale_ratio: 0.75,
            max_dimension: 1600,
            aspect_min: 1.0,
            aspect_max: 2.3,
            central_bias: true,
            fallback_used: true,
            close_kernel: 13,
            dilate_iterations: 2,
        },
    ];

    let mut debug = DetectionDebugInfo::default();
    let mut best_failure_candidate: Option<(f64, f64, f64)> = None;

    for attempt in attempts {
        debug.detection_attempts += 1;
        if attempt.fallback_used {
            debug.fallback_used = true;
        }
        let prepared = prepare_detection_frame(&gray, &attempt)
            .map_err(|error| format!("Failed preparing calibration detection frame: {}", error))?;
        let detection_map = build_detection_map(&prepared, &attempt)
            .map_err(|error| format!("Failed generating calibration detection map: {}", error))?;

        let mut contours = Vector::<Vector<Point>>::new();
        imgproc::find_contours(
            &detection_map,
            &mut contours,
            if matches!(attempt.mode, DetectionMode::DarkMask) {
                imgproc::RETR_EXTERNAL
            } else {
                imgproc::RETR_LIST
            },
            imgproc::CHAIN_APPROX_SIMPLE,
            Point::new(0, 0),
        )
        .map_err(|error| format!("Failed finding chart contours: {}", error))?;

        let frame_area = (prepared.cols() * prepared.rows()) as f64;
        let mut best: Option<([Point2f; 4], f64)> = None;

        for contour in contours {
            let Some((ordered, geometry)) = extract_candidate_quad(&contour, frame_area)
                .map_err(|error| format!("Failed extracting chart candidate: {}", error))?
            else {
                continue;
            };
            debug.candidate_count += 1;
            update_best_candidate_debug(&mut debug, &geometry, &mut best_failure_candidate);

            if geometry.area < frame_area * MIN_AREA_RATIO {
                continue;
            }
            if !(attempt.aspect_min..=attempt.aspect_max).contains(&geometry.aspect_ratio) {
                continue;
            }
            if geometry.fill_ratio < 0.72 {
                continue;
            }
            let prepared_max_dim = prepared.cols().max(prepared.rows()).max(1) as f64;
            let gray_max_dim = gray.cols().max(gray.rows()).max(1) as f64;
            let scale_back = (gray_max_dim / prepared_max_dim) as f32;
            let scaled = ordered.map(|point| Point2f::new(point.x * scale_back, point.y * scale_back));
            let score = score_candidate_with_bias(&geometry, prepared.cols(), prepared.rows(), attempt.central_bias);
            if best.map(|(_, current)| score > current).unwrap_or(true) {
                best = Some((scaled, score));
            }
        }

        if let Some((corners, _)) = best {
            return Ok((corners, debug));
        }
    }

    Err(format_detection_failure(&debug, best_failure_candidate))
}

#[cfg(feature = "calibration")]
fn score_candidate(geometry: &CandidateGeometry, frame_width: i32, frame_height: i32) -> f64 {
    let area_score = geometry.area_ratio.clamp(0.0, 1.0);
    let ratio_penalty = (geometry.aspect_ratio - TARGET_ASPECT_RATIO).abs();
    let frame_center_x = frame_width as f64 * 0.5;
    let frame_center_y = frame_height as f64 * 0.5;
    let dx = (geometry.center_x - frame_center_x).abs() / frame_width as f64;
    let dy = (geometry.center_y - frame_center_y).abs() / frame_height as f64;
    area_score * 0.58
        + (1.0 - ratio_penalty.clamp(0.0, 1.0)) * 0.2
        + geometry.fill_ratio.clamp(0.0, 1.0) * 0.14
        + (1.0 - (dx + dy).clamp(0.0, 1.0)) * 0.08
}

#[cfg(feature = "calibration")]
fn score_candidate_with_bias(
    geometry: &CandidateGeometry,
    frame_width: i32,
    frame_height: i32,
    central_bias: bool,
) -> f64 {
    let mut score = score_candidate(geometry, frame_width, frame_height);
    if central_bias {
        let dx = (geometry.center_x - frame_width as f64 * 0.5).abs() / frame_width as f64;
        let dy = (geometry.center_y - frame_height as f64 * 0.5).abs() / frame_height as f64;
        score += (1.0 - (dx + dy).clamp(0.0, 1.0)) * 0.12;
    }
    score
}

#[cfg(feature = "calibration")]
fn prepare_detection_frame(gray: &Mat, attempt: &DetectionAttemptConfig) -> opencv::Result<Mat> {
    let mut working = gray.clone();
    let gray_max_dimension = gray.cols().max(gray.rows()).max(1) as f64;
    let dimension_scale = (attempt.max_dimension as f64 / gray_max_dimension).min(1.0);
    let resize_scale = (dimension_scale * attempt.downscale_ratio).clamp(0.2, 1.0);
    if (resize_scale - 1.0).abs() > f64::EPSILON {
        let width = ((gray.cols() as f64) * resize_scale).round().max(64.0) as i32;
        let height = ((gray.rows() as f64) * resize_scale).round().max(64.0) as i32;
        let mut resized = Mat::default();
        imgproc::resize(
            gray,
            &mut resized,
            Size::new(width, height),
            0.0,
            0.0,
            imgproc::INTER_AREA,
        )?;
        working = resized;
    }
    if attempt.contrast_normalize {
        let mut normalized = Mat::default();
        imgproc::equalize_hist(&working, &mut normalized)?;
        working = normalized;
    }
    let kernel = if attempt.blur_size % 2 == 0 { attempt.blur_size + 1 } else { attempt.blur_size };
    let mut blurred = Mat::default();
    imgproc::gaussian_blur(
        &working,
        &mut blurred,
        Size::new(kernel, kernel),
        0.0,
        0.0,
        core::BORDER_DEFAULT,
        core::AlgorithmHint::ALGO_HINT_DEFAULT,
    )?;
    Ok(blurred)
}

#[cfg(feature = "calibration")]
fn build_detection_map(prepared: &Mat, attempt: &DetectionAttemptConfig) -> opencv::Result<Mat> {
    match attempt.mode {
        DetectionMode::Edges => {
            let mut edges = Mat::default();
            imgproc::canny(prepared, &mut edges, attempt.canny_low, attempt.canny_high, 3, false)?;
            postprocess_edges(&edges, attempt)
        }
        DetectionMode::DarkMask => build_dark_mask(prepared, attempt),
    }
}

#[cfg(feature = "calibration")]
fn postprocess_edges(edges: &Mat, attempt: &DetectionAttemptConfig) -> opencv::Result<Mat> {
    let mut refined = edges.clone();
    if attempt.close_kernel > 1 {
        let kernel = imgproc::get_structuring_element(
            imgproc::MORPH_RECT,
            Size::new(attempt.close_kernel, attempt.close_kernel),
            Point::new(-1, -1),
        )?;
        let mut closed = Mat::default();
        imgproc::morphology_ex(
            &refined,
            &mut closed,
            imgproc::MORPH_CLOSE,
            &kernel,
            Point::new(-1, -1),
            1,
            core::BORDER_CONSTANT,
            Scalar::default(),
        )?;
        refined = closed;
    }
    if attempt.dilate_iterations > 0 {
        let kernel = imgproc::get_structuring_element(
            imgproc::MORPH_RECT,
            Size::new(3, 3),
            Point::new(-1, -1),
        )?;
        let mut dilated = Mat::default();
        imgproc::dilate(
            &refined,
            &mut dilated,
            &kernel,
            Point::new(-1, -1),
            attempt.dilate_iterations,
            core::BORDER_CONSTANT,
            Scalar::default(),
        )?;
        refined = dilated;
    }
    Ok(refined)
}

#[cfg(feature = "calibration")]
fn build_dark_mask(prepared: &Mat, attempt: &DetectionAttemptConfig) -> opencv::Result<Mat> {
    let mut thresholded = Mat::default();
    imgproc::threshold(
        prepared,
        &mut thresholded,
        0.0,
        255.0,
        imgproc::THRESH_BINARY_INV | imgproc::THRESH_OTSU,
    )?;

    let kernel_size = attempt.close_kernel.max(3) | 1;
    let kernel = imgproc::get_structuring_element(
        imgproc::MORPH_RECT,
        Size::new(kernel_size, kernel_size),
        Point::new(-1, -1),
    )?;

    let mut closed = Mat::default();
    imgproc::morphology_ex(
        &thresholded,
        &mut closed,
        imgproc::MORPH_CLOSE,
        &kernel,
        Point::new(-1, -1),
        2,
        core::BORDER_CONSTANT,
        Scalar::default(),
    )?;

    let mut opened = Mat::default();
    imgproc::morphology_ex(
        &closed,
        &mut opened,
        imgproc::MORPH_OPEN,
        &kernel,
        Point::new(-1, -1),
        1,
        core::BORDER_CONSTANT,
        Scalar::default(),
    )?;

    if attempt.dilate_iterations > 0 {
        let grow_kernel = imgproc::get_structuring_element(
            imgproc::MORPH_RECT,
            Size::new(3, 3),
            Point::new(-1, -1),
        )?;
        let mut dilated = Mat::default();
        imgproc::dilate(
            &opened,
            &mut dilated,
            &grow_kernel,
            Point::new(-1, -1),
            attempt.dilate_iterations,
            core::BORDER_CONSTANT,
            Scalar::default(),
        )?;
        return Ok(dilated);
    }

    Ok(opened)
}


#[cfg(feature = "calibration")]
fn update_best_candidate_debug(
    debug: &mut DetectionDebugInfo,
    geometry: &CandidateGeometry,
    best_failure_candidate: &mut Option<(f64, f64, f64)>,
) {
    match best_failure_candidate {
        Some((best_area, _, best_fill)) if geometry.area_ratio <= *best_area && geometry.fill_ratio <= *best_fill => {}
        _ => {
            *best_failure_candidate = Some((geometry.area_ratio, geometry.aspect_ratio, geometry.fill_ratio));
            debug.best_area_ratio = Some(geometry.area_ratio);
            debug.best_aspect_ratio = Some(geometry.aspect_ratio);
            debug.best_rectangularity = Some(geometry.fill_ratio);
        }
    }
}

#[cfg(feature = "calibration")]
fn format_detection_failure(
    debug: &DetectionDebugInfo,
    best_failure_candidate: Option<(f64, f64, f64)>,
) -> String {
    let best_area = best_failure_candidate
        .map(|(area, _, _)| area * 100.0)
        .unwrap_or(0.0);
    let best_aspect = best_failure_candidate
        .map(|(_, aspect, _)| aspect)
        .unwrap_or(0.0);
    let best_fill = best_failure_candidate
        .map(|(_, _, fill)| fill * 100.0)
        .unwrap_or(0.0);
    format!(
        "Summary: Chart not detected\nDetails:\nDetection attempts: {}\nCandidate count: {}\nBest candidate area: {:.1}%\nBest aspect ratio: {:.2}\nBest rectangularity: {:.1}%\nFallback used: {}\nDetection remained below threshold.",
        debug.detection_attempts,
        debug.candidate_count,
        best_area,
        best_aspect,
        best_fill,
        if debug.fallback_used { "yes" } else { "no" },
    )
}

#[cfg(feature = "calibration")]
fn build_crop_context(
    frame: &Mat,
    crop_rect: Option<&CalibrationCropRectNormalized>,
) -> Result<CropContext, String> {
    let Some(crop_rect) = crop_rect else {
        return Ok(CropContext {
            detection_frame: frame.clone(),
            offset: None,
        });
    };

    let frame_width = frame.cols().max(1);
    let frame_height = frame.rows().max(1);
    let crop_x = (crop_rect.x.clamp(0.0, 0.98) * frame_width as f64).round() as i32;
    let crop_y = (crop_rect.y.clamp(0.0, 0.98) * frame_height as f64).round() as i32;
    let crop_width = (crop_rect.width.clamp(0.02, 1.0) * frame_width as f64).round() as i32;
    let crop_height = (crop_rect.height.clamp(0.02, 1.0) * frame_height as f64).round() as i32;

    let width = crop_width.clamp(64, frame_width.max(64));
    let height = crop_height.clamp(64, frame_height.max(64));
    let x = crop_x.clamp(0, (frame_width - width).max(0));
    let y = crop_y.clamp(0, (frame_height - height).max(0));
    let roi = Rect::new(x, y, width.max(1), height.max(1));
    let cropped = Mat::roi(frame, roi)
        .map_err(|error| format!("Failed creating calibration crop ROI: {}", error))?;
    let mut detection_frame = Mat::default();
    cropped
        .copy_to(&mut detection_frame)
        .map_err(|error| format!("Failed copying calibration crop ROI: {}", error))?;
    Ok(CropContext {
        detection_frame,
        offset: Some(Point2f::new(x as f32, y as f32)),
    })
}

#[cfg(feature = "calibration")]
fn resolve_manual_corners(
    corners: &[CalibrationPoint],
    frame_width: f64,
    frame_height: f64,
) -> Result<[Point2f; 4], String> {
    if corners.len() != 4 {
        return Err("Manual chart override requires exactly four corners.".to_string());
    }
    let mut points = Vector::<Point>::new();
    for corner in corners {
        let x = (corner.x.clamp(0.0, 1.0) * frame_width).round() as i32;
        let y = (corner.y.clamp(0.0, 1.0) * frame_height).round() as i32;
        points.push(Point::new(x, y));
    }
    order_quad_points(&points)
}

#[cfg(feature = "calibration")]

#[cfg(feature = "calibration")]
fn compute_manual_aspect_ratio(corners: &[Point2f; 4]) -> f64 {
    let width_a = distance(corners[0], corners[1]);
    let width_b = distance(corners[2], corners[3]);
    let height_a = distance(corners[0], corners[3]);
    let height_b = distance(corners[1], corners[2]);
    ((width_a + width_b) * 0.5 / ((height_a + height_b) * 0.5).max(1.0)).max(1.0)
}

#[cfg(feature = "calibration")]
fn extract_candidate_quad(
    contour: &Vector<Point>,
    frame_area: f64,
) -> Result<Option<([Point2f; 4], CandidateGeometry)>, String> {
    if contour.len() < 4 {
        return Ok(None);
    }

    let perimeter = imgproc::arc_length(contour, true)
        .map_err(|error| format!("Failed measuring contour perimeter: {}", error))?;
    if perimeter <= 0.0 {
        return Ok(None);
    }

    let area = imgproc::contour_area(contour, false)
        .map_err(|error| format!("Failed measuring contour area: {}", error))?
        .abs();
    if area <= 0.0 {
        return Ok(None);
    }

    let rotated_rect = imgproc::min_area_rect(contour)
        .map_err(|error| format!("Failed computing rotated chart bounds: {}", error))?;
    let rect_size = normalized_rotated_size(&rotated_rect.size);
    if rect_size.width < 12.0 || rect_size.height < 12.0 {
        return Ok(None);
    }

    let rect_area = (rect_size.width * rect_size.height) as f64;
    if rect_area <= 0.0 {
        return Ok(None);
    }

    let geometry = CandidateGeometry {
        area,
        area_ratio: (area / frame_area).clamp(0.0, 1.0),
        aspect_ratio: (rect_size.width as f64 / rect_size.height.max(1.0) as f64).max(1.0),
        fill_ratio: (area / rect_area).clamp(0.0, 1.0),
        center_x: rotated_rect.center.x as f64,
        center_y: rotated_rect.center.y as f64,
    };

    let mut approx = Vector::<Point>::new();
    imgproc::approx_poly_dp(contour, &mut approx, 0.02 * perimeter, true)
        .map_err(|error| format!("Failed approximating contour polygon: {}", error))?;

    if approx.len() == 4 {
        let ordered = order_quad_points(&approx)?;
        return Ok(Some((ordered, geometry)));
    }

    if geometry.fill_ratio < 0.84 {
        return Ok(None);
    }

    let ordered = rotated_rect_points(&rotated_rect)?;
    Ok(Some((ordered, geometry)))
}

#[cfg(feature = "calibration")]
fn normalized_rotated_size(size: &Size2f) -> Size2f {
    if size.width >= size.height {
        *size
    } else {
        Size2f::new(size.height, size.width)
    }
}

#[cfg(feature = "calibration")]
fn rotated_rect_points(rect: &RotatedRect) -> Result<[Point2f; 4], String> {
    let mut points = Mat::default();
    imgproc::box_points(*rect, &mut points)
        .map_err(|error| format!("Failed resolving rotated chart corners: {}", error))?;
    let points = points
        .reshape_def(Point2f::opencv_channels())
        .map_err(|error| format!("Failed reshaping rotated chart corners: {}", error))?;
    let mut corners = Vector::<Point>::new();
    for index in 0..4 {
        let point = points
            .at_2d::<Point2f>(index, 0)
            .map_err(|error| format!("Failed reading rotated chart corner: {}", error))?;
        corners.push(Point::new(point.x.round() as i32, point.y.round() as i32));
    }
    order_quad_points(&corners)
}

#[cfg(feature = "calibration")]
fn order_quad_points(points: &Vector<Point>) -> Result<[Point2f; 4], String> {
    let mut corners = points
        .iter()
        .map(|point| Point2f::new(point.x as f32, point.y as f32))
        .collect::<Vec<_>>();
    if corners.len() != 4 {
        return Err("Chart candidate did not resolve to four corners.".to_string());
    }
    corners.sort_by(|a, b| {
        (a.x + a.y)
            .partial_cmp(&(b.x + b.y))
            .unwrap_or(Ordering::Equal)
    });

    let top_left = corners[0];
    let bottom_right = corners[3];
    let mut remaining = [corners[1], corners[2]];
    remaining.sort_by(|a, b| {
        (a.y - a.x)
            .partial_cmp(&(b.y - b.x))
            .unwrap_or(Ordering::Equal)
    });
    let top_right = remaining[0];
    let bottom_left = remaining[1];
    Ok([top_left, top_right, bottom_right, bottom_left])
}

#[cfg(feature = "calibration")]
fn normalize_chart(frame: &Mat, corners: &[Point2f; 4]) -> Result<Mat, String> {
    let mut src = Vector::<Point2f>::new();
    for corner in corners {
        src.push(*corner);
    }
    let mut dst = Vector::<Point2f>::new();
    dst.push(Point2f::new(0.0, 0.0));
    dst.push(Point2f::new((NORMALIZED_WIDTH - 1) as f32, 0.0));
    dst.push(Point2f::new(
        (NORMALIZED_WIDTH - 1) as f32,
        (NORMALIZED_HEIGHT - 1) as f32,
    ));
    dst.push(Point2f::new(0.0, (NORMALIZED_HEIGHT - 1) as f32));

    let transform = imgproc::get_perspective_transform(&src, &dst, 0)
        .map_err(|error| format!("Failed building perspective transform: {}", error))?;
    let mut normalized = Mat::default();
    imgproc::warp_perspective(
        frame,
        &mut normalized,
        &transform,
        Size::new(NORMALIZED_WIDTH, NORMALIZED_HEIGHT),
        imgproc::INTER_LINEAR,
        BORDER_REPLICATE,
        Scalar::default(),
    )
    .map_err(|error| format!("Failed warping chart perspective: {}", error))?;
    Ok(normalized)
}

#[cfg(feature = "calibration")]
pub fn sample_patch_colors(normalized_chart: &Mat) -> Result<Vec<CalibrationPatchSample>, String> {
    let mut patch_samples = Vec::with_capacity(TOTAL_PATCHES);
    let patch_width = NORMALIZED_WIDTH as f64 / PATCH_COLUMNS as f64;
    let patch_height = NORMALIZED_HEIGHT as f64 / PATCH_ROWS as f64;
    let sample_scale = 0.447;

    for row in 0..PATCH_ROWS {
        for column in 0..PATCH_COLUMNS {
            let patch_index = row * PATCH_COLUMNS + column;
            let center_x = column as f64 * patch_width + patch_width * 0.5;
            let center_y = row as f64 * patch_height + patch_height * 0.5;
            let sample_width = (patch_width * sample_scale).round().max(8.0) as i32;
            let sample_height = (patch_height * sample_scale).round().max(8.0) as i32;
            let left = (center_x.round() as i32 - sample_width / 2).clamp(0, NORMALIZED_WIDTH - sample_width);
            let top = (center_y.round() as i32 - sample_height / 2).clamp(0, NORMALIZED_HEIGHT - sample_height);
            let roi_rect = Rect::new(left, top, sample_width, sample_height);
            let roi = normalized_chart
                .roi(roi_rect)
                .map_err(|error| format!("Failed extracting patch ROI: {}", error))?;

            let measured_mean_bgr = mean_bgr(&roi)?;
            let measured_median_bgr = median_bgr(&roi)?;
            let measured_mean_rgb = [measured_mean_bgr[2], measured_mean_bgr[1], measured_mean_bgr[0]];
            let measured_median_rgb = [measured_median_bgr[2], measured_median_bgr[1], measured_median_bgr[0]];
            let measured_lab = bgr_to_lab(measured_mean_bgr)?;
            let reference = SPYDERCHECKR_REFERENCE[patch_index];
            let reference_lab = rgb_to_lab(reference.reference_rgb)?;
            patch_samples.push(CalibrationPatchSample {
                patch_index: reference.patch_index,
                measured_rgb_mean: measured_mean_rgb,
                measured_rgb_median: measured_median_rgb,
                reference_rgb: reference.reference_rgb,
                reference_lab,
                delta_e: compute_patch_delta(measured_lab, reference_lab),
                center_x: (center_x / NORMALIZED_WIDTH as f64).clamp(0.0, 1.0),
                center_y: (center_y / NORMALIZED_HEIGHT as f64).clamp(0.0, 1.0),
            });
        }
    }

    Ok(patch_samples)
}

#[cfg(feature = "calibration")]
pub fn compute_patch_delta(measured_lab: [f64; 3], reference_lab: [f64; 3]) -> f64 {
    delta_e_2000(measured_lab, reference_lab)
}

#[cfg(feature = "calibration")]
fn mean_bgr(roi: &impl core::ToInputArray) -> Result<[u8; 3], String> {
    let mean = core::mean(roi, &core::no_array())
        .map_err(|error| format!("Failed computing patch mean: {}", error))?;
    Ok([
        mean[0].round().clamp(0.0, 255.0) as u8,
        mean[1].round().clamp(0.0, 255.0) as u8,
        mean[2].round().clamp(0.0, 255.0) as u8,
    ])
}

#[cfg(feature = "calibration")]
fn median_bgr(roi: &impl core::MatTraitConst) -> Result<[u8; 3], String> {
    let rows = roi.rows();
    let cols = roi.cols();
    let mut blue = Vec::with_capacity((rows * cols) as usize);
    let mut green = Vec::with_capacity((rows * cols) as usize);
    let mut red = Vec::with_capacity((rows * cols) as usize);
    for y in 0..rows {
        for x in 0..cols {
            let pixel = roi
                .at_2d::<Vec3b>(y, x)
                .map_err(|error| format!("Failed reading patch pixel: {}", error))?;
            blue.push(pixel[0]);
            green.push(pixel[1]);
            red.push(pixel[2]);
        }
    }
    Ok([median_u8(&mut blue), median_u8(&mut green), median_u8(&mut red)])
}

#[cfg(feature = "calibration")]
fn median_u8(values: &mut [u8]) -> u8 {
    values.sort_unstable();
    values[values.len() / 2]
}

#[cfg(feature = "calibration")]
fn bgr_to_lab(bgr: [u8; 3]) -> Result<[f64; 3], String> {
    let pixel = Mat::from_slice_2d(&[[Vec3b::from([bgr[0], bgr[1], bgr[2]])]])
        .map_err(|error| format!("Failed building BGR patch mat: {}", error))?;
    let mut lab = Mat::default();
    imgproc::cvt_color(
        &pixel,
        &mut lab,
        imgproc::COLOR_BGR2Lab,
        0,
        core::AlgorithmHint::ALGO_HINT_DEFAULT,
    )
    .map_err(|error| format!("Failed converting BGR sample to Lab: {}", error))?;
    let lab_pixel = lab
        .at_2d::<Vec3b>(0, 0)
        .map_err(|error| format!("Failed reading Lab patch sample: {}", error))?;
    Ok([
        lab_pixel[0] as f64 * 100.0 / 255.0,
        lab_pixel[1] as f64 - 128.0,
        lab_pixel[2] as f64 - 128.0,
    ])
}




#[cfg(feature = "calibration")]
fn rgb_to_lab(rgb: [u8; 3]) -> Result<[f64; 3], String> {
    bgr_to_lab([rgb[2], rgb[1], rgb[0]])
}

#[cfg(feature = "calibration")]
fn delta_e_2000(a: [f64; 3], b: [f64; 3]) -> f64 {
    let (l1, a1, b1) = (a[0], a[1], a[2]);
    let (l2, a2, b2) = (b[0], b[1], b[2]);
    let avg_lp = 0.5 * (l1 + l2);
    let c1 = (a1 * a1 + b1 * b1).sqrt();
    let c2 = (a2 * a2 + b2 * b2).sqrt();
    let avg_c = 0.5 * (c1 + c2);
    let g = 0.5 * (1.0 - (avg_c.powi(7) / (avg_c.powi(7) + 25_f64.powi(7))).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = (a1p * a1p + b1 * b1).sqrt();
    let c2p = (a2p * a2p + b2 * b2).sqrt();
    let avg_cp = 0.5 * (c1p + c2p);
    let h1p = hue_angle(b1, a1p);
    let h2p = hue_angle(b2, a2p);
    let delta_lp = l2 - l1;
    let delta_cp = c2p - c1p;
    let delta_hp = if c1p * c2p == 0.0 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p <= h1p {
        h2p - h1p + 360.0
    } else {
        h2p - h1p - 360.0
    };
    let delta_hp_rad = 2.0 * (c1p * c2p).sqrt() * (degrees_to_radians(delta_hp) / 2.0).sin();
    let avg_hp = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) * 0.5
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) * 0.5
    } else {
        (h1p + h2p - 360.0) * 0.5
    };
    let t = 1.0
        - 0.17 * degrees_to_radians(avg_hp - 30.0).cos()
        + 0.24 * degrees_to_radians(2.0 * avg_hp).cos()
        + 0.32 * degrees_to_radians(3.0 * avg_hp + 6.0).cos()
        - 0.20 * degrees_to_radians(4.0 * avg_hp - 63.0).cos();
    let delta_theta = 30.0 * (-(((avg_hp - 275.0) / 25.0).powi(2))).exp();
    let r_c = 2.0 * (avg_cp.powi(7) / (avg_cp.powi(7) + 25_f64.powi(7))).sqrt();
    let s_l = 1.0 + (0.015 * (avg_lp - 50.0).powi(2)) / (20.0 + (avg_lp - 50.0).powi(2)).sqrt();
    let s_c = 1.0 + 0.045 * avg_cp;
    let s_h = 1.0 + 0.015 * avg_cp * t;
    let r_t = -r_c * degrees_to_radians(2.0 * delta_theta).sin();

    ((delta_lp / s_l).powi(2)
        + (delta_cp / s_c).powi(2)
        + (delta_hp_rad / s_h).powi(2)
        + r_t * (delta_cp / s_c) * (delta_hp_rad / s_h))
        .sqrt()
}

#[cfg(feature = "calibration")]
fn hue_angle(b: f64, a: f64) -> f64 {
    let mut angle = radians_to_degrees(b.atan2(a));
    if angle < 0.0 {
        angle += 360.0;
    }
    angle
}

#[cfg(feature = "calibration")]
fn degrees_to_radians(value: f64) -> f64 {
    value * std::f64::consts::PI / 180.0
}

#[cfg(feature = "calibration")]
fn radians_to_degrees(value: f64) -> f64 {
    value * 180.0 / std::f64::consts::PI
}


#[cfg(feature = "calibration")]
fn score_detection(corners: &[Point2f; 4], frame_width: f64, frame_height: f64) -> f64 {
    let width_a = distance(corners[0], corners[1]);
    let width_b = distance(corners[2], corners[3]);
    let height_a = distance(corners[0], corners[3]);
    let height_b = distance(corners[1], corners[2]);
    let mean_width = (width_a + width_b) * 0.5;
    let mean_height = (height_a + height_b) * 0.5;
    let ratio = mean_width / mean_height.max(1.0);
    let area = polygon_area(corners);
    let area_ratio = area / (frame_width * frame_height);
    (1.0 - (ratio - TARGET_ASPECT_RATIO).abs().min(1.0)) * 0.4 + area_ratio.clamp(0.0, 1.0) * 0.6
}

#[cfg(feature = "calibration")]
fn distance(a: Point2f, b: Point2f) -> f64 {
    let dx = a.x as f64 - b.x as f64;
    let dy = a.y as f64 - b.y as f64;
    (dx * dx + dy * dy).sqrt()
}


#[cfg(feature = "calibration")]
fn polygon_area(corners: &[Point2f; 4]) -> f64 {
    let mut area = 0.0;
    for index in 0..4 {
        let current = corners[index];
        let next = corners[(index + 1) % 4];
        area += current.x as f64 * next.y as f64 - next.x as f64 * current.y as f64;
    }
    area.abs() * 0.5
}

#[cfg(all(test, feature = "calibration"))]
mod tests {
    use super::*;

    #[test]
    fn extract_candidate_quad_accepts_dense_rectangular_contour() {
        let contour = Vector::<Point>::from_iter([
            Point::new(10, 12),
            Point::new(48, 8),
            Point::new(92, 11),
            Point::new(126, 20),
            Point::new(132, 48),
            Point::new(128, 78),
            Point::new(86, 84),
            Point::new(38, 82),
            Point::new(14, 70),
            Point::new(8, 40),
        ]);

        let (corners, geometry) = extract_candidate_quad(&contour, 200.0 * 120.0)
            .expect("candidate extraction should succeed")
            .expect("rectangular contour should produce a candidate");

        assert_eq!(corners.len(), 4);
        assert!(geometry.aspect_ratio > 1.2 && geometry.aspect_ratio < 1.9);
        assert!(geometry.fill_ratio > 0.72);
        assert!(geometry.area_ratio > MIN_AREA_RATIO);
    }

    #[test]
    fn prepare_detection_frame_caps_large_input_dimension() {
        let gray = Mat::new_rows_cols_with_default(4000, 6000, core::CV_8UC1, Scalar::all(0.0))
            .expect("test mat should allocate");
        let attempt = DetectionAttemptConfig {
            mode: DetectionMode::Edges,
            canny_low: 50.0,
            canny_high: 140.0,
            blur_size: 5,
            contrast_normalize: false,
            downscale_ratio: 1.0,
            max_dimension: 1800,
            aspect_min: 1.2,
            aspect_max: 1.9,
            central_bias: false,
            fallback_used: false,
            close_kernel: 5,
            dilate_iterations: 1,
        };

        let prepared = prepare_detection_frame(&gray, &attempt).expect("prepare should succeed");

        assert_eq!(prepared.cols().max(prepared.rows()), 1800);
    }

    #[test]
    fn resolve_manual_corners_orders_input_quad() {
        let corners = [
            CalibrationPoint { x: 0.82, y: 0.78 },
            CalibrationPoint { x: 0.18, y: 0.22 },
            CalibrationPoint { x: 0.18, y: 0.8 },
            CalibrationPoint { x: 0.84, y: 0.2 },
        ];
        let ordered = resolve_manual_corners(&corners, 1000.0, 800.0).expect("manual corners should resolve");
        assert!(ordered[0].x < ordered[1].x);
        assert!(ordered[0].y < ordered[3].y);
        assert!(ordered[2].x > ordered[3].x);
    }

    #[test]
    fn dark_mask_detection_map_finds_large_dark_region() {
        let mut gray = Mat::new_rows_cols_with_default(240, 320, core::CV_8UC1, Scalar::all(220.0))
            .expect("test mat should allocate");
        imgproc::rectangle(
            &mut gray,
            Rect::new(80, 60, 140, 100),
            Scalar::all(35.0),
            -1,
            imgproc::LINE_8,
            0,
        )
        .expect("rectangle should draw");

        let attempt = DetectionAttemptConfig {
            mode: DetectionMode::DarkMask,
            canny_low: 0.0,
            canny_high: 0.0,
            blur_size: 5,
            contrast_normalize: false,
            downscale_ratio: 1.0,
            max_dimension: 320,
            aspect_min: 1.0,
            aspect_max: 2.2,
            central_bias: true,
            fallback_used: true,
            close_kernel: 9,
            dilate_iterations: 1,
        };

        let prepared = prepare_detection_frame(&gray, &attempt).expect("prepare should succeed");
        let mask = build_detection_map(&prepared, &attempt).expect("dark mask should build");

        let mut contours = Vector::<Vector<Point>>::new();
        imgproc::find_contours(
            &mask,
            &mut contours,
            imgproc::RETR_EXTERNAL,
            imgproc::CHAIN_APPROX_SIMPLE,
            Point::new(0, 0),
        )
        .expect("contours should extract");

        let frame_area = (prepared.cols() * prepared.rows()) as f64;
        let best_area_ratio = contours
            .iter()
            .filter_map(|contour| extract_candidate_quad(&contour, frame_area).ok().flatten().map(|(_, geometry)| geometry.area_ratio))
            .fold(0.0, f64::max);

        assert!(best_area_ratio > 0.12);
    }
}
