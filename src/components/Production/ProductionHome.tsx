import React from "react";
import { ArrowRight, BriefcaseBusiness, Camera, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { ProductionProject } from "../../types";

interface ProductionHomeProps {
  activeProject: ProductionProject | null;
  onOpenProjectPicker: () => void;
  onOpenLookSetup: () => void;
  onOpenOnSetCoach: () => void;
  onOpenMatchNormalize: () => void;
}

export function ProductionHome({
  activeProject,
  onOpenProjectPicker,
  onOpenLookSetup,
  onOpenOnSetCoach,
  onOpenMatchNormalize,
}: ProductionHomeProps) {
  return (
    <div className="scrollable-view">
      <div className="onboarding-container">
        <div className="onboarding-header">
          <span className="onboarding-eyebrow">Production</span>
          <h1>Camera prep and set discipline</h1>
          <p>Lock the look, carry reliable exposure targets, and keep every body aligned to the same baseline.</p>
        </div>

        <div style={{ marginBottom: 28, display: "flex", justifyContent: "center" }}>
          <button type="button" className="btn btn-secondary" onClick={onOpenProjectPicker} style={{ gap: 10 }}>
            <BriefcaseBusiness size={16} />
            <span>{activeProject ? `${activeProject.name} · ${activeProject.client_name}` : "Create or open production project"}</span>
          </button>
        </div>

        <div className="onboarding-grid onboarding-grid-root">
          <ModuleCard
            icon={<SlidersHorizontal size={22} strokeWidth={1.35} />}
            label="Production"
            title="Look Setup"
            description="Build camera A/B/C settings, define the target look, and generate deterministic capture guidance."
            enabled={Boolean(activeProject)}
            onClick={onOpenLookSetup}
          />
          <ModuleCard
            icon={<ShieldCheck size={22} strokeWidth={1.35} />}
            label="Production"
            title="On-Set Coach"
            description="Carry forward the saved look plan into fast ready checks, warning toggles, and lighting discipline."
            enabled={Boolean(activeProject)}
            onClick={onOpenOnSetCoach}
          />
          <ModuleCard
            icon={<Camera size={22} strokeWidth={1.35} />}
            label="Production"
            title="Match & Normalize"
            description="Choose a hero camera and save repeatable alignment presets for the rest of the camera package."
            enabled={Boolean(activeProject)}
            onClick={onOpenMatchNormalize}
          />
        </div>
      </div>
    </div>
  );
}

function ModuleCard({
  icon,
  label,
  title,
  description,
  enabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  description: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`module-card premium-card ${enabled ? "" : "disabled"}`}
      onClick={enabled ? onClick : undefined}
    >
      <div className="module-icon">{icon}</div>
      <div className="module-info">
        <span className="module-label">{label}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <span className="module-action">
          {enabled ? "Open App" : "Production project required"} <ArrowRight size={16} />
        </span>
      </div>
    </div>
  );
}
