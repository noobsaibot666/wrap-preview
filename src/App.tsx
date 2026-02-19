import { Component, ReactNode, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Camera,
  FolderOpen,
  FileText,
  Info,
  ShieldCheck,
  ArrowRight,
  Clock,
  Star,
  Volume2,
  Boxes,
  BriefcaseBusiness,
  MessageCircleWarning,
  BadgeInfo,
  CircleHelp,
} from "lucide-react";
import { ClipList } from "./components/ClipList";
import { PrintLayout } from "./components/PrintLayout";
import { SafeCopy } from "./components/SafeCopy";
import { ExportPanel } from "./components/ExportPanel";
import { BlocksView } from "./components/BlocksView";
import { JobsPanel } from "./components/JobsPanel";
import { AboutPanel } from "./components/AboutPanel";
import { TourGuide, TourStep } from "./components/TourGuide";
import { exportElementAsImage } from "./utils/ExportUtils";
import appLogo from "./assets/Icon_square_rounded.svg";
import { AppInfo, Clip, ClipWithThumbnails, JobInfo, ScanResult, ThumbnailProgress } from "./types";

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
          <button style={{ padding: '10px 20px', background: '#6366f1', border: 'none', borderRadius: 8, color: 'white', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Reload App</button>
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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [clips, setClips] = useState<ClipWithThumbnails[]>([]);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [showPrint, setShowPrint] = useState(false);
  const [printingForImage, setPrintingForImage] = useState(false);
  const [thumbnailCache, setThumbnailCache] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"home" | "contact" | "blocks" | "safe-copy">(() => {
    const saved = localStorage.getItem("wp_active_tab");
    if (saved === "home" || saved === "contact" || saved === "blocks" || saved === "safe-copy") {
      return saved;
    }
    return "home";
  });
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

  // Settings with Persistence
  const [thumbCount, setThumbCount] = useState<number>(() => {
    const saved = localStorage.getItem("wp_thumbCount");
    return saved ? parseInt(saved, 10) : 5;
  });
  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem("wp_sortBy") || "name";
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    return (localStorage.getItem("wp_sortOrder") as "asc" | "desc") || "asc";
  });
  const [namingTemplate, setNamingTemplate] = useState<string>(() => {
    return localStorage.getItem("wp_namingTemplate") || "ContactSheet_{PROJECT}_{DATE}";
  });

  useEffect(() => {
    localStorage.setItem("wp_thumbCount", thumbCount.toString());
    localStorage.setItem("wp_sortBy", sortBy);
    localStorage.setItem("wp_sortOrder", sortOrder);
    localStorage.setItem("wp_namingTemplate", namingTemplate);
  }, [thumbCount, sortBy, sortOrder, namingTemplate]);

  useEffect(() => {
    localStorage.setItem("wp_active_tab", activeTab);
  }, [activeTab]);

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

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<JobInfo>("job-progress", () => refreshJobs()).then((u) => { unlisten = u; }).catch(console.error);
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshJobs]);

  useEffect(() => {
    invoke<AppInfo>("get_app_info").then(setAppInfo).catch(console.error);
  }, []);

  // State for delayed actions
  const [openExportAfterScan, setOpenExportAfterScan] = useState(false);
  const [postScanTab, setPostScanTab] = useState<"contact" | "blocks" | null>(null);

  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);

  const toggleClipSelection = useCallback((id: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleUpdateMetadata = useCallback(async (clipId: string, updates: Partial<Pick<Clip, 'rating' | 'flag' | 'notes'>>) => {
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

    try {
      await invoke("update_clip_metadata", {
        clipId,
        rating: updates.rating ?? null,
        flag: updates.flag ?? null,
        notes: updates.notes ?? null
      });
    } catch (err) {
      console.error("Failed to persist metadata:", err);
      setUiError({ title: "Could not save rating/flag", hint: "Retry. If this persists, export diagnostics from header actions." });
    }
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (tourRun) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.closest("[data-tour-tooltip]")) return;

      const targetId = hoveredClipId;
      const key = e.key.toLowerCase();

      if ((key === "arrowdown" || key === "arrowright" || key === "arrowup" || key === "arrowleft") && clips.length > 0) {
        e.preventDefault();
        const currentIndex = targetId ? clips.findIndex((c) => c.clip.id === targetId) : -1;
        const nextIndex = key === "arrowdown" || key === "arrowright"
          ? Math.min(currentIndex + 1, clips.length - 1)
          : Math.max(currentIndex - 1, 0);
        setHoveredClipId(clips[nextIndex].clip.id);
        return;
      }

      if (!targetId) return;

      if (key >= '0' && key <= '5') {
        handleUpdateMetadata(targetId, { rating: parseInt(key) });
      } else if (key === 'p') {
        handleUpdateMetadata(targetId, { flag: 'pick' });
      } else if (key === 'x') {
        handleUpdateMetadata(targetId, { flag: 'reject' });
      } else if (key === 'u' || key === ' ') {
        e.preventDefault();
        handleUpdateMetadata(targetId, { flag: 'none' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredClipId, clips, handleUpdateMetadata, tourRun]);

  // Automatic Audio Analysis Trigger
  useEffect(() => {
    const processClips = async () => {
      const clipsToProcess = clips.filter(c => !c.clip.audio_envelope);
      if (clipsToProcess.length === 0) return;

      for (const item of clipsToProcess) {
        try {
          const envelope = await invoke<number[]>("extract_audio_waveform", { clipId: item.clip.id });
          setClips(prev => prev.map(c =>
            c.clip.id === item.clip.id ? { ...c, clip: { ...c.clip, audio_envelope: envelope } } : c
          ));
        } catch (err) {
          console.warn(`Failed to extract waveform for ${item.clip.id}:`, err);
        }
      }
    };

    if (clips.length > 0 && !scanning) {
      processClips();
    }
  }, [clips, scanning]);

  // Handle delayed export panel opening
  useEffect(() => {
    if (projectId && openExportAfterScan) {
      setShowExportPanel(true);
      setOpenExportAfterScan(false);
    }
  }, [projectId, openExportAfterScan]);

  useEffect(() => {
    if (projectId && postScanTab) {
      setActiveTab(postScanTab);
      setPostScanTab(null);
    }
  }, [projectId, postScanTab]);

  const hydrateThumbnailCache = useCallback(async (items: ClipWithThumbnails[]) => {
    const thumbEntries = items.flatMap((item) =>
      item.thumbnails.map((thumb) => ({
        key: `${thumb.clip_id}_${thumb.index}`,
        path: thumb.file_path
      }))
    );
    if (thumbEntries.length === 0) return;

    const results = await Promise.all(
      thumbEntries.map(async ({ key, path }) => {
        try {
          const dataUrl = await invoke<string>("read_thumbnail", { path });
          return { key, dataUrl };
        } catch (error) {
          console.warn(`Thumbnail load failed for ${path}`, error);
          return null;
        }
      })
    );

    const nextCache: Record<string, string> = {};
    for (const item of results) {
      if (item) nextCache[item.key] = item.dataUrl;
    }
    if (Object.keys(nextCache).length > 0) {
      setThumbnailCache((prev) => ({ ...prev, ...nextCache }));
    }
  }, []);

  const refreshProjectClips = useCallback(async (nextProjectId: string) => {
    try {
      const clipRows = await invoke<ClipWithThumbnails[]>("get_clips", { projectId: nextProjectId });
      setClips(clipRows);
      await hydrateThumbnailCache(clipRows);
    } catch (error) {
      console.error("Failed to refresh clips:", error);
      setUiError({ title: "Could not load clip previews", hint: "Retry scan. If this persists, export diagnostics." });
    }
  }, [hydrateThumbnailCache]);

  // Listen for thumbnail progress events
  useEffect(() => {
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;

    async function setupListeners() {
      unlistenProgress = await listen<ThumbnailProgress>("thumbnail-progress", (event) => {
        const { clip_id, clip_index, total_clips, thumbnails } = event.payload;
        setExtractProgress({ done: clip_index + 1, total: total_clips });

        if (thumbnails.length > 0) {
          setClips((prev) =>
            prev.map((c) =>
              c.clip.id === clip_id ? { ...c, thumbnails: thumbnails } : c
            )
          );

          Promise.all(thumbnails.map(async (thumb) => {
            try {
              const dataUrl = await invoke<string>("read_thumbnail", { path: thumb.file_path });
              return { key: `${thumb.clip_id}_${thumb.index}`, dataUrl };
            } catch (e) {
              console.warn("Failed to load thumbnail:", e);
              return null;
            }
          })).then(results => {
            const newEntries: Record<string, string> = {};
            results.forEach(res => {
              if (res) newEntries[res.key] = res.dataUrl;
            });
            if (Object.keys(newEntries).length > 0) {
              setThumbnailCache(prev => ({ ...prev, ...newEntries }));
            }
          });
        }
      });

      unlistenComplete = await listen("thumbnail-complete", async () => {
        setExtracting(false);
        if (projectId) {
          await refreshProjectClips(projectId);
        }
      });
    }

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, [projectId, refreshProjectClips]);

  const handleSelectFolder = useCallback(async (targetTab?: "contact" | "blocks") => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Footage Folder",
    });

    if (!selected) return;

    setScanning(true);
    setClips([]);
    setThumbnailCache({});
    setProjectId(null);
    setSelectedBlockIds([]);
    if (targetTab) setPostScanTab(targetTab);

    try {
      const result = await invoke<ScanResult>("scan_folder", {
        folderPath: selected,
      });

      setProjectId(result.project_id);
      setProjectName(result.project_name);
      setClips(result.clips.map((clip) => ({ clip, thumbnails: [] })));

      setExtracting(true);
      setExtractProgress({ done: 0, total: result.clip_count });
      invoke("extract_thumbnails", { projectId: result.project_id }).catch(
        (e) => {
          console.error("Thumbnail extraction error:", e);
          setUiError({ title: "Thumbnail extraction failed", hint: "Retry scan or check media read permissions." });
          setExtracting(false);
        }
      );

      refreshProjectClips(result.project_id).catch((err) => {
        console.warn("Initial clip refresh failed", err);
      });
    } catch (e) {
      console.error("Scan error:", e);
      setUiError({ title: "Scan failed", hint: "Verify folder access and media formats, then retry." });
    } finally {
      setScanning(false);
    }
  }, [refreshProjectClips]);

  const handleGoHome = useCallback(() => {
    setProjectId(null);
    setClips([]);
    setSelectedClipIds(new Set());
    setExtracting(false);
    setActiveTab("home");
  }, []);

  const tourSteps: TourStep[] = [
    {
      target: ".onboarding-grid",
      title: "Workflow Modules",
      description: "Start from these cards to run the suite in order.",
      placement: "bottom",
      learnMore: ["Each module focuses on one production phase.", "You can jump modules at any time.", "Use Jobs to monitor long tasks."]
    },
    {
      target: ".tour-safe-copy-module",
      title: "Safe Copy",
      description: "Run FAST or SOLID verification before editorial work.",
      placement: "right",
      learnMore: ["SOLID uses full-file hashing.", "FAST checks metadata quickly.", "Export JSON reports for records."]
    },
    {
      target: ".tour-contact-module",
      title: "Contact Sheet",
      description: "Scan media and generate visual strip previews.",
      placement: "right"
    },
    {
      target: ".clip-rating",
      title: "Ratings & Flags",
      description: "Use stars and pick/reject to tag editorial selects.",
      placement: "top"
    },
    {
      target: ".waveform-container",
      title: "Audio Waveform",
      description: "Waveform and badges help identify low/absent/clipped audio quickly.",
      placement: "top"
    },
    {
      target: ".tour-blocks-tab",
      title: "Blocks",
      description: "Open Blocks to cluster clips by timeline gaps and camera labels.",
      placement: "bottom"
    },
    {
      target: ".tour-open-export",
      title: "Resolve Export",
      description: "Open export to generate structured FCPXML for Resolve.",
      placement: "bottom"
    },
    {
      target: ".tour-director-pack-btn",
      title: "Director Pack",
      description: "Create a deterministic bundle with PDF, FCPXML, and JSON report.",
      placement: "left"
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


  const selectAll = () => {
    setSelectedClipIds(new Set(sortedClips.map((c) => c.clip.id)));
  };

  const selectNone = () => {
    setSelectedClipIds(new Set());
  };

  const getExportFilename = () => {
    const date = new Date().toISOString().split('T')[0];
    return namingTemplate
      .replace("{PROJECT}", projectName || "ContactSheet")
      .replace("{DATE}", date)
      .replace("{COUNT}", selectedClipIds.size.toString());
  };

  const handleExportImage = async () => {
    if (selectedClipIds.size === 0) return;
    setPrintingForImage(true);
    setTimeout(async () => {
      const element = document.getElementById('print-area');
      if (element) {
        try {
          await exportElementAsImage(element, getExportFilename());
          setUiError(null);
        } catch (err) {
          console.error(err);
          setUiError({ title: "Image export failed", hint: "Retry with a writable destination folder." });
        }
      }
      setPrintingForImage(false);
    }, 500);
  };

  const handleExport = useCallback(() => {
    if (selectedClipIds.size === 0) {
      alert("Please select at least one clip to export.");
      return;
    }
    setShowPrint(true);
    setTimeout(() => {
      window.print();
      setTimeout(() => setShowPrint(false), 500);
    }, 300);
  }, [selectedClipIds]);

  const totalClips = clips.length;
  const okClips = clips.filter((c) => c.clip.status === "ok").length;
  const warnClips = clips.filter((c) => c.clip.status === "warn").length;
  const totalSize = clips.reduce((acc, c) => acc + c.clip.size_bytes, 0);
  const totalDuration = clips.reduce((acc, c) => acc + c.clip.duration_ms, 0);

  const visibleClips = clips.filter(({ clip }) => {
    if (viewFilter === "picks") return clip.flag === "pick";
    if (viewFilter === "rated_min") return clip.rating >= viewMinRating;
    return true;
  });

  const sortedClips = [...visibleClips].sort((a, b) => {
    let result = 0;
    if (sortBy === "name") result = a.clip.filename.localeCompare(b.clip.filename);
    else if (sortBy === "duration") result = a.clip.duration_ms - b.clip.duration_ms;
    else if (sortBy === "size") result = a.clip.size_bytes - b.clip.size_bytes;

    return sortOrder === "asc" ? result : -result;
  });

  const thumbnailsByClipId = clips.reduce<Record<string, ClipWithThumbnails["thumbnails"]>>((acc, row) => {
    acc[row.clip.id] = row.thumbnails;
    return acc;
  }, {});

  return (
    <div className="app-shell">
      {(showPrint || printingForImage) && (
        <div id="print-area" style={printingForImage ? { position: 'absolute', left: '-9999px', width: '297mm' } : {}}>
          <PrintLayout
            projectName={projectName}
            clips={sortedClips.filter(c => selectedClipIds.has(c.clip.id))}
            thumbnailCache={thumbnailCache}
            brandProfile={null}
            logoSrc={appLogo}
            thumbCount={thumbCount}
            onClose={() => {
              if (!printingForImage) setShowPrint(false);
            }}
          />
        </div>
      )}

      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo" onClick={handleGoHome} style={{ cursor: 'pointer' }}>
            <div className="app-logo-icon">
              <img src={appLogo} alt="Wrap Preview Logo" />
            </div>
            <span>Wrap Preview</span>
          </div>
          <div className="app-tabs">
            <button className={`tab-btn ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>Modules</button>
            <button className={`tab-btn ${activeTab === 'contact' ? 'active' : ''}`} onClick={() => setActiveTab('contact')}>Contact Sheet</button>
            <button className={`tab-btn tour-blocks-tab ${activeTab === 'blocks' ? 'active' : ''}`} onClick={() => setActiveTab('blocks')} disabled={!projectId}>Blocks</button>
            <button className={`tab-btn ${activeTab === 'safe-copy' ? 'active' : ''}`} onClick={() => setActiveTab('safe-copy')}>Safe Copy</button>
          </div>
          {(activeTab === 'contact' || activeTab === 'blocks') && projectName && (
            <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)", marginLeft: '12px' }}>
              / {projectName}
            </span>
          )}
        </div>
        <div className="app-header-right">
          {(activeTab === 'home' || activeTab === 'contact' || activeTab === 'blocks') && (
            <>
              <button
                className="btn btn-primary"
                onClick={() => handleSelectFolder(activeTab === "blocks" ? "blocks" : "contact")}
                disabled={scanning}
                title="Check clips and generate metadata/thumbnails for a media folder."
              >
                {scanning ? <div className="spinner" /> : <FolderOpen size={16} />}
                {scanning ? "Scanning..." : "Check Clips"}
              </button>
              <button className="btn btn-secondary" onClick={() => setJobsOpen(true)}>
                <BriefcaseBusiness size={16} /> Jobs
              </button>
              <button className="btn btn-secondary" onClick={() => setAboutOpen(true)}>
                <BadgeInfo size={16} /> About
              </button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const dest = await open({ directory: true, multiple: false, title: "Export Feedback Bundle" });
                  if (!dest) return;
                  try {
                    const zip = await invoke<string>("export_feedback_bundle", {
                      outputRoot: dest,
                      lastVerificationJobId
                    });
                    try {
                      await openPath(zip);
                    } catch (openErr) {
                      console.warn("openPath failed for feedback bundle", openErr);
                      setUiError({ title: "Feedback bundle exported", hint: `Saved at ${zip}. Use Finder to open if auto-open is blocked.` });
                    }
                  } catch (e) {
                    console.error(e);
                    setUiError({ title: "Diagnostics export failed", hint: "Retry and verify destination folder is writable." });
                  }
                }}
              >
                <MessageCircleWarning size={16} /> Send Feedback
              </button>
              {activeTab === "contact" && projectId && clips.length > 0 && !extracting && (
                <button className="btn btn-primary btn-export tour-open-export" onClick={handleExport} disabled={selectedClipIds.size === 0}>
                  <FileText size={16} /> Export PDF
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (tourRun) completeTour();
                  else setTourRun(true);
                }}
              >
                <CircleHelp size={16} /> {tourRun ? "Hide Tips" : "Show Tour"}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="app-content">
        {uiError && (
          <div className="error-banner">
            <strong>{uiError.title}</strong> {uiError.hint}
          </div>
        )}
        {activeTab === 'safe-copy' ? (
          <SafeCopy onJobCreated={setLastVerificationJobId} onError={setUiError} />
        ) : activeTab === 'home' || !projectId ? (
          <div className="onboarding-container">
            <div className="onboarding-header">
              <h1>Professional Workflow</h1>
              <p>Select a workspace to begin.</p>
            </div>
            <div className="onboarding-grid">
              <div className={`module-card tour-contact-module ${scanning ? 'disabled' : ''}`} onClick={scanning ? undefined : () => handleSelectFolder("contact")}>
                <div className="module-icon">
                  {scanning ? <div className="spinner" /> : <Camera size={32} strokeWidth={1.5} />}
                </div>
                <div className="module-info">
                  <h3>1. Ingest + Contact Sheet</h3>
                  <p>Scan media and build a printable visual index.</p>
                  <span className="module-action">
                    {scanning ? "Scanning..." : "Scan"} <ArrowRight size={14} />
                  </span>
                </div>
              </div>

              <div className={`module-card ${scanning ? 'disabled' : ''}`} onClick={scanning ? undefined : () => handleSelectFolder("contact")}>
                <div className="module-icon"><Star size={32} strokeWidth={1.5} /></div>
                <div className="module-info">
                  <h3>2. Rate + Director Selects</h3>
                  <p>Apply stars and pick/reject flags with hotkeys.</p>
                  <span className="module-action">Open <ArrowRight size={14} /></span>
                </div>
              </div>

              <div className={`module-card ${scanning ? 'disabled' : ''}`} onClick={scanning ? undefined : () => handleSelectFolder("contact")}>
                <div className="module-icon"><Volume2 size={32} strokeWidth={1.5} /></div>
                <div className="module-info">
                  <h3>3. Audio Summary Strip</h3>
                  <p>Generate waveform previews and audio health hints.</p>
                  <span className="module-action">Analyze <ArrowRight size={14} /></span>
                </div>
              </div>

              <div className={`module-card ${scanning ? 'disabled' : ''}`} onClick={scanning ? undefined : () => handleSelectFolder("blocks")}>
                <div className="module-icon"><Boxes size={32} strokeWidth={1.5} /></div>
                <div className="module-info">
                  <h3>4. Scene Blocks</h3>
                  <p>Auto-cluster moments by shoot time gaps and camera tags.</p>
                  <span className="module-action">Cluster <ArrowRight size={14} /></span>
                </div>
              </div>

              <div className={`module-card ${scanning ? 'disabled' : ''}`} onClick={scanning ? undefined : () => {
                setOpenExportAfterScan(true);
                handleSelectFolder("contact");
              }}>
                <div className="module-icon"><FileText size={32} strokeWidth={1.5} /></div>
                <div className="module-info">
                  <h3>5. Resolve Export</h3>
                  <p>Export All/Picks/Rating/Selected Blocks to FCPXML.</p>
                  <span className="module-action">Export <ArrowRight size={14} /></span>
                </div>
              </div>

              <div className="module-card tour-safe-copy-module" onClick={() => { setProjectId(null); setActiveTab('safe-copy'); }}>
                <div className="module-icon"><ShieldCheck size={32} strokeWidth={1.5} /></div>
                <div className="module-info">
                  <h3>6. Safe Copy</h3>
                  <p>Bit-accurate verification logs via BLAKE3.</p>
                  <span className="module-action">Verify <ArrowRight size={14} /></span>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "blocks" ? (
          <BlocksView
            projectId={projectId}
            thumbnailCache={thumbnailCache}
            thumbnailsByClipId={thumbnailsByClipId}
            onSelectedBlockIdsChange={setSelectedBlockIds}
            onRequestGenerateThumbnails={async () => {
              try {
                setExtracting(true);
                setExtractProgress({ done: 0, total: clips.length });
                await invoke("extract_thumbnails", { projectId });
              } catch (error) {
                console.error("Thumbnail extraction error:", error);
                setUiError({ title: "Thumbnail extraction failed", hint: "Retry and confirm media folder is readable." });
                setExtracting(false);
              }
            }}
          />
        ) : (
          <>
            <div className="stats-bar">
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-label">Selection</span>
                </div>
                <span className="stat-value">{selectedClipIds.size} / {totalClips}</span>
                <span className="stat-sub">Selected for Export</span>
              </div>
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-label">Assets</span>
                  <Info size={12} className="info-icon" data-tooltip="Total video files discovered." />
                </div>
                <span className="stat-value">{totalClips}</span>
                <div className="stat-sub-group">
                  <span className="stat-sub-item ok">{okClips} OK</span>
                  <span className="stat-sub-item warn">{warnClips} WARN</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-label">Warnings</span>
                  <Info size={12} className="info-icon" data-tooltip="No embedded timecode found in these files." />
                </div>
                <span className="stat-value">{warnClips}</span>
                <span className="stat-sub">Missing Timecode</span>
              </div>
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-label">Total Duration</span>
                  <Clock size={12} className="info-icon" data-tooltip="Cumulative runtime of all discovered clips." />
                </div>
                <span className="stat-value">{formatDuration(totalDuration)}</span>
                <span className="stat-sub">{formatFileSize(totalSize)} total volume</span>
              </div>
            </div>

            {extracting && (
              <div className="progress-container">
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${extractProgress.total > 0 ? (extractProgress.done / extractProgress.total) * 100 : 0}% ` }} />
                </div>
                <div className="progress-label">
                  <span>Extracting thumbnails…</span>
                  <span>{extractProgress.done} / {extractProgress.total}</span>
                </div>
              </div>
            )}

            <div className="toolbar premium-toolbar toolbar-row">
              <div className="toolbar-left-group">
                <div className="toolbar-segment">
                  <span className="toolbar-label">Layout</span>
                  <div className="layout-picker">
                    {[3, 5, 7].map((n) => (
                      <button key={n} className={`btn-toggle ${thumbCount === n ? 'active' : ''}`} onClick={() => setThumbCount(n)}>{n}</button>
                    ))}
                  </div>
                </div>

                <div className="toolbar-segment">
                  <span className="toolbar-label">Sort</span>
                  <div className="sort-group">
                    <select className="input-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      <option value="name">Name</option>
                      <option value="duration">Duration</option>
                      <option value="size">Size</option>
                    </select>
                    <button className="btn-toggle sort-dir" onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>
                </div>

                <div className="toolbar-segment">
                  <span className="toolbar-label">Filter</span>
                  <div className="sort-group">
                    <select className="input-select" value={viewFilter} onChange={(e) => setViewFilter(e.target.value as "all" | "picks" | "rated_min")}>
                      <option value="all">Show All</option>
                      <option value="picks">Picks Only</option>
                      <option value="rated_min">Rating &gt;= N</option>
                    </select>
                    {viewFilter === "rated_min" && (
                      <select className="input-select" value={viewMinRating} onChange={(e) => setViewMinRating(Number(e.target.value))}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}+</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="toolbar premium-toolbar toolbar-row">
              <div className="toolbar-left-group">
                <div className="toolbar-segment">
                  <span className="toolbar-label">Selection</span>
                  <div className="toolbar-actions">
                    <button className="btn-link" onClick={selectAll}>Select All</button>
                    <button className="btn-link" onClick={selectNone}>Clear</button>
                  </div>
                </div>

                <div className="toolbar-segment naming-segment">
                  <span className="toolbar-label">Export Name</span>
                  <div className="naming-input-group">
                    <input
                      type="text"
                      className="input-text"
                      value={namingTemplate}
                      onChange={(e) => setNamingTemplate(e.target.value)}
                      placeholder="ContactSheet_{PROJECT}_{DATE}"
                      aria-label="Export name template"
                    />
                    <div className="info-trigger" data-tooltip="{PROJECT}, {DATE}, {COUNT}. Example: ContactSheet_ProjectA_2026-02-19">
                      <Info size={12} className="info-icon" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="toolbar-right-group">
                <button
                  className="btn btn-secondary btn-image-export"
                  onClick={handleExportImage}
                  disabled={selectedClipIds.size === 0}
                  title="Save image export for current selection."
                >
                  <Camera size={16} /> Save Image
                </button>
                {clips.length === 0 && !scanning && (
                  <span className="empty-warning">No media found.</span>
                )}
              </div>
            </div>

            <ClipList
              clips={sortedClips}
              thumbnailCache={thumbnailCache}
              isExtracting={extracting}
              selectedIds={selectedClipIds}
              onToggleSelection={toggleClipSelection}
              thumbCount={thumbCount}
              onUpdateMetadata={handleUpdateMetadata}
              onHoverClip={setHoveredClipId}
            />
          </>
        )}
      </div>

      {
        showExportPanel && projectId && (
          <ExportPanel
            projectId={projectId}
            clips={clips.map(c => c.clip)}
            selectedBlockIds={selectedBlockIds}
            currentFilterMode={viewFilter}
            currentFilterMinRating={viewMinRating}
            onError={setUiError}
            onClose={() => setShowExportPanel(false)}
          />
        )
      }
      <JobsPanel open={jobsOpen} jobs={jobs} onClose={() => setJobsOpen(false)} onRefresh={refreshJobs} />
      <AboutPanel open={aboutOpen} info={appInfo} onResetTour={resetTour} onClose={() => setAboutOpen(false)} />
      <TourGuide
        run={tourRun}
        steps={tourSteps}
        onComplete={completeTour}
        onClose={completeTour}
      />
    </div >
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
