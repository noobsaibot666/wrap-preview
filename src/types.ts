export interface Clip {
    id: string;
    project_id: string;
    filename: string;
    file_path: string;
    size_bytes: number;
    created_at: string;
    duration_ms: number;
    fps: number;
    width: number;
    height: number;
    video_codec: string;
    audio_summary: string;
    timecode: string | null;
    status: string;
    rating: number;
    flag: "none" | "pick" | "reject";
    notes?: string;
    audio_envelope?: number[]; // Represented as byte array/number array from Rust Vec<u8>
}

export interface Thumbnail {
    clip_id: string;
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

export interface ThumbnailProgress {
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
}
