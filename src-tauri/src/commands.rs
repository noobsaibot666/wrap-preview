/*
 * (c) 2026 Alan Alves. All rights reserved.
 * CineFlow Suite — Professional Production to Post Hub
 * hello@expose-u.com | https://alan-design.com/
 */

use crate::audio;
use crate::clustering;
use crate::db::{
    Asset, AssetVersion, Clip, Database, ProductionCameraConfig, ProductionLookSetup,
    ProductionMatchLabResultRecord, ProductionMatchLabRunRecord, ProductionMatchLabSource,
    ProductionOnsetChecks, ProductionPreset, ProductionProject, Project, ProjectRoot,
    ReviewCoreAnnotation, ReviewCoreApprovalState, ReviewCoreComment, ReviewCoreFrameNote,
    ReviewCoreProject, ReviewCoreShareLink, ReviewCoreShareSession, SceneBlock,
    SceneDetectionCache, ShotListEquipmentItem, ShotListEquipmentSection, ShotListProject,
    ShotListRow, Thumbnail, VerificationItem, VerificationJob, VerificationQueueItem,
};
use crate::ffprobe;
use crate::jobs::{JobInfo, JobStatus};
#[cfg(target_os = "macos")]
use crate::mac_bookmarks;
use crate::production::{self, CameraProfile, LookPreset};
use crate::production_match_lab::{
    aggregate_frames, analysis_timeout, analyze_frame, build_cache_dir, build_frame_timestamps,
    build_measurement_bundle,
    build_proxy_decode_path, build_proxy_paths, choose_source_path_for_analysis,
    classify_source_format, clip_name_from_path, create_braw_proxy_via_file, create_braw_proxy_via_stdout,
    create_redline_proxy_via_file, hash_source_signature, is_braw_path, is_decoder_backed_raw_path, is_proxy_only_raw_path,
    probe_braw_decoder, probe_redline_decoder, BrawDecoderCaps, RedlineDecoderCaps,
    validate_proxy_output_path,
    CameraMatchAnalysisResult, MatchLabAnalysisTracker, MatchLabProxyAttempt, MatchLabProxyTracker,
    ProductionMatchLabProxyResult, ProductionMatchLabRun, ProductionMatchLabRunResult,
    ProductionMatchLabRunResultInput, ProductionMatchLabRunSummary,
};
use crate::production_calibration::{CalibrationChartDetection, CalibrationCropRectNormalized, CalibrationPoint};
use crate::review_core;
use crate::scanner;
use crate::thumbnail;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bcrypt::{hash, verify, DEFAULT_COST};
use rand::rngs::OsRng;
use rand::RngCore;
use uuid;
mod folders_impl {
    pub use crate::folders::*;
}
use crate::verification;
use sha2::{Digest, Sha256};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShotListBundle {
    pub project: ShotListProject,
    pub rows: Vec<ShotListRow>,
    pub sections: Vec<ShotListEquipmentSection>,
    pub items: Vec<ShotListEquipmentItem>,
}

/// App state holding the database
pub struct AppState {
    pub db: Database,
    pub cache_dir: String,
    #[allow(dead_code)]
    pub app_data_dir: std::path::PathBuf,
    #[allow(dead_code)]
    pub db_path: std::path::PathBuf,
    pub job_manager: Arc<crate::jobs::JobManager>,
    pub perf_log: crate::perf::PerfLog,
    pub review_core_base_dir: std::path::PathBuf,
    pub review_core_server_base_url: Mutex<Option<String>>,
    pub production_matchlab_proxy_tracker: MatchLabProxyTracker,
    pub production_matchlab_analysis_tracker: MatchLabAnalysisTracker,
    pub production_matchlab_braw_decoder_caps: Mutex<Option<BrawDecoderCaps>>,
    pub production_matchlab_redline_decoder_caps: Mutex<Option<RedlineDecoderCaps>>,
}

// ─── Tauri Commands ───

#[tauri::command]
pub async fn scan_folder(
    folder_path: String,
    phase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ScanResult, String> {
    let perf_id = state
        .perf_log
        .start("scan_folder", Some(folder_path.clone()));
    let db = &state.db;

    // Create project
    let project_name = std::path::Path::new(&folder_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled Project".to_string());

    // Include phase in the hash to isolate projects across phases even if they use the same folder
    let project_id = hash_string(&format!("{}::{}", phase, folder_path));
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    #[cfg(target_os = "macos")]
    let bookmark = mac_bookmarks::create_secure_bookmark(&folder_path).ok();
    #[cfg(not(target_os = "macos"))]
    let bookmark = None;

    let project = Project {
        id: project_id.clone(),
        root_path: folder_path.clone(),
        name: project_name.clone(),
        created_at: now,
        bookmark: bookmark.clone(),
    };

    db.upsert_project(&project)
        .map_err(|e| format!("Failed to create project: {}", e))?;
    let initial_root = ProjectRoot {
        id: hash_string(&format!("{}::{}", project_id, folder_path)),
        project_id: project_id.clone(),
        root_path: folder_path.clone(),
        label: "Root 01".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        bookmark,
    };
    db.upsert_project_root(&initial_root)
        .map_err(|e| format!("Failed to create initial project root: {}", e))?;
    db.keep_only_project_root_path(&project_id, &folder_path)
        .map_err(|e| format!("Failed to sync project root set: {}", e))?;

    let clips = rescan_project_internal(db, &project_id, None)?;

    let result = ScanResult {
        project_id,
        project_name,
        clip_count: clips.len(),
        clips,
    };
    state.perf_log.end(&perf_id, "ok", None);
    Ok(result)
}

#[tauri::command]
pub async fn scan_media(
    paths: Vec<String>,
    phase: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ScanResult, String> {
    if paths.is_empty() {
        return Err("No paths provided".into());
    }

    if paths.len() == 1 && std::path::Path::new(&paths[0]).is_dir() {
        return scan_folder(paths[0].clone(), phase, state).await;
    }

    let perf_id = state
        .perf_log
        .start("scan_media", Some(format!("{} files", paths.len())));
    let db = &state.db;

    let first_path = Path::new(&paths[0]);
    let parent = first_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let parent_name = first_path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Selected Media".to_string());

    let project_name = format!("Selected Files from {}", parent_name);
    let project_id = hash_string(&format!("{}::files::{:?}", phase, paths));
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    #[cfg(target_os = "macos")]
    let bookmark = mac_bookmarks::create_secure_bookmark(&parent).ok();
    #[cfg(not(target_os = "macos"))]
    let bookmark = None;

    let project = Project {
        id: project_id.clone(),
        root_path: parent.clone(),
        name: project_name.clone(),
        created_at: now.clone(),
        bookmark: bookmark.clone(),
    };
    db.upsert_project(&project)
        .map_err(|e| format!("Failed to create project: {}", e))?;

    let root = ProjectRoot {
        id: hash_string(&format!("{}::{}", project_id, parent)),
        project_id: project_id.clone(),
        root_path: parent.clone(),
        label: "Selected Files".to_string(),
        created_at: now,
        bookmark,
    };
    db.upsert_project_root(&root)
        .map_err(|e| format!("Failed to create project root: {}", e))?;
    db.keep_only_project_root_path(&project_id, &parent)
        .map_err(|e| format!("Failed to sync project root: {}", e))?;

    let mut clips: Vec<Clip> = Vec::new();
    let mut seen_ids: Vec<String> = Vec::new();

    for file_path in &paths {
        if !std::path::Path::new(file_path).is_file() {
            continue;
        }

        let rel_path = std::path::Path::new(file_path)
            .strip_prefix(&root.root_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.clone());

        let clip_id = generate_clip_id(&root.id, &rel_path);
        let existing = db.get_clip(&clip_id).ok().flatten();
        let clip = build_clip_from_file(db, &project_id, &root, file_path, &rel_path, existing);

        seen_ids.push(clip.id.clone());
        if let Err(e) = db.upsert_clip(&clip) {
            eprintln!("scan: failed to upsert clip {}: {}", clip.id, e);
        }
        clips.push(clip);
    }

    if let Err(e) = db.prune_project_clips(&project_id, &seen_ids) {
        eprintln!("scan: prune project clips failed: {}", e);
    }

    let db_clips = db.get_clips(&project_id).unwrap_or(clips);
    let result = ScanResult {
        project_id,
        project_name,
        clip_count: db_clips.len(),
        clips: db_clips,
    };
    state.perf_log.end(&perf_id, "ok", None);
    Ok(result)
}

#[tauri::command]
pub async fn list_project_roots(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ProjectRoot>, String> {
    state
        .db
        .list_project_roots(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_project_root(
    project_id: String,
    root_path: String,
    label: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ProjectRoot, String> {
    #[cfg(target_os = "macos")]
    let bookmark = mac_bookmarks::create_secure_bookmark(&root_path).ok();
    #[cfg(not(target_os = "macos"))]
    let bookmark = None;

    let root = ProjectRoot {
        id: hash_string(&format!("{}::{}", project_id, root_path)),
        project_id,
        root_path,
        label: label.unwrap_or_else(|| "Root".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
        bookmark,
    };
    state
        .db
        .upsert_project_root(&root)
        .map_err(|e| format!("Failed to add project root: {}", e))?;
    Ok(root)
}

#[tauri::command]
pub async fn remove_project_root(
    root_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .remove_project_root(&root_id)
        .map_err(|e| format!("Failed removing project root: {}", e))
}

#[tauri::command]
pub async fn update_project_root_label(
    root_id: String,
    label: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .update_project_root_label(&root_id, &label)
        .map_err(|e| format!("Failed updating root label: {}", e))
}

#[tauri::command]
pub async fn rescan_project(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ScanResult, String> {
    let project = state
        .db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;
    let clips = rescan_project_internal(&state.db, &project_id, None)?;
    Ok(ScanResult {
        project_id,
        project_name: project.name,
        clip_count: clips.len(),
        clips,
    })
}

#[tauri::command]
pub async fn get_clips(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ClipWithThumbnails>, String> {
    let db = &state.db;
    let roots = db
        .list_project_roots(&project_id)
        .map_err(|e| format!("Failed to get project roots: {}", e))?;
    let root_map: std::collections::HashMap<String, String> =
        roots.into_iter().map(|r| (r.id, r.root_path)).collect();

    let clips = db
        .get_clips(&project_id)
        .map_err(|e| format!("Failed to get clips: {}", e))?;
    let mut valid_clip_ids: Vec<String> = Vec::new();

    let mut result = Vec::new();
    for clip in clips {
        let file_exists = std::path::Path::new(&clip.file_path).exists();
        let in_project_root = root_map
            .get(&clip.root_id)
            .map(|root_path| std::path::Path::new(&clip.file_path).starts_with(root_path))
            .unwrap_or(false);
        if !(file_exists && in_project_root) {
            continue;
        }
        valid_clip_ids.push(clip.id.clone());
        let thumbnails = db.get_thumbnails(&clip.id).unwrap_or_default();
        result.push(ClipWithThumbnails { clip, thumbnails });
    }
    if let Err(e) = db.prune_project_clips(&project_id, &valid_clip_ids) {
        eprintln!("get_clips: failed to prune stale clips: {}", e);
    }
    Ok(result)
}

#[tauri::command]
pub async fn extract_thumbnails(
    project_id: String,
    _thumb_count: Option<u32>,
    clip_id: Option<String>,

    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let perf_id = state
        .perf_log
        .start("extract_thumbnails", Some(project_id.clone()));
    let db = &state.db;
    let job_id = format!("thumbnails:{}", project_id);

    // Cancel existing thumbnail job for this project if it exists
    if let Some(existing) = state.job_manager.get_job(&job_id) {
        if existing.status == JobStatus::Running || existing.status == JobStatus::Queued {
            state.job_manager.cancel_job(&job_id);
            // Give it a tiny bit of time to settle if needed, but usually create_job overwrites the record anyway
        }
    }

    let (job_id, cancel_flag) = state.job_manager.create_job("thumbnails", Some(job_id));
    state
        .job_manager
        .mark_running(&job_id, "Thumbnail extraction started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let mut clips = db
        .get_clips(&project_id)
        .map_err(|e| format!("Failed to get clips: {}", e))?;
    if let Some(target_clip_id) = clip_id.as_ref() {
        clips.retain(|clip| clip.id == *target_clip_id);
    }

    let total_clips = clips.len();
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    let job_id_clone = job_id.clone();
    let project_id_clone = project_id.clone();

    tokio::spawn(async move {
        let semaphore = Arc::new(Semaphore::new(10));
        let mut handles = Vec::new();

        for (clip_idx, clip) in clips.into_iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }

            let project_id_inner = project_id_clone.clone();
            let app_inner = app_clone.clone();
            let state_inner = state_clone.clone();
            let semaphore_inner = semaphore.clone();
            let job_id_inner = job_id_clone.clone();
            let cache_dir_clone = state_inner.cache_dir.clone();
            let cancel_flag_clone = cancel_flag.clone();

            let handle = tokio::spawn(async move {
                let is_image = thumbnail::is_image_file(&clip.file_path);

                if clip.status == "fail" || (!is_image && clip.duration_ms == 0) {
                    let _ = app_inner.emit(
                        "thumbnail-progress",
                        ThumbnailProgress {
                            project_id: project_id_inner,
                            clip_id: clip.id.clone(),
                            clip_index: clip_idx,
                            total_clips,
                            status: "skipped".to_string(),
                            thumbnails: vec![],
                        },
                    );
                    return;
                }

                let _permit = semaphore_inner.acquire_owned().await.ok();

                let jump_intervals = vec![1, 2, 5, 10, 20, 30, 60];
                let _ = state_inner.db.delete_thumbnails_for_clip(&clip.id);
                let mut thumb_results: Vec<Thumbnail> = Vec::new();

                if is_image {
                    // For images: generate a single thumbnail per jump interval
                    // (same image, just stored under each jump dir so the UI works)
                    for jump_seconds in jump_intervals {
                        let clip_cache_dir = format!(
                            "{}/thumbnails/{}/jump_{}",
                            cache_dir_clone, clip.id, jump_seconds
                        );
                        std::fs::create_dir_all(&clip_cache_dir).ok();
                        let output_path = format!("{}/thumb_0.jpg", clip_cache_dir);

                        if Path::new(&output_path).exists() {
                            let thumb = Thumbnail {
                                clip_id: clip.id.clone(),
                                jump_seconds,
                                index: 0,
                                timestamp_ms: 0,
                                file_path: output_path.clone(),
                            };
                            let _ = state_inner.db.upsert_thumbnail(&thumb);
                            thumb_results.push(thumb);
                            continue;
                        }

                        let file_path = clip.file_path.clone();
                        let output_path_clone = output_path.clone();
                        let result = tokio::task::spawn_blocking(move || {
                            thumbnail::extract_image_thumbnail(&file_path, &output_path_clone)
                        })
                        .await;

                        match result {
                            Ok(Ok(_)) => {
                                let thumb = Thumbnail {
                                    clip_id: clip.id.clone(),
                                    jump_seconds,
                                    index: 0,
                                    timestamp_ms: 0,
                                    file_path: output_path,
                                };
                                let _ = state_inner.db.upsert_thumbnail(&thumb);
                                thumb_results.push(thumb);
                            }
                            Ok(Err(e)) => {
                                eprintln!(
                                    "Image thumbnail extraction failed for clip {}: {}",
                                    clip.file_path, e
                                );
                            }
                            Err(e) => {
                                eprintln!(
                                    "Image thumbnail task panicked for clip {}: {}",
                                    clip.file_path, e
                                );
                            }
                        }
                    }
                } else {
                    // Video path: original logic
                    for jump_seconds in jump_intervals {
                        let timestamps =
                            thumbnail::calculate_jump_timestamps(clip.duration_ms, jump_seconds);
                        let clip_cache_dir = format!(
                            "{}/thumbnails/{}/jump_{}",
                            cache_dir_clone, clip.id, jump_seconds
                        );
                        std::fs::create_dir_all(&clip_cache_dir).ok();

                        for (idx, &ts) in timestamps.iter().enumerate() {
                            let thumb_ext = if Path::new(&clip.file_path)
                                .extension()
                                .map(|e| e.to_string_lossy().eq_ignore_ascii_case("braw"))
                                .unwrap_or(false)
                            {
                                "png"
                            } else {
                                "jpg"
                            };
                            let output_path =
                                format!("{}/thumb_{}.{}", clip_cache_dir, idx, thumb_ext);

                            if Path::new(&output_path).exists() {
                                let thumb = Thumbnail {
                                    clip_id: clip.id.clone(),
                                    jump_seconds,
                                    index: idx as u32,
                                    timestamp_ms: ts,
                                    file_path: output_path.clone(),
                                };
                                let _ = state_inner.db.upsert_thumbnail(&thumb);
                                thumb_results.push(thumb);
                                continue;
                            }

                            let file_path = clip.file_path.clone();
                            let output_path_clone = output_path.clone();
                            let duration_ms = clip.duration_ms;

                            let cancel_flag_inner = cancel_flag_clone.clone();
                            let result = tokio::task::spawn_blocking(move || {
                                thumbnail::extract_with_fallback(
                                    &file_path,
                                    &output_path_clone,
                                    ts,
                                    duration_ms,
                                    Some(&cancel_flag_inner),
                                )
                            })
                            .await;

                            match result {
                                Ok(Ok(actual_ts)) => {
                                    let thumb = Thumbnail {
                                        clip_id: clip.id.clone(),
                                        jump_seconds,
                                        index: idx as u32,
                                        timestamp_ms: actual_ts,
                                        file_path: output_path,
                                    };
                                    let _ = state_inner.db.upsert_thumbnail(&thumb);
                                    thumb_results.push(thumb);
                                }
                                Ok(Err(e)) => {
                                    eprintln!(
                                        "Thumbnail extraction failed for clip {}: {}",
                                        clip.file_path, e
                                    );
                                }
                                Err(e) => {
                                    eprintln!(
                                        "Thumbnail extraction task panicked for clip {}: {}",
                                        clip.file_path, e
                                    );
                                }
                            }
                        }
                    }
                }

                let _ = app_inner.emit(
                    "thumbnail-progress",
                    ThumbnailProgress {
                        project_id: project_id_inner,
                        clip_id: clip.id.clone(),
                        clip_index: clip_idx,
                        total_clips,
                        status: "done".to_string(),
                        thumbnails: thumb_results,
                    },
                );

                state_inner.job_manager.update_progress(
                    &job_id_inner,
                    (clip_idx + 1) as f32 / total_clips.max(1) as f32,
                    Some(format!("Processed {}/{} clips", clip_idx + 1, total_clips)),
                );
                emit_job_state(&app_inner, &state_inner.job_manager, &job_id_inner);
            });

            handles.push(handle);
        }

        for handle in handles {
            let _ = handle.await;
        }

        let _ = app_clone.emit(
            "thumbnail-complete",
            serde_json::json!({
                "project_id": project_id_clone,
                "clip_id": clip_id,
            }),
        );

        if !crate::jobs::JobManager::is_cancelled(&cancel_flag) {
            state_clone
                .job_manager
                .mark_done(&job_id_clone, "Thumbnail extraction complete");
        }
        emit_job_state(&app_clone, &state_clone.job_manager, &job_id_clone);
        state_clone.perf_log.end(&perf_id, "ok", None);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn get_project(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<Project>, String> {
    state
        .db
        .get_project(&project_id)
        .map_err(|e| format!("Failed to get project: {}", e))
}

#[tauri::command]
pub async fn read_thumbnail(path: String) -> Result<String, String> {
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Failed to read thumbnail at {}: {}", path, e))?;
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub async fn generate_frame_preview_image_proxy(
    path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Failed to read media metadata: {}", e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let signature = format!("{}::{}::{}", path, metadata.len(), modified);
    let mut hasher = Sha256::new();
    hasher.update(signature.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let target_dir = Path::new(&state.cache_dir)
        .join("frame_preview")
        .join("stills");
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create frame preview cache dir: {}", e))?;

    let output_path = target_dir.join(format!("{}.jpg", hash));
    if !output_path.exists() {
        crate::thumbnail::extract_image_thumbnail(&path, &output_path.to_string_lossy())?;
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn read_audio_preview(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read audio preview at {}: {}", path, e))?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "aif" | "aiff" => "audio/aiff",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    };
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub async fn save_image_data_url(path: String, data_url: String) -> Result<(), String> {
    let payload = data_url
        .split_once(',')
        .map(|(_, content)| content)
        .ok_or("Invalid image payload")?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, payload)
        .map_err(|e| format!("Invalid base64 payload: {}", e))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write image: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_brand_profile(project_path: String) -> Result<serde_json::Value, String> {
    let brand_path = format!("{}/brand/profile.json", project_path);
    let fallback_path = std::path::Path::new(&project_path)
        .parent()
        .map(|p| format!("{}/brand/profile.json", p.display()))
        .unwrap_or_default();

    let profile_path = if std::path::Path::new(&brand_path).exists() {
        brand_path
    } else if std::path::Path::new(&fallback_path).exists() {
        fallback_path
    } else {
        return Ok(default_brand_profile());
    };

    let content = std::fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read brand profile: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse brand profile: {}", e))
}

#[tauri::command]
pub async fn read_brand_logo(project_path: String) -> Result<Option<String>, String> {
    let logo_path = format!("{}/brand/logo.svg", project_path);
    if std::path::Path::new(&logo_path).exists() {
        let content = std::fs::read_to_string(&logo_path)
            .map_err(|e| format!("Failed to read logo: {}", e))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn save_brand_profile(
    project_path: String,
    profile: serde_json::Value,
) -> Result<(), String> {
    let brand_dir = format!("{}/brand", project_path);
    std::fs::create_dir_all(&brand_dir)
        .map_err(|e| format!("Failed to create brand directory: {}", e))?;

    let profile_path = format!("{}/profile.json", brand_dir);
    let content = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Failed to serialize brand profile: {}", e))?;

    std::fs::write(&profile_path, content)
        .map_err(|e| format!("Failed to write brand profile: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn save_brand_logo(project_path: String, _content: String) -> Result<(), String> {
    let brand_dir = format!("{}/brand", project_path);
    std::fs::create_dir_all(&brand_dir)
        .map_err(|e| format!("Failed to create brand directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_job(
    job_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<JobInfo>, String> {
    Ok(state.job_manager.get_job(&job_id))
}

#[tauri::command]
pub async fn list_jobs(state: State<'_, Arc<AppState>>) -> Result<Vec<JobInfo>, String> {
    Ok(state.job_manager.list_jobs())
}

#[tauri::command]
pub async fn cancel_job(
    job_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let cancelled = state.job_manager.cancel_job(&job_id);
    if cancelled {
        emit_job_state(&app, &state.job_manager, &job_id);
    }
    Ok(cancelled)
}

#[tauri::command]
pub async fn start_verification(
    project_id: Option<String>,
    source_root: String,
    source_label: Option<String>,
    dest_root: String,
    dest_label: Option<String>,
    mode: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let perf_id = state.perf_log.start(
        "start_verification",
        Some(format!("{} -> {}", source_root, dest_root)),
    );
    let app_state = state.inner().clone();
    let (job_id, cancel_flag) = app_state.job_manager.create_job("verification", None);
    app_state
        .job_manager
        .mark_running(&job_id, "Verification started");
    emit_job_state(&app, &app_state.job_manager, &job_id);

    let db = Arc::new(app_state.db.clone());
    let app_clone = app.clone();
    let job_id_clone = job_id.clone();
    let app_state_for_task = app_state.clone();
    tokio::spawn(async move {
        let result = verification::run_verification(
            app_clone.clone(),
            db,
            job_id_clone.clone(),
            project_id.unwrap_or_else(|| "__global__".to_string()),
            source_root,
            source_label.unwrap_or_else(|| "Source".to_string()),
            dest_root,
            dest_label.unwrap_or_else(|| "Destination".to_string()),
            mode,
            cancel_flag.clone(),
        )
        .await;

        if crate::jobs::JobManager::is_cancelled(&cancel_flag) {
            app_state_for_task.job_manager.update_progress(
                &job_id_clone,
                1.0,
                Some("Cancelled".to_string()),
            );
            let _ = app_state_for_task.job_manager.cancel_job(&job_id_clone);
        } else if let Err(err) = result {
            eprintln!("verification job failed: {}", err);
            app_state_for_task
                .job_manager
                .mark_failed(&job_id_clone, &err);
        } else {
            app_state_for_task
                .job_manager
                .mark_done(&job_id_clone, "Verification complete");
        }
        emit_job_state(&app_clone, &app_state_for_task.job_manager, &job_id_clone);
    });

    state
        .perf_log
        .end(&perf_id, "ok", Some(format!("job_id={}", job_id)));
    Ok(job_id)
}

#[tauri::command]
pub async fn get_verification_job(
    job_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<VerificationJob>, String> {
    state
        .db
        .get_verification_job(&job_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_verification_items(
    job_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<VerificationItem>, String> {
    state
        .db
        .get_verification_items(&job_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_verification_queue(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<VerificationQueueItemView>, String> {
    let items = state
        .db
        .list_verification_queue(&project_id)
        .map_err(|e| e.to_string())?;
    let out = items
        .into_iter()
        .map(|item| {
            let job = item
                .last_job_id
                .as_ref()
                .and_then(|job_id| state.db.get_verification_job(job_id).ok().flatten());
            VerificationQueueItemView {
                id: item.id,
                project_id: item.project_id,
                idx: item.idx,
                label: item.label,
                source_path: item.source_path,
                dest_path: item.dest_path,
                last_job_id: item.last_job_id,
                status: job
                    .as_ref()
                    .map(|j| j.status.to_ascii_lowercase())
                    .unwrap_or_else(|| "queued".to_string()),
                mode: job.as_ref().map(|j| j.mode.clone()),
                duration_ms: job.as_ref().and_then(|j| j.duration_ms),
                counts_json: job.as_ref().and_then(|j| j.counts_json.clone()),
                created_at: item.created_at,
                updated_at: item.updated_at,
            }
        })
        .collect();
    Ok(out)
}

#[tauri::command]
pub async fn set_verification_queue_item(
    project_id: String,
    idx: i32,
    source_path: String,
    dest_path: String,
    label: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<VerificationQueueItem, String> {
    if idx < 1 || idx > 5 {
        return Err("Queue index must be between 1 and 5".into());
    }
    state
        .db
        .upsert_verification_queue_item(
            &project_id,
            idx,
            &source_path,
            &dest_path,
            label.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_verification_queue_item(
    project_id: String,
    idx: i32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .remove_verification_queue_item(&project_id, idx)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_verification_queue(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .clear_verification_queue(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_verification_queue(
    project_id: String,
    mode: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<QueueRunStartResult, String> {
    let mode_upper = mode.to_ascii_uppercase();
    if mode_upper != "FAST" && mode_upper != "SOLID" {
        return Err("Mode must be FAST or SOLID".into());
    }
    let items = state
        .db
        .list_verification_queue(&project_id)
        .map_err(|e| e.to_string())?;
    if items.is_empty() {
        return Err("Queue is empty".into());
    }
    let queue_run_id = format!("queue-{}", uuid::Uuid::new_v4());
    let child_job_ids: Vec<String> = items
        .iter()
        .map(|item| format!("{}-{:02}", queue_run_id, item.idx))
        .collect();

    let app_state = state.inner().clone();
    let (queue_job_id, queue_cancel) = app_state
        .job_manager
        .create_job("verification_queue", Some(queue_run_id.clone()));
    app_state
        .job_manager
        .mark_running(&queue_job_id, "Verification queue started");
    emit_job_state(&app, &app_state.job_manager, &queue_job_id);

    let app_clone = app.clone();
    tokio::spawn(async move {
        let total = items.len().max(1);
        let mut completed = 0usize;
        let mut failed_count = 0usize;
        let mut cancelled = false;

        for (n, item) in items.iter().enumerate() {
            if crate::jobs::JobManager::is_cancelled(&queue_cancel) {
                cancelled = true;
                for pending in items.iter().skip(n) {
                    let cancelled_job_id = format!("{}-{:02}", queue_job_id, pending.idx);
                    let _ = upsert_cancelled_verification_job(
                        &app_state.db,
                        &project_id,
                        &cancelled_job_id,
                        pending,
                        &mode_upper,
                    );
                    let _ =
                        app_state
                            .db
                            .attach_queue_job(&project_id, pending.idx, &cancelled_job_id);
                }
                break;
            }

            let child_job_id = format!("{}-{:02}", queue_job_id, item.idx);
            let _ = app_state
                .db
                .attach_queue_job(&project_id, item.idx, &child_job_id);
            let (source_label, dest_label) = derive_labels(item.label.clone(), item.idx);
            let (created_id, child_cancel) = app_state
                .job_manager
                .create_job("verification", Some(child_job_id.clone()));
            app_state
                .job_manager
                .mark_running(&created_id, &format!("Queue check {:02} started", item.idx));
            emit_job_state(&app_clone, &app_state.job_manager, &created_id);

            let app_state_watch = app_state.clone();
            let queue_cancel_watch = queue_cancel.clone();
            let child_job_id_watch = child_job_id.clone();
            let child_cancel_watch = child_cancel.clone();
            let watcher = tokio::spawn(async move {
                loop {
                    if crate::jobs::JobManager::is_cancelled(&queue_cancel_watch) {
                        let _ = app_state_watch.job_manager.cancel_job(&child_job_id_watch);
                        break;
                    }
                    if crate::jobs::JobManager::is_cancelled(&child_cancel_watch) {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            });

            let result = verification::run_verification(
                app_clone.clone(),
                Arc::new(app_state.db.clone()),
                child_job_id.clone(),
                project_id.clone(),
                item.source_path.clone(),
                source_label,
                item.dest_path.clone(),
                dest_label,
                mode_upper.clone(),
                child_cancel.clone(),
            )
            .await;
            watcher.abort();

            if crate::jobs::JobManager::is_cancelled(&child_cancel) {
                let _ = app_state.job_manager.cancel_job(&child_job_id);
            } else if let Err(err) = result {
                failed_count += 1;
                app_state.job_manager.mark_failed(&child_job_id, &err);
            } else {
                let status = app_state
                    .db
                    .get_verification_job(&child_job_id)
                    .ok()
                    .flatten()
                    .map(|j| j.status)
                    .unwrap_or_else(|| "FAILED".to_string());
                if status == "DONE" {
                    app_state
                        .job_manager
                        .mark_done(&child_job_id, "Verification complete");
                } else if status == "CANCELLED" {
                    let _ = app_state.job_manager.cancel_job(&child_job_id);
                } else {
                    failed_count += 1;
                    app_state
                        .job_manager
                        .mark_failed(&child_job_id, "Verification failed");
                }
            }
            emit_job_state(&app_clone, &app_state.job_manager, &child_job_id);

            completed += 1;
            app_state.job_manager.update_progress(
                &queue_job_id,
                completed as f32 / total as f32,
                Some(format!("Completed {}/{} checks", completed, total)),
            );
            emit_job_state(&app_clone, &app_state.job_manager, &queue_job_id);
        }

        if cancelled {
            let _ = app_state.job_manager.cancel_job(&queue_job_id);
            emit_job_state(&app_clone, &app_state.job_manager, &queue_job_id);
            return;
        }
        if failed_count > 0 {
            app_state.job_manager.mark_done(
                &queue_job_id,
                &format!("Queue complete with {} failure(s)", failed_count),
            );
        } else {
            app_state
                .job_manager
                .mark_done(&queue_job_id, "Queue verification complete");
        }
        emit_job_state(&app_clone, &app_state.job_manager, &queue_job_id);
    });

    Ok(QueueRunStartResult {
        queue_run_id,
        job_ids: child_job_ids,
    })
}

#[tauri::command]
pub async fn list_verification_jobs_for_project(
    project_id: String,
    limit: Option<i64>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<VerificationJob>, String> {
    state
        .db
        .list_verification_jobs_for_project(&project_id, limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_verification_report_markdown(
    job_id: String,
    out_dir: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let job = state
        .db
        .get_verification_job(&job_id)
        .map_err(|e| e.to_string())?
        .ok_or("Job not found")?;
    let items = state
        .db
        .get_verification_items(&job_id)
        .map_err(|e| e.to_string())?;

    let project = state
        .db
        .get_project(&job.project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;
    let _brand_name = match load_brand_profile(project.root_path.clone()).await {
        Ok(profile) => profile["name"]
            .as_str()
            .unwrap_or("Wrap Preview")
            .to_string(),
        Err(_) => "Wrap Preview".to_string(),
    };

    let mut md = String::new();
    md.push_str("# Wrap Preview Verification Report\n\n");
    md.push_str(&format!(
        "- App: Wrap Preview v{}\n",
        env!("CARGO_PKG_VERSION")
    ));
    md.push_str(&format!("- Date: {}\n", chrono::Utc::now().to_rfc3339()));
    md.push_str(&format!(
        "- Source: {} ({})\n",
        job.source_label, job.source_root
    ));
    md.push_str(&format!(
        "- Destination: {} ({})\n",
        job.dest_label, job.dest_root
    ));
    md.push_str(&format!("- Mode: {}\n\n", job.mode));
    md.push_str("## Summary\n\n");
    md.push_str(&format!("- Verified: {}\n", job.verified_ok_count));
    md.push_str(&format!("- Missing: {}\n", job.missing_count));
    md.push_str(&format!("- Size Mismatch: {}\n", job.size_mismatch_count));
    md.push_str(&format!("- Hash Mismatch: {}\n", job.hash_mismatch_count));
    md.push_str(&format!("- Unreadable: {}\n", job.unreadable_count));
    md.push_str(&format!(
        "- Extra in Destination: {}\n\n",
        job.extra_in_dest_count
    ));

    md.push_str("## Top Issues\n\n");
    let issues: Vec<_> = items.iter().filter(|i| i.status != "OK").collect();
    for item in issues.iter().take(100) {
        md.push_str(&format!(
            "- [{}] `{}` {}\n",
            item.status,
            item.rel_path,
            item.error_message.clone().unwrap_or_default()
        ));
    }
    if issues.len() > 100 {
        md.push_str(&format!("\n- ... and {} more issues\n", issues.len() - 100));
    }
    md.push_str("\nGenerated by Wrap Preview");
    md.push_str(&format!(
        " (v{}) — an offline, professional media control tool for creatives.\n\n",
        env!("CARGO_PKG_VERSION")
    ));
    md.push_str("© Alan Alves. All rights reserved.\n");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let path = collision_safe_path(
        &out_dir,
        &format!(
            "Verification_Report_{}",
            sanitize_filename(&job.source_label)
        ),
        "md",
    );
    std::fs::write(&path, md).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path }))
}

#[tauri::command]
pub async fn export_verification_report_pdf(
    job_id: String,
    out_dir: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    // DEPRECATED: UI uses the frontend jsPDF export path for deterministic branding/logo handling.
    let job = state
        .db
        .get_verification_job(&job_id)
        .map_err(|e| e.to_string())?
        .ok_or("Job not found")?;
    let items = state
        .db
        .get_verification_items(&job_id)
        .map_err(|e| e.to_string())?;

    let project = state
        .db
        .get_project(&job.project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;
    let brand_name = match load_brand_profile(project.root_path.clone()).await {
        Ok(profile) => profile["name"]
            .as_str()
            .unwrap_or("Wrap Preview")
            .to_string(),
        Err(_) => "Wrap Preview".to_string(),
    };

    use printpdf::{BuiltinFont, Mm, PdfDocument};
    let (doc, page1, layer1) = PdfDocument::new(
        format!("{} - Verification Report", brand_name),
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let mut layer = doc.get_page(page1).get_layer(layer1);
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;

    let mut y: f32 = 285.0;
    let line = |text: String,
                y_mm: &mut f32,
                layer: &printpdf::PdfLayerReference,
                font: &printpdf::IndirectFontRef| {
        layer.use_text(text, 10.0, Mm(10.0), Mm(*y_mm), font);
        *y_mm -= 5.0;
    };

    let created = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S UTC")
        .to_string();
    line("Wrap Preview".to_string(), &mut y, &layer, &font);
    line("Verification Report".to_string(), &mut y, &layer, &font);
    line(format!("Date created: {}", created), &mut y, &layer, &font);
    line(
        format!("App: Wrap Preview v{}", env!("CARGO_PKG_VERSION")),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!(
            "Generated by Wrap Preview (v{}) — an offline, professional media control tool for creatives.",
            env!("CARGO_PKG_VERSION")
        ),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Source: {} ({})", job.source_label, job.source_root),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Destination: {} ({})", job.dest_label, job.dest_root),
        &mut y,
        &layer,
        &font,
    );
    line(format!("Mode: {}", job.mode), &mut y, &layer, &font);
    y -= 3.0;
    line(
        format!("Verified: {}", job.verified_ok_count),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Missing: {}", job.missing_count),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Size mismatch: {}", job.size_mismatch_count),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Hash mismatch: {}", job.hash_mismatch_count),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Unreadable: {}", job.unreadable_count),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!("Extra in destination: {}", job.extra_in_dest_count),
        &mut y,
        &layer,
        &font,
    );
    y -= 3.0;
    line("Top issues:".to_string(), &mut y, &layer, &font);
    for item in items.iter().filter(|i| i.status != "OK").take(60) {
        if y < 12.0 {
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            layer = doc.get_page(new_page).get_layer(new_layer);
            y = 285.0;
            line(
                format!("{} - Verification Report (Cont.)", brand_name),
                &mut y,
                &layer,
                &font,
            );
            y -= 10.0;
        }
        line(
            format!("[{}] {}", item.status, item.rel_path),
            &mut y,
            &layer,
            &font,
        );
    }
    if y < 12.0 {
        let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
        layer = doc.get_page(new_page).get_layer(new_layer);
    }
    layer.use_text(
        "© Alan Alves. All rights reserved.".to_string(),
        9.0,
        Mm(10.0),
        Mm(8.0),
        &font,
    );

    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let path = collision_safe_path(
        &out_dir,
        &format!(
            "Verification_Report_{}",
            sanitize_filename(&job.source_label)
        ),
        "pdf",
    );
    let mut writer =
        std::io::BufWriter::new(std::fs::File::create(&path).map_err(|e| e.to_string())?);
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path }))
}

#[tauri::command]
pub async fn export_verification_queue_report_markdown(
    project_id: String,
    out_dir: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let queue_items = state
        .db
        .list_verification_queue(&project_id)
        .map_err(|e| e.to_string())?;
    if queue_items.is_empty() {
        return Err("No verification jobs provided".into());
    }
    let project = state
        .db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;
    let _brand_name = match load_brand_profile(project.root_path.clone()).await {
        Ok(profile) => profile["name"]
            .as_str()
            .unwrap_or("Wrap Preview")
            .to_string(),
        Err(_) => "Wrap Preview".to_string(),
    };

    let queue_with_jobs: Vec<(VerificationQueueItem, VerificationJob)> = queue_items
        .into_iter()
        .filter_map(|item| {
            let job = item
                .last_job_id
                .as_ref()
                .and_then(|job_id| state.db.get_verification_job(job_id).ok().flatten());
            job.map(|j| (item, j))
        })
        .collect();
    if queue_with_jobs.is_empty() {
        return Err("Queue has no completed checks with job data.".into());
    }
    let mut md = String::new();
    md.push_str("# Wrap Preview — Safe Copy Verification Queue\n\n");
    md.push_str(&format!(
        "- App: Wrap Preview v{}\n",
        env!("CARGO_PKG_VERSION")
    ));
    md.push_str(&format!(
        "- Date: {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S %Z")
    ));
    md.push_str(&format!(
        "- Smart Copy: This report was created with Wrap Preview v{} — a professional offline tool for creatives to verify, review, and prepare footage for post-production.\n",
        env!("CARGO_PKG_VERSION")
    ));
    md.push_str(&format!("- Checks: {}\n\n", queue_with_jobs.len()));

    let mut totals = (0u32, 0u32, 0u32, 0u32, 0u32, 0u32);
    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut cancelled = 0u32;
    for (item, job) in &queue_with_jobs {
        totals.0 += job.verified_ok_count;
        totals.1 += job.missing_count;
        totals.2 += job.size_mismatch_count;
        totals.3 += job.hash_mismatch_count;
        totals.4 += job.unreadable_count;
        totals.5 += job.extra_in_dest_count;
        match job.status.as_str() {
            "DONE" => passed += 1,
            "CANCELLED" => cancelled += 1,
            _ => failed += 1,
        }
        md.push_str(&format!(
            "## Check {:02} — {}\n\n",
            item.idx,
            item.label
                .clone()
                .unwrap_or_else(|| format!("{} → {}", job.source_label, job.dest_label))
        ));
        md.push_str(&format!(
            "- Source: {} ({})\n",
            job.source_label, job.source_root
        ));
        md.push_str(&format!(
            "- Destination: {} ({})\n",
            job.dest_label, job.dest_root
        ));
        md.push_str(&format!("- Mode: {}\n", job.mode));
        md.push_str(&format!("- Status: {}\n", job.status));
        md.push_str(&format!(
            "- Duration (ms): {}\n",
            job.duration_ms.unwrap_or(0)
        ));
        md.push_str(&format!(
            "- Summary: Verified {} | Missing {} | Size {} | Hash {} | Unreadable {} | Extra {}\n\n",
            job.verified_ok_count,
            job.missing_count,
            job.size_mismatch_count,
            job.hash_mismatch_count,
            job.unreadable_count,
            job.extra_in_dest_count
        ));

        let items = state
            .db
            .get_verification_items(&job.id)
            .map_err(|e| e.to_string())?;
        let issues: Vec<_> = items.iter().filter(|i| i.status != "OK").collect();
        for issue in issues.iter().take(20) {
            md.push_str(&format!(
                "- [{}] `{}` {}\n",
                issue.status,
                issue.rel_path,
                issue.error_message.clone().unwrap_or_default()
            ));
        }
        if issues.len() > 20 {
            md.push_str(&format!("- ... and {} more\n", issues.len() - 20));
        }
        md.push_str("\n");
    }

    md.push_str("## Queue Totals\n\n");
    md.push_str(&format!("- Passed: {}\n", passed));
    md.push_str(&format!("- Failed: {}\n", failed));
    md.push_str(&format!("- Cancelled: {}\n", cancelled));
    md.push_str(&format!("- Verified: {}\n", totals.0));
    md.push_str(&format!("- Missing: {}\n", totals.1));
    md.push_str(&format!("- Size Mismatch: {}\n", totals.2));
    md.push_str(&format!("- Hash Mismatch: {}\n", totals.3));
    md.push_str(&format!("- Unreadable: {}\n", totals.4));
    md.push_str(&format!("- Extra in Destination: {}\n\n", totals.5));
    md.push_str("© Alan Alves. All rights reserved.\n");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let path = collision_safe_path(
        &out_dir,
        &format!("SafeCopy_Queue_Report_{}", sanitize_filename(&project.name)),
        "md",
    );
    std::fs::write(&path, md).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path }))
}

#[tauri::command]
pub async fn export_verification_queue_report_pdf(
    project_id: String,
    out_dir: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    // DEPRECATED: UI uses the frontend jsPDF export path for deterministic branding/logo handling.
    let queue_items = state
        .db
        .list_verification_queue(&project_id)
        .map_err(|e| e.to_string())?;
    if queue_items.is_empty() {
        return Err("No verification jobs provided".into());
    }
    let queue_with_jobs: Vec<(VerificationQueueItem, VerificationJob)> = queue_items
        .into_iter()
        .filter_map(|item| {
            let job = item
                .last_job_id
                .as_ref()
                .and_then(|job_id| state.db.get_verification_job(job_id).ok().flatten());
            job.map(|j| (item, j))
        })
        .collect();
    if queue_with_jobs.is_empty() {
        return Err("Queue has no completed checks with job data.".into());
    }
    let project = state
        .db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;
    let brand_name = match load_brand_profile(project.root_path.clone()).await {
        Ok(profile) => profile["name"]
            .as_str()
            .unwrap_or("Wrap Preview")
            .to_string(),
        Err(_) => "Wrap Preview".to_string(),
    };

    use printpdf::{BuiltinFont, Mm, PdfDocument};
    let (doc, page1, layer1) = PdfDocument::new(
        format!("{} - Verification Report", brand_name),
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let mut layer = doc.get_page(page1).get_layer(layer1);
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;
    let mut y: f32 = 285.0;
    let line = |text: String,
                y_mm: &mut f32,
                layer: &printpdf::PdfLayerReference,
                font: &printpdf::IndirectFontRef| {
        if *y_mm > 10.0 {
            layer.use_text(text, 10.0, Mm(10.0), Mm(*y_mm), font);
            *y_mm -= 5.0;
        }
    };
    let created = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S UTC")
        .to_string();
    line("Wrap Preview".to_string(), &mut y, &layer, &font);
    line(
        "Verification Queue Report".to_string(),
        &mut y,
        &layer,
        &font,
    );
    line(format!("Date created: {}", created), &mut y, &layer, &font);
    line(
        format!("App: Wrap Preview v{}", env!("CARGO_PKG_VERSION")),
        &mut y,
        &layer,
        &font,
    );
    line(
        format!(
            "Generated by Wrap Preview (v{}) — an offline, professional media control tool for creatives.",
            env!("CARGO_PKG_VERSION")
        ),
        &mut y,
        &layer,
        &font,
    );
    y -= 4.0;
    for (item, job) in &queue_with_jobs {
        if y < 35.0 {
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            layer = doc.get_page(new_page).get_layer(new_layer);
            y = 285.0;
            line(
                format!("{} - Verification Queue Report (Cont.)", brand_name),
                &mut y,
                &layer,
                &font,
            );
            y -= 10.0;
        }
        line(
            format!(
                "Check {:02}: {}",
                item.idx,
                item.label
                    .clone()
                    .unwrap_or_else(|| format!("{} -> {}", job.source_label, job.dest_label))
            ),
            &mut y,
            &layer,
            &font,
        );
        line(
            format!("  Source: {}", job.source_root),
            &mut y,
            &layer,
            &font,
        );
        line(
            format!("  Destination: {}", job.dest_root),
            &mut y,
            &layer,
            &font,
        );
        line(
            format!(
                "  Status: {} | Mode: {} | Duration(ms): {}",
                job.status,
                job.mode,
                job.duration_ms.unwrap_or(0)
            ),
            &mut y,
            &layer,
            &font,
        );
        line(
            format!(
                "  Verified {} | Missing {} | Size {} | Hash {} | Unreadable {} | Extra {}",
                job.verified_ok_count,
                job.missing_count,
                job.size_mismatch_count,
                job.hash_mismatch_count,
                job.unreadable_count,
                job.extra_in_dest_count
            ),
            &mut y,
            &layer,
            &font,
        );
    }
    if y < 12.0 {
        let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
        layer = doc.get_page(new_page).get_layer(new_layer);
    }
    layer.use_text(
        "© Alan Alves. All rights reserved.".to_string(),
        9.0,
        Mm(10.0),
        Mm(8.0),
        &font,
    );
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let path = collision_safe_path(
        &out_dir,
        &format!("SafeCopy_Queue_Report_{}", sanitize_filename(&project.name)),
        "pdf",
    );
    let mut writer =
        std::io::BufWriter::new(std::fs::File::create(&path).map_err(|e| e.to_string())?);
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path }))
}

#[tauri::command]
pub async fn extract_audio_waveform(
    clip_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<u8>, String> {
    let perf_id = state
        .perf_log
        .start("extract_audio_waveform", Some(clip_id.clone()));
    let (job_id, _cancel_flag) = state
        .job_manager
        .create_job("waveform", Some(format!("waveform-{}", clip_id)));
    state
        .job_manager
        .mark_running(&job_id, "Waveform extraction started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let result: Result<Vec<u8>, String> = (|| {
        let db = &state.db;
        let clip = db
            .get_clips_by_ids(&[clip_id.clone()])
            .map_err(|e| e.to_string())?
            .into_iter()
            .next()
            .ok_or("Clip not found")?;

        if let Some(env) = clip.audio_envelope {
            return Ok(env);
        }

        let result = audio::extract_envelope(&clip.file_path, 150)?;

        db.update_audio_envelope(&clip_id, &result.envelope)
            .map_err(|e| format!("Failed to save audio envelope: {}", e))?;

        Ok(result.envelope)
    })();

    match result {
        Ok(envelope) => {
            state
                .job_manager
                .mark_done(&job_id, "Waveform extraction complete");
            emit_job_state(&app, &state.job_manager, &job_id);
            state.perf_log.end(&perf_id, "ok", None);
            Ok(envelope)
        }
        Err(error) => {
            state.job_manager.mark_failed(&job_id, &error);
            emit_job_state(&app, &state.job_manager, &job_id);
            state.perf_log.end(&perf_id, "err", Some(error.clone()));
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn generate_lut_thumbnails(
    project_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let db = &state.db;

    let settings = db
        .get_project_settings(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No LUT settings found for project".to_string())?;

    let settings_val: serde_json::Value =
        serde_json::from_str(&settings.settings_json).map_err(|e| e.to_string())?;

    let lut_path = settings_val["lut_path"].as_str().unwrap_or("");
    let lut_hash = settings_val["lut_hash"].as_str().unwrap_or("");

    if lut_path.is_empty() || lut_hash.is_empty() {
        return Err("Invalid LUT settings".to_string());
    }

    let lut_content = std::fs::read_to_string(lut_path).map_err(|e| e.to_string())?;
    let lut = crate::lut::Lut3D::parse_cube(&lut_content).map_err(|e| e.to_string())?;

    let _perf_id = state
        .perf_log
        .start("generate_lut_thumbnails", Some(project_id.clone()));
    let cache_dir = state.cache_dir.clone();
    let (job_id, cancel_flag) = state.job_manager.create_job("lut_thumbnails", None);
    state
        .job_manager
        .mark_running(&job_id, "Applying LUT to thumbnails");
    emit_job_state(&app, &state.job_manager, &job_id);

    let clips = db
        .get_clips(&project_id)
        .map_err(|e| format!("Failed to get clips: {}", e))?;

    let total_clips = clips.len();
    let semaphore = Arc::new(Semaphore::new(3)); // 3 concurrent jobs

    for (clip_idx, clip) in clips.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = state.job_manager.cancel_job(&job_id);
            emit_job_state(&app, &state.job_manager, &job_id);
            break;
        }

        // Skip clips without LUT enabled unless we want to cache all of them.
        // Caching all makes sense so if they toggle it later, it's instant.

        let thumbnails = db.get_thumbnails(&clip.id).unwrap_or_default();
        if thumbnails.is_empty() {
            let _ = app.emit(
                "lut-thumbnail-progress",
                ThumbnailProgress {
                    project_id: project_id.clone(),
                    clip_id: clip.id.clone(),
                    clip_index: clip_idx,
                    total_clips,
                    status: "skipped".to_string(),
                    thumbnails: vec![],
                },
            );
            continue;
        }

        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;

        let mut processed_thumbs = Vec::new();

        for thumb in &thumbnails {
            let original_name = Path::new(&thumb.file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("thumb.jpg");
            let output_dir = Path::new(&thumb.file_path)
                .parent()
                .map(|parent| parent.to_path_buf())
                .unwrap_or_else(|| Path::new(&cache_dir).join(&clip.id));
            if let Err(e) = std::fs::create_dir_all(&output_dir) {
                eprintln!("Failed to create LUT output dir: {}", e);
                continue;
            }
            let output_path = output_dir
                .join(format!("lut_{}_{}", lut_hash, original_name))
                .to_string_lossy()
                .to_string();

            if std::path::Path::new(&output_path).exists() {
                // already applied
                let mut new_thumb = thumb.clone();
                new_thumb.file_path = output_path;
                processed_thumbs.push(new_thumb);
                continue;
            }

            match crate::lut::apply_lut_to_image(&thumb.file_path, &lut, &output_path) {
                Ok(_) => {
                    let mut new_thumb = thumb.clone();
                    new_thumb.file_path = output_path;
                    processed_thumbs.push(new_thumb);
                }
                Err(err) => {
                    eprintln!("LUT processing failed for {}: {}", thumb.file_path, err);
                }
            }
        }

        let _ = app.emit(
            "lut-thumbnail-progress",
            ThumbnailProgress {
                project_id: project_id.clone(),
                clip_id: clip.id.clone(),
                clip_index: clip_idx,
                total_clips,
                status: "done".to_string(),
                thumbnails: processed_thumbs,
            },
        );
        drop(permit);
    }

    state
        .job_manager
        .mark_done(&job_id, "LUT thumbnails processing complete");
    emit_job_state(&app, &state.job_manager, &job_id);

    Ok(job_id)
}

#[tauri::command]
pub async fn update_clip_metadata(
    clip_id: String,
    rating: Option<i32>,
    flag: Option<String>,
    notes: Option<String>,
    shot_size: Option<String>,
    movement: Option<String>,
    manual_order: Option<i32>,
    lut_enabled: Option<i32>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    db.update_clip_metadata(
        &clip_id,
        rating,
        flag,
        notes,
        shot_size,
        movement,
        manual_order,
        lut_enabled,
    )
    .map_err(|e| format!("Failed to update clip metadata: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn export_to_fcpxml(
    project_id: String,
    scope: String, // "all", "picks", "rated", "rated_min", "selected_blocks"
    min_rating: Option<i32>,
    block_ids: Option<Vec<String>>,
    include_master_timeline: Option<bool>,
    output_path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let perf_id = state
        .perf_log
        .start("export_to_fcpxml", Some(project_id.clone()));
    let (job_id, _cancel_flag) = state.job_manager.create_job("resolve_export", None);
    state
        .job_manager
        .mark_running(&job_id, "Resolve export started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let db = &state.db;

    let filtered_clips = resolve_clips_for_scope(db, &project_id, &scope, min_rating, block_ids)?;

    if filtered_clips.is_empty() {
        return Err("No clips found matching the export criteria.".into());
    }

    // Get Project Info
    let project = db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    // Generate XML
    let include_master = include_master_timeline.unwrap_or(true);
    let xml_content = crate::export::generate_fcpxml_structured(
        &filtered_clips,
        &project.name,
        include_master,
        Some(&project.root_path),
    );

    // Write to file
    std::fs::write(&output_path, xml_content).map_err(|e| e.to_string())?;
    let _ = write_last_export_metadata(
        &state.cache_dir,
        serde_json::json!({
            "kind": "resolve_fcpxml",
            "project_id": project_id,
            "scope": scope,
            "min_rating": min_rating,
            "output_path": output_path,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }),
    );

    state
        .job_manager
        .mark_done(&job_id, "Resolve export complete");
    emit_job_state(&app, &state.job_manager, &job_id);
    state.perf_log.end(&perf_id, "ok", Some(output_path));
    Ok(())
}

#[tauri::command]
pub async fn build_scene_blocks(
    project_id: String,
    mode: Option<String>,
    gap_seconds: Option<i64>,
    overlap_window_seconds: Option<i64>,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SceneBlockWithClips>, String> {
    let perf_id = state
        .perf_log
        .start("build_scene_blocks", Some(project_id.clone()));
    let (job_id, cancel_flag) = state.job_manager.create_job("clustering", None);
    state
        .job_manager
        .mark_running(&job_id, "Block clustering started");
    emit_job_state(&app, &state.job_manager, &job_id);
    if cancel_flag.load(Ordering::Relaxed) {
        let _ = state.job_manager.cancel_job(&job_id);
        emit_job_state(&app, &state.job_manager, &job_id);
        return Ok(vec![]);
    }
    let db = &state.db;
    let clips = db.get_clips(&project_id).map_err(|e| e.to_string())?;
    if mode.as_deref().unwrap_or("time_gap") == "scene_change" {
        let threshold = (gap_seconds.unwrap_or(60).max(1) as f64) / 100.0;
        let analyzer_version = "scene-v1-lite";
        for clip in &clips {
            let cached = db
                .get_scene_detection_cache(&clip.id, threshold, analyzer_version)
                .map_err(|e| e.to_string())?;
            if cached.is_none() {
                let cuts = synthetic_cut_points(clip.duration_ms, threshold);
                let item = SceneDetectionCache {
                    clip_id: clip.id.clone(),
                    threshold,
                    analyzer_version: analyzer_version.to_string(),
                    cut_points_json: serde_json::to_string(&cuts).map_err(|e| e.to_string())?,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                };
                db.upsert_scene_detection_cache(&item)
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    let built = clustering::build_scene_blocks(
        &project_id,
        &clips,
        mode.as_deref().unwrap_or("time_gap"),
        gap_seconds.unwrap_or(60),
        overlap_window_seconds.unwrap_or(30),
    );
    db.replace_scene_blocks(&project_id, &built.blocks, &built.memberships)
        .map_err(|e| format!("Failed to persist scene blocks: {}", e))?;
    state
        .job_manager
        .mark_done(&job_id, "Block clustering complete");
    emit_job_state(&app, &state.job_manager, &job_id);
    let blocks = get_scene_blocks(project_id, state.clone()).await;
    state
        .perf_log
        .end(&perf_id, if blocks.is_ok() { "ok" } else { "error" }, None);
    blocks
}

#[tauri::command]
pub async fn clear_scene_detection_cache(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    state
        .db
        .clear_scene_detection_cache_for_project(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_scene_blocks(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SceneBlockWithClips>, String> {
    let db = &state.db;
    let blocks = db
        .get_scene_blocks(&project_id)
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for block in blocks {
        let clips = db
            .get_clips_for_block(&block.id)
            .map_err(|e| format!("Failed loading clips for block {}: {}", block.id, e))?;
        result.push(SceneBlockWithClips { block, clips });
    }
    Ok(result)
}

#[tauri::command]
pub async fn set_project_lut(
    project_id: String,
    lut_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    use crate::db::ProjectSettings;
    use crate::lut::Lut3D;
    use blake3;
    use serde_json::json;

    let content = std::fs::read_to_string(&lut_path)
        .map_err(|e| format!("Failed to read LUT file: {}", e))?;

    let _parsed = Lut3D::parse_cube(&content).map_err(|e| format!("Invalid LUT format: {}", e))?;

    let mut hasher = blake3::Hasher::new();
    hasher.update(content.as_bytes());
    let hash_hex = hasher.finalize().to_hex()[..16].to_string();

    let lut_name = std::path::Path::new(&lut_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown LUT".to_string());

    let settings = json!({
        "lut_path": lut_path,
        "lut_name": lut_name,
        "lut_hash": hash_hex,
        "lut_loaded_at": chrono::Utc::now().to_rfc3339(),
    });

    let project_settings = ProjectSettings {
        project_id,
        settings_json: settings.to_string(),
    };

    let db = &state.db;
    db.upsert_project_settings(&project_settings)
        .map_err(|e| format!("Failed to save project settings: {}", e))
}

#[tauri::command]
pub async fn remove_project_lut(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    use crate::db::ProjectSettings;
    let db = &state.db;
    let project_settings = ProjectSettings {
        project_id,
        settings_json: "{}".to_string(),
    };

    db.upsert_project_settings(&project_settings)
        .map_err(|e| format!("Failed to clear project settings: {}", e))
}

#[tauri::command]
pub async fn set_clip_lut_enabled(
    clip_id: String,
    enabled: i32,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    db.update_clip_metadata(&clip_id, None, None, None, None, None, None, Some(enabled))
        .map_err(|e| format!("Failed to update clip lut_enabled: {}", e))
}

#[tauri::command]
pub async fn rename_scene_block(
    block_id: String,
    name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Block name cannot be empty.".into());
    }
    state
        .db
        .rename_scene_block(&block_id, name.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_scene_blocks(
    primary_block_id: String,
    secondary_block_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    let mut primary_ids = db
        .get_block_clip_ids(&primary_block_id)
        .map_err(|e| e.to_string())?;
    let secondary_ids = db
        .get_block_clip_ids(&secondary_block_id)
        .map_err(|e| e.to_string())?;

    for clip_id in secondary_ids {
        if !primary_ids.contains(&clip_id) {
            primary_ids.push(clip_id);
        }
    }

    db.replace_block_memberships(&primary_block_id, &primary_ids)
        .map_err(|e| e.to_string())?;
    db.refresh_scene_block_stats(&primary_block_id)
        .map_err(|e| e.to_string())?;
    db.delete_scene_block(&secondary_block_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn split_scene_block(
    block_id: String,
    split_at_clip_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    let clip_ids = db
        .get_block_clip_ids(&block_id)
        .map_err(|e| e.to_string())?;
    if clip_ids.len() < 2 {
        return Err("Block is too small to split.".into());
    }

    let split_index = clip_ids
        .iter()
        .position(|id| id == &split_at_clip_id)
        .ok_or("Split clip not part of block.")?;

    if split_index == 0 || split_index >= clip_ids.len() {
        return Err("Split point must be inside the block.".into());
    }

    let project_id = db
        .get_block_project_id(&block_id)
        .map_err(|e| e.to_string())?
        .ok_or("Block not found.")?;
    let original = db
        .get_scene_blocks(&project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|b| b.id == block_id)
        .ok_or("Block not found.")?;

    let first_half = clip_ids[..split_index].to_vec();
    let second_half = clip_ids[split_index..].to_vec();
    db.replace_block_memberships(&block_id, &first_half)
        .map_err(|e| e.to_string())?;

    let new_block_id = format!("{}_b", hash_string(&(block_id.clone() + &split_at_clip_id)));
    let new_block = SceneBlock {
        id: new_block_id.clone(),
        project_id,
        name: format!("{} (Part 2)", original.name),
        start_time: original.start_time,
        end_time: original.end_time,
        display_order: original.display_order + 1,
        clip_count: second_half.len() as i32,
        camera_list: original.camera_list.clone(),
        confidence: original.confidence,
    };
    db.create_scene_block(&new_block)
        .map_err(|e| e.to_string())?;
    db.replace_block_memberships(&new_block_id, &second_half)
        .map_err(|e| e.to_string())?;
    db.refresh_scene_block_stats(&block_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn reorder_scene_blocks(
    project_id: String,
    block_ids: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    let existing_ids: Vec<String> = db
        .get_scene_blocks(&project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|block| block.id)
        .collect();

    if existing_ids.len() != block_ids.len() {
        return Err("Block order does not match the project block count.".into());
    }

    let existing_set: std::collections::HashSet<String> = existing_ids.into_iter().collect();
    let next_set: std::collections::HashSet<String> = block_ids.iter().cloned().collect();
    if existing_set != next_set {
        return Err("Block order contains invalid project blocks.".into());
    }

    db.replace_scene_block_order(&project_id, &block_ids)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn reorder_scene_block_clips(
    block_id: String,
    clip_ids: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    let existing_ids = db
        .get_block_clip_ids(&block_id)
        .map_err(|e| e.to_string())?;
    if existing_ids.len() != clip_ids.len() {
        return Err("Clip order does not match the block membership.".into());
    }

    let existing_set: std::collections::HashSet<String> = existing_ids.into_iter().collect();
    let next_set: std::collections::HashSet<String> = clip_ids.iter().cloned().collect();
    if existing_set != next_set {
        return Err("Clip order contains invalid block members.".into());
    }

    db.replace_block_memberships(&block_id, &clip_ids)
        .map_err(|e| e.to_string())?;
    db.refresh_scene_block_stats(&block_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn promote_clip_to_block(
    _project_id: String,
    _clip_id: String,
    _state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    Ok(())
}

#[derive(serde::Deserialize, Clone)]
pub struct ExportFilterScope {
    pub mode: String, // all|picks|rated_min|selected_blocks
    pub min_rating: Option<i32>,
    pub block_ids: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
pub struct DirectorPackResult {
    pub root: String,
    pub contact_sheet_pdf: String,
    pub resolve_fcpxml: String,
    pub json_summary: String,
    pub verification_badge: Option<String>,
}

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: String,
    pub build_date: String,
    pub ffmpeg_version: String,
    pub ffprobe_version: String,
    pub macos_version: String,
    pub arch: String,
    pub braw_bridge_active: bool,
    pub redline_bridge_active: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct VerificationQueueItemView {
    pub id: String,
    pub project_id: String,
    pub idx: i32,
    pub label: Option<String>,
    pub source_path: String,
    pub dest_path: String,
    pub last_job_id: Option<String>,
    pub status: String,
    pub mode: Option<String>,
    pub duration_ms: Option<i64>,
    pub counts_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(serde::Serialize)]
pub struct QueueRunStartResult {
    pub queue_run_id: String,
    pub job_ids: Vec<String>,
}

#[tauri::command]
pub async fn export_director_pack(
    project_id: String,
    output_root: String,
    filter: ExportFilterScope,
    include_master_timeline: Option<bool>,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<DirectorPackResult, String> {
    let perf_id = state
        .perf_log
        .start("export_director_pack", Some(project_id.clone()));
    let (job_id, _cancel_flag) = state.job_manager.create_job("director_pack", None);
    state
        .job_manager
        .mark_running(&job_id, "Director Pack export started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let db = &state.db;
    let project = db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    let brand_name = match load_brand_profile(project.root_path.clone()).await {
        Ok(profile) => profile["name"]
            .as_str()
            .unwrap_or("Wrap Preview")
            .to_string(),
        Err(_) => "Wrap Preview".to_string(),
    };

    let pack_root = format!("{}/DirectorPack", output_root);
    let contact_dir = format!("{}/01_Contact_Sheet", pack_root);
    let resolve_dir = format!("{}/02_Resolve_Project", pack_root);
    let reports_dir = format!("{}/03_Reports", pack_root);
    std::fs::create_dir_all(&contact_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&resolve_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&reports_dir).map_err(|e| e.to_string())?;

    let filtered_clips = resolve_clips_for_scope(
        db,
        &project_id,
        &filter.mode,
        filter.min_rating,
        filter.block_ids,
    )
    .map_err(|e| e.to_string())?;
    if filtered_clips.is_empty() {
        return Err("No clips available for current filter scope.".into());
    }

    let fcpxml_path = format!(
        "{}/{}_director.fcpxml",
        resolve_dir,
        sanitize_filename(&project.name)
    );
    let fcpxml = crate::export::generate_fcpxml_structured(
        &filtered_clips,
        &project.name,
        include_master_timeline.unwrap_or(true),
        Some(&project.root_path),
    );
    std::fs::write(&fcpxml_path, fcpxml).map_err(|e| e.to_string())?;

    let verification_badge_path = db
        .list_verification_jobs_for_project(&project_id, 25)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|job| job.status == "DONE")
        .map(|job| {
            let badge_path = collision_safe_path(
                &reports_dir,
                &format!(
                    "verification_badge_{}",
                    chrono::Utc::now().format("%Y-%m-%d")
                ),
                "svg",
            );
            let badge_svg = build_verification_badge_svg(&job);
            std::fs::write(&badge_path, badge_svg).map_err(|e| e.to_string())?;
            Ok::<String, String>(badge_path)
        })
        .transpose()?;

    let report_path = format!(
        "{}/{}_summary.json",
        reports_dir,
        sanitize_filename(&project.name)
    );
    let report = serde_json::json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "project": project,
        "scope": filter.mode,
        "clip_count": filtered_clips.len(),
        "clips": filtered_clips,
        "verification_badge": verification_badge_path,
        "exported_at": chrono::Utc::now().to_rfc3339(),
    });
    let report_content = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    std::fs::write(&report_path, report_content).map_err(|e| e.to_string())?;

    let pdf_path = format!(
        "{}/{}_contact_sheet.pdf",
        contact_dir,
        sanitize_filename(&project.name)
    );
    write_simple_contact_sheet_pdf(
        &pdf_path,
        &project.name,
        &filtered_clips,
        &brand_name,
        &state.cache_dir,
    )
    .map_err(|e| format!("Failed generating contact sheet PDF: {}", e))?;

    let _ = write_last_export_metadata(
        &state.cache_dir,
        serde_json::json!({
            "kind": "director_pack",
            "project_id": project_id,
            "root": pack_root,
            "contact_sheet_pdf": pdf_path,
            "resolve_fcpxml": fcpxml_path,
            "json_summary": report_path,
            "verification_badge": verification_badge_path,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }),
    );

    state
        .job_manager
        .mark_done(&job_id, "Director Pack export complete");
    emit_job_state(&app, &state.job_manager, &job_id);

    let result = DirectorPackResult {
        root: pack_root,
        contact_sheet_pdf: pdf_path,
        resolve_fcpxml: fcpxml_path,
        json_summary: report_path,
        verification_badge: verification_badge_path,
    };
    state
        .perf_log
        .end(&perf_id, "ok", Some(result.root.clone()));
    Ok(result)
}

#[tauri::command]
pub async fn get_app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_date: option_env!("BUILD_DATE").unwrap_or("unknown").to_string(),
        ffmpeg_version: command_first_line(&crate::tools::find_executable("ffmpeg"), &["-version"])
            .unwrap_or_else(|| "Unavailable".to_string()),
        ffprobe_version: command_first_line(
            &crate::tools::find_executable("ffprobe"),
            &["-version"],
        )
        .unwrap_or_else(|| "Unavailable".to_string()),
        macos_version: command_first_line("sw_vers", &["-productVersion"])
            .unwrap_or_else(|| "Unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
        braw_bridge_active: command_exists("braw_bridge") || command_exists("braw-decode"),
        redline_bridge_active: command_exists("REDline") || command_exists("redline"),
    })
}

#[tauri::command]
pub async fn export_feedback_bundle(
    output_root: String,
    last_verification_job_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let app_info = get_app_info().await?;
    let jobs = state.job_manager.list_jobs();
    let output_path = format!(
        "{}/WrapPreview_Feedback_{}.zip",
        output_root,
        chrono::Utc::now().format("%Y%m%d_%H%M%S")
    );

    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("app_info.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        serde_json::to_string_pretty(&app_info)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("jobs.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        serde_json::to_string_pretty(&jobs)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;

    if let Some(last_export) = read_last_export_metadata(&state.cache_dir) {
        zip.start_file("last_export.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(
            serde_json::to_string_pretty(&last_export)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(job_id) = last_verification_job_id {
        if let Ok(Some(job)) = state.db.get_verification_job(&job_id) {
            let items = state.db.get_verification_items(&job_id).unwrap_or_default();
            zip.start_file("verification_summary.json", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(
                serde_json::to_string_pretty(&serde_json::json!({
                    "job": job,
                    "items_count": items.len()
                }))
                .map_err(|e| e.to_string())?
                .as_bytes(),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(output_path)
}

#[tauri::command]
pub async fn list_perf_events(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::perf::PerfEvent>, String> {
    Ok(state.perf_log.list())
}

#[tauri::command]
pub async fn clear_perf_events(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.perf_log.clear();
    Ok(())
}

#[tauri::command]
pub async fn export_perf_report(
    output_root: String,
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let events = state.perf_log.list();
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let base = format!("{}/WrapPreview_Perf_{}", output_root, timestamp);
    let md_path = format!("{}.md", base);
    let json_path = format!("{}.json", base);

    let json = serde_json::json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "events": events
    });
    let json_text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, json_text).map_err(|e| e.to_string())?;

    let mut md = String::new();
    md.push_str("# Wrap Preview Performance Report\n\n");
    md.push_str(&format!(
        "- Exported: {}\n",
        chrono::Utc::now().to_rfc3339()
    ));
    md.push_str(&format!(
        "- Events: {}\n\n",
        json["events"].as_array().map(|a| a.len()).unwrap_or(0)
    ));
    md.push_str("| Name | Status | Duration (ms) | Started |\n");
    md.push_str("|---|---:|---:|---|\n");
    if let Some(arr) = json["events"].as_array() {
        for ev in arr {
            md.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                ev["name"].as_str().unwrap_or(""),
                ev["status"].as_str().unwrap_or(""),
                ev["duration_ms"]
                    .as_u64()
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                ev["started_at"].as_str().unwrap_or("")
            ));
        }
    }
    std::fs::write(&md_path, md).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "md_path": md_path, "json_path": json_path }))
}

#[derive(serde::Serialize)]
pub struct ReviewCoreIngestResult {
    pub asset_ids: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct ReviewCoreDuplicateCandidate {
    pub file_path: String,
    pub checksum_sha256: String,
    pub existing_asset_id: String,
    pub existing_filename: String,
}

#[derive(serde::Serialize)]
pub struct ReviewCoreThumbnailInfo {
    pub file_name: String,
    pub index: usize,
    pub approx_seconds: f64,
}

#[derive(serde::Serialize)]
pub struct ReviewCoreDuplicateCheckResult {
    pub duplicates: Vec<ReviewCoreDuplicateCandidate>,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreProjectSummary {
    pub id: String,
    pub name: String,
    pub last_opened_at: String,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreShareLinkSummary {
    pub id: String,
    pub project_id: String,
    pub token: String,
    pub asset_version_ids: Vec<String>,
    pub expires_at: Option<String>,
    pub allow_comments: bool,
    pub allow_download: bool,
    pub password_required: bool,
    pub created_at: String,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreShareLinkResolved {
    pub project_id: String,
    pub project_name: String,
    pub asset_version_ids: Vec<String>,
    pub allow_comments: bool,
    pub allow_download: bool,
    pub password_required: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreShareUnlockResult {
    pub session_token: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreSharedAssetSummary {
    pub id: String,
    pub project_id: String,
    pub filename: String,
    pub duration_ms: Option<u64>,
    pub frame_rate: Option<f64>,
    pub avg_frame_rate: Option<String>,
    pub r_frame_rate: Option<String>,
    pub is_vfr: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreSharedVersionSummary {
    pub id: String,
    pub asset_id: String,
    pub version_number: i32,
    pub processing_status: String,
    pub created_at: String,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreAssetWithVersions {
    pub asset: Asset,
    pub versions: Vec<AssetVersion>,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreFrameNoteSummary {
    pub id: String,
    pub project_id: String,
    pub asset_id: String,
    pub asset_version_id: String,
    pub timestamp_ms: i64,
    pub frame_number: Option<i64>,
    pub title: Option<String>,
    pub image_key: String,
    pub image_path: String,
    pub frame_url: String,
    pub vector_data: String,
    pub created_at: String,
    pub updated_at: String,
    pub hidden: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct ReviewCoreExtractFrameResult {
    pub note_id: String,
    pub frame_url: String,
    pub project_id: String,
    pub asset_id: String,
    pub image_path: String,
}

#[derive(serde::Deserialize)]
pub struct ReviewCoreFrameNoteUpdateInput {
    pub title: Option<String>,
    pub vector_data: Option<String>,
    pub hidden: Option<bool>,
}

#[derive(serde::Deserialize)]
pub struct ReviewCoreCommentUpdateInput {
    pub text: Option<String>,
    pub resolved: Option<bool>,
    pub author_name: Option<String>,
}

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewCoreDuplicateMode {
    NewVersion,
    NewAsset,
}

#[derive(Debug, thiserror::Error)]
pub enum ReviewCoreShareError {
    #[error("NOT_FOUND")]
    NotFound,
    #[error("EXPIRED")]
    Expired,
    #[error("FORBIDDEN")]
    Forbidden,
}

#[tauri::command]
pub async fn review_core_create_project(
    name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreProjectSummary, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }

    let safe_name: String = trimmed.chars().take(120).collect();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = uuid::Uuid::new_v4().to_string();
    let project = ReviewCoreProject {
        id: project_id.clone(),
        name: safe_name.clone(),
        created_at: now.clone(),
        last_opened_at: now.clone(),
    };

    state
        .db
        .upsert_project(&Project {
            id: project_id.clone(),
            root_path: format!("review-core://{}", project_id),
            name: safe_name.clone(),
            created_at: now.clone(),
            bookmark: None,
        })
        .map_err(|e| e.to_string())?;

    state
        .db
        .create_review_core_project(&project)
        .map_err(|e| e.to_string())?;

    Ok(ReviewCoreProjectSummary {
        id: project.id,
        name: project.name,
        last_opened_at: project.last_opened_at,
    })
}

#[tauri::command]
pub async fn review_core_list_projects(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreProjectSummary>, String> {
    state
        .db
        .list_review_core_projects()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|project| {
            Ok(ReviewCoreProjectSummary {
                id: project.id,
                name: project.name,
                last_opened_at: project.last_opened_at,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn review_core_touch_project(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .get_review_core_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Review Core project not found")?;

    state
        .db
        .touch_review_core_project(&project_id, &chrono::Utc::now().to_rfc3339())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_list_assets(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Asset>, String> {
    state.db.list_assets(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_list_assets_with_versions(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreAssetWithVersions>, String> {
    let assets = state
        .db
        .list_assets(&project_id)
        .map_err(|e| e.to_string())?;
    let mut payload = Vec::with_capacity(assets.len());
    for asset in assets {
        let versions = state
            .db
            .list_asset_versions(&asset.id)
            .map_err(|e| e.to_string())?;
        payload.push(ReviewCoreAssetWithVersions { asset, versions });
    }
    Ok(payload)
}

#[tauri::command]
pub async fn review_core_list_asset_versions(
    asset_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<AssetVersion>, String> {
    state
        .db
        .list_asset_versions(&asset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_list_thumbnails(
    version_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreThumbnailInfo>, String> {
    let version = state
        .db
        .get_asset_version(&version_id)
        .map_err(|e| e.to_string())?
        .ok_or("Asset version not found")?;
    let asset = state
        .db
        .get_asset(&version.asset_id)
        .map_err(|e| e.to_string())?
        .ok_or("Asset not found")?;
    let Some(thumbs_key) = version.thumbnails_key else {
        return Ok(Vec::new());
    };
    let thumbs_dir =
        review_core::storage::safe_relative_path(&state.review_core_base_dir, &thumbs_key)?;
    if !thumbs_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<_> = std::fs::read_dir(thumbs_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|entry| entry.path().is_file())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    let duration_secs = asset.duration_ms.unwrap_or(0) as f64 / 1000.0;
    let count = entries.len().max(1) as f64;
    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| ReviewCoreThumbnailInfo {
            file_name: entry.file_name().to_string_lossy().to_string(),
            index,
            approx_seconds: if duration_secs > 0.0 {
                (duration_secs / count) * index as f64
            } else {
                index as f64
            },
        })
        .collect())
}

#[tauri::command]
pub async fn review_core_get_server_base_url(
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    Ok(state
        .review_core_server_base_url
        .lock()
        .map_err(|_| "Failed to lock Review Core server URL".to_string())?
        .clone()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn review_core_add_comment(
    asset_version_id: String,
    timestamp_ms: i64,
    frame_number: Option<i64>,
    text: String,
    author_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreComment, String> {
    let version = state
        .db
        .get_asset_version(&asset_version_id)
        .map_err(|e| e.to_string())?
        .ok_or("Asset version not found")?;
    let asset = state
        .db
        .get_asset(&version.asset_id)
        .map_err(|e| e.to_string())?
        .ok_or("Asset not found")?;

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Comment text cannot be empty".to_string());
    }
    let trimmed_text: String = trimmed.chars().take(2000).collect();
    let safe_author = author_name
        .map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                "Anonymous".to_string()
            } else {
                trimmed.chars().take(80).collect()
            }
        })
        .unwrap_or_else(|| "Anonymous".to_string());
    let clamped_timestamp = clamp_frame_note_timestamp(timestamp_ms, asset.duration_ms);
    let computed_frame = compute_comment_frame_number(&asset, clamped_timestamp, frame_number);

    let comment = ReviewCoreComment {
        id: uuid::Uuid::new_v4().to_string(),
        asset_version_id,
        timestamp_ms: clamped_timestamp,
        frame_number: computed_frame,
        text: trimmed_text,
        author_name: safe_author,
        resolved: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .db
        .create_review_core_comment(&comment)
        .map_err(|e| e.to_string())?;
    Ok(comment)
}

#[tauri::command]
pub async fn review_core_list_comments(
    asset_version_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreComment>, String> {
    state
        .db
        .list_review_core_comments(&asset_version_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_update_comment(
    comment_id: String,
    updates: ReviewCoreCommentUpdateInput,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreComment, String> {
    let existing = state
        .db
        .get_review_core_comment(&comment_id)
        .map_err(|e| e.to_string())?
        .ok_or("Comment not found")?;

    let next_text = if let Some(text) = updates.text.as_ref() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err("Comment text cannot be empty".to_string());
        }
        Some(trimmed.chars().take(2000).collect::<String>())
    } else {
        None
    };
    let next_author = updates.author_name.as_ref().map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            "Anonymous".to_string()
        } else {
            trimmed.chars().take(80).collect::<String>()
        }
    });

    state
        .db
        .update_review_core_comment(
            &comment_id,
            next_text.as_deref(),
            updates.resolved,
            next_author.as_deref(),
        )
        .map_err(|e| e.to_string())?;

    state
        .db
        .get_review_core_comment(&comment_id)
        .map_err(|e| e.to_string())?
        .or(Some(ReviewCoreComment {
            id: existing.id,
            asset_version_id: existing.asset_version_id,
            timestamp_ms: existing.timestamp_ms,
            frame_number: existing.frame_number,
            text: next_text.unwrap_or(existing.text),
            author_name: next_author.unwrap_or(existing.author_name),
            resolved: updates.resolved.unwrap_or(existing.resolved),
            created_at: existing.created_at,
        }))
        .ok_or("Comment not found after update".to_string())
}

#[tauri::command]
pub async fn review_core_delete_comment(
    comment_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_review_core_annotations_for_comment(&comment_id)
        .map_err(|e| e.to_string())?;
    state
        .db
        .delete_review_core_comment(&comment_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_add_annotation(
    comment_id: String,
    vector_data_json: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreAnnotation, String> {
    let comment = state
        .db
        .get_review_core_comment(&comment_id)
        .map_err(|e| e.to_string())?
        .ok_or("Comment not found")?;

    let normalized =
        normalize_annotation_vector_data(&vector_data_json, &comment.id, comment.timestamp_ms)?;
    state
        .db
        .delete_review_core_annotations_for_comment(&comment.id)
        .map_err(|e| e.to_string())?;

    let annotation = ReviewCoreAnnotation {
        id: uuid::Uuid::new_v4().to_string(),
        comment_id: comment.id,
        asset_version_id: comment.asset_version_id,
        timestamp_ms: comment.timestamp_ms,
        vector_data: normalized,
        coordinate_space: "normalized_0_1".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .db
        .create_review_core_annotation(&annotation)
        .map_err(|e| e.to_string())?;
    Ok(annotation)
}

#[tauri::command]
pub async fn review_core_list_annotations(
    asset_version_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreAnnotation>, String> {
    state
        .db
        .list_review_core_annotations(&asset_version_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_extract_frame(
    asset_version_id: String,
    timestamp_ms: i64,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreExtractFrameResult, String> {
    let (job_id, _cancel_flag) = state
        .job_manager
        .create_job("review_core_extract_frame", Some(asset_version_id.clone()));
    state
        .job_manager
        .mark_running(&job_id, "Extracting Review Core frame");
    emit_job_state(&app, &state.job_manager, &job_id);
    let fail_job = |message: String| {
        state.job_manager.mark_failed(&job_id, &message);
        emit_job_state(&app, &state.job_manager, &job_id);
        message
    };

    let version = state
        .db
        .get_asset_version(&asset_version_id)
        .map_err(|e| fail_job(e.to_string()))?
        .ok_or_else(|| fail_job("Asset version not found".to_string()))?;
    let asset = state
        .db
        .get_asset(&version.asset_id)
        .map_err(|e| fail_job(e.to_string()))?
        .ok_or_else(|| fail_job("Asset not found".to_string()))?;

    let clamped_timestamp = clamp_frame_note_timestamp(timestamp_ms, asset.duration_ms);
    let note_id = uuid::Uuid::new_v4().to_string();
    let note_dir_key = format!(
        "derived/{}/{}/v{}/frame_notes/{}",
        asset.project_id, asset.id, version.version_number, note_id
    );
    let frame_key = format!("{}/frame.jpg", note_dir_key);
    let frame_path =
        review_core::storage::safe_relative_path(&state.review_core_base_dir, &frame_key)
            .map_err(fail_job)?;
    if let Some(parent) = frame_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| fail_job(e.to_string()))?;
    }

    let proxy_path = version
        .proxy_mp4_key
        .as_deref()
        .and_then(|key| {
            review_core::storage::safe_relative_path(&state.review_core_base_dir, key).ok()
        })
        .filter(|path| path.exists());
    let source_path = if let Some(proxy) = proxy_path {
        proxy
    } else {
        review_core::storage::safe_relative_path(
            &state.review_core_base_dir,
            &version.original_file_key,
        )
        .map_err(fail_job)?
    };
    if !source_path.exists() {
        return Err(fail_job(format!(
            "Frame capture source missing for version {}",
            version.id
        )));
    }

    state.job_manager.update_progress(
        &job_id,
        0.3,
        Some(format!("Seeking frame at {} ms", clamped_timestamp)),
    );
    emit_job_state(&app, &state.job_manager, &job_id);

    if let Err(error) = review_core_ffmpeg_run(&[
        "-y".to_string(),
        "-i".to_string(),
        source_path.to_string_lossy().to_string(),
        "-ss".to_string(),
        format!("{:.6}", clamped_timestamp as f64 / 1000.0),
        "-frames:v".to_string(),
        "1".to_string(),
        "-f".to_string(),
        "image2".to_string(),
        "-q:v".to_string(),
        "2".to_string(),
        frame_path.to_string_lossy().to_string(),
    ]) {
        let failure = format!("Frame capture failed: {}", error);
        state.job_manager.mark_failed(&job_id, &failure);
        emit_job_state(&app, &state.job_manager, &job_id);
        return Err(failure);
    }

    state
        .job_manager
        .update_progress(&job_id, 0.85, Some("Saving Frame Note".to_string()));
    emit_job_state(&app, &state.job_manager, &job_id);

    let now = chrono::Utc::now().to_rfc3339();
    let note = ReviewCoreFrameNote {
        id: note_id.clone(),
        project_id: asset.project_id.clone(),
        asset_id: asset.id.clone(),
        asset_version_id: version.id.clone(),
        timestamp_ms: clamped_timestamp,
        frame_number: compute_comment_frame_number(&asset, clamped_timestamp, None),
        title: None,
        image_key: frame_key.clone(),
        vector_data: "[]".to_string(),
        created_at: now.clone(),
        updated_at: now,
        hidden: false,
    };
    state
        .db
        .create_review_core_frame_note(&note)
        .map_err(|e| fail_job(e.to_string()))?;

    let result = ReviewCoreExtractFrameResult {
        note_id: note_id.clone(),
        frame_url: build_frame_note_url(
            &state,
            &asset.project_id,
            &asset.id,
            &version.id,
            &note_id,
            "frame.jpg",
        )
        .map_err(fail_job)?,
        project_id: asset.project_id,
        asset_id: asset.id,
        image_path: frame_path.to_string_lossy().to_string(),
    };

    state
        .job_manager
        .mark_done(&job_id, "Review Core frame extracted");
    emit_job_state(&app, &state.job_manager, &job_id);

    Ok(result)
}

#[tauri::command]
pub async fn review_core_list_frame_notes(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreFrameNoteSummary>, String> {
    let notes = state
        .db
        .list_review_core_frame_notes(&project_id)
        .map_err(|e| e.to_string())?;
    notes
        .into_iter()
        .map(|note| frame_note_to_summary(&state, note))
        .collect()
}

#[tauri::command]
pub async fn review_core_read_frame_note_image(
    note_id: String,
    file_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let note = state
        .db
        .get_review_core_frame_note(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("Frame note not found")?;
    let base_path =
        review_core::storage::safe_relative_path(&state.review_core_base_dir, &note.image_key)?;
    let requested_file = match file_name.as_deref() {
        Some("annotated.jpg") => "annotated.jpg",
        _ => "frame.jpg",
    };
    let image_path = base_path
        .parent()
        .ok_or("Frame note path invalid")?
        .join(requested_file);
    let bytes = std::fs::read(&image_path)
        .map_err(|e| format!("Failed to read frame note image: {}", e))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
pub async fn review_core_update_frame_note(
    note_id: String,
    updates: ReviewCoreFrameNoteUpdateInput,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreFrameNoteSummary, String> {
    let existing = state
        .db
        .get_review_core_frame_note(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("Frame note not found")?;

    let next_title = match updates.title.as_ref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Some(String::new())
            } else {
                Some(trimmed.chars().take(160).collect::<String>())
            }
        }
        None => None,
    };

    let next_vector_data = if let Some(raw) = updates.vector_data.as_deref() {
        Some(normalize_frame_note_vector_data(
            raw,
            existing.timestamp_ms,
        )?)
    } else {
        None
    };

    state
        .db
        .update_review_core_frame_note(
            &note_id,
            next_title.as_deref(),
            next_vector_data.as_deref(),
            updates.hidden,
            &chrono::Utc::now().to_rfc3339(),
        )
        .map_err(|e| e.to_string())?;

    let updated = state
        .db
        .get_review_core_frame_note(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("Frame note not found after update")?;
    frame_note_to_summary(&state, updated)
}

#[tauri::command]
pub async fn review_core_delete_frame_note(
    note_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let note = state
        .db
        .get_review_core_frame_note(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("Frame note not found")?;
    let frame_path =
        review_core::storage::safe_relative_path(&state.review_core_base_dir, &note.image_key)?;
    if let Some(parent) = frame_path.parent() {
        let _ = std::fs::remove_dir_all(parent);
    }
    state
        .db
        .delete_review_core_frame_note(&note_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_delete_annotation(
    annotation_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_review_core_annotation(&annotation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_create_share_link(
    project_id: String,
    asset_version_ids: Vec<String>,
    expires_at: Option<String>,
    password: Option<String>,
    allow_comments: bool,
    allow_download: bool,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreShareLinkSummary, String> {
    let canonical_version_ids =
        validate_share_link_versions(&state.db, &project_id, &asset_version_ids)?;
    let token = generate_share_token();
    let password_hash = if let Some(raw_password) = password {
        let trimmed = raw_password.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(hash(trimmed, DEFAULT_COST).map_err(|e| e.to_string())?)
        }
    } else {
        None
    };
    let share_link = ReviewCoreShareLink {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.clone(),
        token: token.clone(),
        asset_version_ids_json: serde_json::to_string(&canonical_version_ids)
            .map_err(|e| e.to_string())?,
        expires_at: normalize_expiry(expires_at)?,
        password_hash,
        allow_comments,
        allow_download,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .db
        .create_review_core_share_link(&share_link)
        .map_err(|e| e.to_string())?;
    Ok(share_link_to_summary(&share_link)?)
}

#[tauri::command]
pub async fn review_core_list_share_links(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreShareLinkSummary>, String> {
    state
        .db
        .list_review_core_share_links(&project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|link| share_link_to_summary(&link))
        .collect()
}

#[tauri::command]
pub async fn review_core_revoke_share_link(
    share_link_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_review_core_share_link(&share_link_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_resolve_share_link(
    token: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreShareLinkResolved, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    let project = state
        .db
        .get_project(&link.project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;
    Ok(ReviewCoreShareLinkResolved {
        project_id: link.project_id,
        project_name: project.name,
        asset_version_ids: version_ids,
        allow_comments: link.allow_comments,
        allow_download: link.allow_download,
        password_required: link.password_hash.is_some(),
    })
}

#[tauri::command]
pub async fn review_core_verify_share_link_password(
    token: String,
    password: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let (link, _) = match resolve_share_link(&state.db, &token) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    match link.password_hash {
        Some(hash_value) => verify(password.trim(), &hash_value).map_err(|e| e.to_string()),
        None => Ok(true),
    }
}

#[tauri::command]
pub async fn review_core_share_unlock(
    token: String,
    password: String,
    display_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreShareUnlockResult, String> {
    let (link, _) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    match link.password_hash {
        Some(hash_value) => {
            let ok = verify(password.trim(), &hash_value).map_err(|e| e.to_string())?;
            if !ok {
                return Err("FORBIDDEN".to_string());
            }
            let now = chrono::Utc::now();
            let expires_at = now + chrono::Duration::minutes(30);
            let session = ReviewCoreShareSession {
                id: uuid::Uuid::new_v4().to_string(),
                share_link_id: link.id,
                token: generate_share_token(),
                display_name,
                expires_at: expires_at.to_rfc3339(),
                created_at: now.to_rfc3339(),
                last_seen_at: Some(now.to_rfc3339()),
            };
            state
                .db
                .create_review_core_share_session(&session)
                .map_err(|e| e.to_string())?;
            Ok(ReviewCoreShareUnlockResult {
                session_token: Some(session.token),
                expires_at: Some(session.expires_at),
            })
        }
        None => Ok(ReviewCoreShareUnlockResult {
            session_token: None,
            expires_at: None,
        }),
    }
}

#[tauri::command]
pub async fn review_core_share_list_assets(
    token: String,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreSharedAssetSummary>, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    let versions = version_ids
        .into_iter()
        .filter_map(|version_id| state.db.get_asset_version(&version_id).ok().flatten())
        .collect::<Vec<_>>();
    let mut seen = std::collections::HashSet::new();
    let mut assets = Vec::new();
    for version in versions {
        if seen.insert(version.asset_id.clone()) {
            if let Some(asset) = state
                .db
                .get_asset(&version.asset_id)
                .map_err(|e| e.to_string())?
            {
                if asset.project_id == link.project_id {
                    assets.push(ReviewCoreSharedAssetSummary {
                        id: asset.id,
                        project_id: asset.project_id,
                        filename: asset.filename,
                        duration_ms: asset.duration_ms,
                        frame_rate: asset.frame_rate,
                        avg_frame_rate: asset.avg_frame_rate,
                        r_frame_rate: asset.r_frame_rate,
                        is_vfr: asset.is_vfr,
                        width: asset.width,
                        height: asset.height,
                        codec: asset.codec,
                        status: asset.status,
                        created_at: asset.created_at,
                    });
                }
            }
        }
    }
    assets.sort_by(|a, b| {
        a.filename
            .cmp(&b.filename)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    Ok(assets)
}

#[tauri::command]
pub async fn review_core_share_list_versions(
    token: String,
    asset_id: String,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreSharedVersionSummary>, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    let mut versions = Vec::new();
    for version_id in version_ids {
        if let Some(version) = state
            .db
            .get_asset_version(&version_id)
            .map_err(|e| e.to_string())?
        {
            if version.asset_id == asset_id {
                versions.push(ReviewCoreSharedVersionSummary {
                    id: version.id,
                    asset_id: version.asset_id,
                    version_number: version.version_number,
                    processing_status: version.processing_status,
                    created_at: version.created_at,
                });
            }
        }
    }
    versions.sort_by(|a, b| b.version_number.cmp(&a.version_number));
    Ok(versions)
}

#[tauri::command]
pub async fn review_core_share_list_thumbnails(
    token: String,
    asset_version_id: String,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreThumbnailInfo>, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    if !version_ids.contains(&asset_version_id) {
        return Err("FORBIDDEN".to_string());
    }
    review_core_list_thumbnails(asset_version_id, state).await
}

#[tauri::command]
pub async fn review_core_share_set_display_name(
    token: String,
    session_token: String,
    display_name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let link = state
        .db
        .get_review_core_share_link_by_token(&token)
        .map_err(|e| e.to_string())?
        .ok_or("Share link not found")?;

    let session = state
        .db
        .get_review_core_share_session_by_token(&session_token)
        .map_err(|e| e.to_string())?
        .ok_or("Session not found")?;

    if session.share_link_id != link.id {
        return Err("FORBIDDEN".to_string());
    }

    let safe_name = display_name.trim();
    let name_opt = if safe_name.is_empty() {
        None
    } else {
        Some(safe_name)
    };

    state
        .db
        .update_review_core_share_session_display_name(&session.id, name_opt.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_share_list_comments(
    token: String,
    asset_version_id: String,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreComment>, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    if !version_ids.contains(&asset_version_id) {
        return Err("FORBIDDEN".to_string());
    }
    if !link.allow_comments {
        return Ok(Vec::new());
    }
    state
        .db
        .list_review_core_comments(&asset_version_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_share_add_comment(
    token: String,
    asset_version_id: String,
    timestamp_ms: i64,
    frame_number: Option<i64>,
    text: String,
    author_name: Option<String>,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreComment, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    if !link.allow_comments {
        return Err("FORBIDDEN".to_string());
    }
    if !version_ids.contains(&asset_version_id) {
        return Err("FORBIDDEN".to_string());
    }

    let mut final_author = author_name;
    if final_author.as_deref().unwrap_or("").is_empty() {
        if let Some(st) = session_token.as_deref() {
            if let Ok(Some(session)) = state.db.get_review_core_share_session_by_token(st) {
                if let Some(dn) = session.display_name {
                    final_author = Some(dn);
                }
            }
        }
    }

    review_core_add_comment(
        asset_version_id,
        timestamp_ms,
        frame_number,
        text,
        final_author,
        state,
    )
    .await
}

#[tauri::command]
pub async fn review_core_share_list_annotations(
    token: String,
    asset_version_id: String,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ReviewCoreAnnotation>, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    if !version_ids.contains(&asset_version_id) {
        return Err("FORBIDDEN".to_string());
    }
    state
        .db
        .list_review_core_annotations(&asset_version_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn review_core_share_export_download(
    token: String,
    asset_version_id: String,
    output_path: String,
    session_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let (link, version_ids) = resolve_share_link(&state.db, &token).map_err(|e| e.to_string())?;
    validate_share_session(&state.db, &link, session_token.as_deref())
        .map_err(|e| e.to_string())?;
    if !link.allow_download {
        return Err("FORBIDDEN".to_string());
    }
    if !version_ids.contains(&asset_version_id) {
        return Err("FORBIDDEN".to_string());
    }
    let version = state
        .db
        .get_asset_version(&asset_version_id)
        .map_err(|e| e.to_string())?
        .ok_or("Asset version not found")?;

    let download_key = version.proxy_mp4_key.ok_or("PROXY_NOT_READY".to_string())?;

    let source_path =
        review_core::storage::safe_relative_path(&state.review_core_base_dir, &download_key)?;
    if !source_path.exists() {
        return Err("PROXY_NOT_READY".to_string());
    }
    std::fs::copy(&source_path, &output_path).map_err(|e| e.to_string())?;
    Ok(output_path)
}

#[tauri::command]
pub async fn review_core_get_approval(
    asset_version_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreApprovalState, String> {
    state
        .db
        .get_review_core_approval_state(&asset_version_id)
        .map_err(|e| e.to_string())?
        .or(Some(ReviewCoreApprovalState {
            asset_version_id,
            status: "draft".to_string(),
            approved_at: None,
            approved_by: None,
        }))
        .ok_or("Approval state unavailable".to_string())
}

#[tauri::command]
pub async fn review_core_set_approval(
    asset_version_id: String,
    status: String,
    approved_by: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreApprovalState, String> {
    let normalized_status = match status.trim() {
        "draft" => "draft",
        "in_review" => "in_review",
        "approved" => "approved",
        "rejected" => "rejected",
        _ => return Err("Invalid approval status".to_string()),
    };

    let approval = if matches!(normalized_status, "approved" | "rejected") {
        let safe_name = approved_by
            .map(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    "Anonymous".to_string()
                } else {
                    trimmed.chars().take(80).collect()
                }
            })
            .unwrap_or_else(|| "Anonymous".to_string());
        ReviewCoreApprovalState {
            asset_version_id,
            status: normalized_status.to_string(),
            approved_at: Some(chrono::Utc::now().to_rfc3339()),
            approved_by: Some(safe_name),
        }
    } else {
        ReviewCoreApprovalState {
            asset_version_id,
            status: normalized_status.to_string(),
            approved_at: None,
            approved_by: None,
        }
    };

    state
        .db
        .upsert_review_core_approval_state(&approval)
        .map_err(|e| e.to_string())?;
    Ok(approval)
}

#[tauri::command]
pub async fn review_core_check_duplicate_files(
    project_id: String,
    file_paths: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreDuplicateCheckResult, String> {
    let mut duplicates = Vec::new();
    for file_path in file_paths {
        let source = std::path::PathBuf::from(&file_path);
        if !source.exists() || !source.is_file() {
            continue;
        }
        let checksum = checksum_sha256(&source)?;
        if let Some(asset) = state
            .db
            .find_asset_by_project_and_checksum(&project_id, &checksum)
            .map_err(|e| e.to_string())?
        {
            duplicates.push(ReviewCoreDuplicateCandidate {
                file_path,
                checksum_sha256: checksum,
                existing_asset_id: asset.id,
                existing_filename: asset.filename,
            });
        }
    }
    Ok(ReviewCoreDuplicateCheckResult { duplicates })
}

#[tauri::command]
pub async fn review_core_ingest_files(
    app: AppHandle,
    project_id: String,
    file_paths: Vec<String>,
    duplicate_mode: Option<ReviewCoreDuplicateMode>,
    state: State<'_, Arc<AppState>>,
) -> Result<ReviewCoreIngestResult, String> {
    if file_paths.is_empty() {
        return Ok(ReviewCoreIngestResult { asset_ids: vec![] });
    }

    state
        .db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    std::fs::create_dir_all(&state.review_core_base_dir).map_err(|e| e.to_string())?;

    let duplicate_mode = duplicate_mode.unwrap_or(ReviewCoreDuplicateMode::NewVersion);
    let mut asset_ids = Vec::new();
    for file_path in file_paths {
        let source = std::path::PathBuf::from(&file_path);
        if !source.exists() || !source.is_file() {
            return Err(format!("File does not exist: {}", file_path));
        }

        let version_id = uuid::Uuid::new_v4().to_string();
        let filename = source
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .ok_or("Invalid source filename")?;
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bin");
        let checksum_sha256 = checksum_sha256(&source)?;
        let now = chrono::Utc::now().to_rfc3339();
        let existing_asset = state
            .db
            .find_asset_by_project_and_checksum(&project_id, &checksum_sha256)
            .map_err(|e| e.to_string())?;
        let use_existing =
            duplicate_mode == ReviewCoreDuplicateMode::NewVersion && existing_asset.is_some();
        let asset_id = existing_asset
            .as_ref()
            .map(|asset| asset.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let version_number = if use_existing {
            state
                .db
                .get_next_asset_version_number(&asset_id)
                .map_err(|e| e.to_string())?
        } else {
            1
        };
        let version_paths = review_core::storage::build_version_paths(
            &state.review_core_base_dir,
            &project_id,
            &asset_id,
            version_number,
            extension,
        )?;
        let file_size = copy_file(&source, &version_paths.original_abs_path)?;

        if !use_existing {
            state
                .db
                .create_asset(&Asset {
                    id: asset_id.clone(),
                    project_id: project_id.clone(),
                    filename,
                    original_path: version_paths
                        .original_abs_path
                        .to_string_lossy()
                        .to_string(),
                    storage_key: version_paths.original_key.clone(),
                    file_size,
                    duration_ms: None,
                    frame_rate: None,
                    avg_frame_rate: None,
                    r_frame_rate: None,
                    is_vfr: false,
                    width: None,
                    height: None,
                    codec: None,
                    status: "processing".to_string(),
                    checksum_sha256: checksum_sha256.clone(),
                    last_error: None,
                    created_at: now.clone(),
                })
                .map_err(|e| e.to_string())?;
        } else {
            state
                .db
                .set_asset_error(&asset_id, "processing", None)
                .map_err(|e| e.to_string())?;
        }
        state
            .db
            .create_asset_version(&AssetVersion {
                id: version_id.clone(),
                asset_id: asset_id.clone(),
                version_number,
                original_file_key: version_paths.original_key.clone(),
                proxy_playlist_key: None,
                proxy_mp4_key: None,
                thumbnails_key: None,
                poster_key: None,
                processing_status: "processing".to_string(),
                last_error: None,
                created_at: now,
            })
            .map_err(|e| e.to_string())?;

        let (job_id, cancel_flag) = state
            .job_manager
            .create_job("review_core_process_version", None);
        emit_job_state(&app, &state.job_manager, &job_id);

        let app_state = state.inner().clone();
        let app_clone = app.clone();
        let asset_id_clone = asset_id.clone();
        let version_id_clone = version_id.clone();
        let project_id_clone = project_id.clone();
        let original_abs_path = version_paths.original_abs_path.clone();
        let derived_dir_abs = version_paths.derived_dir_abs.clone();
        let cancel_for_task = cancel_flag.clone();
        let job_id_clone = job_id.clone();

        tokio::spawn(async move {
            let ctx = review_core::processor::ReviewCoreProcessContext {
                app: app_clone.clone(),
                db: app_state.db.clone(),
                job_manager: app_state.job_manager.clone(),
                review_core_base_dir: app_state.review_core_base_dir.clone(),
                job_id: job_id_clone.clone(),
                cancel_flag: cancel_for_task.clone(),
            };

            let result = review_core::processor::process_asset_version(
                ctx,
                project_id_clone,
                asset_id_clone.clone(),
                version_id_clone.clone(),
                original_abs_path,
                derived_dir_abs,
            )
            .await;

            if let Err(error) = result {
                let compact = compact_error(&error);
                let _ = app_state
                    .db
                    .set_asset_error(&asset_id_clone, "failed", Some(&compact));
                let _ = app_state.db.set_asset_version_error(
                    &version_id_clone,
                    "failed",
                    Some(&compact),
                );
                if !crate::jobs::JobManager::is_cancelled(&cancel_for_task) {
                    app_state.job_manager.mark_failed(&job_id_clone, &compact);
                }
                emit_job_state(&app_clone, &app_state.job_manager, &job_id_clone);
            }
        });

        asset_ids.push(asset_id);
    }

    Ok(ReviewCoreIngestResult { asset_ids })
}

// ─── Types ───

#[derive(serde::Serialize)]
pub struct ScanResult {
    pub project_id: String,
    pub project_name: String,
    pub clip_count: usize,
    pub clips: Vec<Clip>,
}

#[derive(serde::Serialize)]
pub struct ClipWithThumbnails {
    pub clip: Clip,
    pub thumbnails: Vec<Thumbnail>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SceneBlockWithClips {
    pub block: SceneBlock,
    pub clips: Vec<Clip>,
}

#[derive(serde::Serialize, Clone)]
pub struct ThumbnailProgress {
    pub project_id: String,
    pub clip_id: String,
    pub clip_index: usize,
    pub total_clips: usize,
    pub status: String,
    pub thumbnails: Vec<Thumbnail>,
}

// ─── Helpers ───

fn rescan_project_internal(
    db: &Database,
    project_id: &str,
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> Result<Vec<Clip>, String> {
    let roots = db
        .list_project_roots(project_id)
        .map_err(|e| format!("Failed listing project roots: {}", e))?;
    if roots.is_empty() {
        return Ok(vec![]);
    }

    let mut clips: Vec<Clip> = Vec::new();
    let mut seen_ids: Vec<String> = Vec::new();
    for root in roots {
        #[cfg(target_os = "macos")]
        let _bookmark_guard = root.bookmark.as_ref().and_then(|data| {
            mac_bookmarks::start_accessing_bookmark(data).ok()
        });

        let files = scanner::scan_folder(&root.root_path, cancel_flag);
        for file_path in files {
            let rel_path = std::path::Path::new(&file_path)
                .strip_prefix(&root.root_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| file_path.clone());
            let clip_id = generate_clip_id(&root.id, &rel_path);
            let existing = db.get_clip(&clip_id).ok().flatten();
            let clip = build_clip_from_file(db, project_id, &root, &file_path, &rel_path, existing);
            seen_ids.push(clip.id.clone());
            if let Err(e) = db.upsert_clip(&clip) {
                eprintln!("scan: failed to upsert clip {}: {}", clip.id, e);
            }
            clips.push(clip);
        }
    }

    if let Err(e) = db.prune_project_clips(project_id, &seen_ids) {
        eprintln!("scan: prune project clips failed: {}", e);
    }
    db.get_clips(project_id)
        .map_err(|e| format!("Failed to load rescanned clips: {}", e))
}

fn build_clip_from_file(
    _db: &Database,
    project_id: &str,
    root: &ProjectRoot,
    file_path: &str,
    rel_path: &str,
    existing: Option<Clip>,
) -> Clip {
    let meta = ffprobe::probe_file(file_path);
    let clip_id = generate_clip_id(&root.id, rel_path);
    match meta {
        Ok(m) => {
            let status = if m.timecode.is_none() { "warn" } else { "ok" };
            Clip {
                id: clip_id,
                project_id: project_id.to_string(),
                root_id: root.id.clone(),
                rel_path: rel_path.to_string(),
                filename: m.filename,
                file_path: m.file_path,
                size_bytes: m.size_bytes,
                created_at: m.created_at,
                duration_ms: m.duration_ms,
                fps: m.fps,
                width: m.width,
                height: m.height,
                video_codec: m.video_codec,
                video_bitrate: m.video_bitrate,
                format_name: m.format_name,
                audio_codec: m.audio_codec,
                audio_channels: m.audio_channels,
                audio_sample_rate: m.audio_sample_rate,
                camera_iso: m.camera_iso,
                camera_white_balance: m.camera_white_balance,
                camera_lens: m.camera_lens,
                camera_aperture: m.camera_aperture,
                camera_angle: m.camera_angle,
                audio_summary: m.audio_summary,
                timecode: m.timecode,
                status: status.to_string(),
                rating: existing.as_ref().map(|c| c.rating).unwrap_or(0),
                flag: existing
                    .as_ref()
                    .map(|c| c.flag.clone())
                    .unwrap_or_else(|| "none".to_string()),
                notes: existing.as_ref().and_then(|c| c.notes.clone()),
                shot_size: existing.as_ref().and_then(|c| c.shot_size.clone()),
                movement: existing.as_ref().and_then(|c| c.movement.clone()),
                manual_order: existing.as_ref().map(|c| c.manual_order).unwrap_or(0),
                audio_envelope: existing.as_ref().and_then(|c| c.audio_envelope.clone()),
                lut_enabled: existing.as_ref().map(|c| c.lut_enabled).unwrap_or(0),
            }
        }
        Err(e) => {
            let filename = std::path::Path::new(file_path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            Clip {
                id: clip_id,
                project_id: project_id.to_string(),
                root_id: root.id.clone(),
                rel_path: rel_path.to_string(),
                filename,
                file_path: file_path.to_string(),
                size_bytes: 0,
                created_at: String::new(),
                duration_ms: 0,
                fps: 0.0,
                width: 0,
                height: 0,
                video_codec: "unknown".to_string(),
                video_bitrate: 0,
                format_name: "unknown".to_string(),
                audio_codec: "none".to_string(),
                audio_channels: 0,
                audio_sample_rate: 0,
                camera_iso: None,
                camera_white_balance: None,
                camera_lens: None,
                camera_aperture: None,
                camera_angle: None,
                audio_summary: format!("Error: {}", e),
                timecode: None,
                status: "fail".to_string(),
                rating: existing.as_ref().map(|c| c.rating).unwrap_or(0),
                flag: existing
                    .as_ref()
                    .map(|c| c.flag.clone())
                    .unwrap_or_else(|| "none".to_string()),
                notes: existing.as_ref().and_then(|c| c.notes.clone()),
                shot_size: existing.as_ref().and_then(|c| c.shot_size.clone()),
                movement: existing.as_ref().and_then(|c| c.movement.clone()),
                manual_order: existing.as_ref().map(|c| c.manual_order).unwrap_or(0),
                audio_envelope: existing.as_ref().and_then(|c| c.audio_envelope.clone()),
                lut_enabled: existing.as_ref().map(|c| c.lut_enabled).unwrap_or(0),
            }
        }
    }
}

fn hash_string(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn generate_clip_id(root_id: &str, rel_path: &str) -> String {
    let input = format!("{}:{}", root_id, rel_path);
    hash_string(&input)
}

fn resolve_clips_for_scope(
    db: &Database,
    project_id: &str,
    scope: &str,
    min_rating: Option<i32>,
    block_ids: Option<Vec<String>>,
) -> Result<Vec<Clip>, String> {
    let clips = if scope == "selected_blocks" {
        let selected_blocks = block_ids.unwrap_or_default();
        if selected_blocks.is_empty() {
            return Ok(vec![]);
        }
        let clip_ids = db
            .get_clip_ids_for_blocks(&selected_blocks)
            .map_err(|e| e.to_string())?;
        if clip_ids.is_empty() {
            vec![]
        } else {
            db.get_clips_by_ids(&clip_ids).map_err(|e| e.to_string())?
        }
    } else {
        db.get_clips(project_id).map_err(|e| e.to_string())?
    };

    let mut result: Vec<Clip> = clips
        .into_iter()
        .filter(|c| c.flag != "reject")
        .filter(|c| match scope {
            "picks" => c.flag == "pick",
            "rated" => c.rating > 0,
            "rated_min" => c.rating >= min_rating.unwrap_or(3),
            "selected_blocks" => true,
            _ => true,
        })
        .collect();

    result.sort_by_key(|c| c.manual_order);
    Ok(result)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn checksum_sha256(source: &Path) -> Result<String, String> {
    let input = std::fs::File::open(source).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(input);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 128];

    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn copy_file(source: &Path, destination: &Path) -> Result<u64, String> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let input = std::fs::File::open(source).map_err(|e| e.to_string())?;
    let output = std::fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(input);
    let mut writer = BufWriter::new(output);
    let mut total_bytes = 0u64;
    let mut buffer = [0u8; 1024 * 128];

    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| e.to_string())?;
        total_bytes += read as u64;
    }
    writer.flush().map_err(|e| e.to_string())?;

    Ok(total_bytes)
}

fn compact_error(input: &str) -> String {
    let normalized = input
        .replace('\n', " ")
        .replace('\r', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    normalized.chars().take(280).collect()
}

fn clamp_frame_note_timestamp(timestamp_ms: i64, duration_ms: Option<u64>) -> i64 {
    let clamped = timestamp_ms.max(0);
    if let Some(duration) = duration_ms {
        let safe_end = (duration as i64 - 100).max(0);
        clamped.min(safe_end)
    } else {
        clamped
    }
}

fn rational_fps_from_asset(asset: &Asset) -> Option<f64> {
    asset
        .avg_frame_rate
        .as_deref()
        .or(asset.r_frame_rate.as_deref())
        .map(parse_rational_fps)
        .or(asset.frame_rate)
}

fn parse_rational_fps(raw: &str) -> f64 {
    if let Some((num, den)) = raw.split_once('/') {
        let numerator = num.parse::<f64>().unwrap_or(0.0);
        let denominator = den.parse::<f64>().unwrap_or(1.0);
        if numerator > 0.0 && denominator > 0.0 {
            return numerator / denominator;
        }
    }
    raw.parse::<f64>().unwrap_or(0.0)
}

fn compute_comment_frame_number(
    asset: &Asset,
    timestamp_ms: i64,
    requested_frame_number: Option<i64>,
) -> Option<i64> {
    if asset.is_vfr {
        return None;
    }
    if let Some(frame) = requested_frame_number {
        return Some(frame.max(0));
    }
    let fps = rational_fps_from_asset(asset)?;
    if fps <= 0.0 {
        return None;
    }
    Some(((timestamp_ms as f64 / 1000.0) * fps).round() as i64)
}

fn review_core_ffmpeg_run(args: &[String]) -> Result<(), String> {
    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let output = Command::new(ffmpeg)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

fn normalize_annotation_vector_data(
    raw: &str,
    comment_id: &str,
    timestamp_ms: i64,
) -> Result<String, String> {
    let mut value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid annotation JSON: {}", e))?;
    let object = value
        .as_object_mut()
        .ok_or("Annotation payload must be a JSON object")?;
    let schema_version = object
        .get("schemaVersion")
        .and_then(|value| value.as_i64())
        .ok_or("Annotation payload must include schemaVersion")?;
    if schema_version != 1 {
        return Err("Unsupported annotation schemaVersion".to_string());
    }
    object.insert(
        "commentId".to_string(),
        serde_json::Value::String(comment_id.to_string()),
    );
    object.insert(
        "timestampMs".to_string(),
        serde_json::Value::Number(timestamp_ms.into()),
    );
    clamp_annotation_value(&mut value);
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

fn normalize_frame_note_vector_data(raw: &str, timestamp_ms: i64) -> Result<String, String> {
    let mut value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid frame note JSON: {}", e))?;
    if value.is_array() {
        value = serde_json::json!({
            "schemaVersion": 1,
            "timestampMs": timestamp_ms,
            "items": value,
        });
    }
    let object = value
        .as_object_mut()
        .ok_or("Frame note payload must be a JSON object or array")?;
    let schema_version = object
        .get("schemaVersion")
        .and_then(|entry| entry.as_i64())
        .unwrap_or(1);
    if schema_version != 1 {
        return Err("Unsupported frame note schemaVersion".to_string());
    }
    object.insert(
        "schemaVersion".to_string(),
        serde_json::Value::Number(1.into()),
    );
    object.insert(
        "timestampMs".to_string(),
        serde_json::Value::Number(timestamp_ms.into()),
    );
    if !object.contains_key("items") {
        object.insert("items".to_string(), serde_json::Value::Array(Vec::new()));
    }
    clamp_annotation_value(&mut value);
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

fn build_frame_note_url(
    state: &State<'_, Arc<AppState>>,
    project_id: &str,
    asset_id: &str,
    asset_version_id: &str,
    note_id: &str,
    file_name: &str,
) -> Result<String, String> {
    let base = state
        .review_core_server_base_url
        .lock()
        .map_err(|_| "Failed to lock Review Core server URL".to_string())?
        .clone()
        .unwrap_or_default();
    Ok(format!(
        "{}/frame-notes/{}/{}/{}/{}/{}",
        base, project_id, asset_id, asset_version_id, note_id, file_name
    ))
}

fn frame_note_to_summary(
    state: &State<'_, Arc<AppState>>,
    note: ReviewCoreFrameNote,
) -> Result<ReviewCoreFrameNoteSummary, String> {
    let image_path =
        review_core::storage::safe_relative_path(&state.review_core_base_dir, &note.image_key)?;
    Ok(ReviewCoreFrameNoteSummary {
        id: note.id.clone(),
        project_id: note.project_id.clone(),
        asset_id: note.asset_id.clone(),
        asset_version_id: note.asset_version_id.clone(),
        timestamp_ms: note.timestamp_ms,
        frame_number: note.frame_number,
        title: note.title.clone().filter(|value| !value.is_empty()),
        image_key: note.image_key.clone(),
        image_path: image_path.to_string_lossy().to_string(),
        frame_url: build_frame_note_url(
            state,
            &note.project_id,
            &note.asset_id,
            &note.asset_version_id,
            &note.id,
            "frame.jpg",
        )?,
        vector_data: note.vector_data.clone(),
        created_at: note.created_at.clone(),
        updated_at: note.updated_at.clone(),
        hidden: note.hidden,
    })
}

fn clamp_annotation_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if matches!(key.as_str(), "x" | "y" | "w" | "h") {
                    if let Some(number) = item.as_f64() {
                        *item = serde_json::json!(number.clamp(0.0, 1.0));
                        continue;
                    }
                }
                if matches!(key.as_str(), "a" | "b" | "points") {
                    clamp_normalized_points(item);
                    continue;
                }
                clamp_annotation_value(item);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                clamp_annotation_value(item);
            }
        }
        _ => {}
    }
}

fn clamp_normalized_points(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Array(items) => {
            if items.len() == 2 && items[0].is_number() && items[1].is_number() {
                let x = items[0].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                let y = items[1].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                *value = serde_json::json!([x, y]);
                return;
            }
            for item in items {
                clamp_normalized_points(item);
            }
        }
        _ => clamp_annotation_value(value),
    }
}

fn generate_share_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn normalize_expiry(expires_at: Option<String>) -> Result<Option<String>, String> {
    match expires_at {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                let parsed = chrono::DateTime::parse_from_rfc3339(trimmed)
                    .map_err(|_| "Invalid expires_at format; expected RFC3339".to_string())?;
                Ok(Some(parsed.with_timezone(&chrono::Utc).to_rfc3339()))
            }
        }
        None => Ok(None),
    }
}

fn validate_share_link_versions(
    db: &Database,
    project_id: &str,
    asset_version_ids: &[String],
) -> Result<Vec<String>, String> {
    if asset_version_ids.is_empty() {
        return Err("At least one version must be included".to_string());
    }
    let mut canonical = asset_version_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    canonical.sort();
    canonical.dedup();
    if canonical.is_empty() {
        return Err("At least one version must be included".to_string());
    }
    for version_id in &canonical {
        let version = db
            .get_asset_version(version_id)
            .map_err(|e| e.to_string())?
            .ok_or("Asset version not found")?;
        let asset = db
            .get_asset(&version.asset_id)
            .map_err(|e| e.to_string())?
            .ok_or("Asset not found")?;
        if asset.project_id != project_id {
            return Err("All versions must belong to the target project".to_string());
        }
    }
    Ok(canonical)
}

fn share_link_version_ids(link: &ReviewCoreShareLink) -> Result<Vec<String>, String> {
    let mut ids: Vec<String> =
        serde_json::from_str(&link.asset_version_ids_json).map_err(|e| e.to_string())?;
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn share_link_to_summary(link: &ReviewCoreShareLink) -> Result<ReviewCoreShareLinkSummary, String> {
    Ok(ReviewCoreShareLinkSummary {
        id: link.id.clone(),
        project_id: link.project_id.clone(),
        token: link.token.clone(),
        asset_version_ids: share_link_version_ids(link)?,
        expires_at: link.expires_at.clone(),
        allow_comments: link.allow_comments,
        allow_download: link.allow_download,
        password_required: link.password_hash.is_some(),
        created_at: link.created_at.clone(),
    })
}

pub(crate) fn resolve_share_link(
    db: &Database,
    token: &str,
) -> Result<(ReviewCoreShareLink, Vec<String>), ReviewCoreShareError> {
    let link = db
        .get_review_core_share_link_by_token(token)
        .map_err(|_| ReviewCoreShareError::NotFound)?
        .ok_or(ReviewCoreShareError::NotFound)?;
    if let Some(expires_at) = link.expires_at.as_deref() {
        let expiry = chrono::DateTime::parse_from_rfc3339(expires_at)
            .map_err(|_| ReviewCoreShareError::Expired)?
            .with_timezone(&chrono::Utc);
        if expiry <= chrono::Utc::now() {
            return Err(ReviewCoreShareError::Expired);
        }
    }
    let version_ids = share_link_version_ids(&link).map_err(|_| ReviewCoreShareError::Forbidden)?;
    Ok((link, version_ids))
}

pub(crate) fn validate_share_session(
    db: &Database,
    link: &ReviewCoreShareLink,
    session_token: Option<&str>,
) -> Result<(), ReviewCoreShareError> {
    if link.password_hash.is_none() {
        return Ok(());
    }
    let token = session_token.ok_or(ReviewCoreShareError::Forbidden)?;
    let session = db
        .get_review_core_share_session_by_token(token)
        .map_err(|_| ReviewCoreShareError::Forbidden)?
        .ok_or(ReviewCoreShareError::Forbidden)?;
    if session.share_link_id != link.id {
        return Err(ReviewCoreShareError::Forbidden);
    }
    let expiry = chrono::DateTime::parse_from_rfc3339(&session.expires_at)
        .map_err(|_| ReviewCoreShareError::Forbidden)?
        .with_timezone(&chrono::Utc);
    if expiry <= chrono::Utc::now() {
        return Err(ReviewCoreShareError::Forbidden);
    }
    let now = chrono::Utc::now();
    let renewed_expiry = now + chrono::Duration::minutes(30);
    db.touch_review_core_share_session(
        &session.id,
        &renewed_expiry.to_rfc3339(),
        &now.to_rfc3339(),
    )
    .map_err(|_| ReviewCoreShareError::Forbidden)?;
    Ok(())
}

fn build_verification_badge_svg(job: &VerificationJob) -> String {
    let date_label = job
        .ended_at
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240" fill="none">
<rect x="1" y="1" width="718" height="238" rx="24" fill="#0E0E11" stroke="#00D1FF" stroke-opacity="0.32" stroke-width="2"/>
<rect x="28" y="28" width="92" height="92" rx="20" fill="#08080A"/>
<path d="M80.83 72.727H97.52L97.512 73.763L79.285 73.802C72.267 73.818 62.624 75.923 56.369 79.224C54.912 80.029 53.489 80.855 52.314 82.082L42.444 91.741C42.168 91.52 41.917 91.264 41.666 91L51.354 81.48C51.921 80.925 52.334 80.277 52.614 79.581C52.98 78.655 52.757 77.731 52.087 77.015C50.203 75.01 47.865 74.503 43.247 74.179C42.562 74.137 41.965 74.072 41.264 74.072H18.8V73.734L41.28 73.688C48.339 73.672 57.889 71.563 64.106 68.194C65.44 67.467 66.694 66.686 67.775 65.62L77.082 56.42L78.336 56.312L68.617 66.203C67.379 67.41 66.297 69.223 67.677 70.742C69.011 72.197 71.565 72.852 73.495 73.187C75.568 73.55 77.586 73.617 80.83 72.727Z" fill="#FFFEEF" transform="translate(17 10) scale(0.95)"/>
<text x="148" y="74" fill="#F4F4F5" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700">Wrap Preview</text>
<text x="148" y="112" fill="#00D1FF" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700">Verified</text>
<text x="148" y="148" fill="#A1A1AA" font-family="Helvetica, Arial, sans-serif" font-size="18">Mode: {mode}</text>
<text x="148" y="176" fill="#A1A1AA" font-family="Helvetica, Arial, sans-serif" font-size="18">Date: {date_label}</text>
<text x="28" y="212" fill="#71717A" font-family="Helvetica, Arial, sans-serif" font-size="16">Generated by Wrap Preview — offline media verification for creatives.</text>
</svg>"##,
        mode = job.mode,
        date_label = date_label
    )
}

fn collision_safe_path(base_dir: &str, stem: &str, ext: &str) -> String {
    let mut candidate = std::path::PathBuf::from(base_dir);
    candidate.push(format!("{}.{}", stem, ext));
    if !candidate.exists() {
        return candidate.to_string_lossy().to_string();
    }
    for suffix in 1..1000 {
        let mut next = std::path::PathBuf::from(base_dir);
        next.push(format!("{}_{:02}.{}", stem, suffix, ext));
        if !next.exists() {
            return next.to_string_lossy().to_string();
        }
    }
    candidate.to_string_lossy().to_string()
}

fn write_simple_contact_sheet_pdf(
    output_path: &str,
    project_name: &str,
    clips: &[Clip],
    brand_name: &str,
    cache_dir: &str,
) -> Result<(), String> {
    use printpdf::*;
    use std::fs::File;
    use std::io::BufWriter;

    let (doc, page1, layer1) = PdfDocument::new(
        &format!("{} Contact Sheet", project_name),
        Mm(210.0), // A4 Portrait
        Mm(297.0),
        "Main",
    );

    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;

    let mut current_page = page1;
    let mut current_layer = doc.get_page(current_page).get_layer(layer1);

    let margin_x = 15.0f32;
    let margin_top = 25.0f32;
    let grid_cols = 3;
    let cell_width = (210.0f32 - (margin_x * 2.0f32)) / grid_cols as f32;
    let thumb_w = cell_width - 4.0f32;
    let thumb_h = thumb_w * 9.0f32 / 16.0f32;
    let cell_height = thumb_h + 20.0f32;

    let mut x_idx = 0;
    let mut y_pos = 297.0f32 - margin_top;

    // Header on first page
    current_layer.use_text(brand_name, 12.0f32, Mm(margin_x), Mm(285.0f32), &font_bold);
    current_layer.use_text(
        format!("Project: {}", project_name),
        10.0f32,
        Mm(margin_x),
        Mm(280.0f32),
        &font_regular,
    );
    current_layer.use_text(
        format!("Total Clips: {}", clips.len()),
        8.0f32,
        Mm(160.0f32),
        Mm(280.0f32),
        &font_regular,
    );

    y_pos -= 15.0;

    for (idx, clip) in clips.iter().enumerate() {
        if idx > 0 && idx % (grid_cols * 5) == 0 {
            // New Page every 15 clips (5 rows of 3)
            let (p, l) = doc.add_page(Mm(210.0), Mm(297.0), format!("Page {}", idx / 15 + 1));
            current_page = p;
            current_layer = doc.get_page(current_page).get_layer(l);
            x_idx = 0;
            y_pos = 297.0f32 - margin_top;

            // Re-apply header on new page
            current_layer.use_text(
                brand_name,
                9.0f32,
                Mm(margin_x as f32),
                Mm(288.0f32),
                &font_bold,
            );
        }

        let x = margin_x + (x_idx as f32 * cell_width);
        let y = y_pos - thumb_h;

        // Try to load thumbnail
        let thumb_path = format!("{}/{}/thumb_0.jpg", cache_dir, clip.id);
        let thumb_path_png = format!("{}/{}/thumb_0.png", cache_dir, clip.id);

        let final_thumb = if Path::new(&thumb_path).exists() {
            Some(thumb_path)
        } else if Path::new(&thumb_path_png).exists() {
            Some(thumb_path_png)
        } else {
            None
        };

        if let Some(tp) = final_thumb {
            if let Ok(file) = File::open(&tp) {
                let img_result: Result<printpdf::Image, String> = {
                    let format = if tp.ends_with(".png") {
                        ::image::ImageFormat::Png
                    } else {
                        ::image::ImageFormat::Jpeg
                    };
                    let dynamic_image = ::image::load(std::io::BufReader::new(file), format)
                        .map_err(|e| e.to_string())?;
                    Ok(printpdf::Image::from_dynamic_image(&dynamic_image))
                };

                if let Ok(image) = img_result {
                    let w = image.image.width.0 as f32;
                    image.add_to_layer(
                        current_layer.clone(),
                        ImageTransform {
                            translate_x: Some(Mm(x + 2.0f32)),
                            translate_y: Some(Mm(y)),
                            scale_x: Some(((thumb_w / w) * 0.264583f32 * 2.8f32) as f32),
                            scale_y: Some(((thumb_w / w) * 0.264583f32 * 2.8f32) as f32),
                            ..Default::default()
                        },
                    );
                }
            }
        }

        // Clip Info
        current_layer.use_text(
            &clip.filename,
            7.0f32,
            Mm(x + 2.0f32),
            Mm(y - 4.0f32),
            &font_bold,
        );

        let meta = format!(
            "{} | {:.2} fps | Rating: {}",
            clip.audio_summary.chars().take(15).collect::<String>(),
            clip.fps,
            "★".repeat(clip.rating as usize)
        );
        current_layer.use_text(meta, 6.0f32, Mm(x + 2.0f32), Mm(y - 7.0f32), &font_regular);

        if let Some(notes) = &clip.notes {
            if !notes.is_empty() {
                let note_preview = if notes.len() > 30 {
                    format!("{}...", &notes[0..27])
                } else {
                    notes.clone()
                };
                current_layer.use_text(
                    format!("Note: {}", note_preview),
                    5.0f32,
                    Mm(x + 2.0f32),
                    Mm(y - 10.0f32),
                    &font_regular,
                );
            }
        }

        x_idx += 1;
        if x_idx >= grid_cols {
            x_idx = 0;
            y_pos -= cell_height;
        }
    }

    current_layer.use_text(
        format!("© {}. All rights reserved.", brand_name),
        8.0f32,
        Mm(margin_x),
        Mm(10.0f32),
        &font_regular,
    );

    let mut writer = BufWriter::new(File::create(output_path).map_err(|e| e.to_string())?);
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(())
}

fn write_calibration_report_pdf(
    output_path: &Path,
    project_name: &str,
    run: &ProductionMatchLabRun,
    reference_frame_path: &Path,
    overlay_frame_path: &Path,
) -> Result<(), String> {
    use printpdf::*;
    use std::fs::File;
    use std::io::BufWriter;

    let (doc, page1, layer1) = PdfDocument::new(
        &format!("{} Calibration Report", project_name),
        Mm(297.0),
        Mm(210.0),
        "Calibration",
    );
    let layer = doc.get_page(page1).get_layer(layer1);
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;

    layer.use_text("Wrap Preview", 11.0, Mm(18.0), Mm(198.0), &font_bold);
    layer.use_text("Calibration Report", 22.0, Mm(18.0), Mm(186.0), &font_bold);
    layer.use_text(
        format!("Project: {}", project_name),
        11.0,
        Mm(18.0),
        Mm(176.0),
        &font_regular,
    );
    layer.use_text(
        format!("Date: {}", run.created_at),
        11.0,
        Mm(18.0),
        Mm(169.0),
        &font_regular,
    );
    layer.use_text(
        format!("Hero: Camera {}", run.hero_slot),
        11.0,
        Mm(18.0),
        Mm(162.0),
        &font_regular,
    );

    let reference_image = load_pdf_image(reference_frame_path)?;
    reference_image.add_to_layer(
        layer.clone(),
        ImageTransform {
            translate_x: Some(Mm(18.0)),
            translate_y: Some(Mm(102.0)),
            scale_x: Some(0.42),
            scale_y: Some(0.42),
            ..Default::default()
        },
    );
    let overlay_image = load_pdf_image(overlay_frame_path)?;
    overlay_image.add_to_layer(
        layer.clone(),
        ImageTransform {
            translate_x: Some(Mm(145.0)),
            translate_y: Some(Mm(102.0)),
            scale_x: Some(0.42),
            scale_y: Some(0.42),
            ..Default::default()
        },
    );

    layer.use_text("Reference Frame", 10.0, Mm(18.0), Mm(97.0), &font_bold);
    layer.use_text("Patch Overlay", 10.0, Mm(145.0), Mm(97.0), &font_bold);

    let mut cursor_y = 82.0;
    for result in &run.results {
        let calibration = match result.calibration.as_ref() {
            Some(calibration) if calibration.chart_detected => calibration,
            _ => continue,
        };
        let lut_name = if result.slot == run.hero_slot {
            "Hero baseline".to_string()
        } else {
            calibration
                .lut_path
                .as_ref()
                .and_then(|path| Path::new(path).file_name().and_then(|name| name.to_str()))
                .unwrap_or("Missing LUT")
                .to_string()
        };
        layer.use_text(
            format!(
                "Camera {}  Quality {} {}  dE {:.1} → {}  Exposure {}  WB {}K  Tint {}  LUT {}",
                result.slot,
                calibration.calibration_quality_score,
                calibration.calibration_quality_level,
                calibration.mean_delta_e_before,
                calibration
                    .mean_delta_e_after
                    .map(|value| format!("{:.1}", value))
                    .unwrap_or_else(|| "—".to_string()),
                if result.slot == run.hero_slot {
                    "baseline".to_string()
                } else {
                    format!("{:.2}x", calibration.calibration_transform.as_ref().map(|transform| transform.exposure_scalar).unwrap_or(1.0))
                },
                calibration.wb_kelvin_shift,
                calibration.tint_shift,
                lut_name,
            ),
            9.0,
            Mm(18.0),
            Mm(cursor_y),
            &font_regular,
        );
        cursor_y -= 7.0;
        if !calibration.warnings.is_empty() {
            layer.use_text(
                format!(
                    "Warnings: {}",
                    calibration
                        .warnings
                        .iter()
                        .take(3)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" • ")
                ),
                8.0,
                Mm(22.0),
                Mm(cursor_y),
                &font_regular,
            );
            cursor_y -= 6.0;
        }
    }

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut writer = BufWriter::new(File::create(output_path).map_err(|e| e.to_string())?);
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_pdf_image(path: &Path) -> Result<printpdf::Image, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed opening calibration image {}: {}", path.display(), error))?;
    let format = if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        ::image::ImageFormat::Png
    } else {
        ::image::ImageFormat::Jpeg
    };
    let dynamic_image = ::image::load(std::io::BufReader::new(file), format)
        .map_err(|error| format!("Failed reading calibration image {}: {}", path.display(), error))?;
    Ok(printpdf::Image::from_dynamic_image(&dynamic_image))
}

fn emit_job_state(app: &AppHandle, manager: &crate::jobs::JobManager, job_id: &str) {
    if let Some(job) = manager.get_job(job_id) {
        if let Err(e) = app.emit("job-progress", job) {
            eprintln!("job-progress emit failed: {}", e);
        }
    }
}

fn derive_labels(label: Option<String>, idx: i32) -> (String, String) {
    let default = format!("Check {:02}", idx);
    let raw = label.unwrap_or(default);
    if let Some((left, right)) = raw.split_once("→") {
        return (left.trim().to_string(), right.trim().to_string());
    }
    if let Some((left, right)) = raw.split_once("->") {
        return (left.trim().to_string(), right.trim().to_string());
    }
    (format!("{} Source", raw), format!("{} Destination", raw))
}

fn upsert_cancelled_verification_job(
    db: &Database,
    project_id: &str,
    job_id: &str,
    item: &VerificationQueueItem,
    mode: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let (source_label, dest_label) = derive_labels(item.label.clone(), item.idx);
    let job = VerificationJob {
        id: job_id.to_string(),
        project_id: project_id.to_string(),
        created_at: now.clone(),
        source_path: item.source_path.clone(),
        source_root: item.source_path.clone(),
        source_label,
        dest_path: item.dest_path.clone(),
        dest_root: item.dest_path.clone(),
        dest_label,
        mode: mode.to_string(),
        status: "CANCELLED".to_string(),
        started_at: Some(now.clone()),
        ended_at: Some(now),
        duration_ms: Some(0),
        counts_json: Some(
            serde_json::json!({
                "verified": 0,
                "missing": 0,
                "size_mismatch": 0,
                "hash_mismatch": 0,
                "unreadable": 0,
                "extra_in_dest": 0
            })
            .to_string(),
        ),
        issues_json: Some("[]".to_string()),
        total_files: 0,
        total_bytes: 0,
        verified_ok_count: 0,
        missing_count: 0,
        size_mismatch_count: 0,
        hash_mismatch_count: 0,
        unreadable_count: 0,
        extra_in_dest_count: 0,
    };
    db.insert_verification_job(&job)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn synthetic_cut_points(duration_ms: u64, threshold: f64) -> Vec<u64> {
    if duration_ms < 1500 {
        return vec![];
    }
    let min_gap = ((1000.0 / threshold.max(0.05)) as u64).clamp(1200, 8000);
    let mut cuts = Vec::new();
    let mut t = min_gap;
    while t < duration_ms.saturating_sub(500) {
        cuts.push(t);
        t = t.saturating_add(min_gap);
    }
    cuts
}

fn command_first_line(bin: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(bin).args(args).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|s| s.trim().to_string())
}

async fn camera_match_analyze_clip_internal(
    project_id: &str,
    camera_slot: &str,
    clip_path: &str,
    frame_count: u32,
    analysis_source_override_path: Option<&str>,
    app: &AppHandle,
    state: Arc<AppState>,
) -> Result<CameraMatchAnalysisResult, String> {
    let clip_name = clip_name_from_path(clip_path);
    let analysis_source_key = analysis_source_override_path.unwrap_or(clip_path);
    let analysis_key = format!(
        "{}:{}:{}",
        project_id,
        camera_slot,
        hash_source_signature(analysis_source_key)
    );
    let cache_dir = build_cache_dir(&state.cache_dir, project_id, camera_slot, clip_path);
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create match lab cache: {}", e))?;
    {
        let mut running = state
            .production_matchlab_analysis_tracker
            .running
            .lock()
            .unwrap();
        if running.contains_key(&analysis_key) {
            return Err("Analysis already running for this slot and source.".to_string());
        }
        running.insert(analysis_key.clone(), clip_name.clone());
    }

    let job_kind = format!("camera_match_analysis_{}", camera_slot);
    let (job_id, cancel_flag) = state.job_manager.create_job(&job_kind, None);
    state
        .job_manager
        .mark_running(&job_id, &format!("Analyzing {}", clip_name));
    emit_job_state(app, &state.job_manager, &job_id);

    let result: Result<CameraMatchAnalysisResult, String> = async {
        let mut proxy_info: Option<String> = None;
        let source_path = if let Some(override_path) = analysis_source_override_path {
            validate_analysis_override_path(override_path)?;
            proxy_info = Some("Override source: operator-selected proxy".to_string());
            override_path.to_string()
        } else if is_decoder_backed_raw_path(clip_path) {
            let proxy_result =
                ensure_matchlab_proxy_internal(project_id, camera_slot, clip_path, app, state.clone())
                    .await?;
            proxy_info = Some(format!(
                "Proxy: {} | Decoder: {} | Strategy: {}",
                proxy_result.proxy_path,
                proxy_result
                    .decoder_path
                    .unwrap_or_else(|| "unknown".to_string()),
                proxy_result.strategy.unwrap_or_else(|| "unknown".to_string())
            ));
            proxy_result.proxy_path
        } else {
            choose_source_path_for_analysis(clip_path)?
        };
        let metadata = ffprobe::probe_file(&source_path)?;
        let timestamps = build_frame_timestamps(metadata.duration_ms, frame_count);
        let total_steps = timestamps.len().max(1) as f32;
        let mut per_frame = Vec::with_capacity(timestamps.len());
        let mut analysis_warnings: Vec<String> = Vec::new();

        for (index, timestamp_ms) in timestamps.iter().enumerate() {
            if crate::jobs::JobManager::is_cancelled(&cancel_flag) {
                return Err("Camera Match Lab analysis cancelled".to_string());
            }

            let output_path = cache_dir.join(format!("frame_{}.jpg", index));
            let source_path_for_task = source_path.clone();
            let output_path_for_task = output_path.clone();
            let timestamp_ms_for_task = *timestamp_ms;

            let extraction_result = tokio::time::timeout(
                analysis_timeout(),
                tokio::task::spawn_blocking(move || {
                    crate::production_match_lab::extract_jpeg_frame_with_fallbacks(
                        &source_path_for_task,
                        timestamp_ms_for_task,
                        &output_path_for_task,
                    )
                }),
            )
            .await
            .map_err(|_| "Frame extraction timed out".to_string())?
            .map_err(|e| format!("Frame extraction task failed: {}", e))?;

            let extraction_result = match extraction_result {
                Ok(value) => value,
                Err(frame_error) => {
                    analysis_warnings.push(format!(
                        "Frame {} failed at {}ms: {}",
                        index + 1,
                        timestamp_ms,
                        frame_error.lines().next().unwrap_or("unknown extraction error")
                    ));
                    state.job_manager.update_progress(
                        &job_id,
                        (index as f32 + 1.0) / total_steps,
                        Some(format!("Skipped frame {} due to decode issue", index + 1)),
                    );
                    emit_job_state(app, &state.job_manager, &job_id);
                    continue;
                }
            };

            let output_path_for_metrics = output_path.clone();
            let used_timestamp_ms = extraction_result.used_timestamp_ms;
            let extraction_strategy = extraction_result.strategy_label;
            let frame_metric = tokio::time::timeout(
                analysis_timeout(),
                tokio::task::spawn_blocking(move || {
                    analyze_frame(
                        index as u32,
                        used_timestamp_ms,
                        &output_path_for_metrics,
                        Some(extraction_strategy),
                    )
                }),
            )
            .await
            .map_err(|_| "Frame analysis timed out".to_string())?
            .map_err(|e| format!("Frame analysis task failed: {}", e))??;

            per_frame.push(frame_metric);
            state.job_manager.update_progress(
                &job_id,
                (index as f32 + 1.0) / total_steps,
                Some(format!("Analyzed frame {} of {}", index + 1, timestamps.len())),
            );
            emit_job_state(app, &state.job_manager, &job_id);
        }

        if per_frame.is_empty() {
            return Err("No frames were analyzed".to_string());
        }

        let aggregate = aggregate_frames(&per_frame);
        let representative_index = per_frame.len() / 2;
        let representative_frame_path = per_frame[representative_index].frame_path.clone();
        let frame_paths = per_frame.iter().map(|item| item.frame_path.clone()).collect();

        Ok(CameraMatchAnalysisResult {
            measurement_bundle: build_measurement_bundle(
                &source_path,
                Some(if analysis_source_override_path.is_some() || is_braw_path(clip_path) || is_proxy_only_raw_path(clip_path) {
                    "proxy".to_string()
                } else {
                    "original".to_string()
                }),
                Some(classify_source_format(clip_path)),
                &metadata,
                &aggregate,
            ),
            source_path,
            source_kind: Some(if analysis_source_override_path.is_some() || is_braw_path(clip_path) || is_proxy_only_raw_path(clip_path) {
                "proxy".to_string()
            } else {
                "original".to_string()
            }),
            original_format_kind: Some(classify_source_format(clip_path)),
            clip_path: clip_path.to_string(),
            clip_name: clip_name.clone(),
            representative_frame_path,
            frame_paths,
            per_frame,
            aggregate,
            proxy_info,
            warnings: analysis_warnings,
        })
    }
    .await;

    match &result {
        Ok(done) => {
            state.job_manager.mark_done(
                &job_id,
                &format!("Analyzed {} frames for {}", done.per_frame.len(), done.clip_name),
            );
        }
        Err(error) => {
            state.job_manager.mark_failed(&job_id, error);
        }
    }
    emit_job_state(app, &state.job_manager, &job_id);
    {
        let mut running = state
            .production_matchlab_analysis_tracker
            .running
            .lock()
            .unwrap();
        running.remove(&analysis_key);
    }
    result
}

async fn ensure_matchlab_proxy_internal(
    project_id: &str,
    slot: &str,
    source_path: &str,
    app: &AppHandle,
    state: Arc<AppState>,
) -> Result<ProductionMatchLabProxyResult, String> {
    if !is_decoder_backed_raw_path(source_path) {
        return Ok(ProductionMatchLabProxyResult {
            proxy_path: source_path.to_string(),
            reused_proxy: true,
            decoder_path: None,
            strategy: Some("direct-source".to_string()),
        });
    }

    let source_hash = hash_source_signature(source_path);
    let proxy_key = format!("{}:{}:{}", project_id, slot, source_hash);
    let now_ms = chrono::Utc::now().timestamp_millis();
    {
        let mut attempts = state
            .production_matchlab_proxy_tracker
            .attempts
            .lock()
            .unwrap();
        if let Some(existing) = attempts.get_mut(&proxy_key) {
            if existing.running {
                if let Some(job) = state.job_manager.get_job(&existing.job_id) {
                    if job.status == JobStatus::Running || job.status == JobStatus::Queued {
                        return Err("Proxy is already running for this slot.".to_string());
                    }
                }
                existing.running = false;
            }
            if let Some(last_failed_at_ms) = existing.last_failed_at_ms {
                if now_ms - last_failed_at_ms < 120_000 {
                    return Err("Proxy recently failed. Fix the issue and try again.".to_string());
                }
            }
        }
    }

    let (proxy_root, final_path, tmp_path) =
        build_proxy_paths(&state.cache_dir, project_id, slot, source_path);
    std::fs::create_dir_all(&proxy_root)
        .map_err(|e| format!("Failed to prepare proxy cache: {}", e))?;

    if final_path.exists() {
        if final_path.is_dir() {
            mark_proxy_attempt_failure(&state, &proxy_key, None);
            return Err(format!("Proxy output path is a directory: {}", final_path.display()));
        }
        let size = std::fs::metadata(&final_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if size > 1_000_000 {
            return Ok(ProductionMatchLabProxyResult {
                proxy_path: final_path.to_string_lossy().to_string(),
                reused_proxy: true,
                decoder_path: None,
                strategy: Some("cached-proxy".to_string()),
            });
        }
    }
    if tmp_path.exists() && tmp_path.is_dir() {
        mark_proxy_attempt_failure(&state, &proxy_key, None);
        return Err(format!("Proxy output path is a directory: {}", tmp_path.display()));
    }
    if let Err(error) = validate_proxy_output_path(source_path, &final_path) {
        mark_proxy_attempt_failure(&state, &proxy_key, None);
        return Err(error);
    }
    if let Err(error) = validate_proxy_output_path(source_path, &tmp_path) {
        mark_proxy_attempt_failure(&state, &proxy_key, None);
        return Err(error);
    }

    if tmp_path.exists() {
        let _ = std::fs::remove_file(&tmp_path);
    }

    let clip_name = clip_name_from_path(source_path);
    let job_kind = format!("production_matchlab_proxy_{}", slot);
    let (job_id, cancel_flag) = state.job_manager.create_job(&job_kind, None);
    {
        let mut attempts = state
            .production_matchlab_proxy_tracker
            .attempts
            .lock()
            .unwrap();
        attempts.insert(
            proxy_key.clone(),
            MatchLabProxyAttempt {
                job_id: job_id.clone(),
                running: true,
                last_failed_at_ms: None,
            },
        );
    }

    state
        .job_manager
        .mark_running(&job_id, &format!("Preparing proxy for {}", clip_name));
    emit_job_state(app, &state.job_manager, &job_id);

    let final_string = final_path.to_string_lossy().to_string();
    let is_braw_source = is_braw_path(source_path);
    let braw_decoder_caps = if is_braw_source {
        Some(get_cached_braw_decoder_caps(&state))
    } else {
        None
    };
    let redline_decoder_caps = if !is_braw_source {
        Some(get_cached_redline_decoder_caps(&state))
    } else {
        None
    };
    if let Some(decoder_caps) = braw_decoder_caps.as_ref() {
        if !decoder_caps.found {
            mark_proxy_attempt_failure(&state, &proxy_key, None);
            return Err(format_matchlab_proxy_error(
                "Proxy generation failed",
                "BRAW decode unavailable — install braw-decode or use an MP4 proxy.",
                &format!(
                    "Tool found: {}\nHelp: {}\nNext steps: Install braw-decode on this machine, or pick Use existing MP4 proxy.",
                    decoder_caps.found,
                    decoder_caps.help_excerpt
                ),
            ));
        }
    }
    if let Some(decoder_caps) = redline_decoder_caps.as_ref() {
        if !decoder_caps.found {
            mark_proxy_attempt_failure(&state, &proxy_key, None);
            return Err(format_matchlab_proxy_error(
                "Proxy generation failed",
                "REDline decode unavailable — install REDline/REDCINE-X or use an MP4 proxy.",
                &format!(
                    "Tool found: {}\nHelp: {}\nNext steps: Install REDline on this machine so R3D and Nikon N-RAW can be proxied automatically, or pick Use existing MP4 proxy.",
                    decoder_caps.found,
                    decoder_caps.help_excerpt
                ),
            ));
        }
    }

    let result: Result<ProductionMatchLabProxyResult, String> = async {
        if crate::jobs::JobManager::is_cancelled(&cancel_flag) {
            return Err("Proxy generation cancelled".to_string());
        }

        state.job_manager.update_progress(
            &job_id,
            0.1,
            Some("Preparing proxy output".to_string()),
        );
        emit_job_state(app, &state.job_manager, &job_id);

        let source_for_task = source_path.to_string();
        let tmp_for_task = tmp_path.clone();
        let decoded_for_task = build_proxy_decode_path(&proxy_root);
        let proxy_strategy = tokio::time::timeout(
            std::time::Duration::from_secs(300),
            tokio::task::spawn_blocking(move || {
                if let Some(decoder_caps_for_task) = braw_decoder_caps {
                    if decoder_caps_for_task.supports_stdout {
                        create_braw_proxy_via_stdout(
                            &decoder_caps_for_task,
                            &source_for_task,
                            &tmp_for_task,
                        )?;
                        return Ok(("decoder-stdout-pipe".to_string(), decoder_caps_for_task.executable_path.clone()));
                    }
                    if decoder_caps_for_task.supports_output_flag {
                        create_braw_proxy_via_file(
                            &decoder_caps_for_task,
                            &source_for_task,
                            &decoded_for_task,
                            &tmp_for_task,
                        )?;
                        return Ok(("decoder-file-output".to_string(), decoder_caps_for_task.executable_path.clone()));
                    }
                    return Err(format!(
                        "Tool found: {}\nHelp: {}\nVersion: {}\nNext steps: Verify braw-decode can output a file or stdout stream, or pick Use existing MP4 proxy.",
                        decoder_caps_for_task.found,
                        decoder_caps_for_task.help_excerpt,
                        decoder_caps_for_task.version.unwrap_or_else(|| "unknown".to_string())
                    ));
                }
                if let Some(decoder_caps_for_task) = redline_decoder_caps {
                    create_redline_proxy_via_file(
                        &decoder_caps_for_task,
                        &source_for_task,
                        &decoded_for_task,
                        &tmp_for_task,
                    )?;
                    return Ok(("redline-file-output".to_string(), decoder_caps_for_task.executable_path.clone()));
                }
                Err("No decoder available for this raw source.".to_string())
            }),
        )
        .await
        .map_err(|_| format_matchlab_proxy_error(
            "Proxy generation failed",
            "BRAW decode timed out.",
            &format!(
                "Input: {}\nOutput: {}\nNext steps: Try a shorter clip, verify disk permissions, or use an MP4 proxy.",
                source_path,
                tmp_path.display()
            ),
        ))?
        .map_err(|e| format_matchlab_proxy_error(
            "Proxy generation failed",
            "BRAW decode worker failed.",
            &format!("Input: {}\nOutput: {}\n{}", source_path, tmp_path.display(), e),
        ))?
        .map_err(|details| {
            let summary = if is_braw_source {
                "ffmpeg failed writing proxy."
            } else {
                "REDline failed writing proxy."
            };
            format_matchlab_proxy_error("Proxy generation failed", summary, &details)
        })?;

        state.job_manager.update_progress(
            &job_id,
            0.92,
            Some("Finalizing proxy".to_string()),
        );
        emit_job_state(app, &state.job_manager, &job_id);

        if tmp_path.is_dir() {
            return Err(format_matchlab_proxy_error(
                "Proxy generation failed",
                "Proxy output path is invalid.",
                &format!("Output path is a directory: {}", tmp_path.display()),
            ));
        }
        std::fs::rename(&tmp_path, &final_path).map_err(|e| {
            format_matchlab_proxy_error(
                "Proxy generation failed",
                "Failed to finalize proxy file.",
                &format!(
                    "Input: {}\nTemp output: {}\nFinal output: {}\n{}",
                    source_path,
                    tmp_path.display(),
                    final_path.display(),
                    e
                ),
            )
        })?;

        Ok(ProductionMatchLabProxyResult {
            proxy_path: final_string,
            reused_proxy: false,
            decoder_path: proxy_strategy.1,
            strategy: Some(proxy_strategy.0),
        })
    }
    .await;

    match &result {
        Ok(done) => {
            state.job_manager.mark_done(
                &job_id,
                &format!("Proxy ready for {}", clip_name_from_path(&done.proxy_path)),
            );
            mark_proxy_attempt_success(&state, &proxy_key, &job_id);
        }
        Err(error) => {
            state.job_manager.mark_failed(&job_id, error);
            mark_proxy_attempt_failure(&state, &proxy_key, Some(&job_id));
        }
    }
    emit_job_state(app, &state.job_manager, &job_id);
    result
}

fn get_cached_braw_decoder_caps(state: &Arc<AppState>) -> BrawDecoderCaps {
    let mut lock = state.production_matchlab_braw_decoder_caps.lock().unwrap();
    if let Some(caps) = lock.as_ref() {
        return caps.clone();
    }
    let caps = probe_braw_decoder();
    *lock = Some(caps.clone());
    caps
}

fn get_cached_redline_decoder_caps(state: &Arc<AppState>) -> RedlineDecoderCaps {
    let mut lock = state
        .production_matchlab_redline_decoder_caps
        .lock()
        .unwrap();
    if let Some(caps) = lock.as_ref() {
        return caps.clone();
    }
    let caps = probe_redline_decoder();
    *lock = Some(caps.clone());
    caps
}

fn format_matchlab_proxy_error(title: &str, summary: &str, details: &str) -> String {
    format!(
        "Title: {}\nSummary: {}\nDetails:\n{}",
        title,
        summary,
        details
    )
}

fn mark_proxy_attempt_success(state: &Arc<AppState>, proxy_key: &str, job_id: &str) {
    let mut attempts = state
        .production_matchlab_proxy_tracker
        .attempts
        .lock()
        .unwrap();
    attempts.insert(
        proxy_key.to_string(),
        MatchLabProxyAttempt {
            job_id: job_id.to_string(),
            running: false,
            last_failed_at_ms: None,
        },
    );
}

fn mark_proxy_attempt_failure(state: &Arc<AppState>, proxy_key: &str, job_id: Option<&str>) {
    let mut attempts = state
        .production_matchlab_proxy_tracker
        .attempts
        .lock()
        .unwrap();
    attempts.insert(
        proxy_key.to_string(),
        MatchLabProxyAttempt {
            job_id: job_id.unwrap_or_default().to_string(),
            running: false,
            last_failed_at_ms: Some(chrono::Utc::now().timestamp_millis()),
        },
    );
}

fn validate_analysis_override_path(path: &str) -> Result<(), String> {
    let resolved = Path::new(path);
    if !resolved.exists() {
        return Err("Selected MP4 proxy does not exist.".to_string());
    }
    if !resolved.is_file() {
        return Err("Selected MP4 proxy path is not a file.".to_string());
    }
    let is_proxy_media = resolved
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("mp4") || value.eq_ignore_ascii_case("mov"))
        .unwrap_or(false);
    if !is_proxy_media {
        return Err("Selected override must be an MP4 or MOV file.".to_string());
    }
    Ok(())
}

#[derive(Default)]
struct MatchLabOwnedPaths {
    files: std::collections::HashSet<String>,
    proxy_dirs: std::collections::HashSet<String>,
}

fn collect_matchlab_references(
    results: &[ProductionMatchLabResultRecord],
) -> MatchLabOwnedPaths {
    let mut references = MatchLabOwnedPaths::default();
    for result in results {
        references
            .files
            .insert(result.representative_frame_path.clone());
        if let Ok(frame_paths) = serde_json::from_str::<Vec<String>>(&result.frames_json) {
            for frame_path in frame_paths {
                references.files.insert(frame_path);
            }
        }
        if let Some(proxy_path) = result.proxy_path.as_ref() {
            references.files.insert(proxy_path.clone());
            if let Some(parent) = Path::new(proxy_path).parent() {
                references
                    .proxy_dirs
                    .insert(parent.to_string_lossy().to_string());
            }
        }
        if let Some(calibration_json) = result.calibration_json.as_ref() {
            if let Ok(calibration) = serde_json::from_str::<CalibrationChartDetection>(calibration_json) {
                if !calibration.corrected_preview_path.is_empty() {
                    references.files.insert(calibration.corrected_preview_path);
                }
                if let Some(transform_preview_path) = calibration.transform_preview_path {
                    references.files.insert(transform_preview_path);
                }
                if let Some(lut_path) = calibration.lut_path {
                    references.files.insert(lut_path.clone());
                    if let Some(parent) = Path::new(&lut_path).parent() {
                        references
                            .proxy_dirs
                            .insert(parent.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    references
}

fn is_safe_matchlab_path(cache_root: &Path, candidate: &str) -> bool {
    Path::new(candidate).starts_with(cache_root)
}

fn prune_empty_matchlab_parents(cache_root: &Path, path: &Path) {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir == cache_root {
            break;
        }
        match std::fs::remove_dir(dir) {
            Ok(_) => current = dir.parent(),
            Err(_) => break,
        }
    }
}

fn summarize_fs_error(path: &str, error: &std::io::Error) -> String {
    let label = Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    format!("{} ({})", label, error)
}

fn command_exists(bin: &str) -> bool {
    let path = crate::tools::find_executable(bin);
    if path == bin {
        // find_executable returns the name itself if not found in common paths/sidecars
        // We verify if 'which' or equivalent works for the fallback
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .args(["-lc", &format!("command -v {} >/dev/null 2>&1", bin)])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("where")
                .arg(bin)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    } else {
        std::path::Path::new(&path).exists()
    }
}

fn last_export_metadata_path(cache_dir: &str) -> String {
    format!("{}/last_export.json", cache_dir)
}

fn write_last_export_metadata(cache_dir: &str, value: serde_json::Value) -> Result<(), String> {
    let path = last_export_metadata_path(cache_dir);
    let content = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

fn read_last_export_metadata(cache_dir: &str) -> Option<serde_json::Value> {
    let path = last_export_metadata_path(cache_dir);
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn default_brand_profile() -> serde_json::Value {
    serde_json::json!({
        "name": "expose.u",
        "colors": {
            "primary": "#ffffff",
            "primary_hover": "#e2e8f0",
            "accent": "#00f2ff",
            "background": "#08080a",
            "text": "#ffffff",
            "border": "#1c1c1f"
        },
        "font_family": "Inter, system-ui, sans-serif",
        "pdf_margin": "12mm",
        "pdf_spacing": "8px"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        Asset, AssetVersion, Clip, Project, ReviewCoreApprovalState, ReviewCoreShareLink,
    };

    fn sample_clip(project_id: &str, id: &str, rating: i32, flag: &str) -> Clip {
        Clip {
            id: id.to_string(),
            project_id: project_id.to_string(),
            root_id: "root-1".to_string(),
            rel_path: format!("{}.mov", id),
            filename: format!("{}.mov", id),
            file_path: format!("/tmp/{}.mov", id),
            size_bytes: 10,
            created_at: "2026-01-01 10:00:00".to_string(),
            duration_ms: 1000,
            fps: 24.0,
            width: 1920,
            height: 1080,
            video_codec: "h264".to_string(),
            video_bitrate: 100_000_000,
            format_name: "mov".to_string(),
            audio_codec: "aac".to_string(),
            audio_channels: 2,
            audio_sample_rate: 48000,
            camera_iso: None,
            camera_white_balance: None,
            camera_lens: None,
            camera_aperture: None,
            camera_angle: None,
            audio_summary: "AAC".to_string(),
            timecode: None,
            status: "ok".to_string(),
            rating,
            flag: flag.to_string(),
            notes: None,
            shot_size: None,
            movement: None,
            manual_order: 0,
            audio_envelope: None,
            lut_enabled: 0,
        }
    }

    #[test]
    fn scope_mapping_filters_correctly() {
        let db_path =
            std::env::temp_dir().join(format!("wrap-preview-test-{}.db", uuid::Uuid::new_v4()));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        let project_id = "p1";
        db.upsert_project(&Project {
            id: project_id.to_string(),
            root_path: "/tmp".to_string(),
            name: "P".to_string(),
            created_at: "2026-01-01".to_string(),
            bookmark: None,
        })
        .unwrap();
        db.upsert_clip(&sample_clip(project_id, "c1", 5, "pick"))
            .unwrap();
        db.upsert_clip(&sample_clip(project_id, "c2", 2, "none"))
            .unwrap();
        db.upsert_clip(&sample_clip(project_id, "c3", 5, "reject"))
            .unwrap();

        let picks = resolve_clips_for_scope(&db, project_id, "picks", None, None).unwrap();
        assert_eq!(picks.len(), 1);
        let rated_min =
            resolve_clips_for_scope(&db, project_id, "rated_min", Some(3), None).unwrap();
        assert_eq!(rated_min.len(), 1);
        let all = resolve_clips_for_scope(&db, project_id, "all", None, None).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn derive_labels_parses_arrow_or_falls_back() {
        let (s1, d1) = derive_labels(Some("CARD A -> SSD 01".to_string()), 1);
        assert_eq!(s1, "CARD A");
        assert_eq!(d1, "SSD 01");

        let (s2, d2) = derive_labels(Some("CAM A → RAID".to_string()), 2);
        assert_eq!(s2, "CAM A");
        assert_eq!(d2, "RAID");

        let (s3, d3) = derive_labels(Some("Check Label".to_string()), 3);
        assert_eq!(s3, "Check Label Source");
        assert_eq!(d3, "Check Label Destination");
    }

    #[test]
    fn review_core_comments_are_version_scoped() {
        let db_path = std::env::temp_dir().join(format!(
            "wrap-preview-comments-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        db.upsert_project(&Project {
            id: "p1".to_string(),
            root_path: "/tmp".to_string(),
            name: "P".to_string(),
            created_at: "2026-01-01".to_string(),
            bookmark: None,
        })
        .unwrap();
        db.create_asset(&Asset {
            id: "asset-1".to_string(),
            project_id: "p1".to_string(),
            filename: "clip.mov".to_string(),
            original_path: "/tmp/clip.mov".to_string(),
            storage_key: "originals/p1/asset-1/v1/original.mov".to_string(),
            file_size: 100,
            duration_ms: Some(10_000),
            frame_rate: Some(24.0),
            avg_frame_rate: Some("24/1".to_string()),
            r_frame_rate: Some("24/1".to_string()),
            is_vfr: false,
            width: Some(1920),
            height: Some(1080),
            codec: Some("h264".to_string()),
            status: "ready".to_string(),
            checksum_sha256: "abc".to_string(),
            last_error: None,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.create_asset_version(&AssetVersion {
            id: "v1".to_string(),
            asset_id: "asset-1".to_string(),
            version_number: 1,
            original_file_key: "originals/p1/asset-1/v1/original.mov".to_string(),
            proxy_playlist_key: None,
            proxy_mp4_key: None,
            thumbnails_key: None,
            poster_key: None,
            processing_status: "ready".to_string(),
            last_error: None,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.create_asset_version(&AssetVersion {
            id: "v2".to_string(),
            asset_id: "asset-1".to_string(),
            version_number: 2,
            original_file_key: "originals/p1/asset-1/v2/original.mov".to_string(),
            proxy_playlist_key: None,
            proxy_mp4_key: None,
            thumbnails_key: None,
            poster_key: None,
            processing_status: "ready".to_string(),
            last_error: None,
            created_at: "2026-01-02".to_string(),
        })
        .unwrap();
        db.create_review_core_comment(&ReviewCoreComment {
            id: "c1".to_string(),
            asset_version_id: "v1".to_string(),
            timestamp_ms: 500,
            frame_number: Some(12),
            text: "Version one comment".to_string(),
            author_name: "Alan".to_string(),
            resolved: false,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.create_review_core_comment(&ReviewCoreComment {
            id: "c2".to_string(),
            asset_version_id: "v2".to_string(),
            timestamp_ms: 700,
            frame_number: Some(17),
            text: "Version two comment".to_string(),
            author_name: "Alan".to_string(),
            resolved: false,
            created_at: "2026-01-02".to_string(),
        })
        .unwrap();

        let v1 = db.list_review_core_comments("v1").unwrap();
        let v2 = db.list_review_core_comments("v2").unwrap();
        assert_eq!(v1.len(), 1);
        assert_eq!(v2.len(), 1);
        assert_eq!(v1[0].text, "Version one comment");
        assert_eq!(v2[0].text, "Version two comment");
    }

    #[test]
    fn annotation_payload_is_clamped_and_versioned() {
        let normalized = normalize_annotation_vector_data(
            r#"{
                "schemaVersion": 1,
                "items": [
                    {"id":"a1","type":"arrow","a":[-0.2,0.4],"b":[1.4,2.0],"style":{"stroke":"accent","width":2}},
                    {"id":"r1","type":"rect","x":-1,"y":0.2,"w":1.8,"h":3.0,"style":{"stroke":"accent","width":2}}
                ]
            }"#,
            "comment-1",
            1200,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["commentId"], "comment-1");
        assert_eq!(value["timestampMs"], 1200);
        assert_eq!(value["items"][0]["a"][0], 0.0);
        assert_eq!(value["items"][0]["b"][0], 1.0);
        assert_eq!(value["items"][1]["w"], 1.0);
        assert_eq!(value["items"][1]["h"], 1.0);
    }

    #[test]
    fn review_core_approval_state_round_trips() {
        let db_path = std::env::temp_dir().join(format!(
            "wrap-preview-approval-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        db.upsert_project(&Project {
            id: "p1".to_string(),
            root_path: "/tmp".to_string(),
            name: "P".to_string(),
            created_at: "2026-01-01".to_string(),
            bookmark: None,
        })
        .unwrap();
        db.create_asset(&Asset {
            id: "asset-1".to_string(),
            project_id: "p1".to_string(),
            filename: "clip.mov".to_string(),
            original_path: "/tmp/clip.mov".to_string(),
            storage_key: "originals/p1/asset-1/v1/original.mov".to_string(),
            file_size: 100,
            duration_ms: Some(10_000),
            frame_rate: Some(24.0),
            avg_frame_rate: Some("24/1".to_string()),
            r_frame_rate: Some("24/1".to_string()),
            is_vfr: false,
            width: Some(1920),
            height: Some(1080),
            codec: Some("h264".to_string()),
            status: "ready".to_string(),
            checksum_sha256: "abc".to_string(),
            last_error: None,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.create_asset_version(&AssetVersion {
            id: "version-1".to_string(),
            asset_id: "asset-1".to_string(),
            version_number: 1,
            original_file_key: "originals/p1/asset-1/v1/original.mov".to_string(),
            proxy_playlist_key: None,
            proxy_mp4_key: None,
            thumbnails_key: None,
            poster_key: None,
            processing_status: "ready".to_string(),
            last_error: None,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.upsert_review_core_approval_state(&ReviewCoreApprovalState {
            asset_version_id: "version-1".to_string(),
            status: "approved".to_string(),
            approved_at: Some("2026-02-28T10:00:00Z".to_string()),
            approved_by: Some("Alan".to_string()),
        })
        .unwrap();

        let approval = db
            .get_review_core_approval_state("version-1")
            .unwrap()
            .unwrap();
        assert_eq!(approval.status, "approved");
        assert_eq!(approval.approved_by.as_deref(), Some("Alan"));
    }

    #[test]
    fn resolve_share_link_rejects_expired_links() {
        let db_path = std::env::temp_dir().join(format!(
            "wrap-preview-share-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        db.upsert_project(&Project {
            id: "p1".to_string(),
            root_path: "/tmp".to_string(),
            name: "P".to_string(),
            created_at: "2026-01-01".to_string(),
            bookmark: None,
        })
        .unwrap();
        db.create_review_core_share_link(&ReviewCoreShareLink {
            id: "share-1".to_string(),
            project_id: "p1".to_string(),
            token: "token-1".to_string(),
            asset_version_ids_json: "[\"v1\"]".to_string(),
            expires_at: Some("2020-01-01T00:00:00Z".to_string()),
            password_hash: None,
            allow_comments: true,
            allow_download: false,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();

        let result = resolve_share_link(&db, "token-1");
        assert!(matches!(result, Err(ReviewCoreShareError::Expired)));
    }

    #[test]
    fn protected_share_download_requires_valid_session() {
        let db_path = std::env::temp_dir().join(format!(
            "wrap-preview-share-download-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        db.upsert_project(&Project {
            id: "p1".to_string(),
            root_path: "/tmp".to_string(),
            name: "P".to_string(),
            created_at: "2026-01-01".to_string(),
            bookmark: None,
        })
        .unwrap();
        let link = ReviewCoreShareLink {
            id: "share-protected".to_string(),
            project_id: "p1".to_string(),
            token: "token-protected".to_string(),
            asset_version_ids_json: "[\"v1\"]".to_string(),
            expires_at: None,
            password_hash: Some("$2b$12$example".to_string()),
            allow_comments: true,
            allow_download: true,
            created_at: "2026-01-01".to_string(),
        };
        db.create_review_core_share_link(&link).unwrap();

        assert!(matches!(
            validate_share_session(&db, &link, None),
            Err(ReviewCoreShareError::Forbidden)
        ));
        assert!(matches!(
            validate_share_session(&db, &link, Some("bad-session")),
            Err(ReviewCoreShareError::Forbidden)
        ));
    }
}

#[tauri::command]
pub async fn get_project_settings(
    project_id: String,
    state: tauri::State<'_, std::sync::Arc<crate::commands::AppState>>,
) -> Result<String, String> {
    let settings = state
        .db
        .get_project_settings(&project_id)
        .map_err(|e| format!("Failed to get project settings: {}", e))?;

    match settings {
        Some(s) => Ok(s.settings_json),
        None => Ok("{}".to_string()),
    }
}
#[tauri::command]
pub async fn create_folder_zip(
    structure: Vec<folders_impl::FolderNode>,
    output_path: String,
) -> Result<(), String> {
    folders_impl::create_zip_from_structure(structure, &output_path)
}

#[tauri::command]
pub async fn create_folder_structure(
    structure: Vec<folders_impl::FolderNode>,
    output_root: String,
) -> Result<(), String> {
    folders_impl::create_structure_on_disk(structure, &output_root)
}

#[derive(serde::Serialize, Clone)]
pub struct DuplicateFile {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub modified: String,
}

#[derive(serde::Serialize, Clone)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<DuplicateFile>,
}

#[derive(serde::Serialize, Clone)]
pub struct DuplicateScanProgress {
    pub phase: String,
    pub count: usize,
    pub current_path: Option<String>,
}

#[derive(serde::Serialize)]
pub struct DuplicateScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn import_folder_structure(folder_path: String) -> Result<Vec<crate::folders::FolderNode>, String> {
    let path = std::path::Path::new(&folder_path);
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    crate::folders::scan_disk_to_structure(path)
}

#[tauri::command]
pub async fn scan_duplicates(
    paths: Vec<String>,
    app: tauri::AppHandle,
) -> Result<DuplicateScanResult, String> {
    use rayon::prelude::*;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use walkdir::WalkDir;
    use tauri::Emitter;

    let mut errors = Vec::new();

    // 1. Collect all files with their sizes
    app.emit("duplicate-scan-progress", DuplicateScanProgress {
        phase: "indexing".to_string(),
        count: 0,
        current_path: None,
    }).ok();

    let mut files_by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut file_count = 0;
    
    for root in paths {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.')) 
        {
            match entry {
                Ok(entry) => {
                    if entry.file_type().is_file() {
                        if let Ok(metadata) = entry.metadata() {
                            let size = metadata.len();
                            if size > 0 {
                                files_by_size.entry(size).or_default().push(entry.path().to_path_buf());
                                file_count += 1;
                                
                                if file_count % 500 == 0 {
                                    app.emit("duplicate-scan-progress", DuplicateScanProgress {
                                        phase: "indexing".to_string(),
                                        count: file_count,
                                        current_path: Some(entry.path().to_string_lossy().to_string()),
                                    }).ok();
                                }
                            }
                        }
                    }
                },
                Err(e) => {
                    errors.push(format!("Access error: {}", e));
                }
            }
        }
    }

    // Filter out files with unique sizes
    let candidates: Vec<(u64, Vec<PathBuf>)> = files_by_size
        .into_iter()
        .filter(|(_, paths)| paths.len() > 1)
        .collect();

    if candidates.is_empty() {
        return Ok(DuplicateScanResult { groups: vec![], errors });
    }

    // 2. Compute partial hashes (first 8KB) for candidates with same size
    app.emit("duplicate-scan-progress", DuplicateScanProgress {
        phase: "analyzing signatures".to_string(),
        count: candidates.len(),
        current_path: None,
    }).ok();

    let mut partial_hash_groups: HashMap<(u64, String), Vec<PathBuf>> = HashMap::new();
    
    for (size, paths) in candidates {
        for path in paths {
            if let Ok(partial_hash) = read_partial_hash(&path) {
                partial_hash_groups.entry((size, partial_hash)).or_default().push(path);
            }
        }
    }

    // Filter out unique partial hashes
    let full_scan_candidates: Vec<((u64, String), Vec<PathBuf>)> = partial_hash_groups
        .into_iter()
        .filter(|(_, paths)| paths.len() > 1)
        .collect();

    if full_scan_candidates.is_empty() {
        return Ok(DuplicateScanResult { groups: vec![], errors });
    }

    // 3. Compute full hashes in parallel for remaining candidates
    app.emit("duplicate-scan-progress", DuplicateScanProgress {
        phase: "calculating hashes".to_string(),
        count: full_scan_candidates.len(),
        current_path: None,
    }).ok();

    let groups: Vec<DuplicateGroup> = full_scan_candidates
        .into_par_iter()
        .filter_map(|((size, _), paths)| {
            let mut hash_to_files: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
            
            for path in paths {
                if let Ok(hash) = compute_full_hash(&path) {
                    if let Ok(metadata) = fs::metadata(&path) {
                        let modified = metadata.modified()
                            .ok()
                            .and_then(|t| {
                                let dt: chrono::DateTime<chrono::Utc> = t.into();
                                Some(dt.to_rfc3339())
                            })
                            .unwrap_or_default();

                        hash_to_files.entry(hash).or_default().push(DuplicateFile {
                            path: path.to_string_lossy().to_string(),
                            filename: path.file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default(),
                            size,
                            modified,
                        });
                    }
                }
            }

            let mut final_groups = Vec::new();
            for (hash, files) in hash_to_files {
                if files.len() > 1 {
                    final_groups.push(DuplicateGroup {
                        hash,
                        size,
                        files,
                    });
                }
            }
            
            if final_groups.is_empty() { None } else { Some(final_groups) }
        })
        .flatten()
        .collect();

    app.emit("duplicate-scan-progress", DuplicateScanProgress {
        phase: "complete".to_string(),
        count: groups.len(),
        current_path: None,
    }).ok();

    Ok(DuplicateScanResult { groups, errors })
}

#[tauri::command]
pub async fn delete_duplicate_file(path: String) -> Result<(), String> {
    trash::delete(path).map_err(|e| format!("Failed to move to trash: {}", e))
}

fn read_partial_hash(path: &std::path::Path) -> Result<String, std::io::Error> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buffer = [0; 8192];
    let n = file.read(&mut buffer)?;
    let hash = blake3::hash(&buffer[..n]);
    Ok(hash.to_hex().to_string())
}

fn compute_full_hash(path: &std::path::Path) -> Result<String, std::io::Error> {
    let mut hasher = blake3::Hasher::new();
    let mut file = std::fs::File::open(path)?;
    let mut buffer = [0; 65536];
    loop {
        let n = std::io::Read::read(&mut file, &mut buffer)?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

#[tauri::command]
pub async fn purge_cache(state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let cache_dir = &state.cache_dir;
    let mut freed_bytes: u64 = 0;
    let mut removed_files: u64 = 0;

    // Walk the cache directory and remove clip thumbnail dirs and temp files
    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Skip the database file
            if path.extension().map(|e| e == "db").unwrap_or(false) {
                continue;
            }
            if path.is_dir() {
                if let Ok(size) = dir_size(&path) {
                    freed_bytes += size;
                }
                if let Ok(count) = count_files(&path) {
                    removed_files += count;
                }
                std::fs::remove_dir_all(&path).ok();
            } else {
                if let Ok(meta) = path.metadata() {
                    freed_bytes += meta.len();
                    removed_files += 1;
                }
                std::fs::remove_file(&path).ok();
            }
        }
    }

    // Clear caches from DB
    state.db.purge_caches().ok();

    Ok(serde_json::json!({
        "freed_bytes": freed_bytes,
        "removed_files": removed_files
    }))
}

#[tauri::command]
pub async fn reset_app_data(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    state.db.reset_file()?;

    if state.app_data_dir.exists() {
        for entry in std::fs::read_dir(&state.app_data_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path == state.db_path {
                continue;
            }
            if path.is_dir() {
                std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    
    if std::path::Path::new(&state.cache_dir).exists() {
        let _ = std::fs::remove_dir_all(&state.cache_dir);
    }
    std::fs::create_dir_all(&state.app_data_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&state.review_core_base_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&state.cache_dir).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "ok": true }))
}

fn dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut total: u64 = 0;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            total += dir_size(&entry.path())?;
        } else {
            total += meta.len();
        }
    }
    Ok(total)
}

fn count_files(path: &std::path::Path) -> std::io::Result<u64> {
    let mut count: u64 = 0;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        if entry.metadata()?.is_dir() {
            count += count_files(&entry.path())?;
        } else {
            count += 1;
        }
    }
    Ok(count)
}

// --- Production Module Commands ---

#[tauri::command]
pub async fn production_create_project(
    name: String,
    client_name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ProductionProject, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project = ProductionProject {
        id,
        name,
        client_name,
        created_at: now.clone(),
        last_opened_at: now,
    };

    state
        .db
        .upsert_production_project(&project)
        .map_err(|e| format!("Failed to create production project: {}", e))?;

    Ok(project)
}

#[tauri::command]
pub async fn production_list_projects(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ProductionProject>, String> {
    state
        .db
        .list_production_projects()
        .map_err(|e| format!("Failed to list production projects: {}", e))
}

#[tauri::command]
pub async fn production_touch_project(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    state
        .db
        .touch_production_project(&project_id, &now)
        .map_err(|e| format!("Failed to touch production project: {}", e))
}

#[tauri::command]
pub async fn production_delete_project(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_production_project(&project_id)
        .map_err(|e| format!("Failed to delete production project: {}", e))
}

#[tauri::command]
pub async fn shot_list_ensure_project(
    state: State<'_, Arc<AppState>>,
) -> Result<ShotListProject, String> {
    if let Some(project) = state
        .db
        .get_latest_shot_list_project()
        .map_err(|e| format!("Failed to load Shot List project: {}", e))?
    {
        let now = chrono::Utc::now().to_rfc3339();
        state
            .db
            .touch_shot_list_project(&project.id, &now)
            .map_err(|e| format!("Failed to touch Shot List project: {}", e))?;
        return state
            .db
            .get_shot_list_project(&project.id)
            .map_err(|e| format!("Failed to reload Shot List project: {}", e))?
            .ok_or_else(|| "Shot List project disappeared after touch.".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let local_day = chrono::Local::now().format("Day Sheet • %d %b %Y").to_string();
    let project = ShotListProject {
        id: uuid::Uuid::new_v4().to_string(),
        title: "Shot List".to_string(),
        day_label: local_day,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: now,
    };
    state
        .db
        .upsert_shot_list_project(&project)
        .map_err(|e| format!("Failed to create Shot List project: {}", e))?;
    Ok(project)
}

#[tauri::command]
pub async fn shot_list_get_bundle(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ShotListBundle, String> {
    let project = state
        .db
        .get_shot_list_project(&project_id)
        .map_err(|e| format!("Failed to load Shot List project: {}", e))?
        .ok_or_else(|| "Shot List project not found.".to_string())?;
    let rows = state
        .db
        .list_shot_list_rows(&project_id)
        .map_err(|e| format!("Failed to load Shot List rows: {}", e))?;
    let sections = state
        .db
        .list_shot_list_equipment_sections(&project_id)
        .map_err(|e| format!("Failed to load Shot List sections: {}", e))?;
    let items = state
        .db
        .list_shot_list_equipment_items(&project_id)
        .map_err(|e| format!("Failed to load Shot List items: {}", e))?;
    Ok(ShotListBundle {
        project,
        rows,
        sections,
        items,
    })
}

#[tauri::command]
pub async fn shot_list_save_project(
    project: ShotListProject,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_shot_list_project(&project)
        .map_err(|e| format!("Failed to save Shot List project: {}", e))
}

#[tauri::command]
pub async fn shot_list_save_row(
    row: ShotListRow,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_shot_list_row(&row)
        .map_err(|e| format!("Failed to save Shot List row: {}", e))
}

#[tauri::command]
pub async fn shot_list_delete_row(
    row_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_shot_list_row(&row_id)
        .map_err(|e| format!("Failed to delete Shot List row: {}", e))
}

#[tauri::command]
pub async fn shot_list_reorder_rows(
    project_id: String,
    row_ids: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .reorder_shot_list_rows(&project_id, &row_ids)
        .map_err(|e| format!("Failed to reorder Shot List rows: {}", e))
}

#[tauri::command]
pub async fn shot_list_save_equipment_section(
    section: ShotListEquipmentSection,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_shot_list_equipment_section(&section)
        .map_err(|e| format!("Failed to save Shot List equipment section: {}", e))
}

#[tauri::command]
pub async fn shot_list_delete_equipment_section(
    section_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_shot_list_equipment_section(&section_id)
        .map_err(|e| format!("Failed to delete Shot List equipment section: {}", e))
}

#[tauri::command]
pub async fn shot_list_reorder_sections(
    project_id: String,
    section_ids: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .reorder_shot_list_equipment_sections(&project_id, &section_ids)
        .map_err(|e| format!("Failed to reorder Shot List sections: {}", e))
}

#[tauri::command]
pub async fn shot_list_save_equipment_item(
    item: ShotListEquipmentItem,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_shot_list_equipment_item(&item)
        .map_err(|e| format!("Failed to save Shot List equipment item: {}", e))
}

#[tauri::command]
pub async fn shot_list_delete_equipment_item(
    item_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .delete_shot_list_equipment_item(&item_id)
        .map_err(|e| format!("Failed to delete Shot List equipment item: {}", e))
}

#[tauri::command]
pub async fn shot_list_reorder_equipment_items(
    section_id: String,
    item_ids: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .reorder_shot_list_equipment_items(&section_id, &item_ids)
        .map_err(|e| format!("Failed to reorder Shot List equipment items: {}", e))
}

#[tauri::command]
pub async fn shot_list_replace_bundle(
    bundle: ShotListBundle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .replace_shot_list_bundle(&bundle)
        .map_err(|e| format!("Failed to replace Shot List bundle: {}", e))
}

#[tauri::command]
pub async fn get_camera_profiles() -> Result<Vec<CameraProfile>, String> {
    Ok(production::load_camera_profiles())
}

#[tauri::command]
pub async fn get_look_presets() -> Result<Vec<LookPreset>, String> {
    Ok(production::load_look_presets())
}

#[tauri::command]
pub async fn save_production_camera_config(
    config: ProductionCameraConfig,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_production_camera_config(&config)
        .map_err(|e| format!("Failed to save camera config: {}", e))
}

#[tauri::command]
pub async fn list_production_camera_configs(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ProductionCameraConfig>, String> {
    state
        .db
        .list_production_camera_configs(&project_id)
        .map_err(|e| format!("Failed to list camera configs: {}", e))
}

#[tauri::command]
pub async fn production_save_look_setup(
    setup: ProductionLookSetup,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_production_look_setup(&setup)
        .map_err(|e| format!("Failed to save production look setup: {}", e))
}

#[tauri::command]
pub async fn production_get_look_setup(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ProductionLookSetup>, String> {
    state
        .db
        .get_production_look_setup(&project_id)
        .map_err(|e| format!("Failed to get production look setup: {}", e))
}

#[tauri::command]
pub async fn production_save_onset_checks(
    checks: ProductionOnsetChecks,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_production_onset_checks(&checks)
        .map_err(|e| format!("Failed to save onset checks: {}", e))
}

#[tauri::command]
pub async fn production_get_onset_checks(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ProductionOnsetChecks>, String> {
    state
        .db
        .get_production_onset_checks(&project_id)
        .map_err(|e| format!("Failed to get onset checks: {}", e))
}

#[tauri::command]
pub async fn production_save_preset(
    preset: ProductionPreset,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .upsert_production_preset(&preset)
        .map_err(|e| format!("Failed to save production preset: {}", e))
}

#[tauri::command]
pub async fn production_list_presets(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ProductionPreset>, String> {
    state
        .db
        .list_production_presets(&project_id)
        .map_err(|e| format!("Failed to list production presets: {}", e))
}

#[tauri::command]
pub async fn production_get_preset(
    preset_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ProductionPreset>, String> {
    state
        .db
        .get_production_preset(&preset_id)
        .map_err(|e| format!("Failed to get production preset: {}", e))
}

#[tauri::command]
pub async fn production_matchlab_ensure_proxy(
    project_id: String,
    slot: String,
    source_path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<ProductionMatchLabProxyResult, String> {
    ensure_matchlab_proxy_internal(&project_id, &slot, &source_path, &app, state.inner().clone()).await
}

#[tauri::command]
pub async fn camera_match_analyze_clip(
    project_id: String,
    camera_slot: String,
    clip_path: String,
    frame_count: u32,
    analysis_source_override_path: Option<String>,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<CameraMatchAnalysisResult, String> {
    camera_match_analyze_clip_internal(
        &project_id,
        &camera_slot,
        &clip_path,
        frame_count,
        analysis_source_override_path.as_deref(),
        &app,
        state.inner().clone(),
    )
    .await
}

#[tauri::command]
pub async fn production_matchlab_save_run(
    project_id: String,
    hero_slot: String,
    results: Vec<ProductionMatchLabRunResultInput>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let run_record = ProductionMatchLabRunRecord {
        id: run_id.clone(),
        project_id: project_id.clone(),
        hero_slot,
        created_at: now.clone(),
    };

    let mut result_records = Vec::with_capacity(results.len());
    for item in results {
        let source_hash = hash_source_signature(&item.analysis.clip_path);
        let source_record = ProductionMatchLabSource {
            id: format!("{}:{}", project_id, item.slot),
            project_id: project_id.clone(),
            slot: item.slot.clone(),
            source_path: item.analysis.clip_path.clone(),
            source_hash,
            created_at: now.clone(),
            last_analyzed_at: now.clone(),
        };
        state
            .db
            .upsert_production_matchlab_source(&source_record)
            .map_err(|e| format!("Failed to save match lab source: {}", e))?;

        result_records.push(ProductionMatchLabResultRecord {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: run_id.clone(),
            slot: item.slot,
            proxy_path: item.proxy_path,
            representative_frame_path: item.analysis.representative_frame_path.clone(),
            frames_json: serde_json::to_string(&item.analysis.frame_paths)
                .map_err(|e| format!("Failed to serialize frame paths: {}", e))?,
            metrics_json: serde_json::to_string(&item.analysis)
                .map_err(|e| format!("Failed to serialize match lab result: {}", e))?,
            calibration_json: item
                .calibration
                .map(|calibration| serde_json::to_string(&calibration))
                .transpose()
                .map_err(|e| format!("Failed to serialize calibration payload: {}", e))?,
            created_at: now.clone(),
        });
    }

    state
        .db
        .insert_production_matchlab_run(&run_record, &result_records)
        .map_err(|e| format!("Failed to save match lab run: {}", e))?;

    Ok(run_id)
}

#[tauri::command]
pub async fn production_matchlab_list_runs(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ProductionMatchLabRunSummary>, String> {
    state
        .db
        .list_production_matchlab_runs(&project_id)
        .map(|runs| {
            runs.into_iter()
                .map(|run| ProductionMatchLabRunSummary {
                    run_id: run.id,
                    project_id: run.project_id,
                    hero_slot: run.hero_slot,
                    created_at: run.created_at,
                })
                .collect()
        })
        .map_err(|e| format!("Failed to list match lab runs: {}", e))
}

#[tauri::command]
pub async fn production_matchlab_get_run(
    run_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ProductionMatchLabRun>, String> {
    let record = state
        .db
        .get_production_matchlab_run(&run_id)
        .map_err(|e| format!("Failed to load match lab run: {}", e))?;

    let Some((run, results)) = record else {
        return Ok(None);
    };

    let mut parsed_results = Vec::with_capacity(results.len());
    for result in results {
        let analysis: CameraMatchAnalysisResult = serde_json::from_str(&result.metrics_json)
            .map_err(|e| format!("Failed to parse saved match lab metrics: {}", e))?;
        let frame_paths: Vec<String> = serde_json::from_str(&result.frames_json)
            .map_err(|e| format!("Failed to parse saved match lab frame paths: {}", e))?;
        let calibration = result
            .calibration_json
            .as_deref()
            .map(serde_json::from_str::<CalibrationChartDetection>)
            .transpose()
            .map_err(|e| format!("Failed to parse saved calibration payload: {}", e))?;
        parsed_results.push(ProductionMatchLabRunResult {
            slot: result.slot,
            proxy_path: result.proxy_path,
            representative_frame_path: result.representative_frame_path,
            frame_paths,
            analysis,
            calibration,
            created_at: result.created_at,
        });
    }

    Ok(Some(ProductionMatchLabRun {
        run_id: run.id,
        project_id: run.project_id,
        hero_slot: run.hero_slot,
        created_at: run.created_at,
        results: parsed_results,
    }))
}

#[tauri::command]
pub async fn production_matchlab_delete_run(
    run_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    let existing = state
        .db
        .get_production_matchlab_run(&run_id)
        .map_err(|e| format!("Failed to load match lab run: {}", e))?
        .ok_or("Match lab run not found")?;
    let (_, results) = existing;
    let other_results = state
        .db
        .list_production_matchlab_results_excluding_run(&run_id)
        .map_err(|e| format!("Failed to inspect related match lab runs: {}", e))?;

    let cache_root = Path::new(&state.cache_dir)
        .join("production")
        .join("cache")
        .join("match_lab");
    let referenced_paths = collect_matchlab_references(&other_results);
    let owned_paths = collect_matchlab_references(&results);

    state
        .db
        .delete_production_matchlab_run(&run_id)
        .map_err(|e| format!("Failed to delete match lab run: {}", e))?;

    let mut warnings = Vec::new();
    for file_path in owned_paths.files {
        if referenced_paths.files.contains(&file_path) {
            continue;
        }
        if !is_safe_matchlab_path(&cache_root, &file_path) {
            continue;
        }
        let file = Path::new(&file_path);
        if !file.exists() {
            continue;
        }
        if let Err(error) = std::fs::remove_file(file) {
            warnings.push(format!("Could not remove {}", summarize_fs_error(&file_path, &error)));
            continue;
        }
        prune_empty_matchlab_parents(&cache_root, file);
    }

    for dir_path in owned_paths.proxy_dirs {
        if referenced_paths.proxy_dirs.contains(&dir_path) {
            continue;
        }
        if !is_safe_matchlab_path(&cache_root, &dir_path) {
            continue;
        }
        let dir = Path::new(&dir_path);
        if !dir.exists() {
            continue;
        }
        if let Err(error) = std::fs::remove_dir_all(dir) {
            warnings.push(format!("Could not remove {}", summarize_fs_error(&dir_path, &error)));
            continue;
        }
        prune_empty_matchlab_parents(&cache_root, dir);
    }

    if warnings.is_empty() {
        Ok(None)
    } else {
        Ok(Some(warnings.join(" • ")))
    }
}

#[tauri::command]
pub async fn production_matchlab_detect_calibration(
    project_id: String,
    slot: String,
    frame_path: String,
    crop_rect_normalized: Option<CalibrationCropRectNormalized>,
    manual_chart_corners: Option<Vec<CalibrationPoint>>,
    state: State<'_, Arc<AppState>>,
) -> Result<CalibrationChartDetection, String> {
    crate::production_calibration::detect_spydercheckr(
        Path::new(&state.cache_dir),
        &project_id,
        &slot,
        Path::new(&frame_path),
        crop_rect_normalized.as_ref(),
        manual_chart_corners.as_deref(),
    )
}

#[tauri::command]
pub async fn production_matchlab_generate_transform(
    project_id: String,
    slot: String,
    hero_slot: String,
    source_frame_path: String,
    source_calibration: CalibrationChartDetection,
    target_calibration: Option<CalibrationChartDetection>,
    state: State<'_, Arc<AppState>>,
) -> Result<CalibrationChartDetection, String> {
    crate::production_calibration::generate_calibration_transform(
        Path::new(&state.cache_dir),
        &project_id,
        &slot,
        &hero_slot,
        Path::new(&source_frame_path),
        &source_calibration,
        target_calibration.as_ref(),
    )
}

#[tauri::command]
pub async fn production_matchlab_export_lut(
    lut_path: String,
    destination_path: String,
) -> Result<(), String> {
    let source = Path::new(&lut_path);
    if !source.exists() {
        return Err("Calibration LUT is missing. Re-run calibration.".to_string());
    }
    let destination = Path::new(&destination_path);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed preparing LUT export folder: {}", error))?;
    }
    std::fs::copy(source, destination)
        .map_err(|error| format!("Failed exporting LUT: {}", error))?;
    Ok(())
}

#[tauri::command]
pub async fn production_matchlab_export_calibration_package(
    project_id: String,
    run_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let package_root = Path::new(&state.cache_dir)
        .join("production")
        .join("cache")
        .join("match_lab")
        .join(&project_id)
        .join("calibration_package")
        .join("CalibrationPackage");
    if package_root.exists() {
        std::fs::remove_dir_all(&package_root)
            .map_err(|error| format!("Failed clearing calibration package: {}", error))?;
    }
    std::fs::create_dir_all(&package_root)
        .map_err(|error| format!("Failed preparing calibration package: {}", error))?;

    let record = state
        .db
        .get_production_matchlab_run(&run_id)
        .map_err(|e| format!("Failed to load calibration run: {}", e))?;
    let Some((run_record, result_records)) = record else {
        return Err("Calibration run not found.".to_string());
    };
    if run_record.project_id != project_id {
        return Err("Calibration run does not belong to this project.".to_string());
    }
    let mut run_results = Vec::with_capacity(result_records.len());
    for result in result_records {
        let analysis: CameraMatchAnalysisResult = serde_json::from_str(&result.metrics_json)
            .map_err(|e| format!("Failed to parse saved match lab metrics: {}", e))?;
        let frame_paths: Vec<String> = serde_json::from_str(&result.frames_json)
            .map_err(|e| format!("Failed to parse saved match lab frame paths: {}", e))?;
        let calibration = result
            .calibration_json
            .as_deref()
            .map(serde_json::from_str::<CalibrationChartDetection>)
            .transpose()
            .map_err(|e| format!("Failed to parse saved calibration payload: {}", e))?;
        run_results.push(ProductionMatchLabRunResult {
            slot: result.slot,
            proxy_path: result.proxy_path,
            representative_frame_path: result.representative_frame_path,
            frame_paths,
            analysis,
            calibration,
            created_at: result.created_at,
        });
    }
    let run = ProductionMatchLabRun {
        run_id: run_record.id,
        project_id: run_record.project_id,
        hero_slot: run_record.hero_slot,
        created_at: run_record.created_at,
        results: run_results,
    };

    let project_name = state
        .db
        .list_production_projects()
        .map_err(|error| format!("Failed loading production project: {}", error))?
        .into_iter()
        .find(|item| item.id == project_id)
        .map(|item| item.name)
        .unwrap_or_else(|| "Production Project".to_string());

    let reference_result = run
        .results
        .iter()
        .find(|result| result.slot == run.hero_slot && result.calibration.as_ref().map(|item| item.chart_detected).unwrap_or(false))
        .or_else(|| run.results.iter().find(|result| result.calibration.as_ref().map(|item| item.chart_detected).unwrap_or(false)))
        .ok_or("No calibrated camera found in this run.")?;
    let reference_frame_path = Path::new(&reference_result.representative_frame_path);
    let reference_frame_export = package_root.join("chart_reference_frame.jpg");
    std::fs::copy(reference_frame_path, &reference_frame_export)
        .map_err(|error| format!("Failed exporting chart reference frame: {}", error))?;
    let overlay_frame_export = package_root.join("chart_overlay_frame.jpg");
    crate::production_calibration::render_calibration_overlay_preview(
        reference_frame_path,
        reference_result.calibration.as_ref().ok_or("Missing hero calibration.")?,
        &overlay_frame_export,
    )?;

    let mut manifest_slots = Vec::new();
    let mut lut_files = Vec::new();
    for result in &run.results {
        let calibration = match result.calibration.as_ref() {
            Some(calibration) if calibration.chart_detected => calibration,
            _ => continue,
        };
        let lut_name = if result.slot != run.hero_slot {
            if let Some(lut_path) = calibration.lut_path.as_ref() {
                let source = Path::new(lut_path);
                if source.exists() {
                    let file_name = source
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("calibration.cube")
                        .to_string();
                    std::fs::copy(source, package_root.join(&file_name))
                        .map_err(|error| format!("Failed copying LUT {}: {}", file_name, error))?;
                    lut_files.push(file_name.clone());
                    Some(file_name)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        manifest_slots.push(serde_json::json!({
            "slot": result.slot,
            "mean_delta_e_before": calibration.mean_delta_e_before,
            "mean_delta_e_after": calibration.mean_delta_e_after,
            "calibration_quality_score": calibration.calibration_quality_score,
            "calibration_quality_level": calibration.calibration_quality_level,
            "warnings": calibration.warnings,
            "lut_file": lut_name,
        }));
    }

    std::fs::write(package_root.join("hero_camera.txt"), format!("Hero Camera {}\n", run.hero_slot))
        .map_err(|error| format!("Failed writing hero camera note: {}", error))?;

    let manifest = serde_json::json!({
        "project": project_name,
        "project_id": project_id,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "hero_camera": run.hero_slot,
        "camera_slots": manifest_slots,
        "lut_files": lut_files,
    });
    std::fs::write(
        package_root.join("calibration_manifest.json"),
        serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Failed serializing calibration manifest: {}", error))?,
    )
    .map_err(|error| format!("Failed writing calibration manifest: {}", error))?;

    write_calibration_report_pdf(
        &package_root.join("calibration_report.pdf"),
        &project_name,
        &run,
        &reference_frame_export,
        &overlay_frame_export,
    )?;

    Ok(package_root.to_string_lossy().to_string())
}
