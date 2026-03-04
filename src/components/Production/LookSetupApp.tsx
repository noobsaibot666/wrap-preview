import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, Download, RefreshCw } from "lucide-react";
import {
  LookPreset,
  ProductionCameraConfig,
  ProductionLookOutputs,
  ProductionLookSetup,
  ProductionProject,
} from "../../types";
import { exportProductionImage, exportProductionPdf } from "../../utils/ProductionExport";
import { invokeGuarded } from "../../utils/tauri";
import {
  buildDefaultCameraConfig,
  buildDefaultLookSetup,
  buildLookOutputs,
  findCameraProfile,
  getSelectedBaseIso,
  getSelectedMode,
  isCameraComplete,
  LIGHTING_CONSTRAINTS,
  listCameraBrands,
  listModelsByBrand,
  listModes,
  LOOK_TARGETS,
  normalizeCameraAfterBrandChange,
  normalizeCameraAfterModelChange,
  normalizeCameraAfterModeChange,
  parseLookOutputs,
  PRODUCTION_SLOTS,
  stringifyBaseIsoList,
} from "./productionLogic";

interface LookSetupAppProps {
  project: ProductionProject;
  onBack: () => void;
}

export function LookSetupApp({ project, onBack }: LookSetupAppProps) {
  const [lookPresets, setLookPresets] = useState<LookPreset[]>([]);
  const [cameraConfigs, setCameraConfigs] = useState<ProductionCameraConfig[]>([]);
  const [setup, setSetup] = useState<ProductionLookSetup>(buildDefaultLookSetup(project.id));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mobileMode, setMobileMode] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [project.id]);

  const load = async () => {
    setLoading(true);
    try {
      const [presets, savedConfigs, savedSetup] = await Promise.all([
        invokeGuarded<LookPreset[]>("get_look_presets"),
        invokeGuarded<ProductionCameraConfig[]>("list_production_camera_configs", { projectId: project.id }),
        invokeGuarded<ProductionLookSetup | null>("production_get_look_setup", { projectId: project.id }),
      ]);
      setLookPresets(presets);
      setCameraConfigs(
        PRODUCTION_SLOTS.map((slot) => savedConfigs.find((item) => item.slot === slot) ?? buildDefaultCameraConfig(project.id, slot)),
      );
      setSetup(savedSetup ?? buildDefaultLookSetup(project.id));
    } finally {
      setLoading(false);
    }
  };

  const outputs = useMemo<ProductionLookOutputs | null>(() => parseLookOutputs(setup.outputs_json), [setup.outputs_json]);
  const recommendationsBySlot = useMemo(() => {
    const map = new Map<string, ProductionLookOutputs["recommendations"][number]>();
    for (const item of outputs?.recommendations ?? []) {
      map.set(item.slot, item);
    }
    return map;
  }, [outputs]);

  const saveAll = async (nextConfigs: ProductionCameraConfig[], nextSetup: ProductionLookSetup) => {
    setSaving(true);
    try {
      await Promise.all(nextConfigs.map((config) => invokeGuarded("save_production_camera_config", { config })));
      await invokeGuarded("production_save_look_setup", { setup: nextSetup });
      setCameraConfigs(nextConfigs);
      setSetup(nextSetup);
    } finally {
      setSaving(false);
    }
  };

  const setCameraConfig = (slot: string, nextConfig: ProductionCameraConfig) => {
    setCameraConfigs((prev) => prev.map((item) => (item.slot === slot ? nextConfig : item)));
  };

  const updateCamera = (slot: string, patch: Partial<ProductionCameraConfig>) => {
    setCameraConfigs((prev) => prev.map((item) => (item.slot === slot ? { ...item, ...patch } : item)));
  };

  const buildExportSections = () =>
    cameraConfigs.map((config) => {
      const recommendation = recommendationsBySlot.get(config.slot);
      const mode = getSelectedMode(config);
      const facts = [
        `Brand: ${config.brand || "Not set"}`,
        `Model: ${config.model || "Not set"}`,
        `Mode: ${mode?.label || "Not set"}`,
        `Base ISO: ${getSelectedBaseIso(config) ?? "Not set"}`,
        `Lens character: ${config.lens_character || "Not set"}`,
        `Diffusion: ${config.diffusion || "Not set"}`,
      ];
      if (!recommendation) {
        return { title: `${config.slot} Camera`, lines: [...facts, "Outputs not generated yet."] };
      }
      return {
        title: `${config.slot} Camera · ${recommendation.camera_label}`,
        lines: [
          ...facts,
          recommendation.capture_format,
          recommendation.capture_format_basis,
          recommendation.iso_strategy,
          recommendation.iso_strategy_basis,
          recommendation.white_balance_rule,
          recommendation.white_balance_rule_basis,
          recommendation.detail_rule,
          recommendation.detail_rule_basis,
          recommendation.exposure_target,
          recommendation.exposure_target_basis,
          recommendation.monitoring_class,
          recommendation.monitoring_class_basis,
          ...recommendation.discipline_checklist.map((line) => `Checklist: ${line}`),
        ],
      };
    });

  const handleGenerate = async () => {
    const nextOutputs = buildLookOutputs(setup, cameraConfigs);
    const nextSetup = { ...setup, outputs_json: JSON.stringify(nextOutputs) };
    await saveAll(cameraConfigs, nextSetup);
  };

  const handleExport = async (kind: "pdf" | "image") => {
    const options = {
      fileName: kind === "pdf" ? `${project.name}_LookSetup.pdf` : `${project.name}_LookSetup.jpg`,
      title: "Look Setup",
      subtitle: "Production",
      projectName: project.name,
      clientName: project.client_name,
      sections: buildExportSections(),
    };
    setExportMenuOpen(false);
    if (kind === "pdf") {
      await exportProductionPdf(options);
      return;
    }
    await exportProductionImage(options);
  };

  if (loading) {
    return <div className="inline-loading-state" style={{ padding: 40 }}>Loading look setup...</div>;
  }

  return (
    <div className="scrollable-view" style={{ padding: 32 }}>
      <div style={headerRowStyle}>
        <div>
          <div style={eyebrowStyle}>Production · Look Setup</div>
          <h1 style={{ margin: "6px 0 8px" }}>{project.name}</h1>
          <p style={subtleStyle}>Client: {project.client_name}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMobileMode((prev) => !prev)}>
            {mobileMode ? "Studio View" : "Mobile Checklist"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleGenerate()} disabled={saving}>
            <RefreshCw size={14} /> {saving ? "Saving..." : "Generate Outputs"}
          </button>
          <div style={{ position: "relative" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExportMenuOpen((prev) => !prev)} disabled={!outputs}>
              <Download size={14} /> Export <ChevronDown size={14} />
            </button>
            {exportMenuOpen && (
              <div style={exportMenuStyle}>
                <button type="button" style={exportItemStyle} onClick={() => void handleExport("pdf")}>Export PDF</button>
                <button type="button" style={exportItemStyle} onClick={() => void handleExport("image")}>Export Image</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <section style={guidanceWrapStyle}>
        <div style={guidanceCardStyle}>
          <div style={guidanceTitleStyle}>Target Look</div>
          <div style={guidanceCopyStyle}>
            Choose the target look that should steer white balance, monitoring class, and contrast discipline. The selected look affects outputs directly.
          </div>
          <select value={setup.target_type} onChange={(event) => setSetup((prev) => ({ ...prev, target_type: event.target.value }))} style={inputStyle}>
            {LOOK_TARGETS.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
          </select>
          <div style={helperTextStyle}>{LOOK_TARGETS.find((target) => target.id === setup.target_type)?.helper}</div>
        </div>
        <div style={guidanceCardStyle}>
          <div style={guidanceTitleStyle}>Shooting Conditions</div>
          <div style={guidanceCopyStyle}>
            Set the lighting reality for the day. This drives the white-balance band, monitoring caution, and highlight discipline rules.
          </div>
          <select value={setup.lighting} onChange={(event) => setSetup((prev) => ({ ...prev, lighting: event.target.value }))} style={inputStyle}>
            {LIGHTING_CONSTRAINTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div style={helperTextStyle}>{LIGHTING_CONSTRAINTS.find((item) => item.id === setup.lighting)?.helper}</div>
        </div>
        <div style={guidanceCardStyle}>
          <div style={guidanceTitleStyle}>Skin Priority</div>
          <div style={guidanceCopyStyle}>
            Turn this on when faces must win every exposure decision. Turn it off when you need a more evenly balanced frame.
          </div>
          <label style={toggleWrapStyle}>
            <input type="checkbox" checked={setup.skin_priority} onChange={(event) => setSetup((prev) => ({ ...prev, skin_priority: event.target.checked }))} />
            <span>{setup.skin_priority ? "Faces first" : "Balanced frame"}</span>
          </label>
        </div>
        <div style={guidanceCardStyle}>
          <div style={guidanceTitleStyle}>Custom Target Notes</div>
          <div style={guidanceCopyStyle}>
            Included in export. These notes only shape the generated outputs when the target look is set to Custom.
          </div>
          <textarea value={setup.custom_notes ?? ""} onChange={(event) => setSetup((prev) => ({ ...prev, custom_notes: event.target.value }))} placeholder="Custom target notes" style={{ ...inputStyle, minHeight: 110, resize: "vertical" }} />
          {lookPresets.length > 0 && (
            <div style={helperTextStyle}>Starter references: {lookPresets.map((preset) => preset.name).join(" · ")}</div>
          )}
        </div>
      </section>

      {mobileMode ? (
        <div style={mobileChecklistStyle}>
          {cameraConfigs.map((config) => {
            const recommendation = recommendationsBySlot.get(config.slot);
            return (
              <section key={config.slot} style={mobileCardStyle}>
                <div style={sectionEyebrowStyle}>{config.slot} Camera</div>
                <h3 style={{ margin: "4px 0 10px" }}>{recommendation?.camera_label || "Awaiting camera selection"}</h3>
                <div style={mobileLineStyle}>{recommendation?.exposure_target || "Select camera profile, mode, and base ISO to generate guidance."}</div>
                <div style={mobileLineStyle}>{recommendation?.white_balance_rule || "White-balance guidance will appear here."}</div>
                <div style={mobileLineStyle}>{recommendation?.iso_strategy || "ISO guidance will appear here."}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div style={columnLayoutStyle}>
          {cameraConfigs.map((config) => {
            const recommendation = recommendationsBySlot.get(config.slot);
            const complete = isCameraComplete(config);
            const brandOptions = listCameraBrands();
            const modelOptions = config.brand ? listModelsByBrand(config.brand) : [];
            const modeOptions = config.brand && config.model ? listModes(config.brand, config.model) : [];
            const selectedMode = getSelectedMode(config);
            const selectedIso = getSelectedBaseIso(config);
            const profile = config.brand && config.model ? findCameraProfile(config.brand, config.model) : undefined;

            return (
              <div key={config.slot} style={cameraColumnStyle}>
                <article style={{
                  ...panelStyle,
                  border: complete ? "1px solid rgba(74, 222, 128, 0.35)" : "1px solid rgba(249, 115, 22, 0.24)",
                  boxShadow: complete ? "0 0 0 1px rgba(74,222,128,0.08) inset" : "0 0 0 1px rgba(249,115,22,0.05) inset",
                }}>
                  <div style={cameraHeaderStyle}>
                    <div>
                      <div style={panelTitleStyle}>{config.slot} Camera</div>
                      <div style={{ color: complete ? "#86efac" : "#fdba74", fontSize: "0.82rem", fontWeight: 700 }}>
                        {complete ? "Complete" : "Missing required selections"}
                      </div>
                    </div>
                    {complete && <CheckCircle2 size={18} color="#4ade80" />}
                  </div>

                  <div style={fieldGridStyle}>
                    <select value={config.brand} onChange={(event) => setCameraConfig(config.slot, normalizeCameraAfterBrandChange(config, event.target.value))} style={inputStyle}>
                      <option value="">Select brand</option>
                      {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                    </select>
                    <select value={config.model} onChange={(event) => setCameraConfig(config.slot, normalizeCameraAfterModelChange(config, event.target.value))} style={inputStyle} disabled={!config.brand}>
                      <option value="">Select model</option>
                      {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                    <select value={config.recording_mode} onChange={(event) => setCameraConfig(config.slot, normalizeCameraAfterModeChange(config, event.target.value))} style={inputStyle} disabled={!config.brand || !config.model}>
                      <option value="">Select recording mode</option>
                      {modeOptions.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                    </select>
                    <select
                      value={selectedIso ?? ""}
                      onChange={(event) => updateCamera(config.slot, { base_iso_list_json: stringifyBaseIsoList([Number(event.target.value)]) })}
                      style={inputStyle}
                      disabled={!selectedMode}
                    >
                      <option value="">Select base ISO</option>
                      {(selectedMode?.baseISO ?? []).map((iso) => <option key={iso} value={iso}>{iso}</option>)}
                    </select>
                    <input value={config.lens_character ?? ""} onChange={(event) => updateCamera(config.slot, { lens_character: event.target.value })} placeholder="Lens character" style={inputStyle} />
                    <input value={config.diffusion ?? ""} onChange={(event) => updateCamera(config.slot, { diffusion: event.target.value })} placeholder="Diffusion" style={inputStyle} />
                    <textarea value={config.notes ?? ""} onChange={(event) => updateCamera(config.slot, { notes: event.target.value })} placeholder="Camera notes" style={{ ...inputStyle, minHeight: 88, gridColumn: "1 / -1", resize: "vertical" }} />
                  </div>

                  <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {profile?.notes || "Select a curated camera profile to load factual capture and monitoring guidance."}
                    {selectedMode?.notes ? ` ${selectedMode.notes}` : ""}
                  </div>
                </article>

                <article style={{
                  ...outputPanelStyle,
                  border: recommendation?.complete ? "1px solid rgba(74, 222, 128, 0.22)" : "1px solid rgba(96, 165, 250, 0.18)",
                }}>
                  <div style={sectionEyebrowStyle}>{config.slot} Output</div>
                  <h3 style={{ margin: "0 0 10px" }}>{recommendation?.camera_label || "Awaiting camera profile"}</h3>
                  {!recommendation ? (
                    <div style={emptyOutputStyle}>Generate outputs to show deterministic guidance here.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      <OutputBlock label="Capture format" value={recommendation.capture_format} basis={recommendation.capture_format_basis} />
                      <OutputBlock label="ISO strategy" value={recommendation.iso_strategy} basis={recommendation.iso_strategy_basis} />
                      <OutputBlock label="WB rule" value={recommendation.white_balance_rule} basis={recommendation.white_balance_rule_basis} />
                      <OutputBlock label="Texture rule" value={recommendation.detail_rule} basis={recommendation.detail_rule_basis} />
                      <OutputBlock label="Zebra / waveform targets" value={recommendation.exposure_target} basis={recommendation.exposure_target_basis} />
                      <OutputBlock label="Monitoring" value={recommendation.monitoring_class} basis={recommendation.monitoring_class_basis} />
                      <div>
                        <div style={outputLabelStyle}>On-set discipline</div>
                        <ul style={bulletListStyle}>
                          {recommendation.discipline_checklist.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                      </div>
                      {recommendation.warnings.length > 0 && (
                        <div>
                          <div style={{ ...outputLabelStyle, color: "#fca5a5" }}>Warnings</div>
                          <ul style={bulletListStyle}>
                            {recommendation.warnings.map((line) => <li key={line}>{line}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OutputBlock({ label, value, basis }: { label: string; value: string; basis: string }) {
  return (
    <div>
      <div style={outputLabelStyle}>{label}</div>
      <div style={outputValueStyle}>{value}</div>
      <div style={basisStyle}>{basis}</div>
    </div>
  );
}

const headerRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 20 };
const eyebrowStyle: React.CSSProperties = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800, color: "var(--text-muted)" };
const subtleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)" };
const panelStyle: React.CSSProperties = { padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.025)" };
const outputPanelStyle: React.CSSProperties = { padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.018)" };
const panelTitleStyle: React.CSSProperties = { marginBottom: 8, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 800 };
const fieldGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)" };
const toggleWrapStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)", fontWeight: 600 };
const guidanceWrapStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 20 };
const guidanceCardStyle: React.CSSProperties = { padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)" };
const guidanceTitleStyle: React.CSSProperties = { marginBottom: 6, fontSize: "0.76rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 800 };
const guidanceCopyStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.86rem", lineHeight: 1.45, marginBottom: 10 };
const helperTextStyle: React.CSSProperties = { marginTop: 8, color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.4 };
const columnLayoutStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 };
const cameraColumnStyle: React.CSSProperties = { display: "grid", gap: 14, alignContent: "start" };
const cameraHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 };
const sectionEyebrowStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-accent)", fontWeight: 800, marginBottom: 8 };
const outputLabelStyle: React.CSSProperties = { marginBottom: 4, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.11em", color: "var(--text-muted)", fontWeight: 800 };
const outputValueStyle: React.CSSProperties = { color: "var(--text-primary)", lineHeight: 1.48 };
const basisStyle: React.CSSProperties = { marginTop: 5, color: "#93c5fd", fontSize: "0.78rem", lineHeight: 1.38 };
const bulletListStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, color: "var(--text-secondary)", display: "grid", gap: 6 };
const emptyOutputStyle: React.CSSProperties = { color: "var(--text-muted)", lineHeight: 1.5 };
const mobileChecklistStyle: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" };
const mobileCardStyle: React.CSSProperties = { padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" };
const mobileLineStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.92rem", marginBottom: 8, lineHeight: 1.45 };
const exportMenuStyle: React.CSSProperties = { position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 160, padding: 8, borderRadius: 12, background: "#0c0d0f", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 40px rgba(0,0,0,0.4)", zIndex: 30, display: "grid", gap: 6 };
const exportItemStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" };
