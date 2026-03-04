import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  Gauge,
  HelpCircle,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
  SunMedium,
  Thermometer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  LookPreset,
  ProductionCameraConfig,
  ProductionDetailSection,
  ProductionLookOutputs,
  ProductionLookSetup,
  ProductionProject,
  ProductionQuickSetupRow,
} from "../../types";
import { exportProductionCallSheetImage, exportProductionCallSheetPdf } from "../../utils/ProductionExport";
import { invokeGuarded } from "../../utils/tauri";
import {
  buildDefaultCameraConfig,
  buildDefaultLookSetup,
  buildLookOutputs,
  findCameraProfile,
  getMissingCameraFields,
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [includeDetailsPages, setIncludeDetailsPages] = useState(false);

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

  const handleGenerate = async () => {
    const nextOutputs = buildLookOutputs(setup, cameraConfigs);
    const nextSetup = { ...setup, outputs_json: JSON.stringify(nextOutputs) };
    await saveAll(cameraConfigs, nextSetup);
  };

  const exportPayload = useMemo(() => ({
    fileNameBase: `${project.name}_LookSetup_CallSheet`,
    projectName: project.name,
    clientName: project.client_name,
    intent: [
      { label: "Target look", value: LOOK_TARGETS.find((target) => target.id === setup.target_type)?.label || "—" },
      { label: "Conditions", value: LIGHTING_CONSTRAINTS.find((item) => item.id === setup.lighting)?.label || "—" },
      { label: "Faces first", value: setup.skin_priority ? "On" : "Off" },
      { label: "Notes", value: setup.custom_notes?.trim() || "—" },
    ],
    cameras: cameraConfigs.map((config) => {
      const recommendation = recommendationsBySlot.get(config.slot);
      return {
        slot: config.slot,
        title: recommendation?.camera_label || `${config.slot} Camera`,
        subtitle: [
          config.brand || "Brand —",
          config.model || "Model —",
          getSelectedMode(config)?.label || "Mode —",
          getSelectedBaseIso(config) ? `ISO ${getSelectedBaseIso(config)}` : "ISO —",
        ].join(" • "),
        quickRows: recommendation?.quickSetup ?? [],
        details: recommendation?.details ?? [],
      };
    }),
  }), [cameraConfigs, project.client_name, project.name, recommendationsBySlot, setup.custom_notes, setup.lighting, setup.skin_priority, setup.target_type]);

  const handleExport = async (kind: "pdf" | "image") => {
    setExportMenuOpen(false);
    if (kind === "pdf") {
      await exportProductionCallSheetPdf({
        fileName: `${exportPayload.fileNameBase}.pdf`,
        title: "Look Setup Call Sheet",
        projectName: exportPayload.projectName,
        clientName: exportPayload.clientName,
        intent: exportPayload.intent,
        cameras: exportPayload.cameras,
        includeDetailsPages,
      });
      return;
    }
    await exportProductionCallSheetImage({
      fileName: `${exportPayload.fileNameBase}.jpg`,
      title: "Look Setup Call Sheet",
      projectName: exportPayload.projectName,
      clientName: exportPayload.clientName,
      intent: exportPayload.intent,
      cameras: exportPayload.cameras,
    });
  };

  if (loading) {
    return <div className="inline-loading-state" style={{ padding: 40 }}>Loading look setup...</div>;
  }

  return (
    <div className="scrollable-view" style={{ padding: 24 }}>
      <div style={headerRowStyle}>
        <div>
          <div style={eyebrowStyle}>Production · Look Setup</div>
          <h1 style={{ margin: "6px 0 8px" }}>{project.name}</h1>
          <p style={subtleStyle}>Client: {project.client_name}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleGenerate()} disabled={saving}>
            <RefreshCw size={14} /> {saving ? "Saving..." : "Generate Outputs"}
          </button>
          <div style={{ position: "relative" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExportMenuOpen((prev) => !prev)} disabled={!outputs}>
              <Download size={14} /> Export <ChevronDown size={14} />
            </button>
            {exportMenuOpen && (
              <div style={exportMenuStyle}>
                <label style={exportToggleStyle}>
                  <input type="checkbox" checked={includeDetailsPages} onChange={(event) => setIncludeDetailsPages(event.target.checked)} />
                  <span>Include details pages</span>
                </label>
                <button type="button" style={exportItemStyle} onClick={() => void handleExport("pdf")}>Export Call Sheet (PDF)</button>
                <button type="button" style={exportItemStyle} onClick={() => void handleExport("image")}>Export Call Sheet (Image)</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <section style={intentStripStyle}>
        <IntentControl
          label="Target look"
          helper={LOOK_TARGETS.find((target) => target.id === setup.target_type)?.helper || "Select the look target."}
          control={(
            <select value={setup.target_type} onChange={(event) => setSetup((prev) => ({ ...prev, target_type: event.target.value }))} style={compactInputStyle}>
              {LOOK_TARGETS.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select>
          )}
        />
        <IntentControl
          label="Conditions"
          helper={LIGHTING_CONSTRAINTS.find((item) => item.id === setup.lighting)?.helper || "Select the shooting conditions."}
          control={(
            <select value={setup.lighting} onChange={(event) => setSetup((prev) => ({ ...prev, lighting: event.target.value }))} style={compactInputStyle}>
              {LIGHTING_CONSTRAINTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          )}
        />
        <IntentControl
          label="Faces first"
          helper="When on, skin density wins before the rest of the frame."
          control={(
            <label style={togglePillStyle}>
              <input type="checkbox" checked={setup.skin_priority} onChange={(event) => setSetup((prev) => ({ ...prev, skin_priority: event.target.checked }))} />
              <span>{setup.skin_priority ? "On" : "Off"}</span>
            </label>
          )}
        />
        <details style={notesDrawerStyle}>
          <summary style={notesSummaryStyle}>Notes</summary>
          <textarea
            value={setup.custom_notes ?? ""}
            onChange={(event) => setSetup((prev) => ({ ...prev, custom_notes: event.target.value }))}
            placeholder={lookPresets.length > 0 ? `Optional. Starter refs: ${lookPresets.map((preset) => preset.name).join(" · ")}` : "Optional custom notes"}
            style={notesAreaStyle}
          />
        </details>
      </section>

      <div style={columnLayoutStyle}>
        {cameraConfigs.map((config) => {
          const recommendation = recommendationsBySlot.get(config.slot);
          const complete = isCameraComplete(config);
          const missingFields = getMissingCameraFields(config);
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
                border: complete ? "1px solid rgba(34,197,94,0.28)" : "1px solid rgba(245,158,11,0.24)",
                boxShadow: complete ? "0 0 0 1px rgba(34,197,94,0.08) inset" : "none",
              }}>
                <div style={cameraHeaderStyle}>
                  <div>
                    <div style={panelTitleStyle}>{config.slot} Camera</div>
                    <div style={cameraStatusLineStyle}>
                      {complete ? (
                        <span style={readyBadgeStyle}><CheckCircle2 size={13} /> Ready</span>
                      ) : (
                        <span style={missingLineStyle}>Missing: {missingFields.join(", ")}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={fieldGridStyle}>
                  <select value={config.brand} onChange={(event) => setCameraConfig(config.slot, normalizeCameraAfterBrandChange(config, event.target.value))} style={compactInputStyle}>
                    <option value="">Brand</option>
                    {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                  </select>
                  <select value={config.model} onChange={(event) => setCameraConfig(config.slot, normalizeCameraAfterModelChange(config, event.target.value))} style={compactInputStyle} disabled={!config.brand}>
                    <option value="">Model</option>
                    {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <select value={config.recording_mode} onChange={(event) => setCameraConfig(config.slot, normalizeCameraAfterModeChange(config, event.target.value))} style={compactInputStyle} disabled={!config.brand || !config.model}>
                    <option value="">Mode</option>
                    {modeOptions.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                  </select>
                  <select
                    value={selectedIso ?? ""}
                    onChange={(event) => updateCamera(config.slot, { base_iso_list_json: stringifyBaseIsoList([Number(event.target.value)]) })}
                    style={compactInputStyle}
                    disabled={!selectedMode}
                  >
                    <option value="">Base ISO</option>
                    {(selectedMode?.baseISO ?? []).map((iso) => <option key={iso} value={iso}>{iso}</option>)}
                  </select>
                  <input value={config.lens_character ?? ""} onChange={(event) => updateCamera(config.slot, { lens_character: event.target.value })} placeholder="Lens character" style={compactInputStyle} />
                  <input value={config.diffusion ?? ""} onChange={(event) => updateCamera(config.slot, { diffusion: event.target.value })} placeholder="Diffusion" style={compactInputStyle} />
                </div>

                <div style={cameraFootnoteStyle}>
                  {profile?.notes || "Select a curated camera profile to load deterministic targets."}
                  {selectedMode?.notes ? ` ${selectedMode.notes}` : ""}
                </div>
              </article>

              <article style={{
                ...outputPanelStyle,
                border: recommendation?.complete ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(255,255,255,0.08)",
              }}>
                <div style={outputHeaderStyle}>
                  <div>
                    <div style={sectionEyebrowStyle}>{config.slot} Quick Setup</div>
                    <h3 style={{ margin: 0 }}>{recommendation?.camera_label || "Awaiting camera profile"}</h3>
                  </div>
                  {recommendation?.complete && <span style={readyBadgeStyle}><CheckCircle2 size={13} /> Ready</span>}
                </div>
                {!recommendation ? (
                  <div style={emptyOutputStyle}>Generate outputs to show compact camera actions here.</div>
                ) : (
                  <>
                    <div style={quickRowsWrapStyle}>
                      {(recommendation.quickSetup ?? []).slice(0, 6).map((row) => (
                        <QuickRow key={row.key} row={row} />
                      ))}
                    </div>
                    <details style={detailsWrapStyle}>
                      <summary style={detailsSummaryStyle}>More details</summary>
                      <div style={detailsGridStyle}>
                        {(recommendation.details ?? []).map((section) => (
                          <DetailSection key={section.section} section={section} />
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </article>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntentControl({
  label,
  helper,
  control,
}: {
  label: string;
  helper: string;
  control: React.ReactNode;
}) {
  return (
    <div style={intentCellStyle}>
      <div style={intentLabelStyle}>
        <span>{label}</span>
        <span title={helper} style={helpIconStyle}><HelpCircle size={13} /></span>
      </div>
      {control}
    </div>
  );
}

function QuickRow({ row }: { row: ProductionQuickSetupRow }) {
  const Icon = iconMap[row.icon] ?? Camera;
  const isMissing = row.status === "missing";
  return (
    <div style={{ ...quickRowStyle, borderColor: isMissing ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.06)" }}>
      <div style={quickRowLeftStyle}>
        <span style={{ ...quickIconWrapStyle, color: isMissing ? "#f59e0b" : "#8fc5ff" }}><Icon size={14} /></span>
        <span style={quickLabelStyle}>{row.label}</span>
      </div>
      <div style={quickValueWrapStyle}>
        <span style={{ ...quickValueStyle, color: isMissing ? "#f3d19b" : "var(--text-primary)" }}>{row.value}</span>
        {row.badge && (
          <span style={isMissing ? missingBadgeStyle : monitoringBadgeStyle}>{row.badge}</span>
        )}
      </div>
    </div>
  );
}

function DetailSection({ section }: { section: ProductionDetailSection }) {
  return (
    <div style={detailSectionStyle}>
      <div style={detailSectionTitleStyle}>{section.section}</div>
      <div style={{ display: "grid", gap: 10 }}>
        {section.items.map((item) => (
          <div key={`${section.section}:${item.label}`}>
            <div style={detailItemLabelStyle}>{item.label}</div>
            <div style={detailItemTextStyle}>{item.text}</div>
            <div style={detailItemSourceStyle}>Based on: {item.source.join(" + ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const iconMap: Record<string, LucideIcon> = {
  capture: Camera,
  iso: Gauge,
  wb: Thermometer,
  exposure: SunMedium,
  texture: SlidersHorizontal,
  monitoring: Monitor,
};

const headerRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" };
const eyebrowStyle: React.CSSProperties = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800, color: "var(--text-muted)" };
const subtleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)" };
const panelStyle: React.CSSProperties = { padding: 16, borderRadius: 18, background: "rgba(255,255,255,0.025)" };
const outputPanelStyle: React.CSSProperties = { padding: 16, borderRadius: 18, background: "rgba(255,255,255,0.018)" };
const panelTitleStyle: React.CSSProperties = { marginBottom: 6, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 800 };
const cameraHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 10 };
const cameraStatusLineStyle: React.CSSProperties = { minHeight: 24, display: "flex", alignItems: "center" };
const readyBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#86efac", fontSize: "0.74rem", fontWeight: 700 };
const missingLineStyle: React.CSSProperties = { color: "#f3d19b", fontSize: "0.8rem", fontWeight: 600 };
const cameraFootnoteStyle: React.CSSProperties = { marginTop: 10, color: "var(--text-muted)", fontSize: "0.78rem", lineHeight: 1.45 };
const fieldGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 };
const compactInputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)" };
const intentStripStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 18, padding: 12, borderRadius: 18, background: "rgba(255,255,255,0.022)", border: "1px solid rgba(255,255,255,0.08)" };
const intentCellStyle: React.CSSProperties = { minWidth: 0 };
const intentLabelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.11em", color: "var(--text-muted)", fontWeight: 800 };
const helpIconStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", color: "var(--text-muted)", cursor: "help" };
const togglePillStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minHeight: 42, padding: "0 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", fontWeight: 600 };
const notesDrawerStyle: React.CSSProperties = { minWidth: 0, alignSelf: "stretch", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" };
const notesSummaryStyle: React.CSSProperties = { cursor: "pointer", listStyle: "none", fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)" };
const notesAreaStyle: React.CSSProperties = { marginTop: 10, width: "100%", minHeight: 86, resize: "vertical", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(10,10,12,0.6)", color: "var(--text-primary)" };
const columnLayoutStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" };
const cameraColumnStyle: React.CSSProperties = { display: "grid", gap: 12, alignContent: "start" };
const sectionEyebrowStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-accent)", fontWeight: 800, marginBottom: 8 };
const outputHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 10 };
const emptyOutputStyle: React.CSSProperties = { color: "var(--text-muted)", lineHeight: 1.5, minHeight: 130, display: "flex", alignItems: "center" };
const quickRowsWrapStyle: React.CSSProperties = { display: "grid", gap: 0 };
const quickRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", minHeight: 44, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" };
const quickRowLeftStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 110 };
const quickIconWrapStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22 };
const quickLabelStyle: React.CSSProperties = { fontSize: "0.76rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", fontWeight: 800 };
const quickValueWrapStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 0, flex: 1 };
const quickValueStyle: React.CSSProperties = { fontSize: "0.9rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const monitoringBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "rgba(59,130,246,0.14)", color: "#9ac4ff", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" };
const missingBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "rgba(245,158,11,0.12)", color: "#f5c46b", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" };
const detailsWrapStyle: React.CSSProperties = { marginTop: 10, paddingTop: 10 };
const detailsSummaryStyle: React.CSSProperties = { cursor: "pointer", listStyle: "none", color: "var(--text-secondary)", fontWeight: 700, fontSize: "0.84rem" };
const detailsGridStyle: React.CSSProperties = { marginTop: 12, display: "grid", gap: 10 };
const detailSectionStyle: React.CSSProperties = { padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" };
const detailSectionTitleStyle: React.CSSProperties = { marginBottom: 8, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.11em", color: "var(--text-muted)", fontWeight: 800 };
const detailItemLabelStyle: React.CSSProperties = { marginBottom: 4, fontSize: "0.72rem", color: "#cbd5e1", fontWeight: 700 };
const detailItemTextStyle: React.CSSProperties = { color: "var(--text-secondary)", lineHeight: 1.45, fontSize: "0.84rem" };
const detailItemSourceStyle: React.CSSProperties = { marginTop: 5, color: "#93c5fd", fontSize: "0.74rem", lineHeight: 1.35 };
const exportMenuStyle: React.CSSProperties = { position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 230, padding: 8, borderRadius: 12, background: "#0c0d0f", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 40px rgba(0,0,0,0.4)", zIndex: 30, display: "grid", gap: 6 };
const exportItemStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" };
const exportToggleStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", color: "var(--text-secondary)", fontSize: "0.82rem" };
