import React from "react";
import { ArrowRight, BarChart3, BriefcaseBusiness, Camera, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { ProductionProject } from "../../types";

interface ProductionHomeProps {
  activeProject: ProductionProject | null;
  onOpenProjectPicker: () => void;
  onOpenLookSetup: () => void;
  onOpenOnSetCoach: () => void;
  onOpenMatchNormalize: () => void;
  onOpenCameraMatchLab: () => void;
}

export function ProductionHome({
  activeProject,
  onOpenProjectPicker,
  onOpenLookSetup,
  onOpenOnSetCoach,
  onOpenMatchNormalize,
  onOpenCameraMatchLab,
}: ProductionHomeProps) {
  return (
    <div className="scrollable-view">
      <div className="onboarding-container production-onboarding">
        <div className="onboarding-header production-onboarding-header">
          <h1 className="production-onboarding-title">Camera prep and set discipline</h1>
          <p>Lock the look and keep every camera aligned.</p>
        </div>

        <div style={{ marginBottom: 22, display: "flex", justifyContent: "center" }}>
          <button type="button" className="btn btn-secondary" onClick={onOpenProjectPicker} style={{ gap: 10 }}>
            <BriefcaseBusiness size={16} />
            <span>{activeProject ? `Project: ${activeProject.name} · ${activeProject.client_name}` : "Choose project"}</span>
          </button>
        </div>

        <div style={gridStyle}>
          <ModuleCard
            icon={<SlidersHorizontal size={22} strokeWidth={1.35} />}
            title="Look Setup"
            description="Build camera A/B/C settings, define the target look, and generate deterministic capture guidance."
            enabled={Boolean(activeProject)}
            onClick={onOpenLookSetup}
          />
          <ModuleCard
            icon={<ShieldCheck size={22} strokeWidth={1.35} />}
            title="On-Set Coach"
            description="Carry forward the saved look plan into fast ready checks, warning toggles, and lighting discipline."
            enabled={Boolean(activeProject)}
            onClick={onOpenOnSetCoach}
          />
          <ModuleCard
            icon={<Camera size={22} strokeWidth={1.35} />}
            title="Match & Normalize"
            description="Choose a hero camera and save repeatable alignment presets for the rest of the camera package."
            enabled={Boolean(activeProject)}
            onClick={onOpenMatchNormalize}
          />
          <ModuleCard
            icon={<BarChart3 size={22} strokeWidth={1.35} />}
            title="Camera Match Lab"
            description="Import short test clips, inspect extracted reference frames, and compare deterministic signal metrics side-by-side."
            enabled={Boolean(activeProject)}
            onClick={onOpenCameraMatchLab}
          />
        </div>
      </div>
    </div>
  );
}

function ModuleCard({
  icon,
  title,
  description,
  enabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`module-card premium-card ${enabled ? "" : "disabled"}`}
      onClick={enabled ? onClick : undefined}
      style={moduleCardStyle}
    >
      <div className="module-icon">{icon}</div>
      <div className="module-info">
        <h2>{title}</h2>
        <p>{description}</p>
        <span className="module-action">
          {enabled ? "Open App" : "Project required"} <ArrowRight size={16} />
        </span>
      </div>
    </div>
  );
}

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 18,
  alignItems: "stretch",
};

const moduleCardStyle: React.CSSProperties = {
  minHeight: 214,
  height: "100%",
};
