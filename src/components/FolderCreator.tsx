import { useState, useCallback, useMemo, useRef } from "react";
import { FolderTree, Plus, Trash2, RotateCcw, Download, Folder, FileType, ChevronRight, Hash, UploadCloud } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

interface FolderNode {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: FolderNode[];
}

export function FolderCreator() {
  const [structure, setStructure] = useState<FolderNode[]>([
    { id: "root", name: "PROJECT_NAME", type: "folder", children: [] }
  ]);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetStructure = useCallback(() => {
    setStructure([{ id: "root", name: "PROJECT_NAME", type: "folder", children: [] }]);
  }, []);

  const addNode = useCallback((parentId: string, type: "folder" | "file") => {
    const newNode: FolderNode = {
      id: Math.random().toString(36).substr(2, 9),
      name: type === "folder" ? "new_folder" : "asset_file",
      type,
      children: type === "folder" ? [] : undefined
    };

    const updateStructure = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.map(node => {
        if (node.id === parentId) {
          return { ...node, children: [...(node.children || []), newNode] };
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
    // Sanitize name for filesystem
    const sanitized = name.replace(/[\/\\?%*:|"<>]/g, '_');
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
        const validateStructure = (nodes: any[]): FolderNode[] => {
          if (!Array.isArray(nodes)) return [];
          return nodes.map((node: any) => {
            const validNode: FolderNode = {
              id: typeof node.id === 'string' && node.id ? node.id : Math.random().toString(36).substr(2, 9),
              name: typeof node.name === 'string' ? node.name.replace(/[\/\\?%*:|"<>]/g, '_') : "unnamed_node",
              type: node.type === "file" ? "file" : "folder",
            };

            if (validNode.type === "folder" && Array.isArray(node.children)) {
              validNode.children = validateStructure(node.children);
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

        const newStructure = validateStructure(rawData);
        if (newStructure.length > 0) {
          // If first element isn't root folder, wrap it
          setStructure(newStructure);
        } else {
          console.error("No valid structure found in JSON");
        }
      } catch (err) {
        console.error("Failed to parse JSON", err);
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
    try {
      const dest = await save({
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        defaultPath: "ProjectStructure.zip"
      });
      if (dest) {
        await invoke("create_folder_zip", { structure, outputPath: dest });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const renderNode = (node: FolderNode, depth: number = 0) => (
    <div key={node.id} className="folder-node-wrapper" style={{ marginLeft: depth > 0 ? 24 : 0 }}>
      <div className={`folder-node-item ${node.id === "root" || depth === 0 ? "root-node" : ""}`}>
        <div className="folder-node-drag-handle">
          <Hash size={12} opacity={0.3} />
        </div>
        <div className="folder-node-icon">
          {node.type === "folder" ? <Folder size={18} fill="currentColor" fillOpacity={0.1} /> : <FileType size={18} />}
        </div>
        <input
          className="folder-node-input"
          value={node.name}
          onChange={(e) => updateName(node.id, e.target.value)}
          placeholder="Name..."
          spellCheck={false}
        />
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

  return (
    <div className="folder-creator-container">
      <div className="folder-creator-header">
        <div className="header-left">
          <div className="badge accent-badge">VFX PIPELINE</div>
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
          <button className="btn btn-primary btn-glow" onClick={handleCreate} disabled={creating}>
            {creating ? <div className="spinner" /> : <Download size={16} />}
            <span>{creating ? "Packaging ZIP..." : "Export structure"}</span>
          </button>
        </div>
      </div>

      <div className="folder-creator-workspace">
        <div className="workspace-section segment">
          <div className="segment-header">
            <FolderTree size={16} />
            <span>Visual Builder</span>
          </div>
          <div className="visual-preview premium-scroll">
            {structure.map(node => renderNode(node))}
          </div>
        </div>

        <div className="workspace-section segment">
          <div className="segment-header">
            <ChevronRight size={16} />
            <span>Structure Review</span>
          </div>
          <div className="path-preview premium-scroll">
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
          background: var(--color-bg-alt);
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.05);
          color: var(--color-text);
          animation: slideInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
          height: calc(100vh - 180px);
          display: flex;
          flex-direction: column;
        }

        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
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
            font-size: 10px;
            font-weight: 800;
            padding: 4px 8px;
            border-radius: 4px;
            width: fit-content;
            margin-bottom: 12px;
            letter-spacing: 0.1em;
        }

        .folder-creator-header h2 {
          margin: 0;
          font-size: 2rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .folder-creator-header p {
          margin: 8px 0 0;
          opacity: 0.5;
          font-size: 1rem;
        }

        .folder-creator-workspace {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 24px;
          flex: 1;
          min-height: 0;
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
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            opacity: 0.4;
        }

        .visual-preview, .path-preview {
          background: rgba(0,0,0,0.2);
          border-radius: 12px;
          padding: 24px;
          border: 1px solid rgba(255,255,255,0.03);
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
          padding: 10px 14px;
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
          margin-bottom: 8px;
          border: 1px solid rgba(255,255,255,0.03);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          animation: nodePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .root-node {
            background: rgba(var(--color-accent-rgb), 0.1);
            border-color: rgba(var(--color-accent-rgb), 0.2);
        }

        @keyframes nodePop {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .folder-node-item:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
          transform: translateX(4px);
        }

        .folder-node-icon {
          color: var(--color-accent);
          display: flex;
          align-items: center;
        }

        .folder-node-input {
          background: transparent;
          border: none;
          color: white;
          font-size: 0.95rem;
          font-weight: 500;
          flex: 1;
          outline: none;
        }

        .folder-node-actions {
          display: flex;
          gap: 6px;
          opacity: 0;
          transform: translateX(10px);
          transition: all 0.2s ease;
        }

        .folder-node-item:hover .folder-node-actions {
          opacity: 1;
          transform: translateX(0);
        }

        .folder-node-children {
          position: relative;
          border-left: 1px solid rgba(255,255,255,0.05);
          margin-left: 10px;
        }

        .btn-glow:hover {
            box-shadow: 0 0 20px var(--color-accent-soft);
        }

        .btn-glass {
            background: rgba(255,255,255,0.03);
            backdrop-filter: blur(10px);
        }

        .path-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .path-item {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: inherit;
            font-size: 13px;
            animation: fadeInPath 0.3s ease forwards;
            opacity: 0;
        }

        @keyframes fadeInPath {
            to { opacity: 1; }
        }

        .path-index {
            opacity: 0.2;
            font-size: 10px;
            font-weight: 700;
        }

        .path-string {
            opacity: 0.8;
            letter-spacing: 0.02em;
        }

        .premium-scroll::-webkit-scrollbar {
            width: 4px;
        }
        .premium-scroll::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
