use crate::db::{Clip, SceneBlock, SceneBlockClip};
use chrono::{DateTime, NaiveDateTime, Utc};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub struct BuiltBlocks {
    pub blocks: Vec<SceneBlock>,
    pub memberships: Vec<SceneBlockClip>,
}

pub fn build_scene_blocks(
    project_id: &str,
    clips: &[Clip],
    mode: &str,
    gap_seconds: i64,
    overlap_window_seconds: i64,
) -> BuiltBlocks {
    let effective_gap = match mode {
        "scene_change" => (gap_seconds / 2).max(10),
        "multicam_overlap" => gap_seconds.max(overlap_window_seconds).max(15),
        _ => gap_seconds.max(1),
    };

    let mut ordered = clips.to_vec();
    ordered.sort_by_key(|clip| {
        let ts = clip_timestamp(clip);
        (ts.unwrap_or(0), clip.filename.clone())
    });

    let mut groups: Vec<Vec<Clip>> = Vec::new();
    for clip in ordered {
        if let Some(last_group) = groups.last_mut() {
            let last_ts = last_group.last().and_then(clip_timestamp);
            let current_ts = clip_timestamp(&clip);
            let should_split = match (last_ts, current_ts) {
                (Some(prev), Some(cur)) => cur - prev > effective_gap,
                _ => false,
            };
            if should_split {
                groups.push(vec![clip]);
            } else {
                last_group.push(clip);
            }
        } else {
            groups.push(vec![clip]);
        }
    }

    let mut blocks = Vec::new();
    let mut memberships = Vec::new();

    for (idx, group) in groups.iter().enumerate() {
        let start_time = group.first().and_then(clip_timestamp);
        let end_time = group.last().and_then(clip_timestamp);

        let mut cameras = BTreeSet::new();
        for clip in group {
            if let Some(label) = infer_camera_label(&clip.filename) {
                cameras.insert(label);
            }
        }
        let camera_list = if cameras.is_empty() {
            None
        } else {
            Some(cameras.iter().cloned().collect::<Vec<_>>().join(", "))
        };
        let confidence = compute_confidence(group.len(), cameras.len());
        let block_id = block_id(project_id, idx, start_time.unwrap_or(idx as i64));
        let block_name = format!("Block {:02}", idx + 1);

        blocks.push(SceneBlock {
            id: block_id.clone(),
            project_id: project_id.to_string(),
            name: block_name,
            start_time,
            end_time,
            display_order: idx as i32,
            clip_count: group.len() as i32,
            camera_list,
            confidence,
        });

        for (sort_index, clip) in group.iter().enumerate() {
            memberships.push(SceneBlockClip {
                block_id: block_id.clone(),
                clip_id: clip.id.clone(),
                camera_label: infer_camera_label(&clip.filename),
                sort_index: sort_index as i32,
            });
        }
    }

    BuiltBlocks {
        blocks,
        memberships,
    }
}

fn compute_confidence(clip_count: usize, camera_count: usize) -> f32 {
    match (clip_count, camera_count) {
        (0, _) => 0.0,
        (1, _) => 0.45,
        (_, 0) => 0.62,
        (_, 1) => 0.72,
        (_, 2) => 0.88,
        _ => 0.95,
    }
}

fn block_id(project_id: &str, idx: usize, ts: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}", project_id, idx, ts).as_bytes());
    format!("blk_{:x}", hasher.finalize())[..20].to_string()
}

fn parse_ts(value: &str) -> Option<i64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.timestamp());
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc).timestamp());
    }
    None
}

fn clip_timestamp(clip: &Clip) -> Option<i64> {
    parse_ts(&clip.created_at).or_else(|| {
        std::fs::metadata(&clip.file_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| DateTime::<Utc>::from(t).timestamp())
    })
}

fn infer_camera_label(filename: &str) -> Option<String> {
    let upper = filename.to_uppercase();
    for token in upper.split(|c: char| !c.is_ascii_alphanumeric()) {
        if token.is_empty() {
            continue;
        }
        if token == "A" || token == "B" || token == "C" || token == "D" {
            return Some(format!("Cam {}", token));
        }
        if let Some(rest) = token.strip_prefix("CAM") {
            if !rest.is_empty() {
                return Some(format!("Cam {}", rest));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_clip(id: &str, filename: &str, created_at: &str) -> Clip {
        Clip {
            id: id.to_string(),
            project_id: "p1".to_string(),
            root_id: "root-1".to_string(),
            rel_path: filename.to_string(),
            filename: filename.to_string(),
            file_path: "/tmp/none".to_string(),
            size_bytes: 1,
            created_at: created_at.to_string(),
            duration_ms: 1000,
            fps: 24.0,
            width: 1920,
            height: 1080,
            video_codec: "h264".to_string(),
            video_bitrate: 100_000_000,
            format_name: "mov".to_string(),
            audio_codec: "aac".to_string(),
            audio_channels: 2,
            audio_sample_rate: 48_000,
            camera_iso: None,
            camera_white_balance: None,
            camera_lens: None,
            camera_aperture: None,
            camera_angle: None,
            audio_summary: "AAC".to_string(),
            timecode: None,
            status: "ok".to_string(),
            rating: 0,
            flag: "none".to_string(),
            notes: None,
            shot_size: None,
            movement: None,
            manual_order: 0,
            audio_envelope: None,
            lut_enabled: 0,
        }
    }

    #[test]
    fn clusters_by_gap_threshold() {
        let clips = vec![
            make_clip("1", "A001_CamA.mov", "2026-01-01 10:00:00"),
            make_clip("2", "A002_CamB.mov", "2026-01-01 10:00:10"),
            make_clip("3", "A003_CamA.mov", "2026-01-01 10:03:30"),
        ];
        let built = build_scene_blocks("p1", &clips, "time_gap", 60, 30);
        assert_eq!(built.blocks.len(), 2);
        assert_eq!(built.blocks[0].clip_count, 2);
        assert_eq!(built.blocks[1].clip_count, 1);
    }

    #[test]
    fn infers_camera_labels() {
        assert_eq!(
            infer_camera_label("clip_CAMA_001.mov"),
            Some("Cam A".to_string())
        );
        assert_eq!(
            infer_camera_label("clip_B_001.mov"),
            Some("Cam B".to_string())
        );
        assert_eq!(infer_camera_label("clip_unknown_001.mov"), None);
    }
}
