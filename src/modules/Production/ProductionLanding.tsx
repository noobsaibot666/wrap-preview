import React from 'react';
import { Camera, LayoutGrid, BriefcaseBusiness, Settings2, ArrowRight } from 'lucide-react';
import { ProductionProject } from '../../types';

interface ProductionLandingProps {
    onOpenProjectManager: () => void;
    onOpenLookSetup: (project: ProductionProject) => void;
    onOpenOnSetCoach: (project: ProductionProject) => void;
    onOpenMatchNormalize: (project: ProductionProject) => void;
    activeProject: ProductionProject | null;
}

export const ProductionLanding: React.FC<ProductionLandingProps> = ({
    onOpenProjectManager,
    onOpenLookSetup,
    onOpenOnSetCoach,
    onOpenMatchNormalize,
    activeProject,
}) => {
    return (
        <div className="production-landing" style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '40px',
            background: 'var(--bg-app)',
            color: 'var(--text-primary)',
            overflowY: 'auto',
            height: '100%',
            position: 'relative'
        }}>
            <header style={{
                marginBottom: '64px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start'
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-primary)'
                        }}>
                            <Camera size={26} strokeWidth={1.5} />
                        </div>
                        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Production</h1>
                    </div>
                    <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', margin: 0, maxWidth: '600px', lineHeight: 1.6 }}>
                        Plan the look, lock exposure, and keep cameras matched across the entire workflow.
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={onOpenProjectManager}
                        className="review-core-asset-card"
                        style={{
                            width: 'auto',
                            padding: '12px 24px',
                            borderRadius: '10px',
                            fontSize: '0.9rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            background: activeProject ? 'var(--bg-card)' : 'var(--text-primary)',
                            color: activeProject ? 'var(--text-primary)' : '#000',
                            border: activeProject ? '1px solid var(--border-default)' : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            transition: 'all 0.2s ease',
                            boxShadow: activeProject ? 'none' : '0 4px 20px rgba(255, 255, 255, 0.1)'
                        }}
                    >
                        <BriefcaseBusiness size={18} />
                        {activeProject ? 'Switch Project' : 'Select Project'}
                    </button>
                    {activeProject && (
                        <div style={{
                            fontSize: '0.85rem',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '4px 12px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>Active:</span> {activeProject.name}
                        </div>
                    )}
                </div>
            </header>

            <div className="onboarding-grid" style={{
                marginTop: '32px',
                marginBottom: '64px'
            }}>
                <AppCard
                    title="Look Setup"
                    category="Production"
                    description="Match hero cameras with high-precision look plans and printable checklists for the crew."
                    icon={<Settings2 size={22} strokeWidth={1.35} />}
                    enabled={!!activeProject}
                    onClick={() => activeProject && onOpenLookSetup(activeProject)}
                    actionLabel={activeProject ? "Enter App" : "Select Project"}
                />
                <AppCard
                    title="On-Set Coach"
                    category="Production"
                    description="Live monitoring and fast on-set checks. Protect highlights and ensure consistent exposure."
                    icon={<Camera size={22} strokeWidth={1.35} />}
                    enabled={!!activeProject}
                    onClick={() => activeProject && onOpenOnSetCoach(activeProject)}
                    actionLabel={activeProject ? "Enter App" : "Select Project"}
                />
                <AppCard
                    title="Match & Normalize"
                    category="Production"
                    description="The industry standard for multi-camera alignment and sensor normalization workflows."
                    icon={<LayoutGrid size={22} strokeWidth={1.35} />}
                    enabled={!!activeProject}
                    onClick={() => activeProject && onOpenMatchNormalize(activeProject)}
                    actionLabel={activeProject ? "Enter App" : "Select Project"}
                />
            </div>

            <footer style={{ marginTop: 'auto', paddingTop: '48px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                <p>© Alan Alves. All rights reserved.</p>
                <div style={{ display: 'flex', gap: '24px' }}>
                    <span>Wrap Preview Suite</span>
                    <span>Production Module v1.0</span>
                </div>
            </footer>
        </div>
    );
};

interface AppCardProps {
    title: string;
    description: string;
    icon: React.ReactNode;
    enabled: boolean;
    category: string;
    onClick?: () => void;
    actionLabel: string;
}

const AppCard: React.FC<AppCardProps> = ({ title, description, icon, enabled, category, onClick, actionLabel }) => {
    return (
        <div
            className={`module-card premium-card ${!enabled ? 'disabled' : ''}`}
            onClick={enabled ? onClick : undefined}
            style={{ height: '100%', minHeight: '280px' }}
        >
            <div className="module-icon" style={{
                color: 'var(--text-primary)',
                opacity: enabled ? 0.9 : 0.4
            }}>
                {icon}
            </div>
            <div className="module-info">
                <span className="module-label">{category}</span>
                <h3 style={{ fontSize: '1.25rem' }}>{title}</h3>
                <p>{description}</p>
                <span className="module-action" style={{
                    color: enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                    opacity: enabled ? 1 : 0.6
                }}>
                    {actionLabel} <ArrowRight size={16} />
                </span>
            </div>
            {!enabled && (
                <div style={{
                    position: 'absolute',
                    top: '16px',
                    right: '16px',
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    padding: '4px 8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '4px',
                    color: 'var(--text-muted)'
                }}>
                    LOCKED
                </div>
            )}
        </div>
    );
};
