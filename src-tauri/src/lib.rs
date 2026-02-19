mod audio;
mod commands;
mod clustering;
mod db;
mod ffprobe;
mod jobs;
mod scanner;
mod thumbnail;
mod verification;
mod export;

use commands::AppState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Determine cache directory
    let cache_dir = dirs_next::cache_dir()
        .map(|d| d.join("wrap-preview").to_string_lossy().to_string())
        .unwrap_or_else(|| "/tmp/wrap-preview".to_string());

    std::fs::create_dir_all(&cache_dir).expect("Failed to create cache directory");

    // Database path
    let db_path = format!("{}/wrap-preview.db", &cache_dir);
    let database = db::Database::new(&db_path).expect("Failed to initialize database");

    let app_state = Arc::new(AppState {
        db: database,
        cache_dir,
        job_manager: crate::jobs::JobManager::new(),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::get_clips,
            commands::extract_thumbnails,
            commands::get_project,
            commands::read_thumbnail,
            commands::save_image_data_url,
            commands::load_brand_profile,
            commands::read_brand_logo,
            commands::save_brand_profile,
            commands::save_brand_logo,
            commands::start_verification,
            commands::get_job,
            commands::list_jobs,
            commands::cancel_job,
            commands::get_app_info,
            commands::export_feedback_bundle,
            commands::get_verification_job,
            commands::get_verification_items,
            commands::export_verification_report_json,
            commands::extract_audio_waveform,
            commands::update_clip_metadata,
            commands::export_to_fcpxml,
            commands::export_director_pack,
            commands::build_scene_blocks,
            commands::get_scene_blocks,
            commands::rename_scene_block,
            commands::merge_scene_blocks,
            commands::split_scene_block,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
