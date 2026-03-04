import {
    ReviewCoreAnnotation,
    ReviewCoreApprovalState,
    ReviewCoreAsset,
    ReviewCoreAssetWithVersions,
    ReviewCoreAssetVersion,
    ReviewCoreComment,
    ReviewCoreDuplicateCandidate,
    ReviewCoreExtractFrameResult,
    ReviewCoreFrameNote,
    ReviewCoreProjectSummary,
    ReviewCoreShareLinkResolved,
    ReviewCoreShareLinkSummary,
    ReviewCoreShareUnlockResult,
    ReviewCoreSharedAssetSummary,
    ReviewCoreSharedVersionSummary,
    ReviewCoreThumbnailInfo,
} from "../../types";

export type {
    ReviewCoreAnnotation,
    ReviewCoreApprovalState,
    ReviewCoreAsset,
    ReviewCoreAssetWithVersions,
    ReviewCoreAssetVersion,
    ReviewCoreComment,
    ReviewCoreDuplicateCandidate,
    ReviewCoreExtractFrameResult,
    ReviewCoreFrameNote,
    ReviewCoreProjectSummary,
    ReviewCoreShareLinkResolved,
    ReviewCoreShareLinkSummary,
    ReviewCoreShareUnlockResult,
    ReviewCoreSharedAssetSummary,
    ReviewCoreSharedVersionSummary,
    ReviewCoreThumbnailInfo,
};

export type ApprovalStatus = "draft" | "in_review" | "approved" | "rejected" | "changes_requested";
export type AnnotationTool = "pointer" | "pen" | "arrow" | "rect" | "circle" | "text";
export type ReviewCorePanelTab = "feedback" | "share";
export type NormalizedPoint = [number, number];
export type CommonAsset = ReviewCoreAsset | ReviewCoreSharedAssetSummary;
export type CommonVersion = ReviewCoreAssetVersion | ReviewCoreSharedVersionSummary;

export interface ReviewerIdentity {
    name: string;
    initials: string;
    color: string;
}

export interface AnnotationStyle {
    stroke: string;
    width: number;
}

export interface ArrowItem {
    id: string;
    type: "arrow";
    a: NormalizedPoint;
    b: NormalizedPoint;
    style: AnnotationStyle;
}

export interface RectItem {
    id: string;
    type: "rect";
    x: number;
    y: number;
    w: number;
    h: number;
    style: AnnotationStyle;
}

export interface CircleItem {
    id: string;
    type: "circle";
    x: number;
    y: number;
    w: number;
    h: number;
    style: AnnotationStyle;
}

export interface PenItem {
    id: string;
    type: "pen";
    points: NormalizedPoint[];
    style: AnnotationStyle;
}

export interface TextItem {
    id: string;
    type: "text";
    x: number;
    y: number;
    text: string;
    style: AnnotationStyle;
}

export type AnnotationItem = ArrowItem | RectItem | CircleItem | PenItem | TextItem;

export interface AnnotationVectorData {
    schemaVersion: 1;
    commentId: string;
    timestampMs: number;
    items: AnnotationItem[];
}

export interface OverlayFrameRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface FrameNoteVectorData {
    schemaVersion: 1;
    timestampMs: number;
    items: AnnotationItem[];
}

export interface FeedbackItem {
    id: string;
    source: "comment" | "frame_note";
    timestamp_ms: number;
    resolved: boolean;
    author_name: string;
    text: string;
    type_label: "Text" | "Draw";
    version_label: string;
    comment?: ReviewCoreComment;
    note?: ReviewCoreFrameNote;
}

export interface ReviewCoreProps {
    projectId?: string | null;
    projectName?: string | null;
    shareToken?: string | null;
    restricted?: boolean;
    onError?: (error: { title: string; hint: string } | null) => void;
    onExitShare?: () => void;
}
