use rusqlite::{Connection, params, Result as SqlResult, params_from_iter};
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
pub struct Clip {
    pub id: String,
    pub project_id: String,
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
    pub status: String, // "ok", "warn", "fail"
    pub rating: i32,
    pub flag: String,   // "none", "pick", "reject"
    pub notes: Option<String>,
    pub audio_envelope: Option<Vec<u8>>,
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
    pub created_at: String,
    pub source_root: String,
    pub dest_root: String,
    pub mode: String, // "FAST", "SOLID"
    pub status: String, // "RUNNING", "DONE", "FAILED", "CANCELLED"
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
            let columns: Vec<String> = stmt.query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();

            if !columns.contains(&"rating".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN rating INTEGER NOT NULL DEFAULT 0", [])?;
            }
            if !columns.contains(&"flag".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN flag TEXT NOT NULL DEFAULT 'none'", [])?;
            }
            if !columns.contains(&"notes".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN notes TEXT", [])?;
            }
            if !columns.contains(&"audio_envelope".to_string()) {
                conn.execute("ALTER TABLE clips ADD COLUMN audio_envelope BLOB", [])?;
            }

            let mut block_stmt = conn.prepare("PRAGMA table_info(blocks)")?;
            let block_columns: Vec<String> = block_stmt
                .query_map([], |row| row.get(1))?
                .filter_map(|r| r.ok())
                .collect();
            if !block_columns.contains(&"clip_count".to_string()) {
                conn.execute("ALTER TABLE blocks ADD COLUMN clip_count INTEGER NOT NULL DEFAULT 0", [])?;
            }
            if !block_columns.contains(&"camera_list".to_string()) {
                conn.execute("ALTER TABLE blocks ADD COLUMN camera_list TEXT", [])?;
            }
            if !block_columns.contains(&"confidence".to_string()) {
                conn.execute("ALTER TABLE blocks ADD COLUMN confidence REAL NOT NULL DEFAULT 0.0", [])?;
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
                conn.execute("ALTER TABLE block_clips ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0", [])?;
            }
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
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                fps REAL NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                video_codec TEXT NOT NULL,
                audio_summary TEXT NOT NULL,
                timecode TEXT,
                status TEXT NOT NULL DEFAULT 'ok',
                rating INTEGER NOT NULL DEFAULT 0,
                flag TEXT NOT NULL DEFAULT 'none',
                notes TEXT,
                audio_envelope BLOB,
                FOREIGN KEY (project_id) REFERENCES projects(id)
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
                created_at TEXT NOT NULL,
                source_root TEXT NOT NULL,
                dest_root TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                total_files INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                verified_ok_count INTEGER NOT NULL,
                missing_count INTEGER NOT NULL,
                size_mismatch_count INTEGER NOT NULL,
                hash_mismatch_count INTEGER NOT NULL,
                unreadable_count INTEGER NOT NULL,
                extra_in_dest_count INTEGER NOT NULL
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
        let mut stmt = conn.prepare("SELECT id, root_path, name, created_at FROM projects WHERE id = ?1")?;
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

    pub fn upsert_clip(&self, clip: &Clip) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO clips (id, project_id, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height, video_codec, audio_summary, timecode, status, rating, flag, notes, audio_envelope)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                clip.id,
                clip.project_id,
                clip.filename,
                clip.file_path,
                clip.size_bytes as i64,
                clip.created_at,
                clip.duration_ms as i64,
                clip.fps,
                clip.width,
                clip.height,
                clip.video_codec,
                clip.audio_summary,
                clip.timecode,
                clip.status,
                clip.rating,
                clip.flag,
                clip.notes,
                clip.audio_envelope,
            ],
        )?;
        Ok(())
    }

    pub fn get_clips(&self, project_id: &str) -> SqlResult<Vec<Clip>> {
        // ... (truncated for brevity in instructions, I'll provide full block)
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height, video_codec, audio_summary, timecode, status, rating, flag, notes, audio_envelope
             FROM clips WHERE project_id = ?1 ORDER BY filename",
        )?;
        let clips = stmt
            .query_map(params![project_id], |row| {
                Ok(Clip {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    filename: row.get(2)?,
                    file_path: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    created_at: row.get(5)?,
                    duration_ms: row.get::<_, i64>(6)? as u64,
                    fps: row.get(7)?,
                    width: row.get::<_, u32>(8)?,
                    height: row.get::<_, u32>(9)?,
                    video_codec: row.get(10)?,
                    audio_summary: row.get(11)?,
                    timecode: row.get(12)?,
                    status: row.get(13)?,
                    rating: row.get(14)?,
                    flag: row.get(15)?,
                    notes: row.get(16)?,
                    audio_envelope: row.get(17)?,
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
            "SELECT id, project_id, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height, video_codec, audio_summary, timecode, status, rating, flag, notes, audio_envelope
             FROM clips WHERE id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&query)?;
        let clips = stmt
            .query_map(params_from_iter(ids), |row| {
                Ok(Clip {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    filename: row.get(2)?,
                    file_path: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    created_at: row.get(5)?,
                    duration_ms: row.get::<_, i64>(6)? as u64,
                    fps: row.get(7)?,
                    width: row.get::<_, u32>(8)?,
                    height: row.get::<_, u32>(9)?,
                    video_codec: row.get(10)?,
                    audio_summary: row.get(11)?,
                    timecode: row.get(12)?,
                    status: row.get(13)?,
                    rating: row.get(14)?,
                    flag: row.get(15)?,
                    notes: row.get(16)?,
                    audio_envelope: row.get(17)?,
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
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        
        if let Some(r) = rating {
            conn.execute("UPDATE clips SET rating = ?1 WHERE id = ?2", params![r, clip_id])?;
        }
        if let Some(f) = flag {
            conn.execute("UPDATE clips SET flag = ?1 WHERE id = ?2", params![f, clip_id])?;
        }
        if let Some(n) = notes {
            conn.execute("UPDATE clips SET notes = ?1 WHERE id = ?2", params![n, clip_id])?;
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
        tx.execute("DELETE FROM blocks WHERE project_id = ?1", params![project_id])?;

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
            "SELECT c.id, c.project_id, c.filename, c.file_path, c.size_bytes, c.created_at, c.duration_ms, c.fps, c.width, c.height, c.video_codec, c.audio_summary, c.timecode, c.status, c.rating, c.flag, c.notes, c.audio_envelope
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
                    filename: row.get(2)?,
                    file_path: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    created_at: row.get(5)?,
                    duration_ms: row.get::<_, i64>(6)? as u64,
                    fps: row.get(7)?,
                    width: row.get::<_, u32>(8)?,
                    height: row.get::<_, u32>(9)?,
                    video_codec: row.get(10)?,
                    audio_summary: row.get(11)?,
                    timecode: row.get(12)?,
                    status: row.get(13)?,
                    rating: row.get(14)?,
                    flag: row.get(15)?,
                    notes: row.get(16)?,
                    audio_envelope: row.get(17)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(clips)
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

    pub fn replace_block_memberships(
        &self,
        block_id: &str,
        clip_ids: &[String],
    ) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM block_clips WHERE block_id = ?1", params![block_id])?;
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
        conn.execute("DELETE FROM block_clips WHERE block_id = ?1", params![block_id])?;
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
        conn.execute("DELETE FROM blocks WHERE project_id = ?1", params![project_id])?;
        conn.execute("DELETE FROM thumbnails WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)", params![project_id])?;
        conn.execute("DELETE FROM clips WHERE project_id = ?1", params![project_id])?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        Ok(())
    }

    pub fn insert_verification_job(&self, job: &VerificationJob) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO verification_jobs (id, created_at, source_root, dest_root, mode, status, total_files, total_bytes, verified_ok_count, missing_count, size_mismatch_count, hash_mismatch_count, unreadable_count, extra_in_dest_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                job.id, job.created_at, job.source_root, job.dest_root, job.mode, job.status,
                job.total_files, job.total_bytes as i64, job.verified_ok_count, job.missing_count,
                job.size_mismatch_count, job.hash_mismatch_count, job.unreadable_count, job.extra_in_dest_count
            ],
        )?;
        Ok(())
    }

    pub fn update_verification_job_status(&self, id: &str, status: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE verification_jobs SET status = ?1 WHERE id = ?2", params![status, id])?;
        Ok(())
    }

    pub fn update_verification_job_counts(&self, job: &VerificationJob) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE verification_jobs SET 
                verified_ok_count = ?1, missing_count = ?2, size_mismatch_count = ?3, 
                hash_mismatch_count = ?4, unreadable_count = ?5, extra_in_dest_count = ?6,
                total_files = ?7, total_bytes = ?8
             WHERE id = ?9",
            params![
                job.verified_ok_count, job.missing_count, job.size_mismatch_count, 
                job.hash_mismatch_count, job.unreadable_count, job.extra_in_dest_count,
                job.total_files, job.total_bytes as i64, job.id
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
                    item.job_id, item.rel_path, item.source_size as i64, item.dest_size.map(|s| s as i64),
                    item.source_mtime as i64, item.dest_mtime.map(|s| s as i64),
                    item.source_hash, item.dest_hash, item.status, item.error_message
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_verification_job(&self, id: &str) -> SqlResult<Option<VerificationJob>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, created_at, source_root, dest_root, mode, status, total_files, total_bytes, verified_ok_count, missing_count, size_mismatch_count, hash_mismatch_count, unreadable_count, extra_in_dest_count 
             FROM verification_jobs WHERE id = ?1"
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(VerificationJob {
                id: row.get(0)?,
                created_at: row.get(1)?,
                source_root: row.get(2)?,
                dest_root: row.get(3)?,
                mode: row.get(4)?,
                status: row.get(5)?,
                total_files: row.get(6)?,
                total_bytes: row.get::<_, i64>(7)? as u64,
                verified_ok_count: row.get(8)?,
                missing_count: row.get(9)?,
                size_mismatch_count: row.get(10)?,
                hash_mismatch_count: row.get(11)?,
                unreadable_count: row.get(12)?,
                extra_in_dest_count: row.get(13)?,
            })
        })?;
        match rows.next() {
            Some(Ok(job)) => Ok(Some(job)),
            _ => Ok(None),
        }
    }

    pub fn get_verification_items(&self, job_id: &str) -> SqlResult<Vec<VerificationItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT job_id, rel_path, source_size, dest_size, source_mtime, dest_mtime, source_hash, dest_hash, status, error_message 
             FROM verification_items WHERE job_id = ?1"
        )?;
        let items = stmt.query_map(params![job_id], |row| {
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
        })?.filter_map(|r| r.ok()).collect();
        Ok(items)
    }
}
