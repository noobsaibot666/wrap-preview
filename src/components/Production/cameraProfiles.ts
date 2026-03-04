export type CameraBrand = "ARRI" | "Blackmagic" | "Canon" | "Nikon" | "Panasonic" | "RED" | "Sony";
export type SignalProfile =
  | "BMD_FILM_GEN5"
  | "C_LOG2"
  | "F_LOG2"
  | "LOG_C"
  | "N_LOG"
  | "REC709"
  | "RED_IPP2"
  | "S_LOG3"
  | "V_LOG";

export const LENS_CHARACTER_OPTIONS = [
  "Neutral Cine",
  "Vintage Soft",
  "Clean Modern",
  "High Contrast",
  "Lower Contrast",
  "Anamorphic",
  "Spherical",
] as const;

export const DIFFUSION_OPTIONS = [
  "None",
  "Black Pro-Mist 1/8",
  "Black Pro-Mist 1/4",
  "Black Pro-Mist 1/2",
  "Glimmerglass 1",
  "Glimmerglass 2",
  "Hollywood Black Magic 1/8",
  "Hollywood Black Magic 1/4",
] as const;

export interface ModeProfile {
  id: string;
  label: string;
  sourceId: string;
  capture: {
    logName?: string;
    rawName?: string;
    codecOptions?: string[];
    quickLabel: string;
    signalProfile?: SignalProfile | null;
  };
  baseISO: number[];
  texture: {
    sharpening: string;
    noiseReduction: string;
  };
  notes?: string;
}

export interface CameraProfile {
  profileId: string;
  brand: CameraBrand;
  model: string;
  modes: ModeProfile[];
  notes?: string;
}

function buildMode(
  profileId: string,
  id: string,
  label: string,
  quickLabel: string,
  signalProfile: SignalProfile | null,
  baseISO: number[],
  codecOptions: string[],
  extras?: { logName?: string; rawName?: string; notes?: string },
): ModeProfile {
  return {
    id,
    label,
    sourceId: `${profileId}_${id}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
    capture: {
      logName: extras?.logName,
      rawName: extras?.rawName,
      codecOptions,
      quickLabel,
      signalProfile,
    },
    baseISO,
    texture: {
      sharpening: "OFF",
      noiseReduction: "Low/Off",
    },
    notes: extras?.notes,
  };
}

function buildProfile(
  profileId: string,
  brand: CameraBrand,
  model: string,
  notes: string,
  modes: ModeProfile[],
): CameraProfile {
  return { profileId, brand, model, notes, modes };
}

const CAMERA_PROFILES: CameraProfile[] = [
  buildProfile("PROFILE_ARRI_ALEXA_MINI_LF", "ARRI", "Alexa Mini LF", "ARRI large-format baseline with strong LogC monitoring discipline.", [
    buildMode("PROFILE_ARRI_ALEXA_MINI_LF", "arriraw-logc", "ARRIRAW / LogC", "ARRIRAW LogC", "LOG_C", [800], ["ARRIRAW"], { logName: "LogC", rawName: "ARRIRAW", notes: "Use a technical viewing transform before creative taste." }),
    buildMode("PROFILE_ARRI_ALEXA_MINI_LF", "prores-logc", "ProRes 4444 XQ / LogC", "LogC", "LOG_C", [800], ["ProRes 4444 XQ"], { logName: "LogC" }),
  ]),
  buildProfile("PROFILE_ARRI_ALEXA_35", "ARRI", "Alexa 35", "ARRI LogC4 body with wide highlight protection.", [
    buildMode("PROFILE_ARRI_ALEXA_35", "arriraw-logc4", "ARRIRAW / LogC4", "ARRIRAW LogC4", "LOG_C", [800], ["ARRIRAW"], { logName: "LogC4", rawName: "ARRIRAW" }),
    buildMode("PROFILE_ARRI_ALEXA_35", "prores-logc4", "ProRes 4444 XQ / LogC4", "LogC4", "LOG_C", [800], ["ProRes 4444 XQ"], { logName: "LogC4" }),
  ]),
  buildProfile("PROFILE_SONY_FX3", "Sony", "FX3", "Compact Sony body. Keep S-Log3 exposure disciplined.", [
    buildMode("PROFILE_SONY_FX3", "xavc-slog3", "XAVC-I / S-Log3", "S-Log3", "S_LOG3", [800, 12800], ["XAVC-I"], { logName: "S-Log3" }),
  ]),
  buildProfile("PROFILE_SONY_FX6", "Sony", "FX6", "Dual-base Sony cine body with stable S-Log3 pipeline.", [
    buildMode("PROFILE_SONY_FX6", "xavc-slog3", "XAVC-I / S-Log3", "S-Log3", "S_LOG3", [800, 12800], ["XAVC-I"], { logName: "S-Log3" }),
  ]),
  buildProfile("PROFILE_SONY_FX9", "Sony", "FX9", "Full-size Sony cine body with S-Log3 and dual-base ISO.", [
    buildMode("PROFILE_SONY_FX9", "xavc-slog3", "XAVC-I / S-Log3", "S-Log3", "S_LOG3", [800, 4000], ["XAVC-I"], { logName: "S-Log3" }),
  ]),
  buildProfile("PROFILE_SONY_VENICE", "Sony", "Venice", "Sony Venice with technical S-Log3 baseline.", [
    buildMode("PROFILE_SONY_VENICE", "xocn-slog3", "X-OCN / S-Log3", "X-OCN S-Log3", "S_LOG3", [500, 2500], ["X-OCN"], { logName: "S-Log3", rawName: "X-OCN" }),
  ]),
  buildProfile("PROFILE_CANON_C70", "Canon", "C70", "Canon Super 35 body. Keep C-Log3 clean and simple.", [
    buildMode("PROFILE_CANON_C70", "xfavc-clog3", "XF-AVC / C-Log3", "C-Log3", "C_LOG2", [800], ["XF-AVC"], { logName: "C-Log3" }),
  ]),
  buildProfile("PROFILE_CANON_C300III", "Canon", "C300 Mark III", "Canon cinema body with dual-gain output and log capture.", [
    buildMode("PROFILE_CANON_C300III", "xfavc-clog2", "XF-AVC / C-Log2", "C-Log2", "C_LOG2", [800], ["XF-AVC"], { logName: "C-Log2" }),
  ]),
  buildProfile("PROFILE_CANON_C500II", "Canon", "C500 Mark II", "Full-frame Canon body with strong C-Log2 baseline.", [
    buildMode("PROFILE_CANON_C500II", "cinemaraw-clog2", "Cinema RAW Light / C-Log2", "RAW C-Log2", "C_LOG2", [800], ["Cinema RAW Light"], { logName: "C-Log2", rawName: "Cinema RAW Light" }),
  ]),
  buildProfile("PROFILE_PANASONIC_S1H", "Panasonic", "S1H", "Mirrorless V-Log body. Protect highlights before chasing density.", [
    buildMode("PROFILE_PANASONIC_S1H", "all-i-vlog", "ALL-I / V-Log", "V-Log", "V_LOG", [640, 4000], ["ALL-I"], { logName: "V-Log" }),
  ]),
  buildProfile("PROFILE_PANASONIC_GH6", "Panasonic", "GH6", "Micro four-thirds V-Log body with compact highlight headroom.", [
    buildMode("PROFILE_PANASONIC_GH6", "all-i-vlog", "ALL-I / V-Log", "V-Log", "V_LOG", [250, 2000], ["ALL-I"], { logName: "V-Log" }),
  ]),
  buildProfile("PROFILE_NIKON_Z6III", "Nikon", "Z6III", "N-Log mirrorless body with limited highlight headroom versus cinema RAW.", [
    buildMode("PROFILE_NIKON_Z6III", "nlog-h265", "N-Log H.265 10-bit", "N-Log", "N_LOG", [800], ["H.265 10-bit"], { logName: "N-Log", notes: "Treat as a protected LOG capture and monitor false color carefully." }),
    buildMode("PROFILE_NIKON_Z6III", "nraw", "N-RAW", "N-RAW", "N_LOG", [800], ["N-RAW"], { logName: "N-Log", rawName: "N-RAW", notes: "Use N-Log monitoring discipline when treating N-RAW as the negative." }),
    buildMode("PROFILE_NIKON_Z6III", "proresraw", "ProRes RAW HQ", "ProRes RAW HQ", null, [800], ["ProRes RAW HQ"], { rawName: "ProRes RAW HQ", notes: "Recorder-dependent. Confirm recorder path before relying on this mode." }),
  ]),
  buildProfile("PROFILE_NIKON_Z9", "Nikon", "Z9", "Nikon flagship with N-Log and RAW options.", [
    buildMode("PROFILE_NIKON_Z9", "nlog-h265", "N-Log H.265 10-bit", "N-Log", "N_LOG", [800], ["H.265 10-bit"], { logName: "N-Log", notes: "Treat as protected LOG capture and keep highlight discipline." }),
    buildMode("PROFILE_NIKON_Z9", "nraw-nlog", "N-RAW / N-Log", "N-RAW N-Log", "N_LOG", [800], ["N-RAW"], { logName: "N-Log", rawName: "N-RAW" }),
    buildMode("PROFILE_NIKON_Z9", "proresraw", "ProRes RAW HQ", "ProRes RAW HQ", null, [800], ["ProRes RAW HQ"], { rawName: "ProRes RAW HQ", notes: "Recorder-dependent. Confirm recorder path before relying on this mode." }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_BMPC_4K", "Blackmagic", "Production Camera 4K", "Blackmagic Production Camera 4K with legacy Film profile behavior.", [
    buildMode("PROFILE_BLACKMAGIC_BMPC_4K", "prores-film", "ProRes 422 HQ / Film", "BMD Film", null, [400], ["ProRes 422 HQ"], { logName: "BMD Film", notes: "Legacy film profile. If monitoring targets are missing, treat as Needs profile data." }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_4K", "Blackmagic", "Pocket Cinema Camera 4K", "BMCC 4K with Blackmagic RAW and ProRes options.", [
    buildMode("PROFILE_BLACKMAGIC_4K", "braw", "BRAW", "BRAW Film Gen 5", "BMD_FILM_GEN5", [400, 3200], ["Q0", "Q5", "8:1"], { logName: "BMD Film Gen 5", rawName: "Blackmagic RAW" }),
    buildMode("PROFILE_BLACKMAGIC_4K", "prores", "ProRes 422 HQ", "BMD Film Gen 5", "BMD_FILM_GEN5", [400, 3200], ["ProRes 422 HQ"], { logName: "BMD Film Gen 5" }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_6K", "Blackmagic", "Pocket Cinema Camera 6K", "Blackmagic 6K body with Gen 5 monitoring.", [
    buildMode("PROFILE_BLACKMAGIC_6K", "braw", "BRAW", "BRAW Film Gen 5", "BMD_FILM_GEN5", [400, 3200], ["Q0", "Q5", "8:1"], { logName: "BMD Film Gen 5", rawName: "Blackmagic RAW" }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_6K_PRO", "Blackmagic", "Pocket Cinema Camera 6K Pro", "6K Pro with built-in ND and Gen 5 pipeline.", [
    buildMode("PROFILE_BLACKMAGIC_6K_PRO", "braw", "BRAW", "BRAW Film Gen 5", "BMD_FILM_GEN5", [400, 3200], ["Q0", "Q5", "8:1"], { logName: "BMD Film Gen 5", rawName: "Blackmagic RAW" }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_6K_G2", "Blackmagic", "Pocket Cinema Camera 6K G2", "6K G2 with Blackmagic RAW baseline.", [
    buildMode("PROFILE_BLACKMAGIC_6K_G2", "braw", "BRAW", "BRAW Film Gen 5", "BMD_FILM_GEN5", [400, 3200], ["Q0", "Q5", "8:1"], { logName: "BMD Film Gen 5", rawName: "Blackmagic RAW" }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_PYXIS_6K", "Blackmagic", "PYXIS 6K", "Blackmagic Gen 5 color science with strong BRAW flexibility.", [
    buildMode("PROFILE_BLACKMAGIC_PYXIS_6K", "braw", "BRAW", "BRAW Film Gen 5", "BMD_FILM_GEN5", [400, 1250], ["Q0", "Q5", "3:1", "5:1", "8:1", "12:1"], { logName: "BMD Film Gen 5", rawName: "Blackmagic RAW", notes: "Use Gen 5 monitoring pipeline and keep texture controls neutral." }),
    buildMode("PROFILE_BLACKMAGIC_PYXIS_6K", "prores", "ProRes 422 HQ", "BMD Film Gen 5", "BMD_FILM_GEN5", [400, 1250], ["422 HQ"], { logName: "BMD Film Gen 5" }),
  ]),
  buildProfile("PROFILE_BLACKMAGIC_12K", "Blackmagic", "URSA Mini Pro 12K", "High-resolution BRAW body with dual-base ISO behavior.", [
    buildMode("PROFILE_BLACKMAGIC_12K", "braw", "BRAW", "BRAW Film Gen 5", "BMD_FILM_GEN5", [400, 3200], ["3:1", "5:1", "8:1", "12:1"], { logName: "BMD Film Gen 5", rawName: "Blackmagic RAW" }),
  ]),
  buildProfile("PROFILE_RED_KOMODO", "RED", "KOMODO", "Compact global-shutter RED body; protect highlights before chasing shadow density.", [
    buildMode("PROFILE_RED_KOMODO", "redcode", "REDCODE RAW", "RED IPP2", "RED_IPP2", [800], ["HQ", "MQ", "LQ"], { logName: "RED Log3G10", rawName: "REDCODE RAW" }),
  ]),
  buildProfile("PROFILE_RED_V_RAPTOR", "RED", "V-RAPTOR", "High-end RED body with strong highlight discipline near native ISO.", [
    buildMode("PROFILE_RED_V_RAPTOR", "redcode", "REDCODE RAW", "RED IPP2", "RED_IPP2", [800, 3200], ["HQ", "MQ", "LQ"], { logName: "RED Log3G10", rawName: "REDCODE RAW" }),
  ]),
];

export function listCameraBrands(): CameraBrand[] {
  return [...new Set(CAMERA_PROFILES.map((profile) => profile.brand))];
}

export function listModelsByBrand(brand: string): string[] {
  return CAMERA_PROFILES.filter((profile) => profile.brand === brand).map((profile) => profile.model);
}

export function listModes(brand: string, model: string): ModeProfile[] {
  return CAMERA_PROFILES.find((profile) => profile.brand === brand && profile.model === model)?.modes ?? [];
}

export function findCameraProfile(brand: string, model: string): CameraProfile | undefined {
  return CAMERA_PROFILES.find((profile) => profile.brand === brand && profile.model === model);
}
