import { useEffect, useState } from "react";
import { X, FolderOpen } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { invokeGuarded } from "../utils/tauri";
import { AppInfo } from "../types";

interface SettingsPanelProps {
  open: boolean;
  info: AppInfo | null;
  onClose: () => void;
}

export function SettingsPanel({ open, info, onClose }: SettingsPanelProps) {
  const [cacheDir, setCacheDir] = useState<string>("");

  useEffect(() => {
    if (open) {
      invokeGuarded<string>("get_cache_dir")
        .then(setCacheDir)
        .catch((e) => console.error("get_cache_dir failed", e));
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="jobs-drawer-backdrop" onClick={onClose}>
      <div className="about-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
        <div className="jobs-header">
          <h3>Settings</h3>
          <button className="btn-link" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="about-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 24px" }}>
          <div><strong>Version</strong><p>{info?.version ?? "—"}</p></div>
          <div><strong>Platform</strong><p>{info?.arch ?? "—"}</p></div>
          <div><strong>BRAW Bridge</strong><p>{info?.braw_bridge_active ? "Active" : "Not Detected"}</p></div>
          <div><strong>REDline</strong><p>{info?.redline_bridge_active ? "Active" : "Not Detected"}</p></div>
        </div>

        <div style={{ marginTop: 20 }}>
          <strong style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Storage
          </strong>
          <div style={{ marginTop: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, background: "rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {cacheDir || "Loading…"}
              </span>
              <button
                className="btn btn-secondary btn-xs"
                title="Open cache folder"
                disabled={!cacheDir}
                onClick={() => openPath(cacheDir).catch(() => {})}
              >
                <FolderOpen size={12} style={{ marginRight: 4 }} />
                Open Folder
              </button>
            </div>
            <p style={{ fontSize: 11, opacity: 0.45, marginTop: 6, marginBottom: 0 }}>
              Thumbnails, proxies, and temporary files are stored here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
