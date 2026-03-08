import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { AppInfo } from "../types";

interface AboutPanelProps {
  open: boolean;
  info: AppInfo | null;
  onResetTour?: () => void;
  onClose: () => void;
}

export function AboutPanel({ open, info, onResetTour, onClose }: AboutPanelProps) {
  const [perfEvents, setPerfEvents] = useState<any[]>([]);
  const refreshPerf = async () => {
    try {
      const events = await invoke<any[]>("list_perf_events");
      setPerfEvents(events.slice(-20).reverse());
    } catch (e) {
      console.error("Failed to load perf events", e);
    }
  };

  useEffect(() => {
    if (open) {
      refreshPerf();
    }
  }, [open]);

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
              <div><strong>BRAW Bridge</strong><p>{info.braw_bridge_active ? "Active" : "Not Detected"}</p></div>
              <div><strong>REDline Bridge</strong><p>{info.redline_bridge_active ? "Active" : "Not Detected"}</p></div>
              <div><strong>LUT Previews</strong><p>Supported (.cube)</p></div>
              <div><strong>macOS</strong><p>{info.macos_version}</p></div>
              <div><strong>Architecture</strong><p>{info.arch}</p></div>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    const dest = await openDialog({ directory: true, multiple: false, title: "Export Performance Report" });
                    if (!dest) return;
                    const result = await invoke<{ md_path: string; json_path: string }>("export_perf_report", { outputRoot: dest });
                    try { await openPath(result.md_path); } catch { }
                  }}
                >
                  Export Performance Report
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    await invoke("clear_perf_events");
                    await refreshPerf();
                  }}
                >
                  Clear Perf Events
                </button>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={onResetTour}>
                Reset Tour
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 12 }}>Recent Perf Events</strong>
              <div style={{ marginTop: 6, maxHeight: 160, overflow: "auto", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: 8 }}>
                {perfEvents.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>No events</div>
                ) : (
                  perfEvents.map((ev) => (
                    <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, fontSize: 12, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <span>{ev.name}</span>
                      <span>{ev.status}</span>
                      <span>{ev.duration_ms ?? "-"}ms</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
