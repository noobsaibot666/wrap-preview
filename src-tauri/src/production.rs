use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraProfile {
    pub brand: String,
    pub model: String,
    pub sensor_type: String,
    pub recommended_modes: Vec<RecommendedMode>,
    pub known_pitfalls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedMode {
    pub label: String, // e.g., "ProRes 422 HQ / Log"
    pub base_iso: Vec<i32>,
    pub wb_notes: String,
    pub highlight_limit_guidance: String,
    pub skin_ire_targets: HashMap<String, i32>, // e.g., {"log": 45, "rec709": 70}
    pub sharpening_nr_defaults: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookPreset {
    pub id: String,
    pub name: String,
    pub description: String,
}

pub fn load_camera_profiles() -> Vec<CameraProfile> {
    let json_data = include_str!("../resources/camera_profiles.json");
    serde_json::from_str(json_data).unwrap_or_default()
}

pub fn load_look_presets() -> Vec<LookPreset> {
    let json_data = include_str!("../resources/look_presets.json");
    serde_json::from_str(json_data).unwrap_or_default()
}
