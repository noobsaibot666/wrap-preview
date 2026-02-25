use crate::db::{Database, VerificationItem, VerificationJob};
use blake3::Hasher;
use chrono::Utc;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationProgress {
    pub job_id: String,
    pub phase: String, // "INDEXING", "HASHING", "COMPARING", "DONE", "CANCELLED", "FAILED"
    pub current_file: String,
    pub bytes_total: u64,
    pub bytes_processed: u64,
    pub files_total: u32,
    pub files_processed: u32,
    pub ok_count: u32,
    pub mismatch_count: u32,
    pub missing_count: u32,
}

pub struct FileEntry {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub size: u64,
    pub mtime: u64,
}

pub fn index_tree(root: &Path) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if filename.starts_with('.') || filename == "Thumbs.db" {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            eprintln!("verification: failed metadata for {}", path.display());
            continue;
        };
        let rel_path = match path.strip_prefix(root) {
            Ok(p) => p.to_string_lossy().into_owned(),
            Err(_) => continue,
        };
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        entries.push(FileEntry {
            rel_path,
            abs_path: path.to_path_buf(),
            size: metadata.len(),
            mtime,
        });
    }
    entries
}

pub fn hash_file(path: &Path) -> Result<String, std::io::Error> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::with_capacity(1024 * 1024 * 4, file);
    let mut hasher = Hasher::new();
    let mut buffer = [0; 1024 * 1024];

    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

pub async fn run_verification(
    app: AppHandle,
    db: Arc<Database>,
    job_id: String,
    source_root: String,
    source_label: String,
    dest_root: String,
    dest_label: String,
    mode: String,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut job = VerificationJob {
        id: job_id.clone(),
        created_at: now,
        source_root: source_root.clone(),
        source_label: source_label.clone(),
        dest_root: dest_root.clone(),
        dest_label: dest_label.clone(),
        mode: mode.clone(),
        status: "RUNNING".to_string(),
        total_files: 0,
        total_bytes: 0,
        verified_ok_count: 0,
        missing_count: 0,
        size_mismatch_count: 0,
        hash_mismatch_count: 0,
        unreadable_count: 0,
        extra_in_dest_count: 0,
    };

    db.insert_verification_job(&job).map_err(|e| e.to_string())?;

    emit_progress(
        &app,
        VerificationProgress {
            job_id: job_id.clone(),
            phase: "INDEXING".to_string(),
            current_file: String::new(),
            bytes_total: 0,
            bytes_processed: 0,
            files_total: 0,
            files_processed: 0,
            ok_count: 0,
            mismatch_count: 0,
            missing_count: 0,
        },
    );

    let source_path = PathBuf::from(&source_root);
    let dest_path = PathBuf::from(&dest_root);
    let source_entries = index_tree(&source_path);
    let dest_entries = index_tree(&dest_path);

    job.total_files = source_entries.len() as u32;
    job.total_bytes = source_entries.iter().map(|e| e.size).sum();
    db.update_verification_job_counts(&job).map_err(|e| e.to_string())?;

    let dest_map: HashMap<String, FileEntry> = dest_entries
        .into_iter()
        .map(|e| (e.rel_path.clone(), e))
        .collect();

    let dest_map_shared = Arc::new(StdMutex::new(dest_map));
    let results_shared = Arc::new(StdMutex::new(Vec::new()));
    let job_shared = Arc::new(StdMutex::new(job.clone()));
    let bytes_processed = Arc::new(AtomicU64::new(0));
    let cancelled = Arc::new(AtomicBool::new(false));

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .map_err(|e| e.to_string())?;

    pool.install(|| {
        source_entries.par_iter().enumerate().for_each(|(idx, src)| {
            if cancel_flag.load(Ordering::Relaxed) {
                cancelled.store(true, Ordering::Relaxed);
                return;
            }

            let mut item = VerificationItem {
                job_id: job_id.clone(),
                rel_path: src.rel_path.clone(),
                source_size: src.size,
                dest_size: None,
                source_mtime: src.mtime,
                dest_mtime: None,
                source_hash: None,
                dest_hash: None,
                status: "OK".to_string(),
                error_message: None,
            };

            let mut dest_entry = None;
            if let Ok(mut dm) = dest_map_shared.lock() {
                if let Some(dst) = dm.remove(&src.rel_path) {
                    dest_entry = Some(dst);
                }
            }

            if let Some(dst) = dest_entry {
                item.dest_size = Some(dst.size);
                item.dest_mtime = Some(dst.mtime);

                if src.size != dst.size {
                    item.status = "SIZE_MISMATCH".to_string();
                    if let Ok(mut j) = job_shared.lock() {
                        j.size_mismatch_count += 1;
                    }
                } else if mode == "SOLID" {
                    let src_hash = hash_file(&src.abs_path);
                    let dst_hash = hash_file(&dst.abs_path);
                    match (src_hash, dst_hash) {
                        (Ok(sh), Ok(dh)) => {
                            item.source_hash = Some(sh.clone());
                            item.dest_hash = Some(dh.clone());
                            if sh != dh {
                                item.status = "HASH_MISMATCH".to_string();
                                if let Ok(mut j) = job_shared.lock() {
                                    j.hash_mismatch_count += 1;
                                }
                            } else if let Ok(mut j) = job_shared.lock() {
                                j.verified_ok_count += 1;
                            }
                        }
                        (e1, e2) => {
                            item.status = if e1.is_err() {
                                "UNREADABLE_SOURCE"
                            } else {
                                "UNREADABLE_DEST"
                            }
                            .to_string();
                            item.error_message = Some(format!("S:{:?} D:{:?}", e1.err(), e2.err()));
                            if let Ok(mut j) = job_shared.lock() {
                                j.unreadable_count += 1;
                            }
                        }
                    }
                } else if let Ok(mut j) = job_shared.lock() {
                    j.verified_ok_count += 1;
                }
            } else {
                item.status = "MISSING".to_string();
                if let Ok(mut j) = job_shared.lock() {
                    j.missing_count += 1;
                }
            }

            let current_bytes = bytes_processed.fetch_add(src.size, Ordering::SeqCst) + src.size;
            if idx % 10 == 0 || idx == source_entries.len().saturating_sub(1) {
                if let Ok(j) = job_shared.lock() {
                    emit_progress(
                        &app,
                        VerificationProgress {
                            job_id: job_id.clone(),
                            phase: "HASHING".to_string(),
                            current_file: src.rel_path.clone(),
                            bytes_total: j.total_bytes,
                            bytes_processed: current_bytes,
                            files_total: j.total_files,
                            files_processed: idx as u32 + 1,
                            ok_count: j.verified_ok_count,
                            mismatch_count: j.size_mismatch_count + j.hash_mismatch_count,
                            missing_count: j.missing_count,
                        },
                    );
                }
            }

            if let Ok(mut res) = results_shared.lock() {
                res.push(item);
                if res.len() >= 100 {
                    let flushed = res.clone();
                    res.clear();
                    if let Err(e) = db.insert_verification_items(&flushed) {
                        eprintln!("verification: failed flush items: {}", e);
                    }
                    if let Ok(j) = job_shared.lock() {
                        if let Err(e) = db.update_verification_job_counts(&j) {
                            eprintln!("verification: failed flush counts: {}", e);
                        }
                    }
                }
            }
        });
    });

    let final_results = if let Ok(mut res) = results_shared.lock() {
        let items = res.clone();
        res.clear();
        items
    } else {
        Vec::new()
    };
    if !final_results.is_empty() {
        db.insert_verification_items(&final_results)
            .map_err(|e| format!("Failed writing verification results: {}", e))?;
    }

    let mut final_job = job_shared
        .lock()
        .map_err(|_| "Failed to lock final verification state".to_string())?
        .clone();

    if let Ok(dm) = dest_map_shared.lock() {
        if !dm.is_empty() {
            let mut extras = Vec::new();
            for (rel_path, dst) in dm.iter() {
                extras.push(VerificationItem {
                    job_id: job_id.clone(),
                    rel_path: rel_path.clone(),
                    source_size: 0,
                    dest_size: Some(dst.size),
                    source_mtime: 0,
                    dest_mtime: Some(dst.mtime),
                    source_hash: None,
                    dest_hash: None,
                    status: "EXTRA_IN_DEST".to_string(),
                    error_message: None,
                });
                final_job.extra_in_dest_count += 1;
            }
            db.insert_verification_items(&extras)
                .map_err(|e| format!("Failed writing extra-file records: {}", e))?;
        }
    }

    let was_cancelled = cancelled.load(Ordering::Relaxed) || cancel_flag.load(Ordering::Relaxed);
    final_job.status = if was_cancelled {
        "CANCELLED".to_string()
    } else {
        "DONE".to_string()
    };
    db.update_verification_job_counts(&final_job)
        .map_err(|e| e.to_string())?;
    db.update_verification_job_status(&job_id, &final_job.status)
        .map_err(|e| e.to_string())?;

    emit_progress(
        &app,
        VerificationProgress {
            job_id: job_id.clone(),
            phase: final_job.status.clone(),
            current_file: if was_cancelled {
                "Cancelled".to_string()
            } else {
                "Complete".to_string()
            },
            bytes_total: final_job.total_bytes,
            bytes_processed: final_job.total_bytes.min(bytes_processed.load(Ordering::SeqCst)),
            files_total: final_job.total_files,
            files_processed: final_job.total_files,
            ok_count: final_job.verified_ok_count,
            mismatch_count: final_job.size_mismatch_count + final_job.hash_mismatch_count,
            missing_count: final_job.missing_count,
        },
    );

    Ok(())
}

fn emit_progress(app: &AppHandle, payload: VerificationProgress) {
    if let Err(e) = app.emit("verification-progress", payload) {
        eprintln!("verification: failed emitting progress: {}", e);
    }
}
