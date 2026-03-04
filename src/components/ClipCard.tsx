import { memo, useMemo, useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clip, ClipWithThumbnails } from "../types";
import { FilmStrip } from "./FilmStrip";
import { Film, Star, CheckCircle2, XCircle, ChevronUp, ChevronDown } from "lucide-react";
import { Waveform } from "./Waveform";
import { LookbookSortMode } from "../lookbook";
import { getAudioBadge, buildClipMetadataTags } from "../utils/clipMetadata";
import { getDisplayedThumbsForClip } from "../utils/shotPlannerThumbnails";

const waveformWarningKeys = new Set<string>();
const MAX_FILMSTRIP_PREVIEW_COUNT = 7;
export const metadataTooltipCopy: Record<string, string> = {
    DUR: "Clip duration.",
    FMT: "Container or file wrapper.",
    CODEC: "Video compression format.",
    ISO: "Recorded camera ISO.",
    WB: "White balance in Kelvin.",
    LENS: "Lens metadata from camera.",
    APT: "Lens aperture or T-stop.",
    ANG: "Shutter angle metadata.",
    TC: "Embedded source timecode.",
    BR: "Approximate video bitrate.",
    AUDIO: "Audio health summary from scan.",
    RES: "Frame resolution.",
    FPS: "Recorded frame rate.",
    SIZE: "Source file size.",
    NO_TC: "This clip has no readable source timecode.",
};

interface ClipCardProps {
    item: ClipWithThumbnails;
    thumbnailCache: Record<string, string>;
    isSelected: boolean;
    onToggle: (id: string) => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled'>>) => Promise<boolean>;
    onMouseEnter: (id: string) => void;
    onMouseLeave: (id: string | null) => void;
    onFocus: (id: string) => void;
    shotSizeOptions: string[];
    movementOptions: string[];
    lookbookSortMode: LookbookSortMode;
    onResetClip?: (id: string) => void;
    onManualOrderInputChange?: () => void;
    manualOrderConflict?: { clipId: string; nonce: number } | null;
    onPromoteClip: (id: string) => void;
    onPlayClip: (id: string) => void;
    isPlaying: boolean;
    progress: number;
    cacheKeyContext?: string;
    isFocused: boolean;
    projectLutHash: string | null;
    lutRenderNonce: number;
    hideLutControls?: boolean;
    variant?: "review" | "shot-planner";
}

export const ClipCard = memo(function ClipCard({
    item,
    thumbnailCache,
    isSelected,
    onToggle,
    thumbCount,
    onUpdateMetadata,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    shotSizeOptions,
    movementOptions,
    lookbookSortMode,
    onResetClip,
    onManualOrderInputChange,
    manualOrderConflict,
    onPromoteClip,
    onPlayClip,
    isPlaying,
    progress,
    cacheKeyContext,
    isFocused,
    projectLutHash,
    lutRenderNonce,
    hideLutControls,
    variant = "review",
}: ClipCardProps) {

    const { clip, thumbnails } = item;
    const shotPlannerVariant = variant === "shot-planner";
    const cardRef = useRef<HTMLDivElement>(null);
    const visualFlag = clip.flag === "pick" ? "none" : clip.flag;

    // Local state to prevent jumping during edits
    const [localShotSize, setLocalShotSize] = useState(clip.shot_size ?? "");
    const [localMovement, setLocalMovement] = useState(clip.movement ?? "");
    const [localManualOrder, setLocalManualOrder] = useState(clip.manual_order ?? 0);
    const [showOrderConflict, setShowOrderConflict] = useState(false);
    const [waveformEnvelope, setWaveformEnvelope] = useState<number[] | null>(clip.audio_envelope ?? null);
    const waveformRequestKeyRef = useRef<string | null>(null);
    const metadataTooltipTimerRef = useRef<number | null>(null);
    const [activeMetadataTooltip, setActiveMetadataTooltip] = useState<string | null>(null);
    const audioHealth = getAudioBadge(clip.audio_summary, waveformEnvelope ?? clip.audio_envelope);
    const metadataTags = buildClipMetadataTags(clip, audioHealth);

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
        setWaveformEnvelope(clip.audio_envelope ?? null);
        waveformRequestKeyRef.current = null;
    }, [clip.audio_envelope, clip.id]);
    useEffect(() => {
        if (manualOrderConflict?.clipId !== clip.id) return;
        setShowOrderConflict(true);
        const timer = window.setTimeout(() => setShowOrderConflict(false), 1200);
        return () => window.clearTimeout(timer);
    }, [clip.id, manualOrderConflict]);
    useEffect(() => () => {
        if (metadataTooltipTimerRef.current !== null) {
            window.clearTimeout(metadataTooltipTimerRef.current);
        }
    }, []);
    useEffect(() => {
        if (shotPlannerVariant) return;
        if (waveformEnvelope !== null) return;
        if (!clip.audio_codec && clip.audio_channels <= 0) {
            setWaveformEnvelope([]);
            return;
        }
        const requestKey = `${clip.id}:waveform`;
        if (waveformRequestKeyRef.current === requestKey) return;
        waveformRequestKeyRef.current = requestKey;
        let cancelled = false;
        void invoke<number[]>("extract_audio_waveform", { clipId: clip.id })
            .then((envelope) => {
                if (cancelled) return;
                setWaveformEnvelope(Array.isArray(envelope) ? envelope : []);
            })
            .catch((error) => {
                if (cancelled) return;
                setWaveformEnvelope([]);
                if (import.meta.env.DEV && !waveformWarningKeys.has(clip.id)) {
                    waveformWarningKeys.add(clip.id);
                    console.warn("[Wrap Preview] Failed to extract review waveform", clip.filename, error);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [clip.audio_channels, clip.audio_codec, clip.filename, clip.id, shotPlannerVariant, waveformEnvelope]);

    const handleShotSizeBlur = async () => {
        if (localShotSize.trim() === (clip.shot_size ?? "")) return;
        if (!localShotSize.trim()) await onUpdateMetadata(clip.id, { shot_size: "" });
        else if (shotSizeOptions.includes(localShotSize.trim())) await onUpdateMetadata(clip.id, { shot_size: localShotSize.trim() });
        else setLocalShotSize(clip.shot_size ?? ""); // reset if invalid
    };

    const handleMovementBlur = async () => {
        if (localMovement.trim() === (clip.movement ?? "")) return;
        if (!localMovement.trim()) await onUpdateMetadata(clip.id, { movement: "" });
        else if (movementOptions.includes(localMovement.trim())) await onUpdateMetadata(clip.id, { movement: localMovement.trim() });
        else setLocalMovement(clip.movement ?? ""); // reset if invalid
    };

    const handleManualOrderBlur = async (input?: HTMLInputElement | null) => {
        if (localManualOrder === (clip.manual_order ?? 0)) return;
        const ok = await onUpdateMetadata(clip.id, { manual_order: localManualOrder });
        if (!ok && input) {
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        }
    };

    const scheduleMetadataTooltip = (tooltipKey: string) => {
        if (metadataTooltipTimerRef.current !== null) {
            window.clearTimeout(metadataTooltipTimerRef.current);
        }
        metadataTooltipTimerRef.current = window.setTimeout(() => {
            setActiveMetadataTooltip(tooltipKey);
            metadataTooltipTimerRef.current = null;
        }, 550);
    };

    const clearMetadataTooltip = () => {
        if (metadataTooltipTimerRef.current !== null) {
            window.clearTimeout(metadataTooltipTimerRef.current);
            metadataTooltipTimerRef.current = null;
        }
        setActiveMetadataTooltip(null);
    };

    const previewThumbnails = useMemo(() => getDisplayedThumbsForClip({
        clipId: clip.id,
        thumbnails,
        thumbnailCache,
        thumbCount: MAX_FILMSTRIP_PREVIEW_COUNT,
        cacheKeyContext,
    }), [clip.id, thumbnails, thumbnailCache, cacheKeyContext]);

    return (
        <div
            ref={cardRef}
            className={`clip-card premium-card ${isSelected ? 'selected' : ''} flag-${visualFlag} ${isFocused ? "focused" : ""}`}
            onMouseEnter={() => onMouseEnter(clip.id)}
            onMouseLeave={() => onMouseLeave(null)}
            onClick={(e) => {
                if ((e.target as HTMLElement).closest('button, input, select')) return;
                onFocus(clip.id);
            }}
            style={{ "--corner-color": isSelected ? "var(--color-accent-soft)" : isFocused ? "rgba(80, 162, 255, 0.16)" : "rgba(255,255,255,0.03)" } as any}
            onDoubleClick={(e) => {
                // Only promote if not double-clicking interactive elements
                if ((e.target as HTMLElement).closest('button, input, select')) return;
                onPromoteClip(clip.id);
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
                    {!shotPlannerVariant && (
                        <div className="clip-rating">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                    key={star}
                                    size={14}
                                    className={`star ${star <= clip.rating ? 'filled' : ''}`}
                                    onClick={() => { void onUpdateMetadata(clip.id, { rating: star === clip.rating ? 0 : star }); }}
                                />
                            ))}
                        </div>
                    )}
                    <div className="clip-flags">
                        {shotPlannerVariant && (
                            <button
                                className="btn-flag btn-reset"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onResetClip?.(clip.id);
                                }}
                                title="Reset clip tags"
                                aria-label="Reset"
                            >
                                <span>Reset</span>
                            </button>
                        )}
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
                                void onUpdateMetadata(clip.id, { flag: nextFlag });
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
                        onClick={(e) => { e.stopPropagation(); onToggle(clip.id); }}
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
                    thumbnails={previewThumbnails}
                    status={clip.status}
                    placeholderCount={thumbCount}
                    count={thumbCount}
                    aspectRatio={clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9}
                    onDoubleClick={() => onPlayClip(clip.id)}
                    projectLutHash={projectLutHash}
                    clipLutEnabled={clip.lut_enabled}
                    lutRenderNonce={lutRenderNonce}
                    fallbackThumbnailSrc={previewThumbnails[0]?.src}
                    thumbnailCache={thumbnailCache}
                    cacheKeyContext={cacheKeyContext}
                />
            </div>


            {/* Actions / Metadata */}
            <div className="clip-card-footer">
                <div className="clip-metadata-compact">
                    {metadataTags.map((tag: { label: string; value: string; highlight?: boolean }) => {
                        const tooltipKey = `${clip.id}-${tag.label}`;
                        const tooltipCopy = metadataTooltipCopy[tag.label] ?? tag.label;
                        if (tag.label === "AUDIO") {
                            const healthClass = tag.value === "NO AUDIO" ? "silent" : (tag.value === "POSSIBLE CLIP" ? "clipping" : "");
                            return (
                                <span
                                    key={`${clip.id}-${tag.label}`}
                                    className={`metadata-pill audio-health-badge ${healthClass}`}
                                    onMouseEnter={() => scheduleMetadataTooltip(tooltipKey)}
                                    onMouseLeave={clearMetadataTooltip}
                                >
                                    {tag.value}
                                    {activeMetadataTooltip === tooltipKey && (
                                        <span className="metadata-tooltip-pill" role="tooltip">{tooltipCopy}</span>
                                    )}
                                </span>
                            );
                        }
                        return (
                            <span
                                key={`${clip.id}-${tag.label}-${tag.value}`}
                                className={`metadata-pill metadata-tag ${tag.highlight ? "highlight-tag" : ""} ${tag.value === "POSSIBLE CLIP" ? "danger-tag" : tag.value === "VERY LOW" ? "warn-tag" : ""}`}
                                onMouseEnter={() => scheduleMetadataTooltip(tooltipKey)}
                                onMouseLeave={clearMetadataTooltip}
                            >
                                {tag.value}
                                {activeMetadataTooltip === tooltipKey && (
                                    <span className="metadata-tooltip-pill" role="tooltip">{tooltipCopy}</span>
                                )}
                            </span>
                        );
                    })}

                    {!clip.timecode && (
                        <span
                            className="metadata-pill metadata-tag danger-tag"
                            onMouseEnter={() => scheduleMetadataTooltip(`${clip.id}-NO_TC`)}
                            onMouseLeave={clearMetadataTooltip}
                        >
                            NO TC
                            {activeMetadataTooltip === `${clip.id}-NO_TC` && (
                                <span className="metadata-tooltip-pill" role="tooltip">{metadataTooltipCopy.NO_TC}</span>
                            )}
                        </span>
                    )}
                    <div className="clip-card-status-wrapper">
                        <span className={`clip-status-dot ${clip.status}`} />
                    </div>
                </div>
            </div>

            {/* Waveform Sparkline */}
            {waveformEnvelope && waveformEnvelope.length > 0 && (
                <Waveform
                    envelope={waveformEnvelope}
                    onPlayToggle={() => onPlayClip(clip.id)}
                    isPlaying={isPlaying}
                    progress={progress}
                />
            )}


            <div className="clip-lookbook-taxonomy">
                <label className="clip-taxonomy-field">
                    <span className="meta-label">Shot Size</span>
                    <input
                        data-clip-id={clip.id}
                        data-clip-field="shot_size"
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
                        data-clip-id={clip.id}
                        data-clip-field="movement"
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
                    <div className="custom-stepper manual-order-stepper">
                        <input
                            type="number"
                            data-clip-id={clip.id}
                            data-clip-field="manual_order"
                            className={`input-text ${localManualOrder !== 0 ? 'is-picked' : ''}`}
                            value={localManualOrder}
                            onChange={(e) => {
                                onManualOrderInputChange?.();
                                setLocalManualOrder(Number(e.target.value || 0));
                            }}
                            onBlur={(e) => { void handleManualOrderBlur(e.currentTarget); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleManualOrderBlur(e.currentTarget); } }}
                            min={0}
                            disabled={lookbookSortMode !== "custom"}
                        />
                        <span className={`manual-order-popup ${showOrderConflict ? "visible" : ""}`}>Order already used</span>
                        <div className="stepper-controls">
                            <button
                                className="stepper-btn"
                                onClick={() => { const val = Math.max(1, localManualOrder + 1); setLocalManualOrder(val); void onUpdateMetadata(clip.id, { manual_order: val }); }}
                                disabled={lookbookSortMode !== "custom"}
                            >
                                <ChevronUp size={12} />
                            </button>
                            <button
                                className="stepper-btn"
                                onClick={() => { const val = Math.max(0, localManualOrder - 1); setLocalManualOrder(val); void onUpdateMetadata(clip.id, { manual_order: val }); }}
                                disabled={lookbookSortMode !== "custom"}
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
});
