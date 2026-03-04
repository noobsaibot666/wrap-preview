import {
  ProductionCameraConfig,
  ProductionLookOutputs,
  ProductionLookRecommendation,
  ProductionLookSetup,
  ProductionMatchPresetPayload,
} from "../../types";
import { findCameraProfile, listCameraBrands, listModelsByBrand, listModes, ModeProfile } from "./cameraProfiles";

export const PRODUCTION_SLOTS = ["A", "B", "C"] as const;
export const LOOK_TARGETS = [
  { id: "arri_inspired", label: "ARRI-inspired", helper: "Soft shoulder, calm highlight roll-off, and stable skin separation." },
  { id: "fuji_inspired", label: "Fuji-inspired", helper: "Gentle color separation with cleaner greens and a slightly softer color bite." },
  { id: "cine_neutral", label: "Clean Cine Neutral", helper: "Technical neutral baseline intended for maximum flexibility later." },
  { id: "custom", label: "Custom notes", helper: "Use your own language. These notes are exported and only influence outputs when Custom is selected." },
] as const;
export const LIGHTING_CONSTRAINTS = [
  { id: "controlled", label: "Controlled", helper: "Repeatable fixtures, stable ratios, easier white-balance lock." },
  { id: "mixed", label: "Mixed", helper: "Practicals and daylight may fight each other. Protect skin from drifting green or cool." },
  { id: "run_and_gun", label: "Run-and-gun", helper: "Fast-moving conditions. Build simple guardrails you can hold under pressure." },
] as const;

const LOG_RULES: Record<string, {
  zebra: string;
  waveform: string;
  wbRange: Record<string, string>;
  tintBias: string;
  monitoring: string;
  exposureRuleId: string;
  wbRuleId: string;
  monitorRuleId: string;
}> = {
  "BMD Film Gen 5": {
    zebra: "Faces 45-52 IRE, hard warning at 94 IRE.",
    waveform: "Skin 45-52 IRE, highlights capped below 94 IRE.",
    wbRange: { controlled: "4300K-5600K", mixed: "4000K-5200K", run_and_gun: "3200K-5600K" },
    tintBias: "bias slightly magenta if mixed green practicals creep in",
    monitoring: "Use a neutral Gen 5 viewing LUT first; creative LUT only after exposure is confirmed.",
    exposureRuleId: "RULE_BMDG5_IRE_01",
    wbRuleId: "RULE_BMDG5_WB_01",
    monitorRuleId: "RULE_BMDG5_MON_01",
  },
  "N-Log": {
    zebra: "Faces 42-48 IRE, caution above 92 IRE.",
    waveform: "Skin 42-48 IRE, protect ceiling around 92 IRE.",
    wbRange: { controlled: "4300K-5600K", mixed: "4000K-5200K", run_and_gun: "3800K-5600K" },
    tintBias: "hold a mild magenta trim and avoid cool drift on skin",
    monitoring: "Use a neutral monitoring LUT and do not trust a contrasty Rec709 image for exposure calls.",
    exposureRuleId: "RULE_NLOG_IRE_01",
    wbRuleId: "RULE_NLOG_WB_01",
    monitorRuleId: "RULE_NLOG_MON_01",
  },
  "RED Log3G10": {
    zebra: "Faces 41-47 IRE, warning above 95 IRE.",
    waveform: "Skin 41-47 IRE, keep top-end under 95 IRE.",
    wbRange: { controlled: "4300K-5600K", mixed: "4000K-5200K", run_and_gun: "3400K-5600K" },
    tintBias: "keep skin slightly warm-neutral and correct green drift early",
    monitoring: "Use neutral monitoring when setting exposure; creative LUTs are for taste checks only.",
    exposureRuleId: "RULE_REDLOG3G10_IRE_01",
    wbRuleId: "RULE_REDLOG3G10_WB_01",
    monitorRuleId: "RULE_REDLOG3G10_MON_01",
  },
  "Rec709": {
    zebra: "Faces 55-65 IRE, warning above 88 IRE.",
    waveform: "Skin 55-65 IRE, keep ceiling below 88 IRE.",
    wbRange: { controlled: "4300K-5600K", mixed: "4200K-5200K", run_and_gun: "3600K-5600K" },
    tintBias: "lock kelvin and keep a neutral-warm skin bias",
    monitoring: "Keep monitoring neutral and avoid trusting an over-styled Rec709 display.",
    exposureRuleId: "RULE_709_IRE_01",
    wbRuleId: "RULE_709_WB_01",
    monitorRuleId: "RULE_709_MON_01",
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

export function buildDefaultCameraConfig(projectId: string, slot: string): ProductionCameraConfig {
  return {
    id: `${projectId}:${slot}`,
    project_id: projectId,
    slot,
    brand: "",
    model: "",
    recording_mode: "",
    log_family: "Rec709",
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
    return parsed;
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
    log_family: nextMode?.capture.logName ?? (nextMode?.capture.rawName ? "Rec709" : "Rec709"),
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
    log_family: nextMode?.capture.logName ?? (nextMode?.capture.rawName ? "Rec709" : "Rec709"),
    base_iso_list_json: nextMode ? stringifyBaseIsoList([nextMode.baseISO[0]]) : JSON.stringify([]),
  };
}

export function normalizeCameraAfterModeChange(config: ProductionCameraConfig, modeId: string): ProductionCameraConfig {
  const mode = listModes(config.brand, config.model).find((item) => item.id === modeId) ?? null;
  return {
    ...config,
    recording_mode: modeId,
    log_family: mode?.capture.logName ?? (mode?.capture.rawName ? "Rec709" : "Rec709"),
    base_iso_list_json: mode ? stringifyBaseIsoList([mode.baseISO[0]]) : JSON.stringify([]),
  };
}

function buildMissingRecommendation(config: ProductionCameraConfig, missing: string[]): ProductionLookRecommendation {
  const basis = "Based on: missing camera fields + RULE_INPUT_REQUIRED_01";
  return {
    slot: config.slot,
    camera_label: `${config.brand || "Camera"} ${config.model || config.slot}`.trim(),
    complete: false,
    missing,
    capture_format: `Missing: ${missing.join(", ")}.`,
    capture_format_basis: basis,
    iso_strategy: "Select a mode and base ISO to generate deterministic ISO guidance.",
    iso_strategy_basis: basis,
    white_balance_rule: "Select a profile to generate white-balance and tint guidance.",
    white_balance_rule_basis: basis,
    detail_rule: "Select a profile to confirm texture, detail, and NR guidance.",
    detail_rule_basis: basis,
    exposure_target: "Select a profile to show zebra and waveform targets.",
    exposure_target_basis: basis,
    monitoring_class: "Select a profile to show monitoring class guidance.",
    monitoring_class_basis: basis,
    discipline_checklist: ["Finish the camera card before generating outputs."],
    warnings: [],
  };
}

export function buildLookOutputs(setup: ProductionLookSetup, cameras: ProductionCameraConfig[]): ProductionLookOutputs {
  const recommendations: ProductionLookRecommendation[] = cameras.map((camera) => {
    const missing: string[] = [];
    if (!camera.brand.trim()) missing.push("brand");
    if (!camera.model.trim()) missing.push("model");
    if (!camera.recording_mode.trim()) missing.push("recording mode");
    if (!getSelectedBaseIso(camera)) missing.push("base ISO");

    const profile = findCameraProfile(camera.brand, camera.model);
    const mode = getSelectedMode(camera);
    if (!profile || !mode || !(mode.capture.logName || mode.capture.rawName)) {
      return buildMissingRecommendation(camera, missing.length > 0 ? missing : ["camera profile"]);
    }

    const selectedIso = getSelectedBaseIso(camera) ?? mode.baseISO[0];
    const logKey = mode.capture.logName ?? "Rec709";
    const rule = LOG_RULES[logKey] ?? LOG_RULES.Rec709;
    const targetLookRuleId = `RULE_LOOK_${setup.target_type.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_01`;
    const constraintRuleId = `RULE_LIGHT_${setup.lighting.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_01`;
    const skinRuleId = setup.skin_priority ? "RULE_SKIN_PRIORITY_01" : "RULE_BALANCED_PRIORITY_01";
    const cameraLabel = `${camera.brand} ${camera.model}`;
    const profileFact = `${cameraLabel} · ${mode.label}`;
    const captureFact = mode.capture.rawName
      ? `${mode.capture.rawName}${mode.capture.logName ? ` with ${mode.capture.logName}` : ""}`
      : mode.capture.logName || mode.label;
    const codecFact = mode.capture.codecOptions?.length ? mode.capture.codecOptions.join(", ") : mode.label;

    const capture_format = mode.capture.rawName
      ? `Favor ${mode.capture.rawName} when media budget allows; fall back to ${mode.capture.logName ?? mode.label} only if turnaround or card pressure requires it.`
      : `Use ${mode.capture.logName ?? mode.label} as the capture baseline and stay in the listed codec family: ${codecFact}.`;
    const capture_format_basis = `Based on: ${profileFact}, capture ${captureFact}, base ISO list ${mode.baseISO.join(" / ")} + RULE_CAPTURE_PROFILE_01 + ${constraintRuleId}`;

    const iso_strategy = mode.baseISO.includes(selectedIso)
      ? `Work at base ISO ${selectedIso}. Expose for density with ETTR discipline, but do not push faces by clipping practicals or speculars.`
      : `Selected ISO ${selectedIso} is off-profile. Move to closest base ISO ${mode.baseISO[0]} for the cleanest baseline.`;
    const iso_strategy_basis = `Based on: mode base ISO list ${mode.baseISO.join(" / ")}, selected ISO ${selectedIso} + RULE_ISO_NATIVE_01 + ${skinRuleId}`;

    const wbRange = rule.wbRange[setup.lighting];
    const customInfluence = setup.target_type === "custom" && setup.custom_notes?.trim()
      ? ` Custom note applied: ${setup.custom_notes.trim()}.`
      : "";
    const white_balance_rule = `Set kelvin in the ${wbRange} band, ${rule.tintBias}.${customInfluence}`;
    const white_balance_rule_basis = `Based on: log family ${logKey}, target look ${setup.target_type}, lighting ${setup.lighting} + ${rule.wbRuleId} + ${targetLookRuleId}`;

    const detail_rule = "In-camera sharpening, NR, and detail processing: OFF or minimum. Do not bake texture styling into the negative.";
    const detail_rule_basis = `Based on: capture ${captureFact}, codec family ${codecFact} + RULE_DETAIL_OFF_01`;

    const exposure_target = `${rule.zebra} ${rule.waveform} ${setup.skin_priority ? "Protect skin density first." : "Balance the frame evenly."}`;
    const exposure_target_basis = `Based on: log family ${logKey}, target look ${setup.target_type} + ${rule.exposureRuleId} + ${skinRuleId}`;

    const monitoring_class = `${rule.monitoring} Avoid trusting a contrasty Rec709 picture alone for exposure decisions.`;
    const monitoring_class_basis = `Based on: log family ${logKey}, monitoring class neutral-first + ${rule.monitorRuleId} + RULE_MONITOR_REC709_WARNING_01`;

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
      discipline_checklist: [
        "Confirm false color or waveform before trusting the monitor image.",
        "Protect speculars before adding more stop to faces.",
        "Keep subject separation readable before changing contrast taste.",
        "Reconfirm white balance whenever the source mix changes.",
      ],
      warnings: [
        profile.notes ?? `${cameraLabel}: no extra profile note.`,
        mode.notes ?? `${mode.label}: no extra mode note.`,
      ],
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
