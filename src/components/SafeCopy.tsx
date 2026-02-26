import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Play, XCircle, CheckCircle, AlertTriangle, Search, FileText, ListChecks, Plus, Trash2, ShieldCheck } from "lucide-react";

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

export function SafeCopy({ projectId, onJobCreated, onError }: SafeCopyProps) {
  const [mode, setMode] = useState<"FAST" | "SOLID">("SOLID");
  const [queue, setQueue] = useState<QueueCheck[]>([]);
  const [queueRunId, setQueueRunId] = useState<string | null>(null);
  const [isRunningQueue, setIsRunningQueue] = useState(false);
  const [progress, setProgress] = useState<VerificationProgress | null>(null);
  const [results, setResults] = useState<VerificationItem[]>([]);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const persistTimers = useRef<Record<number, number>>({});
  const queueRef = useRef<QueueCheck[]>([]);

  const loadQueue = async (initial = false) => {
    try {
      const rows = await invoke<QueueCheck[]>("list_verification_queue", { projectId });
      setQueue(rows.sort((a, b) => a.idx - b.idx));

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
    setActiveJobId(null);
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
      setActiveJobId(jobId);
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
      sourcePath: "",
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

  const exportJobMarkdown = async (jobId: string) => {
    const outDir = await choosePath("Export Verification Markdown");
    if (!outDir) return;
    await invoke("export_verification_report_markdown", { jobId, outDir });
  };

  const exportJobPdf = async (jobId: string) => {
    const outDir = await choosePath("Export Verification PDF");
    if (!outDir) return;
    await invoke("export_verification_report_pdf", { jobId, outDir });
  };

  const exportQueueMarkdown = async () => {
    const outDir = await choosePath("Export Combined Queue Markdown");
    if (!outDir) return;
    await invoke("export_verification_queue_report_markdown", { projectId, outDir });
  };

  const exportQueuePdf = async () => {
    const outDir = await choosePath("Export Combined Queue PDF");
    if (!outDir) return;
    await invoke("export_verification_queue_report_pdf", { projectId, outDir });
  };

  const filteredResults = results.filter((item) => {
    const matchesSearch = item.rel_path.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = categoryFilter === "ALL" ||
      (categoryFilter === "PROBLEMS" && item.status !== "OK") ||
      item.status === categoryFilter;
    return matchesSearch && matchesCategory;
  });

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
        <div className="safe-copy-config card premium-card">
          <div className="dashboard-header" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="module-icon" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
                <ShieldCheck size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0 }}>Safe Copy</h3>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Bit-accurate verification & checksums</p>
              </div>
            </div>
            <div className="toolbar-right">
              <button
                className="btn btn-secondary btn-sm"
                onClick={ensureRow}
                disabled={queue.length >= MAX_QUEUE || isRunningQueue}
                style={{ height: 32, padding: '0 12px', gap: 6 }}
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

              return (
                <div key={row.id} className="verification-row-container">
                  <div className="row-number-badge">
                    {idx + 1}
                  </div>

                  <div className="verification-row-inputs">
                    <div className="input-field-group">
                      <label>SOURCE {queue.length > 1 ? `(${idx + 1})` : ''}</label>
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
                          <FolderOpen size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="input-field-group">
                      <label>DESTINATION {queue.length > 1 ? `(${idx + 1})` : ''}</label>
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
                          <FolderOpen size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="row-actions-area">
                    <div className="row-status-info">
                      <span className={`status-pill ${status}`}>{status.toUpperCase()}</span>
                      {counts && (
                        <div className="row-stats-summary">
                          <CheckCircle size={10} className="ok" /> {counts.verified ?? 0}
                          <XCircle size={10} className="fail" style={{ marginLeft: 6 }} /> {counts.missing ?? 0}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {row.last_job_id && (
                        <>
                          <button className="btn-mini-action" onClick={() => exportJobMarkdown(row.last_job_id!)} title="Markdown Report">
                            <FileText size={12} />
                          </button>
                          <button className="btn-mini-action" onClick={() => exportJobPdf(row.last_job_id!)} title="PDF Report">
                            <FileText size={12} />
                          </button>
                        </>
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
            <div className="mode-selection-group">
              <label>MODE</label>
              <div className="mode-toggle-pill">
                <button
                  className={`mode-toggle-btn ${mode === "SOLID" ? "active" : ""}`}
                  onClick={() => setMode("SOLID")}
                  disabled={isRunningQueue}
                >
                  SOLID (Bit-Accurate)
                </button>
                <button
                  className={`mode-toggle-btn ${mode === "FAST" ? "active" : ""}`}
                  onClick={() => setMode("FAST")}
                  disabled={isRunningQueue}
                >
                  FAST (Metadata)
                </button>
              </div>
            </div>

            <div className="verification-primary-actions">
              <button
                className="btn btn-primary btn-verification-start"
                onClick={runQueue}
                disabled={isRunningQueue || queue.length === 0 || queue.some((q) => !q.source_path || !q.dest_path)}
              >
                {isRunningQueue ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <Play size={18} fill="currentColor" />}
                <span>{isRunningQueue ? "Verifying..." : "Start Verification"}</span>
              </button>

              {isRunningQueue && (
                <button className="btn btn-danger btn-lg-circle" onClick={cancelQueue}>
                  <XCircle size={20} />
                </button>
              )}
            </div>

            {queue.length > 0 && (
              <div className="batch-export-row">
                <button className="btn-text-action" onClick={exportQueueMarkdown} disabled={queue.length === 0}>
                  <ListChecks size={14} /> Export Combined MD
                </button>
                <button className="btn-text-action" onClick={exportQueuePdf} disabled={queue.length === 0}>
                  <ListChecks size={14} /> Export Combined PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {(progress || queue.length > 0) && (
          <div className="verification-dashboard card premium-card">
            <div className="dashboard-header">
              <h3>{isRunningQueue ? "Queue Running" : "Queue Summary"}</h3>
              <span className="job-id">{queueRunId ? `Queue: ${queueRunId.slice(0, 12)}` : "Idle"}</span>
            </div>

            <div className="dashboard-stats">
              <div className="dash-stat">
                <span className="label">Done</span>
                <span className="value ok">{queueSummary.done}</span>
              </div>
              <div className="dash-stat">
                <span className="label">Failed</span>
                <span className="value fail">{queueSummary.failed}</span>
              </div>
              <div className="dash-stat">
                <span className="label">Cancelled</span>
                <span className="value">{queueSummary.cancelled}</span>
              </div>
              <div className="dash-stat">
                <span className="label">Total</span>
                <span className="value">{queueSummary.total}</span>
              </div>
            </div>

            {progress && (
              <div className="progress-section">
                <div className="progress-info">
                  <span className="current-file">{progress.current_file || "Identifying files..."}</span>
                  <span>{Math.round(percent)}%</span>
                </div>
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${percent}%`, background: "var(--color-accent-indigo)" }} />
                </div>
              </div>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="results-container card premium-card">
            <div className="results-toolbar">
              <div className="toolbar-left">
                <div className="search-box">
                  <Search size={14} />
                  <input type="text" placeholder="Search files..." value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <div className="filter-tabs">
                  <button className={`tab ${categoryFilter === "ALL" ? "active" : ""}`} onClick={() => setCategoryFilter("ALL")}>All</button>
                  <button className={`tab tab-problems ${categoryFilter === "PROBLEMS" ? "active" : ""}`} onClick={() => setCategoryFilter("PROBLEMS")}>Problems</button>
                  <button className={`tab tab-verified ${categoryFilter === "OK" ? "active" : ""}`} onClick={() => setCategoryFilter("OK")}>Verified</button>
                </div>
              </div>
              <div className="toolbar-right">
                {activeJobId && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => exportJobMarkdown(activeJobId)}><FileText size={14} /> Export MD</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => exportJobPdf(activeJobId)}><FileText size={14} /> Export PDF</button>
                  </>
                )}
              </div>
            </div>

            <div className="results-table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Relative Path</th>
                    <th>Size</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.slice(0, 100).map((item, i) => (
                    <tr key={i} className={item.status === "OK" ? "row-ok" : "row-fail"}>
                      <td className="status-cell">
                        {item.status === "OK" ? <CheckCircle size={14} className="ok" /> :
                          item.status === "MISSING" ? <XCircle size={14} className="fail" /> :
                            <AlertTriangle size={14} className="warn" />}
                        <span className={`status-label ${item.status === "OK" ? "ok" : "fail"}`}>{item.status === "OK" ? "VERIFIED" : item.status}</span>
                      </td>
                      <td className="path-cell">{item.rel_path}</td>
                      <td className="size-cell">{formatFileSize(item.source_size)}</td>
                      <td className="detail-cell">{item.error_message || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredResults.length > 100 && <div className="table-footer">Showing first 100 results...</div>}
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
