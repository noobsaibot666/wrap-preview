export type CameraBrand = "Blackmagic" | "Nikon" | "RED";

export interface ModeProfile {
  id: string;
  label: string;
  sourceId: string;
  capture: {
    logName?: string;
    rawName?: string;
    codecOptions?: string[];
    quickLabel: string;
    signalProfile?: "BMD_FILM_GEN5" | "N_LOG" | "RED_IPP2" | "REC709" | null;
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

const CAMERA_PROFILES: CameraProfile[] = [
  {
    profileId: "PROFILE_BLACKMAGIC_PYXIS_6K",
    brand: "Blackmagic",
    model: "PYXIS 6K",
    notes: "Blackmagic Gen 5 color science with strong BRAW flexibility.",
    modes: [
      {
        id: "pyxis-braw",
        label: "BRAW",
        sourceId: "PROFILE_MODE_PYXIS_BRAW",
        capture: {
          rawName: "Blackmagic RAW",
          logName: "BMD Film Gen 5",
          codecOptions: ["Q0", "Q5", "3:1", "5:1", "8:1", "12:1"],
          quickLabel: "BRAW Film Gen 5",
          signalProfile: "BMD_FILM_GEN5",
        },
        baseISO: [400, 1250],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
        notes: "Use Gen 5 monitoring pipeline and keep texture controls neutral.",
      },
      {
        id: "pyxis-prores",
        label: "ProRes 422 HQ",
        sourceId: "PROFILE_MODE_PYXIS_PRORES",
        capture: {
          logName: "BMD Film Gen 5",
          codecOptions: ["422 HQ"],
          quickLabel: "BMD Film Gen 5",
          signalProfile: "BMD_FILM_GEN5",
        },
        baseISO: [400, 1250],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
      },
    ],
  },
  {
    profileId: "PROFILE_BLACKMAGIC_URSA_CINE_12K",
    brand: "Blackmagic",
    model: "URSA Cine 12K",
    notes: "High-resolution BRAW body with dual-base ISO behavior.",
    modes: [
      {
        id: "ursa-braw",
        label: "BRAW",
        sourceId: "PROFILE_MODE_URSA_BRAW",
        capture: {
          rawName: "Blackmagic RAW",
          logName: "BMD Film Gen 5",
          codecOptions: ["3:1", "5:1", "8:1", "12:1"],
          quickLabel: "BRAW Film Gen 5",
          signalProfile: "BMD_FILM_GEN5",
        },
        baseISO: [400, 1250],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
      },
    ],
  },
  {
    profileId: "PROFILE_NIKON_Z6III",
    brand: "Nikon",
    model: "Z6III",
    notes: "N-Log mirrorless body with flexible low-light behavior but limited highlight headroom compared with cinema RAW.",
    modes: [
      {
        id: "z6iii-nlog-h265",
        label: "N-Log H.265 10-bit",
        sourceId: "PROFILE_MODE_Z6III_NLOG_H265",
        capture: {
          logName: "N-Log",
          codecOptions: ["H.265 10-bit"],
          quickLabel: "N-Log",
          signalProfile: "N_LOG",
        },
        baseISO: [800],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
        notes: "Treat as a protected LOG capture and monitor false color carefully.",
      },
      {
        id: "z6iii-proresraw",
        label: "ProRes RAW HQ",
        sourceId: "PROFILE_MODE_Z6III_PRORES_RAW",
        capture: {
          rawName: "ProRes RAW HQ",
          codecOptions: ["ProRes RAW HQ"],
          quickLabel: "ProRes RAW HQ",
          signalProfile: null,
        },
        baseISO: [800],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
      },
    ],
  },
  {
    profileId: "PROFILE_RED_KOMODO",
    brand: "RED",
    model: "KOMODO",
    notes: "Compact global-shutter RED body; protect highlights before chasing shadow density.",
    modes: [
      {
        id: "komodo-redcode",
        label: "REDCODE RAW",
        sourceId: "PROFILE_MODE_KOMODO_REDCODE",
        capture: {
          rawName: "REDCODE RAW",
          logName: "RED Log3G10",
          codecOptions: ["HQ", "MQ", "LQ"],
          quickLabel: "RED IPP2",
          signalProfile: "RED_IPP2",
        },
        baseISO: [800],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
      },
    ],
  },
  {
    profileId: "PROFILE_RED_V_RAPTOR",
    brand: "RED",
    model: "V-RAPTOR",
    notes: "High-end RED body with strong highlight discipline when kept near its preferred native stop.",
    modes: [
      {
        id: "vraptor-redcode",
        label: "REDCODE RAW",
        sourceId: "PROFILE_MODE_V_RAPTOR_REDCODE",
        capture: {
          rawName: "REDCODE RAW",
          logName: "RED Log3G10",
          codecOptions: ["HQ", "MQ", "LQ"],
          quickLabel: "RED IPP2",
          signalProfile: "RED_IPP2",
        },
        baseISO: [800, 3200],
        texture: {
          sharpening: "OFF",
          noiseReduction: "Low/Off",
        },
      },
    ],
  },
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
