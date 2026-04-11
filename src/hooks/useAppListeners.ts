import { useEffect, MutableRefObject } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
    JobInfo,
    ThumbnailProgress,
    Phase,
    PhaseData
} from "../types";
import { isTauriReloading } from "../utils/tauri";

interface UseAppListenersProps {
    setPhaseState: (phase: Phase, updates: Partial<PhaseData> | ((prev: PhaseData) => PhaseData)) => void;
    refreshProjectClips: (projectId: string, targetPhase: Phase) => Promise<void>;
    projectPhaseMapRef: MutableRefObject<Map<string, Phase>>;
    isShotPlannerActive: boolean;
    refreshJobs: () => void;
    hydrateThumbnailCacheEntries: (entries: Array<{ clipId: string; jumpSeconds: number; index: number; path: string }>) => Promise<Array<{ clipId: string; jumpSeconds: number; index: number; src: string }>>;
    getThumbCacheKey: (clipId: string, index: number, context?: string) => string;
    getThumbnailCacheContext: (jumpSeconds: number) => string;
}

export function useAppListeners({
    setPhaseState,
    refreshProjectClips,
    projectPhaseMapRef,
    isShotPlannerActive,
    refreshJobs,
    hydrateThumbnailCacheEntries,
    getThumbCacheKey,
    getThumbnailCacheContext,
}: UseAppListenersProps) {
    // Job System Synchronization
    useEffect(() => {
        let unlisten: UnlistenFn | null = null;
        let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

        const throttledRefresh = () => {
            if (refreshTimeout) return;
            refreshTimeout = setTimeout(() => {
                refreshJobs();
                refreshTimeout = null;
            }, 1000); // Max once per second
        };

        const setupJobListener = async () => {
            unlisten = await listen<JobInfo>("job-progress", () => throttledRefresh());
        };

        setupJobListener().catch(console.error);

        return () => {
            if (unlisten) unlisten();
            if (refreshTimeout) clearTimeout(refreshTimeout);
        };
    }, [refreshJobs]);

    // Persistent Thumbnail Listeners
    useEffect(() => {
        let unlistenProgress: UnlistenFn | null = null;
        let unlistenComplete: UnlistenFn | null = null;

        async function setupThumbnailListeners() {
            unlistenProgress = await listen<ThumbnailProgress>("thumbnail-progress", async (event) => {
                if (isTauriReloading()) return;
                const { project_id, clip_id, clip_index, total_clips, thumbnails } = event.payload;

                const targetPhase = projectPhaseMapRef.current.get(project_id);
                if (!targetPhase) return;

                // Immediately attempt to hydrate these new thumbnails for the cache
                const incomingEntries = thumbnails.map(t => ({
                    clipId: t.clip_id,
                    jumpSeconds: t.jump_seconds,
                    index: t.index,
                    path: t.file_path
                }));

                const hydrated = await hydrateThumbnailCacheEntries(incomingEntries);

                setPhaseState(targetPhase, (prev: PhaseData) => {
                    const done = clip_index + 1;
                    const nextProgress = { done, total: total_clips };

                    // Throttled updates to clips state.
                    const isAtEnd = done === total_clips;
                    const shouldUpdateClips = !isShotPlannerActive || (clip_index % 10 === 0) || isAtEnd;
                    const shouldUpdateProgress = (clip_index % 10 === 0) || isAtEnd;

                    if (!shouldUpdateClips && !shouldUpdateProgress && hydrated.length === 0) {
                        return prev;
                    }

                    const nextClips = shouldUpdateClips
                        ? prev.clips.map((c) => c.clip.id === clip_id ? { ...c, thumbnails: thumbnails } : c)
                        : prev.clips;

                    const nextCache = { ...(prev.thumbnailCache || {}) };
                    for (const { clipId, jumpSeconds, index, src } of hydrated) {
                        nextCache[`${clipId}_${index}`] = nextCache[`${clipId}_${index}`] ?? src;
                        nextCache[getThumbCacheKey(clipId, index, getThumbnailCacheContext(jumpSeconds))] = src;
                    }

                    return {
                        ...prev,
                        extractProgress: shouldUpdateProgress ? nextProgress : prev.extractProgress,
                        clips: nextClips,
                        thumbnailCache: nextCache
                    };
                });
            });

            unlistenComplete = await listen("thumbnail-complete", async (event) => {
                if (isTauriReloading()) return;
                const payload = event.payload as { project_id: string; clip_id?: string | null };
                const project_id = payload.project_id;

                const targetPhase = projectPhaseMapRef.current.get(project_id);
                if (targetPhase) {
                    setPhaseState(targetPhase, { extracting: false });
                    if (isTauriReloading()) return;
                    await refreshProjectClips(project_id, targetPhase);
                }
            });
        }

        setupThumbnailListeners().catch(console.error);

        return () => {
            if (unlistenProgress) unlistenProgress();
            if (unlistenComplete) unlistenComplete();
        };
    }, [setPhaseState, refreshProjectClips, projectPhaseMapRef, isShotPlannerActive, hydrateThumbnailCacheEntries, getThumbCacheKey, getThumbnailCacheContext]);
}
