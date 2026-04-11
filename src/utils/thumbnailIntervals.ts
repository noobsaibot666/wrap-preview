export const THUMBNAIL_JUMP_INTERVALS = [1, 2, 5, 10, 20, 30, 60] as const;

export function getJumpIntervalForThumbCount(thumbCount: number): number {
  if (thumbCount >= 30) return 1;
  if (thumbCount >= 20) return 2;
  if (thumbCount >= 10) return 5;
  if (thumbCount >= 5) return 10;
  if (thumbCount >= 2) return 30;
  return 60;
}

export function getThumbnailCacheContext(jumpSeconds: number, thumbCount?: number): string {
  return thumbCount ? `jump=${jumpSeconds}_tc=${thumbCount}` : `jump=${jumpSeconds}`;
}
