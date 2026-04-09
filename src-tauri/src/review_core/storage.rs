use std::path::{Component, Path, PathBuf};

pub fn review_core_app_root() -> PathBuf {
    let app_dir = if cfg!(debug_assertions) {
        "cineflow-suite-dev"
    } else {
        "cineflow-suite"
    };

    dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(app_dir)
}

pub fn review_core_base_dir() -> PathBuf {
    review_core_app_root().join("review_core")
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ReviewCoreVersionPaths {
    pub original_abs_path: PathBuf,
    pub original_key: String,
    pub derived_dir_abs: PathBuf,
    pub playlist_abs_path: PathBuf,
    pub playlist_key: String,
    pub proxy_mp4_abs_path: PathBuf,
    pub proxy_mp4_key: String,
    pub thumbs_dir_abs: PathBuf,
    pub thumbs_key: String,
    pub poster_abs_path: PathBuf,
    pub poster_key: String,
}

fn normalize_extension(ext: &str) -> String {
    let cleaned = ext.trim_start_matches('.').trim().to_ascii_lowercase();
    let filtered: String = cleaned
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if filtered.is_empty() {
        "bin".to_string()
    } else {
        filtered
    }
}

fn ensure_relative_segment(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{} cannot be empty", label));
    }
    if value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(format!("{} contains invalid path characters", label));
    }
    Ok(())
}

pub fn build_version_paths(
    base_dir: &Path,
    project_id: &str,
    asset_id: &str,
    version_number: i32,
    extension: &str,
) -> Result<ReviewCoreVersionPaths, String> {
    ensure_relative_segment(project_id, "project_id")?;
    ensure_relative_segment(asset_id, "asset_id")?;
    if version_number <= 0 {
        return Err("version_number must be positive".to_string());
    }

    let extension = normalize_extension(extension);
    let version_dir = format!("v{}", version_number);

    let original_key = format!(
        "originals/{}/{}/{}/original.{}",
        project_id, asset_id, version_dir, extension
    );
    let derived_prefix = format!("derived/{}/{}/{}", project_id, asset_id, version_dir);
    let playlist_key = format!("{}/hls/index.m3u8", derived_prefix);
    let proxy_mp4_key = format!("{}/proxy.mp4", derived_prefix);
    let thumbs_key = format!("{}/thumbs", derived_prefix);
    let poster_key = format!("{}/poster.jpg", derived_prefix);

    let original_abs_path = base_dir.join(&original_key);
    let derived_dir_abs = base_dir.join(&derived_prefix);
    let playlist_abs_path = base_dir.join(&playlist_key);
    let proxy_mp4_abs_path = base_dir.join(&proxy_mp4_key);
    let thumbs_dir_abs = base_dir.join(&thumbs_key);
    let poster_abs_path = base_dir.join(&poster_key);

    if let Some(parent) = original_abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(derived_dir_abs.join("hls")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumbs_dir_abs).map_err(|e| e.to_string())?;

    Ok(ReviewCoreVersionPaths {
        original_abs_path,
        original_key,
        derived_dir_abs,
        playlist_abs_path,
        playlist_key,
        proxy_mp4_abs_path,
        proxy_mp4_key,
        thumbs_dir_abs,
        thumbs_key,
        poster_abs_path,
        poster_key,
    })
}

pub fn safe_relative_path(base_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return Err("absolute paths are not allowed".to_string());
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            Component::ParentDir => return Err("parent traversal is not allowed".to_string()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("invalid path prefix".to_string())
            }
        }
    }
    Ok(base_dir.join(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_paths_are_deterministic_and_scoped() {
        let base = std::env::temp_dir().join("cineflow-suite-review-core-test");
        let paths = build_version_paths(&base, "project1", "asset1", 2, "mov").unwrap();
        assert!(paths
            .original_abs_path
            .ends_with("originals/project1/asset1/v2/original.mov"));
        assert_eq!(
            paths.playlist_key,
            "derived/project1/asset1/v2/hls/index.m3u8"
        );
        assert_eq!(paths.thumbs_key, "derived/project1/asset1/v2/thumbs");
        assert!(paths
            .poster_abs_path
            .ends_with("derived/project1/asset1/v2/poster.jpg"));
    }
}
