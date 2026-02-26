import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { FileDown, CheckCircle, X, Film, Star, Check, Grid2X2, Package } from "lucide-react";
import { Clip } from "../types";

interface ExportPanelProps {
  projectId: string;
  clips: Clip[];
  selectedBlockIds: string[];
  currentFilterMode: "all" | "picks" | "rated_min";
  currentFilterMinRating: number;
  onError?: (error: { title: string; hint: string } | null) => void;
  onClose: () => void;
}

type ExportScope = "all" | "picks" | "rated" | "rated_min" | "selected_blocks" | "current_filter";
type DeliveryType = "resolve" | "director_pack";

export const ExportPanel: React.FC<ExportPanelProps> = ({
  projectId,
  clips,
  selectedBlockIds,
  currentFilterMode,
  currentFilterMinRating,
  onError,
  onClose
}) => {
  const [deliveryType, setDeliveryType] = useState<DeliveryType | null>(null);
  const [scope, setScope] = useState<ExportScope | null>(null);
  const [minRating, setMinRating] = useState<number>(3);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [lastOutputPath, setLastOutputPath] = useState<string | null>(null);

  const picksCount = clips.filter((c) => c.flag === "pick").length;
  const ratedCount = clips.filter((c) => c.rating > 0).length;
  const ratedMinCount = clips.filter((c) => c.rating >= minRating).length;
  const allCount = clips.length;

  const resolveScope = () => {
    if (!scope) {
      return {
        scope: "all" as ExportScope,
        minRating: null,
        blockIds: null
      };
    }
    if (scope === "current_filter") {
      return {
        scope: currentFilterMode,
        minRating: currentFilterMode === "rated_min" ? currentFilterMinRating : null,
        blockIds: null
      };
    }
    return {
      scope,
      minRating: scope === "rated_min" ? minRating : null,
      blockIds: scope === "selected_blocks" ? selectedBlockIds : null
    };
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setResult(null);

      const filePath = await save({
        filters: [{ name: "FCPXML", extensions: ["fcpxml"] }],
        defaultPath: "Export.fcpxml"
      });

      if (!filePath) {
        setIsExporting(false);
        return;
      }
      const confirm = window.confirm(`Export Resolve FCPXML to:\n${filePath}`);
      if (!confirm) {
        setIsExporting(false);
        return;
      }

      const exportScope = resolveScope();
      await invoke("export_to_fcpxml", {
        projectId,
        scope: exportScope.scope,
        minRating: exportScope.minRating,
        blockIds: exportScope.blockIds,
        outputPath: filePath
      });

      setResult({ success: true, message: "Successfully exported FCPXML timeline." });
      setLastOutputPath(filePath);
      onError?.(null);
      try {
        await openPath(filePath);
      } catch (openErr) {
        console.warn("openPath failed for FCPXML", openErr);
        onError?.({ title: "Resolve export completed", hint: `File saved at ${filePath}. Open it from Finder if auto-open is blocked.` });
      }
    } catch (error) {
      console.error(error);
      setResult({ success: false, message: `Export failed: ${error}` });
      onError?.({ title: "Resolve export failed", hint: "Retry export. If it fails again, export diagnostics and share with support." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDirectorPack = async () => {
    try {
      setIsExporting(true);
      setResult(null);
      const outputRoot = await open({
        directory: true,
        multiple: false,
        title: "Select Destination Folder for Director Pack"
      });
      if (!outputRoot) {
        setIsExporting(false);
        return;
      }
      const confirm = window.confirm(`Export Director Pack to:\n${outputRoot}`);
      if (!confirm) {
        setIsExporting(false);
        return;
      }

      const exportScope = resolveScope();
      const result = await invoke<{ root: string }>("export_director_pack", {
        projectId,
        outputRoot,
        filter: {
          mode: exportScope.scope,
          min_rating: exportScope.minRating,
          block_ids: exportScope.blockIds
        }
      });
      setResult({ success: true, message: `Director Pack exported to ${result.root}` });
      setLastOutputPath(result.root);
      onError?.(null);
      try {
        await openPath(result.root);
      } catch (openErr) {
        console.warn("openPath failed for Director Pack", openErr);
        onError?.({ title: "Director Pack completed", hint: `Pack saved at ${result.root}. Open it from Finder if auto-open is blocked.` });
      }
    } catch (error) {
      console.error(error);
      setResult({ success: false, message: `Director Pack failed: ${error}` });
      onError?.({ title: "Director Pack export failed", hint: "Check destination write permissions and filter scope, then retry." });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="export-panel-backdrop">
      <div className="export-panel card premium-card">
        <button onClick={onClose} className="btn-close-modal">
          <X size={20} />
        </button>

        <div className="export-panel-header">
          <div className="export-header-icon">
            <FileDown size={28} />
          </div>
          <div className="export-header-text">
            <h2>Export to DaVinci Resolve</h2>
            <p>Generate an FCPXML timeline from your selection.</p>
          </div>
        </div>

        <div className="export-options-grid">
          <div className="export-section">
            <label className="section-label">Step 1: Delivery Type</label>
            <div className="delivery-type-toggle">
              <button
                onClick={() => setDeliveryType("resolve")}
                className={`btn-delivery ${deliveryType === "resolve" ? "active" : ""}`}
              >
                Resolve FCPXML
              </button>
              <button
                onClick={() => setDeliveryType("director_pack")}
                className={`btn-delivery ${deliveryType === "director_pack" ? "active" : ""}`}
              >
                Director Pack
              </button>
            </div>
          </div>
          <button
            className="btn-link preset-btn"
            onClick={() => {
              setDeliveryType("director_pack");
              setScope("current_filter");
            }}
          >
            Most common preset
          </button>

          <div className="export-section">
            <label className="section-label">Step 2: Scope</label>
            <div className="scope-list">

              <button onClick={() => setScope("picks")} disabled={picksCount === 0} className={`scope-item ${scope === "picks" ? "active" : ""} ${picksCount === 0 ? "disabled" : ""}`}>
                <div className="scope-icon"><Check size={20} /></div>
                <div className="scope-info"><div className="scope-title">Picks Only</div><div className="scope-count">{picksCount} clips selected</div></div>
              </button>

              <button onClick={() => setScope("rated")} disabled={ratedCount === 0} className={`scope-item ${scope === "rated" ? "active" : ""} ${ratedCount === 0 ? "disabled" : ""}`}>
                <div className="scope-icon"><Star size={20} /></div>
                <div className="scope-info"><div className="scope-title">Rated ({">"} 0)</div><div className="scope-count">{ratedCount} clips</div></div>
              </button>

              <button onClick={() => setScope("rated_min")} disabled={ratedMinCount === 0} className={`scope-item ${scope === "rated_min" ? "active" : ""} ${ratedMinCount === 0 ? "disabled" : ""}`}>
                <div className="scope-icon"><Star size={20} /></div>
                <div className="scope-info">
                  <div className="scope-title">Rating {"≥"} {minRating}</div>
                  <div className="scope-count">{ratedMinCount} clips</div>
                  {scope === "rated_min" && (
                    <input type="range" min={1} max={5} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} className="range-input" />
                  )}
                </div>
              </button>

              <button onClick={() => setScope("selected_blocks")} disabled={selectedBlockIds.length === 0} className={`scope-item ${scope === "selected_blocks" ? "active" : ""} ${selectedBlockIds.length === 0 ? "disabled" : ""}`}>
                <div className="scope-icon"><Grid2X2 size={20} /></div>
                <div className="scope-info"><div className="scope-title">Selected Blocks</div><div className="scope-count">{selectedBlockIds.length} blocks</div></div>
              </button>

              <button onClick={() => setScope("current_filter")} className={`scope-item ${scope === "current_filter" ? "active" : ""}`}>
                <div className="scope-icon"><Star size={20} /></div>
                <div className="scope-info"><div className="scope-title">Current View Filter</div><div className="scope-count">{currentFilterMode === "rated_min" ? `Rating >= ${currentFilterMinRating}` : currentFilterMode === "picks" ? "Picks only" : "All clips"}</div></div>
              </button>

              <button onClick={() => setScope("all")} className={`scope-item ${scope === "all" ? "active" : ""}`}>
                <div className="scope-icon"><Film size={20} /></div>
                <div className="scope-info"><div className="scope-title">All Media</div><div className="scope-count">{allCount} clips</div></div>
              </button>
            </div>
          </div>
        </div>
        {(!deliveryType || !scope) && (
          <div className="mb-4 text-xs text-amber-300">Choose one type and one scope to continue.</div>
        )}

        {result && (
          <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${result.success ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            {result.success ? <CheckCircle size={20} /> : <X size={20} />}
            <span className="text-sm">{result.message}</span>
          </div>
        )}
        {lastOutputPath && (
          <div className="mb-4 text-xs text-white/70 flex items-center justify-between gap-3">
            <span>Saved to: {lastOutputPath}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(lastOutputPath);
                  onError?.({ title: "Path copied", hint: lastOutputPath });
                } catch (_e) {
                  onError?.({ title: "Copy failed", hint: "Copy path manually from the saved location message." });
                }
              }}
            >
              Copy Path
            </button>
          </div>
        )}

        <div className="export-panel-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleDirectorPack}
              disabled={isExporting || !deliveryType || !scope || deliveryType !== "director_pack"}
              className={`btn btn-accent btn-glow ${deliveryType === "director_pack" ? "" : "opacity-30"}`}
            >
              Step 3: Export Director Pack
              <Package size={18} />
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || !deliveryType || !scope || deliveryType !== "resolve"}
              className={`btn btn-primary ${deliveryType === "resolve" ? "" : "opacity-30"}`}
            >
              <span className={isExporting ? "shimmer-text" : ""}>
                {isExporting ? "Exporting..." : "Step 3: Export FCPXML"}
              </span>
              {!isExporting && <FileDown size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
