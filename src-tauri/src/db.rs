use rusqlite::{Connection, params, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Thread-safe database wrapper
pub struct Database {
    conn: Mutex<Connection>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thumbnail {
    pub clip_id: String,
    pub index: u32,
    pub timestamp_ms: u64,
    pub file_path: String,
}

impl Database {
    pub fn new(db_path: &str) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
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
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS thumbnails (
                clip_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                PRIMARY KEY (clip_id, idx),
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
            "INSERT OR REPLACE INTO clips (id, project_id, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height, video_codec, audio_summary, timecode, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
            ],
        )?;
        Ok(())
    }

    pub fn get_clips(&self, project_id: &str) -> SqlResult<Vec<Clip>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, filename, file_path, size_bytes, created_at, duration_ms, fps, width, height, video_codec, audio_summary, timecode, status
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
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(clips)
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

    pub fn delete_project_data(&self, project_id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM thumbnails WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?1)", params![project_id])?;
        conn.execute("DELETE FROM clips WHERE project_id = ?1", params![project_id])?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        Ok(())
    }
}
