use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct ReviewCoreProcessContext {
    pub app: AppHandle,
    pub db: crate::db::Database,
    pub job_manager: Arc<crate::jobs::JobManager>,
    pub review_core_base_dir: PathBuf,
    pub job_id: String,
    pub cancel_flag: Arc<AtomicBool>,
}

fn emit_job_state(app: &AppHandle, manager: &crate::jobs::JobManager, job_id: &str) {
    if let Some(job) = manager.get_job(job_id) {
        let _ = app.emit("job-progress", job);
    }
}

fn check_cancel(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if crate::jobs::JobManager::is_cancelled(cancel_flag) {
        Err("Review Core processing cancelled".to_string())
    } else {
        Ok(())
    }
}

fn ffmpeg_run(args: &[String]) -> Result<(), String> {
    let ffmpeg = crate::tools::find_executable("ffmpeg");
    let output = std::process::Command::new(ffmpeg)
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

fn compute_gop_size(fps: f64) -> i32 {
    ((fps.max(1.0) * 2.0).round() as i32).clamp(12, 240)
}

fn format_hls_args(input: &Path, output_dir: &Path, has_audio: bool, fps: f64) -> Vec<String> {
    let segment_pattern = output_dir.join("segment_%04d.ts");
    let playlist = output_dir.join("index.m3u8");
    let gop = compute_gop_size(fps);
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-vf".to_string(),
        "scale='min(1280,iw)':-2".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-g".to_string(),
        gop.to_string(),
        "-keyint_min".to_string(),
        gop.to_string(),
        "-sc_threshold".to_string(),
        "0".to_string(),
    ];
    if has_audio {
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "128k".to_string(),
        ]);
    } else {
        args.push("-an".to_string());
    }
    args.extend([
        "-f".to_string(),
        "hls".to_string(),
        "-hls_time".to_string(),
        "2".to_string(),
        "-hls_playlist_type".to_string(),
        "vod".to_string(),
        "-hls_segment_filename".to_string(),
        segment_pattern.to_string_lossy().to_string(),
        playlist.to_string_lossy().to_string(),
    ]);
    args
}

fn format_proxy_mp4_args(input: &Path, output: &Path, has_audio: bool, fps: f64) -> Vec<String> {
    let gop = compute_gop_size(fps);
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-vf".to_string(),
        "scale='min(1280,iw)':-2".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-g".to_string(),
        gop.to_string(),
    ];
    if has_audio {
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "128k".to_string(),
        ]);
    } else {
        args.push("-an".to_string());
    }
    args.push(output.to_string_lossy().to_string());
    args
}

fn format_poster_args(input: &Path, poster: &Path) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-ss".to_string(),
        "00:00:01.000".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-frames:v".to_string(),
        "1".to_string(),
        "-q:v".to_string(),
        "2".to_string(),
        poster.to_string_lossy().to_string(),
    ]
}

fn format_thumb_args(input: &Path, thumbs_dir: &Path, interval_seconds: u64) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-vf".to_string(),
        format!("fps=1/{}", interval_seconds.max(1)),
        "-frames:v".to_string(),
        "10".to_string(),
        "-q:v".to_string(),
        "4".to_string(),
        thumbs_dir
            .join("thumb_%04d.jpg")
            .to_string_lossy()
            .to_string(),
    ]
}

pub async fn process_asset_version(
    ctx: ReviewCoreProcessContext,
    project_id: String,
    asset_id: String,
    version_id: String,
    original_abs_path: PathBuf,
    output_dir_abs_path: PathBuf,
) -> Result<(), String> {
    ctx.job_manager
        .mark_running(&ctx.job_id, "Review Core: probing media");
    emit_job_state(&ctx.app, &ctx.job_manager, &ctx.job_id);
    check_cancel(&ctx.cancel_flag)?;

    let original_path_string = original_abs_path.to_string_lossy().to_string();
    let metadata = crate::ffprobe::probe_file(&original_path_string)?;
    ctx.db
        .update_asset_metadata(
            &asset_id,
            metadata.duration_ms,
            metadata.fps,
            metadata.avg_frame_rate.as_deref(),
            metadata.r_frame_rate.as_deref(),
            metadata.is_vfr,
            metadata.width,
            metadata.height,
            &metadata.video_codec,
            Some("processing"),
        )
        .map_err(|e| e.to_string())?;
    ctx.job_manager.update_progress(
        &ctx.job_id,
        0.2,
        Some("Review Core: creating proxy HLS".to_string()),
    );
    emit_job_state(&ctx.app, &ctx.job_manager, &ctx.job_id);
    check_cancel(&ctx.cancel_flag)?;

    let paths = crate::review_core::storage::build_version_paths(
        &ctx.review_core_base_dir,
        &project_id,
        &asset_id,
        ctx.db
            .get_asset_version(&version_id)
            .map_err(|e| e.to_string())?
            .ok_or("Missing asset version during finalize")?
            .version_number,
        original_abs_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("bin"),
    )?;

    let hls_dir = output_dir_abs_path.join("hls");
    std::fs::create_dir_all(&hls_dir).map_err(|e| e.to_string())?;
    ffmpeg_run(&format_hls_args(
        &original_abs_path,
        &hls_dir,
        metadata.audio_codec != "none",
        metadata.fps,
    ))?;

    ctx.job_manager.update_progress(
        &ctx.job_id,
        0.45,
        Some("Review Core: creating download proxy".to_string()),
    );
    emit_job_state(&ctx.app, &ctx.job_manager, &ctx.job_id);
    check_cancel(&ctx.cancel_flag)?;

    ffmpeg_run(&format_proxy_mp4_args(
        &original_abs_path,
        &paths.proxy_mp4_abs_path,
        metadata.audio_codec != "none",
        metadata.fps,
    ))?;

    ctx.job_manager.update_progress(
        &ctx.job_id,
        0.55,
        Some("Review Core: extracting poster".to_string()),
    );
    emit_job_state(&ctx.app, &ctx.job_manager, &ctx.job_id);
    check_cancel(&ctx.cancel_flag)?;

    let poster_path = output_dir_abs_path.join("poster.jpg");
    ffmpeg_run(&format_poster_args(&original_abs_path, &poster_path))?;

    ctx.job_manager.update_progress(
        &ctx.job_id,
        0.75,
        Some("Review Core: generating thumbnails".to_string()),
    );
    emit_job_state(&ctx.app, &ctx.job_manager, &ctx.job_id);
    check_cancel(&ctx.cancel_flag)?;

    let thumbs_dir = output_dir_abs_path.join("thumbs");
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;
    let interval = ((metadata.duration_ms / 1000) / 10).max(1);
    ffmpeg_run(&format_thumb_args(
        &original_abs_path,
        &thumbs_dir,
        interval,
    ))?;

    ctx.db
        .update_asset_version_outputs(
            &version_id,
            Some(&paths.playlist_key),
            Some(&paths.proxy_mp4_key),
            Some(&paths.thumbs_key),
            Some(&paths.poster_key),
            "ready",
        )
        .map_err(|e| e.to_string())?;
    ctx.db
        .set_asset_error(&asset_id, "ready", None)
        .map_err(|e| e.to_string())?;

    ctx.job_manager
        .mark_done(&ctx.job_id, "Review Core processing complete");
    emit_job_state(&ctx.app, &ctx.job_manager, &ctx.job_id);
    Ok(())
}
