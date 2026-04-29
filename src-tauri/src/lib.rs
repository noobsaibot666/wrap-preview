/*
 * (c) 2026 Alan Alves. All rights reserved.
 * CineFlow Suite — Professional Production to Post Hub
 * hello@expose-u.com | https://alan-design.com/
 */

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
mod production;
mod production_calibration;
mod production_match_lab;
mod review_core;
mod scanner;
mod thumbnail;
mod tools;
mod verification;

#[cfg(target_os = "macos")]
pub(crate) mod mac_bookmarks;

use commands::AppState;
use std::sync::Arc;
use tauri::Emitter;
// Unused imports removed

fn cache_root_dir() -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        crate::review_core::storage::review_core_app_root().join("cache")
    }

    #[cfg(not(debug_assertions))]
    {
        dirs_next::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("cineflow-suite")
    }
}

fn sqlite_db_path() -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        crate::review_core::storage::review_core_app_root().join("cineflow-suite.db")
    }

    #[cfg(not(debug_assertions))]
    {
        cache_root_dir().join("cineflow-suite.db")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_dir = crate::review_core::storage::review_core_app_root();
    let review_core_base_dir = crate::review_core::storage::review_core_base_dir();
    let cache_dir_path = cache_root_dir();
    let db_path = sqlite_db_path();

    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
    std::fs::create_dir_all(&cache_dir_path).expect("Failed to create cache directory");
    std::fs::create_dir_all(&review_core_base_dir).expect("Failed to create Review Core directory");

    let database =
        db::Database::new(&db_path.to_string_lossy()).expect("Failed to initialize database");

    // Reset any asset versions that were stuck in "processing" from a previous crash.
    if let Err(e) = database.reset_stuck_processing_versions() {
        eprintln!("Warning: failed to reset stuck processing versions: {}", e);
    }

    let app_state = Arc::new(AppState {
        db: database.clone(),
        cache_dir: cache_dir_path.to_string_lossy().to_string(),
        app_data_dir,
        db_path,
        job_manager: Arc::new(crate::jobs::JobManager::new(Some(database))),
        perf_log: crate::perf::PerfLog::new(500),
        review_core_base_dir,
        review_core_server_base_url: std::sync::Mutex::new(None),
        production_matchlab_proxy_tracker: crate::production_match_lab::MatchLabProxyTracker::default(),
        production_matchlab_analysis_tracker: crate::production_match_lab::MatchLabAnalysisTracker::default(),
        production_matchlab_braw_decoder_caps: std::sync::Mutex::new(None),
        production_matchlab_redline_decoder_caps: std::sync::Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state.clone())
        .on_window_event(|_window, event| {
            // Windows: force a clean exit on window close/destroy to prevent the
            // Tauri/tao/WebView2 teardown panic ("cannot move state from Destroyed")
            // which causes WACK "Crashes and hangs" FAIL with panic = "abort".
            #[cfg(target_os = "windows")]
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                std::process::exit(0);
            }
            #[cfg(not(target_os = "windows"))]
            let _ = event;
        })
        .setup(move |app| {
            let handle = app.handle();
            crate::tools::init(handle.clone());
            // Non-fatal: if TCP bind fails (e.g. WACK/sandbox restricts loopback sockets),
            // the app still launches. Streaming review features degrade gracefully.
            match crate::review_core::server::start_review_core_server(
                app_state.db.clone(),
                app_state.review_core_base_dir.clone(),
            ) {
                Ok(url) => {
                    if let Ok(mut lock) = app_state.review_core_server_base_url.lock() {
                        *lock = Some(url);
                    }
                }
                Err(e) => {
                    eprintln!("[review_core] server unavailable: {e}");
                }
            }

            // Native menu — macOS only (Windows uses the OS chrome; no menu bar needed)
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

                let app = handle;
                let about_menu = Submenu::with_id(app, "about", "CineFlow Suite", true)?;
                let settings = MenuItem::with_id(app, "settings", "Settings...", true, Some(","))?;

                about_menu.append(&PredefinedMenuItem::about(app, Some("CineFlow Suite"), None)?)?;
                about_menu.append(&PredefinedMenuItem::separator(app)?)?;
                about_menu.append(&settings)?;
                about_menu.append(&PredefinedMenuItem::separator(app)?)?;
                about_menu.append(&PredefinedMenuItem::services(app, None)?)?;
                about_menu.append(&PredefinedMenuItem::separator(app)?)?;
                about_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
                about_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
                about_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
                about_menu.append(&PredefinedMenuItem::separator(app)?)?;
                about_menu.append(&PredefinedMenuItem::quit(app, None)?)?;

                let edit_menu = Submenu::with_id(app, "edit", "Edit", true)?;
                edit_menu.append(&PredefinedMenuItem::undo(app, None)?)?;
                edit_menu.append(&PredefinedMenuItem::redo(app, None)?)?;
                edit_menu.append(&PredefinedMenuItem::separator(app)?)?;
                edit_menu.append(&PredefinedMenuItem::cut(app, None)?)?;
                edit_menu.append(&PredefinedMenuItem::copy(app, None)?)?;
                edit_menu.append(&PredefinedMenuItem::paste(app, None)?)?;
                edit_menu.append(&PredefinedMenuItem::select_all(app, None)?)?;

                let view_menu = Submenu::with_id(app, "view", "View", true)?;
                view_menu.append(&PredefinedMenuItem::fullscreen(app, None)?)?;

                let window_menu = Submenu::with_id(app, "window", "Window", true)?;
                window_menu.append(&PredefinedMenuItem::minimize(app, None)?)?;
                window_menu.append(&PredefinedMenuItem::maximize(app, None)?)?;
                window_menu.append(&PredefinedMenuItem::separator(app)?)?;
                window_menu.append(&PredefinedMenuItem::close_window(app, None)?)?;

                let menu = Menu::with_items(app, &[&about_menu, &edit_menu, &view_menu, &window_menu])?;
                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| {
                    if event.id() == "settings" {
                        let _ = app_handle.emit("open-settings", ());
                    }
                });
            }

            #[cfg(debug_assertions)]
            {
                let table_status = app_state
                    .db
                    .production_boot_table_status()
                    .unwrap_or_default();
                let cache_root = std::path::Path::new(&app_state.cache_dir)
                    .join("production")
                    .join("cache")
                    .join("match_lab");
                let _ = std::fs::create_dir_all(&cache_root);
                let command_names = [
                    "production_create_project",
                    "production_list_projects",
                    "production_touch_project",
                    "production_delete_project",
                    "shot_list_ensure_project",
                    "shot_list_get_bundle",
                    "shot_list_save_project",
                    "shot_list_save_row",
                    "shot_list_delete_row",
                    "shot_list_reorder_rows",
                    "shot_list_save_equipment_section",
                    "shot_list_delete_equipment_section",
                    "shot_list_reorder_sections",
                    "shot_list_save_equipment_item",
                    "shot_list_delete_equipment_item",
                    "shot_list_reorder_equipment_items",
                    "shot_list_replace_bundle",
                    "production_save_look_setup",
                    "production_get_look_setup",
                    "production_save_onset_checks",
                    "production_get_onset_checks",
                    "production_save_preset",
                    "production_list_presets",
                    "production_get_preset",
                    "production_matchlab_ensure_proxy",
                    "camera_match_analyze_clip",
                    "production_matchlab_save_run",
                    "production_matchlab_list_runs",
                    "production_matchlab_get_run",
                    "production_matchlab_delete_run",
                    "production_matchlab_detect_calibration",
                    "production_matchlab_generate_transform",
                    "production_matchlab_export_lut",
                    "production_matchlab_export_calibration_package",
                ];
                eprintln!(
                    "[production][boot] command registry loaded: {}",
                    command_names.join(", ")
                );
                eprintln!(
                    "[production][boot] table status: {}",
                    table_status
                        .iter()
                        .map(|(name, ok)| format!("{}={}", name, if *ok { "ok" } else { "missing" }))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                eprintln!(
                    "[production][boot] cache root: {} exists={}",
                    cache_root.display(),
                    cache_root.exists()
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::scan_media,
            commands::list_project_roots,
            commands::add_project_root,
            commands::remove_project_root,
            commands::update_project_root_label,
            commands::rescan_project,
            commands::get_clips,
            commands::extract_thumbnails,
            commands::get_project,
            commands::read_thumbnail,
            commands::generate_frame_preview_image_proxy,
            commands::read_audio_preview,
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
            commands::get_cache_dir,
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
            commands::reorder_scene_blocks,
            commands::reorder_scene_block_clips,
            commands::promote_clip_to_block,
            commands::set_project_lut,
            commands::remove_project_lut,
            commands::set_clip_lut_enabled,
            commands::set_all_clips_lut,
            commands::generate_lut_thumbnails,
            commands::get_project_settings,
            commands::create_folder_zip,
            commands::create_folder_structure,
            commands::import_folder_structure,
            commands::scan_duplicates,
            commands::delete_duplicate_file,
            commands::purge_cache,
            commands::review_core_ingest_files,
            commands::review_core_create_project,
            commands::review_core_list_projects,
            commands::review_core_touch_project,
            commands::review_core_list_assets,
            commands::review_core_list_assets_with_versions,
            commands::review_core_list_asset_versions,
            commands::review_core_list_thumbnails,
            commands::review_core_get_server_base_url,
            commands::review_core_check_duplicate_files,
            commands::review_core_add_comment,
            commands::review_core_list_comments,
            commands::review_core_update_comment,
            commands::review_core_delete_comment,
            commands::review_core_add_annotation,
            commands::review_core_list_annotations,
            commands::review_core_delete_annotation,
            commands::review_core_extract_frame,
            commands::review_core_list_frame_notes,
            commands::review_core_read_frame_note_image,
            commands::review_core_update_frame_note,
            commands::review_core_delete_frame_note,
            commands::review_core_get_approval,
            commands::review_core_set_approval,
            commands::review_core_create_share_link,
            commands::review_core_list_share_links,
            commands::review_core_revoke_share_link,
            commands::review_core_resolve_share_link,
            commands::review_core_verify_share_link_password,
            commands::review_core_share_unlock,
            commands::review_core_share_list_assets,
            commands::review_core_share_list_versions,
            commands::review_core_share_list_thumbnails,
            commands::review_core_share_list_comments,
            commands::review_core_share_add_comment,
            commands::review_core_share_set_display_name,
            commands::review_core_share_list_annotations,
            commands::review_core_share_export_download,
            commands::production_create_project,
            commands::production_list_projects,
            commands::production_touch_project,
            commands::production_delete_project,
            commands::shot_list_ensure_project,
            commands::shot_list_get_bundle,
            commands::shot_list_save_project,
            commands::shot_list_save_row,
            commands::shot_list_delete_row,
            commands::shot_list_reorder_rows,
            commands::shot_list_save_equipment_section,
            commands::shot_list_delete_equipment_section,
            commands::shot_list_reorder_sections,
            commands::shot_list_save_equipment_item,
            commands::shot_list_delete_equipment_item,
            commands::shot_list_reorder_equipment_items,
            commands::shot_list_replace_bundle,
            commands::get_camera_profiles,
            commands::get_look_presets,
            commands::save_production_camera_config,
            commands::list_production_camera_configs,
            commands::production_save_look_setup,
            commands::production_get_look_setup,
            commands::production_save_onset_checks,
            commands::production_get_onset_checks,
            commands::production_save_preset,
            commands::production_list_presets,
            commands::production_get_preset,
            commands::production_matchlab_ensure_proxy,
            commands::production_matchlab_save_run,
            commands::production_matchlab_save_sources,
            commands::production_matchlab_get_sources,
            commands::production_matchlab_list_runs,
            commands::production_matchlab_get_run,
            commands::production_matchlab_delete_run,
            commands::production_matchlab_detect_calibration,
            commands::production_matchlab_generate_transform,
            commands::production_matchlab_export_lut,
            commands::production_matchlab_export_calibration_package,
            commands::camera_match_analyze_clip,
            commands::reset_app_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
