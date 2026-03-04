export type CameraBrand = "Blackmagic" | "Nikon" | "RED";

export interface ModeProfile {
  id: string;
  label: string;
  capture: {
    logName?: string;
    rawName?: string;
    codecOptions?: string[];
  };
  baseISO: number[];
  notes?: string;
}

export interface CameraProfile {
  brand: CameraBrand;
  model: string;
  modes: ModeProfile[];
  notes?: string;
}

const CAMERA_PROFILES: CameraProfile[] = [
  {
    brand: "Blackmagic",
    model: "PYXIS 6K",
    notes: "Blackmagic Gen 5 color science with strong BRAW flexibility.",
    modes: [
      {
        id: "pyxis-braw",
        label: "BRAW",
        capture: {
          rawName: "Blackmagic RAW",
          logName: "BMD Film Gen 5",
          codecOptions: ["Q0", "Q5", "3:1", "5:1", "8:1", "12:1"],
        },
        baseISO: [400, 1250],
        notes: "Use Gen 5 monitoring pipeline and keep texture controls neutral.",
      },
      {
        id: "pyxis-prores",
        label: "ProRes 422 HQ",
        capture: {
          logName: "BMD Film Gen 5",
          codecOptions: ["422 HQ"],
        },
        baseISO: [400, 1250],
      },
    ],
  },
  {
    brand: "Blackmagic",
    model: "URSA Cine 12K",
    notes: "High-resolution BRAW body with dual-base ISO behavior.",
    modes: [
      {
        id: "ursa-braw",
        label: "BRAW",
        capture: {
          rawName: "Blackmagic RAW",
          logName: "BMD Film Gen 5",
          codecOptions: ["3:1", "5:1", "8:1", "12:1"],
        },
        baseISO: [400, 1250],
      },
    ],
  },
  {
    brand: "Nikon",
    model: "Z6III",
    notes: "N-Log mirrorless body with flexible low-light behavior but limited highlight headroom compared with cinema RAW.",
    modes: [
      {
        id: "z6iii-nlog-h265",
        label: "N-Log H.265 10-bit",
        capture: {
          logName: "N-Log",
          codecOptions: ["H.265 10-bit"],
        },
        baseISO: [800],
        notes: "Treat as a protected LOG capture and monitor false color carefully.",
      },
      {
        id: "z6iii-proresraw",
        label: "ProRes RAW HQ",
        capture: {
          rawName: "ProRes RAW HQ",
          codecOptions: ["ProRes RAW HQ"],
        },
        baseISO: [800],
      },
    ],
  },
  {
    brand: "RED",
    model: "KOMODO",
    notes: "Compact global-shutter RED body; protect highlights before chasing shadow density.",
    modes: [
      {
        id: "komodo-redcode",
        label: "REDCODE RAW",
        capture: {
          rawName: "REDCODE RAW",
          logName: "RED Log3G10",
          codecOptions: ["HQ", "MQ", "LQ"],
        },
        baseISO: [800],
      },
    ],
  },
  {
    brand: "RED",
    model: "V-RAPTOR",
    notes: "High-end RED body with strong highlight discipline when kept near its preferred native stop.",
    modes: [
      {
        id: "vraptor-redcode",
        label: "REDCODE RAW",
        capture: {
          rawName: "REDCODE RAW",
          logName: "RED Log3G10",
          codecOptions: ["HQ", "MQ", "LQ"],
        },
        baseISO: [800, 3200],
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
