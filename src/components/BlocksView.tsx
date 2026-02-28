import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Scissors, GitMerge, RefreshCw, Pencil, Rows3, Timer } from "lucide-react";
import { SceneBlockWithClips, Thumbnail } from "../types";
import { FilmStrip } from "./FilmStrip";

interface BlocksViewProps {
  projectId: string;
  thumbnailCache: Record<string, string>;
  thumbnailsByClipId: Record<string, Thumbnail[]>;
  onSelectedBlockIdsChange: (ids: string[]) => void;
  onOpenDelivery: () => void;
  onOpenReview: () => void;
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
  onOpenReview,
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

  return (
    <div>
      <div className="toolbar premium-toolbar" style={{ marginBottom: 16 }}>
        <div className="toolbar-left-group">
          <div className="toolbar-segment">
            <span className="toolbar-label">View</span>
            <select className="input-select" value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)} style={{ width: 130 }}>
              <option value="list">List</option>
              <option value="timeline">Timeline</option>
            </select>
          </div>
          <div className="toolbar-segment">
            <span className="toolbar-label">Group</span>
            <select className="input-select" value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)} style={{ width: 150 }}>
              <option value="block">By Block</option>
              <option value="camera">By Camera</option>
              <option value="day">By Day</option>
              <option value="tech">By Tech</option>
              <option value="selects">By Selects</option>
            </select>
          </div>
          <div className="toolbar-segment">
            <span className="toolbar-label">Mode</span>
            <select
              className="input-select"
              value={buildMode}
              onChange={(e) => setBuildMode(e.target.value as BuildMode)}
              style={{ width: 180 }}
            >
              <option value="time_gap">Time Gap</option>
              <option value="scene_change">Scene Change</option>
              <option value="multicam_overlap">Multicam Overlap</option>
            </select>
          </div>
          <div className="toolbar-segment">
            <span className="toolbar-label">Gap</span>
            <input
              className="input-text"
              type="number"
              min={15}
              max={300}
              step={5}
              value={gapSeconds}
              onChange={(e) => setGapSeconds(Math.max(15, Number(e.target.value || 60)))}
              style={{ width: 85 }}
            />
          </div>
          {buildMode === "multicam_overlap" && (
            <div className="toolbar-segment">
              <span className="toolbar-label">Overlap</span>
              <input
                className="input-text"
                type="number"
                min={5}
                max={300}
                step={5}
                value={overlapWindowSeconds}
                onChange={(e) => setOverlapWindowSeconds(Math.max(5, Number(e.target.value || 30)))}
                style={{ width: 85 }}
              />
            </div>
          )}
        </div>
        <div className="toolbar-right-group">
          <button className="btn btn-secondary" onClick={refreshBlocks} disabled={loading}>
            <RefreshCw size={14} /> Reload
          </button>
          {buildMode === "scene_change" && (
            <button className="btn btn-secondary" onClick={() => invoke("clear_scene_detection_cache", { projectId })} disabled={loading}>
              <Timer size={14} /> Clear Scene Cache
            </button>
          )}
          <button className="btn btn-primary" onClick={buildBlocks} disabled={loading}>
            <Scissors size={14} /> Build Blocks
          </button>
        </div>
      </div>

      <div className="toolbar premium-toolbar" style={{ marginBottom: 12 }}>
        <div className="toolbar-left-group" style={{ flexWrap: "wrap" }}>
          <div className="camera-chip-filter">
            <button
              className={`btn btn-ghost btn-xs ${selectedCameras.length === 0 ? "active" : ""}`}
              onClick={() => setSelectedCameras([])}
            >
              All Cameras
            </button>
            {cameraOptions.map((camera) => (
              <button
                key={camera}
                className={`btn btn-ghost btn-xs ${selectedCameras.includes(camera) ? "active" : ""}`}
                onClick={() => toggleCamera(camera)}
              >
                {camera}
              </button>
            ))}
          </div>
          <select className="input-select" value={audioFilter} onChange={(e) => setAudioFilter(e.target.value)}>
            <option value="all">All Audio</option>
            <option value="audio_ok">Audio OK</option>
            <option value="no_audio">No Audio</option>
            <option value="possible_clip">Possible Clip</option>
            <option value="very_low">Very Low</option>
          </select>
          <select className="input-select" value={fpsFilter} onChange={(e) => setFpsFilter(e.target.value)}>
            <option value="all">All FPS</option>
            {fpsOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-select" value={resolutionFilter} onChange={(e) => setResolutionFilter(e.target.value)}>
            <option value="all">All Res</option>
            {resolutionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-select" value={codecFilter} onChange={(e) => setCodecFilter(e.target.value)}>
            <option value="all">All Codec</option>
            {codecOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-select" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
            <option value="all">All Days</option>
            {dayOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-select" value={selectFilter} onChange={(e) => setSelectFilter(e.target.value)}>
            <option value="all">All Selects</option>
            <option value="pick">Picks</option>
            <option value="reject">Rejects</option>
            <option value="rated">Rated</option>
          </select>
        </div>
      </div>

      <div className="scene-blocks-next-step premium-card">
        <div>
          <span className="toolbar-label">Next Step</span>
          <h3>Move this organization into delivery</h3>
          <p>{selectedIds.length > 0 ? `${selectedIds.length} block${selectedIds.length === 1 ? "" : "s"} selected for downstream scope.` : "Review the grouped blocks, select the ones you want, then send that scope to Delivery."}</p>
        </div>
        <div className="scene-blocks-next-step-actions">
          <button className="btn btn-secondary btn-sm" onClick={onOpenReview}>
            Back to Review
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onOpenDelivery}>
            Send to Delivery
          </button>
        </div>
      </div>

      {filteredBlocks.length === 0 ? (
        <div className="empty-state">No blocks match current filters.</div>
      ) : viewMode === "timeline" ? (
        <TimelineView blocks={filteredBlocks} onSelectBlock={toggleBlock} selected={selected} />
      ) : (
        <div className="clip-list">
          {groupedBlocks.map((group) => (
            <div key={group.label}>
              {groupMode !== "block" && <div className="toolbar-label" style={{ margin: "8px 0 10px" }}>{group.label}</div>}
              {group.items.map((item, idx) => {
                const stats = blockStats(item);
                return (
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
                      <span className="metadata-tag">Duration {stats.duration}</span>
                      <span className="metadata-tag">Cameras {stats.cameraCount}</span>
                      <span className="metadata-tag">Audio {stats.audioPresentPct}%</span>
                      <span className="metadata-tag">Confidence {(item.block.confidence * 100).toFixed(0)}%</span>
                      {stats.mixedFps && <span className="metadata-tag danger-tag">Mixed FPS</span>}
                      {stats.missingTimecode && <span className="metadata-tag danger-tag">No TC</span>}
                      {stats.audioPresentPct < 100 && <span className="metadata-tag warn-tag">Partial Audio ({stats.audioPresentPct}%)</span>}
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      {item.clips.map((clip, clipIdx) => (
                        <div key={clip.id} className="block-clip-row">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{clip.filename}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {clipIdx > 0 && groupMode === "block" && (
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
                            aspectRatio={clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9}
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
