import { invoke } from "@tauri-apps/api/core";
import { X, CirclePause, Trash2, CheckCircle2, AlertTriangle, Loader2, Clock } from "lucide-react";
import { JobInfo } from "../types";
import { useState } from "react";

interface JobsPanelProps {
  open: boolean;
  jobs: JobInfo[];
  onClose: () => void;
  onRefresh: () => void;
  extracting?: boolean;
  extractProgress?: { done: number; total: number };
  scanning?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <CheckCircle2 size={14} className="status-icon-done" />;
    case "failed":
      return <AlertTriangle size={14} className="status-icon-failed" />;
    case "running":
      return <Loader2 size={14} className="status-icon-running" />;
    case "queued":
      return <Clock size={14} className="status-icon-queued" />;
    case "cancelled":
      return <CirclePause size={14} className="status-icon-cancelled" />;
    default:
      return null;
  }
}

function JobSection({
  title,
  emptyState,
  jobs,
  cancelJob,
}: {
  title: string;
  emptyState: string;
  jobs: JobInfo[];
  cancelJob: (jobId: string) => void;
}) {
  return (
    <section className="jobs-section">
      <div className="jobs-section-header">
        <span className="jobs-section-title">{title}</span>
        <span className="jobs-section-count">{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <div className="jobs-section-empty">{emptyState}</div>
      ) : (
        <div className="jobs-list">
          {jobs.map((job) => (
            <div key={job.id} className={`job-item status-${job.status}`}>
              <div className="job-title-row">
                <div className="job-title-main">
                  <StatusIcon status={job.status} />
                  <strong>{job.kind}</strong>
                </div>
                <span className={`job-status-badge badge-${job.status}`}>{job.status}</span>
              </div>
              {(job.status === "running" || job.status === "queued") && (
                <div className="progress-bar-wrapper jobs-row-progress">
                  <div className="progress-bar-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
              )}
              <div className="job-meta">
                <span>{Math.round(job.progress * 100)}%</span>
                <span className="job-message">{job.message}</span>
              </div>
              {job.error && <div className="job-error-banner"><AlertTriangle size={12} /> {job.error}</div>}
              {job.status === "running" && (
                <button className="btn btn-secondary btn-sm job-cancel-btn" onClick={() => cancelJob(job.id)}>
                  <CirclePause size={14} /> Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function JobsPanel({ open, jobs, onClose, onRefresh, extracting, extractProgress, scanning }: JobsPanelProps) {
  const [purging, setPurging] = useState(false);
  const [resettingDevData, setResettingDevData] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ freed_bytes: number; removed_files: number } | null>(null);

  if (!open) return null;

  const cancelJob = async (jobId: string) => {
    await invoke("cancel_job", { jobId });
    onRefresh();
  };

  const handlePurge = async () => {
    if (!confirm("This will clear all cached thumbnails, LUT renders, and detection data. You will need to re-scan and re-extract. Continue?")) {
      return;
    }
    setPurging(true);
    try {
      const result = await invoke<{ freed_bytes: number; removed_files: number }>("purge_cache");
      setPurgeResult(result);
    } catch (e) {
      console.error("Purge failed:", e);
    } finally {
      setPurging(false);
    }
  };

  const handleResetDevData = async () => {
    if (!confirm("This will wipe wrap-preview-dev data and reload the app.")) {
      return;
    }
    setResettingDevData(true);
    onClose();

    const reload = () => {
      window.setTimeout(() => {
        window.location.reload();
      }, 120);
    };

    try {
      const resetPromise = invoke<{ ok: boolean }>("dev_reset_all_data");
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("reset timeout")), 1500);
      });
      await Promise.race([resetPromise, timeoutPromise]);
      reload();
    } catch (e) {
      console.warn("Reset dev data did not confirm before reload:", e);
      reload();
    }
  };

  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const completedJobs = jobs.filter((j) => j.status === "done");
  const failedJobs = jobs.filter((j) => j.status === "failed" || j.status === "cancelled");

  return (
    <div className="jobs-drawer-backdrop" onClick={onClose}>
      <aside className="jobs-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="jobs-header">
          <h3>Jobs & History</h3>
          <button className="btn-link" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Live Status */}
        {(scanning || extracting) && (
          <div className="jobs-live-section">
            <div className="jobs-live-banner">
              <Loader2 size={14} className="status-icon-running" style={{ marginTop: 2 }} />
              <div className="jobs-live-info">
                <div className="inspector-field">
                  <div className="inspector-label" style={{ color: "var(--status-blue)", opacity: 0.8 }}>
                    {scanning ? "Scanning" : "Processing"}
                  </div>
                  <div className="jobs-live-title" style={{ fontSize: "12px", fontWeight: 600 }}>
                    {scanning ? "Scanning folder…" : "Extracting thumbnails…"}
                  </div>
                </div>
                {extracting && extractProgress && (
                  <div className="jobs-live-progress">
                    <div className="progress-bar-bg" style={{ height: 3, background: "rgba(59, 130, 246, 0.1)" }}>
                      <div className="progress-bar-fill" style={{ width: `${(extractProgress.done / (extractProgress.total || 1)) * 100}%`, background: "var(--status-blue)" }} />
                    </div>
                    <span className="jobs-live-count">{extractProgress.done}/{extractProgress.total} clips</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="jobs-summary-bar">
          <div className="jobs-summary-stat">
            <span className="jobs-summary-count">{runningJobs.length}</span>
            <span className="jobs-summary-label">Running</span>
          </div>
          <div className="jobs-summary-stat">
            <span className="jobs-summary-count">{completedJobs.length}</span>
            <span className="jobs-summary-label">Done</span>
          </div>
          <div className="jobs-summary-stat jobs-summary-fail">
            <span className="jobs-summary-count">{failedJobs.length}</span>
            <span className="jobs-summary-label">Failed</span>
          </div>
        </div>

        <div className="jobs-sections">
          <JobSection
            title="Active"
            emptyState="No running or queued jobs."
            jobs={runningJobs}
            cancelJob={cancelJob}
          />
          <JobSection
            title="Completed"
            emptyState="Completed jobs will appear here."
            jobs={completedJobs}
            cancelJob={cancelJob}
          />
          <JobSection
            title="Issues"
            emptyState="No failed or cancelled jobs."
            jobs={failedJobs}
            cancelJob={cancelJob}
          />
        </div>

        {/* Purge Section */}
        <div className="jobs-purge-section">
          <div className="jobs-purge-header inspector-field">
            <div className="inspector-label">Storage</div>
            <div className="jobs-purge-title" style={{ fontSize: "13px", fontWeight: 600, marginTop: 2 }}>Cache Management</div>
          </div>
          <p className="inspector-meta" style={{ margin: "8px 0 12px" }}>Clear thumbnails, LUT renders, and detection data to free disk space.</p>
          {purgeResult && (
            <div className="jobs-purge-result">
              <CheckCircle2 size={14} /> Freed {formatBytes(purgeResult.freed_bytes)} ({purgeResult.removed_files} files)
            </div>
          )}
          <button className="btn btn-secondary btn-sm jobs-purge-btn" onClick={handlePurge} disabled={purging}>
            {purging ? <Loader2 size={14} className="status-icon-running" /> : <Trash2 size={14} />}
            <span>{purging ? "Purging…" : "Purge Cache"}</span>
          </button>
        </div>
        {import.meta.env.DEV && (
          <div className="jobs-purge-section jobs-maintenance-section">
            <div className="jobs-purge-header">
              <span className="jobs-purge-title">Maintenance</span>
            </div>
            <p className="jobs-purge-desc">Debug-only workspace cleanup and recovery actions.</p>
            <button className="btn btn-secondary btn-sm jobs-purge-btn" onClick={handleResetDevData} disabled={resettingDevData}>
              {resettingDevData ? <Loader2 size={14} className="status-icon-running" /> : <Trash2 size={14} />}
              <span>{resettingDevData ? "Resetting…" : "Reset Dev Data"}</span>
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
