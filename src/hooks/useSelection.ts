import { useCallback } from "react";
import { ClipWithThumbnails } from "../types";

export function useSelection(
    clips: ClipWithThumbnails[],
    selectedClipIds: Set<string>,
    setSelectedClipIds: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void
) {
    const toggleClipSelection = useCallback((id: string) => {
        setSelectedClipIds((prev) => {
            const clip = clips.find((c) => c.clip.id === id)?.clip;
            if (!clip || clip.flag === "reject") return prev;
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, [clips, setSelectedClipIds]);

    const toggleSelectAll = useCallback((selectableClipIds: string[]) => {
        const selectedSelectableCount = selectableClipIds.filter((id) => selectedClipIds.has(id)).length;
        if (selectedSelectableCount === selectableClipIds.length) {
            setSelectedClipIds(new Set());
        } else {
            setSelectedClipIds(new Set(selectableClipIds));
        }
    }, [selectedClipIds, setSelectedClipIds]);

    return {
        toggleClipSelection,
        toggleSelectAll,
    };
}
