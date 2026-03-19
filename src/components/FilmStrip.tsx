import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "../types";
import { DisplayedThumbnail, getThumbnailCacheValue } from "../utils/shotPlannerThumbnails";
import { invokeGuarded, isTauriReloading } from "../utils/tauri";

interface FilmStripProps {
    clipId?: string;
    thumbnails: DisplayedThumbnail[] | Thumbnail[];
    thumbnailCache?: Record<string, string>;
    status: string;
    placeholderCount?: number;
    count?: number;
    cacheKeyContext?: string;
    aspectRatio?: number;
    onDoubleClick?: () => void;
    projectLutHash?: string | null;
    clipLutEnabled?: number;
    lutRenderNonce?: number;
    fallbackThumbnailSrc?: string;
    isImage?: boolean; // New prop
}

export const FilmStrip = memo(function FilmStrip({
    clipId,
    thumbnails,
    thumbnailCache = {},
    status,
    placeholderCount = 1,
    count,
    cacheKeyContext,
    aspectRatio = 16 / 9,
    onDoubleClick,
    projectLutHash,
    clipLutEnabled = 0,
    lutRenderNonce = 0,
    fallbackThumbnailSrc,
    isImage = false, // Default to false
}: FilmStripProps) {

    const effectivePlaceholderCount = isImage ? 1 : (count ?? placeholderCount);
    const indices = useMemo(
        () => Array.from({ length: effectivePlaceholderCount }, (_, i) => i),
        [effectivePlaceholderCount]
    );
    const orientationClass = aspectRatio > 0 && aspectRatio < 1 ? "is-vertical" : "is-horizontal";
    const imageClass = isImage ? "is-image" : "";

    const resolvedThumbnails: DisplayedThumbnail[] = useMemo(() => thumbnails.map((thumb) => {
        if ("src" in thumb) {
            return thumb;
        }
        return {
            index: thumb.index,
            timestamp_ms: thumb.timestamp_ms,
            src: clipId ? (getThumbnailCacheValue(thumbnailCache, clipId, thumb.index, cacheKeyContext) ?? "") : "",
            file_path: thumb.file_path,
        };
    }).filter((thumb) => Boolean(thumb.src)), [cacheKeyContext, clipId, thumbnailCache, thumbnails]);

    const [renderSources, setRenderSources] = useState<string[]>([]);
    const renderTokenRef = useRef(0);

    useEffect(() => {
        const visibleThumbs = resolvedThumbnails.slice(0, effectivePlaceholderCount);
        const shouldApplyLut = Boolean(projectLutHash && clipLutEnabled === 1);
        if (!shouldApplyLut) {
            setRenderSources(visibleThumbs.map((thumb) => thumb.src));
            return;
        }
        const token = renderTokenRef.current + 1;
        renderTokenRef.current = token;
        let cancelled = false;
        void Promise.all(visibleThumbs.map(async (thumb) => {
            if (isTauriReloading()) return thumb.src;
            const thumbPath = thumb.file_path;
            if (!thumbPath || thumbPath.startsWith("data:")) return thumb.src;
            const parts = thumbPath.split("/");
            const filename = parts.pop();
            if (!filename) return thumb.src;
            const lutPath = [...parts, `lut_${projectLutHash}_${filename}`].join("/");
            try {
                return await invokeGuarded<string>("read_thumbnail", { path: lutPath });
            } catch {
                return thumb.src;
            }
        })).then((nextSources) => {
            if (cancelled || renderTokenRef.current !== token || isTauriReloading()) return;
            setRenderSources(nextSources);
        });
        return () => {
            cancelled = true;
        };
    }, [clipLutEnabled, effectivePlaceholderCount, lutRenderNonce, projectLutHash, resolvedThumbnails]);

    if (status === "fail") {
        return (
            <div
                className={`film-strip filmstrip ${orientationClass} ${imageClass}`}
                onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
                style={{ "--aspect-ratio": aspectRatio } as any}
            >
                {indices.map((i) => (
                    <div key={i} className="film-strip-placeholder">
                        {i === Math.floor(effectivePlaceholderCount / 2) ? "Failed" : ""}
                    </div>
                ))}
            </div>
        );
    }

    if (resolvedThumbnails.length === 0) {
        return (
            <div
                className={`film-strip filmstrip ${orientationClass} ${imageClass}`}
                onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
                style={{ "--aspect-ratio": aspectRatio, "--thumb-columns": effectivePlaceholderCount } as any}
            >
                {indices.map((idx) => (
                    <div key={idx} className="film-strip-placeholder">
                        {idx === Math.floor(effectivePlaceholderCount / 2) ? (
                            <span className="thumb-warning">No thumbnails</span>
                        ) : (
                            <span className="thumb-warning">—</span>
                        )}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div
            className={`film-strip filmstrip ${orientationClass} ${imageClass}`}
            onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
            style={{ "--aspect-ratio": aspectRatio, "--thumb-columns": effectivePlaceholderCount } as any}
        >
            {indices.map((idx) => {
                const thumb = resolvedThumbnails[idx];
                const src = renderSources[idx] ?? thumb?.src;

                if (src) {
                    return (
                        <div key={idx} className="film-strip-thumb">
                            <img className="thumb" src={src} alt={`Frame ${idx + 1}`} onError={(e) => {
                                // Fallback to original thumbnail if LUT image fails to load
                                if (thumb && projectLutHash && clipLutEnabled === 1) {
                                    (e.target as HTMLImageElement).src = fallbackThumbnailSrc ?? thumb.src;
                                }
                            }} loading="lazy" decoding="async" />
                            {!isImage && (
                                <span className="thumb-time">
                                    {formatTimestamp(thumb?.timestamp_ms || 0)}
                                </span>
                            )}
                        </div>
                    );
                }

                return (
                    <div key={idx} className="film-strip-placeholder">
                        {resolvedThumbnails.length === 0 && idx === Math.floor(effectivePlaceholderCount / 2) ? (
                            <span className="thumb-warning">No thumbnails</span>
                        ) : (
                            <span className="thumb-warning">—</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

function formatTimestamp(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}
