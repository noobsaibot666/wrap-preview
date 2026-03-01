import { memo, useMemo, useState, useEffect, useRef } from "react";
import { Virtuoso, GroupedVirtuoso } from 'react-virtuoso';
import { Clip, ClipWithThumbnails } from "../types";
import { FilmStrip } from "./FilmStrip";
import { Film, Star, CheckCircle2, XCircle, FileDown, Image, ChevronUp, ChevronDown } from "lucide-react";
import { Waveform } from "./Waveform";
import { LookbookSortMode } from "../lookbook";
import { getAudioBadge, buildClipMetadataTags } from "../utils/clipMetadata";
import { getDisplayedThumbsForClip } from "../utils/shotPlannerThumbnails";




interface ClipListProps {
    clips: ClipWithThumbnails[];
    thumbnailCache: Record<string, string>;
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled'>>) => Promise<boolean>;
    onHoverClip: (id: string | null) => void;
    onFocusClip: (id: string) => void;
    onPromoteClip: (id: string) => void;
    onPlayClip: (id: string | null) => void;
    playingClipId: string | null;
    playingProgress: number;
    cacheKeyContext?: string;
    shotSizeOptions: string[];
    movementOptions: string[];
    lookbookSortMode: LookbookSortMode;
    onResetClip?: (id: string) => void;
    onManualOrderInputChange?: () => void;
    manualOrderConflict?: { clipId: string; nonce: number } | null;
    groupByShotSize: boolean;
    focusedClipId: string | null;
    projectLutHash: string | null;
    lutRenderNonce: number;
    hideLutControls?: boolean;
    onExportPDF: () => void;
    onExportImage: () => void;
    onExportMosaicPdf?: () => void;
    onExportMosaicImage?: () => void;
    variant?: "review" | "shot-planner";
}

export const ClipList = memo(function ClipList({
    clips,
    thumbnailCache,
    selectedIds,
    onToggleSelection,
    thumbCount,
    onUpdateMetadata,
    onHoverClip,
    onFocusClip,
    onPromoteClip,
    onPlayClip,
    playingClipId,
    playingProgress,
    cacheKeyContext,
    shotSizeOptions,
    movementOptions,
    lookbookSortMode,
    onResetClip,
    onManualOrderInputChange,
    manualOrderConflict,
    groupByShotSize,
    focusedClipId,
    projectLutHash,
    lutRenderNonce,
    hideLutControls = false,
    onExportPDF,
    onExportImage,
    onExportMosaicPdf,
    onExportMosaicImage,
    variant = "review",
}: ClipListProps) {
    if (clips.length === 0) return null;
    const [footerExportMenuOpen, setFooterExportMenuOpen] = useState(false);


    // Memoize the grouping logic to avoid heavy re-calculations on every render
    const { groups, groupCounts } = useMemo(() => {
        const isManual = lookbookSortMode === "custom" || lookbookSortMode === "hook_first";
        if (isManual || !groupByShotSize) {
            return { groups: [], groupCounts: [clips.length] };
        }

        const counts: number[] = [];
        const labels: string[] = [];
        let currentGroupLabel = "";
        let currentGroupCount = 0;

        clips.forEach((item, idx) => {
            const label = item.clip.shot_size ?? "Unspecified Shot Size";
            if (idx === 0) {
                currentGroupLabel = label;
                currentGroupCount = 1;
            } else if (label !== currentGroupLabel) {
                counts.push(currentGroupCount);
                labels.push(currentGroupLabel);
                currentGroupLabel = label;
                currentGroupCount = 1;
            } else {
                currentGroupCount++;
            }
        });
        counts.push(currentGroupCount);
        labels.push(currentGroupLabel);

        return { groups: labels, groupCounts: counts };
    }, [clips, groupByShotSize, lookbookSortMode]);

    // Custom Scroll Container Component to match existing styles
    const Scroller = ({ style, ...props }: any) => (
        <div
            className="clip-list-viewport custom-scrollbar"
            style={{ ...style, overflowX: 'hidden' }}
            {...props}
        />
    );

    const List = ({ style, ...props }: any) => (
        <div className="clip-list-virtuoso" style={{ ...style, paddingBottom: 'var(--space-2xl)' }} {...props} />
    );


    const virtuosoRef = useRef<any>(null);

    // Scroll to focused item when it changes
    useEffect(() => {
        if (focusedClipId && virtuosoRef.current) {
            const index = clips.findIndex(c => c.clip.id === focusedClipId);
            if (index !== -1) {
                virtuosoRef.current.scrollIntoView({
                    index,
                    behavior: 'smooth',
                    done: () => {
                        // Optional: extra check if we need to refine position
                    }
                });
            }
        }
    }, [focusedClipId, clips]);

    const isManual = lookbookSortMode === "custom" || lookbookSortMode === "hook_first";
    const useGroups = isManual || !groupByShotSize ? false : groups.length > 0;

    return (
        <div className="clip-list-container" style={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>
            {variant !== "shot-planner" && (
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
                            title="Export Single Image"
                        >
                            <Image size={14} />
                            <span>Image</span>
                        </button>
                    </div>
                </div>
            )}

            {useGroups ? (
                <GroupedVirtuoso
                    ref={virtuosoRef}
                    groupCounts={groupCounts}
                    groupContent={(index) => (
                        <div className="clip-shot-group-header" style={{ background: 'var(--color-bg-page)', zIndex: 10 }}>
                            {groups[index]}
                        </div>
                    )}
                    itemContent={(index) => {
                        const item = clips[index];
                        return (
                            <div key={item.clip.id} style={{ paddingBottom: 'var(--space-md)' }}>
                                <ClipCard
                                    item={item}
                                    thumbnailCache={thumbnailCache}
                                    isSelected={selectedIds.has(item.clip.id)}
                                    // Use stable wrappers or pass ID-aware handlers
                                    onToggle={onToggleSelection}
                                    thumbCount={thumbCount}
                                    onUpdateMetadata={onUpdateMetadata}
                                    onMouseEnter={onHoverClip}
                                    onMouseLeave={onHoverClip}
                                    onFocus={onFocusClip}
                                    shotSizeOptions={shotSizeOptions}
                                    movementOptions={movementOptions}
                                    lookbookSortMode={lookbookSortMode}
                                    onResetClip={onResetClip}
                                    onManualOrderInputChange={onManualOrderInputChange}
                                    manualOrderConflict={manualOrderConflict}
                                    onPromoteClip={onPromoteClip}
                                    onPlayClip={onPlayClip}
                                    isPlaying={playingClipId === item.clip.id}
                                    progress={playingClipId === item.clip.id ? playingProgress : 0}
                                    cacheKeyContext={cacheKeyContext}
                                    isFocused={focusedClipId === item.clip.id}
                                    projectLutHash={projectLutHash}
                                    lutRenderNonce={lutRenderNonce}
                                    hideLutControls={hideLutControls}
                                    variant={variant}
                                />
                            </div>
                        );
                    }}
                    components={{ Scroller, List }}
                    useWindowScroll={false}
                    increaseViewportBy={300}
                />
            ) : (
                <Virtuoso
                    ref={virtuosoRef}
                    totalCount={clips.length}
                    itemContent={(index) => {
                        const item = clips[index];
                        return (
                            <div key={item.clip.id} style={{ paddingBottom: 'var(--space-md)' }}>
                                <ClipCard
                                    item={item}
                                    thumbnailCache={thumbnailCache}
                                    isSelected={selectedIds.has(item.clip.id)}
                                    onToggle={onToggleSelection}
                                    thumbCount={thumbCount}
                                    onUpdateMetadata={onUpdateMetadata}
                                    onMouseEnter={onHoverClip}
                                    onMouseLeave={onHoverClip}
                                    onFocus={onFocusClip}
                                    shotSizeOptions={shotSizeOptions}
                                    movementOptions={movementOptions}
                                    lookbookSortMode={lookbookSortMode}
                                    onResetClip={onResetClip}
                                    onManualOrderInputChange={onManualOrderInputChange}
                                    manualOrderConflict={manualOrderConflict}
                                    onPromoteClip={onPromoteClip}
                                    onPlayClip={onPlayClip}
                                    isPlaying={playingClipId === item.clip.id}
                                    progress={playingClipId === item.clip.id ? playingProgress : 0}
                                    cacheKeyContext={cacheKeyContext}
                                    isFocused={focusedClipId === item.clip.id}
                                    projectLutHash={projectLutHash}
                                    lutRenderNonce={lutRenderNonce}
                                    hideLutControls={hideLutControls}
                                    variant={variant}
                                />
                            </div>
                        );
                    }}
                    components={{ Scroller, List }}
                    useWindowScroll={false}
                    increaseViewportBy={300}
                />
            )}
            {variant !== "shot-planner" && (
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
            )}
            {variant === "shot-planner" && (
                <div className="clip-list-footer shot-planner-footer-export">
                    <div className="shot-planner-export">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFooterExportMenuOpen((prev) => !prev)} aria-haspopup="menu" aria-expanded={footerExportMenuOpen}>
                            <FileDown size={14} />
                            <span>Export</span>
                        </button>
                        {footerExportMenuOpen && (
                            <div className="shot-planner-export-menu" role="menu">
                                <button type="button" className="shot-planner-export-item" onClick={() => { setFooterExportMenuOpen(false); onExportPDF(); }}>
                                    <FileDown size={14} />
                                    <span>PDF</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setFooterExportMenuOpen(false); onExportImage(); }}>
                                    <Image size={14} />
                                    <span>Image</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setFooterExportMenuOpen(false); onExportMosaicPdf?.(); }}>
                                    <FileDown size={14} />
                                    <span>Mosaic (PDF)</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setFooterExportMenuOpen(false); onExportMosaicImage?.(); }}>
                                    <Image size={14} />
                                    <span>Mosaic (Image)</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            <datalist id="shot-size-options">
                {shotSizeOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
            <datalist id="movement-options">
                {movementOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
        </div>
    );
});


const ClipCard = memo(function ClipCard({
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
}: {
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
}) {

    const { clip, thumbnails } = item;
    const shotPlannerVariant = variant === "shot-planner";
    const audioHealth = getAudioBadge(clip.audio_summary, clip.audio_envelope);
    const metadataTags = buildClipMetadataTags(clip, audioHealth);
    const cardRef = useRef<HTMLDivElement>(null);
    const visualFlag = shotPlannerVariant && clip.flag === "pick" ? "none" : clip.flag;

    // Local state to prevent jumping during edits
    const [localShotSize, setLocalShotSize] = useState(clip.shot_size ?? "");
    const [localMovement, setLocalMovement] = useState(clip.movement ?? "");
    const [localManualOrder, setLocalManualOrder] = useState(clip.manual_order ?? 0);
    const [showOrderConflict, setShowOrderConflict] = useState(false);

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
        if (manualOrderConflict?.clipId !== clip.id) return;
        setShowOrderConflict(true);
        const timer = window.setTimeout(() => setShowOrderConflict(false), 1200);
        return () => window.clearTimeout(timer);
    }, [clip.id, manualOrderConflict]);

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



    const displayedThumbnails = useMemo(() => getDisplayedThumbsForClip({
        clipId: clip.id,
        thumbnails,
        thumbnailCache,
        thumbCount,
        cacheKeyContext,
    }), [clip.id, thumbnails, thumbnailCache, thumbCount, cacheKeyContext]);

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
                        {!shotPlannerVariant && (
                            <button
                                className={`btn-flag btn-pick ${clip.flag === 'pick' ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const nextFlag = clip.flag === 'pick' ? 'none' : 'pick';
                                    void onUpdateMetadata(clip.id, { flag: nextFlag });
                                }}
                                title="Pick (P)"
                                aria-label="Pick"
                            >
                                <CheckCircle2 size={14} />
                                <span>Pick</span>
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
                    thumbnails={displayedThumbnails}
                    status={clip.status}
                    placeholderCount={thumbCount}
                    aspectRatio={clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9}
                    onDoubleClick={() => onPlayClip(clip.id)}
                    projectLutHash={projectLutHash}
                    clipLutEnabled={clip.lut_enabled}
                    lutRenderNonce={lutRenderNonce}
                    fallbackThumbnailSrc={displayedThumbnails[0]?.src}
                    thumbnailCache={thumbnailCache}
                    cacheKeyContext={cacheKeyContext}
                />
            </div>


            {/* Actions / Metadata */}
            <div className="clip-card-footer">
                <div className="clip-metadata-compact">
                    {metadataTags.map((tag: { label: string; value: string; highlight?: boolean }) => {
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

