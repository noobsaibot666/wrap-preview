import React, { useEffect, useState } from "react";
import { BriefcaseBusiness, ChevronRight, Plus, UserRound, X } from "lucide-react";
import { ProductionProject } from "../../types";
import { invokeGuarded } from "../../utils/tauri";

interface ProductionProjectPickerProps {
  onClose: () => void;
  onSelectProject: (project: ProductionProject) => void;
}

export function ProductionProjectPicker({
  onClose,
  onSelectProject,
}: ProductionProjectPickerProps) {
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await invokeGuarded<ProductionProject[]>("production_list_projects");
      setProjects(list);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!projectName.trim() || !clientName.trim()) return;
    setCreating(true);
    try {
      const project = await invokeGuarded<ProductionProject>("production_create_project", {
        name: projectName.trim(),
        clientName: clientName.trim(),
      });
      setProjects((prev) => [project, ...prev]);
      onSelectProject(project);
    } finally {
      setCreating(false);
    }
  };

  const handleOpen = async (project: ProductionProject) => {
    await invokeGuarded("production_touch_project", { projectId: project.id });
    onSelectProject({ ...project, last_opened_at: new Date().toISOString() });
  };

  return (
    <div style={backdropStyle}>
      <div style={panelStyle}>
        <header style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Production Repository</div>
            <h2 style={{ margin: "4px 0 0", fontSize: "1.3rem" }}>Create or open a production project</h2>
          </div>
          <button type="button" onClick={onClose} style={iconButtonStyle}>
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: 24, display: "grid", gap: 20 }}>
          <section style={cardStyle}>
            <div style={sectionTitleStyle}>New Project</div>
            <div style={{ display: "grid", gap: 10 }}>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Production title"
                style={inputStyle}
              />
              <input
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder="Client name"
                style={inputStyle}
              />
              <button type="button" onClick={handleCreate} style={primaryButtonStyle} disabled={creating}>
                <Plus size={16} />
                <span>{creating ? "Creating..." : "Create Project"}</span>
              </button>
            </div>
          </section>

          <section style={cardStyle}>
            <div style={sectionTitleStyle}>Saved Projects</div>
            {loading ? (
              <div style={emptyStyle}>Loading production projects...</div>
            ) : projects.length === 0 ? (
              <div style={emptyStyle}>No production projects yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {projects.map((project) => (
                  <button key={project.id} type="button" onClick={() => void handleOpen(project)} style={listRowStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={rowIconStyle}>
                        <BriefcaseBusiness size={16} />
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{project.name}</div>
                        <div style={metaStyle}>
                          <UserRound size={12} />
                          <span>{project.client_name}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-muted)" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2200,
  backdropFilter: "blur(14px)",
};

const panelStyle: React.CSSProperties = {
  width: "min(720px, 92vw)",
  maxHeight: "84vh",
  overflow: "auto",
  background: "#0a0a0b",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: 24,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--text-muted)",
  fontWeight: 800,
};

const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.025)",
};

const sectionTitleStyle: React.CSSProperties = {
  marginBottom: 12,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--text-muted)",
  fontWeight: 800,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-primary)",
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 16px",
  border: "none",
  borderRadius: 12,
  background: "var(--color-accent)",
  color: "#041018",
  fontWeight: 800,
  cursor: "pointer",
};

const emptyStyle: React.CSSProperties = {
  padding: "18px 4px",
  color: "var(--text-muted)",
  fontSize: "0.9rem",
};

const listRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.02)",
  cursor: "pointer",
  color: "inherit",
};

const rowIconStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(94, 234, 212, 0.08)",
  color: "var(--color-accent)",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 4,
  color: "var(--text-muted)",
  fontSize: "0.8rem",
};

const iconButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
