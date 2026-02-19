import { X } from "lucide-react";
import { AppInfo } from "../types";

interface AboutPanelProps {
  open: boolean;
  info: AppInfo | null;
  onResetTour?: () => void;
  onClose: () => void;
}

export function AboutPanel({ open, info, onResetTour, onClose }: AboutPanelProps) {
  if (!open) return null;
  return (
    <div className="jobs-drawer-backdrop" onClick={onClose}>
      <div className="about-panel" onClick={(e) => e.stopPropagation()}>
        <div className="jobs-header">
          <h3>About Wrap Preview</h3>
          <button className="btn-link" onClick={onClose}><X size={16} /></button>
        </div>
        {!info ? (
          <p>Loading app information…</p>
        ) : (
          <>
            <div className="about-grid">
              <div><strong>Version</strong><p>{info.version}</p></div>
              <div><strong>Build Date</strong><p>{info.build_date}</p></div>
              <div><strong>FFmpeg</strong><p>{info.ffmpeg_version}</p></div>
              <div><strong>ffprobe</strong><p>{info.ffprobe_version}</p></div>
              <div><strong>macOS</strong><p>{info.macos_version}</p></div>
              <div><strong>Architecture</strong><p>{info.arch}</p></div>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary btn-sm" onClick={onResetTour}>
                Reset Tour
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
