import React, { useEffect, useMemo, useState } from "react";
import { Download, Save } from "lucide-react";
import {
  ProductionCameraConfig,
  ProductionLookSetup,
  ProductionMatchPresetPayload,
  ProductionPreset,
  ProductionProject,
} from "../../types";
import { exportProductionPdf } from "../../utils/ProductionExport";
import { invokeGuarded } from "../../utils/tauri";
import { buildMatchPresetPayload, parseLookOutputs } from "./productionLogic";

interface MatchNormalizeAppProps {
  project: ProductionProject;
  onBack?: () => void;
}

export function MatchNormalizeApp({ project }: MatchNormalizeAppProps) {
  const [cameraConfigs, setCameraConfigs] = useState<ProductionCameraConfig[]>([]);
  const [setup, setSetup] = useState<ProductionLookSetup | null>(null);
  const [heroSlot, setHeroSlot] = useState("A");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<ProductionPreset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [project.id]);

  const load = async () => {
    setLoading(true);
    try {
      const [configs, savedSetup, savedPresets] = await Promise.all([
        invokeGuarded<ProductionCameraConfig[]>("list_production_camera_configs", { projectId: project.id }),
        invokeGuarded<ProductionLookSetup | null>("production_get_look_setup", { projectId: project.id }),
        invokeGuarded<ProductionPreset[]>("production_list_presets", { projectId: project.id }),
      ]);
      setCameraConfigs(configs);
      setSetup(savedSetup);
      setPresets(savedPresets);
      if (configs[0]?.slot) setHeroSlot(configs[0].slot);
    } finally {
      setLoading(false);
    }
  };

  const outputs = useMemo(() => parseLookOutputs(setup?.outputs_json), [setup?.outputs_json]);
  const payload = useMemo<ProductionMatchPresetPayload>(() => buildMatchPresetPayload(heroSlot, cameraConfigs, outputs), [cameraConfigs, heroSlot, outputs]);

  const savePreset = async () => {
    if (!presetName.trim()) return;
    const now = new Date().toISOString();
    const preset: ProductionPreset = {
      id: `${project.id}:preset:${now}`,
      project_id: project.id,
      name: presetName.trim(),
      payload_json: JSON.stringify(payload),
      created_at: now,
      updated_at: now,
    };
    await invokeGuarded("production_save_preset", { preset });
    setPresets((prev) => [preset, ...prev]);
    setPresetName("");
  };

  const exportPreset = async () => {
    await exportProductionPdf({
      fileName: `${project.name}_MatchPreset.pdf`,
      title: "Match & Normalize Preset",
      subtitle: "Production",
      projectName: project.name,
      clientName: project.client_name,
      sections: [
        { title: `Hero Camera ${payload.hero_slot}`, lines: [payload.hero_summary] },
        ...payload.steps.map((step) => ({
          title: `${step.slot} Camera · ${step.camera_label}`,
          lines: step.checklist,
        })),
      ],
    });
  };

  if (loading) {
    return <div className="inline-loading-state" style={{ padding: 40 }}>Loading match & normalize...</div>;
  }

  return (
    <div className="scrollable-view" style={{ padding: 32 }}>
      <div style={headerRowStyle}>
        <div style={headerMetaBlockStyle}>
          <div style={headerProjectNameStyle}>Project {project.name}</div>
          <p style={subtleStyle}>Client {project.client_name}</p>
          <p style={subtleHintStyle}>Choose the hero camera baseline and save a repeatable preset.</p>
        </div>
        <div style={headerActionsStyle}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportPreset()}><Download size={14} /> Export PDF</button>
        </div>
      </div>

      <section style={panelStyle}>
        <div style={panelTitleStyle}>Hero Camera</div>
        <div style={heroRowStyle}>
          {cameraConfigs.map((config) => (
            <button
              key={config.slot}
              type="button"
              className={`btn btn-sm ${heroSlot === config.slot ? "btn-secondary" : "btn-ghost"}`}
              style={heroSlot === config.slot ? heroButtonActiveStyle : heroButtonStyle}
              onClick={() => setHeroSlot(config.slot)}
            >
              {config.slot} · {config.brand || "Camera"} {config.model || ""}
            </button>
          ))}
        </div>
        <div style={heroSummaryStyle}>{payload.hero_summary}</div>
      </section>

      <section style={{ ...panelStyle, marginTop: 18 }}>
        <div style={panelTitleStyle}>Match Steps</div>
        <div style={stepGridStyle}>
          {payload.steps.map((step) => (
            <div key={step.slot} style={stepCardStyle}>
              <div style={sectionEyebrowStyle}>{step.slot} Camera</div>
              <h3 style={{ margin: "4px 0 10px" }}>{step.camera_label}</h3>
              <ul style={bulletListStyle}>
                {step.checklist.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...panelStyle, marginTop: 18 }}>
        <div style={panelTitleStyle}>Save Look Profile Preset</div>
        <div style={saveRowStyle}>
          <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" style={inputStyle} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void savePreset()}><Save size={14} /> Save Preset</button>
        </div>
        {presets.length > 0 && (
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {presets.map((preset) => (
              <div key={preset.id} style={savedPresetRowStyle}>
                <span>{preset.name}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{new Date(preset.updated_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const headerRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "center", marginBottom: 20, flexWrap: "wrap" };
const headerMetaBlockStyle: React.CSSProperties = { display: "grid", gap: 4, minWidth: 0 };
const headerProjectNameStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "0.98rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const subtleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: "0.86rem" };
const subtleHintStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" };
const headerActionsStyle: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", justifyContent: "flex-end" };
const panelStyle: React.CSSProperties = { padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" };
const panelTitleStyle: React.CSSProperties = { marginBottom: 12, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 800 };
const heroRowStyle: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 };
const heroButtonStyle: React.CSSProperties = { borderColor: "rgba(255,255,255,0.08)" };
const heroButtonActiveStyle: React.CSSProperties = { borderColor: "rgba(0,209,255,0.28)", color: "var(--color-accent)" };
const heroSummaryStyle: React.CSSProperties = { color: "var(--text-secondary)", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" };
const sectionEyebrowStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", fontWeight: 800, marginBottom: 8 };
const stepGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, alignItems: "stretch" };
const stepCardStyle: React.CSSProperties = { padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" };
const bulletListStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, color: "var(--text-secondary)", display: "grid", gap: 6 };
const saveRowStyle: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" };
const inputStyle: React.CSSProperties = { flex: 1, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)" };
const savedPresetRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" };
