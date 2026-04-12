import React, { useMemo } from "react";
import { MousePointer2, Pen, ArrowUpRight, Square, Circle } from "lucide-react";
import {
    AnnotationItem,
    AnnotationTool,
    AnnotationVectorData,
    OverlayFrameRect,
    NormalizedPoint
} from "./types";
import { ReviewCoreAnnotation } from "../../types";
import { parseAnnotationData } from "./utils";

interface AnnotationOverlayProps {
    rect: OverlayFrameRect;
    activeAnnotation: ReviewCoreAnnotation | null;
    draft: AnnotationVectorData | null;
    activeDraftItem: AnnotationItem | null;
    onMouseDown: (point: NormalizedPoint) => void;
    onMouseMove: (point: NormalizedPoint) => void;
    onMouseUp: () => void;
    isLocked?: boolean;
    annotationTool?: AnnotationTool;
    onToolChange?: (tool: AnnotationTool) => void;
    isAnnotating?: boolean;
}

const TOOL_BUTTONS: { tool: AnnotationTool; Icon: React.ComponentType<{ className?: string }> }[] = [
    { tool: "pointer", Icon: MousePointer2 },
    { tool: "pen", Icon: Pen },
    { tool: "arrow", Icon: ArrowUpRight },
    { tool: "rect", Icon: Square },
    { tool: "circle", Icon: Circle },
];

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
    rect,
    activeAnnotation,
    draft,
    activeDraftItem,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    isLocked = false,
    annotationTool,
    onToolChange,
    isAnnotating = false,
}) => {
    const displayData = useMemo(() => {
        if (draft) return draft;
        if (activeAnnotation) {
            return parseAnnotationData(activeAnnotation.vector_data, activeAnnotation.comment_id, 0);
        }
        return null;
    }, [draft, activeAnnotation]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (isLocked) return;
        const point = getNormalizedPoint(e);
        onMouseDown(point);
        (e.target as Element).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (isLocked) return;
        const point = getNormalizedPoint(e);
        onMouseMove(point);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (isLocked) return;
        onMouseUp();
        (e.target as Element).releasePointerCapture(e.pointerId);
    };

    const getNormalizedPoint = (e: React.PointerEvent): NormalizedPoint => {
        return [
            (e.clientX - rect.left) / rect.width,
            (e.clientY - rect.top) / rect.height,
        ];
    };

    if (rect.width <= 0 || rect.height <= 0) return null;

    const cursorClass = isLocked || annotationTool === "pointer"
        ? "cursor-default"
        : "cursor-crosshair";

    return (
        <>
            <svg
                className={`absolute z-30 pointer-events-auto ${cursorClass}`}
                style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
            >
                <defs>
                    <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                    >
                        <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                    </marker>
                </defs>

                {displayData?.items.map((item) => (
                    <AnnotationShape key={item.id} item={item} />
                ))}

                {activeDraftItem && <AnnotationShape item={activeDraftItem} isDraft />}
            </svg>

            {isAnnotating && onToolChange && (
                <div
                    className="absolute z-40 flex items-center gap-1 bg-black/80 border border-white/10 rounded-xl px-2 py-1.5 pointer-events-auto"
                    style={{
                        bottom: rect.top > 60 ? 12 : rect.top + rect.height + 8,
                        left: rect.left + rect.width / 2,
                        transform: "translateX(-50%)",
                    }}
                >
                    {TOOL_BUTTONS.map(({ tool, Icon }) => (
                        <button
                            key={tool}
                            onClick={() => onToolChange(tool)}
                            className={`p-1.5 rounded-lg transition-all ${
                                annotationTool === tool
                                    ? "bg-white text-black"
                                    : "text-white/50 hover:text-white hover:bg-white/10"
                            }`}
                            title={tool}
                        >
                            <Icon className="w-4 h-4" />
                        </button>
                    ))}
                </div>
            )}
        </>
    );
};

const AnnotationShape: React.FC<{ item: AnnotationItem; isDraft?: boolean }> = ({ item, isDraft }) => {
    const style = {
        stroke: item.style.stroke,
        strokeWidth: item.style.width / 500, // Scale relative to 1x1 viewBox
        fill: "none",
        vectorEffect: "non-scaling-stroke",
        opacity: isDraft ? 0.6 : 1,
    };

    if (item.type === "pen") {
        const d = item.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
        return <path d={d} {...style} strokeLinecap="round" strokeLinejoin="round" />;
    }

    if (item.type === "arrow") {
        return (
            <line
                x1={item.a[0]}
                y1={item.a[1]}
                x2={item.b[0]}
                y2={item.b[1]}
                {...style}
                markerEnd="url(#arrowhead)"
                color={item.style.stroke}
            />
        );
    }

    if (item.type === "rect") {
        return <rect x={item.x} y={item.y} width={item.w} height={item.h} {...style} />;
    }

    if (item.type === "circle") {
        return (
            <ellipse
                cx={item.x + item.w / 2}
                cy={item.y + item.h / 2}
                rx={item.w / 2}
                ry={item.h / 2}
                {...style}
            />
        );
    }

    return null;
};
