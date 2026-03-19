import { Component, ReactNode, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  Compass,
  FolderOpen,
  Info,
  ShieldCheck,
  ArrowRight,
  Boxes,
  BriefcaseBusiness,
  MoreHorizontal,
  FileDown,
  ChevronDown,
  LayoutGrid,
  FolderTree,
  ArrowLeft,
  AlertTriangle,
  Film,
  Image,
  XCircle,
  FileSearch,
  ClipboardCheck,
} from "lucide-react";
import { ClipList } from "./components/ClipList";
import { PrintLayout } from "./components/PrintLayout";
import { SafeCopy } from "./components/SafeCopy";
import { ExportPanel } from "./components/ExportPanel";
import { BlocksView } from "./components/BlocksView";
import { JobsPanel } from "./components/JobsPanel";
import { AboutPanel } from "./components/AboutPanel";
import { FolderCreator } from "./components/FolderCreator";
import { ReviewCore } from "./components/ReviewCore";
import { MosaicBuilder } from "./components/MosaicBuilder";
import { DuplicateFinderApp } from "./components/DuplicateFinderApp";
import StarterSetup from "./components/PreProduction/StarterSetup";
import { TourGuide, TourStep } from "./components/TourGuide";
import { exportPdf, exportImage, exportMosaicImage, exportMosaicPdf } from "./utils/ExportUtils";
import appLogo from "./assets/Icon_square_rounded.svg";
import { AppInfo, Clip, ClipWithThumbnails, JobInfo, ScanResult, RecentProject, ProductionProject, Phase, PhaseData } from "./types";
import {
  LookbookSortMode,
  MOVEMENT_CANONICAL,
  SHOT_SIZE_CANONICAL,
  SHOT_SIZE_OPTIONAL,
  sortLookbookClips,
} from "./lookbook";
import { useAppListeners } from "./hooks/useAppListeners";
import { usePreviewPlayback } from "./hooks/usePreviewPlayback";
import { useSelection } from "./hooks/useSelection";
import { useClipActions } from "./hooks/useClipActions";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { ProductionLanding } from "./modules/Production/ProductionLanding";
import LookSetup from './modules/Production/apps/LookSetup';
import OnSetCoach from './modules/Production/apps/OnSetCoach.tsx';
import MatchNormalize from './modules/Production/apps/MatchNormalize.tsx';
import CameraMatchLab from './modules/Production/apps/CameraMatchLab.tsx';
import FramePreview from './modules/Production/apps/FramePreview';
import { useCommandPalette } from "./hooks/useCommandPalette";
import { CommandPalette } from "./components/CommandPalette";
import { getJumpIntervalForThumbCount, getThumbnailCacheContext } from "./utils/thumbnailIntervals";
import { invokeGuarded, isTauriReloading } from "./utils/tauri";

// --- Error Boundary ---
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <main className="main-content" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 40, textAlign: 'center', background: '#0f172a', color: 'white', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 16 }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', maxWidth: 400, marginBottom: 24 }}>{this.state.error?.message || "An unexpected error occurred in the application UI."}</p>
          <button style={{ padding: '10px 20px', background: 'var(--color-accent)', border: 'none', borderRadius: 8, color: '#000', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Reload App</button>
        </main>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const TOUR_VERSION = "1.0.0-beta.4";
  const TOUR_SEEN_KEY = "wp_has_seen_tour";
  const TOUR_VERSION_KEY = "wp_tour_version";
  const DEV_BOOT_RESET_KEY = "wrap_preview:dev_boot_reset_done";
  const IS_DEV = import.meta.env.DEV;

  const [activeTab, setActiveTab] = useState<"home" | "production" | "preproduction" | "shot-planner" | "media-workspace" | "contact" | "blocks" | "safe-copy" | "all">(() => {
    if (IS_DEV) return "home";
    const saved = localStorage.getItem('wp_activeTab');
    return (saved as any) || 'home';
  });
  const [activeProductionProject, setActiveProductionProject] = useState<ProductionProject | null>(null);
  const [activePreproductionApp, setActivePreproductionApp] = useState<string | null>(() => {
    if (IS_DEV) return null;
    return localStorage.getItem('wp_activePreApp') || null;
  });
  const [activeMediaWorkspaceApp, setActiveMediaWorkspaceApp] = useState<string | null>(() => {
    if (IS_DEV) return null;
    return localStorage.getItem('wp_activeMediaApp') || null;
  });
  const [activeProductionApp, setActiveProductionApp] = useState<string | null>(() => {
    if (IS_DEV) return null;
    return localStorage.getItem('wp_activeProdApp') || null;
  });
  const [shareRouteToken, setShareRouteToken] = useState<string | null>(() => {
    const match = window.location.hash.match(/^#\/r\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  const isShotPlannerActive = activeTab === "preproduction" && activePreproductionApp === "shot-planner";

  useEffect(() => {
    const handleHashChange = () => {
      const match = window.location.hash.match(/^#\/r\/([^/?#]+)/);
      setShareRouteToken(match ? decodeURIComponent(match[1]) : null);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Persist tab state
  useEffect(() => {
    if (!IS_DEV) {
      localStorage.setItem('wp_activeTab', activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!IS_DEV) {
      if (activePreproductionApp) localStorage.setItem('wp_activePreApp', activePreproductionApp);
      else localStorage.removeItem('wp_activePreApp');
    }
  }, [activePreproductionApp]);

  useEffect(() => {
    if (!IS_DEV) {
      if (activeMediaWorkspaceApp) localStorage.setItem('wp_activeMediaApp', activeMediaWorkspaceApp);
      else localStorage.removeItem('wp_activeMediaApp');
    }
  }, [activeMediaWorkspaceApp]);

  useEffect(() => {
    if (!IS_DEV) {
      if (activeProductionApp) localStorage.setItem('wp_activeProdApp', activeProductionApp);
      else localStorage.removeItem('wp_activeProdApp');
    }
  }, [activeProductionApp]);

  useEffect(() => {
    if (!IS_DEV || shareRouteToken) return;
    if (window.sessionStorage.getItem(DEV_BOOT_RESET_KEY)) {
      setActiveTab("home");
      setActivePreproductionApp(null);
      setActiveMediaWorkspaceApp(null);
      return;
    }

    const keysToClear = ["wp_activeTab", "wp_activePreApp", "wp_activeMediaApp", "review_core:last_project_id"];
    for (const key of keysToClear) {
      window.localStorage.removeItem(key);
    }
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key && key.includes("last_")) {
        window.localStorage.removeItem(key);
      }
    }

    window.sessionStorage.setItem(DEV_BOOT_RESET_KEY, "true");
    setActiveTab("home");
    setActivePreproductionApp(null);
    setActiveMediaWorkspaceApp(null);
  }, [DEV_BOOT_RESET_KEY, IS_DEV, shareRouteToken]);

  useEffect(() => {
    const markUnloading = () => {
      isUnloadingRef.current = true;
    };
    window.addEventListener("beforeunload", markUnloading);
    return () => {
      window.removeEventListener("beforeunload", markUnloading);
    };
  }, []);

  useEffect(() => {
    if (!IS_DEV) return;

    const originalWarn = console.warn;
    const originalError = console.error;
    const isHarmlessDevNoise = (message: string) =>
      message.includes("Couldn't find callback id") ||
      (message.includes("callback id") && message.includes("not found")) ||
      message.includes("react-virtuoso: Zero-sized element");
    console.warn = (...args: unknown[]) => {
      const firstArg = typeof args[0] === "string" ? args[0] : "";
      if (isHarmlessDevNoise(firstArg)) {
        return;
      }
      originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      const firstArg = typeof args[0] === "string" ? args[0] : "";
      if (isHarmlessDevNoise(firstArg)) {
        return;
      }
      originalError(...args);
    };

    return () => {
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [IS_DEV]);

  // --- Phase-Isolated State ---

  const initialPhaseState: PhaseData = {
    projectId: null,
    projectName: "",
    clips: [],
    selectedClipIds: new Set(),
    scanning: false,
    extracting: false,
    extractProgress: { done: 0, total: 0 },
    thumbnailCache: {},
  };

  const currentPhase: Phase = (activeTab === 'preproduction') ? 'pre' : 'post';

  const [projectStates, setProjectStates] = useState<Record<Phase, PhaseData>>({
    pre: { ...initialPhaseState },
    post: { ...initialPhaseState },
  });

  // Helper to update specific phase state
  const setPhaseState = useCallback((phase: Phase, updates: Partial<PhaseData> | ((prev: PhaseData) => PhaseData)) => {
    setProjectStates((prev: Record<Phase, PhaseData>) => ({
      ...prev,
      [phase]: typeof updates === 'function' ? updates(prev[phase]) : { ...prev[phase], ...updates },
    }));
  }, []);

  // convenience getters and setters for current phase
  const { projectId, projectName, clips, selectedClipIds, scanning, extracting, extractProgress, thumbnailCache } = projectStates[currentPhase];

  const setClips = (val: ClipWithThumbnails[] | ((prev: ClipWithThumbnails[]) => ClipWithThumbnails[])) => {
    setPhaseState(currentPhase, (prev: PhaseData) => ({
      ...prev,
      clips: typeof val === 'function' ? val(prev.clips) : val,
    }));
  };
  const setSelectedClipIds = (val: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setPhaseState(currentPhase, (prev: PhaseData) => ({
      ...prev,
      selectedClipIds: typeof val === 'function' ? val(prev.selectedClipIds) : val,
    }));
  };

  const [showPrint, setShowPrint] = useState(false);
  const [preparingExport, setPreparingExport] = useState<{ kind: "pdf" | "image" | "mosaic-pdf" | "mosaic-image"; message: string } | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [viewFilter] = useState<"all" | "picks" | "rated_min">("all");
  const [viewMinRating] = useState<number>(3);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const {
    isOpen: commandPaletteOpen,
    setIsOpen: setCommandPaletteOpen,
    query: commandQuery,
    setQuery: setCommandQuery,
  } = useCommandPalette();
  const [uiError, setUiError] = useState<{ title: string; hint: string } | null>(null);
  const [tourRun, setTourRun] = useState(false);
  const [brandProfile, setBrandProfile] = useState<any>(null);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [shotPlannerExportMenuOpen, setShotPlannerExportMenuOpen] = useState(false);
  const [reviewExportMenuOpen, setReviewExportMenuOpen] = useState(false);
  const [openExportAfterScan, setOpenExportAfterScan] = useState(false);
  const [uiNotice, setUiNotice] = useState<{ title: string; hint: string } | null>(null);
  const [manualOrderConflict, setManualOrderConflict] = useState<{ clipId: string; nonce: number } | null>(null);
  const [pendingExportValidation, setPendingExportValidation] = useState<null | {
    kind: "pdf" | "image" | "mosaic-pdf" | "mosaic-image";
    firstMissing: { clipId: string; field: "manual_order" | "shot_size" | "movement" };
  }>(null);
  const [lookbookSortMode, setLookbookSortMode] = useState<LookbookSortMode>(() => {
    const saved = localStorage.getItem("wp_lookbook_sort_mode");
    return (saved === "canonical" || saved === "custom" || saved === "hook_first") ? (saved as LookbookSortMode) : "canonical";
  });
  const [groupByShotSize] = useState<boolean>(() => {
    return localStorage.getItem("wp_group_shot_size") !== "false";
  });
  const [enableOptionalShotTags] = useState<boolean>(() => {
    return localStorage.getItem("wp_enable_optional_shot_tags") === "true";
  });
  const [sequenceMovementFilter] = useState<string>(() => {
    return localStorage.getItem("wp_sequence_movement_filter") || "all";
  });
  const [shotSizeFilter] = useState<string>(() => localStorage.getItem("wp_shot_size_filter") || "all");
  const projectPhaseMapRef = useRef(new Map<string, Phase>());


  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const shotPlannerStateRef = useRef<any>(null);
  const reviewStateRef = useRef<any>(null);
  const isUnloadingRef = useRef(false);


  // Settings with Persistence
  const [thumbCount, setThumbCount] = useState<number>(() => {
    const saved = localStorage.getItem("wp_thumbCount");
    return saved ? parseInt(saved, 10) : 5;
  });

  const [namingTemplate] = useState<string>(() => {
    return localStorage.getItem("wp_namingTemplate") || "ContactSheet_{PROJECT}_{DATE}";
  });

  const [customShotSizes, setCustomShotSizes] = useState<string[]>([]);
  const [customMovements, setCustomMovements] = useState<string[]>([]);
  const selectedJumpSeconds = useMemo(() => getJumpIntervalForThumbCount(thumbCount), [thumbCount]);
  const thumbCacheContext = useMemo(
    () => getThumbnailCacheContext(selectedJumpSeconds),
    [selectedJumpSeconds],
  );

  const safeInvoke = useCallback(async <T,>(command: string, args?: Record<string, unknown>) => {
    if (isUnloadingRef.current) {
      throw new Error("app unloading");
    }
    return invokeGuarded<T>(command, args);
  }, []);

  const loadCustomTaxonomy = useCallback(() => {
    if (!projectId) return;
    const savedShots = localStorage.getItem(`wp_custom_shots_${projectId}`);
    const savedMoves = localStorage.getItem(`wp_custom_moves_${projectId}`);
    setCustomShotSizes(savedShots ? savedShots.split(',').map(s => s.trim()).filter(Boolean) : []);
    setCustomMovements(savedMoves ? savedMoves.split(',').map(s => s.trim()).filter(Boolean) : []);
  }, [projectId]);

  useEffect(() => {
    loadCustomTaxonomy();
  }, [loadCustomTaxonomy]);

  useEffect(() => {
    localStorage.setItem("wp_thumbCount", thumbCount.toString());
    localStorage.setItem("wp_namingTemplate", namingTemplate);
  }, [thumbCount, namingTemplate]);

  useEffect(() => {
    localStorage.setItem("wp_lookbook_sort_mode", lookbookSortMode);
    localStorage.setItem("wp_group_shot_size", String(groupByShotSize));
    localStorage.setItem("wp_enable_optional_shot_tags", String(enableOptionalShotTags));
    localStorage.setItem("wp_sequence_movement_filter", sequenceMovementFilter);
    localStorage.setItem("wp_shot_size_filter", shotSizeFilter);
  }, [lookbookSortMode, groupByShotSize, enableOptionalShotTags, sequenceMovementFilter, shotSizeFilter]);

  useEffect(() => {
    if (lookbookSortMode === "hook_first") {
      setLookbookSortMode("canonical");
    }
  }, [lookbookSortMode]);

  useEffect(() => {
    if (!shotPlannerExportMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShotPlannerExportMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [shotPlannerExportMenuOpen]);

  useEffect(() => {
    if (!uiNotice) return;
    const timer = window.setTimeout(() => setUiNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [uiNotice]);

  // State persistence removed per user request for "blank canvas" starting experience

  useEffect(() => {
    if (projectId) {
      const loadBrand = async () => {
        try {
          const p = await safeInvoke<any>("get_project", { projectId: projectId });
          if (p && p.root_path) {
            const profile = await safeInvoke<any>("load_brand_profile", { projectPath: p.root_path });
            if (isTauriReloading()) return;
            setBrandProfile(profile);
          }
        } catch (e) {
          console.error("Failed to load brand:", e);
        }
      };
      loadBrand();
    } else {
      setBrandProfile(null);
    }
  }, [projectId, safeInvoke]);

  useEffect(() => {
    const seen = localStorage.getItem(TOUR_SEEN_KEY) === "true";
    const version = localStorage.getItem(TOUR_VERSION_KEY);
    if (!seen || version !== TOUR_VERSION) {
      setTourRun(true);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await safeInvoke<JobInfo[]>("list_jobs");
      if (isTauriReloading()) return;
      setJobs(data);
    } catch (err) {
      console.error("Failed loading jobs", err);
    }
  }, [safeInvoke]);

  const hasActiveJobs = scanning || extracting || jobs.some((job) => job.status === "running" || job.status === "queued");

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      await refreshJobs();
      if (cancelled) return;
      schedule(jobsOpen || hasActiveJobs ? 1000 : 15000);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [refreshJobs, jobsOpen, hasActiveJobs]);


  useEffect(() => {
    safeInvoke<AppInfo>("get_app_info")
      .then((info) => {
        if (isTauriReloading()) return;
        setAppInfo(info);
      })
      .catch(console.error);

    // Project restoration on mount disabled for "blank canvas" start
  }, [safeInvoke]);

  // State for delayed actions
  const [postScanTab, setPostScanTab] = useState<"preproduction" | "shot-planner" | "mosaic-builder" | "media-workspace" | "clip-review" | "scene-blocks" | "contact" | "blocks" | "all" | null>(null);

  const [projectLut, setProjectLut] = useState<{ path: string; name: string; hash: string } | null>(null);
  const [lutRenderNonce, setLutRenderNonce] = useState(0);


  // Active project refs removed in favor of phase-aware listeners

  const fetchProjectSettings = useCallback(async (pid: string) => {
    try {
      const settingsJson = await safeInvoke<string>("get_project_settings", { projectId: pid });
      if (isTauriReloading()) return;
      if (settingsJson && settingsJson !== "{}") {
        const settings = JSON.parse(settingsJson);
        if (settings.lut_path) {
          setProjectLut({
            path: settings.lut_path,
            name: settings.lut_name,
            hash: settings.lut_hash
          });
        } else {
          setProjectLut(null);
        }
      } else {
        setProjectLut(null);
      }
    } catch (e) {
      console.error("Failed to fetch project settings", e);
      setProjectLut(null);
    }
  }, [safeInvoke]);

  const handleLoadProjectLut = useCallback(async () => {
    if (!projectId) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "LUT Files", extensions: ["cube"] }],
      title: "Select LUT (.cube)",
    });
    if (!selected || typeof selected !== "string") return;
    try {
      await invoke("set_project_lut", { projectId, lutPath: selected });
      await fetchProjectSettings(projectId);
      await invoke("generate_lut_thumbnails", { projectId });
      setLutRenderNonce((n) => n + 1);
      setUiNotice({ title: "LUT loaded", hint: "Review thumbnails can now use the selected project LUT." });
    } catch (error) {
      console.error("Failed to load project LUT", error);
      setUiError({ title: "Could not load LUT", hint: String(error) });
    }
  }, [fetchProjectSettings, projectId]);

  const handleRemoveProjectLut = useCallback(async () => {
    if (!projectId) return;
    try {
      await invoke("remove_project_lut", { projectId });
      await fetchProjectSettings(projectId);
      setLutRenderNonce((n) => n + 1);
    } catch (error) {
      console.error("Failed to clear project LUT", error);
      setUiError({ title: "Could not clear LUT", hint: String(error) });
    }
  }, [fetchProjectSettings, projectId]);

  const [focusedClipId, setFocusedClipId] = useState<string | null>(null);
  const [focusedClipScrollToken, setFocusedClipScrollToken] = useState(0);
  const hoveredClipIdRef = useRef<string | null>(null);


  const focusClipField = useCallback((clipId: string, field: "manual_order" | "shot_size" | "movement") => {
    hoveredClipIdRef.current = clipId;
    requestAnimationFrame(() => {
      const selector = `[data-clip-id="${clipId}"][data-clip-field="${field}"]`;
      const input = document.querySelector<HTMLInputElement>(selector);
      if (!input) return;
      input.focus();
      if (input.select) input.select();
    });
  }, []);


  const getThumbCacheKey = useCallback((clipId: string, index: number, context = thumbCacheContext) => {
    return `${clipId}_${index}|${context}`;
  }, [thumbCacheContext]);

  const hydrateThumbnailEntry = useCallback(async (path: string) => {
    if (!path || isUnloadingRef.current) return null;
    if (path.startsWith("data:")) return path;
    try {
      return await safeInvoke<string>("read_thumbnail", { path });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isMissingFile = message.includes("No such file or directory") || message.includes("os error 2");
      if (!isUnloadingRef.current && !isMissingFile) {
        console.warn(`Failed to hydrate thumbnail ${path}`, error);
      }
      return null;
    }
  }, [safeInvoke]);

  const hydrateThumbnailCacheEntries = useCallback(async (
    entries: Array<{ clipId: string; jumpSeconds: number; index: number; path: string }>
  ) => {
    const hydrated = await Promise.all(entries.map(async ({ clipId, jumpSeconds, index, path }) => {
      const src = await hydrateThumbnailEntry(path);
      if (!src) return null;
      return { clipId, jumpSeconds, index, src };
    }));

    return hydrated.filter((entry): entry is { clipId: string; jumpSeconds: number; index: number; src: string } => Boolean(entry));
  }, [hydrateThumbnailEntry]);


  const focusShotPlannerClip = useCallback((clipId: string, options?: { scrollIntoView?: boolean }) => {
    setFocusedClipId(prev => {
      if (prev === clipId) return prev;
      return clipId;
    });
    if (options?.scrollIntoView) {
      setFocusedClipScrollToken((prev) => prev + 1);
    }
    // manualOrderBufferRef.current logic removed as it's handled in useAppKeyboard
  }, []);

  const onHoverClip = useCallback((id: string | null) => {
    hoveredClipIdRef.current = id;
  }, []);




  useEffect(() => {
    if (projectId && postScanTab) {
      if (postScanTab === "preproduction" || postScanTab === "shot-planner" || postScanTab === "mosaic-builder") {
        setActiveTab("preproduction");
        setActivePreproductionApp(postScanTab === "preproduction" ? "shot-planner" : postScanTab);
      } else if (postScanTab === "media-workspace" || postScanTab === "clip-review") {
        setActiveTab("media-workspace");
        setActiveMediaWorkspaceApp("clip-review");
      } else if (postScanTab === "scene-blocks") {
        setActiveTab("media-workspace");
        setActiveMediaWorkspaceApp("scene-blocks");
      } else {
        setActiveTab(postScanTab as any);
      }
      setPostScanTab(null);
    }
  }, [projectId, postScanTab]);

  useEffect(() => {
    if (projectId && openExportAfterScan) {
      setShowExportPanel(true);
      setOpenExportAfterScan(false);
    }
  }, [projectId, openExportAfterScan]);

  useEffect(() => {
    setSelectedClipIds((prev) => {
      let changed = false;
      const allowed = new Set(
        clips
          .filter((row) => row.clip.flag !== "reject")
          .map((row) => row.clip.id)
      );
      const next = new Set<string>();
      prev.forEach((id) => {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [clips]);

  // hydrateThumbnailCache logic merged into refreshProjectClips for phase-safety

  const refreshProjectClips = useCallback(async (nextProjectId: string, targetPhase?: Phase) => {
    try {
      const clipRows = await safeInvoke<ClipWithThumbnails[]>("get_clips", { projectId: nextProjectId });
      if (isTauriReloading()) return;

      // Determine phase: use provided, or look up in map, or default to current
      const activePhase = targetPhase || projectPhaseMapRef.current.get(nextProjectId) || currentPhase;

      setPhaseState(activePhase, (prev) => {
        return {
          ...prev,
          clips: clipRows,
        };
      });

      // Hydrate thumbnails
      const thumbEntries = clipRows.flatMap((item) =>
        item.thumbnails.map((thumb) => ({
          clipId: thumb.clip_id,
          jumpSeconds: thumb.jump_seconds,
          index: thumb.index,
          path: thumb.file_path
        }))
      );

      if (thumbEntries.length > 0) {
        const hydratedEntries = await hydrateThumbnailCacheEntries(thumbEntries);

        setPhaseState(activePhase, (prev) => {
          const nextCache = { ...(prev.thumbnailCache || {}) };
          for (const { clipId, jumpSeconds, index, src } of hydratedEntries) {
            nextCache[`${clipId}_${index}`] = nextCache[`${clipId}_${index}`] ?? src;
            nextCache[getThumbCacheKey(clipId, index, getThumbnailCacheContext(jumpSeconds))] = src;
          }
          return {
            ...prev,
            thumbnailCache: nextCache,
          };
        });
      }

      await fetchProjectSettings(nextProjectId);

    } catch (error) {

      console.error("Failed to refresh clips:", error);
      setUiError({ title: "Could not load clip previews", hint: "Retry scan. If this persists, export diagnostics." });
    }
  }, [fetchProjectSettings, getThumbCacheKey, hydrateThumbnailCacheEntries, safeInvoke, setPhaseState]);



  const {
    playingClipId,
    playingProgress,
    handlePlayClip,
  } = usePreviewPlayback(clips);

  const {
    toggleClipSelection,
    toggleSelectAll
  } = useSelection(clips, selectedClipIds, setSelectedClipIds);

  const clipActions = useClipActions({
    clips,
    isShotPlannerActive,
    projectId,
    projectLut,
    setClips,
    setSelectedClipIds,
    setManualOrderConflict,
    setUiError,
    setLutRenderNonce,
    refreshProjectClips,
  });

  const {
    handleUpdateMetadata,
    handleResetShotPlannerClip,
    handlePromoteClip,
  } = clipActions;

  const { clearManualOrderBuffer } = useAppKeyboard({
    shotPlannerStateRef,
    reviewStateRef,
    setManualOrderConflict,
  });

  // Register Global Listeners
  useAppListeners({
    setPhaseState,
    refreshProjectClips,
    projectPhaseMapRef,
    isShotPlannerActive,
    refreshJobs,
  });

  // handleCloseProject was replaced by inline initialPhaseState reset in handleSelectFolder

  const addRecentProject = useCallback((id: string, name: string, path: string, phase: Phase) => {
    const saved = localStorage.getItem("wp_recent_projects");
    let prev: RecentProject[] = [];
    if (saved) {
      try {
        prev = JSON.parse(saved);
      } catch (e) {
        // ignore
      }
    }
    // Filter by both path and phase for true isolation in history
    const filtered = prev.filter((p) => !(p.path === path && p.phase === phase));
    const next = [{ id, name, path, phase, lastOpened: Date.now() }, ...filtered].slice(0, 10);
    localStorage.setItem("wp_recent_projects", JSON.stringify(next));
  }, []);

  const handleLoadFootage = useCallback(async (
    targetTab?: "preproduction" | "shot-planner" | "mosaic-builder" | "media-workspace" | "clip-review" | "scene-blocks" | "contact" | "blocks" | "all",
    mode: 'folder' | 'files' = 'folder'
  ) => {
    const selected = await open({
      directory: mode === 'folder',
      multiple: mode === 'files',
      title: mode === 'folder' ? "Select Footage Folder" : "Select Media Files",
      filters: mode === 'files' ? [
        {
          name: "Media Files",
          extensions: ["mp4", "mov", "mxf", "avi", "mkv", "r3d", "braw", "jpg", "jpeg", "png", "webp", "tiff", "heic"]
        }
      ] : undefined
    });

    if (!selected) return;

    const targetPhase: Phase = (targetTab === "preproduction" || targetTab === "shot-planner" || targetTab === "mosaic-builder") ? "pre" : "post";

    setPhaseState(targetPhase, { scanning: true, projectId: null, clips: [] });
    if (targetTab) setPostScanTab(targetTab);

    try {
      // If mode is files, selected is string | string[]. We want to pass a string or handle the array.
      // For now, let's pass a special prefix or iterate. 
      // Actually, let's update scan_folder to handle multiple paths.
      // But for now, if it's one path, just pass it.
      
      const paths = Array.isArray(selected) ? selected : [selected];
      
      // We'll call a new scan_media command instead of scan_folder
      const result = await safeInvoke<ScanResult>("scan_media", {
        paths,
        phase: targetPhase,
      });

      // Update the mapping Ref so listeners can find this project
      projectPhaseMapRef.current.set(result.project_id, targetPhase);

      setPhaseState(targetPhase, {
        projectId: result.project_id,
        projectName: result.project_name,
        clips: result.clips.map((clip) => ({ clip, thumbnails: [] })),
        extracting: true,
        extractProgress: { done: 0, total: result.clip_count }
      });

      // Use the first path as the path for recent projects
      addRecentProject(result.project_id, result.project_name, paths[0], targetPhase);

      safeInvoke("extract_thumbnails", { projectId: result.project_id }).catch(
        (e) => {
          console.error("Thumbnail extraction error:", e);
          setUiError({ title: "Thumbnail extraction failed", hint: "Retry scan or check media read permissions." });
          setPhaseState(targetPhase, { extracting: false });
        }
      );

      refreshProjectClips(result.project_id, targetPhase).catch((err) => {
        console.warn("Initial clip refresh failed", err);
      });
    } catch (e) {
      console.error("Scan error:", e);
      setUiError({ title: "Scan failed", hint: "Verify folder access and media formats, then retry." });
    } finally {
      setPhaseState(targetPhase, { scanning: false });
    }
  }, [addRecentProject, refreshProjectClips, safeInvoke, setPhaseState]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
  }, [projectId]);



  const tourSteps: TourStep[] = [
    {
      target: ".onboarding-grid-root",
      title: "Modules",
      description: "Start from the modules screen to choose between pre-production and post-production work.",
      placement: "bottom",
      learnMore: [
        "The left module covers planning before the shoot.",
        "The right module covers review, verification, organization, and delivery after ingest."
      ]
    },
    {
      target: ".btn-jobs",
      title: "Jobs & Activity",
      description: "Track processing, export progress, and surfaced issues in one drawer.",
      placement: "bottom",
      learnMore: [
        "Active jobs show live progress and cancel actions.",
        "Completed jobs stay visible as history.",
        "In dev builds, the drawer includes a Maintenance area for Reset Dev Data."
      ]
    },
    {
      target: ".tour-home-preproduction",
      title: "Pre-Production",
      description: "Use this module for Shot Planner and Folder Creator during prep.",
      placement: "bottom",
      learnMore: [
        "Shot Planner helps review reference media and build selects before the shoot.",
        "Folder Creator generates production folder structures."
      ]
    },
    {
      target: ".tour-home-postproduction",
      title: "Post-Production",
      description: "Use this module for Safe Copy, Review, Scene Blocks, Delivery, and Review Core.",
      placement: "bottom",
      learnMore: [
        "Open Workspace / Review, Scene Blocks, and Delivery open after a workspace is loaded.",
        "Safe Copy verifies transfers before editorial.",
        "Review Core can run as an independent review surface."
      ]
    }
  ];

  const handleReorderClips = useCallback(async (activeId: string, overId: string) => {
    const activeClip = clips.find(c => c.clip.id === activeId);
    const overClip = clips.find(c => c.clip.id === overId);
    if (!activeClip || !overClip) return;

    const activeOrder = activeClip.clip.manual_order ?? 0;
    const overOrder = overClip.clip.manual_order ?? 0;

    // Swap manual_order values
    await handleUpdateMetadata(activeId, { manual_order: overOrder || 1 });
    await handleUpdateMetadata(overId, { manual_order: activeOrder || 1 });
  }, [clips, handleUpdateMetadata]);

  const completeTour = useCallback(() => {
    localStorage.setItem(TOUR_SEEN_KEY, "true");
    localStorage.setItem(TOUR_VERSION_KEY, TOUR_VERSION);
    setTourRun(false);
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(TOUR_SEEN_KEY);
    localStorage.removeItem(TOUR_VERSION_KEY);
    setTourRun(false);
  }, []);

  const startTour = useCallback(() => {
    setHelpMenuOpen(false);
    setJobsOpen(false);
    setActiveTab("home");
    setActivePreproductionApp(null);
    setActiveMediaWorkspaceApp(null);
    setTourRun(true);
  }, []);
  const effectiveLookbookSortMode: LookbookSortMode = lookbookSortMode === "hook_first" ? "canonical" : lookbookSortMode;
  const thumbnailsByClipId = clips.reduce<Record<string, ClipWithThumbnails["thumbnails"]>>((acc, row) => {
    acc[row.clip.id] = row.thumbnails;
    return acc;
  }, {});

  const getExportClips = useCallback((): Clip[] => {
    if (!isShotPlannerActive) {
      return clips
        .filter((c) => selectedClipIds.has(c.clip.id))
        .map((c) => c.clip);
    }
    const selected = clips
      .filter((c) => selectedClipIds.has(c.clip.id) && c.clip.flag !== "reject")
      .map((c) => c.clip);
    return sortLookbookClips(selected, effectiveLookbookSortMode);
  }, [clips, effectiveLookbookSortMode, isShotPlannerActive, selectedClipIds]);

  const getFirstMissingTag = useCallback((items: Clip[]) => {
    for (const clip of items) {
      if (effectiveLookbookSortMode === "custom" && !(clip.manual_order ?? 0)) {
        return { clipId: clip.id, field: "manual_order" as const };
      }
      if (!(clip.shot_size ?? "").trim()) {
        return { clipId: clip.id, field: "shot_size" as const };
      }
      if (!(clip.movement ?? "").trim()) {
        return { clipId: clip.id, field: "movement" as const };
      }
    }
    return null;
  }, [effectiveLookbookSortMode]);

  const runExport = useCallback(async (kind: "pdf" | "image" | "mosaic-pdf" | "mosaic-image", options?: { shuffle?: boolean, useOriginalRatio?: boolean }) => {
    const exportClips = getExportClips();
    if (exportClips.length === 0) {
      alert("Please select at least one clip to export.");
      return;
    }

    if (kind === "image" || kind === "mosaic-image") {
      setPreparingExport({ kind, message: kind === "image" ? "Generating contact sheet image..." : "Generating mosaic image..." });
      try {
        const exporter = kind === "image" ? exportImage : exportMosaicImage;
        const payload: any = {
          projectName: projectName || "ContactSheet",
          clips: exportClips,
          thumbnailsByClipId,
          thumbnailCache,
          thumbCount,
          jumpSeconds: selectedJumpSeconds,
          cacheKeyContext: thumbCacheContext,
          projectLutHash: projectLut?.hash || null,
          brandName: brandProfile?.name,
          appVersion: appInfo?.version || "unknown",
          onWarning: (message: string) => setUiError({ title: "Export branding fallback", hint: message }),
        };
        if (options?.shuffle !== undefined) payload.shuffle = options.shuffle;
        if (options?.useOriginalRatio !== undefined) payload.useOriginalRatio = options.useOriginalRatio;
        await exporter(payload);
        setUiError(null);
      } catch (err) {
        console.error(err);
        setUiError({
          title: "Image export failed",
          hint: "Retry after thumbnails load. If it persists, check folder permissions.",
        });
      } finally {
        setPreparingExport(null);
      }
      return;
    }

    setPreparingExport({ kind, message: kind === "pdf" ? "Generating PDF contact sheet..." : "Generating mosaic PDF..." });
    try {
      const exporter = kind === "pdf" ? exportPdf : exportMosaicPdf;
      const payload: any = {
        projectName: projectName || "ContactSheet",
        clips: exportClips,
        thumbnailsByClipId,
        thumbnailCache,
        thumbCount,
        jumpSeconds: selectedJumpSeconds,
        cacheKeyContext: thumbCacheContext,
        projectLutHash: projectLut?.hash || null,
        brandName: brandProfile?.name,
        appVersion: appInfo?.version || "unknown",
        onWarning: (message: string) => setUiError({ title: "Export branding fallback", hint: message }),
      };
      if (options?.shuffle !== undefined) payload.shuffle = options.shuffle;
      if (options?.useOriginalRatio !== undefined) payload.useOriginalRatio = options.useOriginalRatio;
      await exporter(payload);
      setUiError(null);
    } catch (err) {
      console.error(err);
      setUiError({
        title: kind === "pdf" ? "PDF export failed" : "Mosaic PDF export failed",
        hint: "Retry after thumbnails load.",
      });
    } finally {
      setPreparingExport(null);
    }
  }, [appInfo, brandProfile, getExportClips, isShotPlannerActive, projectLut, projectName, selectedJumpSeconds, thumbCacheContext, thumbCount, thumbnailCache, thumbnailsByClipId]);

  const requestExport = useCallback((kind: "pdf" | "image" | "mosaic-pdf" | "mosaic-image") => {
    setShotPlannerExportMenuOpen(false);
    const exportClips = getExportClips();
    if (exportClips.length === 0) {
      alert("Please select at least one clip to export.");
      return;
    }
    if (!isShotPlannerActive) {
      void runExport(kind);
      return;
    }
    const firstMissing = getFirstMissingTag(exportClips);
    if (firstMissing) {
      setPendingExportValidation({ kind, firstMissing });
      return;
    }
    void runExport(kind);
  }, [getExportClips, getFirstMissingTag, isShotPlannerActive, runExport]);


  const handleExportImage = useCallback(() => {
    requestExport("image");
  }, [requestExport]);

  const handleExportMosaicImage = useCallback(() => {
    requestExport("mosaic-image");
  }, [requestExport]);

  const handleExport = useCallback(() => {
    requestExport("pdf");
  }, [requestExport]);

  const handleExportMosaicPdf = useCallback(() => {
    requestExport("mosaic-pdf");
  }, [requestExport]);

  const totalClips = clips.length;
  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const inWorkspaceLauncher = activeTab === "media-workspace" && !activeMediaWorkspaceApp;
  const jobHudState = failedJobs > 0 ? "error" : (scanning || extracting || runningJobs > 0) ? "running" : jobs.some((j) => j.status === "done") ? "success" : "idle";
  const rejectedCount = clips.filter((c) => c.clip.flag === "reject").length;
  const exportReadyCount = clips.filter(({ clip }) => {
    if (!selectedClipIds.has(clip.id) || clip.flag === "reject") return false;
    if (!(clip.shot_size ?? "").trim()) return false;
    if (!(clip.movement ?? "").trim()) return false;
    if (effectiveLookbookSortMode === "custom" && !(clip.manual_order ?? 0)) return false;
    return true;
  }).length;

  const visibleClips = useMemo(() => {
    return clips.filter(({ clip }) => {
      const shotSizeMatch = shotSizeFilter === "all" ? true : clip.shot_size === shotSizeFilter;
      return shotSizeMatch;
    });
  }, [clips, shotSizeFilter]);

  const sortedClips = useMemo(() => {
    return sortLookbookClips(visibleClips, effectiveLookbookSortMode);
  }, [visibleClips, effectiveLookbookSortMode]);
  const selectableClipIds = sortedClips
    .filter((c) => c.clip.flag !== "reject")
    .map((c) => c.clip.id);
  const selectedSelectableCount = selectableClipIds.filter((id) => selectedClipIds.has(id)).length;

  const handleToggleSelectAll = () => toggleSelectAll(selectableClipIds);

  useEffect(() => {
    shotPlannerStateRef.current = {
      active: isShotPlannerActive,
      tourRun,
      hoveredClipId: hoveredClipIdRef.current,
      sortedClips,
      clips,
      effectiveLookbookSortMode,
      requestExport,
      setLookbookSortMode,
      focusShotPlannerClip,
      setShotPlannerExportMenuOpen,
      setThumbCount,
      toggleClipSelection,
      handleUpdateMetadata,
      handleResetShotPlannerClip,
      clearManualOrderBuffer,
    };
  }, [
    clips,
    effectiveLookbookSortMode,
    handleUpdateMetadata,
    handleResetShotPlannerClip,
    clearManualOrderBuffer,
    focusShotPlannerClip,
    isShotPlannerActive,
    requestExport,
    sortedClips,
    toggleClipSelection,
    tourRun,
  ]);

  useEffect(() => {
    reviewStateRef.current = {
      active: activeTab === "media-workspace" && activeMediaWorkspaceApp === "clip-review" && Boolean(projectId),
      hoveredClipId: hoveredClipIdRef.current,
      sortedClips,
      clips,
      requestExport,
      toggleClipSelection,
      handleUpdateMetadata,
      focusClip: focusShotPlannerClip,
      projectLutHash: projectLut?.hash || null,
    };
  }, [
    activeMediaWorkspaceApp,
    activeTab,
    clips,
    focusShotPlannerClip,
    handleUpdateMetadata,
    projectId,
    projectLut,
    requestExport,
    sortedClips,
    toggleClipSelection,
  ]);

  const commandActions = useMemo(() => {
    const recentJson = localStorage.getItem("wp_recent_projects");
    let recent: RecentProject[] = [];
    if (recentJson) {
      try { recent = JSON.parse(recentJson); } catch (e) { /* ignore */ }
    }

    const commandRegistry: Record<string, () => void | Promise<void>> = {
      "nav-home": () => {
        setActiveTab("home");
        setActivePreproductionApp(null);
        setActiveMediaWorkspaceApp(null);
      },
      "nav-shot-planner": () => {
        setActiveTab("preproduction");
        setActivePreproductionApp("shot-planner");
      },
      "nav-review": () => {
        setActiveTab("media-workspace");
        setActiveMediaWorkspaceApp("clip-review");
      },
      "nav-safe-copy": () => {
        setActiveTab("media-workspace");
        setActiveMediaWorkspaceApp("safe-copy");
      },
    };

    const commandRefs = [
      { id: "nav-home", title: "Go to Modules", description: "Home screen", icon: "box", category: "Navigation" as const },
      { id: "nav-shot-planner", title: "Shot Planner", description: "Pre-production planning", icon: "play", category: "Navigation" as const },
      { id: "nav-review", title: "Post-production Review", description: "Review and organize footage", icon: "play", category: "Navigation" as const },
      { id: "nav-safe-copy", title: "Safe Copy", description: "Secure ingest and verification", icon: "nav", category: "Navigation" as const },
    ];

    const navigationActions = commandRefs.map((entry) => {
      const handler = commandRegistry[entry.id];
      if (!handler) {
        console.warn(`[Wrap Preview] Missing command registry entry for "${entry.id}"`);
      }
      return {
        ...entry,
        disabled: !handler,
        onSelect: () => {
          if (!handler) return;
          void handler();
        },
      };
    });

    const projectActions = recent.map((p) => ({
      id: `project-${p.id}-${p.phase}`,
      title: p.name,
      description: p.path,
      category: "Recent" as const,
      icon: "project",
      onSelect: async () => {
        const phase: Phase = p.phase as Phase;
        setPhaseState(phase, { scanning: true, projectId: null, clips: [] });
        setActiveTab(phase === "pre" ? "preproduction" : "media-workspace");
        if (phase === "pre") setActivePreproductionApp("shot-planner");
        else setActiveMediaWorkspaceApp("clip-review");

        try {
          const result = await safeInvoke<ScanResult>("scan_folder", {
            folderPath: p.path,
            phase: phase,
          });
          projectPhaseMapRef.current.set(result.project_id, phase);
          setPhaseState(phase, {
            projectId: result.project_id,
            projectName: result.project_name,
            clips: result.clips.map((clip) => ({ clip, thumbnails: [] })),
            extracting: true,
            extractProgress: { done: 0, total: result.clip_count }
          });
          void safeInvoke("extract_thumbnails", { projectId: result.project_id }).catch(console.error);
          await refreshProjectClips(result.project_id, phase);
        } catch (e) {
          console.error("Failed to load project from palette", e);
        } finally {
          setPhaseState(phase, { scanning: false });
        }
      }
    }));

    return [...navigationActions, ...projectActions];
  }, [refreshProjectClips, safeInvoke, setActiveMediaWorkspaceApp, setActivePreproductionApp, setActiveTab, setPhaseState]);

  return (
    <div className="app-container">
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        actions={commandActions}
      />
      {shareRouteToken ? (
        <div className="app-content">
          {uiError && (
            <div className="error-banner">
              <strong>{uiError.title}</strong> {uiError.hint}
            </div>
          )}
          <ReviewCore
            shareToken={shareRouteToken}
            restricted={true}
            onError={setUiError}
            onExitShare={() => {
              window.location.hash = "";
              setShareRouteToken(null);
            }}
          />
        </div>
      ) : (
        <>
          {showPrint && (
            <div id="print-area">
              <PrintLayout
                projectName={projectName}
                clips={sortedClips.filter(c => selectedClipIds.has(c.clip.id) && c.clip.flag !== "reject")}
                thumbnailCache={thumbnailCache}
                brandProfile={brandProfile}
                logoSrc={appLogo}
                appVersion={appInfo?.version || "unknown"}
                thumbCount={thumbCount}
                jumpSeconds={selectedJumpSeconds}
                cacheKeyContext={thumbCacheContext}
                onClose={() => {
                  setShowPrint(false);
                }}
                projectLutHash={projectLut?.hash || null}

              />
            </div>
          )}
          {preparingExport && (
            <div className="export-preparing-overlay" role="status" aria-live="polite">
              <div className="export-preparing-card">
                <div className="spinner" />
                <strong>{
                  preparingExport.kind === "pdf" ? "Preparing PDF" :
                    preparingExport.kind === "image" ? "Preparing Image" :
                      preparingExport.kind === "mosaic-pdf" ? "Preparing Mosaic PDF" :
                        "Preparing Mosaic Image"
                }</strong>
                <span>{preparingExport.message}</span>
              </div>
            </div>
          )}

          <header className="app-header">
            <div className="app-header-left">
              <div className="app-logo" onClick={() => { setActiveTab('home'); setActivePreproductionApp(null); setActiveMediaWorkspaceApp(null); }}>
                <img src={appLogo} alt="Logo" className="app-logo-img" />
                <span className="app-title">Wrap Preview</span>
              </div>
              {projectName && (
                <div className="header-project-info">
                  <span className="separator">/</span>
                  <span className="project-name-highlight">{projectName}</span>
                </div>
              )}
            </div>

            {activeTab !== "home" && (
              <nav className="app-tabs-nav header-tabs">
                <button
                  className="nav-tab"
                  onClick={() => {
                    setActiveTab('home');
                    setActivePreproductionApp(null);
                    setActiveMediaWorkspaceApp(null);
                    setActiveProductionApp(null);
                  }}
                >
                  <LayoutGrid size={14} /> Modules
                </button>

                <button
                  className={`nav-tab nav-tab-phase-preproduction ${activeTab === 'preproduction' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('preproduction');
                    setActivePreproductionApp(null);
                    setActiveMediaWorkspaceApp(null);
                    setActiveProductionApp(null);
                  }}
                >
                  <Boxes size={14} /> Pre-production
                </button>

                <button
                  className={`nav-tab nav-tab-phase-production ${activeTab === 'production' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('production');
                    setActivePreproductionApp(null);
                    setActiveMediaWorkspaceApp(null);
                    setActiveProductionApp(null);
                  }}
                >
                  <Camera size={14} /> Production
                </button>

                <button
                  className={`nav-tab nav-tab-phase-postproduction ${activeTab === 'media-workspace' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('media-workspace');
                    setActivePreproductionApp(null);
                    setActiveMediaWorkspaceApp(null);
                    setActiveProductionApp(null);
                  }}
                >
                  <BriefcaseBusiness size={14} /> Post-production
                </button>
              </nav>
            )}
            <div className="app-header-right">
              <nav className="header-nav">
              </nav>
              <>

                <div className="help-menu-wrapper" style={{ position: 'relative' }}>
                  <button className="btn btn-icon" onClick={() => setHelpMenuOpen(!helpMenuOpen)} title="Help & Info">
                    <MoreHorizontal size={18} />
                  </button>
                  {helpMenuOpen && (
                    <>
                      <div className="dropdown-backdrop" onClick={() => setHelpMenuOpen(false)} />
                      <div className="help-dropdown menu-dropdown">
                        <button className="dropdown-item menu-item" onClick={() => { setAboutOpen(true); setHelpMenuOpen(false); }}>
                          <span className="menu-item-icon"><Info size={16} /></span>
                          <span className="menu-item-label">About Wrap Preview</span>
                        </button>
                        <div className="dropdown-divider menu-divider" />
                        <button className="dropdown-item menu-item" onClick={() => {
                          if (tourRun) completeTour();
                          else startTour();
                        }}>
                          <span className="menu-item-icon"><Compass size={16} /></span>
                          <span className="menu-item-label">{tourRun ? "Hide Tour" : "Show Tour"}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>


                <button className={`btn btn-jobs jobs-state-${jobHudState}`} onClick={() => setJobsOpen(true)}>
                  <div className="jobs-indicator-content">
                    <BriefcaseBusiness size={16} />
                    <span className="jobs-label">
                      {(scanning || extracting) ? (scanning ? "Scanning…" : `Extracting ${extractProgress.done}/${extractProgress.total}`) : (
                        runningJobs > 0 ? `Running ${runningJobs}` : failedJobs > 0 ? `Errors ${failedJobs}` : "Jobs"
                      )}
                    </span>
                    {failedJobs > 0 && <AlertTriangle size={14} className="status-icon-failed" style={{ marginLeft: 4 }} />}
                  </div>
                  {(scanning || extracting || runningJobs > 0) && (
                    <div className="jobs-progress-bar">
                      <div className="jobs-progress-bar-fill" />
                    </div>
                  )}
                </button>
              </>
            </div>
          </header>

          <div className="app-content">
            {uiError && (
              <div className="error-banner">
                <strong>{uiError.title}</strong> {uiError.hint}
              </div>
            )}
            {uiNotice && (
              <div className="error-banner info-banner">
                <strong>{uiNotice.title}</strong>{uiNotice.hint ? ` ${uiNotice.hint}` : ""}
              </div>
            )}
            {activeTab === 'preproduction' ? (
              activePreproductionApp === 'mosaic-builder' ? (
                <MosaicBuilder
                  clips={clips}
                  thumbnailCache={thumbnailCache}
                  selectedIds={selectedClipIds}
                  onToggleSelection={toggleClipSelection}
                  onToggleSelectAll={() => toggleSelectAll(clips.filter(c => c.clip.flag !== "reject").map(c => c.clip.id))}
                  thumbCount={thumbCount}
                  onSetThumbCount={setThumbCount}
                  jumpSeconds={selectedJumpSeconds}
                  cacheKeyContext={thumbCacheContext}
                  onExportPdf={(options) => runExport("mosaic-pdf", options)}
                  onExportImage={(options) => runExport("mosaic-image", options)}
                  onLoadFootage={() => handleLoadFootage("mosaic-builder")}
                  scanning={projectStates.pre.scanning || false}
                />
              ) : activePreproductionApp === 'shot-planner' ? (
                projectId ? (
                  <div className="media-workspace">
                    <div className="stats-bar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
                      <div className={`stat-card ${selectedClipIds.size > 0 ? 'stat-card-highlight' : ''}`} style={{ background: "transparent", border: "none", boxShadow: "none" }}>
                        <div className="stat-header">
                          <span className="stat-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Selected</span>
                        </div>
                        <span className="stat-value" style={{ fontSize: "var(--inspector-value-size)", fontWeight: "var(--inspector-value-weight)", letterSpacing: "var(--inspector-value-spacing)" }}>
                          {selectedClipIds.size}<span className="stat-value-total" style={{ opacity: 0.4 }}> / {totalClips}</span>
                        </span>
                        <span className="stat-sub" style={{ fontSize: "10px", opacity: 0.5 }}>Reference clips in export scope</span>
                      </div>
                      <div className="stat-card" style={{ background: "transparent", border: "none", boxShadow: "none" }}>
                        <div className="stat-header">
                          <span className="stat-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Rejected</span>
                        </div>
                        <span className="stat-value" style={{ fontSize: "var(--inspector-value-size)", fontWeight: "var(--inspector-value-weight)", letterSpacing: "var(--inspector-value-spacing)" }}>{rejectedCount}</span>
                        <span className="stat-sub" style={{ fontSize: "10px", opacity: 0.5 }}>Rejected clips never export</span>
                      </div>
                      <div className="stat-card" style={{ background: "transparent", border: "none", boxShadow: "none" }}>
                        <div className="stat-header">
                          <span className="stat-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Export-ready</span>
                        </div>
                        <span className="stat-value" style={{ fontSize: "var(--inspector-value-size)", fontWeight: "var(--inspector-value-weight)", letterSpacing: "var(--inspector-value-spacing)" }}>{exportReadyCount}</span>
                        <span className="stat-sub" style={{ fontSize: "10px", opacity: 0.5 }}>{effectiveLookbookSortMode === "custom" ? "Tagged with order, size, movement" : "Tagged with size and movement"}</span>
                      </div>
                    </div>

                    <div className="toolbar premium-toolbar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)", marginTop: -1 }}>
                      <div className="toolbar-left-group">
                        <div className="thumb-range-selector">
                          <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Thumbs</span>
                          {[3, 5, 7].map((n) => (
                            <button
                              key={n}
                              className={`btn btn-ghost btn-xs ${thumbCount === n ? 'active' : ''}`}
                              onClick={() => { setThumbCount(n); localStorage.setItem('wp_thumbCount', n.toString()); }}
                            >
                              <span className="thumb-choice-value">{n}</span>
                            </button>
                          ))}
                        </div>
                        <div className="toolbar-separator" />
                        <div className="shot-planner-order-mode">
                          <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Order</span>
                          <div className="clip-mode-pill-row">
                            <button type="button" className={`clip-mode-pill ${effectiveLookbookSortMode === "custom" ? "active" : ""}`} onClick={() => setLookbookSortMode("custom")}>Manual</button>
                            <button type="button" className={`clip-mode-pill ${effectiveLookbookSortMode === "canonical" ? "active" : ""}`} onClick={() => setLookbookSortMode("canonical")}>Canonical</button>
                          </div>
                        </div>
                        <div className="toolbar-separator" />
                      </div>
                      <div className="toolbar-right-group">
                        <button className="btn btn-ghost btn-sm" onClick={handleToggleSelectAll}>
                          {selectedSelectableCount === selectableClipIds.length ? "Deselect all" : "Select all"}
                        </button>
                        <div className="shot-planner-export" ref={exportMenuRef}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShotPlannerExportMenuOpen((prev) => !prev)}
                            aria-haspopup="menu"
                            aria-expanded={shotPlannerExportMenuOpen}
                          >
                            <FileDown size={14} />
                            <span>Export</span>
                            <ChevronDown size={14} />
                          </button>
                          {shotPlannerExportMenuOpen && (
                            <div className="shot-planner-export-menu" role="menu">
                              <button type="button" className="shot-planner-export-item" onClick={() => handleExport()}>
                                <FileDown size={14} />
                                <span>PDF</span>
                              </button>
                              <button type="button" className="shot-planner-export-item" onClick={() => handleExportImage()}>
                                <Image size={14} />
                                <span>Image</span>
                              </button>
                              <button type="button" className="shot-planner-export-item" onClick={() => handleExportMosaicPdf()}>
                                <FileDown size={14} />
                                <span>Mosaic (PDF)</span>
                              </button>
                              <button type="button" className="shot-planner-export-item" onClick={() => handleExportMosaicImage()}>
                                <Image size={14} />
                                <span>Mosaic (Image)</span>
                              </button>
                            </div>
                          )}
                        </div>
                         <div className="shot-planner-export-dropdown">
                          <button className="btn btn-secondary btn-sm" onClick={() => handleLoadFootage("shot-planner", "folder")} disabled={scanning}>
                            {scanning ? <div className="spinner" /> : <FolderOpen size={14} />}
                            <span>{scanning ? "Scanning..." : "Load..."}</span>
                            <ChevronDown size={12} style={{ marginLeft: '4px', opacity: 0.5 }} />
                          </button>
                          <div className="shot-planner-export-menu">
                            <button type="button" className="shot-planner-export-item" onClick={() => handleLoadFootage("shot-planner", "folder")}>
                              <FolderOpen size={14} />
                              <span>Load Folder</span>
                            </button>
                            <button type="button" className="shot-planner-export-item" onClick={() => handleLoadFootage("shot-planner", "files")}>
                              <Film size={14} />
                              <span>Load File(s)</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <ClipList
                      clips={sortedClips}
                      thumbnailCache={thumbnailCache}
                      selectedIds={selectedClipIds}
                      onToggleSelection={toggleClipSelection}
                      thumbCount={thumbCount}
                      onUpdateMetadata={handleUpdateMetadata}
                      onHoverClip={onHoverClip}
                      onFocusClip={focusShotPlannerClip}
                      focusedClipId={focusedClipId}
                      focusedClipScrollToken={focusedClipScrollToken}
                      jumpSeconds={selectedJumpSeconds}
                      cacheKeyContext={thumbCacheContext}
                      shotSizeOptions={[...SHOT_SIZE_CANONICAL, ...(enableOptionalShotTags ? SHOT_SIZE_OPTIONAL : []), ...customShotSizes]}
                      movementOptions={[...MOVEMENT_CANONICAL, ...customMovements]}
                      lookbookSortMode={effectiveLookbookSortMode}
                      onResetClip={handleResetShotPlannerClip}
                      onManualOrderInputChange={clearManualOrderBuffer}
                      manualOrderConflict={manualOrderConflict}
                      groupByShotSize={true}
                      onPromoteClip={handlePromoteClip}
                      onPlayClip={handlePlayClip}
                      playingClipId={playingClipId}
                      playingProgress={playingProgress}
                      projectLutHash={projectLut?.hash || null}
                      lutRenderNonce={lutRenderNonce}
                      hideLutControls={true}
                      onExportPDF={handleExport}
                      onExportImage={handleExportImage}
                      onExportMosaicPdf={handleExportMosaicPdf}
                      onExportMosaicImage={handleExportMosaicImage}
                      variant="shot-planner"
                      onReorderClips={handleReorderClips}
                    />
                  </div>
                ) : (scanning) ? (
                  <div className="media-workspace">
                    <div className="toolbar premium-toolbar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
                      <div className="toolbar-left-group">
                        <button className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.8 }}>
                          <div className="spinner" />
                          <span>Scanning…</span>
                        </button>
                      </div>
                    </div>
                    <div className="inline-loading-state" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div className="skeleton-pulse" style={{ height: '32px', width: '200px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }} />
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                        {[1, 2, 3, 4, 5, 6].map(i => (
                          <div key={i} className="skeleton-pulse" style={{ height: '160px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="media-workspace">
                    <div className="workspace-empty-state premium-card" style={{ background: "var(--inspector-bg)", border: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
                      <div className="module-icon"><Camera size={28} strokeWidth={1.5} /></div>
                      <h2>Shot Planner</h2>
                      <p style={{ color: "var(--text-secondary)", maxWidth: "400px", margin: "0 auto var(--space-md)" }}>
                        Load reference clips to tag shot sizes, movement, and selections before the shoot.
                      </p>
                      <button className="btn btn-secondary" onClick={() => handleLoadFootage("shot-planner")}>
                        <FolderOpen size={14} />
                        <span>Load References</span>
                      </button>
                    </div>
                  </div>
                )
              ) : activePreproductionApp === 'folder-creator' ? (
                <div className="scrollable-view">
                  <FolderCreator />
                </div>
              ) : activePreproductionApp === 'duplicate-finder' ? (
                <div className="scrollable-view">
                  <DuplicateFinderApp />
                </div>
              ) : activePreproductionApp === 'starter-setup' ? (
                <div className="scrollable-view">
                  <StarterSetup onBack={() => setActivePreproductionApp(null)} />
                </div>
              ) : (
                <div className="scrollable-view">
                  <div className="onboarding-container preproduction-launcher">
                    <div className="onboarding-header">
                      <span className="onboarding-eyebrow">Module</span>
                      <h1>Pre-production</h1>
                      <p>Plan your shoot and organize your project structure.</p>
                    </div>
                    <div className="onboarding-grid onboarding-grid-root">
                      <div
                        className="module-card premium-card"
                        onClick={() => setActivePreproductionApp('folder-creator')}
                      >
                        <div className="module-icon"><FolderTree size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Folder Creator</h3>
                          <p>Generate sophisticated folder structures for multi-platform use.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card"
                        onClick={() => setActivePreproductionApp('starter-setup')}
                      >
                        <div className="module-icon"><ClipboardCheck size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Starter Setup</h3>
                          <p>Get a safe technical starting setup sheet for your shoot instantly.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card"
                        onClick={() => {
                          if (projectStates.pre.projectId) setActivePreproductionApp('shot-planner');
                          else handleLoadFootage('shot-planner');
                        }}
                      >
                        <div className="module-icon"><Camera size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Shot Planner</h3>
                          <p>Analyze reference footage and export selected on-set reference sheets.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card"
                        onClick={() => {
                          if (projectStates.pre.projectId) setActivePreproductionApp('mosaic-builder');
                          else handleLoadFootage('mosaic-builder');
                        }}
                      >
                        <div className="module-icon"><LayoutGrid size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Grid Mosaic</h3>
                          <p>Generate large multi-frame image grids and PDF sheets from clip thumbnails.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card"
                        onClick={() => setActivePreproductionApp('duplicate-finder')}
                      >
                        <div className="module-icon"><FileSearch size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Duplicate Finder</h3>
                          <p>Scan folders for identical files and generate cleanup reports.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            ) : activeTab === 'media-workspace' ? (
              activeMediaWorkspaceApp === 'safe-copy' ? (
                <div className="media-workspace">

                  <SafeCopy projectId={projectId ?? "__global__"} onError={setUiError} />
                </div>
              ) : activeMediaWorkspaceApp === 'clip-review' ? (
                projectId ? (
                  <div className="media-workspace">
                    <div className="stats-bar">
                      <div className="stat-card">
                        <div className="stat-header">
                          <span className="stat-label">Clips</span>
                        </div>
                        <span className="stat-value">{totalClips}</span>
                        <span className="stat-sub">Workspace review items</span>
                      </div>
                      <div className={`stat-card ${selectedClipIds.size > 0 ? 'stat-card-highlight' : ''}`}>
                        <div className="stat-header">
                          <span className="stat-label">Selected</span>
                        </div>
                        <span className="stat-value">{selectedClipIds.size}<span className="stat-value-total"> / {totalClips}</span></span>
                        <span className="stat-sub">Included in export scope</span>
                      </div>
                      <div className={`stat-card ${projectLut ? 'stat-card-lut-loaded' : ''}`}>
                        <div className="stat-header">
                          <span className="stat-label">Project LUT</span>
                        </div>
                        <span className="stat-value">{projectLut ? projectLut.name : "None"}</span>
                        <span className="stat-sub">{projectLut ? "LUT preview available in Review" : "Load a .cube LUT for review previews"}</span>
                      </div>
                    </div>

                    <div className="toolbar premium-toolbar review-toolbar">
                      <div className="toolbar-left-group">
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexShrink: 0 }}>
                          <span className="toolbar-label">Clips</span>
                          <span className="section-count highlight">{sortedClips.length}</span>
                        </div>
                        <div className="thumb-range-selector">
                          <span className="toolbar-label">Thumbs</span>
                          {[3, 5, 7].map((n) => (
                            <button
                              key={n}
                              className={`btn btn-ghost btn-xs ${thumbCount === n ? 'active' : ''}`}
                              onClick={() => { setThumbCount(n); localStorage.setItem('wp_thumbCount', n.toString()); }}
                            >
                              <span className="thumb-choice-value">{n}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="toolbar-right-group">
                        <button className="btn btn-ghost btn-sm" onClick={handleToggleSelectAll}>
                          {selectedSelectableCount === selectableClipIds.length ? "Deselect all" : "Select all"}
                        </button>
                        <div className="shot-planner-export">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setReviewExportMenuOpen((prev) => !prev)}
                            aria-haspopup="menu"
                            aria-expanded={reviewExportMenuOpen}
                          >
                            <FileDown size={14} />
                            <span>Export</span>
                            <ChevronDown size={14} />
                          </button>
                          {reviewExportMenuOpen && (
                            <div className="shot-planner-export-menu" role="menu">
                              <button type="button" className="shot-planner-export-item" onClick={() => { setReviewExportMenuOpen(false); handleExport(); }}>
                                <FileDown size={14} />
                                <span>PDF</span>
                              </button>
                              <button type="button" className="shot-planner-export-item" onClick={() => { setReviewExportMenuOpen(false); handleExportImage(); }}>
                                <Image size={14} />
                                <span>Image</span>
                              </button>
                              <button type="button" className="shot-planner-export-item" onClick={() => { setReviewExportMenuOpen(false); handleExportMosaicPdf(); }}>
                                <FileDown size={14} />
                                <span>Mosaic (PDF)</span>
                              </button>
                              <button type="button" className="shot-planner-export-item" onClick={() => { setReviewExportMenuOpen(false); handleExportMosaicImage(); }}>
                                <Image size={14} />
                                <span>Mosaic (Image)</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={handleLoadProjectLut}>
                          <FolderOpen size={14} />
                          <span>{projectLut ? "Replace LUT" : "Load LUT"}</span>
                        </button>
                        {projectLut && (
                          <button className="btn btn-ghost btn-sm" onClick={handleRemoveProjectLut}>
                            <XCircle size={14} />
                            <span>Clear LUT</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <ClipList
                      clips={sortedClips}
                      thumbnailCache={thumbnailCache}
                      selectedIds={selectedClipIds}
                      onToggleSelection={toggleClipSelection}
                      thumbCount={thumbCount}
                      onUpdateMetadata={handleUpdateMetadata}
                      onHoverClip={onHoverClip}
                      onFocusClip={focusShotPlannerClip}
                      focusedClipId={focusedClipId}
                      focusedClipScrollToken={focusedClipScrollToken}
                      jumpSeconds={selectedJumpSeconds}
                      cacheKeyContext={thumbCacheContext}
                      shotSizeOptions={[...SHOT_SIZE_CANONICAL, ...customShotSizes]}
                      movementOptions={[...MOVEMENT_CANONICAL, ...customMovements]}
                      lookbookSortMode={lookbookSortMode}
                      groupByShotSize={false}
                      onPromoteClip={handlePromoteClip}
                      onPlayClip={handlePlayClip}
                      playingClipId={playingClipId}
                      playingProgress={playingProgress}
                      projectLutHash={projectLut?.hash || null}
                      lutRenderNonce={lutRenderNonce}
                      onExportPDF={handleExport}
                      onExportImage={handleExportImage}
                      onExportMosaicPdf={handleExportMosaicPdf}
                      onExportMosaicImage={handleExportMosaicImage}
                      hideSectionHeader={true}
                      onReorderClips={handleReorderClips}
                    />
                  </div>
                ) : null
              ) : activeMediaWorkspaceApp === 'scene-blocks' ? (
                projectId ? (
                  <div className="media-workspace">
                    <BlocksView
                      projectId={projectId}
                      thumbnailCache={thumbnailCache}
                      thumbnailsByClipId={thumbnailsByClipId}
                      onSelectedBlockIdsChange={setSelectedBlockIds}
                      onOpenDelivery={() => setShowExportPanel(true)}
                    />
                  </div>
                ) : null
              ) : activeMediaWorkspaceApp === 'review-core' ? (
                <div className="media-workspace">
                  <ReviewCore
                    projectId={projectId}
                    projectName={projectName}
                    onError={setUiError}
                  />
                </div>
              ) : (
                <div className="scrollable-view">
                  <div className="onboarding-container postproduction-launcher">
                    <div className="onboarding-header">
                      <h1>Media Workspace</h1>
                      <p>Post-production suite for media verification and organization.</p>
                    </div>
                    <div className="onboarding-grid workspace-apps-grid postproduction-apps-grid">
                      <div
                        className="module-card premium-card"
                        onClick={() => setActiveMediaWorkspaceApp('safe-copy')}
                      >
                        <div className="module-icon"><ShieldCheck size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Safe Copy</h3>
                          <p>Verify source and destination pairs before editorial work begins.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card"
                        onClick={() => {
                          if (projectId) setActiveMediaWorkspaceApp('clip-review');
                          else handleLoadFootage("clip-review");
                        }}
                      >
                        <div className="module-icon"><Camera size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Open Workspace / Review</h3>
                          <p>{projectId ? "Continue reviewing thumbnails, metadata, and audio." : "Load a footage folder to unlock Review, Scene Blocks, and Delivery."}</p>
                          <span className="module-action">{projectId ? "Open App" : "Load Workspace"} <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card"
                        onClick={() => {
                          setActiveMediaWorkspaceApp('review-core');
                        }}
                      >
                        <div className="module-icon"><Film size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Review Core</h3>
                          <p>{projectId ? "Play app-managed HLS proxies, inspect versions, and confirm metadata." : "Create or reopen a Review Core project to import and review media independently."}</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className={`module-card premium-card ${!projectId ? "disabled" : ""}`}
                        onClick={() => {
                          if (projectId) setActiveMediaWorkspaceApp('scene-blocks');
                        }}
                      >
                        <div className="module-icon"><Boxes size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Scene Blocks</h3>
                          <p>{projectId ? "Organize reviewed clips into deterministic editorial groups." : "Available after a workspace is opened in Review."}</p>
                          <span className="module-action">{projectId ? "Open App" : "Workspace required"}</span>
                        </div>
                      </div>
                      <div
                        className={`module-card premium-card ${!projectId ? "disabled" : ""}`}
                        onClick={() => { if (projectId) setShowExportPanel(true); }}
                      >
                        <div className="module-icon"><FileDown size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Delivery</h3>
                          <p>{projectId ? "Export Resolve timelines and Director Packs from the current scope." : "Available after clips are loaded into the workspace."}</p>
                          <span className="module-action">{projectId ? "Open App" : "Workspace required"}</span>
                        </div>
                      </div>
                    </div>
                    {inWorkspaceLauncher && !projectId && (
                      <div className="workspace-launcher-hint">
                        <strong>Review Core</strong> can now run independently. <strong>Scene Blocks</strong> and <strong>Delivery</strong> still require an opened workspace.
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : activeTab === 'production' ? (
              activeProductionApp === "look-setup" && activeProductionProject ? (
                <LookSetup
                  project={activeProductionProject}
                  onBack={() => setActiveProductionApp(null)}
                  onContinueToMatchLab={() => setActiveProductionApp("camera-match-lab")}
                />
              ) : activeProductionApp === "onset-coach" && activeProductionProject ? (
                <OnSetCoach
                  project={activeProductionProject}
                  onBack={() => setActiveProductionApp(null)}
                />
              ) : activeProductionApp === "match-normalize" && activeProductionProject ? (
                <MatchNormalize
                  project={activeProductionProject}
                  onBack={() => setActiveProductionApp(null)}
                />
              ) : activeProductionApp === "camera-match-lab" && activeProductionProject ? (
                <CameraMatchLab
                  project={activeProductionProject}
                  onBack={() => setActiveProductionApp(null)}
                />
              ) : activeProductionApp === "frame-preview" && activeProductionProject ? (
                <FramePreview
                  project={activeProductionProject}
                  onBack={() => setActiveProductionApp(null)}
                />
              ) : (
                <ProductionLanding
                  onSelectProject={setActiveProductionProject}
                  onOpenLookSetup={() => {
                    setActiveProductionApp("look-setup");
                  }}
                  onOpenOnSetCoach={() => {
                    setActiveProductionApp("onset-coach");
                  }}
                  onOpenMatchNormalize={() => {
                    setActiveProductionApp("match-normalize");
                  }}
                  onOpenCameraMatchLab={() => {
                    setActiveProductionApp("camera-match-lab");
                  }}
                  onOpenFramePreview={() => {
                    setActiveProductionApp("frame-preview");
                  }}
                  activeProject={activeProductionProject}
                />
              )
            ) : (
              <div className="scrollable-view">
                <div className="onboarding-container">
                  <div className="onboarding-header">
                    <span className="onboarding-eyebrow">Modules</span>
                    <h1>Wrap Preview Suite</h1>
                    <p>Offline media control for shoots and post.</p>
                  </div>
                  <div className="onboarding-grid onboarding-grid-root">
                    <div
                      className="module-card premium-card tour-home-preproduction"
                      onClick={() => {
                        setActiveTab("preproduction");
                        setActivePreproductionApp(null);
                        setActiveMediaWorkspaceApp(null);
                      }}
                    >
                      <div className="module-icon"><Boxes size={22} strokeWidth={1.35} /></div>
                      <div className="module-info">
                        <span className="module-label">Pre-Production</span>
                        <h2>Pre-Production</h2>
                        <p>Plan shots, build references, generate folder structure.</p>
                        <span className="module-action">Enter Module <ArrowRight size={16} /></span>
                      </div>
                    </div>
                    <div
                      className="module-card premium-card tour-home-production"
                      onClick={() => {
                        setActiveTab("production");
                        setActivePreproductionApp(null);
                        setActiveMediaWorkspaceApp(null);
                      }}
                    >
                      <div className="module-icon"><Camera size={22} strokeWidth={1.35} /></div>
                      <div className="module-info">
                        <span className="module-label">Production</span>
                        <h2>Production</h2>
                        <p>Plan looks, lock exposure, and match cameras on set.</p>
                        <span className="module-action">Enter Module <ArrowRight size={16} /></span>
                      </div>
                    </div>
                    <div
                      className="module-card premium-card tour-home-postproduction"
                      onClick={() => {
                        setActiveTab("media-workspace");
                        setActivePreproductionApp(null);
                        setActiveMediaWorkspaceApp(null);
                      }}
                    >
                      <div className="module-icon"><BriefcaseBusiness size={22} strokeWidth={1.35} /></div>
                      <div className="module-info">
                        <span className="module-label">Post-Production</span>
                        <h2>Post-Production</h2>
                        <p>Review footage, verify copies, build selects, export handoff.</p>
                        <span className="module-action">Enter Module <ArrowRight size={16} /></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {pendingExportValidation && (
            <div className="export-modal-backdrop" onClick={() => setPendingExportValidation(null)}>
              <div className="export-modal export-validation-modal" onClick={(e) => e.stopPropagation()}>
                <div className="export-modal-header">
                  <div className="export-modal-icon">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h3 className="export-modal-title">Missing tags</h3>
                    <p className="export-modal-subtitle">Some selected clips are missing order or shot tags. Fill them now?</p>
                  </div>
                </div>
                <div className="export-modal-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      focusClipField(pendingExportValidation.firstMissing.clipId, pendingExportValidation.firstMissing.field);
                      setPendingExportValidation(null);
                    }}
                  >
                    Fill now
                  </button>
                  <button
                    className="btn btn-accent"
                    onClick={() => {
                      const kind = pendingExportValidation.kind;
                      setPendingExportValidation(null);
                      setUiNotice({
                        title: "Untagged clips will be placed at the end of the export.",
                        hint: ""
                      });
                      void runExport(kind);
                    }}
                  >
                    Export anyway
                  </button>
                </div>
              </div>
            </div>
          )}

          {showExportPanel && projectId && (
            <ExportPanel
              projectId={projectId}
              clips={clips.map(c => c.clip).filter((c) => c.flag !== "reject")}
              selectedBlockIds={selectedBlockIds}
              currentFilterMode={viewFilter}
              currentFilterMinRating={viewMinRating}
              onError={setUiError}
              onClose={() => setShowExportPanel(false)}
            />
          )}

          <JobsPanel open={jobsOpen} jobs={jobs} onClose={() => setJobsOpen(false)} onRefresh={refreshJobs} extracting={extracting} extractProgress={extractProgress} scanning={scanning} />
          <AboutPanel open={aboutOpen} info={appInfo} onResetTour={resetTour} onClose={() => setAboutOpen(false)} />

          <TourGuide
            run={tourRun}
            steps={tourSteps}
            onComplete={completeTour}
            onClose={completeTour}
          />

          {(activeTab !== 'home' || activePreproductionApp || activeMediaWorkspaceApp) && (
            <button
              className="subtle-back-button"
              onClick={() => {
                if (activeMediaWorkspaceApp) setActiveMediaWorkspaceApp(null);
                else if (activePreproductionApp) setActivePreproductionApp(null);
                else setActiveTab('home');
              }}
              title="Back to Dashboard"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
