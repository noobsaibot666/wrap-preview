import {
  ProductionCameraConfig,
  ProductionDetailSection,
  ProductionLookOutputs,
  ProductionLookRecommendation,
  ProductionLookSetup,
  ProductionMatchPresetPayload,
  ProductionQuickSetupRow,
} from "../../types";
import { findCameraProfile, listCameraBrands, listModelsByBrand, listModes, ModeProfile } from "./cameraProfiles";

export const PRODUCTION_SLOTS = ["A", "B", "C"] as const;
export const LOOK_TARGETS = [
  { id: "arri_inspired", label: "ARRI-inspired", helper: "Soft shoulder and calm highlight roll-off." },
  { id: "fuji_inspired", label: "Fuji-inspired", helper: "Gentle separation and cleaner greens." },
  { id: "cine_neutral", label: "Clean Cine Neutral", helper: "Technical neutral baseline for the day." },
  { id: "custom", label: "Custom notes", helper: "Notes are exported and only shape outputs when Custom is selected." },
] as const;
export const LIGHTING_CONSTRAINTS = [
  { id: "controlled", label: "Controlled", helper: "Stable fixtures and repeatable white balance." },
  { id: "mixed", label: "Mixed", helper: "Protect faces from green or cool drift." },
  { id: "run_and_gun", label: "Run-and-gun", helper: "Simple guardrails for fast changes." },
] as const;

type LightingKey = "controlled" | "mixed" | "run_and_gun";
type SignalProfileKey = "BMD_FILM_GEN5" | "N_LOG" | "RED_IPP2" | "REC709";

interface SignalRule {
  signalId: SignalProfileKey;
  exposureRuleId: string;
  wbRuleId: string;
  monitorRuleId: string;
  detailRuleId: string;
  isoRuleId: string;
  skinIre?: [number, number];
  highlightCeiling?: number;
  wbRange: Record<LightingKey, string>;
  tintBias: string;
  monitoringLabel: string;
  monitoringWarning: string;
  disciplineChecklist: string[];
}

const SIGNAL_RULES: Record<SignalProfileKey, SignalRule> = {
  BMD_FILM_GEN5: {
    signalId: "BMD_FILM_GEN5",
    exposureRuleId: "RULE_BMDG5_IRE_01",
    wbRuleId: "RULE_BMDG5_WB_01",
    monitorRuleId: "RULE_BMDG5_MON_01",
    detailRuleId: "RULE_DETAIL_OFF_01",
    isoRuleId: "RULE_ISO_NATIVE_01",
    skinIre: [45, 52],
    highlightCeiling: 94,
    wbRange: {
      controlled: "4300-5600K",
      mixed: "4000-5200K",
      run_and_gun: "3200-5600K",
    },
    tintBias: "slight magenta bias",
    monitoringLabel: "Neutral LUT",
    monitoringWarning: "Don't trust Rec709",
    disciplineChecklist: [
      "Check false color before trusting the monitor image.",
      "Protect speculars before adding stop to faces.",
      "Hold subject separation before adding contrast taste.",
      "Recheck kelvin whenever the source mix changes.",
    ],
  },
  N_LOG: {
    signalId: "N_LOG",
    exposureRuleId: "RULE_NLOG_IRE_01",
    wbRuleId: "RULE_NLOG_WB_01",
    monitorRuleId: "RULE_NLOG_MON_01",
    detailRuleId: "RULE_DETAIL_OFF_01",
    isoRuleId: "RULE_ISO_NATIVE_01",
    skinIre: [42, 48],
    highlightCeiling: 92,
    wbRange: {
      controlled: "4300-5600K",
      mixed: "4000-5200K",
      run_and_gun: "3800-5600K",
    },
    tintBias: "slight magenta bias",
    monitoringLabel: "Neutral LUT",
    monitoringWarning: "Don't trust Rec709",
    disciplineChecklist: [
      "Watch highlight headroom before lifting faces.",
      "Lock tint early when practicals go green.",
      "Use false color or waveform for exposure calls.",
      "Recheck white balance after every location shift.",
    ],
  },
  RED_IPP2: {
    signalId: "RED_IPP2",
    exposureRuleId: "RULE_RED_IPP2_IRE_01",
    wbRuleId: "RULE_RED_IPP2_WB_01",
    monitorRuleId: "RULE_RED_IPP2_MON_01",
    detailRuleId: "RULE_DETAIL_OFF_01",
    isoRuleId: "RULE_ISO_NATIVE_01",
    skinIre: [41, 47],
    highlightCeiling: 95,
    wbRange: {
      controlled: "4300-5600K",
      mixed: "4000-5200K",
      run_and_gun: "3400-5600K",
    },
    tintBias: "warm-neutral skin bias",
    monitoringLabel: "Technical LUT",
    monitoringWarning: "Don't trust Rec709",
    disciplineChecklist: [
      "Protect the highlight shoulder before chasing shadow density.",
      "Keep skin warm-neutral before touching contrast.",
      "Confirm texture controls are still neutral.",
      "Set exposure from scopes, then sanity check the LUT.",
    ],
  },
  REC709: {
    signalId: "REC709",
    exposureRuleId: "RULE_709_IRE_01",
    wbRuleId: "RULE_709_WB_01",
    monitorRuleId: "RULE_709_MON_01",
    detailRuleId: "RULE_DETAIL_OFF_01",
    isoRuleId: "RULE_ISO_NATIVE_01",
    skinIre: [55, 65],
    highlightCeiling: 88,
    wbRange: {
      controlled: "4300-5600K",
      mixed: "4200-5200K",
      run_and_gun: "3600-5600K",
    },
    tintBias: "neutral-warm skin bias",
    monitoringLabel: "Neutral LUT",
    monitoringWarning: "Don't trust Rec709",
    disciplineChecklist: [
      "Keep contrast simple and readable.",
      "Avoid baking extra sharpness into the image.",
      "Watch skin and bright practicals at the same time.",
      "Reset white balance as the source mix moves.",
    ],
  },
};

export { listCameraBrands, listModelsByBrand, listModes, findCameraProfile };

export function stringifyBaseIsoList(values: number[]): string {
  return JSON.stringify(values.filter((value) => Number.isFinite(value) && value > 0));
}

export function parseBaseIsoList(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

export function getSelectedBaseIso(config: ProductionCameraConfig): number | null {
  const parsed = parseBaseIsoList(config.base_iso_list_json);
  return parsed[0] ?? null;
}

export function getMissingCameraFields(config: ProductionCameraConfig): string[] {
  const missing: string[] = [];
  if (!config.brand.trim()) missing.push("Brand");
  if (!config.model.trim()) missing.push("Model");
  if (!config.recording_mode.trim()) missing.push("Mode");
  if (!getSelectedBaseIso(config)) missing.push("Base ISO");
  return missing;
}

export function buildDefaultCameraConfig(projectId: string, slot: string): ProductionCameraConfig {
  return {
    id: `${projectId}:${slot}`,
    project_id: projectId,
    slot,
    brand: "",
    model: "",
    recording_mode: "",
    log_family: "",
    base_iso_list_json: JSON.stringify([]),
    lens_character: "",
    diffusion: "",
    notes: "",
  };
}

export function buildDefaultLookSetup(projectId: string): ProductionLookSetup {
  return {
    id: `${projectId}:look-setup`,
    project_id: projectId,
    target_type: "cine_neutral",
    custom_notes: "",
    lighting: "mixed",
    skin_priority: true,
    outputs_json: JSON.stringify({}),
  };
}

export function buildDefaultOnsetChecks(projectId: string) {
  return {
    id: `${projectId}:onset-checks`,
    project_id: projectId,
    ready_state_json: JSON.stringify({ A: false, B: false, C: false }),
    lighting_checks_json: JSON.stringify([
      { id: "false-color", label: "Confirm false color or waveform reference", done: false },
      { id: "key-side", label: "Check key-to-fill ratio on faces", done: false },
      { id: "speculars", label: "Control specular highlights before rolling", done: false },
      { id: "separation", label: "Keep subject separation readable", done: false },
    ]),
    failure_modes_json: JSON.stringify([
      { id: "cool-drift", label: "Cool drift creeping into skin", active: false },
      { id: "specular-clip", label: "Speculars reaching clip zone", active: false },
      { id: "monitor-bias", label: "Creative monitoring hiding exposure errors", active: false },
      { id: "texture-overcooked", label: "Sharpening or NR still active", active: false },
    ]),
    updated_at: new Date().toISOString(),
  };
}

export function parseLookOutputs(raw?: string | null): ProductionLookOutputs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProductionLookOutputs;
    if (!parsed || !Array.isArray(parsed.recommendations)) return null;
    return {
      ...parsed,
      recommendations: parsed.recommendations.map((item) => ({
        ...item,
        quickSetup: Array.isArray(item.quickSetup) ? item.quickSetup : [],
        details: Array.isArray(item.details) ? item.details : [],
      })),
    };
  } catch {
    return null;
  }
}

export function isCameraComplete(config: ProductionCameraConfig): boolean {
  if (!config.brand.trim() || !config.model.trim() || !config.recording_mode.trim()) return false;
  const selectedIso = getSelectedBaseIso(config);
  if (!selectedIso) return false;
  const mode = getSelectedMode(config);
  if (!mode) return false;
  return Boolean(mode.capture.logName || mode.capture.rawName);
}

export function getSelectedMode(config: ProductionCameraConfig): ModeProfile | null {
  const modes = listModes(config.brand, config.model);
  return modes.find((mode) => mode.id === config.recording_mode) ?? null;
}

export function normalizeCameraAfterBrandChange(config: ProductionCameraConfig, brand: string): ProductionCameraConfig {
  const models = listModelsByBrand(brand);
  const nextModel = models.includes(config.model) ? config.model : "";
  const modes = listModes(brand, nextModel);
  const nextMode = modes.find((mode) => mode.id === config.recording_mode) ?? null;
  return {
    ...config,
    brand,
    model: nextModel,
    recording_mode: nextMode?.id ?? "",
    log_family: nextMode?.capture.logName ?? "",
    base_iso_list_json: nextMode ? stringifyBaseIsoList([nextMode.baseISO[0]]) : JSON.stringify([]),
  };
}

export function normalizeCameraAfterModelChange(config: ProductionCameraConfig, model: string): ProductionCameraConfig {
  const modes = listModes(config.brand, model);
  const nextMode = modes.find((mode) => mode.id === config.recording_mode) ?? null;
  return {
    ...config,
    model,
    recording_mode: nextMode?.id ?? "",
    log_family: nextMode?.capture.logName ?? "",
    base_iso_list_json: nextMode ? stringifyBaseIsoList([nextMode.baseISO[0]]) : JSON.stringify([]),
  };
}

export function normalizeCameraAfterModeChange(config: ProductionCameraConfig, modeId: string): ProductionCameraConfig {
  const mode = listModes(config.brand, config.model).find((item) => item.id === modeId) ?? null;
  return {
    ...config,
    recording_mode: modeId,
    log_family: mode?.capture.logName ?? "",
    base_iso_list_json: mode ? stringifyBaseIsoList([mode.baseISO[0]]) : JSON.stringify([]),
  };
}

function formatSource(source: string[]): string {
  return `Based on: ${source.join(" + ")}`;
}

function buildQuickRow(
  key: string,
  label: string,
  value: string,
  icon: string,
  source: string[],
  status: "ready" | "missing" = "ready",
  badge?: string,
): ProductionQuickSetupRow {
  return { key, label, value, icon, source, status, badge };
}

function buildMissingRecommendation(config: ProductionCameraConfig, missing: string[]): ProductionLookRecommendation {
  const source = ["PROFILE_PENDING_SELECTION", "RULE_INPUT_REQUIRED_01"];
  return {
    slot: config.slot,
    camera_label: `${config.brand || "Camera"} ${config.model || config.slot}`.trim(),
    complete: false,
    missing,
    capture_format: `Missing: ${missing.join(", ")}.`,
    capture_format_basis: formatSource(source),
    iso_strategy: "Select a mode and base ISO to generate ISO guidance.",
    iso_strategy_basis: formatSource(source),
    white_balance_rule: "Select a profile to generate white-balance guidance.",
    white_balance_rule_basis: formatSource(source),
    detail_rule: "Select a profile to confirm texture guidance.",
    detail_rule_basis: formatSource(source),
    exposure_target: "Select a profile to show zebra and waveform targets.",
    exposure_target_basis: formatSource(source),
    monitoring_class: "Select a profile to show monitoring guidance.",
    monitoring_class_basis: formatSource(source),
    discipline_checklist: ["Finish the camera card before generating outputs."],
    warnings: [],
    quickSetup: [
      buildQuickRow("capture", "Capture", `Missing: ${missing.join(", ")}`, "capture", source, "missing"),
      buildQuickRow("iso", "ISO", "—", "iso", source, "missing"),
      buildQuickRow("wb", "WB", "—", "wb", source, "missing"),
      buildQuickRow("exposure", "Exposure", "—", "exposure", source, "missing"),
      buildQuickRow("texture", "Texture", "—", "texture", source, "missing"),
      buildQuickRow("monitoring", "Monitoring", "—", "monitoring", source, "missing"),
    ],
    details: [
      {
        section: "Missing inputs",
        items: [
          {
            label: "Required",
            text: `Complete these fields first: ${missing.join(", ")}.`,
            source,
          },
        ],
      },
    ],
  };
}

function getSignalRule(mode: ModeProfile): SignalRule | null {
  const signalProfile = mode.capture.signalProfile;
  if (!signalProfile) return null;
  return SIGNAL_RULES[signalProfile] ?? null;
}

function formatIsoQuick(mode: ModeProfile, selectedIso: number): string {
  if (mode.baseISO.length <= 1) {
    return `Base ${selectedIso} (stay base)`;
  }
  return `${mode.baseISO.join("/")} dual native • on ${selectedIso}`;
}

function formatExposureQuick(rule: SignalRule | null): { value: string; badge?: string } {
  if (!rule?.skinIre || !rule.highlightCeiling) {
    return { value: "—", badge: "Needs profile data" };
  }
  return {
    value: `Skin ${rule.skinIre[0]}-${rule.skinIre[1]} IRE • Highlights < ${rule.highlightCeiling} IRE`,
  };
}

function formatMonitoringQuick(rule: SignalRule | null): { value: string; badge?: string } {
  if (!rule) {
    return { value: "—", badge: "Needs profile data" };
  }
  return {
    value: rule.monitoringLabel,
    badge: rule.monitoringWarning,
  };
}

function buildDetails(
  mode: ModeProfile,
  profileSource: string[],
  rule: SignalRule | null,
  setup: ProductionLookSetup,
  selectedIso: number,
  capture_format: string,
  iso_strategy: string,
  white_balance_rule: string,
  detail_rule: string,
  exposure_target: string,
  monitoring_class: string,
  discipline_checklist: string[],
  warnings: string[],
): ProductionDetailSection[] {
  const targetLookRuleId = `RULE_LOOK_${setup.target_type.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_01`;
  const constraintRuleId = `RULE_LIGHT_${setup.lighting.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_01`;
  const skinRuleId = setup.skin_priority ? "RULE_SKIN_PRIORITY_01" : "RULE_BALANCED_PRIORITY_01";
  const ruleSource = rule ? [rule.signalId, rule.exposureRuleId, rule.wbRuleId, rule.monitorRuleId] : ["RULE_PROFILE_DATA_MISSING_01"];
  const detailRuleSource = rule ? [...profileSource, rule.detailRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"];

  return [
    {
      section: "Capture",
      items: [
        { label: "Action", text: capture_format, source: [...profileSource, "RULE_CAPTURE_PROFILE_01", constraintRuleId] },
        { label: "Codec family", text: mode.capture.codecOptions?.join(" / ") || "—", source: profileSource },
      ],
    },
    {
      section: "ISO",
      items: [
        { label: "Action", text: iso_strategy, source: rule ? [...profileSource, rule.isoRuleId, skinRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"] },
        { label: "Base ISO list", text: mode.baseISO.join(" / ") || "—", source: profileSource },
        { label: "Selected base ISO", text: String(selectedIso), source: profileSource },
      ],
    },
    {
      section: "White Balance",
      items: [
        { label: "Action", text: white_balance_rule, source: rule ? [...profileSource, rule.wbRuleId, targetLookRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"] },
      ],
    },
    {
      section: "Exposure",
      items: [
        { label: "Action", text: exposure_target, source: rule ? [...profileSource, rule.exposureRuleId, skinRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"] },
      ],
    },
    {
      section: "Texture",
      items: [
        { label: "Action", text: detail_rule, source: detailRuleSource },
      ],
    },
    {
      section: "Monitoring",
      items: [
        { label: "Action", text: monitoring_class, source: rule ? [...profileSource, rule.monitorRuleId, "RULE_MONITOR_REC709_WARNING_01"] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"] },
      ],
    },
    {
      section: "On-set discipline",
      items: [
        { label: "Checklist", text: discipline_checklist.join(" • "), source: rule ? [...profileSource, ...ruleSource] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"] },
        { label: "Notes", text: warnings.join(" • "), source: profileSource },
      ],
    },
  ];
}

export function buildLookOutputs(setup: ProductionLookSetup, cameras: ProductionCameraConfig[]): ProductionLookOutputs {
  const recommendations: ProductionLookRecommendation[] = cameras.map((camera) => {
    const missing = getMissingCameraFields(camera);
    const profile = findCameraProfile(camera.brand, camera.model);
    const mode = getSelectedMode(camera);
    if (!profile || !mode || !(mode.capture.logName || mode.capture.rawName) || missing.length > 0) {
      return buildMissingRecommendation(camera, missing.length > 0 ? missing : ["Profile"]);
    }

    const selectedIso = getSelectedBaseIso(camera) ?? mode.baseISO[0];
    const rule = getSignalRule(mode);
    const profileSource = [profile.profileId, mode.sourceId];
    const targetLookRuleId = `RULE_LOOK_${setup.target_type.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_01`;
    const constraintRuleId = `RULE_LIGHT_${setup.lighting.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_01`;
    const skinRuleId = setup.skin_priority ? "RULE_SKIN_PRIORITY_01" : "RULE_BALANCED_PRIORITY_01";
    const cameraLabel = `${camera.brand} ${camera.model}`;
    const capture_format = mode.capture.rawName
      ? `Capture in ${mode.capture.rawName} with ${mode.capture.logName ?? "the camera-native monitoring pipeline"} and only fall back when media pressure forces it.`
      : `Capture in ${mode.capture.logName ?? mode.label} and stay inside the listed codec family for a stable negative.`;
    const capture_format_basis = formatSource([...profileSource, "RULE_CAPTURE_PROFILE_01", constraintRuleId]);

    const iso_strategy = mode.baseISO.includes(selectedIso)
      ? `Stay on base ISO ${selectedIso}. Build density with clean ETTR discipline without sacrificing highlight control.`
      : `Selected ISO ${selectedIso} sits off-profile. Move to the nearest base ISO ${mode.baseISO[0]} for a cleaner baseline.`;
    const iso_strategy_basis = formatSource(rule ? [...profileSource, rule.isoRuleId, skinRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"]);

    const wbRange = rule?.wbRange[setup.lighting as LightingKey];
    const customInfluence = setup.target_type === "custom" && setup.custom_notes?.trim()
      ? ` Custom note carried into the export: ${setup.custom_notes.trim()}.`
      : "";
    const white_balance_rule = wbRange && rule
      ? `Set kelvin in the ${wbRange} band with a ${rule.tintBias}.${customInfluence}`
      : "No white-balance rule available for this profile yet.";
    const white_balance_rule_basis = formatSource(rule ? [...profileSource, rule.wbRuleId, targetLookRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"]);

    const detail_rule = `Set sharpening ${mode.texture.sharpening} and noise reduction ${mode.texture.noiseReduction}. Do not bake extra texture styling into the image.`;
    const detail_rule_basis = formatSource([...profileSource, "RULE_DETAIL_OFF_01"]);

    const exposure_target = rule?.skinIre && rule.highlightCeiling
      ? `Hold skin around ${rule.skinIre[0]}-${rule.skinIre[1]} IRE and keep highlights below ${rule.highlightCeiling} IRE.${setup.skin_priority ? " Faces win first." : " Balance the full frame."}`
      : "No zebra or waveform target available for this profile yet.";
    const exposure_target_basis = formatSource(rule ? [...profileSource, rule.exposureRuleId, skinRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"]);

    const monitoring_class = rule
      ? `${rule.monitoringLabel}. ${rule.monitoringWarning}.`
      : "No monitoring class available for this profile yet.";
    const monitoring_class_basis = formatSource(rule ? [...profileSource, rule.monitorRuleId, "RULE_MONITOR_REC709_WARNING_01"] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"]);

    const discipline_checklist = rule?.disciplineChecklist ?? ["No discipline checklist available for this profile yet."];
    const warnings = [
      profile.notes || `${cameraLabel}: no profile note.`,
      mode.notes || `${mode.label}: no mode note.`,
      camera.notes?.trim() ? `Camera note: ${camera.notes.trim()}` : "",
    ].filter(Boolean);

    const exposureQuick = formatExposureQuick(rule);
    const monitoringQuick = formatMonitoringQuick(rule);
    const quickSetup = [
      buildQuickRow("capture", "Capture", mode.capture.quickLabel, "capture", [...profileSource, "RULE_CAPTURE_PROFILE_01"]),
      buildQuickRow("iso", "ISO", formatIsoQuick(mode, selectedIso), "iso", rule ? [...profileSource, rule.isoRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"]),
      buildQuickRow(
        "wb",
        "WB",
        wbRange && rule ? `${wbRange} + ${rule.tintBias}` : "—",
        "wb",
        rule ? [...profileSource, rule.wbRuleId, targetLookRuleId, constraintRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"],
        wbRange && rule ? "ready" : "missing",
        wbRange && rule ? undefined : "Needs profile data",
      ),
      buildQuickRow(
        "exposure",
        "Exposure",
        exposureQuick.value,
        "exposure",
        rule ? [...profileSource, rule.exposureRuleId, skinRuleId] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"],
        exposureQuick.badge ? "missing" : "ready",
        exposureQuick.badge,
      ),
      buildQuickRow(
        "texture",
        "Texture",
        `Sharpening ${mode.texture.sharpening} • NR ${mode.texture.noiseReduction}`,
        "texture",
        [...profileSource, "RULE_DETAIL_OFF_01"],
      ),
      buildQuickRow(
        "monitoring",
        "Monitoring",
        monitoringQuick.value,
        "monitoring",
        rule ? [...profileSource, rule.monitorRuleId, "RULE_MONITOR_REC709_WARNING_01"] : [...profileSource, "RULE_PROFILE_DATA_MISSING_01"],
        monitoringQuick.badge ? "missing" : "ready",
        monitoringQuick.badge,
      ),
    ];

    return {
      slot: camera.slot,
      camera_label: cameraLabel,
      complete: true,
      missing: [],
      capture_format,
      capture_format_basis,
      iso_strategy,
      iso_strategy_basis,
      white_balance_rule,
      white_balance_rule_basis,
      detail_rule,
      detail_rule_basis,
      exposure_target,
      exposure_target_basis,
      monitoring_class,
      monitoring_class_basis,
      discipline_checklist,
      warnings,
      quickSetup,
      details: buildDetails(
        mode,
        profileSource,
        rule,
        setup,
        selectedIso,
        capture_format,
        iso_strategy,
        white_balance_rule,
        detail_rule,
        exposure_target,
        monitoring_class,
        discipline_checklist,
        warnings,
      ),
    };
  });

  const completedCount = recommendations.filter((item) => item.complete).length;
  return {
    summary:
      completedCount > 0
        ? `Generated ${completedCount} complete camera plan${completedCount === 1 ? "" : "s"} from curated camera facts and explicit rule IDs.`
        : "No complete camera profiles selected yet.",
    recommendations,
    generated_at: new Date().toISOString(),
  };
}

export function buildMatchPresetPayload(
  heroSlot: string,
  cameras: ProductionCameraConfig[],
  outputs: ProductionLookOutputs | null,
): ProductionMatchPresetPayload {
  const heroRecommendation = outputs?.recommendations.find((item) => item.slot === heroSlot) ?? null;
  const heroCamera = cameras.find((item) => item.slot === heroSlot) ?? null;
  const others = cameras.filter((item) => item.slot !== heroSlot && (item.brand || item.model || item.recording_mode));

  return {
    hero_slot: heroSlot,
    hero_summary: heroRecommendation
      ? `${heroRecommendation.camera_label}: ${heroRecommendation.exposure_target}`
      : `${heroCamera?.brand || "Hero"} ${heroCamera?.model || heroSlot}: build a clean baseline in Look Setup first.`,
    steps: others.map((camera) => ({
      slot: camera.slot,
      camera_label: `${camera.brand || "Camera"} ${camera.model || camera.slot}`.trim(),
      checklist: [
        `Match exposure method to hero camera ${heroSlot}; confirm on zebra or waveform, not just a Rec709 monitor.`,
        "Align kelvin and tint before moving contrast or saturation.",
        "Confirm sharpening, NR, and detail processing are off.",
        "Stay in the same monitoring class as the hero camera.",
      ],
    })),
  };
}
