import { Thumbnail } from "../types";

export type RatioType = '16:9' | '9:16' | '1:1' | '4:5' | '3:5' | '4:3' | '2.39:1';

export interface FrameTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
}

export interface FramePreviewMedia {
    id: string;
    filename: string;
    file_path: string;
    width: number;
    height: number;
    duration_ms: number;
    status: string;
    thumbnails: Thumbnail[];
    type: 'video' | 'image';
}

export interface FramePreviewState {
    mediaList: FramePreviewMedia[];
    activeMediaId: string | null;
    selectedMediaIds: Set<string>;
    activeRatio: RatioType;
    visibleRatios: RatioType[]; // Max 4
    
    // Per-ratio independent transforms
    frameTransforms: {
        [key in RatioType]?: FrameTransform;
    };
}

export const RATIO_VALUES: Record<RatioType, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1 / 1,
    '4:5': 4 / 5,
    '3:5': 3 / 5,
    '4:3': 4 / 3,
    '2.39:1': 2.39 / 1,
};

export const INITIAL_TRANSFORM: FrameTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
};
