import { Component, ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Camera,
  Compass,
  FolderOpen,
  Info,
  ShieldCheck,
  ArrowRight,
  Boxes,
  BriefcaseBusiness,
  MessageCircleWarning,
  MoreHorizontal,
  FileDown,
  LayoutGrid,
  FolderTree,
  ArrowLeft,
  AlertTriangle,
  Film,
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
import { TourGuide, TourStep } from "./components/TourGuide";
import { exportPdf, exportImage } from "./utils/ExportUtils";
import appLogo from "./assets/Icon_square_rounded.svg";
import { AppInfo, Clip, ClipWithThumbnails, JobInfo, ScanResult, ThumbnailProgress, RecentProject } from "./types";
import {
  LookbookSortMode,
  MOVEMENT_CANONICAL,
  SHOT_SIZE_CANONICAL,
  SHOT_SIZE_OPTIONAL,
  sortLookbookClips,
} from "./lookbook";

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
        <div style={{ padding: 40, textAlign: 'center', background: '#0f172a', color: 'white', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 16 }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', maxWidth: 400, marginBottom: 24 }}>{this.state.error?.message || "An unexpected error occurred in the application UI."}</p>
          <button style={{ padding: '10px 20px', background: 'var(--color-accent)', border: 'none', borderRadius: 8, color: '#000', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Reload App</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const TOUR_VERSION = "1.0.0-beta.1";
  const TOUR_SEEN_KEY = "wp_has_seen_tour";
  const TOUR_VERSION_KEY = "wp_tour_version";
  const DEV_BOOT_RESET_KEY = "wrap_preview:dev_boot_reset_done";
  const IS_DEV = import.meta.env.DEV;

  const [activeTab, setActiveTab] = useState<"home" | "preproduction" | "shot-planner" | "media-workspace" | "contact" | "blocks" | "safe-copy" | "all">(() => {
    if (IS_DEV) return "home";
    const saved = localStorage.getItem('wp_activeTab');
    return (saved as any) || 'home';
  });
  const [activePreproductionApp, setActivePreproductionApp] = useState<string | null>(() => {
    if (IS_DEV) return null;
    return localStorage.getItem('wp_activePreApp') || null;
  });
  const [activeMediaWorkspaceApp, setActiveMediaWorkspaceApp] = useState<string | null>(() => {
    if (IS_DEV) return null;
    return localStorage.getItem('wp_activeMediaApp') || null;
  });
  const [shareRouteToken, setShareRouteToken] = useState<string | null>(() => {
    const match = window.location.hash.match(/^#\/r\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  });

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

  // --- Phase-Isolated State ---
  type Phase = 'pre' | 'post';
  interface PhaseData {
    projectId: string | null;
    projectName: string;
    clips: ClipWithThumbnails[];
    selectedClipIds: Set<string>;
    scanning: boolean;
    extracting: boolean;
    extractProgress: { done: number; total: number };
    thumbnailCache: Record<string, string>;
  }

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
    setProjectStates((prev) => ({
      ...prev,
      [phase]: typeof updates === 'function' ? updates(prev[phase]) : { ...prev[phase], ...updates },
    }));
  }, []);

  // convenience getters and setters for current phase
  const { projectId, projectName, clips, selectedClipIds, scanning, extracting, extractProgress, thumbnailCache } = projectStates[currentPhase];

  const setClips = (val: ClipWithThumbnails[] | ((prev: ClipWithThumbnails[]) => ClipWithThumbnails[])) => {
    setPhaseState(currentPhase, (prev) => ({
      ...prev,
      clips: typeof val === 'function' ? val(prev.clips) : val,
    }));
  };
  const setSelectedClipIds = (val: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setPhaseState(currentPhase, (prev) => ({
      ...prev,
      selectedClipIds: typeof val === 'function' ? val(prev.selectedClipIds) : val,
    }));
  };

  const [showPrint, setShowPrint] = useState(false);
  const [preparingExport, setPreparingExport] = useState<{ kind: "pdf" | "image"; message: string } | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [viewFilter, setViewFilter] = useState<"all" | "picks" | "rated_min">("all");
  const [viewMinRating, setViewMinRating] = useState<number>(3);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [lastVerificationJobId, setLastVerificationJobId] = useState<string | null>(null);
  const [uiError, setUiError] = useState<{ title: string; hint: string } | null>(null);
  const [tourRun, setTourRun] = useState(false);
  const [brandProfile, setBrandProfile] = useState<any>(null);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [openExportAfterScan, setOpenExportAfterScan] = useState(false);
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
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [playingProgress, setPlayingProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // State persistence removed per user request for "blank canvas" starting experience

  useEffect(() => {
    if (projectId) {
      const loadBrand = async () => {
        try {
          const p = await invoke<any>("get_project", { projectId: projectId });
          if (p && p.root_path) {
            const profile = await invoke<any>("load_brand_profile", { projectPath: p.root_path });
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
  }, [projectId]);

  useEffect(() => {
    const seen = localStorage.getItem(TOUR_SEEN_KEY) === "true";
    const version = localStorage.getItem(TOUR_VERSION_KEY);
    if (!seen || version !== TOUR_VERSION) {
      setTourRun(true);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await invoke<JobInfo[]>("list_jobs");
      setJobs(data);
    } catch (err) {
      console.error("Failed loading jobs", err);
    }
  }, []);

  useEffect(() => {
    refreshJobs();
    const t = setInterval(refreshJobs, 1000);
    return () => clearInterval(t);
  }, [refreshJobs]);

  // Job System Synchronization
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let refreshTimeout: any = null;

    const throttledRefresh = () => {
      if (refreshTimeout) return;
      refreshTimeout = setTimeout(() => {
        refreshJobs();
        refreshTimeout = null;
      }, 1000); // Max once per second
    };

    listen<JobInfo>("job-progress", () => throttledRefresh())
      .then((u) => { unlisten = u; })
      .catch(console.error);

    return () => {
      if (unlisten) unlisten();
      if (refreshTimeout) clearTimeout(refreshTimeout);
    };
  }, [refreshJobs]);

  useEffect(() => {
    invoke<AppInfo>("get_app_info").then(setAppInfo).catch(console.error);

    // Project restoration on mount disabled for "blank canvas" start
  }, []);

  // State for delayed actions
  const [postScanTab, setPostScanTab] = useState<"preproduction" | "shot-planner" | "media-workspace" | "clip-review" | "scene-blocks" | "contact" | "blocks" | "all" | null>(null);

  const [projectLut, setProjectLut] = useState<{ path: string; name: string; hash: string } | null>(null);
  const [lutRenderNonce, setLutRenderNonce] = useState(0);
  // Active project refs removed in favor of phase-aware listeners

  const fetchProjectSettings = useCallback(async (pid: string) => {
    try {
      const settingsJson = await invoke<string>("get_project_settings", { projectId: pid });
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
  }, []);

  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);

  const toggleClipSelection = useCallback((id: string) => {
    setSelectedClipIds((prev) => {
      const clip = clips.find((c) => c.clip.id === id)?.clip;
      if (!clip || clip.flag === "reject") return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [clips]);

  const handleUpdateMetadata = useCallback(async (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes' | 'shot_size' | 'movement' | 'manual_order' | 'lut_enabled' | 'thumb_range_seconds'>>) => {
    // Optimistic UI update
    setClips((prevClips) =>
      prevClips.map(clipItem => {
        if (clipItem.clip.id === clipId) {
          return {
            ...clipItem,
            clip: { ...clipItem.clip, ...updates }
          };
        }
        return clipItem;
      })
    );
    if (updates.flag === "reject") {
      setSelectedClipIds((prev) => {
        if (!prev.has(clipId)) return prev;
        const next = new Set(prev);
        next.delete(clipId);
        return next;
      });
    }

    try {
      await invoke("update_clip_metadata", {
        clipId,
        rating: updates.rating ?? null,
        flag: updates.flag ?? null,
        notes: updates.notes ?? null,
        shotSize: updates.shot_size ?? null,
        movement: updates.movement ?? null,
        manualOrder: updates.manual_order ?? null,
        thumbRangeSeconds: updates.thumb_range_seconds ?? null,
        lutEnabled: updates.lut_enabled ?? null,
      });
      if (updates.lut_enabled === 1 && projectId && projectLut) {
        await invoke("generate_lut_thumbnails", { projectId });
        setLutRenderNonce((n) => n + 1);
      }
      if (updates.lut_enabled === 0) {
        setLutRenderNonce((n) => n + 1);
      }
    } catch (err) {
      console.error("Failed to persist metadata:", err);
      setUiError({ title: "Could not save rating/flag", hint: "Retry. If this persists, export diagnostics from header actions." });
    }
  }, [projectId, projectLut]);

  const handlePlayClip = useCallback(async (id: string | null) => {
    if (!id || (playingClipId === id)) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
        audioRef.current = null;
      }
      setPlayingClipId(null);
      setPlayingProgress(0);
      return;
    }

    const clip = clips.find(c => c.clip.id === id)?.clip;
    if (!clip) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }

    try {
      const src = await invoke<string>("read_audio_preview", { path: clip.file_path });
      const audio = new Audio();
      audio.onended = () => {
        setPlayingClipId(null);
        setPlayingProgress(0);
      };
      audio.ontimeupdate = () => {
        if (audio.duration) {
          setPlayingProgress((audio.currentTime / audio.duration) * 100);
        }
      };
      audio.onerror = (e) => {
        console.error("Audio playback error", e);
        setPlayingClipId(null);
        setPlayingProgress(0);
      };
      audio.src = src;
      audio.load();
      audioRef.current = audio;
      setPlayingClipId(id);
      await audio.play();
    } catch (err) {
      console.error("Failed to play audio:", err);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
        audioRef.current = null;
      }
      setPlayingClipId(null);
      setPlayingProgress(0);
    }
  }, [playingClipId, clips]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (tourRun) return;
      const inReview =
        (activeTab === "preproduction" && activePreproductionApp === "shot-planner") ||
        (activeTab === "media-workspace" && activeMediaWorkspaceApp === "clip-review");
      if (!inReview) return;

      // Don't fire shortcuts if the user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.closest("[data-tour-tooltip]")) return;

      const targetId = hoveredClipId;
      const key = e.key.toLowerCase();
      const isCtrl = e.ctrlKey || e.metaKey;

      // Global Select All / Deselect All
      if (isCtrl && key === 's') {
        e.preventDefault();
        toggleSelectAll();
        return;
      }

      // Arrow navigation
      if ((key === "arrowdown" || key === "arrowright" || key === "arrowup" || key === "arrowleft") && clips.length > 0) {
        e.preventDefault();
        const visibleClipsList = sortLookbookClips(clips.filter(({ clip }) => {
          const viewMatch = viewFilter === "picks" ? clip.flag === "pick" : viewFilter === "rated_min" ? clip.rating >= viewMinRating : true;
          const shotSizeMatch = shotSizeFilter === "all" ? true : clip.shot_size === shotSizeFilter;
          return viewMatch && shotSizeMatch;
        }), lookbookSortMode);

        const currentIndex = targetId ? visibleClipsList.findIndex((c) => c.clip.id === targetId) : -1;
        const nextIndex = key === "arrowdown" || key === "arrowright"
          ? Math.min(currentIndex + 1, visibleClipsList.length - 1)
          : Math.max(currentIndex - 1, 0);

        if (visibleClipsList[nextIndex]) {
          setHoveredClipId(visibleClipsList[nextIndex].clip.id);
        }
        return;
      }

      // PDF Export
      if (key === "p" && !isCtrl) {
        e.preventDefault();
        handleExport();
        return;
      }

      // Image Export
      if (key === "i" && !isCtrl) {
        e.preventDefault();
        handleExportImage();
        return;
      }

      if (!targetId) return;

      // Manual Order (Ctrl + 1-9)
      if (isCtrl && key >= '0' && key <= '9') {
        e.preventDefault();
        let order = parseInt(key);
        if (order === 0) order = 10;
        handleUpdateMetadata(targetId, { manual_order: order });
        return;
      }

      // Rating shortcuts (1-5)
      if (!isCtrl && key >= '0' && key <= '5') {
        if (key === '0') {
          handleUpdateMetadata(targetId, { rating: 0 });
          return;
        }
        handleUpdateMetadata(targetId, { rating: Number(key) });
        return;
      }

      // Ordering shortcuts (Ctrl + 1-9)
      if (isCtrl && key >= '1' && key <= '9') {
        e.preventDefault();
        handleUpdateMetadata(targetId, { manual_order: Number(key) });
      }

      // Export shortcuts
      if (!isCtrl && key === 'p') {
        e.preventDefault();
        handleExport();
      }
      if (!isCtrl && key === 'i') {
        e.preventDefault();
        handleExportImage();
      }

      // Flag shortcuts
      if (key === 'r') handleUpdateMetadata(targetId, { flag: 'reject' });
      if (key === 'k') handleUpdateMetadata(targetId, { flag: 'pick' });
      if (key === 'n') handleUpdateMetadata(targetId, { flag: 'none' });
      if (key === 'u' || key === ' ') {
        e.preventDefault();
        handleUpdateMetadata(targetId, { flag: 'none' });
      }
      if (key === 's' && !isCtrl) {
        toggleClipSelection(targetId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredClipId, clips, handleUpdateMetadata, tourRun, toggleClipSelection, activeTab, activePreproductionApp, activeMediaWorkspaceApp]);


  useEffect(() => {
    if (projectId && postScanTab) {
      if (postScanTab === "preproduction" || postScanTab === "shot-planner") {
        setActiveTab("preproduction");
        setActivePreproductionApp("shot-planner");
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
      const activePhase = targetPhase || (projectStates.pre.projectId === nextProjectId ? 'pre' : 'post');
      const clipRows = await invoke<ClipWithThumbnails[]>("get_clips", { projectId: nextProjectId });

      setPhaseState(activePhase, { clips: clipRows });

      // Hydrate for specific phase
      const thumbEntries = clipRows.flatMap((item) =>
        item.thumbnails.map((thumb) => ({
          key: `${thumb.clip_id}_${thumb.index}`,
          path: thumb.file_path
        }))
      );
      if (thumbEntries.length > 0) {
        const nextCache = { ...(projectStates[activePhase].thumbnailCache || {}) };
        for (const { key, path } of thumbEntries) {
          try {
            nextCache[key] = convertFileSrc(path);
          } catch (e) {
            console.warn(`convertFileSrc failed for ${path}, attempting base64 rehydration`, e);
            try {
              const base64 = await invoke<string>("read_thumbnail", { path });
              nextCache[key] = base64;
            } catch (err) {
              console.error(`Full thumbnail rehydration failure for ${path}`, err);
            }
          }
        }
        setPhaseState(activePhase, { thumbnailCache: nextCache });
      }

      await fetchProjectSettings(nextProjectId);
    } catch (error) {
      console.error("Failed to refresh clips:", error);
      setUiError({ title: "Could not load clip previews", hint: "Retry scan. If this persists, export diagnostics." });
    }
  }, [projectStates, setPhaseState, fetchProjectSettings]);


  // Persistent Thumbnail Listeners
  useEffect(() => {
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;

    async function setupListeners() {
      unlistenProgress = await listen<ThumbnailProgress>("thumbnail-progress", (event) => {
        const { project_id, clip_id, clip_index, total_clips, thumbnails } = event.payload;

        // Find which phase this project belongs to
        const targetPhase: Phase | null =
          projectStates.pre.projectId === project_id ? 'pre' :
            projectStates.post.projectId === project_id ? 'post' : null;

        if (!targetPhase) return;

        setPhaseState(targetPhase, (prev) => {
          const nextProgress = { done: clip_index + 1, total: total_clips };
          const nextClips = prev.clips.map((c) =>
            c.clip.id === clip_id ? { ...c, thumbnails: thumbnails } : c
          );

          const newEntries: Record<string, string> = { ...prev.thumbnailCache };
          thumbnails.forEach(thumb => {
            try {
              newEntries[`${thumb.clip_id}_${thumb.index}`] = convertFileSrc(thumb.file_path);
            } catch (e) {
              console.warn("Failed to convert thumbnail path:", e);
            }
          });

          return {
            ...prev,
            extractProgress: nextProgress,
            clips: nextClips,
            thumbnailCache: newEntries
          };
        });
      });

      unlistenComplete = await listen("thumbnail-complete", async (event) => {
        const payload = event.payload as { project_id: string };
        const project_id = payload.project_id;

        const targetPhase: Phase | null =
          projectStates.pre.projectId === project_id ? 'pre' :
            projectStates.post.projectId === project_id ? 'post' : null;

        if (targetPhase) {
          setPhaseState(targetPhase, { extracting: false });
          await refreshProjectClips(project_id, targetPhase);
        }
      });
    }

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, [refreshProjectClips]); // Only depends on refreshProjectClips which is stable-ish

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

  const handleSelectFolder = useCallback(async (targetTab?: "preproduction" | "shot-planner" | "media-workspace" | "clip-review" | "scene-blocks" | "contact" | "blocks" | "all") => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Footage Folder",
    });

    if (!selected) return;

    const targetPhase: Phase = (targetTab === "preproduction" || targetTab === "shot-planner") ? "pre" : "post";

    setPhaseState(targetPhase, { scanning: true, projectId: null, clips: [] });
    if (targetTab) setPostScanTab(targetTab);

    try {
      const result = await invoke<ScanResult>("scan_folder", {
        folderPath: selected,
        phase: targetPhase,
      });

      setPhaseState(targetPhase, {
        projectId: result.project_id,
        projectName: result.project_name,
        clips: result.clips.map((clip) => ({ clip, thumbnails: [] })),
        extracting: true,
        extractProgress: { done: 0, total: result.clip_count }
      });

      addRecentProject(result.project_id, result.project_name, selected as string, targetPhase);

      invoke("extract_thumbnails", { projectId: result.project_id }).catch(
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
  }, [addRecentProject, refreshProjectClips, setPhaseState]);

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



  const getExportClips = useCallback((): Clip[] => {
    return clips
      .filter((c) => selectedClipIds.has(c.clip.id))
      .map((c) => c.clip);
  }, [clips, selectedClipIds]);

  const handleExportImage = async () => {
    if (selectedClipIds.size === 0) return;
    setPreparingExport({ kind: "image", message: "Generating contact sheet image..." });
    try {
      await exportImage({
        projectName: projectName || "ContactSheet",
        clips: getExportClips(),
        thumbnailCache,
        thumbCount,
        projectLutHash: projectLut?.hash || null,
        brandName: brandProfile?.name,
        appVersion: appInfo?.version || "unknown",
        onWarning: (message) => setUiError({ title: "Export branding fallback", hint: message }),
      });
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
  };

  const handlePromoteClip = async (clipId: string) => {
    try {
      await invoke("promote_clip_to_block", { projectId, clipId });
      if (projectId) {
        await refreshProjectClips(projectId);
      }
    } catch (error) {
      console.error("Failed to promote clip:", error);
      setUiError({ title: "Promotion Failed", hint: String(error) });
    }
  };

  const handleExport = useCallback(() => {
    if (selectedClipIds.size === 0) {
      alert("Please select at least one clip to export.");
      return;
    }
    const run = async () => {
      setPreparingExport({ kind: "pdf", message: "Generating PDF contact sheet..." });
      try {
        await exportPdf({
          projectName: projectName || "ContactSheet",
          clips: getExportClips(),
          thumbnailCache,
          thumbCount,
          projectLutHash: projectLut?.hash || null,
          brandName: brandProfile?.name,
          appVersion: appInfo?.version || "unknown",
          onWarning: (message) => setUiError({ title: "Export branding fallback", hint: message }),
        });
        setUiError(null);
      } catch (err) {
        console.error(err);
        setUiError({
          title: "PDF export failed",
          hint: "Retry after thumbnails load.",
        });
      } finally {
        setPreparingExport(null);
      }
    };
    run().catch((err) => {
      console.error(err);
      setPreparingExport(null);
    });
  }, [selectedClipIds, getExportClips, thumbnailCache, thumbCount, projectLut, brandProfile, projectName, appInfo]);

  const totalClips = clips.length;
  const okClips = clips.filter((c) => c.clip.status === "ok").length;
  const warnClips = clips.filter((c) => c.clip.status === "warn").length;
  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const totalSize = clips.reduce((acc, c) => acc + c.clip.size_bytes, 0);
  const totalDuration = clips.reduce((acc, c) => acc + c.clip.duration_ms, 0);
  const inWorkspaceLauncher = activeTab === "media-workspace" && !activeMediaWorkspaceApp;
  const jobHudState = failedJobs > 0 ? "error" : (scanning || extracting || runningJobs > 0) ? "running" : jobs.some((j) => j.status === "done") ? "success" : "idle";

  // Advanced stats for pre-production
  const avgDuration = totalClips > 0 ? totalDuration / totalClips : 0;
  const clipsWithAudio = clips.filter((c) => c.clip.audio_codec && c.clip.audio_codec !== "none" && c.clip.audio_codec !== "").length;
  const fpsSet = new Set(clips.map((c) => c.clip.fps).filter(Boolean));
  const topFps = clips.length > 0 ? [...fpsSet].sort((a, b) => b - a)[0] : 0;
  const resolutions = new Set(clips.map((c) => `${c.clip.width}×${c.clip.height}`).filter(r => r !== "0×0"));
  const topRes = resolutions.size > 0 ? [...resolutions][0] : "—";

  // Aspect ratio detection
  const calculateRatio = (w: number, h: number) => {
    if (!w || !h) return null;
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const common = gcd(w, h);
    const rw = w / common;
    const rh = h / common;

    // Check for common cinematic/standard ratios
    const ratio = w / h;
    if (Math.abs(ratio - 16 / 9) < 0.01) return "16:9";
    if (Math.abs(ratio - 9 / 16) < 0.01) return "9:16";
    if (Math.abs(ratio - 2.35) < 0.02) return "2.35:1";
    if (Math.abs(ratio - 2.39) < 0.02) return "2.39:1";
    if (Math.abs(ratio - 1.85) < 0.01) return "1.85:1";
    if (Math.abs(ratio - 4 / 3) < 0.01) return "4:3";
    if (Math.abs(ratio - 1) < 0.01) return "1:1";

    return `${rw}:${rh}`;
  };

  const ratioSet = new Set(clips.map(c => calculateRatio(c.clip.width, c.clip.height)).filter(Boolean));
  const ratioLabel = ratioSet.size > 1 ? [...ratioSet].join(", ") : ratioSet.size === 1 ? [...ratioSet][0] : "";
  const picksCount = clips.filter((c) => c.clip.flag === "pick").length;
  const ratedCount = clips.filter((c) => c.clip.rating > 0).length;

  const visibleClips = clips.filter(({ clip }) => {
    const viewMatch =
      viewFilter === "picks" ? clip.flag === "pick" :
        viewFilter === "rated_min" ? clip.rating >= viewMinRating :
          true;
    const shotSizeMatch = shotSizeFilter === "all" ? true : clip.shot_size === shotSizeFilter;
    return viewMatch && shotSizeMatch;
  });
  const lookbookSorted = sortLookbookClips(visibleClips, lookbookSortMode);
  const sortedClips = lookbookSorted;
  const selectableClipIds = sortedClips
    .filter((c) => c.clip.flag !== "reject")
    .map((c) => c.clip.id);
  const selectedSelectableCount = selectableClipIds.filter((id) => selectedClipIds.has(id)).length;

  const toggleSelectAll = () => {
    if (selectedSelectableCount === selectableClipIds.length) {
      setSelectedClipIds(new Set());
      return;
    }
    setSelectedClipIds(new Set(selectableClipIds));
  };

  const thumbnailsByClipId = clips.reduce<Record<string, ClipWithThumbnails["thumbnails"]>>((acc, row) => {
    acc[row.clip.id] = row.thumbnails;
    return acc;
  }, {});

  return (
    <div className="app-container">
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
            <strong>{preparingExport.kind === "pdf" ? "Preparing PDF" : "Preparing Image"}</strong>
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
            <button className="nav-tab" onClick={() => { setActiveTab('home'); setActivePreproductionApp(null); setActiveMediaWorkspaceApp(null); }}>
              <LayoutGrid size={14} /> Modules
            </button>
            {activeTab === "preproduction" ? (
              <button
                className="nav-tab active"
                onClick={() => {
                  setActiveTab('preproduction');
                  setActivePreproductionApp(null);
                  setActiveMediaWorkspaceApp(null);
                }}
              >
                <Boxes size={14} /> Pre-production
              </button>
            ) : (
              <button
                className="nav-tab active"
                onClick={() => {
                  setActiveTab('media-workspace');
                  setActivePreproductionApp(null);
                  setActiveMediaWorkspaceApp(null);
                }}
              >
                <BriefcaseBusiness size={14} /> Media Workspace
              </button>
            )}
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
                    <button className="dropdown-item menu-item" onClick={async () => {
                      setHelpMenuOpen(false);
                      const dest = await open({ directory: true, multiple: false, title: "Export Feedback Bundle" });
                      if (!dest) return;
                      try {
                        const zip = await invoke<string>("export_feedback_bundle", { outputRoot: dest, lastVerificationJobId });
                        try { await openPath(zip); } catch (openErr) {
                          console.warn("openPath failed for feedback bundle", openErr);
                          setUiError({ title: "Feedback bundle exported", hint: `Saved at ${zip}. Use Finder to open if auto-open is blocked.` });
                        }
                      } catch (e) {
                        console.error(e);
                        setUiError({ title: "Diagnostics export failed", hint: "Retry and verify destination folder is writable." });
                      }
                    }}>
                      <span className="menu-item-icon"><MessageCircleWarning size={16} /></span>
                      <span className="menu-item-label">Send Feedback</span>
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
        {activeTab === 'preproduction' ? (
          activePreproductionApp === 'shot-planner' ? (
            projectId ? (
              <div className="media-workspace">
                <div className="stats-bar">
                  <div className={`stat-card ${selectedClipIds.size > 0 ? 'stat-card-highlight' : ''}`}>
                    <div className="stat-header">
                      <span className="stat-label">Selection</span>
                    </div>
                    <span className="stat-value">{selectedClipIds.size}<span className="stat-value-total"> / {totalClips}</span></span>
                    <span className="stat-sub">Selected for Export</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Assets</span>
                      <Info size={12} className="info-icon" />
                    </div>
                    <span className="stat-value">{totalClips}</span>
                    <span className="stat-sub">{formatFileSize(totalSize)} • {okClips} OK / {warnClips} Warn</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Duration</span>
                    </div>
                    <span className="stat-value">{formatDuration(totalDuration)}</span>
                    <span className="stat-sub">Avg {formatDuration(avgDuration)}/clip</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Resolution</span>
                    </div>
                    <span className="stat-value">{topRes}</span>
                    <span className="stat-sub">
                      {ratioLabel ? `${ratioLabel}` : `${resolutions.size} format${resolutions.size !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">FPS</span>
                    </div>
                    <span className="stat-value">{topFps || '—'}</span>
                    <span className="stat-sub">{fpsSet.size} rate{fpsSet.size !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Audio</span>
                    </div>
                    <span className="stat-value">{clipsWithAudio}</span>
                    <span className="stat-sub">{totalClips > 0 ? Math.round((clipsWithAudio / totalClips) * 100) : 0}% with audio</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Picks</span>
                    </div>
                    <span className="stat-value">{picksCount}</span>
                    <span className="stat-sub">{ratedCount} rated</span>
                  </div>
                </div>

                <div className="toolbar premium-toolbar">
                  <div className="toolbar-left-group">
                    <button className="btn btn-secondary btn-sm" onClick={() => handleSelectFolder("shot-planner")} disabled={scanning}>
                      {scanning ? <div className="spinner" /> : <FolderOpen size={14} />}
                      <span>{scanning ? "Scanning..." : "Load Footage"}</span>
                    </button>
                    <div className="toolbar-separator" />
                    <div className="thumb-range-selector">
                      <span className="toolbar-label">Thumbs</span>
                      {[3, 5, 7].map((n) => (
                        <button
                          key={n}
                          className={`btn btn-ghost btn-xs ${thumbCount === n ? 'active' : ''}`}
                          onClick={() => { setThumbCount(n); localStorage.setItem('wp_thumbCount', n.toString()); }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="toolbar-separator" />
                    <select
                      className="toolbar-select"
                      value={lookbookSortMode}
                      onChange={(e) => setLookbookSortMode(e.target.value as LookbookSortMode)}
                      title="Sort Mode"
                    >
                      <option value="canonical">Canonical Sort</option>
                      <option value="custom">Manual Order</option>
                      <option value="hook_first">Hook First</option>
                    </select>
                    <div className="toolbar-separator" />
                    <select
                      className="toolbar-select"
                      value={viewFilter}
                      onChange={(e) => setViewFilter(e.target.value as any)}
                    >
                      <option value="all">All Clips</option>
                      <option value="picks">Picks Only</option>
                      <option value="rated_min">Rated ≥</option>
                    </select>
                    {viewFilter === 'rated_min' && (
                      <select
                        className="toolbar-select"
                        value={viewMinRating}
                        onChange={(e) => setViewMinRating(Number(e.target.value))}
                        style={{ width: 60 }}
                      >
                        {[1, 2, 3, 4, 5].map((r) => (
                          <option key={r} value={r}>★{r}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="toolbar-right-group">
                    <button className="btn btn-ghost btn-sm" onClick={toggleSelectAll}>
                      {selectedSelectableCount === selectableClipIds.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                </div>



                <ClipList
                  clips={sortedClips}
                  thumbnailCache={thumbnailCache}
                  selectedIds={selectedClipIds}
                  onToggleSelection={toggleClipSelection}
                  thumbCount={thumbCount}
                  onUpdateMetadata={handleUpdateMetadata}
                  onHoverClip={setHoveredClipId}
                  shotSizeOptions={[...SHOT_SIZE_CANONICAL, ...(enableOptionalShotTags ? SHOT_SIZE_OPTIONAL : []), ...customShotSizes]}
                  movementOptions={[...MOVEMENT_CANONICAL, ...customMovements]}
                  lookbookSortMode={lookbookSortMode}
                  groupByShotSize={true}
                  onPromoteClip={handlePromoteClip}
                  onPlayClip={handlePlayClip}
                  playingClipId={playingClipId}
                  playingProgress={playingProgress}
                  focusedClipId={hoveredClipId}
                  projectLutHash={projectLut?.hash || null}
                  lutRenderNonce={lutRenderNonce}
                  hideLutControls={true}
                  onExportPDF={handleExport}
                  onExportImage={handleExportImage}
                />
              </div>
            ) : (scanning) ? (
              <div className="media-workspace">
                <div className="toolbar premium-toolbar">
                  <div className="toolbar-left-group">
                    <button className="btn btn-secondary btn-sm" disabled>
                      {scanning ? <div className="spinner" /> : null}
                      <span>{scanning ? "Scanning…" : ""}</span>
                    </button>
                  </div>
                </div>
                <div className="inline-loading-state">
                  <span style={{ fontSize: '1rem' }}>{scanning ? "Scanning folder for media files…" : ""}</span>
                </div>
              </div>
            ) : (
              <div className="media-workspace">
                <div className="workspace-empty-state premium-card">
                  <div className="module-icon"><Camera size={28} strokeWidth={1.5} /></div>
                  <h2>Shot Planner</h2>
                  <p>Load reference clips to tag shot sizes, movement, and selections before the shoot.</p>
                  <button className="btn btn-secondary" onClick={() => handleSelectFolder("shot-planner")}>
                    <FolderOpen size={14} />
                    <span>Load References</span>
                  </button>
                </div>
              </div>
            )
          ) : activePreproductionApp === 'folder-creator' ? (
            <div className="media-workspace">

              <FolderCreator />
            </div>
          ) : (
            <div className="onboarding-container">
              <div className="onboarding-header">
                <h1>Pre-production</h1>
                <p>Plan your shoot and organize your project structure.</p>
              </div>
              <div className="onboarding-grid">
              <div
                className="module-card premium-card"
                onClick={() => {
                  if (projectStates.pre.projectId) setActivePreproductionApp('shot-planner');
                  else handleSelectFolder('shot-planner');
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
                  onClick={() => setActivePreproductionApp('folder-creator')}
                >
                  <div className="module-icon"><FolderTree size={20} strokeWidth={1.5} /></div>
                  <div className="module-info">
                    <h3>Folder Creator</h3>
                    <p>Generate sophisticated folder structures for multi-platform use.</p>
                    <span className="module-action">Open App <ArrowRight size={14} /></span>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : activeTab === 'media-workspace' ? (
          activeMediaWorkspaceApp === 'safe-copy' ? (
            <div className="media-workspace">

              <SafeCopy projectId={projectId ?? "__global__"} onJobCreated={setLastVerificationJobId} onError={setUiError} />
            </div>
          ) : activeMediaWorkspaceApp === 'clip-review' ? (
            projectId ? (
              <div className="media-workspace">
                {/* Statistics and Toolbar as before, but maybe streamlined */}
                <ClipList
                  clips={sortedClips}
                  thumbnailCache={thumbnailCache}
                  selectedIds={selectedClipIds}
                  onToggleSelection={toggleClipSelection}
                  thumbCount={thumbCount}
                  onUpdateMetadata={handleUpdateMetadata}
                  onHoverClip={setHoveredClipId}
                  shotSizeOptions={[...SHOT_SIZE_CANONICAL, ...customShotSizes]}
                  movementOptions={[...MOVEMENT_CANONICAL, ...customMovements]}
                  lookbookSortMode={lookbookSortMode}
                  groupByShotSize={false}
                  onPromoteClip={handlePromoteClip}
                  onPlayClip={handlePlayClip}
                  playingClipId={playingClipId}
                  playingProgress={playingProgress}
                  focusedClipId={hoveredClipId}
                  projectLutHash={projectLut?.hash || null}
                  lutRenderNonce={lutRenderNonce}
                  onExportPDF={handleExport}
                  onExportImage={handleExportImage}
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
                  onOpenReview={() => setActiveMediaWorkspaceApp("clip-review")}
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
            <div className="onboarding-container">
              <div className="onboarding-header">
                <h1>Media Workspace</h1>
                <p>Post-production suite for media verification and organization.</p>
              </div>
              <div className="onboarding-grid workspace-apps-grid">
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
                    else handleSelectFolder("clip-review");
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
          )
        ) : (
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
        )}
      </div>

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

// ─── Utilities ───

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]} `;
}

function formatDuration(ms: number): string {
  if (ms === 0) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) return `${hours}h ${mins} m`;
  if (mins > 0) return `${mins}m ${secs} s`;
  return `${secs} s`;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
