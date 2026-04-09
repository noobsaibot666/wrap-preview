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
      setPerfEvents(events.slice(-5).reverse()); // Only show last 5
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

  // Helper to shorten long version strings
  const formatVersion = (s: string) => s.split('\n')[0].split(' Copyright')[0].replace('https://', '').trim();
  const formatDate = (s: string) => s.split('T')[0];

  return (
    <div className="jobs-drawer-backdrop" onClick={onClose}>
      <div className="about-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="jobs-header">
          <h3>About</h3>
          <button className="btn-link" onClick={onClose}><X size={16} /></button>
        </div>
        {!info ? (
          <p>Loading...</p>
        ) : (
          <>
            <div className="about-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 24px' }}>
              <div><strong>Version</strong><p>{info.version}</p></div>
              <div><strong>Build Date</strong><p>{formatDate(info.build_date)}</p></div>
              <div><strong>System</strong><p>macOS {info.macos_version} ({info.arch})</p></div>
              <div><strong>LUTs</strong><p>Supported (.cube)</p></div>
              <div><strong>BRAW Bridge</strong><p>{info.braw_bridge_active ? "Active" : "Not Detected"}</p></div>
              <div><strong>REDline</strong><p>{info.redline_bridge_active ? "Active" : "Not Detected"}</p></div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong>Engine</strong>
                <p style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>
                  FFmpeg: {formatVersion(info.ffmpeg_version)}
                </p>
              </div>
            </div>

            <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn-secondary btn-xs"
                  title="Export system performance report"
                  onClick={async () => {
                    const dest = await openDialog({ directory: true, multiple: false, title: "Export Performance Report" });
                    if (!dest) return;
                    const result = await invoke<{ md_path: string; json_path: string }>("export_perf_report", { outputRoot: dest });
                    try { await openPath(result.md_path); } catch { }
                  }}
                >
                  Export Perf
                </button>
                <button
                  className="btn btn-secondary btn-xs"
                  onClick={async () => {
                    await invoke("clear_perf_events");
                    await refreshPerf();
                  }}
                >
                  Clear Logs
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-secondary btn-xs" onClick={onResetTour}>
                  Reset Tour
                </button>
                <button
                  className="btn btn-danger btn-xs"
                  style={{ backgroundColor: "#dc2626", color: "white" }}
                  onClick={async () => {
                    const { ask } = await import("@tauri-apps/plugin-dialog");
                    const confirmed = await ask(
                      "Delete ALL projects, jobs, and cache? App will restart.",
                      { title: "Hard Reset", kind: "warning" }
                    );
                    if (confirmed) {
                      try {
                        await invoke("reset_app_data");
                        window.location.reload();
                      } catch (e) {
                        console.error("Failed to reset app data", e);
                      }
                    }
                  }}
                >
                  Hard Reset
                </button>
              </div>
            </div>

            {perfEvents.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <strong style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent Activity</strong>
                <div style={{ marginTop: 6, maxHeight: 100, overflow: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: '4px 8px', background: 'rgba(0,0,0,0.1)' }}>
                  {perfEvents.map((ev) => (
                    <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ opacity: 0.8 }}>{ev.name}</span>
                      <span style={{ fontSize: '10px', opacity: 0.5 }}>{ev.status}</span>
                      <span style={{ fontSize: '10px', opacity: 0.5 }}>{ev.duration_ms ?? "-"}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
