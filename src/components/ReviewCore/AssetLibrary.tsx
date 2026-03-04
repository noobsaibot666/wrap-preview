import React, { useMemo } from "react";
import { Film, Search, Filter, ChevronDown, Clock } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { CommonAsset } from "./types";
import { formatDuration, formatResolution, formatFps } from "./utils";

interface AssetLibraryProps {
    assets: CommonAsset[];
    selectedAssetId: string | null;
    onSelectAsset: (assetId: string) => void;
    loading: boolean;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    sortOrder: "newest" | "name" | "status";
    onSortChange: (order: "newest" | "name" | "status") => void;
}

export const AssetLibrary: React.FC<AssetLibraryProps> = ({
    assets,
    selectedAssetId,
    onSelectAsset,
    loading,
    searchQuery,
    onSearchChange,
    sortOrder,
    onSortChange,
}) => {
    const filteredAssets = useMemo(() => {
        let result = assets;
        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            result = result.filter(a => a.filename.toLowerCase().includes(lower));
        }

        return [...result].sort((a, b) => {
            if (sortOrder === "name") return a.filename.localeCompare(b.filename);
            if (sortOrder === "status") return (a.status || "").localeCompare(b.status || "");
            // Default to newest
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
    }, [assets, searchQuery, sortOrder]);

    return (
        <div className="flex flex-col h-full border-r border-white/5 bg-black/40">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-white/40" />
                    <h2 className="text-sm font-semibold tracking-tight uppercase">Library</h2>
                    <span className="px-1.5 py-0.5 bg-white/5 rounded text-[10px] text-white/40 font-mono">
                        {assets.length}
                    </span>
                </div>
            </div>

            <div className="p-4 space-y-3 bg-white/[0.01]">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-focus-within:text-white/60 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search assets..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-lg py-2 pl-9 pr-4 text-xs tracking-tight outline-none focus:bg-white/[0.08] focus:border-white/10 transition-all placeholder:text-white/10"
                    />
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    <button
                        onClick={() => onSortChange("newest")}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${sortOrder === "newest" ? "bg-white text-black border-white" : "bg-white/5 text-white/40 border-white/5 hover:border-white/20"}`}
                    >
                        Newest
                    </button>
                    <button
                        onClick={() => onSortChange("name")}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${sortOrder === "name" ? "bg-white text-black border-white" : "bg-white/5 text-white/40 border-white/5 hover:border-white/20"}`}
                    >
                        Name
                    </button>
                    <button
                        onClick={() => onSortChange("status")}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${sortOrder === "status" ? "bg-white text-black border-white" : "bg-white/5 text-white/40 border-white/5 hover:border-white/20"}`}
                    >
                        Status
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <div className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
                        <span className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Syncing...</span>
                    </div>
                ) : filteredAssets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                            <Film className="w-6 h-6 text-white/10" />
                        </div>
                        <p className="text-xs text-white/30 leading-relaxed font-medium">
                            No assets found matching your criteria.
                        </p>
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: "100%" }}
                        data={filteredAssets}
                        itemContent={(_index, asset) => {
                            const isActive = selectedAssetId === asset.id;
                            return (
                                <div
                                    onClick={() => onSelectAsset(asset.id)}
                                    className={`
                    group px-4 py-4 cursor-pointer border-b border-white/[0.03] transition-all
                    ${isActive ? "bg-white/10" : "hover:bg-white/[0.03]"}
                  `}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <span className={`text-xs font-semibold truncate ${isActive ? "text-white" : "text-white/80 group-hover:text-white"}`}>
                                            {asset.filename}
                                        </span>
                                        <div className={`
                      px-1.5 py-0.5 rounded-[4px] text-[9px] font-bold uppercase tracking-wider
                      ${asset.status === "ready" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}
                    `}>
                                            {asset.status}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-[10px] text-white/30 font-medium">
                                        <div className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            <span>{formatDuration(asset.duration_ms)}</span>
                                        </div>
                                        <span>•</span>
                                        <span>{formatResolution(asset)}</span>
                                        <span>•</span>
                                        <span>{formatFps(asset.frame_rate)} fps</span>
                                    </div>
                                </div>
                            );
                        }}
                    />
                )}
            </div>
        </div>
    );
};
