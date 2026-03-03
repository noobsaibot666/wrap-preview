import React, { useState, useEffect } from 'react';
import {
    ArrowLeft,
    Shield,
    Camera,
    Settings2,
    ImageIcon,
    Check,
    ChevronRight,
    Info,
    Maximize2,
    Activity,
    Target
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface ProductionProject {
    id: string;
    name: string;
}

interface CameraProfile {
    brand: string;
    model: string;
    sensor_type: string;
    recommended_modes: RecommendedMode[];
    known_pitfalls: string[];
}

interface RecommendedMode {
    label: string;
    base_iso: number[];
    wb_notes: string;
    highlight_limit_guidance: string;
    skin_ire_targets: Record<string, number>;
    sharpening_nr_defaults: string;
}

interface LookPreset {
    id: string;
    name: string;
    description: string;
}

interface LookSetupProps {
    project: ProductionProject;
    onBack: () => void;
}

const LookSetup: React.FC<LookSetupProps> = ({ project, onBack }) => {
    const [cameraProfiles, setCameraProfiles] = useState<CameraProfile[]>([]);
    const [lookPresets, setLookPresets] = useState<LookPreset[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [selectedProfile, setSelectedProfile] = useState<CameraProfile | null>(null);
    const [selectedMode, setSelectedMode] = useState<RecommendedMode | null>(null);
    const [selectedLookId, setSelectedLookId] = useState<string>('master-natural');

    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                const [profiles, presets] = await Promise.all([
                    invoke<CameraProfile[]>('get_camera_profiles'),
                    invoke<LookPreset[]>('get_look_presets')
                ]);
                setCameraProfiles(profiles);
                setLookPresets(presets);
                if (profiles.length > 0) {
                    setSelectedProfile(profiles[0]);
                    if (profiles[0].recommended_modes.length > 0) {
                        setSelectedMode(profiles[0].recommended_modes[0]);
                    }
                }
            } catch (error) {
                console.error("Failed to load Production data:", error);
            } finally {
                // Keep skeleton visible for at least 800ms for premium feel
                setTimeout(() => setIsLoading(false), 800);
            }
        };
        loadData();
    }, []);

    // Design Tokens (Statics)
    const statLabelStyle = {
        fontSize: 'var(--inspector-label-size)',
        fontWeight: 'var(--inspector-label-weight)' as any,
        color: 'var(--inspector-label-color)',
        letterSpacing: 'var(--inspector-label-spacing)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '8px',
        textTransform: 'uppercase' as any
    };

    const glassCardStyle = {
        background: 'var(--inspector-bg)',
        border: '1px solid var(--inspector-border)',
        borderRadius: '8px',
        padding: '20px',
        backdropFilter: 'blur(var(--inspector-glass-blur))'
    };

    const btnStyle = (active: boolean) => ({
        padding: '10px 16px',
        background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
        border: active ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.05)',
        borderRadius: '6px',
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        fontSize: '0.7rem',
        fontWeight: active ? 700 : 500,
        textAlign: 'left' as any,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        transition: 'all 0.2s ease'
    });

    if (isLoading) {
        return (
            <div style={{ background: '#090909', height: '100vh', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '48px', background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
                    <div className="skeleton-pulse" style={{ width: '120px', height: '14px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
                </div>
                <div style={{ flex: 1, padding: '40px', display: 'flex', gap: '24px' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div className="skeleton-pulse" style={{ width: '100%', height: '300px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                            <div className="skeleton-pulse" style={{ height: '200px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }} />
                            <div className="skeleton-pulse" style={{ height: '200px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }} />
                            <div className="skeleton-pulse" style={{ height: '200px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }} />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="look-setup-viewer" style={{
            background: '#090909',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            color: 'var(--text-primary)',
            overflow: 'hidden'
        }}>
            {/* Universal Header */}
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
                        justifyContent: 'center'
                    }}>
                        <ArrowLeft size={18} strokeWidth={1.5} />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ fontSize: '0.75rem', fontWeight: 950, margin: 0, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.9)' }}>
                            LOOK SETUP
                        </h2>
                        <span style={{ fontSize: '0.55rem', fontWeight: 900, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.1em' }}>
                            PROD • {project.name.toUpperCase()}
                        </span>
                    </div>
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '32px' }}>
                    <div style={{ textAlign: 'right' }}>
                        <div style={statLabelStyle}>PROJECT</div>
                        <div style={{
                            fontSize: 'var(--inspector-value-size)',
                            fontWeight: 'var(--inspector-value-weight)' as any,
                            color: 'var(--text-primary)',
                            letterSpacing: 'var(--inspector-value-spacing)'
                        }}>{project.name.toUpperCase()}</div>
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
                        <Shield size={12} strokeWidth={2.5} /> SYNC LOOK
                    </button>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                {/* 1. HERO CREATIVE REFERENCE - CENTERED */}
                <section style={{
                    padding: '32px 40px',
                    background: 'rgba(255,255,255,0.01)',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <div style={{ maxWidth: '1440px', width: '100%', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                            <label style={{ ...statLabelStyle, marginBottom: 0 }}><ImageIcon size={12} /> CREATIVE INTENT PREVIEW</label>
                        </div>
                        <div style={{
                            aspectRatio: '21/9',
                            maxHeight: '380px',
                            width: '100%',
                            background: '#000',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            overflow: 'hidden',
                            boxShadow: '0 30px 60px -12px rgba(0,0,0,0.5)'
                        }}>
                            <div style={{ textAlign: 'center', opacity: 0.2 }}>
                                <ImageIcon size={48} strokeWidth={1} style={{ marginBottom: '12px' }} />
                                <p style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em' }}>BUFFERING MASTER REFERENCE...</p>
                            </div>
                            <div style={{
                                position: 'absolute',
                                bottom: '16px',
                                right: '16px',
                                background: 'rgba(0,0,0,0.6)',
                                padding: '6px 10px',
                                borderRadius: '4px',
                                fontSize: '0.55rem',
                                fontWeight: 900,
                                backdropFilter: 'blur(10px)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                color: 'rgba(255,255,255,0.6)',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                                <Maximize2 size={10} /> FULLSCREEN
                            </div>
                        </div>
                    </div>
                </section>

                {/* 2. TECHNICAL DATA BLOCK - ORGANIZED SEQUENTIALLY */}
                <main style={{
                    padding: '32px 40px',
                    maxWidth: '1440px',
                    width: '100%',
                    margin: '0 auto',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(250px, 1fr) minmax(300px, 1.2fr) minmax(320px, 1.3fr)',
                    gap: '24px'
                }}>
                    {/* COLUMN 1: SENSOR ORIGIN */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <section>
                            <label style={statLabelStyle}><Camera size={12} /> SENSOR ORIGIN</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {cameraProfiles.map(p => (
                                    <button
                                        key={p.model}
                                        onClick={() => { setSelectedProfile(p); if (p.recommended_modes.length) setSelectedMode(p.recommended_modes[0]); }}
                                        style={btnStyle(selectedProfile?.model === p.model)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '0.55rem', opacity: 0.5, fontWeight: 900 }}>{p.brand}</span>
                                            <span>{p.model}</span>
                                        </div>
                                        {selectedProfile?.model === p.model && <Check size={12} color="var(--color-accent)" />}
                                    </button>
                                ))}
                            </div>
                        </section>

                        {selectedProfile && (
                            <section>
                                <label style={statLabelStyle}><Settings2 size={12} /> RECORDING LOGIC</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {selectedProfile.recommended_modes.map(m => (
                                        <button
                                            key={m.label}
                                            onClick={() => setSelectedMode(m)}
                                            style={{
                                                ...btnStyle(selectedMode?.label === m.label),
                                                background: 'transparent',
                                                border: 'none'
                                            }}
                                        >
                                            <span style={{ fontSize: '0.7rem', opacity: selectedMode?.label === m.label ? 1 : 0.6 }}>{m.label}</span>
                                            {selectedMode?.label === m.label && <ChevronRight size={10} />}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>

                    {/* COLUMN 2: TECHNICAL STRATEGY (INFOS ON TOP) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {selectedMode ? (
                            <>
                                <section>
                                    <label style={statLabelStyle}><Shield size={12} /> EXPOSURE STRATEGY</label>
                                    <div style={{ ...glassCardStyle }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                            <span style={{ fontSize: '0.5rem', fontWeight: 900, opacity: 0.4 }}>TARGET SKIN TONE</span>
                                            <span style={{ fontSize: '0.5rem', fontWeight: 900, color: 'var(--color-accent)' }}>{selectedMode.skin_ire_targets['rec709'] || 0} IRE RE.709</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
                                            <span style={{ fontSize: '2.4rem', fontWeight: 900, letterSpacing: '-0.04em' }}>{selectedMode.skin_ire_targets['log'] || 0}</span>
                                            <span style={{ fontSize: '0.7rem', fontWeight: 800, opacity: 0.5 }}>IRE (LOG)</span>
                                        </div>
                                        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                                <span style={{ fontSize: '0.5rem', fontWeight: 800, opacity: 0.3 }}>BASE ISO</span>
                                                <div style={{ fontSize: '1rem', fontWeight: 900 }}>{selectedMode.base_iso[0]}</div>
                                            </div>
                                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                                <span style={{ fontSize: '0.5rem', fontWeight: 800, opacity: 0.3 }}>LATITUDE</span>
                                                <div style={{ fontSize: '1rem', fontWeight: 900 }}>17.2 EL</div>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <label style={statLabelStyle}><Activity size={12} /> PROTECTION SCHEME</label>
                                    <div style={{ ...glassCardStyle }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 800, lineHeight: 1.4, marginBottom: '12px' }}>
                                            {selectedMode.highlight_limit_guidance}
                                        </div>
                                        <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                                            {[...Array(15)].map((_, i) => (
                                                <div key={i} style={{ flex: 1, height: '100%', background: i > 12 ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)', borderRight: '1px solid #000' }} />
                                            ))}
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <div style={{ ...glassCardStyle, background: 'rgba(59, 130, 246, 0.03)', border: '1px solid rgba(59, 130, 246, 0.1)', display: 'flex', gap: '12px', padding: '12px' }}>
                                        <Info size={14} color="var(--color-accent)" style={{ flexShrink: 0 }} />
                                        <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.5, fontWeight: 500 }}>
                                            {selectedProfile?.known_pitfalls[0]}
                                        </p>
                                    </div>
                                </section>
                            </>
                        ) : (
                            <div style={{ ...glassCardStyle, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', opacity: 0.3 }}>
                                <span style={{ fontSize: '0.65rem', fontWeight: 800, opacity: 0.4 }}>PENDING SENSOR SETUP</span>
                            </div>
                        )}
                    </div>

                    {/* COLUMN 3: PIPELINE ARCHITECTURE */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <section>
                            <label style={statLabelStyle}><Target size={12} /> PIPELINE OUTPUT</label>
                            <div style={{ ...glassCardStyle }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '16px' }}>
                                    {lookPresets.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => setSelectedLookId(p.id)}
                                            style={btnStyle(selectedLookId === p.id)}
                                        >
                                            <span style={{ fontSize: '0.65rem', fontWeight: 900 }}>{p.name.toUpperCase()}</span>
                                            {selectedLookId === p.id && <Check size={10} />}
                                        </button>
                                    ))}
                                </div>

                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                    <span style={{ fontSize: '0.5rem', fontWeight: 900, opacity: 0.3, letterSpacing: '0.1em' }}>LOGIC SPECIFICATION</span>
                                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', margin: '8px 0 0 0', lineHeight: 1.6, fontWeight: 500 }}>
                                        {lookPresets.find(p => p.id === selectedLookId)?.description || "Define mastering intent."}
                                    </p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '16px' }}>
                                        {['HDR ENABLED', 'LOG-C4 NAT', 'ACES 1.3'].map(t => (
                                            <span key={t} style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)', padding: '2px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.05)', fontWeight: 900 }}>{t}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </main>
            </div>
        </div>
    );
};

export default LookSetup;
