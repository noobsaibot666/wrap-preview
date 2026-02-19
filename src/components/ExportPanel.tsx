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

export const ExportPanel: React.FC<ExportPanelProps> = ({
  projectId,
  clips,
  selectedBlockIds,
  currentFilterMode,
  currentFilterMinRating,
  onError,
  onClose
}) => {
  const [scope, setScope] = useState<ExportScope>("all");
  const [minRating, setMinRating] = useState<number>(3);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const picksCount = clips.filter((c) => c.flag === "pick").length;
  const ratedCount = clips.filter((c) => c.rating > 0).length;
  const ratedMinCount = clips.filter((c) => c.rating >= minRating).length;
  const allCount = clips.length;

  const resolveScope = () => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/40 hover:text-white rounded-full hover:bg-white/5 transition-colors">
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
            <FileDown size={28} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Export to DaVinci Resolve</h2>
            <p className="text-white/40 text-sm">Generate an FCPXML timeline from your selection.</p>
          </div>
        </div>

        <div className="space-y-4 mb-8">
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider ml-1">Export Scope</label>

          <button onClick={() => setScope("picks")} disabled={picksCount === 0} className={`w-full flex items-center p-4 rounded-xl border transition-all text-left ${scope === "picks" ? "bg-emerald-500/10 border-emerald-500/50" : "bg-white/5 border-transparent"} ${picksCount === 0 ? "opacity-50 cursor-not-allowed" : ""}`}>
            <div className={`p-2 rounded-lg mr-4 ${scope === "picks" ? "bg-emerald-500 text-black" : "bg-white/10 text-emerald-400"}`}><Check size={20} /></div>
            <div className="flex-1"><div className="font-medium text-white">Picks Only</div><div className="text-sm text-white/40">{picksCount} clips selected</div></div>
          </button>

          <button onClick={() => setScope("rated")} disabled={ratedCount === 0} className={`w-full flex items-center p-4 rounded-xl border transition-all text-left ${scope === "rated" ? "bg-amber-500/10 border-amber-500/50" : "bg-white/5 border-transparent"} ${ratedCount === 0 ? "opacity-50 cursor-not-allowed" : ""}`}>
            <div className={`p-2 rounded-lg mr-4 ${scope === "rated" ? "bg-amber-500 text-black" : "bg-white/10 text-amber-400"}`}><Star size={20} /></div>
            <div className="flex-1"><div className="font-medium text-white">Rated ({">"} 0)</div><div className="text-sm text-white/40">{ratedCount} clips</div></div>
          </button>

          <button onClick={() => setScope("rated_min")} disabled={ratedMinCount === 0} className={`w-full flex items-center p-4 rounded-xl border transition-all text-left ${scope === "rated_min" ? "bg-yellow-500/10 border-yellow-500/50" : "bg-white/5 border-transparent"} ${ratedMinCount === 0 ? "opacity-50 cursor-not-allowed" : ""}`}>
            <div className={`p-2 rounded-lg mr-4 ${scope === "rated_min" ? "bg-yellow-500 text-black" : "bg-white/10 text-yellow-300"}`}><Star size={20} /></div>
            <div className="flex-1">
              <div className="font-medium text-white">Rating {"≥"} {minRating}</div>
              <div className="text-sm text-white/40">{ratedMinCount} clips</div>
              {scope === "rated_min" && (
                <input type="range" min={1} max={5} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} className="w-full mt-2" />
              )}
            </div>
          </button>

          <button onClick={() => setScope("selected_blocks")} disabled={selectedBlockIds.length === 0} className={`w-full flex items-center p-4 rounded-xl border transition-all text-left ${scope === "selected_blocks" ? "bg-cyan-500/10 border-cyan-500/50" : "bg-white/5 border-transparent"} ${selectedBlockIds.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}>
            <div className={`p-2 rounded-lg mr-4 ${scope === "selected_blocks" ? "bg-cyan-500 text-black" : "bg-white/10 text-cyan-400"}`}><Grid2X2 size={20} /></div>
            <div className="flex-1"><div className="font-medium text-white">Selected Blocks</div><div className="text-sm text-white/40">{selectedBlockIds.length} blocks selected in Blocks view</div></div>
          </button>

          <button onClick={() => setScope("current_filter")} className={`w-full flex items-center p-4 rounded-xl border transition-all text-left ${scope === "current_filter" ? "bg-purple-500/10 border-purple-500/50" : "bg-white/5 border-transparent"}`}>
            <div className={`p-2 rounded-lg mr-4 ${scope === "current_filter" ? "bg-purple-500 text-black" : "bg-white/10 text-purple-300"}`}><Star size={20} /></div>
            <div className="flex-1"><div className="font-medium text-white">Current View Filter</div><div className="text-sm text-white/40">{currentFilterMode === "rated_min" ? `Rating >= ${currentFilterMinRating}` : currentFilterMode === "picks" ? "Picks only" : "All clips"}</div></div>
          </button>

          <button onClick={() => setScope("all")} className={`w-full flex items-center p-4 rounded-xl border transition-all text-left ${scope === "all" ? "bg-blue-500/10 border-blue-500/50" : "bg-white/5 border-transparent"}`}>
            <div className={`p-2 rounded-lg mr-4 ${scope === "all" ? "bg-blue-500 text-black" : "bg-white/10 text-blue-400"}`}><Film size={20} /></div>
            <div className="flex-1"><div className="font-medium text-white">All Media</div><div className="text-sm text-white/40">{allCount} clips</div></div>
          </button>
        </div>

        {result && (
          <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${result.success ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            {result.success ? <CheckCircle size={20} /> : <X size={20} />}
            <span className="text-sm">{result.message}</span>
          </div>
        )}

        <div className="flex gap-4 pt-2 border-t border-white/10">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={handleDirectorPack} disabled={isExporting} className="tour-director-pack-btn flex-1 px-4 py-3 bg-amber-400 text-black font-bold rounded-xl transition-transform shadow-lg shadow-amber-300/20 flex items-center justify-center gap-2 disabled:opacity-60">
            Director Pack
            <Package size={18} />
          </button>
          <button onClick={handleExport} disabled={isExporting} className="flex-1 px-4 py-3 bg-white text-black font-bold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-white/10 flex items-center justify-center gap-2 disabled:opacity-60">
            {isExporting ? "Exporting..." : "Export FCPXML"}
            {!isExporting && <FileDown size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
};
