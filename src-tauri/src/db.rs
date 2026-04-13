use rusqlite::{params, params_from_iter, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Thread-safe database wrapper
#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
    _path: Arc<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub created_at: String,
    pub bookmark: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRoot {
    pub id: String,
    pub project_id: String,
    pub root_path: String,
    pub label: String,
    pub created_at: String,
    pub bookmark: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub project_id: String,
    pub root_id: String,
    pub rel_path: String,
    pub filename: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub duration_ms: u64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub video_bitrate: u64,
    pub format_name: String,
    pub audio_codec: String,
    pub audio_channels: u32,
    pub audio_sample_rate: u32,
    pub camera_iso: Option<String>,
    pub camera_white_balance: Option<String>,
    pub camera_lens: Option<String>,
    pub camera_aperture: Option<String>,
    pub camera_angle: Option<String>,
    pub audio_summary: String,
    pub timecode: Option<String>,
    pub status: String, // "ok", "warn", "fail"
    pub rating: i32,
    pub flag: String, // "none", "pick", "reject"
    pub notes: Option<String>,
    pub shot_size: Option<String>,
    pub movement: Option<String>,
    pub manual_order: i32,
    pub audio_envelope: Option<Vec<u8>>,
    pub lut_enabled: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneBlock {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub display_order: i32,
    pub clip_count: i32,
    pub camera_list: Option<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneBlockClip {
    pub block_id: String,
    pub clip_id: String,
    pub camera_label: Option<String>,
    pub sort_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thumbnail {
    pub clip_id: String,
    pub jump_seconds: u32,
    pub index: u32,
    pub timestamp_ms: u64,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationJob {
    pub id: String,
    pub project_id: String,
    pub created_at: String,
    pub source_path: String,
    pub source_root: String,
    pub source_label: String,
    pub dest_path: String,
    pub dest_root: String,
    pub dest_label: String,
    pub mode: String,   // "FAST", "SOLID"
    pub status: String, // "RUNNING", "DONE", "FAILED", "CANCELLED"
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub counts_json: Option<String>,
    pub issues_json: Option<String>,
    pub total_files: u32,
    pub total_bytes: u64,
    pub verified_ok_count: u32,
    pub missing_count: u32,
    pub size_mismatch_count: u32,
    pub hash_mismatch_count: u32,
    pub unreadable_count: u32,
    pub extra_in_dest_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationQueueItem {
    pub id: String,
    pub project_id: String,
    pub idx: i32,
    pub label: Option<String>,
    pub source_path: String,
    pub dest_path: String,
    pub last_job_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationItem {
    pub job_id: String,
    pub rel_path: String,
    pub source_size: u64,
    pub dest_size: Option<u64>,
    pub source_mtime: u64,
    pub dest_mtime: Option<u64>,
    pub source_hash: Option<String>,
    pub dest_hash: Option<String>,
    pub status: String, // "OK", "MISSING", "SIZE_MISMATCH", "HASH_MISMATCH", "UNREADABLE_SOURCE", "UNREADABLE_DEST", "SKIPPED", "EXTRA_IN_DEST"
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneDetectionCache {
    pub clip_id: String,
    pub threshold: f64,
    pub analyzer_version: String,
    pub cut_points_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub project_id: String,
    pub settings_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub project_id: String,
    pub filename: String,
    pub original_path: String,
    pub storage_key: String,
    pub file_size: u64,
    pub duration_ms: Option<u64>,
    pub frame_rate: Option<f64>,
    pub avg_frame_rate: Option<String>,
    pub r_frame_rate: Option<String>,
    pub is_vfr: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub status: String,
    pub checksum_sha256: String,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetVersion {
    pub id: String,
    pub asset_id: String,
    pub version_number: i32,
    pub original_file_key: String,
    pub proxy_playlist_key: Option<String>,
    pub proxy_mp4_key: Option<String>,
    pub thumbnails_key: Option<String>,
    pub poster_key: Option<String>,
    pub processing_status: String,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreComment {
    pub id: String,
    pub asset_version_id: String,
    pub timestamp_ms: i64,
    pub frame_number: Option<i64>,
    pub text: String,
    pub author_name: String,
    pub resolved: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreAnnotation {
    pub id: String,
    pub comment_id: String,
    pub asset_version_id: String,
    pub timestamp_ms: i64,
    pub vector_data: String,
    pub coordinate_space: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreFrameNote {
    pub id: String,
    pub project_id: String,
    pub asset_id: String,
    pub asset_version_id: String,
    pub timestamp_ms: i64,
    pub frame_number: Option<i64>,
    pub title: Option<String>,
    pub image_key: String,
    pub vector_data: String,
    pub created_at: String,
    pub updated_at: String,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreApprovalState {
    pub asset_version_id: String,
    pub status: String,
    pub approved_at: Option<String>,
    pub approved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreShareLink {
    pub id: String,
    pub project_id: String,
    pub token: String,
    pub asset_version_ids_json: String,
    pub expires_at: Option<String>,
    pub password_hash: Option<String>,
    pub allow_comments: bool,
    pub allow_download: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreShareSession {
    pub id: String,
    pub share_link_id: String,
    pub token: String,
    pub display_name: Option<String>,
    pub expires_at: String,
    pub created_at: String,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCoreProject {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentJob {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub progress: f32,
    pub message: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionProject {
    pub id: String,
    pub name: String,
    pub client_name: String,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionCameraConfig {
    pub id: String,
    pub project_id: String,
    pub slot: String, // "A", "B", "C"
    pub brand: String,
    pub model: String,
    pub recording_mode: String,
    pub log_family: String,
    pub base_iso_list_json: String,
    pub lens_character: Option<String>,
    pub diffusion: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionLookSetup {
    pub id: String,
    pub project_id: String,
    pub target_type: String, // "arri", "fuji", "cine_neutral", "custom"
    pub custom_notes: Option<String>,
    pub lighting: String, // "controlled", "mixed", "run_and_gun"
    pub skin_priority: bool,
    pub outputs_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionOnsetChecks {
    pub id: String,
    pub project_id: String,
    pub ready_state_json: String,
    pub lighting_checks_json: String,
    pub failure_modes_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionPreset {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub payload_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotListProject {
    pub id: String,
    pub title: String,
    pub day_label: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotListRow {
    pub id: String,
    pub project_id: String,
    pub sort_order: i32,
    pub shot_number: String,
    pub capture_type: String,
    pub scene: String,
    pub location: String,
    pub timing: String,
    pub shot_type: String,
    pub description: String,
    pub camera_lens: String,
    pub camera_movement: String,
    pub audio_notes: String,
    pub lighting_notes: String,
    pub talent_subjects: String,
    pub props_details: String,
    pub notes: String,
    pub status: String,
    // Backward compatibility
    pub scene_setup: String,
    pub movement: String,
    pub location_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotListEquipmentSection {
    pub id: String,
    pub project_id: String,
    pub sort_order: i32,
    pub section_key: Option<String>,
    pub section_name: String,
    pub icon_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotListEquipmentItem {
    pub id: String,
    pub section_id: String,
    pub sort_order: i32,
    pub item_name: String,
    pub item_type: String,
    pub icon_name: String,
    pub notes: String,
    pub camera_label: Option<String>,
    pub media_type: Option<String>,
    pub capacity_value: Option<i32>,
    pub capacity_unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabSource {
    pub id: String,
    pub project_id: String,
    pub slot: String,
    pub source_path: String,
    pub source_hash: String,
    pub created_at: String,
    pub last_analyzed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabRunRecord {
    pub id: String,
    pub project_id: String,
    pub hero_slot: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionMatchLabResultRecord {
    pub id: String,
    pub run_id: String,
    pub slot: String,
    pub proxy_path: Option<String>,
    pub representative_frame_path: String,
    pub frames_json: String,
    pub metrics_json: String,
    pub calibration_json: Option<String>,
    pub created_at: String,
}

impl Database {
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
            _path: Arc::new(db_path.to_string()),
        };
        db.create_tables()?;

        // --- Migrations: Add new columns to existing clips table ---
        {
            let conn = db.conn.lock().unwrap();
            let mut stmt = conn.prepare("PRAGMA table_info(clips)")?;
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();

            if !columns.contains(&"rating".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !columns.contains(&"root_id".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN root_id TEXT NOT NULL DEFAULT 'legacy_root'",
                    [],
                )?;
            }
            if !columns.contains(&"rel_path".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN rel_path TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            if !columns.contains(&"flag".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN flag TEXT NOT NULL DEFAULT 'none'",
                    [],
                )?;
            }
            if !columns.contains(&"notes".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN notes TEXT", [])?;
            }
            if !columns.contains(&"audio_envelope".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN audio_envelope BLOB", [])?;
            }
            if !columns.contains(&"video_bitrate".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN video_bitrate INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !columns.contains(&"format_name".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN format_name TEXT NOT NULL DEFAULT 'unknown'",
                    [],
                )?;
            }
            if !columns.contains(&"audio_codec".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN audio_codec TEXT NOT NULL DEFAULT 'none'",
                    [],
                )?;
            }
            if !columns.contains(&"audio_channels".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN audio_channels INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !columns.contains(&"audio_sample_rate".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN audio_sample_rate INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !columns.contains(&"camera_iso".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN camera_iso TEXT", [])?;
            }
            if !columns.contains(&"camera_white_balance".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN camera_white_balance TEXT", [])?;
            }
            if !columns.contains(&"shot_size".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN shot_size TEXT", [])?;
            }
            if !columns.contains(&"movement".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN movement TEXT", [])?;
            }
            if !columns.contains(&"manual_order".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN manual_order INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !columns.contains(&"lut_enabled".to_string()) {
                conn.execute(
                    "ALTER TABLE clips ADD COLUMN lut_enabled INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !columns.contains(&"camera_lens".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN camera_lens TEXT", [])?;
            }
            if !columns.contains(&"camera_aperture".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN camera_aperture TEXT", [])?;
            }
            if !columns.contains(&"camera_angle".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN camera_angle TEXT", [])?;
            }
            let mut matchlab_stmt = conn.prepare("PRAGMA table_info(production_matchlab_results)")?;
            let matchlab_columns: Vec<String> = matchlab_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !matchlab_columns.is_empty() && !matchlab_columns.contains(&"calibration_json".to_string()) {
                conn.execute(
                    "ALTER TABLE production_matchlab_results ADD COLUMN calibration_json TEXT",
                    [],
                )?;
            }

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS project_settings (
                    project_id TEXT PRIMARY KEY,
                    settings_json TEXT NOT NULL
                );
                ",
            )?;
            let mut settings_stmt = conn.prepare("PRAGMA table_info(project_settings)")?;
            let settings_columns: Vec<String> = settings_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !settings_columns.contains(&"settings_json".to_string()) {
                conn.execute(
                    "ALTER TABLE project_settings ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
                    [],
                )?;
                if settings_columns.contains(&"settings".to_string()) {
                    conn.execute(
                        "UPDATE project_settings
                         SET settings_json = CASE
                           WHEN settings IS NULL OR TRIM(settings) = '' THEN '{}'
                           ELSE settings
                         END",
                        [],
                    )?;
                }
            }

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS project_roots (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    root_path TEXT NOT NULL,
                    label TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(project_id, root_path),
                    FOREIGN KEY(project_id) REFERENCES projects(id)
                );
                ",
            )?;

            let mut block_stmt = conn.prepare("PRAGMA table_info(blocks)")?;
            let block_columns: Vec<String> = block_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !block_columns.contains(&"clip_count".to_string()) {
                conn.execute(
                    "ALTER TABLE blocks ADD COLUMN clip_count INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !block_columns.contains(&"display_order".to_string()) {
                conn.execute(
                    "ALTER TABLE blocks ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !block_columns.contains(&"camera_list".to_string()) {
                conn.execute("ALTER TABLE blocks ADD COLUMN camera_list TEXT", [])?;
            }
            if !block_columns.contains(&"confidence".to_string()) {
                conn.execute(
                    "ALTER TABLE blocks ADD COLUMN confidence REAL NOT NULL DEFAULT 0.0",
                    [],
                )?;
            }

            let mut block_clips_stmt = conn.prepare("PRAGMA table_info(block_clips)")?;
            let block_clip_columns: Vec<String> = block_clips_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !block_clip_columns.contains(&"camera_label".to_string()) {
                conn.execute("ALTER TABLE block_clips ADD COLUMN camera_label TEXT", [])?;
            }
            if !block_clip_columns.contains(&"sort_index".to_string()) {
                conn.execute(
                    "ALTER TABLE block_clips ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }

            let mut thumbnail_stmt = conn.prepare("PRAGMA table_info(thumbnails)")?;
            let thumbnail_columns: Vec<String> = thumbnail_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !thumbnail_columns.contains(&"jump_seconds".to_string()) {
                conn.execute_batch(
                    "
                    ALTER TABLE thumbnails RENAME TO thumbnails_legacy;
                    CREATE TABLE thumbnails (
                        clip_id TEXT NOT NULL,
                        jump_seconds INTEGER NOT NULL,
                        idx INTEGER NOT NULL,
                        timestamp_ms INTEGER NOT NULL,
                        file_path TEXT NOT NULL,
                        PRIMARY KEY (clip_id, jump_seconds, idx),
                        FOREIGN KEY (clip_id) REFERENCES clips(id)
                    );
                    INSERT INTO thumbnails (clip_id, jump_seconds, idx, timestamp_ms, file_path)
                    SELECT clip_id, 4, idx, timestamp_ms, file_path
                    FROM thumbnails_legacy;
                    DROP TABLE thumbnails_legacy;
                    ",
                )?;
            }

            let mut verification_stmt = conn.prepare("PRAGMA table_info(verification_jobs)")?;
            let verification_columns: Vec<String> = verification_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !verification_columns.contains(&"source_label".to_string()) {
                conn.execute("ALTER TABLE verification_jobs ADD COLUMN source_label TEXT NOT NULL DEFAULT 'Source'", [])?;
            }
            if !verification_columns.contains(&"dest_label".to_string()) {
                conn.execute("ALTER TABLE verification_jobs ADD COLUMN dest_label TEXT NOT NULL DEFAULT 'Destination'", [])?;
            }
            if !verification_columns.contains(&"project_id".to_string()) {
                conn.execute("ALTER TABLE verification_jobs ADD COLUMN project_id TEXT NOT NULL DEFAULT '__global__'", [])?;
            }
            if !verification_columns.contains(&"source_path".to_string()) {
                conn.execute(
                    "ALTER TABLE verification_jobs ADD COLUMN source_path TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            if !verification_columns.contains(&"dest_path".to_string()) {
                conn.execute(
                    "ALTER TABLE verification_jobs ADD COLUMN dest_path TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            if !verification_columns.contains(&"started_at".to_string()) {
                conn.execute(
                    "ALTER TABLE verification_jobs ADD COLUMN started_at TEXT",
                    [],
                )?;
            }
            if !verification_columns.contains(&"ended_at".to_string()) {
                conn.execute("ALTER TABLE verification_jobs ADD COLUMN ended_at TEXT", [])?;
            }
            if !verification_columns.contains(&"duration_ms".to_string()) {
                conn.execute(
                    "ALTER TABLE verification_jobs ADD COLUMN duration_ms INTEGER",
                    [],
                )?;
            }
            if !verification_columns.contains(&"counts_json".to_string()) {
                conn.execute(
                    "ALTER TABLE verification_jobs ADD COLUMN counts_json TEXT",
                    [],
                )?;
            }
            if !verification_columns.contains(&"issues_json".to_string()) {
                conn.execute(
                    "ALTER TABLE verification_jobs ADD COLUMN issues_json TEXT",
                    [],
                )?;
            }

            let mut production_project_stmt =
                conn.prepare("PRAGMA table_info(production_projects)")?;
            let production_project_columns: Vec<String> = production_project_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !production_project_columns.contains(&"client_name".to_string()) {
                conn.execute(
                    "ALTER TABLE production_projects ADD COLUMN client_name TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }

            let mut production_camera_stmt =
                conn.prepare("PRAGMA table_info(production_camera_configs)")?;
            let production_camera_columns: Vec<String> = production_camera_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !production_camera_columns.contains(&"log_family".to_string()) {
                conn.execute(
                    "ALTER TABLE production_camera_configs ADD COLUMN log_family TEXT NOT NULL DEFAULT 'rec709'",
                    [],
                )?;
            }
            if !production_camera_columns.contains(&"lens_character".to_string()) {
                conn.execute(
                    "ALTER TABLE production_camera_configs ADD COLUMN lens_character TEXT",
                    [],
                )?;
            }
            if !production_camera_columns.contains(&"diffusion".to_string()) {
                conn.execute(
                    "ALTER TABLE production_camera_configs ADD COLUMN diffusion TEXT",
                    [],
                )?;
            }

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS production_look_setups (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    custom_notes TEXT,
                    lighting TEXT NOT NULL,
                    skin_priority INTEGER NOT NULL DEFAULT 0,
                    outputs_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(project_id) REFERENCES production_projects(id)
                );
                CREATE TABLE IF NOT EXISTS production_onset_checks (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    ready_state_json TEXT NOT NULL DEFAULT '{}',
                    lighting_checks_json TEXT NOT NULL DEFAULT '[]',
                    failure_modes_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES production_projects(id)
                );
                CREATE TABLE IF NOT EXISTS production_presets (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES production_projects(id)
                );
                ",
            )?;

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS shot_list_projects (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    day_label TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_opened_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS shot_list_rows (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    shot_number TEXT NOT NULL DEFAULT '',
                    capture_type TEXT NOT NULL DEFAULT 'video',
                    scene TEXT NOT NULL DEFAULT '',
                    location TEXT NOT NULL DEFAULT '',
                    timing TEXT NOT NULL DEFAULT '',
                    shot_type TEXT NOT NULL DEFAULT 'Medium',
                    description TEXT NOT NULL DEFAULT '',
                    camera_lens TEXT NOT NULL DEFAULT '',
                    camera_movement TEXT NOT NULL DEFAULT 'Static',
                    audio_notes TEXT NOT NULL DEFAULT '',
                    lighting_notes TEXT NOT NULL DEFAULT '',
                    talent_subjects TEXT NOT NULL DEFAULT '',
                    props_details TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'planned',
                    scene_setup TEXT NOT NULL DEFAULT '',
                    movement TEXT NOT NULL DEFAULT '',
                    location_time TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(project_id) REFERENCES shot_list_projects(id)
                );
                CREATE TABLE IF NOT EXISTS shot_list_equipment_sections (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    section_key TEXT,
                    section_name TEXT NOT NULL DEFAULT '',
                    icon_name TEXT NOT NULL DEFAULT 'misc',
                    FOREIGN KEY(project_id) REFERENCES shot_list_projects(id)
                );
                CREATE TABLE IF NOT EXISTS shot_list_equipment_items (
                    id TEXT PRIMARY KEY,
                    section_id TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    item_name TEXT NOT NULL DEFAULT '',
                    item_type TEXT NOT NULL DEFAULT 'misc',
                    icon_name TEXT NOT NULL DEFAULT 'misc',
                    notes TEXT NOT NULL DEFAULT '',
                    camera_label TEXT,
                    media_type TEXT,
                    capacity_value INTEGER,
                    capacity_unit TEXT,
                    FOREIGN KEY(section_id) REFERENCES shot_list_equipment_sections(id)
                );
                CREATE INDEX IF NOT EXISTS idx_shot_list_rows_project_order
                    ON shot_list_rows(project_id, sort_order);
                CREATE INDEX IF NOT EXISTS idx_shot_list_sections_project_order
                    ON shot_list_equipment_sections(project_id, sort_order);
                CREATE INDEX IF NOT EXISTS idx_shot_list_items_section_order
                    ON shot_list_equipment_items(section_id, sort_order);
                ",
            )?;

            {
                let mut stmt = conn.prepare("PRAGMA table_info(shot_list_rows)")?;
                let columns: Vec<String> = stmt
                    .query_map([], |row| row.get(1))?
                    .filter_map(|r| r.ok())
                    .collect();

                if !columns.contains(&"scene".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN scene TEXT NOT NULL DEFAULT ''", []);
                }
                if !columns.contains(&"location".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN location TEXT NOT NULL DEFAULT ''", []);
                }
                if !columns.contains(&"timing".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN timing TEXT NOT NULL DEFAULT ''", []);
                }
                if !columns.contains(&"shot_type".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN shot_type TEXT NOT NULL DEFAULT 'Medium'", []);
                }
                if !columns.contains(&"camera_movement".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN camera_movement TEXT NOT NULL DEFAULT 'Static'", []);
                }
                if !columns.contains(&"audio_notes".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN audio_notes TEXT NOT NULL DEFAULT ''", []);
                }
                if !columns.contains(&"lighting_notes".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN lighting_notes TEXT NOT NULL DEFAULT ''", []);
                }
                if !columns.contains(&"talent_subjects".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN talent_subjects TEXT NOT NULL DEFAULT ''", []);
                }
                if !columns.contains(&"props_details".to_string()) {
                    let _ = conn.execute("ALTER TABLE shot_list_rows ADD COLUMN props_details TEXT NOT NULL DEFAULT ''", []);
                }
            }

            let mut legacy_look_stmt =
                conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_look_targets'")?;
            let has_legacy_look_targets = legacy_look_stmt.exists([])?;
            if has_legacy_look_targets {
                conn.execute(
                    "INSERT OR IGNORE INTO production_look_setups (id, project_id, target_type, custom_notes, lighting, skin_priority, outputs_json)
                     SELECT t.id, t.project_id, t.target_type, t.custom_notes, COALESCE(c.lighting, 'mixed'), COALESCE(c.skin_priority, 0), '{}'
                     FROM production_look_targets t
                     LEFT JOIN production_scene_constraints c ON c.project_id = t.project_id",
                    [],
                )?;
            }

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS verification_queue_items (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    label TEXT,
                    source_path TEXT NOT NULL,
                    dest_path TEXT NOT NULL,
                    last_job_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(project_id, idx)
                );
                ",
            )?;

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    original_path TEXT NOT NULL,
                    storage_key TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    duration_ms INTEGER,
                    frame_rate REAL,
                    avg_frame_rate TEXT,
                    r_frame_rate TEXT,
                    is_vfr INTEGER NOT NULL DEFAULT 0,
                    width INTEGER,
                    height INTEGER,
                    codec TEXT,
                    status TEXT NOT NULL,
                    checksum_sha256 TEXT NOT NULL,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                );

                CREATE TABLE IF NOT EXISTS asset_versions (
                    id TEXT PRIMARY KEY,
                    asset_id TEXT NOT NULL,
                    version_number INTEGER NOT NULL,
                    original_file_key TEXT NOT NULL,
                    proxy_playlist_key TEXT,
                    thumbnails_key TEXT,
                    poster_key TEXT,
                    processing_status TEXT NOT NULL,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (asset_id) REFERENCES assets(id)
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_versions_asset_version
                    ON asset_versions(asset_id, version_number);
                CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
                CREATE INDEX IF NOT EXISTS idx_asset_versions_asset_id ON asset_versions(asset_id);
                CREATE INDEX IF NOT EXISTS idx_assets_project_checksum ON assets(project_id, checksum_sha256);

                CREATE TABLE IF NOT EXISTS review_core_comments (
                    id TEXT PRIMARY KEY,
                    asset_version_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    frame_number INTEGER,
                    text TEXT NOT NULL,
                    author_name TEXT NOT NULL DEFAULT 'Anonymous',
                    resolved INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_comments_asset_version_time
                    ON review_core_comments(asset_version_id, timestamp_ms);
                CREATE INDEX IF NOT EXISTS idx_comments_asset_version_created
                    ON review_core_comments(asset_version_id, created_at);

                CREATE TABLE IF NOT EXISTS review_core_annotations (
                    id TEXT PRIMARY KEY,
                    comment_id TEXT NOT NULL,
                    asset_version_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    vector_data TEXT NOT NULL,
                    coordinate_space TEXT NOT NULL DEFAULT 'normalized_0_1',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (comment_id) REFERENCES review_core_comments(id),
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_annotations_comment
                    ON review_core_annotations(comment_id);
                CREATE INDEX IF NOT EXISTS idx_annotations_asset_version_time
                    ON review_core_annotations(asset_version_id, timestamp_ms);

                CREATE TABLE IF NOT EXISTS review_core_frame_notes (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    asset_id TEXT NOT NULL,
                    asset_version_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    frame_number INTEGER,
                    title TEXT,
                    image_key TEXT NOT NULL,
                    vector_data TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    hidden INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (project_id) REFERENCES projects(id),
                    FOREIGN KEY (asset_id) REFERENCES assets(id),
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_frame_notes_asset_version_time
                    ON review_core_frame_notes(asset_version_id, timestamp_ms);
                CREATE INDEX IF NOT EXISTS idx_frame_notes_project_created
                    ON review_core_frame_notes(project_id, created_at);

                CREATE TABLE IF NOT EXISTS review_core_approval_state (
                    asset_version_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'draft',
                    approved_at TEXT,
                    approved_by TEXT,
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );

                CREATE TABLE IF NOT EXISTS review_core_projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_opened_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_review_core_projects_last_opened
                    ON review_core_projects(last_opened_at DESC);

                CREATE TABLE IF NOT EXISTS review_core_share_links (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    asset_version_ids_json TEXT NOT NULL,
                    expires_at TEXT,
                    password_hash TEXT,
                    allow_comments INTEGER NOT NULL DEFAULT 1,
                    allow_download INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                );
                CREATE INDEX IF NOT EXISTS idx_share_links_project_id
                    ON review_core_share_links(project_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token
                    ON review_core_share_links(token);

                CREATE TABLE IF NOT EXISTS review_core_share_sessions (
                    id TEXT PRIMARY KEY,
                    share_link_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT,
                    FOREIGN KEY (share_link_id) REFERENCES review_core_share_links(id)
                );
                CREATE INDEX IF NOT EXISTS idx_share_sessions_share_link_id
                    ON review_core_share_sessions(share_link_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_share_sessions_token
                    ON review_core_share_sessions(token);
                ",
            )?;

            let mut assets_stmt = conn.prepare("PRAGMA table_info(assets)")?;
            let asset_columns: Vec<String> = assets_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !asset_columns.contains(&"avg_frame_rate".to_string()) {
                conn.execute("ALTER TABLE assets ADD COLUMN avg_frame_rate TEXT", [])?;
            }
            if !asset_columns.contains(&"r_frame_rate".to_string()) {
                conn.execute("ALTER TABLE assets ADD COLUMN r_frame_rate TEXT", [])?;
            }
            if !asset_columns.contains(&"is_vfr".to_string()) {
                conn.execute(
                    "ALTER TABLE assets ADD COLUMN is_vfr INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            if !asset_columns.contains(&"last_error".to_string()) {
                conn.execute("ALTER TABLE assets ADD COLUMN last_error TEXT", [])?;
            }

            let mut asset_versions_stmt = conn.prepare("PRAGMA table_info(asset_versions)")?;
            let asset_version_columns: Vec<String> = asset_versions_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !asset_version_columns.contains(&"last_error".to_string()) {
                conn.execute("ALTER TABLE asset_versions ADD COLUMN last_error TEXT", [])?;
            }
            if !asset_version_columns.contains(&"proxy_mp4_key".to_string()) {
                conn.execute(
                    "ALTER TABLE asset_versions ADD COLUMN proxy_mp4_key TEXT",
                    [],
                )?;
            }

            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS review_core_comments (
                    id TEXT PRIMARY KEY,
                    asset_version_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    frame_number INTEGER,
                    text TEXT NOT NULL,
                    author_name TEXT NOT NULL DEFAULT 'Anonymous',
                    resolved INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_comments_asset_version_time
                    ON review_core_comments(asset_version_id, timestamp_ms);
                CREATE INDEX IF NOT EXISTS idx_comments_asset_version_created
                    ON review_core_comments(asset_version_id, created_at);

                CREATE TABLE IF NOT EXISTS review_core_annotations (
                    id TEXT PRIMARY KEY,
                    comment_id TEXT NOT NULL,
                    asset_version_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    vector_data TEXT NOT NULL,
                    coordinate_space TEXT NOT NULL DEFAULT 'normalized_0_1',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (comment_id) REFERENCES review_core_comments(id),
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_annotations_comment
                    ON review_core_annotations(comment_id);
                CREATE INDEX IF NOT EXISTS idx_annotations_asset_version_time
                    ON review_core_annotations(asset_version_id, timestamp_ms);

                CREATE TABLE IF NOT EXISTS review_core_frame_notes (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    asset_id TEXT NOT NULL,
                    asset_version_id TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    frame_number INTEGER,
                    title TEXT,
                    image_key TEXT NOT NULL,
                    vector_data TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    hidden INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (project_id) REFERENCES projects(id),
                    FOREIGN KEY (asset_id) REFERENCES assets(id),
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_frame_notes_asset_version_time
                    ON review_core_frame_notes(asset_version_id, timestamp_ms);
                CREATE INDEX IF NOT EXISTS idx_frame_notes_project_created
                    ON review_core_frame_notes(project_id, created_at);

                CREATE TABLE IF NOT EXISTS review_core_approval_state (
                    asset_version_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'draft',
                    approved_at TEXT,
                    approved_by TEXT,
                    FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
                );

                CREATE TABLE IF NOT EXISTS review_core_projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_opened_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_review_core_projects_last_opened
                    ON review_core_projects(last_opened_at DESC);

                CREATE TABLE IF NOT EXISTS review_core_share_links (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    asset_version_ids_json TEXT NOT NULL,
                    expires_at TEXT,
                    password_hash TEXT,
                    allow_comments INTEGER NOT NULL DEFAULT 1,
                    allow_download INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                );
                CREATE INDEX IF NOT EXISTS idx_share_links_project_id
                    ON review_core_share_links(project_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token
                    ON review_core_share_links(token);

                CREATE TABLE IF NOT EXISTS review_core_share_sessions (
                    id TEXT PRIMARY KEY,
                    share_link_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT,
                    FOREIGN KEY (share_link_id) REFERENCES review_core_share_links(id)
                );
                CREATE INDEX IF NOT EXISTS idx_share_sessions_share_link_id
                    ON review_core_share_sessions(share_link_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_share_sessions_token
                    ON review_core_share_sessions(token);
                ",
            )?;

            let mut share_session_stmt =
                conn.prepare("PRAGMA table_info(review_core_share_sessions)")?;
            let share_session_columns: Vec<String> = share_session_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !share_session_columns.contains(&"display_name".to_string()) {
                conn.execute(
                    "ALTER TABLE review_core_share_sessions ADD COLUMN display_name TEXT",
                    [],
                )?;
            }

            // macOS Sandboxing: Add bookmark support
            let mut project_stmt = conn.prepare("PRAGMA table_info(projects)")?;
            let project_cols: Vec<String> = project_stmt.query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok()).collect();
            if !project_cols.contains(&"bookmark".to_string()) {
                conn.execute("ALTER TABLE projects ADD COLUMN bookmark BLOB", [])?;
            }

            let mut root_stmt = conn.prepare("PRAGMA table_info(project_roots)")?;
            let root_cols: Vec<String> = root_stmt.query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok()).collect();
            if !root_cols.contains(&"bookmark".to_string()) {
                conn.execute("ALTER TABLE project_roots ADD COLUMN bookmark BLOB", [])?;
            }
        }

        Ok(db)
    }

    pub fn reset_file(&self) -> Result<(), String> {
        let db_path = (*self._path).clone();
        println!("[db][reset] resetting database file: {}", db_path);

        if let Some(parent) = Path::new(&db_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        {
            println!("[db][reset] swapping connection for in-memory placeholder...");
            let mut conn = self.conn.lock().unwrap();
            let placeholder = Connection::open_in_memory().map_err(|e| e.to_string())?;
            let old_conn = std::mem::replace(&mut *conn, placeholder);
            println!("[db][reset] dropping old connection...");
            drop(old_conn);
        }

        println!("[db][reset] deleting physical files...");
        let _ = remove_sqlite_file(&db_path);
        let _ = remove_sqlite_file(&format!("{}-wal", db_path));
        let _ = remove_sqlite_file(&format!("{}-shm", db_path));

        println!("[db][reset] reopening database file...");
        let reopened = Connection::open(&db_path).map_err(|e| e.to_string())?;
        {
            let mut conn = self.conn.lock().unwrap();
            *conn = reopened;
        }

        println!("[db][reset] re-creating schema...");
        self.create_tables().map_err(|e| e.to_string())?;
        println!("[db][reset] database reset success");
        Ok(())
    }

    fn create_tables(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                root_path TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                bookmark BLOB
            );

            CREATE TABLE IF NOT EXISTS clips (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                root_id TEXT NOT NULL DEFAULT 'legacy_root',
                rel_path TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                fps REAL NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                video_codec TEXT NOT NULL,
                video_bitrate INTEGER NOT NULL DEFAULT 0,
                format_name TEXT NOT NULL DEFAULT 'unknown',
                audio_codec TEXT NOT NULL DEFAULT 'none',
                audio_channels INTEGER NOT NULL DEFAULT 0,
                audio_sample_rate INTEGER NOT NULL DEFAULT 0,
                camera_iso TEXT,
                camera_white_balance TEXT,
                camera_lens TEXT,
                camera_aperture TEXT,
                camera_angle TEXT,
                audio_summary TEXT NOT NULL,
                timecode TEXT,
                status TEXT NOT NULL DEFAULT 'ok',
                rating INTEGER NOT NULL DEFAULT 0,
                flag TEXT NOT NULL DEFAULT 'none',
                notes TEXT,
                shot_size TEXT,
                movement TEXT,
                manual_order INTEGER NOT NULL DEFAULT 0,
                audio_envelope BLOB,
                lut_enabled INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS project_settings (
                project_id TEXT PRIMARY KEY,
                settings_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_roots (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                root_path TEXT NOT NULL,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL,
                bookmark BLOB,
                UNIQUE(project_id, root_path),
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_time INTEGER,
                end_time INTEGER,
                display_order INTEGER NOT NULL DEFAULT 0,
                clip_count INTEGER NOT NULL DEFAULT 0,
                camera_list TEXT,
                confidence REAL NOT NULL DEFAULT 0.0,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS block_clips (
                block_id TEXT NOT NULL,
                clip_id TEXT NOT NULL,
                camera_label TEXT,
                sort_index INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (block_id, clip_id),
                FOREIGN KEY (block_id) REFERENCES blocks(id),
                FOREIGN KEY (clip_id) REFERENCES clips(id)
            );

            CREATE TABLE IF NOT EXISTS thumbnails (
                clip_id TEXT NOT NULL,
                jump_seconds INTEGER NOT NULL,
                idx INTEGER NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                PRIMARY KEY (clip_id, jump_seconds, idx),
                FOREIGN KEY (clip_id) REFERENCES clips(id)
            );

            CREATE TABLE IF NOT EXISTS verification_jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL DEFAULT '__global__',
                created_at TEXT NOT NULL,
                source_path TEXT NOT NULL DEFAULT '',
                source_root TEXT NOT NULL,
                source_label TEXT NOT NULL DEFAULT 'Source',
                dest_path TEXT NOT NULL DEFAULT '',
                dest_root TEXT NOT NULL,
                dest_label TEXT NOT NULL DEFAULT 'Destination',
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                duration_ms INTEGER,
                counts_json TEXT,
                issues_json TEXT,
                total_files INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                verified_ok_count INTEGER NOT NULL,
                missing_count INTEGER NOT NULL,
                size_mismatch_count INTEGER NOT NULL,
                hash_mismatch_count INTEGER NOT NULL,
                unreadable_count INTEGER NOT NULL,
                extra_in_dest_count INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS verification_queue_items (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                label TEXT,
                source_path TEXT NOT NULL,
                dest_path TEXT NOT NULL,
                last_job_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(project_id, idx)
            );

            CREATE TABLE IF NOT EXISTS verification_items (
                job_id TEXT NOT NULL,
                rel_path TEXT NOT NULL,
                source_size INTEGER NOT NULL,
                dest_size INTEGER,
                source_mtime INTEGER NOT NULL,
                dest_mtime INTEGER,
                source_hash TEXT,
                dest_hash TEXT,
                status TEXT NOT NULL,
                error_message TEXT,
                PRIMARY KEY (job_id, rel_path),
                FOREIGN KEY (job_id) REFERENCES verification_jobs(id)
            );

            CREATE TABLE IF NOT EXISTS file_hash_cache (
                abs_path TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL,
                algo TEXT NOT NULL,
                hash TEXT NOT NULL,
                computed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scene_detection_cache (
                clip_id TEXT NOT NULL,
                threshold REAL NOT NULL,
                analyzer_version TEXT NOT NULL,
                cut_points_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (clip_id, threshold, analyzer_version),
                FOREIGN KEY (clip_id) REFERENCES clips(id)
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                progress REAL NOT NULL,
                message TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                original_path TEXT NOT NULL,
                storage_key TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                duration_ms INTEGER,
                frame_rate REAL,
                avg_frame_rate TEXT,
                r_frame_rate TEXT,
                is_vfr INTEGER NOT NULL DEFAULT 0,
                width INTEGER,
                height INTEGER,
                codec TEXT,
                status TEXT NOT NULL,
                checksum_sha256 TEXT NOT NULL,
                last_error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS asset_versions (
                id TEXT PRIMARY KEY,
                asset_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                original_file_key TEXT NOT NULL,
                proxy_playlist_key TEXT,
                thumbnails_key TEXT,
                poster_key TEXT,
                processing_status TEXT NOT NULL,
                last_error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (asset_id) REFERENCES assets(id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_versions_asset_version
                ON asset_versions(asset_id, version_number);
            CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
            CREATE INDEX IF NOT EXISTS idx_asset_versions_asset_id ON asset_versions(asset_id);
            CREATE INDEX IF NOT EXISTS idx_assets_project_checksum ON assets(project_id, checksum_sha256);

            CREATE TABLE IF NOT EXISTS review_core_comments (
                id TEXT PRIMARY KEY,
                asset_version_id TEXT NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                frame_number INTEGER,
                text TEXT NOT NULL,
                author_name TEXT NOT NULL DEFAULT 'Anonymous',
                resolved INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_comments_asset_version_time
                ON review_core_comments(asset_version_id, timestamp_ms);
            CREATE INDEX IF NOT EXISTS idx_comments_asset_version_created
                ON review_core_comments(asset_version_id, created_at);

            CREATE TABLE IF NOT EXISTS review_core_annotations (
                id TEXT PRIMARY KEY,
                comment_id TEXT NOT NULL,
                asset_version_id TEXT NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                vector_data TEXT NOT NULL,
                coordinate_space TEXT NOT NULL DEFAULT 'normalized_0_1',
                created_at TEXT NOT NULL,
                FOREIGN KEY (comment_id) REFERENCES review_core_comments(id),
                FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_annotations_comment
                ON review_core_annotations(comment_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_asset_version_time
                ON review_core_annotations(asset_version_id, timestamp_ms);

            CREATE TABLE IF NOT EXISTS review_core_frame_notes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                asset_id TEXT NOT NULL,
                asset_version_id TEXT NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                frame_number INTEGER,
                title TEXT,
                image_key TEXT NOT NULL,
                vector_data TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                hidden INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (project_id) REFERENCES projects(id),
                FOREIGN KEY (asset_id) REFERENCES assets(id),
                FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_frame_notes_asset_version_time
                ON review_core_frame_notes(asset_version_id, timestamp_ms);
            CREATE INDEX IF NOT EXISTS idx_frame_notes_project_created
                ON review_core_frame_notes(project_id, created_at);

            CREATE TABLE IF NOT EXISTS review_core_approval_state (
                asset_version_id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'draft',
                approved_at TEXT,
                approved_by TEXT,
                FOREIGN KEY (asset_version_id) REFERENCES asset_versions(id)
            );

            CREATE TABLE IF NOT EXISTS review_core_projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_opened_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_review_core_projects_last_opened
                ON review_core_projects(last_opened_at DESC);

            CREATE TABLE IF NOT EXISTS review_core_share_links (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                asset_version_ids_json TEXT NOT NULL,
                expires_at TEXT,
                password_hash TEXT,
                allow_comments INTEGER NOT NULL DEFAULT 1,
                allow_download INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_share_links_project_id
                ON review_core_share_links(project_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token
                ON review_core_share_links(token);

            CREATE TABLE IF NOT EXISTS review_core_share_sessions (
                id TEXT PRIMARY KEY,
                share_link_id TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_seen_at TEXT,
                FOREIGN KEY (share_link_id) REFERENCES review_core_share_links(id)
            );
            CREATE INDEX IF NOT EXISTS idx_share_sessions_share_link_id
                ON review_core_share_sessions(share_link_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_share_sessions_token
                ON review_core_share_sessions(token);

            CREATE TABLE IF NOT EXISTS production_projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                client_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                last_opened_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS production_camera_configs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                brand TEXT NOT NULL,
                model TEXT NOT NULL,
                recording_mode TEXT NOT NULL,
                log_family TEXT NOT NULL DEFAULT 'rec709',
                base_iso_list_json TEXT NOT NULL,
                lens_character TEXT,
                diffusion TEXT,
                notes TEXT,
                FOREIGN KEY(project_id) REFERENCES production_projects(id)
            );

            CREATE TABLE IF NOT EXISTS production_look_setups (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                custom_notes TEXT,
                lighting TEXT NOT NULL,
                skin_priority INTEGER NOT NULL DEFAULT 0,
                outputs_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(project_id) REFERENCES production_projects(id)
            );

            CREATE TABLE IF NOT EXISTS production_onset_checks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                ready_state_json TEXT NOT NULL DEFAULT '{}',
                lighting_checks_json TEXT NOT NULL DEFAULT '[]',
                failure_modes_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES production_projects(id)
            );

            CREATE TABLE IF NOT EXISTS production_presets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES production_projects(id)
            );

            CREATE TABLE IF NOT EXISTS production_matchlab_sources (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                source_path TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_analyzed_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES production_projects(id)
            );

            CREATE TABLE IF NOT EXISTS production_matchlab_runs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                hero_slot TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES production_projects(id)
            );

            CREATE TABLE IF NOT EXISTS production_matchlab_results (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                proxy_path TEXT,
                representative_frame_path TEXT NOT NULL,
                frames_json TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                calibration_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(run_id) REFERENCES production_matchlab_runs(id)
            );

            CREATE TABLE IF NOT EXISTS shot_list_projects (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                day_label TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_opened_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shot_list_rows (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                shot_number TEXT NOT NULL DEFAULT '',
                capture_type TEXT NOT NULL DEFAULT 'video',
                scene_setup TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                camera_lens TEXT NOT NULL DEFAULT '',
                movement TEXT NOT NULL DEFAULT '',
                location_time TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'planned',
                FOREIGN KEY(project_id) REFERENCES shot_list_projects(id)
            );

            CREATE TABLE IF NOT EXISTS shot_list_equipment_sections (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                section_key TEXT,
                section_name TEXT NOT NULL DEFAULT '',
                icon_name TEXT NOT NULL DEFAULT 'misc',
                FOREIGN KEY(project_id) REFERENCES shot_list_projects(id)
            );

            CREATE TABLE IF NOT EXISTS shot_list_equipment_items (
                id TEXT PRIMARY KEY,
                section_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                item_name TEXT NOT NULL DEFAULT '',
                item_type TEXT NOT NULL DEFAULT 'misc',
                icon_name TEXT NOT NULL DEFAULT 'misc',
                notes TEXT NOT NULL DEFAULT '',
                camera_label TEXT,
                media_type TEXT,
                capacity_value INTEGER,
                capacity_unit TEXT,
                FOREIGN KEY(section_id) REFERENCES shot_list_equipment_sections(id)
            );

            CREATE INDEX IF NOT EXISTS idx_production_matchlab_sources_project_id
                ON production_matchlab_sources(project_id);
            CREATE INDEX IF NOT EXISTS idx_production_matchlab_sources_project_slot
                ON production_matchlab_sources(project_id, slot);
            CREATE INDEX IF NOT EXISTS idx_production_matchlab_runs_project_id
                ON production_matchlab_runs(project_id);
            CREATE INDEX IF NOT EXISTS idx_production_matchlab_results_run_id
                ON production_matchlab_results(run_id);
            CREATE INDEX IF NOT EXISTS idx_shot_list_rows_project_order
                ON shot_list_rows(project_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_shot_list_sections_project_order
                ON shot_list_equipment_sections(project_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_shot_list_items_section_order
                ON shot_list_equipment_items(section_id, sort_order);
            ",
        )?;
        Ok(())
    }

    pub fn upsert_project(&self, project: &Project) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, root_path, name, created_at, bookmark)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                root_path = excluded.root_path,
                name = excluded.name,
                bookmark = excluded.bookmark",
            params![
                project.id,
                project.root_path,
                project.name,
                project.created_at,
                project.bookmark
            ],
        )?;
        Ok(())
    }

    // --- Production Module ---

    #[allow(dead_code)]
    pub fn production_boot_table_status(&self) -> SqlResult<Vec<(String, bool)>> {
        let conn = self.conn.lock().unwrap();
        let tables = vec![
            "production_projects",
            "production_camera_configs",
            "production_look_setups",
            "production_onset_checks",
            "production_presets",
            "production_matchlab_sources",
            "production_matchlab_runs",
            "production_matchlab_results",
        ];
        let mut out = Vec::with_capacity(tables.len());
        for table in tables {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )?;
            out.push((table.to_string(), exists > 0));
        }
        Ok(out)
    }

    pub fn upsert_production_project(&self, project: &ProductionProject) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO production_projects (id, name, client_name, created_at, last_opened_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                project.id,
                project.name,
                project.client_name,
                project.created_at,
                project.last_opened_at
            ],
        )?;
        Ok(())
    }

    pub fn touch_production_project(&self, project_id: &str, touched_at: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE production_projects SET last_opened_at = ?2 WHERE id = ?1",
            params![project_id, touched_at],
        )?;
        Ok(())
    }

    pub fn list_production_projects(&self) -> SqlResult<Vec<ProductionProject>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, client_name, created_at, last_opened_at FROM production_projects ORDER BY last_opened_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(ProductionProject {
                id: row.get(0)?,
                name: row.get(1)?,
                client_name: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        })?;
        let mut projects = Vec::new();
        for p in rows {
            projects.push(p?);
        }
        Ok(projects)
    }

    pub fn delete_production_project(&self, project_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM production_matchlab_results
             WHERE run_id IN (SELECT id FROM production_matchlab_runs WHERE project_id = ?1)",
            params![project_id],
        )?;
        tx.execute("DELETE FROM production_matchlab_runs WHERE project_id = ?1", params![project_id])?;
        tx.execute("DELETE FROM production_matchlab_sources WHERE project_id = ?1", params![project_id])?;
        tx.execute("DELETE FROM production_presets WHERE project_id = ?1", params![project_id])?;
        tx.execute("DELETE FROM production_onset_checks WHERE project_id = ?1", params![project_id])?;
        tx.execute("DELETE FROM production_look_setups WHERE project_id = ?1", params![project_id])?;
        tx.execute("DELETE FROM production_camera_configs WHERE project_id = ?1", params![project_id])?;
        tx.execute("DELETE FROM production_projects WHERE id = ?1", params![project_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_production_camera_config(
        &self,
        config: &ProductionCameraConfig,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO production_camera_configs (id, project_id, slot, brand, model, recording_mode, log_family, base_iso_list_json, lens_character, diffusion, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                config.id,
                config.project_id,
                config.slot,
                config.brand,
                config.model,
                config.recording_mode,
                config.log_family,
                config.base_iso_list_json,
                config.lens_character,
                config.diffusion,
                config.notes
            ],
        )?;
        Ok(())
    }

    pub fn list_production_camera_configs(
        &self,
        project_id: &str,
    ) -> SqlResult<Vec<ProductionCameraConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, project_id, slot, brand, model, recording_mode, log_family, base_iso_list_json, lens_character, diffusion, notes FROM production_camera_configs WHERE project_id = ?1 ORDER BY slot ASC")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ProductionCameraConfig {
                id: row.get(0)?,
                project_id: row.get(1)?,
                slot: row.get(2)?,
                brand: row.get(3)?,
                model: row.get(4)?,
                recording_mode: row.get(5)?,
                log_family: row.get(6)?,
                base_iso_list_json: row.get(7)?,
                lens_character: row.get(8)?,
                diffusion: row.get(9)?,
                notes: row.get(10)?,
            })
        })?;
        let mut configs = Vec::new();
        for c in rows {
            configs.push(c?);
        }
        Ok(configs)
    }

    pub fn upsert_production_look_setup(&self, target: &ProductionLookSetup) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO production_look_setups (id, project_id, target_type, custom_notes, lighting, skin_priority, outputs_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                target.id,
                target.project_id,
                target.target_type,
                target.custom_notes,
                target.lighting,
                if target.skin_priority { 1 } else { 0 },
                target.outputs_json
            ],
        )?;
        Ok(())
    }

    pub fn get_production_look_setup(
        &self,
        project_id: &str,
    ) -> SqlResult<Option<ProductionLookSetup>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, project_id, target_type, custom_notes, lighting, skin_priority, outputs_json FROM production_look_setups WHERE project_id = ?1")?;
        let mut rows = stmt.query_map(params![project_id], |row| {
            Ok(ProductionLookSetup {
                id: row.get(0)?,
                project_id: row.get(1)?,
                target_type: row.get(2)?,
                custom_notes: row.get(3)?,
                lighting: row.get(4)?,
                skin_priority: row.get::<_, i32>(5)? != 0,
                outputs_json: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(t)) => Ok(Some(t)),
            _ => Ok(None),
        }
    }

    pub fn upsert_production_onset_checks(&self, checks: &ProductionOnsetChecks) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO production_onset_checks (id, project_id, ready_state_json, lighting_checks_json, failure_modes_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                checks.id,
                checks.project_id,
                checks.ready_state_json,
                checks.lighting_checks_json,
                checks.failure_modes_json,
                checks.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn get_production_onset_checks(
        &self,
        project_id: &str,
    ) -> SqlResult<Option<ProductionOnsetChecks>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, project_id, ready_state_json, lighting_checks_json, failure_modes_json, updated_at FROM production_onset_checks WHERE project_id = ?1")?;
        let mut rows = stmt.query_map(params![project_id], |row| {
            Ok(ProductionOnsetChecks {
                id: row.get(0)?,
                project_id: row.get(1)?,
                ready_state_json: row.get(2)?,
                lighting_checks_json: row.get(3)?,
                failure_modes_json: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        match rows.next() {
            Some(Ok(c)) => Ok(Some(c)),
            _ => Ok(None),
        }
    }

    pub fn upsert_production_preset(&self, preset: &ProductionPreset) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO production_presets (id, project_id, name, payload_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                preset.id,
                preset.project_id,
                preset.name,
                preset.payload_json,
                preset.created_at,
                preset.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn list_production_presets(&self, project_id: &str) -> SqlResult<Vec<ProductionPreset>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, project_id, name, payload_json, created_at, updated_at FROM production_presets WHERE project_id = ?1 ORDER BY updated_at DESC")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ProductionPreset {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                payload_json: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        let mut presets = Vec::new();
        for preset in rows {
            presets.push(preset?);
        }
        Ok(presets)
    }

    pub fn get_production_preset(&self, preset_id: &str) -> SqlResult<Option<ProductionPreset>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, project_id, name, payload_json, created_at, updated_at FROM production_presets WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![preset_id], |row| {
            Ok(ProductionPreset {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                payload_json: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        match rows.next() {
            Some(Ok(preset)) => Ok(Some(preset)),
            _ => Ok(None),
        }
    }

    pub fn upsert_production_matchlab_source(
        &self,
        source: &ProductionMatchLabSource,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO production_matchlab_sources (id, project_id, slot, source_path, source_hash, created_at, last_analyzed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                source.id,
                source.project_id,
                source.slot,
                source.source_path,
                source.source_hash,
                source.created_at,
                source.last_analyzed_at
            ],
        )?;
        Ok(())
    }

    pub fn list_production_matchlab_sources(
        &self,
        project_id: &str,
    ) -> SqlResult<Vec<ProductionMatchLabSource>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, project_id, slot, source_path, source_hash, created_at, last_analyzed_at FROM production_matchlab_sources WHERE project_id = ?1")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ProductionMatchLabSource {
                id: row.get(0)?,
                project_id: row.get(1)?,
                slot: row.get(2)?,
                source_path: row.get(3)?,
                source_hash: row.get(4)?,
                created_at: row.get(5)?,
                last_analyzed_at: row.get(6)?,
            })
        })?;
        let mut sources = Vec::new();
        for s in rows {
            sources.push(s?);
        }
        Ok(sources)
    }

    pub fn insert_production_matchlab_run(
        &self,
        run: &ProductionMatchLabRunRecord,
        results: &[ProductionMatchLabResultRecord],
    ) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO production_matchlab_runs (id, project_id, hero_slot, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![run.id, run.project_id, run.hero_slot, run.created_at],
        )?;
        for result in results {
            tx.execute(
                "INSERT INTO production_matchlab_results (id, run_id, slot, proxy_path, representative_frame_path, frames_json, metrics_json, calibration_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    result.id,
                    result.run_id,
                    result.slot,
                    result.proxy_path,
                    result.representative_frame_path,
                    result.frames_json,
                    result.metrics_json,
                    result.calibration_json,
                    result.created_at
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_production_matchlab_runs(
        &self,
        project_id: &str,
    ) -> SqlResult<Vec<ProductionMatchLabRunRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, hero_slot, created_at
             FROM production_matchlab_runs
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ProductionMatchLabRunRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                hero_slot: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        let mut runs = Vec::new();
        for run in rows {
            runs.push(run?);
        }
        Ok(runs)
    }

    pub fn get_production_matchlab_run(
        &self,
        run_id: &str,
    ) -> SqlResult<Option<(ProductionMatchLabRunRecord, Vec<ProductionMatchLabResultRecord>)>> {
        let conn = self.conn.lock().unwrap();
        let mut run_stmt = conn.prepare(
            "SELECT id, project_id, hero_slot, created_at
             FROM production_matchlab_runs
             WHERE id = ?1",
        )?;
        let mut run_rows = run_stmt.query_map(params![run_id], |row| {
            Ok(ProductionMatchLabRunRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                hero_slot: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        let run = match run_rows.next() {
            Some(Ok(run)) => run,
            _ => return Ok(None),
        };

        let mut result_stmt = conn.prepare(
            "SELECT id, run_id, slot, proxy_path, representative_frame_path, frames_json, metrics_json, calibration_json, created_at
             FROM production_matchlab_results
             WHERE run_id = ?1
             ORDER BY slot ASC",
        )?;
        let result_rows = result_stmt.query_map(params![run_id], |row| {
            Ok(ProductionMatchLabResultRecord {
                id: row.get(0)?,
                run_id: row.get(1)?,
                slot: row.get(2)?,
                proxy_path: row.get(3)?,
                representative_frame_path: row.get(4)?,
                frames_json: row.get(5)?,
                metrics_json: row.get(6)?,
                calibration_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        let mut results = Vec::new();
        for result in result_rows {
            results.push(result?);
        }
        Ok(Some((run, results)))
    }

    pub fn list_production_matchlab_results_excluding_run(
        &self,
        run_id: &str,
    ) -> SqlResult<Vec<ProductionMatchLabResultRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, run_id, slot, proxy_path, representative_frame_path, frames_json, metrics_json, calibration_json, created_at
             FROM production_matchlab_results
             WHERE run_id != ?1",
        )?;
        let rows = stmt.query_map(params![run_id], |row| {
            Ok(ProductionMatchLabResultRecord {
                id: row.get(0)?,
                run_id: row.get(1)?,
                slot: row.get(2)?,
                proxy_path: row.get(3)?,
                representative_frame_path: row.get(4)?,
                frames_json: row.get(5)?,
                metrics_json: row.get(6)?,
                calibration_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;
        let mut results = Vec::new();
        for result in rows {
            results.push(result?);
        }
        Ok(results)
    }

    pub fn delete_production_matchlab_run(&self, run_id: &str) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM production_matchlab_results WHERE run_id = ?1",
            params![run_id],
        )?;
        tx.execute(
            "DELETE FROM production_matchlab_runs WHERE id = ?1",
            params![run_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_shot_list_project(&self, project: &ShotListProject) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO shot_list_projects (id, title, day_label, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                project.id,
                project.title,
                project.day_label,
                project.created_at,
                project.updated_at,
                project.last_opened_at
            ],
        )?;
        Ok(())
    }

    pub fn replace_shot_list_bundle(&self, bundle: &crate::commands::ShotListBundle) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        tx.execute("DELETE FROM shot_list_equipment_items", [])?;
        tx.execute("DELETE FROM shot_list_equipment_sections", [])?;
        tx.execute("DELETE FROM shot_list_rows", [])?;
        tx.execute("DELETE FROM shot_list_projects", [])?;

        tx.execute(
            "INSERT INTO shot_list_projects (id, title, day_label, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                bundle.project.id,
                bundle.project.title,
                bundle.project.day_label,
                bundle.project.created_at,
                bundle.project.updated_at,
                bundle.project.last_opened_at
            ],
        )?;

        for row in &bundle.rows {
            tx.execute(
                "INSERT INTO shot_list_rows (
                    id, project_id, sort_order, shot_number, capture_type, scene_setup, description, camera_lens, movement, location_time, notes, status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    row.id,
                    row.project_id,
                    row.sort_order,
                    row.shot_number,
                    row.capture_type,
                    row.scene_setup,
                    row.description,
                    row.camera_lens,
                    row.movement,
                    row.location_time,
                    row.notes,
                    row.status
                ],
            )?;
        }

        for section in &bundle.sections {
            tx.execute(
                "INSERT INTO shot_list_equipment_sections (
                    id, project_id, sort_order, section_key, section_name, icon_name
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    section.id,
                    section.project_id,
                    section.sort_order,
                    section.section_key,
                    section.section_name,
                    section.icon_name
                ],
            )?;
        }

        for item in &bundle.items {
            tx.execute(
                "INSERT INTO shot_list_equipment_items (
                    id, section_id, sort_order, item_name, item_type, icon_name, notes, camera_label, media_type, capacity_value, capacity_unit
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    item.id,
                    item.section_id,
                    item.sort_order,
                    item.item_name,
                    item.item_type,
                    item.icon_name,
                    item.notes,
                    item.camera_label,
                    item.media_type,
                    item.capacity_value,
                    item.capacity_unit
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_latest_shot_list_project(&self) -> SqlResult<Option<ShotListProject>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, day_label, created_at, updated_at, last_opened_at
             FROM shot_list_projects
             ORDER BY last_opened_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], |row| {
            Ok(ShotListProject {
                id: row.get(0)?,
                title: row.get(1)?,
                day_label: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                last_opened_at: row.get(5)?,
            })
        })?;
        match rows.next() {
            Some(Ok(project)) => Ok(Some(project)),
            _ => Ok(None),
        }
    }

    pub fn get_shot_list_project(&self, project_id: &str) -> SqlResult<Option<ShotListProject>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, day_label, created_at, updated_at, last_opened_at
             FROM shot_list_projects
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![project_id], |row| {
            Ok(ShotListProject {
                id: row.get(0)?,
                title: row.get(1)?,
                day_label: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                last_opened_at: row.get(5)?,
            })
        })?;
        match rows.next() {
            Some(Ok(project)) => Ok(Some(project)),
            _ => Ok(None),
        }
    }

    pub fn touch_shot_list_project(&self, project_id: &str, timestamp: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE shot_list_projects
             SET updated_at = ?2, last_opened_at = ?2
             WHERE id = ?1",
            params![project_id, timestamp],
        )?;
        Ok(())
    }

    pub fn list_shot_list_rows(&self, project_id: &str) -> SqlResult<Vec<ShotListRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, sort_order, shot_number, capture_type, scene, location, timing, shot_type, description, camera_lens, camera_movement, audio_notes, lighting_notes, talent_subjects, props_details, notes, status, scene_setup, movement, location_time
             FROM shot_list_rows
             WHERE project_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ShotListRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                sort_order: row.get(2)?,
                shot_number: row.get(3)?,
                capture_type: row.get(4)?,
                scene: row.get(5)?,
                location: row.get(6)?,
                timing: row.get(7)?,
                shot_type: row.get(8)?,
                description: row.get(9)?,
                camera_lens: row.get(10)?,
                camera_movement: row.get(11)?,
                audio_notes: row.get(12)?,
                lighting_notes: row.get(13)?,
                talent_subjects: row.get(14)?,
                props_details: row.get(15)?,
                notes: row.get(16)?,
                status: row.get(17)?,
                scene_setup: row.get(18)?,
                movement: row.get(19)?,
                location_time: row.get(20)?,
            })
        })?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    pub fn upsert_shot_list_row(&self, row: &ShotListRow) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO shot_list_rows (
                id, project_id, sort_order, shot_number, capture_type, scene, location, timing, shot_type, description, camera_lens, camera_movement, audio_notes, lighting_notes, talent_subjects, props_details, notes, status, scene_setup, movement, location_time
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![
                row.id,
                row.project_id,
                row.sort_order,
                row.shot_number,
                row.capture_type,
                row.scene,
                row.location,
                row.timing,
                row.shot_type,
                row.description,
                row.camera_lens,
                row.camera_movement,
                row.audio_notes,
                row.lighting_notes,
                row.talent_subjects,
                row.props_details,
                row.notes,
                row.status,
                row.scene_setup,
                row.movement,
                row.location_time,
            ],
        )?;
        Ok(())
    }

    pub fn delete_shot_list_row(&self, row_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM shot_list_rows WHERE id = ?1", params![row_id])?;
        Ok(())
    }

    pub fn reorder_shot_list_rows(&self, project_id: &str, row_ids: &[String]) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for (index, row_id) in row_ids.iter().enumerate() {
            tx.execute(
                "UPDATE shot_list_rows SET sort_order = ?1 WHERE id = ?2 AND project_id = ?3",
                params![index as i32 + 1, row_id, project_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_shot_list_equipment_sections(&self, project_id: &str) -> SqlResult<Vec<ShotListEquipmentSection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, sort_order, section_key, section_name, icon_name
             FROM shot_list_equipment_sections
             WHERE project_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ShotListEquipmentSection {
                id: row.get(0)?,
                project_id: row.get(1)?,
                sort_order: row.get(2)?,
                section_key: row.get(3)?,
                section_name: row.get(4)?,
                icon_name: row.get(5)?,
            })
        })?;
        let mut results = Vec::new();
        for section in rows {
            results.push(section?);
        }
        Ok(results)
    }

    pub fn upsert_shot_list_equipment_section(&self, section: &ShotListEquipmentSection) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO shot_list_equipment_sections (
                id, project_id, sort_order, section_key, section_name, icon_name
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                section.id,
                section.project_id,
                section.sort_order,
                section.section_key,
                section.section_name,
                section.icon_name
            ],
        )?;
        Ok(())
    }

    pub fn delete_shot_list_equipment_section(&self, section_id: &str) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM shot_list_equipment_items WHERE section_id = ?1",
            params![section_id],
        )?;
        tx.execute(
            "DELETE FROM shot_list_equipment_sections WHERE id = ?1",
            params![section_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn reorder_shot_list_equipment_sections(
        &self,
        project_id: &str,
        section_ids: &[String],
    ) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for (index, section_id) in section_ids.iter().enumerate() {
            tx.execute(
                "UPDATE shot_list_equipment_sections SET sort_order = ?1 WHERE id = ?2 AND project_id = ?3",
                params![index as i32 + 1, section_id, project_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_shot_list_equipment_items(&self, project_id: &str) -> SqlResult<Vec<ShotListEquipmentItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT i.id, i.section_id, i.sort_order, i.item_name, i.item_type, i.icon_name, i.notes, i.camera_label, i.media_type, i.capacity_value, i.capacity_unit
             FROM shot_list_equipment_items i
             INNER JOIN shot_list_equipment_sections s ON s.id = i.section_id
             WHERE s.project_id = ?1
             ORDER BY s.sort_order ASC, i.sort_order ASC, i.id ASC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ShotListEquipmentItem {
                id: row.get(0)?,
                section_id: row.get(1)?,
                sort_order: row.get(2)?,
                item_name: row.get(3)?,
                item_type: row.get(4)?,
                icon_name: row.get(5)?,
                notes: row.get(6)?,
                camera_label: row.get(7)?,
                media_type: row.get(8)?,
                capacity_value: row.get(9)?,
                capacity_unit: row.get(10)?,
            })
        })?;
        let mut results = Vec::new();
        for item in rows {
            results.push(item?);
        }
        Ok(results)
    }

    pub fn upsert_shot_list_equipment_item(&self, item: &ShotListEquipmentItem) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO shot_list_equipment_items (
                id, section_id, sort_order, item_name, item_type, icon_name, notes, camera_label, media_type, capacity_value, capacity_unit
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                item.id,
                item.section_id,
                item.sort_order,
                item.item_name,
                item.item_type,
                item.icon_name,
                item.notes,
                item.camera_label,
                item.media_type,
                item.capacity_value,
                item.capacity_unit
            ],
        )?;
        Ok(())
    }

    pub fn delete_shot_list_equipment_item(&self, item_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM shot_list_equipment_items WHERE id = ?1",
            params![item_id],
        )?;
        Ok(())
    }

    pub fn reorder_shot_list_equipment_items(&self, section_id: &str, item_ids: &[String]) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for (index, item_id) in item_ids.iter().enumerate() {
            tx.execute(
                "UPDATE shot_list_equipment_items SET sort_order = ?1 WHERE id = ?2 AND section_id = ?3",
                params![index as i32 + 1, item_id, section_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_project(&self, id: &str) -> SqlResult<Option<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, root_path, name, created_at, bookmark FROM projects WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(Project {
                id: row.get(0)?,
                root_path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                bookmark: row.get(4)?,
            })
        })?;
        match rows.next() {
            Some(Ok(project)) => Ok(Some(project)),
            _ => Ok(None),
        }
    }

    pub fn create_review_core_project(&self, project: &ReviewCoreProject) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_projects (id, name, created_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                project.id,
                project.name,
                project.created_at,
                project.last_opened_at
            ],
        )?;
        Ok(())
    }

    pub fn list_review_core_projects(&self) -> SqlResult<Vec<ReviewCoreProject>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, last_opened_at
             FROM review_core_projects
             ORDER BY last_opened_at DESC, created_at DESC, name COLLATE NOCASE ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ReviewCoreProject {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    last_opened_at: row.get(3)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn touch_review_core_project(
        &self,
        project_id: &str,
        last_opened_at: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE review_core_projects
             SET last_opened_at = ?2
             WHERE id = ?1",
            params![project_id, last_opened_at],
        )?;
        Ok(())
    }

    pub fn list_project_roots(&self, project_id: &str) -> SqlResult<Vec<ProjectRoot>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, root_path, label, created_at, bookmark
             FROM project_roots
             WHERE project_id = ?1
             ORDER BY created_at ASC, root_path ASC",
        )?;
        let roots = stmt
            .query_map(params![project_id], |row| {
                Ok(ProjectRoot {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    root_path: row.get(2)?,
                    label: row.get(3)?,
                    created_at: row.get(4)?,
                    bookmark: row.get(5)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(roots)
    }

    pub fn upsert_project_root(&self, root: &ProjectRoot) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        // Avoid relying on a UNIQUE(project_id, root_path) migration in legacy DBs.
        // First try to update an existing row, then insert if nothing changed.
        let updated = conn.execute(
            "UPDATE project_roots SET label = ?1, bookmark = ?2 WHERE project_id = ?3 AND root_path = ?4",
            params![root.label, root.bookmark, root.project_id, root.root_path],
        )?;
        if updated == 0 {
            conn.execute(
                "INSERT OR IGNORE INTO project_roots (id, project_id, root_path, label, created_at, bookmark)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    root.id,
                    root.project_id,
                    root.root_path,
                    root.label,
                    root.created_at,
                    root.bookmark
                ],
            )?;
        }
        Ok(())
    }

    pub fn remove_project_root(&self, root_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM project_roots WHERE id = ?1", params![root_id])?;
        Ok(())
    }

    pub fn update_project_root_label(&self, root_id: &str, label: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE project_roots SET label = ?1 WHERE id = ?2",
            params![label, root_id],
        )?;
        Ok(())
    }

    pub fn create_asset(&self, asset: &Asset) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO assets (
                id, project_id, filename, original_path, storage_key, file_size, duration_ms,
                frame_rate, avg_frame_rate, r_frame_rate, is_vfr, width, height, codec, status,
                checksum_sha256, last_error, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                asset.id,
                asset.project_id,
                asset.filename,
                asset.original_path,
                asset.storage_key,
                asset.file_size,
                asset.duration_ms,
                asset.frame_rate,
                asset.avg_frame_rate,
                asset.r_frame_rate,
                asset.is_vfr as i32,
                asset.width,
                asset.height,
                asset.codec,
                asset.status,
                asset.checksum_sha256,
                asset.last_error,
                asset.created_at
            ],
        )?;
        Ok(())
    }

    pub fn create_asset_version(&self, version: &AssetVersion) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO asset_versions (
                id, asset_id, version_number, original_file_key, proxy_playlist_key, proxy_mp4_key,
                thumbnails_key, poster_key, processing_status, last_error, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                version.id,
                version.asset_id,
                version.version_number,
                version.original_file_key,
                version.proxy_playlist_key,
                version.proxy_mp4_key,
                version.thumbnails_key,
                version.poster_key,
                version.processing_status,
                version.last_error,
                version.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_assets(&self, project_id: &str) -> SqlResult<Vec<Asset>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, filename, original_path, storage_key, file_size, duration_ms,
                    frame_rate, avg_frame_rate, r_frame_rate, is_vfr, width, height, codec, status, checksum_sha256, last_error, created_at
             FROM assets
             WHERE project_id = ?1
             ORDER BY created_at DESC, filename ASC",
        )?;
        let rows = stmt
            .query_map(params![project_id], |row| {
                Ok(Asset {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    filename: row.get(2)?,
                    original_path: row.get(3)?,
                    storage_key: row.get(4)?,
                    file_size: row.get(5)?,
                    duration_ms: row.get(6)?,
                    frame_rate: row.get(7)?,
                    avg_frame_rate: row.get(8)?,
                    r_frame_rate: row.get(9)?,
                    is_vfr: row.get::<_, i32>(10)? != 0,
                    width: row.get(11)?,
                    height: row.get(12)?,
                    codec: row.get(13)?,
                    status: row.get(14)?,
                    checksum_sha256: row.get(15)?,
                    last_error: row.get(16)?,
                    created_at: row.get(17)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_asset(&self, asset_id: &str) -> SqlResult<Option<Asset>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, filename, original_path, storage_key, file_size, duration_ms,
                    frame_rate, avg_frame_rate, r_frame_rate, is_vfr, width, height, codec, status, checksum_sha256, last_error, created_at
             FROM assets WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![asset_id], |row| {
            Ok(Asset {
                id: row.get(0)?,
                project_id: row.get(1)?,
                filename: row.get(2)?,
                original_path: row.get(3)?,
                storage_key: row.get(4)?,
                file_size: row.get(5)?,
                duration_ms: row.get(6)?,
                frame_rate: row.get(7)?,
                avg_frame_rate: row.get(8)?,
                r_frame_rate: row.get(9)?,
                is_vfr: row.get::<_, i32>(10)? != 0,
                width: row.get(11)?,
                height: row.get(12)?,
                codec: row.get(13)?,
                status: row.get(14)?,
                checksum_sha256: row.get(15)?,
                last_error: row.get(16)?,
                created_at: row.get(17)?,
            })
        })?;
        match rows.next() {
            Some(Ok(asset)) => Ok(Some(asset)),
            _ => Ok(None),
        }
    }

    pub fn list_asset_versions(&self, asset_id: &str) -> SqlResult<Vec<AssetVersion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, asset_id, version_number, original_file_key, proxy_playlist_key,
                    thumbnails_key, poster_key, processing_status, last_error, created_at,
                    proxy_mp4_key
             FROM asset_versions
             WHERE asset_id = ?1
             ORDER BY version_number DESC",
        )?;
        let rows = stmt
            .query_map(params![asset_id], |row| {
                Ok(AssetVersion {
                    id: row.get(0)?,
                    asset_id: row.get(1)?,
                    version_number: row.get(2)?,
                    original_file_key: row.get(3)?,
                    proxy_playlist_key: row.get(4)?,
                    thumbnails_key: row.get(5)?,
                    poster_key: row.get(6)?,
                    processing_status: row.get(7)?,
                    last_error: row.get(8)?,
                    created_at: row.get(9)?,
                    proxy_mp4_key: row.get(10)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    /// Fetch all versions for every asset in a project in a single JOIN query,
    /// avoiding the N+1 pattern of calling list_asset_versions per asset.
    pub fn list_asset_versions_for_project(&self, project_id: &str) -> SqlResult<Vec<AssetVersion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT av.id, av.asset_id, av.version_number, av.original_file_key,
                    av.proxy_playlist_key, av.thumbnails_key, av.poster_key,
                    av.processing_status, av.last_error, av.created_at, av.proxy_mp4_key
             FROM asset_versions av
             INNER JOIN assets a ON a.id = av.asset_id
             WHERE a.project_id = ?1
             ORDER BY av.asset_id, av.version_number DESC",
        )?;
        let rows = stmt
            .query_map(params![project_id], |row| {
                Ok(AssetVersion {
                    id: row.get(0)?,
                    asset_id: row.get(1)?,
                    version_number: row.get(2)?,
                    original_file_key: row.get(3)?,
                    proxy_playlist_key: row.get(4)?,
                    thumbnails_key: row.get(5)?,
                    poster_key: row.get(6)?,
                    processing_status: row.get(7)?,
                    last_error: row.get(8)?,
                    created_at: row.get(9)?,
                    proxy_mp4_key: row.get(10)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_asset_version(&self, version_id: &str) -> SqlResult<Option<AssetVersion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, asset_id, version_number, original_file_key, proxy_playlist_key,
                    thumbnails_key, poster_key, processing_status, last_error, created_at,
                    proxy_mp4_key
             FROM asset_versions WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![version_id], |row| {
            Ok(AssetVersion {
                id: row.get(0)?,
                asset_id: row.get(1)?,
                version_number: row.get(2)?,
                original_file_key: row.get(3)?,
                proxy_playlist_key: row.get(4)?,
                thumbnails_key: row.get(5)?,
                poster_key: row.get(6)?,
                processing_status: row.get(7)?,
                last_error: row.get(8)?,
                created_at: row.get(9)?,
                proxy_mp4_key: row.get(10)?,
            })
        })?;
        match rows.next() {
            Some(Ok(version)) => Ok(Some(version)),
            _ => Ok(None),
        }
    }

    pub fn update_asset_metadata(
        &self,
        asset_id: &str,
        duration_ms: u64,
        frame_rate: f64,
        avg_frame_rate: Option<&str>,
        r_frame_rate: Option<&str>,
        is_vfr: bool,
        width: u32,
        height: u32,
        codec: &str,
        status: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE assets
             SET duration_ms = ?1,
                 frame_rate = ?2,
                 avg_frame_rate = ?3,
                 r_frame_rate = ?4,
                 is_vfr = ?5,
                 width = ?6,
                 height = ?7,
                 codec = ?8,
                 status = COALESCE(?9, status),
                 last_error = NULL
             WHERE id = ?10",
            params![
                duration_ms,
                frame_rate,
                avg_frame_rate,
                r_frame_rate,
                is_vfr as i32,
                width,
                height,
                codec,
                status,
                asset_id
            ],
        )?;
        Ok(())
    }

    pub fn set_asset_error(
        &self,
        asset_id: &str,
        status: &str,
        last_error: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE assets SET status = ?1, last_error = ?2 WHERE id = ?3",
            params![status, last_error, asset_id],
        )?;
        Ok(())
    }

    pub fn set_asset_version_error(
        &self,
        version_id: &str,
        status: &str,
        last_error: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE asset_versions SET processing_status = ?1, last_error = ?2 WHERE id = ?3",
            params![status, last_error, version_id],
        )?;
        Ok(())
    }

    /// On app startup, reset any asset versions that were stuck in "processing"
    /// due to a previous crash or force-quit. They will show as "failed" so the
    /// user can re-import rather than waiting forever.
    pub fn reset_stuck_processing_versions(&self) -> SqlResult<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "UPDATE asset_versions
             SET processing_status = 'failed',
                 last_error = 'Processing interrupted by app restart'
             WHERE processing_status = 'processing'",
            [],
        )?;
        Ok(count)
    }

    pub fn update_asset_version_outputs(
        &self,
        version_id: &str,
        playlist_key: Option<&str>,
        proxy_mp4_key: Option<&str>,
        thumbs_key: Option<&str>,
        poster_key: Option<&str>,
        status: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE asset_versions
             SET proxy_playlist_key = ?1,
                 proxy_mp4_key = ?2,
                 thumbnails_key = ?3,
                 poster_key = ?4,
                 processing_status = ?5,
                 last_error = NULL
             WHERE id = ?6",
            params![
                playlist_key,
                proxy_mp4_key,
                thumbs_key,
                poster_key,
                status,
                version_id
            ],
        )?;
        Ok(())
    }

    pub fn find_asset_by_project_and_checksum(
        &self,
        project_id: &str,
        checksum_sha256: &str,
    ) -> SqlResult<Option<Asset>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, filename, original_path, storage_key, file_size, duration_ms,
                    frame_rate, avg_frame_rate, r_frame_rate, is_vfr, width, height, codec, status, checksum_sha256, last_error, created_at
             FROM assets
             WHERE project_id = ?1 AND checksum_sha256 = ?2
             ORDER BY created_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![project_id, checksum_sha256], |row| {
            Ok(Asset {
                id: row.get(0)?,
                project_id: row.get(1)?,
                filename: row.get(2)?,
                original_path: row.get(3)?,
                storage_key: row.get(4)?,
                file_size: row.get(5)?,
                duration_ms: row.get(6)?,
                frame_rate: row.get(7)?,
                avg_frame_rate: row.get(8)?,
                r_frame_rate: row.get(9)?,
                is_vfr: row.get::<_, i32>(10)? != 0,
                width: row.get(11)?,
                height: row.get(12)?,
                codec: row.get(13)?,
                status: row.get(14)?,
                checksum_sha256: row.get(15)?,
                last_error: row.get(16)?,
                created_at: row.get(17)?,
            })
        })?;
        match rows.next() {
            Some(Ok(asset)) => Ok(Some(asset)),
            _ => Ok(None),
        }
    }

    pub fn get_next_asset_version_number(&self, asset_id: &str) -> SqlResult<i32> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM asset_versions WHERE asset_id = ?1",
        )?;
        stmt.query_row(params![asset_id], |row| row.get(0))
    }

    pub fn create_review_core_comment(&self, comment: &ReviewCoreComment) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_comments (
                id, asset_version_id, timestamp_ms, frame_number, text, author_name, resolved, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                comment.id,
                comment.asset_version_id,
                comment.timestamp_ms,
                comment.frame_number,
                comment.text,
                comment.author_name,
                comment.resolved as i32,
                comment.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_review_core_comments(
        &self,
        asset_version_id: &str,
    ) -> SqlResult<Vec<ReviewCoreComment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, asset_version_id, timestamp_ms, frame_number, text, author_name, resolved, created_at
             FROM review_core_comments
             WHERE asset_version_id = ?1
             ORDER BY timestamp_ms ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![asset_version_id], |row| {
            Ok(ReviewCoreComment {
                id: row.get(0)?,
                asset_version_id: row.get(1)?,
                timestamp_ms: row.get(2)?,
                frame_number: row.get(3)?,
                text: row.get(4)?,
                author_name: row.get(5)?,
                resolved: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_review_core_comment(
        &self,
        comment_id: &str,
    ) -> SqlResult<Option<ReviewCoreComment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, asset_version_id, timestamp_ms, frame_number, text, author_name, resolved, created_at
             FROM review_core_comments
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![comment_id], |row| {
            Ok(ReviewCoreComment {
                id: row.get(0)?,
                asset_version_id: row.get(1)?,
                timestamp_ms: row.get(2)?,
                frame_number: row.get(3)?,
                text: row.get(4)?,
                author_name: row.get(5)?,
                resolved: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
            })
        })?;
        match rows.next() {
            Some(Ok(comment)) => Ok(Some(comment)),
            _ => Ok(None),
        }
    }

    pub fn update_review_core_comment(
        &self,
        comment_id: &str,
        text: Option<&str>,
        resolved: Option<bool>,
        author_name: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE review_core_comments
             SET text = COALESCE(?1, text),
                 resolved = COALESCE(?2, resolved),
                 author_name = COALESCE(?3, author_name)
             WHERE id = ?4",
            params![
                text,
                resolved.map(|value| if value { 1 } else { 0 }),
                author_name,
                comment_id
            ],
        )?;
        Ok(())
    }

    pub fn delete_review_core_comment(&self, comment_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_core_comments WHERE id = ?1",
            params![comment_id],
        )?;
        Ok(())
    }

    pub fn create_review_core_annotation(
        &self,
        annotation: &ReviewCoreAnnotation,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_annotations (
                id, comment_id, asset_version_id, timestamp_ms, vector_data, coordinate_space, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                annotation.id,
                annotation.comment_id,
                annotation.asset_version_id,
                annotation.timestamp_ms,
                annotation.vector_data,
                annotation.coordinate_space,
                annotation.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_review_core_annotations(
        &self,
        asset_version_id: &str,
    ) -> SqlResult<Vec<ReviewCoreAnnotation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, comment_id, asset_version_id, timestamp_ms, vector_data, coordinate_space, created_at
             FROM review_core_annotations
             WHERE asset_version_id = ?1
             ORDER BY timestamp_ms ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![asset_version_id], |row| {
            Ok(ReviewCoreAnnotation {
                id: row.get(0)?,
                comment_id: row.get(1)?,
                asset_version_id: row.get(2)?,
                timestamp_ms: row.get(3)?,
                vector_data: row.get(4)?,
                coordinate_space: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_review_core_annotation(&self, annotation_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_core_annotations WHERE id = ?1",
            params![annotation_id],
        )?;
        Ok(())
    }

    pub fn delete_review_core_annotations_for_comment(&self, comment_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_core_annotations WHERE comment_id = ?1",
            params![comment_id],
        )?;
        Ok(())
    }

    pub fn create_review_core_frame_note(&self, note: &ReviewCoreFrameNote) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_frame_notes (
                id, project_id, asset_id, asset_version_id, timestamp_ms, frame_number, title,
                image_key, vector_data, created_at, updated_at, hidden
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                note.id,
                note.project_id,
                note.asset_id,
                note.asset_version_id,
                note.timestamp_ms,
                note.frame_number,
                note.title,
                note.image_key,
                note.vector_data,
                note.created_at,
                note.updated_at,
                note.hidden as i32
            ],
        )?;
        Ok(())
    }

    pub fn list_review_core_frame_notes(
        &self,
        project_id: &str,
    ) -> SqlResult<Vec<ReviewCoreFrameNote>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, asset_id, asset_version_id, timestamp_ms, frame_number, title,
                    image_key, vector_data, created_at, updated_at, hidden
             FROM review_core_frame_notes
             WHERE project_id = ?1
             ORDER BY created_at DESC, timestamp_ms DESC",
        )?;
        let rows = stmt
            .query_map(params![project_id], |row| {
                Ok(ReviewCoreFrameNote {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    asset_id: row.get(2)?,
                    asset_version_id: row.get(3)?,
                    timestamp_ms: row.get(4)?,
                    frame_number: row.get(5)?,
                    title: row.get(6)?,
                    image_key: row.get(7)?,
                    vector_data: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    hidden: row.get::<_, i32>(11)? != 0,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_review_core_frame_note(
        &self,
        note_id: &str,
    ) -> SqlResult<Option<ReviewCoreFrameNote>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, asset_id, asset_version_id, timestamp_ms, frame_number, title,
                    image_key, vector_data, created_at, updated_at, hidden
             FROM review_core_frame_notes
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![note_id], |row| {
            Ok(ReviewCoreFrameNote {
                id: row.get(0)?,
                project_id: row.get(1)?,
                asset_id: row.get(2)?,
                asset_version_id: row.get(3)?,
                timestamp_ms: row.get(4)?,
                frame_number: row.get(5)?,
                title: row.get(6)?,
                image_key: row.get(7)?,
                vector_data: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                hidden: row.get::<_, i32>(11)? != 0,
            })
        })?;
        match rows.next() {
            Some(Ok(note)) => Ok(Some(note)),
            _ => Ok(None),
        }
    }

    pub fn update_review_core_frame_note(
        &self,
        note_id: &str,
        title: Option<&str>,
        vector_data: Option<&str>,
        hidden: Option<bool>,
        updated_at: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE review_core_frame_notes
             SET title = COALESCE(?2, title),
                 vector_data = COALESCE(?3, vector_data),
                 hidden = COALESCE(?4, hidden),
                 updated_at = ?5
             WHERE id = ?1",
            params![
                note_id,
                title,
                vector_data,
                hidden.map(|value| if value { 1 } else { 0 }),
                updated_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_review_core_frame_note(&self, note_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_core_frame_notes WHERE id = ?1",
            params![note_id],
        )?;
        Ok(())
    }

    pub fn get_review_core_approval_state(
        &self,
        asset_version_id: &str,
    ) -> SqlResult<Option<ReviewCoreApprovalState>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT asset_version_id, status, approved_at, approved_by
             FROM review_core_approval_state
             WHERE asset_version_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![asset_version_id], |row| {
            Ok(ReviewCoreApprovalState {
                asset_version_id: row.get(0)?,
                status: row.get(1)?,
                approved_at: row.get(2)?,
                approved_by: row.get(3)?,
            })
        })?;
        match rows.next() {
            Some(Ok(state)) => Ok(Some(state)),
            _ => Ok(None),
        }
    }

    pub fn upsert_review_core_approval_state(
        &self,
        approval: &ReviewCoreApprovalState,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_approval_state (
                asset_version_id, status, approved_at, approved_by
            ) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(asset_version_id) DO UPDATE SET
                status = excluded.status,
                approved_at = excluded.approved_at,
                approved_by = excluded.approved_by",
            params![
                approval.asset_version_id,
                approval.status,
                approval.approved_at,
                approval.approved_by
            ],
        )?;
        Ok(())
    }

    pub fn create_review_core_share_link(&self, link: &ReviewCoreShareLink) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_share_links (
                id, project_id, token, asset_version_ids_json, expires_at, password_hash, allow_comments, allow_download, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                link.id,
                link.project_id,
                link.token,
                link.asset_version_ids_json,
                link.expires_at,
                link.password_hash,
                link.allow_comments as i32,
                link.allow_download as i32,
                link.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_review_core_share_links(
        &self,
        project_id: &str,
    ) -> SqlResult<Vec<ReviewCoreShareLink>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, token, asset_version_ids_json, expires_at, password_hash, allow_comments, allow_download, created_at
             FROM review_core_share_links
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ReviewCoreShareLink {
                id: row.get(0)?,
                project_id: row.get(1)?,
                token: row.get(2)?,
                asset_version_ids_json: row.get(3)?,
                expires_at: row.get(4)?,
                password_hash: row.get(5)?,
                allow_comments: row.get::<_, i32>(6)? != 0,
                allow_download: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_review_core_share_link_by_token(
        &self,
        token: &str,
    ) -> SqlResult<Option<ReviewCoreShareLink>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, token, asset_version_ids_json, expires_at, password_hash, allow_comments, allow_download, created_at
             FROM review_core_share_links
             WHERE token = ?1",
        )?;
        let mut rows = stmt.query_map(params![token], |row| {
            Ok(ReviewCoreShareLink {
                id: row.get(0)?,
                project_id: row.get(1)?,
                token: row.get(2)?,
                asset_version_ids_json: row.get(3)?,
                expires_at: row.get(4)?,
                password_hash: row.get(5)?,
                allow_comments: row.get::<_, i32>(6)? != 0,
                allow_download: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
            })
        })?;
        match rows.next() {
            Some(Ok(link)) => Ok(Some(link)),
            _ => Ok(None),
        }
    }

    pub fn delete_review_core_share_link(&self, share_link_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_core_share_sessions WHERE share_link_id = ?1",
            params![share_link_id],
        )?;
        conn.execute(
            "DELETE FROM review_core_share_links WHERE id = ?1",
            params![share_link_id],
        )?;
        Ok(())
    }

    pub fn create_review_core_share_session(
        &self,
        session: &ReviewCoreShareSession,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO review_core_share_sessions (
                id, share_link_id, token, display_name, expires_at, created_at, last_seen_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session.id,
                session.share_link_id,
                session.token,
                session.display_name,
                session.expires_at,
                session.created_at,
                session.last_seen_at
            ],
        )?;
        Ok(())
    }

    pub fn get_review_core_share_session_by_token(
        &self,
        token: &str,
    ) -> SqlResult<Option<ReviewCoreShareSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, share_link_id, token, display_name, expires_at, created_at, last_seen_at
             FROM review_core_share_sessions
             WHERE token = ?1",
        )?;
        let mut rows = stmt.query_map(params![token], |row| {
            Ok(ReviewCoreShareSession {
                id: row.get(0)?,
                share_link_id: row.get(1)?,
                token: row.get(2)?,
                display_name: row.get(3)?,
                expires_at: row.get(4)?,
                created_at: row.get(5)?,
                last_seen_at: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(session)) => Ok(Some(session)),
            _ => Ok(None),
        }
    }

    pub fn touch_review_core_share_session(
        &self,
        session_id: &str,
        expires_at: &str,
        last_seen_at: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE review_core_share_sessions
             SET expires_at = ?1, last_seen_at = ?2
             WHERE id = ?3",
            params![expires_at, last_seen_at, session_id],
        )?;
        Ok(())
    }

    pub fn update_review_core_share_session_display_name(
        &self,
        session_id: &str,
        display_name: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE review_core_share_sessions
             SET display_name = ?1
             WHERE id = ?2",
            params![display_name, session_id],
        )?;
        Ok(())
    }

    pub fn keep_only_project_root_path(
        &self,
        project_id: &str,
        keep_root_path: &str,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM project_roots WHERE project_id = ?1 AND root_path <> ?2",
            params![project_id, keep_root_path],
        )?;
        Ok(())
    }

    pub fn upsert_clip(&self, clip: &Clip) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO clips (
                id, project_id, root_id, rel_path, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height,
                video_codec, video_bitrate, format_name, audio_codec, audio_channels, audio_sample_rate,
                camera_iso, camera_white_balance, camera_lens, camera_aperture, camera_angle, audio_summary, timecode, status, rating, flag, notes,
                shot_size, movement, manual_order, audio_envelope, lut_enabled
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34)

            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                root_id = excluded.root_id,
                rel_path = excluded.rel_path,
                filename = excluded.filename,
                file_path = excluded.file_path,
                size_bytes = excluded.size_bytes,
                created_at = excluded.created_at,
                duration_ms = excluded.duration_ms,
                fps = excluded.fps,
                width = excluded.width,
                height = excluded.height,
                video_codec = excluded.video_codec,
                video_bitrate = excluded.video_bitrate,
                format_name = excluded.format_name,
                audio_codec = excluded.audio_codec,
                audio_channels = excluded.audio_channels,
                audio_sample_rate = excluded.audio_sample_rate,
                camera_iso = excluded.camera_iso,
                camera_white_balance = excluded.camera_white_balance,
                camera_lens = excluded.camera_lens,
                camera_aperture = excluded.camera_aperture,
                camera_angle = excluded.camera_angle,
                audio_summary = excluded.audio_summary,
                timecode = excluded.timecode,
                status = excluded.status,
                rating = excluded.rating,
                flag = excluded.flag,
                notes = excluded.notes,
                shot_size = excluded.shot_size,
                movement = excluded.movement,
                manual_order = excluded.manual_order,
                audio_envelope = excluded.audio_envelope

                -- intentionally excluding lut_enabled from UPDATE to prevent rescans from overwriting it",
            params![
                clip.id,
                clip.project_id,
                clip.root_id,
                clip.rel_path,
                clip.filename,
                clip.file_path,
                clip.size_bytes as i64,
                clip.created_at,
                clip.duration_ms as i64,
                clip.fps,
                clip.width,
                clip.height,
                clip.video_codec,
                clip.video_bitrate as i64,
                clip.format_name,
                clip.audio_codec,
                clip.audio_channels,
                clip.audio_sample_rate,
                clip.camera_iso,
                clip.camera_white_balance,
                clip.camera_lens,
                clip.camera_aperture,
                clip.camera_angle,
                clip.audio_summary,
                clip.timecode,
                clip.status,
                clip.rating,
                clip.flag,
                clip.notes,
                clip.shot_size,
                clip.movement,
                clip.manual_order,
                clip.audio_envelope,
                clip.lut_enabled,
            ],
        )?;
        Ok(())
    }

    pub fn get_clip(&self, id: &str) -> SqlResult<Option<Clip>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, root_id, rel_path, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height,
                    video_codec, video_bitrate, format_name, audio_codec, audio_channels, audio_sample_rate,
                    camera_iso, camera_white_balance, camera_lens, camera_aperture, camera_angle, audio_summary, timecode, status, rating, flag, notes,
                    shot_size, movement, manual_order, audio_envelope, lut_enabled

             FROM clips WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(Clip {
                id: row.get(0)?,
                project_id: row.get(1)?,
                root_id: row.get(2)?,
                rel_path: row.get(3)?,
                filename: row.get(4)?,
                file_path: row.get(5)?,
                size_bytes: row.get::<_, i64>(6)? as u64,
                created_at: row.get(7)?,
                duration_ms: row.get::<_, i64>(8)? as u64,
                fps: row.get(9)?,
                width: row.get::<_, u32>(10)?,
                height: row.get::<_, u32>(11)?,
                video_codec: row.get(12)?,
                video_bitrate: row.get::<_, i64>(13)? as u64,
                format_name: row.get(14)?,
                audio_codec: row.get(15)?,
                audio_channels: row.get::<_, u32>(16)?,
                audio_sample_rate: row.get::<_, u32>(17)?,
                camera_iso: row.get(18)?,
                camera_white_balance: row.get(19)?,
                camera_lens: row.get(20)?,
                camera_aperture: row.get(21)?,
                camera_angle: row.get(22)?,
                audio_summary: row.get(23)?,
                timecode: row.get(24)?,
                status: row.get(25)?,
                rating: row.get(26)?,
                flag: row.get(27)?,
                notes: row.get(28)?,
                shot_size: row.get(29)?,
                movement: row.get(30)?,
                manual_order: row.get(31)?,
                audio_envelope: row.get(32)?,
                lut_enabled: row.get(33)?,
            })
        })?;
        match rows.next() {
            Some(Ok(clip)) => Ok(Some(clip)),
            _ => Ok(None),
        }
    }

    pub fn get_clips(&self, project_id: &str) -> SqlResult<Vec<Clip>> {
        // ... (truncated for brevity in instructions, I'll provide full block)
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, root_id, rel_path, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height,
                    video_codec, video_bitrate, format_name, audio_codec, audio_channels, audio_sample_rate,
                    camera_iso, camera_white_balance, camera_lens, camera_aperture, camera_angle, audio_summary, timecode, status, rating, flag, notes,
                    shot_size, movement, manual_order, audio_envelope, lut_enabled

             FROM clips WHERE project_id = ?1 ORDER BY filename",
        )?;
        let clips = stmt
            .query_map(params![project_id], |row| {
                Ok(Clip {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    root_id: row.get(2)?,
                    rel_path: row.get(3)?,
                    filename: row.get(4)?,
                    file_path: row.get(5)?,
                    size_bytes: row.get::<_, i64>(6)? as u64,
                    created_at: row.get(7)?,
                    duration_ms: row.get::<_, i64>(8)? as u64,
                    fps: row.get(9)?,
                    width: row.get::<_, u32>(10)?,
                    height: row.get::<_, u32>(11)?,
                    video_codec: row.get(12)?,
                    video_bitrate: row.get::<_, i64>(13)? as u64,
                    format_name: row.get(14)?,
                    audio_codec: row.get(15)?,
                    audio_channels: row.get::<_, u32>(16)?,
                    audio_sample_rate: row.get::<_, u32>(17)?,
                    camera_iso: row.get(18)?,
                    camera_white_balance: row.get(19)?,
                    camera_lens: row.get(20)?,
                    camera_aperture: row.get(21)?,
                    camera_angle: row.get(22)?,
                    audio_summary: row.get(23)?,
                    timecode: row.get(24)?,
                    status: row.get(25)?,
                    rating: row.get(26)?,
                    flag: row.get(27)?,
                    notes: row.get(28)?,
                    shot_size: row.get(29)?,
                    movement: row.get(30)?,
                    manual_order: row.get(31)?,
                    audio_envelope: row.get(32)?,
                    lut_enabled: row.get(33)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(clips)
    }

    pub fn set_all_clips_lut(&self, project_id: &str, enabled: i32) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE clips SET lut_enabled = ?1 WHERE project_id = ?2",
            params![enabled, project_id],
        )?;
        Ok(())
    }

    pub fn get_clips_by_ids(&self, ids: &[String]) -> SqlResult<Vec<Clip>> {
        let conn = self.conn.lock().unwrap();
        let placeholders: String = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let query = format!(
            "SELECT id, project_id, root_id, rel_path, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height,
                    video_codec, video_bitrate, format_name, audio_codec, audio_channels, audio_sample_rate,
                    camera_iso, camera_white_balance, camera_lens, camera_aperture, camera_angle, audio_summary, timecode, status, rating, flag, notes,
                    shot_size, movement, manual_order, audio_envelope, lut_enabled

             FROM clips WHERE id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&query)?;
        let clips = stmt
            .query_map(params_from_iter(ids), |row| {
                Ok(Clip {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    root_id: row.get(2)?,
                    rel_path: row.get(3)?,
                    filename: row.get(4)?,
                    file_path: row.get(5)?,
                    size_bytes: row.get::<_, i64>(6)? as u64,
                    created_at: row.get(7)?,
                    duration_ms: row.get::<_, i64>(8)? as u64,
                    fps: row.get(9)?,
                    width: row.get::<_, u32>(10)?,
                    height: row.get::<_, u32>(11)?,
                    video_codec: row.get(12)?,
                    video_bitrate: row.get::<_, i64>(13)? as u64,
                    format_name: row.get(14)?,
                    audio_codec: row.get(15)?,
                    audio_channels: row.get::<_, u32>(16)?,
                    audio_sample_rate: row.get::<_, u32>(17)?,
                    camera_iso: row.get(18)?,
                    camera_white_balance: row.get(19)?,
                    camera_lens: row.get(20)?,
                    camera_aperture: row.get(21)?,
                    camera_angle: row.get(22)?,
                    audio_summary: row.get(23)?,
                    timecode: row.get(24)?,
                    status: row.get(25)?,
                    rating: row.get(26)?,
                    flag: row.get(27)?,
                    notes: row.get(28)?,
                    shot_size: row.get(29)?,
                    movement: row.get(30)?,
                    manual_order: row.get(31)?,
                    audio_envelope: row.get(32)?,
                    lut_enabled: row.get(33)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(clips)
    }
    pub fn update_clip_metadata(
        &self,
        clip_id: &str,
        rating: Option<i32>,
        flag: Option<String>,
        notes: Option<String>,
        shot_size: Option<String>,
        movement: Option<String>,
        manual_order: Option<i32>,
        lut_enabled: Option<i32>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();

        if let Some(r) = rating {
            conn.execute(
                "UPDATE clips SET rating = ?1 WHERE id = ?2",
                params![r, clip_id],
            )?;
        }
        if let Some(f) = flag {
            conn.execute(
                "UPDATE clips SET flag = ?1 WHERE id = ?2",
                params![f, clip_id],
            )?;
        }
        if let Some(n) = notes {
            conn.execute(
                "UPDATE clips SET notes = ?1 WHERE id = ?2",
                params![n, clip_id],
            )?;
        }
        if let Some(s) = shot_size {
            conn.execute(
                "UPDATE clips SET shot_size = ?1 WHERE id = ?2",
                params![s, clip_id],
            )?;
        }
        if let Some(m) = movement {
            conn.execute(
                "UPDATE clips SET movement = ?1 WHERE id = ?2",
                params![m, clip_id],
            )?;
        }
        if let Some(mo) = manual_order {
            conn.execute(
                "UPDATE clips SET manual_order = ?1 WHERE id = ?2",
                params![mo, clip_id],
            )?;
        }
        if let Some(le) = lut_enabled {
            conn.execute(
                "UPDATE clips SET lut_enabled = ?1 WHERE id = ?2",
                params![le, clip_id],
            )?;
        }
        Ok(())
    }

    pub fn update_audio_envelope(&self, clip_id: &str, envelope: &[u8]) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE clips SET audio_envelope = ?1 WHERE id = ?2",
            params![envelope, clip_id],
        )?;
        Ok(())
    }

    pub fn upsert_thumbnail(&self, thumb: &Thumbnail) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO thumbnails (clip_id, jump_seconds, idx, timestamp_ms, file_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                thumb.clip_id,
                thumb.jump_seconds,
                thumb.index,
                thumb.timestamp_ms as i64,
                thumb.file_path
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete_thumbnails_for_clip(&self, clip_id: &str) -> SqlResult<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM thumbnails WHERE clip_id = ?1",
            params![clip_id],
        )
    }

    pub fn get_thumbnails(&self, clip_id: &str) -> SqlResult<Vec<Thumbnail>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT clip_id, jump_seconds, idx, timestamp_ms, file_path FROM thumbnails WHERE clip_id = ?1 ORDER BY jump_seconds, idx",
        )?;
        let thumbs = stmt
            .query_map(params![clip_id], |row| {
                Ok(Thumbnail {
                    clip_id: row.get(0)?,
                    jump_seconds: row.get::<_, u32>(1)?,
                    index: row.get::<_, u32>(2)?,
                    timestamp_ms: row.get::<_, i64>(3)? as u64,
                    file_path: row.get(4)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        let thumbs = thumbs
            .into_iter()
            .filter(|thumb| Path::new(&thumb.file_path).exists())
            .collect();
        Ok(thumbs)
    }

    pub fn replace_scene_blocks(
        &self,
        project_id: &str,
        blocks: &[SceneBlock],
        memberships: &[SceneBlockClip],
    ) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        tx.execute(
            "DELETE FROM block_clips WHERE block_id IN (SELECT id FROM blocks WHERE project_id = ?1)",
            params![project_id],
        )?;
        tx.execute(
            "DELETE FROM blocks WHERE project_id = ?1",
            params![project_id],
        )?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO blocks (id, project_id, name, start_time, end_time, display_order, clip_count, camera_list, confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            for block in blocks {
                stmt.execute(params![
                    block.id,
                    block.project_id,
                    block.name,
                    block.start_time,
                    block.end_time,
                    block.display_order,
                    block.clip_count,
                    block.camera_list,
                    block.confidence,
                ])?;
            }
        }

        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO block_clips (block_id, clip_id, camera_label, sort_index)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for item in memberships {
                stmt.execute(params![
                    item.block_id,
                    item.clip_id,
                    item.camera_label,
                    item.sort_index,
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_scene_blocks(&self, project_id: &str) -> SqlResult<Vec<SceneBlock>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, start_time, end_time, display_order, clip_count, camera_list, confidence
             FROM blocks
             WHERE project_id = ?1
             ORDER BY display_order ASC, start_time ASC, name ASC",
        )?;
        let blocks = stmt
            .query_map(params![project_id], |row| {
                Ok(SceneBlock {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    start_time: row.get(3)?,
                    end_time: row.get(4)?,
                    display_order: row.get(5)?,
                    clip_count: row.get(6)?,
                    camera_list: row.get(7)?,
                    confidence: row.get::<_, f64>(8)? as f32,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(blocks)
    }

    pub fn get_clips_for_block(&self, block_id: &str) -> SqlResult<Vec<Clip>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.project_id, c.root_id, c.rel_path, c.filename, c.file_path, c.size_bytes, c.created_at, c.duration_ms, c.fps, c.width, c.height,
                    c.video_codec, c.video_bitrate, c.format_name, c.audio_codec, c.audio_channels, c.audio_sample_rate,
                    c.camera_iso, c.camera_white_balance, c.camera_lens, c.camera_aperture, c.camera_angle, c.audio_summary, c.timecode, c.status, c.rating, c.flag, c.notes,
                    c.shot_size, c.movement, c.manual_order, c.audio_envelope, c.lut_enabled

             FROM block_clips bc
             JOIN clips c ON c.id = bc.clip_id
             WHERE bc.block_id = ?1
             ORDER BY bc.sort_index ASC, c.filename ASC",
        )?;
        let clips = stmt
            .query_map(params![block_id], |row| {
                Ok(Clip {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    root_id: row.get(2)?,
                    rel_path: row.get(3)?,
                    filename: row.get(4)?,
                    file_path: row.get(5)?,
                    size_bytes: row.get::<_, i64>(6)? as u64,
                    created_at: row.get(7)?,
                    duration_ms: row.get::<_, i64>(8)? as u64,
                    fps: row.get(9)?,
                    width: row.get::<_, u32>(10)?,
                    height: row.get::<_, u32>(11)?,
                    video_codec: row.get(12)?,
                    video_bitrate: row.get::<_, i64>(13)? as u64,
                    format_name: row.get(14)?,
                    audio_codec: row.get(15)?,
                    audio_channels: row.get::<_, u32>(16)?,
                    audio_sample_rate: row.get::<_, u32>(17)?,
                    camera_iso: row.get(18)?,
                    camera_white_balance: row.get(19)?,
                    camera_lens: row.get(20)?,
                    camera_aperture: row.get(21)?,
                    camera_angle: row.get(22)?,
                    audio_summary: row.get(23)?,
                    timecode: row.get(24)?,
                    status: row.get(25)?,
                    rating: row.get(26)?,
                    flag: row.get(27)?,
                    notes: row.get(28)?,
                    shot_size: row.get(29)?,
                    movement: row.get(30)?,
                    manual_order: row.get(31)?,
                    audio_envelope: row.get(32)?,
                    lut_enabled: row.get(33)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(clips)
    }

    pub fn get_project_settings(&self, project_id: &str) -> SqlResult<Option<ProjectSettings>> {
        let conn = self.conn.lock().unwrap();
        let mut col_stmt = conn.prepare("PRAGMA table_info(project_settings)")?;
        let columns: Vec<String> = col_stmt
            .query_map([], |row| row.get(1))?
            .filter_map(|r| r.ok())
            .collect();
        let has_settings_json = columns.contains(&"settings_json".to_string());
        let has_legacy_json = columns.contains(&"json".to_string());
        let query = if has_settings_json {
            "SELECT project_id, settings_json FROM project_settings WHERE project_id = ?1"
        } else if has_legacy_json {
            "SELECT project_id, json FROM project_settings WHERE project_id = ?1"
        } else {
            "SELECT project_id, '{}' FROM project_settings WHERE project_id = ?1"
        };
        let mut stmt = conn.prepare(query)?;
        let mut rows = stmt.query_map(params![project_id], |row| {
            Ok(ProjectSettings {
                project_id: row.get(0)?,
                settings_json: row.get(1)?,
            })
        })?;
        match rows.next() {
            Some(Ok(s)) => Ok(Some(s)),
            _ => Ok(None),
        }
    }

    pub fn upsert_project_settings(&self, settings: &ProjectSettings) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let mut col_stmt = conn.prepare("PRAGMA table_info(project_settings)")?;
        let columns: Vec<String> = col_stmt
            .query_map([], |row| row.get(1))?
            .filter_map(|r| r.ok())
            .collect();
        let has_settings_json = columns.contains(&"settings_json".to_string());
        let has_legacy_json = columns.contains(&"json".to_string());
        let has_updated_at = columns.contains(&"updated_at".to_string());
        let has_created_at = columns.contains(&"created_at".to_string());
        let now = chrono::Utc::now().to_rfc3339();

        if has_settings_json && has_legacy_json && has_created_at && has_updated_at {
            conn.execute(
                "INSERT INTO project_settings (project_id, settings_json, json, created_at, updated_at)
                 VALUES (?1, ?2, ?2, ?3, ?3)
                 ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json, json = excluded.settings_json, updated_at = excluded.updated_at",
                params![settings.project_id, settings.settings_json, now],
            )?;
        } else if has_settings_json && has_legacy_json && has_updated_at {
            conn.execute(
                "INSERT INTO project_settings (project_id, settings_json, json, updated_at)
                 VALUES (?1, ?2, ?2, ?3)
                 ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json, json = excluded.settings_json, updated_at = excluded.updated_at",
                params![settings.project_id, settings.settings_json, now],
            )?;
        } else if has_settings_json && has_legacy_json {
            conn.execute(
                "INSERT INTO project_settings (project_id, settings_json, json) VALUES (?1, ?2, ?2)
                 ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json, json = excluded.settings_json",
                params![settings.project_id, settings.settings_json],
            )?;
        } else if has_settings_json && has_created_at && has_updated_at {
            conn.execute(
                "INSERT INTO project_settings (project_id, settings_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
                params![settings.project_id, settings.settings_json, now],
            )?;
        } else if has_settings_json && has_updated_at {
            conn.execute(
                "INSERT INTO project_settings (project_id, settings_json, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
                params![settings.project_id, settings.settings_json, now],
            )?;
        } else if has_settings_json {
            conn.execute(
                "INSERT INTO project_settings (project_id, settings_json) VALUES (?1, ?2)
                 ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json",
                params![settings.project_id, settings.settings_json],
            )?;
        } else if has_legacy_json && has_created_at && has_updated_at {
            conn.execute(
                "INSERT INTO project_settings (project_id, json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
                params![settings.project_id, settings.settings_json, now],
            )?;
        } else if has_legacy_json && has_updated_at {
            conn.execute(
                "INSERT INTO project_settings (project_id, json, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
                params![settings.project_id, settings.settings_json, now],
            )?;
        } else if has_legacy_json {
            conn.execute(
                "INSERT INTO project_settings (project_id, json) VALUES (?1, ?2)
                 ON CONFLICT(project_id) DO UPDATE SET json = excluded.json",
                params![settings.project_id, settings.settings_json],
            )?;
        } else {
            conn.execute(
                "INSERT OR REPLACE INTO project_settings (project_id) VALUES (?1)",
                params![settings.project_id],
            )?;
        }
        Ok(())
    }

    pub fn rename_scene_block(&self, block_id: &str, name: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE blocks SET name = ?1 WHERE id = ?2",
            params![name, block_id],
        )?;
        Ok(())
    }

    pub fn get_block_project_id(&self, block_id: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT project_id FROM blocks WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![block_id], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(Ok(project_id)) => Ok(Some(project_id)),
            _ => Ok(None),
        }
    }

    pub fn get_block_clip_ids(&self, block_id: &str) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT clip_id FROM block_clips WHERE block_id = ?1 ORDER BY sort_index ASC",
        )?;
        let ids = stmt
            .query_map(params![block_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    pub fn replace_block_memberships(&self, block_id: &str, clip_ids: &[String]) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM block_clips WHERE block_id = ?1",
            params![block_id],
        )?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO block_clips (block_id, clip_id, sort_index) VALUES (?1, ?2, ?3)",
            )?;
            for (idx, clip_id) in clip_ids.iter().enumerate() {
                stmt.execute(params![block_id, clip_id, idx as i32])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn create_scene_block(&self, block: &SceneBlock) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO blocks (id, project_id, name, start_time, end_time, display_order, clip_count, camera_list, confidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                block.id,
                block.project_id,
                block.name,
                block.start_time,
                block.end_time,
                block.display_order,
                block.clip_count,
                block.camera_list,
                block.confidence,
            ],
        )?;
        Ok(())
    }

    pub fn replace_scene_block_order(
        &self,
        project_id: &str,
        block_ids: &[String],
    ) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "UPDATE blocks SET display_order = ?1 WHERE project_id = ?2 AND id = ?3",
            )?;
            for (idx, block_id) in block_ids.iter().enumerate() {
                stmt.execute(params![idx as i32, project_id, block_id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_scene_block(&self, block_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM block_clips WHERE block_id = ?1",
            params![block_id],
        )?;
        conn.execute("DELETE FROM blocks WHERE id = ?1", params![block_id])?;
        Ok(())
    }

    pub fn refresh_scene_block_stats(&self, block_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE blocks
             SET clip_count = (SELECT COUNT(*) FROM block_clips WHERE block_id = ?1)
             WHERE id = ?1",
            params![block_id],
        )?;
        Ok(())
    }

    pub fn get_clip_ids_for_blocks(&self, block_ids: &[String]) -> SqlResult<Vec<String>> {
        if block_ids.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn.lock().unwrap();
        let placeholders = block_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let query = format!(
            "SELECT DISTINCT clip_id FROM block_clips WHERE block_id IN ({}) ORDER BY sort_index ASC",
            placeholders
        );
        let mut stmt = conn.prepare(&query)?;
        let ids = stmt
            .query_map(params_from_iter(block_ids), |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    pub fn prune_project_clips(
        &self,
        project_id: &str,
        keep_clip_ids: &[String],
    ) -> SqlResult<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        if keep_clip_ids.is_empty() {
            tx.execute(
                "DELETE FROM block_clips WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)",
                params![project_id],
            )?;
            tx.execute(
                "DELETE FROM scene_detection_cache WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)",
                params![project_id],
            )?;
            tx.execute(
                "DELETE FROM thumbnails WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)",
                params![project_id],
            )?;
            let removed = tx.execute(
                "DELETE FROM clips WHERE project_id = ?1",
                params![project_id],
            )?;
            tx.commit()?;
            return Ok(removed);
        }

        let placeholders = keep_clip_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");
        let thumbs_query = format!(
            "DELETE FROM thumbnails WHERE clip_id IN (
                SELECT id FROM clips WHERE project_id = ? AND id NOT IN ({})
            )",
            placeholders
        );
        let scene_cache_query = format!(
            "DELETE FROM scene_detection_cache WHERE clip_id IN (
                SELECT id FROM clips WHERE project_id = ? AND id NOT IN ({})
            )",
            placeholders
        );
        let block_clips_query = format!(
            "DELETE FROM block_clips WHERE clip_id IN (
                SELECT id FROM clips WHERE project_id = ? AND id NOT IN ({})
            )",
            placeholders
        );
        let clips_query = format!(
            "DELETE FROM clips WHERE project_id = ? AND id NOT IN ({})",
            placeholders
        );
        let mut query_params: Vec<String> = Vec::with_capacity(keep_clip_ids.len() + 1);
        query_params.push(project_id.to_string());
        query_params.extend_from_slice(keep_clip_ids);
        tx.execute(&block_clips_query, params_from_iter(query_params.clone()))?;
        tx.execute(&scene_cache_query, params_from_iter(query_params.clone()))?;
        tx.execute(&thumbs_query, params_from_iter(query_params.clone()))?;
        let removed = tx.execute(&clips_query, params_from_iter(query_params))?;
        tx.commit()?;
        Ok(removed)
    }

    pub fn insert_verification_job(&self, job: &VerificationJob) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO verification_jobs (
                id, project_id, created_at, source_path, source_root, source_label, dest_path, dest_root, dest_label,
                mode, status, started_at, ended_at, duration_ms, counts_json, issues_json,
                total_files, total_bytes, verified_ok_count, missing_count, size_mismatch_count, hash_mismatch_count, unreadable_count, extra_in_dest_count
             )
             VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
             )",
            params![
                job.id,
                job.project_id,
                job.created_at,
                job.source_path,
                job.source_root,
                job.source_label,
                job.dest_path,
                job.dest_root,
                job.dest_label,
                job.mode,
                job.status,
                job.started_at,
                job.ended_at,
                job.duration_ms,
                job.counts_json,
                job.issues_json,
                job.total_files,
                job.total_bytes as i64,
                job.verified_ok_count,
                job.missing_count,
                job.size_mismatch_count,
                job.hash_mismatch_count,
                job.unreadable_count,
                job.extra_in_dest_count
            ],
        )?;
        Ok(())
    }

    pub fn update_verification_job_status(&self, id: &str, status: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE verification_jobs SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn update_verification_job_counts(&self, job: &VerificationJob) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE verification_jobs SET 
                verified_ok_count = ?1, missing_count = ?2, size_mismatch_count = ?3, 
                hash_mismatch_count = ?4, unreadable_count = ?5, extra_in_dest_count = ?6,
                total_files = ?7, total_bytes = ?8, started_at = ?9, ended_at = ?10,
                duration_ms = ?11, counts_json = ?12, issues_json = ?13, status = ?14
             WHERE id = ?15",
            params![
                job.verified_ok_count,
                job.missing_count,
                job.size_mismatch_count,
                job.hash_mismatch_count,
                job.unreadable_count,
                job.extra_in_dest_count,
                job.total_files,
                job.total_bytes as i64,
                job.started_at,
                job.ended_at,
                job.duration_ms,
                job.counts_json,
                job.issues_json,
                job.status,
                job.id
            ],
        )?;
        Ok(())
    }

    pub fn insert_verification_items(&self, items: &[VerificationItem]) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO verification_items (job_id, rel_path, source_size, dest_size, source_mtime, dest_mtime, source_hash, dest_hash, status, error_message)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
            )?;
            for item in items {
                stmt.execute(params![
                    item.job_id,
                    item.rel_path,
                    item.source_size as i64,
                    item.dest_size.map(|s| s as i64),
                    item.source_mtime as i64,
                    item.dest_mtime.map(|s| s as i64),
                    item.source_hash,
                    item.dest_hash,
                    item.status,
                    item.error_message
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_verification_job(&self, id: &str) -> SqlResult<Option<VerificationJob>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, created_at, source_path, source_root, source_label, dest_path, dest_root, dest_label,
                    mode, status, started_at, ended_at, duration_ms, counts_json, issues_json,
                    total_files, total_bytes, verified_ok_count, missing_count, size_mismatch_count, hash_mismatch_count, unreadable_count, extra_in_dest_count
             FROM verification_jobs WHERE id = ?1"
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(VerificationJob {
                id: row.get(0)?,
                project_id: row.get(1)?,
                created_at: row.get(2)?,
                source_path: row.get(3)?,
                source_root: row.get(4)?,
                source_label: row.get(5)?,
                dest_path: row.get(6)?,
                dest_root: row.get(7)?,
                dest_label: row.get(8)?,
                mode: row.get(9)?,
                status: row.get(10)?,
                started_at: row.get(11)?,
                ended_at: row.get(12)?,
                duration_ms: row.get(13)?,
                counts_json: row.get(14)?,
                issues_json: row.get(15)?,
                total_files: row.get(16)?,
                total_bytes: row.get::<_, i64>(17)? as u64,
                verified_ok_count: row.get(18)?,
                missing_count: row.get(19)?,
                size_mismatch_count: row.get(20)?,
                hash_mismatch_count: row.get(21)?,
                unreadable_count: row.get(22)?,
                extra_in_dest_count: row.get(23)?,
            })
        })?;
        match rows.next() {
            Some(Ok(job)) => Ok(Some(job)),
            _ => Ok(None),
        }
    }

    pub fn list_verification_jobs_for_project(
        &self,
        project_id: &str,
        limit: i64,
    ) -> SqlResult<Vec<VerificationJob>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, created_at, source_path, source_root, source_label, dest_path, dest_root, dest_label,
                    mode, status, started_at, ended_at, duration_ms, counts_json, issues_json,
                    total_files, total_bytes, verified_ok_count, missing_count, size_mismatch_count, hash_mismatch_count, unreadable_count, extra_in_dest_count
             FROM verification_jobs
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let jobs = stmt
            .query_map(params![project_id, limit], |row| {
                Ok(VerificationJob {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    created_at: row.get(2)?,
                    source_path: row.get(3)?,
                    source_root: row.get(4)?,
                    source_label: row.get(5)?,
                    dest_path: row.get(6)?,
                    dest_root: row.get(7)?,
                    dest_label: row.get(8)?,
                    mode: row.get(9)?,
                    status: row.get(10)?,
                    started_at: row.get(11)?,
                    ended_at: row.get(12)?,
                    duration_ms: row.get(13)?,
                    counts_json: row.get(14)?,
                    issues_json: row.get(15)?,
                    total_files: row.get(16)?,
                    total_bytes: row.get::<_, i64>(17)? as u64,
                    verified_ok_count: row.get(18)?,
                    missing_count: row.get(19)?,
                    size_mismatch_count: row.get(20)?,
                    hash_mismatch_count: row.get(21)?,
                    unreadable_count: row.get(22)?,
                    extra_in_dest_count: row.get(23)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(jobs)
    }

    pub fn list_verification_queue(
        &self,
        project_id: &str,
    ) -> SqlResult<Vec<VerificationQueueItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, idx, label, source_path, dest_path, last_job_id, created_at, updated_at
             FROM verification_queue_items
             WHERE project_id = ?1
             ORDER BY idx ASC",
        )?;
        let items = stmt
            .query_map(params![project_id], |row| {
                Ok(VerificationQueueItem {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    idx: row.get(2)?,
                    label: row.get(3)?,
                    source_path: row.get(4)?,
                    dest_path: row.get(5)?,
                    last_job_id: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(items)
    }

    pub fn upsert_verification_queue_item(
        &self,
        project_id: &str,
        idx: i32,
        source_path: &str,
        dest_path: &str,
        label: Option<&str>,
    ) -> SqlResult<VerificationQueueItem> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let existing: Option<(String, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT id, created_at, last_job_id
                 FROM verification_queue_items
                 WHERE project_id = ?1 AND idx = ?2",
                params![project_id, idx],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let id = existing
            .as_ref()
            .map(|v| v.0.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = existing
            .as_ref()
            .and_then(|v| v.1.clone())
            .unwrap_or_else(|| now.clone());
        let last_job_id = existing.as_ref().and_then(|v| v.2.clone());
        conn.execute(
            "INSERT INTO verification_queue_items (id, project_id, idx, label, source_path, dest_path, last_job_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(project_id, idx) DO UPDATE SET
                label = excluded.label,
                source_path = excluded.source_path,
                dest_path = excluded.dest_path,
                updated_at = excluded.updated_at",
            params![id, project_id, idx, label, source_path, dest_path, last_job_id, created_at, now],
        )?;
        Ok(VerificationQueueItem {
            id,
            project_id: project_id.to_string(),
            idx,
            label: label.map(|s| s.to_string()),
            source_path: source_path.to_string(),
            dest_path: dest_path.to_string(),
            last_job_id,
            created_at,
            updated_at: now,
        })
    }

    pub fn remove_verification_queue_item(&self, project_id: &str, idx: i32) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM verification_queue_items WHERE project_id = ?1 AND idx = ?2",
            params![project_id, idx],
        )?;
        tx.execute(
            "UPDATE verification_queue_items
             SET idx = idx - 1, updated_at = ?3
             WHERE project_id = ?1 AND idx > ?2",
            params![project_id, idx, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn clear_verification_queue(&self, project_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM verification_queue_items WHERE project_id = ?1",
            params![project_id],
        )?;
        Ok(())
    }

    pub fn attach_queue_job(&self, project_id: &str, idx: i32, job_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE verification_queue_items
             SET last_job_id = ?1, updated_at = ?4
             WHERE project_id = ?2 AND idx = ?3",
            params![job_id, project_id, idx, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get_verification_items(&self, job_id: &str) -> SqlResult<Vec<VerificationItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT job_id, rel_path, source_size, dest_size, source_mtime, dest_mtime, source_hash, dest_hash, status, error_message 
             FROM verification_items WHERE job_id = ?1"
        )?;
        let items = stmt
            .query_map(params![job_id], |row| {
                Ok(VerificationItem {
                    job_id: row.get(0)?,
                    rel_path: row.get(1)?,
                    source_size: row.get::<_, i64>(2)? as u64,
                    dest_size: row.get::<_, Option<i64>>(3)?.map(|s| s as u64),
                    source_mtime: row.get::<_, i64>(4)? as u64,
                    dest_mtime: row.get::<_, Option<i64>>(5)?.map(|s| s as u64),
                    source_hash: row.get(6)?,
                    dest_hash: row.get(7)?,
                    status: row.get(8)?,
                    error_message: row.get(9)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(items)
    }

    pub fn get_scene_detection_cache(
        &self,
        clip_id: &str,
        threshold: f64,
        analyzer_version: &str,
    ) -> SqlResult<Option<SceneDetectionCache>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT clip_id, threshold, analyzer_version, cut_points_json, updated_at
             FROM scene_detection_cache
             WHERE clip_id = ?1 AND threshold = ?2 AND analyzer_version = ?3",
        )?;
        let mut rows = stmt.query_map(params![clip_id, threshold, analyzer_version], |row| {
            Ok(SceneDetectionCache {
                clip_id: row.get(0)?,
                threshold: row.get(1)?,
                analyzer_version: row.get(2)?,
                cut_points_json: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        match rows.next() {
            Some(Ok(item)) => Ok(Some(item)),
            _ => Ok(None),
        }
    }

    pub fn upsert_scene_detection_cache(&self, item: &SceneDetectionCache) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scene_detection_cache (clip_id, threshold, analyzer_version, cut_points_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(clip_id, threshold, analyzer_version) DO UPDATE SET
                cut_points_json = excluded.cut_points_json,
                updated_at = excluded.updated_at",
            params![
                item.clip_id,
                item.threshold,
                item.analyzer_version,
                item.cut_points_json,
                item.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn clear_scene_detection_cache_for_project(&self, project_id: &str) -> SqlResult<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scene_detection_cache WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)",
            params![project_id],
        )
    }

    pub fn purge_caches(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM scene_detection_cache", [])?;
        conn.execute("DELETE FROM file_hash_cache", [])?;
        Ok(())
    }

    pub fn upsert_job(&self, job: &PersistentJob) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO jobs (id, kind, status, progress, message, error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                progress = excluded.progress,
                message = excluded.message,
                error = excluded.error,
                updated_at = excluded.updated_at",
            params![
                job.id,
                job.kind,
                job.status,
                job.progress,
                job.message,
                job.error,
                job.created_at,
                job.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn list_jobs(&self) -> SqlResult<Vec<PersistentJob>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, kind, status, progress, message, error, created_at, updated_at 
             FROM jobs ORDER BY updated_at DESC LIMIT 100",
        )?;
        let jobs = stmt
            .query_map([], |row| {
                Ok(PersistentJob {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    status: row.get(2)?,
                    progress: row.get(3)?,
                    message: row.get(4)?,
                    error: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(jobs)
    }

    pub fn cleanup_stale_jobs(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        // Mark any jobs stuck in "queued" or "running" as "cancelled" on app start
        conn.execute(
            "UPDATE jobs SET status = 'cancelled', message = 'App restarted'
             WHERE status IN ('queued', 'running')",
            [],
        )?;
        Ok(())
    }
}

#[allow(dead_code)]
fn remove_sqlite_file(path: &str) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
