import React, { useMemo } from "react";
import {
    AnnotationItem,
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
}

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
    rect,
    activeAnnotation,
    draft,
    activeDraftItem,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    isLocked = false,
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

    return (
        <svg
            className={`absolute z-30 pointer-events-auto ${isLocked ? "cursor-default" : "cursor-crosshair"}`}
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
