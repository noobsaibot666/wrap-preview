import { invoke } from "@tauri-apps/api/core";
import { X, CirclePause } from "lucide-react";
import { JobInfo } from "../types";

interface JobsPanelProps {
  open: boolean;
  jobs: JobInfo[];
  onClose: () => void;
  onRefresh: () => void;
}

export function JobsPanel({ open, jobs, onClose, onRefresh }: JobsPanelProps) {
  if (!open) return null;

  const cancelJob = async (jobId: string) => {
    await invoke("cancel_job", { jobId });
    onRefresh();
  };

  return (
    <div className="jobs-drawer-backdrop" onClick={onClose}>
      <aside className="jobs-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="jobs-header">
          <h3>Jobs</h3>
          <button className="btn-link" onClick={onClose}><X size={16} /></button>
        </div>
        {jobs.length === 0 ? (
          <div className="empty-state">No jobs yet.</div>
        ) : (
          <div className="jobs-list">
            {jobs.map((job) => (
              <div key={job.id} className={`job-item status-${job.status}`}>
                <div className="job-title-row">
                  <strong>{job.kind}</strong>
                  <span>{job.status}</span>
                </div>
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
                <div className="job-meta">
                  <span>{Math.round(job.progress * 100)}%</span>
                  <span>{job.message}</span>
                </div>
                <div className="job-meta">
                  <code>{job.id.slice(0, 8)}</code>
                  <span>{new Date(job.updated_at).toLocaleString()}</span>
                </div>
                {job.error && <div className="error-banner">{job.error}</div>}
                {job.status === "running" && (
                  <button className="btn btn-secondary btn-sm" onClick={() => cancelJob(job.id)}>
                    <CirclePause size={14} /> Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

