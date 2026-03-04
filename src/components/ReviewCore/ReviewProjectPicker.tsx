import React from "react";
import { Folder, ChevronRight, Projector, Plus, Clock } from "lucide-react";
import { ReviewCoreProjectSummary } from "./types";

interface ReviewProjectPickerProps {
    projects: ReviewCoreProjectSummary[];
    activeProject: ReviewCoreProjectSummary | null;
    onSelectProject: (projectId: string) => void;
    loading: boolean;
    onCreateProject: (name: string) => void;
    newProjectName: string;
    setNewProjectName: (name: string) => void;
    creating: boolean;
}

export const ReviewProjectPicker: React.FC<ReviewProjectPickerProps> = ({
    projects,
    activeProject,
    onSelectProject,
    loading,
    onCreateProject,
    newProjectName,
    setNewProjectName,
    creating,
}) => {
    return (
        <div className="flex flex-col h-full bg-[#050505] text-white overflow-hidden select-none">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Review Projects</h1>
                    <p className="text-xs text-white/30 mt-1">Select a workspace to begin the review process</p>
                </div>
                <Folder className="w-8 h-8 text-white/10" />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span className="text-xs text-white/30 font-medium">Fetching projects...</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {projects.map((project) => (
                            <button
                                key={project.id}
                                onClick={() => onSelectProject(project.id)}
                                className={`
                  flex items-center justify-between p-4 rounded-xl border transition-all text-left group
                  ${activeProject?.id === project.id
                                        ? "bg-white/10 border-white/20 shadow-lg"
                                        : "bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10"}
                `}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`
                    w-12 h-12 rounded-lg flex items-center justify-center transition-colors
                    ${activeProject?.id === project.id ? "bg-white text-black" : "bg-white/5 text-white/40 group-hover:text-white/60"}
                  `}>
                                        <Projector className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-sm tracking-tight">{project.name}</h3>
                                        <div className="flex items-center gap-3 mt-1">
                                            <span className="text-[10px] text-white/30 uppercase tracking-wider font-bold">Project</span>
                                            <span className="w-1 h-1 bg-white/10 rounded-full" />
                                            <span className="text-[10px] text-white/40 font-mono italic">#{project.id.slice(0, 8)}</span>
                                        </div>
                                    </div>
                                </div>
                                <ChevronRight className={`w-4 h-4 transition-transform ${activeProject?.id === project.id ? "text-white" : "text-white/20 group-hover:translate-x-1"}`} />
                            </button>
                        ))}

                        {/* Create New Project */}
                        <div className="mt-8 pt-8 border-t border-white/5">
                            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20 mb-4 px-2">Actions</h4>
                            <div className="flex gap-2 p-2 bg-white/[0.02] border border-white/5 rounded-xl focus-within:bg-white/[0.04] focus-within:border-white/10 transition-all">
                                <input
                                    type="text"
                                    placeholder="New project name..."
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    className="flex-1 bg-transparent border-none outline-none px-2 text-xs py-2 placeholder:text-white/10"
                                />
                                <button
                                    onClick={() => onCreateProject(newProjectName)}
                                    disabled={creating || !newProjectName.trim()}
                                    className="px-4 py-2 bg-white text-black rounded-lg text-xs font-bold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 transition-all flex items-center gap-2"
                                >
                                    {creating ? <div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                    <span>Create</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-6 bg-black/40 border-t border-white/5 text-[10px] text-white/20 uppercase tracking-[0.1em] font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    <span>Last sync: {new Date().toLocaleTimeString()}</span>
                </div>
                <span>v1.0.0-beta</span>
            </div>
        </div>
    );
};
