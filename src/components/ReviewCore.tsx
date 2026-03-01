import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import Hls from "hls.js";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Edit3,
  Film,
  FolderUp,
  Image,
  KeyRound,
  Layers3,
  Link2,
  LoaderCircle,
  MousePointer2,
  PenTool,
  PlayCircle,
  RectangleHorizontal,
  Save as SaveIcon,
  ShieldCheck,
  Trash2,
  Type,
} from "lucide-react";
import {
  ReviewCoreAnnotation,
  ReviewCoreApprovalState,
  ReviewCoreAsset,
  ReviewCoreAssetWithVersions,
  ReviewCoreAssetVersion,
  ReviewCoreComment,
  ReviewCoreDuplicateCandidate,
  ReviewCoreExtractFrameResult,
  ReviewCoreFrameNote,
  ReviewCoreProjectSummary,
  ReviewCoreShareLinkResolved,
  ReviewCoreShareLinkSummary,
  ReviewCoreShareUnlockResult,
  ReviewCoreSharedAssetSummary,
  ReviewCoreSharedVersionSummary,
  ReviewCoreThumbnailInfo,
} from "../types";

const REVIEW_CORE_DEBUG = import.meta.env.DEV;

interface ReviewCoreProps {
  projectId?: string | null;
  projectName?: string | null;
  shareToken?: string | null;
  restricted?: boolean;
  onError?: (error: { title: string; hint: string } | null) => void;
  onExitShare?: () => void;
}

type ApprovalStatus = "draft" | "in_review" | "approved" | "rejected";
type AnnotationTool = "pointer" | "pen" | "arrow" | "rect" | "circle" | "text";
type ReviewCorePanelTab = "feedback" | "share";
type NormalizedPoint = [number, number];
type CommonAsset = ReviewCoreAsset | ReviewCoreSharedAssetSummary;
type CommonVersion = ReviewCoreAssetVersion | ReviewCoreSharedVersionSummary;

interface ReviewerIdentity {
  name: string;
  initials: string;
  color: string;
}

interface AnnotationStyle {
  stroke: string;
  width: number;
}

interface ArrowItem {
  id: string;
  type: "arrow";
  a: NormalizedPoint;
  b: NormalizedPoint;
  style: AnnotationStyle;
}

interface RectItem {
  id: string;
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  style: AnnotationStyle;
}

interface CircleItem {
  id: string;
  type: "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  style: AnnotationStyle;
}

interface PenItem {
  id: string;
  type: "pen";
  points: NormalizedPoint[];
  style: AnnotationStyle;
}

interface TextItem {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  style: AnnotationStyle;
}

type AnnotationItem = ArrowItem | RectItem | CircleItem | PenItem | TextItem;

interface AnnotationVectorData {
  schemaVersion: 1;
  commentId: string;
  timestampMs: number;
  items: AnnotationItem[];
}

interface OverlayFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FrameNoteVectorData {
  schemaVersion: 1;
  timestampMs: number;
  items: AnnotationItem[];
}

interface FeedbackItem {
  id: string;
  source: "comment" | "frame_note";
  timestamp_ms: number;
  resolved: boolean;
  author_name: string;
  text: string;
  type_label: "Text" | "Draw";
  version_label: string;
  comment?: ReviewCoreComment;
  note?: ReviewCoreFrameNote;
}

const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  stroke: "#00d1ff",
  width: 2,
};
const FRAME_NOTE_COLOR_SWATCHES = ["#00d1ff", "#f97316", "#22c55e", "#eab308", "#ef4444", "#f8fafc"];

const DEFAULT_APPROVAL: ReviewCoreApprovalState = {
  asset_version_id: "",
  status: "draft",
  approved_at: null,
  approved_by: null,
};
const TIMECODE_FALLBACK_ASSET = { frame_rate: 24, avg_frame_rate: null, r_frame_rate: null, is_vfr: true } as const;

const REVIEW_CORE_LAST_PROJECT_STORAGE_KEY = "review_core:last_project_id";
const REVIEWER_PALETTE = ["#00a3a3", "#d97706", "#3b82f6", "#16a34a", "#dc2626", "#0891b2", "#ca8a04", "#64748b"];

export function ReviewCore({
  projectId,
  projectName,
  shareToken,
  restricted = false,
  onError,
  onExitShare,
}: ReviewCoreProps) {
  const isShareMode = Boolean(shareToken);
  const usesEmbeddedProjectPicker = !isShareMode && !projectId;

  const [assets, setAssets] = useState<CommonAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [versions, setVersions] = useState<CommonVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [serverBaseUrl, setServerBaseUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [thumbnails, setThumbnails] = useState<ReviewCoreThumbnailInfo[]>([]);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [pendingDuplicateFiles, setPendingDuplicateFiles] = useState<string[] | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<ReviewCoreDuplicateCandidate[]>([]);
  const [comments, setComments] = useState<ReviewCoreComment[]>([]);
  const [annotations, setAnnotations] = useState<ReviewCoreAnnotation[]>([]);
  const [approval, setApproval] = useState<ReviewCoreApprovalState>(DEFAULT_APPROVAL);
  const [approvalName, setApprovalName] = useState("Anonymous");
  const [savingApproval, setSavingApproval] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("Anonymous");
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [annotatingCommentId, setAnnotatingCommentId] = useState<string | null>(null);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("pointer");
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationVectorData | null>(null);
  const [annotationTextValue, setAnnotationTextValue] = useState("Note");
  const [selectedAnnotationItemId, setSelectedAnnotationItemId] = useState<string | null>(null);
  const [activeDraftItem, setActiveDraftItem] = useState<AnnotationItem | null>(null);
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [frameRect, setFrameRect] = useState<OverlayFrameRect>({ left: 0, top: 0, width: 0, height: 0 });
  const [annotationColor, setAnnotationColor] = useState(DEFAULT_ANNOTATION_STYLE.stroke);

  const [shareLinks, setShareLinks] = useState<ReviewCoreShareLinkSummary[]>([]);
  const [shareVersionIds, setShareVersionIds] = useState<string[]>([]);
  const [shareAllowComments, setShareAllowComments] = useState(true);
  const [shareAllowDownload, setShareAllowDownload] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiryLocal, setShareExpiryLocal] = useState("");
  const [creatingShareLink, setCreatingShareLink] = useState(false);
  const [copiedShareLinkId, setCopiedShareLinkId] = useState<string | null>(null);
  const [shareResolved, setShareResolved] = useState<ReviewCoreShareLinkResolved | null>(null);
  const [sharePasswordInput, setSharePasswordInput] = useState("");
  const [shareUnlocked, setShareUnlocked] = useState(!isShareMode);
  const [shareSessionToken, setShareSessionToken] = useState<string | null>(null);
  const [verifyingSharePassword, setVerifyingSharePassword] = useState(false);
  const [sharePasswordError, setSharePasswordError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [librarySort, setLibrarySort] = useState<"newest" | "name" | "status">("newest");
  const [shareVersionSearch, setShareVersionSearch] = useState("");
  const [reviewerNameInput, setReviewerNameInput] = useState("");
  const [reviewerNameActive, setReviewerNameActive] = useState<string | null>(null);
  const [expandedAssetIds, setExpandedAssetIds] = useState<string[]>([]);
  const [markerHoverId, setMarkerHoverId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ReviewCoreProjectSummary | null>(null);
  const [recentProjects, setRecentProjects] = useState<ReviewCoreProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(usesEmbeddedProjectPicker);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [shareLibrary, setShareLibrary] = useState<ReviewCoreAssetWithVersions[]>([]);
  const [frameNotes, setFrameNotes] = useState<ReviewCoreFrameNote[]>([]);
  const [grabbingFrame, setGrabbingFrame] = useState(false);
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [showFrameNotes, setShowFrameNotes] = useState(true);
  const [selectedFrameNoteId, setSelectedFrameNoteId] = useState<string | null>(null);
  const [editingFrameNoteId, setEditingFrameNoteId] = useState<string | null>(null);
  const [frameNoteDraft, setFrameNoteDraft] = useState<FrameNoteVectorData | null>(null);
  const [savingFrameNote, setSavingFrameNote] = useState(false);
  const [exportingFrameNoteId, setExportingFrameNoteId] = useState<string | null>(null);
  const [onionSkinEnabled, setOnionSkinEnabled] = useState(false);
  const [onionSkinOpacity, setOnionSkinOpacity] = useState(0.45);
  const [showQuickNoteComposer, setShowQuickNoteComposer] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState<ReviewCorePanelTab>("feedback");
  const [mediaReadyStatus, setMediaReadyStatus] = useState<"idle" | "processing" | "finalizing" | "ready" | "failed">("idle");
  const [mediaReadyAttempt, setMediaReadyAttempt] = useState(0);
  const [verifiedMediaUrls, setVerifiedMediaUrls] = useState<{ playlistUrl: string; posterUrl: string } | null>(null);
  const [mediaProbeNonce, setMediaProbeNonce] = useState(0);
  const [frameNoteImageCache, setFrameNoteImageCache] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStageRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ mode: "draw" | "move"; start: NormalizedPoint; itemId?: string } | null>(null);
  const previousVersionStatusRef = useRef<string | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) || null,
    [assets, selectedAssetId]
  );
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );
  const annotationsByCommentId = useMemo(() => {
    const map = new Map<string, ReviewCoreAnnotation>();
    for (const annotation of annotations) map.set(annotation.comment_id, annotation);
    return map;
  }, [annotations]);
  const sortedAssets = useMemo(() => {
    let filtered = assets.filter((a) => a.filename.toLowerCase().includes(librarySearch.toLowerCase()));
    return [...filtered].sort((a, b) => {
      if (librarySort === "name") return a.filename.localeCompare(b.filename);
      if (librarySort === "status") return a.status.localeCompare(b.status);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [assets, librarySearch, librarySort]);
  const filteredShareVersions = useMemo(() => {
    const query = shareVersionSearch.trim().toLowerCase();
    return shareLibrary.filter(({ asset }) => asset.filename.toLowerCase().includes(query));
  }, [shareLibrary, shareVersionSearch]);
  const reviewerIdentities = useMemo(() => {
    const entries = new Map<string, ReviewerIdentity>();
    for (const comment of comments) {
      const key = normalizeReviewerName(comment.author_name);
      if (!entries.has(key)) {
        entries.set(key, {
          name: key,
          initials: getReviewerInitials(key),
          color: getReviewerColor(key),
        });
      }
    }
    return entries;
  }, [comments]);
  const visibleReviewerIdentities = useMemo(() => {
    return Array.from(reviewerIdentities.values()).slice(0, 5);
  }, [reviewerIdentities]);
  const hiddenReviewerCount = Math.max(reviewerIdentities.size - visibleReviewerIdentities.length, 0);
  const activeViewAnnotation = useMemo(() => {
    if (annotatingCommentId) return null;
    const activeComment = comments.find(
      (comment) => Math.abs(comment.timestamp_ms - currentTime * 1000) <= 250 && annotationsByCommentId.has(comment.id)
    );
    return activeComment ? annotationsByCommentId.get(activeComment.id) || null : null;
  }, [annotatingCommentId, annotationsByCommentId, comments, currentTime]);
  const parsedActiveAnnotation = useMemo(
    () => parseAnnotationData(activeViewAnnotation?.vector_data, activeViewAnnotation?.comment_id, activeViewAnnotation?.timestamp_ms),
    [activeViewAnnotation]
  );
  const activeEditingComment = useMemo(
    () => comments.find((comment) => comment.id === annotatingCommentId) || null,
    [annotatingCommentId, comments]
  );
  const currentAnnotationStyle = useMemo(
    () => ({ stroke: annotationColor, width: DEFAULT_ANNOTATION_STYLE.width }),
    [annotationColor]
  );
  const frameNoteIndex = useMemo(() => {
    const assetMap = new Map<string, CommonAsset>();
    for (const asset of assets) assetMap.set(asset.id, asset);
    const versionMap = new Map<string, CommonVersion>();
    for (const group of shareLibrary) {
      assetMap.set(group.asset.id, group.asset);
      for (const version of group.versions) versionMap.set(version.id, version);
    }
    for (const version of versions) versionMap.set(version.id, version);
    return { assetMap, versionMap };
  }, [assets, shareLibrary, versions]);
  const assetFrameNotes = useMemo(() => {
    if (!selectedAsset) return [];
    return frameNotes.filter((note) => note.asset_id === selectedAsset.id);
  }, [frameNotes, selectedAsset]);
  const selectedFrameNote = useMemo(
    () => frameNotes.find((note) => note.id === selectedFrameNoteId) || null,
    [frameNotes, selectedFrameNoteId]
  );
  const parsedFrameNoteDraft = useMemo(
    () => parseFrameNoteData(selectedFrameNote?.vector_data, selectedFrameNote?.timestamp_ms),
    [selectedFrameNote]
  );
  const feedbackItems = useMemo(() => {
    const query = feedbackSearch.trim().toLowerCase();
    const items: FeedbackItem[] = [];
    for (const comment of comments) {
      const text = comment.text;
      const author = normalizeReviewerName(comment.author_name);
      if (
        query &&
        !text.toLowerCase().includes(query) &&
        !author.toLowerCase().includes(query)
      ) {
        continue;
      }
      items.push({
        id: `comment:${comment.id}`,
        source: "comment",
        timestamp_ms: comment.timestamp_ms,
        resolved: comment.resolved,
        author_name: author,
        text,
        type_label: "Text",
        version_label: selectedVersion ? `v${selectedVersion.version_number}` : "Current",
        comment,
      });
    }
    for (const note of assetFrameNotes) {
      if (!showFrameNotes) continue;
      const version = frameNoteIndex.versionMap.get(note.asset_version_id);
      const text = note.title?.trim() || "Marked frame";
      if (
        query &&
        !text.toLowerCase().includes(query) &&
        !(frameNoteIndex.assetMap.get(note.asset_id)?.filename.toLowerCase() || "").includes(query)
      ) {
        continue;
      }
      items.push({
        id: `note:${note.id}`,
        source: "frame_note",
        timestamp_ms: note.timestamp_ms,
        resolved: note.hidden,
        author_name: "Frame Note",
        text,
        type_label: "Draw",
        version_label: version ? `v${version.version_number}` : "Unknown",
        note,
      });
    }
    return items.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  }, [assetFrameNotes, comments, feedbackSearch, frameNoteIndex, selectedVersion, showFrameNotes]);
  const activeFeedbackId = useMemo(() => {
    let best: string | null = null;
    for (const item of feedbackItems) {
      if (currentTime * 1000 >= item.timestamp_ms) {
        best = item.id;
      } else {
        break;
      }
    }
    return best;
  }, [feedbackItems, currentTime]);
  const selectedFeedbackItem = useMemo(() => {
    if (selectedFrameNoteId) {
      return feedbackItems.find((item) => item.source === "frame_note" && item.note?.id === selectedFrameNoteId) || null;
    }
    if (selectedCommentId) {
      return feedbackItems.find((item) => item.source === "comment" && item.comment?.id === selectedCommentId) || null;
    }
    return null;
  }, [feedbackItems, selectedCommentId, selectedFrameNoteId]);
  const feedbackThumbnailNotes = useMemo(
    () =>
      assetFrameNotes
        .filter(() => showFrameNotes)
        .filter((note) => !note.hidden)
        .sort((a, b) => a.timestamp_ms - b.timestamp_ms),
    [assetFrameNotes, showFrameNotes]
  );
  const onionSkinVisible =
    showFrameNotes &&
    onionSkinEnabled &&
    Boolean(selectedFrameNote) &&
    !selectedFrameNote?.hidden &&
    selectedFrameNote?.asset_id === selectedAsset?.id &&
    selectedFrameNote?.asset_version_id !== selectedVersionId;
  const canShowComments = !isShareMode || Boolean(shareResolved?.allow_comments);
  const canAddComments = !isShareMode || Boolean(shareResolved?.allow_comments);
  const effectiveProjectId = isShareMode ? null : projectId ?? activeProject?.id ?? null;
  const displayProjectName = isShareMode
    ? shareResolved?.project_name || "Shared Review"
    : projectName || activeProject?.name || "Review Core";
  const displaySubtitle = isShareMode
    ? `${reviewerNameActive ? `Reviewing as ${reviewerNameActive}` : "Restricted review link"}`
    : projectId
      ? "App-managed proxy review"
      : "Standalone project review";

  useEffect(() => {
    invoke<string>("review_core_get_server_base_url")
      .then(setServerBaseUrl)
      .catch((error) => {
        console.error("Failed loading Review Core server URL", error);
      });
  }, []);

  const applyRecentProjectState = (projects: ReviewCoreProjectSummary[]) => {
    setRecentProjects(projects);
    setLoadingProjects(false);
  };

  const persistLastProjectId = (nextProjectId: string | null) => {
    if (!usesEmbeddedProjectPicker) return;
    if (import.meta.env.DEV) return;
    if (nextProjectId) {
      window.localStorage.setItem(REVIEW_CORE_LAST_PROJECT_STORAGE_KEY, nextProjectId);
    } else {
      window.localStorage.removeItem(REVIEW_CORE_LAST_PROJECT_STORAGE_KEY);
    }
  };

  const markProjectOpened = async (project: ReviewCoreProjectSummary) => {
    const openedAt = new Date().toISOString();
    const nextProject = { ...project, last_opened_at: openedAt };
    setActiveProject(nextProject);
    persistLastProjectId(project.id);
    setRecentProjects((current) => {
      const others = current.filter((item) => item.id !== project.id);
      return [nextProject, ...others].sort(
        (a, b) => new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime()
      );
    });
    try {
      await invoke("review_core_touch_project", { projectId: project.id });
    } catch (error) {
      console.error("Failed touching Review Core project", error);
      onError?.({ title: "Review Core project failed", hint: String(error) });
    }
  };

  const handleBackToProjects = () => {
    if (!usesEmbeddedProjectPicker) return;
    setActiveProject(null);
    persistLastProjectId(null);
    setAssets([]);
    setVersions([]);
    setComments([]);
    setAnnotations([]);
    setFrameNotes([]);
    setSelectedAssetId(null);
    setSelectedVersionId(null);
    setSelectedCommentId(null);
    setSelectedFrameNoteId(null);
    setVerifiedMediaUrls(null);
    setMediaReadyStatus("idle");
  };

  useEffect(() => {
    if (!usesEmbeddedProjectPicker) {
      setLoadingProjects(false);
      return;
    }

    let cancelled = false;
    const bootProjects = async () => {
      setLoadingProjects(true);
      try {
        const projects = await invoke<ReviewCoreProjectSummary[]>("review_core_list_projects");
        if (cancelled) return;
        applyRecentProjectState(projects);
        if (import.meta.env.DEV) {
          setActiveProject(null);
          return;
        }
        const lastProjectId = window.localStorage.getItem(REVIEW_CORE_LAST_PROJECT_STORAGE_KEY);
        if (!lastProjectId) {
          setActiveProject(null);
          return;
        }
        const matched = projects.find((project) => project.id === lastProjectId) || null;
        if (!matched) {
          persistLastProjectId(null);
          setActiveProject(null);
          return;
        }
        void markProjectOpened(matched);
      } catch (error) {
        if (cancelled) return;
        setLoadingProjects(false);
        console.error("Failed loading Review Core projects", error);
        onError?.({ title: "Review Core projects failed", hint: String(error) });
      }
    };

    void bootProjects();
    return () => {
      cancelled = true;
    };
  }, [usesEmbeddedProjectPicker]);

  useEffect(() => {
    if (!isShareMode || !shareToken) {
      setShareResolved(null);
      setShareUnlocked(true);
      setShareSessionToken(null);
      return;
    }
    invoke<ReviewCoreShareLinkResolved>("review_core_resolve_share_link", { token: shareToken })
      .then((resolved) => {
        setShareResolved(resolved);
        setShareUnlocked(!resolved.password_required);
        setShareSessionToken(null);
        setSharePasswordError(null);
        onError?.(null);
      })
      .catch((error) => {
        const hint = String(error);
        setShareResolved(null);
        setShareUnlocked(false);
        onError?.({
          title: hint.includes("EXPIRED") ? "Share link expired" : "Share link unavailable",
          hint,
        });
      });
  }, [isShareMode, shareToken, onError]);

  const refreshAssets = async () => {
    if (isShareMode) {
      if (!shareToken || !shareUnlocked) {
        setAssets([]);
        return;
      }
    } else if (!effectiveProjectId) {
      setAssets([]);
      return;
    }

    setLoading(true);
    try {
      const nextAssets = isShareMode
        ? await invoke<ReviewCoreSharedAssetSummary[]>("review_core_share_list_assets", {
          token: shareToken,
          sessionToken: shareSessionToken,
        })
        : await invoke<ReviewCoreAsset[]>("review_core_list_assets", { projectId: effectiveProjectId });
      setAssets(nextAssets);
      setSelectedAssetId((current) =>
        current && nextAssets.some((asset) => asset.id === current) ? current : nextAssets[0]?.id ?? null
      );
      onError?.(null);
    } catch (error) {
      console.error("Failed loading Review Core assets", error);
      onError?.({ title: "Review Core failed to load", hint: String(error) });
    } finally {
      setLoading(false);
    }
  };

  const refreshVersions = async (assetId: string) => {
    try {
      const nextVersions = isShareMode
        ? await invoke<ReviewCoreSharedVersionSummary[]>("review_core_share_list_versions", {
          token: shareToken,
          assetId,
          sessionToken: shareSessionToken,
        })
        : await invoke<ReviewCoreAssetVersion[]>("review_core_list_asset_versions", { assetId });
      setVersions(nextVersions);
      setSelectedVersionId((current) =>
        current && nextVersions.some((version) => version.id === current) ? current : nextVersions[0]?.id ?? null
      );
    } catch (error) {
      console.error("Failed loading Review Core versions", error);
      onError?.({ title: "Review Core versions failed", hint: String(error) });
    }
  };

  const refreshShareLinks = async () => {
    if (isShareMode || !effectiveProjectId) {
      setShareLinks([]);
      return;
    }
    try {
      const nextLinks = await invoke<ReviewCoreShareLinkSummary[]>("review_core_list_share_links", {
        projectId: effectiveProjectId,
      });
      setShareLinks(nextLinks);
    } catch (error) {
      console.error("Failed loading Review Core share links", error);
    }
  };

  const refreshShareLibrary = async () => {
    if (isShareMode || !effectiveProjectId) {
      setShareLibrary([]);
      return;
    }
    try {
      const nextLibrary = await invoke<ReviewCoreAssetWithVersions[]>("review_core_list_assets_with_versions", {
        projectId: effectiveProjectId,
      });
      setShareLibrary(nextLibrary);
    } catch (error) {
      console.error("Failed loading Review Core share library", error);
      onError?.({ title: "Review Core share library failed", hint: String(error) });
    }
  };

  const refreshFrameNotes = async () => {
    if (isShareMode || !effectiveProjectId) {
      setFrameNotes([]);
      setSelectedFrameNoteId(null);
      return;
    }
    try {
      const nextNotes = await invoke<ReviewCoreFrameNote[]>("review_core_list_frame_notes", {
        projectId: effectiveProjectId,
      });
      setFrameNotes(nextNotes);
      setSelectedFrameNoteId((current) => (current && nextNotes.some((note) => note.id === current) ? current : null));
    } catch (error) {
      console.error("Failed loading frame notes", error);
      onError?.({ title: "Frame Notes failed", hint: String(error) });
    }
  };

  useEffect(() => {
    refreshAssets();
  }, [effectiveProjectId, isShareMode, shareToken, shareUnlocked, shareSessionToken]);

  useEffect(() => {
    refreshShareLinks();
  }, [effectiveProjectId, isShareMode]);

  useEffect(() => {
    refreshShareLibrary();
  }, [effectiveProjectId, isShareMode]);

  useEffect(() => {
    refreshFrameNotes();
  }, [effectiveProjectId, isShareMode]);

  useEffect(() => {
    if (!selectedFrameNote) {
      if (onionSkinEnabled) {
        setOnionSkinEnabled(false);
      }
      if (editingFrameNoteId) {
        closeFrameNoteEditor();
      }
    }
  }, [selectedFrameNote, editingFrameNoteId, onionSkinEnabled]);

  useEffect(() => {
    if (!selectedFrameNote || frameNoteImageCache[selectedFrameNote.id]) return;
    invoke<string>("review_core_read_frame_note_image", {
      noteId: selectedFrameNote.id,
    })
      .then((dataUrl) => {
        setFrameNoteImageCache((current) => ({ ...current, [selectedFrameNote.id]: dataUrl }));
      })
      .catch((error) => {
        console.warn("Failed loading frame note image data", error);
      });
  }, [selectedFrameNote?.id, frameNoteImageCache]);

  useEffect(() => {
    if (!selectedAssetId) {
      setVersions([]);
      setSelectedVersionId(null);
      setThumbnails([]);
      setComments([]);
      setAnnotations([]);
      setApproval(DEFAULT_APPROVAL);
      return;
    }
    refreshVersions(selectedAssetId);
  }, [selectedAssetId, isShareMode, shareToken, shareSessionToken]);

  useEffect(() => {
    if (!selectedVersionId) {
      setThumbnails([]);
      setComments([]);
      setAnnotations([]);
      setApproval(DEFAULT_APPROVAL);
      setAnnotatingCommentId(null);
      return;
    }

    const loadVersionData = async () => {
      setThumbnails([]);
      try {
        const [nextComments, nextAnnotations, nextApproval] = await Promise.all([
          canShowComments
            ? isShareMode
              ? invoke<ReviewCoreComment[]>("review_core_share_list_comments", {
                token: shareToken,
                assetVersionId: selectedVersionId,
                sessionToken: shareSessionToken,
              })
              : invoke<ReviewCoreComment[]>("review_core_list_comments", { assetVersionId: selectedVersionId })
            : Promise.resolve([]),
          isShareMode
            ? invoke<ReviewCoreAnnotation[]>("review_core_share_list_annotations", {
              token: shareToken,
              assetVersionId: selectedVersionId,
              sessionToken: shareSessionToken,
            })
            : invoke<ReviewCoreAnnotation[]>("review_core_list_annotations", { assetVersionId: selectedVersionId }),
          isShareMode
            ? Promise.resolve(DEFAULT_APPROVAL)
            : invoke<ReviewCoreApprovalState>("review_core_get_approval", { assetVersionId: selectedVersionId }).catch(
              () => ({ ...DEFAULT_APPROVAL, asset_version_id: selectedVersionId })
            ),
        ]);
        setComments(nextComments);
        setAnnotations(nextAnnotations);
        setApproval(nextApproval);
        setApprovalName(nextApproval.approved_by || "Anonymous");
        setAnnotatingCommentId(null);
        setAnnotationDraft(null);
        setSelectedAnnotationItemId(null);
        setActiveDraftItem(null);
      } catch (error) {
        console.error("Failed loading Review Core version data", error);
        onError?.({ title: "Review Core version data failed", hint: String(error) });
      }
    };

    loadVersionData();
  }, [selectedVersionId, isShareMode, shareToken, shareSessionToken, canShowComments]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    const resetMedia = () => {
      setVerifiedMediaUrls(null);
      setThumbnails([]);
      setMediaReadyAttempt(0);
    };

    if (!selectedAsset || !selectedVersion || !serverBaseUrl) {
      resetMedia();
      setMediaReadyStatus("idle");
      return () => {
        if (timeoutId != null) window.clearTimeout(timeoutId);
      };
    }

    if (REVIEW_CORE_DEBUG) {
      console.info("[Wrap Preview][ReviewCore] media selection", {
        project_id: selectedAsset.project_id,
        asset_id: selectedAsset.id,
        version_id: selectedVersion.id,
        processing_status: selectedVersion.processing_status,
        playlist_url: buildMediaUrl({
          serverBaseUrl,
          projectId: selectedAsset.project_id,
          assetId: selectedAsset.id,
          versionId: selectedVersion.id,
          type: "playlist",
          shareToken,
          sessionToken: shareSessionToken,
        }),
        poster_url: buildMediaUrl({
          serverBaseUrl,
          projectId: selectedAsset.project_id,
          assetId: selectedAsset.id,
          versionId: selectedVersion.id,
          type: "poster",
          shareToken,
          sessionToken: shareSessionToken,
        }),
        thumbnails_base: `${serverBaseUrl}/media/${selectedAsset.project_id}/${selectedAsset.id}/${selectedVersion.id}/thumbs/`,
      });
    }

    if (selectedVersion.processing_status === "failed") {
      resetMedia();
      setMediaReadyStatus("failed");
      return () => {
        if (timeoutId != null) window.clearTimeout(timeoutId);
      };
    }

    if (selectedVersion.processing_status !== "ready") {
      resetMedia();
      setMediaReadyStatus("processing");
      return () => {
        if (timeoutId != null) window.clearTimeout(timeoutId);
      };
    }

    const playlistUrl = buildMediaUrl({
      serverBaseUrl,
      projectId: selectedAsset.project_id,
      assetId: selectedAsset.id,
      versionId: selectedVersion.id,
      type: "playlist",
      shareToken,
      sessionToken: shareSessionToken,
    });
    const posterUrl = buildMediaUrl({
      serverBaseUrl,
      projectId: selectedAsset.project_id,
      assetId: selectedAsset.id,
      versionId: selectedVersion.id,
      type: "poster",
      shareToken,
      sessionToken: shareSessionToken,
    });

    if (REVIEW_CORE_DEBUG) {
      console.info("[Wrap Preview][ReviewCore] media attach", {
        project_id: selectedAsset.project_id,
        asset_id: selectedAsset.id,
        version_id: selectedVersion.id,
        processing_status: selectedVersion.processing_status,
        playlist_url: playlistUrl,
        poster_url: posterUrl,
        thumbnails_base: `${serverBaseUrl}/media/${selectedAsset.project_id}/${selectedAsset.id}/${selectedVersion.id}/thumbs/`,
      });
    }

    const verifyMedia = async (attempt: number) => {
      setMediaReadyStatus("finalizing");
      setMediaReadyAttempt(attempt);
      try {
        const [posterResponse, playlistResponse] = await Promise.all([
          fetch(`${posterUrl}${posterUrl.includes("?") ? "&" : "?"}v=${attempt}`, { cache: "no-store" }),
          fetch(`${playlistUrl}${playlistUrl.includes("?") ? "&" : "?"}v=${attempt}`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        let nextThumbs: ReviewCoreThumbnailInfo[] = [];
        let thumbsError: string | null = null;
        if (posterResponse.ok && playlistResponse.ok) {
          try {
            nextThumbs = isShareMode
              ? await invoke<ReviewCoreThumbnailInfo[]>("review_core_share_list_thumbnails", {
                token: shareToken,
                assetVersionId: selectedVersion.id,
                sessionToken: shareSessionToken,
              })
              : await invoke<ReviewCoreThumbnailInfo[]>("review_core_list_thumbnails", { versionId: selectedVersion.id });
          } catch (error) {
            thumbsError = String(error);
          }
        }
        if (posterResponse.ok && playlistResponse.ok && !thumbsError && nextThumbs.length > 0) {
          setVerifiedMediaUrls({ posterUrl, playlistUrl });
          setMediaReadyStatus("ready");
          if (!cancelled) {
            setThumbnails(nextThumbs);
          }
          return;
        }
        if (REVIEW_CORE_DEBUG) {
          const missing: string[] = [];
          if (!posterResponse.ok) missing.push("poster.jpg");
          if (!playlistResponse.ok) missing.push("index.m3u8");
          if (thumbsError || nextThumbs.length === 0) missing.push("thumb list");
          if (missing.length > 0) {
            console.info("[Wrap Preview][ReviewCore] media probe missing", {
              project_id: selectedAsset.project_id,
              asset_id: selectedAsset.id,
              version_id: selectedVersion.id,
              attempt,
              missing,
              thumbnail_error: thumbsError,
            });
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.warn("[Wrap Preview][ReviewCore] media probe failed", error);
      }

      if (attempt >= 5) {
        setVerifiedMediaUrls(null);
        setMediaReadyStatus("finalizing");
        return;
      }
      timeoutId = window.setTimeout(() => {
        void verifyMedia(attempt + 1);
      }, Math.min(500 * 2 ** (attempt - 1), 4000));
    };

    void verifyMedia(1);
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [
    selectedAsset,
    selectedVersion,
    serverBaseUrl,
    isShareMode,
    shareToken,
    shareSessionToken,
    mediaProbeNonce,
  ]);

  useEffect(() => {
    const currentStatus = selectedVersion?.processing_status ?? null;
    const previousStatus = previousVersionStatusRef.current;
    previousVersionStatusRef.current = currentStatus;
    if (currentStatus !== "ready" || previousStatus === "ready") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setMediaProbeNonce((value) => value + 1);
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [selectedVersion?.id, selectedVersion?.processing_status]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (mediaReadyStatus === "ready" && verifiedMediaUrls && selectedAsset && selectedVersion) {
      return;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    video.pause();
    video.poster = "";
    video.removeAttribute("src");
    video.load();
    setCurrentTime(0);
    setDuration(selectedAsset?.duration_ms ? selectedAsset.duration_ms / 1000 : 0);
  }, [mediaReadyStatus, verifiedMediaUrls, selectedAsset?.id, selectedVersion?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedAsset || !selectedVersion || !verifiedMediaUrls) return;

    video.poster = verifiedMediaUrls.posterUrl;
    video.pause();
    video.removeAttribute("src");
    video.load();
    setCurrentTime(0);
    setDuration(selectedAsset.duration_ms ? selectedAsset.duration_ms / 1000 : 0);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(verifiedMediaUrls.playlistUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = verifiedMediaUrls.playlistUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [selectedAsset, selectedVersion, verifiedMediaUrls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => {
      setDuration(video.duration || 0);
      updateFrameRect();
    };
    const handleCanPlay = () => {
      if (pendingSeekSecondsRef.current != null) {
        video.currentTime = pendingSeekSecondsRef.current;
        pendingSeekSecondsRef.current = null;
      }
      updateFrameRect();
    };
    const handleError = () => {
      if (video.poster) {
        video.poster = "";
      }
    };
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("error", handleError);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("error", handleError);
    };
  }, [selectedAsset]);

  useEffect(() => {
    const frame = videoStageRef.current;
    if (!frame) return;
    const resizeObserver = new ResizeObserver(() => updateFrameRect());
    resizeObserver.observe(frame);
    const video = videoRef.current;
    if (video) resizeObserver.observe(video);
    window.addEventListener("resize", updateFrameRect);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFrameRect);
    };
  }, [selectedAsset, selectedVersion]);

  useEffect(() => {
    if (!selectedAssetId || !selectedVersion || selectedVersion.processing_status !== "processing") {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshVersions(selectedAssetId);
    }, 2500);
    return () => window.clearInterval(intervalId);
  }, [selectedAssetId, selectedVersion?.id, selectedVersion?.processing_status]);

  const updateFrameRect = () => {
    const container = videoStageRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    setFrameRect(getVideoFrameRect(container, video));
  };

  const handleImport = async () => {
    if (isShareMode) return;
    const selected = await open({
      multiple: true,
      directory: false,
      title: "Import media into Review Core",
    });
    if (!selected || !effectiveProjectId) return;

    const filePaths = Array.isArray(selected) ? selected : [selected];
    if (filePaths.length === 0) return;

    try {
      const duplicateCheck = await invoke<{ duplicates: ReviewCoreDuplicateCandidate[] }>("review_core_check_duplicate_files", {
        projectId: effectiveProjectId,
        filePaths,
      });
      if (duplicateCheck.duplicates.length > 0) {
        setPendingDuplicateFiles(filePaths);
        setDuplicateCandidates(duplicateCheck.duplicates);
        return;
      }
      await runIngest(filePaths, "new_version");
    } catch (error) {
      console.error("Review Core duplicate check failed", error);
      onError?.({ title: "Review Core ingest failed", hint: String(error) });
    }
  };

  const handleCreateProject = async () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    setCreatingProject(true);
    try {
      const created = await invoke<ReviewCoreProjectSummary>("review_core_create_project", { name: trimmed });
      setNewProjectName("");
      setRecentProjects((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      await markProjectOpened(created);
      onError?.(null);
    } catch (error) {
      console.error("Failed creating Review Core project", error);
      onError?.({ title: "Create project failed", hint: String(error) });
    } finally {
      setCreatingProject(false);
    }
  };

  const runIngest = async (filePaths: string[], duplicateMode: "new_version" | "new_asset") => {
    if (!effectiveProjectId) return;
    setImporting(true);
    try {
      await invoke("review_core_ingest_files", { projectId: effectiveProjectId, filePaths, duplicateMode });
      setPendingDuplicateFiles(null);
      setDuplicateCandidates([]);
      await refreshAssets();
      await refreshShareLibrary();
    } catch (error) {
      console.error("Review Core ingest failed", error);
      onError?.({ title: "Review Core ingest failed", hint: String(error) });
    } finally {
      setImporting(false);
    }
  };

  const handleThumbnailSeek = (seconds: number) => {
    const video = videoRef.current;
    pendingSeekSecondsRef.current = seconds;
    if (!video || selectedVersion?.processing_status !== "ready") return;
    if (video.readyState >= 1) {
      video.currentTime = seconds;
      pendingSeekSecondsRef.current = null;
    }
  };

  const addComment = async () => {
    if (!selectedVersionId || !canAddComments) return;
    setSubmittingComment(true);
    try {
      const created = isShareMode
        ? await invoke<ReviewCoreComment>("review_core_share_add_comment", {
          token: shareToken,
          assetVersionId: selectedVersionId,
          timestampMs: Math.round(currentTime * 1000),
          text: commentText,
          authorName: commentAuthor,
          sessionToken: shareSessionToken,
        })
        : await invoke<ReviewCoreComment>("review_core_add_comment", {
          assetVersionId: selectedVersionId,
          timestampMs: Math.round(currentTime * 1000),
          text: commentText,
          authorName: commentAuthor,
        });
      setComments((prev) => [...prev, created].sort((a, b) => a.timestamp_ms - b.timestamp_ms));
      setSelectedCommentId(created.id);
      setSelectedFrameNoteId(null);
      setShowQuickNoteComposer(false);
      setCommentText("");
    } catch (error) {
      console.error("Failed adding comment", error);
      onError?.({ title: "Add comment failed", hint: String(error) });
    } finally {
      setSubmittingComment(false);
    }
  };

  const seekToComment = (comment: ReviewCoreComment) => {
    handleThumbnailSeek(comment.timestamp_ms / 1000);
    setSelectedCommentId(comment.id);
    setSelectedFrameNoteId(null);
  };

  const toggleResolved = async (comment: ReviewCoreComment) => {
    if (isShareMode) return;
    try {
      const updated = await invoke<ReviewCoreComment>("review_core_update_comment", {
        commentId: comment.id,
        updates: { resolved: !comment.resolved },
      });
      setComments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      console.error("Failed updating comment", error);
      onError?.({ title: "Comment update failed", hint: String(error) });
    }
  };

  const saveEditedComment = async (commentId: string) => {
    setSavingCommentId(commentId);
    try {
      const updated = await invoke<ReviewCoreComment>("review_core_update_comment", {
        commentId,
        updates: { text: editingCommentText },
      });
      setComments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setEditingCommentId(null);
      setEditingCommentText("");
    } catch (error) {
      console.error("Failed updating comment text", error);
      onError?.({ title: "Edit comment failed", hint: String(error) });
    } finally {
      setSavingCommentId(null);
    }
  };

  const deleteComment = async (comment: ReviewCoreComment) => {
    if (isShareMode || !window.confirm("Delete this comment?")) return;
    try {
      await invoke("review_core_delete_comment", { commentId: comment.id });
      setComments((prev) => prev.filter((item) => item.id !== comment.id));
      setAnnotations((prev) => prev.filter((item) => item.comment_id !== comment.id));
    } catch (error) {
      console.error("Failed deleting comment", error);
      onError?.({ title: "Delete comment failed", hint: String(error) });
    }
  };

  const handleApprovalChange = async (status: ApprovalStatus) => {
    if (!selectedVersionId || isShareMode) return;
    setSavingApproval(true);
    try {
      const nextApproval = await invoke<ReviewCoreApprovalState>("review_core_set_approval", {
        assetVersionId: selectedVersionId,
        status,
        approvedBy: status === "approved" || status === "rejected" ? approvalName : undefined,
      });
      setApproval(nextApproval);
      if (nextApproval.approved_by) {
        setApprovalName(nextApproval.approved_by);
      }
    } catch (error) {
      console.error("Failed setting approval", error);
      onError?.({ title: "Approval update failed", hint: String(error) });
    } finally {
      setSavingApproval(false);
    }
  };

  const openAnnotationEditor = (comment: ReviewCoreComment) => {
    if (isShareMode) return;
    seekToComment(comment);
    videoRef.current?.pause();
    const existing = annotationsByCommentId.get(comment.id);
    setAnnotatingCommentId(comment.id);
    setAnnotationTool("pointer");
    setSelectedAnnotationItemId(null);
    setActiveDraftItem(null);
    setAnnotationDraft(existing ? parseAnnotationData(existing.vector_data, comment.id, comment.timestamp_ms) : createEmptyAnnotationDraft(comment));
  };

  const cancelAnnotationEditor = () => {
    setAnnotatingCommentId(null);
    setAnnotationDraft(null);
    setSelectedAnnotationItemId(null);
    setActiveDraftItem(null);
    dragStateRef.current = null;
  };

  const saveAnnotation = async () => {
    if (!annotatingCommentId || !annotationDraft || isShareMode) return;
    setSavingAnnotation(true);
    try {
      const saved = await invoke<ReviewCoreAnnotation>("review_core_add_annotation", {
        commentId: annotatingCommentId,
        vectorDataJson: JSON.stringify(annotationDraft),
      });
      setAnnotations((prev) => [...prev.filter((item) => item.comment_id !== annotatingCommentId), saved]);
      cancelAnnotationEditor();
    } catch (error) {
      console.error("Failed saving annotation", error);
      onError?.({ title: "Save annotation failed", hint: String(error) });
    } finally {
      setSavingAnnotation(false);
    }
  };

  const deleteAnnotation = async () => {
    if (!annotatingCommentId || isShareMode) return;
    const existing = annotationsByCommentId.get(annotatingCommentId);
    if (!existing) {
      cancelAnnotationEditor();
      return;
    }
    try {
      await invoke("review_core_delete_annotation", { annotationId: existing.id });
      setAnnotations((prev) => prev.filter((item) => item.id !== existing.id));
      cancelAnnotationEditor();
    } catch (error) {
      console.error("Failed deleting annotation", error);
      onError?.({ title: "Delete annotation failed", hint: String(error) });
    }
  };

  const openFrameNoteEditor = (note: ReviewCoreFrameNote) => {
    setAnnotatingCommentId(null);
    setAnnotationDraft(null);
    setSelectedFrameNoteId(note.id);
    setSelectedCommentId(null);
    setEditingFrameNoteId(note.id);
    setAnnotationTool("pointer");
    setSelectedAnnotationItemId(null);
    setActiveDraftItem(null);
    setFrameNoteDraft(parseFrameNoteData(note.vector_data, note.timestamp_ms));
    setOnionSkinEnabled(false);
  };

  const closeFrameNoteEditor = () => {
    setEditingFrameNoteId(null);
    setFrameNoteDraft(null);
    setSelectedAnnotationItemId(null);
    setActiveDraftItem(null);
    dragStateRef.current = null;
  };

  const handleGrabFrame = async () => {
    if (!selectedVersionId || !selectedAssetId || isShareMode) return;
    setGrabbingFrame(true);
    try {
      const result = await invoke<ReviewCoreExtractFrameResult>("review_core_extract_frame", {
        assetVersionId: selectedVersionId,
        timestampMs: Math.round(currentTime * 1000),
      });
      await refreshFrameNotes();
      const createdNote = await invoke<ReviewCoreFrameNote[]>("review_core_list_frame_notes", {
        projectId: result.project_id,
      });
      const note = createdNote.find((item) => item.id === result.note_id);
      if (note) {
        setFrameNotes(createdNote);
        setSelectedCommentId(null);
        openFrameNoteEditor(note);
      }
    } catch (error) {
      console.error("Failed extracting frame", error);
      onError?.({ title: "Grab frame failed", hint: String(error) });
    } finally {
      setGrabbingFrame(false);
    }
  };

  const saveFrameNote = async () => {
    if (!selectedFrameNoteId || !frameNoteDraft) return;
    setSavingFrameNote(true);
    try {
      const updated = await invoke<ReviewCoreFrameNote>("review_core_update_frame_note", {
        noteId: selectedFrameNoteId,
        updates: {
          vectorData: JSON.stringify(frameNoteDraft),
        },
      });
      setFrameNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)));
      closeFrameNoteEditor();
    } catch (error) {
      console.error("Failed saving frame note", error);
      onError?.({ title: "Save Frame Note failed", hint: String(error) });
    } finally {
      setSavingFrameNote(false);
    }
  };

  const updateFrameNoteMeta = async (noteId: string, updates: { title?: string; hidden?: boolean }) => {
    try {
      const updated = await invoke<ReviewCoreFrameNote>("review_core_update_frame_note", {
        noteId,
        updates,
      });
      setFrameNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)));
    } catch (error) {
      console.error("Failed updating frame note", error);
      onError?.({ title: "Frame Note update failed", hint: String(error) });
    }
  };

  const deleteFrameNote = async (note: ReviewCoreFrameNote) => {
    if (!window.confirm("Delete this Frame Note?")) return;
    try {
      await invoke("review_core_delete_frame_note", { noteId: note.id });
      setFrameNotes((prev) => prev.filter((item) => item.id !== note.id));
      if (selectedFrameNoteId === note.id) {
        closeFrameNoteEditor();
        setSelectedFrameNoteId(null);
      }
    } catch (error) {
      console.error("Failed deleting frame note", error);
      onError?.({ title: "Delete Frame Note failed", hint: String(error) });
    }
  };

  const exportFrameNoteJpg = async (note: ReviewCoreFrameNote) => {
    setExportingFrameNoteId(note.id);
    try {
      const dataUrl = await renderFrameNoteExport(note);
      const outputPath = note.image_path.replace(/frame\.jpg$/i, "annotated.jpg");
      await invoke("save_image_data_url", { path: outputPath, dataUrl });
      onError?.({ title: "Frame Note exported", hint: "Annotated JPG saved into Review Core storage." });
    } catch (error) {
      console.error("Failed exporting frame note", error);
      onError?.({ title: "Export Frame Note failed", hint: String(error) });
    } finally {
      setExportingFrameNoteId(null);
    }
  };

  const handleVerifyPassword = async () => {
    if (!shareToken) return;
    setVerifyingSharePassword(true);
    try {
      const unlock = await invoke<ReviewCoreShareUnlockResult>("review_core_share_unlock", {
        token: shareToken,
        password: sharePasswordInput,
        displayName: reviewerNameInput || "Guest Reviewer",
      });
      if (unlock.session_token) {
        setShareUnlocked(true);
        setShareSessionToken(unlock.session_token || null);
        setReviewerNameActive(reviewerNameInput || "Guest Reviewer");
        setCommentAuthor(reviewerNameInput || "Guest Reviewer");
        setSharePasswordError(null);
      } else {
        setSharePasswordError("Password incorrect.");
      }
    } catch (error) {
      setSharePasswordError(String(error));
    } finally {
      setVerifyingSharePassword(false);
    }
  };

  const handleSetReviewerNameOnly = async () => {
    if (!shareToken) return;
    setVerifyingSharePassword(true); // Reusing spinner
    try {
      const unlock = await invoke<ReviewCoreShareUnlockResult>("review_core_share_unlock", {
        token: shareToken,
        displayName: reviewerNameInput || "Guest Reviewer",
      });
      if (unlock.session_token) {
        setShareUnlocked(true);
        setShareSessionToken(unlock.session_token || null);
        setReviewerNameActive(reviewerNameInput || "Guest Reviewer");
        setCommentAuthor(reviewerNameInput || "Guest Reviewer");
      }
    } catch (error) {
      onError?.({ title: "Session start failed", hint: String(error) });
    } finally {
      setVerifyingSharePassword(false);
    }
  };

  const copyToClipboard = async (value: string) => {
    if (!navigator.clipboard?.writeText) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      console.warn("Clipboard write failed", error);
      return false;
    }
  };

  const handleCreateShareLink = async () => {
    if (!effectiveProjectId || isShareMode) return;
    setCreatingShareLink(true);
    try {
      const created = await invoke<ReviewCoreShareLinkSummary>("review_core_create_share_link", {
        projectId: effectiveProjectId,
        assetVersionIds: shareVersionIds,
        expiresAt: shareExpiryLocal ? new Date(shareExpiryLocal).toISOString() : null,
        password: sharePassword || null,
        allowComments: shareAllowComments,
        allowDownload: shareAllowDownload,
      });
      setShareLinks((prev) => [created, ...prev]);
      setSharePassword("");
      setShareExpiryLocal("");
      setCopiedShareLinkId(created.id);
      const copied = await copyToClipboard(buildShareLink(created.token));
      if (!copied) {
        onError?.({
          title: "Share link created",
          hint: "Copy was blocked by the browser. Use the Copy link button to try again.",
        });
      }
    } catch (error) {
      console.error("Failed creating share link", error);
      onError?.({ title: "Create share link failed", hint: String(error) });
    } finally {
      setCreatingShareLink(false);
    }
  };

  const handleCopyShareLink = async (shareLink: ReviewCoreShareLinkSummary) => {
    const copied = await copyToClipboard(buildShareLink(shareLink.token));
    if (!copied) {
      onError?.({
        title: "Copy share link failed",
        hint: "Clipboard access was blocked in this context.",
      });
      return;
    }
    setCopiedShareLinkId(shareLink.id);
    window.setTimeout(() => setCopiedShareLinkId((current) => (current === shareLink.id ? null : current)), 1500);
  };

  const handleRevokeShareLink = async (shareLinkId: string) => {
    if (!window.confirm("Revoke this share link?")) return;
    try {
      await invoke("review_core_revoke_share_link", { shareLinkId });
      setShareLinks((prev) => prev.filter((item) => item.id !== shareLinkId));
    } catch (error) {
      console.error("Failed revoking share link", error);
      onError?.({ title: "Revoke share link failed", hint: String(error) });
    }
  };

  const handleDownload = async () => {
    if (!shareToken || !selectedVersionId || !shareResolved?.allow_download || !selectedAsset) return;
    const suggestedName = buildProxyFileName(selectedAsset.filename, selectedVersion?.version_number);
    const outputPath = await save({
      title: "Save shared proxy",
      defaultPath: suggestedName,
    });
    if (!outputPath) return;
    setDownloading(true);
    try {
      await invoke("review_core_share_export_download", {
        token: shareToken,
        assetVersionId: selectedVersionId,
        outputPath,
        sessionToken: shareSessionToken,
      });
    } catch (error) {
      console.error("Failed downloading shared media", error);
      const hint = String(error);
      onError?.({
        title: "Download failed",
        hint: hint.includes("PROXY_NOT_READY") ? "Proxy not ready yet." : hint,
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleRetryMediaAttach = () => {
    setVerifiedMediaUrls(null);
    setThumbnails([]);
    setMediaProbeNonce((value) => value + 1);
  };

  const selectFeedbackItem = (item: FeedbackItem) => {
    if (item.source === "comment" && item.comment) {
      seekToComment(item.comment);
      return;
    }
    if (item.note) {
      setSelectedCommentId(null);
      setSelectedFrameNoteId(item.note.id);
      handleThumbnailSeek(item.note.timestamp_ms / 1000);
    }
  };

  const activeDrawingDraft = editingFrameNoteId ? frameNoteDraft : annotationDraft;
  const setActiveDrawingDraft = (
    updater: FrameNoteVectorData | AnnotationVectorData | null | ((current: any) => any)
  ) => {
    if (editingFrameNoteId) {
      setFrameNoteDraft(updater as any);
    } else {
      setAnnotationDraft(updater as any);
    }
  };

  const pointerToNormalized = (event: React.PointerEvent<SVGSVGElement>): NormalizedPoint | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return [clamp01((event.clientX - rect.left) / rect.width), clamp01((event.clientY - rect.top) / rect.height)];
  };

  const handleOverlayPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!activeDrawingDraft || isShareMode) return;
    const point = pointerToNormalized(event);
    if (!point) return;

    if (annotationTool === "pointer") {
      const hit = hitTestAnnotationItem(activeDrawingDraft.items, point);
      setSelectedAnnotationItemId(hit?.id || null);
      if (hit) {
        dragStateRef.current = { mode: "move", start: point, itemId: hit.id };
      }
      return;
    }

    if (annotationTool === "text") {
      const text = annotationTextValue.trim() || "Note";
      const item: TextItem = {
        id: createItemId(),
        type: "text",
        x: point[0],
        y: point[1],
        text,
        style: currentAnnotationStyle,
      };
      setActiveDrawingDraft((current: FrameNoteVectorData | AnnotationVectorData | null) =>
        current ? { ...current, items: [...current.items, item] } : current
      );
      setSelectedAnnotationItemId(item.id);
      return;
    }

    const nextItem = createDraftItem(annotationTool, point, currentAnnotationStyle);
    if (!nextItem) return;
    setActiveDraftItem(nextItem);
    setSelectedAnnotationItemId(nextItem.id);
    dragStateRef.current = { mode: "draw", start: point, itemId: nextItem.id };
  };

  const handleOverlayPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !activeDrawingDraft || isShareMode) return;
    const point = pointerToNormalized(event);
    if (!point) return;

    if (drag.mode === "draw" && activeDraftItem) {
      setActiveDraftItem(updateDraftItem(activeDraftItem, drag.start, point));
      return;
    }

    if (drag.mode === "move" && drag.itemId) {
      const deltaX = point[0] - drag.start[0];
      const deltaY = point[1] - drag.start[1];
      dragStateRef.current = { ...drag, start: point };
      setActiveDrawingDraft((current: FrameNoteVectorData | AnnotationVectorData | null) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((item) => (item.id === drag.itemId ? translateAnnotationItem(item, deltaX, deltaY) : item)),
        };
      });
    }
  };

  const handleOverlayPointerUp = () => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    if (drag?.mode === "draw" && activeDraftItem) {
      setActiveDrawingDraft((current: FrameNoteVectorData | AnnotationVectorData | null) =>
        current ? { ...current, items: [...current.items, activeDraftItem] } : current
      );
      setActiveDraftItem(null);
    }
  };

  const displayedAnnotation = annotatingCommentId ? annotationDraft : parsedActiveAnnotation;
  const overlayVisible = Boolean(annotatingCommentId || displayedAnnotation);

  if (isShareMode && shareResolved?.password_required && !shareUnlocked) {
    return (
      <div className="review-core-shell review-core-share-shell">
        <div className="review-core-share-gate premium-card">
          <div className="section-title">Shared Review</div>
          <p>Please enter your name and the review password.</p>
          <div className="review-core-share-gate-fields">
            <input
              className="input-text"
              type="text"
              value={reviewerNameInput}
              onChange={(event) => setReviewerNameInput(event.target.value)}
              placeholder="Your display name"
              maxLength={80}
            />
            <input
              className="input-text"
              type="password"
              value={sharePasswordInput}
              onChange={(event) => setSharePasswordInput(event.target.value)}
              placeholder="Enter password"
              onKeyDown={(event) => {
                if (event.key === "Enter") handleVerifyPassword();
              }}
            />
          </div>
          {sharePasswordError && <div className="error-banner">{sharePasswordError}</div>}
          <div className="review-core-share-gate-actions">
            {onExitShare && (
              <button className="btn btn-secondary btn-sm" onClick={onExitShare}>
                Back
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={handleVerifyPassword} disabled={verifyingSharePassword || !reviewerNameInput.trim()}>
              <KeyRound size={14} />
              <span>{verifyingSharePassword ? "Unlocking…" : "Unlock"}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isShareMode && !shareSessionToken && !shareResolved?.password_required) {
    return (
      <div className="review-core-shell review-core-share-shell">
        <div className="review-core-share-gate premium-card">
          <div className="section-title">Shared Review</div>
          <p>Please enter your name to begin the review.</p>
          <input
            className="input-text"
            type="text"
            value={reviewerNameInput}
            onChange={(event) => setReviewerNameInput(event.target.value)}
            placeholder="Your display name"
            maxLength={80}
            onKeyDown={(event) => {
              if (event.key === "Enter" && reviewerNameInput.trim()) handleSetReviewerNameOnly();
            }}
          />
          <div className="review-core-share-gate-actions">
            {onExitShare && (
              <button className="btn btn-secondary btn-sm" onClick={onExitShare}>
                Back
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={handleSetReviewerNameOnly} disabled={verifyingSharePassword || !reviewerNameInput.trim()}>
              <span>{verifyingSharePassword ? "Starting…" : "Start Review"}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (usesEmbeddedProjectPicker && !effectiveProjectId) {
    return (
      <div className="review-core-shell">
        <div className="review-core-project-picker premium-card">
          <div className="section-title">Review Core</div>
          <div className="review-core-project-picker-copy">
            Select a Review Core project or create one to import media directly into app-managed review storage.
          </div>

          <div className="review-core-project-picker-grid">
            <div className="review-core-project-picker-panel">
              <div className="section-header">
                <span className="section-title">Create Project</span>
              </div>
              <div className="review-core-project-picker-form">
                <input
                  className="input-text"
                  type="text"
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="Project name"
                  maxLength={120}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newProjectName.trim()) {
                      void handleCreateProject();
                    }
                  }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleCreateProject}
                  disabled={creatingProject || !newProjectName.trim()}
                >
                  <Film size={14} />
                  <span>{creatingProject ? "Creating…" : "Create Project"}</span>
                </button>
              </div>
            </div>

            <div className="review-core-project-picker-panel">
              <div className="section-header">
                <span className="section-title">Open Existing</span>
                <span className="section-count highlight">{recentProjects.length}</span>
              </div>
              {loadingProjects ? (
                <div className="empty-state">Loading Review Core projects…</div>
              ) : recentProjects.length === 0 ? (
                <div className="empty-state review-core-empty">
                  <Film size={18} />
                  <p>No Review Core projects yet.</p>
                </div>
              ) : (
                <div className="review-core-project-list">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      className="review-core-project-list-item"
                      onClick={() => {
                        void markProjectOpened(project);
                      }}
                    >
                      <div>
                        <strong>{project.name}</strong>
                        <span>Last opened {new Date(project.last_opened_at).toLocaleString()}</span>
                      </div>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`review-core-shell ${isShareMode ? "review-core-share-shell" : ""} ${restricted ? "review-core-restricted-shell" : ""}`}>
      <div className="review-core-toolbar premium-toolbar">
        <div>
          <div className="section-title">{isShareMode ? "Shared Review" : "Review Core"}</div>
          <div className="review-core-subtitle">
            {displayProjectName} · {displaySubtitle}
          </div>
        </div>
        <div className="review-core-toolbar-actions">
          {isShareMode ? (
            <>
              {shareResolved?.allow_download && (
                <button className="btn btn-secondary btn-sm" onClick={handleDownload} disabled={downloading || !selectedVersionId}>
                  {downloading ? <LoaderCircle size={14} className="review-core-spin" /> : <ShieldCheck size={14} />}
                  <span>{downloading ? "Saving…" : "Download Proxy"}</span>
                </button>
              )}
              {onExitShare && (
                <button className="btn btn-secondary btn-sm" onClick={onExitShare}>
                  Back
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={handleImport} disabled={importing}>
              {importing ? <LoaderCircle size={14} className="review-core-spin" /> : <FolderUp size={14} />}
              <span>{importing ? "Importing…" : "Import Files"}</span>
            </button>
          )}
        </div>
      </div>

      <div className="review-core-layout">
        <aside className="review-core-sidebar">
          <div className="section-header">
            <div className="section-header-top">
              <div className="review-core-library-title">
                {!isShareMode && usesEmbeddedProjectPicker && activeProject && (
                  <button className="btn-link btn-xs" onClick={handleBackToProjects}>
                    Projects
                  </button>
                )}
                <span className="section-title">Library</span>
              </div>
              <span className="section-count highlight">{assets.length}</span>
            </div>
            <div className="review-core-library-controls">
              <input
                className="input-text btn-xs"
                placeholder="Search assets..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
              />
              <select
                className="input-select btn-xs"
                value={librarySort}
                onChange={(e) => setLibrarySort(e.target.value as any)}
              >
                <option value="newest">Newest</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
              </select>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading Review Core assets…</div>
          ) : assets.length === 0 ? (
            <div className="empty-state review-core-empty">
              <Film size={18} />
              <p>{isShareMode ? "No shared versions are available for this link." : <>No imported assets yet. Use <strong>Import Files</strong> to copy media into app-managed storage for proxy review.</>}</p>
            </div>
          ) : (
            <div className="review-core-asset-list">
              {sortedAssets.map((asset) => (
                <button
                  key={asset.id}
                  className={`review-core-asset-card ${selectedAssetId === asset.id ? "active" : ""}`}
                  onClick={() => setSelectedAssetId(asset.id)}
                >
                  <div className="review-core-asset-header">
                    <span className="review-core-asset-name">{asset.filename}</span>
                    <span className={`review-core-status review-core-status-${asset.status}`}>{asset.status}</span>
                  </div>
                  <div className="review-core-asset-meta">
                    <span>{formatDuration(asset.duration_ms)}</span>
                    <span>{formatResolution(asset)}</span>
                    <span>{formatFps(asset.frame_rate)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="review-core-main">
          {selectedAsset ? (
            <>
              <div className="review-core-player-card">
                <div className="review-core-player-header">
                  <div>
                    <h3>{selectedAsset.filename}</h3>
                    <p>{selectedAsset.codec || "Unknown codec"} · {formatResolution(selectedAsset)} · {formatFps(selectedAsset.frame_rate)}</p>
                  </div>
                  <div className="review-core-player-tools">
                    <div className="review-core-player-controls">
                      <select
                        className="input-select"
                        value={selectedVersionId || ""}
                        onChange={(event) => setSelectedVersionId(event.target.value)}
                      >
                        {versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            Version {version.version_number} · {version.processing_status}
                          </option>
                        ))}
                      </select>
                      <div className="review-core-timecode">
                        <PlayCircle size={14} />
                        <span>{formatTimecode(currentTime, selectedAsset)} / {formatTimecode(duration, selectedAsset)}</span>
                      </div>
                    </div>
                    {!isShareMode && (
                      <div className="review-core-approval-block">
                        <label className="review-core-approval-label">Approval</label>
                        <div className="review-core-approval-controls">
                          <select
                            className="input-select"
                            value={approval.status}
                            onChange={(event) => handleApprovalChange(event.target.value as ApprovalStatus)}
                            disabled={!selectedVersionId || savingApproval}
                          >
                            <option value="draft">Draft</option>
                            <option value="in_review">In Review</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                          </select>
                          {(approval.status === "approved" || approval.status === "rejected") && (
                            <input
                              className="input-text review-core-approval-name"
                              value={approvalName}
                              onChange={(event) => setApprovalName(event.target.value)}
                              onBlur={() => handleApprovalChange(approval.status)}
                              placeholder="Approved by"
                              maxLength={80}
                            />
                          )}
                        </div>
                        {(approval.status === "approved" || approval.status === "rejected") && approval.approved_at && (
                          <div className="review-core-approval-meta">
                            {approval.approved_by || "Anonymous"} · {new Date(approval.approved_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="review-core-video-frame">
                  <div className="review-core-video-stage" ref={videoStageRef}>
                    <div className="review-core-stage-actions">
                      {canAddComments && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setShowQuickNoteComposer((current) => !current);
                            setSelectedFrameNoteId(null);
                            setSelectedCommentId(null);
                          }}
                          disabled={!selectedVersionId}
                        >
                          <Type size={14} />
                          <span>Add Note</span>
                        </button>
                      )}
                      {!isShareMode && (
                        <button className="btn btn-secondary btn-sm" onClick={handleGrabFrame} disabled={grabbingFrame || !selectedVersionId}>
                          {grabbingFrame ? <LoaderCircle size={14} className="review-core-spin" /> : <Image size={14} />}
                          <span>{grabbingFrame ? "Capturing…" : "Mark Frame"}</span>
                        </button>
                      )}
                      {!isShareMode && (
                        <button
                          className={`btn btn-secondary btn-sm ${onionSkinEnabled ? "active" : ""}`}
                          onClick={() => setOnionSkinEnabled((current) => !current)}
                          disabled={!selectedFrameNote || selectedFrameNote.asset_id !== selectedAsset.id || selectedFrameNote.asset_version_id === selectedVersionId || selectedFrameNote.hidden}
                        >
                          <Layers3 size={14} />
                          <span>Compare</span>
                        </button>
                      )}
                      {!isShareMode && onionSkinEnabled && (
                        <label className="review-core-stage-opacity">
                          <span>Opacity</span>
                          <input
                            type="range"
                            min="0.1"
                            max="0.9"
                            step="0.05"
                            value={onionSkinOpacity}
                            onChange={(event) => setOnionSkinOpacity(Number(event.target.value))}
                          />
                        </label>
                      )}
                    </div>
                    {showQuickNoteComposer && canAddComments && (
                      <div className="review-core-stage-note-composer">
                        {!isShareMode && (
                          <input
                            className="input-text"
                            value={commentAuthor}
                            onChange={(event) => setCommentAuthor(event.target.value)}
                            placeholder="Author"
                            maxLength={80}
                          />
                        )}
                        <textarea
                          className="input-text review-core-comment-textarea"
                          value={commentText}
                          onChange={(event) => setCommentText(event.target.value)}
                          placeholder="Add a note at this timecode"
                          maxLength={2000}
                        />
                        <div className="review-core-stage-note-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => setShowQuickNoteComposer(false)}>
                            Cancel
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={addComment} disabled={submittingComment || !commentText.trim()}>
                            {submittingComment ? "Saving…" : "Save Note"}
                          </button>
                        </div>
                      </div>
                    )}
                    <video ref={videoRef} controls playsInline preload="metadata" />
                    {onionSkinVisible && selectedFrameNote && frameRect.width > 0 && frameRect.height > 0 && (
                      <div
                        className="review-core-onion-skin-layer"
                        style={{
                          left: `${frameRect.left}px`,
                          top: `${frameRect.top}px`,
                          width: `${frameRect.width}px`,
                          height: `${frameRect.height}px`,
                          opacity: onionSkinOpacity,
                        }}
                      >
                        <img src={selectedFrameNote.frame_url} alt={selectedFrameNote.title || "Frame note onion skin"} />
                        <svg className="review-core-annotation-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                          {renderAnnotationItems(parsedFrameNoteDraft?.items || [], null)}
                        </svg>
                      </div>
                    )}
                    {overlayVisible && frameRect.width > 0 && frameRect.height > 0 && (
                      <div
                        className={`review-core-annotation-layer ${annotatingCommentId ? "editing" : "viewing"}`}
                        style={{
                          left: `${frameRect.left}px`,
                          top: `${frameRect.top}px`,
                          width: `${frameRect.width}px`,
                          height: `${frameRect.height}px`,
                        }}
                      >
                      {annotatingCommentId && !isShareMode && (
                        <div className="review-core-annotation-toolbar">
                          <button className={`btn btn-secondary btn-sm ${annotationTool === "pointer" ? "active" : ""}`} onClick={() => setAnnotationTool("pointer")}><MousePointer2 size={14} /></button>
                          <button className={`btn btn-secondary btn-sm ${annotationTool === "pen" ? "active" : ""}`} onClick={() => setAnnotationTool("pen")}><PenTool size={14} /></button>
                          <button className={`btn btn-secondary btn-sm ${annotationTool === "arrow" ? "active" : ""}`} onClick={() => setAnnotationTool("arrow")}><ChevronRight size={14} /></button>
                          <button className={`btn btn-secondary btn-sm ${annotationTool === "rect" ? "active" : ""}`} onClick={() => setAnnotationTool("rect")}><RectangleHorizontal size={14} /></button>
                          <button className={`btn btn-secondary btn-sm ${annotationTool === "circle" ? "active" : ""}`} onClick={() => setAnnotationTool("circle")}><Circle size={14} /></button>
                          <button className={`btn btn-secondary btn-sm ${annotationTool === "text" ? "active" : ""}`} onClick={() => setAnnotationTool("text")}><Type size={14} /></button>
                          {annotationTool === "text" && (
                            <input
                              className="input-text review-core-annotation-text-input"
                              value={annotationTextValue}
                              onChange={(event) => setAnnotationTextValue(event.target.value)}
                              maxLength={120}
                            />
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={!selectedAnnotationItemId}
                            onClick={() =>
                              setAnnotationDraft((current) =>
                                current ? { ...current, items: current.items.filter((item) => item.id !== selectedAnnotationItemId) } : current
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                      <svg
                        className="review-core-annotation-svg"
                        viewBox="0 0 1000 1000"
                        preserveAspectRatio="none"
                        onPointerDown={!isShareMode && annotatingCommentId ? handleOverlayPointerDown : undefined}
                        onPointerMove={!isShareMode && annotatingCommentId ? handleOverlayPointerMove : undefined}
                        onPointerUp={!isShareMode && annotatingCommentId ? handleOverlayPointerUp : undefined}
                        onPointerLeave={!isShareMode && annotatingCommentId ? handleOverlayPointerUp : undefined}
                      >
                        {renderAnnotationItems(displayedAnnotation?.items || [], selectedAnnotationItemId)}
                        {activeDraftItem && renderAnnotationItems([activeDraftItem], selectedAnnotationItemId)}
                      </svg>
                      {annotatingCommentId && !isShareMode && (
                        <div className="review-core-annotation-footer">
                          <span>Annotation at {formatTimecode((activeEditingComment?.timestamp_ms || 0) / 1000, selectedAsset)}</span>
                          <div className="review-core-annotation-footer-actions">
                            <button className="btn btn-secondary btn-sm" onClick={cancelAnnotationEditor}>Cancel</button>
                            <button className="btn btn-secondary btn-sm" onClick={deleteAnnotation} disabled={!annotationsByCommentId.get(annotatingCommentId)}>Remove</button>
                            <button className="btn btn-secondary btn-sm" onClick={saveAnnotation} disabled={savingAnnotation || !annotationDraft}>
                              <SaveIcon size={14} />
                              <span>{savingAnnotation ? "Saving…" : "Save"}</span>
                            </button>
                          </div>
                        </div>
                      )}
                      </div>
                    )}
                    {selectedVersion && mediaReadyStatus !== "ready" && (
                      <div className="review-core-player-overlay">
                        <div className="review-core-processing-state">
                          {selectedVersion.processing_status === "failed" ? (
                            <>
                              <span className="review-core-processing-label">Processing failed</span>
                              <span className="review-core-processing-copy">Re-import the asset to retry.</span>
                            </>
                          ) : (
                            <>
                              <span className="review-core-processing-label">
                                {mediaReadyStatus === "finalizing" ? "Still finalizing…" : "Processing…"}
                              </span>
                              <span className="review-core-processing-copy">
                                {mediaReadyStatus === "finalizing"
                                  ? `Preparing poster, proxy, and timeline files${mediaReadyAttempt > 0 ? ` · attempt ${mediaReadyAttempt}/5` : ""}`
                                  : "Preparing proxy, poster, and feedback surfaces"}
                              </span>
                              <span className="review-core-processing-bar" />
                              {REVIEW_CORE_DEBUG && (
                                <button className="review-core-debug-action" onClick={handleRetryMediaAttach}>
                                  Retry media attach
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="review-core-timeline-container">
                    <div className="review-core-timeline-rail">
                      <div
                        className="review-core-timeline-playhead"
                        style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
                      />
                      {feedbackItems.map((item) => {
                        const isActive = activeFeedbackId === item.id;
                        const markerPosition = (item.timestamp_ms / 1000 / (duration || 1)) * 100;
                        const markerColor = item.source === "frame_note" ? "#22c55e" : getReviewerColor(item.author_name);
                        return (
                          <div
                            key={item.id}
                            className={`review-core-timeline-marker ${isActive ? "active" : ""} ${item.resolved ? "resolved" : ""} ${item.source === "frame_note" ? "draw" : "text"}`}
                            style={{ left: `${markerPosition}%`, "--marker-color": markerColor } as CSSProperties}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectFeedbackItem(item);
                            }}
                            onMouseEnter={() => setMarkerHoverId(item.id)}
                            onMouseLeave={() => setMarkerHoverId(null)}
                          >
                            {markerHoverId === item.id && (
                              <div className="review-core-marker-tooltip">
                                <span className="tooltip-time">{formatTimecode(item.timestamp_ms / 1000, selectedAsset)}</span>
                                <span className="tooltip-text">{item.author_name} — {truncateText(item.text, 60)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {isShareMode
                  ? thumbnails.length > 0 && serverBaseUrl && selectedVersion && mediaReadyStatus === "ready" && (
                    <div className="review-core-thumb-strip">
                      {thumbnails.map((thumb) => {
                        const thumbUrl = buildMediaUrl({
                          serverBaseUrl,
                          projectId: selectedAsset.project_id,
                          assetId: selectedAsset.id,
                          versionId: selectedVersion.id,
                          type: "thumb",
                          file: thumb.file_name,
                          shareToken,
                          sessionToken: shareSessionToken,
                        });
                        return (
                          <button
                            key={thumb.file_name}
                            className="review-core-thumb-button"
                            onClick={() => handleThumbnailSeek(thumb.approx_seconds)}
                            title={`Seek to ${formatApproxTime(thumb.approx_seconds)}`}
                          >
                            <img src={thumbUrl} alt={thumb.file_name} />
                            <span>{formatApproxTime(thumb.approx_seconds)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )
                  : feedbackThumbnailNotes.length > 0 && (
                    <div className="review-core-thumb-strip review-core-feedback-strip">
                      {feedbackThumbnailNotes.map((note) => (
                        <button
                          key={note.id}
                          className={`review-core-thumb-button ${selectedFrameNoteId === note.id ? "active" : ""}`}
                          onClick={() => {
                            setSelectedCommentId(null);
                            setSelectedFrameNoteId(note.id);
                            handleThumbnailSeek(note.timestamp_ms / 1000);
                          }}
                          title={note.title || formatTimecode(note.timestamp_ms / 1000, selectedAsset)}
                        >
                          <img src={frameNoteImageCache[note.id] || note.frame_url} alt={note.title || "Feedback frame"} />
                          <span>{formatTimecode(note.timestamp_ms / 1000, selectedAsset)}</span>
                        </button>
                      ))}
                    </div>
                  )}

                {selectedVersion?.processing_status === "failed" && getVersionLastError(selectedVersion, selectedAsset) && (
                  <div className="review-core-error-card">
                    <button className="review-core-error-toggle" onClick={() => setShowErrorDetails((value) => !value)}>
                      {showErrorDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span>Processing error</span>
                    </button>
                    {showErrorDetails && (
                      <pre className="review-core-error-body">
                        {getVersionLastError(selectedVersion, selectedAsset)}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              <div className="review-core-metadata-grid">
                <div className="review-core-meta-card">
                  <span className="review-core-meta-label">Duration</span>
                  <strong>{formatDuration(selectedAsset.duration_ms)}</strong>
                </div>
                <div className="review-core-meta-card">
                  <span className="review-core-meta-label">Resolution</span>
                  <strong>{formatResolution(selectedAsset)}</strong>
                </div>
                <div className="review-core-meta-card">
                  <span className="review-core-meta-label">Frame Rate</span>
                  <strong>{formatFps(selectedAsset.frame_rate)}</strong>
                </div>
                {!isShareMode && isInternalAsset(selectedAsset) && (
                  <div className="review-core-meta-card">
                    <span className="review-core-meta-label">Checksum</span>
                    <strong>{selectedAsset.checksum_sha256.slice(0, 16)}…</strong>
                  </div>
                )}
              </div>
              {!isShareMode && (
                <div className="review-core-panel-tabs">
                  <button className={`btn btn-secondary btn-sm ${activePanelTab === "feedback" ? "active" : ""}`} onClick={() => setActivePanelTab("feedback")}>
                    Feedback
                  </button>
                  <button className={`btn btn-secondary btn-sm ${activePanelTab === "share" ? "active" : ""}`} onClick={() => setActivePanelTab("share")}>
                    Share
                  </button>
                </div>
              )}

              {(isShareMode || activePanelTab === "feedback") && (
                <div className="review-core-feedback-card">
                  <div className="section-header">
                    <span className="section-title">Feedback</span>
                    <span className="section-count highlight">{feedbackItems.length}</span>
                  </div>
                  {reviewerIdentities.size > 0 && (
                    <div className="review-core-reviewer-summary">
                      {visibleReviewerIdentities.map((reviewer) => (
                        <span
                          key={reviewer.name}
                          className="review-core-reviewer-chip"
                          style={{ "--reviewer-color": reviewer.color } as CSSProperties}
                        >
                          <span className="review-core-author-badge">{reviewer.initials}</span>
                          {reviewer.name}
                        </span>
                      ))}
                      {hiddenReviewerCount > 0 && (
                        <span className="review-core-reviewer-chip review-core-reviewer-chip-muted">+{hiddenReviewerCount}</span>
                      )}
                    </div>
                  )}
                  <div className="review-core-feedback-layout">
                    <aside className="review-core-feedback-sidebar">
                      <div className="review-core-feedback-toolbar">
                        <input
                          className="input-text btn-xs"
                          placeholder="Search feedback..."
                          value={feedbackSearch}
                          onChange={(event) => setFeedbackSearch(event.target.value)}
                        />
                        {!isShareMode && (
                          <label className="review-core-share-toggle">
                            <input type="checkbox" checked={showFrameNotes} onChange={(event) => setShowFrameNotes(event.target.checked)} />
                            <span>Show Frame Notes</span>
                          </label>
                        )}
                      </div>
                      <div className="review-core-feedback-list">
                        {feedbackItems.map((item) => {
                          const isActive = selectedFeedbackItem?.id === item.id || activeFeedbackId === item.id;
                          return (
                            <button
                              key={item.id}
                              className={`review-core-feedback-row ${isActive ? "active" : ""} ${item.resolved ? "resolved" : ""}`}
                              onClick={() => selectFeedbackItem(item)}
                            >
                              <span className={`review-core-feedback-kind ${item.source}`}>
                                {item.type_label}
                              </span>
                              <strong>{formatTimecode(item.timestamp_ms / 1000, selectedAsset)}</strong>
                              <span className="review-core-feedback-row-copy">{truncateText(item.text, 70)}</span>
                              <span className="review-core-feedback-row-meta">
                                <span className="review-core-author-badge" style={{ "--reviewer-color": item.source === "frame_note" ? "#22c55e" : getReviewerColor(item.author_name) } as CSSProperties}>
                                  {item.source === "frame_note" ? "DF" : getReviewerInitials(item.author_name)}
                                </span>
                                {item.author_name} · {item.version_label}
                              </span>
                            </button>
                          );
                        })}
                        {feedbackItems.length === 0 && (
                          <div className="empty-state review-core-empty">
                            <Type size={18} />
                            <p>No feedback yet. Use <strong>Add Note</strong> or <strong>Mark Frame</strong> from the player.</p>
                          </div>
                        )}
                      </div>
                    </aside>
                    <section className="review-core-feedback-detail">
                      {selectedFeedbackItem?.source === "comment" && selectedFeedbackItem.comment ? (
                        <div className="review-core-feedback-detail-card">
                          <div className="review-core-feedback-detail-head">
                            <div>
                              <div className="section-title">Text Feedback</div>
                              <div className="review-core-subtitle">
                                {formatTimecode(selectedFeedbackItem.comment.timestamp_ms / 1000, selectedAsset)} · {selectedFeedbackItem.author_name}
                              </div>
                            </div>
                            {!isShareMode && (
                              <div className="review-core-feedback-detail-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => toggleResolved(selectedFeedbackItem.comment!)}>
                                  {selectedFeedbackItem.comment.resolved ? "Unresolve" : "Resolve"}
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => openAnnotationEditor(selectedFeedbackItem.comment!)}>
                                  <PenTool size={14} />
                                  <span>Annotate</span>
                                </button>
                              </div>
                            )}
                          </div>
                          {editingCommentId === selectedFeedbackItem.comment.id ? (
                            <div className="review-core-comment-edit">
                              <textarea
                                className="input-text review-core-comment-textarea"
                                value={editingCommentText}
                                onChange={(event) => setEditingCommentText(event.target.value)}
                              />
                              <div className="review-core-comment-edit-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => { setEditingCommentId(null); setEditingCommentText(""); }}>
                                  Cancel
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => saveEditedComment(selectedFeedbackItem.comment!.id)} disabled={savingCommentId === selectedFeedbackItem.comment.id}>
                                  {savingCommentId === selectedFeedbackItem.comment.id ? "Saving…" : "Save"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="review-core-feedback-detail-copy">{selectedFeedbackItem.comment.text}</p>
                              {!isShareMode && (
                                <div className="review-core-feedback-detail-actions">
                                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditingCommentId(selectedFeedbackItem.comment!.id); setEditingCommentText(selectedFeedbackItem.comment!.text); }}>
                                    <Edit3 size={14} />
                                    <span>Edit</span>
                                  </button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => deleteComment(selectedFeedbackItem.comment!)}>
                                    Delete
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : selectedFrameNote ? (
                        <>
                          <div className="review-core-frame-note-detail-header">
                            <div>
                              <div className="section-title">Draw Feedback</div>
                              <div className="review-core-subtitle">
                                {frameNoteIndex.assetMap.get(selectedFrameNote.asset_id)?.filename || "Unknown asset"} ·
                                {" "}v{frameNoteIndex.versionMap.get(selectedFrameNote.asset_version_id)?.version_number || "?"} ·
                                {" "}{formatTimecode(selectedFrameNote.timestamp_ms / 1000, (frameNoteIndex.assetMap.get(selectedFrameNote.asset_id) || selectedAsset || TIMECODE_FALLBACK_ASSET) as any)}
                              </div>
                            </div>
                            {!isShareMode && (
                              <div className="review-core-feedback-detail-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => updateFrameNoteMeta(selectedFrameNote.id, { hidden: !selectedFrameNote.hidden })}>
                                  {selectedFrameNote.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                                  <span>{selectedFrameNote.hidden ? "Show" : "Hide"}</span>
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => exportFrameNoteJpg(selectedFrameNote)} disabled={exportingFrameNoteId === selectedFrameNote.id}>
                                  <SaveIcon size={14} />
                                  <span>{exportingFrameNoteId === selectedFrameNote.id ? "Exporting…" : "Export JPG"}</span>
                                </button>
                              </div>
                            )}
                          </div>
                          <input
                            className="input-text"
                            value={selectedFrameNote.title || ""}
                            placeholder="Frame Note title"
                            onChange={(event) =>
                              setFrameNotes((prev) =>
                                prev.map((note) => (note.id === selectedFrameNote.id ? { ...note, title: event.target.value } : note))
                              )
                            }
                            onBlur={(event) => updateFrameNoteMeta(selectedFrameNote.id, { title: event.target.value })}
                          />
                          <div className="review-core-frame-note-editor">
                            <img src={frameNoteImageCache[selectedFrameNote.id] || selectedFrameNote.frame_url} alt={selectedFrameNote.title || "Frame note"} />
                            <div className="review-core-frame-note-overlay">
                              {editingFrameNoteId === selectedFrameNote.id && (
                                <div className="review-core-annotation-toolbar">
                                  <button className={`btn btn-secondary btn-sm ${annotationTool === "pointer" ? "active" : ""}`} onClick={() => setAnnotationTool("pointer")}><MousePointer2 size={14} /></button>
                                  <button className={`btn btn-secondary btn-sm ${annotationTool === "pen" ? "active" : ""}`} onClick={() => setAnnotationTool("pen")}><PenTool size={14} /></button>
                                  <button className={`btn btn-secondary btn-sm ${annotationTool === "arrow" ? "active" : ""}`} onClick={() => setAnnotationTool("arrow")}><ChevronRight size={14} /></button>
                                  <button className={`btn btn-secondary btn-sm ${annotationTool === "rect" ? "active" : ""}`} onClick={() => setAnnotationTool("rect")}><RectangleHorizontal size={14} /></button>
                                  <button className={`btn btn-secondary btn-sm ${annotationTool === "circle" ? "active" : ""}`} onClick={() => setAnnotationTool("circle")}><Circle size={14} /></button>
                                  <button className={`btn btn-secondary btn-sm ${annotationTool === "text" ? "active" : ""}`} onClick={() => setAnnotationTool("text")}><Type size={14} /></button>
                                  {FRAME_NOTE_COLOR_SWATCHES.map((color) => (
                                    <button
                                      key={color}
                                      className={`review-core-color-swatch ${annotationColor === color ? "active" : ""}`}
                                      style={{ "--swatch-color": color } as CSSProperties}
                                      onClick={() => setAnnotationColor(color)}
                                    />
                                  ))}
                                  {annotationTool === "text" && (
                                    <input
                                      className="input-text review-core-annotation-text-input"
                                      value={annotationTextValue}
                                      onChange={(event) => setAnnotationTextValue(event.target.value)}
                                      maxLength={120}
                                    />
                                  )}
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    disabled={!selectedAnnotationItemId}
                                    onClick={() =>
                                      setFrameNoteDraft((current) =>
                                        current ? { ...current, items: current.items.filter((item) => item.id !== selectedAnnotationItemId) } : current
                                      )
                                    }
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                              <svg
                                className="review-core-annotation-svg"
                                viewBox="0 0 1000 1000"
                                preserveAspectRatio="none"
                                onPointerDown={editingFrameNoteId === selectedFrameNote.id ? handleOverlayPointerDown : undefined}
                                onPointerMove={editingFrameNoteId === selectedFrameNote.id ? handleOverlayPointerMove : undefined}
                                onPointerUp={editingFrameNoteId === selectedFrameNote.id ? handleOverlayPointerUp : undefined}
                                onPointerLeave={editingFrameNoteId === selectedFrameNote.id ? handleOverlayPointerUp : undefined}
                              >
                                {renderAnnotationItems(
                                  (editingFrameNoteId === selectedFrameNote.id ? frameNoteDraft : parsedFrameNoteDraft)?.items || [],
                                  selectedAnnotationItemId
                                )}
                                {activeDraftItem && renderAnnotationItems([activeDraftItem], selectedAnnotationItemId)}
                              </svg>
                              <div className="review-core-annotation-footer">
                                <span>{selectedFrameNote.hidden ? "Hidden draw feedback" : "Visible draw feedback"} · {selectedFrameNote.frame_number != null ? `Frame ${selectedFrameNote.frame_number}` : "Frame note"}</span>
                                <div className="review-core-annotation-footer-actions">
                                  {editingFrameNoteId === selectedFrameNote.id ? (
                                    <>
                                      <button className="btn btn-secondary btn-sm" onClick={closeFrameNoteEditor}>Cancel</button>
                                      <button className="btn btn-secondary btn-sm" onClick={saveFrameNote} disabled={savingFrameNote}>
                                        <SaveIcon size={14} />
                                        <span>{savingFrameNote ? "Saving…" : "Save"}</span>
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {!isShareMode && (
                                        <>
                                          <button className="btn btn-secondary btn-sm" onClick={() => openFrameNoteEditor(selectedFrameNote)}>Edit Markup</button>
                                          <button className="btn btn-secondary btn-sm" onClick={() => deleteFrameNote(selectedFrameNote)}>
                                            Delete
                                          </button>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="empty-state review-core-empty">
                          <Image size={18} />
                          <p>Select feedback from the marker bar, draw thumbnails, or the list to inspect it here.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              )}

              {!isShareMode && activePanelTab === "share" && (
                <div className="review-core-share-card">
                  <div className="section-header">
                    <span className="section-title">Share</span>
                    <span className="section-count highlight">{shareLinks.length}</span>
                  </div>
                  <div className="review-core-share-form">
                    <div className="review-core-share-version-header">
                      <input
                        className="input-text btn-xs"
                        placeholder="Search versions..."
                        value={shareVersionSearch}
                        onChange={(e) => setShareVersionSearch(e.target.value)}
                      />
                      <div className="review-core-share-version-bulk">
                        <button
                          className="btn-link btn-xs"
                          onClick={() =>
                            setShareVersionIds(
                              Array.from(new Set(filteredShareVersions.flatMap(({ versions: versionRows }) => versionRows.map((version) => version.id))))
                            )
                          }
                        >
                          All
                        </button>
                        <button className="btn-link btn-xs" onClick={() => setShareVersionIds([])}>Clear</button>
                      </div>
                    </div>
                    <div className="review-core-share-version-list">
                      {filteredShareVersions.map(({ asset, versions: assetVersions }) => {
                        const assetId = asset.id;
                        const isExpanded = expandedAssetIds.includes(assetId);
                        const allSelected = assetVersions.every(v => shareVersionIds.includes(v.id));

                        return (
                          <div key={assetId} className="review-core-share-asset-group">
                            <div className="review-core-share-asset-header">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={(e) => {
                                  const ids = assetVersions.map(v => v.id);
                                  if (e.target.checked) {
                                    setShareVersionIds(prev => Array.from(new Set([...prev, ...ids])));
                                  } else {
                                    setShareVersionIds(prev => prev.filter(id => !ids.includes(id)));
                                  }
                                }}
                              />
                              <span onClick={() => setExpandedAssetIds(prev => prev.includes(assetId) ? prev.filter(id => id !== assetId) : [...prev, assetId])} className="review-core-share-asset-name">
                                {asset.filename}
                                <span className="version-count">({assetVersions.length} versions)</span>
                              </span>
                              <button className="btn-link btn-xs" onClick={() => setExpandedAssetIds(prev => prev.includes(assetId) ? prev.filter(id => id !== assetId) : [...prev, assetId])}>
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="review-core-share-asset-versions">
                                {assetVersions.map((version) => (
                                  <label key={version.id} className="review-core-share-version-option">
                                    <input
                                      type="checkbox"
                                      checked={shareVersionIds.includes(version.id)}
                                      onChange={() =>
                                        setShareVersionIds((prev) =>
                                          prev.includes(version.id) ? prev.filter((item) => item !== version.id) : [...prev, version.id].sort()
                                        )
                                      }
                                    />
                                    <span>{formatShareVersionLabel(version)}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="review-core-share-options">
                      <label className="review-core-share-toggle">
                        <input type="checkbox" checked={shareAllowComments} onChange={(event) => setShareAllowComments(event.target.checked)} />
                        <span>Allow comments</span>
                      </label>
                      <label className="review-core-share-toggle">
                        <input type="checkbox" checked={shareAllowDownload} onChange={(event) => setShareAllowDownload(event.target.checked)} />
                        <span>Allow proxy download</span>
                      </label>
                    </div>
                    <div className="review-core-share-fields">
                      <input
                        className="input-text"
                        type="datetime-local"
                        value={shareExpiryLocal}
                        onChange={(event) => setShareExpiryLocal(event.target.value)}
                      />
                      <input
                        className="input-text"
                        type="password"
                        value={sharePassword}
                        onChange={(event) => setSharePassword(event.target.value)}
                        placeholder="Optional password"
                        maxLength={120}
                      />
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleCreateShareLink}
                        disabled={creatingShareLink || shareVersionIds.length === 0}
                      >
                        <Link2 size={14} />
                        <span>{creatingShareLink ? "Creating…" : "Create share link"}</span>
                      </button>
                    </div>
                  </div>

                  <div className="review-core-share-links-list">
                    {shareLinks.map((shareLink) => (
                      <div key={shareLink.id} className="review-core-share-link-row">
                        <div className="review-core-share-link-main">
                          <strong>{buildShareLink(shareLink.token)}</strong>
                          <span>
                            {shareLink.asset_version_ids.length} version{shareLink.asset_version_ids.length !== 1 ? "s" : ""} ·
                            {shareLink.allow_comments ? " comments" : " read-only"} ·
                            {shareLink.allow_download ? " proxy download" : " no download"}
                            {shareLink.expires_at ? ` · expires ${new Date(shareLink.expires_at).toLocaleString()}` : ""}
                            {shareLink.password_required ? " · password" : ""}
                          </span>
                        </div>
                        <div className="review-core-share-link-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => handleCopyShareLink(shareLink)}>
                            <Copy size={14} />
                            <span>{copiedShareLinkId === shareLink.id ? "Copied" : "Copy link"}</span>
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => handleRevokeShareLink(shareLink.id)}>
                            <Trash2 size={14} />
                            <span>Revoke</span>
                          </button>
                        </div>
                      </div>
                    ))}
                    {shareLinks.length === 0 && <div className="empty-state">No share links created yet.</div>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">Select an asset to open the Review Core player.</div>
          )}
        </section>
      </div>

      {!isShareMode && pendingDuplicateFiles && duplicateCandidates.length > 0 && (
        <div className="review-core-duplicate-backdrop">
          <div className="review-core-duplicate-modal">
            <h3>Already imported</h3>
            <p>These files match media already imported for this workspace. The default action is to create a new version under the existing asset.</p>
            <div className="review-core-duplicate-list">
              {duplicateCandidates.map((item) => (
                <div key={`${item.file_path}-${item.existing_asset_id}`} className="review-core-duplicate-row">
                  <strong>{item.existing_filename}</strong>
                  <span>{item.file_path}</span>
                </div>
              ))}
            </div>
            <div className="review-core-duplicate-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => { setPendingDuplicateFiles(null); setDuplicateCandidates([]); }}>
                Cancel
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => runIngest(pendingDuplicateFiles, "new_asset")}>
                Import as new asset anyway
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => runIngest(pendingDuplicateFiles, "new_version")}>
                Create new version under existing asset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildShareLink(token: string) {
  return `${window.location.origin}/#/r/${token}`;
}

function buildMediaUrl({
  serverBaseUrl,
  projectId,
  assetId,
  versionId,
  type,
  file,
  shareToken,
  sessionToken,
}: {
  serverBaseUrl: string;
  projectId: string;
  assetId: string;
  versionId: string;
  type: "playlist" | "poster" | "thumb";
  file?: string;
  shareToken?: string | null;
  sessionToken?: string | null;
}) {
  const query = new URLSearchParams();
  if (shareToken) query.set("t", shareToken);
  if (sessionToken) query.set("s", sessionToken);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  if (type === "playlist") {
    return `${serverBaseUrl}/media/${projectId}/${assetId}/${versionId}/hls/index.m3u8${suffix}`;
  }
  if (type === "poster") {
    return `${serverBaseUrl}/media/${projectId}/${assetId}/${versionId}/poster.jpg${suffix}`;
  }
  return `${serverBaseUrl}/media/${projectId}/${assetId}/${versionId}/thumbs/${file}${suffix}`;
}

function buildProxyFileName(filename: string, versionNumber?: number) {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${base}${versionNumber ? `-v${versionNumber}` : ""}-proxy.mp4`;
}

function normalizeReviewerName(name?: string | null) {
  const trimmed = (name || "").trim();
  return trimmed || "Anonymous";
}

function getReviewerInitials(name?: string | null) {
  const normalized = normalizeReviewerName(name);
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function getReviewerColor(name?: string | null) {
  const normalized = normalizeReviewerName(name);
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return REVIEWER_PALETTE[hash % REVIEWER_PALETTE.length];
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function formatShareVersionLabel(version: CommonVersion) {
  return `v${version.version_number} • ${version.processing_status} • ${formatShortDate(version.created_at)}`;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isInternalAsset(asset: CommonAsset): asset is ReviewCoreAsset {
  return "checksum_sha256" in asset;
}

function getVersionLastError(version: CommonVersion | null, asset: CommonAsset | null) {
  const versionError = version && "last_error" in version ? version.last_error : null;
  const assetError = asset && isInternalAsset(asset) ? asset.last_error : null;
  return versionError || assetError || null;
}

function createEmptyAnnotationDraft(comment: ReviewCoreComment): AnnotationVectorData {
  return {
    schemaVersion: 1,
    commentId: comment.id,
    timestampMs: comment.timestamp_ms,
    items: [],
  };
}

function createEmptyFrameNoteDraft(timestampMs: number): FrameNoteVectorData {
  return {
    schemaVersion: 1,
    timestampMs,
    items: [],
  };
}

function parseAnnotationData(raw?: string | null, commentId?: string, timestampMs?: number): AnnotationVectorData | null {
  if (!raw) {
    return commentId && timestampMs != null
      ? { schemaVersion: 1, commentId, timestampMs, items: [] }
      : null;
  }
  try {
    const parsed = JSON.parse(raw) as AnnotationVectorData;
    return {
      schemaVersion: 1,
      commentId: parsed.commentId || commentId || "",
      timestampMs: parsed.timestampMs ?? timestampMs ?? 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return commentId && timestampMs != null
      ? { schemaVersion: 1, commentId, timestampMs, items: [] }
      : null;
  }
}

function parseFrameNoteData(raw?: string | null, timestampMs?: number): FrameNoteVectorData | null {
  if (!raw) {
    return timestampMs != null ? createEmptyFrameNoteDraft(timestampMs) : null;
  }
  try {
    const parsed = JSON.parse(raw) as any;
    if (Array.isArray(parsed)) {
      return {
        schemaVersion: 1,
        timestampMs: timestampMs ?? 0,
        items: parsed,
      };
    }
    return {
      schemaVersion: 1,
      timestampMs: parsed.timestampMs ?? timestampMs ?? 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return timestampMs != null ? createEmptyFrameNoteDraft(timestampMs) : null;
  }
}

function createItemId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDraftItem(tool: AnnotationTool, point: NormalizedPoint, style: AnnotationStyle): AnnotationItem | null {
  const id = createItemId();
  if (tool === "pen") {
    return { id, type: "pen", points: [point, point], style };
  }
  if (tool === "arrow") {
    return { id, type: "arrow", a: point, b: point, style };
  }
  if (tool === "rect") {
    return { id, type: "rect", x: point[0], y: point[1], w: 0, h: 0, style };
  }
  if (tool === "circle") {
    return { id, type: "circle", x: point[0], y: point[1], w: 0, h: 0, style };
  }
  return null;
}

function updateDraftItem(item: AnnotationItem, start: NormalizedPoint, point: NormalizedPoint): AnnotationItem {
  if (item.type === "pen") {
    return { ...item, points: [...item.points, point] };
  }
  if (item.type === "arrow") {
    return { ...item, b: point };
  }
  if (item.type === "rect" || item.type === "circle") {
    return {
      ...item,
      x: Math.min(start[0], point[0]),
      y: Math.min(start[1], point[1]),
      w: Math.abs(point[0] - start[0]),
      h: Math.abs(point[1] - start[1]),
    };
  }
  return item;
}

function translateAnnotationItem(item: AnnotationItem, deltaX: number, deltaY: number): AnnotationItem {
  if (item.type === "arrow") {
    return {
      ...item,
      a: [clamp01(item.a[0] + deltaX), clamp01(item.a[1] + deltaY)],
      b: [clamp01(item.b[0] + deltaX), clamp01(item.b[1] + deltaY)],
    };
  }
  if (item.type === "pen") {
    return {
      ...item,
      points: item.points.map(([x, y]) => [clamp01(x + deltaX), clamp01(y + deltaY)]),
    };
  }
  if (item.type === "text") {
    return { ...item, x: clamp01(item.x + deltaX), y: clamp01(item.y + deltaY) };
  }
  return {
    ...item,
    x: clamp01(item.x + deltaX),
    y: clamp01(item.y + deltaY),
  };
}

function hitTestAnnotationItem(items: AnnotationItem[], point: NormalizedPoint): AnnotationItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === "arrow") {
      if (distanceToSegment(point, item.a, item.b) <= 0.03) return item;
      continue;
    }
    if (item.type === "pen") {
      for (let i = 1; i < item.points.length; i += 1) {
        if (distanceToSegment(point, item.points[i - 1], item.points[i]) <= 0.025) return item;
      }
      continue;
    }
    if (item.type === "text") {
      if (Math.abs(point[0] - item.x) <= 0.06 && Math.abs(point[1] - item.y) <= 0.03) return item;
      continue;
    }
    if (point[0] >= item.x && point[0] <= item.x + item.w && point[1] >= item.y && point[1] <= item.y + item.h) {
      return item;
    }
  }
  return null;
}

function distanceToSegment(point: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint) {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  const cx = ax + clamped * dx;
  const cy = ay + clamped * dy;
  return Math.hypot(px - cx, py - cy);
}

function renderAnnotationItems(items: AnnotationItem[], selectedId: string | null) {
  return items.map((item) => {
    const isSelected = item.id === selectedId;
    const strokeWidth = (item.style?.width || 2) * (isSelected ? 1.4 : 1);
    const stroke = item.style?.stroke || DEFAULT_ANNOTATION_STYLE.stroke;
    if (item.type === "arrow") {
      return (
        <g key={item.id}>
          <defs>
            <marker id={`arrow-head-${item.id}`} markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={stroke} />
            </marker>
          </defs>
          <line
            x1={item.a[0] * 1000}
            y1={item.a[1] * 1000}
            x2={item.b[0] * 1000}
            y2={item.b[1] * 1000}
            stroke={stroke}
            strokeWidth={strokeWidth}
            markerEnd={`url(#arrow-head-${item.id})`}
          />
        </g>
      );
    }
    if (item.type === "pen") {
      const d = item.points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x * 1000} ${y * 1000}`).join(" ");
      return <path key={item.id} d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (item.type === "rect") {
      return <rect key={item.id} x={item.x * 1000} y={item.y * 1000} width={item.w * 1000} height={item.h * 1000} fill="none" stroke={stroke} strokeWidth={strokeWidth} />;
    }
    if (item.type === "circle") {
      return (
        <ellipse
          key={item.id}
          cx={(item.x + item.w / 2) * 1000}
          cy={(item.y + item.h / 2) * 1000}
          rx={(item.w * 1000) / 2}
          ry={(item.h * 1000) / 2}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }
    return (
      <text key={item.id} x={item.x * 1000} y={item.y * 1000} fill={stroke} fontSize={22} fontWeight={600}>
        {item.text}
      </text>
    );
  });
}

async function renderFrameNoteExport(note: ReviewCoreFrameNote) {
  const imageDataUrl = await invoke<string>("review_core_read_frame_note_image", {
    noteId: note.id,
  });
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const vector = parseFrameNoteData(note.vector_data, note.timestamp_ms);
  drawAnnotationItemsToCanvas(context, vector?.items || [], canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function drawAnnotationItemsToCanvas(
  context: CanvasRenderingContext2D,
  items: AnnotationItem[],
  width: number,
  height: number
) {
  for (const item of items) {
    const stroke = item.style?.stroke || DEFAULT_ANNOTATION_STYLE.stroke;
    const lineWidth = item.style?.width || DEFAULT_ANNOTATION_STYLE.width;
    context.strokeStyle = stroke;
    context.fillStyle = stroke;
    context.lineWidth = lineWidth * Math.max(1, width / 1000);
    context.lineCap = "round";
    context.lineJoin = "round";
    if (item.type === "arrow") {
      const ax = item.a[0] * width;
      const ay = item.a[1] * height;
      const bx = item.b[0] * width;
      const by = item.b[1] * height;
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
      const angle = Math.atan2(by - ay, bx - ax);
      const headLength = 12 * Math.max(1, width / 1000);
      context.beginPath();
      context.moveTo(bx, by);
      context.lineTo(bx - headLength * Math.cos(angle - Math.PI / 6), by - headLength * Math.sin(angle - Math.PI / 6));
      context.lineTo(bx - headLength * Math.cos(angle + Math.PI / 6), by - headLength * Math.sin(angle + Math.PI / 6));
      context.closePath();
      context.fill();
      continue;
    }
    if (item.type === "pen") {
      if (item.points.length < 2) continue;
      context.beginPath();
      context.moveTo(item.points[0][0] * width, item.points[0][1] * height);
      for (let index = 1; index < item.points.length; index += 1) {
        context.lineTo(item.points[index][0] * width, item.points[index][1] * height);
      }
      context.stroke();
      continue;
    }
    if (item.type === "rect") {
      context.strokeRect(item.x * width, item.y * height, item.w * width, item.h * height);
      continue;
    }
    if (item.type === "circle") {
      context.beginPath();
      context.ellipse(
        (item.x + item.w / 2) * width,
        (item.y + item.h / 2) * height,
        (item.w * width) / 2,
        (item.h * height) / 2,
        0,
        0,
        Math.PI * 2
      );
      context.stroke();
      continue;
    }
    context.font = `${Math.max(18, width * 0.022)}px sans-serif`;
    context.fillText(item.text, item.x * width, item.y * height);
  }
}

async function loadImage(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed loading image: ${src}`));
    image.src = src;
  });
}

function getVideoFrameRect(container: HTMLDivElement, video: HTMLVideoElement): OverlayFrameRect {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!video.videoWidth || !video.videoHeight || width <= 0 || height <= 0) {
    return { left: 0, top: 0, width, height };
  }
  const videoAspect = video.videoWidth / video.videoHeight;
  const containerAspect = width / height;
  if (containerAspect > videoAspect) {
    const fittedWidth = height * videoAspect;
    return {
      left: (width - fittedWidth) / 2,
      top: 0,
      width: fittedWidth,
      height,
    };
  }
  const fittedHeight = width / videoAspect;
  return {
    left: 0,
    top: (height - fittedHeight) / 2,
    width,
    height: fittedHeight,
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs) return "00:00";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatResolution(asset: Pick<CommonAsset, "width" | "height">) {
  if (!asset.width || !asset.height) return "Unknown res";
  return `${asset.width}×${asset.height}`;
}

function formatFps(fps?: number | null) {
  if (!fps) return "Unknown fps";
  return `${fps.toFixed(2)} fps`;
}

function formatTimecode(seconds: number, asset: Pick<CommonAsset, "frame_rate" | "avg_frame_rate" | "r_frame_rate" | "is_vfr">) {
  const safeFps = normalizePlaybackFps(asset.avg_frame_rate || asset.r_frame_rate, asset.frame_rate);
  if (asset.is_vfr) {
    return formatApproxTime(seconds);
  }
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const frames = Math.floor((seconds - wholeSeconds) * safeFps);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function normalizePlaybackFps(rawRate?: string | null, fallback?: number | null) {
  if (rawRate && rawRate.includes("/")) {
    const [num, den] = rawRate.split("/").map((value) => Number(value));
    if (num > 0 && den > 0) return num / den;
  }
  return fallback && fallback > 0 ? fallback : 24;
}

function formatApproxTime(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const millis = Math.floor((seconds - wholeSeconds) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
