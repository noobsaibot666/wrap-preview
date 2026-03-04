import React, { startTransition, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FolderOpen, Gauge, ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CameraMatchAnalysis,
  CameraMatchAnalysisResult,
  CameraMatchDelta,
  CameraMatchMetrics,
  CameraMatchSuggestionSet,
  ProductionMatchLabRun,
  ProductionMatchLabRunSummary,
  ProductionProject,
} from "../../types";
import { exportProductionMatchSheetImage, exportProductionMatchSheetPdf } from "../../utils/ProductionExport";
import { invokeGuarded } from "../../utils/tauri";

interface CameraMatchLabAppProps {
  project: ProductionProject;
  onBack?: () => void;
}

const SLOT_ORDER = ["A", "B", "C"] as const;
const FRAME_COUNT = 5;
type CameraSlot = (typeof SLOT_ORDER)[number];

export function CameraMatchLabApp({ project }: CameraMatchLabAppProps) {
  const [clipsBySlot, setClipsBySlot] = useState<Record<string, string>>({});
  const [analysisOverrideBySlot, setAnalysisOverrideBySlot] = useState<Record<string, string>>({});
  const [analysisBySlot, setAnalysisBySlot] = useState<Record<string, CameraMatchAnalysisResult>>({});
  const [frameDataUrls, setFrameDataUrls] = useState<Record<string, string>>({});
  const [frameWarnings, setFrameWarnings] = useState<Record<string, string>>({});
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const [slotErrorDetails, setSlotErrorDetails] = useState<Record<string, string>>({});
  const [slotStatuses, setSlotStatuses] = useState<Record<string, string>>({});
  const [heroSlot, setHeroSlot] = useState<CameraSlot>("A");
  const [analyzing, setAnalyzing] = useState(false);
  const [activeSlots, setActiveSlots] = useState<string[]>([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [framesOpenBySlot, setFramesOpenBySlot] = useState<Record<string, boolean>>({});
  const [runSummaries, setRunSummaries] = useState<ProductionMatchLabRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [hoveredRunId, setHoveredRunId] = useState<string | null>(null);
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [runsMenuOpen, setRunsMenuOpen] = useState(false);
  const [savedRunMessage, setSavedRunMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadFrames = async () => {
      const analyses = Object.entries(analysisBySlot);
      if (analyses.length === 0) {
        setFrameDataUrls({});
        return;
      }

      const nextUrls: Record<string, string> = {};
      const nextWarnings: Record<string, string> = {};

      for (const [slot, analysis] of analyses) {
        const uniqueFramePaths = new Set([
          analysis.representative_frame_path,
          ...analysis.frame_paths,
        ]);
        for (const framePath of uniqueFramePaths) {
          try {
            const dataUrl = await invokeGuarded<string>("read_thumbnail", { path: framePath });
            nextUrls[framePath] = dataUrl;
          } catch {
            if (!nextWarnings[slot]) {
              nextWarnings[slot] = "Some cached frames are missing. Re-run analysis.";
            }
          }
        }
      }

      if (!cancelled) {
        startTransition(() => {
          setFrameDataUrls(nextUrls);
          setFrameWarnings((prev) => ({ ...prev, ...nextWarnings }));
        });
      }
    };

    void loadFrames();

    return () => {
      cancelled = true;
    };
  }, [analysisBySlot]);

  const selectedSlots = useMemo(
    () => SLOT_ORDER.filter((slot) => Boolean(clipsBySlot[slot])),
    [clipsBySlot],
  );

  useEffect(() => {
    let cancelled = false;
    const loadRuns = async () => {
      try {
        const runs = await invokeGuarded<ProductionMatchLabRunSummary[]>("production_matchlab_list_runs", {
          projectId: project.id,
        });
        if (cancelled) return;
        setRunSummaries(runs);
        setSelectedRunId((current) => current ?? runs[0]?.run_id ?? null);
      } catch {
        if (!cancelled) {
          setRunSummaries([]);
        }
      }
    };
    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    const loadRun = async () => {
        try {
        const run = await invokeGuarded<ProductionMatchLabRun | null>("production_matchlab_get_run", {
          runId: selectedRunId,
        });
        if (!run || cancelled) return;
        const nextAnalyses: Record<string, CameraMatchAnalysisResult> = {};
        const nextClips: Record<string, string> = {};
        run.results.forEach((result) => {
          nextAnalyses[result.slot] = result.analysis;
          nextClips[result.slot] = result.analysis.clip_path;
        });
        startTransition(() => {
          setHeroSlot((run.hero_slot || "A") as CameraSlot);
          setAnalysisBySlot(nextAnalyses);
          setClipsBySlot((prev) => ({ ...prev, ...nextClips }));
          setAnalysisOverrideBySlot({});
          setFrameWarnings({});
          setSlotStatuses({});
          setSlotErrors({});
          setSlotErrorDetails({});
        });
      } catch {
        if (!cancelled) {
          setSavedRunMessage("Failed to load saved run.");
        }
      }
    };
    void loadRun();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!savedRunMessage) return undefined;
    const timeout = window.setTimeout(() => setSavedRunMessage(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [savedRunMessage]);

  useEffect(() => {
    if (selectedSlots.includes(heroSlot)) return;
    if (selectedSlots.includes("A")) {
      setHeroSlot("A");
      return;
    }
    setHeroSlot(selectedSlots[0] ?? "A");
  }, [heroSlot, selectedSlots]);

  const matchResult = useMemo(() => {
    const analyses = SLOT_ORDER
      .filter((slot) => analysisBySlot[slot])
      .map((slot) => buildAnalysisModel(slot, analysisBySlot[slot], heroSlot, analysisBySlot[heroSlot]));
    return {
      analyses,
      hero_slot: heroSlot,
      generated_at: new Date().toISOString(),
    };
  }, [analysisBySlot, heroSlot]);

  const pickClip = async (slot: string) => {
    const selected = await open({
      multiple: false,
      title: `Select camera ${slot} test clip`,
      filters: [{
        name: "Video",
        extensions: ["mov", "mp4", "mxf", "mkv", "avi", "braw", "r3d"],
      }],
    });
    if (typeof selected !== "string") return;
    setClipsBySlot((prev) => ({ ...prev, [slot]: selected }));
    setAnalysisOverrideBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSelectedRunId(null);
    setSlotErrors((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSlotErrorDetails((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setFrameWarnings((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSlotStatuses((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const clearSlot = (slot: string) => {
    setSelectedRunId(null);
    setClipsBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setAnalysisBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setAnalysisOverrideBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setFrameWarnings((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSlotErrors((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSlotErrorDetails((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSlotStatuses((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const analyzeClips = async () => {
    if (selectedSlots.length === 0) return;
    setAnalyzing(true);
    setActiveSlots(selectedSlots);
    setSlotErrors({});
    setSlotErrorDetails({});
    setSelectedRunId(null);
    const nextResults: Array<{ slot: string; proxy_path?: string | null; analysis: CameraMatchAnalysisResult }> = [];

    try {
      for (const slot of selectedSlots) {
        const clipPath = clipsBySlot[slot];
        if (!clipPath) continue;
        try {
          if (isBrawClip(clipPath)) {
            startTransition(() => {
              setSlotStatuses((prev) => ({ ...prev, [slot]: "Preparing proxy..." }));
            });
          }
          startTransition(() => {
            setSlotStatuses((prev) => ({ ...prev, [slot]: "Analyzing..." }));
          });
          const result = await invokeGuarded<CameraMatchAnalysisResult>("camera_match_analyze_clip", {
            projectId: project.id,
            cameraSlot: slot,
            clipPath,
            frameCount: FRAME_COUNT,
            analysisSourceOverridePath: analysisOverrideBySlot[slot] ?? null,
          });
          const proxyPath = result.source_path !== clipPath ? result.source_path : undefined;
          nextResults.push({ slot, proxy_path: proxyPath, analysis: { ...result, clip_path: clipPath } });
          startTransition(() => {
            setAnalysisBySlot((prev) => ({ ...prev, [slot]: { ...result, clip_path: clipPath } }));
            setSlotStatuses((prev) => ({ ...prev, [slot]: "Ready" }));
            setSlotErrors((prev) => {
              const next = { ...prev };
              delete next[slot];
              return next;
            });
            setSlotErrorDetails((prev) => {
              const next = { ...prev };
              delete next[slot];
              return next;
            });
          });
        } catch (slotError) {
          const message = slotError instanceof Error ? slotError.message : String(slotError);
          const parsedError = parseStructuredError(message);
          const errorSummary = parsedError.summary || message.split("\n")[0];
          const errorDetails = parsedError.details;
          startTransition(() => {
            setSlotErrors((prev) => ({ ...prev, [slot]: errorSummary }));
            setSlotErrorDetails((prev) => {
              if (!errorDetails) {
                const next = { ...prev };
                delete next[slot];
                return next;
              }
              return { ...prev, [slot]: errorDetails };
            });
            setSlotStatuses((prev) => {
              const next = { ...prev };
              delete next[slot];
              return next;
            });
            setAnalysisBySlot((prev) => {
              const next = { ...prev };
              delete next[slot];
              return next;
            });
          });
        }
      }
      if (nextResults.length > 0) {
        const runId = await invokeGuarded<string>("production_matchlab_save_run", {
          projectId: project.id,
          heroSlot,
          results: nextResults,
        });
        const runs = await invokeGuarded<ProductionMatchLabRunSummary[]>("production_matchlab_list_runs", {
          projectId: project.id,
        });
        startTransition(() => {
          setRunSummaries(runs);
          setSelectedRunId(runId);
          setSavedRunMessage("Saved run");
        });
      }
    } finally {
      setAnalyzing(false);
      setActiveSlots([]);
    }
  };

  const exportMatchSheet = async (kind: "pdf" | "image") => {
    setExportMenuOpen(false);
    const exportPayload = {
      fileName: `${project.name}_MatchLab_${heroSlot}.${kind === "pdf" ? "pdf" : "jpg"}`,
      title: "Match Sheet",
      projectName: project.name,
      clientName: project.client_name,
      heroSlot,
      generatedAt: matchResult.generated_at,
      cameras: matchResult.analyses.map((analysis) => ({
        slot: analysis.slot,
        title: analysis.clip_name,
        frameDataUrl: frameDataUrls[analysis.representative_frame_path] ?? "",
        metrics: analysis.metrics,
        delta: analysis.delta_vs_hero ?? null,
        suggestions: analysis.suggestions ?? null,
      })),
    };
    if (kind === "pdf") {
      await exportProductionMatchSheetPdf(exportPayload);
      return;
    }
    await exportProductionMatchSheetImage(exportPayload);
  };

  const pickExistingProxy = async (slot: string) => {
    const selected = await open({
      multiple: false,
      title: `Select existing MP4 proxy for camera ${slot}`,
      filters: [{ name: "MP4 Proxy", extensions: ["mp4"] }],
    });
    if (typeof selected !== "string") return;
    setAnalysisOverrideBySlot((prev) => ({ ...prev, [slot]: selected }));
    setSlotStatuses((prev) => ({ ...prev, [slot]: "MP4 proxy selected" }));
  };

  const confirmDeleteRun = async () => {
    if (!pendingDeleteRunId || deletingRun) return;
    setDeletingRun(true);
    try {
      const warning = await invokeGuarded<string | null>("production_matchlab_delete_run", {
        runId: pendingDeleteRunId,
      });
      const runs = await invokeGuarded<ProductionMatchLabRunSummary[]>("production_matchlab_list_runs", {
        projectId: project.id,
      });
      startTransition(() => {
        setRunSummaries(runs);
        if (selectedRunId === pendingDeleteRunId) {
          const nextSelected = runs[0]?.run_id ?? null;
          setSelectedRunId(nextSelected);
          if (!nextSelected) {
            setAnalysisBySlot({});
            setFrameDataUrls({});
            setFrameWarnings({});
            setSlotErrors({});
            setSlotErrorDetails({});
          }
        }
        setSavedRunMessage(warning || "Run deleted");
        setPendingDeleteRunId(null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSavedRunMessage(message);
    } finally {
      setDeletingRun(false);
    }
  };

  const pendingRun = runSummaries.find((run) => run.run_id === pendingDeleteRunId) ?? null;
  const selectedRunSummary = runSummaries.find((run) => run.run_id === selectedRunId) ?? null;

  return (
    <div className="scrollable-view" style={{ padding: 24 }}>
      <div className="production-matchlab-shell" style={matchLabLayoutStyle}>
        <main style={{ minWidth: 0, paddingBottom: 48 }}>
          <div style={headerRowStyle}>
            <div className="production-matchlab-header-utility" style={headerUtilityRowStyle}>
              <div style={headerMetaClusterStyle}>
                <div style={headerInfoBlockStyle}>
                  <div style={headerProjectNameStyle}>Project {project.name}</div>
                  <div style={subtleStyle}>Measured match sheet. {FRAME_COUNT} frames per clip.</div>
                </div>
                <div className="production-matchlab-header-capsule" style={headerCapsuleStyle}>
                  <div style={headerControlGroupStyle}>
                    <span style={headerControlLabelStyle}>Hero</span>
                    <div style={heroInlineStyle}>
                      {SLOT_ORDER.filter((slot) => clipsBySlot[slot]).map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          className={`btn btn-sm ${heroSlot === slot ? "production-matchlab-hero-active" : "btn-ghost"}`}
                          onClick={() => setHeroSlot(slot)}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={capsuleDividerStyle} />
                  <div style={{ position: "relative", minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm production-matchlab-run-chip"
                      style={runChipStyle}
                      onClick={() => setRunsMenuOpen((prev) => !prev)}
                    >
                      <span style={runChipLabelStyle}>Run:</span>
                      <span style={runChipValueStyle}>{selectedRunSummary ? formatRunTimestamp(selectedRunSummary.created_at) : "No saved runs"}</span>
                      <ChevronDown size={14} />
                    </button>
                    {runsMenuOpen && (
                      <div className="production-matchlab-runs-menu" style={runsPopoverStyle}>
                        {runSummaries.length === 0 ? (
                          <div style={runsEmptyStyle}>No saved runs</div>
                        ) : (
                          runSummaries.map((run) => (
                            <div
                              key={run.run_id}
                              style={{
                                ...runItemStyle,
                                ...(selectedRunId === run.run_id ? runItemActiveStyle : null),
                              }}
                              onMouseEnter={() => setHoveredRunId(run.run_id)}
                              onMouseLeave={() => setHoveredRunId((current) => (current === run.run_id ? null : current))}
                            >
                              <button
                                type="button"
                                style={runSelectButtonStyle}
                                onClick={() => {
                                  setSelectedRunId(run.run_id);
                                  setRunsMenuOpen(false);
                                }}
                              >
                                <div style={runItemTitleStyle}>{formatRunTimestamp(run.created_at)}</div>
                                <div style={runItemMetaStyle}>Hero {run.hero_slot}</div>
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete run ${formatRunTimestamp(run.created_at)}`}
                                style={{
                                  ...runDeleteButtonStyle,
                                  opacity: hoveredRunId === run.run_id ? 1 : 0.18,
                                }}
                                onClick={() => {
                                  setPendingDeleteRunId(run.run_id);
                                  setRunsMenuOpen(false);
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="production-matchlab-header-actions" style={headerActionsStyle}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm production-matchlab-analyze-button"
                  onClick={() => void analyzeClips()}
                  disabled={selectedSlots.length === 0 || analyzing || activeSlots.length > 0}
                >
                  <RefreshCw size={14} /> {analyzing ? "Analyzing..." : "Analyze"}
                </button>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setExportMenuOpen((prev) => !prev)}
                    disabled={matchResult.analyses.length === 0}
                  >
                    <Download size={14} /> Export <ChevronDown size={14} />
                  </button>
                  {exportMenuOpen && (
                    <div className="production-matchlab-export-menu" style={exportMenuStyle}>
                      <button type="button" className="production-matchlab-export-item" style={exportItemStyle} onClick={() => void exportMatchSheet("pdf")}>Export Match Sheet (PDF)</button>
                      <button type="button" className="production-matchlab-export-item" style={exportItemStyle} onClick={() => void exportMatchSheet("image")}>Export Match Sheet (Image)</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <section className="matchLabGrid" style={gridStyle}>
            {SLOT_ORDER.map((slot) => {
              const clipPath = clipsBySlot[slot];
              const analysis = matchResult.analyses.find((item) => item.slot === slot);
              const rawAnalysis = analysisBySlot[slot];
              const representativeFrameUrl = rawAnalysis ? frameDataUrls[rawAnalysis.representative_frame_path] : "";
              const frameWarning = frameWarnings[slot];
              const slotError = slotErrors[slot];
              const slotErrorDetail = slotErrorDetails[slot];
              const slotStatus = slotStatuses[slot];
              const active = activeSlots.includes(slot);

              return (
                <div key={slot} className="matchLabColumn" style={cameraColumnStyle}>
                  <div className="matchLabCard" style={cameraCardStyle}>
                    <div style={slotHeaderRowStyle}>
                      <span style={{ ...slotBadgeStyle, ...slotBadgeColor(slot) }}>Camera {slot}</span>
                      {heroSlot === slot && <span style={heroChipStyle}>Hero</span>}
                    </div>
                    <div className="matchLabCameraActions" style={cameraActionsStyle}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void pickClip(slot)}>
                        <FolderOpen size={14} /> {clipPath ? "Replace" : "Import Clip"}
                      </button>
                      {clipPath && <button type="button" className="btn btn-ghost btn-sm" onClick={() => clearSlot(slot)}>Clear</button>}
                    </div>
                    <div className="matchLabPathPrimary" style={fileMetaStyle} title={clipPath ? getFileName(clipPath) : "No clip selected"}>{clipPath ? getFileName(clipPath) : "No clip selected"}</div>
                    <div className="matchLabPathSecondary" style={helperMetaStyle} title={clipPath || "One short test clip per camera."}>{clipPath || "One short test clip per camera."}</div>
                    {slotStatus ? <div style={statusMetaStyle}>{slotStatus}</div> : null}
                  </div>

                  <div className="matchLabCard matchLabAnalysisCard" style={analysisCardStyle}>
                    {slotError && (
                      <div style={errorCardStyle}>
                        <div>{slotError}</div>
                        {isBrawClip(clipPath || "") ? (
                          <div style={errorActionsStyle}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pickExistingProxy(slot)} disabled={active}>
                              <FolderOpen size={14} /> Use existing MP4 proxy…
                            </button>
                          </div>
                        ) : null}
                        {slotErrorDetail ? (
                          <details style={errorDetailsStyle}>
                            <summary style={errorDetailsSummaryStyle}>Details</summary>
                            <pre style={errorDetailsBodyStyle}>{slotErrorDetail}</pre>
                          </details>
                        ) : null}
                      </div>
                    )}
                    {analysis && rawAnalysis && representativeFrameUrl ? (
                      <>
                        <div className="matchLabFrameWrap" style={frameWrapStyle}>
                          <img className="matchLabFrameImage" src={representativeFrameUrl} alt={`${slot} representative frame`} style={frameImageStyle} />
                          <div style={frameOverlayStyle}>
                            <HistogramOverlay histogram={analysis.metrics.luma_histogram} />
                          </div>
                        </div>
                        {frameWarning && <div style={inlineWarningStyle}>{frameWarning}</div>}
                        <div style={metricsWrapStyle}>
                          <MetricChip label="Luma" value={formatPercent(analysis.metrics.luma_median)} />
                          <MetricChip label="RGB" value={formatRgbTriplet(analysis.metrics.rgb_medians)} />
                          <MetricChip label="Hi %" value={formatPercent(analysis.metrics.highlight_percent)} />
                          <MetricChip label="Mid %" value={formatPercent(analysis.metrics.midtone_density)} />
                        </div>
                        <div style={deltaRowStyle}>
                          <DeltaChip label="Delta Luma" value={analysis.delta_vs_hero ? formatSignedPercent(analysis.delta_vs_hero.luma_median) : "Hero"} />
                          <DeltaChip label="Delta Hi" value={analysis.delta_vs_hero ? formatSignedPercent(analysis.delta_vs_hero.highlight_percent) : "Hero"} />
                          <DeltaChip label="Delta Mid" value={analysis.delta_vs_hero ? formatSignedPercent(analysis.delta_vs_hero.midtone_density) : "Hero"} />
                        </div>
                        <div style={metricsWrapStyle}>
                          <SuggestionChip label="Exposure" value={analysis.suggestions?.exposure ?? "Hero baseline"} />
                          <SuggestionChip label="WB" value={analysis.suggestions?.white_balance ?? "Hero baseline"} />
                          <SuggestionChip label="Highlights" value={analysis.suggestions?.highlight ?? "Hero baseline"} />
                        </div>
                        <details style={detailsWrapStyle}>
                          <summary style={detailsSummaryStyle}>
                            <ImageIcon size={14} /> Frames & Details
                          </summary>
                          <div style={framesGridStyle}>
                            {rawAnalysis.frame_paths.map((framePath) => (
                              <button
                                key={framePath}
                                type="button"
                                style={frameThumbButtonStyle}
                                onClick={() => setFramesOpenBySlot((prev) => ({ ...prev, [slot]: !prev[slot] }))}
                              >
                                {frameDataUrls[framePath] ? (
                                  <img src={frameDataUrls[framePath]} alt={`${slot} frame`} style={frameThumbStyle} />
                                ) : (
                                  <div style={frameThumbPlaceholderStyle}>Missing</div>
                                )}
                              </button>
                            ))}
                          </div>
                          {framesOpenBySlot[slot] && (
                            <div style={detailsDrawerStyle}>
                              <div style={rawMetricsGridStyle}>
                                {rawAnalysis.per_frame.map((frame) => (
                                  <div key={frame.frame_index} style={rawMetricsCardStyle}>
                                    <div style={rawMetricsTitleStyle}>Frame {frame.frame_index + 1}</div>
                                    <div style={rawMetricsLineStyle}>
                                      <span style={rawMetricsLabelStyle}>Time</span>
                                      <span style={rawMetricsValueStyle}>{Math.round(frame.timestamp_ms / 1000)}s</span>
                                    </div>
                                    <div style={rawMetricsLineStyle}>
                                      <span style={rawMetricsLabelStyle}>Luma</span>
                                      <span style={rawMetricsValueStyle}>{formatPercent(frame.luma_median)}</span>
                                    </div>
                                    <div style={rawMetricsLineStyle}>
                                      <span style={rawMetricsLabelStyle}>RGB</span>
                                      <span style={rawMetricsValueStyle}>{formatRgbTriplet(frame.rgb_medians)}</span>
                                    </div>
                                    <div style={rawMetricsLineStyle}>
                                      <span style={rawMetricsLabelStyle}>Hi</span>
                                      <span style={rawMetricsValueStyle}>{formatPercent(frame.highlight_percent)}</span>
                                    </div>
                                    <div style={rawMetricsLineStyle}>
                                      <span style={rawMetricsLabelStyle}>Mid</span>
                                      <span style={rawMetricsValueStyle}>{formatPercent(frame.midtone_density)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </details>
                      </>
                    ) : (
                      <div style={placeholderStyle}>
                        <Gauge size={18} />
                        <span>{active ? (slotStatus || "Analyzing clip...") : clipPath ? "Run analysis to measure this camera." : "Import a clip to compare this camera."}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        </main>
      </div>
      {pendingRun ? (
        <div style={modalBackdropStyle} onClick={() => (!deletingRun ? setPendingDeleteRunId(null) : undefined)}>
          <div style={modalCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={modalTitleStyle}>Delete run?</div>
            <div style={modalBodyStyle}>This removes the saved analysis and cached frames for this run.</div>
            <div style={modalMetaStyle}>{formatRunTimestamp(pendingRun.created_at)} · Hero {pendingRun.hero_slot}</div>
            <div style={modalActionsStyle}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingDeleteRunId(null)} disabled={deletingRun}>Cancel</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void confirmDeleteRun()} disabled={deletingRun}>
                <Trash2 size={14} /> {deletingRun ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildAnalysisModel(
  slot: string,
  result: CameraMatchAnalysisResult,
  heroSlot: string,
  heroResult?: CameraMatchAnalysisResult,
): CameraMatchAnalysis {
  const metrics: CameraMatchMetrics = {
    luma_histogram: result.aggregate.luma_histogram,
    rgb_medians: result.aggregate.rgb_medians,
    luma_median: result.aggregate.luma_median,
    highlight_percent: result.aggregate.highlight_percent,
    midtone_density: result.aggregate.midtone_density,
  };
  if (!heroResult || heroSlot === slot) {
    return {
      slot,
      clip_path: result.clip_path,
      clip_name: result.clip_name,
      representative_frame_path: result.representative_frame_path,
      frame_paths: result.frame_paths,
      per_frame: result.per_frame,
      metrics,
      delta_vs_hero: null,
      suggestions: {
        exposure: "Hero baseline",
        white_balance: "Hero baseline",
        highlight: "Hero baseline",
      },
    };
  }
  const delta = computeDelta(metrics, {
    luma_histogram: heroResult.aggregate.luma_histogram,
    rgb_medians: heroResult.aggregate.rgb_medians,
    luma_median: heroResult.aggregate.luma_median,
    highlight_percent: heroResult.aggregate.highlight_percent,
    midtone_density: heroResult.aggregate.midtone_density,
  });
  return {
    slot,
    clip_path: result.clip_path,
    clip_name: result.clip_name,
    representative_frame_path: result.representative_frame_path,
    frame_paths: result.frame_paths,
    per_frame: result.per_frame,
    metrics,
    delta_vs_hero: delta,
    suggestions: buildSuggestionSet(delta, metrics, {
      luma_histogram: heroResult.aggregate.luma_histogram,
      rgb_medians: heroResult.aggregate.rgb_medians,
      luma_median: heroResult.aggregate.luma_median,
      highlight_percent: heroResult.aggregate.highlight_percent,
      midtone_density: heroResult.aggregate.midtone_density,
    }),
  };
}

function computeDelta(current: CameraMatchMetrics, hero: CameraMatchMetrics): CameraMatchDelta {
  return {
    luma_median: current.luma_median - hero.luma_median,
    highlight_percent: current.highlight_percent - hero.highlight_percent,
    midtone_density: current.midtone_density - hero.midtone_density,
    red_median: current.rgb_medians.red - hero.rgb_medians.red,
    green_median: current.rgb_medians.green - hero.rgb_medians.green,
    blue_median: current.rgb_medians.blue - hero.rgb_medians.blue,
  };
}

function buildSuggestionSet(
  delta: CameraMatchDelta,
  current: CameraMatchMetrics,
  hero: CameraMatchMetrics,
): CameraMatchSuggestionSet {
  const safeCurrent = Math.max(current.luma_median, 0.01);
  const safeHero = Math.max(hero.luma_median, 0.01);
  const stopDelta = clamp(Math.log2(safeHero / safeCurrent), -2, 2);
  const boundedStops = Math.abs(stopDelta) < 0.08 ? 0 : roundTo(stopDelta, 0.1);

  const heroRb = hero.rgb_medians.red - hero.rgb_medians.blue;
  const currentRb = current.rgb_medians.red - current.rgb_medians.blue;
  const kelvinShift = clamp(Math.round(((heroRb - currentRb) * 8000) / 100) * 100, -1200, 1200);
  const heroTintBase = hero.rgb_medians.green - (hero.rgb_medians.red + hero.rgb_medians.blue) * 0.5;
  const currentTintBase = current.rgb_medians.green - (current.rgb_medians.red + current.rgb_medians.blue) * 0.5;
  const tintShift = clamp(Math.round((heroTintBase - currentTintBase) * 180), -10, 10);

  return {
    exposure: boundedStops === 0 ? "Hold" : `${boundedStops > 0 ? "+" : ""}${boundedStops.toFixed(1)} stop`,
    white_balance: `${formatKelvinShift(kelvinShift)} • ${formatTintShift(tintShift)}`,
    highlight: delta.highlight_percent > 0.015
      ? `Warn +${(delta.highlight_percent * 100).toFixed(1)}%`
      : delta.highlight_percent < -0.015
        ? `Safer ${(Math.abs(delta.highlight_percent) * 100).toFixed(1)}%`
        : "Aligned",
  };
}

function HistogramOverlay({ histogram }: { histogram: number[] }) {
  const max = Math.max(...histogram, 1);
  const points = histogram.map((value, index) => {
    const x = (index / Math.max(histogram.length - 1, 1)) * 100;
    const y = 100 - (value / max) * 100;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
      <rect x="0" y="0" width="100" height="100" fill="rgba(9,11,14,0.68)" />
      <polyline fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.6" points={points} />
      <line x1="40" y1="0" x2="40" y2="100" stroke="rgba(88,166,255,0.55)" strokeWidth="0.8" strokeDasharray="3 3" />
      <line x1="70" y1="0" x2="70" y2="100" stroke="rgba(255,194,95,0.55)" strokeWidth="0.8" strokeDasharray="3 3" />
      <line x1="95" y1="0" x2="95" y2="100" stroke="rgba(255,95,68,0.7)" strokeWidth="0.8" strokeDasharray="3 3" />
    </svg>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={chipStyle}>
      <div style={chipLabelStyle}>{label}</div>
      <div style={chipValueStyle}>{value}</div>
    </div>
  );
}

function DeltaChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={deltaChipStyle}>
      <div style={chipLabelStyle}>{label}</div>
      <div style={chipValueStyle}>{value}</div>
    </div>
  );
}

function SuggestionChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={suggestionChipStyle}>
      <div style={chipLabelStyle}>{label}</div>
      <div style={chipValueStyle}>{value}</div>
    </div>
  );
}

function getFileName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function isBrawClip(path: string) {
  return path.toLowerCase().endsWith(".braw");
}

function formatRunTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseStructuredError(message: string) {
  const summaryMatch = message.match(/^Summary:\s*(.+)$/m);
  const detailsMatch = message.match(/^Details:\n([\s\S]+)$/m);
  return {
    summary: summaryMatch?.[1]?.trim() ?? "",
    details: detailsMatch?.[1]?.trim() ?? "",
  };
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatRgbTriplet(rgb: { red: number; green: number; blue: number }) {
  return `${Math.round(rgb.red * 255)} / ${Math.round(rgb.green * 255)} / ${Math.round(rgb.blue * 255)}`;
}

function formatKelvinShift(value: number) {
  if (value === 0) return "WB hold";
  return `${value > 0 ? "+" : ""}${value}K`;
}

function formatTintShift(value: number) {
  if (value === 0) return "Tint hold";
  if (value > 0) return `Tint +${value}G`;
  return `Tint ${value}M`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step;
}

function slotBadgeColor(slot: string): React.CSSProperties {
  if (slot === "A") return { background: "rgba(59,130,246,0.14)", color: "#93c5fd" };
  if (slot === "B") return { background: "rgba(34,197,94,0.14)", color: "#86efac" };
  return { background: "rgba(245,158,11,0.14)", color: "#fcd34d" };
}

const headerRowStyle: React.CSSProperties = { display: "grid", gap: 14, marginBottom: 20 };
const headerUtilityRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "center", flexWrap: "wrap", minWidth: 0 };
const headerMetaClusterStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 24, minWidth: 0, flexWrap: "wrap", flex: "1 1 auto" };
const headerCapsuleStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", minHeight: 44, maxWidth: "100%", flexWrap: "nowrap", minWidth: 0 };
const capsuleDividerStyle: React.CSSProperties = { width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.08)" };
const headerActionsStyle: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "nowrap", justifyContent: "flex-end", minWidth: 0 };
const headerInfoBlockStyle: React.CSSProperties = { display: "grid", gap: 2, minWidth: 0 };
const headerProjectNameStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "0.96rem", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const headerControlGroupStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minHeight: 32 };
const headerControlLabelStyle: React.CSSProperties = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800, color: "var(--text-muted)" };
const heroInlineStyle: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "nowrap" };
const runChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 240, whiteSpace: "nowrap", minWidth: 0, borderRadius: 12 };
const runChipLabelStyle: React.CSSProperties = { color: "var(--text-muted)", fontSize: "0.78rem", fontWeight: 700 };
const runChipValueStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const matchLabLayoutStyle: React.CSSProperties = { display: "block" };
const runsPopoverStyle: React.CSSProperties = { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 280, maxHeight: 280, overflowY: "auto", padding: 8, borderRadius: 12, background: "#0c0d0f", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 40px rgba(0,0,0,0.4)", zIndex: 30, display: "grid", gap: 6 };
const runsEmptyStyle: React.CSSProperties = { padding: "10px 8px", color: "var(--text-muted)", borderRadius: 12, background: "rgba(255,255,255,0.02)", textAlign: "center", whiteSpace: "nowrap" };
const runItemStyle: React.CSSProperties = { padding: "8px 8px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", textAlign: "left", display: "flex", alignItems: "center", gap: 8, minHeight: 46 };
const runItemActiveStyle: React.CSSProperties = { border: "1px solid rgba(88,166,255,0.35)", background: "rgba(88,166,255,0.08)" };
const runSelectButtonStyle: React.CSSProperties = { border: "none", background: "transparent", color: "inherit", padding: 0, textAlign: "left", cursor: "pointer", width: "100%", minWidth: 0 };
const runDeleteButtonStyle: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.04)", color: "var(--text-muted)", width: 30, height: 30, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "opacity 120ms ease" };
const runItemTitleStyle: React.CSSProperties = { fontSize: "0.88rem", fontWeight: 700 };
const runItemMetaStyle: React.CSSProperties = { fontSize: "0.78rem", color: "var(--text-muted)" };
const modalBackdropStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(5,6,8,0.68)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 80 };
const modalCardStyle: React.CSSProperties = { width: "min(420px, 100%)", padding: 20, borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", background: "#0c0d10", boxShadow: "0 24px 60px rgba(0,0,0,0.45)" };
const modalTitleStyle: React.CSSProperties = { fontSize: "1rem", fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 };
const modalBodyStyle: React.CSSProperties = { color: "var(--text-secondary)", lineHeight: 1.5 };
const modalMetaStyle: React.CSSProperties = { marginTop: 10, color: "var(--text-muted)", fontSize: "0.82rem" };
const modalActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 };
const subtleStyle: React.CSSProperties = { margin: 0, color: "var(--text-muted)", maxWidth: 760, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" };
const errorCardStyle: React.CSSProperties = { marginBottom: 16, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(239,68,68,0.28)", background: "rgba(239,68,68,0.08)", color: "#fecaca" };
const errorActionsStyle: React.CSSProperties = { marginTop: 10 };
const errorDetailsStyle: React.CSSProperties = { marginTop: 10 };
const errorDetailsSummaryStyle: React.CSSProperties = { cursor: "pointer", color: "#fecaca", fontSize: "0.8rem", fontWeight: 700 };
const errorDetailsBodyStyle: React.CSSProperties = { margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.76rem", lineHeight: 1.45, color: "#fca5a5" };
const gridStyle: React.CSSProperties = { minWidth: 0 };
const cameraColumnStyle: React.CSSProperties = { minWidth: 0 };
const cameraCardStyle: React.CSSProperties = { padding: 16, borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", minWidth: 0 };
const slotHeaderRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 };
const slotBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" };
const heroChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: "var(--text-primary)", fontSize: "0.72rem", fontWeight: 700 };
const cameraActionsStyle: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, minWidth: 0 };
const fileMetaStyle: React.CSSProperties = { fontSize: "0.94rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const helperMetaStyle: React.CSSProperties = { color: "var(--text-muted)", lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const statusMetaStyle: React.CSSProperties = { marginTop: 10, fontSize: "0.78rem", color: "#93c5fd" };
const analysisCardStyle: React.CSSProperties = { padding: 14, borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(9,10,13,0.78)", minHeight: 420, display: "flex", flexDirection: "column", minWidth: 0 };
const frameWrapStyle: React.CSSProperties = { position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#080a0c", aspectRatio: "16 / 9", marginBottom: 12 };
const frameImageStyle: React.CSSProperties = { width: "100%", height: "100%", display: "block", objectFit: "cover" };
const frameOverlayStyle: React.CSSProperties = { position: "absolute", left: 10, right: 10, bottom: 10, height: 88, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" };
const inlineWarningStyle: React.CSSProperties = { marginBottom: 10, color: "#f5c46b", fontSize: "0.78rem" };
const metricsWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 };
const deltaRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 };
const chipStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)", flex: "1 1 120px", minWidth: 0 };
const deltaChipStyle: React.CSSProperties = { ...chipStyle, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)" };
const suggestionChipStyle: React.CSSProperties = { ...chipStyle, background: "rgba(255,255,255,0.035)" };
const chipLabelStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 5 };
const chipValueStyle: React.CSSProperties = { fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)" };
const detailsWrapStyle: React.CSSProperties = { marginTop: 4 };
const detailsSummaryStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", listStyle: "none", color: "var(--text-secondary)", fontSize: "0.84rem", fontWeight: 700 };
const framesGridStyle: React.CSSProperties = { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 };
const frameThumbButtonStyle: React.CSSProperties = { padding: 0, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, overflow: "hidden", background: "#070809", cursor: "pointer" };
const frameThumbStyle: React.CSSProperties = { display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover" };
const frameThumbPlaceholderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "16 / 9", color: "var(--text-muted)", fontSize: "0.72rem" };
const detailsDrawerStyle: React.CSSProperties = { marginTop: 12 };
const rawMetricsGridStyle: React.CSSProperties = { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 };
const rawMetricsCardStyle: React.CSSProperties = { padding: "12px 13px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)", display: "grid", gap: 8 };
const rawMetricsTitleStyle: React.CSSProperties = { fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-accent)", marginBottom: 2, fontWeight: 800 };
const rawMetricsLineStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "var(--text-secondary)", fontSize: "0.64rem", lineHeight: 1.2, whiteSpace: "nowrap" };
const rawMetricsLabelStyle: React.CSSProperties = { color: "var(--text-muted)", fontWeight: 700, flexShrink: 0, fontSize: "0.6rem" };
const rawMetricsValueStyle: React.CSSProperties = { color: "var(--text-primary)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", fontSize: "0.64rem" };
const placeholderStyle: React.CSSProperties = { minHeight: 320, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 12, color: "var(--text-muted)", textAlign: "center", padding: 24 };
const exportMenuStyle: React.CSSProperties = { position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 244, padding: 8, borderRadius: 12, background: "#0c0d0f", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 40px rgba(0,0,0,0.4)", zIndex: 30, display: "grid", gap: 6 };
const exportItemStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap" };
