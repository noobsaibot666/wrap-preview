import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Play, XCircle, CheckCircle, AlertTriangle, Search, FileText, ListChecks, Plus, Trash2 } from "lucide-react";

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
  sourcePath: string;
  sourceLabel: string;
  destPath: string;
  destLabel: string;
  status: "queued" | "running" | "done" | "failed";
  jobId?: string;
}

interface SafeCopyProps {
  onJobCreated?: (jobId: string) => void;
  onError?: (error: { title: string; hint: string } | null) => void;
}

export function SafeCopy({ onJobCreated, onError }: SafeCopyProps) {
  const [sourcePath, setSourcePath] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Source");
  const [destPath, setDestPath] = useState("");
  const [destLabel, setDestLabel] = useState("Destination");
  const [mode, setMode] = useState<"SOLID" | "FAST">("SOLID");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRunningQueue, setIsRunningQueue] = useState(false);
  const [progress, setProgress] = useState<VerificationProgress | null>(null);
  const [results, setResults] = useState<VerificationItem[]>([]);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [queue, setQueue] = useState<QueueCheck[]>([]);
  const [queueJobIds, setQueueJobIds] = useState<string[]>([]);

  useEffect(() => {
    const unlisten = listen<VerificationProgress>("verification-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.phase === "DONE" || event.payload.phase === "FAILED" || event.payload.phase === "CANCELLED") {
        setIsVerifying(false);
        fetchResults(event.payload.job_id);
      }
    });

    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  const fetchResults = async (jobId: string) => {
    try {
      const items = await invoke<VerificationItem[]>("get_verification_items", { jobId });
      setResults(items);
    } catch (e) {
      console.error("Failed to fetch results:", e);
    }
  };

  const handleSelectSource = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Source Folder (Card)" });
    if (selected) setSourcePath(selected as string);
  };

  const handleSelectDest = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Destination Folder" });
    if (selected) setDestPath(selected as string);
  };

  const startVerification = async (sourceRoot: string, sourceName: string, destRoot: string, destName: string): Promise<string> => {
    const jobId = await invoke<string>("start_verification", {
      sourceRoot,
      sourceLabel: sourceName,
      destRoot,
      destLabel: destName,
      mode
    });
    onJobCreated?.(jobId);
    return jobId;
  };

  const waitForJobCompletion = async (jobId: string): Promise<void> => {
    while (true) {
      const job = await invoke<any>("get_verification_job", { jobId });
      if (job && (job.status === "DONE" || job.status === "FAILED" || job.status === "CANCELLED")) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  const handleStart = async () => {
    if (!sourcePath || !destPath) {
      onError?.({ title: "Missing source or destination", hint: "Select both folders before starting verification." });
      return;
    }
    const confirm = window.confirm("Start verification job now?");
    if (!confirm) return;
    setIsVerifying(true);
    setResults([]);
    setProgress(null);
    try {
      await startVerification(sourcePath, sourceLabel, destPath, destLabel);
      onError?.(null);
    } catch (_e) {
      onError?.({ title: "Verification failed to start", hint: "Retry. If this keeps happening, export diagnostics and share with the team." });
      setIsVerifying(false);
    }
  };

  const addToQueue = () => {
    if (!sourcePath || !destPath) {
      onError?.({ title: "Missing source or destination", hint: "Select both folders before adding a queue check." });
      return;
    }
    if (queue.length >= 5) {
      onError?.({ title: "Queue limit reached", hint: "Safe Copy queue supports up to 5 checks." });
      return;
    }
    const item: QueueCheck = {
      id: crypto.randomUUID(),
      sourcePath,
      sourceLabel: sourceLabel.trim() || `Source ${String(queue.length + 1).padStart(2, "0")}`,
      destPath,
      destLabel: destLabel.trim() || `Destination ${String(queue.length + 1).padStart(2, "0")}`,
      status: "queued"
    };
    setQueue((prev) => [...prev, item]);
    onError?.(null);
  };

  const removeFromQueue = (id: string) => {
    if (isRunningQueue) return;
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const runQueue = async () => {
    if (queue.length === 0) {
      onError?.({ title: "Queue is empty", hint: "Add at least one source/destination check before running queue." });
      return;
    }
    const confirm = window.confirm(`Start ${queue.length} verification checks sequentially?`);
    if (!confirm) return;
    setIsRunningQueue(true);
    setQueueJobIds([]);
    setResults([]);
    try {
      for (const q of queue) {
        setQueue((prev) => prev.map((item) => (item.id === q.id ? { ...item, status: "running" } : item)));
        const jobId = await startVerification(q.sourcePath, q.sourceLabel, q.destPath, q.destLabel);
        setQueue((prev) => prev.map((item) => (item.id === q.id ? { ...item, jobId } : item)));
        setQueueJobIds((prev) => [...prev, jobId]);
        await waitForJobCompletion(jobId);
        const doneJob = await invoke<any>("get_verification_job", { jobId });
        const failed = !doneJob || (doneJob.status !== "DONE" && doneJob.status !== "CANCELLED");
        setQueue((prev) => prev.map((item) => (item.id === q.id ? { ...item, status: failed ? "failed" : "done" } : item)));
      }
      onError?.(null);
    } catch (e) {
      console.error("Queue execution failed", e);
      onError?.({ title: "Queue run failed", hint: "One check failed to start or complete. Review rows and retry." });
    } finally {
      setIsRunningQueue(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!progress?.job_id) return;
    try {
      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: `Verification_Report_${progress.job_id.slice(0, 8)}.md`
      });
      if (path) {
        await invoke("export_verification_report_markdown", { jobId: progress.job_id, savePath: path });
      }
    } catch (_e) {
      onError?.({ title: "Failed to export verification markdown", hint: "Check output folder permissions and retry." });
    }
  };

  const handleExportPdf = async () => {
    if (!progress?.job_id) return;
    try {
      const path = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: `Verification_Report_${progress.job_id.slice(0, 8)}.pdf`
      });
      if (path) {
        await invoke("export_verification_report_pdf", { jobId: progress.job_id, savePath: path });
      }
    } catch (_e) {
      onError?.({ title: "Failed to export verification PDF", hint: "Check output folder permissions and retry." });
    }
  };

  const handleExportQueueMarkdown = async () => {
    if (queueJobIds.length === 0) return;
    const path = await save({
      filters: [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: "Verification_Queue_Report.md"
    });
    if (!path) return;
    await invoke("export_verification_queue_report_markdown", { jobIds: queueJobIds, savePath: path });
  };

  const handleExportQueuePdf = async () => {
    if (queueJobIds.length === 0) return;
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "Verification_Queue_Report.pdf"
    });
    if (!path) return;
    await invoke("export_verification_queue_report_pdf", { jobIds: queueJobIds, savePath: path });
  };

  const filteredResults = results.filter((item) => {
    const matchesSearch = item.rel_path.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = categoryFilter === "ALL" ||
      (categoryFilter === "PROBLEMS" && item.status !== "OK") ||
      item.status === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const percent = progress?.bytes_total ? (progress.bytes_processed / progress.bytes_total) * 100 : 0;

  return (
    <div className="safe-copy-view">
      <div className="safecopy-featured-wrapper">
        <div className="safe-copy-config card">
          <div className="config-grid">
            <div className="config-item">
              <label>Source (Card A)</label>
              <div className="path-picker">
                <input type="text" readOnly value={sourcePath} placeholder="Choose source..." />
                <button className="btn btn-secondary btn-sm" onClick={handleSelectSource} disabled={isVerifying || isRunningQueue}>
                  <FolderOpen size={14} />
                </button>
              </div>
              <input className="input-text mt-2" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Source label" />
            </div>
            <div className="config-item">
              <label>Destination (Folder B)</label>
              <div className="path-picker">
                <input type="text" readOnly value={destPath} placeholder="Choose destination..." />
                <button className="btn btn-secondary btn-sm" onClick={handleSelectDest} disabled={isVerifying || isRunningQueue}>
                  <FolderOpen size={14} />
                </button>
              </div>
              <input className="input-text mt-2" value={destLabel} onChange={(e) => setDestLabel(e.target.value)} placeholder="Destination label" />
            </div>
            <div className="config-item">
              <label>Mode</label>
              <div className="mode-toggle">
                <button className={`btn-toggle ${mode === "SOLID" ? "active" : ""}`} onClick={() => setMode("SOLID")} disabled={isVerifying || isRunningQueue}>
                  SOLID (Bit-Accurate)
                </button>
                <button className={`btn-toggle ${mode === "FAST" ? "active" : ""}`} onClick={() => setMode("FAST")} disabled={isVerifying || isRunningQueue}>
                  FAST (Metadata)
                </button>
              </div>
            </div>
          </div>
          <div className="config-actions" style={{ gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-lg" onClick={handleStart} disabled={!sourcePath || !destPath || isRunningQueue || isVerifying}>
              <Play size={18} /> Start Verification
            </button>
            <button className="btn btn-secondary btn-lg" onClick={addToQueue} disabled={!sourcePath || !destPath || isRunningQueue || queue.length >= 5}>
              <Plus size={18} /> Add Check
            </button>
            <button className="btn btn-secondary btn-lg" onClick={runQueue} disabled={queue.length === 0 || isRunningQueue || isVerifying}>
              <ListChecks size={18} /> Run Queue ({queue.length}/5)
            </button>
          </div>
        </div>

        {queue.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="dashboard-header">
              <h3>Verification Queue</h3>
              <div className="toolbar-right" style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={handleExportQueueMarkdown} disabled={queueJobIds.length === 0}><FileText size={14} /> Queue MD</button>
                <button className="btn btn-secondary btn-sm" onClick={handleExportQueuePdf} disabled={queueJobIds.length === 0}><FileText size={14} /> Queue PDF</button>
              </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {queue.map((item, index) => (
                <div key={item.id} className="workspace-root-item">
                  <strong style={{ minWidth: 46 }}>{String(index + 1).padStart(2, "0")}</strong>
                  <span className="workspace-root-path">{item.sourceLabel} → {item.destLabel}</span>
                  <span className={`status-pill ${item.status}`}>{item.status.toUpperCase()}</span>
                  <button className="btn btn-danger btn-sm" onClick={() => removeFromQueue(item.id)} disabled={isRunningQueue}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {progress && (
          <div className="verification-dashboard card">
            <div className="dashboard-header">
              <h3>{progress.phase === "DONE" ? "Verification Complete" : `Phase: ${progress.phase}`}</h3>
              <span className="job-id">Job: {progress.job_id.slice(0, 8)}</span>
            </div>

            <div className="dashboard-stats">
              <div className="dash-stat">
                <span className="label">Verified</span>
                <span className="value ok">{progress.ok_count}</span>
              </div>
              <div className="dash-stat">
                <span className="label">Problems Found</span>
                <span className="value fail">{progress.mismatch_count + progress.missing_count}</span>
              </div>
              <div className="dash-stat">
                <span className="label">Total Files</span>
                <span className="value">{progress.files_total}</span>
              </div>
            </div>

            <div className="progress-section">
              <div className="progress-info">
                <span className="current-file">{progress.current_file || "Identifying files..."}</span>
                <span>{Math.round(percent)}%</span>
              </div>
              <div className="progress-bar-wrapper">
                <div className="progress-bar-fill" style={{ width: `${percent}%`, background: progress.phase === "DONE" ? "var(--color-primary)" : "var(--accent-glow)" }} />
              </div>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="results-container card">
            <div className="results-toolbar">
              <div className="toolbar-left">
                <div className="search-box">
                  <Search size={14} />
                  <input type="text" placeholder="Search files..." value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <div className="filter-tabs">
                  <button className={`tab ${categoryFilter === "ALL" ? "active" : ""}`} onClick={() => setCategoryFilter("ALL")}>All</button>
                  <button className={`tab ${categoryFilter === "PROBLEMS" ? "active" : ""}`} onClick={() => setCategoryFilter("PROBLEMS")}>Problems</button>
                  <button className={`tab ${categoryFilter === "OK" ? "active" : ""}`} onClick={() => setCategoryFilter("OK")}>Verified</button>
                </div>
              </div>
              <div className="toolbar-right">
                <button className="btn btn-secondary btn-sm" onClick={handleExportMarkdown} disabled={!progress}><FileText size={14} /> Export MD</button>
                <button className="btn btn-secondary btn-sm" onClick={handleExportPdf} disabled={!progress}><FileText size={14} /> Export PDF</button>
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
                        <span className="status-label">{item.status}</span>
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
