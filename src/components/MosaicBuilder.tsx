import { memo, useState } from "react";
import { ClipWithThumbnails } from "../types";
import { FilmStrip } from "./FilmStrip";
import { FolderOpen, FileDown, Image as ImageIcon, Shuffle, LayoutGrid, CheckCircle2, XCircle } from "lucide-react";
import { getDisplayedThumbsForClip } from "../utils/shotPlannerThumbnails";

interface MosaicBuilderProps {
  clips: ClipWithThumbnails[];
  thumbnailCache: Record<string, string>;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleSelectAll: () => void;
  thumbCount: number;
  onSetThumbCount: (count: number) => void;
  jumpSeconds: number;
  cacheKeyContext?: string;
  onExportPdf: (options: { shuffle: boolean, useOriginalRatio: boolean }) => void;
  onExportImage: (options: { shuffle: boolean, useOriginalRatio: boolean }) => void;
  onLoadFootage: () => void;
  scanning: boolean;
}

export const MosaicBuilder = memo(function MosaicBuilder({
  clips,
  thumbnailCache,
  selectedIds,
  onToggleSelection,
  onToggleSelectAll,
  thumbCount,
  onSetThumbCount,
  jumpSeconds,
  cacheKeyContext,
  onExportPdf,
  onExportImage,
  onLoadFootage,
  scanning,
}: MosaicBuilderProps) {
  const [shuffle, setShuffle] = useState(false);
  const [useOriginalRatio, setUseOriginalRatio] = useState(false);

  // Get total selectable
  const selectableClipIds = clips.filter(c => c.clip.flag !== "reject").map((c) => c.clip.id);
  const selectedSelectableCount = Array.from(selectedIds).filter(id => selectableClipIds.includes(id)).length;

  if (!clips || clips.length === 0) {
    if (scanning) {
      return (
        <div className="media-workspace">
          <div className="toolbar premium-toolbar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
            <div className="toolbar-left-group">
              <button className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.8 }}>
                <div className="spinner" />
                <span>Scanning…</span>
              </button>
            </div>
          </div>
          <div className="inline-loading-state" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="skeleton-pulse" style={{ height: '32px', width: '200px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="skeleton-pulse" style={{ height: '160px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }} />
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="media-workspace">
        <div className="workspace-empty-state premium-card" style={{ background: "var(--inspector-bg)", border: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
          <div className="module-icon"><LayoutGrid size={28} strokeWidth={1.5} /></div>
          <h2>Grid Mosaic</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "400px", margin: "0 auto var(--space-md)" }}>
            Load reference clips to generate a large multi-frame grid mosaic. Export to PDF or high resolution Image.
          </p>
          <button className="btn btn-secondary" onClick={onLoadFootage}>
            <FolderOpen size={14} />
            <span>Load Footage</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="media-workspace">
      <div className="stats-bar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)" }}>
        <div className={`stat-card ${selectedIds.size > 0 ? 'stat-card-highlight' : ''}`} style={{ background: "transparent", border: "none", boxShadow: "none" }}>
          <div className="stat-header">
            <span className="stat-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Selected for Mosaic</span>
          </div>
          <span className="stat-value" style={{ fontSize: "var(--inspector-value-size)", fontWeight: "var(--inspector-value-weight)", letterSpacing: "var(--inspector-value-spacing)" }}>
            {selectedIds.size}<span className="stat-value-total" style={{ opacity: 0.4 }}> / {clips.length}</span>
          </span>
          <span className="stat-sub" style={{ fontSize: "10px", opacity: 0.5 }}>Estimated {selectedIds.size * thumbCount} total frames</span>
        </div>
        <div className="stat-card" style={{ background: "transparent", border: "none", boxShadow: "none" }}>
          <div className="stat-header">
            <span className="stat-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Layout Mode</span>
          </div>
          <span className="stat-value" style={{ fontSize: "var(--inspector-value-size)", fontWeight: "var(--inspector-value-weight)", letterSpacing: "var(--inspector-value-spacing)" }}>{shuffle ? "Shuffled" : "Sequential"}</span>
          <span className="stat-sub" style={{ fontSize: "10px", opacity: 0.5 }}>Grid array distribution</span>
        </div>
      </div>

      <div className="toolbar premium-toolbar" style={{ background: "var(--inspector-bg)", borderBottom: "var(--inspector-border)", backdropFilter: "var(--inspector-glass-blur)", marginTop: -1 }}>
        <div className="toolbar-left-group">
          <div className="thumb-range-selector">
            <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Thumbs</span>
            {[7, 10, 12, 15, 20].map((n) => (
              <button
                key={n}
                className={`btn btn-ghost btn-xs ${thumbCount === n ? 'active' : ''}`}
                onClick={() => onSetThumbCount(n)}
              >
                <span className="thumb-choice-value">{n}</span>
              </button>
            ))}
          </div>
          <div className="toolbar-separator" />
          <button
            className={`btn btn-ghost btn-sm ${shuffle ? 'active' : ''}`}
            onClick={() => setShuffle(!shuffle)}
            title="Randomize the final exported grid positions"
          >
            <Shuffle size={14} />
            <span>Shuffle Grid</span>
          </button>
          <div className="toolbar-separator" />
          <div className="aspect-ratio-selector" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span className="toolbar-label" style={{ fontSize: "var(--inspector-label-size)", fontWeight: "var(--inspector-label-weight)", letterSpacing: "var(--inspector-label-spacing)", color: "var(--inspector-label-color)", textTransform: "uppercase" }}>Ratio</span>
            <button
              className={`btn btn-ghost btn-xs ${!useOriginalRatio ? 'active' : ''}`}
              onClick={() => setUseOriginalRatio(false)}
            >
              <span>Square</span>
            </button>
            <button
              className={`btn btn-ghost btn-xs ${useOriginalRatio ? 'active' : ''}`}
              onClick={() => setUseOriginalRatio(true)}
            >
              <span>Original</span>
            </button>
          </div>
          <div className="toolbar-separator" />
        </div>
        <div className="toolbar-right-group">
          <button className="btn btn-ghost btn-sm" onClick={onToggleSelectAll}>
            {selectedSelectableCount === selectableClipIds.length ? "Deselect all" : "Select all"}
          </button>
          
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onExportPdf({ shuffle, useOriginalRatio })}>
            <FileDown size={14} />
            <span>Export PDF</span>
          </button>
          <button type="button" className="btn btn-primary btn-sm btn-glow" onClick={() => onExportImage({ shuffle, useOriginalRatio })}>
            <ImageIcon size={14} />
            <span>Export Image</span>
          </button>
          
          <button className="btn btn-secondary btn-sm" onClick={onLoadFootage} disabled={scanning}>
            <FolderOpen size={14} />
            <span>{scanning ? "Scanning..." : "Load..."}</span>
          </button>
        </div>
      </div>

      <div className="scrollable-view clip-list mosaic-builder-grid">
        <div className="clip-list-content">
          {clips.map((item) => {
            const isSelected = selectedIds.has(item.clip.id);
            const previewThumbnails = getDisplayedThumbsForClip({
              clipId: item.clip.id,
              thumbnails: item.thumbnails,
              thumbnailCache,
              thumbCount,
              jumpSeconds,
              cacheKeyContext,
            });

            const isRejected = item.clip.flag === "reject";

            return (
              <div 
                key={item.clip.id} 
                className={`clip-card premium-card ${isSelected ? 'selected' : ''} ${isRejected ? 'flag-reject' : ''}`}
                onClick={() => {
                  if (!isRejected) onToggleSelection(item.clip.id);
                }}
                style={{ cursor: isRejected ? "not-allowed" : "pointer", opacity: isRejected ? 0.6 : 1, "--corner-color": isSelected ? "var(--phase-preproduction-soft)" : "rgba(255,255,255,0.03)", paddingBottom: "12px" } as any}
              >
                <div className="clip-card-header">
                  <div className="clip-card-title-group">
                    <span className="clip-filename">
                      {item.clip.filename}
                    </span>
                  </div>
                  <div className="clip-card-header-right">
                    {isRejected && (
                       <div className="clip-flags">
                          <button className="btn-flag btn-reject active" disabled title="Rejected Clip">
                              <XCircle size={14} />
                              <span>Reject</span>
                          </button>
                       </div>
                    )}
                    <button
                      className={`btn-flag btn-select ${isSelected ? 'active' : ''}`}
                      title="Select for export"
                      disabled={isRejected}
                    >
                      <CheckCircle2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="clip-card-media" style={{ padding: "0 12px" }}>
                  <FilmStrip
                    clipId={item.clip.id}
                    thumbnails={previewThumbnails}
                    status={item.clip.status}
                    placeholderCount={thumbCount}
                    count={thumbCount}
                    aspectRatio={item.clip.width > 0 && item.clip.height > 0 ? item.clip.width / item.clip.height : 16 / 9}
                    thumbnailCache={thumbnailCache}
                    cacheKeyContext={cacheKeyContext}
                    isImage={item.clip.duration_ms === 0}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
