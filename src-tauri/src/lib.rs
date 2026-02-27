mod audio;
mod clustering;
mod commands;
mod db;
mod export;
mod ffprobe;
mod folders;
mod jobs;
mod lut;
mod perf;
mod scanner;
mod thumbnail;
mod tools;
mod verification;

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
        perf_log: crate::perf::PerfLog::new(500),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::list_project_roots,
            commands::add_project_root,
            commands::remove_project_root,
            commands::update_project_root_label,
            commands::rescan_project,
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
            commands::list_perf_events,
            commands::clear_perf_events,
            commands::export_perf_report,
            commands::get_verification_job,
            commands::get_verification_items,
            commands::list_verification_jobs_for_project,
            commands::list_verification_queue,
            commands::set_verification_queue_item,
            commands::remove_verification_queue_item,
            commands::clear_verification_queue,
            commands::start_verification_queue,
            commands::export_verification_report_json,
            commands::export_verification_report_markdown,
            commands::export_verification_report_pdf,
            commands::export_verification_queue_report_markdown,
            commands::export_verification_queue_report_pdf,
            commands::extract_audio_waveform,
            commands::update_clip_metadata,
            commands::export_to_fcpxml,
            commands::export_director_pack,
            commands::build_scene_blocks,
            commands::clear_scene_detection_cache,
            commands::get_scene_blocks,
            commands::rename_scene_block,
            commands::merge_scene_blocks,
            commands::split_scene_block,
            commands::set_project_lut,
            commands::remove_project_lut,
            commands::set_clip_lut_enabled,
            commands::generate_lut_thumbnails,
            commands::get_project_settings,
            commands::create_folder_zip,
            commands::purge_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
