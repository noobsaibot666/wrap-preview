use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Queued => "queued",
            JobStatus::Running => "running",
            JobStatus::Done => "done",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct JobInfo {
    pub id: String,
    pub kind: String,
    pub status: JobStatus,
    pub progress: f32,
    pub message: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

struct JobRecord {
    info: JobInfo,
    cancel_flag: Arc<AtomicBool>,
}

pub struct JobManager {
    jobs: Mutex<HashMap<String, JobRecord>>,
    db: Mutex<Option<crate::db::Database>>,
}

impl JobManager {
    pub fn new(db: Option<crate::db::Database>) -> Self {
        if let Some(ref d) = db {
            let _ = d.cleanup_stale_jobs();
        }
        Self {
            jobs: Mutex::new(HashMap::new()),
            db: Mutex::new(db),
        }
    }

    pub fn create_job(&self, kind: &str, id: Option<String>) -> (String, Arc<AtomicBool>) {
        let now = Utc::now().to_rfc3339();
        let job_id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let info = JobInfo {
            id: job_id.clone(),
            kind: kind.to_string(),
            status: JobStatus::Queued,
            progress: 0.0,
            message: "Queued".to_string(),
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };
        lock_or_recover(&self.jobs).insert(
            job_id.clone(),
            JobRecord {
                info: info.clone(),
                cancel_flag: cancel_flag.clone(),
            },
        );

        // Persist to DB
        if let Some(db) = lock_or_recover(&self.db).as_ref() {
            let _ = db.upsert_job(&crate::db::PersistentJob {
                id: info.id,
                kind: info.kind,
                status: info.status.as_str().to_string(),
                progress: info.progress,
                message: info.message,
                error: info.error,
                created_at: info.created_at,
                updated_at: info.updated_at,
            });
        }

        (job_id, cancel_flag)
    }

    pub fn mark_running(&self, job_id: &str, message: &str) {
        self.update(
            job_id,
            JobStatus::Running,
            None,
            Some(message.to_string()),
            None,
        );
    }

    pub fn update_progress(&self, job_id: &str, progress: f32, message: Option<String>) {
        let bounded = progress.clamp(0.0, 1.0);
        self.update(job_id, JobStatus::Running, Some(bounded), message, None);
    }

    pub fn mark_done(&self, job_id: &str, message: &str) {
        self.update(
            job_id,
            JobStatus::Done,
            Some(1.0),
            Some(message.to_string()),
            None,
        );
    }

    pub fn mark_failed(&self, job_id: &str, error: &str) {
        self.update(
            job_id,
            JobStatus::Failed,
            None,
            Some("Failed".to_string()),
            Some(error.to_string()),
        );
    }

    pub fn cancel_job(&self, job_id: &str) -> bool {
        let mut jobs = lock_or_recover(&self.jobs);
        if let Some(record) = jobs.get_mut(job_id) {
            record.cancel_flag.store(true, Ordering::Relaxed);
            record.info.status = JobStatus::Cancelled;
            record.info.message = "Cancellation requested".to_string();
            record.info.updated_at = Utc::now().to_rfc3339();

            // Persist
            if let Some(db) = lock_or_recover(&self.db).as_ref() {
                let _ = db.upsert_job(&crate::db::PersistentJob {
                    id: record.info.id.clone(),
                    kind: record.info.kind.clone(),
                    status: record.info.status.as_str().to_string(),
                    progress: record.info.progress,
                    message: record.info.message.clone(),
                    error: record.info.error.clone(),
                    created_at: record.info.created_at.clone(),
                    updated_at: record.info.updated_at.clone(),
                });
            }

            return true;
        }
        false
    }

    pub fn is_cancelled(cancel_flag: &Arc<AtomicBool>) -> bool {
        cancel_flag.load(Ordering::Relaxed)
    }

    pub fn get_job(&self, job_id: &str) -> Option<JobInfo> {
        lock_or_recover(&self.jobs)
            .get(job_id)
            .map(|r| r.info.clone())
    }

    pub fn list_jobs(&self) -> Vec<JobInfo> {
        let mut out: Vec<JobInfo> = lock_or_recover(&self.jobs)
            .values()
            .map(|r| r.info.clone())
            .collect();

        // Merge with persisted jobs for history
        if let Some(db) = lock_or_recover(&self.db).as_ref() {
            if let Ok(persisted) = db.list_jobs() {
                for p in persisted {
                    if !out.iter().any(|j| j.id == p.id) {
                        let status = match p.status.as_str() {
                            "queued" => JobStatus::Queued,
                            "running" => JobStatus::Running,
                            "done" => JobStatus::Done,
                            "failed" => JobStatus::Failed,
                            "cancelled" => JobStatus::Cancelled,
                            _ => JobStatus::Failed,
                        };
                        out.push(JobInfo {
                            id: p.id,
                            kind: p.kind,
                            status,
                            progress: p.progress,
                            message: p.message,
                            error: p.error,
                            created_at: p.created_at,
                            updated_at: p.updated_at,
                        });
                    }
                }
            }
        }

        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    fn update(
        &self,
        job_id: &str,
        status: JobStatus,
        progress: Option<f32>,
        message: Option<String>,
        error: Option<String>,
    ) {
        let mut jobs = lock_or_recover(&self.jobs);
        if let Some(record) = jobs.get_mut(job_id) {
            record.info.status = status;
            if let Some(p) = progress {
                record.info.progress = p;
            }
            if let Some(m) = message {
                record.info.message = m;
            }
            if let Some(e) = error {
                record.info.error = Some(e);
            }
            record.info.updated_at = Utc::now().to_rfc3339();

            // Persist
            if let Some(db) = lock_or_recover(&self.db).as_ref() {
                let _ = db.upsert_job(&crate::db::PersistentJob {
                    id: record.info.id.clone(),
                    kind: record.info.kind.clone(),
                    status: record.info.status.as_str().to_string(),
                    progress: record.info.progress,
                    message: record.info.message.clone(),
                    error: record.info.error.clone(),
                    created_at: record.info.created_at.clone(),
                    updated_at: record.info.updated_at.clone(),
                });
            }
        }
    }
}

fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}
