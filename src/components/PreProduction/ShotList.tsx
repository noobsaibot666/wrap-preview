import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FocusEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  HelpCircle,
  LoaderCircle,
  Minus,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type {
  ShotListBundle,
  ShotListEquipmentItem,
  ShotListEquipmentSection,
  ShotListProject,
  ShotListRow,
} from "../../types";
import { invokeGuarded } from "../../utils/tauri";
import { exportShotListImage, exportShotListPdf } from "../../utils/ShotListExport";
import {
  getCaptureTypeIconName,
  getDefaultIconNameForSection,
  getDefaultItemTypeForSection,
  getShotListIconOptionsForItemType,
  getShotListIconOptionsForSection,
  getShotListIconComponent,
  SHOT_LIST_CAPACITY_UNITS,
  SHOT_LIST_MEDIA_TYPES,
  SHOT_LIST_SECTION_PRESETS,
  SHOT_LIST_STATUS_OPTIONS,
  SHOT_LIST_SUMMARY_ICONS,
  type ShotListIconName,
} from "../../modules/PreProduction/ShotListConfig";

interface ShotListProps {
  onBack?: () => void;
  appVersion?: string;
}

interface CameraSetup {
  camera: string;
  lens: string;
  accessory: string;
  media: string;
  support: string;
  movement: string;
  power: string;
  monitor: string;
}



interface InventoryEntry {
  name: string;
  category: string;
}

interface ImportedInventory {
  entries: InventoryEntry[];
  sourceName: string | null;
}

interface ShotListWrapDocument {
  format: "wrap-shot-list";
  version: 1;
  saved_at: string;
  bundle: ShotListBundle;
  importedInventory?: ImportedInventory;
}

const CAMERA_SETUP_DELIMITER = "__SLCAM__";

const SHOT_LIST_IMPORT_STORAGE_KEY = "shot-list-imported-inventory";
const SHOT_LIST_WRAP_EXTENSION = "wrap";

function createEmptyCameraSetup(): CameraSetup {
  return {
    camera: "",
    lens: "",
    accessory: "",
    media: "",
    support: "",
    movement: "Static",
    power: "",
    monitor: "",
  };
}

function uniqueSuggestions(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => (value || "").trim()).filter(Boolean))];
}

function parseCameraSetups(value: string) {
  const setups = value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes(CAMERA_SETUP_DELIMITER)) {
        const parts = entry.split(CAMERA_SETUP_DELIMITER);
        if (parts.length >= 8) {
          const [camera = "", lens = "", accessory = "", media = "", support = "", movement = "Static", power = "", monitor = ""] = parts;
          return { camera, lens, accessory, media, support, movement, power, monitor };
        }
        const [camera = "", lens = "", accessory = "", media = "", support = "", power = "", monitor = ""] = parts;
        return { camera, lens, accessory, media, support, movement: "Static", power, monitor };
      }
      return {
        camera: entry,
        lens: "",
        accessory: "",
        media: "",
        support: "",
        movement: "Static",
        power: "",
        monitor: "",
      };
    });
  return setups.length > 0 ? setups : [createEmptyCameraSetup()];
}

function serializeCameraSetups(values: CameraSetup[]) {
  return values
    .map((entry) => [entry.camera, entry.lens, entry.accessory, entry.media, entry.support, entry.movement, entry.power, entry.monitor].map((part) => part.trim()).join(CAMERA_SETUP_DELIMITER))
    .filter((entry) => entry.split(CAMERA_SETUP_DELIMITER).some((part) => part.trim()))
    .join("\n");
}



function inferInventoryCategory(value: string) {
  const normalized = value.toLowerCase();
  if (/(camera|fx3|komodo|c70|bmc|body|arri|sony|canon|red)\b/.test(normalized)) return "camera";
  if (/(lens|prime|zoom|macro|anamorphic|24-70|70-200|35mm|50mm|85mm|filter|adapter)\b/.test(normalized)) return "lens";
  if (/(tripod|monopod|hi-hat|fluid head)\b/.test(normalized)) return "tripod";
  if (/(gimbal|slider|jib|dolly|car mount|easyrig)\b/.test(normalized)) return "motion";
  if (/(mic|microphone|lav|boom|recorder|wireless|headphone|audio|xlr)\b/.test(normalized)) return "sound";
  if (/(light|tube|led|softbox|practical|skypanel|aputure|stand)\b/.test(normalized)) return "light";
  if (/(clamp|flag|diffusion|sandbag|grip|c-stand|arm|knuckle)\b/.test(normalized)) return "grip";
  if (/(monitor|transmitter|receiver|wireless video|video village)\b/.test(normalized)) return "monitor";
  if (/(battery|charger|power|extension|v-mount|np-f)\b/.test(normalized)) return "power";
  if (/(ssd|sd|cfexpress|media|card|offload|storage)\b/.test(normalized)) return "media";
  return "misc";
}

function parseMarkdownEquipmentInventory(markdown: string): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  let activeCategory = "misc";
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      activeCategory = inferInventoryCategory(headingMatch[1]);
      continue;
    }
    const itemMatch = line.match(/^[-*+]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    const value = (itemMatch ? itemMatch[1] : line).trim();
    if (!value) continue;
    entries.push({
      name: value,
      category: activeCategory === "misc" ? inferInventoryCategory(value) : activeCategory,
    });
  }
  return entries;
}

function buildDefaultRow(projectId: string, sortOrder: number, shotNumber: string): ShotListRow {
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    sort_order: sortOrder,
    shot_number: shotNumber,
    capture_type: "video",
    scene: "",
    location: "",
    timing: "",
    shot_type: "Medium",
    description: "",
    camera_lens: "",
    camera_movement: "Static",
    audio_notes: "",
    lighting_notes: "",
    talent_subjects: "",
    props_details: "",
    notes: "",
    status: "planned",
    scene_setup: "",
    location_time: "",
    movement: "Static",
  };
}

function buildDefaultSection(projectId: string, presetKey: string): ShotListEquipmentSection {
  const preset = SHOT_LIST_SECTION_PRESETS.find((entry) => entry.key === presetKey) || SHOT_LIST_SECTION_PRESETS[SHOT_LIST_SECTION_PRESETS.length - 1];
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    sort_order: 0,
    section_key: preset.key,
    section_name: preset.label,
    icon_name: preset.iconName,
  };
}

function buildDefaultItem(section: ShotListEquipmentSection, count: number): ShotListEquipmentItem {
  const defaultItemType = getDefaultItemTypeForSection(section.section_key);
  return {
    id: crypto.randomUUID(),
    section_id: section.id,
    sort_order: count + 1,
    item_name: defaultItemType === "camera" ? `Camera ${count + 1}` : "",
    item_type: defaultItemType,
    icon_name: (section.icon_name as ShotListIconName) || getDefaultIconNameForSection(section.section_key),
    notes: "",
    camera_label: defaultItemType === "camera" ? `Cam ${count + 1}` : null,
    media_type: defaultItemType === "camera" || defaultItemType === "media" ? "SSD" : null,
    capacity_value: null,
    capacity_unit: "GB",
  };
}

function sortByOrder<T extends { sort_order: number }>(items: T[]) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

function getItemDetailMeta(itemType: string) {
  switch (itemType) {
    case "camera":
      return {
        itemLabel: "Camera body",
        itemPlaceholder: "FX3, Komodo, A-cam",
        detailLabel: "Camera name",
        detailPlaceholder: "A-cam / handheld body / lock-off cam",
        notePlaceholder: "Rig, batteries, cage, monitor, operator note",
      };
    case "sound":
      return {
        itemLabel: "Sound item",
        itemPlaceholder: "Shotgun mic, lav kit, field recorder",
        detailLabel: "Sound detail",
        detailPlaceholder: "Boom, lavs, recorder, XLR set, spare capsules",
        notePlaceholder: "Channels, frequency plan, adapters, power notes",
      };
    case "light":
      return {
        itemLabel: "Light item",
        itemPlaceholder: "Key light, tube, practical, modifier",
        detailLabel: "Light detail",
        detailPlaceholder: "Softbox, grid, stand, dimmer, gels",
        notePlaceholder: "Mounting, diffusion, power draw, accessories",
      };
    case "tripod":
      return {
        itemLabel: "Support item",
        itemPlaceholder: "Tripod, monopod, hi-hat",
        detailLabel: "Support detail",
        detailPlaceholder: "Fluid head, slider base, quick release plate",
        notePlaceholder: "Height, head type, adapter, carrying note",
      };
    case "motion":
      return {
        itemLabel: "Motion item",
        itemPlaceholder: "Gimbal, slider, jib, dolly",
        detailLabel: "Motion detail",
        detailPlaceholder: "Payload, plate, motor setup, track length",
        notePlaceholder: "Balance state, batteries, accessories, setup note",
      };
    case "lens":
      return {
        itemLabel: "Lens item",
        itemPlaceholder: "24-70, prime set, macro, filter kit",
        detailLabel: "Lens detail",
        detailPlaceholder: "Mount, focal range, matte box, filter thread",
        notePlaceholder: "Case, cleaning kit, caps, support note",
      };
    case "grip":
      return {
        itemLabel: "Grip item",
        itemPlaceholder: "C-stand, clamp, flag, diffusion",
        detailLabel: "Grip detail",
        detailPlaceholder: "Arm, knuckle, sandbag, butterfly frame",
        notePlaceholder: "Quantity, special rigging, transport note",
      };
    case "monitor":
      return {
        itemLabel: "Monitor item",
        itemPlaceholder: "Director monitor, onboard monitor, TX/RX kit",
        detailLabel: "Monitor detail",
        detailPlaceholder: "Wireless RX, mount, sun hood, LUT setup",
        notePlaceholder: "Power, brightness, cables, viewing note",
      };
    case "power":
      return {
        itemLabel: "Power item",
        itemPlaceholder: "V-mount battery, charger, power distro",
        detailLabel: "Power detail",
        detailPlaceholder: "NP-F, AC adapter, extension, charger bay",
        notePlaceholder: "Capacity, charging status, cable note",
      };
    case "media":
      return {
        itemLabel: "Media item",
        itemPlaceholder: "SSD 01, card wallet, offload shuttle",
        detailLabel: "Media label",
        detailPlaceholder: "A-cam media, backup shuttle, card case",
        notePlaceholder: "Offload plan, labeling, backup note",
      };
    default:
      return {
        itemLabel: "Item",
        itemPlaceholder: "Case, tool, accessory",
        detailLabel: "Detail",
        detailPlaceholder: "Short identifying detail",
        notePlaceholder: "Anything the crew should know",
      };
  }
}

function getItemSuggestions(itemType: string) {
  switch (itemType) {
    case "camera":
      return ["A-cam", "B-cam", "FX3", "Komodo", "Pocket 6K"];
    case "sound":
      return ["Shotgun mic", "Lav kit", "Field recorder", "XLR cable kit", "Headphones"];
    case "light":
      return ["Key light", "Tube light", "Practical light", "Softbox", "Light stand"];
    case "tripod":
      return ["Tripod", "Monopod", "Hi-hat", "Fluid head", "Slider"];
    case "motion":
      return ["Gimbal", "Slider", "Jib", "Dolly", "Car mount"];
    case "lens":
      return ["24-70", "70-200", "Prime set", "Macro lens", "Filter kit"];
    case "grip":
      return ["C-stand", "Clamp kit", "Flag", "Diffusion", "Sandbags"];
    case "monitor":
      return ["Director monitor", "Onboard monitor", "Wireless TX/RX", "Sun hood", "Monitor arm"];
    case "power":
      return ["V-mount battery", "NP-F set", "Charger", "Extension cable", "Power distro"];
    case "media":
      return ["SSD", "SD cards", "CFexpress", "Card wallet", "Offload shuttle"];
    default:
      return ["Accessory", "Case", "Toolkit", "Backup item"];
  }
}

function sanitizeFileStem(value: string) {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "_").replace(/\s+/g, "_");
  return cleaned || "shot-list";
}

function normalizeShotListBundle(bundle: ShotListBundle): ShotListBundle {
  const project = {
    ...bundle.project,
    title: bundle.project.title || "Shot List",
    day_label: bundle.project.day_label || "Day Sheet",
  };
  const rows = sortByOrder(bundle.rows || []).map((row, index) => ({
    ...row,
    project_id: project.id,
    sort_order: index + 1,
  }));
  const sections = sortByOrder(bundle.sections || []).map((section, index) => ({
    ...section,
    project_id: project.id,
    sort_order: index + 1,
  }));
  const validSectionIds = new Set(sections.map((section) => section.id));
  const itemsBySection = new Map<string, ShotListEquipmentItem[]>();
  for (const item of bundle.items || []) {
    if (!validSectionIds.has(item.section_id)) continue;
    const current = itemsBySection.get(item.section_id) || [];
    current.push(item);
    itemsBySection.set(item.section_id, current);
  }
  const items = sections.flatMap((section) =>
    sortByOrder(itemsBySection.get(section.id) || []).map((item, index) => ({
      ...item,
      section_id: section.id,
      sort_order: index + 1,
    })),
  );
  return { project, rows, sections, items };
}

function parseShotListWrapDocument(raw: string): { bundle: ShotListBundle; importedInventory: ImportedInventory } {
  const parsed = JSON.parse(raw) as Partial<ShotListWrapDocument> & Partial<ShotListBundle>;
  const rawBundle = parsed.bundle && parsed.bundle.project ? parsed.bundle : parsed;
  if (!rawBundle || !("project" in rawBundle) || !rawBundle.project) {
    throw new Error("This .wrap file does not contain a valid Shot List document.");
  }
  const bundle = normalizeShotListBundle(rawBundle as ShotListBundle);
  const importedInventory =
    parsed.importedInventory && Array.isArray(parsed.importedInventory.entries)
      ? {
          entries: parsed.importedInventory.entries,
          sourceName: parsed.importedInventory.sourceName || null,
        }
      : { entries: [], sourceName: null };
  return { bundle, importedInventory };
}

export default function ShotList({ appVersion }: ShotListProps) {
  const [bundle, setBundle] = useState<ShotListBundle | null>(null);
  const [importedInventory, setImportedInventory] = useState<ImportedInventory>({ entries: [], sourceName: null });
  const [activeOptionField, setActiveOptionField] = useState<string | null>(null);
  const [wrapFilePath, setWrapFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle" | "error">("saved");
  const [exporting, setExporting] = useState<"pdf" | "image" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());
  const [collapsedItemIds, setCollapsedItemIds] = useState<Set<string>>(new Set());
  const saveTimersRef = useRef<Record<string, number>>({});
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsMenuOpen]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const ensured = await invokeGuarded<ShotListProject>("shot_list_ensure_project");
        const nextBundle = await invokeGuarded<ShotListBundle>("shot_list_get_bundle", { projectId: ensured.id });
        if (mounted) {
          setBundle({
            project: nextBundle.project,
            rows: sortByOrder(nextBundle.rows),
            sections: sortByOrder(nextBundle.sections),
            items: sortByOrder(nextBundle.items),
          });
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load Shot List.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!bundle) return;
    try {
      const stored = window.localStorage.getItem(`${SHOT_LIST_IMPORT_STORAGE_KEY}:${bundle.project.id}`);
      if (!stored) {
        setImportedInventory({ entries: [], sourceName: null });
        return;
      }
      const parsed = JSON.parse(stored) as ImportedInventory;
      setImportedInventory({
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        sourceName: typeof parsed.sourceName === "string" ? parsed.sourceName : null,
      });
    } catch {
      setImportedInventory({ entries: [], sourceName: null });
    }
  }, [bundle?.project.id]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".shot-list-option-field")) return;
      setActiveOptionField(null);
      window.requestAnimationFrame(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const sectionsWithItems = useMemo(() => {
    if (!bundle) return [];
    return bundle.sections
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((section) => ({
        section,
        items: bundle.items
          .filter((item) => item.section_id === section.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      }));
  }, [bundle]);

  const cameraCount = useMemo(
    () => (bundle?.items || []).filter((item) => item.item_type === "camera").length,
    [bundle],
  );

  const importedSuggestionsByCategory = useMemo(() => {
    const byCategory = new Map<string, string[]>();
    for (const entry of importedInventory.entries) {
      const current = byCategory.get(entry.category) || [];
      current.push(entry.name);
      byCategory.set(entry.category, uniqueSuggestions(current));
    }
    return byCategory;
  }, [importedInventory.entries]);

  const cameraNameSuggestions = useMemo(() => {
    if (!bundle) return importedSuggestionsByCategory.get("camera") || [];
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "camera").flatMap((item) => [item.item_name, item.camera_label]),
      ...(importedSuggestionsByCategory.get("camera") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const lensSuggestions = useMemo(() => {
    if (!bundle) return importedSuggestionsByCategory.get("lens") || [];
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "lens").flatMap((item) => [item.item_name, item.camera_label]),
      ...(importedSuggestionsByCategory.get("lens") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const supportSuggestions = useMemo(() => {
    if (!bundle) return uniqueSuggestions([...(importedSuggestionsByCategory.get("tripod") || []), ...(importedSuggestionsByCategory.get("motion") || [])]);
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "tripod" || item.item_type === "motion").flatMap((item) => [item.item_name, item.camera_label]),
      ...(importedSuggestionsByCategory.get("tripod") || []),
      ...(importedSuggestionsByCategory.get("motion") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const powerSuggestions = useMemo(() => {
    if (!bundle) return importedSuggestionsByCategory.get("power") || [];
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "power").flatMap((item) => [item.item_name, item.camera_label]),
      ...(importedSuggestionsByCategory.get("power") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const monitorSuggestions = useMemo(() => {
    if (!bundle) return importedSuggestionsByCategory.get("monitor") || [];
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "monitor").flatMap((item) => [item.item_name, item.camera_label]),
      ...(importedSuggestionsByCategory.get("monitor") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const accessorySuggestions = useMemo(() => {
    if (!bundle) return uniqueSuggestions([...(importedSuggestionsByCategory.get("grip") || []), ...(importedSuggestionsByCategory.get("misc") || [])]);
    return uniqueSuggestions([
      ...bundle.items
        .filter((item) => ["grip", "misc"].includes(item.item_type))
        .flatMap((item) => [item.item_name, item.camera_label]),
      ...(importedSuggestionsByCategory.get("grip") || []),
      ...(importedSuggestionsByCategory.get("misc") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const movementSuggestions = useMemo(() => {
    const defaults = ["Static", "Handheld", "Tripod", "Gimbal", "Slider", "Pan", "Tilt", "Crane", "Dolly"];
    const derived = bundle
      ? bundle.items
          .filter((item) => item.item_type === "tripod" || item.item_type === "motion")
          .map((item) => item.item_name)
      : [];
    return uniqueSuggestions([...defaults, ...derived, ...(importedSuggestionsByCategory.get("tripod") || []), ...(importedSuggestionsByCategory.get("motion") || [])]);
  }, [bundle, importedSuggestionsByCategory]);

  const shotTypeSuggestions = useMemo(() => {
    return ["Wide", "Medium", "Close-up", "Extreme Close-up", "Long Shot", "Full Shot", "Medium Wide", "Medium Close-up", "Choker", "Macro", "Over the Shoulder", "POV"];
  }, []);

  const audioSuggestions = useMemo(() => {
    if (!bundle) return importedSuggestionsByCategory.get("sound") || [];
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "sound").map((item) => item.item_name),
      ...(importedSuggestionsByCategory.get("sound") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const lightingSuggestions = useMemo(() => {
    if (!bundle) return importedSuggestionsByCategory.get("light") || [];
    return uniqueSuggestions([
      ...bundle.items.filter((item) => item.item_type === "light").map((item) => item.item_name),
      ...(importedSuggestionsByCategory.get("light") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const propsSuggestions = useMemo(() => {
    if (!bundle) return uniqueSuggestions([...(importedSuggestionsByCategory.get("grip") || []), ...(importedSuggestionsByCategory.get("misc") || [])]);
    return uniqueSuggestions([
      ...bundle.items.filter((item) => ["grip", "misc"].includes(item.item_type)).map((item) => item.item_name),
      ...(importedSuggestionsByCategory.get("grip") || []),
      ...(importedSuggestionsByCategory.get("misc") || []),
    ]);
  }, [bundle, importedSuggestionsByCategory]);

  const getMergedItemSuggestions = (itemType: string) =>
    uniqueSuggestions([
      ...getItemSuggestions(itemType),
      ...(importedSuggestionsByCategory.get(itemType) || []),
    ]);

  const clearPendingSaves = () => {
    Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current = {};
  };

  const persistImportedInventory = (projectId: string, nextInventory: ImportedInventory) => {
    setImportedInventory(nextInventory);
    window.localStorage.setItem(`${SHOT_LIST_IMPORT_STORAGE_KEY}:${projectId}`, JSON.stringify(nextInventory));
  };

  const scheduleSave = async (key: string, task: () => Promise<void>, delay = 360) => {
    if (saveTimersRef.current[key]) {
      window.clearTimeout(saveTimersRef.current[key]);
    }
    saveTimersRef.current[key] = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await task();
        setSaveState("saved");
      } catch {
        setSaveState("error");
      } finally {
        delete saveTimersRef.current[key];
      }
    }, delay);
  };

  const updateProject = (patch: Partial<ShotListProject>) => {
    if (!bundle) return;
    const nextProject = { ...bundle.project, ...patch, updated_at: new Date().toISOString() };
    setBundle({ ...bundle, project: nextProject });
    void scheduleSave("project", () => invokeGuarded("shot_list_save_project", { project: nextProject }));
  };

  const updateRow = (rowId: string, patch: Partial<ShotListRow>) => {
    if (!bundle) return;
    const nextRows = bundle.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
    const updatedRow = nextRows.find((row) => row.id === rowId);
    setBundle({ ...bundle, rows: nextRows });
    if (updatedRow) void scheduleSave(`row:${rowId}`, () => invokeGuarded("shot_list_save_row", { row: updatedRow }));
  };

  const updateRowCameraSetups = (rowId: string, setups: CameraSetup[]) => {
    updateRow(rowId, { camera_lens: serializeCameraSetups(setups) });
  };

  const handleImportMarkdown = async () => {
    if (!bundle) return;
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      ],
      title: "Import equipment markdown",
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const content = await readTextFile(selected);
      const entries = parseMarkdownEquipmentInventory(content);
      const nextInventory: ImportedInventory = {
        entries,
        sourceName: selected.split("/").pop() || "Imported markdown",
      };
      persistImportedInventory(bundle.project.id, nextInventory);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import equipment markdown.");
    }
  };

  const saveWrapDocument = async (targetPath?: string | null) => {
    if (!bundle) return false;
    const resolvedPath =
      targetPath ||
      wrapFilePath ||
      (await save({
        filters: [{ name: "Wrap Shot List", extensions: [SHOT_LIST_WRAP_EXTENSION] }],
        defaultPath: `${sanitizeFileStem(bundle.project.title)}.${SHOT_LIST_WRAP_EXTENSION}`,
        title: "Save Shot List",
      }));
    if (!resolvedPath) return false;

    const payload: ShotListWrapDocument = {
      format: "wrap-shot-list",
      version: 1,
      saved_at: new Date().toISOString(),
      bundle: normalizeShotListBundle(bundle),
      importedInventory,
    };
    await writeTextFile(resolvedPath, JSON.stringify(payload, null, 2));
    setWrapFilePath(resolvedPath);
    setSaveState("saved");
    setError(null);
    return true;
  };

  const handleSaveWrap = async (saveAs = false) => {
    try {
      await saveWrapDocument(saveAs ? null : wrapFilePath);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Shot List file.");
    }
  };

  const handleOpenWrap = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Wrap Shot List", extensions: [SHOT_LIST_WRAP_EXTENSION, "json"] }],
      title: "Open Shot List",
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      clearPendingSaves();
      const content = await readTextFile(selected);
      const { bundle: nextBundle, importedInventory: nextInventory } = parseShotListWrapDocument(content);
      const now = new Date().toISOString();
      const hydratedBundle: ShotListBundle = {
        ...nextBundle,
        project: {
          ...nextBundle.project,
          updated_at: now,
          last_opened_at: now,
        },
      };
      await invokeGuarded("shot_list_replace_bundle", { bundle: hydratedBundle });
      setBundle(hydratedBundle);
      persistImportedInventory(hydratedBundle.project.id, nextInventory);
      setWrapFilePath(selected);
      setCollapsedRowIds(new Set());
      setCollapsedSectionIds(new Set());
      setCollapsedItemIds(new Set());
      setActiveOptionField(null);
      setSaveState("saved");
      setError(null);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open Shot List file.");
    }
  };

  const handleOptionFieldBlur = (fieldKey: string, event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setActiveOptionField((current) => (current === fieldKey ? null : current));
  };

  const addRow = async () => {
    if (!bundle) return;
    const nextRow = buildDefaultRow(bundle.project.id, bundle.rows.length + 1, String(bundle.rows.length + 1).padStart(2, "0"));
    const nextRows = sortByOrder([...bundle.rows, nextRow]).map((row, index) => ({ ...row, sort_order: index + 1 }));
    setBundle({ ...bundle, rows: nextRows });
    setSaveState("saving");
    await invokeGuarded("shot_list_save_row", { row: { ...nextRow, sort_order: nextRows.findIndex((row) => row.id === nextRow.id) + 1 } });
    await invokeGuarded("shot_list_reorder_rows", { projectId: bundle.project.id, rowIds: nextRows.map((row) => row.id) });
    setSaveState("saved");
  };

  const deleteRow = async (rowId: string) => {
    if (!bundle) return;
    const nextRows = bundle.rows.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, sort_order: index + 1 }));
    setBundle({ ...bundle, rows: nextRows });
    setSaveState("saving");
    await invokeGuarded("shot_list_delete_row", { rowId });
    await invokeGuarded("shot_list_reorder_rows", { projectId: bundle.project.id, rowIds: nextRows.map((row) => row.id) });
    setSaveState("saved");
  };

  const moveRow = async (rowId: string, direction: -1 | 1) => {
    if (!bundle) return;
    const currentIndex = bundle.rows.findIndex((row) => row.id === rowId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= bundle.rows.length) return;
    const nextRows = [...bundle.rows];
    const [moved] = nextRows.splice(currentIndex, 1);
    nextRows.splice(targetIndex, 0, moved);
    const normalized = nextRows.map((row, index) => ({ ...row, sort_order: index + 1 }));
    setBundle({ ...bundle, rows: normalized });
    setSaveState("saving");
    await invokeGuarded("shot_list_reorder_rows", { projectId: bundle.project.id, rowIds: normalized.map((row) => row.id) });
    setSaveState("saved");
  };

  const addSection = async (presetKey: string) => {
    if (!bundle) return;
    const nextSection = { ...buildDefaultSection(bundle.project.id, presetKey), sort_order: bundle.sections.length + 1 };
    const nextSections = [...bundle.sections, nextSection].map((section, index) => ({ ...section, sort_order: index + 1 }));
    setBundle({ ...bundle, sections: nextSections });
    setSectionPickerOpen(false);
    setSaveState("saving");
    await invokeGuarded("shot_list_save_equipment_section", { section: nextSection });
    await invokeGuarded("shot_list_reorder_sections", { projectId: bundle.project.id, sectionIds: nextSections.map((section) => section.id) });
    setSaveState("saved");
  };

  const updateSection = (sectionId: string, patch: Partial<ShotListEquipmentSection>) => {
    if (!bundle) return;
    const nextSections = bundle.sections.map((section) => {
      if (section.id !== sectionId) return section;
      const nextSection = { ...section, ...patch };
      if (patch.section_key && !patch.icon_name) {
        nextSection.icon_name = getDefaultIconNameForSection(patch.section_key);
      }
      return nextSection;
    });
    const updatedSection = nextSections.find((section) => section.id === sectionId);
    setBundle({ ...bundle, sections: nextSections });
    if (updatedSection) void scheduleSave(`section:${sectionId}`, () => invokeGuarded("shot_list_save_equipment_section", { section: updatedSection }));
  };

  const moveSection = async (sectionId: string, direction: -1 | 1) => {
    if (!bundle) return;
    const currentIndex = bundle.sections.findIndex((section) => section.id === sectionId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= bundle.sections.length) return;
    const nextSections = [...bundle.sections];
    const [moved] = nextSections.splice(currentIndex, 1);
    nextSections.splice(targetIndex, 0, moved);
    const normalized = nextSections.map((section, index) => ({ ...section, sort_order: index + 1 }));
    setBundle({ ...bundle, sections: normalized });
    setSaveState("saving");
    await invokeGuarded("shot_list_reorder_sections", { projectId: bundle.project.id, sectionIds: normalized.map((section) => section.id) });
    setSaveState("saved");
  };

  const deleteSection = async (sectionId: string) => {
    if (!bundle) return;
    const nextSections = bundle.sections.filter((section) => section.id !== sectionId).map((section, index) => ({ ...section, sort_order: index + 1 }));
    const nextItems = bundle.items.filter((item) => item.section_id !== sectionId);
    setBundle({ ...bundle, sections: nextSections, items: nextItems });
    setSaveState("saving");
    await invokeGuarded("shot_list_delete_equipment_section", { sectionId });
    await invokeGuarded("shot_list_reorder_sections", { projectId: bundle.project.id, sectionIds: nextSections.map((section) => section.id) });
    setSaveState("saved");
  };

  const addItem = async (section: ShotListEquipmentSection) => {
    if (!bundle) return;
    const inSection = bundle.items.filter((item) => item.section_id === section.id);
    const nextItem = buildDefaultItem(section, inSection.length);
    const nextItems = [...bundle.items, nextItem];
    setBundle({ ...bundle, items: nextItems });
    setSaveState("saving");
    await invokeGuarded("shot_list_save_equipment_item", { item: nextItem });
    setSaveState("saved");
  };

  const updateItem = (itemId: string, patch: Partial<ShotListEquipmentItem>) => {
    if (!bundle) return;
    const nextItems = bundle.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item));
    const updatedItem = nextItems.find((item) => item.id === itemId);
    setBundle({ ...bundle, items: nextItems });
    if (updatedItem) void scheduleSave(`item:${itemId}`, () => invokeGuarded("shot_list_save_equipment_item", { item: updatedItem }));
  };

  const moveItem = async (sectionId: string, itemId: string, direction: -1 | 1) => {
    if (!bundle) return;
    const sectionItems = bundle.items.filter((item) => item.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order);
    const currentIndex = sectionItems.findIndex((item) => item.id === itemId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sectionItems.length) return;
    const nextItemsInSection = [...sectionItems];
    const [moved] = nextItemsInSection.splice(currentIndex, 1);
    nextItemsInSection.splice(targetIndex, 0, moved);
    const normalizedSectionItems = nextItemsInSection.map((item, index) => ({ ...item, sort_order: index + 1 }));
    const nextItems = bundle.items.map((item) => normalizedSectionItems.find((entry) => entry.id === item.id) || item);
    setBundle({ ...bundle, items: nextItems });
    setSaveState("saving");
    await invokeGuarded("shot_list_reorder_equipment_items", { sectionId, itemIds: normalizedSectionItems.map((item) => item.id) });
    setSaveState("saved");
  };

  const deleteItem = async (itemId: string) => {
    if (!bundle) return;
    const targetItem = bundle.items.find((item) => item.id === itemId);
    if (!targetItem) return;
    const remainingItems = bundle.items.filter((item) => item.id !== itemId);
    const normalizedItems = remainingItems.map((item) => {
      if (item.section_id !== targetItem.section_id) return item;
      const nextOrder =
        remainingItems
          .filter((entry) => entry.section_id === targetItem.section_id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .findIndex((entry) => entry.id === item.id) + 1;
      return { ...item, sort_order: nextOrder };
    });
    setBundle({ ...bundle, items: normalizedItems });
    setSaveState("saving");
    await invokeGuarded("shot_list_delete_equipment_item", { itemId });
    await invokeGuarded("shot_list_reorder_equipment_items", {
      sectionId: targetItem.section_id,
      itemIds: normalizedItems.filter((item) => item.section_id === targetItem.section_id).sort((a, b) => a.sort_order - b.sort_order).map((item) => item.id),
    });
    setSaveState("saved");
  };

  const handleExport = async (kind: "pdf" | "image") => {
    if (!bundle) return;
    setExporting(kind);
    try {
      if (kind === "pdf") {
        await exportShotListPdf({ ...bundle, appVersion });
      } else {
        await exportShotListImage({ ...bundle, appVersion });
      }
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : `Failed to export ${kind.toUpperCase()}.`);
    } finally {
      setExporting(null);
    }
  };

  const toggleSectionCollapsed = (sectionId: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const toggleRowCollapsed = (rowId: string) => {
    setCollapsedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleItemCollapsed = (itemId: string) => {
    setCollapsedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="shot-list-shell">
        <div className="shot-list-loading premium-card">
          <LoaderCircle className="shot-list-spinner" size={22} />
          <span>Loading Shot List…</span>
        </div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="shot-list-shell">
        <div className="shot-list-loading premium-card">
          <span>{error || "Shot List could not be loaded."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="shot-list-shell">
      <div className="shot-list-header-card premium-card">
        <div className="shot-list-header-main">
          <div className="shot-list-header-copy">
            <span className="shot-list-eyebrow">Shot List</span>
            <div className="shot-list-header-title-row">
              <input
                className="shot-list-title-input"
                value={bundle.project.title}
                placeholder="Project title"
                onChange={(event) => updateProject({ title: event.target.value })}
              />
              <input
                className="shot-list-day-input"
                value={bundle.project.day_label}
                placeholder="Day sheet"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => updateProject({ day_label: event.target.value })}
              />
            </div>
          </div>
          <div className="shot-list-actions">
            <span className={`shot-list-save-badge ${saveState}`}>
              <span className="shot-list-save-dot" />
              <span>{saveState === "error" ? "Save issue" : "Saved"}</span>
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleOpenWrap()} disabled={!!exporting}>
              <FolderOpen size={14} />
              <span>Open</span>
            </button>
            <div className={`shot-list-actions-dropdown ${actionsMenuOpen ? "is-open" : ""}`} ref={actionsMenuRef}>
              <button
                type="button"
                className="btn btn-primary btn-sm btn-glow"
                onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                disabled={!!exporting}
              >
                <Save size={14} />
                <span>Save & Export</span>
                <ChevronDown size={14} className={`dropdown-arrow ${actionsMenuOpen ? "is-open" : ""}`} />
              </button>
              {actionsMenuOpen && (
                <div className="shot-list-actions-menu">
                  <button
                    className="shot-list-action-item"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      void handleSaveWrap(false);
                    }}
                  >
                    <Save size={14} />
                    <span>Save .wrap</span>
                  </button>
                  <button
                    className="shot-list-action-item"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      void handleSaveWrap(true);
                    }}
                  >
                    <Save size={14} />
                    <span>Save As</span>
                  </button>
                  <div className="shot-list-actions-divider" />
                  <button
                    className="shot-list-action-item"
                    disabled={!!exporting}
                    onClick={() => {
                      setActionsMenuOpen(false);
                      void handleExport("pdf");
                    }}
                  >
                    <Download size={14} />
                    <span>{exporting === "pdf" ? "Exporting PDF…" : "Export PDF"}</span>
                  </button>
                  <button
                    className="shot-list-action-item"
                    disabled={!!exporting}
                    onClick={() => {
                      setActionsMenuOpen(false);
                      void handleExport("image");
                    }}
                  >
                    <Download size={14} />
                    <span>{exporting === "image" ? "Exporting Image…" : "Export Image"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shot-list-summary-grid">
          {[
            { label: "Shots", value: bundle.rows.length, Icon: SHOT_LIST_SUMMARY_ICONS.rows, tone: "shots" },
            { label: "Sections", value: bundle.sections.length, Icon: SHOT_LIST_SUMMARY_ICONS.sections, tone: "gear" },
            { label: "Gear", value: bundle.items.length, Icon: SHOT_LIST_SUMMARY_ICONS.items, tone: "gear" },
            { label: "Cameras", value: cameraCount, Icon: SHOT_LIST_SUMMARY_ICONS.cameras, tone: "gear" },
          ].map(({ label, value, Icon, tone }) => (
            <div key={label} className={`shot-list-summary-card ${tone}`}>
              <div className="shot-list-summary-icon"><Icon size={16} /></div>
              <div>
                <span className="shot-list-summary-label">{label}</span>
                <strong className="shot-list-summary-value">{value}</strong>
              </div>
            </div>
          ))}
        </div>
        {error && <div className="error-banner"><strong>Shot List</strong> {error}</div>}
      </div>

      <div className="shot-list-body">
        <section className="shot-list-rows-column premium-card">
          <div className="shot-list-section-heading">
            <div>
              <h2>Shot Rows</h2>
            </div>
            <div className="shot-list-action-with-hint">
              <button type="button" className="btn btn-secondary btn-sm shot-list-hinted-button" onClick={() => void addRow()}>
                <Plus size={14} />
                <span>Add Shot</span>
                <span className="shot-list-inline-hint-icon shot-list-tooltip-anchor shot-list-button-corner-hint" data-tooltip="Add the next shot row to the day sheet.">
                  <HelpCircle size={12} />
                </span>
              </button>
            </div>
          </div>
          <div className="shot-list-row-stack">
            {bundle.rows.length === 0 && (
              <div className="shot-list-empty-state">
                <p>Start with the essential shots for the day. Keep it minimal and readable.</p>
                <div className="shot-list-action-with-hint">
                  <button type="button" className="btn btn-secondary btn-sm shot-list-hinted-button" onClick={() => void addRow()}>
                    <Plus size={14} />
                    <span>Create first shot</span>
                    <span className="shot-list-inline-hint-icon shot-list-tooltip-anchor shot-list-button-corner-hint" data-tooltip="Use this first, then keep building with Add Shot.">
                      <HelpCircle size={12} />
                    </span>
                  </button>
                </div>
              </div>
            )}
            {bundle.rows.map((row, index) => {
              const TypeIcon = getShotListIconComponent(getCaptureTypeIconName(row.capture_type));
              const cameraSetups = parseCameraSetups(row.camera_lens).map((setup, setupIndex) =>
                setupIndex === 0 && (!setup.movement || setup.movement.trim() === "")
                  ? { ...setup, movement: row.camera_movement || row.movement || "Static" }
                  : setup,
              );
              const isRowCollapsed = collapsedRowIds.has(row.id);
              const addedCameraNames = cameraSetups.map((setup) => setup.camera.trim().toLowerCase()).filter(Boolean);
              const availableCameraSuggestions = cameraNameSuggestions.filter((suggestion) => !addedCameraNames.includes(suggestion.trim().toLowerCase())).slice(0, 6);
              return (
                <article key={row.id} className="shot-list-row-card">
                  <div className="shot-list-row-topline">
                    <div className="shot-list-row-topline-left">
                      <span className="shot-list-row-index">Shot</span>
                      <input
                        className="shot-list-shot-number"
                        value={row.shot_number}
                        onChange={(event) => updateRow(row.id, { shot_number: event.target.value })}
                      />
                      <div className={`shot-list-type-toggle ${row.capture_type}-active`}>
                        {(["photo", "video"] as const).map((captureType) => {
                          const CaptureIcon = getShotListIconComponent(getCaptureTypeIconName(captureType));
                          return (
                            <button
                              key={captureType}
                              type="button"
                              className={`shot-list-type-button ${captureType} ${row.capture_type === captureType ? "active" : ""}`}
                              onClick={() => updateRow(row.id, { capture_type: captureType })}
                            >
                              <CaptureIcon size={14} />
                              <span>{captureType}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="shot-list-row-actions">
                      <button type="button" className="shot-list-icon-btn" onClick={() => toggleRowCollapsed(row.id)} aria-label={isRowCollapsed ? "Expand shot row" : "Collapse shot row"}>
                        {isRowCollapsed ? <Plus size={14} /> : <Minus size={14} />}
                      </button>
                      <button type="button" className="shot-list-icon-btn" onClick={() => void moveRow(row.id, -1)} disabled={index === 0}>
                        <ChevronUp size={14} />
                      </button>
                      <button type="button" className="shot-list-icon-btn" onClick={() => void moveRow(row.id, 1)} disabled={index === bundle.rows.length - 1}>
                        <ChevronDown size={14} />
                      </button>
                      <button type="button" className="shot-list-icon-btn danger" onClick={() => void deleteRow(row.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isRowCollapsed ? (
                    <div className="shot-list-collapsed-summary shot-list-collapsed-row-summary">
                      <div className="shot-list-collapsed-summary-icon"><TypeIcon size={14} /></div>
                      <span>{row.scene || row.description || `Shot ${row.shot_number}`}</span>
                      <small>{row.capture_type === "photo" ? "Photo" : "Motion"}</small>
                    </div>
                  ) : (
                  <div className="shot-list-row-grid">
                    <label>
                      <span className="shot-list-field-heading">
                        <span>Scene</span>
                      </span>
                      <input
                        value={row.scene}
                        placeholder="Scene 03, Opening beat, Chorus"
                        onChange={(event) => updateRow(row.id, { scene: event.target.value })}
                      />
                    </label>
                    <label>
                      <span className="shot-list-field-heading">
                        <span>Shot Type</span>
                      </span>
                      <div
                        className={`shot-list-option-field ${activeOptionField === `${row.id}-shot_type` ? "is-open" : ""}`}
                        onBlur={(event) => handleOptionFieldBlur(`${row.id}-shot_type`, event)}
                      >
                        <input
                          value={row.shot_type}
                          placeholder="Wide, medium, close-up"
                          onFocus={() => setActiveOptionField(`${row.id}-shot_type`)}
                          onChange={(event) => updateRow(row.id, { shot_type: event.target.value })}
                        />
                        <div className="shot-list-field-options">
                          <div className="shot-list-suggestion-pills">
                            {shotTypeSuggestions.map((suggestion) => (
                              <button
                                key={`${row.id}-shot_type-${suggestion}`}
                                type="button"
                                className="shot-list-suggestion-pill"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => updateRow(row.id, { shot_type: suggestion })}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </label>
                    <label className="shot-list-row-wide">
                      <span>Description / Action</span>
                      <input
                        value={row.description}
                        placeholder="What needs to be captured in this shot or moment"
                        onChange={(event) => updateRow(row.id, { description: event.target.value })}
                      />
                    </label>
                    <label className="shot-list-row-wide">
                      <span className="shot-list-field-heading">
                        <span>Camera setups</span>
                        <span className="shot-list-field-clue shot-list-tooltip-anchor" data-tooltip="Add multiple camera positions for the same shot. Use one line per camera setup.">
                          <HelpCircle size={12} />
                        </span>
                      </span>
                      <div className="shot-list-camera-stack">
                        {cameraSetups.map((setup, setupIndex) => (
                          <div key={`${row.id}-camera-${setupIndex}`} className="shot-list-camera-entry">
                            <span className="shot-list-camera-entry-label" aria-label={`Camera ${setupIndex + 1}`}>
                              <Camera size={16} />
                              <small>{setupIndex + 1}</small>
                            </span>
                            <div className="shot-list-camera-fields">
                              <div
                                className={`shot-list-option-field ${activeOptionField === `${row.id}-camera-${setupIndex}` ? "is-open" : ""}`}
                                onBlur={(event) => handleOptionFieldBlur(`${row.id}-camera-${setupIndex}`, event)}
                              >
                                <input
                                  value={setup.camera}
                                  placeholder="Camera"
                                  onFocus={() => setActiveOptionField(`${row.id}-camera-${setupIndex}`)}
                                  onChange={(event) => {
                                    const next = [...cameraSetups];
                                    next[setupIndex] = { ...next[setupIndex], camera: event.target.value };
                                    updateRowCameraSetups(row.id, next);
                                  }}
                                />
                                {availableCameraSuggestions.length > 0 && (
                                  <div className="shot-list-field-options">
                                    <div className="shot-list-suggestion-pills">
                                      {availableCameraSuggestions.map((suggestion) => (
                                        <button
                                          key={`${row.id}-${setupIndex}-camera-${suggestion}`}
                                          type="button"
                                          className="shot-list-suggestion-pill"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => {
                                            const next = [...cameraSetups];
                                            next[setupIndex] = { ...next[setupIndex], camera: suggestion };
                                            updateRowCameraSetups(row.id, next);
                                          }}
                                        >
                                          {suggestion}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div
                                className={`shot-list-option-field ${activeOptionField === `${row.id}-lens-${setupIndex}` ? "is-open" : ""}`}
                                onBlur={(event) => handleOptionFieldBlur(`${row.id}-lens-${setupIndex}`, event)}
                              >
                                <input
                                  value={setup.lens}
                                  placeholder="Lens"
                                  onFocus={() => setActiveOptionField(`${row.id}-lens-${setupIndex}`)}
                                  onChange={(event) => {
                                    const next = [...cameraSetups];
                                    next[setupIndex] = { ...next[setupIndex], lens: event.target.value };
                                    updateRowCameraSetups(row.id, next);
                                  }}
                                />
                                {lensSuggestions.length > 0 && (
                                  <div className="shot-list-field-options">
                                    <div className="shot-list-suggestion-pills">
                                      {lensSuggestions.slice(0, 6).map((suggestion) => (
                                        <button
                                          key={`${row.id}-${setupIndex}-lens-${suggestion}`}
                                          type="button"
                                          className="shot-list-suggestion-pill"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => {
                                            const next = [...cameraSetups];
                                            next[setupIndex] = { ...next[setupIndex], lens: suggestion };
                                            updateRowCameraSetups(row.id, next);
                                          }}
                                        >
                                          {suggestion}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div
                                className={`shot-list-option-field ${activeOptionField === `${row.id}-accessory-${setupIndex}` ? "is-open" : ""}`}
                                onBlur={(event) => handleOptionFieldBlur(`${row.id}-accessory-${setupIndex}`, event)}
                              >
                                <input
                                  value={setup.accessory}
                                  placeholder="Filter / adapter / accessory"
                                  onFocus={() => setActiveOptionField(`${row.id}-accessory-${setupIndex}`)}
                                  onChange={(event) => {
                                    const next = [...cameraSetups];
                                    next[setupIndex] = { ...next[setupIndex], accessory: event.target.value };
                                    updateRowCameraSetups(row.id, next);
                                  }}
                                />
                                {accessorySuggestions.length > 0 && (
                                  <div className="shot-list-field-options">
                                    <div className="shot-list-suggestion-pills">
                                      {accessorySuggestions.slice(0, 6).map((suggestion) => (
                                        <button
                                          key={`${row.id}-${setupIndex}-accessory-${suggestion}`}
                                          type="button"
                                          className="shot-list-suggestion-pill"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => {
                                            const next = [...cameraSetups];
                                            next[setupIndex] = { ...next[setupIndex], accessory: suggestion };
                                            updateRowCameraSetups(row.id, next);
                                          }}
                                        >
                                          {suggestion}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="shot-list-icon-btn danger"
                              onClick={() => {
                                const next = cameraSetups.filter((_, entryIndex) => entryIndex !== setupIndex);
                                updateRowCameraSetups(row.id, next.length > 0 ? next : [createEmptyCameraSetup()]);
                              }}
                              disabled={cameraSetups.length === 1 && !cameraSetups[0].camera.trim() && !cameraSetups[0].lens.trim() && !cameraSetups[0].accessory.trim() && !cameraSetups[0].media.trim() && !cameraSetups[0].support.trim() && (!cameraSetups[0].movement.trim() || cameraSetups[0].movement.trim().toLowerCase() === "static") && !cameraSetups[0].power.trim() && !cameraSetups[0].monitor.trim()}
                            >
                              <Trash2 size={14} />
                            </button>
                            <div className="shot-list-camera-support">
                              <div className="shot-list-camera-inline-meta">
                                <div
                                  className={`shot-list-option-field ${activeOptionField === `${row.id}-media-${setupIndex}` ? "is-open" : ""}`}
                                  onBlur={(event) => handleOptionFieldBlur(`${row.id}-media-${setupIndex}`, event)}
                                >
                                  <input
                                    value={setup.media}
                                    placeholder="Media"
                                    onFocus={() => setActiveOptionField(`${row.id}-media-${setupIndex}`)}
                                    onChange={(event) => {
                                      const next = [...cameraSetups];
                                      next[setupIndex] = { ...next[setupIndex], media: event.target.value };
                                      updateRowCameraSetups(row.id, next);
                                    }}
                                  />
                                  {(importedSuggestionsByCategory.get("media") || []).length > 0 && (
                                    <div className="shot-list-field-options">
                                      <div className="shot-list-suggestion-pills">
                                        {(importedSuggestionsByCategory.get("media") || []).slice(0, 6).map((suggestion) => (
                                          <button
                                            key={`${row.id}-${setupIndex}-media-${suggestion}`}
                                            type="button"
                                            className="shot-list-suggestion-pill"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => {
                                              const next = [...cameraSetups];
                                              next[setupIndex] = { ...next[setupIndex], media: suggestion };
                                              updateRowCameraSetups(row.id, next);
                                            }}
                                          >
                                            {suggestion}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div
                                  className={`shot-list-option-field ${activeOptionField === `${row.id}-support-${setupIndex}` ? "is-open" : ""}`}
                                  onBlur={(event) => handleOptionFieldBlur(`${row.id}-support-${setupIndex}`, event)}
                                >
                                  <input
                                    value={setup.support}
                                    placeholder="Support / position"
                                    onFocus={() => setActiveOptionField(`${row.id}-support-${setupIndex}`)}
                                    onChange={(event) => {
                                      const next = [...cameraSetups];
                                      next[setupIndex] = { ...next[setupIndex], support: event.target.value };
                                      updateRowCameraSetups(row.id, next);
                                    }}
                                  />
                                  {supportSuggestions.length > 0 && (
                                    <div className="shot-list-field-options">
                                      <div className="shot-list-suggestion-pills">
                                        {supportSuggestions.slice(0, 6).map((suggestion) => (
                                          <button
                                            key={`${row.id}-${setupIndex}-support-${suggestion}`}
                                            type="button"
                                            className="shot-list-suggestion-pill"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => {
                                              const next = [...cameraSetups];
                                              next[setupIndex] = { ...next[setupIndex], support: suggestion };
                                              updateRowCameraSetups(row.id, next);
                                            }}
                                          >
                                            {suggestion}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div
                                  className={`shot-list-option-field ${activeOptionField === `${row.id}-movement-${setupIndex}` ? "is-open" : ""}`}
                                  onBlur={(event) => handleOptionFieldBlur(`${row.id}-movement-${setupIndex}`, event)}
                                >
                                  <input
                                    value={setup.movement}
                                    placeholder="Camera movement"
                                    onFocus={() => setActiveOptionField(`${row.id}-movement-${setupIndex}`)}
                                    onChange={(event) => {
                                      const next = [...cameraSetups];
                                      next[setupIndex] = { ...next[setupIndex], movement: event.target.value };
                                      updateRowCameraSetups(row.id, next);
                                      if (setupIndex === 0) {
                                        updateRow(row.id, { camera_movement: event.target.value, movement: event.target.value });
                                      }
                                    }}
                                  />
                                  {movementSuggestions.length > 0 && (
                                    <div className="shot-list-field-options">
                                      <div className="shot-list-suggestion-pills">
                                        {movementSuggestions.slice(0, 6).map((suggestion) => (
                                          <button
                                            key={`${row.id}-${setupIndex}-movement-${suggestion}`}
                                            type="button"
                                            className="shot-list-suggestion-pill"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => {
                                              const next = [...cameraSetups];
                                              next[setupIndex] = { ...next[setupIndex], movement: suggestion };
                                              updateRowCameraSetups(row.id, next);
                                              if (setupIndex === 0) {
                                                updateRow(row.id, { camera_movement: suggestion, movement: suggestion });
                                              }
                                            }}
                                          >
                                            {suggestion}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div
                                  className={`shot-list-option-field ${activeOptionField === `${row.id}-power-${setupIndex}` ? "is-open" : ""}`}
                                  onBlur={(event) => handleOptionFieldBlur(`${row.id}-power-${setupIndex}`, event)}
                                >
                                  <input
                                    value={setup.power}
                                    placeholder="Power"
                                    onFocus={() => setActiveOptionField(`${row.id}-power-${setupIndex}`)}
                                    onChange={(event) => {
                                      const next = [...cameraSetups];
                                      next[setupIndex] = { ...next[setupIndex], power: event.target.value };
                                      updateRowCameraSetups(row.id, next);
                                    }}
                                  />
                                  {powerSuggestions.length > 0 && (
                                    <div className="shot-list-field-options">
                                      <div className="shot-list-suggestion-pills">
                                        {powerSuggestions.slice(0, 6).map((suggestion) => (
                                          <button
                                            key={`${row.id}-${setupIndex}-power-${suggestion}`}
                                            type="button"
                                            className="shot-list-suggestion-pill"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => {
                                              const next = [...cameraSetups];
                                              next[setupIndex] = { ...next[setupIndex], power: suggestion };
                                              updateRowCameraSetups(row.id, next);
                                            }}
                                          >
                                            {suggestion}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div
                                  className={`shot-list-option-field ${activeOptionField === `${row.id}-monitor-${setupIndex}` ? "is-open" : ""}`}
                                  onBlur={(event) => handleOptionFieldBlur(`${row.id}-monitor-${setupIndex}`, event)}
                                >
                                  <input
                                    value={setup.monitor}
                                    placeholder="Monitor"
                                    onFocus={() => setActiveOptionField(`${row.id}-monitor-${setupIndex}`)}
                                    onChange={(event) => {
                                      const next = [...cameraSetups];
                                      next[setupIndex] = { ...next[setupIndex], monitor: event.target.value };
                                      updateRowCameraSetups(row.id, next);
                                    }}
                                  />
                                  {monitorSuggestions.length > 0 && (
                                    <div className="shot-list-field-options">
                                      <div className="shot-list-suggestion-pills">
                                        {monitorSuggestions.slice(0, 6).map((suggestion) => (
                                          <button
                                            key={`${row.id}-${setupIndex}-monitor-${suggestion}`}
                                            type="button"
                                            className="shot-list-suggestion-pill"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => {
                                              const next = [...cameraSetups];
                                              next[setupIndex] = { ...next[setupIndex], monitor: suggestion };
                                              updateRowCameraSetups(row.id, next);
                                            }}
                                          >
                                            {suggestion}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="shot-list-camera-footer">
                        <button
                          type="button"
                          className="shot-list-add-item shot-list-add-camera"
                          onClick={() => updateRowCameraSetups(row.id, [...cameraSetups, createEmptyCameraSetup()])}
                        >
                          <Plus size={14} />
                          <span>Add camera</span>
                        </button>
                      </div>
                    </label>
                    <label>
                      <span className="shot-list-field-heading">
                        <span>Location</span>
                      </span>
                      <input
                        value={row.location}
                        placeholder="Location"
                        onChange={(event) => updateRow(row.id, { location: event.target.value })}
                      />
                    </label>
                    <label>
                      <span className="shot-list-field-heading">
                        <span>Timing</span>
                      </span>
                      <input
                        value={row.timing}
                        placeholder="Start - End"
                        onChange={(event) => updateRow(row.id, { timing: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Audio Notes</span>
                      <div
                        className={`shot-list-option-field ${activeOptionField === `${row.id}-audio_notes` ? "is-open" : ""}`}
                        onBlur={(event) => handleOptionFieldBlur(`${row.id}-audio_notes`, event)}
                      >
                        <input
                          value={row.audio_notes}
                          placeholder="Sync, wild, lavs..."
                          onFocus={() => setActiveOptionField(`${row.id}-audio_notes`)}
                          onChange={(event) => updateRow(row.id, { audio_notes: event.target.value })}
                        />
                        <div className="shot-list-field-options">
                          <div className="shot-list-suggestion-pills">
                            {audioSuggestions.slice(0, 5).map((suggestion) => (
                              <button
                                key={`${row.id}-audio-${suggestion}`}
                                type="button"
                                className="shot-list-suggestion-pill"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => updateRow(row.id, { audio_notes: suggestion })}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </label>
                    <label>
                      <span>Lighting Notes</span>
                      <div
                        className={`shot-list-option-field ${activeOptionField === `${row.id}-lighting_notes` ? "is-open" : ""}`}
                        onBlur={(event) => handleOptionFieldBlur(`${row.id}-lighting_notes`, event)}
                      >
                        <input
                          value={row.lighting_notes}
                          placeholder="Controlled, day, night..."
                          onFocus={() => setActiveOptionField(`${row.id}-lighting_notes`)}
                          onChange={(event) => updateRow(row.id, { lighting_notes: event.target.value })}
                        />
                        <div className="shot-list-field-options">
                          <div className="shot-list-suggestion-pills">
                            {lightingSuggestions.slice(0, 5).map((suggestion) => (
                              <button
                                key={`${row.id}-lighting-${suggestion}`}
                                type="button"
                                className="shot-list-suggestion-pill"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => updateRow(row.id, { lighting_notes: suggestion })}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </label>
                    <label>
                      <span>Talent / Subjects</span>
                      <input
                        value={row.talent_subjects}
                        placeholder="Person name, group..."
                        onChange={(event) => updateRow(row.id, { talent_subjects: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Props / Set Details</span>
                      <div
                        className={`shot-list-option-field ${activeOptionField === `${row.id}-props_details` ? "is-open" : ""}`}
                        onBlur={(event) => handleOptionFieldBlur(`${row.id}-props_details`, event)}
                      >
                        <input
                          value={row.props_details}
                          placeholder="Prop list, furniture..."
                          onFocus={() => setActiveOptionField(`${row.id}-props_details`)}
                          onChange={(event) => updateRow(row.id, { props_details: event.target.value })}
                        />
                        <div className="shot-list-field-options">
                          <div className="shot-list-suggestion-pills">
                            {propsSuggestions.slice(0, 5).map((suggestion) => (
                              <button
                                key={`${row.id}-props-${suggestion}`}
                                type="button"
                                className="shot-list-suggestion-pill"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => updateRow(row.id, { props_details: suggestion })}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </label>
                    <label>
                      <span>Status</span>
                      <select value={row.status} onChange={(event) => updateRow(row.id, { status: event.target.value })}>
                        {SHOT_LIST_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="shot-list-row-wide">
                      <span>Notes</span>
                      <textarea value={row.notes} onChange={(event) => updateRow(row.id, { notes: event.target.value })} rows={2} />
                    </label>
                  </div>
                  )}
                  <div className={`shot-list-row-badge ${row.capture_type}`}>
                    <TypeIcon size={14} />
                    <span>{row.capture_type === "photo" ? "Photo" : "Motion"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="shot-list-equipment-column premium-card">
          <div className="shot-list-section-heading shot-list-equipment-heading">
            <div>
              <h2>Visual gear sections</h2>
            </div>
            <div className="shot-list-section-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleImportMarkdown()}>
                <Download size={14} />
                <span>Import List</span>
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSectionPickerOpen((open) => !open)}>
                <Plus size={14} />
                <span>Add section</span>
              </button>
            </div>
          </div>

          {sectionPickerOpen && (
            <div className="shot-list-section-picker">
              {SHOT_LIST_SECTION_PRESETS.map((preset) => {
                const Icon = getShotListIconComponent(preset.iconName);
                return (
                  <button key={preset.key} type="button" className="shot-list-section-preset" onClick={() => void addSection(preset.key)}>
                    <span className="shot-list-section-preset-icon"><Icon size={16} /></span>
                    <span className="shot-list-section-preset-copy">
                      <strong>{preset.label}</strong>
                      <small>{preset.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="shot-list-equipment-stack">
            {sectionsWithItems.length === 0 && (
              <div className="shot-list-empty-state equipment">
                <p>Add camera, light, sound, tripod, media, or any other section needed for the day.</p>
              </div>
            )}
            {sectionsWithItems.map(({ section, items }, sectionIndex) => {
              const SectionIcon = getShotListIconComponent(section.icon_name);
              const isCollapsed = collapsedSectionIds.has(section.id);
              return (
                <article key={section.id} className="shot-list-equipment-card">
                  <div className="shot-list-equipment-card-header">
                    <div className="shot-list-equipment-card-title">
                      <div className="shot-list-equipment-icon"><SectionIcon size={18} /></div>
                      <div className="shot-list-equipment-title-fields">
                        <input value={section.section_name} onChange={(event) => updateSection(section.id, { section_name: event.target.value })} />
                        <div className="shot-list-equipment-meta">
                          <select value={section.section_key || "misc"} onChange={(event) => updateSection(section.id, { section_key: event.target.value, icon_name: getDefaultIconNameForSection(event.target.value) })}>
                            {SHOT_LIST_SECTION_PRESETS.map((preset) => (
                              <option key={preset.key} value={preset.key}>{preset.label}</option>
                            ))}
                          </select>
                          <select value={section.icon_name} onChange={(event) => updateSection(section.id, { icon_name: event.target.value })}>
                            {getShotListIconOptionsForSection(section.section_key).map((option) => (
                              <option key={`${section.id}-${option.value}`} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="shot-list-row-actions">
                      <button type="button" className="shot-list-icon-btn" onClick={() => toggleSectionCollapsed(section.id)} aria-label={isCollapsed ? "Expand section" : "Collapse section"}>
                        {isCollapsed ? <Plus size={14} /> : <Minus size={14} />}
                      </button>
                      <button type="button" className="shot-list-icon-btn" onClick={() => void moveSection(section.id, -1)} disabled={sectionIndex === 0}>
                        <ChevronUp size={14} />
                      </button>
                      <button type="button" className="shot-list-icon-btn" onClick={() => void moveSection(section.id, 1)} disabled={sectionIndex === bundle.sections.length - 1}>
                        <ChevronDown size={14} />
                      </button>
                      <button type="button" className="shot-list-icon-btn danger" onClick={() => void deleteSection(section.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isCollapsed ? (
                    <div className="shot-list-collapsed-summary">
                      <div className="shot-list-collapsed-summary-icon"><SectionIcon size={15} /></div>
                      <span>{section.section_name}</span>
                      <small>{items.length} items</small>
                    </div>
                  ) : (
                    <>
                      <div className="shot-list-equipment-items">
                        {items.map((item, itemIndex) => {
                          const ItemIcon = getShotListIconComponent(item.icon_name);
                          const showMediaFields = item.item_type === "camera" || item.item_type === "media";
                          const detailMeta = getItemDetailMeta(item.item_type);
                          const itemSuggestions = getMergedItemSuggestions(item.item_type);
                          const isItemCollapsed = collapsedItemIds.has(item.id);
                          return (
                            <div key={item.id} className="shot-list-equipment-item">
                              <div className="shot-list-equipment-item-header">
                                <div className="shot-list-equipment-item-title">
                                  <div className="shot-list-equipment-item-icon"><ItemIcon size={15} /></div>
                                  <input
                                    value={item.item_name}
                                    placeholder={detailMeta.itemPlaceholder}
                                    onChange={(event) => updateItem(item.id, { item_name: event.target.value })}
                                  />
                                </div>
                                <div className="shot-list-row-actions">
                                  <button type="button" className="shot-list-icon-btn" onClick={() => toggleItemCollapsed(item.id)} aria-label={isItemCollapsed ? "Expand item" : "Collapse item"}>
                                    {isItemCollapsed ? <Plus size={14} /> : <Minus size={14} />}
                                  </button>
                                  <button type="button" className="shot-list-icon-btn" onClick={() => void moveItem(section.id, item.id, -1)} disabled={itemIndex === 0}>
                                    <ChevronUp size={14} />
                                  </button>
                                  <button type="button" className="shot-list-icon-btn" onClick={() => void moveItem(section.id, item.id, 1)} disabled={itemIndex === items.length - 1}>
                                    <ChevronDown size={14} />
                                  </button>
                                  <button type="button" className="shot-list-icon-btn danger" onClick={() => void deleteItem(item.id)}>
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>

                              {isItemCollapsed ? (
                                <div className="shot-list-collapsed-summary shot-list-collapsed-item-summary">
                                  <div className="shot-list-collapsed-summary-icon"><ItemIcon size={14} /></div>
                                  <span>{item.item_name || detailMeta.itemLabel}</span>
                                  <small>{item.item_type}</small>
                                </div>
                              ) : (
                              <div className="shot-list-equipment-item-grid">
                                <label>
                                  <span>Type</span>
                                  <select
                                    value={item.item_type}
                                    onChange={(event) =>
                                      updateItem(item.id, {
                                        item_type: event.target.value,
                                        icon_name: getDefaultIconNameForSection(event.target.value),
                                        media_type: event.target.value === "camera" || event.target.value === "media" ? item.media_type || "SSD" : null,
                                        capacity_value: event.target.value === "camera" || event.target.value === "media" ? item.capacity_value : null,
                                        capacity_unit: event.target.value === "camera" || event.target.value === "media" ? item.capacity_unit || "GB" : "GB",
                                        camera_label: "",
                                      })
                                    }
                                  >
                                    <option value="camera">Camera</option>
                                    <option value="light">Light</option>
                                    <option value="sound">Sound</option>
                                    <option value="tripod">Tripod</option>
                                    <option value="motion">Motion Support</option>
                                    <option value="lens">Lens</option>
                                    <option value="grip">Grip</option>
                                    <option value="monitor">Monitor</option>
                                    <option value="power">Power</option>
                                    <option value="media">Media</option>
                                    <option value="misc">Misc</option>
                                  </select>
                                </label>
                                <label>
                                  <span>Icon</span>
                                  <select value={item.icon_name} onChange={(event) => updateItem(item.id, { icon_name: event.target.value })}>
                                    {getShotListIconOptionsForItemType(item.item_type).map((option) => (
                                      <option key={`${item.id}-${option.value}`} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span>{detailMeta.itemLabel}</span>
                                  <div
                                    className={`shot-list-option-field ${activeOptionField === `equipment-item-${item.id}` ? "is-open" : ""}`}
                                    onBlur={(event) => handleOptionFieldBlur(`equipment-item-${item.id}`, event)}
                                  >
                                    <input
                                      value={item.item_name}
                                      onFocus={() => setActiveOptionField(`equipment-item-${item.id}`)}
                                      onChange={(event) => updateItem(item.id, { item_name: event.target.value })}
                                      placeholder={detailMeta.itemPlaceholder}
                                    />
                                    {itemSuggestions.length > 0 && (
                                      <div className="shot-list-field-options">
                                        <div className="shot-list-suggestion-pills">
                                          {itemSuggestions.map((suggestion) => (
                                            <button
                                              key={`${item.id}-${suggestion}`}
                                              type="button"
                                              className="shot-list-suggestion-pill"
                                              onMouseDown={(event) => event.preventDefault()}
                                              onClick={() => updateItem(item.id, { item_name: suggestion })}
                                            >
                                              {suggestion}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </label>
                                <label>
                                  <span>{detailMeta.detailLabel}</span>
                                  <input value={item.camera_label || ""} onChange={(event) => updateItem(item.id, { camera_label: event.target.value })} placeholder={detailMeta.detailPlaceholder} />
                                </label>
                                {showMediaFields && (
                                  <>
                                    <label>
                                      <span>Media</span>
                                      <select value={item.media_type || "SSD"} onChange={(event) => updateItem(item.id, { media_type: event.target.value })}>
                                        {SHOT_LIST_MEDIA_TYPES.map((mediaType) => (
                                          <option key={mediaType} value={mediaType}>{mediaType}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      <span>Capacity</span>
                                      <div className="shot-list-inline-pair">
                                        <input
                                          type="number"
                                          min={0}
                                          value={item.capacity_value ?? ""}
                                          onChange={(event) => updateItem(item.id, { capacity_value: event.target.value ? Number(event.target.value) : null })}
                                          placeholder="256"
                                        />
                                        <select value={item.capacity_unit || "GB"} onChange={(event) => updateItem(item.id, { capacity_unit: event.target.value as "GB" | "TB" })}>
                                          {SHOT_LIST_CAPACITY_UNITS.map((unit) => (
                                            <option key={unit} value={unit}>{unit}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </label>
                                  </>
                                )}
                                <label className="shot-list-row-wide">
                                  <span>Notes</span>
                                  <textarea value={item.notes} onChange={(event) => updateItem(item.id, { notes: event.target.value })} rows={2} placeholder={detailMeta.notePlaceholder} />
                                </label>
                              </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <button type="button" className="shot-list-add-item" onClick={() => void addItem(section)}>
                        <Plus size={14} />
                        <span>Add item</span>
                      </button>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
