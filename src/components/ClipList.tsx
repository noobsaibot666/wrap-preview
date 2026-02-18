import { ClipWithThumbnails } from "../App";
import { FilmStrip } from "./FilmStrip";
import { Film, CheckCircle2, AlertCircle, XCircle } from "lucide-react";

interface ClipListProps {
    clips: ClipWithThumbnails[];
    thumbnailCache: Record<string, string>;
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
    thumbCount: number;
}

export function ClipList({ clips, thumbnailCache, selectedIds, onToggleSelection, thumbCount }: ClipListProps) {
    if (clips.length === 0) return null;

    return (
        <div>
            <div className="section-header">
                <span className="section-title">Clips</span>
                <span className="section-count highlight">{clips.length}</span>
            </div>
            <div className="clip-list">
                {clips.map((item) => (
                    <ClipCard
                        key={item.clip.id}
                        item={item}
                        thumbnailCache={thumbnailCache}
                        isSelected={selectedIds.has(item.clip.id)}
                        onToggle={() => onToggleSelection(item.clip.id)}
                        thumbCount={thumbCount}
                    />
                ))}
            </div>
        </div>
    );
}

function ClipCard({
    item,
    thumbnailCache,
    isSelected,
    onToggle,
    thumbCount,
}: {
    item: ClipWithThumbnails;
    thumbnailCache: Record<string, string>;
    isSelected: boolean;
    onToggle: () => void;
    thumbCount: number;
}) {
    const { clip, thumbnails } = item;

    return (
        <div className={`clip-card ${isSelected ? 'selected' : ''}`}>
            {/* Header */}
            <div className="clip-card-header">
                <div className="clip-card-title-group">
                    <span className="clip-filename">
                        <Film size={14} style={{ opacity: 0.6 }} /> {clip.filename}
                    </span>
                </div>
                <div className="clip-card-header-right">
                    <label className="clip-selection-label">
                        <span>Select</span>
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={onToggle}
                            className="clip-checkbox"
                        />
                    </label>
                    <span className={`clip-status ${clip.status}`}>
                        {clip.status === "ok" && <CheckCircle2 size={12} />}
                        {clip.status === "warn" && <AlertCircle size={12} />}
                        {clip.status === "fail" && <XCircle size={12} />}
                        {clip.status.toUpperCase()}
                    </span>
                </div>
            </div>

            <div className="clip-card-media">
                <FilmStrip
                    clipId={clip.id}
                    thumbnails={thumbnails}
                    thumbnailCache={thumbnailCache}
                    status={clip.status}
                    count={thumbCount}
                />
            </div>

            {/* Metadata grid */}
            <div className="clip-metadata">
                <MetaItem label="DUR" value={formatDuration(clip.duration_ms)} tooltip="Duration" />
                <MetaItem label="RES" value={clip.width > 0 ? `${clip.width}×${clip.height}` : "—"} tooltip="Resolution" />
                <MetaItem label="FPS" value={clip.fps > 0 ? `${clip.fps}` : "—"} tooltip="Frames per second" />
                <MetaItem label="CODEC" value={clip.video_codec.toUpperCase()} tooltip="Video Codec" />
                <MetaItem label="SIZE" value={formatFileSize(clip.size_bytes)} tooltip="File size" />
                <MetaItem label="AUDIO" value={clip.audio_summary} tooltip="Audio description" />
                {clip.timecode && <MetaItem label="TC" value={clip.timecode} tooltip="Embedded Timecode" />}
            </div>
        </div>
    );
}

function MetaItem({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
    return (
        <div className="meta-item" data-tooltip={tooltip}>
            <span className="meta-label">{label}</span>
            <span className="meta-value">{value}</span>
        </div>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms: number): string {
    if (ms === 0) return "—";
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

