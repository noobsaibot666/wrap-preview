import { Clip, ClipWithThumbnails } from "../types";
import { FilmStrip } from "./FilmStrip";
import { Film, CheckCircle2, XCircle, Star } from "lucide-react";
import { Waveform } from "./Waveform";

interface ClipListProps {
    clips: ClipWithThumbnails[];
    thumbnailCache: Record<string, string>;
    isExtracting: boolean;
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes'>>) => Promise<void>;
    onHoverClip: (id: string | null) => void;
}

export function ClipList({
    clips,
    thumbnailCache,
    isExtracting,
    selectedIds,
    onToggleSelection,
    thumbCount,
    onUpdateMetadata,
    onHoverClip
}: ClipListProps) {
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
                        isExtracting={isExtracting}
                        isSelected={selectedIds.has(item.clip.id)}
                        onToggle={() => onToggleSelection(item.clip.id)}
                        thumbCount={thumbCount}
                        onUpdateMetadata={onUpdateMetadata}
                        onMouseEnter={() => onHoverClip(item.clip.id)}
                        onMouseLeave={() => onHoverClip(null)}
                    />
                ))}
            </div>
        </div>
    );
}

function ClipCard({
    item,
    thumbnailCache,
    isExtracting,
    isSelected,
    onToggle,
    thumbCount,
    onUpdateMetadata,
    onMouseEnter,
    onMouseLeave,
}: {
    item: ClipWithThumbnails;
    thumbnailCache: Record<string, string>;
    isExtracting: boolean;
    isSelected: boolean;
    onToggle: () => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes'>>) => Promise<void>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}) {
    const { clip, thumbnails } = item;
    const audioHealth = getAudioHealth(clip.audio_summary, clip.audio_envelope);

    return (
        <div
            className={`clip-card ${isSelected ? 'selected' : ''} flag-${clip.flag}`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {/* Header */}
            <div className="clip-card-header">
                <div className="clip-card-title-group">
                    <span className="clip-filename">
                        <Film size={14} style={{ opacity: 0.6 }} /> {clip.filename}
                    </span>
                </div>
                <div className="clip-card-header-right">
                    <div className="clip-flags">
                        <button
                            className={`btn-flag btn-pick ${clip.flag === 'pick' ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); onUpdateMetadata(clip.id, { flag: clip.flag === 'pick' ? 'none' : 'pick' }); }}
                            title="Pick (P)"
                            aria-label="Pick"
                        >
                            <CheckCircle2 size={14} />
                            <span>Pick</span>
                        </button>
                        <button
                            className={`btn-flag btn-reject ${clip.flag === 'reject' ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); onUpdateMetadata(clip.id, { flag: clip.flag === 'reject' ? 'none' : 'reject' }); }}
                            title="Reject (X)"
                            aria-label="Reject"
                        >
                            <XCircle size={14} />
                            <span>Reject</span>
                        </button>
                    </div>

                    <label className="clip-selection-label">
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={onToggle}
                            className="clip-checkbox"
                        />
                    </label>
                </div>
            </div>

            <div className="clip-card-media">
                <FilmStrip
                    clipId={clip.id}
                    thumbnails={thumbnails}
                    thumbnailCache={thumbnailCache}
                    status={clip.status}
                    count={thumbCount}
                    isExtracting={isExtracting}
                />
            </div>

            {/* Actions / Metadata */}
            <div className="clip-card-footer">
                <div className="clip-rating">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                            key={star}
                            size={14}
                            className={`star ${star <= clip.rating ? 'filled' : ''}`}
                            onClick={() => onUpdateMetadata(clip.id, { rating: star === clip.rating ? 0 : star })}
                        />
                    ))}
                </div>

            <div className="clip-metadata-compact">
                <span className="metadata-tag">{formatDuration(clip.duration_ms)}</span>
                <span className="metadata-tag">{clip.video_codec.toUpperCase()}</span>
                {audioHealth && <span className="metadata-tag">{audioHealth}</span>}
                <span className={`clip-status-dot ${clip.status}`} />
            </div>
            </div>

            {/* Waveform Sparkline */}
            {clip.audio_envelope && (
                <Waveform envelope={clip.audio_envelope} />
            )}

            <div className="clip-metadata">
                <MetaItem label="RES" value={clip.width > 0 ? `${clip.width}×${clip.height}` : "—"} />
                <MetaItem label="FPS" value={clip.fps > 0 ? `${clip.fps}` : "—"} />
                <MetaItem label="SIZE" value={formatFileSize(clip.size_bytes)} />
                <MetaItem label="AUDIO" value={clip.audio_summary} />
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

function getAudioHealth(summary: string, envelope?: number[]): string | null {
    if (!summary || summary.toLowerCase().includes("no audio")) return "NO AUDIO";
    if (!envelope || envelope.length === 0) return "AUDIO";
    const peak = Math.max(...envelope);
    const silentRatio = envelope.filter((v) => v < 20).length / envelope.length;
    if (peak >= 245) return "POSSIBLE CLIP";
    if (silentRatio > 0.85) return "VERY LOW";
    return "AUDIO OK";
}
