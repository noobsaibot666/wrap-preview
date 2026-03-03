import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, BriefcaseBusiness, X, ChevronRight, Calendar } from 'lucide-react';
import { ProductionProject } from '../../types';

interface ProjectManagerProps {
    onClose: () => void;
    onSelectProject: (project: ProductionProject) => void;
}

export const ProjectManager: React.FC<ProjectManagerProps> = ({ onClose, onSelectProject }) => {
    const [projects, setProjects] = useState<ProductionProject[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        setLoading(true);
        try {
            const list = await invoke<ProductionProject[]>('list_production_projects');
            setProjects(list);
        } catch (e) {
            console.error("Failed to load production projects:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newProjectName.trim()) return;
        try {
            const project = await invoke<ProductionProject>('create_production_project', { name: newProjectName });
            setProjects([project, ...projects]);
            setIsCreating(false);
            setNewProjectName('');
            onSelectProject(project);
        } catch (e) {
            console.error("Failed to create project:", e);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(12px)'
        }}>
            <div style={{
                width: 'min(500px, 90%)',
                background: 'var(--bg-app)',
                borderRadius: '24px',
                border: '1px solid var(--border-default)',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '80vh',
                boxShadow: '0 32px 64px rgba(0, 0, 0, 0.6)',
                overflow: 'hidden'
            }}>
                <header style={{
                    padding: '32px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255, 255, 255, 0.02)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ color: 'var(--text-primary)', opacity: 0.8 }}>
                            <BriefcaseBusiness size={24} />
                        </div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>Production Projects</h2>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '50%',
                        display: 'flex',
                        transition: 'all 0.2s ease'
                    }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                    >
                        <X size={20} />
                    </button>
                </header>

                <div style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
                    {isCreating ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '32px' }}>
                            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Production Project</h3>
                            <input
                                autoFocus
                                type="text"
                                placeholder="Project Name (e.g. 'Project Artemis')"
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid var(--border-default)',
                                    borderRadius: '12px',
                                    padding: '16px',
                                    color: 'var(--text-primary)',
                                    fontSize: '1rem',
                                    outline: 'none',
                                    width: '100%',
                                    transition: 'border-color 0.2s ease'
                                }}
                                onFocus={(e) => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={(e) => e.target.style.borderColor = 'var(--border-default)'}
                            />
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setIsCreating(false)} style={{
                                    background: 'transparent',
                                    border: '1px solid var(--border-default)',
                                    borderRadius: '10px',
                                    padding: '10px 20px',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.9rem'
                                }}>Cancel</button>
                                <button onClick={handleCreate} style={{
                                    background: 'var(--text-primary)',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '10px 24px',
                                    color: '#000',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    fontSize: '0.9rem',
                                    boxShadow: '0 4px 12px rgba(255, 255, 255, 0.1)'
                                }}>Create</button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setIsCreating(true)} style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            padding: '20px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px dashed var(--border-default)',
                            borderRadius: '16px',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            marginBottom: '32px',
                            transition: 'all 0.2s ease',
                            fontWeight: 600
                        }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                e.currentTarget.style.borderColor = 'var(--color-accent)';
                                e.currentTarget.style.color = 'var(--text-primary)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                e.currentTarget.style.borderColor = 'var(--border-default)';
                                e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                        >
                            <Plus size={20} />
                            <span>Create New Project</span>
                        </button>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                                <span className="animate-pulse">Loading project repository...</span>
                            </div>
                        ) : projects.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                                <BriefcaseBusiness size={48} style={{ opacity: 0.1, marginBottom: '16px' }} />
                                <p style={{ fontSize: '0.9rem' }}>No active projects in repository.</p>
                            </div>
                        ) : (
                            projects.map(p => (
                                <div
                                    key={p.id}
                                    onClick={() => onSelectProject(p)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '20px',
                                        background: 'rgba(255, 255, 255, 0.02)',
                                        border: '1px solid var(--border-default)',
                                        borderRadius: '16px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.transform = 'scale(1.02)';
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                                        e.currentTarget.style.borderColor = 'var(--border-default)';
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{p.name}</h4>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Calendar size={12} />
                                                <span>{new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '8px',
                                        background: 'rgba(255, 255, 255, 0.03)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--text-muted)'
                                    }}>
                                        <ChevronRight size={18} />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
