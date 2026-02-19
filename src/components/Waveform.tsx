import React from 'react';

interface WaveformProps {
    envelope: number[]; // Array of 0-255 values
    color?: string;
    height?: number;
    width?: string;
}

export const Waveform: React.FC<WaveformProps> = ({
    envelope,
    color = "var(--accent)",
    height = 32,
    width = "100%"
}) => {
    if (!envelope || envelope.length === 0) return null;

    // Calculate points for the SVG polyline/path
    // Using a path for a smooth bottom-aligned sparkline
    const points = envelope.map((val, i) => {
        const x = (i / (envelope.length - 1)) * 100;
        const y = 100 - (val / 255) * 100; // Invert and normalize to 0-100
        return `${x},${y}`;
    }).join(' ');

    // Create a fill path by adding corners to the points
    const fillPath = `0,100 ${points} 100,100`;

    return (
        <div className="waveform-container" style={{ width, height, position: 'relative' }}>
            <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ width: '100%', height: '100%', display: 'block' }}
            >
                <defs>
                    <linearGradient id="waveform-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.8" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.1" />
                    </linearGradient>
                </defs>

                {/* Fill */}
                <polyline
                    points={fillPath}
                    fill="url(#waveform-gradient)"
                    stroke="none"
                />

                {/* Stroke */}
                <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
            </svg>
        </div>
    );
};
