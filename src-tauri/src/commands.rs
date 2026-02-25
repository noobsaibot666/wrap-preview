use crate::clustering;
use crate::db::{Clip, Database, Project, ProjectRoot, SceneBlock, SceneDetectionCache, Thumbnail, VerificationJob, VerificationItem};
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
    pub perf_log: crate::perf::PerfLog,
}

// ─── Tauri Commands ───

#[tauri::command]
pub async fn scan_folder(
    folder_path: String,
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
    let initial_root = ProjectRoot {
        id: hash_string(&format!("{}::{}", project_id, folder_path)),
        project_id: project_id.clone(),
        root_path: folder_path.clone(),
        label: "Root 01".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    db.upsert_project_root(&initial_root)
        .map_err(|e| format!("Failed to create initial project root: {}", e))?;

    let clips = rescan_project_internal(db, &project_id)?;

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
pub async fn list_project_roots(
    project_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ProjectRoot>, String> {
    state.db.list_project_roots(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_project_root(
    project_id: String,
    root_path: String,
    label: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<ProjectRoot, String> {
    let root = ProjectRoot {
        id: hash_string(&format!("{}::{}", project_id, root_path)),
        project_id,
        root_path,
        label: label.unwrap_or_else(|| "Root".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
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
    let clips = rescan_project_internal(&state.db, &project_id)?;
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
    let perf_id = state.perf_log.start("extract_thumbnails", Some(project_id.clone()));
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
    state.perf_log.end(&perf_id, "ok", None);
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
    source_label: Option<String>,
    dest_root: String,
    dest_label: Option<String>,
    mode: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let perf_id = state
        .perf_log
        .start("start_verification", Some(format!("{} -> {}", source_root, dest_root)));
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
            source_label.unwrap_or_else(|| "Source".to_string()),
            dest_root,
            dest_label.unwrap_or_else(|| "Destination".to_string()),
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

    state.perf_log.end(&perf_id, "ok", Some(format!("job_id={}", job_id)));
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
pub async fn export_verification_report_markdown(
    job_id: String,
    save_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let job = state
        .db
        .get_verification_job(&job_id)
        .map_err(|e| e.to_string())?
        .ok_or("Job not found")?;
    let items = state.db.get_verification_items(&job_id).map_err(|e| e.to_string())?;

    let mut md = String::new();
    md.push_str("# Wrap Preview Verification Report\n\n");
    md.push_str(&format!("- App: Wrap Preview v{}\n", env!("CARGO_PKG_VERSION")));
    md.push_str(&format!("- Date: {}\n", chrono::Utc::now().to_rfc3339()));
    md.push_str(&format!("- Source: {} ({})\n", job.source_label, job.source_root));
    md.push_str(&format!("- Destination: {} ({})\n", job.dest_label, job.dest_root));
    md.push_str(&format!("- Mode: {}\n\n", job.mode));
    md.push_str("## Summary\n\n");
    md.push_str(&format!("- Verified: {}\n", job.verified_ok_count));
    md.push_str(&format!("- Missing: {}\n", job.missing_count));
    md.push_str(&format!("- Size Mismatch: {}\n", job.size_mismatch_count));
    md.push_str(&format!("- Hash Mismatch: {}\n", job.hash_mismatch_count));
    md.push_str(&format!("- Unreadable: {}\n", job.unreadable_count));
    md.push_str(&format!("- Extra in Destination: {}\n\n", job.extra_in_dest_count));

    md.push_str("## Top Issues\n\n");
    let issues: Vec<_> = items.iter().filter(|i| i.status != "OK").collect();
    for item in issues.iter().take(100) {
        md.push_str(&format!("- [{}] `{}` {}\n", item.status, item.rel_path, item.error_message.clone().unwrap_or_default()));
    }
    if issues.len() > 100 {
        md.push_str(&format!("\n- ... and {} more issues\n", issues.len() - 100));
    }
    std::fs::write(save_path, md).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_verification_report_pdf(
    job_id: String,
    save_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let job = state
        .db
        .get_verification_job(&job_id)
        .map_err(|e| e.to_string())?
        .ok_or("Job not found")?;
    let items = state.db.get_verification_items(&job_id).map_err(|e| e.to_string())?;

    use printpdf::{BuiltinFont, Mm, PdfDocument};
    let (doc, page1, layer1) = PdfDocument::new("Verification Report", Mm(210.0), Mm(297.0), "Layer 1");
    let layer = doc.get_page(page1).get_layer(layer1);
    let font = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| e.to_string())?;

    let mut y: f32 = 285.0;
    let line = |text: String, y_mm: &mut f32, layer: &printpdf::PdfLayerReference, font: &printpdf::IndirectFontRef| {
        layer.use_text(text, 10.0, Mm(10.0), Mm(*y_mm), font);
        *y_mm -= 5.0;
    };

    line("Wrap Preview Verification Report".to_string(), &mut y, &layer, &font);
    line(format!("App: Wrap Preview v{}", env!("CARGO_PKG_VERSION")), &mut y, &layer, &font);
    line(format!("Date: {}", chrono::Utc::now().to_rfc3339()), &mut y, &layer, &font);
    line(format!("Source: {} ({})", job.source_label, job.source_root), &mut y, &layer, &font);
    line(format!("Destination: {} ({})", job.dest_label, job.dest_root), &mut y, &layer, &font);
    line(format!("Mode: {}", job.mode), &mut y, &layer, &font);
    y -= 3.0;
    line(format!("Verified: {}", job.verified_ok_count), &mut y, &layer, &font);
    line(format!("Missing: {}", job.missing_count), &mut y, &layer, &font);
    line(format!("Size mismatch: {}", job.size_mismatch_count), &mut y, &layer, &font);
    line(format!("Hash mismatch: {}", job.hash_mismatch_count), &mut y, &layer, &font);
    line(format!("Unreadable: {}", job.unreadable_count), &mut y, &layer, &font);
    line(format!("Extra in destination: {}", job.extra_in_dest_count), &mut y, &layer, &font);
    y -= 3.0;
    line("Top issues:".to_string(), &mut y, &layer, &font);
    for item in items.iter().filter(|i| i.status != "OK").take(60) {
        if y < 12.0 { break; }
        line(format!("[{}] {}", item.status, item.rel_path), &mut y, &layer, &font);
    }
    line("© Alan Alves. All rights reserved.".to_string(), &mut y, &layer, &font);

    let mut writer = std::io::BufWriter::new(std::fs::File::create(save_path).map_err(|e| e.to_string())?);
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_verification_queue_report_markdown(
    job_ids: Vec<String>,
    save_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if job_ids.is_empty() {
        return Err("No verification jobs provided".into());
    }
    let mut md = String::new();
    md.push_str("# Wrap Preview Verification Queue Report\n\n");
    md.push_str(&format!("- App: Wrap Preview v{}\n", env!("CARGO_PKG_VERSION")));
    md.push_str(&format!("- Date: {}\n", chrono::Utc::now().to_rfc3339()));
    md.push_str(&format!("- Checks: {}\n\n", job_ids.len()));

    let mut totals = (0u32, 0u32, 0u32, 0u32, 0u32, 0u32);
    for (idx, job_id) in job_ids.iter().enumerate() {
        let Some(job) = state.db.get_verification_job(job_id).map_err(|e| e.to_string())? else {
            continue;
        };
        totals.0 += job.verified_ok_count;
        totals.1 += job.missing_count;
        totals.2 += job.size_mismatch_count;
        totals.3 += job.hash_mismatch_count;
        totals.4 += job.unreadable_count;
        totals.5 += job.extra_in_dest_count;
        md.push_str(&format!("## Check {:02}\n\n", idx + 1));
        md.push_str(&format!("- Source: {} ({})\n", job.source_label, job.source_root));
        md.push_str(&format!("- Destination: {} ({})\n", job.dest_label, job.dest_root));
        md.push_str(&format!("- Mode: {}\n", job.mode));
        md.push_str(&format!("- Status: {}\n", job.status));
        md.push_str(&format!(
            "- Summary: Verified {} | Missing {} | Size {} | Hash {} | Unreadable {} | Extra {}\n\n",
            job.verified_ok_count,
            job.missing_count,
            job.size_mismatch_count,
            job.hash_mismatch_count,
            job.unreadable_count,
            job.extra_in_dest_count
        ));

        let items = state.db.get_verification_items(job_id).map_err(|e| e.to_string())?;
        let issues: Vec<_> = items.iter().filter(|i| i.status != "OK").collect();
        for item in issues.iter().take(50) {
            md.push_str(&format!("- [{}] `{}` {}\n", item.status, item.rel_path, item.error_message.clone().unwrap_or_default()));
        }
        if issues.len() > 50 {
            md.push_str(&format!("- ... and {} more\n", issues.len() - 50));
        }
        md.push_str("\n");
    }

    md.push_str("## Queue Totals\n\n");
    md.push_str(&format!("- Verified: {}\n", totals.0));
    md.push_str(&format!("- Missing: {}\n", totals.1));
    md.push_str(&format!("- Size Mismatch: {}\n", totals.2));
    md.push_str(&format!("- Hash Mismatch: {}\n", totals.3));
    md.push_str(&format!("- Unreadable: {}\n", totals.4));
    md.push_str(&format!("- Extra in Destination: {}\n\n", totals.5));
    md.push_str("© Alan Alves. All rights reserved.\n");

    std::fs::write(save_path, md).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_verification_queue_report_pdf(
    job_ids: Vec<String>,
    save_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if job_ids.is_empty() {
        return Err("No verification jobs provided".into());
    }
    use printpdf::{BuiltinFont, Mm, PdfDocument};
    let (doc, page1, layer1) = PdfDocument::new("Verification Queue Report", Mm(210.0), Mm(297.0), "Layer 1");
    let layer = doc.get_page(page1).get_layer(layer1);
    let font = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| e.to_string())?;
    let mut y: f32 = 285.0;
    let line = |text: String, y_mm: &mut f32, layer: &printpdf::PdfLayerReference, font: &printpdf::IndirectFontRef| {
        if *y_mm > 10.0 {
            layer.use_text(text, 10.0, Mm(10.0), Mm(*y_mm), font);
            *y_mm -= 5.0;
        }
    };
    line("Wrap Preview Verification Queue Report".to_string(), &mut y, &layer, &font);
    line(format!("App: Wrap Preview v{}", env!("CARGO_PKG_VERSION")), &mut y, &layer, &font);
    line(format!("Date: {}", chrono::Utc::now().to_rfc3339()), &mut y, &layer, &font);
    y -= 4.0;
    for (idx, job_id) in job_ids.iter().enumerate() {
        let Some(job) = state.db.get_verification_job(job_id).map_err(|e| e.to_string())? else {
            continue;
        };
        if y < 24.0 {
            break;
        }
        line(format!("Check {:02}: {} -> {}", idx + 1, job.source_label, job.dest_label), &mut y, &layer, &font);
        line(format!("  Verified {} | Missing {} | Size {} | Hash {} | Unreadable {} | Extra {}",
            job.verified_ok_count, job.missing_count, job.size_mismatch_count, job.hash_mismatch_count, job.unreadable_count, job.extra_in_dest_count
        ), &mut y, &layer, &font);
    }
    line("© Alan Alves. All rights reserved.".to_string(), &mut y, &layer, &font);
    let mut writer = std::io::BufWriter::new(std::fs::File::create(save_path).map_err(|e| e.to_string())?);
    doc.save(&mut writer).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn extract_audio_waveform(
    clip_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<u8>, String> {
    let perf_id = state.perf_log.start("extract_audio_waveform", Some(clip_id.clone()));
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
    state.perf_log.end(&perf_id, "ok", None);
    Ok(result.envelope)
}

#[tauri::command]
pub async fn auto_analyze_lookbook(
    project_id: String,
    recompute: Option<bool>,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let (job_id, cancel_flag) = state.job_manager.create_job("auto_analyze", None);
    state.job_manager.mark_running(&job_id, "Auto analyze started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let clips = state.db.get_clips(&project_id).map_err(|e| e.to_string())?;
    let total = clips.len().max(1);
    for (idx, clip) in clips.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = state.job_manager.cancel_job(&job_id);
            emit_job_state(&app, &state.job_manager, &job_id);
            return Ok(job_id);
        }
        if !recompute.unwrap_or(false) && clip.auto_motion.is_some() && clip.auto_brightness.is_some() {
            continue;
        }

        // Cheap deterministic heuristics from existing metadata.
        let motion = if clip.fps >= 48.0 {
            "high-motion"
        } else if clip.fps >= 30.0 {
            "moving"
        } else {
            "static"
        };
        let brightness = if clip.video_bitrate > 250_000_000 {
            "bright"
        } else if clip.video_bitrate > 0 {
            "normal"
        } else {
            "low"
        };
        let contrast = if clip.video_codec.contains("raw") || clip.video_codec.contains("braw") {
            "flat"
        } else {
            "normal"
        };
        let temp = "neutral";
        let tags_json = serde_json::json!({
            "auto_motion": motion,
            "auto_brightness": brightness,
            "auto_contrast": contrast,
            "auto_temp": temp,
        })
        .to_string();

        state
            .db
            .update_auto_tags(
                &clip.id,
                Some(motion.to_string()),
                Some(brightness.to_string()),
                Some(contrast.to_string()),
                Some(temp.to_string()),
                Some(tags_json),
                Some("v1-lite".to_string()),
            )
            .map_err(|e| e.to_string())?;

        state.job_manager.update_progress(
            &job_id,
            (idx + 1) as f32 / total as f32,
            Some(format!("Analyzed {}/{} clips", idx + 1, total)),
        );
        emit_job_state(&app, &state.job_manager, &job_id);
    }

    state.job_manager.mark_done(&job_id, "Auto analyze complete");
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
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let db = &state.db;
    db.update_clip_metadata(&clip_id, rating, flag, notes, shot_size, movement, manual_order)
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
    let perf_id = state.perf_log.start("export_to_fcpxml", Some(project_id.clone()));
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
    let perf_id = state.perf_log.start("build_scene_blocks", Some(project_id.clone()));
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
    state.job_manager.mark_done(&job_id, "Block clustering complete");
    emit_job_state(&app, &state.job_manager, &job_id);
    let blocks = get_scene_blocks(project_id, state.clone()).await;
    state.perf_log.end(&perf_id, if blocks.is_ok() { "ok" } else { "error" }, None);
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
    pub braw_bridge_active: bool,
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
    let perf_id = state.perf_log.start("export_director_pack", Some(project_id.clone()));
    let (job_id, _cancel_flag) = state.job_manager.create_job("director_pack", None);
    state.job_manager.mark_running(&job_id, "Director Pack export started");
    emit_job_state(&app, &state.job_manager, &job_id);

    let db = &state.db;
    let project = db
        .get_project(&project_id)
        .map_err(|e| e.to_string())?
        .ok_or("Project not found")?;

    let pack_root = format!("{}/DirectorPack", output_root);
    let contact_dir = format!("{}/01_Contact_Sheet", pack_root);
    let resolve_dir = format!("{}/02_Resolve_Project", pack_root);
    let reports_dir = format!("{}/03_Reports", pack_root);
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

    let result = DirectorPackResult {
        root: pack_root,
        contact_sheet_pdf: pdf_path,
        resolve_fcpxml: fcpxml_path,
        json_summary: report_path,
    };
    state.perf_log.end(&perf_id, "ok", Some(result.root.clone()));
    Ok(result)
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
        braw_bridge_active: command_exists("braw-decode"),
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

#[tauri::command]
pub async fn list_perf_events(state: State<'_, Arc<AppState>>) -> Result<Vec<crate::perf::PerfEvent>, String> {
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
    md.push_str(&format!("- Exported: {}\n", chrono::Utc::now().to_rfc3339()));
    md.push_str(&format!("- Events: {}\n\n", json["events"].as_array().map(|a| a.len()).unwrap_or(0)));
    md.push_str("| Name | Status | Duration (ms) | Started |\n");
    md.push_str("|---|---:|---:|---|\n");
    if let Some(arr) = json["events"].as_array() {
        for ev in arr {
            md.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                ev["name"].as_str().unwrap_or(""),
                ev["status"].as_str().unwrap_or(""),
                ev["duration_ms"].as_u64().map(|v| v.to_string()).unwrap_or_else(|| "-".to_string()),
                ev["started_at"].as_str().unwrap_or("")
            ));
        }
    }
    std::fs::write(&md_path, md).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "md_path": md_path, "json_path": json_path }))
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

fn rescan_project_internal(db: &Database, project_id: &str) -> Result<Vec<Clip>, String> {
    let roots = db
        .list_project_roots(project_id)
        .map_err(|e| format!("Failed listing project roots: {}", e))?;
    if roots.is_empty() {
        return Ok(vec![]);
    }

    let mut clips: Vec<Clip> = Vec::new();
    let mut seen_ids: Vec<String> = Vec::new();
    for root in roots {
        let files = scanner::scan_folder(&root.root_path);
        for file_path in files {
            let rel_path = std::path::Path::new(&file_path)
                .strip_prefix(&root.root_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| file_path.clone());
            let clip = build_clip_from_file(db, project_id, &root, &file_path, &rel_path);
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
                audio_summary: m.audio_summary,
                timecode: m.timecode,
                status: status.to_string(),
                rating: 0,
                flag: "none".to_string(),
                notes: None,
                shot_size: None,
                movement: None,
                manual_order: 0,
                auto_motion: None,
                auto_brightness: None,
                auto_contrast: None,
                auto_temp: None,
                auto_tags_json: None,
                auto_analyzed_at: None,
                auto_analyzer_version: None,
                audio_envelope: None,
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
                audio_summary: format!("Error: {}", e),
                timecode: None,
                status: "fail".to_string(),
                rating: 0,
                flag: "none".to_string(),
                notes: None,
                shot_size: None,
                movement: None,
                manual_order: 0,
                auto_motion: None,
                auto_brightness: None,
                auto_contrast: None,
                auto_temp: None,
                auto_tags_json: None,
                auto_analyzed_at: None,
                auto_analyzer_version: None,
                audio_envelope: None,
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

fn command_exists(bin: &str) -> bool {
    Command::new("sh")
        .args(["-lc", &format!("command -v {} >/dev/null 2>&1", bin)])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
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
            audio_summary: "AAC".to_string(),
            timecode: None,
            status: "ok".to_string(),
            rating,
            flag: flag.to_string(),
            notes: None,
            shot_size: None,
            movement: None,
            manual_order: 0,
            auto_motion: None,
            auto_brightness: None,
            auto_contrast: None,
            auto_temp: None,
            auto_tags_json: None,
            auto_analyzed_at: None,
            auto_analyzer_version: None,
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
