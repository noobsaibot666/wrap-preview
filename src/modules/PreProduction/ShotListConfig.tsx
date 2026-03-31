import type { LucideProps } from "lucide-react";
import {
  Aperture,
  Battery,
  Boxes,
  Camera,
  CircleDot,
  FileAudio2,
  FileVideo2,
  Grip,
  HardDrive,
  Image as ImageIcon,
  Lightbulb,
  MapPin,
  Mic,
  Monitor,
  Package,
  ScanLine,
  SlidersHorizontal,
  TimerReset,
  Video,
} from "lucide-react";
import type { ComponentType } from "react";

export type ShotListIconName =
  | "camera"
  | "light"
  | "sound"
  | "tripod"
  | "motion"
  | "lens"
  | "grip"
  | "monitor"
  | "power"
  | "media"
  | "misc"
  | "recorder"
  | "wireless"
  | "slider"
  | "rig"
  | "storage"
  | "charger"
  | "photo"
  | "video"
  | "location"
  | "timing";

export type ShotListSectionKey =
  | "camera"
  | "light"
  | "sound"
  | "tripod"
  | "motion"
  | "lens"
  | "grip"
  | "monitor"
  | "power"
  | "media"
  | "misc";

export interface ShotListSectionPreset {
  key: ShotListSectionKey;
  label: string;
  iconName: ShotListIconName;
  description: string;
}

export interface ShotListIconOption {
  value: ShotListIconName;
  label: string;
}

export const SHOT_LIST_SECTION_PRESETS: ShotListSectionPreset[] = [
  { key: "camera", label: "Camera", iconName: "camera", description: "Bodies, rigs, named camera packages" },
  { key: "light", label: "Light", iconName: "light", description: "Fixtures, modifiers, and practicals" },
  { key: "sound", label: "Sound", iconName: "sound", description: "Mics, recorders, and monitoring" },
  { key: "tripod", label: "Tripod", iconName: "tripod", description: "Tripods, heads, monopods, supports" },
  { key: "motion", label: "Motion Support", iconName: "motion", description: "Gimbals, sliders, jibs, and moving camera support" },
  { key: "lens", label: "Lens", iconName: "lens", description: "Lens kits, focal choices, filters" },
  { key: "grip", label: "Grip", iconName: "grip", description: "Grip support, clamps, and shaping tools" },
  { key: "monitor", label: "Monitor", iconName: "monitor", description: "Video village, monitoring, wireless video" },
  { key: "power", label: "Power", iconName: "power", description: "Batteries, chargers, and power distribution" },
  { key: "media", label: "Media", iconName: "media", description: "SSD, SD, CFexpress, and offload media" },
  { key: "misc", label: "Misc", iconName: "misc", description: "Anything else needed on the day" },
];

const ICON_COMPONENTS: Record<ShotListIconName, ComponentType<LucideProps>> = {
  camera: Camera,
  light: Lightbulb,
  sound: Mic,
  tripod: ScanLine,
  motion: SlidersHorizontal,
  lens: Aperture,
  grip: Grip,
  monitor: Monitor,
  power: Battery,
  media: HardDrive,
  misc: Package,
  recorder: FileAudio2,
  wireless: CircleDot,
  slider: SlidersHorizontal,
  rig: Grip,
  storage: HardDrive,
  charger: Battery,
  photo: ImageIcon,
  video: Video,
  location: MapPin,
  timing: TimerReset,
};

export const SHOT_LIST_ICON_OPTIONS: ShotListIconOption[] = [
  { value: "camera", label: "Camera" },
  { value: "video", label: "Video" },
  { value: "photo", label: "Photo" },
  { value: "light", label: "Light" },
  { value: "sound", label: "Microphone" },
  { value: "recorder", label: "Recorder" },
  { value: "wireless", label: "Wireless" },
  { value: "tripod", label: "Tripod" },
  { value: "motion", label: "Motion support" },
  { value: "slider", label: "Slider" },
  { value: "lens", label: "Lens" },
  { value: "grip", label: "Grip" },
  { value: "rig", label: "Rig" },
  { value: "monitor", label: "Monitor" },
  { value: "power", label: "Battery" },
  { value: "charger", label: "Charger" },
  { value: "media", label: "Media" },
  { value: "storage", label: "Storage" },
  { value: "misc", label: "Misc" },
];

export const SHOT_LIST_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "ready", label: "Ready" },
  { value: "hold", label: "Hold" },
  { value: "done", label: "Done" },
] as const;

export const SHOT_LIST_MEDIA_TYPES = ["SSD", "SD", "CFexpress", "CFast", "Micro SD", "Other"] as const;
export const SHOT_LIST_CAPACITY_UNITS = ["GB", "TB"] as const;

export function getShotListIconComponent(iconName: string): ComponentType<LucideProps> {
  return ICON_COMPONENTS[(iconName as ShotListIconName) || "misc"] || ICON_COMPONENTS.misc;
}

export function getShotListSectionPreset(sectionKey?: string | null): ShotListSectionPreset | null {
  return SHOT_LIST_SECTION_PRESETS.find((preset) => preset.key === sectionKey) || null;
}

export function getDefaultItemTypeForSection(sectionKey?: string | null): string {
  switch (sectionKey) {
    case "camera":
      return "camera";
    case "motion":
      return "motion";
    case "media":
      return "media";
    default:
      return sectionKey || "misc";
  }
}

export function getDefaultIconNameForSection(sectionKey?: string | null): ShotListIconName {
  return getShotListSectionPreset(sectionKey)?.iconName || "misc";
}

export function getShotListIconOptionsForItemType(itemType?: string | null): ShotListIconOption[] {
  switch (itemType) {
    case "camera":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["camera", "video", "photo", "rig"].includes(option.value));
    case "sound":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["sound", "recorder", "wireless"].includes(option.value));
    case "light":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["light", "power", "grip"].includes(option.value));
    case "tripod":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["tripod", "rig", "motion"].includes(option.value));
    case "motion":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["motion", "slider", "tripod", "camera"].includes(option.value));
    case "lens":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["lens", "camera", "rig"].includes(option.value));
    case "grip":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["grip", "rig", "tripod"].includes(option.value));
    case "monitor":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["monitor", "wireless", "power"].includes(option.value));
    case "power":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["power", "charger", "misc"].includes(option.value));
    case "media":
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["media", "storage", "misc"].includes(option.value));
    default:
      return SHOT_LIST_ICON_OPTIONS.filter((option) => ["misc", "storage", "power"].includes(option.value));
  }
}

export function getShotListIconOptionsForSection(sectionKey?: string | null): ShotListIconOption[] {
  return getShotListIconOptionsForItemType(sectionKey || "misc");
}

export function getCaptureTypeIconName(captureType: "photo" | "video"): ShotListIconName {
  return captureType === "photo" ? "photo" : "video";
}

export const SHOT_LIST_SUMMARY_ICONS = {
  rows: FileVideo2,
  sections: Boxes,
  items: CircleDot,
  cameras: Camera,
  sound: FileAudio2,
  media: ScanLine,
};
