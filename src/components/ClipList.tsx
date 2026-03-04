import { memo, useMemo, useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { GroupedVirtuoso } from 'react-virtuoso';
import { Clip, ClipWithThumbnails } from "../types";
import { FileDown, Image, ChevronDown, GripVertical } from "lucide-react";
import { LookbookSortMode } from "../lookbook";
import { ClipCard } from "./ClipCard";
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragEndEvent,
    DragOverlay,
} from "@dnd-kit/core";



const VirtuosoScroller = forwardRef<HTMLDivElement, any>(({ style, ...props }, ref) => (
    <div
        ref={ref}
        className="clip-list-viewport custom-scrollbar"
        style={{ ...style, overflowX: "hidden" }}
        {...props}
    />
));

VirtuosoScroller.displayName = "VirtuosoScroller";

const VirtuosoList = forwardRef<HTMLDivElement, any>(({ style, ...props }, ref) => (
    <div
        ref={ref}
        className="clip-list-virtuoso"
        style={{ ...style, paddingBottom: "var(--space-2xl)" }}
        {...props}
    />
));

VirtuosoList.displayName = "VirtuosoList";

const virtuosoComponents = {
    Scroller: VirtuosoScroller,
    List: VirtuosoList,
};

interface ClipListProps {
    clips: ClipWithThumbnails[];
    thumbnailCache: Record<string, string>;
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
    thumbCount: number;
    onUpdateMetadata: (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled'>>) => Promise<boolean>;
    onHoverClip: (id: string | null) => void;
    onFocusClip: (id: string, options?: { scrollIntoView?: boolean }) => void;
    onPromoteClip: (id: string) => void;
    onPlayClip: (id: string | null) => void;
    playingClipId: string | null;
    playingProgress: number;
    jumpSeconds?: number;
    cacheKeyContext?: string;
    shotSizeOptions: string[];
    movementOptions: string[];
    lookbookSortMode: LookbookSortMode;
    onResetClip?: (id: string) => void;
    onManualOrderInputChange?: () => void;
    manualOrderConflict?: { clipId: string; nonce: number } | null;
    groupByShotSize: boolean;
    focusedClipId: string | null;
    focusedClipScrollToken?: number;
    projectLutHash: string | null;
    lutRenderNonce: number;
    hideLutControls?: boolean;
    onExportPDF: () => void;
    onExportImage: () => void;
    onExportMosaicPdf?: () => void;
    onExportMosaicImage?: () => void;
    variant?: "review" | "shot-planner";
    hideSectionHeader?: boolean;
    onReorderClips?: (activeId: string, overId: string) => void;
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
    jumpSeconds,
    cacheKeyContext,
    shotSizeOptions,
    movementOptions,
    lookbookSortMode,
    onResetClip,
    onManualOrderInputChange,
    manualOrderConflict,
    groupByShotSize,
    focusedClipId,
    focusedClipScrollToken = 0,
    projectLutHash,
    lutRenderNonce,
    hideLutControls = false,
    onExportPDF,
    onExportImage,
    onExportMosaicPdf,
    onExportMosaicImage,
    variant = "review",
    hideSectionHeader = false,
    onReorderClips,
}: ClipListProps) {
    if (clips.length === 0) return null;
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [isViewportReady, setIsViewportReady] = useState(false);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);

    const isDndEnabled = lookbookSortMode === "custom" && !!onReorderClips;

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        })
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveDragId(event.active.id as string);
    }, []);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        setActiveDragId(null);
        if (over && active.id !== over.id && onReorderClips) {
            onReorderClips(active.id as string, over.id as string);
        }
    }, [onReorderClips]);

    const handleDragCancel = useCallback(() => {
        setActiveDragId(null);
    }, []);

    const activeDragItem = activeDragId ? clips.find(c => c.clip.id === activeDragId) : null;


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
    const virtuosoRef = useRef<any>(null);
    const lastFocusedId = useRef<string | null>(null);

    // Scroll to focused item when it changes
    useEffect(() => {
        if (!focusedClipId) {
            lastFocusedId.current = null;
            return;
        }
        if (focusedClipId === lastFocusedId.current || !virtuosoRef.current || focusedClipScrollToken === 0) {
            lastFocusedId.current = focusedClipId;
            return;
        }
        lastFocusedId.current = focusedClipId;
        const index = clips.findIndex(c => c.clip.id === focusedClipId);
        if (index !== -1) {
            virtuosoRef.current.scrollIntoView({
                index,
                behavior: 'auto',
                align: 'center'
            });
        }
    }, [focusedClipId, focusedClipScrollToken, clips]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const updateReadyState = () => {
            const rect = element.getBoundingClientRect();
            setIsViewportReady(rect.width > 0 && rect.height > 0);
        };
        updateReadyState();
        const observer = new ResizeObserver(updateReadyState);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);


    // We always use GroupedVirtuoso now to prevent unmounting when switching modes.
    // If grouping is disabled, we just have one large group.

    return (
        <div ref={containerRef} className="clip-list-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {variant !== "shot-planner" && !hideSectionHeader && (
                <div className="section-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <span className="section-title">Clips</span>
                        <span className="section-count highlight">{clips.length}</span>
                    </div>
                    <div className="shot-planner-export">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => { e.stopPropagation(); setExportMenuOpen((prev) => !prev); }}
                            aria-haspopup="menu"
                            aria-expanded={exportMenuOpen}
                        >
                            <FileDown size={14} />
                            <span>Export</span>
                            <ChevronDown size={14} />
                        </button>
                        {exportMenuOpen && (
                            <div className="shot-planner-export-menu" role="menu">
                                <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportPDF(); }}>
                                    <FileDown size={14} />
                                    <span>PDF</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportImage(); }}>
                                    <Image size={14} />
                                    <span>Image</span>
                                </button>
                                {onExportMosaicPdf && (
                                    <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportMosaicPdf(); }}>
                                        <FileDown size={14} />
                                        <span>Mosaic (PDF)</span>
                                    </button>
                                )}
                                {onExportMosaicImage && (
                                    <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportMosaicImage(); }}>
                                        <Image size={14} />
                                        <span>Mosaic (Image)</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <DndContext
                sensors={isDndEnabled ? sensors : []}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
            >
                {isViewportReady ? (
                    <GroupedVirtuoso
                        ref={virtuosoRef}
                        groupCounts={groupCounts}
                        groupContent={(index) => {
                            if (groups.length === 0) return null;
                            return (
                                <div className="clip-shot-group-header" style={{ background: 'var(--color-bg-page)', zIndex: 10 }}>
                                    {groups[index]}
                                </div>
                            );
                        }}
                        itemContent={(index) => {
                            const item = clips[index];
                            return (
                                <div
                                    key={item.clip.id}
                                    data-clip-id={item.clip.id}
                                    style={{
                                        paddingBottom: 'var(--space-md)',
                                        opacity: activeDragId === item.clip.id ? 0.3 : 1,
                                        transition: 'opacity 150ms ease',
                                    }}
                                >
                                    {isDndEnabled && (
                                        <div
                                            className="clip-drag-handle"
                                            data-dnd-handle
                                            data-dnd-id={item.clip.id}
                                            onPointerDown={(e) => {
                                                // Start drag via pointer sensor - this element acts as the handle
                                                e.stopPropagation();
                                            }}
                                        >
                                            <GripVertical size={14} />
                                        </div>
                                    )}
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
                                        jumpSeconds={jumpSeconds}
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
                        components={virtuosoComponents}
                        useWindowScroll={false}
                        increaseViewportBy={500}
                    />
                ) : (
                    <div className="clip-list-loading-shell" aria-hidden="true" />
                )}

                <DragOverlay dropAnimation={{
                    duration: 200,
                    easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
                }}>
                    {activeDragItem ? (
                        <div className="clip-drag-overlay">
                            <div className="clip-drag-overlay-inner">
                                <span className="clip-drag-overlay-name">{activeDragItem.clip.filename}</span>
                            </div>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
            {variant === "shot-planner" && (
                <div className="clip-list-footer shot-planner-footer-export">
                    <div className="shot-planner-export">
                        <button type="button" className="btn btn-secondary btn-sm shot-planner-floating-button" onClick={() => setExportMenuOpen((prev) => !prev)} aria-haspopup="menu" aria-expanded={exportMenuOpen}>
                            <FileDown size={14} />
                            <span>Export</span>
                        </button>
                        {exportMenuOpen && (
                            <div className="shot-planner-export-menu" role="menu">
                                <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportPDF(); }}>
                                    <FileDown size={14} />
                                    <span>PDF</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportImage(); }}>
                                    <Image size={14} />
                                    <span>Image</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportMosaicPdf?.(); }}>
                                    <FileDown size={14} />
                                    <span>Mosaic (PDF)</span>
                                </button>
                                <button type="button" className="shot-planner-export-item" onClick={() => { setExportMenuOpen(false); onExportMosaicImage?.(); }}>
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

