use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderValue, Response, StatusCode},
    routing::get,
    Router,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone)]
struct ReviewCoreServerState {
    db: crate::db::Database,
    base_dir: PathBuf,
}

pub fn start_review_core_server(
    db: crate::db::Database,
    base_dir: PathBuf,
) -> Result<String, String> {
    std::fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let addr = std_listener.local_addr().map_err(|e| e.to_string())?;

    let router = Router::new()
        .route(
            "/media/:project_id/:asset_id/:version_id/hls/*file",
            get(serve_hls),
        )
        .route(
            "/media/:project_id/:asset_id/:version_id/thumbs/:file",
            get(serve_thumb),
        )
        .route(
            "/media/:project_id/:asset_id/:version_id/poster.jpg",
            get(serve_poster),
        )
        .route(
            "/frame-notes/:project_id/:asset_id/:version_id/:note_id/:file",
            get(serve_frame_note),
        )
        .with_state(ReviewCoreServerState { db, base_dir });

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("review_core_server listener init failed: {}", error);
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("review_core_server failed: {}", error);
        }
    });

    Ok(format!("http://{}", addr))
}

async fn serve_hls(
    State(state): State<ReviewCoreServerState>,
    AxumPath((project_id, asset_id, version_id, file)): AxumPath<(String, String, String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response<Body> {
    match serve_relative_asset(
        state,
        &project_id,
        &asset_id,
        &version_id,
        "hls",
        &file,
        query.get("t").map(String::as_str),
        query.get("s").map(String::as_str),
    )
    .await
    {
        Ok(response) => response,
        Err(status) => build_error_response(status),
    }
}

async fn serve_thumb(
    State(state): State<ReviewCoreServerState>,
    AxumPath((project_id, asset_id, version_id, file)): AxumPath<(String, String, String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response<Body> {
    match serve_relative_asset(
        state,
        &project_id,
        &asset_id,
        &version_id,
        "thumbs",
        &file,
        query.get("t").map(String::as_str),
        query.get("s").map(String::as_str),
    )
    .await
    {
        Ok(response) => response,
        Err(status) => build_error_response(status),
    }
}

async fn serve_poster(
    State(state): State<ReviewCoreServerState>,
    AxumPath((project_id, asset_id, version_id)): AxumPath<(String, String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response<Body> {
    match serve_relative_asset(
        state,
        &project_id,
        &asset_id,
        &version_id,
        "",
        "poster.jpg",
        query.get("t").map(String::as_str),
        query.get("s").map(String::as_str),
    )
    .await
    {
        Ok(response) => response,
        Err(status) => build_error_response(status),
    }
}

async fn serve_frame_note(
    State(state): State<ReviewCoreServerState>,
    AxumPath((project_id, asset_id, version_id, note_id, file)): AxumPath<(String, String, String, String, String)>,
) -> Response<Body> {
    match serve_frame_note_asset(state, &project_id, &asset_id, &version_id, &note_id, &file).await {
        Ok(response) => response,
        Err(status) => build_error_response(status),
    }
}

async fn serve_relative_asset(
    state: ReviewCoreServerState,
    project_id: &str,
    asset_id: &str,
    version_id: &str,
    section: &str,
    requested_file: &str,
    token: Option<&str>,
    session_token: Option<&str>,
) -> Result<Response<Body>, StatusCode> {
    let asset = state
        .db
        .get_asset(asset_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if asset.project_id != project_id {
        return Err(StatusCode::NOT_FOUND);
    }
    let version = state
        .db
        .get_asset_version(version_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if version.asset_id != asset_id {
        return Err(StatusCode::NOT_FOUND);
    }
    if let Some(token_value) = token {
        authorize_share_access(&state.db, token_value, session_token, version_id)?;
    }

    let relative_key = if requested_file == "poster.jpg" {
        version.poster_key.ok_or(StatusCode::NOT_FOUND)?
    } else if section == "thumbs" {
        let key = version.thumbnails_key.ok_or(StatusCode::NOT_FOUND)?;
        format!("{}/{}", key, requested_file)
    } else {
        let key = version.proxy_playlist_key.ok_or(StatusCode::NOT_FOUND)?;
        let prefix = key.trim_end_matches("index.m3u8");
        format!("{}{}", prefix, requested_file)
    };

    let path = crate::review_core::storage::safe_relative_path(&state.base_dir, &relative_key)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(build_binary_response(
        &path,
        bytes,
        project_id,
        asset_id,
        version_id,
        token,
        session_token,
    ))
}

async fn serve_frame_note_asset(
    state: ReviewCoreServerState,
    project_id: &str,
    asset_id: &str,
    version_id: &str,
    note_id: &str,
    requested_file: &str,
) -> Result<Response<Body>, StatusCode> {
    let note = state
        .db
        .get_review_core_frame_note(note_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if note.project_id != project_id || note.asset_id != asset_id || note.asset_version_id != version_id {
        return Err(StatusCode::NOT_FOUND);
    }
    if !matches!(requested_file, "frame.jpg" | "annotated.jpg") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let note_path = crate::review_core::storage::safe_relative_path(&state.base_dir, &note.image_key)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let target_path = note_path
        .parent()
        .ok_or(StatusCode::BAD_REQUEST)?
        .join(requested_file);
    let bytes = tokio::fs::read(&target_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(build_binary_response(
        &target_path,
        bytes,
        project_id,
        asset_id,
        version_id,
        None,
        None,
    ))
}

fn authorize_share_access(
    db: &crate::db::Database,
    token: &str,
    session_token: Option<&str>,
    version_id: &str,
) -> Result<(), StatusCode> {
    let (link, version_ids) =
        crate::commands::resolve_share_link(db, token).map_err(map_share_error)?;
    crate::commands::validate_share_session(db, &link, session_token).map_err(map_share_error)?;
    if !version_ids.iter().any(|value| value == version_id) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}

fn map_share_error(error: crate::commands::ReviewCoreShareError) -> StatusCode {
    match error {
        crate::commands::ReviewCoreShareError::NotFound => StatusCode::FORBIDDEN,
        crate::commands::ReviewCoreShareError::Expired => StatusCode::GONE,
        crate::commands::ReviewCoreShareError::Forbidden => StatusCode::FORBIDDEN,
    }
}

fn build_binary_response(
    path: &Path,
    bytes: Vec<u8>,
    project_id: &str,
    asset_id: &str,
    version_id: &str,
    token: Option<&str>,
    session_token: Option<&str>,
) -> Response<Body> {
    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    let mime = match ext {
        "m3u8" => "application/vnd.apple.mpegurl",
        "ts" => "video/mp2t",
        "m4s" => "video/iso.segment",
        "mp4" => "video/mp4",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    };
    let cache_control = match ext {
        "m3u8" => "no-cache",
        "jpg" | "jpeg" => "public, max-age=31536000, immutable",
        _ => "public, max-age=86400",
    };

    let body = if ext == "m3u8" {
        let query = build_media_query(token, session_token);
        rewrite_playlist(
            &String::from_utf8_lossy(&bytes),
            project_id,
            asset_id,
            version_id,
            &query,
        )
        .into_bytes()
    } else {
        bytes
    };

    let mut response = Response::new(Body::from(body));
    apply_cors_headers(&mut response);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_str(cache_control)
            .unwrap_or_else(|_| HeaderValue::from_static("no-cache")),
    );
    response
}

fn build_error_response(status: StatusCode) -> Response<Body> {
    let mut response = Response::new(Body::from(
        status
            .canonical_reason()
            .unwrap_or("Request failed")
            .to_string(),
    ));
    *response.status_mut() = status;
    apply_cors_headers(&mut response);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

fn apply_cors_headers(response: &mut Response<Body>) {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
}

fn build_media_query(token: Option<&str>, session_token: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(token) = token {
        parts.push(format!("t={}", token));
    }
    if let Some(session_token) = session_token {
        parts.push(format!("s={}", session_token));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

fn rewrite_playlist(
    raw: &str,
    project_id: &str,
    asset_id: &str,
    version_id: &str,
    query: &str,
) -> String {
    raw.lines()
        .map(|line| {
            if line.starts_with('#') {
                line.to_string()
            } else if line.trim().is_empty() {
                String::new()
            } else {
                format!(
                    "/media/{}/{}/{}/hls/{}{}",
                    project_id,
                    asset_id,
                    version_id,
                    line.trim_start_matches('/'),
                    query
                )
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::{authorize_share_access, rewrite_playlist};
    use crate::db::{
        Asset, AssetVersion, Database, Project, ReviewCoreFrameNote, ReviewCoreShareLink,
        ReviewCoreShareSession,
    };
    use axum::http::StatusCode;

    #[test]
    fn traversal_is_rejected() {
        let base = std::env::temp_dir().join("wrap-preview-review-core-traversal");
        let result = crate::review_core::storage::safe_relative_path(&base, "../secrets.txt");
        assert!(result.is_err());
    }

    fn seeded_db() -> Database {
        let db_path = std::env::temp_dir().join(format!(
            "wrap-preview-share-server-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(db_path.to_str().unwrap()).unwrap();
        db.upsert_project(&Project {
            id: "p1".to_string(),
            root_path: "/tmp".to_string(),
            name: "Project".to_string(),
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.create_asset(&Asset {
            id: "asset-1".to_string(),
            project_id: "p1".to_string(),
            filename: "clip.mov".to_string(),
            original_path: "/tmp/clip.mov".to_string(),
            storage_key: "originals/p1/asset-1/v1/original.mov".to_string(),
            file_size: 100,
            duration_ms: Some(1000),
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
            proxy_playlist_key: Some("derived/p1/asset-1/v1/hls/index.m3u8".to_string()),
            proxy_mp4_key: Some("derived/p1/asset-1/v1/proxy.mp4".to_string()),
            thumbnails_key: Some("derived/p1/asset-1/v1/thumbs".to_string()),
            poster_key: Some("derived/p1/asset-1/v1/poster.jpg".to_string()),
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
            proxy_playlist_key: Some("derived/p1/asset-1/v2/hls/index.m3u8".to_string()),
            proxy_mp4_key: Some("derived/p1/asset-1/v2/proxy.mp4".to_string()),
            thumbnails_key: Some("derived/p1/asset-1/v2/thumbs".to_string()),
            poster_key: Some("derived/p1/asset-1/v2/poster.jpg".to_string()),
            processing_status: "ready".to_string(),
            last_error: None,
            created_at: "2026-01-02".to_string(),
        })
        .unwrap();
        db
    }

    #[test]
    fn password_protected_link_requires_session() {
        let db = seeded_db();
        let password_hash = bcrypt::hash("secret", bcrypt::DEFAULT_COST).unwrap();
        db.create_review_core_share_link(&ReviewCoreShareLink {
            id: "share-1".to_string(),
            project_id: "p1".to_string(),
            token: "token-1".to_string(),
            asset_version_ids_json: "[\"v1\"]".to_string(),
            expires_at: None,
            password_hash: Some(password_hash),
            allow_comments: true,
            allow_download: false,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();

        let denied = authorize_share_access(&db, "token-1", None, "v1");
        assert_eq!(denied.unwrap_err(), StatusCode::FORBIDDEN);

        db.create_review_core_share_session(&ReviewCoreShareSession {
            id: "session-1".to_string(),
            share_link_id: "share-1".to_string(),
            token: "session-token".to_string(),
            display_name: None,
            expires_at: (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_seen_at: None,
        })
        .unwrap();

        let allowed = authorize_share_access(&db, "token-1", Some("session-token"), "v1");
        assert!(allowed.is_ok());
    }

    #[test]
    fn share_scope_enforcement_rejects_other_versions() {
        let db = seeded_db();
        db.create_review_core_share_link(&ReviewCoreShareLink {
            id: "share-2".to_string(),
            project_id: "p1".to_string(),
            token: "token-2".to_string(),
            asset_version_ids_json: "[\"v1\"]".to_string(),
            expires_at: None,
            password_hash: None,
            allow_comments: true,
            allow_download: false,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();

        let denied = authorize_share_access(&db, "token-2", None, "v2");
        assert_eq!(denied.unwrap_err(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn expired_session_is_rejected_and_valid_session_slides() {
        let db = seeded_db();
        let password_hash = bcrypt::hash("secret", bcrypt::DEFAULT_COST).unwrap();
        db.create_review_core_share_link(&ReviewCoreShareLink {
            id: "share-3".to_string(),
            project_id: "p1".to_string(),
            token: "token-3".to_string(),
            asset_version_ids_json: "[\"v1\"]".to_string(),
            expires_at: None,
            password_hash: Some(password_hash),
            allow_comments: true,
            allow_download: false,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();
        db.create_review_core_share_session(&ReviewCoreShareSession {
            id: "session-2".to_string(),
            share_link_id: "share-3".to_string(),
            token: "expired-session".to_string(),
            display_name: None,
            expires_at: (chrono::Utc::now() - chrono::Duration::minutes(1)).to_rfc3339(),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_seen_at: None,
        })
        .unwrap();
        let denied = authorize_share_access(&db, "token-3", Some("expired-session"), "v1");
        assert_eq!(denied.unwrap_err(), StatusCode::FORBIDDEN);

        db.create_review_core_share_session(&ReviewCoreShareSession {
            id: "session-3".to_string(),
            share_link_id: "share-3".to_string(),
            token: "renew-session".to_string(),
            display_name: None,
            expires_at: (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_seen_at: None,
        })
        .unwrap();
        let before = db
            .get_review_core_share_session_by_token("renew-session")
            .unwrap()
            .unwrap();
        authorize_share_access(&db, "token-3", Some("renew-session"), "v1").unwrap();
        let after = db
            .get_review_core_share_session_by_token("renew-session")
            .unwrap()
            .unwrap();
        let before_expiry = chrono::DateTime::parse_from_rfc3339(&before.expires_at).unwrap();
        let after_expiry = chrono::DateTime::parse_from_rfc3339(&after.expires_at).unwrap();
        assert!(after_expiry > before_expiry);
    }

    #[test]
    fn playlist_rewrite_propagates_share_query_params() {
        let raw = "#EXTM3U\n#EXT-X-VERSION:3\nsegment_0001.ts\nsegment_0002.ts";
        let rewritten = rewrite_playlist(raw, "p1", "asset-1", "v1", "?t=token-1&s=session-1");
        assert!(
            rewritten.contains("/media/p1/asset-1/v1/hls/segment_0001.ts?t=token-1&s=session-1")
        );
        assert!(
            rewritten.contains("/media/p1/asset-1/v1/hls/segment_0002.ts?t=token-1&s=session-1")
        );
    }

    #[test]
    fn reviewer_name_is_persisted_in_session() {
        let db = seeded_db();
        db.create_review_core_share_link(&ReviewCoreShareLink {
            id: "share-4".to_string(),
            project_id: "p1".to_string(),
            token: "token-4".to_string(),
            asset_version_ids_json: "[\"v1\"]".to_string(),
            expires_at: None,
            password_hash: None,
            allow_comments: true,
            allow_download: true,
            created_at: "2026-01-01".to_string(),
        })
        .unwrap();

        db.create_review_core_share_session(&ReviewCoreShareSession {
            id: "session-4".to_string(),
            share_link_id: "share-4".to_string(),
            token: "session-token-4".to_string(),
            display_name: Some("Alice Reviewer".to_string()),
            expires_at: (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_seen_at: None,
        })
        .unwrap();

        let session = db
            .get_review_core_share_session_by_token("session-token-4")
            .unwrap()
            .unwrap();
        assert_eq!(session.display_name, Some("Alice Reviewer".to_string()));
    }

    #[test]
    fn asset_version_carries_proxy_mp4_key() {
        let db = seeded_db();
        let v1 = db.get_asset_version("v1").unwrap().unwrap();
        assert_eq!(
            v1.proxy_mp4_key,
            Some("derived/p1/asset-1/v1/proxy.mp4".to_string())
        );
    }

    #[test]
    fn frame_note_route_rejects_traversal_filenames() {
        let db = seeded_db();
        let base = std::env::temp_dir().join(format!(
            "wrap-preview-frame-note-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(base.join("derived/p1/asset-1/v1/frame_notes/n1")).unwrap();
        db.create_review_core_frame_note(&ReviewCoreFrameNote {
            id: "n1".to_string(),
            project_id: "p1".to_string(),
            asset_id: "asset-1".to_string(),
            asset_version_id: "v1".to_string(),
            timestamp_ms: 100,
            frame_number: Some(3),
            title: None,
            image_key: "derived/p1/asset-1/v1/frame_notes/n1/frame.jpg".to_string(),
            vector_data: "[]".to_string(),
            created_at: "2026-01-01".to_string(),
            updated_at: "2026-01-01".to_string(),
            hidden: false,
        })
        .unwrap();

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let status: StatusCode = runtime
            .block_on(async {
                super::serve_frame_note_asset(
                    super::ReviewCoreServerState {
                        db,
                        base_dir: base,
                    },
                    "p1",
                    "asset-1",
                    "v1",
                    "n1",
                    "../secret.txt",
                )
                .await
            })
            .unwrap_err();

        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}
