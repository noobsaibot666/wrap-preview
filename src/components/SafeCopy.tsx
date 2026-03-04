import { useEffect, useMemo, useRef, useState } from "react";
import { TableVirtuoso } from "react-virtuoso";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Play, XCircle, CheckCircle, AlertTriangle, Search, FileText, ListChecks, Plus, Trash2, ShieldCheck } from "lucide-react";
import { saveSafeCopyJobPdf, saveSafeCopyQueuePdf, SafeCopyVerificationJob } from "../utils/SafeCopyPdf";

interface VerificationProgress {
  job_id: string;
  phase: string;
  current_file: string;
  bytes_total: number;
  bytes_processed: number;
  files_total: number;
  files_processed: number;
  ok_count: number;
  mismatch_count: number;
  missing_count: number;
}

interface VerificationItem {
  rel_path: string;
  source_size: number;
  dest_size?: number;
  status: string;
  error_message?: string;
}

interface AppInfo {
  version: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  root_path: string;
}

interface QueueCheck {
  id: string;
  project_id: string;
  idx: number;
  label?: string | null;
  source_path: string;
  dest_path: string;
  last_job_id?: string | null;
  status: string;
  mode?: string | null;
  duration_ms?: number | null;
  counts_json?: string | null;
}

interface QueueRunStartResult {
  queue_run_id: string;
  job_ids: string[];
}

interface SafeCopyProps {
  projectId: string;
  onJobCreated?: (jobId: string) => void;
  onError?: (error: { title: string; hint: string } | null) => void;
}

const MAX_QUEUE = 5;
const PREVIEW_VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "mxf", "avi", "mkv", "r3d", "braw", "mts", "m4v", "webm", "wmv", "flv",
  "ts", "m2ts", "mpg", "mpeg", "3gp", "ogv"
]);

function shouldShowVerificationPreviewItem(relPath: string) {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEW_VIDEO_EXTENSIONS.has(ext);
}

export function SafeCopy({ projectId, onJobCreated, onError }: SafeCopyProps) {
  const [mode, setMode] = useState<"FAST" | "SOLID">("SOLID");
  const [queue, setQueue] = useState<QueueCheck[]>([]);
  const [defaultSourcePath, setDefaultSourcePath] = useState("");
  const [queueRunId, setQueueRunId] = useState<string | null>(null);
  const [isRunningQueue, setIsRunningQueue] = useState(false);
  const [progress, setProgress] = useState<VerificationProgress | null>(null);
  const [results, setResults] = useState<VerificationItem[]>([]);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const persistTimers = useRef<Record<number, number>>({});
  const queueRef = useRef<QueueCheck[]>([]);

  const createInitialRow = async (sourcePath = "") => {
    const row = await invoke<QueueCheck>("set_verification_queue_item", {
      projectId,
      idx: 1,
      sourcePath,
      destPath: "",
      label: "Check 01"
    });
    setQueue([row]);
    return row;
  };

  const loadQueue = async (initial = false) => {
    try {
      const rows = await invoke<QueueCheck[]>("list_verification_queue", { projectId });
      const sortedRows = rows.sort((a, b) => a.idx - b.idx);
      if (sortedRows.length === 0) {
        if (projectId !== "__global__") {
          const project = await invoke<ProjectInfo | null>("get_project", { projectId });
          setDefaultSourcePath(project?.root_path ?? "");
          await createInitialRow(project?.root_path ?? "");
        } else {
          await createInitialRow("");
        }
      } else {
        setQueue(sortedRows);
      }

      if (initial) {
        // Try to find an existing running job for verification queue
        const jobs = await invoke<any[]>("list_jobs");
        const running = jobs.find(j => j.kind === "verification_queue" && (j.status === "running" || j.status === "queued"));
        if (running) {
          setQueueRunId(running.id);
        }
      }
    } catch (e) {
      console.error(e);
      onError?.({ title: "Failed to load verification queue", hint: "Retry. If this persists, export diagnostics." });
    }
  };

  useEffect(() => {
    loadQueue(true);
    setProgress(null);
    setResults([]);
    setQueueRunId(null);
    setIsRunningQueue(false);
  }, [projectId]);

  useEffect(() => {
    if (projectId === "__global__") {
      setDefaultSourcePath("");
      return;
    }

    invoke<ProjectInfo | null>("get_project", { projectId })
      .then((project) => setDefaultSourcePath(project?.root_path ?? ""))
      .catch((error) => {
        console.error(error);
        setDefaultSourcePath("");
      });
  }, [projectId]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    return () => {
      Object.values(persistTimers.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  useEffect(() => {
    if (!queueRunId) return;
    let mounted = true;
    const poll = async () => {
      try {
        const jobs = await invoke<any[]>("list_jobs");
        const queueJob = jobs.find((j) => j.id === queueRunId);
        if (!mounted) return;
        if (queueJob) {
          const running = queueJob.status === "running" || queueJob.status === "queued";
          setIsRunningQueue(running);
          if (!running) {
            setQueueRunId(null);
            await loadQueue();
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
    poll();
    const t = setInterval(poll, 800);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [queueRunId]);

  const fetchResults = async (jobId: string) => {
    try {
      const items = await invoke<VerificationItem[]>("get_verification_items", { jobId });
      setResults(items);
    } catch (e) {
      console.error("Failed to fetch results:", e);
    }
  };

  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    listen<VerificationProgress>("verification-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.phase === "DONE" || event.payload.phase === "FAILED" || event.payload.phase === "CANCELLED") {
        fetchResults(event.payload.job_id);
        loadQueue();
      }
    }).then((u) => { unlistenProgress = u; }).catch(console.error);
    return () => {
      if (unlistenProgress) unlistenProgress();
    };
  }, [projectId]);

  const ensureRow = async () => {
    if (queue.length >= MAX_QUEUE) {
      onError?.({ title: "Queue limit reached", hint: "Safe Copy queue supports up to 5 checks." });
      return;
    }
    const idx = queue.length + 1;
    const row = await invoke<QueueCheck>("set_verification_queue_item", {
      projectId,
      idx,
      sourcePath: idx === 1 ? defaultSourcePath : "",
      destPath: "",
      label: `Check ${String(idx).padStart(2, "0")}`
    });
    setQueue((prev) => [...prev, row].sort((a, b) => a.idx - b.idx));
  };

  const persistRow = async (row: QueueCheck) => {
    const saved = await invoke<QueueCheck>("set_verification_queue_item", {
      projectId,
      idx: row.idx,
      sourcePath: row.source_path,
      destPath: row.dest_path,
      label: row.label ?? ""
    });
    setQueue((prev) => prev.map((q) => (q.idx === saved.idx ? { ...q, ...saved } : q)));
  };

  const updateRow = async (idx: number, patch: Partial<QueueCheck>) => {
    setQueue((prev) =>
      prev.map((row) => (row.idx === idx ? { ...row, ...patch } : row))
    );
    if (persistTimers.current[idx]) {
      window.clearTimeout(persistTimers.current[idx]);
    }
    persistTimers.current[idx] = window.setTimeout(async () => {
      const row = queueRef.current.find((q) => q.idx === idx);
      if (!row) return;
      const nextRow = { ...row, ...patch };
      try {
        await persistRow(nextRow);
        onError?.(null);
      } catch (e) {
        console.error(e);
        onError?.({ title: "Could not save queue row", hint: "Retry editing this row." });
      }
    }, 250);
  };

  const removeRow = async (idx: number) => {
    if (isRunningQueue) return;
    try {
      await invoke("remove_verification_queue_item", { projectId, idx });
      await loadQueue();
    } catch (e) {
      console.error(e);
      onError?.({ title: "Could not remove queue row", hint: "Retry." });
    }
  };


  const choosePath = async (title: string): Promise<string | null> => {
    const selected = await open({ directory: true, multiple: false, title });
    if (!selected || typeof selected !== "string") return null;
    return selected;
  };

  const runQueue = async () => {
    if (queue.length === 0) {
      onError?.({ title: "Queue is empty", hint: "Add at least one source/destination check before running queue." });
      return;
    }
    if (queue.some((q) => !q.source_path || !q.dest_path)) {
      onError?.({ title: "Missing source or destination", hint: "Fill source and destination for all queue rows." });
      return;
    }
    const confirm = window.confirm(`Start ${queue.length} verification checks sequentially?`);
    if (!confirm) return;

    try {
      setResults([]);
      setProgress(null);
      const res = await invoke<QueueRunStartResult>("start_verification_queue", {
        projectId,
        mode
      });
      setQueueRunId(res.queue_run_id);
      setIsRunningQueue(true);
      res.job_ids.forEach((id) => onJobCreated?.(id));
      onError?.(null);
      await loadQueue();
    } catch (e) {
      console.error(e);
      setIsRunningQueue(false);
      onError?.({ title: "Queue run failed to start", hint: "Retry. If this persists, export diagnostics." });
    }
  };

  const cancelQueue = async () => {
    if (!queueRunId) return;
    await invoke("cancel_job", { jobId: queueRunId });
    setIsRunningQueue(false);
  };

  const exportJobPdf = async (jobId: string) => {
    const filePath = await save({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      defaultPath: `Verification_Report_${jobId.slice(0, 8)}.pdf`
    });
    if (!filePath) return;
    const [appInfo, job, items, project] = await Promise.all([
      invoke<AppInfo>("get_app_info"),
      invoke<SafeCopyVerificationJob | null>("get_verification_job", { jobId }),
      invoke<VerificationItem[]>("get_verification_items", { jobId }),
      projectId !== "__global__" ? invoke<ProjectInfo | null>("get_project", { projectId }) : Promise.resolve(null),
    ]);
    if (!job) {
      onError?.({ title: "Verification job not found", hint: "Refresh Safe Copy results and try again." });
      return;
    }
    await saveSafeCopyJobPdf({
      filePath,
      appVersion: appInfo.version,
      projectName: project?.name,
      onWarning: (message) => onError?.({ title: "Export branding fallback", hint: message }),
    }, job, items);
  };

  const exportQueuePdf = async () => {
    const filePath = await save({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      defaultPath: "SafeCopy_Queue_Report.pdf"
    });
    if (!filePath) return;
    const [appInfo, project] = await Promise.all([
      invoke<AppInfo>("get_app_info"),
      projectId !== "__global__" ? invoke<ProjectInfo | null>("get_project", { projectId }) : Promise.resolve(null),
    ]);
    const rows = await Promise.all(
      queue
        .filter((row) => row.last_job_id)
        .map(async (row) => {
          const jobId = row.last_job_id!;
          const [job, items] = await Promise.all([
            invoke<SafeCopyVerificationJob | null>("get_verification_job", { jobId }),
            invoke<VerificationItem[]>("get_verification_items", { jobId }),
          ]);
          return job ? { queue: { idx: row.idx, label: row.label }, job, items } : null;
        })
    );
    const validRows = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (validRows.length === 0) {
      onError?.({ title: "No completed verification data", hint: "Run Safe Copy first, then export the combined PDF." });
      return;
    }
    await saveSafeCopyQueuePdf({
      filePath,
      appVersion: appInfo.version,
      projectName: project?.name,
      onWarning: (message) => onError?.({ title: "Export branding fallback", hint: message }),
    }, validRows);
  };

  const filteredResults = results.filter((item) => {
    const matchesSearch = item.rel_path.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = categoryFilter === "ALL" ||
      (categoryFilter === "PROBLEMS" && item.status !== "OK") ||
      item.status === categoryFilter;
    return matchesSearch && matchesCategory;
  });
  const previewResults = filteredResults.filter((item) => shouldShowVerificationPreviewItem(item.rel_path));

  const percent = progress?.bytes_total ? (progress.bytes_processed / progress.bytes_total) * 100 : 0;

  const queueSummary = useMemo(() => {
    let done = 0;
    let failed = 0;
    let cancelled = 0;
    let running = 0;
    queue.forEach((q) => {
      const s = q.status?.toLowerCase() ?? "queued";
      if (s === "done") done += 1;
      else if (s === "failed") failed += 1;
      else if (s === "cancelled") cancelled += 1;
      else if (s === "running") running += 1;
    });
    return { done, failed, cancelled, running, total: queue.length };
  }, [queue]);

  return (
    <div className="safe-copy-view">
      <div className="safecopy-featured-wrapper">
        {(progress || queue.length > 0) && (
          <div className="verification-dashboard card premium-card safe-copy-summary-card">
            <div className="dashboard-header safe-copy-summary-header">
              <div className="inspector-field">
                <div className="inspector-label">Verification</div>
                <h3>{isRunningQueue ? "Queue Running" : "Queue Summary"}</h3>
              </div>
              <span className="job-id">{queueRunId ? `Queue: ${queueRunId.slice(0, 12)}` : "Idle"}</span>
            </div>

            <div className="dashboard-stats safe-copy-dashboard-stats">
              <div className="dash-stat done">
                <span className="label">Done</span>
                <span className="value ok">{queueSummary.done}</span>
              </div>
              <div className="dash-stat failed">
                <span className="label">Failed</span>
                <span className="value fail">{queueSummary.failed}</span>
              </div>
              <div className="dash-stat total">
                <span className="label">Total</span>
                <span className="value">{queueSummary.total}</span>
              </div>
            </div>

            <div className="verification-queue-summary-list">
              {queue.map((row) => (
                <div key={row.id} className={`verification-queue-summary-item status-${row.status?.toLowerCase() || "queued"}`}>
                  <span className="summary-item-name">{row.source_path ? row.source_path.split(/[\\/]/).pop() : `Check ${String(row.idx).padStart(2, "0")}`}</span>
                  <span className="summary-item-status">{(row.status || "queued").toUpperCase()}</span>
                </div>
              ))}
            </div>

            {progress && (
              <div className="progress-section">
                <div className="progress-info">
                  <span className="current-file">{progress.current_file || "Identifying files..."}</span>
                  <span>{Math.round(percent)}%</span>
                </div>
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${percent}%`, background: "var(--status-blue)" }} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="safe-copy-config card premium-card">
          <div className="dashboard-header safe-copy-header" style={{ marginBottom: 20 }}>
            <div className="safe-copy-title-block">
              <div className="safe-copy-title-icon">
                <ShieldCheck size={18} />
              </div>
              <div className="inspector-field">
                <div className="inspector-label">Safe Copy</div>
                <div className="inspector-meta" style={{ marginTop: 2 }}>Bit-accurate verification & checksums</div>
              </div>
            </div>
            <div className="toolbar-right">
              <button
                className="btn btn-secondary btn-sm safe-copy-add-source"
                onClick={ensureRow}
                disabled={queue.length >= MAX_QUEUE || isRunningQueue}
                data-tooltip="Add another verification pair"
              >
                <Plus size={14} /> Add Source
              </button>
            </div>
          </div>

          <div className="verification-rows-list">
            {queue.map((row, idx) => {
              const status = row.status?.toLowerCase() || "queued";
              const counts = row.counts_json ? JSON.parse(row.counts_json) : null;
              const hasReportActions = Boolean(row.last_job_id);
              const hasStats = Boolean(counts);
              const isSoloRemoveAction = !hasReportActions && !hasStats;

              return (
                <div key={row.id} className="verification-row-container">
                  <div className="row-number-badge">
                    {idx + 1}
                  </div>

                  <div className="verification-row-inputs">
                    <div className="inspector-field">
                      <div className="inspector-label">Source</div>
                      <div className="path-entry">
                        <input
                          type="text"
                          readOnly
                          value={row.source_path}
                          placeholder="Choose source card or folder..."
                          className="premium-input-dark"
                        />
                        <button className="btn-icon-square" onClick={async () => {
                          const p = await choosePath(`Select Source`);
                          if (p) updateRow(row.idx, { source_path: p });
                        }} disabled={isRunningQueue}>
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="inspector-field">
                      <div className="inspector-label">Destination</div>
                      <div className="path-entry">
                        <input
                          type="text"
                          readOnly
                          value={row.dest_path}
                          placeholder="Choose destination folder..."
                          className="premium-input-dark"
                        />
                        <button className="btn-icon-square" onClick={async () => {
                          const p = await choosePath(`Select Destination`);
                          if (p) updateRow(row.idx, { dest_path: p });
                        }} disabled={isRunningQueue}>
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={`row-actions-area ${isSoloRemoveAction ? "solo-action" : ""}`}>
                    <div className="row-status-info">
                      <span className={`status-pill ${status}`}>{status.toUpperCase()}</span>
                      {hasStats && (
                        <div className="row-stats-summary">
                          <CheckCircle size={10} className="ok" /> {counts.verified ?? 0}
                          <XCircle size={10} className="fail" style={{ marginLeft: 6 }} /> {counts.missing ?? 0}
                        </div>
                      )}
                    </div>

                    <div className="row-action-buttons">
                      {hasReportActions && (
                        <button className="btn-mini-action btn-mini-report" onClick={() => exportJobPdf(row.last_job_id!)} title="Export report">
                          <FileText size={14} />
                        </button>
                      )}
                      <button
                        className="btn-mini-action btn-mini-danger"
                        onClick={() => removeRow(row.idx)}
                        disabled={isRunningQueue || queue.length === 1}
                        title="Remove pair"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="safecopy-bottom-controls">
            <div className="safecopy-action-row">
              <div className="mode-selection-group">
                <label>Mode</label>
                <div className="mode-toggle-pill">
                  <button
                    className={`mode-toggle-btn ${mode === "SOLID" ? "active" : ""}`}
                    onClick={() => setMode("SOLID")}
                    disabled={isRunningQueue}
                  >
                    SOLID
                  </button>
                  <button
                    className={`mode-toggle-btn ${mode === "FAST" ? "active" : ""}`}
                    onClick={() => setMode("FAST")}
                    disabled={isRunningQueue}
                  >
                    FAST
                  </button>
                </div>
              </div>

              <div className="verification-primary-actions">
                <button
                  className={`btn btn-primary btn-verification-start ${isRunningQueue ? "is-running" : ""}`}
                  onClick={runQueue}
                  disabled={isRunningQueue || queue.length === 0 || queue.some((q) => !q.source_path || !q.dest_path)}
                >
                  {isRunningQueue ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <Play size={14} fill="currentColor" />}
                  <span>{isRunningQueue ? "Verifying..." : "Start Verification"}</span>
                </button>

                {isRunningQueue && (
                  <button className="btn btn-danger btn-lg-circle" onClick={cancelQueue}>
                    <XCircle size={18} />
                  </button>
                )}
              </div>

              <div className="batch-export-row">
                <button className="btn btn-secondary btn-sm btn-queue-export" onClick={exportQueuePdf} disabled={queue.length === 0}>
                  <ListChecks size={14} /> Export Combined Report
                </button>
              </div>
            </div>
          </div>
        </div>

        {results.length > 0 && (
          <div className="results-container card premium-card">
            <div className="results-toolbar">
              <div className="toolbar-left">
                <div className="results-heading">
                  <span className="summary-kicker">Processed Files</span>
                  <h3>Files Overview</h3>
                </div>
                <div className="search-box">
                  <Search size={14} />
                  <input type="text" placeholder="Search video files..." value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <div className="filter-tabs">
                  <button className={`tab ${categoryFilter === "ALL" ? "active" : ""}`} onClick={() => setCategoryFilter("ALL")}>All</button>
                  <button className={`tab tab-problems ${categoryFilter === "PROBLEMS" ? "active" : ""}`} onClick={() => setCategoryFilter("PROBLEMS")}>Problems</button>
                  <button className={`tab tab-verified ${categoryFilter === "OK" ? "active" : ""}`} onClick={() => setCategoryFilter("OK")}>Verified</button>
                </div>
              </div>
            </div>

            <div className="results-table-scroll" style={{ height: 400 }}>
              <TableVirtuoso
                data={previewResults}
                useWindowScroll={false}
                fixedHeaderContent={() => (
                  <tr style={{ background: "var(--bg-darker)" }}>
                    <th style={{ width: 120 }}>Status</th>
                    <th>Relative Path</th>
                    <th style={{ width: 100 }}>Size</th>
                    <th>Details</th>
                  </tr>
                )}
                itemContent={(_index, item) => (
                  <>
                    <td className="status-cell">
                      {item.status === "OK" ? <CheckCircle size={14} className="ok" /> :
                        item.status === "MISSING" ? <XCircle size={14} className="fail" /> :
                          <AlertTriangle size={14} className="warn" />}
                      <span className={`status-label ${item.status === "OK" ? "ok" : "fail"}`}>{item.status === "OK" ? "VERIFIED" : item.status}</span>
                    </td>
                    <td className="path-cell">{item.rel_path}</td>
                    <td className="size-cell">{formatFileSize(item.source_size)}</td>
                    <td className="detail-cell">{item.error_message || "—"}</td>
                  </>
                )}
                components={{
                  Table: ({ ...props }) => <table {...props} className="results-table" style={{ borderCollapse: 'collapse', width: '100%' }} />,
                  TableRow: ({ item: _item, ...props }) => {
                    const item = previewResults[props['data-index']];
                    return <tr {...props} className={item?.status === "OK" ? "row-ok" : "row-fail"} />;
                  }
                }}
              />

              {previewResults.length === 0 && (
                <div className="results-empty-state">
                  Verification checked every file in the source, but this preview only shows video files.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
