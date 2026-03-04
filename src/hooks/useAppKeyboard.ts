import { useEffect, useRef, useCallback } from "react";
import { ClipWithThumbnails } from "../types";

interface UseAppKeyboardProps {
    shotPlannerStateRef: React.MutableRefObject<any>;
    reviewStateRef: React.MutableRefObject<any>;
    setManualOrderConflict: (val: { clipId: string; nonce: number } | null) => void;
}

export function useAppKeyboard({
    shotPlannerStateRef,
    reviewStateRef,
    setManualOrderConflict,
}: UseAppKeyboardProps) {
    const manualOrderBufferRef = useRef("");
    const manualOrderTimerRef = useRef<number | null>(null);
    const rejectKeyTimeoutRef = useRef<number | null>(null);
    const lastRejectKeyAtRef = useRef(0);

    const clearManualOrderBuffer = useCallback(() => {
        manualOrderBufferRef.current = "";
        setManualOrderConflict(null);
    }, [setManualOrderConflict]);

    const commitBufferedManualOrder = useCallback(async () => {
        const state = shotPlannerStateRef.current;
        if (!state) return;
        const targetId = state.hoveredClipId;
        const buffer = manualOrderBufferRef.current;
        if (!targetId || !buffer || state.effectiveLookbookSortMode !== "custom") return;
        const order = Number(buffer);
        if (!Number.isFinite(order) || order <= 0) return;
        const ok = await state.handleUpdateMetadata(targetId, { manual_order: order });
        if (ok) {
            clearManualOrderBuffer();
        }
    }, [shotPlannerStateRef, clearManualOrderBuffer]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const state = shotPlannerStateRef.current;
            const reviewState = reviewStateRef.current;
            if (!state?.active && !reviewState?.active) return;
            if (state?.active && state.tourRun) return;

            const activeState = state?.active ? state : reviewState;
            const targetId = activeState?.hoveredClipId;
            const isCtrl = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            // Basic bypass for inputs
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (activeState?.active && key === "p" && isCtrl) {
                e.preventDefault();
                activeState.requestExport("pdf");
                return;
            }
            if (activeState?.active && key === "i" && !isCtrl) {
                e.preventDefault();
                activeState.requestExport("image");
                return;
            }
            if (state?.active && key === "m" && !isCtrl) {
                e.preventDefault();
                state.setLookbookSortMode("custom");
                return;
            }
            if (state?.active && key === "c" && !isCtrl) {
                e.preventDefault();
                clearManualOrderBuffer();
                state.setLookbookSortMode("canonical");
                return;
            }
            if ((key === "arrowdown" || key === "arrowup") && activeState?.sortedClips.length > 0) {
                if (state?.active && manualOrderBufferRef.current) {
                    void commitBufferedManualOrder();
                }
                const currentIndex = targetId ? activeState.sortedClips.findIndex((c: ClipWithThumbnails) => c.clip.id === targetId) : -1;
                const nextIndex = key === "arrowdown"
                    ? Math.min(currentIndex + 1, activeState.sortedClips.length - 1)
                    : Math.max(currentIndex - 1, 0);

                if (activeState.sortedClips[nextIndex] && activeState.sortedClips[nextIndex].clip.id !== targetId) {
                    e.preventDefault();
                    activeState.focusClip(activeState.sortedClips[nextIndex].clip.id, { scrollIntoView: true });
                }
                return;
            }
            if (!targetId) return;
            if (reviewState?.active && key >= "0" && key <= "5" && !isCtrl) {
                e.preventDefault();
                void reviewState.handleUpdateMetadata(targetId, { rating: Number(key) });
                return;
            }
            if (reviewState?.active && key === "l" && !isCtrl && reviewState.projectLutHash) {
                e.preventDefault();
                const clip = reviewState.clips.find((entry: ClipWithThumbnails) => entry.clip.id === targetId)?.clip;
                if (clip) {
                    void reviewState.handleUpdateMetadata(targetId, { lut_enabled: clip.lut_enabled === 1 ? 0 : 1 });
                }
                return;
            }
            if (key === "r") {
                e.preventDefault();
                const now = Date.now();
                if (now - lastRejectKeyAtRef.current <= 300) {
                    if (rejectKeyTimeoutRef.current !== null) {
                        window.clearTimeout(rejectKeyTimeoutRef.current);
                        rejectKeyTimeoutRef.current = null;
                    }
                    lastRejectKeyAtRef.current = 0;
                    void state?.handleResetShotPlannerClip(targetId);
                    return;
                }
                lastRejectKeyAtRef.current = now;
                rejectKeyTimeoutRef.current = window.setTimeout(() => {
                    const latestState = shotPlannerStateRef.current?.active ? shotPlannerStateRef.current : reviewStateRef.current;
                    const clip = latestState?.clips.find((entry: ClipWithThumbnails) => entry.clip.id === targetId)?.clip;
                    if (clip) {
                        void latestState.handleUpdateMetadata(targetId, { flag: clip.flag === "reject" ? "none" : "reject" });
                    }
                    rejectKeyTimeoutRef.current = null;
                }, 300);
                return;
            }
            if (key === "s" && !isCtrl) {
                e.preventDefault();
                activeState.toggleClipSelection(targetId);
                return;
            }
            if (state?.active && state.effectiveLookbookSortMode === "custom" && key >= "0" && key <= "9" && !isCtrl) {
                e.preventDefault();
                manualOrderBufferRef.current = `${manualOrderBufferRef.current}${key}`.replace(/^0+/, "");
                if (manualOrderTimerRef.current !== null) {
                    window.clearTimeout(manualOrderTimerRef.current);
                }
                manualOrderTimerRef.current = window.setTimeout(() => {
                    void commitBufferedManualOrder();
                }, 200);
                return;
            }
            if (state?.active && key === "enter" && manualOrderBufferRef.current) {
                e.preventDefault();
                void commitBufferedManualOrder();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            if (manualOrderTimerRef.current !== null) {
                window.clearTimeout(manualOrderTimerRef.current);
                manualOrderTimerRef.current = null;
            }
            if (rejectKeyTimeoutRef.current !== null) {
                window.clearTimeout(rejectKeyTimeoutRef.current);
                rejectKeyTimeoutRef.current = null;
            }
        };
    }, [shotPlannerStateRef, reviewStateRef, commitBufferedManualOrder, clearManualOrderBuffer]);

    return {
        clearManualOrderBuffer,
    };
}
