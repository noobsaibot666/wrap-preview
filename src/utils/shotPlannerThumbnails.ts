import { Thumbnail } from "../types";

export interface DisplayedThumbnail {
  index: number;
  timestamp_ms: number;
  src: string;
  file_path?: string;
}

interface DisplayedThumbOptions {
  clipId: string;
  thumbnails: Thumbnail[];
  thumbnailCache: Record<string, string>;
  thumbCount: number;
  jumpSeconds?: number;
  cacheKeyContext?: string;
}

export function getThumbnailCacheValue(
  thumbnailCache: Record<string, string>,
  clipId: string,
  index: number,
  cacheKeyContext?: string,
): string | undefined {
  if (cacheKeyContext) {
    return thumbnailCache[`${clipId}_${index}::${cacheKeyContext}`];
  }
  return thumbnailCache[`${clipId}_${index}`];
}


export function getDisplayedThumbsForClip({
  clipId,
  thumbnails,
  thumbnailCache,
  thumbCount,
  jumpSeconds,
  cacheKeyContext,
}: DisplayedThumbOptions): DisplayedThumbnail[] {
  // If we have jumpSeconds, try that first. 
  // If we get fewer than thumbCount / 2 results, try to find a better jumpSeconds from what's available.
  let effectiveJump = jumpSeconds;
  
  if (jumpSeconds != null && thumbnails.length > 0) {
    const primaryCount = thumbnails.filter(t => t.jump_seconds === jumpSeconds).length;
    if (primaryCount < Math.min(thumbCount, 3)) {
      // Find the jump_seconds that gives us the most thumbnails without exceeding thumbCount by too much
      const availableJumps = Array.from(new Set(thumbnails.map(t => t.jump_seconds))).sort((a, b) => a - b);
      for (const j of availableJumps) {
        if (thumbnails.filter(t => t.jump_seconds === j).length >= Math.min(thumbCount, 5)) {
          effectiveJump = j;
          break;
        }
      }
    }
  }

  const resolved: DisplayedThumbnail[] = [...thumbnails]
    .filter((thumb) => effectiveJump == null || thumb.jump_seconds === effectiveJump)
    .sort((a, b) => a.index - b.index)
    .map((thumb) => {
      // Use the specific context for THIS jump
      const specificContext = cacheKeyContext?.replace(/jump=\d+/, `jump=${thumb.jump_seconds}`);
      const src = getThumbnailCacheValue(thumbnailCache, clipId, thumb.index, specificContext);
      if (!src) return null;
      return {
        index: thumb.index,
        timestamp_ms: thumb.timestamp_ms,
        src,
        file_path: thumb.file_path,
      };
    })
    .filter((thumb): thumb is NonNullable<typeof thumb> => Boolean(thumb));

  if (resolved.length === 0) return [];
  return resolved.slice(0, Math.max(1, thumbCount));
}
