import { useState, useCallback, useMemo } from 'react';
import { FramePreviewMedia, FramePreviewState, RatioType, FrameTransform, INITIAL_TRANSFORM } from '../../types/framePreview';

export function useFramePreview() {
    const [state, setState] = useState<FramePreviewState>({
        mediaList: [],
        activeMediaId: null,
        selectedMediaIds: new Set(),
        activeRatio: '16:9',
        visibleRatios: ['16:9'],
        frameTransforms: {
            '16:9': { ...INITIAL_TRANSFORM }
        }
    });

    const activeMedia = useMemo(() => 
        state.mediaList.find(m => m.id === state.activeMediaId) || null
    , [state.mediaList, state.activeMediaId]);

    const setMediaList = useCallback((media: FramePreviewMedia[]) => {
        setState(prev => ({
            ...prev,
            mediaList: media,
            activeMediaId: prev.activeMediaId || (media.length > 0 ? media[0].id : null)
        }));
    }, []);

    const setActiveMedia = useCallback((id: string) => {
        setState(prev => ({ ...prev, activeMediaId: id }));
    }, []);

    const toggleMediaSelection = useCallback((id: string, multi: boolean) => {
        setState(prev => {
            const next = new Set(prev.selectedMediaIds);
            if (multi) {
                if (next.has(id)) next.delete(id);
                else next.add(id);
            } else {
                next.clear();
                next.add(id);
            }
            return { ...prev, selectedMediaIds: next };
        });
    }, []);

    const updateTransform = useCallback((ratio: RatioType, updates: Partial<FrameTransform>) => {
        setState(prev => {
            const current = prev.frameTransforms[ratio] || { ...INITIAL_TRANSFORM };
            return {
                ...prev,
                frameTransforms: {
                    ...prev.frameTransforms,
                    [ratio]: { ...current, ...updates }
                }
            };
        });
    }, []);

    const toggleRatio = useCallback((ratio: RatioType) => {
        setState(prev => {
            const isVisible = prev.visibleRatios.includes(ratio);
            let nextVisible = [...prev.visibleRatios];
            
            if (isVisible) {
                if (nextVisible.length > 1) {
                    nextVisible = nextVisible.filter(r => r !== ratio);
                }
            } else {
                if (nextVisible.length < 4) {
                    nextVisible.push(ratio);
                }
            }

            const nextActive = nextVisible.includes(prev.activeRatio) 
                ? prev.activeRatio 
                : nextVisible[0];

            // Initialize transform if new
            const nextTransforms = { ...prev.frameTransforms };
            if (!nextTransforms[ratio]) {
                nextTransforms[ratio] = { ...INITIAL_TRANSFORM };
            }

            return {
                ...prev,
                visibleRatios: nextVisible,
                activeRatio: nextActive,
                frameTransforms: nextTransforms
            };
        });
    }, []);

    const setActiveRatio = useCallback((ratio: RatioType) => {
        setState(prev => ({ ...prev, activeRatio: ratio }));
    }, []);

    const resetTransform = useCallback((ratio: RatioType) => {
        updateTransform(ratio, INITIAL_TRANSFORM);
    }, [updateTransform]);

    return {
        state,
        activeMedia,
        setMediaList,
        setActiveMedia,
        toggleMediaSelection,
        updateTransform,
        toggleRatio,
        setActiveRatio,
        resetTransform
    };
}
