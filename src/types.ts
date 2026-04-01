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
    redline_bridge_active?: boolean;
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

export interface ProductionQuickSetupRow {
    key: string;
    label: string;
    value: string;
    icon: string;
    source: string[];
    status?: "ready" | "missing";
    badge?: string;
}

export interface ShotListProject {
    id: string;
    title: string;
    day_label: string;
    created_at: string;
    updated_at: string;
    last_opened_at: string;
}

export interface ShotListRow {
    id: string;
    project_id: string;
    sort_order: number;
    shot_number: string;
    capture_type: "photo" | "video";
    scene: string;
    location: string;
    timing: string;
    shot_type: string;
    description: string;
    camera_lens: string;
    camera_movement: string; 
    audio_notes: string;
    lighting_notes: string;
    talent_subjects: string;
    props_details: string;
    notes: string;
    status: string;
    // Backward compatibility
    scene_setup: string;
    location_time: string;
    movement: string;
}

export interface ShotListEquipmentSection {
    id: string;
    project_id: string;
    sort_order: number;
    section_key?: string | null;
    section_name: string;
    icon_name: string;
}

export interface ShotListEquipmentItem {
    id: string;
    section_id: string;
    sort_order: number;
    item_name: string;
    item_type: string;
    icon_name: string;
    notes: string;
    camera_label?: string | null;
    media_type?: string | null;
    capacity_value?: number | null;
    capacity_unit?: "GB" | "TB" | null;
}

export interface ShotListBundle {
    project: ShotListProject;
    rows: ShotListRow[];
    sections: ShotListEquipmentSection[];
    items: ShotListEquipmentItem[];
}

export interface ProductionDetailItem {
    label: string;
    text: string;
    source: string[];
}

export interface ProductionDetailSection {
    section: string;
    items: ProductionDetailItem[];
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
    quickSetup: ProductionQuickSetupRow[];
    details: ProductionDetailSection[];
}

export interface ProductionLookOutputs {
    summary: string;
    recommendations: ProductionLookRecommendation[];
    generated_at: string;
}

export interface ProductionUsageGuidance {
    id: string;
    group: "Exposure order" | "Monitoring" | "Camera pairing" | "Per-camera targets";
    label: string;
    support: string;
    reason: string;
    slots: string[];
    camera_labels: string[];
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

export interface CameraMatchClipInput {
    slot: string;
    clip_path: string;
}

export interface CameraMatchRgbMedians {
    red: number;
    green: number;
    blue: number;
}

export interface CameraMatchFrameMetrics {
    frame_index: number;
    timestamp_ms: number;
    frame_path: string;
    width: number;
    height: number;
    luma_histogram: number[];
    rgb_medians: CameraMatchRgbMedians;
    midtone_rgb_medians: CameraMatchRgbMedians;
    skin_rgb_medians: CameraMatchRgbMedians;
    luma_median: number;
    midtone_luma_median: number;
    skin_luma_median: number;
    highlight_percent: number;
    midtone_density: number;
    shadow_percent: number;
}

export interface CameraMatchAggregateMetrics {
    luma_histogram: number[];
    rgb_medians: CameraMatchRgbMedians;
    midtone_rgb_medians: CameraMatchRgbMedians;
    skin_rgb_medians: CameraMatchRgbMedians;
    luma_median: number;
    midtone_luma_median: number;
    skin_luma_median: number;
    highlight_percent: number;
    midtone_density: number;
    shadow_percent: number;
    luma_variance: number;
    red_variance: number;
    green_variance: number;
    blue_variance: number;
    highlight_variance: number;
    midtone_variance: number;
    shadow_variance: number;
}

export interface MeasurementWaveformSummary {
    median_luma: number;
    midtone_band_median_luma?: number | null;
    skin_band_median_luma?: number | null;
    top_band_density: number;
    bottom_band_density: number;
    skin_band_estimate?: number | null;
}

export interface MeasurementFalseColorSummary {
    clipped: number;
    near_clip: number;
    skin_zone: number;
    mids: number;
    shadows: number;
    crushed: number;
}

export interface MeasurementRgbBalanceSummary {
    red_vs_green: number;
    blue_vs_green: number;
    midtone_red_vs_green?: number | null;
    midtone_blue_vs_green?: number | null;
    skin_red_vs_green?: number | null;
    skin_blue_vs_green?: number | null;
    green_magenta_hint?: string | null;
}

export interface MeasurementLumaSummary {
    min_luma: number;
    max_luma: number;
    median_luma: number;
}

export interface ProductionMeasurementBundle {
    source_path: string;
    original_format_kind?: string | null;
    analysis_source_kind?: string | null;
    codec_name?: string | null;
    resolution?: string | null;
    fps?: number | null;
    iso_metadata?: string | null;
    wb_metadata?: string | null;
    waveform_summary: MeasurementWaveformSummary;
    false_color_summary: MeasurementFalseColorSummary;
    rgb_balance_summary: MeasurementRgbBalanceSummary;
    luma_summary: MeasurementLumaSummary;
    highlight_percentage: number;
    midtone_percentage: number;
    shadow_percentage: number;
    calibration_available?: boolean | null;
    calibration_quality?: string | null;
    calibration_neutral_bias?: string | null;
    calibration_mean_delta_e?: number | null;
}

export interface CameraMatchAnalysisResult {
    source_path: string;
    source_kind?: "original" | "proxy" | string;
    original_format_kind?: string | null;
    clip_path: string;
    clip_name: string;
    representative_frame_path: string;
    frame_paths: string[];
    per_frame: CameraMatchFrameMetrics[];
    aggregate: CameraMatchAggregateMetrics;
    proxy_info?: string | null;
    warnings?: string[];
    measurement_bundle: ProductionMeasurementBundle;
}

export interface CalibrationPatchSample {
    patch_index: number;
    measured_rgb_mean: [number, number, number];
    measured_rgb_median: [number, number, number];
    reference_rgb: [number, number, number];
    reference_lab: [number, number, number];
    delta_e: number;
    center_x: number;
    center_y: number;
}

export interface CalibrationPoint {
    x: number;
    y: number;
}

export interface CalibrationCropRectNormalized {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CalibrationChartDetection {
    chart_detected: boolean;
    detection_attempts: number;
    candidate_count: number;
    best_aspect_ratio?: number | null;
    best_area_ratio?: number | null;
    fallback_used: boolean;
    frame_width: number;
    frame_height: number;
    chart_corners: CalibrationPoint[];
    patch_samples: CalibrationPatchSample[];
    delta_e: number[];
    mean_delta_e: number;
    max_delta_e: number;
    neutral_mean_delta_e: number;
    skin_mean_delta_e: number;
    exposure_offset_stops: number;
    wb_kelvin_shift: number;
    tint_shift: number;
    corrected_preview_path: string;
    calibration_transform?: CalibrationTransform | null;
    lut_path?: string | null;
    cube_size?: number | null;
    transform_type?: string | null;
    transform_target_slot?: string | null;
    mean_delta_e_before: number;
    mean_delta_e_after?: number | null;
    transform_preview_path?: string | null;
    chart_area_ratio: number;
    chart_skew_score: number;
    clipped_patch_count: number;
    crushed_patch_count: number;
    lighting_uniformity_score: number;
    calibration_quality_score: number;
    calibration_quality_level: "Good" | "Caution" | "Poor" | string;
    transform_quality_flag?: string | null;
    warnings: string[];
    detection_score: number;
}

export interface CalibrationTransform {
    exposure_scalar: number;
    wb_gains_rgb: [number, number, number];
    tint_gains_rgb: [number, number, number];
    matrix_3x3?: [[number, number, number], [number, number, number], [number, number, number]] | null;
    source_patch_count: number;
    mean_delta_e_before: number;
    mean_delta_e_after: number;
}

export interface ProductionMatchLabProxyResult {
    proxy_path: string;
    reused_proxy: boolean;
    decoder_path?: string | null;
    strategy?: string | null;
}

export interface ProductionMatchLabRunSummary {
    run_id: string;
    project_id: string;
    hero_slot: string;
    created_at: string;
}

export interface ProductionMatchLabRunResult {
    slot: string;
    proxy_path?: string | null;
    representative_frame_path: string;
    frame_paths: string[];
    analysis: CameraMatchAnalysisResult;
    calibration?: CalibrationChartDetection | null;
    created_at: string;
}

export interface ProductionMatchLabRun {
    run_id: string;
    project_id: string;
    hero_slot: string;
    created_at: string;
    results: ProductionMatchLabRunResult[];
}

export interface CameraMatchDelta {
    luma_median: number;
    highlight_percent: number;
    midtone_density: number;
    red_median: number;
    green_median: number;
    blue_median: number;
}

export interface CameraMatchSuggestionSet {
    match_engine_version?: string | null;
    exposure: string;
    white_balance: string;
    highlight: string;
    confidence: "High" | "Medium" | "Low";
    warning?: string | null;
}

export interface CameraMatchMetrics {
    luma_histogram: number[];
    rgb_medians: {
        red: number;
        green: number;
        blue: number;
    };
    midtone_rgb_medians: {
        red: number;
        green: number;
        blue: number;
    };
    skin_rgb_medians: {
        red: number;
        green: number;
        blue: number;
    };
    luma_median: number;
    midtone_luma_median: number;
    skin_luma_median: number;
    highlight_percent: number;
    midtone_density: number;
}

export interface CameraMatchAnalysis {
    slot: string;
    clip_path: string;
    clip_name: string;
    representative_frame_path: string;
    frame_paths: string[];
    per_frame: CameraMatchFrameMetrics[];
    metrics: CameraMatchMetrics;
    delta_vs_hero?: CameraMatchDelta | null;
    suggestions?: CameraMatchSuggestionSet | null;
}

export interface CameraMatchResult {
    analyses: CameraMatchAnalysis[];
    hero_slot: string;
    generated_at: string;
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
