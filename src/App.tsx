import { Component, ReactNode, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { FolderOpen, FileText, Info, Camera, Clock } from "lucide-react";
import { ClipList } from "./components/ClipList";
import { PrintLayout } from "./components/PrintLayout";
import { exportElementAsImage } from "./utils/ExportUtils";
import appLogo from "./assets/Icon_square_rounded.svg";

// Types
export interface Clip {
  id: string;
  project_id: string;
  filename: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  duration_ms: number;
  fps: number;
  width: number;
  height: number;
  video_codec: string;
  audio_summary: string;
  timecode: string | null;
  status: string;
}

export interface Thumbnail {
  clip_id: string;
  index: number;
  timestamp_ms: number;
  file_path: string;
}

export interface ClipWithThumbnails {
  clip: Clip;
  thumbnails: Thumbnail[];
}

interface ScanResult {
  project_id: string;
  project_name: string;
  clip_count: number;
  clips: Clip[];
}

interface ThumbnailProgress {
  clip_id: string;
  clip_index: number;
  total_clips: number;
  status: string;
  thumbnails: Thumbnail[];
}

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

export interface BrandProfile {
  name: string;
  colors: {
    primary: string;
    primary_hover: string;
    accent: string;
    background: string;
    text: string;
    border: string;
  };
}

function AppContent() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [clips, setClips] = useState<ClipWithThumbnails[]>([]);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [thumbCount, setThumbCount] = useState<number>(5);
  const [scanning, setScanning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [showPrint, setShowPrint] = useState(false);
  const [printingForImage, setPrintingForImage] = useState(false);
  const [thumbnailCache, setThumbnailCache] = useState<Record<string, string>>({});

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

      unlistenComplete = await listen("thumbnail-complete", () => {
        setExtracting(false);
      });
    }

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, []);

  const handleSelectFolder = useCallback(async () => {
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
          setExtracting(false);
        }
      );
    } catch (e) {
      console.error("Scan error:", e);
    } finally {
      setScanning(false);
    }
  }, []);

  const toggleClipSelection = (clipId: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedClipIds(new Set(clips.map((c) => c.clip.id)));
  };

  const selectNone = () => {
    setSelectedClipIds(new Set());
  };

  const handleExportImage = async () => {
    if (selectedClipIds.size === 0) return;
    setPrintingForImage(true);
    setTimeout(async () => {
      const element = document.getElementById('print-area');
      if (element) {
        try {
          await exportElementAsImage(element, `${projectName || 'ContactSheet'}`);
        } catch (err) {
          console.error(err);
          alert("Failed to export image.");
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

  return (
    <div className="app-shell">
      {(showPrint || printingForImage) && (
        <div id="print-area" style={printingForImage ? { position: 'absolute', left: '-9999px', width: '297mm' } : {}}>
          <PrintLayout
            projectName={projectName}
            clips={clips.filter(c => selectedClipIds.has(c.clip.id))}
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
          <div className="app-logo">
            <div className="app-logo-icon">
              <img src={appLogo} alt="Wrap Preview Logo" />
            </div>
            <span>Wrap Preview</span>
          </div>
          {projectName && (
            <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)", marginLeft: '12px' }}>
              / {projectName}
            </span>
          )}
        </div>
        <div className="app-header-right">
          <button className="btn btn-primary" onClick={handleSelectFolder} disabled={scanning}>
            {scanning ? <div className="spinner" /> : <FolderOpen size={16} />}
            {scanning ? "Scanning..." : "Select Folder"}
          </button>
          {projectId && clips.length > 0 && !extracting && (
            <button className="btn btn-primary btn-export" onClick={handleExport} disabled={selectedClipIds.size === 0}>
              <FileText size={16} /> Export PDF
            </button>
          )}
        </div>
      </header>

      <div className="app-content">
        {!projectId ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Camera size={32} /></div>
            <h2>Welcome to Wrap Preview</h2>
            <p>Select a footage folder to scan, extract thumbnails, and generate contact sheets.</p>
            <button className="btn btn-primary btn-lg" onClick={handleSelectFolder} disabled={scanning}>
              <FolderOpen size={20} /> Select Footage Folder
            </button>
          </div>
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
                  <div className="progress-bar-fill" style={{ width: `${extractProgress.total > 0 ? (extractProgress.done / extractProgress.total) * 100 : 0}%` }} />
                </div>
                <div className="progress-label">
                  <span>Extracting thumbnails…</span>
                  <span>{extractProgress.done} / {extractProgress.total}</span>
                </div>
              </div>
            )}

            <div className="toolbar">
              <div className="toolbar-left">
                <div className="selection-stats-toolbar">
                  <span className="toolbar-label">Select:</span>
                  <button className="btn-link" onClick={selectAll}>All</button>
                  <button className="btn-link" onClick={selectNone}>None</button>
                </div>
                <div className="layout-picker">
                  <span className="toolbar-label">Thumbnails:</span>
                  {[3, 5, 7].map((n) => (
                    <button key={n} className={`btn-toggle ${thumbCount === n ? 'active' : ''}`} onClick={() => setThumbCount(n)}>{n}</button>
                  ))}
                </div>
              </div>
              <button className="btn btn-secondary" onClick={handleExportImage} disabled={selectedClipIds.size === 0}>
                <Camera size={16} /> Export Image
              </button>
            </div>

            <ClipList
              clips={clips}
              thumbnailCache={thumbnailCache}
              selectedIds={selectedClipIds}
              onToggleSelection={toggleClipSelection}
              thumbCount={thumbCount}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Utilities ───

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms === 0) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
