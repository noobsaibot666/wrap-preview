use crate::db::{Clip, Database, Project, Thumbnail};
use crate::ffprobe;
use crate::scanner;
use crate::thumbnail;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;

/// App state holding the database
pub struct AppState {
    pub db: Database,
    pub cache_dir: String,
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

        let clip = match meta {
            Ok(m) => {
                let clip_id = generate_clip_id(file_path);

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
                }
            }
            Err(e) => {
                let filename = std::path::Path::new(file_path)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();

                Clip {
                    id: generate_clip_id(file_path),
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
) -> Result<(), String> {
    let db = &state.db;
    let cache_dir = state.cache_dir.clone();

    let clips = db
        .get_clips(&project_id)
        .map_err(|e| format!("Failed to get clips: {}", e))?;

    let total_clips = clips.len();
    let semaphore = Arc::new(Semaphore::new(3)); // 3 concurrent jobs

    for (clip_idx, clip) in clips.iter().enumerate() {
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
                    db.upsert_thumbnail(&thumb).ok();
                    thumb_results.push(thumb);
                }
                Err(_) => {
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

        drop(permit);
    }

    let _ = app.emit("thumbnail-complete", serde_json::json!({
        "project_id": project_id,
    }));

    Ok(())
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
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read thumbnail: {}", e))?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
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
pub async fn save_brand_logo(project_path: String, content: String) -> Result<(), String> {
    let brand_dir = format!("{}/brand", project_path);
    std::fs::create_dir_all(&brand_dir)
        .map_err(|e| format!("Failed to create brand directory: {}", e))?;

    let logo_path = format!("{}/logo.svg", brand_dir);
    std::fs::write(&logo_path, content).map_err(|e| format!("Failed to write logo: {}", e))?;

    Ok(())
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

fn generate_clip_id(file_path: &str) -> String {
    let metadata = std::fs::metadata(file_path).ok();
    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.timestamp().to_string()
        })
        .unwrap_or_default();

    let input = format!("{}:{}:{}", file_path, size, modified);
    hash_string(&input)
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
