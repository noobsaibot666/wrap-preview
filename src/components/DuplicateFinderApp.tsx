import { useState, useCallback, useMemo } from "react";
import { 
  Plus, 
  ExternalLink, 
  FileText, 
  AlertCircle, 
  Folder, 
  CheckCircle2, 
  X, 
  Scan,
  Download,
  FileSearch,
  Info
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, confirm, message } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { jsPDF } from "jspdf";

interface DuplicateFile {
  path: string;
  filename: string;
  size: u64;
  modified: string;
}

interface DuplicateGroup {
  hash: string;
  size: u64;
  files: DuplicateFile[];
}

interface ScanProgress {
  phase: string;
  count: number;
  current_path?: string;
}

interface ScanResult {
  groups: DuplicateGroup[];
  errors: string[];
}

type u64 = number;

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function DuplicateFinderApp() {
  const [folders, setFolders] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<DuplicateGroup[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uiError, setUiError] = useState<string | null>(null);
  const [scanStats, setScanStats] = useState<{ startTime: number; endTime: number } | null>(null);

  const addFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Select Folders to Scan"
      });
      if (selected && Array.isArray(selected)) {
        setFolders(prev => [...new Set([...prev, ...selected])]);
      } else if (selected && typeof selected === "string") {
        setFolders(prev => [...new Set([...prev, selected])]);
      }
    } catch (err) {
      console.error(err);
      setUiError("Failed to open folder dialog.");
    }
  }, []);

  const removeFolder = (path: string) => {
    setFolders(prev => prev.filter(p => p !== path));
  };

  const startScan = async () => {
    if (folders.length === 0) return;
    
    setIsScanning(true);
    setUiError(null);
    setErrors([]);
    setResults([]);
    setProgress({ phase: "Initializing...", count: 0 });
    const startTime = Date.now();
    
    // Listen for progress events
    const unlisten = await listen<ScanProgress>("duplicate-scan-progress", (event) => {
      setProgress(event.payload);
    });

    try {
      const resp = await invoke("scan_duplicates", { paths: folders }) as ScanResult;
      setResults(resp.groups);
      setErrors(resp.errors);
      setScanStats({ startTime, endTime: Date.now() });
    } catch (err) {
      console.error(err);
      setUiError(String(err));
    } finally {
      setIsScanning(false);
      setProgress(null);
      unlisten();
    }
  };

  const deleteFile = async (filePath: string, groupHash: string) => {
    const fileName = filePath.split(/[\\/]/).pop();
    const confirmed = await confirm(
      `Are you sure you want to move "${fileName}" to the trash?`,
      { title: "Move to Trash", kind: 'warning' }
    );

    if (confirmed) {
      try {
        await invoke("delete_duplicate_file", { path: filePath });
        
        // Update results locally
        setResults(prev => prev.map(group => {
          if (group.hash === groupHash) {
            return {
              ...group,
              files: group.files.filter(f => f.path !== filePath)
            };
          }
          return group;
        }).filter(group => group.files.length > 1));
        
        await message(`Successfully moved "${fileName}" to trash.`, { title: "File Removed", kind: 'info' });
      } catch (err) {
        console.error(err);
        setUiError(`Failed to delete file: ${err}`);
      }
    }
  };

  const revealInFinder = async (path: string) => {
    try {
      await openPath(path);
    } catch (err) {
      console.error(err);
      setUiError("Failed to open file path.");
    }
  };

  const totalWastedSpace = useMemo(() => {
    return results.reduce((acc, group) => {
      // Wasted space = (count - 1) * size
      return acc + (group.files.length - 1) * group.size;
    }, 0);
  }, [results]);

  const exportPDF = async () => {
    if (results.length === 0) return;

    try {
      const doc = new jsPDF();
      let y = 20;
      const margin = 20;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Title
      doc.setFontSize(22);
      doc.setTextColor(33, 33, 33);
      doc.text("Duplicate Files Report", margin, y);
      y += 12;

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Generated on ${new Date().toLocaleString()}`, margin, y);
      y += 8;
      doc.text(`Folders scanned: ${folders.length}`, margin, y);
      y += 5;
      doc.text(`Duplicates found: ${results.length} groups`, margin, y);
      y += 5;
      doc.text(`Potential space savings: ${formatSize(totalWastedSpace)}`, margin, y);
      y += 15;

      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, pageWidth - margin, y);
      y += 15;

      // Groups
      results.forEach((group, gIdx) => {
        if (y > pageHeight - 40) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(12);
        doc.setTextColor(33, 33, 33);
        doc.setFont("helvetica", "bold");
        doc.text(`Group ${gIdx + 1} - ${formatSize(group.size)} per file`, margin, y);
        y += 7;

        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(80, 80, 80);
        
        group.files.forEach((file, fIdx) => {
          if (y > pageHeight - 20) {
            doc.addPage();
            y = 20;
          }
          const text = `[${fIdx + 1}] ${file.path}`;
          const lines = doc.splitTextToSize(text, pageWidth - margin * 2 - 10);
          doc.text(lines, margin + 5, y);
          y += (lines.length * 5) + 2;
        });

        y += 5;
        doc.setDrawColor(240, 240, 240);
        doc.line(margin, y, pageWidth - margin, y);
        y += 10;
      });

      // Save using existing Tauri pipeline if possible, otherwise direct download
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `DuplicateReport_${timestamp}.pdf`;
      
      // In this app, we can just use the manual save or just let browser handle it if not in tauri
      // but we ARE in tauri.
      doc.save(filename);
    } catch (err) {
      console.error(err);
      setUiError("Failed to generate PDF report.");
    }
  };

  return (
    <div className="duplicate-finder-container">
      <div className="duplicate-finder-header">
        <div className="header-left">
          <div className="accent-badge">PRE-PRODUCTION</div>
          <h2>Duplicate File Finder</h2>
          <p>Recursive content-based scanning across multiple directories.</p>
        </div>
        <div className="header-right">
          <button className="btn btn-secondary btn-glass" onClick={addFolder} disabled={isScanning}>
            <Plus size={16} /> Add Folders
          </button>
          <button 
            className="btn btn-primary btn-glow" 
            onClick={startScan} 
            disabled={isScanning || folders.length === 0}
          >
            {isScanning ? <div className="spinner" /> : <Scan size={16} />}
            <span>{isScanning ? "Scanning Content..." : "Start Scan"}</span>
          </button>
          {results.length > 0 && (
            <button className="btn btn-secondary btn-glass" onClick={exportPDF}>
              <Download size={16} /> Export PDF
            </button>
          )}
        </div>
      </div>

      {uiError && (
        <div className="status-alert error">
          <AlertCircle size={16} />
          <span>{uiError}</span>
          <button className="close-btn" onClick={() => setUiError(null)}><X size={14} /></button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="status-alert warning">
          <AlertCircle size={16} />
          <div className="error-log">
            <strong>Partial Scan Warnings:</strong>
            <ul>
              {errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
              {errors.length > 3 && <li>...and {errors.length - 3} more</li>}
            </ul>
          </div>
          <button className="close-btn" onClick={() => setErrors([])}><X size={14} /></button>
        </div>
      )}

      <div className="duplicate-finder-workspace">
        <div className="workspace-sidebar">
          <div className="segment">
            <div className="segment-header">
              <Folder size={14} />
              <span>SCAN TARGETS</span>
            </div>
            <div className="folder-list premium-scroll">
              {folders.length === 0 ? (
                <div className="empty-state">No folders selected</div>
              ) : (
                folders.map((path, idx) => (
                  <div key={idx} className="folder-tag">
                    <span className="folder-path" title={path}>{path}</span>
                    <button onClick={() => removeFolder(path)} disabled={isScanning}>
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="segment summary-stats">
            <div className="segment-header">
              <Info size={14} />
              <span>SCAN SUMMARY</span>
            </div>
            <div className="stats-grid">
              <div className="stat-item">
                <label>Duplicate Groups</label>
                <span className="stat-value">{results.length}</span>
              </div>
              <div className="stat-item">
                <label>Wasted Space</label>
                <span className="stat-value highlight">{formatSize(totalWastedSpace)}</span>
              </div>
              {scanStats && (
                <div className="stat-item">
                  <label>Scan Duration</label>
                  <span className="stat-value">{((scanStats.endTime - scanStats.startTime) / 1000).toFixed(2)}s</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="workspace-results segment">
          <div className="segment-header">
            <FileSearch size={14} />
            <span>RESULTS {results.length > 0 && `(${results.length} Groups)`}</span>
          </div>
          <div className="results-list premium-scroll">
            {isScanning ? (
              <div className="loading-state">
                <div className="spinner large" />
                <p>{progress?.phase || "Analyzing file signatures..."}</p>
                {progress && (
                  <div className="progress-details">
                    <span className="count-badge">{progress.count} items processed</span>
                    {progress.current_path && <span className="current-path">{progress.current_path}</span>}
                  </div>
                )}
                <div className="progress-bar-container">
                  <div className="progress-bar-indeterminate" />
                </div>
              </div>
            ) : results.length === 0 ? (
              <div className="empty-state-large">
                <div className="icon-circle"><CheckCircle2 size={32} /></div>
                <h3>{scanStats ? "No Duplicates Found" : "Ready to Scan"}</h3>
                <p>{scanStats ? "All files in the selected directories appear to be unique." : "Select one or more folders and click 'Start Scan' to find identical files."}</p>
              </div>
            ) : (
              results.map((group, gIdx) => (
                <div key={group.hash} className="duplicate-group">
                  <div className="group-header">
                    <div className="group-info">
                      <span className="group-label">Group {gIdx + 1}</span>
                      <span className="group-hash">HASH: {group.hash.substring(0, 12)}...</span>
                    </div>
                    <div className="group-meta">
                      <span className="file-size-badge">{formatSize(group.size)} per file</span>
                      <span className="waste-badge">Waste: {formatSize((group.files.length - 1) * group.size)}</span>
                    </div>
                  </div>
                  <div className="group-files">
                    {group.files.map((file, fIdx) => (
                      <div key={fIdx} className="file-item">
                        <div className="file-icon"><FileText size={16} /></div>
                        <div className="file-details">
                          <div className="file-name">{file.filename}</div>
                          <div className="file-path">{file.path}</div>
                        </div>
                        <div className="file-actions">
                          <button className="btn-browse" onClick={() => revealInFinder(file.path)}>
                            <ExternalLink size={14} />
                            <span>Browse</span>
                          </button>
                          <button className="btn-trash" onClick={() => deleteFile(file.path, group.hash)}>
                            <X size={14} />
                            <span>Trash</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <style>{`
        .duplicate-finder-container {
          padding: 32px;
          background: var(--inspector-bg);
          backdrop-filter: var(--inspector-glass-blur);
          border-radius: var(--radius-lg);
          border: var(--inspector-border);
          color: var(--text-primary);
          animation: fadeInApp 0.36s ease;
          box-shadow: var(--shadow-lg);
          height: calc(100vh - 180px);
          display: flex;
          flex-direction: column;
        }

        @keyframes fadeInApp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .duplicate-finder-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 24px;
        }

        .header-left h2 {
          margin: 0;
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .header-left p {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: 0.95rem;
        }

        .header-right {
          display: flex;
          gap: 12px;
        }

        .accent-badge {
          background: var(--color-accent-soft);
          color: var(--color-accent);
          font-size: var(--inspector-label-size);
          font-weight: var(--inspector-label-weight);
          letter-spacing: var(--inspector-label-spacing);
          padding: 4px 10px;
          border-radius: var(--radius-sm);
          width: fit-content;
          margin-bottom: 12px;
          text-transform: uppercase;
          border: 1px solid var(--color-accent-glow);
        }

        .duplicate-finder-workspace {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 24px;
          flex: 1;
          min-height: 0;
        }

        .workspace-sidebar {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .segment {
          background: rgba(0, 0, 0, 0.2);
          border: var(--inspector-border);
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .segment-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .folder-list {
          padding: 12px;
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .folder-tag {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: var(--radius-sm);
          font-size: 0.8rem;
          transition: all 0.2s ease;
        }

        .folder-tag:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: var(--color-accent-soft);
        }

        .folder-path {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-right: 8px;
          opacity: 0.8;
        }

        .folder-tag button {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          padding: 2px;
          border-radius: 4px;
        }

        .folder-tag button:hover {
          background: rgba(239, 68, 68, 0.1);
          color: var(--status-red);
        }

        .stats-grid {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .stat-item label {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 500;
        }

        .stat-item value {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .stat-item value.highlight {
          color: var(--color-accent);
        }

        .results-list {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .duplicate-group {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: var(--radius-md);
          overflow: hidden;
        }

        .group-header {
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.03);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .group-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .group-label {
          font-weight: 700;
          font-size: 0.9rem;
        }

        .group-hash {
          font-family: monospace;
          font-size: 0.75rem;
          opacity: 0.4;
        }

        .group-meta {
          display: flex;
          gap: 12px;
        }

        .file-size-badge {
          background: rgba(255, 255, 255, 0.05);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .waste-badge {
          background: rgba(239, 68, 68, 0.1);
          color: var(--status-red);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
        }

        .group-files {
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .file-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          transition: background 0.2s ease;
        }

        .file-item:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .file-icon {
          color: var(--color-accent);
          opacity: 0.6;
        }

        .file-details {
          flex: 1;
          min-width: 0;
        }

        .file-name {
          font-size: 0.9rem;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-path {
          font-size: 0.75rem;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: 0.7;
        }

        .btn-browse {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(0, 209, 255, 0.05);
          border: 1px solid rgba(0, 209, 255, 0.1);
          color: var(--color-accent);
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-browse:hover {
          background: var(--color-accent);
          color: white;
          border-color: var(--color-accent);
        }

        .loading-state, .empty-state-large {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px;
          text-align: center;
        }

        .loading-state p {
          margin: 16px 0 8px;
          font-size: 1.1rem;
          font-weight: 600;
        }

        .loading-state span {
          color: var(--text-muted);
          font-size: 0.9rem;
        }

        .empty-state-large .icon-circle {
          width: 64px;
          height: 64px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
          color: var(--color-accent);
          opacity: 0.4;
        }

        .empty-state-large h3 {
          font-size: 1.25rem;
          margin: 0 0 8px;
        }

        .empty-state-large p {
          color: var(--text-muted);
          max-width: 400px;
        }

        .status-alert {
          margin-bottom: 20px;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
        }

        .status-alert.error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #ff8080;
        }

        .close-btn {
          margin-left: auto;
          background: none;
          border: none;
          color: inherit;
          opacity: 0.5;
          cursor: pointer;
          padding: 4px;
        }

        .spinner.large {
          width: 48px;
          height: 48px;
        }

        .premium-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .premium-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }

        .progress-bar-container {
          width: 300px;
          height: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          margin-top: 24px;
          overflow: hidden;
          position: relative;
        }

        .progress-bar-indeterminate {
          position: absolute;
          left: -30%;
          width: 30%;
          height: 100%;
          background: var(--color-accent);
          animation: progressIndeterminate 1.5s infinite linear;
        }

        @keyframes progressIndeterminate {
          0% { left: -30%; }
          100% { left: 100%; }
        }

        .progress-details {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
        }

        .count-badge {
          font-size: 0.8rem;
          color: var(--color-accent);
          font-weight: 700;
        }

        .current-path {
          font-size: 0.75rem;
          color: var(--text-muted);
          max-width: 500px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-actions {
          display: flex;
          gap: 8px;
        }

        .btn-trash {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid rgba(239, 68, 68, 0.1);
          color: var(--status-red);
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-trash:hover {
          background: var(--status-red);
          color: white;
          border-color: var(--status-red);
        }

        .error-log {
          font-size: 0.85rem;
          text-align: left;
        }

        .error-log ul {
          margin: 4px 0 0;
          padding-left: 20px;
        }

        .status-alert.warning {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          color: #ffb347;
        }
      `}</style>
    </div>
  );
}
