import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Scissors, GitMerge, RefreshCw, Pencil, Rows3, Timer, CheckCircle2, ChevronUp, ChevronDown, Send } from "lucide-react";
import { SceneBlockWithClips, Thumbnail } from "../types";
import { FilmStrip } from "./FilmStrip";

interface BlocksViewProps {
  projectId: string;
  thumbnailCache: Record<string, string>;
  thumbnailsByClipId: Record<string, Thumbnail[]>;
  onSelectedBlockIdsChange: (ids: string[]) => void;
  onOpenDelivery: () => void;
}

type BuildMode = "time_gap" | "scene_change" | "multicam_overlap";
type GroupMode = "block" | "camera" | "day" | "tech" | "selects";
type ViewMode = "list" | "timeline";

export function BlocksView({
  projectId,
  thumbnailCache,
  thumbnailsByClipId,
  onSelectedBlockIdsChange,
  onOpenDelivery,
}: BlocksViewProps) {
  const [blocks, setBlocks] = useState<SceneBlockWithClips[]>([]);
  const [loading, setLoading] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>("time_gap");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [groupMode, setGroupMode] = useState<GroupMode>("block");
  const [gapSeconds, setGapSeconds] = useState(60);
  const [overlapWindowSeconds, setOverlapWindowSeconds] = useState(30);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [selectedCameras, setSelectedCameras] = useState<string[]>([]);
  const [audioFilter, setAudioFilter] = useState("all");
  const [fpsFilter, setFpsFilter] = useState("all");
  const [resolutionFilter, setResolutionFilter] = useState("all");
  const [codecFilter, setCodecFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [selectFilter, setSelectFilter] = useState("all");
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  useEffect(() => {
    onSelectedBlockIdsChange(selectedIds);
  }, [selectedIds, onSelectedBlockIdsChange]);

  useEffect(() => {
    const keyBase = `wp_blocks_${projectId}_`;
    const get = (k: string, fallback: string) => localStorage.getItem(keyBase + k) || fallback;
    setGroupMode(get("group", "block") as GroupMode);
    setViewMode(get("view", "list") as ViewMode);
    const savedCameras = localStorage.getItem(keyBase + "cameras");
    setSelectedCameras(savedCameras ? JSON.parse(savedCameras) : []);
  }, [projectId]);

  useEffect(() => {
    const keyBase = `wp_blocks_${projectId}_`;
    localStorage.setItem(keyBase + "group", groupMode);
    localStorage.setItem(keyBase + "view", viewMode);
    localStorage.setItem(keyBase + "cameras", JSON.stringify(selectedCameras));
  }, [projectId, groupMode, viewMode, selectedCameras]);

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
      const result = await invoke<SceneBlockWithClips[]>("build_scene_blocks", {
        projectId,
        mode: buildMode,
        gapSeconds,
        overlapWindowSeconds
      });
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

  const mergeIntoPrevious = async (primaryBlockId: string, secondaryBlockId: string) => {
    await invoke("merge_scene_blocks", {
      primaryBlockId,
      secondaryBlockId
    });
    await refreshBlocks();
  };

  const splitAtClip = async (blockId: string, clipId: string) => {
    await invoke("split_scene_block", { blockId, splitAtClipId: clipId });
    await refreshBlocks();
  };

  const filterClip = (clip: SceneBlockWithClips["clips"][number]) => {
    const inferredCamera = inferCamera(clip.filename);
    if (selectedCameras.length > 0 && !selectedCameras.includes(inferredCamera)) return false;
    if (audioFilter !== "all" && audioState(clip) !== audioFilter) return false;
    if (fpsFilter !== "all" && fpsBucket(clip.fps) !== fpsFilter) return false;
    if (resolutionFilter !== "all" && `${clip.width}x${clip.height}` !== resolutionFilter) return false;
    if (codecFilter !== "all" && clip.video_codec !== codecFilter) return false;
    if (dayFilter !== "all" && clip.created_at.slice(0, 10) !== dayFilter) return false;
    if (selectFilter !== "all") {
      if (selectFilter === "pick" && clip.flag !== "pick") return false;
      if (selectFilter === "reject" && clip.flag !== "reject") return false;
      if (selectFilter === "rated" && clip.rating <= 0) return false;
    }
    return true;
  };

  const filteredBlocks = useMemo(() => {
    return blocks
      .map((item) => ({ ...item, clips: item.clips.filter(filterClip) }))
      .filter((item) => item.clips.length > 0);
  }, [blocks, selectedCameras, audioFilter, fpsFilter, resolutionFilter, codecFilter, dayFilter, selectFilter]);

  const reorderBlocks = useCallback(async (draggedId: string, targetId: string) => {
    if (draggedId === targetId || groupMode !== "block") return;
    const orderedIds = filteredBlocks.map((item) => item.block.id);
    const fromIndex = orderedIds.indexOf(draggedId);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const nextIds = [...orderedIds];
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved);
    await invoke("reorder_scene_blocks", { projectId, blockIds: nextIds });
    await refreshBlocks();
    setFocusedBlockId(moved);
  }, [filteredBlocks, groupMode, projectId]);

  const moveBlockByDirection = useCallback(async (blockId: string, direction: -1 | 1) => {
    if (groupMode !== "block") return;
    const orderedIds = filteredBlocks.map((item) => item.block.id);
    const index = orderedIds.indexOf(blockId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) return;
    await reorderBlocks(blockId, orderedIds[targetIndex]);
  }, [filteredBlocks, groupMode, reorderBlocks]);

  useEffect(() => {
    setFocusedBlockId((current) => {
      if (current && filteredBlocks.some((item) => item.block.id === current)) return current;
      return filteredBlocks[0]?.block.id ?? null;
    });
  }, [filteredBlocks]);

  const cameraOptions = useMemo(() => {
    const set = new Set<string>();
    blocks.forEach((b) => b.clips.forEach((c) => set.add(inferCamera(c.filename))));
    return Array.from(set).sort();
  }, [blocks]);

  const toggleCamera = (camera: string) => {
    setSelectedCameras((prev) =>
      prev.includes(camera) ? prev.filter((item) => item !== camera) : [...prev, camera]
    );
  };
  const fpsOptions = useMemo(() => Array.from(new Set(blocks.flatMap((b) => b.clips.map((c) => fpsBucket(c.fps))))).sort(), [blocks]);
  const resolutionOptions = useMemo(() => Array.from(new Set(blocks.flatMap((b) => b.clips.map((c) => `${c.width}x${c.height}`)))).sort(), [blocks]);
  const codecOptions = useMemo(() => Array.from(new Set(blocks.flatMap((b) => b.clips.map((c) => c.video_codec)))).sort(), [blocks]);
  const dayOptions = useMemo(() => Array.from(new Set(blocks.flatMap((b) => b.clips.map((c) => c.created_at.slice(0, 10))))).sort(), [blocks]);

  const groupedBlocks = useMemo(() => {
    if (groupMode === "block") return [{ label: "Blocks", items: filteredBlocks }];
    const map = new Map<string, SceneBlockWithClips[]>();
    for (const block of filteredBlocks) {
      for (const clip of block.clips) {
        const key =
          groupMode === "camera" ? inferCamera(clip.filename) :
            groupMode === "day" ? clip.created_at.slice(0, 10) :
              groupMode === "tech" ? `${fpsBucket(clip.fps)} / ${clip.width}x${clip.height}` :
                clip.flag === "pick" ? "Picks" : clip.flag === "reject" ? "Rejects" : clip.rating > 0 ? "Rated" : "Unselected";
        const synthetic: SceneBlockWithClips = {
          block: { ...block.block, id: `${block.block.id}_${clip.id}_${key}` },
          clips: [clip]
        };
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(synthetic);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, items]) => ({ label, items }));
  }, [filteredBlocks, groupMode]);

  const orderedBlocks = useMemo(() => groupedBlocks.flatMap((group) => group.items), [groupedBlocks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.closest("[data-tooltip]")) return;
      if (!orderedBlocks.length) return;

      const currentIndex = Math.max(0, orderedBlocks.findIndex((item) => item.block.id === focusedBlockId));
      const currentBlock = orderedBlocks[currentIndex];
      const key = event.key.toLowerCase();

      if (key === "arrowdown" || key === "arrowup") {
        event.preventDefault();
        const delta = key === "arrowdown" ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(orderedBlocks.length - 1, currentIndex + delta));
        const nextId = orderedBlocks[nextIndex]?.block.id;
        if (!nextId) return;
        setFocusedBlockId(nextId);
        blockRefs.current[nextId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }

      if (key === "s" && groupMode === "block" && currentBlock) {
        event.preventDefault();
        toggleBlock(currentBlock.block.id);
        return;
      }

      if (key === "m" && groupMode === "block" && currentIndex > 0 && currentBlock) {
        event.preventDefault();
        void mergeIntoPrevious(orderedBlocks[currentIndex - 1].block.id, currentBlock.block.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedBlockId, groupMode, orderedBlocks]);

  return (
    <div className="scene-blocks-view">
      <div className="scene-blocks-toolbar-stack">
        <div className="toolbar premium-toolbar scene-blocks-toolbar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
          <div className="toolbar-left-group">
            <div className="toolbar-segment delayed-tooltip" data-tooltip="Choose how Scene Blocks are displayed.">
              <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>View</span>
              <select className="input-select" value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)} style={{ width: 120 }}>
                <option value="list">List</option>
                <option value="timeline">Timeline</option>
              </select>
            </div>
            <div className="toolbar-segment delayed-tooltip" data-tooltip="Change how clips are grouped into block sections.">
              <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Group</span>
              <select className="input-select" value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)} style={{ width: 136 }}>
                <option value="block">Block</option>
                <option value="camera">Camera</option>
                <option value="day">Day</option>
                <option value="tech">Tech</option>
                <option value="selects">Selects</option>
              </select>
            </div>
            <div className="toolbar-separator" />
            <div className="toolbar-segment delayed-tooltip" data-tooltip="Choose the logic used to rebuild Scene Blocks.">
              <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Build</span>
              <select
                className="input-select"
                value={buildMode}
                onChange={(e) => setBuildMode(e.target.value as BuildMode)}
                style={{ width: 170 }}
              >
                <option value="time_gap">Time Gap</option>
                <option value="scene_change">Scene Change</option>
                <option value="multicam_overlap">Multicam Overlap</option>
              </select>
            </div>
            <div className="toolbar-segment delayed-tooltip" data-tooltip={buildMode === "multicam_overlap" ? "Time overlap used to connect cameras into one block." : "Maximum gap before clips split into a new block."}>
              <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>{buildMode === "multicam_overlap" ? "Window" : "Gap"}</span>
              <input
                className="input-text"
                type="number"
                min={buildMode === "multicam_overlap" ? 5 : 15}
                max={300}
                step={5}
                value={buildMode === "multicam_overlap" ? overlapWindowSeconds : gapSeconds}
                onChange={(e) => {
                  const value = Number(e.target.value || (buildMode === "multicam_overlap" ? 30 : 60));
                  if (buildMode === "multicam_overlap") setOverlapWindowSeconds(Math.max(5, value));
                  else setGapSeconds(Math.max(15, value));
                }}
                style={{ width: 82 }}
              />
            </div>
          </div>
          <div className="toolbar-right-group">
            <button className="btn btn-secondary btn-sm delayed-tooltip" data-tooltip="Refresh blocks without rebuilding." onClick={refreshBlocks} disabled={loading}>
              <RefreshCw size={14} /> Reload
            </button>
            {buildMode === "scene_change" && (
              <button className="btn btn-ghost btn-sm delayed-tooltip" data-tooltip="Clear cached scene-detection results for this project." onClick={() => invoke("clear_scene_detection_cache", { projectId })} disabled={loading}>
                <Timer size={14} /> Clear Cache
              </button>
            )}
            <button className="btn btn-primary btn-sm delayed-tooltip" data-tooltip="Rebuild Scene Blocks using the current build settings." onClick={buildBlocks} disabled={loading}>
              <Scissors size={14} /> Rebuild
            </button>
            <button className="btn btn-secondary btn-sm delayed-tooltip" data-tooltip="Send the current Scene Blocks work into Delivery." onClick={onOpenDelivery}>
              <Send size={14} /> Delivery
            </button>
          </div>
        </div>

        <div className="toolbar premium-toolbar scene-blocks-toolbar scene-blocks-filter-toolbar" style={{ background: "rgba(255,255,255,0.01)", borderBottom: "var(--inspector-border)" }}>
          <div className="toolbar-left-group scene-blocks-filter-group" style={{ overflowX: "auto", whiteSpace: "nowrap" }}>
            <div className="camera-chip-filter" style={{ display: "flex", gap: "var(--space-xs)" }}>
              <button
                className={`btn btn-ghost btn-xs ${selectedCameras.length === 0 ? "active" : ""}`}
                onClick={() => setSelectedCameras([])}
                style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700, padding: "2px 8px" }}
              >
                All Cameras
              </button>
              {cameraOptions.map((camera) => (
                <button
                  key={camera}
                  className={`btn btn-ghost btn-xs ${selectedCameras.includes(camera) ? "active" : ""}`}
                  onClick={() => toggleCamera(camera)}
                  style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700, padding: "2px 8px" }}
                >
                  {camera}
                </button>
              ))}
            </div>
            <div className="toolbar-separator" />
            <select className="input-select" value={audioFilter} onChange={(e) => setAudioFilter(e.target.value)} style={{ height: 26, fontSize: 11 }}>
              <option value="all">All Audio</option>
              <option value="audio_ok">Audio OK</option>
              <option value="no_audio">No Audio</option>
              <option value="possible_clip">Possible Clip</option>
              <option value="very_low">Very Low</option>
            </select>
            <select className="input-select" value={fpsFilter} onChange={(e) => setFpsFilter(e.target.value)} style={{ height: 26, fontSize: 11 }}>
              <option value="all">All FPS</option>
              {fpsOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input-select" value={resolutionFilter} onChange={(e) => setResolutionFilter(e.target.value)} style={{ height: 26, fontSize: 11 }}>
              <option value="all">All Res</option>
              {resolutionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input-select" value={codecFilter} onChange={(e) => setCodecFilter(e.target.value)} style={{ height: 26, fontSize: 11 }}>
              <option value="all">All Codec</option>
              {codecOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input-select" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} style={{ height: 26, fontSize: 11 }}>
              <option value="all">All Days</option>
              {dayOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input-select" value={selectFilter} onChange={(e) => setSelectFilter(e.target.value)} style={{ height: 26, fontSize: 11 }}>
              <option value="all">All Selects</option>
              <option value="pick">Picks</option>
              <option value="reject">Rejects</option>
              <option value="rated">Rated</option>
            </select>
          </div>
        </div>
      </div>

      <div className="scene-blocks-content custom-scrollbar">
        {loading ? (
          <div className="clip-list scene-blocks-list" style={{ padding: "var(--space-md)" }}>
            {[1, 2, 3].map(i => <BlockSkeleton key={i} />)}
          </div>
        ) : filteredBlocks.length === 0 ? (
          <div className="empty-state">
            <Rows3 size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
            <p>No blocks match current filters.</p>
          </div>
        ) : viewMode === "timeline" ? (
          <TimelineView blocks={filteredBlocks} onSelectBlock={toggleBlock} selected={selected} />
        ) : (
          <div className="clip-list scene-blocks-list">
            {groupedBlocks.map((group) => (
              <div key={group.label}>
                {groupMode !== "block" && <div className="toolbar-label" style={{ margin: "8px 0 10px" }}>{group.label}</div>}
                {group.items.map((item) => {
                  const stats = blockStats(item);
                  const blockIndex = orderedBlocks.findIndex((entry) => entry.block.id === item.block.id);
                  const isFocused = focusedBlockId === item.block.id;
                  return (
                    <div
                      key={item.block.id}
                      ref={(node) => {
                        blockRefs.current[item.block.id] = node;
                      }}
                      className={`clip-card scene-block-card ${selected.has(item.block.id) ? "selected" : ""} ${isFocused ? "focused" : ""}`}
                      onClick={() => setFocusedBlockId(item.block.id)}
                      style={{
                        background: "var(--inspector-bg)",
                        border: "var(--inspector-border)",
                        backdropFilter: "var(--inspector-glass-blur)",
                        borderRadius: "var(--radius-lg)"
                      }}
                    >
                      <div className="clip-card-header" style={{ borderBottom: "var(--inspector-border)", paddingBottom: 10, marginBottom: 12 }}>
                        <div className="clip-card-title-group">
                          <button
                            type="button"
                            className="btn-link btn-link-prominent delayed-tooltip"
                            data-tooltip="Rename block."
                            onClick={(event) => {
                              event.stopPropagation();
                              void renameBlock(item.block.id, item.block.name);
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                          <span className="clip-filename" style={{ fontSize: "var(--inspector-value-size)", fontWeight: "var(--inspector-value-weight)" }}>{item.block.name}</span>
                        </div>
                        <div className="clip-card-header-right scene-block-card-actions">
                          {groupMode === "block" && (
                            <>
                              <button
                                type="button"
                                className="btn-link btn-link-prominent delayed-tooltip"
                                data-tooltip="Move block up in sequence."
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void moveBlockByDirection(item.block.id, -1);
                                }}
                                disabled={blockIndex <= 0}
                              >
                                <ChevronUp size={15} />
                              </button>
                              <button
                                type="button"
                                className="btn-link btn-link-prominent delayed-tooltip"
                                data-tooltip="Move block down in sequence."
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void moveBlockByDirection(item.block.id, 1);
                                }}
                                disabled={blockIndex >= orderedBlocks.length - 1}
                              >
                                <ChevronDown size={15} />
                              </button>
                            </>
                          )}
                          {groupMode === "block" && (
                            <button
                              type="button"
                              className="btn-flag btn-select scene-block-connect delayed-tooltip"
                              data-tooltip="Merge this block into the one above (M)."
                              onClick={(event) => {
                                event.stopPropagation();
                                void mergeIntoPrevious(orderedBlocks[blockIndex - 1].block.id, item.block.id);
                              }}
                              disabled={blockIndex <= 0}
                            >
                              <GitMerge size={16} />
                              <span>Connect</span>
                            </button>
                          )}
                          {groupMode === "block" && (
                            <button
                              type="button"
                              className={`btn-flag btn-select scene-block-select ${selected.has(item.block.id) ? "active" : ""}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleBlock(item.block.id);
                              }}
                              title="Select block (S)"
                              aria-label={selected.has(item.block.id) ? "Selected" : "Select"}
                            >
                              <CheckCircle2 size={14} />
                              <span>{selected.has(item.block.id) ? "Selected" : "Select"}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="clip-metadata-compact" style={{ marginBottom: 12, opacity: 0.8 }}>
                        <span className="metadata-tag" style={{ background: "rgba(255,255,255,0.03)", border: "var(--inspector-border)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700 }}>{item.block.clip_count} CLIPS</span>
                        <span className="metadata-tag" style={{ background: "rgba(255,255,255,0.03)", border: "var(--inspector-border)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700 }}>{stats.duration}</span>
                        <span className="metadata-tag" style={{ background: "rgba(255,255,255,0.03)", border: "var(--inspector-border)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700 }}>CAM {stats.cameraCount}</span>
                        <span className="metadata-tag" style={{ background: "rgba(255,255,255,0.03)", border: "var(--inspector-border)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700 }}>AUDIO {stats.audioPresentPct}%</span>
                        <span className="metadata-tag" style={{ background: "rgba(255,255,255,0.03)", border: "var(--inspector-border)", color: "var(--status-ok)", fontSize: 10, fontWeight: 700 }}>CONFIDENCE {(item.block.confidence * 100).toFixed(0)}%</span>
                        {stats.mixedFps && <span className="metadata-tag danger-tag" style={{ fontSize: 10, fontWeight: 700 }}>MIXED FPS</span>}
                        {stats.missingTimecode && <span className="metadata-tag danger-tag" style={{ fontSize: 10, fontWeight: 700 }}>NO TC</span>}
                        {stats.audioPresentPct < 100 && <span className="metadata-tag warn-tag" style={{ fontSize: 10, fontWeight: 700 }}>AUDIO WARN ({stats.audioPresentPct}%)</span>}
                      </div>

                      <div style={{ display: "grid", gap: 10 }}>
                        {item.clips.map((clip, clipIdx) => (
                          <div key={clip.id} className="block-clip-row">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                              <div className="scene-block-clip-heading">
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{clip.filename}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {clipIdx > 0 && groupMode === "block" && (
                                  <button className="btn-link delayed-tooltip" data-tooltip="Split the block at this clip." onClick={() => splitAtClip(item.block.id, clip.id)}>
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
                              aspectRatio={clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9}
                              isImage={clip.duration_ms === 0}
                              fallbackThumbnailSrc={thumbnailsByClipId[clip.id]?.[0]?.file_path}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fpsBucket(fps: number): string {
  if (fps >= 59) return "60+";
  if (fps >= 47) return "48-59";
  if (fps >= 29) return "30-47";
  if (fps > 0) return "24-29";
  return "unknown";
}

function inferCamera(filename: string): string {
  const upper = filename.toUpperCase();
  for (const token of upper.split(/[^A-Z0-9]+/)) {
    if (token === "A" || token === "B" || token === "C" || token === "D") return `Cam ${token}`;
    if (token.startsWith("CAM") && token.length > 3) return `Cam ${token.slice(3)}`;
  }
  return "Unknown";
}

function audioState(clip: SceneBlockWithClips["clips"][number]): "audio_ok" | "no_audio" | "possible_clip" | "very_low" {
  const summary = (clip.audio_summary || "").toUpperCase();
  if (summary.includes("NO AUDIO") || clip.audio_codec === "none") return "no_audio";
  if (summary.includes("POSSIBLE CLIP")) return "possible_clip";
  if (summary.includes("VERY LOW")) return "very_low";
  return "audio_ok";
}

function blockStats(item: SceneBlockWithClips) {
  const clips = item.clips;
  const durationSec = clips.reduce((sum, c) => sum + (c.duration_ms || 0), 0) / 1000;
  const cameras = new Set(clips.map((c) => inferCamera(c.filename)));
  const audioPresent = clips.filter((c) => audioState(c) !== "no_audio").length;
  const fpsValues = new Set(clips.map((c) => c.fps.toFixed(2)));
  const missingTimecode = clips.some((c) => !c.timecode || c.timecode.trim() === "");
  return {
    duration: `${Math.floor(durationSec / 60)}m ${Math.floor(durationSec % 60)}s`,
    cameraCount: cameras.size,
    audioPresentPct: Math.round((audioPresent / Math.max(1, clips.length)) * 100),
    mixedFps: fpsValues.size > 1,
    missingTimecode
  };
}

function TimelineView({
  blocks,
  onSelectBlock,
  selected
}: {
  blocks: SceneBlockWithClips[];
  onSelectBlock: (blockId: string) => void;
  selected: Set<string>;
}) {
  const times = blocks
    .flatMap((b) => [b.block.start_time, b.block.end_time])
    .filter((t): t is number => typeof t === "number");
  const minTs = Math.min(...times);
  const maxTs = Math.max(...times);
  const range = Math.max(1, maxTs - minTs);

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="toolbar-label" style={{ marginBottom: 8 }}><Rows3 size={14} style={{ verticalAlign: "middle", marginRight: 6 }} /> Timeline</div>
      <div style={{ display: "grid", gap: 8, overflowX: "auto" }}>
        {blocks.map((b) => {
          const start = ((b.block.start_time ?? minTs) - minTs) / range;
          const end = ((b.block.end_time ?? (b.block.start_time ?? minTs)) - minTs) / range;
          const width = Math.max(0.03, end - start);
          return (
            <button
              key={b.block.id}
              className={`btn btn-secondary ${selected.has(b.block.id) ? "active" : ""}`}
              style={{ justifyContent: "flex-start", height: 34, position: "relative", minWidth: 740 }}
              onClick={() => onSelectBlock(b.block.id)}
            >
              <span style={{ position: "absolute", left: `${start * 100}%`, width: `${width * 100}%`, top: 6, bottom: 6, borderRadius: 8, background: "rgba(0,255,230,0.22)", border: "1px solid rgba(0,255,230,0.55)" }} />
              <span style={{ position: "relative", zIndex: 1, paddingLeft: 8, fontSize: 12 }}>{b.block.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function BlockSkeleton() {
  return (
    <div className="clip-card scene-block-card skeleton-pulse" style={{ background: "var(--inspector-bg)", border: "var(--inspector-border)", borderRadius: "var(--radius-lg)", marginBottom: 16, height: 260 }}>
      <div className="clip-card-header" style={{ borderBottom: "var(--inspector-border)", padding: "12px 16px", height: 44 }}>
        <div style={{ width: 140, height: 16, background: "rgba(255,255,255,0.05)", borderRadius: 4 }} />
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ width: 80, height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 4 }} />
          ))}
        </div>
        <div style={{ height: 140, background: "rgba(255,255,255,0.03)", borderRadius: 8, display: "flex", gap: 2, padding: 4 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ flex: 1, height: "100%", background: "rgba(255,255,255,0.02)", borderRadius: 4 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
