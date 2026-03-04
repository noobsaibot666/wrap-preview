import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ShieldAlert } from "lucide-react";
import { ProductionLookSetup, ProductionOnsetChecks, ProductionProject } from "../../types";
import { invokeGuarded } from "../../utils/tauri";
import { buildDefaultOnsetChecks, parseLookOutputs } from "./productionLogic";

interface OnSetCoachAppProps {
  project: ProductionProject;
  onBack: () => void;
}

interface ToggleItem {
  id: string;
  label: string;
  done?: boolean;
  active?: boolean;
}

export function OnSetCoachApp({ project, onBack }: OnSetCoachAppProps) {
  const [setup, setSetup] = useState<ProductionLookSetup | null>(null);
  const [checks, setChecks] = useState<ProductionOnsetChecks | null>(null);
  const [loading, setLoading] = useState(true);

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
    setChecks(next);
    await invokeGuarded("production_save_onset_checks", { checks: next });
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, marginBottom: 20 }}>
        <div>
          <div style={eyebrowStyle}>Production · On-Set Coach</div>
          <h1 style={{ margin: "6px 0 8px" }}>{project.name}</h1>
          <p style={subtleStyle}>Use the saved look setup outputs as the on-set baseline.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        {(outputs?.recommendations ?? []).map((item) => (
          <section key={item.slot} style={panelStyle}>
            <div style={sectionEyebrowStyle}>{item.slot} Camera</div>
            <h3 style={{ margin: "0 0 10px" }}>{item.camera_label}</h3>
            <button type="button" className={`btn btn-sm ${readyState[item.slot] ? "btn-secondary" : "btn-ghost"}`} onClick={() => void updateReady(item.slot)}>
              <CheckCircle2 size={14} /> {readyState[item.slot] ? "Ready" : "Mark Ready"}
            </button>
            <div style={{ marginTop: 14, display: "grid", gap: 8, color: "var(--text-secondary)" }}>
              <div>{item.exposure_target}</div>
              <div>{item.white_balance_rule}</div>
              <div>{item.iso_strategy}</div>
            </div>
          </section>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 20 }}>
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
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShieldAlert size={14} />
                  {item.label}
                </span>
                <span>{item.active ? "Flagged" : "Clear"}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const eyebrowStyle: React.CSSProperties = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800, color: "var(--text-muted)" };
const subtleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)" };
const panelStyle: React.CSSProperties = { padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" };
const sectionEyebrowStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-accent)", fontWeight: 800, marginBottom: 8 };
const panelTitleStyle: React.CSSProperties = { marginBottom: 12, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 800 };
const toggleRowStyle = (active: boolean): React.CSSProperties => ({ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: active ? "rgba(94,234,212,0.08)" : "rgba(255,255,255,0.03)", color: "var(--text-primary)", cursor: "pointer" });
const warningRowStyle = (active: boolean): React.CSSProperties => ({ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: active ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.03)", color: active ? "#fecaca" : "var(--text-primary)", cursor: "pointer" });
