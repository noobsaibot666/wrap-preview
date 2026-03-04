import { useState, useEffect, useCallback } from "react";

export interface CommandAction {
    id: string;
    title: string;
    description?: string;
    icon?: string;
    category: "Navigation" | "Project" | "System" | "Recent";
    onSelect: () => void;
    shortcut?: string;
    disabled?: boolean;
}

export function useCommandPalette() {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);

    const toggle = useCallback(() => {
        setIsOpen((v) => !v);
        setQuery("");
        setSelectedIndex(0);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                toggle();
            }

            if (isOpen) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    setIsOpen(false);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, toggle]);

    return {
        isOpen,
        setIsOpen,
        query,
        setQuery,
        selectedIndex,
        setSelectedIndex,
        toggle,
    };
}
