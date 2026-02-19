import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Play, XCircle, CheckCircle, AlertTriangle, Search, FileJson, FileText } from "lucide-react";

interface VerificationProgress {
    job_id: string;
    phase: string;
    current_file: string;
    bytes_total: number;
    bytes_processed: number;
    files_total: number;
    files_processed: number;
    ok_count: number;
    mismatch_count: number;
    missing_count: number;
}

interface VerificationItem {
    rel_path: string;
    source_size: number;
    dest_size?: number;
    status: string;
    error_message?: string;
}

interface SafeCopyProps {
    onJobCreated?: (jobId: string) => void;
    onError?: (error: { title: string; hint: string } | null) => void;
}

export function SafeCopy({ onJobCreated, onError }: SafeCopyProps) {
    const [sourcePath, setSourcePath] = useState("");
    const [destPath, setDestPath] = useState("");
    const [mode, setMode] = useState<"SOLID" | "FAST">("SOLID");
    const [isVerifying, setIsVerifying] = useState(false);
    const [progress, setProgress] = useState<VerificationProgress | null>(null);
    const [results, setResults] = useState<VerificationItem[]>([]);
    const [filter, setFilter] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("ALL");

    useEffect(() => {
        const unlisten = listen<VerificationProgress>("verification-progress", (event) => {
            setProgress(event.payload);
            if (event.payload.phase === "DONE") {
                setIsVerifying(false);
                fetchResults(event.payload.job_id);
            }
        });

        return () => {
            unlisten.then(u => u());
        };
    }, []);

    const fetchResults = async (jobId: string) => {
        try {
            const items = await invoke<VerificationItem[]>("get_verification_items", { jobId });
            setResults(items);
        } catch (e) {
            console.error("Failed to fetch results:", e);
        }
    };

    const handleSelectSource = async () => {
        const selected = await open({ directory: true, multiple: false, title: "Select Source Folder (Card)" });
        if (selected) setSourcePath(selected as string);
    };

    const handleSelectDest = async () => {
        const selected = await open({ directory: true, multiple: false, title: "Select Destination Folder" });
        if (selected) setDestPath(selected as string);
    };

    const handleStart = async () => {
        if (!sourcePath || !destPath) {
            onError?.({ title: "Missing source or destination", hint: "Select both folders before starting verification." });
            return;
        }
        const confirm = window.confirm("Start verification job now?");
        if (!confirm) return;
        setIsVerifying(true);
        setResults([]);
        setProgress(null);
        try {
            const jobId = await invoke<string>("start_verification", { sourceRoot: sourcePath, destRoot: destPath, mode });
            onJobCreated?.(jobId);
            onError?.(null);
        } catch (e) {
            onError?.({ title: "Verification failed to start", hint: "Retry. If this keeps happening, export diagnostics and share with the team." });
            setIsVerifying(false);
        }
    };

    const handleExportJson = async () => {
        if (!progress?.job_id) return;
        try {
            const path = await save({
                filters: [{ name: "JSON", extensions: ["json"] }],
                defaultPath: `Verification_Report_${progress.job_id.slice(0, 8)}.json`
            });
            if (path) {
                await invoke("export_verification_report_json", { jobId: progress.job_id, savePath: path });
            }
        } catch (e) {
            onError?.({ title: "Failed to export verification JSON", hint: "Check output folder permissions and retry." });
        }
    };

    const filteredResults = results.filter(item => {
        const matchesSearch = item.rel_path.toLowerCase().includes(filter.toLowerCase());
        const matchesCategory = categoryFilter === "ALL" ||
            (categoryFilter === "PROBLEMS" && item.status !== "OK") ||
            item.status === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    const percent = progress?.bytes_total ? (progress.bytes_processed / progress.bytes_total) * 100 : 0;

    return (
        <div className="safe-copy-view">
            <div className="safecopy-featured-wrapper">
                <div className="safe-copy-config card">
                    <div className="config-grid">
                        <div className="config-item">
                            <label>Source (Card A)</label>
                            <div className="path-picker">
                                <input type="text" readOnly value={sourcePath} placeholder="Choose source..." />
                                <button className="btn btn-secondary btn-sm" onClick={handleSelectSource} disabled={isVerifying}>
                                    <FolderOpen size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="config-item">
                            <label>Destination (Folder B)</label>
                            <div className="path-picker">
                                <input type="text" readOnly value={destPath} placeholder="Choose destination..." />
                                <button className="btn btn-secondary btn-sm" onClick={handleSelectDest} disabled={isVerifying}>
                                    <FolderOpen size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="config-item">
                            <label>Mode</label>
                            <div className="mode-toggle">
                                <button
                                    className={`btn-toggle ${mode === "SOLID" ? "active" : ""}`}
                                    onClick={() => setMode("SOLID")}
                                    disabled={isVerifying}
                                >
                                    SOLID (Bit-Accurate)
                                </button>
                                <button
                                    className={`btn-toggle ${mode === "FAST" ? "active" : ""}`}
                                    onClick={() => setMode("FAST")}
                                    disabled={isVerifying}
                                >
                                    FAST (Metadata)
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="config-actions">
                        {!isVerifying ? (
                            <button className="btn btn-primary btn-lg" onClick={handleStart} disabled={!sourcePath || !destPath}>
                                <Play size={18} /> Start Verification
                            </button>
                        ) : (
                            <button className="btn btn-danger btn-lg" disabled>
                                <div className="spinner" /> Verifying...
                            </button>
                        )}
                    </div>
                </div>

                {progress && (
                    <div className="verification-dashboard card">
                        <div className="dashboard-header">
                            <h3>{progress.phase === "DONE" ? "Verification Complete" : `Phase: ${progress.phase}`}</h3>
                            <span className="job-id">Job: {progress.job_id.slice(0, 8)}</span>
                        </div>

                        <div className="dashboard-stats">
                            <div className="dash-stat">
                                <span className="label">Verified OK</span>
                                <span className="value ok">{progress.ok_count}</span>
                            </div>
                            <div className="dash-stat">
                                <span className="label">Problems Found</span>
                                <span className="value fail">{progress.mismatch_count + progress.missing_count}</span>
                            </div>
                            <div className="dash-stat">
                                <span className="label">Total Files</span>
                                <span className="value">{progress.files_total}</span>
                            </div>
                        </div>

                        <div className="progress-section">
                            <div className="progress-info">
                                <span className="current-file">{progress.current_file || "Identifying files..."}</span>
                                <span>{Math.round(percent)}%</span>
                            </div>
                            <div className="progress-bar-wrapper">
                                <div className="progress-bar-fill" style={{ width: `${percent}%`, background: progress.phase === "DONE" ? "var(--color-primary)" : "var(--accent-glow)" }} />
                            </div>
                        </div>
                    </div>
                )}

                {results.length > 0 && (
                    <div className="results-container card">
                        <div className="results-toolbar">
                            <div className="toolbar-left">
                                <div className="search-box">
                                    <Search size={14} />
                                    <input type="text" placeholder="Search files..." value={filter} onChange={e => setFilter(e.target.value)} />
                                </div>
                                <div className="filter-tabs">
                                    <button className={`tab ${categoryFilter === "ALL" ? "active" : ""}`} onClick={() => setCategoryFilter("ALL")}>All</button>
                                    <button className={`tab ${categoryFilter === "PROBLEMS" ? "active" : ""}`} onClick={() => setCategoryFilter("PROBLEMS")}>Problems</button>
                                    <button className={`tab ${categoryFilter === "OK" ? "active" : ""}`} onClick={() => setCategoryFilter("OK")}>OK</button>
                                </div>
                            </div>
                            <div className="toolbar-right">
                                <button className="btn btn-secondary btn-sm" onClick={handleExportJson} disabled={!progress}><FileJson size={14} /> Export JSON</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><FileText size={14} /> Export Report</button>
                            </div>
                        </div>

                        <div className="results-table-scroll">
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        <th>Status</th>
                                        <th>Relative Path</th>
                                        <th>Size</th>
                                        <th>Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredResults.slice(0, 100).map((item, i) => (
                                        <tr key={i} className={item.status === "OK" ? "row-ok" : "row-fail"}>
                                            <td className="status-cell">
                                                {item.status === "OK" ? <CheckCircle size={14} className="ok" /> :
                                                    item.status === "MISSING" ? <XCircle size={14} className="fail" /> :
                                                        <AlertTriangle size={14} className="warn" />}
                                                <span className="status-label">{item.status}</span>
                                            </td>
                                            <td className="path-cell">{item.rel_path}</td>
                                            <td className="size-cell">{formatFileSize(item.source_size)}</td>
                                            <td className="detail-cell">{item.error_message || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredResults.length > 100 && (
                                <div className="table-footer">Showing first 100 results...</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
