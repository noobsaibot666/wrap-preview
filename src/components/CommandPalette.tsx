import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Command, ArrowRight, Clock, Box, Play, FileText, ChevronRight } from "lucide-react";
import { CommandAction } from "../hooks/useCommandPalette";

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    query: string;
    onQueryChange: (query: string) => void;
    actions: CommandAction[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    isOpen,
    onClose,
    query,
    onQueryChange,
    actions,
}) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const filteredActions = useMemo(() => {
        if (!query) return actions;
        const lower = query.toLowerCase();
        return actions.filter(
            (a) =>
                a.title.toLowerCase().includes(lower) ||
                a.description?.toLowerCase().includes(lower) ||
                a.category.toLowerCase().includes(lower)
        );
    }, [actions, query]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => (i + 1) % filteredActions.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => (i - 1 + filteredActions.length) % filteredActions.length);
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (filteredActions[selectedIndex]) {
                    filteredActions[selectedIndex].onSelect();
                    onClose();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, filteredActions, selectedIndex, onClose]);

    // Grouping for display
    const groups = useMemo(() => {
        const map: Record<string, CommandAction[]> = {};
        filteredActions.forEach((a) => {
            if (!map[a.category]) map[a.category] = [];
            map[a.category].push(a);
        });
        return Object.entries(map);
    }, [filteredActions]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Palette Container */}
            <div className="relative w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                {/* Search Header */}
                <div className="flex items-center gap-3 px-4 py-4 border-b border-white/5">
                    <Search className="w-5 h-5 text-white/40" />
                    <input
                        autoFocus
                        type="text"
                        placeholder="Type a command or search projects..."
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-base text-white placeholder:text-white/20 font-medium"
                    />
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/5 rounded-md">
                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Esc</span>
                    </div>
                </div>

                {/* Results List */}
                <div
                    ref={scrollRef}
                    className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2"
                >
                    {filteredActions.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                                <Search className="w-6 h-6 text-white/10" />
                            </div>
                            <p className="text-sm text-white/30 font-medium">
                                No results found for "<span className="text-white/60">{query}</span>"
                            </p>
                        </div>
                    ) : (
                        groups.map(([category, items]) => (
                            <div key={category} className="mb-4 last:mb-0">
                                <h3 className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/20 select-none">
                                    {category}
                                </h3>
                                <div className="space-y-0.5">
                                    {items.map((action) => {
                                        const globalIndex = filteredActions.indexOf(action);
                                        const isSelected = selectedIndex === globalIndex;

                                        return (
                                            <div
                                                key={action.id}
                                                onClick={() => { action.onSelect(); onClose(); }}
                                                className={`
                                                    group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150
                                                    ${isSelected ? "bg-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.4)]" : "hover:bg-white/[0.03]"}
                                                `}
                                            >
                                                <div className={`
                                                    w-9 h-9 rounded-lg flex items-center justify-center border transition-all duration-150
                                                    ${isSelected ? "bg-white border-white text-black" : "bg-white/5 border-white/5 text-white/40"}
                                                `}>
                                                    {getIcon(action.icon)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className={`text-sm font-semibold truncate ${isSelected ? "text-white" : "text-white/80"}`}>
                                                            {action.title}
                                                        </span>
                                                        {action.shortcut && (
                                                            <span className="text-[10px] font-mono text-white/20 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                                                                {action.shortcut}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {action.description && (
                                                        <p className={`text-xs truncate ${isSelected ? "text-white/40" : "text-white/20"}`}>
                                                            {action.description}
                                                        </p>
                                                    )}
                                                </div>
                                                <ChevronRight className={`w-4 h-4 transition-all duration-200 ${isSelected ? "translate-x-0 opacity-40 text-white" : "-translate-x-2 opacity-0 text-white"}`} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-white/[0.02] border-t border-white/5 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/20">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <span className="p-1 bg-white/5 rounded border border-white/10 text-white/40 font-mono">↑↓</span>
                            <span>Navigate</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10 text-white/40 font-mono">Enter</span>
                            <span>Select</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

function getIcon(name?: string) {
    switch (name) {
        case "play": return <Play className="w-4 h-4" />;
        case "project": return <Box className="w-4 h-4" />;
        case "nav": return <ArrowRight className="w-4 h-4" />;
        case "clock": return <Clock className="w-4 h-4" />;
        case "file": return <FileText className="w-4 h-4" />;
        default: return <Command className="w-4 h-4" />;
    }
}
