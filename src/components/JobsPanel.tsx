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

export function JobsPanel({ open, jobs, onClose, onRefresh, extracting, extractProgress, scanning }: JobsPanelProps) {
  const [purging, setPurging] = useState(false);
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

  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const completedJobs = jobs.filter((j) => j.status === "done");
  const failedJobs = jobs.filter((j) => j.status === "failed" || j.status === "cancelled");

  return (
    <div className="jobs-drawer-backdrop" onClick={onClose}>
      <aside className="jobs-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="jobs-header">
          <h3>Jobs & Activity</h3>
          <button className="btn-link" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Live Status */}
        {(scanning || extracting) && (
          <div className="jobs-live-section">
            <div className="jobs-live-banner">
              <Loader2 size={16} className="status-icon-running" />
              <div className="jobs-live-info">
                <span className="jobs-live-title">
                  {scanning ? "Scanning folder…" : "Extracting thumbnails…"}
                </span>
                {extracting && extractProgress && (
                  <div className="jobs-live-progress">
                    <div className="progress-bar-bg" style={{ height: 4 }}>
                      <div className="progress-bar-fill" style={{ width: `${(extractProgress.done / (extractProgress.total || 1)) * 100}%` }} />
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

        {/* Job List */}
        {jobs.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px', fontSize: '0.82rem' }}>No jobs yet. Load footage to start processing.</div>
        ) : (
          <div className="jobs-list">
            {jobs.map((job) => (
              <div key={job.id} className={`job-item status-${job.status}`}>
                <div className="job-title-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusIcon status={job.status} />
                    <strong>{job.kind}</strong>
                  </div>
                  <span className={`job-status-badge badge-${job.status}`}>{job.status}</span>
                </div>
                {(job.status === "running" || job.status === "queued") && (
                  <div className="progress-bar-wrapper">
                    <div className="progress-bar-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                )}
                <div className="job-meta">
                  <span>{Math.round(job.progress * 100)}%</span>
                  <span style={{ flex: 1, textAlign: 'right', opacity: 0.7 }}>{job.message}</span>
                </div>
                {job.error && <div className="job-error-banner"><AlertTriangle size={12} /> {job.error}</div>}
                {job.status === "running" && (
                  <button className="btn btn-secondary btn-sm" onClick={() => cancelJob(job.id)} style={{ marginTop: 4 }}>
                    <CirclePause size={14} /> Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Purge Section */}
        <div className="jobs-purge-section">
          <div className="jobs-purge-header">
            <span className="jobs-purge-title">Cache Management</span>
          </div>
          <p className="jobs-purge-desc">Clear thumbnails, LUT renders, and detection data to free disk space.</p>
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
      </aside>
    </div>
  );
}
