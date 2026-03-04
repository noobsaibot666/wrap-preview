import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clip, ClipWithThumbnails } from "../types";

interface UseClipActionsProps {
    clips: ClipWithThumbnails[];
    isShotPlannerActive: boolean;
    projectId: string | null;
    projectLut: { hash: string } | null;
    setClips: (val: ClipWithThumbnails[] | ((prev: ClipWithThumbnails[]) => ClipWithThumbnails[])) => void;
    setSelectedClipIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
    setManualOrderConflict: (val: { clipId: string; nonce: number } | null) => void;
    setUiError: (val: { title: string; hint: string } | null) => void;
    setLutRenderNonce: (val: number | ((prev: number) => number)) => void;
    refreshProjectClips: (id: string) => Promise<void>;
}

export function useClipActions({
    clips,
    isShotPlannerActive,
    projectId,
    projectLut,
    setClips,
    setSelectedClipIds,
    setManualOrderConflict,
    setUiError,
    setLutRenderNonce,
    refreshProjectClips,
}: UseClipActionsProps) {
    const isManualOrderTaken = useCallback((clipId: string, order: number) => {
        if (!order) return false;
        return clips.some(({ clip }) => clip.id !== clipId && clip.flag !== "reject" && (clip.manual_order ?? 0) === order);
    }, [clips]);

    const handleUpdateMetadata = useCallback(async (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled'>>) => {
        const existingClip = clips.find((clipItem) => clipItem.clip.id === clipId)?.clip;
        if (!existingClip) return false;

        const manualOrder = updates.manual_order ?? existingClip.manual_order ?? 0;
        if (isShotPlannerActive && manualOrder > 0 && isManualOrderTaken(clipId, manualOrder)) {
            setManualOrderConflict({ clipId, nonce: Date.now() });
            return false;
        }

        const nextFlag = updates.flag ?? existingClip.flag;
        const shouldAutoSelect = isShotPlannerActive && nextFlag !== "reject" && (
            (typeof updates.manual_order === "number" && updates.manual_order > 0) ||
            (typeof updates.shot_size === "string" && updates.shot_size.trim().length > 0) ||
            (typeof updates.movement === "string" && updates.movement.trim().length > 0)
        );

        // Optimistic UI update
        setClips((prevClips) =>
            prevClips.map(clipItem => {
                if (clipItem.clip.id === clipId) {
                    return {
                        ...clipItem,
                        clip: { ...clipItem.clip, ...updates }
                    };
                }
                return clipItem;
            })
        );

        if (updates.flag === "reject") {
            setSelectedClipIds((prev) => {
                if (!prev.has(clipId)) return prev;
                const next = new Set(prev);
                next.delete(clipId);
                return next;
            });
        } else if (shouldAutoSelect) {
            setSelectedClipIds((prev) => {
                if (prev.has(clipId)) return prev;
                const next = new Set(prev);
                next.add(clipId);
                return next;
            });
        }

        try {
            await invoke("update_clip_metadata", {
                clipId,
                rating: updates.rating ?? null,
                flag: updates.flag ?? null,
                notes: updates.notes ?? null,
                shotSize: updates.shot_size ?? null,
                movement: updates.movement ?? null,
                manualOrder: updates.manual_order ?? null,
                lutEnabled: updates.lut_enabled ?? null,
            });
            if (updates.lut_enabled === 1 && projectId && projectLut) {
                await invoke("generate_lut_thumbnails", { projectId });
                setLutRenderNonce((n) => n + 1);
            }
            if (updates.lut_enabled === 0) {
                setLutRenderNonce((n) => n + 1);
            }
        } catch (err) {
            console.error("Failed to persist metadata:", err);
            setUiError({ title: "Could not save rating/flag", hint: "Retry. If this persists, export diagnostics from header actions." });
            return false;
        }
        return true;
    }, [clips, isManualOrderTaken, isShotPlannerActive, projectId, projectLut, setClips, setSelectedClipIds, setManualOrderConflict, setUiError, setLutRenderNonce]);

    const handleResetShotPlannerClip = useCallback(async (clipId: string) => {
        setSelectedClipIds((prev) => {
            if (!prev.has(clipId)) return prev;
            const next = new Set(prev);
            next.delete(clipId);
            return next;
        });
        await handleUpdateMetadata(clipId, {
            shot_size: "",
            movement: "",
            manual_order: 0,
            flag: "none",
        });
    }, [handleUpdateMetadata, setSelectedClipIds]);

    const handlePromoteClip = useCallback(async (clipId: string) => {
        try {
            await invoke("promote_clip_to_block", { projectId, clipId });
            if (projectId) {
                await refreshProjectClips(projectId);
            }
        } catch (error) {
            console.error("Failed to promote clip:", error);
            setUiError({ title: "Promotion Failed", hint: String(error) });
        }
    }, [projectId, refreshProjectClips, setUiError]);

    return {
        handleUpdateMetadata,
        handleResetShotPlannerClip,
        handlePromoteClip,
    };
}
