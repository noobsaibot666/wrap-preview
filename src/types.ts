export interface Clip {
    id: string;
    project_id: string;
    root_id: string;
    rel_path: string;
    filename: string;
    file_path: string;
    size_bytes: number;
    created_at: string;
    duration_ms: number;
    fps: number;
    width: number;
    height: number;
    video_codec: string;
    video_bitrate: number;
    format_name: string;
    audio_codec: string;
    audio_channels: number;
    audio_sample_rate: number;
    camera_iso?: string | null;
    camera_white_balance?: string | null;
    camera_lens?: string | null;
    camera_aperture?: string | null;
    camera_angle?: string | null;
    audio_summary: string;
    timecode: string | null;
    status: string;
    rating: number;
    flag: "none" | "pick" | "reject";
    notes?: string;
    shot_size?: string | null;
    movement?: string | null;
    manual_order?: number | null;
    audio_envelope?: number[]; // Represented as byte array/number array from Rust Vec<u8>
    lut_enabled: number;
}

export interface Thumbnail {
    clip_id: string;
    jump_seconds: number;
    index: number;
    timestamp_ms: number;
    file_path: string;
}

export interface ClipWithThumbnails {
    clip: Clip;
    thumbnails: Thumbnail[];
}

export interface ScanResult {
    project_id: string;
    project_name: string;
    clip_count: number;
    clips: Clip[];
}

export interface ProjectRoot {
    id: string;
    project_id: string;
    root_path: string;
    label: string;
    created_at: string;
}

export interface RecentProject {
    id: string;
    name: string;
    path: string;
    phase: "pre" | "post";
    lastOpened: number;
}

export interface ThumbnailProgress {
    project_id: string;
    clip_id: string;
    clip_index: number;
    total_clips: number;
    status: string;
    thumbnails: Thumbnail[];
}

export interface BrandProfile {
    name: string;
    colors: {
        primary: string;
        primary_hover: string;
        accent: string;
        background: string;
        text: string;
        border: string;
    };
}

export interface SceneBlock {
    id: string;
    project_id: string;
    name: string;
    start_time: number | null;
    end_time: number | null;
    clip_count: number;
    camera_list?: string | null;
    confidence: number;
}

export interface SceneBlockWithClips {
    block: SceneBlock;
    clips: Clip[];
}

export interface JobInfo {
    id: string;
    kind: string;
    status: "queued" | "running" | "done" | "failed" | "cancelled";
    progress: number;
    message: string;
    error?: string | null;
    created_at: string;
    updated_at: string;
}

export interface AppInfo {
    version: string;
    build_date: string;
    ffmpeg_version: string;
    ffprobe_version: string;
    macos_version: string;
    arch: string;
    braw_bridge_active?: boolean;
}

export interface ReviewCoreAsset {
    id: string;
    project_id: string;
    filename: string;
    original_path: string;
    storage_key: string;
    file_size: number;
    duration_ms?: number | null;
    frame_rate?: number | null;
    avg_frame_rate?: string | null;
    r_frame_rate?: string | null;
    is_vfr: boolean;
    width?: number | null;
    height?: number | null;
    codec?: string | null;
    status: "processing" | "ready" | "failed";
    checksum_sha256: string;
    last_error?: string | null;
    created_at: string;
}

export interface ReviewCoreAssetVersion {
    id: string;
    asset_id: string;
    version_number: number;
    original_file_key: string;
    proxy_playlist_key?: string | null;
    proxy_mp4_key?: string | null;
    thumbnails_key?: string | null;
    poster_key?: string | null;
    processing_status: "processing" | "ready" | "failed";
    last_error?: string | null;
    created_at: string;
}

export interface ReviewCoreAssetWithVersions {
    asset: ReviewCoreAsset;
    versions: ReviewCoreAssetVersion[];
}

export interface ReviewCoreThumbnailInfo {
    file_name: string;
    index: number;
    approx_seconds: number;
}

export interface ReviewCoreDuplicateCandidate {
    file_path: string;
    checksum_sha256: string;
    existing_asset_id: string;
    existing_filename: string;
}

export interface ReviewCoreComment {
    id: string;
    asset_version_id: string;
    timestamp_ms: number;
    frame_number?: number | null;
    text: string;
    author_name: string;
    resolved: boolean;
    created_at: string;
}

export interface ReviewCoreAnnotation {
    id: string;
    comment_id: string;
    asset_version_id: string;
    timestamp_ms: number;
    vector_data: string;
    coordinate_space: string;
    created_at: string;
}

export interface ReviewCoreFrameNote {
    id: string;
    project_id: string;
    asset_id: string;
    asset_version_id: string;
    timestamp_ms: number;
    frame_number?: number | null;
    title?: string | null;
    image_key: string;
    image_path: string;
    frame_url: string;
    vector_data: string;
    created_at: string;
    updated_at: string;
    hidden: boolean;
}

export interface ReviewCoreExtractFrameResult {
    note_id: string;
    frame_url: string;
    project_id: string;
    asset_id: string;
    image_path: string;
}

export interface ReviewCoreApprovalState {
    asset_version_id: string;
    status: "draft" | "in_review" | "approved" | "rejected" | "changes_requested";
    approved_at?: string | null;
    approved_by?: string | null;
}

export interface ReviewCoreProjectSummary {
    id: string;
    name: string;
    last_opened_at: string;
}

export interface ReviewCoreShareLinkSummary {
    id: string;
    project_id: string;
    token: string;
    asset_version_ids: string[];
    expires_at?: string | null;
    allow_comments: boolean;
    allow_download: boolean;
    password_required: boolean;
    created_at: string;
}

export interface ReviewCoreShareLinkResolved {
    project_id: string;
    project_name: string;
    asset_version_ids: string[];
    allow_comments: boolean;
    allow_download: boolean;
    password_required: boolean;
}

export interface ReviewCoreShareUnlockResult {
    session_token?: string | null;
    expires_at?: string | null;
}

export interface ReviewCoreSharedAssetSummary {
    id: string;
    project_id: string;
    filename: string;
    duration_ms?: number | null;
    frame_rate?: number | null;
    avg_frame_rate?: string | null;
    r_frame_rate?: string | null;
    is_vfr: boolean;
    width?: number | null;
    height?: number | null;
    codec?: string | null;
    status: string;
    created_at: string;
}

export interface ReviewCoreSharedVersionSummary {
    id: string;
    asset_id: string;
    version_number: number;
    processing_status: "processing" | "ready" | "failed";
    created_at: string;
}

export interface ProductionProject {
    id: string;
    name: string;
    client_name: string;
    created_at: string;
    last_opened_at: string;
}

export interface ProductionCameraConfig {
    id: string;
    project_id: string;
    slot: string; // "A" | "B" | "C"
    brand: string;
    model: string;
    recording_mode: string;
    log_family: string;
    base_iso_list_json: string;
    lens_character?: string | null;
    diffusion?: string | null;
    notes?: string | null;
}

export interface ProductionLookSetup {
    id: string;
    project_id: string;
    target_type: string; // "arri" | "fuji" | "cine_neutral" | "custom"
    custom_notes?: string | null;
    lighting: string; // "controlled" | "mixed" | "run_and_gun"
    skin_priority: boolean;
    outputs_json: string;
}

export interface ProductionOnsetChecks {
    id: string;
    project_id: string;
    ready_state_json: string;
    lighting_checks_json: string;
    failure_modes_json: string;
    updated_at: string;
}

export interface ProductionPreset {
    id: string;
    project_id: string;
    name: string;
    payload_json: string;
    created_at: string;
    updated_at: string;
}

export interface ProductionLookRecommendation {
    slot: string;
    camera_label: string;
    complete: boolean;
    missing: string[];
    capture_format: string;
    capture_format_basis: string;
    iso_strategy: string;
    iso_strategy_basis: string;
    white_balance_rule: string;
    white_balance_rule_basis: string;
    detail_rule: string;
    detail_rule_basis: string;
    exposure_target: string;
    exposure_target_basis: string;
    monitoring_class: string;
    monitoring_class_basis: string;
    discipline_checklist: string[];
    warnings: string[];
}

export interface ProductionLookOutputs {
    summary: string;
    recommendations: ProductionLookRecommendation[];
    generated_at: string;
}

export interface ProductionMatchPresetPayload {
    hero_slot: string;
    hero_summary: string;
    steps: Array<{
        slot: string;
        camera_label: string;
        checklist: string[];
    }>;
}

export interface CameraProfile {
    brand: string;
    model: string;
    sensor_type: string;
    recommended_modes: RecommendedMode[];
    known_pitfalls: string[];
}

export interface RecommendedMode {
    label: string;
    base_iso: number[];
    wb_notes: string;
    highlight_limit_guidance: string;
    skin_ire_targets: Record<string, number>;
    sharpening_nr_defaults: string;
}

export interface LookPreset {
    id: string;
    name: string;
    description: string;
}

export type Phase = "pre" | "post";
export interface PhaseData {
    projectId: string | null;
    projectName: string;
    clips: ClipWithThumbnails[];
    selectedClipIds: Set<string>;
    scanning: boolean;
    extracting: boolean;
    extractProgress: { done: number; total: number };
    thumbnailCache: Record<string, string>;
}
