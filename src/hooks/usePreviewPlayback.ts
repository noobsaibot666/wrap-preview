import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClipWithThumbnails } from "../types";

export function usePreviewPlayback(clips: ClipWithThumbnails[]) {
    const [playingClipId, setPlayingClipId] = useState<string | null>(null);
    const [playingProgress, setPlayingProgress] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioPreviewClipIdRef = useRef<string | null>(null);

    const clearAudioPreview = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute("src");
            audioRef.current.load();
            audioRef.current = null;
        }
        audioPreviewClipIdRef.current = null;
    }, []);

    const handlePlayClip = useCallback(async (id: string | null) => {
        if (!id) {
            clearAudioPreview();
            setPlayingClipId(null);
            setPlayingProgress(0);
            return;
        }

        if (playingClipId === id && audioRef.current && audioPreviewClipIdRef.current === id) {
            audioRef.current.pause();
            setPlayingClipId(null);
            return;
        }

        if (!playingClipId && audioRef.current && audioPreviewClipIdRef.current === id) {
            try {
                setPlayingClipId(id);
                await audioRef.current.play();
            } catch (err) {
                console.error("Failed to resume audio:", err);
                clearAudioPreview();
                setPlayingClipId(null);
                setPlayingProgress(0);
            }
            return;
        }

        const clipMatch = clips.find(c => c.clip.id === id);
        const clip = clipMatch?.clip;
        if (!clip) return;

        clearAudioPreview();

        try {
            const src = await invoke<string>("read_audio_preview", { path: clip.file_path });
            const audio = new Audio();
            audio.onended = () => {
                clearAudioPreview();
                setPlayingClipId(null);
                setPlayingProgress(0);
            };
            audio.ontimeupdate = () => {
                if (audio.duration) {
                    setPlayingProgress((audio.currentTime / audio.duration) * 100);
                }
            };
            audio.onerror = (e) => {
                console.error("Audio playback error", e);
                clearAudioPreview();
                setPlayingClipId(null);
                setPlayingProgress(0);
            };
            audio.src = src;
            audio.load();
            audioRef.current = audio;
            audioPreviewClipIdRef.current = id;
            setPlayingClipId(id);
            await audio.play();
        } catch (err) {
            console.error("Failed to play audio:", err);
            clearAudioPreview();
            setPlayingClipId(null);
            setPlayingProgress(0);
        }
    }, [playingClipId, clips, clearAudioPreview]);

    return {
        playingClipId,
        playingProgress,
        handlePlayClip,
        clearAudioPreview,
        setPlayingClipId,
    };
}
