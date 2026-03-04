export const THUMBNAIL_JUMP_INTERVALS = [2, 4, 6] as const;

export function getJumpIntervalForThumbCount(thumbCount: number): number {
  if (thumbCount >= 7) return 2;
  if (thumbCount >= 5) return 4;
  return 6;
}

export function getThumbnailCacheContext(jumpSeconds: number): string {
  return `jump=${jumpSeconds}`;
}
