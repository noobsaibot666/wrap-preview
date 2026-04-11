import React from 'react';

interface WaveformProps {
    envelope: number[]; // Array of 0-255 values
    color?: string;
    height?: number;
    width?: string;
    onPlayToggle?: () => void;
    isPlaying?: boolean;
    progress?: number; // 0 to 100
}

export const Waveform: React.FC<WaveformProps> = ({
    envelope,
    color = "var(--color-accent-indigo, var(--color-accent))",
    height = 36,
    width = "100%",
    onPlayToggle,
    isPlaying = false,
    progress = 0
}) => {
    const id = React.useId();
    const gradientId = `waveform-gradient-${id.replace(/:/g, '')}`;

    if (!envelope || envelope.length === 0) return null;

    // Calculate points for the SVG polyline/path
    const barCount = envelope.length;
    const gap = 0.5;
    const barWidth = (100 - (barCount - 1) * gap) / barCount;

    return (
        <div className="waveform-outer">
            <div className="waveform-container" style={{ width, height, position: 'relative' }}>
                <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{ width: '100%', height: '100%', display: 'block' }}
                >
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="1" />
                            <stop offset="50%" stopColor={color} stopOpacity="0.6" />
                            <stop offset="100%" stopColor={color} stopOpacity="1" />
                        </linearGradient>
                    </defs>

                    {envelope.map((val, i) => {
                        const h = (val / 255) * 85; // Max 85% height for symmetry
                        const x = i * (barWidth + gap);
                        const isPlayed = (i / barCount) * 100 < progress;
                        return (
                            <rect
                                key={i}
                                x={x}
                                y={50 - h / 2}
                                width={barWidth}
                                height={Math.max(2, h)}
                                fill={isPlayed ? color : "rgba(255,255,255,0.12)"}
                                rx={barWidth / 2}
                            />
                        );
                    })}

                    {/* Playhead line */}
                    {progress > 0 && progress < 100 && (
                        <line
                            x1={progress}
                            y1="0"
                            x2={progress}
                            y2="100"
                            stroke="white"
                            strokeWidth="1"
                            style={{ opacity: 0.8 }}
                            vectorEffect="non-scaling-stroke"
                        />
                    )}
                </svg>
            </div>

            {onPlayToggle && (
                <button
                    className={`waveform-play-btn ${isPlaying ? 'playing' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPlayToggle();
                    }}
                    title={isPlaying ? "Pause audio" : "Play audio preview"}
                >
                    {isPlaying ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    )}
                </button>
            )}
        </div>
    );
};
