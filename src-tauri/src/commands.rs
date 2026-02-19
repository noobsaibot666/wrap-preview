use crate::clustering;
use crate::db::{Clip, Database, Project, SceneBlock, Thumbnail, VerificationJob, VerificationItem};
use crate::audio;
use crate::ffprobe;
use crate::jobs::JobInfo;
use crate::scanner;
use crate::thumbnail;
use crate::verification;
use sha2::{Digest, Sha256};
use std::io::Write as _;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

/// App state holding the database
pub struct AppState {
    pub db: Database,
    pub cache_dir: String,
    pub job_manager: crate::jobs::JobManager,
}

// ─── Tauri Commands ───

#[tauri::command]
pub async fn scan_folder(
    folder_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<ScanResult, String> {
    let db = &state.db;

    // Create project
    let project_name = std::path::Path::new(&folder_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled Project".to_string());

    let project_id = hash_string(&folder_path);
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let project = Project {
        id: project_id.clone(),
        root_path: folder_path.clone(),
        name: project_name.clone(),
        created_at: now,
    };

    db.upsert_project(&project)
        .map_err(|e| format!("Failed to create project: {}", e))?;

    // Scan for video files
    let video_files = scanner::scan_folder(&folder_path);

    // Probe each file
    let mut clips: Vec<Clip> = Vec::new();
    for file_path in &video_files {
        let meta = ffprobe::probe_file(file_path);

        // Calculate relative path for stable ID
        let relative_path = std::path::Path::new(file_path)
            .strip_prefix(&folder_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.clone());

        let clip = match meta {
            Ok(m) => {
                let clip_id = generate_clip_id(file_path, Some(&relative_path));

                // Determine status
                let status = if m.timecode.is_none() { "warn" } else { "ok" };

                Clip {
                    id: clip_id,
                    project_id: project_id.clone(),
                    filename: m.filename,
                    file_path: m.file_path,
                    size_bytes: m.size_bytes,
                    created_at: m.created_at,
                    duration_ms: m.duration_ms,
                    fps: m.fps,
                    width: m.width,
                    height: m.height,
                    video_codec: m.video_codec,
                    audio_summary: m.audio_summary,
                    timecode: m.timecode,
                    status: status.to_string(),
                    rating: 0,
                    flag: "none".to_string(),
                    notes: None,
                    audio_envelope: None,
                }
            }
            Err(e) => {
                let filename = std::path::Path::new(file_path)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();

                Clip {
                    id: generate_clip_id(file_path, Some(&relative_path)),
                    project_id: project_id.clone(),
                    filename,
                    file_path: file_path.clone(),
                    size_bytes: 0,
                    created_at: String::new(),
                    duration_ms: 0,
                    fps: 0.0,
                    width: 0,
                    height: 0,
                    video_codec: "unknown".to_string(),
                    audio_summary: format!("Error: {}", e),
                    timecode: None,
                    status: "fail".to_string(),
                    rating: 0,
                    flag: "none".to_string(),
                    notes: None,
                    audio_envelope: None,
                }
            }
        };

        db.upsert_clip(&clip).ok();
        clips.push(clip);
    }

    Ok(ScanResult {
        project_id,
        project_name,
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
    let clips = db
        .get_clips(&project_id)
        .map_err(|e| format!("Failed to get clips: {}", e))?;

    let mut result = Vec::new();
    for clip in clips {
        let thumbnails = db.get_thumbnails(&clip.id).unwrap_or_default();
        result.push(ClipWithThumbnails { clip, thumbnails });
    }
    Ok(result)
}

#[tauri::command]
pub async fn extract_thumbnails(
    project_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let db = &state.db;
    let cache_dir = state.cache_dir.clone();
    let (job_id, cancel_flag) = state.job_manager.create_job("thumbnails", None);
    state
        .job_manager
        .mark_running(&job_id, "Thumbnail extraction started");
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
        if clip.status == "fail" || clip.duration_ms == 0 {
            // Emit progress even for skipped clips
            let _ = app.emit("thumbnail-progress", ThumbnailProgress {
                clip_id: clip.id.clone(),
                clip_index: clip_idx,
                total_clips,
                status: "skipped".to_string(),
                thumbnails: vec![],
            });
            continue;
        }

        let permit = semaphore.clone().acquire_owned().await.map_err(|e| e.to_string())?;

        // Extract 7 thumbnails to support all layout options (3, 5, 7)
        let timestamps = thumbnail::calculate_timestamps(clip.duration_ms, 7);

        let clip_cache_dir = format!("{}/{}", cache_dir, clip.id);
        std::fs::create_dir_all(&clip_cache_dir).ok();

        let mut thumb_results: Vec<Thumbnail> = Vec::new();

        for (idx, &ts) in timestamps.iter().enumerate() {
            let output_path = format!("{}/thumb_{}.jpg", clip_cache_dir, idx);

            match thumbnail::extract_with_fallback(
                &clip.file_path,
                &output_path,
                ts,
                clip.duration_ms,
            ) {
                Ok(actual_ts) => {
                    let thumb = Thumbnail {
                        clip_id: clip.id.clone(),
                        index: idx as u32,
                        timestamp_ms: actual_ts,
                        file_path: output_path,
                    };
                    if let Err(e) = db.upsert_thumbnail(&thumb) {
                        eprintln!("thumbnail: failed to persist {}: {}", thumb.file_path, e);
                    }
                    thumb_results.push(thumb);
                }
                Err(err) => {
                    eprintln!("thumbnail: extract failed for {}: {}", clip.file_path, err);
                    // Continue even if one thumbnail fails
                }
            }
        }

        let _ = app.emit("thumbnail-progress", ThumbnailProgress {
            clip_id: clip.id.clone(),
            clip_index: clip_idx,
            total_clips,
            status: "done".to_string(),
            thumbnails: thumb_results,
        });
        state.job_manager.update_progress(
            &job_id,
            (clip_idx + 1) as f32 / total_clips.max(1) as f32,
            Some(format!("Processed {}/{} clips", clip_idx + 1, total_clips)),
        );
        emit_job_state(&app, &state.job_manager, &job_id);

        drop(permit);
    }

    let _ = app.emit("thumbnail-complete", serde_json::json!({
        "project_id": project_id,
    }));

    if !crate::jobs::JobManager::is_cancelled(&cancel_flag) {
        state
            .job_manager
            .mark_done(&job_id, "Thumbnail extraction complete");
    }
    emit_job_state(&app, &state.job_manager, &job_id);
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
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read thumbnail at {}: {}", path, e))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
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
    let fallback_path = std::path::Path::new(&project_path).parent()
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
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse brand profile: {}", e))
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
pub async fn get_job(job_id: String, state: State<'_, Arc<AppState>>) -> Result<Option<JobInfo>, String> {
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
    source_root: String,
    dest_root: String,
    mode: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let app_state = state.inner().clone();
    let (job_id, cancel_flag) = app_state.job_manager.create_job("verification", None);
    app_state.job_manager.mark_running(&job_id, "Verification started");
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
            source_root,
            dest_root,
            mode,
            cancel_flag.clone(),
        )
        .await;

        if crate::jobs::JobManager::is_cancelled(&cancel_flag) {
            app_state_for_task
                .job_manager
                .update_progress(&job_id_clone, 1.0, Some("Cancelled".to_string()));
            let _ = app_state_for_task.job_manager.cancel_job(&job_id_clone);
        } else if let Err(err) = result {
            eprintln!("verification job failed: {}", err);
            app_state_for_task.job_manager.mark_failed(&job_id_clone, &err);
        } else {
            app_state_for_task
                .job_manager
                .mark_done(&job_id_clone, "Verification complete");
        }
        emit_job_state(&app_clone, &app_state_for_task.job_manager, &job_id_clone);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn get_verification_job(
    job_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<VerificationJob>, String> {
    state.db.get_verification_job(&job_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_verification_items(
    job_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<VerificationItem>, String> {
    state.db.get_verification_items(&job_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_verification_report_json(
    job_id: String,
    save_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let job = state.db.get_verification_job(&job_id).map_err(|e| e.to_string())?
        .ok_or("Job not found")?;
    let items = state.db.get_verification_items(&job_id).map_err(|e| e.to_string())?;

    let report = serde_json::json!({
        "job": job,
        "items": items,
        "app": "Wrap Preview",
        "version": env!("CARGO_PKG_VERSION"),
        "exported_at": chrono::Utc::now().to_rfc3339(),
    });

    let content = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    std::fs::write(&save_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn extract_audio_waveform(
    clip_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<u8>, String> {
    let (job_id, _cancel_flag) = state
        .job_manager
        .create_job("waveform", Some(format!("waveform-{}", clip_id)));
    state
        .job_manager
        .mark_running(&job_id, "Waveform extraction started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let db = &state.db;
    let clip = db.get_clips_by_ids(&[clip_id.clone()])
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or("Clip not found")?;

    // Check if we already have it
    if let Some(env) = clip.audio_envelope {
        state
            .job_manager
            .mark_done(&job_id, "Waveform loaded from cache");
        emit_job_state(&app, &state.job_manager, &job_id);
        return Ok(env);
    }

    // Otherwise extract
    let result = audio::extract_envelope(&clip.file_path, 150)?;
    
    // Save to DB
    db.update_audio_envelope(&clip_id, &result.envelope)
        .map_err(|e| format!("Failed to save audio envelope: {}", e))?;

    state
        .job_manager
        .mark_done(&job_id, "Waveform extraction complete");
    emit_job_state(&app, &state.job_manager, &job_id);
    Ok(result.envelope)
}

#[tauri::command]
pub async fn update_clip_metadata(
    clip_id: String,
    rating: Option<i32>,
    flag: Option<String>,
    notes: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    db.update_clip_metadata(&clip_id, rating, flag, notes)
        .map_err(|e| format!("Failed to update clip metadata: {}", e))
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
    let (job_id, _cancel_flag) = state.job_manager.create_job("resolve_export", None);
    state.job_manager.mark_running(&job_id, "Resolve export started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let db = &state.db;

    let filtered_clips =
        resolve_clips_for_scope(db, &project_id, &scope, min_rating, block_ids)?;

    if filtered_clips.is_empty() {
        return Err("No clips found matching the export criteria.".into());
    }

    // Get Project Info
    let project = db.get_project(&project_id).map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    // Generate XML
    let include_master = include_master_timeline.unwrap_or(true);
    let xml_content = crate::export::generate_fcpxml_structured(
        &filtered_clips,
        &project.name,
        include_master,
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

    state.job_manager.mark_done(&job_id, "Resolve export complete");
    emit_job_state(&app, &state.job_manager, &job_id);
    Ok(())
}

#[tauri::command]
pub async fn build_scene_blocks(
    project_id: String,
    gap_seconds: Option<i64>,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SceneBlockWithClips>, String> {
    let (job_id, cancel_flag) = state.job_manager.create_job("clustering", None);
    state.job_manager.mark_running(&job_id, "Block clustering started");
    emit_job_state(&app, &state.job_manager, &job_id);
    if cancel_flag.load(Ordering::Relaxed) {
        let _ = state.job_manager.cancel_job(&job_id);
        emit_job_state(&app, &state.job_manager, &job_id);
        return Ok(vec![]);
    }
    let db = &state.db;
    let clips = db.get_clips(&project_id).map_err(|e| e.to_string())?;
    let built = clustering::build_scene_blocks(&project_id, &clips, gap_seconds.unwrap_or(60));
    db.replace_scene_blocks(&project_id, &built.blocks, &built.memberships)
        .map_err(|e| format!("Failed to persist scene blocks: {}", e))?;
    state.job_manager.mark_done(&job_id, "Block clustering complete");
    emit_job_state(&app, &state.job_manager, &job_id);
    get_scene_blocks(project_id, state).await
}

#[tauri::command]
pub async fn get_scene_blocks(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SceneBlockWithClips>, String> {
    let db = &state.db;
    let blocks = db.get_scene_blocks(&project_id).map_err(|e| e.to_string())?;
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
    let mut primary_ids = db.get_block_clip_ids(&primary_block_id).map_err(|e| e.to_string())?;
    let secondary_ids = db.get_block_clip_ids(&secondary_block_id).map_err(|e| e.to_string())?;

    for clip_id in secondary_ids {
        if !primary_ids.contains(&clip_id) {
            primary_ids.push(clip_id);
        }
    }

    db.replace_block_memberships(&primary_block_id, &primary_ids)
        .map_err(|e| e.to_string())?;
    db.refresh_scene_block_stats(&primary_block_id)
        .map_err(|e| e.to_string())?;
    db.delete_scene_block(&secondary_block_id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn split_scene_block(
    block_id: String,
    split_at_clip_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    let clip_ids = db.get_block_clip_ids(&block_id).map_err(|e| e.to_string())?;
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
        clip_count: second_half.len() as i32,
        camera_list: original.camera_list.clone(),
        confidence: original.confidence,
    };
    db.create_scene_block(&new_block).map_err(|e| e.to_string())?;
    db.replace_block_memberships(&new_block_id, &second_half)
        .map_err(|e| e.to_string())?;
    db.refresh_scene_block_stats(&block_id).map_err(|e| e.to_string())?;
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
}

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: String,
    pub build_date: String,
    pub ffmpeg_version: String,
    pub ffprobe_version: String,
    pub macos_version: String,
    pub arch: String,
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
    let (job_id, _cancel_flag) = state.job_manager.create_job("director_pack", None);
    state.job_manager.mark_running(&job_id, "Director Pack export started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let db = &state.db;
    let project = db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    let pack_root = format!("{}/DirectorPack", output_root);
    let contact_dir = format!("{}/ContactSheet", pack_root);
    let resolve_dir = format!("{}/Resolve", pack_root);
    let reports_dir = format!("{}/Reports", pack_root);
    std::fs::create_dir_all(&contact_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&resolve_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&reports_dir).map_err(|e| e.to_string())?;

    let filtered_clips = resolve_clips_for_scope(db, &project_id, &filter.mode, filter.min_rating, filter.block_ids)
        .map_err(|e| e.to_string())?;
    if filtered_clips.is_empty() {
        return Err("No clips available for current filter scope.".into());
    }

    let fcpxml_path = format!("{}/{}_director.fcpxml", resolve_dir, sanitize_filename(&project.name));
    let fcpxml = crate::export::generate_fcpxml_structured(
        &filtered_clips,
        &project.name,
        include_master_timeline.unwrap_or(true),
    );
    std::fs::write(&fcpxml_path, fcpxml).map_err(|e| e.to_string())?;

    let report_path = format!("{}/{}_summary.json", reports_dir, sanitize_filename(&project.name));
    let report = serde_json::json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "project": project,
        "scope": filter.mode,
        "clip_count": filtered_clips.len(),
        "clips": filtered_clips,
        "exported_at": chrono::Utc::now().to_rfc3339(),
    });
    let report_content = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    std::fs::write(&report_path, report_content).map_err(|e| e.to_string())?;

    let pdf_path = format!("{}/{}_contact_sheet.pdf", contact_dir, sanitize_filename(&project.name));
    write_simple_contact_sheet_pdf(&pdf_path, &project.name, &filtered_clips)
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
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }),
    );

    state.job_manager.mark_done(&job_id, "Director Pack export complete");
    emit_job_state(&app, &state.job_manager, &job_id);

    Ok(DirectorPackResult {
        root: pack_root,
        contact_sheet_pdf: pdf_path,
        resolve_fcpxml: fcpxml_path,
        json_summary: report_path,
    })
}

#[tauri::command]
pub async fn get_app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_date: option_env!("BUILD_DATE")
            .unwrap_or("unknown")
            .to_string(),
        ffmpeg_version: command_first_line("ffmpeg", &["-version"]).unwrap_or_else(|| "Unavailable".to_string()),
        ffprobe_version: command_first_line("ffprobe", &["-version"]).unwrap_or_else(|| "Unavailable".to_string()),
        macos_version: command_first_line("sw_vers", &["-productVersion"]).unwrap_or_else(|| "Unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
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

    zip.start_file("app_info.json", options).map_err(|e| e.to_string())?;
    zip.write_all(
        serde_json::to_string_pretty(&app_info)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("jobs.json", options).map_err(|e| e.to_string())?;
    zip.write_all(
        serde_json::to_string_pretty(&jobs)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;

    if let Some(last_export) = read_last_export_metadata(&state.cache_dir) {
        zip.start_file("last_export.json", options).map_err(|e| e.to_string())?;
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
    pub clip_id: String,
    pub clip_index: usize,
    pub total_clips: usize,
    pub status: String,
    pub thumbnails: Vec<Thumbnail>,
}

// ─── Helpers ───

fn hash_string(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn generate_clip_id(file_path: &str, relative_path: Option<&str>) -> String {
    let metadata = std::fs::metadata(file_path).ok();
    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.timestamp().to_string()
        })
        .unwrap_or_default();

    // Use relative path if available for portability (e.g. project moved or accessed from different root)
    let path_key = relative_path.unwrap_or(file_path);

    let input = format!("{}:{}:{}", path_key, size, modified);
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
        let clip_ids = db.get_clip_ids_for_blocks(&selected_blocks).map_err(|e| e.to_string())?;
        if clip_ids.is_empty() {
            vec![]
        } else {
            db.get_clips_by_ids(&clip_ids).map_err(|e| e.to_string())?
        }
    } else {
        db.get_clips(project_id).map_err(|e| e.to_string())?
    };

    Ok(clips
        .into_iter()
        .filter(|c| match scope {
            "picks" => c.flag == "pick",
            "rated" => c.rating > 0,
            "rated_min" => c.rating >= min_rating.unwrap_or(3),
            "selected_blocks" => true,
            _ => true,
        })
        .collect())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn write_simple_contact_sheet_pdf(
    output_path: &str,
    project_name: &str,
    clips: &[Clip],
) -> Result<(), String> {
    use printpdf::{BuiltinFont, Mm, PdfDocument};

    let (doc, page1, layer1) = PdfDocument::new(
        &format!("{} Contact Sheet", project_name),
        Mm(297.0),
        Mm(210.0),
        "Layer 1",
    );
    let layer = doc.get_page(page1).get_layer(layer1);
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;

    layer.use_text(
        format!("Project: {}", project_name),
        16.0,
        Mm(10.0),
        Mm(198.0),
        &font,
    );
    layer.use_text(
        format!("Clips: {}", clips.len()),
        12.0,
        Mm(10.0),
        Mm(190.0),
        &font,
    );

    let mut y = 182.0;
    for clip in clips.iter().take(40) {
        let line = format!(
            "{} | {} | rating:{} | flag:{}",
            clip.filename, clip.audio_summary, clip.rating, clip.flag
        );
        layer.use_text(line, 9.0, Mm(10.0), Mm(y), &font);
        y -= 4.0;
        if y < 10.0 {
            break;
        }
    }

    let mut writer = std::io::BufWriter::new(
        std::fs::File::create(output_path).map_err(|e| e.to_string())?,
    );
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(())
}

fn emit_job_state(app: &AppHandle, manager: &crate::jobs::JobManager, job_id: &str) {
    if let Some(job) = manager.get_job(job_id) {
        if let Err(e) = app.emit("job-progress", job) {
            eprintln!("job-progress emit failed: {}", e);
        }
    }
}

fn command_first_line(bin: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(bin).args(args).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|s| s.trim().to_string())
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
    use crate::db::{Clip, Project};

    fn sample_clip(project_id: &str, id: &str, rating: i32, flag: &str) -> Clip {
        Clip {
            id: id.to_string(),
            project_id: project_id.to_string(),
            filename: format!("{}.mov", id),
            file_path: format!("/tmp/{}.mov", id),
            size_bytes: 10,
            created_at: "2026-01-01 10:00:00".to_string(),
            duration_ms: 1000,
            fps: 24.0,
            width: 1920,
            height: 1080,
            video_codec: "h264".to_string(),
            audio_summary: "AAC".to_string(),
            timecode: None,
            status: "ok".to_string(),
            rating,
            flag: flag.to_string(),
            notes: None,
            audio_envelope: None,
        }
    }

    #[test]
    fn scope_mapping_filters_correctly() {
        let db_path = std::env::temp_dir().join(format!("wrap-preview-test-{}.db", uuid::Uuid::new_v4()));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        let project_id = "p1";
        db.upsert_project(&Project {
            id: project_id.to_string(),
            root_path: "/tmp".to_string(),
            name: "P".to_string(),
            created_at: "2026-01-01".to_string(),
        }).unwrap();
        db.upsert_clip(&sample_clip(project_id, "c1", 5, "pick")).unwrap();
        db.upsert_clip(&sample_clip(project_id, "c2", 2, "none")).unwrap();

        let picks = resolve_clips_for_scope(&db, project_id, "picks", None, None).unwrap();
        assert_eq!(picks.len(), 1);
        let rated_min = resolve_clips_for_scope(&db, project_id, "rated_min", Some(3), None).unwrap();
        assert_eq!(rated_min.len(), 1);
        let all = resolve_clips_for_scope(&db, project_id, "all", None, None).unwrap();
        assert_eq!(all.len(), 2);
    }
}
