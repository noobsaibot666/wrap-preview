export type LookbookSortMode = "canonical" | "custom" | "hook_first";

export const SHOT_SIZE_CANONICAL = ["EWS/ELS", "WS/LS", "FS", "MS", "MCU", "CU", "ECU", "Detail/Insert"];
export const SHOT_SIZE_HOOK_FIRST = ["Detail/Insert", "ECU", "CU", "MCU", "MS", "FS", "WS/LS", "EWS/ELS"];
export const SHOT_SIZE_OPTIONAL = ["American/Cowboy"];
export const MOVEMENT_CANONICAL = ["Static/Locked", "Handheld", "Gimbal follow", "Push-in", "Pull-out", "Pan", "Tilt", "Slide/Truck", "Arc/Orbit", "Crane/Jib", "Zoom in", "Zoom out"];

export function sortLookbookClips(clips: any[], mode: LookbookSortMode) {
    const ordered = [...clips];
    if (mode === "custom") {
        return ordered.sort((a, b) => {
            const aClip = a.clip ?? a;
            const bClip = b.clip ?? b;
            const aVal = aClip.manual_order || 0;
            const bVal = bClip.manual_order || 0;
            // 0 means unassigned, should go to the end
            if (aVal !== bVal) {
                if (aVal === 0) return 1;
                if (bVal === 0) return -1;
                return aVal - bVal;
            }
            return aClip.filename.localeCompare(bClip.filename);
        });
    }
    const shotOrder = mode === "hook_first" ? SHOT_SIZE_HOOK_FIRST : SHOT_SIZE_CANONICAL;
    return ordered.sort((a, b) => {
        const aClip = a.clip ?? a;
        const bClip = b.clip ?? b;
        const aShot = shotOrder.indexOf(aClip.shot_size || ""), bShot = shotOrder.indexOf(bClip.shot_size || "");
        if (aShot !== bShot) return (aShot === -1 ? 99 : aShot) - (bShot === -1 ? 99 : bShot);
        const aMove = MOVEMENT_CANONICAL.indexOf(aClip.movement || ""), bMove = MOVEMENT_CANONICAL.indexOf(bClip.movement || "");
        if (aMove !== bMove) return (aMove === -1 ? 99 : aMove) - (bMove === -1 ? 99 : bMove);
        return String(aClip.created_at || "").localeCompare(String(bClip.created_at || "")) || aClip.filename.localeCompare(bClip.filename);
    });
}
