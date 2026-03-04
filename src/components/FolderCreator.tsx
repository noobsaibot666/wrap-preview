import { useState, useCallback, useMemo, useRef } from "react";
import { FolderTree, Plus, Trash2, RotateCcw, Download, Folder, FileType, ChevronRight, Hash, UploadCloud } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

interface FolderNode {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: FolderNode[];
}

const MAX_STRUCTURE_DEPTH = 12;
const MAX_STRUCTURE_NODES = 1000;
const INVALID_NAME_CHARS = /[\/\\?%*:|"<>]/g;
const CANONICAL_COUNT_LABELS = ["Main", "Primary", "Secondary"];

function sanitizeNodeName(name: string) {
  return name.replace(INVALID_NAME_CHARS, "_").trim();
}

function getHierarchyLabel(depth: number) {
  return CANONICAL_COUNT_LABELS[depth] ?? null;
}

function makeSiblingKey(name: string) {
  return sanitizeNodeName(name).toLocaleLowerCase();
}

function makeUniqueNodeName(baseName: string, siblings: FolderNode[]) {
  const sanitizedBase = sanitizeNodeName(baseName) || "node";
  const existing = new Set(siblings.map((node) => makeSiblingKey(node.name)));
  if (!existing.has(makeSiblingKey(sanitizedBase))) {
    return sanitizedBase;
  }

  let suffix = 2;
  while (existing.has(makeSiblingKey(`${sanitizedBase}_${suffix}`))) {
    suffix += 1;
  }
  return `${sanitizedBase}_${suffix}`;
}

function validateFolderNodes(
  nodes: FolderNode[],
  depth = 1,
  parentLabel = "root",
  counter = { value: 0 }
): string | null {
  if (depth > MAX_STRUCTURE_DEPTH) {
    return `Folder structure exceeds the ${MAX_STRUCTURE_DEPTH}-level depth limit.`;
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    counter.value += 1;
    if (counter.value > MAX_STRUCTURE_NODES) {
      return `Folder structure exceeds the ${MAX_STRUCTURE_NODES} node limit.`;
    }

    const sanitized = sanitizeNodeName(node.name);
    if (!sanitized) {
      return "Folder structure contains an empty node name.";
    }

    const duplicateKey = sanitized.toLocaleLowerCase();
    if (seen.has(duplicateKey)) {
      return `Duplicate node name "${sanitized}" inside "${parentLabel}".`;
    }
    seen.add(duplicateKey);

    if (node.type !== "folder" && node.type !== "file") {
      return "Folder structure nodes must be either folder or file.";
    }

    if (node.children?.length) {
      const childError = validateFolderNodes(node.children, depth + 1, sanitized, counter);
      if (childError) {
        return childError;
      }
    }
  }

  return null;
}

export function FolderCreator() {
  const [structure, setStructure] = useState<FolderNode[]>([
    { id: "root", name: "PROJECT_NAME", type: "folder", children: [] }
  ]);
  const [creating, setCreating] = useState(false);
  const [creatingOnDisk, setCreatingOnDisk] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetStructure = useCallback(() => {
    setStructure([{ id: "root", name: "PROJECT_NAME", type: "folder", children: [] }]);
    setErrorMessage(null);
    setStatusMessage(null);
  }, []);

  const addNode = useCallback((parentId: string, type: "folder" | "file") => {
    const updateStructure = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.map(node => {
        if (node.id === parentId) {
          const siblings = node.children || [];
          const newNode: FolderNode = {
            id: Math.random().toString(36).substr(2, 9),
            name: makeUniqueNodeName(type === "folder" ? "new_folder" : "asset_file", siblings),
            type,
            children: type === "folder" ? [] : undefined
          };
          return { ...node, children: [...siblings, newNode] };
        }
        if (node.children) {
          return { ...node, children: updateStructure(node.children) };
        }
        return node;
      });
    };

    setStructure(prev => updateStructure(prev));
  }, []);

  const removeNode = useCallback((id: string) => {
    if (id === "root") return;
    const updateStructure = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.filter(node => node.id !== id).map(node => {
        if (node.children) {
          return { ...node, children: updateStructure(node.children) };
        }
        return node;
      });
    };
    setStructure(prev => updateStructure(prev));
  }, []);

  const updateName = useCallback((id: string, name: string) => {
    const sanitized = sanitizeNodeName(name);
    const updateStructure = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.map(node => {
        if (node.id === id) {
          return { ...node, name: sanitized };
        }
        if (node.children) {
          return { ...node, children: updateStructure(node.children) };
        }
        return node;
      });
    };
    setStructure(prev => updateStructure(prev));
  }, []);

  const handleJSONUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);

        // Recursive function to validate and ensure all nodes have required properties
        let nodeCount = 0;
        const validateStructure = (nodes: any[], depth: number): FolderNode[] => {
          if (!Array.isArray(nodes)) return [];
          if (depth > MAX_STRUCTURE_DEPTH) {
            throw new Error(`Folder structure exceeds the ${MAX_STRUCTURE_DEPTH}-level depth limit.`);
          }
          const seen = new Set<string>();
          return nodes.map((node: any) => {
            nodeCount += 1;
            if (nodeCount > MAX_STRUCTURE_NODES) {
              throw new Error(`Folder structure exceeds the ${MAX_STRUCTURE_NODES} node limit.`);
            }
            const rawName = typeof node.name === "string" ? node.name.trim() : "";
            if (!rawName) {
              throw new Error("Folder structure contains an empty node name.");
            }
            if (rawName.startsWith("/") || rawName.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(rawName)) {
              throw new Error("Absolute paths are not allowed in imported folder schemas.");
            }
            if (rawName.split(/[\\/]/).some((segment: string) => segment === "..")) {
              throw new Error("Path traversal segments are not allowed in imported folder schemas.");
            }
            const sanitizedName = sanitizeNodeName(rawName);
            const duplicateKey = sanitizedName.toLocaleLowerCase();
            if (seen.has(duplicateKey)) {
              throw new Error(`Duplicate node name "${sanitizedName}" found in imported folder schema.`);
            }
            seen.add(duplicateKey);
            const validNode: FolderNode = {
              id: typeof node.id === 'string' && node.id ? node.id : Math.random().toString(36).substr(2, 9),
              name: sanitizedName,
              type: node.type === "file" ? "file" : "folder",
            };

            if (validNode.type === "folder" && Array.isArray(node.children)) {
              validNode.children = validateStructure(node.children, depth + 1);
            } else if (validNode.type === "folder") {
              validNode.children = [];
            }

            return validNode;
          });
        };

        // Handle both object wrapper and direct array
        let rawData = Array.isArray(json) ? json : (json.structure || json.data || json.children || [json]);
        if (!Array.isArray(rawData)) {
          rawData = [json];
        }

        const newStructure = validateStructure(rawData, 1);
        if (newStructure.length > 0) {
          // If first element isn't root folder, wrap it
          setStructure(newStructure);
          setErrorMessage(null);
          setStatusMessage("JSON structure loaded.");
        } else {
          console.error("No valid structure found in JSON");
          setErrorMessage("No valid folder structure was found in that JSON file.");
        }
      } catch (err) {
        console.error("Failed to parse JSON", err);
        setErrorMessage(err instanceof Error ? err.message : "Could not parse JSON structure.");
      }

      // Reset input so the same file can be uploaded again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const flattenedPaths = useMemo(() => {
    const paths: string[] = [];
    const traverse = (node: FolderNode, currentPath: string) => {
      const newPath = currentPath ? `${currentPath}/${node.name}` : node.name;
      paths.push(newPath);
      if (node.children) {
        node.children.forEach(child => traverse(child, newPath));
      }
    };
    structure.forEach(node => traverse(node, ""));
    return paths;
  }, [structure]);

  const handleCreate = async () => {
    setCreating(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const validationError = validateFolderNodes(structure);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
      const dest = await save({
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        defaultPath: "ProjectStructure.zip"
      });
      if (dest) {
        await invoke("create_folder_zip", { structure, outputPath: dest });
        setStatusMessage(`ZIP saved to ${dest}`);
      }
    } catch (e) {
      console.error(e);
      setErrorMessage(`ZIP export failed: ${String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateOnDisk = async () => {
    setCreatingOnDisk(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const validationError = validateFolderNodes(structure);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
      const dest = await open({
        directory: true,
        multiple: false,
        title: "Choose destination folder"
      });
      if (!dest || typeof dest !== "string") {
        return;
      }
      await invoke("create_folder_structure", { structure, outputRoot: dest });
      setStatusMessage(`Folder structure created in ${dest}`);
      try {
        await openPath(dest);
      } catch (openErr) {
        console.warn("openPath failed for folder structure output", openErr);
      }
    } catch (e) {
      console.error(e);
      setErrorMessage(`Create on disk failed: ${String(e)}`);
    } finally {
      setCreatingOnDisk(false);
    }
  };

  const renderNode = (node: FolderNode, depth: number = 0) => {
    const hierarchyLabel = node.type === "folder" ? getHierarchyLabel(depth) : null;
    const depthClass =
      depth === 0 ? "depth-main" : depth === 1 ? "depth-primary" : depth === 2 ? "depth-secondary" : "depth-detail";

    return (
      <div key={node.id} className={`folder-node-wrapper ${depthClass}`} style={{ marginLeft: depth > 0 ? 24 : 0 }}>
        <div className={`folder-node-item ${node.id === "root" || depth === 0 ? "root-node" : ""} ${depthClass}`}>
          <div className="folder-node-drag-handle">
            <Hash size={12} opacity={0.3} />
          </div>
          <div className={`folder-node-icon ${node.type === "folder" ? "folder-kind" : "file-kind"}`}>
            {node.type === "folder" ? <Folder size={18} fill="currentColor" fillOpacity={0.1} /> : <FileType size={18} />}
          </div>
          <div className="folder-node-content">
            <div className="folder-node-title-row">
              <input
                className="folder-node-input"
                value={node.name}
                onChange={(e) => updateName(node.id, e.target.value)}
                placeholder="Name..."
                spellCheck={false}
              />
              {hierarchyLabel && <span className={`folder-node-tier ${depthClass}`}>{hierarchyLabel}</span>}
            </div>
          </div>
          <div className="folder-node-actions">
            {node.type === "folder" && (
              <button className="btn-icon-sm" onClick={() => addNode(node.id, "folder")} title="Add Child Folder">
                <Plus size={14} />
              </button>
            )}
            {(node.id !== "root" && depth !== 0) && (
              <button className="btn-icon-sm danger" onClick={() => removeNode(node.id)} title="Remove">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        {node.children && node.children.length > 0 && (
          <div className="folder-node-children">
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="folder-creator-container">
      <div className="folder-creator-header">
        <div className="header-left">
          <div className="accent-badge">VFX PIPELINE</div>
          <h2>Project Structure Creator</h2>
          <p>Build and export sophisticated directory hierarchies for macOS & Windows.</p>
        </div>
        <div className="header-right">
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            onChange={handleJSONUpload}
            style={{ display: 'none' }}
          />
          <button className="btn btn-secondary btn-glass" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={16} /> Import JSON
          </button>
          <button className="btn btn-secondary btn-glass" onClick={resetStructure}>
            <RotateCcw size={16} /> Reset
          </button>
          <button className="btn btn-secondary btn-glass" onClick={handleCreateOnDisk} disabled={creating || creatingOnDisk}>
            {creatingOnDisk ? <div className="spinner" /> : <Folder size={16} />}
            <span>{creatingOnDisk ? "Creating..." : "Create on disk"}</span>
          </button>
          <button className="btn btn-primary btn-glow" onClick={handleCreate} disabled={creating || creatingOnDisk}>
            {creating ? <div className="spinner" /> : <Download size={16} />}
            <span>{creating ? "Packaging ZIP..." : "Export structure"}</span>
          </button>
        </div>
      </div>

      {(statusMessage || errorMessage) && (
        <div className={`folder-creator-status ${errorMessage ? "error" : "success"}`} style={{
          background: errorMessage ? "rgba(239, 68, 68, 0.1)" : "rgba(0, 209, 255, 0.05)",
          border: `1px solid ${errorMessage ? "rgba(239, 68, 68, 0.2)" : "rgba(0, 209, 255, 0.1)"}`,
          color: errorMessage ? "var(--status-red)" : "var(--color-accent)"
        }}>
          {errorMessage || statusMessage}
        </div>
      )}

      <div className="folder-creator-workspace">
        <div className="workspace-section segment">
          <div className="segment-header">
            <FolderTree size={16} />
            <span style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Visual Builder</span>
          </div>
          <div className="visual-preview premium-scroll" style={{ background: "rgba(0,0,0,0.2)", border: "var(--inspector-border)", borderRadius: "var(--radius-md)" }}>
            {structure.map(node => renderNode(node))}
          </div>
        </div>

        <div className="workspace-section segment">
          <div className="segment-header">
            <ChevronRight size={16} />
            <span style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Structure Review</span>
          </div>
          <div className="path-preview premium-scroll" style={{ background: "rgba(0,0,0,0.2)", border: "var(--inspector-border)", borderRadius: "var(--radius-md)" }}>
            <div className="path-list">
              {flattenedPaths.map((path, idx) => (
                <div key={idx} className="path-item" style={{ animationDelay: `${idx * 0.05}s` }}>
                  <span className="path-index">{(idx + 1).toString().padStart(2, '0')}</span>
                  <span className="path-string">{path}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .folder-creator-container {
          padding: 32px;
          background: var(--inspector-bg);
          backdrop-filter: var(--inspector-glass-blur);
          border-radius: var(--radius-lg);
          border: var(--inspector-border);
          color: var(--text-primary);
          animation: fadeInFolderCreator 0.36s ease;
          box-shadow: var(--shadow-lg);
          height: calc(100vh - 180px);
          display: flex;
          flex-direction: column;
        }

        @keyframes fadeInFolderCreator {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .folder-creator-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 32px;
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

        .folder-creator-header h2 {
          margin: 0;
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .folder-creator-header p {
          margin: 8px 0 0;
          color: var(--text-secondary);
          font-size: 0.95rem;
        }

        .folder-creator-workspace {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 24px;
          flex: 1;
          min-height: 0;
        }
        .folder-creator-status {
          margin-bottom: 18px;
          padding: 12px 14px;
          border-radius: var(--radius-md);
          font-size: 0.92rem;
        }

        .workspace-section {
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .segment-header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0 4px 12px;
            opacity: 0.8;
        }

        .visual-preview, .path-preview {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
        }

        .folder-node-wrapper {
          position: relative;
        }

        .folder-node-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.02);
          border-radius: var(--radius-md);
          margin-bottom: 6px;
          border: 1px solid rgba(255,255,255,0.03);
          transition: all 0.18s ease;
          animation: nodeFade 0.24s ease;
        }

        .root-node {
            background: rgba(0, 209, 255, 0.04);
            border-color: rgba(0, 209, 255, 0.1);
        }

        @keyframes nodeFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .folder-node-item:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
        }

        .folder-node-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          flex: 0 0 18px;
        }

        .folder-node-icon.folder-kind {
          color: var(--color-accent);
        }

        .folder-node-icon.file-kind {
          color: var(--text-muted);
        }

        .folder-node-content {
          flex: 1;
          min-width: 0;
        }

        .folder-node-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .folder-node-input {
          background: transparent;
          border: none;
          color: var(--text-primary);
          font-size: 0.9rem;
          font-weight: 500;
          flex: 1;
          outline: none;
          min-width: 0;
        }

        .folder-node-tier {
          padding: 2px 8px;
          border-radius: var(--radius-full);
          border: 1px solid rgba(255,255,255,0.05);
          background: rgba(255,255,255,0.03);
          color: var(--text-muted);
          font-size: var(--inspector-label-size);
          font-weight: var(--inspector-label-weight);
          letter-spacing: var(--inspector-label-spacing);
          text-transform: uppercase;
          white-space: nowrap;
        }

        .folder-node-tier.depth-primary {
          opacity: 0.8;
        }

        .folder-node-tier.depth-secondary {
          opacity: 0.6;
        }

        .folder-node-tier.depth-detail {
          display: none;
        }

        .folder-node-actions {
          display: flex;
          gap: 6px;
          opacity: 0;
          transition: all 0.2s ease;
        }

        .folder-node-item:hover .folder-node-actions {
          opacity: 1;
        }

        .folder-node-children {
          position: relative;
          border-left: 1px solid rgba(255,255,255,0.03);
          margin-left: 10px;
          padding-left: 12px;
        }

        .btn-glow:hover {
            box-shadow: 0 0 20px var(--color-accent-glow);
        }

        .btn-glass {
            background: rgba(255,255,255,0.02);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.04);
        }

        .path-list {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .path-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 0.8rem;
            animation: fadeInPath 0.3s ease forwards;
            opacity: 0;
            background: rgba(255,255,255,0.01);
        }

        @keyframes fadeInPath {
            to { opacity: 1; }
        }

        .path-index {
            opacity: 0.2;
            font-size: 10px;
            font-weight: 900;
        }

        .path-string {
            opacity: 0.6;
            letter-spacing: 0.02em;
        }

        .premium-scroll::-webkit-scrollbar {
            width: 4px;
        }
        .premium-scroll::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.05);
            border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
