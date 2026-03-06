import React, { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { ChartColumn, ChevronDown, Download, FolderOpen, Gauge, HelpCircle, ImageIcon, Maximize2, Palette, Pipette, RefreshCw, Trash2, Waves } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CalibrationChartDetection,
  CalibrationCropRectNormalized,
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
type MatchActionChip = {
  key: string;
  label: string;
  value: string;
  reason: string;
};

type MatchActionCard = {
  slot: string;
  tone: "critical" | "warning" | "info" | "good";
  status: string;
  severity: "Close" | "Moderate" | "Major";
  actions: MatchActionChip[];
};

type MatchActionsAction =
  | { kind: "proxy"; label: string; slot: string }
  | { kind: "recalibrate"; label: string; slot: string }
  | { kind: "lut"; label: string; slot: string }
  | { kind: "export"; label: string }
  | { kind: "analyze"; label: string };

type CalibrationCropState = {
  enabled: boolean;
  zoom: number;
  offset_x: number;
  offset_y: number;
  crop_rect_normalized: CalibrationCropRectNormalized;
};

type PreviewViewMode = "image" | "waveform" | "falseColor" | "scope";

type SignalPreviewData = {
  waveform_line: number[];
  waveform_density: number[][];
  rgb_scope_density: {
    red: number[][];
    green: number[][];
    blue: number[][];
  };
  false_color_data_url: string;
  summary: {
    min_luma: number;
    max_luma: number;
    median_luma: number;
  };
  zones: {
    clipped: number;
    near_clip: number;
    skin: number;
    mids: number;
    shadows: number;
    crushed: number;
  };
};

type DecisionItem = {
  id: string;
  tone: "critical" | "warning" | "info" | "good";
  label: string;
  reason: string;
};

type DecisionAction =
  | { kind: "proxy"; label: string }
  | { kind: "recalibrate"; label: string }
  | { kind: "lut"; label: string }
  | { kind: "signal"; label: string }
  | { kind: "export"; label: string };

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
  const [calibrationBySlot, setCalibrationBySlot] = useState<Record<string, CalibrationChartDetection>>({});
  const [calibratingSlots, setCalibratingSlots] = useState<Record<string, boolean>>({});
  const [fullscreenSlot, setFullscreenSlot] = useState<string | null>(null);
  const [previewModeBySlot, setPreviewModeBySlot] = useState<Record<string, "original" | "corrected" | "lut">>({});
  const [transformingSlots, setTransformingSlots] = useState<Record<string, boolean>>({});
  const [signalPreviewModeBySlot, setSignalPreviewModeBySlot] = useState<Record<string, PreviewViewMode>>({});
  const [signalPreviewByFramePath, setSignalPreviewByFramePath] = useState<Record<string, SignalPreviewData>>({});
  const [cropStateBySlot, setCropStateBySlot] = useState<Record<string, CalibrationCropState>>({});
  const [cropAssistSlot, setCropAssistSlot] = useState<string | null>(null);
  const [cropDragging, setCropDragging] = useState<{ slot: string; startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const cropViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFrames = async () => {
      const analyses = Object.entries(analysisBySlot);
      const calibrations = Object.entries(calibrationBySlot);
      if (analyses.length === 0 && calibrations.length === 0) {
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

      for (const [slot, calibration] of calibrations) {
        if (!calibration.corrected_preview_path) continue;
        try {
          const dataUrl = await invokeGuarded<string>("read_thumbnail", { path: calibration.corrected_preview_path });
          nextUrls[calibration.corrected_preview_path] = dataUrl;
        } catch {
          if (!nextWarnings[slot]) {
            nextWarnings[slot] = "Corrected preview is missing. Recalibrate this camera.";
          }
        }
        if (calibration.transform_preview_path) {
          try {
            const dataUrl = await invokeGuarded<string>("read_thumbnail", { path: calibration.transform_preview_path });
            nextUrls[calibration.transform_preview_path] = dataUrl;
          } catch {
            if (!nextWarnings[slot]) {
              nextWarnings[slot] = "Transform preview is missing. Re-run calibration.";
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
  }, [analysisBySlot, calibrationBySlot]);

  useEffect(() => {
    let cancelled = false;
    const representativeFrames = SLOT_ORDER
      .map((slot) => analysisBySlot[slot]?.representative_frame_path)
      .filter((framePath): framePath is string => Boolean(framePath))
      .filter((framePath) => Boolean(frameDataUrls[framePath]) && !signalPreviewByFramePath[framePath]);

    if (representativeFrames.length === 0) return undefined;

    const loadSignalPreviews = async () => {
      const nextPreviews: Record<string, SignalPreviewData> = {};
      for (const framePath of representativeFrames) {
        try {
          nextPreviews[framePath] = await buildSignalPreviewData(frameDataUrls[framePath]);
        } catch {
          continue;
        }
      }
      if (!cancelled && Object.keys(nextPreviews).length > 0) {
        startTransition(() => {
          setSignalPreviewByFramePath((prev) => ({ ...prev, ...nextPreviews }));
        });
      }
    };

    void loadSignalPreviews();

    return () => {
      cancelled = true;
    };
  }, [analysisBySlot, frameDataUrls, signalPreviewByFramePath]);

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
        const nextCalibrations: Record<string, CalibrationChartDetection> = {};
        const nextPreviewModes: Record<string, "original" | "corrected" | "lut"> = {};
        run.results.forEach((result) => {
          nextAnalyses[result.slot] = result.analysis;
          nextClips[result.slot] = result.analysis.clip_path;
          if (result.calibration?.chart_detected) {
            nextCalibrations[result.slot] = result.calibration;
            nextPreviewModes[result.slot] = result.calibration.transform_preview_path ? "lut" : "corrected";
          }
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
          setCalibrationBySlot(nextCalibrations);
          setPreviewModeBySlot(nextPreviewModes);
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

  const persistCurrentRun = async (message: string) => {
    const resultEntries = SLOT_ORDER
      .filter((slot) => analysisBySlot[slot])
      .map((slot) => {
        const analysis = analysisBySlot[slot];
        return {
          slot,
          proxy_path: analysis.source_path !== analysis.clip_path ? analysis.source_path : null,
          analysis,
          calibration: calibrationBySlot[slot] ?? null,
        };
      });
    if (resultEntries.length === 0) return;
    const runId = await invokeGuarded<string>("production_matchlab_save_run", {
      projectId: project.id,
      heroSlot,
      results: resultEntries,
    });
    const runs = await invokeGuarded<ProductionMatchLabRunSummary[]>("production_matchlab_list_runs", {
      projectId: project.id,
    });
    startTransition(() => {
      setRunSummaries(runs);
      setSelectedRunId(runId);
      setSavedRunMessage(message);
    });
  };

  useEffect(() => {
    const heroCalibration = calibrationBySlot[heroSlot];
    if (!heroCalibration?.chart_detected) return;
    let cancelled = false;

    const refreshTransforms = async () => {
      let didChange = false;
      for (const slot of SLOT_ORDER) {
        const calibration = calibrationBySlot[slot];
        const analysis = analysisBySlot[slot];
        if (!calibration?.chart_detected || !analysis?.representative_frame_path) continue;
        if (slot === heroSlot) {
          if (
            calibration.calibration_transform ||
            calibration.lut_path ||
            calibration.transform_preview_path ||
            calibration.transform_target_slot !== heroSlot ||
            calibration.mean_delta_e_before !== calibration.mean_delta_e
          ) {
            didChange = true;
            startTransition(() => {
              setCalibrationBySlot((prev) => ({
                ...prev,
                [slot]: {
                  ...prev[slot],
                  calibration_transform: null,
                  lut_path: null,
                  cube_size: null,
                  transform_type: null,
                  transform_target_slot: heroSlot,
                  mean_delta_e_before: prev[slot].mean_delta_e,
                  mean_delta_e_after: null,
                  transform_preview_path: null,
                },
              }));
              setPreviewModeBySlot((prev) => ({ ...prev, [slot]: "corrected" }));
            });
          }
          continue;
        }
        if (
          calibration.transform_target_slot === heroSlot &&
          calibration.transform_preview_path &&
          calibration.calibration_transform
        ) {
          continue;
        }

        startTransition(() => {
          setTransformingSlots((prev) => ({ ...prev, [slot]: true }));
          setSlotStatuses((prev) => ({ ...prev, [slot]: "Building LUT..." }));
        });
        try {
          const transformed = await invokeGuarded<CalibrationChartDetection>("production_matchlab_generate_transform", {
            projectId: project.id,
            slot,
            heroSlot,
            sourceFramePath: analysis.representative_frame_path,
            sourceCalibration: calibration,
            targetCalibration: heroCalibration,
          });
          if (cancelled) return;
          didChange = true;
          startTransition(() => {
            setCalibrationBySlot((prev) => ({ ...prev, [slot]: transformed }));
            setPreviewModeBySlot((prev) => ({ ...prev, [slot]: transformed.transform_preview_path ? "lut" : "corrected" }));
            setSlotStatuses((prev) => ({ ...prev, [slot]: "Calibration ready" }));
          });
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          startTransition(() => {
            setSlotErrors((prev) => ({ ...prev, [slot]: message.split("\n")[0] }));
            setSlotErrorDetails((prev) => ({ ...prev, [slot]: message }));
          });
        } finally {
          if (!cancelled) {
            startTransition(() => {
              setTransformingSlots((prev) => {
                const next = { ...prev };
                delete next[slot];
                return next;
              });
            });
          }
        }
      }
      if (!cancelled && didChange) {
        try {
          await persistCurrentRun("Saved calibration");
        } catch {
          // Keep the calibration visible even if snapshot persistence fails.
        }
      }
    };

    void refreshTransforms();

    return () => {
      cancelled = true;
    };
  }, [analysisBySlot, calibrationBySlot, heroSlot, project.id]);

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

  const matchActions = useMemo(() => buildMatchActions({
    heroSlot,
    analyses: matchResult.analyses,
    analysisBySlot,
    calibrationBySlot,
    clipsBySlot,
    analysisOverrideBySlot,
    signalPreviewByFramePath,
    selectedSlots,
  }), [analysisBySlot, analysisOverrideBySlot, calibrationBySlot, clipsBySlot, heroSlot, matchResult.analyses, selectedSlots, signalPreviewByFramePath]);

  const pickClip = async (slot: string) => {
    const selected = await open({
      multiple: false,
      title: `Select camera ${slot} test clip`,
      filters: [{
        name: "Video",
        extensions: ["mov", "mp4", "mxf", "mkv", "avi", "braw", "r3d", "nev"],
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
    setCalibrationBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setPreviewModeBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    if (isProxyOnlyRawClip(selected)) {
      setSlotStatuses((prev) => ({ ...prev, [slot]: `${getProxyOnlyFormatBadge(selected)} detected · Proxy required` }));
    }
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
    setCalibrationBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setCalibratingSlots((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setPreviewModeBySlot((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const calibrateSlot = async (slot: string, framePath?: string, cropRectNormalized?: CalibrationCropRectNormalized) => {
    if (!framePath) return;
    setCalibratingSlots((prev) => ({ ...prev, [slot]: true }));
    try {
      const result = await invokeGuarded<CalibrationChartDetection>("production_matchlab_detect_calibration", {
        projectId: project.id,
        slot,
        framePath,
        cropRectNormalized: cropRectNormalized ?? null,
      });
      startTransition(() => {
        setCalibrationBySlot((prev) => ({ ...prev, [slot]: result }));
        setPreviewModeBySlot((prev) => ({ ...prev, [slot]: "corrected" }));
        setSlotStatuses((prev) => ({ ...prev, [slot]: "Calibration ready" }));
        setSlotErrors((prev) => {
          const next = { ...prev };
          delete next[slot];
          return next;
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      startTransition(() => {
        setSlotErrors((prev) => ({ ...prev, [slot]: message.split("\n")[0] }));
        setSlotErrorDetails((prev) => ({ ...prev, [slot]: message }));
      });
    } finally {
      setCalibratingSlots((prev) => ({ ...prev, [slot]: false }));
    }
  };

  const analyzeClips = async () => {
    if (selectedSlots.length === 0) return;
    setAnalyzing(true);
    setActiveSlots(selectedSlots);
    setSlotErrors({});
    setSlotErrorDetails({});
    setSelectedRunId(null);
    const nextResults: Array<{ slot: string; proxy_path?: string | null; analysis: CameraMatchAnalysisResult; calibration?: CalibrationChartDetection | null }> = [];

    try {
      for (const slot of selectedSlots) {
        const clipPath = clipsBySlot[slot];
        if (!clipPath) continue;
        if (isProxyOnlyRawClip(clipPath) && !analysisOverrideBySlot[slot]) {
          const formatLabel = getProxyOnlyFormatBadge(clipPath);
          startTransition(() => {
            setSlotStatuses((prev) => ({ ...prev, [slot]: "Proxy required" }));
            setSlotErrors((prev) => ({ ...prev, [slot]: "Proxy required for analysis" }));
            setSlotErrorDetails((prev) => ({
              ...prev,
              [slot]: `${formatLabel} source selected. This format is accepted in Match Lab, but analysis runs through an operator-selected MP4 or MOV proxy.`,
            }));
          });
          continue;
        }
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
          nextResults.push({
            slot,
            proxy_path: proxyPath,
            analysis: { ...result, clip_path: clipPath },
            calibration: calibrationBySlot[slot] ?? null,
          });
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
        calibration: calibrationBySlot[analysis.slot] ?? null,
      })),
    };
    if (kind === "pdf") {
      await exportProductionMatchSheetPdf(exportPayload);
      return;
    }
    await exportProductionMatchSheetImage(exportPayload);
  };

  const exportSlotLut = async (slot: string, calibration: CalibrationChartDetection) => {
    if (!calibration.lut_path) {
      setSavedRunMessage("No LUT available for this camera.");
      return;
    }
    const defaultName = calibration.lut_path.split("/").pop() || `camera_${slot.toLowerCase()}_to_${heroSlot.toLowerCase()}.cube`;
    const destination = await save({
      title: `Export Camera ${slot} LUT`,
      defaultPath: defaultName,
      filters: [{ name: "LUT", extensions: ["cube"] }],
    });
    if (typeof destination !== "string") return;
    await invokeGuarded("production_matchlab_export_lut", {
      lutPath: calibration.lut_path,
      destinationPath: destination,
    });
    setSavedRunMessage(`Exported LUT for camera ${slot}`);
  };

  const exportSlotMonitorLut = async (slot: string, calibration: CalibrationChartDetection) => {
    if (!calibration.lut_path) {
      setSavedRunMessage("No LUT available for this camera.");
      return;
    }
    const defaultName = `camera_${slot.toLowerCase()}_to_${heroSlot.toLowerCase()}_monitor.cube`;
    const destination = await save({
      title: `Export Camera ${slot} Monitor LUT`,
      defaultPath: defaultName,
      filters: [{ name: "LUT", extensions: ["cube"] }],
    });
    if (typeof destination !== "string") return;
    await invokeGuarded("production_matchlab_export_lut", {
      lutPath: calibration.lut_path,
      destinationPath: destination,
    });
    setSavedRunMessage(`Exported monitor LUT for camera ${slot}`);
  };

  const exportCalibrationPackage = async () => {
    if (!selectedRunId) {
      setSavedRunMessage("Save a run before exporting the calibration package.");
      return;
    }
    const packagePath = await invokeGuarded<string>("production_matchlab_export_calibration_package", {
      projectId: project.id,
      runId: selectedRunId,
    });
    setSavedRunMessage(`Calibration package ready: ${getFileName(packagePath)}`);
  };

  const pickExistingProxy = async (slot: string) => {
    const selected = await open({
      multiple: false,
      title: `Select existing MP4 or MOV proxy for camera ${slot}`,
      filters: [{ name: "Proxy", extensions: ["mp4", "mov"] }],
    });
    if (typeof selected !== "string") return;
    setAnalysisOverrideBySlot((prev) => ({ ...prev, [slot]: selected }));
    setSlotStatuses((prev) => ({ ...prev, [slot]: "Proxy selected" }));
  };

  const openCropAssist = (slot: string) => {
    setCropStateBySlot((prev) => ({
      ...prev,
      [slot]: prev[slot] ?? buildDefaultCropState(),
    }));
    setCropAssistSlot(slot);
  };

  const updateCropZoom = (slot: string, nextZoom: number) => {
    setCropStateBySlot((prev) => {
      const current = prev[slot] ?? buildDefaultCropState();
      return {
        ...prev,
        [slot]: buildCropState(nextZoom, current.offset_x, current.offset_y),
      };
    });
  };

  const resetCropAssist = (slot: string) => {
    setCropStateBySlot((prev) => ({ ...prev, [slot]: buildDefaultCropState() }));
  };

  const confirmCropAssist = async (slot: string) => {
    const framePath = analysisBySlot[slot]?.representative_frame_path;
    if (!framePath) return;
    const cropState = cropStateBySlot[slot] ?? buildDefaultCropState();
    setCropAssistSlot(null);
    await calibrateSlot(slot, framePath, cropState.crop_rect_normalized);
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
            <div style={headerTitleRowStyle}>
              <div style={headerTitleStyle}>Camera Match Lab</div>
              <div style={subtleStyle}>Measured match sheet. {FRAME_COUNT} frames per clip.</div>
            </div>
            <div className="production-matchlab-header-utility" style={headerUtilityRowStyle}>
              <div style={headerMetaClusterStyle}>
                <div style={headerInfoBlockStyle}>
                  <div style={headerProjectNameStyle}>Project {project.name}</div>
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
                      <button type="button" className="production-matchlab-export-item" style={exportItemStyle} onClick={() => void exportCalibrationPackage()}>Export Calibration Package</button>
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
              const analysisWarning = rawAnalysis?.warnings?.[0];
              const slotError = slotErrors[slot];
              const slotErrorDetail = slotErrorDetails[slot];
              const parsedSlotError = slotErrorDetail ? parseStructuredError(slotErrorDetail) : { summary: "", details: "" };
              const calibrationFailure = isCalibrationDetectionFailure(slotError, parsedSlotError.summary, parsedSlotError.details);
              const calibrationRecoveryActions = calibrationFailure ? buildCalibrationRecoveryActions(slot, parsedSlotError.details) : [];
              const slotStatus = slotStatuses[slot];
              const active = activeSlots.includes(slot);
              const calibration = calibrationBySlot[slot];
              const heroCalibration = calibrationBySlot[heroSlot];
              const correctionDisplay = calibration ? buildCalibrationDisplay(calibration, heroCalibration, slot === heroSlot) : null;
              const previewMode = previewModeBySlot[slot] ?? "original";
              const signalPreviewMode = signalPreviewModeBySlot[slot] ?? "image";
              const correctedPreviewUrl = calibration?.corrected_preview_path ? frameDataUrls[calibration.corrected_preview_path] : "";
              const transformPreviewUrl = calibration?.transform_preview_path ? frameDataUrls[calibration.transform_preview_path] : "";
              const signalPreview = rawAnalysis ? signalPreviewByFramePath[rawAnalysis.representative_frame_path] : undefined;
              const signalOnly = Boolean(rawAnalysis) && !calibration?.chart_detected;
              const decisionSummary = analysis && rawAnalysis
                ? buildDecisionSummary({
                  slot,
                  heroSlot,
                  clipPath: clipPath || "",
                  analysis,
                  rawAnalysis,
                  calibration,
                  signalPreview,
                })
                : null;
              const activePreviewUrl =
                previewMode === "lut" && transformPreviewUrl
                  ? transformPreviewUrl
                  : previewMode === "corrected" && correctedPreviewUrl
                    ? correctedPreviewUrl
                    : representativeFrameUrl;
              const activePreviewLabel =
                previewMode === "lut" && transformPreviewUrl
                  ? "LUT Preview"
                  : previewMode === "corrected" && correctedPreviewUrl
                    ? "Corrected"
                    : "Original";

              return (
                <div key={slot} className="matchLabColumn" style={cameraColumnStyle}>
                  <div className="matchLabCard" style={cameraCardStyle}>
                    <div style={slotHeaderRowStyle}>
                      <span style={{ ...slotBadgeStyle, ...slotBadgeColor(slot) }}>Camera {slot}</span>
                      {heroSlot === slot && <span style={heroChipStyle}>Hero</span>}
                    </div>
                    {isProxyOnlyRawClip(clipPath || "") ? (
                      <div style={sourceMetaRowStyle}>
                        <span style={sourceBadgeStyle}>{getProxyOnlyFormatBadge(clipPath || "")}</span>
                        <span style={sourceMetaTextStyle}>{analysisOverrideBySlot[slot] ? "Proxy attached" : "Proxy required"}</span>
                      </div>
                    ) : null}
                    <div className="matchLabCameraActions" style={cameraActionsWrapStyle}>
                      <div style={cameraActionsTopRowStyle}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void pickClip(slot)}>
                          <FolderOpen size={14} /> {clipPath ? "Replace" : "Import Clip"}
                        </button>
                        {clipPath ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => clearSlot(slot)}>Clear</button>
                        ) : (
                          <span style={actionPlaceholderStyle} aria-hidden="true" />
                        )}
                        {rawAnalysis?.representative_frame_path ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void calibrateSlot(slot, rawAnalysis.representative_frame_path)}
                            disabled={Boolean(calibratingSlots[slot])}
                          >
                            <Pipette size={14} /> {calibratingSlots[slot] ? "Calibrating..." : "Calibrate"}
                          </button>
                        ) : (
                          <span style={actionPlaceholderStyle} aria-hidden="true" />
                        )}
                      </div>
                      <div style={cameraActionsSupportRowStyle}>
                        {isProxyOnlyRawClip(clipPath || "") && !rawAnalysis?.representative_frame_path ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pickExistingProxy(slot)}>
                            <FolderOpen size={14} /> Use existing MP4/MOV proxy…
                          </button>
                        ) : rawAnalysis?.representative_frame_path ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openCropAssist(slot)}>
                            <Maximize2 size={14} /> Zoom to chart
                          </button>
                        ) : (
                          <span style={supportRowPlaceholderStyle} aria-hidden="true" />
                        )}
                      </div>
                    </div>
                    <div className="matchLabPathPrimary" style={fileMetaStyle} title={clipPath ? getFileName(clipPath) : "No clip selected"}>{clipPath ? getFileName(clipPath) : "No clip selected"}</div>
                    <div className="matchLabPathSecondary" style={helperMetaStyle} title={clipPath || "One short test clip per camera."}>{clipPath || "One short test clip per camera."}</div>
                    {analysisOverrideBySlot[slot] ? (
                      <div style={sourceMetaInlineStyle} title={analysisOverrideBySlot[slot]}>
                        Using proxy · {getFileName(analysisOverrideBySlot[slot])}
                      </div>
                    ) : null}
                    {slotStatus ? <div style={statusMetaStyle}>{slotStatus}</div> : null}
                  </div>

                  <div className="matchLabCard matchLabAnalysisCard" style={analysisCardStyle}>
                    {slotError && (
                      <div style={errorCardStyle}>
                        <div>{calibrationFailure ? "Calibration unavailable" : slotError}</div>
                        {calibrationFailure ? (
                          <>
                            <div style={errorSupportTextStyle}>Using signal analysis only. Reframe the chart and retry.</div>
                            <div style={recoveryActionRowStyle}>
                              {calibrationRecoveryActions.map((action) => (
                                <span key={`${slot}:${action.label}`} title={action.reason} style={recoveryActionChipStyle}>
                                  {action.label}
                                </span>
                              ))}
                            </div>
                            {rawAnalysis?.representative_frame_path ? (
                              <div style={errorActionsStyle}>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => void calibrateSlot(slot, rawAnalysis.representative_frame_path)}
                                  disabled={Boolean(calibratingSlots[slot])}
                                >
                                  <Pipette size={14} /> Retry Calibration
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => openCropAssist(slot)}
                                >
                                  <Maximize2 size={14} /> Zoom to chart
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : isBrawClip(clipPath || "") || isProxyOnlyRawClip(clipPath || "") ? (
                          <div style={errorActionsStyle}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pickExistingProxy(slot)} disabled={active}>
                              <FolderOpen size={14} /> Use existing MP4/MOV proxy…
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
                        <div style={previewToggleRowStyle}>
                          <div style={previewIconGroupStyle}>
                            <PreviewModeButton
                              icon={<ImageIcon size={14} />}
                              active={signalPreviewMode === "image"}
                              onClick={() => setSignalPreviewModeBySlot((prev) => ({ ...prev, [slot]: "image" }))}
                              label="Image preview"
                            />
                            <PreviewModeButton
                              icon={<Waves size={14} />}
                              active={signalPreviewMode === "waveform"}
                              onClick={() => setSignalPreviewModeBySlot((prev) => ({ ...prev, [slot]: "waveform" }))}
                              label="Waveform preview"
                              disabled={!signalPreview}
                            />
                            <PreviewModeButton
                              icon={<Palette size={14} />}
                              active={signalPreviewMode === "falseColor"}
                              onClick={() => setSignalPreviewModeBySlot((prev) => ({ ...prev, [slot]: "falseColor" }))}
                              label="False color preview"
                              disabled={!signalPreview}
                            />
                            <PreviewModeButton
                              icon={<ChartColumn size={14} />}
                              active={signalPreviewMode === "scope"}
                              onClick={() => setSignalPreviewModeBySlot((prev) => ({ ...prev, [slot]: "scope" }))}
                              label="Scope preview"
                              disabled={!signalPreview}
                            />
                          </div>
                          {calibration?.chart_detected ? (
                            <>
                              <button
                                type="button"
                                className={`btn btn-sm ${previewMode === "original" ? "btn-secondary" : "btn-ghost"}`}
                                onClick={() => setPreviewModeBySlot((prev) => ({ ...prev, [slot]: "original" }))}
                              >
                                Original
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${previewMode === "corrected" ? "btn-secondary" : "btn-ghost"}`}
                                onClick={() => setPreviewModeBySlot((prev) => ({ ...prev, [slot]: "corrected" }))}
                                disabled={!correctedPreviewUrl}
                              >
                                Corrected
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${previewMode === "lut" ? "btn-secondary" : "btn-ghost"}`}
                                onClick={() => setPreviewModeBySlot((prev) => ({ ...prev, [slot]: "lut" }))}
                                disabled={!transformPreviewUrl}
                              >
                                LUT Preview
                              </button>
                              <span style={previewToggleDividerStyle} />
                            </>
                          ) : null}
                          <span style={previewToggleLabelStyle}>
                            {signalPreviewMode === "image"
                              ? calibration?.chart_detected ? activePreviewLabel : "Preview"
                              : signalPreviewMode === "waveform"
                                ? "Waveform"
                                : signalPreviewMode === "falseColor"
                                  ? "False Color"
                                  : signalPreviewMode === "scope"
                                    ? "Scope"
                                : calibration?.chart_detected
                                  ? `${activePreviewLabel}`
                                  : "Preview"}
                          </span>
                        </div>
                        <div className="matchLabFrameWrap" style={frameWrapStyle}>
                          {signalPreviewMode === "image" ? (
                            <>
                              <img className="matchLabFrameImage" src={activePreviewUrl} alt={`${slot} representative frame`} style={frameImageStyle} />
                              {previewMode === "original" && calibration?.chart_detected ? <CalibrationOverlay calibration={calibration} /> : null}
                            </>
                          ) : signalPreviewMode === "waveform" ? (
                            <WaveformPreview data={signalPreview} />
                          ) : signalPreviewMode === "falseColor" ? (
                            signalPreview?.false_color_data_url ? (
                              <img className="matchLabFrameImage" src={signalPreview.false_color_data_url} alt={`${slot} false color preview`} style={frameImageStyle} />
                            ) : (
                              <WaveformPreview data={signalPreview} />
                            )
                          ) : signalPreviewMode === "scope" ? (
                            <ScopePreview data={signalPreview} />
                          ) : (
                            <>
                              <img className="matchLabFrameImage" src={activePreviewUrl} alt={`${slot} representative frame`} style={frameImageStyle} />
                              {previewMode === "original" && calibration?.chart_detected ? <CalibrationOverlay calibration={calibration} /> : null}
                            </>
                          )}
                          {signalPreviewMode === "image" ? (
                            <div style={frameOverlayStyle}>
                              <HistogramOverlay histogram={analysis.metrics.luma_histogram} />
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={frameExpandButtonStyle}
                            onClick={() => setFullscreenSlot(slot)}
                          >
                            <Maximize2 size={14} />
                          </button>
                        </div>
                        {(frameWarning || analysisWarning) && <div style={inlineWarningStyle}>{frameWarning || analysisWarning}</div>}
                        {signalOnly ? (
                          <div style={signalOnlyStripStyle}>
                            <span style={signalOnlyChipStyle}>Signal only</span>
                            <span style={signalOnlyTextStyle}>Calibration unavailable · Using signal analysis only</span>
                          </div>
                        ) : null}
                        {signalPreviewMode === "falseColor" && signalPreview ? (
                          <>
                            <div style={metricsWrapStyle}>
                              <SuggestionChip label="Skin" value={formatZonePercent(signalPreview.zones.skin)} />
                              <SuggestionChip label="Near clip" value={formatZonePercent(signalPreview.zones.near_clip)} />
                              <SuggestionChip label="Clipped" value={formatZonePercent(signalPreview.zones.clipped)} />
                              <SuggestionChip label="Shadows" value={formatZonePercent(signalPreview.zones.shadows + signalPreview.zones.crushed)} />
                            </div>
                            <div style={falseColorLegendStyle} title="False color legend: clipped, near clipping, skin, mids, shadows.">
                              <LegendChip color="rgb(255, 64, 64)" label="Clip" />
                              <LegendChip color="rgb(255, 149, 0)" label="Near" />
                              <LegendChip color="rgb(235, 78, 155)" label="Skin" />
                              <LegendChip color="rgb(72, 187, 120)" label="Mids" />
                              <LegendChip color="rgb(32, 156, 238)" label="Shad" />
                            </div>
                          </>
                        ) : null}
                        {calibration?.chart_detected ? (
                          <div style={calibrationStripStyle}>
                          <div style={calibrationHeaderStyle}>
                              <span style={chipLabelStyle}>Calibration</span>
                              <div style={calibrationHeaderMetaStyle}>
                                <span style={qualitySummaryStyle}>Quality {calibration.calibration_quality_score} · {calibration.calibration_quality_level}</span>
                                <span style={{ ...qualityLevelChipStyle, ...qualityLevelStyle(calibration.calibration_quality_level) }}>
                                  {calibration.calibration_quality_level}
                                </span>
                              </div>
                            </div>
                            <div style={qualityBandStyle}>
                              <div style={{ ...qualityFillStyle, ...qualityLevelFillStyle(calibration.calibration_quality_level), width: `${Math.max(calibration.calibration_quality_score, 10)}%` }} />
                            </div>
                            {calibration.warnings.length > 0 ? (
                              <div style={warningBadgeRowStyle}>
                                {calibration.warnings.slice(0, 2).map((warning) => (
                                  <span key={warning} style={warningBadgeStyle}>
                                    {compactWarningLabel(warning)}
                                  </span>
                                ))}
                                {calibration.warnings.length > 2 ? (
                                  <span style={warningBadgeStyle}>+{calibration.warnings.length - 2} more</span>
                                ) : null}
                              </div>
                            ) : null}
                            {correctionDisplay ? (
                              <div style={metricsWrapStyle}>
                                <SuggestionChip label="Exposure" value={correctionDisplay.exposure} />
                                <SuggestionChip label="WB" value={correctionDisplay.whiteBalance} />
                                <SuggestionChip label="Tint" value={correctionDisplay.tint} />
                                <SuggestionChip label="dE Before" value={calibration.mean_delta_e_before.toFixed(1)} />
                                <SuggestionChip label="dE After" value={calibration.mean_delta_e_after?.toFixed(1) ?? "—"} />
                                <SuggestionChip label="Improve" value={formatImprovement(calibration.mean_delta_e_before, calibration.mean_delta_e_after)} />
                              </div>
                            ) : null}
                            <div style={metricsWrapStyle}>
                              <SuggestionChip label="Neutral dE" value={calibration.neutral_mean_delta_e.toFixed(1)} />
                              <SuggestionChip label="Skin dE" value={calibration.skin_mean_delta_e.toFixed(1)} />
                              <SuggestionChip label="Max dE" value={calibration.max_delta_e.toFixed(1)} />
                              <SuggestionChip label="LUT" value={calibration.lut_path ? getFileName(calibration.lut_path) : slot === heroSlot ? "Hero baseline" : "Pending"} />
                            </div>
                            {calibration.transform_quality_flag ? (
                              <div style={inlineWarningStyle}>{calibration.transform_quality_flag}</div>
                            ) : null}
                            {slot !== heroSlot ? (
                              <div style={errorActionsStyle}>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => void exportSlotLut(slot, calibration)}
                                  disabled={!calibration.lut_path || Boolean(transformingSlots[slot])}
                                >
                                  <Download size={14} /> Export LUT
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => void exportSlotMonitorLut(slot, calibration)}
                                  disabled={!calibration.lut_path || Boolean(transformingSlots[slot])}
                                >
                                  <Download size={14} /> Export Monitor LUT
                                </button>
                              </div>
                            ) : null}
                            <div style={patchGridStyle}>
                              {calibration.patch_samples.map((patch) => (
                                <PatchDeltaSwatch key={patch.patch_index} patch={patch} />
                              ))}
                            </div>
                          </div>
                        ) : null}
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
                          <SuggestionChip label="Confidence" value={analysis.suggestions?.confidence ?? "Low"} />
                        </div>
                        <div style={metricsWrapStyle}>
                          <SuggestionChip label="Format" value={formatSourceKindLabel(rawAnalysis)} />
                          <SuggestionChip label="Source" value={formatAnalysisSourceLabel(rawAnalysis)} />
                          <SuggestionChip label="Resolution" value={rawAnalysis.measurement_bundle.resolution ?? `${rawAnalysis.per_frame[0]?.width ?? "—"}×${rawAnalysis.per_frame[0]?.height ?? "—"}`} />
                          <SuggestionChip label="Waveform" value={`${formatPercent(rawAnalysis.measurement_bundle.waveform_summary.median_luma)} mid`} />
                        </div>
                        {analysis.suggestions?.warning ? <div style={inlineWarningStyle}>{analysis.suggestions.warning}</div> : null}
                        {decisionSummary ? (
                          <div style={decisionSummaryStyle}>
                            <div style={decisionSummaryHeaderStyle}>
                              <span style={chipLabelStyle}>Decision</span>
                              <span style={decisionSummaryMetaStyle}>{signalOnly ? "Signal match" : "Match status"}</span>
                            </div>
                            <div style={decisionListStyle}>
                              {decisionSummary.items.map((item) => (
                                <div key={item.id} style={decisionRowStyle}>
                                  <span style={{ ...guidanceToneDotStyle, ...guidanceToneDotColor(item.tone) }} />
                                  <span style={decisionLabelStyle}>{item.label}</span>
                                  <span title={item.reason} style={guidanceHelpStyle}>
                                    <HelpCircle size={12} />
                                  </span>
                                </div>
                              ))}
                            </div>
                            {decisionSummary.action ? (
                              <div style={decisionActionRowStyle}>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    if (decisionSummary.action?.kind === "proxy") {
                                      void pickExistingProxy(slot);
                                      return;
                                    }
                                    if (decisionSummary.action?.kind === "recalibrate" && rawAnalysis.representative_frame_path) {
                                      void calibrateSlot(slot, rawAnalysis.representative_frame_path);
                                      return;
                                    }
                                    if (decisionSummary.action?.kind === "lut" && calibration) {
                                      void exportSlotLut(slot, calibration);
                                      return;
                                    }
                                    if (decisionSummary.action?.kind === "export") {
                                      setExportMenuOpen(true);
                                      return;
                                    }
                                    if (decisionSummary.action?.kind === "signal") {
                                      setSignalPreviewModeBySlot((prev) => ({ ...prev, [slot]: "waveform" }));
                                    }
                                  }}
                                >
                                  {decisionSummary.action.label}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <details style={detailsWrapStyle}>
                          <summary style={detailsSummaryStyle}>
                            <ImageIcon size={14} /> Frames & Details
                          </summary>
                          {rawAnalysis.proxy_info ? (
                            <div style={detailsMetaLineStyle}>
                              <span style={rawMetricsLabelStyle}>Proxy info</span>
                              <span style={detailsMetaValueStyle}>{rawAnalysis.proxy_info}</span>
                            </div>
                          ) : null}
                          <div style={detailsMetaLineStyle}>
                            <span style={rawMetricsLabelStyle}>Source</span>
                            <span style={detailsMetaValueStyle}>{formatMeasurementBundleLine(rawAnalysis.measurement_bundle)}</span>
                          </div>
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
          {(matchActions.cards.length > 0 || selectedSlots.length > 0) ? (
            <section style={guidanceSectionStyle}>
              <div style={guidanceHeaderStyle}>
                <div>
                  <div style={guidanceTitleStyle}>Match Actions</div>
                  <div style={matchActionsSubtitleStyle}>Apply these changes to move each camera toward the hero.</div>
                </div>
              </div>
              <div style={matchActionsGridStyle}>
                {matchActions.cards.length > 0 ? matchActions.cards.map((card) => (
                  <div key={card.slot} style={matchActionCardStyle}>
                    <div style={matchActionCardHeaderStyle}>
                      <div style={matchActionCardTopStyle}>
                        <span style={{ ...slotBadgeStyle, ...slotBadgeColor(card.slot), minWidth: 30, justifyContent: "center" }}>
                          {card.slot}
                        </span>
                        <span style={matchActionCardTitleStyle}>Camera {card.slot}</span>
                      </div>
                      <span style={{ ...matchActionSeverityStyle, ...matchActionSeverityTone(card.tone) }}>{card.severity}</span>
                    </div>
                    <div style={matchActionStatusStyle}>{card.status}</div>
                    <div style={matchActionChipGridStyle}>
                      {card.actions.map((action) => (
                        <div key={`${card.slot}-${action.key}`} style={matchActionChipStyle}>
                          <span style={matchActionChipLabelStyle}>{action.label}</span>
                          <span style={matchActionChipValueStyle}>{action.value}</span>
                          <span title={action.reason} style={guidanceHelpStyle}>
                            <HelpCircle size={12} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )) : (
                  <div style={matchActionEmptyStyle}>Hero baseline</div>
                )}
              </div>
              <div style={guidanceActionRowStyle}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (!matchActions.action) return;
                    if (matchActions.action.kind === "proxy") {
                      void pickExistingProxy(matchActions.action.slot);
                      return;
                    }
                    if (matchActions.action.kind === "recalibrate") {
                      const framePath = analysisBySlot[matchActions.action.slot]?.representative_frame_path;
                      if (framePath) {
                        void calibrateSlot(matchActions.action.slot, framePath);
                      }
                      return;
                    }
                    if (matchActions.action.kind === "lut") {
                      const calibration = calibrationBySlot[matchActions.action.slot];
                      if (calibration) {
                        void exportSlotLut(matchActions.action.slot, calibration);
                      }
                      return;
                    }
                    if (matchActions.action.kind === "export") {
                      setExportMenuOpen(true);
                      return;
                    }
                    void analyzeClips();
                  }}
                >
                  {matchActions.action?.label ?? "Re-check Match"}
                </button>
              </div>
            </section>
          ) : null}
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
      {fullscreenSlot && analysisBySlot[fullscreenSlot] ? (
        <div style={modalBackdropStyle} onClick={() => setFullscreenSlot(null)}>
          <div style={fullscreenCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={fullscreenHeaderStyle}>
              <div>
                <div style={modalTitleStyle}>Calibration Preview · Camera {fullscreenSlot}</div>
                <div style={modalMetaStyle}>{getFileName(analysisBySlot[fullscreenSlot].clip_path)}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullscreenSlot(null)}>Close</button>
            </div>
            <div style={fullscreenFrameWrapStyle}>
              <img
                src={previewModeBySlot[fullscreenSlot] === "corrected" && calibrationBySlot[fullscreenSlot]?.corrected_preview_path
                  ? frameDataUrls[calibrationBySlot[fullscreenSlot].corrected_preview_path] || frameDataUrls[analysisBySlot[fullscreenSlot].representative_frame_path]
                  : previewModeBySlot[fullscreenSlot] === "lut" && calibrationBySlot[fullscreenSlot]?.transform_preview_path
                    ? frameDataUrls[calibrationBySlot[fullscreenSlot].transform_preview_path!] || frameDataUrls[analysisBySlot[fullscreenSlot].representative_frame_path]
                    : frameDataUrls[analysisBySlot[fullscreenSlot].representative_frame_path]}
                alt={`Calibration preview ${fullscreenSlot}`}
                style={frameImageStyle}
              />
              {previewModeBySlot[fullscreenSlot] === "original" && calibrationBySlot[fullscreenSlot]?.chart_detected ? <CalibrationOverlay calibration={calibrationBySlot[fullscreenSlot]} /> : null}
            </div>
          </div>
        </div>
      ) : null}
      {cropAssistSlot && analysisBySlot[cropAssistSlot] ? (
        <div style={modalBackdropStyle} onClick={() => { setCropAssistSlot(null); setCropDragging(null); }}>
          <div style={fullscreenCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={fullscreenHeaderStyle}>
              <div>
                <div style={modalTitleStyle}>Zoom to chart · Camera {cropAssistSlot}</div>
                <div style={modalMetaStyle}>{getFileName(analysisBySlot[cropAssistSlot].clip_path)}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCropAssistSlot(null); setCropDragging(null); }}>Close</button>
            </div>
            <div style={cropControlsStyle}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateCropZoom(cropAssistSlot, Math.max(1, (cropStateBySlot[cropAssistSlot]?.zoom ?? 1) - 0.25))}>-</button>
              <input
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={cropStateBySlot[cropAssistSlot]?.zoom ?? 1}
                onChange={(event) => updateCropZoom(cropAssistSlot, Number(event.target.value))}
                style={cropSliderStyle}
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateCropZoom(cropAssistSlot, Math.min(4, (cropStateBySlot[cropAssistSlot]?.zoom ?? 1) + 0.25))}>+</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetCropAssist(cropAssistSlot)}>Reset</button>
            </div>
            <div
              ref={cropViewportRef}
              style={{
                ...cropViewportStyle,
                aspectRatio: `${analysisBySlot[cropAssistSlot].per_frame[0]?.width || 16} / ${analysisBySlot[cropAssistSlot].per_frame[0]?.height || 9}`,
                backgroundImage: `url(${frameDataUrls[analysisBySlot[cropAssistSlot].representative_frame_path]})`,
                backgroundSize: `${(cropStateBySlot[cropAssistSlot]?.zoom ?? 1) * 100}% ${(cropStateBySlot[cropAssistSlot]?.zoom ?? 1) * 100}%`,
                backgroundPosition: `${cropBackgroundPosition(cropStateBySlot[cropAssistSlot] ?? buildDefaultCropState()).x}% ${cropBackgroundPosition(cropStateBySlot[cropAssistSlot] ?? buildDefaultCropState()).y}%`,
              }}
              onMouseDown={(event) => {
                const current = cropStateBySlot[cropAssistSlot] ?? buildDefaultCropState();
                setCropDragging({
                  slot: cropAssistSlot,
                  startX: event.clientX,
                  startY: event.clientY,
                  startOffsetX: current.offset_x,
                  startOffsetY: current.offset_y,
                });
              }}
              onMouseMove={(event) => {
                if (!cropDragging || cropDragging.slot !== cropAssistSlot || !cropViewportRef.current) return;
                const rect = cropViewportRef.current.getBoundingClientRect();
                const current = cropStateBySlot[cropAssistSlot] ?? buildDefaultCropState();
                const visible = 1 / current.zoom;
                const maxOffset = Math.max(0, 1 - visible);
                const deltaX = (event.clientX - cropDragging.startX) / rect.width;
                const deltaY = (event.clientY - cropDragging.startY) / rect.height;
                setCropStateBySlot((prev) => ({
                  ...prev,
                  [cropAssistSlot]: buildCropState(
                    current.zoom,
                    clamp(cropDragging.startOffsetX - deltaX * visible, 0, maxOffset),
                    clamp(cropDragging.startOffsetY - deltaY * visible, 0, maxOffset),
                  ),
                }));
              }}
              onMouseUp={() => setCropDragging(null)}
              onMouseLeave={() => setCropDragging(null)}
            >
              <div style={cropViewportMaskStyle} />
              <div style={cropViewportBoxStyle} />
            </div>
            <div style={modalActionsStyle}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCropAssistSlot(null); setCropDragging(null); }}>Cancel</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void confirmCropAssist(cropAssistSlot)}>
                Use crop
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
        confidence: computeConfidence(result.aggregate, result.per_frame.length),
        warning: computeVarianceWarning(result.aggregate, result.per_frame.length),
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
    }, result.aggregate, result.per_frame.length),
  };
}

function buildDefaultCropState(): CalibrationCropState {
  return buildCropState(1.6, 0.1875, 0.1875);
}

function buildCropState(zoom: number, offsetX: number, offsetY: number): CalibrationCropState {
  const safeZoom = clamp(zoom, 1, 4);
  const visible = 1 / safeZoom;
  const maxOffset = Math.max(0, 1 - visible);
  const x = clamp(offsetX, 0, maxOffset);
  const y = clamp(offsetY, 0, maxOffset);
  return {
    enabled: true,
    zoom: safeZoom,
    offset_x: x,
    offset_y: y,
    crop_rect_normalized: {
      x,
      y,
      width: visible,
      height: visible,
    },
  };
}

function cropBackgroundPosition(cropState: CalibrationCropState) {
  const visible = cropState.crop_rect_normalized.width;
  const maxOffset = Math.max(0.0001, 1 - visible);
  return {
    x: (cropState.offset_x / maxOffset) * 100,
    y: (cropState.offset_y / maxOffset) * 100,
  };
}

function buildMatchActions({
  heroSlot,
  analyses,
  analysisBySlot,
  calibrationBySlot,
  clipsBySlot,
  analysisOverrideBySlot,
  signalPreviewByFramePath,
  selectedSlots,
}: {
  heroSlot: string;
  analyses: CameraMatchAnalysis[];
  analysisBySlot: Record<string, CameraMatchAnalysisResult>;
  calibrationBySlot: Record<string, CalibrationChartDetection>;
  clipsBySlot: Record<string, string>;
  analysisOverrideBySlot: Record<string, string>;
  signalPreviewByFramePath: Record<string, SignalPreviewData>;
  selectedSlots: string[];
}): { cards: MatchActionCard[]; action: MatchActionsAction | null } {
  const heroCalibration = calibrationBySlot[heroSlot];
  const cards = analyses
    .filter((analysis) => analysis.slot !== heroSlot)
    .map((analysis) => {
      const rawAnalysis = analysisBySlot[analysis.slot];
      const calibration = calibrationBySlot[analysis.slot];
      const signalPreview = signalPreviewByFramePath[rawAnalysis?.representative_frame_path || ""];
      const correctionDisplay = calibration?.chart_detected ? buildCalibrationDisplay(calibration, heroCalibration, false) : null;
      const actions = rawAnalysis ? buildMatchActionChips(analysis, rawAnalysis, correctionDisplay, signalPreview) : [];
      const severity = classifyMatchSeverity(analysis, signalPreview, calibration);
      return {
        slot: analysis.slot,
        tone: severity === "Major" ? "critical" : severity === "Moderate" ? "warning" : "good",
        status: buildMatchStatusText(analysis.slot, heroSlot, severity),
        severity,
        actions,
      } satisfies MatchActionCard;
    });

  const proxySlot = SLOT_ORDER.find((slot) => {
    const clipPath = clipsBySlot[slot];
    return clipPath && isProxyOnlyRawClip(clipPath) && !analysisOverrideBySlot[slot];
  });
  if (proxySlot) {
    return { cards, action: { kind: "proxy", label: "Attach Proxy", slot: proxySlot } };
  }

  const recalibrateSlot = SLOT_ORDER.find((slot) => {
    const analysis = analysisBySlot[slot];
    const calibration = calibrationBySlot[slot];
    return analysis?.representative_frame_path && !calibration?.chart_detected;
  });
  if (recalibrateSlot) {
    return { cards, action: { kind: "recalibrate", label: "Retry Calibration", slot: recalibrateSlot } };
  }

  const lutSlot = cards.find((card) => calibrationBySlot[card.slot]?.lut_path)?.slot;
  if (lutSlot) {
    return { cards, action: { kind: "lut", label: "Proceed to LUT Export", slot: lutSlot } };
  }
  if (analyses.length > 0) {
    return { cards, action: { kind: "export", label: "Export Results" } };
  }
  if (selectedSlots.length > 0) {
    return { cards, action: { kind: "analyze", label: "Re-check Match" } };
  }
  return { cards, action: null };
}

function isCalibrationDetectionFailure(slotError?: string, summary?: string, details?: string) {
  const text = `${slotError || ""}\n${summary || ""}\n${details || ""}`.toLowerCase();
  return text.includes("chart not detected");
}

function buildCalibrationRecoveryActions(slot: string, details: string) {
  const items: Array<{ label: string; reason: string }> = [];
  const detailText = details.toLowerCase();
  if (detailText.includes("best candidate area")) {
    items.push({
      label: "Move chart closer",
      reason: `Camera ${slot} needs the chart to occupy more of the frame for stable patch sampling.`,
    });
  }
  if (detailText.includes("best aspect ratio")) {
    items.push({
      label: "Keep chart flat",
      reason: `Camera ${slot} should see a cleaner rectangle with less angle and perspective distortion.`,
    });
  }
  if (detailText.includes("candidate count: 0") || detailText.includes("below threshold")) {
    items.push({
      label: "Retry calibration",
      reason: `Camera ${slot} needs a cleaner chart frame before calibration can lock.`,
    });
  }
  items.push({
    label: "Reduce glare",
    reason: `Keep reflections off the white patches so the detector and patch sampling stay reliable.`,
  });
  return items.slice(0, 4);
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
  aggregateVariance: {
    luma_variance: number;
    red_variance: number;
    green_variance: number;
    blue_variance: number;
    highlight_variance: number;
    midtone_variance: number;
  },
  frameCount: number,
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
    confidence: computeConfidence(aggregateVariance, frameCount),
    warning: computeVarianceWarning(aggregateVariance, frameCount),
  };
}

function computeConfidence(
  aggregateVariance: {
    luma_variance: number;
    red_variance: number;
    green_variance: number;
    blue_variance: number;
    highlight_variance: number;
    midtone_variance: number;
  },
  frameCount: number,
): "High" | "Medium" | "Low" {
  if (frameCount < 5) return "Low";
  const varianceScore = aggregateVariance.luma_variance
    + aggregateVariance.highlight_variance
    + aggregateVariance.midtone_variance
    + ((aggregateVariance.red_variance + aggregateVariance.green_variance + aggregateVariance.blue_variance) / 3);
  if (varianceScore <= 0.002) return "High";
  if (varianceScore <= 0.008) return "Medium";
  return "Low";
}

function computeVarianceWarning(
  aggregateVariance: {
    luma_variance: number;
    red_variance: number;
    green_variance: number;
    blue_variance: number;
    highlight_variance: number;
    midtone_variance: number;
  },
  frameCount: number,
) {
  if (frameCount < 5) {
    return "Partial sample. Add a full 5-frame clip for stronger matching confidence.";
  }
  const varianceScore = aggregateVariance.luma_variance
    + aggregateVariance.highlight_variance
    + aggregateVariance.midtone_variance;
  if (varianceScore > 0.008) {
    return "Lighting changed across frames — capture a new reference clip.";
  }
  return null;
}

async function buildSignalPreviewData(dataUrl: string): Promise<SignalPreviewData> {
  if (!dataUrl) {
    throw new Error("signal preview unavailable");
  }
  const image = await loadImage(dataUrl);
  const width = 160;
  const height = 90;
  const waveformBins = 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("signal preview unavailable");
  }
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const waveformDensity = createDensityGrid(width, waveformBins);
  const redDensity = createDensityGrid(width, waveformBins);
  const greenDensity = createDensityGrid(width, waveformBins);
  const blueDensity = createDensityGrid(width, waveformBins);
  const waveformLine: number[] = new Array(width).fill(0);
  const lumaValues: number[] = [];
  let clippedCount = 0;
  let nearClipCount = 0;
  let skinCount = 0;
  let midsCount = 0;
  let shadowCount = 0;
  let crushedCount = 0;

  const falseColorCanvas = document.createElement("canvas");
  falseColorCanvas.width = width;
  falseColorCanvas.height = height;
  const falseColorCtx = falseColorCanvas.getContext("2d", { willReadFrequently: true });
  if (!falseColorCtx) {
    throw new Error("false color unavailable");
  }
  const falseColorImage = falseColorCtx.createImageData(width, height);

  for (let x = 0; x < width; x += 1) {
    let lumaSum = 0;
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index] / 255;
      const g = pixels[index + 1] / 255;
      const b = pixels[index + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lumaBin = waveformBins - 1 - Math.round(clamp(luma, 0, 1) * (waveformBins - 1));
      const redBin = waveformBins - 1 - Math.round(clamp(r, 0, 1) * (waveformBins - 1));
      const greenBin = waveformBins - 1 - Math.round(clamp(g, 0, 1) * (waveformBins - 1));
      const blueBin = waveformBins - 1 - Math.round(clamp(b, 0, 1) * (waveformBins - 1));
      waveformDensity[x][lumaBin] += 1;
      redDensity[x][redBin] += 1;
      greenDensity[x][greenBin] += 1;
      blueDensity[x][blueBin] += 1;
      lumaSum += luma;
      lumaValues.push(luma);

      if (luma >= 0.97) clippedCount += 1;
      else if (luma >= 0.88) nearClipCount += 1;
      else if (luma >= 0.46 && luma <= 0.63) skinCount += 1;
      else if (luma >= 0.28 && luma < 0.46) midsCount += 1;
      else if (luma <= 0.12) shadowCount += 1;
      if (luma <= 0.04) crushedCount += 1;

      const falseColor = falseColorRgb(luma);
      falseColorImage.data[index] = falseColor[0];
      falseColorImage.data[index + 1] = falseColor[1];
      falseColorImage.data[index + 2] = falseColor[2];
      falseColorImage.data[index + 3] = 255;
    }
    waveformLine[x] = lumaSum / height;
  }

  falseColorCtx.putImageData(falseColorImage, 0, 0);
  const sortedLuma = [...lumaValues].sort((a, b) => a - b);
  const totalPixels = Math.max(1, width * height);

  return {
    waveform_line: waveformLine,
    waveform_density: normalizeDensityGrid(waveformDensity),
    rgb_scope_density: {
      red: normalizeDensityGrid(redDensity),
      green: normalizeDensityGrid(greenDensity),
      blue: normalizeDensityGrid(blueDensity),
    },
    false_color_data_url: falseColorCanvas.toDataURL("image/jpeg", 0.88),
    summary: {
      min_luma: sortedLuma[0] ?? 0,
      max_luma: sortedLuma[sortedLuma.length - 1] ?? 0,
      median_luma: sortedLuma[Math.floor(sortedLuma.length / 2)] ?? 0,
    },
    zones: {
      clipped: clippedCount / totalPixels,
      near_clip: nearClipCount / totalPixels,
      skin: skinCount / totalPixels,
      mids: midsCount / totalPixels,
      shadows: shadowCount / totalPixels,
      crushed: crushedCount / totalPixels,
    },
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to load image"));
    image.src = src;
  });
}

function createDensityGrid(columns: number, rows: number) {
  return Array.from({ length: columns }, () => new Array(rows).fill(0));
}

function normalizeDensityGrid(grid: number[][]) {
  let max = 0;
  grid.forEach((column) => {
    column.forEach((value) => {
      if (value > max) max = value;
    });
  });
  if (max === 0) return grid;
  return grid.map((column) => column.map((value) => value / max));
}

function falseColorRgb(luma: number): [number, number, number] {
  if (luma >= 0.97) return [255, 64, 64];
  if (luma >= 0.88) return [255, 149, 0];
  if (luma >= 0.62) return [255, 214, 10];
  if (luma >= 0.46) return [235, 78, 155];
  if (luma >= 0.28) return [72, 187, 120];
  if (luma >= 0.12) return [32, 156, 238];
  if (luma >= 0.04) return [88, 92, 246];
  return [36, 28, 72];
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

function PreviewModeButton({
  icon,
  active,
  onClick,
  label,
  disabled,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn btn-sm ${active ? "btn-secondary" : "btn-ghost"}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={previewIconButtonStyle}
    >
      {icon}
    </button>
  );
}

function WaveformPreview({ data }: { data?: SignalPreviewData }) {
  if (!data) {
    return (
      <div style={waveformEmptyStyle}>
        Waveform unavailable
      </div>
    );
  }
  const points = data.waveform_line.map((value, index) => {
    const x = (index / Math.max(data.waveform_line.length - 1, 1)) * 100;
    const y = 100 - clamp(value, 0, 1) * 100;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={waveformSvgStyle}>
      <rect x="0" y="0" width="100" height="100" fill="rgba(7,9,12,0.96)" />
      {[20, 40, 60, 80].map((y) => (
        <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" strokeDasharray="2 2" />
      ))}
      <DensityGridOverlay density={data.waveform_density} color="rgba(110,231,183," />
      <polyline fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="0.55" points={points} />
    </svg>
  );
}

function ScopePreview({ data }: { data?: SignalPreviewData }) {
  if (!data) {
    return <div style={waveformEmptyStyle}>Scope unavailable</div>;
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={waveformSvgStyle}>
      <rect x="0" y="0" width="100" height="100" fill="rgba(7,9,12,0.96)" />
      {[20, 40, 60, 80].map((y) => (
        <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="2 2" />
      ))}
      <g>
        <rect x="0" y="0" width="33.333" height="100" fill="rgba(255,255,255,0.015)" />
        <rect x="33.333" y="0" width="33.333" height="100" fill="rgba(255,255,255,0.02)" />
        <rect x="66.666" y="0" width="33.334" height="100" fill="rgba(255,255,255,0.015)" />
      </g>
      <DensityGridOverlay density={data.rgb_scope_density.red} color="rgba(248,113,113," xOffset={0} widthScale={1 / 3} />
      <DensityGridOverlay density={data.rgb_scope_density.green} color="rgba(74,222,128," xOffset={1 / 3} widthScale={1 / 3} />
      <DensityGridOverlay density={data.rgb_scope_density.blue} color="rgba(96,165,250," xOffset={2 / 3} widthScale={1 / 3} />
    </svg>
  );
}

function DensityGridOverlay({
  density,
  color,
  xOffset = 0,
  widthScale = 1,
}: {
  density: number[][];
  color: string;
  xOffset?: number;
  widthScale?: number;
}) {
  const columns = density.length;
  const rows = density[0]?.length ?? 0;
  if (!columns || !rows) return null;
  return (
    <>
      {density.map((column, xIndex) => (
        column.map((value, yIndex) => (
          value > 0.06 ? (
            <rect
              key={`${xOffset}-${xIndex}-${yIndex}`}
              x={xOffset * 100 + (xIndex / columns) * 100 * widthScale}
              y={(yIndex / rows) * 100}
              width={(100 * widthScale) / columns + 0.2}
              height={100 / rows + 0.2}
              fill={`${color}${Math.min(0.92, value + 0.08)})`}
            />
          ) : null
        ))
      ))}
    </>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={legendChipStyle}>
      <span style={{ ...legendSwatchStyle, background: color }} />
      {label}
    </span>
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

function CalibrationOverlay({ calibration }: { calibration: CalibrationChartDetection }) {
  const polygon = calibration.chart_corners
    .map((corner) => `${corner.x * 100},${corner.y * 100}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={calibrationOverlaySvgStyle}>
      <polygon points={polygon} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="0.45" />
      {calibration.patch_samples.map((patch) => (
        <circle
          key={patch.patch_index}
          cx={patch.center_x * 100}
          cy={patch.center_y * 100}
          r="0.9"
          fill={deltaEColor(patch.delta_e)}
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="0.22"
        />
      ))}
    </svg>
  );
}

function PatchDeltaSwatch({ patch }: { patch: CalibrationChartDetection["patch_samples"][number] }) {
  return (
    <div style={patchSwatchStyle}>
      <div style={{ ...patchColorStyle, background: rgbCss(patch.reference_rgb) }} />
      <div style={{ ...patchColorStyle, background: rgbCss(patch.measured_rgb_mean) }} />
      <div style={{ ...patchDeltaStyle, color: deltaEColor(patch.delta_e) }}>{patch.delta_e.toFixed(1)}</div>
    </div>
  );
}

function buildCalibrationDisplay(
  calibration: CalibrationChartDetection,
  heroCalibration: CalibrationChartDetection | undefined,
  isHero: boolean,
) {
  if (isHero || !heroCalibration) {
    return {
      exposure: "Baseline",
      whiteBalance: "Baseline",
      tint: "Baseline",
    };
  }
  const exposure = clamp(calibration.exposure_offset_stops - heroCalibration.exposure_offset_stops, -2, 2);
  const wbShift = calibration.wb_kelvin_shift - heroCalibration.wb_kelvin_shift;
  const tintShift = calibration.tint_shift - heroCalibration.tint_shift;
  return {
    exposure: formatExposureShift(exposure),
    whiteBalance: formatKelvinShift(wbShift),
    tint: formatTintDelta(tintShift),
  };
}

function buildDecisionSummary({
  slot,
  heroSlot,
  clipPath,
  analysis,
  rawAnalysis,
  calibration,
  signalPreview,
}: {
  slot: string;
  heroSlot: string;
  clipPath: string;
  analysis: CameraMatchAnalysis;
  rawAnalysis: CameraMatchAnalysisResult;
  calibration?: CalibrationChartDetection;
  signalPreview?: SignalPreviewData;
}): { items: DecisionItem[]; action: DecisionAction | null } {
  const items: DecisionItem[] = [];
  if (isProxyOnlyRawClip(clipPath) && rawAnalysis.source_kind !== "proxy") {
    items.push({
      id: `proxy-${slot}`,
      tone: "critical",
      label: "Apply proxy before trusting this slot",
      reason: `${getProxyOnlyFormatBadge(clipPath)} still requires a proxy-backed analysis path.`,
    });
    return { items, action: { kind: "proxy", label: "Apply Proxy" } };
  }

  if (signalPreview) {
    if (signalPreview.zones.clipped > 0.01 || signalPreview.zones.near_clip > 0.06) {
      items.push({
        id: `clip-${slot}`,
        tone: "critical",
        label: `Protect highlights on Camera ${slot}`,
        reason: `False color and waveform show ${formatZonePercent(signalPreview.zones.clipped + signalPreview.zones.near_clip)} of the frame crowding the clipping range.`,
      });
    }
    if (signalPreview.zones.shadows > 0.18 || signalPreview.zones.crushed > 0.04) {
      items.push({
        id: `shadow-${slot}`,
        tone: "warning",
        label: `Lift shadows slightly on Camera ${slot}`,
        reason: `Shadow and crushed-black zones are heavy enough to compromise matchability.`,
      });
    }
    if (signalPreview.zones.skin > 0.16 && analysis.delta_vs_hero && Math.abs(analysis.delta_vs_hero.luma_median) > 0.03) {
      items.push({
        id: `skin-${slot}`,
        tone: "warning",
        label: analysis.delta_vs_hero.luma_median > 0 ? `Skin too high on Camera ${slot}` : `Skin too low on Camera ${slot}`,
        reason: "False color shows a healthy skin band, but the camera is drifting from the hero exposure.",
      });
    }
  }

  if (calibration?.chart_detected && calibration.transform_quality_flag) {
    items.push({
      id: `trust-${slot}`,
      tone: "warning",
      label: `Do not trust Camera ${slot} LUT yet`,
      reason: calibration.transform_quality_flag,
    });
  } else if (!calibration?.chart_detected) {
    items.push({
      id: `signal-${slot}`,
      tone: "info",
      label: `Use signal match only for Camera ${slot}`,
      reason: "Chart calibration is unavailable, so the current match relies on waveform, false color, RGB balance, and hero deltas only.",
    });
  }

  if (slot !== heroSlot && analysis.suggestions?.exposure && analysis.suggestions.exposure !== "Hold") {
    items.push({
      id: `exp-${slot}`,
      tone: "info",
      label: `Expose Camera ${slot} ${analysis.suggestions.exposure.toLowerCase()}`,
      reason: `Measured luma delta vs Hero ${heroSlot} supports this stop correction.`,
    });
  }
  if (slot !== heroSlot && analysis.suggestions?.white_balance && !analysis.suggestions.white_balance.toLowerCase().includes("hold")) {
    items.push({
      id: `wb-${slot}`,
      tone: "info",
      label: `${analysis.suggestions.white_balance.replace(" • ", "  ")}`,
      reason: "RGB median balance indicates a white-balance and tint trim toward the hero.",
    });
  }

  if (slot !== heroSlot && analysis.delta_vs_hero && Math.abs(analysis.delta_vs_hero.luma_median) <= 0.015 && Math.abs(analysis.delta_vs_hero.red_median) <= 0.025 && Math.abs(analysis.delta_vs_hero.blue_median) <= 0.025) {
    items.push({
      id: `close-${slot}`,
      tone: "good",
      label: `Camera ${slot} is close to Hero ${heroSlot}`,
      reason: "The measured exposure and color deltas are already within a tight matching window.",
    });
  }

  const ordered = items.slice(0, 4);
  let action: DecisionAction | null = null;
  if (isProxyOnlyRawClip(clipPath) && rawAnalysis.source_kind !== "proxy") {
    action = { kind: "proxy", label: "Apply Proxy" };
  } else if (!calibration?.chart_detected && rawAnalysis.representative_frame_path) {
    action = { kind: "recalibrate", label: "Retry Calibration" };
  } else if (calibration?.chart_detected && calibration.lut_path && slot !== heroSlot) {
    action = { kind: "lut", label: "Proceed to LUT Export" };
  } else if (!calibration?.chart_detected) {
    action = { kind: "signal", label: "Proceed with Signal Match" };
  } else {
    action = { kind: "export", label: "Export Results" };
  }

  return { items: ordered, action };
}

function buildMatchActionChips(
  analysis: CameraMatchAnalysis,
  rawAnalysis: CameraMatchAnalysisResult,
  correctionDisplay: ReturnType<typeof buildCalibrationDisplay> | null,
  signalPreview?: SignalPreviewData,
): MatchActionChip[] {
  const bundle = rawAnalysis.measurement_bundle;
  const wbValue = correctionDisplay?.whiteBalance && correctionDisplay.whiteBalance !== "Baseline"
    ? correctionDisplay.whiteBalance
    : deriveWhiteBalanceAction(rawAnalysis, analysis);
  const tintValue = correctionDisplay?.tint && correctionDisplay.tint !== "Baseline"
    ? correctionDisplay.tint
    : deriveTintAction(rawAnalysis, analysis);
  const expValue = correctionDisplay?.exposure && correctionDisplay.exposure !== "Baseline"
    ? compactExposureValue(correctionDisplay.exposure)
    : deriveExposureAction(rawAnalysis, analysis, signalPreview);
  const hlValue = (bundle.false_color_summary.clipped > 0.01 || bundle.false_color_summary.near_clip > 0.06 || bundle.waveform_summary.top_band_density > 0.14)
    ? "Protect"
    : "OK";
  const midValue = getMidAction(rawAnalysis, analysis, signalPreview);

  return [
    {
      key: "wb",
      label: "WB",
      value: wbValue,
      reason: wbValue === "OK" ? "White balance is already close to the hero." : "RGB balance and metadata support a warm/cool trim toward the hero.",
    },
    {
      key: "exp",
      label: "EXP",
      value: expValue,
      reason: expValue === "OK" ? "Exposure is already within the hero tolerance band." : "Waveform median, highlight density, and hero-relative luma indicate this exposure trim.",
    },
    {
      key: "tint",
      label: "TINT",
      value: tintValue,
      reason: tintValue === "OK" ? "Green/magenta balance is already controlled." : "RGB balance and neutral bias indicate a green/magenta trim toward the hero.",
    },
    {
      key: "hl",
      label: "HL",
      value: hlValue,
      reason: hlValue === "OK" ? "Highlight shape is currently safe against the hero." : "False color and highlight percentage show the top end getting too hot.",
    },
    {
      key: "mid",
      label: "MID",
      value: midValue,
      reason: midValue === "OK" ? "Midtone density is close to the hero." : "Midtone density and skin placement are drifting from the hero.",
    },
  ];
}

function classifyMatchSeverity(
  analysis: CameraMatchAnalysis,
  signalPreview?: SignalPreviewData,
  calibration?: CalibrationChartDetection,
): "Close" | "Moderate" | "Major" {
  const delta = analysis.delta_vs_hero;
  if (!delta) return "Close";
  const exposureMagnitude = Math.abs(delta.luma_median);
  const colorMagnitude = Math.max(Math.abs(delta.red_median), Math.abs(delta.green_median), Math.abs(delta.blue_median));
  const clipPressure = (signalPreview?.zones.clipped ?? 0) + (signalPreview?.zones.near_clip ?? 0);
  if (clipPressure > 0.08 || exposureMagnitude > 0.05 || colorMagnitude > 0.08 || calibration?.calibration_quality_level === "Poor") {
    return "Major";
  }
  if (clipPressure > 0.03 || exposureMagnitude > 0.02 || colorMagnitude > 0.035 || analysis.suggestions?.confidence === "Low") {
    return "Moderate";
  }
  return "Close";
}

function buildMatchStatusText(slot: string, heroSlot: string, severity: "Close" | "Moderate" | "Major") {
  if (severity === "Close") return `${slot} Close to Hero ${heroSlot}`;
  if (severity === "Moderate") return `${slot} Needs adjustment`;
  return `${slot} Major correction needed`;
}

function getFileName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function isBrawClip(path: string) {
  return path.toLowerCase().endsWith(".braw");
}

function isNrawClip(path: string) {
  return path.toLowerCase().endsWith(".nev");
}

function isR3dClip(path: string) {
  return path.toLowerCase().endsWith(".r3d");
}

function isProxyOnlyRawClip(path: string) {
  return isNrawClip(path) || isR3dClip(path);
}

function getProxyOnlyFormatBadge(path: string) {
  if (isNrawClip(path)) return "N-RAW";
  if (isR3dClip(path)) return "R3D";
  return "RAW";
}

function formatSourceKindLabel(analysis: CameraMatchAnalysisResult) {
  const kind = analysis.original_format_kind || "";
  if (kind === "NIKON_NRAW") return "N-RAW";
  if (kind === "RED_R3D") return "R3D";
  if (kind === "BLACKMAGIC_BRAW") return "BRAW";
  if (kind) return kind.replace(/_/g, " ");
  return "Video";
}

function formatAnalysisSourceLabel(analysis: CameraMatchAnalysisResult) {
  if (analysis.source_kind === "proxy") return "Proxy";
  if (analysis.source_kind === "original") return "Original";
  if (analysis.source_kind) return analysis.source_kind;
  return "Original";
}

function formatZonePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMeasurementBundleLine(bundle: CameraMatchAnalysisResult["measurement_bundle"]) {
  const parts = [
    formatSourceKindFromBundle(bundle),
    bundle.analysis_source_kind === "proxy" ? "proxy" : null,
    bundle.resolution,
    bundle.fps ? `${roundTo(bundle.fps, 0.01)} fps` : null,
    bundle.iso_metadata ? `ISO ${bundle.iso_metadata}` : null,
    bundle.wb_metadata ? `WB ${bundle.wb_metadata}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatSourceKindFromBundle(bundle: CameraMatchAnalysisResult["measurement_bundle"]) {
  const kind = bundle.original_format_kind || "";
  if (kind === "NIKON_NRAW") return "N-RAW";
  if (kind === "RED_R3D") return "R3D";
  if (kind === "BLACKMAGIC_RAW") return "BRAW";
  if (kind) return kind.replace(/_/g, " ");
  return bundle.codec_name || "Video";
}

function extractWhiteBalanceAction(value?: string | null) {
  if (!value) return "OK";
  const match = value.match(/([+-]?\d+K)/);
  return match?.[1] ?? "OK";
}

function extractTintAction(value?: string | null) {
  if (!value) return "OK";
  const match = value.match(/Tint\s+([+-]?\d+[GM])/i);
  return match?.[1]?.toUpperCase() ?? "OK";
}

function compactExposureValue(value?: string | null) {
  if (!value || value === "Hold" || value === "Baseline") return "OK";
  const match = value.match(/([+-]?\d+(?:\.\d+)?)/);
  return match?.[1] ?? value;
}

function getMidAction(rawAnalysis: CameraMatchAnalysisResult, analysis: CameraMatchAnalysis, signalPreview?: SignalPreviewData) {
  const midDelta = analysis.delta_vs_hero?.midtone_density ?? 0;
  const shadowWeight = signalPreview ? signalPreview.zones.shadows + signalPreview.zones.crushed : rawAnalysis.measurement_bundle.shadow_percentage;
  const bundleMid = rawAnalysis.measurement_bundle.midtone_percentage;
  if (midDelta < -0.025 || shadowWeight > 0.2 || bundleMid < 0.22) return "Raise";
  if (midDelta > 0.025) return "Lower";
  return "OK";
}

function deriveWhiteBalanceAction(rawAnalysis: CameraMatchAnalysisResult, analysis: CameraMatchAnalysis) {
  const bundle = rawAnalysis.measurement_bundle;
  const calibrationKelvin = analysis.suggestions?.white_balance ? extractWhiteBalanceAction(analysis.suggestions.white_balance) : "OK";
  if (calibrationKelvin !== "OK") return calibrationKelvin;
  const drift = bundle.rgb_balance_summary.blue_vs_green - bundle.rgb_balance_summary.red_vs_green;
  if (drift > 0.03) return "+200K";
  if (drift < -0.03) return "-200K";
  return "OK";
}

function deriveTintAction(rawAnalysis: CameraMatchAnalysisResult, analysis: CameraMatchAnalysis) {
  const suggestionTint = analysis.suggestions?.white_balance ? extractTintAction(analysis.suggestions.white_balance) : "OK";
  if (suggestionTint !== "OK") return suggestionTint;
  const hint = rawAnalysis.measurement_bundle.rgb_balance_summary.green_magenta_hint;
  if (hint === "Green") return "-2M";
  if (hint === "Magenta") return "+2G";
  return "OK";
}

function deriveExposureAction(rawAnalysis: CameraMatchAnalysisResult, analysis: CameraMatchAnalysis, signalPreview?: SignalPreviewData) {
  const suggestion = compactExposureValue(analysis.suggestions?.exposure);
  if (suggestion !== "OK") return suggestion;
  const median = signalPreview?.summary.median_luma ?? rawAnalysis.measurement_bundle.waveform_summary.median_luma;
  if (median < 0.36) return "+0.2";
  if (median > 0.62 || rawAnalysis.measurement_bundle.highlight_percentage > 0.035) return "-0.2";
  return "OK";
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

function formatExposureShift(value: number) {
  if (Math.abs(value) < 0.05) return "Hold";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} stop`;
}

function formatTintDelta(value: number) {
  if (value === 0) return "Tint hold";
  if (value > 0) return `+${value}G`;
  return `${value}M`;
}

function formatImprovement(before: number, after?: number | null) {
  if (after == null || before <= 0 || after >= before) return "—";
  return `${Math.round(((before - after) / before) * 100)}%`;
}

function compactWarningLabel(warning: string) {
  if (warning.startsWith("Chart too small")) return "Chart too small";
  if (warning.startsWith("Chart angle")) return "Too much skew";
  if (warning.startsWith("Highlights clipped")) return "Highlights clipped";
  if (warning.startsWith("Shadows crushed")) return "Shadows crushed";
  if (warning.startsWith("Uneven lighting")) return "Uneven light";
  if (warning.startsWith("Calibration produced weak")) return "Weak improvement";
  if (warning.startsWith("Calibration made the match worse")) return "Match worse";
  return warning;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbCss(rgb: [number, number, number]) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function deltaEColor(delta: number) {
  if (delta <= 4) return "rgba(34,197,94,0.9)";
  if (delta <= 9) return "rgba(245,158,11,0.9)";
  return "rgba(239,68,68,0.9)";
}

function qualityLevelStyle(level: string): React.CSSProperties {
  if (level === "Good") return { color: "rgba(110,231,183,0.98)", borderColor: "rgba(34,197,94,0.32)" };
  if (level === "Caution") return { color: "rgba(251,191,36,0.96)", borderColor: "rgba(245,158,11,0.28)" };
  return { color: "rgba(248,113,113,0.96)", borderColor: "rgba(239,68,68,0.3)" };
}

function qualityLevelFillStyle(level: string): React.CSSProperties {
  if (level === "Good") return { background: "linear-gradient(90deg, rgba(22,163,74,0.9), rgba(74,222,128,0.88))" };
  if (level === "Caution") return { background: "linear-gradient(90deg, rgba(217,119,6,0.92), rgba(251,191,36,0.88))" };
  return { background: "linear-gradient(90deg, rgba(220,38,38,0.92), rgba(248,113,113,0.88))" };
}

function matchActionSeverityTone(tone: MatchActionCard["tone"]): React.CSSProperties {
  if (tone === "critical") return { color: "rgba(248,113,113,0.96)", borderColor: "rgba(239,68,68,0.28)" };
  if (tone === "warning") return { color: "rgba(251,191,36,0.96)", borderColor: "rgba(245,158,11,0.24)" };
  if (tone === "good") return { color: "rgba(110,231,183,0.98)", borderColor: "rgba(34,197,94,0.24)" };
  return { color: "rgba(147,197,253,0.96)", borderColor: "rgba(59,130,246,0.24)" };
}

function guidanceToneDotColor(tone: DecisionItem["tone"] | MatchActionCard["tone"]): React.CSSProperties {
  if (tone === "critical") return { background: "var(--status-orange)" };
  if (tone === "warning") return { background: "var(--text-muted)" };
  if (tone === "good") return { background: "var(--status-green)" };
  return { background: "var(--color-accent)" };
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
const headerTitleRowStyle: React.CSSProperties = { display: "grid", gap: 4, minWidth: 0 };
const headerTitleStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "1.28rem", fontWeight: 700, letterSpacing: "0.01em" };
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
const errorSupportTextStyle: React.CSSProperties = { marginTop: 6, color: "rgba(254,202,202,0.88)", fontSize: "0.78rem" };
const errorActionsStyle: React.CSSProperties = { marginTop: 10 };
const recoveryActionRowStyle: React.CSSProperties = { marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 };
const recoveryActionChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.08)", color: "var(--text-primary)", fontSize: "0.7rem", fontWeight: 700, whiteSpace: "nowrap" };
const errorDetailsStyle: React.CSSProperties = { marginTop: 10 };
const errorDetailsSummaryStyle: React.CSSProperties = { cursor: "pointer", color: "#fecaca", fontSize: "0.8rem", fontWeight: 700 };
const errorDetailsBodyStyle: React.CSSProperties = { margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.76rem", lineHeight: 1.45, color: "#fca5a5" };
const gridStyle: React.CSSProperties = { minWidth: 0 };
const cameraColumnStyle: React.CSSProperties = { minWidth: 0 };
const cameraCardStyle: React.CSSProperties = { padding: 16, borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)", minWidth: 0 };
const slotHeaderRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 };
const slotBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" };
const heroChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: "var(--text-primary)", fontSize: "0.72rem", fontWeight: 700 };
const cameraActionsWrapStyle: React.CSSProperties = { display: "grid", gap: 8, marginBottom: 12, minWidth: 0 };
const cameraActionsTopRowStyle: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", minHeight: 34, minWidth: 0 };
const cameraActionsSupportRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", minHeight: 34, minWidth: 0 };
const actionPlaceholderStyle: React.CSSProperties = { display: "inline-flex", minWidth: 92, height: 34, visibility: "hidden", flexShrink: 0 };
const supportRowPlaceholderStyle: React.CSSProperties = { display: "block", width: 1, height: 34, visibility: "hidden" };
const fileMetaStyle: React.CSSProperties = { fontSize: "0.94rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const helperMetaStyle: React.CSSProperties = { color: "var(--text-muted)", lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const sourceMetaRowStyle: React.CSSProperties = { marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const sourceBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: "var(--text-primary)", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em" };
const sourceMetaTextStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.74rem", fontWeight: 700 };
const sourceMetaInlineStyle: React.CSSProperties = { marginTop: 8, color: "var(--text-secondary)", fontSize: "0.74rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const statusMetaStyle: React.CSSProperties = { marginTop: 10, fontSize: "0.78rem", color: "#93c5fd" };
const analysisCardStyle: React.CSSProperties = { padding: 14, borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(9,10,13,0.78)", minHeight: 420, display: "flex", flexDirection: "column", minWidth: 0 };
const frameWrapStyle: React.CSSProperties = { position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#080a0c", aspectRatio: "16 / 9", marginBottom: 12 };
const frameImageStyle: React.CSSProperties = { width: "100%", height: "100%", display: "block", objectFit: "cover" };
const frameOverlayStyle: React.CSSProperties = { position: "absolute", left: 10, right: 10, bottom: 10, height: 88, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" };
const frameExpandButtonStyle: React.CSSProperties = { position: "absolute", top: 10, right: 10, minWidth: 36, minHeight: 36, borderRadius: 10, background: "rgba(5,8,12,0.58)" };
const waveformSvgStyle: React.CSSProperties = { width: "100%", height: "100%", display: "block" };
const waveformEmptyStyle: React.CSSProperties = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.78rem", background: "rgba(7,9,12,0.96)" };
const calibrationOverlaySvgStyle: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" };
const calibrationStripStyle: React.CSSProperties = { display: "grid", gap: 8, marginBottom: 10 };
const signalOnlyStripStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 };
const signalOnlyChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.04em" };
const signalOnlyTextStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.74rem", fontWeight: 700 };
const calibrationHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 };
const calibrationHeaderMetaStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" };
const qualitySummaryStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.74rem", fontWeight: 700 };
const qualityLevelChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.04em", background: "rgba(255,255,255,0.03)" };
const qualityBandStyle: React.CSSProperties = { width: "100%", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" };
const qualityFillStyle: React.CSSProperties = { height: "100%", borderRadius: 999 };
const warningBadgeRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const warningBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "5px 8px", borderRadius: 999, border: "1px solid rgba(245,158,11,0.18)", background: "rgba(245,158,11,0.08)", color: "rgba(251,191,36,0.94)", fontSize: "0.68rem", fontWeight: 700, whiteSpace: "nowrap" };
const patchGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6 };
const patchSwatchStyle: React.CSSProperties = { display: "grid", gap: 4, padding: 6, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" };
const patchColorStyle: React.CSSProperties = { width: "100%", height: 12, borderRadius: 6 };
const patchDeltaStyle: React.CSSProperties = { fontSize: "0.68rem", color: "var(--text-secondary)", textAlign: "center", fontWeight: 700 };
const previewToggleRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" };
const previewIconGroupStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
const previewIconButtonStyle: React.CSSProperties = { minWidth: 34, minHeight: 34, padding: 0, borderRadius: 10 };
const previewToggleDividerStyle: React.CSSProperties = { width: 1, height: 18, background: "rgba(255,255,255,0.08)", margin: "0 2px" };
const previewToggleLabelStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.74rem", fontWeight: 700, marginLeft: "auto" };
const fullscreenCardStyle: React.CSSProperties = { width: "min(1180px, 100%)", padding: 20, borderRadius: 22, border: "1px solid rgba(255,255,255,0.08)", background: "#090b0e", boxShadow: "0 24px 60px rgba(0,0,0,0.45)", display: "grid", gap: 16 };
const fullscreenHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 };
const fullscreenFrameWrapStyle: React.CSSProperties = { position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#07090c" };
const cropControlsStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
const cropSliderStyle: React.CSSProperties = { flex: "1 1 220px" };
const cropViewportStyle: React.CSSProperties = { position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "#07090c", backgroundRepeat: "no-repeat", cursor: "grab" };
const cropViewportMaskStyle: React.CSSProperties = { position: "absolute", inset: 0, boxShadow: "inset 0 0 0 9999px rgba(5,8,12,0.26)", pointerEvents: "none" };
const cropViewportBoxStyle: React.CSSProperties = { position: "absolute", inset: 0, border: "2px solid rgba(255,255,255,0.78)", borderRadius: 14, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)", pointerEvents: "none" };
const inlineWarningStyle: React.CSSProperties = { marginBottom: 10, color: "rgba(251,191,36,0.94)", fontSize: "0.78rem" };
const metricsWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 };
const falseColorLegendStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 };
const legendChipStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", color: "var(--text-secondary)", fontSize: "0.68rem", fontWeight: 700 };
const legendSwatchStyle: React.CSSProperties = { width: 8, height: 8, borderRadius: 999, flexShrink: 0 };
const decisionSummaryStyle: React.CSSProperties = { display: "grid", gap: 8, marginBottom: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" };
const decisionSummaryHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 };
const decisionSummaryMetaStyle: React.CSSProperties = { color: "var(--text-muted)", fontSize: "0.72rem", fontWeight: 700 };
const decisionListStyle: React.CSSProperties = { display: "grid", gap: 6 };
const decisionRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "8px minmax(0, 1fr) auto", alignItems: "center", gap: 8, minWidth: 0 };
const decisionLabelStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "0.8rem", fontWeight: 700, minWidth: 0 };
const decisionActionRowStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-start" };
const deltaRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 };
const chipStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)", flex: "1 1 120px", minWidth: 0 };
const deltaChipStyle: React.CSSProperties = { ...chipStyle, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)" };
const suggestionChipStyle: React.CSSProperties = { ...chipStyle, background: "rgba(255,255,255,0.035)" };
const chipLabelStyle: React.CSSProperties = { fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 5 };
const chipValueStyle: React.CSSProperties = { fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)" };
const detailsWrapStyle: React.CSSProperties = { marginTop: 4 };
const detailsSummaryStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", listStyle: "none", color: "var(--text-secondary)", fontSize: "0.84rem", fontWeight: 700 };
const detailsMetaLineStyle: React.CSSProperties = { marginTop: 10, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 };
const detailsMetaValueStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, textAlign: "right" };
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
const guidanceSectionStyle: React.CSSProperties = { marginTop: 16, display: "grid", gap: 10, padding: 14, borderRadius: 18, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.022)" };
const guidanceHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const guidanceTitleStyle: React.CSSProperties = { fontSize: "0.76rem", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800, color: "var(--text-muted)" };
const matchActionsSubtitleStyle: React.CSSProperties = { marginTop: 4, color: "var(--text-secondary)", fontSize: "0.82rem", fontWeight: 600 };
const matchActionsGridStyle: React.CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const matchActionCardStyle: React.CSSProperties = { display: "grid", gap: 10, padding: "12px 12px 10px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" };
const matchActionCardHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 };
const matchActionCardTopStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
const matchActionCardTitleStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "0.86rem", fontWeight: 800 };
const matchActionSeverityStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.04em" };
const matchActionStatusStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "0.78rem", fontWeight: 700 };
const matchActionChipGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 };
const matchActionChipStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 8, minWidth: 0, padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" };
const matchActionChipLabelStyle: React.CSSProperties = { color: "var(--text-muted)", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em" };
const matchActionChipValueStyle: React.CSSProperties = { color: "var(--text-primary)", fontSize: "0.82rem", fontWeight: 800, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const matchActionEmptyStyle: React.CSSProperties = { padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", color: "var(--text-secondary)", fontSize: "0.82rem", fontWeight: 700 };
const guidanceToneDotStyle: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, flexShrink: 0 };
const guidanceHelpStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", color: "var(--text-muted)", cursor: "help", flexShrink: 0 };
const guidanceActionRowStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", marginTop: 2 };
const exportMenuStyle: React.CSSProperties = { position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 244, padding: 8, borderRadius: 12, background: "#0c0d0f", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 40px rgba(0,0,0,0.4)", zIndex: 30, display: "grid", gap: 6 };
const exportItemStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap" };
