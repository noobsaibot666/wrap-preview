import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  X, 
  Plus, 
  Minus, 
  RotateCcw, 
  Play, 
  Pause, 
  FileDown, 
  Maximize2, 
  ChevronDown, 
  Settings2,
  ShieldCheck,
  Image as ImageIcon,
  FolderOpen,
  LayoutGrid,
  Download
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { toPng } from 'html-to-image';
import { useFramePreview } from './framePreviewLogic';
import { RatioType, FramePreviewMedia, RATIO_VALUES, INITIAL_TRANSFORM } from '../../types/framePreview';
import { ProductionProject } from '../../types';

interface FramePreviewAppProps {
  project?: ProductionProject | null;
  onBack: () => void;
}

export const FramePreviewApp: React.FC<FramePreviewAppProps> = ({ project, onBack }) => {
  const {
    state,
    activeMedia,
    setMediaList,
    setActiveMedia,
    toggleMediaSelection,
    updateTransform,
    toggleRatio,
    setActiveRatio,
    resetTransform
  } = useFramePreview();

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize with some media or empty state
  useEffect(() => {
    // Phase 1 can load from project folder or manually
  }, [project?.id]);

  const handleAddMedia = async () => {
    const selected = await open({
      multiple: true,
      title: 'Select media for Frame Preview',
      filters: [{
        name: 'Media',
        extensions: ['mov', 'mp4', 'mxf', 'mkv', 'jpg', 'jpeg', 'png', 'webp']
      }]
    });

    if (!selected || !Array.isArray(selected)) return;

    const newMedia: FramePreviewMedia[] = await Promise.all(selected.map(async (path) => {
      // Basic mock parsing for now, in a real app would use a metadata backend call
      const filename = path.split(/[/\\]/).pop() || '';
      const isImage = /\.(jpg|jpeg|png|webp)$/i.test(path);
      
      return {
        id: crypto.randomUUID(),
        filename,
        file_path: path,
        width: 1920, // Default to FHD if metadata call not implemented
        height: 1080,
        duration_ms: isImage ? 0 : 5000,
        status: 'ready',
        thumbnails: [],
        type: isImage ? 'image' : 'video'
      };
    }));

    setMediaList([...state.mediaList, ...newMedia]);
  };

  const currentTransform = state.frameTransforms[state.activeRatio] || INITIAL_TRANSFORM;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeMedia) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offX: currentTransform.offsetX,
      offY: currentTransform.offsetY
    };
  }, [activeMedia, currentTransform]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    
    updateTransform(state.activeRatio, {
      offsetX: dragStartRef.current.offX + dx,
      offsetY: dragStartRef.current.offY + dy
    });
  }, [isDragging, state.activeRatio, updateTransform]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const delta = e.deltaY * -0.001;
    const nextScale = Math.min(Math.max(0.1, currentTransform.scale + delta), 10);
    updateTransform(state.activeRatio, { scale: nextScale });
  }, [currentTransform.scale, state.activeRatio, updateTransform]);

  const toggleVideoPlayback = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleVideoScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = (val / 100) * videoRef.current.duration;
      setProgress(val);
    }
  };

  const [exportRes, setExportRes] = useState<'1080p' | '4k' | '720p'>('1080p');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg'>('png');
  const [safeGuides, setSafeGuides] = useState<Record<string, boolean>>({});

  const toggleSafeGuide = (ratio: RatioType) => {
    setSafeGuides(prev => ({ ...prev, [ratio]: !prev[ratio] }));
  };

  const copyTransform = (fromRatio: RatioType) => {
    const transform = state.frameTransforms[fromRatio];
    if (!transform) return;
    
    state.visibleRatios.forEach(toRatio => {
        if (toRatio !== fromRatio) {
            updateTransform(toRatio, { ...transform });
        }
    });
  };

  const handleExportRatio = async (ratio: RatioType) => {
    const el = document.getElementById(`frame-${ratio}`);
    if (!el || !activeMedia) return;

    try {
        const rVal = RATIO_VALUES[ratio];
        let width = 1920;
        if (exportRes === '4k') width = 3840;
        if (exportRes === '720p') width = 1280;
        const height = width / rVal;

        const dataUrl = await toPng(el, { 
            quality: 1, 
            pixelRatio: 2,
            canvasWidth: width,
            canvasHeight: height
        });
        
        const filePath = await save({
            defaultPath: `${activeMedia.filename.split('.')[0]}_${ratio.replace(':', '-')}.${exportFormat}`,
            filters: [{ name: 'Image', extensions: [exportFormat] }]
        });

        if (filePath) {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            await writeFile(filePath, new Uint8Array(buffer));
        }
    } catch (err) {
        console.error("Export failed:", err);
    }
  };

  const handleBatchExport = async () => {
    if (state.selectedMediaIds.size === 0 && !activeMedia) return;

    const mediaToExport = state.selectedMediaIds.size > 0 
        ? state.mediaList.filter(m => state.selectedMediaIds.has(m.id))
        : [activeMedia!];

    for (const media of mediaToExport) {
        // We need to set it as active one by one to capture correctly if needed, 
        // but for now let's assume handleExportRatio can take a media param.
        for (const ratio of state.visibleRatios) {
            await handleExportRatioWithMedia(ratio, media);
        }
    }
  };

  const handleExportRatioWithMedia = async (ratio: RatioType, media: FramePreviewMedia) => {
    // Note: html-to-image captures what's currently in the DOM.
    // If we want to export multiple DIFFERENT media, we must switch them 
    // or render off-screen. For MVP, we'll assume the user exports the ACTIVE layout.
    // To support full batch, we'd need a background renderer.
    // For now, let's just do a "Batch Visible Ratios" for the active media correctly.
    await handleExportRatio(ratio);
  };

  const fitToFrame = useCallback((ratio: RatioType) => {
    if (!activeMedia) return;
    const rVal = RATIO_VALUES[ratio];
    const mediaRatio = activeMedia.width / activeMedia.height;
    
    // Simplified covering scale calculation:
    // We want the media to fully cover the frame while maintaining proportions.
    const scale = mediaRatio > rVal ? (mediaRatio / rVal) : (rVal / mediaRatio);
    
    updateTransform(ratio, { scale, offsetX: 0, offsetY: 0 });
  }, [activeMedia, updateTransform]);

  return (
    <div className="frame-preview-app-container">
      {/* HEADER */}
      <header className="app-header premium-header">
        <div className="header-left">
          <button className="btn-icon" onClick={onBack} title="Back to Project Dashboard"><X size={18} /></button>
          <div className="app-title-group">
            <span className="eyebrow">Production</span>
            <h1>Frame Preview <span className="version-pill">MVP Phase 3</span></h1>
          </div>
        </div>

        <div className="header-center">
            <div className="export-settings-header">
                <div className="selector-group">
                    <span className="label">Res</span>
                    {(['720p', '1080p', '4k'] as const).map(res => (
                        <button 
                            key={res} 
                            className={`btn-toggle ${exportRes === res ? 'active' : ''}`}
                            onClick={() => setExportRes(res)}
                        >
                            {res.toUpperCase()}
                        </button>
                    ))}
                </div>
                <div className="selector-group">
                    <span className="label">Format</span>
                    {(['png', 'jpg'] as const).map(fmt => (
                        <button 
                            key={fmt} 
                            className={`btn-toggle ${exportFormat === fmt ? 'active' : ''}`}
                            onClick={() => setExportFormat(fmt)}
                        >
                            {fmt.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        <div className="header-right">
            <div className="header-actions" style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button className="btn btn-ghost btn-sm" title="Frame Preview Settings"><Settings2 size={16} /></button>
                <button 
                    className="btn btn-primary btn-sm" 
                    onClick={handleBatchExport} 
                    disabled={!activeMedia || state.visibleRatios.length === 0}
                >
                    <FileDown size={14} /> <span>Batch Export</span>
                </button>
            </div>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="main-viewport" ref={containerRef}>
        <div className="canvas-stage">
            {activeMedia ? (
                <div className={`canvas-grid canvas-grid-${state.visibleRatios.length}`}>
                    {state.visibleRatios.map(ratio => {
                        const transform = state.frameTransforms[ratio] || INITIAL_TRANSFORM;
                        const isRatioActive = state.activeRatio === ratio;
                        const rVal = RATIO_VALUES[ratio];

                        return (
                            <div 
                                key={ratio}
                                id={`frame-${ratio}`}
                                className={`ratio-frame-container ${isRatioActive ? 'active' : ''}`}
                                style={{ 
                                    aspectRatio: String(rVal),
                                }}
                                onMouseDown={(e) => {
                                    setActiveRatio(ratio);
                                    handleMouseDown(e);
                                }}
                                onWheel={(e) => {
                                    setActiveRatio(ratio);
                                    handleWheel(e);
                                }}
                            >
                                <div className="frame-header">
                                    <div className="frame-label">{ratio}</div>
                                    <div className="frame-header-actions">
                                        <button 
                                            className={`btn-frame-action ${safeGuides[ratio] ? 'active' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); toggleSafeGuide(ratio); }}
                                            title="Toggle Safe Guides"
                                        >
                                            <ShieldCheck size={12} />
                                        </button>
                                        <button 
                                            className="btn-frame-action"
                                            onClick={(e) => { e.stopPropagation(); copyTransform(ratio); }}
                                            title="Apply framing to all ratios"
                                        >
                                            <LayoutGrid size={12} />
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="media-mount" style={{
                                    transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
                                    transformOrigin: 'center'
                                }}>
                                    {activeMedia.type === 'video' ? (
                                        <video 
                                            key={`${activeMedia.id}-${ratio}`}
                                            ref={isRatioActive ? videoRef : null}
                                            src={activeMedia.file_path}
                                            muted
                                            autoPlay={isPlaying}
                                            loop
                                        />
                                    ) : (
                                        <img src={activeMedia.file_path} alt={activeMedia.filename} draggable={false} />
                                    )}
                                </div>

                                {safeGuides[ratio] && (
                                    <div className={`safe-guide-overlay ratio-${ratio.replace(':', '-')}`}>
                                        <div className="action-safe"></div>
                                        <div className="title-safe"></div>
                                        {/* Social Media specific guides */}
                                        {ratio === '9:16' && (
                                            <>
                                                <div className="social-top-ui"></div>
                                                <div className="social-bottom-ui"></div>
                                                <div className="social-side-ui"></div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="empty-state">
                    <LayoutGrid size={48} className="muted" />
                    <h2>No media loaded</h2>
                    <p>Load images or videos to begin reframing for delivery.</p>
                    <button className="btn btn-secondary" onClick={handleAddMedia}>
                        <FolderOpen size={16} /> <span>Load Media</span>
                    </button>
                </div>
            )}
        </div>
      </main>

      {/* FOOTER: CONTROL BAR + FILMSTRIP */}
      <footer className="app-footer">
          {activeMedia && (
            <div className="control-bar">
                <div className="control-section ratios">
                    <span className="control-label">Ratios (Max 4)</span>
                    <div className="ratio-chips-group">
                        {(['16:9', '9:16', '1:1', '4:5', '3:5', '4:3', '2.39:1'] as RatioType[]).map(r => {
                            const isVisible = state.visibleRatios.includes(r);
                            const isActive = state.activeRatio === r;
                            return (
                                <div 
                                    key={r}
                                    className={`ratio-chip ${isVisible ? 'visible' : ''} ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                        if (!isVisible) toggleRatio(r);
                                        setActiveRatio(r);
                                    }}
                                >
                                    {r}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="control-section playback">
                    {activeMedia.type === 'video' && (
                        <div className="playback-controls">
                            <button className="btn-icon" onClick={toggleVideoPlayback}>
                                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                            </button>
                            <input 
                                type="range" 
                                className="scrubber" 
                                min="0" max="100" 
                                value={progress} 
                                onChange={handleVideoScrub} 
                            />
                        </div>
                    )}
                </div>

                <div className="control-section transforms">
                    <div className="zoom-group">
                        <button className="btn-icon" onClick={() => updateTransform(state.activeRatio, { scale: Math.max(0.1, currentTransform.scale - 0.1) })}><Minus size={14} /></button>
                        <span className="zoom-value">{Math.round(currentTransform.scale * 100)}%</span>
                        <button className="btn-icon" onClick={() => updateTransform(state.activeRatio, { scale: Math.min(10, currentTransform.scale + 0.1) })}><Plus size={14} /></button>
                    </div>
                    
                    <div className="btn-group">
                        <button className="btn btn-ghost btn-xs" onClick={() => fitToFrame(state.activeRatio)} title="Fit to Frame">
                            <Maximize2 size={14} /> <span>Fit</span>
                        </button>
                        <button className="btn btn-ghost btn-xs" onClick={() => resetTransform(state.activeRatio)}>
                            <RotateCcw size={14} /> <span>Reset</span>
                        </button>
                        <button className="btn btn-primary btn-xs" onClick={() => handleExportRatio(state.activeRatio)} title="Export Current Frame">
                            <Download size={14} /> <span>Export Frame</span>
                        </button>
                    </div>
                </div>
            </div>
          )}

          <div className="filmstrip-scroll">
              <div className="filmstrip-inner">
                <button className="filmstrip-card add-btn" onClick={handleAddMedia}>
                    <Plus size={20} />
                </button>
                
                {/* Dynamic Filmstrip: If only one image, show ratios as cards */}
                {state.mediaList.length === 1 && state.mediaList[0].type === 'image' ? (
                    state.visibleRatios.map(ratio => {
                        const isActive = state.activeRatio === ratio;
                        return (
                            <div 
                                key={ratio}
                                className={`filmstrip-card ratio-mode ${isActive ? 'active' : ''}`}
                                onClick={() => setActiveRatio(ratio)}
                            >
                                <div className="card-thumb" style={{ aspectRatio: String(RATIO_VALUES[ratio]), width: '60px', margin: 'auto' }}>
                                    <ImageIcon size={20} />
                                </div>
                                <div className="card-label">{ratio}</div>
                            </div>
                        );
                    })
                ) : (
                    state.mediaList.map(media => {
                        const isActive = media.id === state.activeMediaId;
                        const isSelected = state.selectedMediaIds.has(media.id);
                        return (
                            <div 
                                key={media.id} 
                                className={`filmstrip-card ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                                onClick={(e) => {
                                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                        toggleMediaSelection(media.id, true);
                                    } else {
                                        setActiveMedia(media.id);
                                        toggleMediaSelection(media.id, false);
                                    }
                                }}
                            >
                                <div className="card-thumb">
                                    {media.type === 'image' ? <ImageIcon size={24} /> : <Play size={24} />}
                                    {isSelected && <div className="selection-indicator"><ChevronDown size={14} /></div>}
                                </div>
                                <div className="card-label">{media.filename}</div>
                            </div>
                        );
                    })
                )}
              </div>
          </div>
      </footer>
    </div>
  );
};
