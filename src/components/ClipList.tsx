import { useState, useEffect, useRef } from "react";
import { Clip, ClipWithThumbnails } from "../types";
import { FilmStrip } from "./FilmStrip";
import { Film, CheckCircle2, XCircle, Star, FileDown, Image, ChevronUp, ChevronDown } from "lucide-react";
import { Waveform } from "./Waveform";
import { LookbookSortMode } from "../lookbook";
import { buildClipMetadataTags, getAudioBadge } from "../utils/clipMetadata";

interface ClipListProps {
    clips: ClipWithThumbnails[];
    thumbnailCache: Record<string, string>;
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled' | 'thumb_range_seconds'>>) => Promise<void>;
    onHoverClip: (id: string | null) => void;
    onPromoteClip: (id: string) => void;
    onPlayClip: (id: string | null) => void;
    playingClipId: string | null;
    playingProgress: number;
    shotSizeOptions: string[];
    movementOptions: string[];
    lookbookSortMode: LookbookSortMode;
    groupByShotSize: boolean;
    focusedClipId: string | null;
    projectLutHash: string | null;
    lutRenderNonce: number;
    hideLutControls?: boolean;
    onExportPDF: () => void;
    onExportImage: () => void;
}

export function ClipList({
    clips,
    thumbnailCache,
    selectedIds,
    onToggleSelection,
    thumbCount,
    onUpdateMetadata,
    onHoverClip,
    onPromoteClip,
    onPlayClip,
    playingClipId,
    playingProgress,
    shotSizeOptions,
    movementOptions,
    lookbookSortMode,
    groupByShotSize,
    focusedClipId,
    projectLutHash,
    lutRenderNonce,
    hideLutControls = false,
    onExportPDF,
    onExportImage
}: ClipListProps) {
    if (clips.length === 0) return null;

    return (
        <div>
            <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <span className="section-title">Clips</span>
                    <span className="section-count highlight">{clips.length}</span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); onExportPDF(); }}
                        title="Export Multi-page PDF"
                    >
                        <FileDown size={14} />
                        <span>PDF</span>
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); onExportImage(); }}
                        title="Export as Image"
                    >
                        <Image size={14} />
                        <span>Image</span>
                    </button>
                </div>
            </div>
            <div className="clip-list">
                {clips.map((item, idx) => {
                    const prev = idx > 0 ? clips[idx - 1].clip.shot_size : null;
                    const cur = item.clip.shot_size ?? "Unspecified Shot Size";
                    const isManual = lookbookSortMode === "custom" || lookbookSortMode === "hook_first";
                    const showGroup = !isManual && groupByShotSize && (idx === 0 || (prev ?? "Unspecified Shot Size") !== cur);
                    return (
                        <div key={item.clip.id}>
                            {showGroup && <div className="clip-shot-group-header">{cur}</div>}
                            <ClipCard
                                item={item}
                                thumbnailCache={thumbnailCache}
                                isSelected={selectedIds.has(item.clip.id)}
                                onToggle={() => onToggleSelection(item.clip.id)}
                                thumbCount={thumbCount}
                                onUpdateMetadata={onUpdateMetadata}
                                onMouseEnter={() => onHoverClip(item.clip.id)}
                                onMouseLeave={() => onHoverClip(null)}
                                shotSizeOptions={shotSizeOptions}
                                movementOptions={movementOptions}
                                lookbookSortMode={lookbookSortMode}
                                onPromoteClip={() => onPromoteClip(item.clip.id)}
                                onPlayClip={() => onPlayClip(item.clip.id)}
                                isPlaying={playingClipId === item.clip.id}
                                progress={playingClipId === item.clip.id ? playingProgress : 0}
                                isFocused={focusedClipId === item.clip.id}
                                projectLutHash={projectLutHash}
                                lutRenderNonce={lutRenderNonce}
                                hideLutControls={hideLutControls}
                            />
                        </div>
                    );
                })}
            </div>
            <div className="clip-list-footer" style={{ marginTop: 'var(--space-xl)', display: 'flex', gap: 'var(--space-md)', justifyContent: 'center', padding: 'var(--space-lg) 0' }}>
                <button
                    className="btn btn-accent btn-lg"
                    onClick={onExportPDF}
                    style={{ minWidth: 200 }}
                >
                    <FileDown size={18} />
                    <span>Export PDF Contact Sheet</span>
                </button>
                <button
                    className="btn btn-secondary btn-lg"
                    onClick={onExportImage}
                    style={{ minWidth: 200 }}
                >
                    <Image size={18} />
                    <span>Export Image</span>
                </button>
            </div>
            <datalist id="shot-size-options">
                {shotSizeOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
            <datalist id="movement-options">
                {movementOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
        </div>
    );
}

function ClipCard({
    item,
    thumbnailCache,
    isSelected,
    onToggle,
    thumbCount,
    onUpdateMetadata,
    onMouseEnter,
    onMouseLeave,
    shotSizeOptions,
    movementOptions,
    lookbookSortMode,
    onPromoteClip,
    onPlayClip,
    isPlaying,
    progress,
    isFocused,
    projectLutHash,
    lutRenderNonce,
    hideLutControls
}: {
    item: ClipWithThumbnails;
    thumbnailCache: Record<string, string>;
    isSelected: boolean;
    onToggle: () => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled' | 'thumb_range_seconds'>>) => Promise<void>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    shotSizeOptions: string[];
    movementOptions: string[];
    lookbookSortMode: LookbookSortMode;
    onPromoteClip: () => void;
    onPlayClip: () => void;
    isPlaying: boolean;
    progress: number;
    isFocused: boolean;
    projectLutHash: string | null;
    lutRenderNonce: number;
    hideLutControls?: boolean;
}) {
    const { clip, thumbnails } = item;
    const audioHealth = getAudioBadge(clip.audio_summary, clip.audio_envelope);
    const metadataTags = buildClipMetadataTags(clip, audioHealth);
    const cardRef = useRef<HTMLDivElement>(null);

    // Local state to prevent jumping during edits
    const [localShotSize, setLocalShotSize] = useState(clip.shot_size ?? "");
    const [localMovement, setLocalMovement] = useState(clip.movement ?? "");
    const [localManualOrder, setLocalManualOrder] = useState(clip.manual_order ?? 0);
    const [localThumbRange, setLocalThumbRange] = useState(clip.thumb_range_seconds ?? 0);

    // Keep local state in sync if prop changes from outside (e.g. reload)
    useEffect(() => {
        setLocalShotSize(clip.shot_size ?? "");
    }, [clip.shot_size]);
    useEffect(() => {
        setLocalMovement(clip.movement ?? "");
    }, [clip.movement]);
    useEffect(() => {
        setLocalManualOrder(clip.manual_order ?? 0);
    }, [clip.manual_order]);
    useEffect(() => {
        setLocalThumbRange(clip.thumb_range_seconds ?? 0);
    }, [clip.thumb_range_seconds]);

    const handleShotSizeBlur = () => {
        if (localShotSize.trim() === (clip.shot_size ?? "")) return;
        if (!localShotSize.trim()) onUpdateMetadata(clip.id, { shot_size: "" });
        else if (shotSizeOptions.includes(localShotSize.trim())) onUpdateMetadata(clip.id, { shot_size: localShotSize.trim() });
        else setLocalShotSize(clip.shot_size ?? ""); // reset if invalid
    };

    const handleMovementBlur = () => {
        if (localMovement.trim() === (clip.movement ?? "")) return;
        if (!localMovement.trim()) onUpdateMetadata(clip.id, { movement: "" });
        else if (movementOptions.includes(localMovement.trim())) onUpdateMetadata(clip.id, { movement: localMovement.trim() });
        else setLocalMovement(clip.movement ?? ""); // reset if invalid
    };

    const handleManualOrderBlur = () => {
        if (localManualOrder === (clip.manual_order ?? 0)) return;
        onUpdateMetadata(clip.id, { manual_order: localManualOrder });
    };

    const handleThumbRangeBlur = () => {
        if (localThumbRange === (clip.thumb_range_seconds ?? 0)) return;
        onUpdateMetadata(clip.id, { thumb_range_seconds: localThumbRange });
    };

    useEffect(() => {
        if (!isFocused || !cardRef.current) return;
        cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [isFocused]);

    return (
        <div
            ref={cardRef}
            className={`clip-card premium-card ${isSelected ? 'selected' : ''} flag-${clip.flag} ${isFocused ? "focused" : ""}`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{ "--corner-color": isSelected ? "var(--color-accent-soft)" : isFocused ? "var(--color-accent-indigo-soft)" : "rgba(255,255,255,0.03)" } as any}
            onDoubleClick={(e) => {
                // Only promote if not double-clicking interactive elements
                if ((e.target as HTMLElement).closest('button, input, select')) return;
                onPromoteClip();
            }}
        >
            {/* Header */}
            <div className="clip-card-header">
                <div className="clip-card-title-group">
                    <span className="clip-filename">
                        <Film size={14} style={{ opacity: 0.6 }} /> {clip.filename}
                    </span>
                </div>
                <div className="clip-card-header-right">
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
                    <div className="clip-flags">
                        {!hideLutControls && (
                            <button
                                className={`btn-flag btn-lut ${clip.lut_enabled === 1 ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!projectLutHash) return;
                                    onUpdateMetadata(clip.id, { lut_enabled: clip.lut_enabled === 1 ? 0 : 1 });
                                }}
                                title={projectLutHash ? "LUT Preview On/Off" : "Load project LUT to enable"}
                                aria-label="Toggle LUT Preview"
                                disabled={!projectLutHash}
                            >
                                <span>LUT</span>
                            </button>
                        )}
                        <button
                            className={`btn-flag btn-reject ${clip.flag === 'reject' ? 'active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                const nextFlag = clip.flag === 'reject' ? 'none' : 'reject';
                                onUpdateMetadata(clip.id, { flag: nextFlag });
                                if (nextFlag === "reject" && !isSelected) {
                                    onToggle();
                                }
                            }}
                            title="Reject (R)"
                            aria-label="Reject"
                        >
                            <XCircle size={14} />
                            <span>Reject</span>
                        </button>
                    </div>

                    <button
                        className={`btn-flag btn-select ${isSelected ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onToggle(); }}
                        title="Select for export"
                        aria-label="Select"
                        disabled={clip.flag === "reject"}
                    >
                        <CheckCircle2 size={14} />
                        <span>{isSelected ? "Selected" : "Select"}</span>
                    </button>
                </div>
            </div>

            <div className="clip-card-media">
                <FilmStrip
                    clipId={clip.id}
                    thumbnails={thumbnails}
                    thumbnailCache={thumbnailCache}
                    status={clip.status}
                    count={thumbCount}
                    aspectRatio={clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9}
                    onDoubleClick={onPlayClip}
                    projectLutHash={projectLutHash}
                    clipLutEnabled={clip.lut_enabled}
                    lutRenderNonce={lutRenderNonce}
                />
            </div>

            {/* Actions / Metadata */}
            <div className="clip-card-footer">
                <div className="clip-metadata-compact">
                    {metadataTags.map((tag) => {
                        if (tag.label === "AUDIO") {
                            const healthClass = tag.value === "NO AUDIO" ? "silent" : (tag.value === "POSSIBLE CLIP" ? "clipping" : "");
                            return (
                                <span key={`${clip.id}-${tag.label}`} className={`audio-health-badge ${healthClass}`}>
                                    {tag.value}
                                </span>
                            );
                        }
                        return (
                            <span key={`${clip.id}-${tag.label}-${tag.value}`} className={`metadata-tag ${tag.highlight ? "highlight-tag" : ""} ${tag.value === "POSSIBLE CLIP" ? "danger-tag" : tag.value === "VERY LOW" ? "warn-tag" : ""}`}>
                                {tag.value}
                            </span>
                        );
                    })}
                    {!clip.timecode && <span className="metadata-tag danger-tag">NO TC</span>}
                    <div className="clip-card-status-wrapper">
                        <span className={`clip-status-dot ${clip.status}`} />
                    </div>
                </div>
            </div>

            {/* Waveform Sparkline */}
            {clip.audio_envelope && (
                <Waveform
                    envelope={clip.audio_envelope}
                    onPlayToggle={onPlayClip}
                    isPlaying={isPlaying}
                    progress={progress}
                />
            )}

            <div className="clip-lookbook-taxonomy">
                <label className="clip-taxonomy-field">
                    <span className="meta-label">Shot Size</span>
                    <input
                        list="shot-size-options"
                        className={`input-text ${localShotSize ? 'is-picked' : ''}`}
                        value={localShotSize}
                        placeholder="Type to search"
                        onChange={(e) => setLocalShotSize(e.target.value)}
                        onBlur={handleShotSizeBlur}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleShotSizeBlur(); }}
                    />
                </label>
                <label className="clip-taxonomy-field">
                    <span className="meta-label">Movement</span>
                    <input
                        list="movement-options"
                        className={`input-text ${localMovement ? 'is-picked' : ''}`}
                        value={localMovement}
                        placeholder="Type to search"
                        onChange={(e) => setLocalMovement(e.target.value)}
                        onBlur={handleMovementBlur}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleMovementBlur(); }}
                    />
                </label>
                <label className="clip-taxonomy-field clip-taxonomy-order">
                    <span className="meta-label">Manual Order</span>
                    <div className="custom-stepper">
                        <input
                            type="number"
                            className={`input-text ${localManualOrder !== 0 ? 'is-picked' : ''}`}
                            value={localManualOrder}
                            onChange={(e) => setLocalManualOrder(Number(e.target.value || 0))}
                            onBlur={handleManualOrderBlur}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleManualOrderBlur(); }}
                            min={0}
                            disabled={lookbookSortMode !== "custom"}
                        />
                        <div className="stepper-controls">
                            <button
                                className="stepper-btn"
                                onClick={() => { const val = Math.max(1, localManualOrder + 1); setLocalManualOrder(val); onUpdateMetadata(clip.id, { manual_order: val }); }}
                                disabled={lookbookSortMode !== "custom"}
                            >
                                <ChevronUp size={12} />
                            </button>
                            <button
                                className="stepper-btn"
                                onClick={() => { const val = Math.max(0, localManualOrder - 1); setLocalManualOrder(val); onUpdateMetadata(clip.id, { manual_order: val }); }}
                                disabled={lookbookSortMode !== "custom"}
                            >
                                <ChevronDown size={12} />
                            </button>
                        </div>
                    </div>
                </label>
                <label className="clip-taxonomy-field clip-taxonomy-order">
                    <span className="meta-label">Thumb Range (s)</span>
                    <div className="custom-stepper">
                        <input
                            type="number"
                            className={`input-text ${localThumbRange !== 0 ? 'is-picked' : ''}`}
                            value={localThumbRange}
                            onChange={(e) => setLocalThumbRange(Number(e.target.value || 0))}
                            onBlur={handleThumbRangeBlur}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleThumbRangeBlur(); }}
                            min={0}
                            max={Math.floor(clip.duration_ms / 1000)}
                            step={2}
                        />
                        <div className="stepper-controls">
                            <button
                                className="stepper-btn"
                                onClick={() => { const val = Math.min(Math.floor(clip.duration_ms / 1000), localThumbRange + 2); setLocalThumbRange(val); onUpdateMetadata(clip.id, { thumb_range_seconds: val }); }}
                            >
                                <ChevronUp size={12} />
                            </button>
                            <button
                                className="stepper-btn"
                                onClick={() => { const val = Math.max(0, localThumbRange - 2); setLocalThumbRange(val); onUpdateMetadata(clip.id, { thumb_range_seconds: val }); }}
                            >
                                <ChevronDown size={12} />
                            </button>
                        </div>
                    </div>
                </label>
            </div>

            <div className="clip-metadata-compact" style={{ padding: "0 12px 12px" }}>
                {/* Auto analysis fields removed per user request */}
            </div>
        </div>
    );
}
