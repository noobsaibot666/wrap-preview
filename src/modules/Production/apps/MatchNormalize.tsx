import React, { useState, useEffect, useMemo } from 'react';
import {
    ArrowLeft,
    Shield,
    Scale,
    Layers,
    CheckCircle2,
    Lock,
    Settings2
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ProductionProject, ProductionCameraConfig, CameraProfile } from '../../../types';

interface MatchNormalizeProps {
    project: ProductionProject;
    onBack: () => void;
}

export const MatchNormalize: React.FC<MatchNormalizeProps> = ({ project, onBack }) => {
    const [cameraConfigs, setCameraConfigs] = useState<ProductionCameraConfig[]>([]);
    const [_cameraProfiles, _setCameraProfiles] = useState<CameraProfile[]>([]);
    const [referenceSlot, setReferenceSlot] = useState<string>("A");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [configs, profiles] = await Promise.all([
                    invoke<ProductionCameraConfig[]>('list_production_camera_configs', { projectId: project.id }),
                    invoke<CameraProfile[]>('get_camera_profiles')
                ]);
                setCameraConfigs(configs);
                _setCameraProfiles(profiles);
                // Set default reference slot to first camera if present
                if (configs.length > 0) {
                    setReferenceSlot(configs[0].slot);
                }
            } catch (err) {
                console.error("Failed to load Match & Normalize data:", err);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [project.id]);

    // Memoized reference config
    const referenceConfig = useMemo(() =>
        cameraConfigs.find(c => c.slot === referenceSlot) || cameraConfigs[0],
        [cameraConfigs, referenceSlot]);

    // Memoized delta calculations for comparison matrix
    const comparisonMatrix = useMemo(() => {
        return cameraConfigs
            .filter(c => c.slot !== referenceSlot)
            .map((config, idx) => {
                // In a production app, these would be calculated based on sensor specs/profiles
                const deltaStop = (idx % 2 === 0) ? "-0.3" : "+0.1";
                const deltaTint = (idx % 2 === 0) ? "+0.5" : "0.0";
                const strength = 85 + (idx * 3); // Mock strength percentage

                return {
                    config,
                    deltaStop,
                    deltaTint,
                    strength
                };
            });
    }, [cameraConfigs, referenceSlot]);

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
        padding: '24px',
        display: 'flex',
        flexDirection: 'column'
    };

    if (isLoading) {
        return (
            <div style={{ background: '#050505', height: '100vh', padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ height: '48px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', width: '30%' }} className="skeleton-pulse" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '40px' }}>
                    <div style={{ height: '300px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }} className="skeleton-pulse" />
                    <div style={{ height: '600px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }} className="skeleton-pulse" />
                </div>
            </div>
        );
    }

    return (
        <div className="match-normalize-view" style={{
            background: '#050505',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            fontFamily: 'var(--font-main)'
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
                            MATCH & NORMALIZE
                        </h2>
                        <span style={{ fontSize: '0.55rem', fontWeight: 900, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.1em' }}>
                            MULTI-CAM ALIGNMENT
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
                        <Shield size={12} strokeWidth={2.5} /> COMMIT OFFSETS
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '40px' }}>
                <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 2fr', gap: '40px' }}>

                    {/* LEFT PANEL: REFERENCE & MASTER CONFIG */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <section style={{ ...glassCardStyle, borderLeft: '4px solid var(--color-accent)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Lock size={14} color="var(--color-accent)" />
                                    <h3 style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>PIVOT REFERENCE</h3>
                                </div>
                                <select
                                    value={referenceSlot}
                                    onChange={(e) => setReferenceSlot(e.target.value)}
                                    style={{
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.65rem',
                                        fontWeight: 900,
                                        borderRadius: '4px',
                                        padding: '4px 8px'
                                    }}
                                >
                                    {cameraConfigs.map(c => (
                                        <option key={c.slot} value={c.slot}>SLOT {c.slot}</option>
                                    ))}
                                </select>
                            </div>

                            {referenceConfig && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    <div>
                                        <div style={statLabelStyle}>MASTER BODY</div>
                                        <div style={{ ...valueStyle, fontSize: '1.1rem' }}>{referenceConfig.brand} {referenceConfig.model}</div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                        <div>
                                            <div style={statLabelStyle}>BASE ISO</div>
                                            <div style={valueStyle}>{referenceConfig.recording_mode} • 800</div>
                                        </div>
                                        <div>
                                            <div style={statLabelStyle}>SENSOR SLOT</div>
                                            <div style={valueStyle}>SLOT {referenceConfig.slot}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section style={glassCardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                                <Layers size={14} color="rgba(255,255,255,0.4)" />
                                <h3 style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>NORMALIZATION RULES</h3>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Match Skin Tones</span>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#10b981' }}>ENABLED</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Align Black Pivot</span>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#10b981' }}>ENABLED</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Match Texture (OETF)</span>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'rgba(255,255,255,0.3)' }}>OPTIONAL</span>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* RIGHT PANEL: COMPARISON MATRIX */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', overflow: 'hidden' }}>

                        {/* Matrix Header */}
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '24px 32px', display: 'grid', gridTemplateColumns: 'minmax(250px, 1.5fr) 1fr 1.2fr', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <Scale size={14} color="rgba(255,255,255,0.4)" />
                                <h3 style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>COMPARISON MATRIX</h3>
                            </div>
                            <div style={statLabelStyle}>MATCH DELTA</div>
                            <div style={{ textAlign: 'right' }}><div style={statLabelStyle}>NORMALIZATION OFFSET</div></div>
                        </div>

                        {/* Comparison Rows */}
                        {comparisonMatrix.map(({ config, deltaStop, deltaTint, strength }) => (
                            <div key={config.slot} style={{ background: '#050505', padding: '32px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: 'minmax(250px, 1.5fr) 1fr 1.2fr', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 900 }}>
                                        {config.slot}
                                    </div>
                                    <div>
                                        <div style={{ ...valueStyle, fontSize: '0.9rem' }}>{config.brand} {config.model}</div>
                                        <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', fontWeight: 800, marginTop: '2px' }}>{config.recording_mode.toUpperCase()}</div>
                                    </div>
                                </div>

                                <div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                                            <span style={{ fontSize: '1rem', fontWeight: 950 }}>{deltaStop}</span>
                                            <span style={{ fontSize: '0.6rem', fontWeight: 900, color: 'rgba(255,255,255,0.2)' }}>STOPS</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 950, color: 'var(--color-accent)' }}>{deltaTint}</span>
                                            <span style={{ fontSize: '0.6rem', fontWeight: 900, color: 'rgba(59, 130, 246, 0.2)' }}>TINT</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', marginBottom: '12px' }}>
                                        <div style={statLabelStyle}>ALIGNMENT STRENGTH</div>
                                        <div style={{ display: 'flex', gap: '3px' }}>
                                            {[1, 2, 3, 4, 5].map(i => (
                                                <div key={i} style={{ width: '8px', height: '2px', borderRadius: '1px', background: i <= (strength / 20) ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)' }} />
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <button style={{
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            borderRadius: '4px',
                                            padding: '8px 16px',
                                            fontSize: '0.65rem',
                                            fontWeight: 900,
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <Settings2 size={12} strokeWidth={2} /> CALIBRATE
                                        </button>
                                        <button style={{
                                            background: 'rgba(16, 185, 129, 0.1)',
                                            border: '1px solid rgba(16, 185, 129, 0.2)',
                                            borderRadius: '4px',
                                            padding: '8px 12px',
                                            cursor: 'pointer'
                                        }}>
                                            <CheckCircle2 size={14} color="#10b981" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Empty/Footer area of matrix */}
                        <div style={{ padding: '40px', background: 'rgba(0,0,0,0.2)', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            {cameraConfigs.length <= 1 ? (
                                <div style={{ textAlign: 'center', maxWidth: '300px' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', fontWeight: 800, letterSpacing: '0.05em' }}>
                                        ONLY ONE CAMERA SLOT DETECTED. ADD ADDITIONAL BODIES IN PROJECT MANAGER TO ENABLE MATCHING.
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', fontWeight: 800, letterSpacing: '0.1em' }}>
                                        ALL DELTAS CALCULATED RELATIVE TO SLOT {referenceSlot}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Matrix Footer */}
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
                    <span>PUMP CALCULATOR ACTIVE</span>
                    <span>ALGORITHM: PIVOT-NATIVE-V2</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <span>READY TO NORMALIZE</span>
                    <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981' }} />
                </div>
            </footer>
        </div>
    );
};

export default MatchNormalize;
