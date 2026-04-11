/*
 * (c) 2026 Alan Alves. All rights reserved.
 * CineFlow Suite — Professional Production to Post Hub
 * hello@expose-u.com | https://alan-design.com/
 */

import { Component, ReactNode, useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
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
  Briefcase,
  CircleHelp,
  FileDown,
  ChevronDown,
  LayoutGrid,
  Maximize,
  FolderTree,
  ArrowLeft,
  AlertTriangle,
  Film,
  Image,
  XCircle,
  FileSearch,
  ClipboardCheck,
  Calculator,
  Ruler,
  CircleDot,
  X,
  HardDrive,
  Clock3,
  AudioLines,
  Scaling,
  RotateCcw,
  Minimize,
  Eye,
} from "lucide-react";
// Lazy-loaded components
const ClipList = lazy(() => import("./components/ClipList").then(m => ({ default: m.ClipList })));
const PrintLayout = lazy(() => import("./components/PrintLayout").then(m => ({ default: m.PrintLayout })));
const SafeCopy = lazy(() => import("./components/SafeCopy").then(m => ({ default: m.SafeCopy })));
const ExportPanel = lazy(() => import("./components/ExportPanel").then(m => ({ default: m.ExportPanel })));
const BlocksView = lazy(() => import("./components/BlocksView").then(m => ({ default: m.BlocksView })));
const JobsPanel = lazy(() => import("./components/JobsPanel").then(m => ({ default: m.JobsPanel })));
const AboutPanel = lazy(() => import("./components/AboutPanel").then(m => ({ default: m.AboutPanel })));
const FolderCreator = lazy(() => import("./components/FolderCreator").then(m => ({ default: m.FolderCreator })));
const ReviewCore = lazy(() => import("./components/ReviewCore").then(m => ({ default: m.ReviewCore })));
const MosaicBuilder = lazy(() => import("./components/MosaicBuilder").then(m => ({ default: m.MosaicBuilder })));
const DuplicateFinderApp = lazy(() => import("./components/DuplicateFinderApp").then(m => ({ default: m.DuplicateFinderApp })));
const StarterSetup = lazy(() => import("./components/PreProduction/StarterSetup"));
const ShotList = lazy(() => import("./components/PreProduction/ShotList"));
import { TourGuide, TourStep } from "./components/TourGuide";
import { exportPdf, exportImage, exportMosaicImage, exportMosaicPdf } from "./utils/ExportUtils";
import appLogo from "./assets/Subtract.svg";
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
const ProductionLanding = lazy(() => import("./modules/Production/ProductionLanding").then(m => ({ default: m.ProductionLanding })));
const LookSetup = lazy(() => import('./modules/Production/apps/LookSetup'));
const OnSetCoach = lazy(() => import('./modules/Production/apps/OnSetCoach.tsx'));
const MatchNormalize = lazy(() => import('./modules/Production/apps/MatchNormalize.tsx'));
const CameraMatchLab = lazy(() => import('./modules/Production/apps/CameraMatchLab.tsx'));
const FramePreview = lazy(() => import('./modules/Production/apps/FramePreview'));
import { useCommandPalette } from "./hooks/useCommandPalette";
import { CommandPalette } from "./components/CommandPalette";
import { getJumpIntervalForThumbCount, getThumbnailCacheContext } from "./utils/thumbnailIntervals";
import { invokeGuarded, isTauriReloading, convertFileSrc } from "./utils/tauri";

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

function SuiteLoading() {
  return (
    <div className="media-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
      <div className="spinner" style={{ width: '40px', height: '40px', borderWidth: '3px', marginBottom: '16px' }} />
      <span className="stat-label" style={{ fontSize: '14px', letterSpacing: '0.1em', opacity: 0.6, textTransform: 'uppercase' }}>Loading Module...</span>
    </div>
  );
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
  const [othersMenuOpen, setOthersMenuOpen] = useState(false);
  const [activeMicroApp, setActiveMicroApp] = useState<"crop-factor" | "video-file-size" | "aspect-ratio" | "transfer-time" | null>(null);
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
    if (activeTab !== "home") {
      setOthersMenuOpen(false);
      setActiveMicroApp(null);
    }
  }, [activeTab]);

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
  const [transferResetNonce, setTransferResetNonce] = useState(0);
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
    () => getThumbnailCacheContext(selectedJumpSeconds, thumbCount),
    [selectedJumpSeconds, thumbCount],
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
    // Tour is only activated manually by the user, not automatically on first run
    const seen = localStorage.getItem(TOUR_SEEN_KEY) === "true";
    const version = localStorage.getItem(TOUR_VERSION_KEY);
    if (!seen || version !== TOUR_VERSION) {
      // We still mark it as seen so we know the user's current version
      localStorage.setItem(TOUR_SEEN_KEY, "true");
      localStorage.setItem(TOUR_VERSION_KEY, TOUR_VERSION);
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
    return `${clipId}_${index}::${context}`;
  }, [thumbCacheContext]);

  const hydrateThumbnailEntry = useCallback(async (path: string) => {
    if (!path || isUnloadingRef.current) return null;
    if (path.startsWith("data:")) return path;
    try {
      return await safeInvoke<string>("read_thumbnail", { path });
    } catch (error) {
      if (!isUnloadingRef.current) {
        console.warn(`Failed to hydrate thumbnail ${path}`, error);
      }
      return null;
    }
  }, [safeInvoke]);

  const hydrateThumbnailCacheEntries = useCallback(async (
    entries: Array<{ clipId: string; jumpSeconds: number; index: number; path: string }>
  ) => {
    const results: Array<{ clipId: string; jumpSeconds: number; index: number; src: string }> = [];
    const BATCH_SIZE = 20;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const hydratedBatch = await Promise.all(
        batch.map(async ({ clipId, jumpSeconds, index, path }) => {
          const src = await hydrateThumbnailEntry(path);
          return src ? { clipId, jumpSeconds, index, src } : null;
        })
      );
      for (const item of hydratedBatch) {
        if (item) results.push(item);
      }
    }
    return results;
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
            nextCache[getThumbCacheKey(clipId, index, getThumbnailCacheContext(jumpSeconds, thumbCount))] = src;
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
    hydrateThumbnailCacheEntries,
    getThumbCacheKey,
    getThumbnailCacheContext,
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
      target: ".tour-app-logo",
      title: "Welcome to CineFlow Suite",
      description: "Welcome! CineFlow Suite is your high-performance suite for media control, designed to protect your vision from prep to post.",
      placement: "bottom",
      learnMore: [
        "Use the sidebar and tabs to navigate various modules.",
        "The app is sandboxed for security and App Store compliance."
      ]
    },
    {
      target: ".onboarding-grid-root",
      title: "Navigation Hub",
      description: "Modules are organized by project phase. Each hub contains specialized applications for that stage of production.",
      placement: "top",
      learnMore: [
        "Pre-production: Planning and project structure.",
        "Production: Look development and on-set tools.",
        "Post-production: Ingest, verification, and editorial handoff."
      ]
    },
    {
      target: ".tour-home-preproduction",
      title: "Planning & Prep",
      description: "Prepare for your shoot with the Shot List builder, Folder Creator, and visual Shot Planner.",
      placement: "bottom",
      learnMore: [
        "Generate automated folder structures for multi-platform projects.",
        "Build rich reference sheets with embedded clip metadata."
      ]
    },
    {
      target: ".tour-home-postproduction",
      title: "Ingest & Review",
      description: "Our high-speed post-production tools include Safe Copy for secure offloads and Review Core for visual verification.",
      placement: "bottom",
      learnMore: [
        "Safe Copy uses checksums to ensure file integrity.",
        "Review Core provides a deterministic HLS proxy playback environment."
      ]
    },
    {
      target: ".btn-jobs",
      title: "Background Engine",
      description: "CineFlow Suite handles proxy extraction, metadata analysis, and exports in the background.",
      placement: "bottom",
      learnMore: [
        "Monitor live progress for long-running queue tasks.",
        "The engine utilizes native hardware acceleration for media processing."
      ]
    },
    {
      target: ".help-menu-wrapper",
      title: "Help & Maintenance",
      description: "Access system information, guides, and the Hard Reset utility for periodic maintenance.",
      placement: "bottom",
      learnMore: [
        "Hard Reset deep-cleans all local databases and caches.",
        "Check system health and sidecar binary status in the about panel."
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
        console.warn(`[CineFlow Suite] Missing command registry entry for "${entry.id}"`);
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
              <div className="app-logo tour-app-logo" onClick={() => { setActiveTab('home'); setActivePreproductionApp(null); setActiveMediaWorkspaceApp(null); }}>
                <img src={appLogo} alt="Logo" className="app-logo-img" />
                <span className="app-title">CineFlow Suite</span>
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
                  <Briefcase size={14} /> Post-production
                </button>
              </nav>
            )}
            <div className="app-header-right">
              <nav className="header-nav">
              </nav>
              <>

                <div className="help-menu-wrapper" style={{ position: 'relative' }}>
                  <button 
                    className="btn btn-ghost help-menu-trigger" 
                    style={{ 
                      width: '32px', 
                      height: '32px', 
                      color: 'var(--text-secondary)', 
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0
                    }} 
                    onClick={() => setHelpMenuOpen(!helpMenuOpen)} 
                    title="Help & Info"
                  >
                    <CircleHelp size={16} strokeWidth={1.5} />
                  </button>
                  {helpMenuOpen && (
                    <>
                      <div className="dropdown-backdrop" onClick={() => setHelpMenuOpen(false)} />
                      <div className="help-dropdown menu-dropdown">
                        <button className="dropdown-item menu-item" onClick={() => { setAboutOpen(true); setHelpMenuOpen(false); }}>
                          <span className="menu-item-icon"><Info size={16} /></span>
                          <span className="menu-item-label">About CineFlow</span>
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

                <div className="utilities-menu-wrapper" style={{ position: 'relative' }}>
                  <button
                    className="btn btn-utilities"
                    onClick={() => setOthersMenuOpen((prev) => !prev)}
                    aria-haspopup="menu"
                    aria-expanded={othersMenuOpen}
                  >
                    <span>Utilities</span>
                    <ChevronDown size={14} />
                  </button>
                  {othersMenuOpen && (
                    <>
                      <div className="dropdown-backdrop" onClick={() => setOthersMenuOpen(false)} />
                      <div className="help-dropdown menu-dropdown utilities-dropdown" role="menu">
                        <button
                          className="dropdown-item menu-item utilities-menu-item utilities-menu-item-crop"
                          onClick={() => {
                            setOthersMenuOpen(false);
                            setActiveMicroApp("crop-factor");
                          }}
                        >
                          <span className="menu-item-icon"><Calculator size={16} /></span>
                          <span className="menu-item-copy">
                            <span className="menu-item-label">Crop Factor</span>
                            <small>Lens equivalence</small>
                          </span>
                        </button>
                        <button
                          className="dropdown-item menu-item utilities-menu-item utilities-menu-item-file"
                          onClick={() => {
                            setOthersMenuOpen(false);
                            setActiveMicroApp("video-file-size");
                          }}
                        >
                          <span className="menu-item-icon"><HardDrive size={16} /></span>
                          <span className="menu-item-copy">
                            <span className="menu-item-label">File Size</span>
                            <small>Storage estimate</small>
                          </span>
                        </button>
                        <button
                          className="dropdown-item menu-item utilities-menu-item utilities-menu-item-aspect"
                          onClick={() => {
                            setOthersMenuOpen(false);
                            setActiveMicroApp("aspect-ratio");
                          }}
                        >
                          <span className="menu-item-icon"><Scaling size={16} /></span>
                          <span className="menu-item-copy">
                            <span className="menu-item-label">Aspect Ratio</span>
                            <small>Frame math</small>
                          </span>
                        </button>
                        <button
                          className="dropdown-item menu-item utilities-menu-item utilities-menu-item-transfer"
                          onClick={() => {
                            setOthersMenuOpen(false);
                            setActiveMicroApp("transfer-time");
                          }}
                        >
                          <span className="menu-item-icon"><Clock3 size={16} /></span>
                          <span className="menu-item-copy">
                            <span className="menu-item-label">Transfer Time</span>
                            <small>Copy estimate</small>
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>


                <button className={`btn btn-jobs jobs-state-${jobHudState}`} onClick={() => setJobsOpen(true)}>
                  <div className="jobs-indicator-content">
                    <Briefcase size={16} />
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
            <Suspense fallback={<SuiteLoading />}>
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
                      groupByShotSize={false}
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
              ) : activePreproductionApp === 'shot-list' ? (
                <div className="scrollable-view">
                  <ShotList onBack={() => setActivePreproductionApp(null)} appVersion={appInfo?.version} />
                </div>
              ) : (
                <div className="scrollable-view">
                  <div className="onboarding-container module-launcher preproduction-launcher">
                    <div className="onboarding-header module-launcher-header">
                      <h1>Pre-production</h1>
                      <p>Plan your shoot and organize your project structure.</p>
                    </div>
                    <div className="onboarding-grid module-launcher-grid onboarding-grid-root">
                      <div
                        className="module-card premium-card module-launcher-card"
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
                        className="module-card premium-card module-launcher-card"
                        onClick={() => setActivePreproductionApp('shot-list')}
                      >
                        <div className="module-icon"><ClipboardCheck size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Shot List</h3>
                          <p>Build a clean day sheet with minimal shot rows and a visual equipment list.</p>
                          <span className="module-action">Open App <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card module-launcher-card"
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
                        className="module-card premium-card module-launcher-card"
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
                        className="module-card premium-card module-launcher-card"
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
                        className="module-card premium-card module-launcher-card"
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
                  <div className="onboarding-container module-launcher postproduction-launcher">
                    <div className="onboarding-header module-launcher-header">
                      <h1>Post-production</h1>
                      <p>Post-production suite for media verification and organization.</p>
                    </div>
                    <div className="onboarding-grid module-launcher-grid workspace-apps-grid postproduction-apps-grid">
                      <div
                        className="module-card premium-card module-launcher-card"
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
                        className="module-card premium-card module-launcher-card"
                        onClick={() => {
                          if (projectId) setActiveMediaWorkspaceApp('clip-review');
                          else handleLoadFootage("clip-review");
                        }}
                      >
                        <div className="module-icon"><Camera size={20} strokeWidth={1.5} /></div>
                        <div className="module-info">
                          <h3>Media Review</h3>
                          <p>{projectId ? "Continue reviewing thumbnails, metadata, and audio." : "Load a footage folder to unlock Review, Scene Blocks, and Delivery."}</p>
                          <span className="module-action">{projectId ? "Open App" : "Load Workspace"} <ArrowRight size={14} /></span>
                        </div>
                      </div>
                      <div
                        className="module-card premium-card module-launcher-card"
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
                        className={`module-card premium-card module-launcher-card ${!projectId ? "disabled" : ""}`}
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
                        className={`module-card premium-card module-launcher-card ${!projectId ? "disabled" : ""}`}
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
              ) : activeProductionApp === "frame-preview" ? (
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
                    <h1>CineFlow Suite</h1>
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
                      <div className="module-icon"><Briefcase size={22} strokeWidth={1.35} /></div>
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
            </Suspense>
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

          {activeMicroApp === "crop-factor" && (
            <MicroAppModal title="Crop Factor Calculator" onClose={() => setActiveMicroApp(null)} className="expanded">
              <CropFactorCalculator />
            </MicroAppModal>
          )}
          {activeMicroApp === "video-file-size" && (
            <MicroAppModal title="Video File Size Calculator" onClose={() => setActiveMicroApp(null)}>
              <VideoFileSizeCalculator />
            </MicroAppModal>
          )}
          {activeMicroApp === "aspect-ratio" && (
            <MicroAppModal title="Aspect Ratio Calculator" onClose={() => setActiveMicroApp(null)}>
              <AspectRatioCalculator />
            </MicroAppModal>
          )}
          {activeMicroApp === "transfer-time" && (
            <MicroAppModal
              title="Transfer Time Calculator"
              onClose={() => setActiveMicroApp(null)}
              headerAction={(
                <button
                  type="button"
                  className="transfer-reset"
                  onClick={() => setTransferResetNonce((value) => value + 1)}
                >
                  <RotateCcw size={14} />
                  <span>Reset</span>
                </button>
              )}
            >
              <TransferTimeCalculator resetNonce={transferResetNonce} />
            </MicroAppModal>
          )}
        </>
      )}
    </div>
  );
}

// Width/height values below come from official manufacturer specification pages.
const SENSOR_PRESETS = {
  video: [
    {
      brand: 'ARRI',
      models: [
        { label: 'ALEXA 35', sensor: 'Super 35', width: 27.99, height: 19.22 },
      ],
    },
    {
      brand: 'RED',
      models: [
        { label: 'V-RAPTOR 8K VV', sensor: 'Vista Vision', width: 40.96, height: 21.6 },
      ],
    },
    {
      brand: 'Canon',
      models: [
        { label: 'C70', sensor: 'Super 35', width: 26.2, height: 13.8 },
      ],
    },
    {
      brand: 'Blackmagic',
      models: [
        { label: 'Pocket 4K', sensor: 'Micro Four Thirds', width: 18.96, height: 10 },
        { label: 'Pocket 6K', sensor: 'Super 35', width: 23.1, height: 12.99 },
        { label: 'Cinema 6K FF', sensor: 'Full Frame', width: 36, height: 24 },
      ],
    },
  ],
  photo: [
    {
      brand: 'Nikon',
      models: [
        { label: 'Z8', sensor: 'Full Frame', width: 35.9, height: 23.9 },
      ],
    },
    {
      brand: 'Fujifilm',
      models: [
        { label: 'X-T5', sensor: 'APS-C', width: 23.5, height: 15.7 },
        { label: 'GFX100S', sensor: 'Medium Format', width: 43.8, height: 32.9 },
      ],
    },
    {
      brand: 'Panasonic',
      models: [
        { label: 'GH7', sensor: 'Micro Four Thirds', width: 17.3, height: 13.0 },
      ],
    },
  ],
} satisfies Record<"video" | "photo", Array<{ brand: string; models: Array<{ label: string; sensor: string; width: number; height: number }> }>>;

const COMMON_FOCALS = [8, 10, 12, 14, 16, 18, 24, 35, 50, 85, 135, 200];
const COMMON_APERTURES = [1.4, 2, 2.8, 4, 5.6, 8, 11];
const TELECONVERTER_OPTIONS = [
  { label: '1.4x', multiplier: 1.4 },
  { label: '1.7x', multiplier: 1.7 },
  { label: '2.0x', multiplier: 2.0 },
];
const WIDE_CONVERTER_OPTIONS = [
  { label: '0.7x', multiplier: 0.7 },
  { label: '0.75x', multiplier: 0.75 },
  { label: '0.8x', multiplier: 0.8 },
];
const FISHEYE_CONVERTER_OPTIONS = [
  { label: '0.5x', multiplier: 0.5 },
  { label: '0.6x', multiplier: 0.6 },
];
const COMMON_AUDIO_BITRATES = [128, 256, 320, 512];
const ASPECT_RATIO_PRESETS = [
  { label: "1:1", width: 1, height: 1, note: "Square" },
  { label: "4:3", width: 4, height: 3, note: "Classic video" },
  { label: "3:2", width: 3, height: 2, note: "Still photo" },
  { label: "16:9", width: 16, height: 9, note: "HD / UHD" },
  { label: "17:9", width: 17, height: 9, note: "DCI" },
  { label: "1.85:1", width: 185, height: 100, note: "Flat" },
  { label: "2.39:1", width: 239, height: 100, note: "Scope" },
  { label: "9:16", width: 9, height: 16, note: "Vertical" },
] as const;
const ASPECT_DELIVERY_PRESETS = [
  { label: "YouTube", width: 16, height: 9, note: "16:9" },
  { label: "DCI Flat", width: 185, height: 100, note: "1.85:1" },
  { label: "DCI Scope", width: 239, height: 100, note: "2.39:1" },
  { label: "Instagram Post", width: 4, height: 5, note: "4:5" },
  { label: "Instagram Story", width: 9, height: 16, note: "9:16" },
  { label: "A4 Landscape", width: 297, height: 210, note: "1.414:1" },
] as const;
const ASPECT_RESOLUTION_PRESETS = [
  { label: "1920 × 1080", width: 1920, height: 1080, note: "FHD" },
  { label: "2048 × 1080", width: 2048, height: 1080, note: "2K DCI" },
  { label: "3840 × 2160", width: 3840, height: 2160, note: "UHD" },
  { label: "4096 × 2160", width: 4096, height: 2160, note: "4K DCI" },
  { label: "4096 × 1716", width: 4096, height: 1716, note: "4K Scope" },
  { label: "1080 × 1920", width: 1080, height: 1920, note: "Vertical HD" },
] as const;
const TRANSFER_SIZE_UNITS = [
  { label: "MB", bytes: 1_000_000 },
  { label: "GB", bytes: 1_000_000_000 },
  { label: "TB", bytes: 1_000_000_000_000 },
  { label: "MiB", bytes: 1_048_576 },
  { label: "GiB", bytes: 1_073_741_824 },
  { label: "TiB", bytes: 1_099_511_627_776 },
] as const;
const TRANSFER_SPEED_UNITS = [
  { label: "MB/s", bytesPerSecond: 1_000_000 },
  { label: "GB/s", bytesPerSecond: 1_000_000_000 },
  { label: "MiB/s", bytesPerSecond: 1_048_576 },
  { label: "GiB/s", bytesPerSecond: 1_073_741_824 },
  { label: "Mbps", bytesPerSecond: 125_000 },
  { label: "Gbps", bytesPerSecond: 125_000_000 },
] as const;
const TRANSFER_SIZE_PRESETS = [
  { label: "128 GB card", value: 128, unit: "GB" },
  { label: "256 GB card", value: 256, unit: "GB" },
  { label: "512 GB card", value: 512, unit: "GB" },
  { label: "1 TB drive", value: 1, unit: "TB" },
  { label: "2 TB drive", value: 2, unit: "TB" },
] as const;
const TRANSFER_SOURCE_PRESETS = [
  { label: "SD UHS-II card", value: 250, unit: "MB/s", note: "practical sustained read" },
  { label: "CFexpress Type A card", value: 800, unit: "MB/s", note: "practical sustained read" },
  { label: "CFexpress Type B card", value: 1700, unit: "MB/s", note: "practical sustained read" },
  { label: "SATA SSD", value: 550, unit: "MB/s", note: "single drive" },
  { label: "NVMe SSD", value: 2800, unit: "MB/s", note: "fast external or internal" },
] as const;
const TRANSFER_INTERFACE_PRESETS = [
  { label: "USB 3.2 Gen 1", value: 450, unit: "MB/s", note: "5 Gbps class" },
  { label: "USB 3.2 Gen 2", value: 1000, unit: "MB/s", note: "10 Gbps class" },
  { label: "USB 3.2 Gen 2x2", value: 2000, unit: "MB/s", note: "20 Gbps class" },
  { label: "Thunderbolt 3 / 4", value: 2800, unit: "MB/s", note: "real NVMe class" },
  { label: "100 MbE", value: 95, unit: "Mbps", note: "practical Ethernet throughput" },
  { label: "1 GbE", value: 940, unit: "Mbps", note: "real network throughput" },
  { label: "2.5 GbE", value: 2.35, unit: "Gbps", note: "practical Ethernet throughput" },
  { label: "10 GbE", value: 9.4, unit: "Gbps", note: "real network throughput" },
] as const;
const TRANSFER_DESTINATION_PRESETS = [
  { label: "Portable SSD", value: 1000, unit: "MB/s", note: "10 Gbps class" },
  { label: "NVMe SSD", value: 2800, unit: "MB/s", note: "fast local storage" },
  { label: "RAID storage", value: 1800, unit: "MB/s", note: "shared fast volume" },
  { label: "NAS over 100 MbE", value: 95, unit: "Mbps", note: "practical Ethernet throughput" },
  { label: "NAS over 1 GbE", value: 940, unit: "Mbps", note: "real network throughput" },
  { label: "NAS over 2.5 GbE", value: 2.35, unit: "Gbps", note: "practical Ethernet throughput" },
  { label: "NAS over 10 GbE", value: 9.4, unit: "Gbps", note: "real network throughput" },
] as const;
const TRANSFER_NETWORK_REFERENCE = [
  { label: "10 GbE", value: 9.4, unit: "Gbps", throughput: "~1175 MB/s", interface: "10 GbE", destination: "NAS over 10 GbE" },
  { label: "2.5 GbE", value: 2.35, unit: "Gbps", throughput: "~294 MB/s", interface: "2.5 GbE", destination: "NAS over 2.5 GbE" },
  { label: "1 GbE", value: 940, unit: "Mbps", throughput: "~118 MB/s", interface: "1 GbE", destination: "NAS over 1 GbE" },
  { label: "100 MbE", value: 95, unit: "Mbps", throughput: "~12 MB/s", interface: "100 MbE", destination: "NAS over 100 MbE" },
] as const;
type VideoFileSizePreset = {
  brand: string;
  camera: string;
  codec: string;
  resolution: string;
  frameRate: string;
  videoMbps: number;
  source: string;
  profile: string;
  codecRateName?: string;
};

const parseResolution = (resolution: string) => {
  const match = resolution.match(/(\d+)\s*[x×]\s*(\d+)/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 3840, height: 2160 };
};

const parseFps = (frameRate: string) => Number.parseFloat(frameRate.replace('p', '').trim()) || 24;

const VIDEO_CODEC_DATA_RATES: Record<string, number> = {
  'ARRIRAW': 1276482476e-14,
  'ARRIRAW  HDE': 6382412381e-15,
  'Apple ProRes 422 HQ': 3550965109e-15,
  'Apple ProRes 422': 2368879907e-15,
  'Apple ProRes LT': 1648325979e-15,
  'Apple ProRes Proxy': 7.299729335e-7,
  'Apple ProRes RAW HQ': 479841821e-14,
  'Apple ProRes 4444': 5326447663e-15,
  'Apple ProRes 4444 XQ': 7992026247e-15,
  'Sony X-OCN XT': 4544670199e-15,
  'Sony X-OCN ST': 3108271846e-15,
  'Sony X-OCN LT': 1831996588e-15,
  'Sony XAVC S-I': 1205632716e-15,
  'Sony XAVC S 4K': 5.02346965e-7,
  'Sony XAVC HS 4K': 5.02346965e-7,
  'Sony XAVC S': 5.02346965e-7,
  'Sony XAVC-I': 1205632716e-15,
  'Sony XAVC-L': 5.02346965e-7,
  'Sony XAVC H-I HQ': 1243308738e-15,
  'Canon Cinema RAW Light LT': 1212816474e-15,
  'Canon XF-AVC': 3814697266e-15,
  'REDCODE HQ': 4599522748e-15,
  'REDCODE MQ': 2759713649e-15,
  'Blackmagic RAW 3:1': 4056451743e-15,
  'Blackmagic RAW 5:1': 243638278e-14,
  'Blackmagic RAW 8:1': 1519599569e-15,
  'Blackmagic RAW 12:1': 1017252604e-15,
  'Blackmagic RAW 18:1': 5.475581919e-7,
  'Blackmagic RAW Q0': 5463023245e-15,
  'Blackmagic RAW Q1': 4370418596e-15,
  'Blackmagic RAW Q3': 3127109857e-15,
  'Blackmagic RAW Q5': 1833566422e-15,
  'Nikon N-RAW': 151057281e-14,
  'H.265 10-bit': 9.544592335e-7,
  'H.265 8-bit': 7.535204475e-7,
  'H.264': 6.02816358e-7,
};

const resolveCodecVideoMbps = (codecRateName: string | undefined, resolution: string, frameRate: string) => {
  if (!codecRateName) return null;
  const dataRate = VIDEO_CODEC_DATA_RATES[codecRateName];
  if (!dataRate) return null;
  const { width, height } = parseResolution(resolution);
  const fps = parseFps(frameRate);
  return dataRate * width * height * fps;
};

const scaleMbps = (
  baseMbps: number,
  baseResolution: string,
  baseFrameRate: string,
  targetResolution: string,
  targetFrameRate: string,
) => {
  const base = parseResolution(baseResolution);
  const target = parseResolution(targetResolution);
  const baseFps = parseFps(baseFrameRate);
  const targetFps = parseFps(targetFrameRate);
  const ratio = (target.width * target.height * targetFps) / (base.width * base.height * baseFps);
  return Math.round(baseMbps * ratio);
};

const mbPerSecondToMbps = (value: number) => Math.round(value * 8);
const tbPerHourToMbps = (value: number) => Math.round((value * 8_000_000) / 3600);

const createEntries = ({
  brand,
  camera,
  codec,
  profile,
  source,
  baseResolution,
  baseFrameRate,
  baseMbps,
  resolutions,
  codecRateName,
}: {
  brand: string;
  camera: string;
  codec: string;
  profile: string;
  source: string;
  baseResolution: string;
  baseFrameRate: string;
  baseMbps: number;
  resolutions: Array<{ resolution: string; frameRates: string[] }>;
  codecRateName?: string;
}): VideoFileSizePreset[] =>
  resolutions.flatMap(({ resolution, frameRates }) =>
    frameRates.map((frameRate) => ({
      brand,
      camera,
      codec,
      resolution,
      frameRate,
      videoMbps: scaleMbps(baseMbps, baseResolution, baseFrameRate, resolution, frameRate),
      source,
      profile,
      codecRateName,
    }))
  );

const createMappedEntries = (
  entries: ReadonlyArray<readonly [string, string, number]>,
  config: Omit<VideoFileSizePreset, "resolution" | "frameRate" | "videoMbps">
): VideoFileSizePreset[] =>
  entries.map(([resolution, frameRate, videoMbps]) => ({
    ...config,
    resolution,
    frameRate,
    videoMbps,
  }));

const arriAlexa35Presets = [
  ...createEntries({
    brand: 'ARRI',
    camera: 'ALEXA 35',
    codec: 'ARRIRAW',
    profile: 'LogC4 / RAW',
    source: 'data-calc structure + ARRI 1h reference',
    codecRateName: 'ARRIRAW',
    baseResolution: '4608 × 3164',
    baseFrameRate: '24',
    baseMbps: tbPerHourToMbps(1.915),
    resolutions: [
      { resolution: '4608 × 3164', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4608 × 2592', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4096 × 2304', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75', '90', '96', '100', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'ARRI',
    camera: 'ALEXA 35',
    codec: 'ARRIRAW HDE',
    profile: 'LogC4 / RAW',
    source: 'data-calc structure + ARRI HDE',
    codecRateName: 'ARRIRAW  HDE',
    baseResolution: '4608 × 3164',
    baseFrameRate: '24',
    baseMbps: Math.round(tbPerHourToMbps(1.915) * 0.72),
    resolutions: [
      { resolution: '4608 × 3164', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4608 × 2592', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4096 × 2304', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75', '90', '96', '100', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'ARRI',
    camera: 'ALEXA 35',
    codec: 'Apple ProRes 422 HQ',
    profile: 'LogC4',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 707,
    resolutions: [
      { resolution: '4608 × 3164', frameRates: ['20', '23.976', '24', '25', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60'] },
      { resolution: '4608 × 2592', frameRates: ['20', '23.976', '24', '25', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4096 × 2304', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75', '90', '96', '100', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'ARRI',
    camera: 'ALEXA 35',
    codec: 'Apple ProRes 4444',
    profile: 'LogC4',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 4444',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 990,
    resolutions: [
      { resolution: '4608 × 3164', frameRates: ['20', '23.976', '24', '25', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60'] },
      { resolution: '4608 × 2592', frameRates: ['20', '23.976', '24', '25', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4096 × 2304', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
    ],
  }),
  ...createEntries({
    brand: 'ARRI',
    camera: 'ALEXA 35',
    codec: 'Apple ProRes 4444 XQ',
    profile: 'LogC4',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 4444 XQ',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 1150,
    resolutions: [
      { resolution: '4608 × 3164', frameRates: ['20', '23.976', '24', '25', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60'] },
      { resolution: '4608 × 2592', frameRates: ['20', '23.976', '24', '25', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
      { resolution: '4096 × 2304', frameRates: ['20', '23.976', '24', '25', '27', '29.97', '30', '35', '40', '45', '48', '50', '59.94', '60', '72', '75'] },
    ],
  }),
];

const sonyFx3Presets: VideoFileSizePreset[] = [
  ...createMappedEntries([
    ['4096 × 2160', '23.976', 240],
    ['4096 × 2160', '25', 250],
    ['4096 × 2160', '29.97', 300],
    ['4096 × 2160', '50', 500],
    ['4096 × 2160', '59.94', 600],
    ['3840 × 2160', '23.976', 240],
    ['3840 × 2160', '25', 250],
    ['3840 × 2160', '29.97', 300],
    ['3840 × 2160', '50', 500],
    ['3840 × 2160', '59.94', 600],
  ] as const, {
    brand: 'Sony',
    camera: 'FX3',
    codec: 'Sony XAVC S-I',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC S-I',
  }),
  ...createMappedEntries([
    ['3840 × 2160', '23.976', 100],
    ['3840 × 2160', '25', 100],
    ['3840 × 2160', '29.97', 100],
    ['3840 × 2160', '50', 200],
    ['3840 × 2160', '59.94', 200],
    ['3840 × 2160', '100', 280],
    ['3840 × 2160', '119.88', 280],
  ] as const, {
    brand: 'Sony',
    camera: 'FX3',
    codec: 'Sony XAVC S 4K',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC S 4K',
  }),
  ...createMappedEntries([
    ['3840 × 2160', '23.976', 50],
    ['3840 × 2160', '25', 50],
    ['3840 × 2160', '29.97', 50],
    ['3840 × 2160', '50', 100],
    ['3840 × 2160', '59.94', 100],
    ['3840 × 2160', '100', 200],
    ['3840 × 2160', '119.88', 200],
  ] as const, {
    brand: 'Sony',
    camera: 'FX3',
    codec: 'Sony XAVC HS 4K',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC HS 4K',
  }),
  ...createMappedEntries([
    ['1920 × 1080', '23.976', 222],
    ['1920 × 1080', '25', 222],
    ['1920 × 1080', '29.97', 222],
    ['1920 × 1080', '50', 222],
    ['1920 × 1080', '59.94', 222],
  ] as const, {
    brand: 'Sony',
    camera: 'FX3',
    codec: 'Sony XAVC S-I',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC S-I',
  }),
  ...createMappedEntries([
    ['1920 × 1080', '23.976', 50],
    ['1920 × 1080', '25', 50],
    ['1920 × 1080', '29.97', 50],
    ['1920 × 1080', '50', 50],
    ['1920 × 1080', '59.94', 50],
  ] as const, {
    brand: 'Sony',
    camera: 'FX3',
    codec: 'Sony XAVC S',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC S',
  }),
];

const sonyVenice2Presets = [
  ...createEntries({
    brand: 'Sony',
    camera: 'VENICE 2 8K',
    codec: 'Sony X-OCN XT',
    profile: 'S-Log3 / RAW',
    source: 'data-calc structure + Sony X-OCN scaling',
    codecRateName: 'Sony X-OCN XT',
    baseResolution: '8640 × 5760',
    baseFrameRate: '24',
    baseMbps: 3400,
    resolutions: [
      { resolution: '8640 × 5760', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '7680 × 4320', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '5760 × 4820', frameRates: ['23.976', '24', '25', '29.97', '47.95'] },
      { resolution: '5760 × 3040', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75'] },
      { resolution: '5434 × 3056', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75'] },
    ],
  }),
  ...createEntries({
    brand: 'Sony',
    camera: 'VENICE 2 8K',
    codec: 'Sony X-OCN ST',
    profile: 'S-Log3 / RAW',
    source: 'data-calc structure + Sony X-OCN scaling',
    codecRateName: 'Sony X-OCN ST',
    baseResolution: '8640 × 5760',
    baseFrameRate: '24',
    baseMbps: 2500,
    resolutions: [
      { resolution: '8640 × 5760', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94'] },
      { resolution: '7680 × 4320', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '5760 × 4820', frameRates: ['23.976', '24', '25', '29.97', '47.95'] },
      { resolution: '5760 × 3040', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75', '90'] },
      { resolution: '5434 × 3056', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75', '90'] },
    ],
  }),
  ...createEntries({
    brand: 'Sony',
    camera: 'VENICE 2 8K',
    codec: 'Sony X-OCN LT',
    profile: 'S-Log3 / RAW',
    source: 'data-calc structure + Sony X-OCN scaling',
    codecRateName: 'Sony X-OCN LT',
    baseResolution: '8640 × 5760',
    baseFrameRate: '24',
    baseMbps: 1700,
    resolutions: [
      { resolution: '8640 × 5760', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94'] },
      { resolution: '7680 × 4320', frameRates: ['23.976', '24', '25', '29.97'] },
      { resolution: '5760 × 4820', frameRates: ['23.976', '24', '25', '29.97', '47.95'] },
      { resolution: '5760 × 3040', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75', '90'] },
      { resolution: '5434 × 3056', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75', '90'] },
    ],
  }),
  ...createEntries({
    brand: 'Sony',
    camera: 'VENICE 2 8K',
    codec: 'Apple ProRes 4444',
    profile: 'S-Log3',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 4444',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 990,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94'] },
    ],
  }),
  ...createEntries({
    brand: 'Sony',
    camera: 'VENICE 2 8K',
    codec: 'Apple ProRes 422 HQ',
    profile: 'S-Log3',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 707,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75', '90'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '47.95', '50', '59.94', '75', '90'] },
    ],
  }),
];

const sonyFx6Presets = [
  ...createMappedEntries([
    ['4096 × 2160', '23.976', 240],
    ['4096 × 2160', '25', 250],
    ['4096 × 2160', '29.97', 300],
    ['3840 × 2160', '23.976', 240],
    ['3840 × 2160', '25', 250],
    ['3840 × 2160', '29.97', 300],
    ['3840 × 2160', '50', 600],
    ['3840 × 2160', '59.94', 600],
  ] as const, {
    brand: 'Sony',
    camera: 'FX6',
    codec: 'Sony XAVC-I',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC-I',
  }),
  ...createMappedEntries([
    ['3840 × 2160', '23.976', 100],
    ['3840 × 2160', '25', 100],
    ['3840 × 2160', '29.97', 100],
    ['3840 × 2160', '50', 150],
    ['3840 × 2160', '59.94', 150],
    ['1920 × 1080', '23.976', 50],
    ['1920 × 1080', '25', 50],
    ['1920 × 1080', '29.97', 50],
    ['1920 × 1080', '50', 100],
    ['1920 × 1080', '59.94', 100],
    ['1920 × 1080', '100', 100],
    ['1920 × 1080', '119.88', 100],
  ] as const, {
    brand: 'Sony',
    camera: 'FX6',
    codec: 'Sony XAVC-L',
    source: 'data-calc structure + Sony Help Guide',
    profile: 'S-Log3',
    codecRateName: 'Sony XAVC-L',
  }),
];

const sonyBuranoPresets = [
  ...createEntries({
    brand: 'Sony',
    camera: 'BURANO',
    codec: 'Sony X-OCN LT',
    profile: 'S-Log3 / RAW',
    source: 'data-calc structure + Sony BURANO codec scaling',
    codecRateName: 'Sony X-OCN LT',
    baseResolution: '8640 × 5760',
    baseFrameRate: '24',
    baseMbps: 2100,
    resolutions: [
      { resolution: '8640 × 5760', frameRates: ['23.976', '24', '25', '29.97', '30'] },
      { resolution: '6912 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'Sony',
    camera: 'BURANO',
    codec: 'Sony XAVC H-I',
    profile: 'S-Log3',
    source: 'data-calc structure + Sony codec family scaling',
    codecRateName: 'Sony XAVC H-I HQ',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 600,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88'] },
    ],
  }),
];

const canonC70Presets: VideoFileSizePreset[] = [
  ...createEntries({
    brand: 'Canon',
    camera: 'C70',
    codec: 'Canon XF-AVC',
    profile: 'Canon Log 2 / 3',
    source: 'Canon EOS C70 official mode support + data-calc Canon XF-AVC rate',
    codecRateName: 'Canon XF-AVC',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 240,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94'] },
      { resolution: '1920 × 1080', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88'] },
    ],
  }),
];

const canonC80Presets: VideoFileSizePreset[] = [
  ...createEntries({
    brand: 'Canon',
    camera: 'C80',
    codec: 'Canon XF-AVC',
    profile: 'Canon Log 2 / 3',
    source: 'Canon EOS C80 official mode support + data-calc Canon XF-AVC rate',
    codecRateName: 'Canon XF-AVC',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 240,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88'] },
      { resolution: '2048 × 1080', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88', '150', '180'] },
      { resolution: '1920 × 1080', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88', '150', '180'] },
    ],
  }),
  ...createMappedEntries([
    ['4096 × 2160', '23.98', 135],
    ['4096 × 2160', '24', 135],
    ['4096 × 2160', '25', 135],
    ['4096 × 2160', '29.97', 135],
    ['4096 × 2160', '50', 225],
    ['4096 × 2160', '59.94', 225],
    ['3840 × 2160', '23.98', 135],
    ['3840 × 2160', '24', 135],
    ['3840 × 2160', '25', 135],
    ['3840 × 2160', '29.97', 135],
    ['3840 × 2160', '50', 225],
    ['3840 × 2160', '59.94', 225],
    ['2048 × 1080', '23.98', 50],
    ['2048 × 1080', '24', 50],
    ['2048 × 1080', '25', 50],
    ['2048 × 1080', '29.97', 50],
    ['2048 × 1080', '50', 50],
    ['2048 × 1080', '59.94', 50],
    ['1920 × 1080', '23.98', 50],
    ['1920 × 1080', '24', 50],
    ['1920 × 1080', '25', 50],
    ['1920 × 1080', '29.97', 50],
    ['1920 × 1080', '50', 50],
    ['1920 × 1080', '59.94', 50],
  ] as const, {
    brand: 'Canon',
    camera: 'C80',
    codec: 'XF-HEVC S 4:2:2 10-bit',
    profile: 'Canon Log 2 / 3',
    source: 'Canon EOS C80 official technical specifications',
  }),
  ...createMappedEntries([
    ['4096 × 2160', '23.98', 100],
    ['4096 × 2160', '24', 100],
    ['4096 × 2160', '25', 100],
    ['4096 × 2160', '29.97', 100],
    ['4096 × 2160', '50', 150],
    ['4096 × 2160', '59.94', 150],
    ['3840 × 2160', '23.98', 100],
    ['3840 × 2160', '24', 100],
    ['3840 × 2160', '25', 100],
    ['3840 × 2160', '29.97', 100],
    ['3840 × 2160', '50', 150],
    ['3840 × 2160', '59.94', 150],
    ['2048 × 1080', '23.98', 35],
    ['2048 × 1080', '24', 35],
    ['2048 × 1080', '25', 35],
    ['2048 × 1080', '29.97', 35],
    ['2048 × 1080', '50', 35],
    ['2048 × 1080', '59.94', 35],
    ['1920 × 1080', '23.98', 35],
    ['1920 × 1080', '24', 35],
    ['1920 × 1080', '25', 35],
    ['1920 × 1080', '29.97', 35],
    ['1920 × 1080', '50', 35],
    ['1920 × 1080', '59.94', 35],
  ] as const, {
    brand: 'Canon',
    camera: 'C80',
    codec: 'XF-HEVC S 4:2:0 10-bit',
    profile: 'Canon Log 2 / 3',
    source: 'Canon EOS C80 official technical specifications',
  }),
  ...createMappedEntries([
    ['4096 × 2160', '23.98', 150],
    ['4096 × 2160', '24', 150],
    ['4096 × 2160', '25', 150],
    ['4096 × 2160', '29.97', 150],
    ['4096 × 2160', '50', 250],
    ['4096 × 2160', '59.94', 250],
    ['3840 × 2160', '23.98', 150],
    ['3840 × 2160', '24', 150],
    ['3840 × 2160', '25', 150],
    ['3840 × 2160', '29.97', 150],
    ['3840 × 2160', '50', 250],
    ['3840 × 2160', '59.94', 250],
    ['2048 × 1080', '23.98', 50],
    ['2048 × 1080', '24', 50],
    ['2048 × 1080', '25', 50],
    ['2048 × 1080', '29.97', 50],
    ['2048 × 1080', '50', 50],
    ['2048 × 1080', '59.94', 50],
    ['1920 × 1080', '23.98', 50],
    ['1920 × 1080', '24', 50],
    ['1920 × 1080', '25', 50],
    ['1920 × 1080', '29.97', 50],
    ['1920 × 1080', '50', 50],
    ['1920 × 1080', '59.94', 50],
  ] as const, {
    brand: 'Canon',
    camera: 'C80',
    codec: 'XF-AVC S 4:2:2 10-bit',
    profile: 'Canon Log 2 / 3',
    source: 'Canon EOS C80 official technical specifications',
  }),
  ...createMappedEntries([
    ['4096 × 2160', '23.98', 100],
    ['4096 × 2160', '24', 100],
    ['4096 × 2160', '25', 100],
    ['4096 × 2160', '29.97', 100],
    ['4096 × 2160', '50', 150],
    ['4096 × 2160', '59.94', 150],
    ['3840 × 2160', '23.98', 100],
    ['3840 × 2160', '24', 100],
    ['3840 × 2160', '25', 100],
    ['3840 × 2160', '29.97', 100],
    ['3840 × 2160', '50', 150],
    ['3840 × 2160', '59.94', 150],
    ['2048 × 1080', '23.98', 35],
    ['2048 × 1080', '24', 35],
    ['2048 × 1080', '25', 35],
    ['2048 × 1080', '29.97', 35],
    ['2048 × 1080', '50', 35],
    ['2048 × 1080', '59.94', 35],
    ['1920 × 1080', '23.98', 35],
    ['1920 × 1080', '24', 35],
    ['1920 × 1080', '25', 35],
    ['1920 × 1080', '29.97', 35],
    ['1920 × 1080', '50', 35],
    ['1920 × 1080', '59.94', 35],
  ] as const, {
    brand: 'Canon',
    camera: 'C80',
    codec: 'XF-AVC S 4:2:0 8-bit',
    profile: 'Canon 709 / Wide DR',
    source: 'Canon EOS C80 official technical specifications',
  }),
];

const canonC400Presets: VideoFileSizePreset[] = [
  ...createEntries({
    brand: 'Canon',
    camera: 'C400',
    codec: 'Cinema RAW Light LT',
    profile: 'Canon Log 2 / 3 / RAW',
    source: 'data-calc reference + Canon RAW Light scaling',
    codecRateName: 'Canon Cinema RAW Light LT',
    baseResolution: '6000 × 3164',
    baseFrameRate: '24',
    baseMbps: 960,
    resolutions: [
      { resolution: '6000 × 3164', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94'] },
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'Canon',
    camera: 'C400',
    codec: 'Canon XF-AVC',
    profile: 'Canon Log 2 / 3',
    source: 'Canon EOS C400 official mode support + data-calc Canon XF-AVC rate',
    codecRateName: 'Canon XF-AVC',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 240,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94'] },
      { resolution: '1920 × 1080', frameRates: ['23.98', '24', '25', '29.97', '50', '59.94', '100', '119.88'] },
    ],
  }),
];

const redVRaptorPresets = [
  ...createEntries({
    brand: 'RED',
    camera: 'V-RAPTOR 8K VV',
    codec: 'REDCODE HQ',
    profile: 'Log3G10 / RWG',
    source: 'data-calc structure + REDCODE scaling',
    codecRateName: 'REDCODE HQ',
    baseResolution: '8192 × 4320',
    baseFrameRate: '24',
    baseMbps: 950,
    resolutions: [
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '7680 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '96', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'RED',
    camera: 'V-RAPTOR 8K VV',
    codec: 'REDCODE MQ',
    profile: 'Log3G10 / RWG',
    source: 'data-calc structure + REDCODE scaling',
    codecRateName: 'REDCODE MQ',
    baseResolution: '8192 × 4320',
    baseFrameRate: '24',
    baseMbps: 700,
    resolutions: [
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '7680 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '96', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'RED',
    camera: 'V-RAPTOR 8K VV',
    codec: 'Apple ProRes 422 HQ',
    profile: 'Log3G10 / RWG',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 707,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
    ],
  }),
];

const redKomodoXPresets = [
  ...createEntries({
    brand: 'RED',
    camera: 'KOMODO-X',
    codec: 'REDCODE HQ',
    profile: 'Log3G10 / RWG',
    source: 'data-calc reference + REDCODE scaling',
    codecRateName: 'REDCODE HQ',
    baseResolution: '6144 × 3240',
    baseFrameRate: '24',
    baseMbps: 450,
    resolutions: [
      { resolution: '6144 × 3240', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '96', '100', '119.88'] },
      { resolution: '2048 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '96', '100', '119.88', '240'] },
    ],
  }),
];

const blackmagicP6KProPresets = [
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW 3:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 3:1',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(323),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW 5:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 5:1',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(194),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW 8:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 8:1',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(121),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW 12:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 12:1',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(81),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Apple ProRes 422',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 471,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Apple ProRes LT',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes LT',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 328,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Apple ProRes Proxy',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes Proxy',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 145,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW Q0',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q0',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(280),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3728 × 3104', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '2868 × 1512', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW Q1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q1',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(220),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3728 × 3104', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '2868 × 1512', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW Q3',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q3',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(150),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3728 × 3104', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '2868 × 1512', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 6K Pro',
    codec: 'Blackmagic RAW Q5',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q5',
    baseResolution: '6144 × 3456',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(105),
    resolutions: [
      { resolution: '6144 × 3456', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94'] },
      { resolution: '6144 × 2560', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '5744 × 3024', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3728 × 3104', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '2868 × 1512', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
];

const blackmagicP4KPresets = [
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW 3:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 3:1',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(129),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW 5:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 5:1',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(77),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW 8:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 8:1',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(48),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW 12:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 12:1',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(32),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW Q0',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q0',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(112),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW Q1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q1',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(90),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW Q3',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q3',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(64),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Blackmagic RAW Q5',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic Q constant quality',
    codecRateName: 'Blackmagic RAW Q5',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(43),
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Apple ProRes 422',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 471,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Apple ProRes LT',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes LT',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 328,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Apple ProRes Proxy',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes Proxy',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 145,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Pocket 4K',
    codec: 'Apple ProRes 422 HQ',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 707,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
];

const blackmagicCinema6KFFPresets = [
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Blackmagic RAW 3:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 3:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(387),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Blackmagic RAW 5:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 5:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(232),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Blackmagic RAW 8:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 8:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(145),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Blackmagic RAW 12:1',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 12:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(97),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Apple ProRes 422',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 471,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Apple ProRes LT',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes LT',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 328,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Apple ProRes Proxy',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes Proxy',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 145,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '100', '119.88'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'Cinema 6K FF',
    codec: 'Apple ProRes 422 HQ',
    profile: 'Film / Extended Video',
    source: 'data-calc reference + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 707,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'] },
      { resolution: '1920 × 1080', frameRates: ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '100', '119.88'] },
    ],
  }),
];

const blackmagicUrsaMiniPro12KPresets = [
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'URSA Mini Pro 12K',
    codec: 'Blackmagic RAW 5:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 5:1',
    baseResolution: '12288 × 6480',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(1546),
    resolutions: [
      { resolution: '12288 × 6480', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '120'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '220', '240'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'URSA Mini Pro 12K',
    codec: 'Blackmagic RAW 8:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 8:1',
    baseResolution: '12288 × 6480',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(966),
    resolutions: [
      { resolution: '12288 × 6480', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '120'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '220', '240'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'URSA Mini Pro 12K',
    codec: 'Blackmagic RAW 12:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 12:1',
    baseResolution: '12288 × 6480',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(644),
    resolutions: [
      { resolution: '12288 × 6480', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '8192 × 4320', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '120'] },
      { resolution: '4096 × 2160', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60', '220', '240'] },
    ],
  }),
];

const blackmagicPyxis6KPresets = [
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'PYXIS 6K',
    codec: 'Blackmagic RAW 3:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 3:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(387),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '4832 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 3408', frameRates: ['23.976', '24', '25', '29.97', '30', '46'] },
      { resolution: '6048 × 3200', frameRates: ['23.976', '24', '25', '29.97', '30', '48'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '4096 × 3072', frameRates: ['23.976', '24', '25', '29.97', '30', '50'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'PYXIS 6K',
    codec: 'Blackmagic RAW 5:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 5:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(232),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '4832 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 3408', frameRates: ['23.976', '24', '25', '29.97', '30', '46'] },
      { resolution: '6048 × 3200', frameRates: ['23.976', '24', '25', '29.97', '30', '48'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '4096 × 3072', frameRates: ['23.976', '24', '25', '29.97', '30', '50'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'PYXIS 6K',
    codec: 'Blackmagic RAW 8:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 8:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(145),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '4832 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 3408', frameRates: ['23.976', '24', '25', '29.97', '30', '46'] },
      { resolution: '6048 × 3200', frameRates: ['23.976', '24', '25', '29.97', '30', '48'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '4096 × 3072', frameRates: ['23.976', '24', '25', '29.97', '30', '50'] },
    ],
  }),
  ...createEntries({
    brand: 'Blackmagic',
    camera: 'PYXIS 6K',
    codec: 'Blackmagic RAW 12:1',
    profile: 'Film / Extended Video',
    source: 'data-calc structure + Blackmagic data rate reference',
    codecRateName: 'Blackmagic RAW 12:1',
    baseResolution: '6048 × 4032',
    baseFrameRate: '24',
    baseMbps: mbPerSecondToMbps(97),
    resolutions: [
      { resolution: '6048 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '4832 × 4032', frameRates: ['23.976', '24', '25', '29.97', '30', '36'] },
      { resolution: '6048 × 3408', frameRates: ['23.976', '24', '25', '29.97', '30', '46'] },
      { resolution: '6048 × 3200', frameRates: ['23.976', '24', '25', '29.97', '30', '48'] },
      { resolution: '6048 × 2520', frameRates: ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '4096 × 3072', frameRates: ['23.976', '24', '25', '29.97', '30', '50'] },
    ],
  }),
];

const nikonZ8Presets = [
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z8',
    codec: 'Nikon N-RAW',
    profile: 'RAW',
    source: 'data-calc structure + Nikon manual',
    codecRateName: 'Nikon N-RAW',
    baseResolution: '8256 × 4644',
    baseFrameRate: '24',
    baseMbps: 2780,
    resolutions: [
      { resolution: '8256 × 4644', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '4128 × 2322', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z8',
    codec: 'Apple ProRes 422 HQ',
    profile: 'N-Log',
    source: 'data-calc structure + Apple ProRes target rate',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 707,
    resolutions: [
      { resolution: '5376 × 3024', frameRates: ['24', '25', '30'] },
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z8',
    codec: 'H.265 10-bit',
    profile: 'N-Log',
    source: 'data-calc structure + Nikon codec family estimate',
    codecRateName: 'H.265 10-bit',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 100,
    resolutions: [
      { resolution: '5376 × 3024', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120', '200', '240'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z8',
    codec: 'H.265 8-bit',
    profile: 'Standard',
    source: 'data-calc structure + Nikon codec family estimate',
    codecRateName: 'H.265 8-bit',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 70,
    resolutions: [
      { resolution: '5376 × 3024', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '3840 × 2160 DX', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z8',
    codec: 'H.264',
    profile: 'Standard',
    source: 'data-calc structure + Nikon codec family estimate',
    codecRateName: 'H.264',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 50,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
    ],
  }),
];

const nikonZ6IIIPresets = [
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z6III',
    codec: 'Nikon N-RAW',
    profile: 'RAW',
    source: 'Nikon Z6III official specifications',
    codecRateName: 'Nikon N-RAW',
    baseResolution: '6048 × 3402',
    baseFrameRate: '24',
    baseMbps: 1870,
    resolutions: [
      { resolution: '6048 × 3402', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '4032 × 2268', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '3984 × 2240', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z6III',
    codec: 'Apple ProRes 422 HQ',
    profile: 'N-Log',
    source: 'Nikon Z6III official specifications',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '5376 × 3024',
    baseFrameRate: '24',
    baseMbps: 1380,
    resolutions: [
      { resolution: '5376 × 3024', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120', '200', '240'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z6III',
    codec: 'H.265 10-bit',
    profile: 'N-Log',
    source: 'Nikon Z6III official specifications',
    codecRateName: 'H.265 10-bit',
    baseResolution: '5376 × 3024',
    baseFrameRate: '24',
    baseMbps: 125,
    resolutions: [
      { resolution: '5376 × 3024', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60', '100', '120'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120', '200', '240'] },
    ],
  }),
  ...createEntries({
    brand: 'Nikon',
    camera: 'Z6III',
    codec: 'H.264',
    profile: 'Standard',
    source: 'Nikon Z6III official specifications',
    codecRateName: 'H.264',
    baseResolution: '3840 × 2160',
    baseFrameRate: '24',
    baseMbps: 65,
    resolutions: [
      { resolution: '3840 × 2160', frameRates: ['24', '25', '30', '50', '60'] },
      { resolution: '1920 × 1080', frameRates: ['24', '25', '30', '50', '60', '100', '120', '200', '240'] },
    ],
  }),
];

const fujifilmXH2SPresets = [
  ...createEntries({
    brand: 'Fujifilm',
    camera: 'X-H2S',
    codec: 'Apple ProRes 422 HQ',
    profile: 'F-Log2 / F-Log',
    source: 'Fujifilm X-H2S official specifications',
    codecRateName: 'Apple ProRes 422 HQ',
    baseResolution: '6240 × 4160',
    baseFrameRate: '24',
    baseMbps: 2200,
    resolutions: [
      { resolution: '6240 × 4160', frameRates: ['23.98', '24', '25', '29.97', '30'] },
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Fujifilm',
    camera: 'X-H2S',
    codec: 'Apple ProRes 422',
    profile: 'F-Log2 / F-Log',
    source: 'Fujifilm X-H2S official specifications',
    codecRateName: 'Apple ProRes 422',
    baseResolution: '6240 × 4160',
    baseFrameRate: '24',
    baseMbps: 1460,
    resolutions: [
      { resolution: '6240 × 4160', frameRates: ['23.98', '24', '25', '29.97', '30'] },
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Fujifilm',
    camera: 'X-H2S',
    codec: 'Apple ProRes LT',
    profile: 'F-Log2 / F-Log',
    source: 'Fujifilm X-H2S official specifications',
    codecRateName: 'Apple ProRes LT',
    baseResolution: '6240 × 4160',
    baseFrameRate: '24',
    baseMbps: 1020,
    resolutions: [
      { resolution: '6240 × 4160', frameRates: ['23.98', '24', '25', '29.97', '30'] },
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    ],
  }),
  ...createEntries({
    brand: 'Fujifilm',
    camera: 'X-H2S',
    codec: 'H.265 10-bit',
    profile: 'F-Log2 / F-Log',
    source: 'Fujifilm X-H2S official specifications',
    codecRateName: 'H.265 10-bit',
    baseResolution: '6240 × 4160',
    baseFrameRate: '24',
    baseMbps: 360,
    resolutions: [
      { resolution: '6240 × 4160', frameRates: ['23.98', '24', '25', '29.97', '30'] },
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
      { resolution: '2048 × 1080', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120', '200', '239.76', '240'] },
      { resolution: '1920 × 1080', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120', '200', '239.76', '240'] },
    ],
  }),
  ...createEntries({
    brand: 'Fujifilm',
    camera: 'X-H2S',
    codec: 'H.264',
    profile: 'Standard',
    source: 'Fujifilm X-H2S official specifications',
    codecRateName: 'H.264',
    baseResolution: '4096 × 2160',
    baseFrameRate: '24',
    baseMbps: 200,
    resolutions: [
      { resolution: '4096 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
      { resolution: '3840 × 2160', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120'] },
      { resolution: '2048 × 1080', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120', '200', '239.76', '240'] },
      { resolution: '1920 × 1080', frameRates: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60', '100', '119.88', '120', '200', '239.76', '240'] },
    ],
  }),
];

const VIDEO_FILE_SIZE_PRESETS: VideoFileSizePreset[] = [
  ...arriAlexa35Presets,
  ...sonyFx3Presets,
  ...sonyFx6Presets,
  ...sonyVenice2Presets,
  ...sonyBuranoPresets,
  ...canonC70Presets,
  ...canonC80Presets,
  ...canonC400Presets,
  ...redVRaptorPresets,
  ...redKomodoXPresets,
  ...blackmagicP4KPresets,
  ...blackmagicP6KProPresets,
  ...blackmagicCinema6KFFPresets,
  ...blackmagicUrsaMiniPro12KPresets,
  ...blackmagicPyxis6KPresets,
  ...nikonZ8Presets,
  ...nikonZ6IIIPresets,
  ...fujifilmXH2SPresets,
];

function MicroAppModal({
  title,
  children,
  onClose,
  headerAction,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  headerAction?: ReactNode;
  className?: string;
}) {
  return (
    <div className="microapp-backdrop" onClick={onClose}>
      <div className={`microapp-modal ${className}`} onClick={(event) => event.stopPropagation()}>
        <div className="microapp-modal-header">
          <div className="microapp-modal-heading">
            <span className="microapp-modal-eyebrow">Utilities</span>
            <h2>{title}</h2>
          </div>
          <div className="microapp-modal-actions">
            {headerAction}
            <button type="button" className="microapp-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function CropFactorCalculator() {
  const [sensorMode, setSensorMode] = useState<"video" | "photo">("video");
  const [sensorSize, setSensorSize] = useState(String(SENSOR_PRESETS.video[0].models[0].width));
  const [focalLength, setFocalLength] = useState("50");
  const [aperture, setAperture] = useState("2.8");
  const [adapterType, setAdapterType] = useState<"none" | "tele" | "wide" | "fisheye">("none");
  const [teleMultiplier, setTeleMultiplier] = useState(1.4);
  const [wideMultiplier, setWideMultiplier] = useState(0.7);
  const [fisheyeMultiplier, setFisheyeMultiplier] = useState(0.6);

  const activeSensorPresets = SENSOR_PRESETS[sensorMode];

  const sensor = Math.max(0, Number(sensorSize) || 0);
  const focal = Math.max(0, Number(focalLength) || 0);
  const fStop = Math.max(0, Number(aperture) || 0);

  let effectiveFocal = focal;
  let effectiveAperture = fStop;

  if (adapterType === "tele") {
    effectiveFocal *= teleMultiplier;
    effectiveAperture *= teleMultiplier;
  } else if (adapterType === "wide") {
    effectiveFocal *= wideMultiplier;
  } else if (adapterType === "fisheye") {
    effectiveFocal *= fisheyeMultiplier;
  }

  const cropFactor = sensor > 0 ? 36 / sensor : 0;
  const equivalentFocalLength = (effectiveFocal > 0 && cropFactor > 0) ? effectiveFocal * cropFactor : 0;
  const equivalentAperture = (effectiveAperture > 0 && cropFactor > 0) ? effectiveAperture * cropFactor : 0;

  return (
    <div className="crop-factor-app">
      <div className="crop-factor-mode-toggle" role="tablist" aria-label="Sensor preset type">
        <button
          type="button"
          className={`crop-factor-mode-pill ${sensorMode === "video" ? "active" : ""}`}
          onClick={() => {
            setSensorMode("video");
            setSensorSize(String(SENSOR_PRESETS.video[0].models[0].width));
          }}
        >
          Video
        </button>
        <button
          type="button"
          className={`crop-factor-mode-pill ${sensorMode === "photo" ? "active" : ""}`}
          onClick={() => {
            setSensorMode("photo");
            setSensorSize(String(SENSOR_PRESETS.photo[0].models[0].width));
          }}
        >
          Photo
        </button>
      </div>

      <div className="crop-factor-inputs">
        <div className="crop-factor-field">
          <label className="crop-factor-label">
            <Ruler size={14} />
            <span>Sensor Size mm</span>
          </label>
          <input
            type="number"
            min="1"
            step="0.01"
            value={sensorSize}
            onChange={(event) => setSensorSize(event.target.value)}
            className="crop-factor-input"
            placeholder="23.5"
          />
          <div className="crop-factor-sensor-groups">
            {activeSensorPresets.map((group) => (
              <div key={group.brand} className="crop-factor-sensor-group">
                <div className="crop-factor-group-label">{group.brand}</div>
                <div className="crop-factor-chip-row">
                  {group.models.map((preset) => (
                    <button
                      key={`${group.brand}-${preset.label}`}
                      type="button"
                      className={`crop-factor-chip ${Number(sensorSize) === preset.width ? "active" : ""}`}
                      onClick={() => setSensorSize(String(preset.width))}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.sensor}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="crop-factor-field">
          <label className="crop-factor-label">
            <Camera size={14} />
            <span>Focal Length (mm)</span>
          </label>
          <input
            type="number"
            min="1"
            step="0.1"
            value={focalLength}
            onChange={(event) => setFocalLength(event.target.value)}
            className="crop-factor-input"
            placeholder="50"
          />
          <div className="crop-factor-inline-note">Common</div>
          <div className="crop-factor-chip-row compact">
            {COMMON_FOCALS.map((value) => (
              <button
                key={value}
                type="button"
                className={`crop-factor-chip ${Number(focalLength) === value ? "active" : ""}`}
                onClick={() => setFocalLength(String(value))}
              >
                {value}mm
              </button>
            ))}
          </div>
        </div>

        <div className="crop-factor-field">
          <label className="crop-factor-label">
            <CircleDot size={14} />
            <span>Aperture (f/)</span>
          </label>
          <input
            type="number"
            min="0.7"
            step="0.1"
            value={aperture}
            onChange={(event) => setAperture(event.target.value)}
            className="crop-factor-input"
            placeholder="2.8"
          />
          <div className="crop-factor-inline-note">Common</div>
          <div className="crop-factor-chip-row compact">
            {COMMON_APERTURES.map((value) => (
              <button
                key={value}
                type="button"
                className={`crop-factor-chip ${Number(aperture) === value ? "active" : ""}`}
                onClick={() => setAperture(String(value))}
              >
                f/{value}
              </button>
            ))}
          </div>
        </div>

        <div className="crop-factor-adapters-column">
          <div className="crop-factor-field">
            <div className="crop-factor-field-header">
              <label className="crop-factor-label">
                <Maximize size={14} />
                <span>Teleconverter</span>
              </label>
              <div
                className={`crop-factor-toggle ${adapterType === "tele" ? "active" : ""}`}
                onClick={() => setAdapterType(adapterType === "tele" ? "none" : "tele")}
                role="switch"
                aria-checked={adapterType === "tele"}
              >
                <div className="crop-factor-toggle-handle" />
              </div>
            </div>
            
            <div className={`crop-factor-tc-options ${adapterType !== "tele" ? "disabled" : ""}`}>
              <div className="crop-factor-inline-note">Types</div>
              <div className="crop-factor-chip-row compact">
                {TELECONVERTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.multiplier}
                    type="button"
                    className={`crop-factor-chip ${teleMultiplier === opt.multiplier ? "active" : ""}`}
                    disabled={adapterType !== "tele"}
                    onClick={() => setTeleMultiplier(opt.multiplier)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="crop-factor-field">
            <div className="crop-factor-field-header">
              <label className="crop-factor-label">
                <Minimize size={14} />
                <span>Wide Converter</span>
              </label>
              <div
                className={`crop-factor-toggle ${adapterType === "wide" ? "active" : ""}`}
                onClick={() => setAdapterType(adapterType === "wide" ? "none" : "wide")}
                role="switch"
                aria-checked={adapterType === "wide"}
              >
                <div className="crop-factor-toggle-handle" />
              </div>
            </div>
            
            <div className={`crop-factor-tc-options ${adapterType !== "wide" ? "disabled" : ""}`}>
              <div className="crop-factor-inline-note">Multipliers</div>
              <div className="crop-factor-chip-row compact">
                {WIDE_CONVERTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.multiplier}
                    type="button"
                    className={`crop-factor-chip ${wideMultiplier === opt.multiplier ? "active" : ""}`}
                    disabled={adapterType !== "wide"}
                    onClick={() => setWideMultiplier(opt.multiplier)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="crop-factor-field">
            <div className="crop-factor-field-header">
              <label className="crop-factor-label">
                <Eye size={14} />
                <span>Fisheye Converter</span>
              </label>
              <div
                className={`crop-factor-toggle ${adapterType === "fisheye" ? "active" : ""}`}
                onClick={() => setAdapterType(adapterType === "fisheye" ? "none" : "fisheye")}
                role="switch"
                aria-checked={adapterType === "fisheye"}
              >
                <div className="crop-factor-toggle-handle" />
              </div>
            </div>
            
            <div className={`crop-factor-tc-options ${adapterType !== "fisheye" ? "disabled" : ""}`}>
              <div className="crop-factor-inline-note">Distortion</div>
              <div className="crop-factor-chip-row compact">
                {FISHEYE_CONVERTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.multiplier}
                    type="button"
                    className={`crop-factor-chip ${fisheyeMultiplier === opt.multiplier ? "active" : ""}`}
                    disabled={adapterType !== "fisheye"}
                    onClick={() => setFisheyeMultiplier(opt.multiplier)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="crop-factor-results">
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Crop Factor</span>
          <strong>{Number.isFinite(cropFactor) && cropFactor > 0 ? `${cropFactor.toFixed(2)}x` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Equivalent Focal Length</span>
          <strong>{Number.isFinite(equivalentFocalLength) && equivalentFocalLength > 0 ? `${Math.round(equivalentFocalLength)} mm` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Equivalent Aperture</span>
          <strong>{Number.isFinite(equivalentAperture) && equivalentAperture > 0 ? `f/${equivalentAperture.toFixed(1)}` : "—"}</strong>
        </div>
      </div>
    </div>
  );
}

function VideoFileSizeCalculator() {
  const [brand, setBrand] = useState<string>(VIDEO_FILE_SIZE_PRESETS[0].brand);
  const [camera, setCamera] = useState<string>(VIDEO_FILE_SIZE_PRESETS[0].camera);
  const [codec, setCodec] = useState<string>(VIDEO_FILE_SIZE_PRESETS[0].codec);
  const [resolution, setResolution] = useState<string>(VIDEO_FILE_SIZE_PRESETS[0].resolution);
  const [frameRate, setFrameRate] = useState<string>(VIDEO_FILE_SIZE_PRESETS[0].frameRate);
  const [audioBitrate, setAudioBitrate] = useState("256");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("10");
  const [seconds, setSeconds] = useState("0");

  const brandOptions: string[] = Array.from(new Set(VIDEO_FILE_SIZE_PRESETS.map((preset) => preset.brand)));
  const cameraOptions: string[] = Array.from(new Set(VIDEO_FILE_SIZE_PRESETS.filter((preset) => preset.brand === brand).map((preset) => preset.camera)));
  const codecOptions: string[] = Array.from(new Set(VIDEO_FILE_SIZE_PRESETS.filter((preset) => preset.brand === brand && preset.camera === camera).map((preset) => preset.codec)));
  const resolutionOptions: string[] = Array.from(new Set(VIDEO_FILE_SIZE_PRESETS.filter((preset) => preset.brand === brand && preset.camera === camera && preset.codec === codec).map((preset) => preset.resolution)));
  const frameRateOptions: string[] = Array.from(new Set(VIDEO_FILE_SIZE_PRESETS.filter((preset) => preset.brand === brand && preset.camera === camera && preset.codec === codec && preset.resolution === resolution).map((preset) => preset.frameRate)));

  useEffect(() => {
    if (!cameraOptions.includes(camera)) {
      setCamera(cameraOptions[0] ?? "");
    }
  }, [camera, cameraOptions]);

  useEffect(() => {
    if (!codecOptions.includes(codec)) {
      setCodec(codecOptions[0] ?? "");
    }
  }, [codec, codecOptions]);

  useEffect(() => {
    if (!resolutionOptions.includes(resolution)) {
      setResolution(resolutionOptions[0] ?? "");
    }
  }, [resolution, resolutionOptions]);

  useEffect(() => {
    if (!frameRateOptions.includes(frameRate)) {
      setFrameRate(frameRateOptions[0] ?? "");
    }
  }, [frameRate, frameRateOptions]);

  const selectedPreset = VIDEO_FILE_SIZE_PRESETS.find((preset) =>
    preset.brand === brand &&
    preset.camera === camera &&
    preset.codec === codec &&
    preset.resolution === resolution &&
    preset.frameRate === frameRate
  ) ?? VIDEO_FILE_SIZE_PRESETS[0];

  const videoMbps = resolveCodecVideoMbps(selectedPreset.codecRateName, selectedPreset.resolution, selectedPreset.frameRate) ?? selectedPreset.videoMbps;
  const audioKbps = Math.max(0, Number(audioBitrate) || 0);
  
  const h = Math.max(0, Number(hours) || 0);
  const m = Math.max(0, Math.min(59, Number(minutes) || 0));
  const s = Math.max(0, Math.min(59, Number(seconds) || 0));
  
  const durationSeconds = h * 3600 + m * 60 + s;
  const totalMbps = Math.max(0, videoMbps + audioKbps / 1000);
  const totalMegabits = totalMbps * durationSeconds;
  const totalMegabytes = totalMegabits / 8;
  const totalGigabytes = totalMegabytes / 1024;
  const totalTerabytes = totalGigabytes / 1024;

  return (
    <div className="micro-tool-app">
      <div className="micro-tool-inputs">
        <div className="micro-tool-field">
          <label className="crop-factor-label"><span>Brand</span></label>
          <select value={brand} onChange={(event) => setBrand(event.target.value)} className="crop-factor-input micro-tool-select">
            {brandOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label"><Camera size={14} /><span>Camera</span></label>
          <select value={camera} onChange={(event) => setCamera(event.target.value)} className="crop-factor-input micro-tool-select">
            {cameraOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label"><HardDrive size={14} /><span>Codec</span></label>
          <select value={codec} onChange={(event) => setCodec(event.target.value)} className="crop-factor-input micro-tool-select">
            {codecOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label"><span>Resolution</span></label>
          <select value={resolution} onChange={(event) => setResolution(event.target.value)} className="crop-factor-input micro-tool-select">
            {resolutionOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label"><span>Frame Rate</span></label>
          <select value={frameRate} onChange={(event) => setFrameRate(event.target.value)} className="crop-factor-input micro-tool-select">
            {frameRateOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <div className="micro-tool-source-note">Preset bitrate from {selectedPreset.source}</div>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label"><span>Profile</span></label>
          <div className="micro-tool-readout">{selectedPreset.profile}</div>
          <div className="micro-tool-source-note">Profile reference only, does not change file size.</div>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <HardDrive size={14} />
            <span>Video Bitrate</span>
          </label>
          <div className="micro-tool-readout">{videoMbps.toFixed(0)} Mbps</div>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <AudioLines size={14} />
            <span>Audio Bitrate (kbps)</span>
          </label>
          <select
            value={audioBitrate}
            onChange={(event) => setAudioBitrate(event.target.value)}
            className="crop-factor-input micro-tool-select"
          >
            {COMMON_AUDIO_BITRATES.map((value) => (
              <option key={value} value={value}>
                {value} kbps
              </option>
            ))}
          </select>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <Clock3 size={14} />
            <span>Duration</span>
          </label>
          <div className="duration-input-row">
            <input
              type="number"
              min="0"
              step="1"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className="crop-factor-input"
              placeholder="0"
            />
            <input
              type="number"
              min="0"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="crop-factor-input"
              placeholder="10"
            />
            <input
              type="number"
              min="0"
              step="1"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              className="crop-factor-input"
              placeholder="0"
            />
          </div>
          <div className="duration-input-labels">
            <span>Hours</span>
            <span>Minutes</span>
            <span>Seconds</span>
          </div>
        </div>
      </div>

      <div className="micro-tool-results">
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Total Bitrate</span>
          <strong>{totalMbps ? `${totalMbps.toFixed(3)} Mbps` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Estimated Size</span>
          <strong>
            {totalGigabytes >= 1 && Number.isFinite(totalGigabytes)
              ? `${totalGigabytes.toFixed(2)} GB`
              : totalMegabytes > 0 && Number.isFinite(totalMegabytes)
                ? `${totalMegabytes.toFixed(0)} MB`
                : "—"}
          </strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Large Media</span>
          <strong>{totalTerabytes >= 1 && Number.isFinite(totalTerabytes) ? `${totalTerabytes.toFixed(2)} TB` : "Below 1 TB"}</strong>
        </div>
      </div>
    </div>
  );
}

function AspectRatioCalculator() {
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [targetPresetLabel, setTargetPresetLabel] = useState<string>(ASPECT_DELIVERY_PRESETS[0].label);

  const widthValue = Math.max(0, Number(width) || 0);
  const heightValue = Math.max(0, Number(height) || 0);

  const roundedWidth = Math.max(1, Math.round(widthValue || 1));
  const roundedHeight = Math.max(1, Math.round(heightValue || 1));

  const gcd = (a: number, b: number): number => {
    let x = Math.max(1, Math.abs(Math.round(a)));
    let y = Math.max(0, Math.abs(Math.round(b)));
    while (y !== 0) {
      const next = x % y;
      x = y;
      y = next;
    }
    return x || 1;
  };

  const divisor = gcd(roundedWidth, roundedHeight);
  const ratioWidth = roundedWidth / divisor;
  const ratioHeight = roundedHeight / divisor;
  const decimalRatio = heightValue > 0 ? widthValue / heightValue : 0;
  const heightAt1920 = (decimalRatio > 0 && Number.isFinite(1920 / decimalRatio)) ? 1920 / decimalRatio : 0;
  const widthAt1080 = (decimalRatio > 0 && Number.isFinite(1080 * decimalRatio)) ? 1080 * decimalRatio : 0;
  const targetPreset = ASPECT_DELIVERY_PRESETS.find((preset) => preset.label === targetPresetLabel) ?? ASPECT_DELIVERY_PRESETS[0];
  const targetRatio = targetPreset.width / Math.max(0.01, targetPreset.height);
  const fitHeightForTarget = (widthValue > 0 && targetRatio > 0) ? widthValue / targetRatio : 0;
  const fitWidthForTarget = (heightValue > 0 && targetRatio > 0) ? heightValue * targetRatio : 0;
  const cropsSides = (decimalRatio > targetRatio && decimalRatio > 0) ? (1 - targetRatio / decimalRatio) * 100 : 0;
  const cropsTopBottom = (decimalRatio < targetRatio && targetRatio > 0) ? (1 - decimalRatio / targetRatio) * 100 : 0;

  const nearestPreset = (decimalRatio > 0 && Number.isFinite(decimalRatio))
    ? ASPECT_RATIO_PRESETS.reduce<(typeof ASPECT_RATIO_PRESETS)[number] | null>((closest, preset) => {
        const presetRatio = preset.width / Math.max(0.01, preset.height);
        if (!closest) return preset;
        const closestRatio = closest.width / Math.max(0.01, closest.height);
        return Math.abs(presetRatio - decimalRatio) < Math.abs(closestRatio - decimalRatio) ? preset : closest;
      }, null)
    : null;

  return (
    <div className="micro-tool-app">
      <div className="micro-tool-inputs">
        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <Ruler size={14} />
            <span>Width</span>
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
            className="crop-factor-input"
            placeholder="1920"
          />
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <Ruler size={14} />
            <span>Height</span>
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            className="crop-factor-input"
            placeholder="1080"
          />
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <Scaling size={14} />
            <span>Common Ratios</span>
          </label>
          <div className="crop-factor-chip-row">
            {ASPECT_RATIO_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`crop-factor-chip ${ratioWidth === preset.width && ratioHeight === preset.height ? "active" : ""}`}
                onClick={() => {
                  setWidth(String(preset.width));
                  setHeight(String(preset.height));
                }}
              >
                <span>{preset.label}</span>
                <small>{preset.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="micro-tool-field" style={{ gridColumn: "1 / -1" }}>
          <label className="crop-factor-label">
            <LayoutGrid size={14} />
            <span>Common Frames</span>
          </label>
          <div className="crop-factor-chip-row">
            {ASPECT_RESOLUTION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`crop-factor-chip ${roundedWidth === preset.width && roundedHeight === preset.height ? "active" : ""}`}
                onClick={() => {
                  setWidth(String(preset.width));
                  setHeight(String(preset.height));
                }}
              >
                <span>{preset.label}</span>
                <small>{preset.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="micro-tool-field" style={{ gridColumn: "1 / -1" }}>
          <label className="crop-factor-label">
            <Film size={14} />
            <span>Delivery Presets</span>
          </label>
          <div className="crop-factor-chip-row">
            {ASPECT_DELIVERY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`crop-factor-chip ${targetPreset.label === preset.label ? "active" : ""}`}
                onClick={() => setTargetPresetLabel(preset.label)}
              >
                <span>{preset.label}</span>
                <small>{preset.note}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="micro-tool-results">
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Simplified Ratio</span>
          <strong>{widthValue > 0 && heightValue > 0 ? `${ratioWidth}:${ratioHeight}` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Decimal Ratio</span>
          <strong>{(decimalRatio > 0 && Number.isFinite(decimalRatio)) ? `${decimalRatio.toFixed(3)}:1` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Closest Standard</span>
          <strong>{nearestPreset ? nearestPreset.label : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Height at 1920 Width</span>
          <strong>{(heightAt1920 > 0 && Number.isFinite(heightAt1920)) ? `${Math.round(heightAt1920)} px` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Width at 1080 Height</span>
          <strong>{(widthAt1080 > 0 && Number.isFinite(widthAt1080)) ? `${Math.round(widthAt1080)} px` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Current Frame</span>
          <strong>{widthValue > 0 && heightValue > 0 ? `${roundedWidth} × ${roundedHeight}` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">{targetPreset.label} Fit Height</span>
          <strong>{(fitHeightForTarget > 0 && Number.isFinite(fitHeightForTarget)) ? `${Math.round(fitHeightForTarget)} px` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">{targetPreset.label} Fit Width</span>
          <strong>{(fitWidthForTarget > 0 && Number.isFinite(fitWidthForTarget)) ? `${Math.round(fitWidthForTarget)} px` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card">
          <span className="crop-factor-result-label">Crop Needed</span>
          <strong>
            {cropsSides > 0.01
              ? `${cropsSides.toFixed(1)}% sides`
              : cropsTopBottom > 0.01
                ? `${cropsTopBottom.toFixed(1)}% top / bottom`
                : "No crop"}
          </strong>
        </div>
      </div>
    </div>
  );
}

function TransferTimeCalculator({ resetNonce = 0 }: { resetNonce?: number }) {
  const [sizeValue, setSizeValue] = useState("256");
  const [sizeUnit, setSizeUnit] = useState<string>("GB");
  const [sourceLabel, setSourceLabel] = useState<string>(TRANSFER_SOURCE_PRESETS[2].label);
  const [interfaceLabel, setInterfaceLabel] = useState<string>(TRANSFER_INTERFACE_PRESETS[1].label);
  const [destinationLabel, setDestinationLabel] = useState<string>(TRANSFER_DESTINATION_PRESETS[0].label);
  const [efficiency, setEfficiency] = useState("100");

  const sizeUnitConfig = TRANSFER_SIZE_UNITS.find((unit) => unit.label === sizeUnit) ?? TRANSFER_SIZE_UNITS[1];
  const sourcePreset = TRANSFER_SOURCE_PRESETS.find((preset) => preset.label === sourceLabel) ?? TRANSFER_SOURCE_PRESETS[0];
  const interfacePreset = TRANSFER_INTERFACE_PRESETS.find((preset) => preset.label === interfaceLabel) ?? TRANSFER_INTERFACE_PRESETS[0];
  const destinationPreset = TRANSFER_DESTINATION_PRESETS.find((preset) => preset.label === destinationLabel) ?? TRANSFER_DESTINATION_PRESETS[0];
  const sourceUnitConfig = TRANSFER_SPEED_UNITS.find((unit) => unit.label === sourcePreset.unit) ?? TRANSFER_SPEED_UNITS[0];
  const interfaceUnitConfig = TRANSFER_SPEED_UNITS.find((unit) => unit.label === interfacePreset.unit) ?? TRANSFER_SPEED_UNITS[0];
  const destinationUnitConfig = TRANSFER_SPEED_UNITS.find((unit) => unit.label === destinationPreset.unit) ?? TRANSFER_SPEED_UNITS[0];

  const sizeVal = Math.max(0, Number(sizeValue) || 0);
  const totalBytes = sizeVal * sizeUnitConfig.bytes;
  const sourceBytesPerSecond = Math.max(0, sourcePreset.value * sourceUnitConfig.bytesPerSecond);
  const interfaceBytesPerSecond = Math.max(0, interfacePreset.value * interfaceUnitConfig.bytesPerSecond);
  const destinationBytesPerSecond = Math.max(0, destinationPreset.value * destinationUnitConfig.bytesPerSecond);
  const bottleneckBytesPerSecond = Math.min(
    sourceBytesPerSecond || Infinity,
    interfaceBytesPerSecond || Infinity,
    destinationBytesPerSecond || Infinity
  );
  
  const hasBottleneck = new Set([sourceBytesPerSecond, interfaceBytesPerSecond, destinationBytesPerSecond]).size > 1;
  const efficiencyVal = Math.max(0, Math.min(100, Number(efficiency) || 0));
  const effectiveBytesPerSecond = bottleneckBytesPerSecond !== Infinity ? bottleneckBytesPerSecond * efficiencyVal / 100 : 0;
  
  const transferSeconds = (effectiveBytesPerSecond > 0 && Number.isFinite(effectiveBytesPerSecond)) ? totalBytes / effectiveBytesPerSecond : 0;
  const totalMinutes = transferSeconds / 60;
  const totalHours = transferSeconds / 3600;
  const effectiveMBps = effectiveBytesPerSecond / 1_000_000;
  const effectiveGbps = effectiveBytesPerSecond * 8 / 1_000_000_000;
  
  const bottleneckStage = (bottleneckBytesPerSecond === sourceBytesPerSecond && sourceBytesPerSecond < 1e12)
    ? "source"
    : (bottleneckBytesPerSecond === interfaceBytesPerSecond && interfaceBytesPerSecond < 1e12)
      ? "interface"
      : (bottleneckBytesPerSecond === destinationBytesPerSecond && destinationBytesPerSecond < 1e12)
        ? "destination"
        : null;

  const computeTransferSeconds = (bytesPerSecond: number) => {
    const adjusted = bytesPerSecond * efficiencyVal / 100;
    return (adjusted > 0 && Number.isFinite(adjusted)) ? totalBytes / adjusted : 0;
  };

  const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "—";
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    if (minutes || hours || days) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(" ");
  };

  const formatDurationCompact = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "—";
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  useEffect(() => {
    setSizeValue("256");
    setSizeUnit("GB");
    setSourceLabel(TRANSFER_SOURCE_PRESETS[2].label);
    setInterfaceLabel(TRANSFER_INTERFACE_PRESETS[1].label);
    setDestinationLabel(TRANSFER_DESTINATION_PRESETS[0].label);
    setEfficiency("100");
  }, [resetNonce]);

  return (
    <div className="micro-tool-app">
      <div className="micro-tool-results transfer-top-stats">
        <div className="crop-factor-result-card transfer-stat-card transfer-time-card">
          <div className="transfer-summary-head">
            <span className="crop-factor-result-label">Transfer Time</span>
          </div>
          <strong>{formatDuration(transferSeconds)}</strong>
        </div>
        <div className="crop-factor-result-card transfer-stat-card">
          <span className="crop-factor-result-label">Effective Speed</span>
          <strong>{(effectiveMBps > 0 && Number.isFinite(effectiveMBps)) ? `${effectiveMBps.toFixed(0)} MB/s` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card transfer-stat-card">
          <span className="crop-factor-result-label">Effective Link Rate</span>
          <strong>{(effectiveGbps > 0 && Number.isFinite(effectiveGbps)) ? `${effectiveGbps.toFixed(2)} Gbps` : "—"}</strong>
        </div>
        <div className="crop-factor-result-card transfer-stat-card">
          <span className="crop-factor-result-label">Duration</span>
          <strong>
            {(totalMinutes > 0 && Number.isFinite(totalMinutes))
              ? `${totalMinutes.toFixed(1)} min · ${totalHours.toFixed(2)} h`
              : "—"}
          </strong>
        </div>
        <div className="crop-factor-result-card transfer-stat-card">
          <span className="crop-factor-result-label">Calculation Basis</span>
          <strong>{sizeValue ? `${sizeValue} ${sizeUnit}` : "—"}</strong>
        </div>
      </div>

      <div className="micro-tool-inputs">
        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <HardDrive size={14} />
            <span>Data Size</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={sizeValue}
            onChange={(event) => setSizeValue(event.target.value)}
            className="crop-factor-input"
            placeholder="256"
          />
          <select
            value={sizeUnit}
            onChange={(event) => setSizeUnit(event.target.value)}
            className="crop-factor-input micro-tool-select"
          >
            {TRANSFER_SIZE_UNITS.map((unit) => (
              <option key={unit.label} value={unit.label}>{unit.label}</option>
            ))}
          </select>
          <div className="crop-factor-chip-row">
            {TRANSFER_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="crop-factor-chip"
                onClick={() => {
                  setSizeValue(String(preset.value));
                  setSizeUnit(preset.unit);
                }}
              >
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <CircleDot size={14} />
            <span>Efficiency</span>
          </label>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={efficiency}
            onChange={(event) => setEfficiency(event.target.value)}
            className="crop-factor-input"
            placeholder="100"
          />
          <div className="micro-tool-source-note">
            Use 100% for measured sustained speed. Lower it if your real copy pipeline runs below the rated interface speed.
          </div>
          <div className="crop-factor-chip-row compact">
            {[100, 95, 90, 85, 80].map((value) => (
              <button
                key={value}
                type="button"
                className={`crop-factor-chip ${Number(efficiency) === value ? "active" : ""}`}
                onClick={() => setEfficiency(String(value))}
              >
                {value}%
              </button>
            ))}
          </div>
        </div>

        <div className="micro-tool-field">
          <label className="crop-factor-label">
            <FolderOpen size={14} />
            <span>Ethernet Reference</span>
          </label>
          <div className="transfer-network-reference">
            {TRANSFER_NETWORK_REFERENCE.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className={`transfer-network-row ${interfaceLabel === entry.interface && destinationLabel === entry.destination ? "active" : ""}`}
                onClick={() => {
                  setInterfaceLabel(entry.interface);
                  setDestinationLabel(entry.destination);
                }}
              >
                <strong>{entry.label}</strong>
                <span>{entry.throughput}</span>
                <small>{formatDurationCompact(computeTransferSeconds(entry.value * (TRANSFER_SPEED_UNITS.find((unit) => unit.label === entry.unit)?.bytesPerSecond ?? 0)))}</small>
              </button>
            ))}
          </div>
          <div className="micro-tool-source-note">
            Practical sustained Ethernet backup speeds. Click a row to apply it to the flow.
          </div>
        </div>

        <div className="micro-tool-field" style={{ gridColumn: "1 / -1" }}>
          <div className="transfer-flow">
            <div className="transfer-stage">
              <div className="transfer-stage-head">
                <HardDrive size={15} />
                <span>Source media</span>
                {hasBottleneck && bottleneckStage === "source" && <span className="transfer-inline-badge">Bottleneck</span>}
              </div>
              <select
                value={sourceLabel}
                onChange={(event) => setSourceLabel(event.target.value)}
                className="crop-factor-input micro-tool-select"
              >
                {TRANSFER_SOURCE_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>{preset.label}</option>
                ))}
              </select>
              <div className="transfer-stage-meta">
                <span>{sourcePreset.note}</span>
              </div>
            </div>

            <div className="transfer-stage-arrow">
              <ArrowRight size={16} />
            </div>

            <div className="transfer-stage">
              <div className="transfer-stage-head">
                <Boxes size={15} />
                <span>Interface</span>
                {hasBottleneck && bottleneckStage === "interface" && <span className="transfer-inline-badge">Bottleneck</span>}
              </div>
              <select
                value={interfaceLabel}
                onChange={(event) => setInterfaceLabel(event.target.value)}
                className="crop-factor-input micro-tool-select"
              >
                {TRANSFER_INTERFACE_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>{preset.label}</option>
                ))}
              </select>
              <div className="transfer-stage-meta">
                <span>{interfacePreset.note}</span>
              </div>
            </div>

            <div className="transfer-stage-arrow">
              <ArrowRight size={16} />
            </div>

            <div className="transfer-stage">
              <div className="transfer-stage-head">
                <FolderOpen size={15} />
                <span>Destination</span>
                {hasBottleneck && bottleneckStage === "destination" && <span className="transfer-inline-badge">Bottleneck</span>}
              </div>
              <select
                value={destinationLabel}
                onChange={(event) => setDestinationLabel(event.target.value)}
                className="crop-factor-input micro-tool-select"
              >
                {TRANSFER_DESTINATION_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>{preset.label}</option>
                ))}
              </select>
              <div className="transfer-stage-meta">
                <span>{destinationPreset.note}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
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
