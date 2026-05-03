import React, { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Briefcase, Camera, CircleDot, Maximize2, Minus, Plus, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { ProductionProject } from "../../types";
import { invokeGuarded } from "../../utils/tauri";

interface ProductionHomeProps {
  activeProject: ProductionProject | null;
  onSelectProject: (project: ProductionProject | null) => void;
  onOpenLookSetup: () => void;
  onOpenOnSetCoach: () => void;
  onOpenMatchNormalize: () => void;
  onOpenCameraMatchLab: () => void;
  onOpenFramePreview: () => void;
  lockedModuleIds?: string[];
}

export function ProductionHome({
  activeProject,
  onSelectProject,
  onOpenLookSetup,
  onOpenOnSetCoach,
  onOpenMatchNormalize,
  onOpenCameraMatchLab,
  onOpenFramePreview,
  lockedModuleIds = [],
}: ProductionHomeProps) {
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [showFullProjectList, setShowFullProjectList] = useState(false);

  useEffect(() => {
    void loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const list = await invokeGuarded<ProductionProject[]>("production_list_projects");
      setProjects(list);
    } catch (error) {
      console.error("Failed to load production projects", error);
      setProjects([]);
    }
  };

  const handleCreateProject = async () => {
    const nextName = projectName.trim();
    const nextClient = clientName.trim();
    if (!nextName || !nextClient) return;
    setCreatingProject(true);
    try {
      const project = await invokeGuarded<ProductionProject>("production_create_project", {
        name: nextName,
        clientName: nextClient,
      });
      setProjects((prev) => [project, ...prev]);
      setProjectName("");
      setClientName("");
      setCreateModalOpen(false);
      onSelectProject(project);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleOpenProject = async (project: ProductionProject) => {
    await invokeGuarded("production_touch_project", { projectId: project.id });
    const touchedProject = { ...project, last_opened_at: new Date().toISOString() };
    setProjects((prev) => [touchedProject, ...prev.filter((item) => item.id !== project.id)]);
    onSelectProject(touchedProject);
    setShowFullProjectList(false);
  };

  const handleDeleteProject = async (project: ProductionProject) => {
    setDeletingProjectId(project.id);
    try {
      await invokeGuarded("production_delete_project", { projectId: project.id });
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      if (activeProject?.id === project.id) {
        onSelectProject(null);
      }
    } finally {
      setDeletingProjectId(null);
    }
  };


  const formatDate = (isoString: string) => {
    if (!isoString) return "-";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="scrollable-view">
      <div className="onboarding-container production-onboarding module-launcher production-launcher">
        {showFullProjectList ? (
          <div style={fullListContainerStyle}>
            <div style={fullListHeaderStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowFullProjectList(false)} style={{ padding: 4 }}>
                  <X size={20} />
                </button>
                <h1 className="production-onboarding-title" style={{ margin: 0 }}>All Projects</h1>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateModalOpen(true)}>
                <Plus size={14} /> Create Project
              </button>
            </div>

            <div style={fullListTableWrapStyle}>
              <table style={fullListTableStyle}>
                <thead>
                  <tr style={tableHeaderRowStyle}>
                    <th style={tableHeaderCellStyle}>Project Name</th>
                    <th style={tableHeaderCellStyle}>Client</th>
                    <th style={tableHeaderCellStyle}>Created</th>
                    <th style={tableHeaderCellStyle}>Last Change</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={{ ...tableHeaderCellStyle, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                        No projects found. Create your first project to get started.
                      </td>
                    </tr>
                  ) : (
                    projects.map((project) => {
                      const isActive = activeProject?.id === project.id;
                      return (
                        <tr key={project.id} style={{ ...tableRowStyle, ...(isActive ? tableRowActiveStyle : null) }}>
                          <td style={tableCellStyle}>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{project.name}</div>
                          </td>
                          <td style={tableCellStyle}>{project.client_name}</td>
                          <td style={tableCellStyle}>{formatDate(project.created_at)}</td>
                          <td style={tableCellStyle}>{formatDate(project.last_opened_at)}</td>
                          <td style={tableCellStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: isActive ? "var(--status-blue)" : "var(--status-green)",
                                boxShadow: isActive ? "0 0 8px var(--color-accent-glow)" : "none"
                              }} />
                              <span style={{ fontSize: "0.8rem", color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                                {isActive ? "Active" : "Ready"}
                              </span>
                            </div>
                          </td>
                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                              <button
                                type="button"
                                className={`btn btn-sm ${isActive ? "btn-primary" : "btn-ghost"}`}
                                style={{ padding: "4px 12px", height: 28, fontSize: "0.75rem" }}
                                onClick={() => void handleOpenProject(project)}
                              >
                                {isActive ? "Opened" : "Open"}
                              </button>
                              <button
                                type="button"
                                style={projectDeleteButtonStyle}
                                onClick={() => void handleDeleteProject(project)}
                                disabled={deletingProjectId === project.id}
                                title="Delete project"
                              >
                                <Minus size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <>
            <div className="onboarding-header production-onboarding-header module-launcher-header">
              <h1 className="production-onboarding-title">Production</h1>
              <p>Lock the look, align the camera package, and keep the set disciplined.</p>
            </div>

            <div className="production-apps-grid module-launcher-grid">
              <ProjectsCard
                activeProject={activeProject}
                onViewAll={() => setShowFullProjectList(true)}
              />
              <ModuleCard
                icon={<SlidersHorizontal size={22} strokeWidth={1.35} />}
                title="Look Setup"
                description="Build camera A/B/C settings, define the target look, and generate deterministic capture guidance."
                enabled={Boolean(activeProject)}
                locked={lockedModuleIds.includes('look-setup')}
                onClick={onOpenLookSetup}
              />
              <ModuleCard
                icon={<BarChart3 size={22} strokeWidth={1.35} />}
                title="Camera Match Lab"
                description="Import test clips, inspect reference frames, and compare signal metrics side-by-side."
                enabled={Boolean(activeProject)}
                locked={lockedModuleIds.includes('camera-match-lab')}
                onClick={onOpenCameraMatchLab}
              />
              <ModuleCard
                icon={<ShieldCheck size={22} strokeWidth={1.35} />}
                title="On-Set Coach"
                description="Carry forward the saved look plan into fast ready checks, warning toggles, and lighting discipline."
                enabled={Boolean(activeProject)}
                locked={lockedModuleIds.includes('onset-coach')}
                onClick={onOpenOnSetCoach}
              />
              <ModuleCard
                icon={<Camera size={22} strokeWidth={1.35} />}
                title="Match & Normalize"
                description="Choose a hero camera and save repeatable alignment presets for the rest of the camera package."
                enabled={Boolean(activeProject)}
                locked={lockedModuleIds.includes('match-normalize')}
                onClick={onOpenMatchNormalize}
              />
              <ModuleCard
                icon={<Maximize2 size={22} strokeWidth={1.35} />}
                title="Frame Preview"
                description="Preview media in multiple aspect ratio frames, reframe content per format, and export preview crops."
                enabled={true}
                locked={lockedModuleIds.includes('frame-preview')}
                onClick={onOpenFramePreview}
              />
            </div>
          </>
        )}

        {createModalOpen ? (
          <div style={modalBackdropStyle} onClick={() => setCreateModalOpen(false)}>
            <div style={modalCardStyle} onClick={(event) => event.stopPropagation()}>
              <div style={modalHeaderStyle}>
                <div>
                  <div style={projectListTitleStyle}>Create Project</div>
                  <div style={modalTitleStyle}>New production project</div>
                </div>
                <button type="button" style={modalCloseButtonStyle} onClick={() => setCreateModalOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div style={modalFormStyle}>
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="Project name"
                  style={projectInputStyle}
                />
                <input
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Client"
                  style={projectInputStyle}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCreateProject()} disabled={creatingProject}>
                  <Plus size={14} /> {creatingProject ? "Creating..." : "Create project"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProjectsCard({
  activeProject,
  onViewAll,
}: {
  activeProject: ProductionProject | null;
  onViewAll: () => void;
}) {
  return (
    <div 
      className="module-card premium-card module-launcher-card production-project-card" 
      style={{ ...moduleCardStyle, alignText: "left", position: "relative" } as any}
      onClick={onViewAll}
    >
      {activeProject && (
        <div style={activeBadgeStyle} title={`Active Project: ${activeProject.name}`}>
          <CircleDot size={8} strokeWidth={3} className="pulse-slow" />
          <span>In Session</span>
        </div>
      )}
      <div className="module-icon">
        <Briefcase size={22} strokeWidth={1.35} />
      </div>
      <div className="module-info">
        <h2>Project Manager</h2>
        <p>Manage your projects here and open the one you want to work on.</p>
        <span className="module-action">
           Manage Projects <ArrowRight size={16} />
        </span>
      </div>
    </div>
  );
}

function ModuleCard({
  icon,
  title,
  description,
  enabled,
  locked = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  const isDisabled = locked || !enabled;
  return (
    <div
      className={`module-card premium-card module-launcher-card ${isDisabled ? "disabled" : ""}`}
      onClick={isDisabled ? undefined : onClick}
      style={{ ...moduleCardStyle, position: 'relative' }}
    >
      {locked && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          display: 'flex', alignItems: 'center', gap: 5,
          backgroundColor: 'rgba(10,10,12,0.85)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 999, padding: '4px 10px 4px 7px',
          backdropFilter: 'blur(8px)', zIndex: 2,
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Full License</span>
        </div>
      )}
      <div className="module-icon">{icon}</div>
      <div className="module-info">
        <h2>{title}</h2>
        <p>{description}</p>
        <span className="module-action">
          {locked ? "Full License required" : enabled ? "Open App" : "Project required"} <ArrowRight size={16} />
        </span>
      </div>
    </div>
  );
}

const moduleCardStyle: React.CSSProperties = {
  minHeight: 214,
  height: "100%",
};


const projectInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-primary)",
  outline: "none",
};

const projectListTitleStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--text-muted)",
  fontWeight: 800,
};

const projectDeleteButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  padding: 0,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.76)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 2200,
  backdropFilter: "blur(10px)",
};

const modalCardStyle: React.CSSProperties = {
  width: "min(460px, 100%)",
  padding: 20,
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "#0b0b0e",
  boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
  display: "grid",
  gap: 16,
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
};

const modalTitleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: "1.12rem",
  fontWeight: 700,
  color: "var(--text-primary)",
};

const modalCloseButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const modalFormStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const fullListContainerStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 24,
  padding: "4px 2px",
};

const fullListHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
};

const fullListTableWrapStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.01)",
  overflow: "hidden",
};

const fullListTableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.85rem",
};

const tableHeaderRowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const tableHeaderCellStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "left",
  color: "var(--text-muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "0.7rem",
};

const tableRowStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  transition: "background 0.2s",
};

const tableRowActiveStyle: React.CSSProperties = {
  background: "rgba(165,146,255,0.04)",
};

const tableCellStyle: React.CSSProperties = {
  padding: "16px",
  color: "var(--text-secondary)",
  verticalAlign: "middle",
};

const activeBadgeStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 8px",
  borderRadius: 99,
  background: "rgba(165,146,255,0.12)",
  border: "1px solid rgba(165,146,255,0.2)",
  color: "var(--color-accent)",
  fontSize: "0.55rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  zIndex: 10,
};
