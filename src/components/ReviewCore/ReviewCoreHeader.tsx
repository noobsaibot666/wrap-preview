import React from "react";
import { FolderUp, Share2, ChevronLeft, User } from "lucide-react";
import { ReviewCoreProjectSummary } from "./types";

interface ReviewCoreHeaderProps {
    project: ReviewCoreProjectSummary | null;
    subtitle: string;
    isShareMode: boolean;
    onImport: () => void;
    onBackToProjects: () => void;
    importing: boolean;
    onShowShare: () => void;
}

export const ReviewCoreHeader: React.FC<ReviewCoreHeaderProps> = ({
    project,
    subtitle,
    isShareMode,
    onImport,
    onBackToProjects,
    importing,
    onShowShare,
}) => {
    return (
        <header className="h-16 border-b border-white/5 bg-[#050505] flex items-center justify-between px-6 shrink-0 z-50">
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <div
                        onClick={onBackToProjects}
                        className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4 text-white/40" />
                    </div>
                    <div className="h-4 w-[1px] bg-white/10 mx-1" />
                    <div className="flex flex-col">
                        <h1 className="text-sm font-bold tracking-tight text-white/90">
                            {project?.name || "Review Core"}
                        </h1>
                        <p className="text-[10px] text-white/30 font-mono tracking-tighter uppercase font-bold">
                            {isShareMode ? "Shared Review" : subtitle}
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                {!isShareMode && (
                    <>
                        <button
                            onClick={onImport}
                            disabled={importing}
                            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 self-center"
                        >
                            {importing ? (
                                <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            ) : (
                                <FolderUp className="w-3.5 h-3.5" />
                            )}
                            <span>Import</span>
                        </button>

                        <button
                            onClick={onShowShare}
                            className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-xs font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-white/5"
                        >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Share</span>
                        </button>
                    </>
                )}

                <div className="h-4 w-[1px] bg-white/10 mx-2" />

                <div className="flex items-center gap-1">
                    <div className="ml-2 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 p-[1px]">
                        <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                            <User className="w-4 h-4 text-white/40" />
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
};
