import React, { useMemo } from "react";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Maximize,
    Settings,
    Camera,
    AlertCircle,
} from "lucide-react";
import { CommonAsset, CommonVersion } from "./types";
import { formatDuration, formatTimecode } from "./utils";

interface ReviewPlayerProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    videoStageRef: React.RefObject<HTMLDivElement | null>;
    asset: CommonAsset | null;
    version: CommonVersion | null;
    currentTime: number;
    duration: number;
    mediaReadyStatus: "idle" | "processing" | "finalizing" | "ready" | "failed";
    grabbingFrame: boolean;
    onSeek: (seconds: number) => void;
    onGrabFrame: () => void;
    onTogglePlay: () => void;
    isPaused: boolean;
    onShowSettings: () => void;
    overlay?: React.ReactNode;
}

export const ReviewPlayer: React.FC<ReviewPlayerProps> = ({
    videoRef,
    videoStageRef,
    asset,
    version,
    currentTime,
    duration,
    mediaReadyStatus,
    grabbingFrame,
    onSeek,
    onGrabFrame,
    onTogglePlay,
    isPaused,
    onShowSettings,
    overlay,
}) => {
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const statusLabel = useMemo(() => {
        switch (mediaReadyStatus) {
            case "processing": return "Processing proxy...";
            case "finalizing": return "Finalizing media...";
            case "failed": return "Media generation failed";
            default: return null;
        }
    }, [mediaReadyStatus]);

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-black/40 relative overflow-hidden">
            {/* Video Content Area */}
            <div
                ref={videoStageRef}
                className="flex-1 relative flex items-center justify-center overflow-hidden bg-black select-none pointer-events-auto"
            >
                <video
                    ref={videoRef}
                    className="max-w-full max-h-full block outline-none ring-0 shadow-2xl"
                    playsInline
                    crossOrigin="anonymous"
                    onClick={onTogglePlay}
                />

                {/* Overlays (Annotations, Onion Skin, etc) */}
                {overlay}

                {/* Status Overlay */}
                {statusLabel && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
                        <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                            {mediaReadyStatus === "failed" ? (
                                <AlertCircle className="w-10 h-10 text-red-500 mb-2" />
                            ) : (
                                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-2" />
                            )}
                            <h3 className="text-lg font-medium tracking-tight">{statusLabel}</h3>
                            {version?.processing_status === "processing" && (
                                <p className="text-sm text-white/50">
                                    This might take a few minutes depending on your hardware.
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Playback Controls */}
            <div className="bg-[#0a0a0a]/90 border-t border-white/5 px-4 pt-3 pb-4 backdrop-blur-xl shrink-0">
                {/* Timeline */}
                <div className="relative group mb-3">
                    <div className="h-1.5 w-full bg-white/10 rounded-full cursor-pointer relative overflow-hidden transition-all group-hover:h-2">
                        <div
                            className="absolute left-0 top-0 bottom-0 bg-white/60 rounded-full z-10"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step={0.01}
                        value={currentTime}
                        onChange={(e) => onSeek(parseFloat(e.target.value))}
                        className="absolute -inset-y-1 w-full opacity-0 cursor-pointer z-20"
                    />
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => onSeek(Math.max(0, currentTime - 5))}
                            className="p-1.5 text-white/40 hover:text-white transition-colors"
                            title="Back 5s"
                        >
                            <SkipBack className="w-5 h-5" />
                        </button>
                        <button
                            onClick={onTogglePlay}
                            className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 active:scale-95 transition-all shadow-lg"
                        >
                            {isPaused ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
                        </button>
                        <button
                            onClick={() => onSeek(Math.min(duration, currentTime + 5))}
                            className="p-1.5 text-white/40 hover:text-white transition-colors"
                            title="Forward 5s"
                        >
                            <SkipForward className="w-5 h-5" />
                        </button>

                        <div className="ml-2 font-mono text-sm tracking-tight">
                            <span className="text-white/90">{formatTimecode(currentTime, asset as any)}</span>
                            <span className="text-white/30 mx-1">/</span>
                            <span className="text-white/40">{formatDuration(duration * 1000)}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onGrabFrame}
                            disabled={grabbingFrame || mediaReadyStatus !== "ready"}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-lg text-xs font-medium transition-all"
                            title="Save current frame as reference"
                        >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Snapshot</span>
                        </button>

                        <div className="h-4 w-[1px] bg-white/10 mx-1" />

                        <button
                            onClick={onShowSettings}
                            className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                        >
                            <Settings className="w-5 h-5" />
                        </button>
                        <button className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                            <Maximize className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
