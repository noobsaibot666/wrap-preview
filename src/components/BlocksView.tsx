import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Scissors, GitMerge, RefreshCw, Pencil } from "lucide-react";
import { SceneBlockWithClips, Thumbnail } from "../types";
import { FilmStrip } from "./FilmStrip";

interface BlocksViewProps {
  projectId: string;
  thumbnailCache: Record<string, string>;
  thumbnailsByClipId: Record<string, Thumbnail[]>;
  onSelectedBlockIdsChange: (ids: string[]) => void;
  onRequestGenerateThumbnails: () => Promise<void>;
}

export function BlocksView({
  projectId,
  thumbnailCache,
  thumbnailsByClipId,
  onSelectedBlockIdsChange,
  onRequestGenerateThumbnails
}: BlocksViewProps) {
  const [blocks, setBlocks] = useState<SceneBlockWithClips[]>([]);
  const [loading, setLoading] = useState(false);
  const [gapSeconds, setGapSeconds] = useState(60);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  useEffect(() => {
    onSelectedBlockIdsChange(selectedIds);
  }, [selectedIds, onSelectedBlockIdsChange]);

  const refreshBlocks = async () => {
    setLoading(true);
    try {
      const result = await invoke<SceneBlockWithClips[]>("get_scene_blocks", { projectId });
      setBlocks(result);
    } finally {
      setLoading(false);
    }
  };

  const buildBlocks = async () => {
    setLoading(true);
    try {
      const result = await invoke<SceneBlockWithClips[]>("build_scene_blocks", { projectId, gapSeconds });
      setBlocks(result);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshBlocks();
  }, [projectId]);

  const toggleBlock = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renameBlock = async (id: string, current: string) => {
    const next = window.prompt("Rename block", current);
    if (!next || next.trim() === current) return;
    await invoke("rename_scene_block", { blockId: id, name: next.trim() });
    await refreshBlocks();
  };

  const mergeIntoPrevious = async (index: number) => {
    if (index <= 0) return;
    const previous = blocks[index - 1];
    const current = blocks[index];
    await invoke("merge_scene_blocks", {
      primaryBlockId: previous.block.id,
      secondaryBlockId: current.block.id
    });
    await refreshBlocks();
  };

  const splitAtClip = async (blockId: string, clipId: string) => {
    await invoke("split_scene_block", { blockId, splitAtClipId: clipId });
    await refreshBlocks();
  };

  return (
    <div>
      <div className="toolbar premium-toolbar" style={{ marginBottom: 16 }}>
        <div className="toolbar-left-group">
          <div className="toolbar-segment">
            <span className="toolbar-label">Gap Threshold (sec)</span>
            <input
              className="input-text"
              type="number"
              min={15}
              max={300}
              step={5}
              value={gapSeconds}
              onChange={(e) => setGapSeconds(Math.max(15, Number(e.target.value || 60)))}
              style={{ width: 100 }}
            />
          </div>
        </div>
        <div className="toolbar-right-group">
          <button className="btn btn-secondary" onClick={refreshBlocks} disabled={loading}>
            <RefreshCw size={14} /> Reload
          </button>
          <button className="btn btn-primary" onClick={buildBlocks} disabled={loading}>
            <Scissors size={14} /> Build Blocks
          </button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <div className="empty-state">No blocks yet. Click "Build Blocks".</div>
      ) : (
        <div className="clip-list">
          {blocks.map((item, idx) => (
            <div key={item.block.id} className="clip-card selected">
              <div className="clip-card-header">
                <div className="clip-card-title-group">
                  <label className="clip-selection-label">
                    <input
                      type="checkbox"
                      checked={selected.has(item.block.id)}
                      onChange={() => toggleBlock(item.block.id)}
                      className="clip-checkbox"
                    />
                  </label>
                  <span className="clip-filename">{item.block.name}</span>
                </div>
                <div className="clip-card-header-right" style={{ gap: 8 }}>
                  <button className="btn-link" onClick={() => renameBlock(item.block.id, item.block.name)}>
                    <Pencil size={14} />
                  </button>
                  <button className="btn-link" onClick={() => mergeIntoPrevious(idx)} disabled={idx === 0}>
                    <GitMerge size={14} />
                  </button>
                </div>
              </div>

              <div className="clip-metadata-compact" style={{ marginBottom: 8 }}>
                <span className="metadata-tag">{item.block.clip_count} clips</span>
                <span className="metadata-tag">Confidence {(item.block.confidence * 100).toFixed(0)}%</span>
                <span className="metadata-tag">{item.block.camera_list || "No camera labels inferred"}</span>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {item.clips.map((clip, clipIdx) => (
                  <div key={clip.id} className="block-clip-row">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {clip.filename}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {!thumbnailsByClipId[clip.id] || thumbnailsByClipId[clip.id].length === 0 ? (
                          <button className="btn-link" onClick={onRequestGenerateThumbnails}>
                            Generate thumbnails
                          </button>
                        ) : null}
                        {clipIdx > 0 && (
                          <button className="btn-link" onClick={() => splitAtClip(item.block.id, clip.id)}>
                            Split Here
                          </button>
                        )}
                      </div>
                    </div>
                    <FilmStrip
                      clipId={clip.id}
                      thumbnails={thumbnailsByClipId[clip.id] || []}
                      thumbnailCache={thumbnailCache}
                      status={clip.status}
                      count={5}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
