import { ReviewCoreAsset, ReviewCoreComment } from "../../types";
import {
    AnnotationItem,
    AnnotationStyle,
    AnnotationTool,
    AnnotationVectorData,
    CommonAsset,
    FrameNoteVectorData,
    NormalizedPoint,
    OverlayFrameRect,
} from "./types";

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
    stroke: "#00d1ff",
    width: 2,
};

export const REVIEWER_PALETTE = ["#00a3a3", "#d97706", "#3b82f6", "#16a34a", "#dc2626", "#0891b2", "#ca8a04", "#64748b"];

export function normalizeReviewerName(name?: string | null) {
    const trimmed = name?.trim();
    return trimmed || "Anonymous";
}

export function getReviewerInitials(name?: string | null) {
    const normalized = normalizeReviewerName(name);
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "A";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export function getReviewerColor(name?: string | null) {
    const normalized = normalizeReviewerName(name);
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
    }
    return REVIEWER_PALETTE[hash % REVIEWER_PALETTE.length];
}

export function truncateText(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function isInternalAsset(asset: CommonAsset): asset is ReviewCoreAsset {
    return "checksum_sha256" in asset;
}

export function createEmptyAnnotationDraft(comment: ReviewCoreComment): AnnotationVectorData {
    return {
        schemaVersion: 1,
        commentId: comment.id,
        timestampMs: comment.timestamp_ms,
        items: [],
    };
}

export function createEmptyFrameNoteDraft(timestampMs: number): FrameNoteVectorData {
    return {
        schemaVersion: 1,
        timestampMs,
        items: [],
    };
}

export function parseAnnotationData(raw?: string | null, commentId?: string, timestampMs?: number): AnnotationVectorData | null {
    if (!raw) {
        return commentId && timestampMs != null
            ? { schemaVersion: 1, commentId, timestampMs, items: [] }
            : null;
    }
    try {
        const parsed = JSON.parse(raw) as AnnotationVectorData;
        return {
            schemaVersion: 1,
            commentId: parsed.commentId || commentId || "",
            timestampMs: parsed.timestampMs ?? timestampMs ?? 0,
            items: Array.isArray(parsed.items) ? parsed.items : [],
        };
    } catch {
        return commentId && timestampMs != null
            ? { schemaVersion: 1, commentId, timestampMs, items: [] }
            : null;
    }
}

export function parseFrameNoteData(raw?: string | null, timestampMs?: number): FrameNoteVectorData | null {
    if (!raw) {
        return timestampMs != null ? createEmptyFrameNoteDraft(timestampMs) : null;
    }
    try {
        const parsed = JSON.parse(raw) as any;
        if (Array.isArray(parsed)) {
            return {
                schemaVersion: 1,
                timestampMs: timestampMs ?? 0,
                items: parsed,
            };
        }
        return {
            schemaVersion: 1,
            timestampMs: parsed.timestampMs ?? timestampMs ?? 0,
            items: Array.isArray(parsed.items) ? parsed.items : [],
        };
    } catch {
        return timestampMs != null ? createEmptyFrameNoteDraft(timestampMs) : null;
    }
}

export function createItemId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDraftItem(tool: AnnotationTool, point: NormalizedPoint, style: AnnotationStyle): AnnotationItem | null {
    const id = createItemId();
    if (tool === "pen") {
        return { id, type: "pen", points: [point, point], style };
    }
    if (tool === "arrow") {
        return { id, type: "arrow", a: point, b: point, style };
    }
    if (tool === "rect") {
        return { id, type: "rect", x: point[0], y: point[1], w: 0, h: 0, style };
    }
    if (tool === "circle") {
        return { id, type: "circle", x: point[0], y: point[1], w: 0, h: 0, style };
    }
    return null;
}

export function updateDraftItem(item: AnnotationItem, start: NormalizedPoint, point: NormalizedPoint): AnnotationItem {
    if (item.type === "pen") {
        return { ...item, points: [...item.points, point] };
    }
    if (item.type === "arrow") {
        return { ...item, b: point };
    }
    if (item.type === "rect" || item.type === "circle") {
        return {
            ...item,
            x: Math.min(start[0], point[0]),
            y: Math.min(start[1], point[1]),
            w: Math.abs(point[0] - start[0]),
            h: Math.abs(point[1] - start[1]),
        };
    }
    return item;
}

export function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

export function translateAnnotationItem(item: AnnotationItem, deltaX: number, deltaY: number): AnnotationItem {
    if (item.type === "arrow") {
        return {
            ...item,
            a: [clamp01(item.a[0] + deltaX), clamp01(item.a[1] + deltaY)],
            b: [clamp01(item.b[0] + deltaX), clamp01(item.b[1] + deltaY)],
        };
    }
    if (item.type === "pen") {
        return {
            ...item,
            points: item.points.map(([x, y]) => [clamp01(x + deltaX), clamp01(y + deltaY)]),
        };
    }
    if (item.type === "text") {
        return { ...item, x: clamp01(item.x + deltaX), y: clamp01(item.y + deltaY) };
    }
    return {
        ...item,
        x: clamp01(item.x + deltaX),
        y: clamp01(item.y + deltaY),
    };
}

export function distanceToSegment(point: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint) {
    const [px, py] = point;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    const clamped = Math.max(0, Math.min(1, t));
    const cx = ax + clamped * dx;
    const cy = ay + clamped * dy;
    return Math.hypot(px - cx, py - cy);
}

export function hitTestAnnotationItem(items: AnnotationItem[], point: NormalizedPoint): AnnotationItem | null {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item.type === "arrow") {
            if (distanceToSegment(point, item.a, item.b) <= 0.03) return item;
            continue;
        }
        if (item.type === "pen") {
            for (let i = 1; i < item.points.length; i += 1) {
                if (distanceToSegment(point, item.points[i - 1], item.points[i]) <= 0.025) return item;
            }
            continue;
        }
        if (item.type === "text") {
            if (Math.abs(point[0] - item.x) <= 0.06 && Math.abs(point[1] - item.y) <= 0.03) return item;
            continue;
        }
        if (point[0] >= item.x && point[0] <= item.x + item.w && point[1] >= item.y && point[1] <= item.y + item.h) {
            return item;
        }
    }
    return null;
}

export function getVideoFrameRect(container: HTMLDivElement, video: HTMLVideoElement): OverlayFrameRect {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!video.videoWidth || !video.videoHeight || width <= 0 || height <= 0) {
        return { left: 0, top: 0, width, height };
    }
    const videoAspect = video.videoWidth / video.videoHeight;
    const containerAspect = width / height;
    if (containerAspect > videoAspect) {
        const fittedWidth = height * videoAspect;
        return {
            left: (width - fittedWidth) / 2,
            top: 0,
            width: fittedWidth,
            height,
        };
    }
    const fittedHeight = width / videoAspect;
    return {
        left: 0,
        top: (height - fittedHeight) / 2,
        width,
        height: fittedHeight,
    };
}

export function formatDuration(durationMs?: number | null) {
    if (!durationMs) return "00:00";
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatResolution(asset: Pick<CommonAsset, "width" | "height">) {
    if (!asset.width || !asset.height) return "Unknown res";
    return `${asset.width}×${asset.height}`;
}

export function formatFps(fps?: number | null) {
    if (!fps) return "Unknown fps";
    return `${fps.toFixed(2)} fps`;
}

export function normalizePlaybackFps(rawRate?: string | null, fallback?: number | null) {
    if (rawRate && rawRate.includes("/")) {
        const [num, den] = rawRate.split("/").map((value) => Number(value));
        if (num > 0 && den > 0) return num / den;
    }
    return fallback && fallback > 0 ? fallback : 24;
}

export function formatApproxTime(seconds: number) {
    const wholeSeconds = Math.floor(seconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const secs = wholeSeconds % 60;
    const millis = Math.floor((seconds - wholeSeconds) * 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function formatTimecode(seconds: number, asset?: Pick<CommonAsset, "frame_rate" | "avg_frame_rate" | "r_frame_rate" | "is_vfr"> | null) {
    if (!asset) return formatApproxTime(seconds);
    const safeFps = normalizePlaybackFps(asset.avg_frame_rate || asset.r_frame_rate, asset.frame_rate);
    if (asset.is_vfr) {
        return formatApproxTime(seconds);
    }
    const wholeSeconds = Math.floor(seconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const secs = wholeSeconds % 60;
    const frames = Math.floor((seconds - wholeSeconds) * safeFps);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
