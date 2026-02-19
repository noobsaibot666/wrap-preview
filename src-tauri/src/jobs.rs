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
}

impl JobManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
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
                info,
                cancel_flag: cancel_flag.clone(),
            },
        );
        (job_id, cancel_flag)
    }

    pub fn mark_running(&self, job_id: &str, message: &str) {
        self.update(job_id, JobStatus::Running, None, Some(message.to_string()), None);
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
            return true;
        }
        false
    }

    pub fn is_cancelled(cancel_flag: &Arc<AtomicBool>) -> bool {
        cancel_flag.load(Ordering::Relaxed)
    }

    pub fn get_job(&self, job_id: &str) -> Option<JobInfo> {
        lock_or_recover(&self.jobs).get(job_id).map(|r| r.info.clone())
    }

    pub fn list_jobs(&self) -> Vec<JobInfo> {
        let mut out: Vec<JobInfo> = lock_or_recover(&self.jobs).values().map(|r| r.info.clone()).collect();
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
        }
    }
}

fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}
