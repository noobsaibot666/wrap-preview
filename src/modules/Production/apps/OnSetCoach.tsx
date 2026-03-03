import React, { useState, useEffect } from 'react';
import {
    ArrowLeft,
    Activity,
    Target,
    Zap,
    Info,
    AlertTriangle,
    CheckCircle2,
    Shield,
    Camera
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ProductionProject, CameraProfile, RecommendedMode, ProductionCameraConfig, LookPreset, ProductionLookTarget } from '../../../types';

interface OnSetCoachProps {
    project: ProductionProject;
    onBack: () => void;
}

export const OnSetCoach: React.FC<OnSetCoachProps> = ({ project, onBack }) => {
    const [cameraConfig, setCameraConfig] = useState<ProductionCameraConfig | null>(null);
    const [cameraProfile, setCameraProfile] = useState<CameraProfile | null>(null);
    const [activeMode, setActiveMode] = useState<RecommendedMode | null>(null);
    const [lookPreset, setLookPreset] = useState<LookPreset | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [configs, target, profiles, presets] = await Promise.all([
                    invoke<ProductionCameraConfig[]>('list_production_camera_configs', { projectId: project.id }),
                    invoke<ProductionLookTarget | null>('get_production_look_target', { projectId: project.id }),
                    invoke<CameraProfile[]>('get_camera_profiles'),
                    invoke<LookPreset[]>('get_look_presets')
                ]);

                if (configs.length > 0) {
                    const config = configs.find(c => c.slot === "A") || configs[0];
                    setCameraConfig(config);
                    const profile = profiles.find(p => p.brand === config.brand && p.model === config.model);
                    if (profile) {
                        setCameraProfile(profile);
                        const mode = profile.recommended_modes.find(m => m.label === config.recording_mode);
                        if (mode) setActiveMode(mode);
                    }
                }

                if (target) {
                    const preset = presets.find(p => p.id === target.target_type);
                    if (preset) setLookPreset(preset);
                }
            } catch (err) {
                console.error("Failed to load On-Set Coach data:", err);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, [project.id]);

    // Design Tokens from index.css
    const statLabelStyle: React.CSSProperties = {
        fontSize: 'var(--inspector-label-size)',
        fontWeight: 'var(--inspector-label-weight)' as any,
        textTransform: 'uppercase',
        letterSpacing: 'var(--inspector-label-spacing)',
        color: 'var(--inspector-label-color)',
        marginBottom: '6px'
    };

    const valueStyle: React.CSSProperties = {
        fontSize: 'var(--inspector-value-size)',
        fontWeight: 'var(--inspector-value-weight)' as any,
        color: 'var(--text-primary)',
        letterSpacing: 'var(--inspector-value-spacing)'
    };

    const glassCardStyle: React.CSSProperties = {
        background: 'var(--inspector-bg)',
        border: 'var(--inspector-border)',
        borderRadius: '8px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column'
    };

    if (isLoading) {
        return (
            <div style={{ background: '#050505', height: '100vh', padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ height: '48px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', width: '30%' }} className="skeleton-pulse" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '40px' }}>
                    <div style={{ height: '500px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }} className="skeleton-pulse" />
                    <div style={{ height: '500px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }} className="skeleton-pulse" />
                    <div style={{ height: '500px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }} className="skeleton-pulse" />
                </div>
            </div>
        );
    }

    return (
        <div className="on-set-coach-view" style={{
            background: '#050505',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            fontFamily: 'var(--font-main)'
        }}>
            {/* Header: Synchronized with LookSetup */}
            <header style={{
                height: '48px',
                padding: '0 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(0,0,0,0.4)',
                backdropFilter: 'blur(20px)',
                zIndex: 100
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button onClick={onBack} style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'color 0.2s'
                    }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'} onMouseOut={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}>
                        <ArrowLeft size={18} strokeWidth={1.5} />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ fontSize: '0.75rem', fontWeight: 950, margin: 0, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.9)' }}>
                            ON-SET COACH
                        </h2>
                        <span style={{ fontSize: '0.55rem', fontWeight: 900, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.1em' }}>
                            LIVE GUIDANCE
                        </span>
                    </div>
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '32px' }}>
                    <div style={{ textAlign: 'right' }}>
                        <div style={statLabelStyle}>PROJECT</div>
                        <div style={valueStyle}>{project.name.toUpperCase()}</div>
                    </div>
                    <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.05)' }} />
                    <button style={{
                        background: 'var(--color-accent)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 16px',
                        fontSize: '0.65rem',
                        fontWeight: 900,
                        color: '#000',
                        cursor: 'pointer',
                        letterSpacing: '0.05em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <Shield size={12} strokeWidth={2.5} /> SYNC WAVEFORM
                    </button>
                </div>
            </header>

            {/* Main Content: Refined 3-Column Layout */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '40px' }}>
                <div style={{
                    maxWidth: '1280px',
                    margin: '0 auto',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(280px, 1fr) 2fr minmax(280px, 1fr)',
                    gap: '2px', // Thin separator lines
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    overflow: 'hidden'
                }}>

                    {/* COLUMN 1: HARDWARE ORIGIN */}
                    <div style={{ background: '#050505', padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                                <Camera size={14} color="rgba(255,255,255,0.4)" />
                                <h3 style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>SENSOR ORIGIN</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div>
                                    <div style={statLabelStyle}>ACTIVE BODY</div>
                                    <div style={{ ...valueStyle, fontSize: '1rem' }}>{cameraConfig ? `${cameraConfig.brand} ${cameraConfig.model}` : 'NOT SET'}</div>
                                </div>
                                <div>
                                    <div style={statLabelStyle}>BAY / SLOT</div>
                                    <div style={valueStyle}>SLOT A · DUAL-LINK</div>
                                </div>
                                <div>
                                    <div style={statLabelStyle}>LATITUDE</div>
                                    <div style={{ ...valueStyle, color: 'var(--color-accent)' }}>17.2 STOPS</div>
                                </div>
                                <div>
                                    <div style={statLabelStyle}>COLOR SPACE</div>
                                    <div style={valueStyle}>{cameraConfig?.brand === 'ARRI' ? 'AWG4 / LOGC4' : cameraConfig?.brand === 'RED' ? 'RWG / LOG3G10' : 'NATIVE LOG'}</div>
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: 'auto', padding: '20px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <Info size={14} color="var(--color-accent)" />
                                <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--color-accent)', letterSpacing: '0.05em' }}>SENSOR NOTE</span>
                            </div>
                            <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: 0, fontWeight: 500 }}>
                                {cameraProfile?.known_pitfalls[0] || "Maintain exposure consistency across takes."}
                            </p>
                        </div>
                    </div>

                    {/* COLUMN 2: EXPOSURE STRATEGY (Center Focus) */}
                    <div style={{ background: '#080808', padding: '32px', borderLeft: '1px solid rgba(255,255,255,0.05)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px' }}>
                            <Activity size={14} color="rgba(255,255,255,0.4)" />
                            <h3 style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>EXPOSURE STRATEGY</h3>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', padding: '1px' }}>
                            <div style={{ background: '#0a0a0a', padding: '32px' }}>
                                <div style={statLabelStyle}>LOG TARGET (NATIVE)</div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '12px' }}>
                                    <span style={{ fontSize: '3.5rem', fontWeight: 950, letterSpacing: '-0.05em', lineHeight: 1 }}>
                                        {activeMode?.skin_ire_targets['log'] || '--'}
                                    </span>
                                    <span style={{ fontSize: '1rem', fontWeight: 950, color: 'rgba(255,255,255,0.2)' }}>IRE</span>
                                </div>
                                <div style={{ marginTop: '16px', fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                    RAW SENSOR DATA
                                </div>
                            </div>
                            <div style={{ background: '#0a0a0a', padding: '32px' }}>
                                <div style={{ ...statLabelStyle, color: 'var(--color-accent)' }}>709 TARGET (PIPELINE)</div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '12px' }}>
                                    <span style={{ fontSize: '3.5rem', fontWeight: 950, letterSpacing: '-0.05em', lineHeight: 1, color: 'var(--color-accent)' }}>
                                        {activeMode?.skin_ire_targets['rec709'] || '--'}
                                    </span>
                                    <span style={{ fontSize: '1rem', fontWeight: 950, color: 'rgba(59, 130, 246, 0.2)' }}>IRE</span>
                                </div>
                                <div style={{ marginTop: '16px', fontSize: '0.65rem', fontWeight: 800, color: 'rgba(59, 130, 246, 0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                    {lookPreset?.name.toUpperCase() || 'DEFAULT'} PIPELINE
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '40px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <div style={statLabelStyle}>DYNAMIC RANGE ALLOCATION</div>
                                <Target size={12} opacity={0.3} />
                            </div>
                            <div style={{ height: '40px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
                                {/* Multi-color highlight protection scale */}
                                <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '40%', background: 'rgba(255,255,255,0.05)' }} />
                                <div style={{ position: 'absolute', top: 0, left: '40%', height: '100%', width: '45%', background: 'rgba(255,255,255,0.1)' }} />
                                <div style={{ position: 'absolute', top: 0, left: '85%', height: '100%', width: '15%', background: 'rgba(59, 130, 246, 0.3)' }} />

                                {/* Target indicators */}
                                <div style={{ position: 'absolute', top: 0, left: `${activeMode?.skin_ire_targets['log']}%`, height: '100%', width: '2px', background: '#fff', zIndex: 5 }}>
                                    <div style={{ position: 'absolute', top: '-15px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.5rem', fontWeight: 950 }}>SKIN</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '0.55rem', fontWeight: 900, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
                                <span>SHADOWS</span>
                                <span>NEUTRAL</span>
                                <span style={{ color: 'var(--color-accent)' }}>HIGHLIGHTS</span>
                            </div>
                        </div>

                        <div style={{ marginTop: '40px', padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dotted rgba(255,255,255,0.1)' }}>
                            <div style={{ ...statLabelStyle, marginBottom: '12px' }}>QUICK GUIDANCE</div>
                            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                                {activeMode?.highlight_limit_guidance || "Adjust exposure until target values are reached on external waveform."}
                            </p>
                        </div>
                    </div>

                    {/* COLUMN 3: PROTECTION & VERIFICATION */}
                    <div style={{ background: '#050505', padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                                <Shield size={14} color="rgba(255,255,255,0.4)" />
                                <h3 style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>VERIFICATION</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ ...glassCardStyle, background: 'rgba(16, 185, 129, 0.03)', borderColor: 'rgba(16, 185, 129, 0.1)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <CheckCircle2 size={14} color="#10b981" />
                                        <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#10b981', letterSpacing: '0.1em' }}>CHECKLIST</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>BASE ISO: {activeMode?.base_iso[0] || '---'}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>SHUTTER: 180.0°</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>OETF: {activeMode?.label || 'LOG'}</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ ...glassCardStyle, background: 'rgba(245, 158, 11, 0.03)', borderColor: 'rgba(245, 158, 11, 0.1)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <AlertTriangle size={14} color="#f59e0b" />
                                        <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#f59e0b', letterSpacing: '0.1em' }}>PITFALLS</span>
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, margin: 0, fontWeight: 500 }}>
                                        Watch for sensor noise in underexposed regions when shooting at higher ambient temps.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: 'auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', opacity: 0.3 }}>
                                <Zap size={14} />
                                <span style={{ fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.1em' }}>LIVE SYNC</span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', fontWeight: 800, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px' }}>
                                WAITING FOR WAVEFORM SIGNAL...
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Sticky Action Footer */}
            <footer style={{
                height: '40px',
                padding: '0 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(0,0,0,0.2)',
                fontSize: '0.6rem',
                color: 'rgba(255,255,255,0.3)',
                fontWeight: 800,
                letterSpacing: '0.05em'
            }}>
                <div style={{ display: 'flex', gap: '24px' }}>
                    <span>SESSION: {new Date().toLocaleTimeString()}</span>
                    <span>CONNECTION: STABLE</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <span>PRO MODULE V1.0</span>
                    <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
                </div>
            </footer>
        </div>
    );
};
