import React, { useEffect, useMemo, useState } from "react";
import { ProductionLookSetup, ProductionOnsetChecks, ProductionProject } from "../../types";
import { invokeGuarded } from "../../utils/tauri";
import { buildDefaultOnsetChecks, parseLookOutputs } from "./productionLogic";

interface OnSetCoachAppProps {
  project: ProductionProject;
  onBack?: () => void;
}

interface ToggleItem {
  id: string;
  label: string;
  done?: boolean;
  active?: boolean;
}

export function OnSetCoachApp({ project }: OnSetCoachAppProps) {
  const [setup, setSetup] = useState<ProductionLookSetup | null>(null);
  const [checks, setChecks] = useState<ProductionOnsetChecks | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [project.id]);

  const load = async () => {
    setLoading(true);
    try {
      const [savedSetup, savedChecks] = await Promise.all([
        invokeGuarded<ProductionLookSetup | null>("production_get_look_setup", { projectId: project.id }),
        invokeGuarded<ProductionOnsetChecks | null>("production_get_onset_checks", { projectId: project.id }),
      ]);
      setSetup(savedSetup);
      setChecks(savedChecks ?? buildDefaultOnsetChecks(project.id));
    } finally {
      setLoading(false);
    }
  };

  const outputs = useMemo(() => parseLookOutputs(setup?.outputs_json), [setup?.outputs_json]);
  const readyState = useMemo<Record<string, boolean>>(() => checks ? JSON.parse(checks.ready_state_json) : {}, [checks]);
  const lightingChecks = useMemo<ToggleItem[]>(() => checks ? JSON.parse(checks.lighting_checks_json) : [], [checks]);
  const failureModes = useMemo<ToggleItem[]>(() => checks ? JSON.parse(checks.failure_modes_json) : [], [checks]);

  const persist = async (next: ProductionOnsetChecks) => {
    setSaving(true);
    setChecks(next);
    try {
      await invokeGuarded("production_save_onset_checks", { checks: next });
    } finally {
      setSaving(false);
    }
  };

  const resetChecks = async () => {
    const next = buildDefaultOnsetChecks(project.id);
    await persist({ ...next, updated_at: new Date().toISOString() });
  };

  const updateReady = async (slot: string) => {
    if (!checks) return;
    const nextState = { ...readyState, [slot]: !readyState[slot] };
    await persist({ ...checks, ready_state_json: JSON.stringify(nextState), updated_at: new Date().toISOString() });
  };

  const updateLightingCheck = async (id: string) => {
    if (!checks) return;
    const next = lightingChecks.map((item) => item.id === id ? { ...item, done: !item.done } : item);
    await persist({ ...checks, lighting_checks_json: JSON.stringify(next), updated_at: new Date().toISOString() });
  };

  const updateFailureMode = async (id: string) => {
    if (!checks) return;
    const next = failureModes.map((item) => item.id === id ? { ...item, active: !item.active } : item);
    await persist({ ...checks, failure_modes_json: JSON.stringify(next), updated_at: new Date().toISOString() });
  };

  if (loading || !checks) {
    return <div className="inline-loading-state" style={{ padding: 40 }}>Loading on-set coach...</div>;
  }

  return (
    <div className="scrollable-view" style={{ padding: 32 }}>
      <div style={headerRowStyle}>
        <div style={headerMetaBlockStyle}>
          <div style={headerProjectNameStyle}>Project {project.name}</div>
          <p style={subtleStyle}>Client {project.client_name}</p>
          <p style={subtleHintStyle}>Use the saved look setup outputs as the on-set baseline.</p>
        </div>
        <div style={headerActionsStyle}>
          <button
            type="button"
            className="btn btn-ghost btn-sm production-matchlab-analyze-button"
            onClick={() => void resetChecks()}
            disabled={saving}
          >
            {saving ? "Saving..." : "Reset Checks"}
          </button>
        </div>
      </div>

      <div style={cameraGridStyle}>
        {(outputs?.recommendations ?? []).map((item) => (
          <section key={item.slot} style={panelStyle}>
            <div style={sectionHeaderRowStyle}>
              <div style={sectionEyebrowStyle}>{item.slot} Camera</div>
              <span style={readyState[item.slot] ? readyBadgeStyle : pendingBadgeStyle}>
                {readyState[item.slot] ? "Ready" : "Open"}
              </span>
            </div>
            <h3 style={{ margin: "0 0 10px", fontSize: "1rem" }}>{item.camera_label}</h3>
            <button
              type="button"
              className={`btn btn-sm ${readyState[item.slot] ? "btn-secondary" : "btn-ghost"}`}
              style={readyButtonStyle(readyState[item.slot])}
              onClick={() => void updateReady(item.slot)}
            >
              {readyState[item.slot] ? "Ready" : "Mark Ready"}
            </button>
            <div style={cameraSignalListStyle}>
              <div style={cameraSignalItemStyle}>{item.exposure_target}</div>
              <div style={cameraSignalItemStyle}>{item.white_balance_rule}</div>
              <div style={cameraSignalItemStyle}>{item.iso_strategy}</div>
            </div>
          </section>
        ))}
      </div>

      <div style={checklistGridStyle}>
        <section style={panelStyle}>
          <div style={panelTitleStyle}>Lighting Checklist</div>
          <div style={{ display: "grid", gap: 10 }}>
            {lightingChecks.map((item) => (
              <button key={item.id} type="button" onClick={() => void updateLightingCheck(item.id)} style={toggleRowStyle(item.done === true)}>
                <span>{item.label}</span>
                <span>{item.done ? "Done" : "Open"}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={panelTitleStyle}>Failure Mode Warnings</div>
          <div style={{ display: "grid", gap: 10 }}>
            {failureModes.map((item) => (
              <button key={item.id} type="button" onClick={() => void updateFailureMode(item.id)} style={warningRowStyle(item.active === true)}>
                <span>{item.label}</span>
                <span>{item.active ? "Flagged" : "Clear"}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const headerRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "center", marginBottom: 20, flexWrap: "wrap" };
const headerMetaBlockStyle: React.CSSProperties = { display: "grid", gap: 4, minWidth: 0 };
const headerProjectNameStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "0.98rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const subtleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: "0.86rem" };
const subtleHintStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" };
const headerActionsStyle: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", justifyContent: "flex-end" };
const cameraGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "stretch" };
const checklistGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 18, alignItems: "start" };
const panelStyle: React.CSSProperties = { padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" };
const sectionHeaderRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 };
const sectionEyebrowStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", fontWeight: 800, marginBottom: 0 };
const readyBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#86efac", fontSize: "0.72rem", fontWeight: 700 };
const pendingBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)", fontSize: "0.72rem", fontWeight: 700 };
const readyButtonStyle = (active: boolean): React.CSSProperties => ({
  borderColor: active ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.08)",
  color: active ? "#86efac" : "var(--text-primary)",
});
const cameraSignalListStyle: React.CSSProperties = { marginTop: 12, display: "grid", gap: 8, color: "var(--text-secondary)" };
const cameraSignalItemStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", fontSize: "0.84rem", lineHeight: 1.35 };
const panelTitleStyle: React.CSSProperties = { marginBottom: 12, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 800 };
const toggleRowStyle = (active: boolean): React.CSSProperties => ({ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: active ? "rgba(94,234,212,0.08)" : "rgba(255,255,255,0.03)", color: "var(--text-primary)", cursor: "pointer" });
const warningRowStyle = (active: boolean): React.CSSProperties => ({ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: active ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.03)", color: active ? "#fecaca" : "var(--text-primary)", cursor: "pointer" });
