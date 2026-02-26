use rusqlite::{params, params_from_iter, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Thread-safe database wrapper
#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRoot {
    pub id: String,
    pub project_id: String,
    pub root_path: String,
    pub label: String,
    pub created_at: String,
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

impl Database {
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
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
        }

        Ok(db)
    }

    fn create_tables(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                root_path TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
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
                UNIQUE(project_id, root_path),
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_time INTEGER,
                end_time INTEGER,
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
                idx INTEGER NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                PRIMARY KEY (clip_id, idx),
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
            ",
        )?;
        Ok(())
    }

    pub fn upsert_project(&self, project: &Project) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO projects (id, root_path, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![project.id, project.root_path, project.name, project.created_at],
        )?;
        Ok(())
    }

    pub fn get_project(&self, id: &str) -> SqlResult<Option<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, root_path, name, created_at FROM projects WHERE id = ?1")?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(Project {
                id: row.get(0)?,
                root_path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        match rows.next() {
            Some(Ok(project)) => Ok(Some(project)),
            _ => Ok(None),
        }
    }

    pub fn list_project_roots(&self, project_id: &str) -> SqlResult<Vec<ProjectRoot>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, root_path, label, created_at
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
            "UPDATE project_roots SET label = ?1 WHERE project_id = ?2 AND root_path = ?3",
            params![root.label, root.project_id, root.root_path],
        )?;
        if updated == 0 {
            conn.execute(
                "INSERT OR IGNORE INTO project_roots (id, project_id, root_path, label, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    root.id,
                    root.project_id,
                    root.root_path,
                    root.label,
                    root.created_at
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

    pub fn get_project_root(&self, root_id: &str) -> SqlResult<Option<ProjectRoot>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, root_path, label, created_at FROM project_roots WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![root_id], |row| {
            Ok(ProjectRoot {
                id: row.get(0)?,
                project_id: row.get(1)?,
                root_path: row.get(2)?,
                label: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        match rows.next() {
            Some(Ok(root)) => Ok(Some(root)),
            _ => Ok(None),
        }
    }

    pub fn upsert_clip(&self, clip: &Clip) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO clips (
                id, project_id, root_id, rel_path, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height,
                video_codec, video_bitrate, format_name, audio_codec, audio_channels, audio_sample_rate,
                camera_iso, camera_white_balance, audio_summary, timecode, status, rating, flag, notes,
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
                    camera_iso, camera_white_balance, audio_summary, timecode, status, rating, flag, notes,
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
                audio_summary: row.get(20)?,
                timecode: row.get(21)?,
                status: row.get(22)?,
                rating: row.get(23)?,
                flag: row.get(24)?,
                notes: row.get(25)?,
                shot_size: row.get(26)?,
                movement: row.get(27)?,
                manual_order: row.get(28)?,
                audio_envelope: row.get(29)?,
                lut_enabled: row.get(30)?,
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
                    camera_iso, camera_white_balance, audio_summary, timecode, status, rating, flag, notes,
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
                    audio_summary: row.get(20)?,
                    timecode: row.get(21)?,
                    status: row.get(22)?,
                    rating: row.get(23)?,
                    flag: row.get(24)?,
                    notes: row.get(25)?,
                    shot_size: row.get(26)?,
                    movement: row.get(27)?,
                    manual_order: row.get(28)?,
                    audio_envelope: row.get(29)?,
                    lut_enabled: row.get(30)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(clips)
    }

    pub fn get_clips_by_ids(&self, ids: &[String]) -> SqlResult<Vec<Clip>> {
        let conn = self.conn.lock().unwrap();
        let placeholders: String = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let query = format!(
            "SELECT id, project_id, root_id, rel_path, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height,
                    video_codec, video_bitrate, format_name, audio_codec, audio_channels, audio_sample_rate,
                    camera_iso, camera_white_balance, audio_summary, timecode, status, rating, flag, notes,
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
                    audio_summary: row.get(20)?,
                    timecode: row.get(21)?,
                    status: row.get(22)?,
                    rating: row.get(23)?,
                    flag: row.get(24)?,
                    notes: row.get(25)?,
                    shot_size: row.get(26)?,
                    movement: row.get(27)?,
                    manual_order: row.get(28)?,
                    audio_envelope: row.get(29)?,
                    lut_enabled: row.get(30)?,
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
            "INSERT OR REPLACE INTO thumbnails (clip_id, idx, timestamp_ms, file_path) VALUES (?1, ?2, ?3, ?4)",
            params![thumb.clip_id, thumb.index, thumb.timestamp_ms as i64, thumb.file_path],
        )?;
        Ok(())
    }

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
            "SELECT clip_id, idx, timestamp_ms, file_path FROM thumbnails WHERE clip_id = ?1 ORDER BY idx",
        )?;
        let thumbs = stmt
            .query_map(params![clip_id], |row| {
                Ok(Thumbnail {
                    clip_id: row.get(0)?,
                    index: row.get::<_, u32>(1)?,
                    timestamp_ms: row.get::<_, i64>(2)? as u64,
                    file_path: row.get(3)?,
                })
            })?
            .filter_map(|r| r.ok())
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
                "INSERT INTO blocks (id, project_id, name, start_time, end_time, clip_count, camera_list, confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for block in blocks {
                stmt.execute(params![
                    block.id,
                    block.project_id,
                    block.name,
                    block.start_time,
                    block.end_time,
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
            "SELECT id, project_id, name, start_time, end_time, clip_count, camera_list, confidence
             FROM blocks
             WHERE project_id = ?1
             ORDER BY start_time ASC, name ASC",
        )?;
        let blocks = stmt
            .query_map(params![project_id], |row| {
                Ok(SceneBlock {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    start_time: row.get(3)?,
                    end_time: row.get(4)?,
                    clip_count: row.get(5)?,
                    camera_list: row.get(6)?,
                    confidence: row.get::<_, f64>(7)? as f32,
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
                    c.camera_iso, c.camera_white_balance, c.audio_summary, c.timecode, c.status, c.rating, c.flag, c.notes,
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
                    audio_summary: row.get(20)?,
                    timecode: row.get(21)?,
                    status: row.get(22)?,
                    rating: row.get(23)?,
                    flag: row.get(24)?,
                    notes: row.get(25)?,
                    shot_size: row.get(26)?,
                    movement: row.get(27)?,
                    manual_order: row.get(28)?,
                    audio_envelope: row.get(29)?,
                    lut_enabled: row.get(30)?,
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
            "INSERT INTO blocks (id, project_id, name, start_time, end_time, clip_count, camera_list, confidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                block.id,
                block.project_id,
                block.name,
                block.start_time,
                block.end_time,
                block.clip_count,
                block.camera_list,
                block.confidence,
            ],
        )?;
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

    pub fn delete_project_data(&self, project_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM block_clips WHERE block_id IN (SELECT id FROM blocks WHERE project_id = ?1)", params![project_id])?;
        conn.execute(
            "DELETE FROM blocks WHERE project_id = ?1",
            params![project_id],
        )?;
        conn.execute(
            "DELETE FROM thumbnails WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)",
            params![project_id],
        )?;
        conn.execute(
            "DELETE FROM clips WHERE project_id = ?1",
            params![project_id],
        )?;
        conn.execute(
            "DELETE FROM project_roots WHERE project_id = ?1",
            params![project_id],
        )?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        Ok(())
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
}
