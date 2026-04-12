import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type Hls from "hls.js";
import {
    ReviewCoreAnnotation,
    ReviewCoreApprovalState,
    ReviewCoreAsset,
    ReviewCoreAssetWithVersions,
    ReviewCoreAssetVersion,
    ReviewCoreComment,
    ReviewCoreExtractFrameResult,
    ReviewCoreFrameNote,
    ReviewCoreProjectSummary,
    ReviewCoreShareLinkResolved,
    ReviewCoreShareLinkSummary,
    ReviewCoreSharedVersionSummary,
    ReviewCoreThumbnailInfo,
} from "../../types";
import {
    AnnotationItem,
    AnnotationTool,
    AnnotationVectorData,
    ApprovalStatus,
    CommonAsset,
    CommonVersion,
    FrameNoteVectorData,
    NormalizedPoint,
    OverlayFrameRect,
    ReviewCorePanelTab,
    ReviewCoreProps,
} from "./types";
import {
    DEFAULT_ANNOTATION_STYLE,
    createEmptyAnnotationDraft,
    getVideoFrameRect,
    parseAnnotationData,
    updateDraftItem,
} from "./utils";

const DEFAULT_APPROVAL: ReviewCoreApprovalState = {
    asset_version_id: "",
    status: "draft",
    approved_at: null,
    approved_by: null,
};

export function useReviewLogic({
    projectId,
    projectName,
    shareToken,
    onError,
}: ReviewCoreProps) {
    const isShareMode = Boolean(shareToken);
    const usesEmbeddedProjectPicker = !isShareMode && !projectId;

    // --- State ---
    const [assets, setAssets] = useState<CommonAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [versions, setVersions] = useState<CommonVersion[]>([]);
    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
    const [serverBaseUrl, setServerBaseUrl] = useState("");
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [thumbnails, setThumbnails] = useState<ReviewCoreThumbnailInfo[]>([]);
    const [showErrorDetails, setShowErrorDetails] = useState(false);

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

    // --- Refs ---
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const videoStageRef = useRef<HTMLDivElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const pendingSeekSecondsRef = useRef<number | null>(null);
    const dragStateRef = useRef<{ mode: "draw" | "move"; start: NormalizedPoint; itemId?: string } | null>(null);
    const previousVersionStatusRef = useRef<string | null>(null);
    const processingPollAttemptRef = useRef<number>(0);

    const effectiveProjectId = activeProject?.id || shareResolved?.project_id || projectId;
    const shareAccessReady = !isShareMode || Boolean(shareResolved && (!shareResolved.password_required || shareSessionToken || shareUnlocked));
    const selectedVersion = useMemo(
        () => versions.find((version) => version.id === selectedVersionId) || null,
        [selectedVersionId, versions]
    );

    // --- Handlers ---
    const refreshProjects = useCallback(async () => {
        if (isShareMode) return;
        setLoadingProjects(true);
        try {
            const list = await invoke<ReviewCoreProjectSummary[]>("review_core_list_projects");
            setRecentProjects(list);
        } catch (error) {
            console.error("Failed to list projects", error);
        } finally {
            setLoadingProjects(false);
        }
    }, [isShareMode]);

    const refreshAssets = useCallback(async () => {
        if (isShareMode || !effectiveProjectId) return;
        setLoading(true);
        try {
            const list = await invoke<ReviewCoreAsset[]>("review_core_list_assets", { projectId: effectiveProjectId });
            setAssets(list);
        } catch (error) {
            console.error("Failed to list assets", error);
        } finally {
            setLoading(false);
        }
    }, [isShareMode, effectiveProjectId]);

    const refreshFrameNotes = useCallback(async () => {
        if (isShareMode || !effectiveProjectId) {
            setFrameNotes([]);
            return;
        }
        try {
            const notes = await invoke<ReviewCoreFrameNote[]>("review_core_list_frame_notes", { projectId: effectiveProjectId });
            setFrameNotes(notes);
        } catch (error) {
            console.error("Failed to list frame notes", error);
            setFrameNotes([]);
        }
    }, [effectiveProjectId, isShareMode]);

    const refreshVersions = useCallback(async (assetId: string) => {
        if (isShareMode && !shareAccessReady) {
            setVersions([]);
            return;
        }
        try {
            const list = isShareMode
                ? await invoke<ReviewCoreSharedVersionSummary[]>("review_core_share_list_versions", {
                    token: shareToken,
                    assetId,
                    sessionToken: shareSessionToken,
                })
                : await invoke<ReviewCoreAssetVersion[]>("review_core_list_asset_versions", { assetId });
            setVersions(list);
        } catch (error) {
            console.error("Failed to list versions", error);
            if (isShareMode) {
                setVersions([]);
            }
        }
    }, [isShareMode, shareAccessReady, shareToken, shareSessionToken]);

    const refreshShareAssets = useCallback(async () => {
        if (!isShareMode || !shareToken || !shareAccessReady) {
            setAssets([]);
            return;
        }
        setLoading(true);
        try {
            const sharedAssets = await invoke<ReviewCoreAsset[]>("review_core_share_list_assets", {
                token: shareToken,
                sessionToken: shareSessionToken,
            });
            setAssets(sharedAssets);
        } catch (error) {
            console.error("Failed to list shared assets", error);
            setAssets([]);
            onError?.({ title: "Shared review unavailable", hint: String(error) });
        } finally {
            setLoading(false);
        }
    }, [isShareMode, onError, shareAccessReady, shareSessionToken, shareToken]);

    const resetMedia = useCallback(() => {
        setVerifiedMediaUrls(null);
        setThumbnails([]);
        setMediaReadyStatus("idle");
    }, []);

    const handleThumbnailSeek = useCallback((seconds: number) => {
        const video = videoRef.current;
        pendingSeekSecondsRef.current = seconds;
        if (!video || !selectedVersionId) return; // Basic check
        if (video.readyState >= 1) {
            video.currentTime = seconds;
            pendingSeekSecondsRef.current = null;
        }
    }, [selectedVersionId]);

    const seekToComment = useCallback((comment: ReviewCoreComment) => {
        handleThumbnailSeek(comment.timestamp_ms / 1000);
        setSelectedCommentId(comment.id);
        setSelectedFrameNoteId(null);
    }, [handleThumbnailSeek]);

    const updateFrameRect = useCallback(() => {
        const container = videoStageRef.current;
        const video = videoRef.current;
        if (!container || !video) return;
        setFrameRect(getVideoFrameRect(container, video));
    }, []);

    const addComment = useCallback(async () => {
        if (!selectedVersionId) return;
        if (isShareMode && shareResolved && !shareResolved.allow_comments) {
            onError?.({ title: "Comments disabled", hint: "This shared review does not allow comments." });
            return;
        }
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
            setCommentText("");
            setSelectedCommentId(created.id);
        } catch (error) {
            console.error("Failed adding comment", error);
            onError?.({ title: "Add comment failed", hint: String(error) });
        } finally {
            setSubmittingComment(false);
        }
    }, [selectedVersionId, isShareMode, shareResolved, shareToken, currentTime, commentText, commentAuthor, shareSessionToken, onError]);

    // --- Media Effects ---
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleLoadedMetadata = () => {
            setDuration(video.duration || 0);
            updateFrameRect();
            if (pendingSeekSecondsRef.current != null && video.readyState >= 1) {
                video.currentTime = pendingSeekSecondsRef.current;
                pendingSeekSecondsRef.current = null;
            }
        };
        const handleCanPlay = () => {
            if (pendingSeekSecondsRef.current != null) {
                video.currentTime = pendingSeekSecondsRef.current;
                pendingSeekSecondsRef.current = null;
            }
            updateFrameRect();
        };
        const handleError = () => {
            if (video.poster) video.poster = "";
            setMediaReadyStatus((current) => (current === "ready" ? "finalizing" : current));
            setMediaReadyAttempt((attempt) => attempt + 1);
        };
        video.addEventListener("timeupdate", handleTimeUpdate);
        video.addEventListener("play", handlePlay);
        video.addEventListener("pause", handlePause);
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("canplay", handleCanPlay);
        video.addEventListener("error", handleError);
        return () => {
            video.removeEventListener("timeupdate", handleTimeUpdate);
            video.removeEventListener("play", handlePlay);
            video.removeEventListener("pause", handlePause);
            video.removeEventListener("loadedmetadata", handleLoadedMetadata);
            video.removeEventListener("canplay", handleCanPlay);
            video.removeEventListener("error", handleError);
        };
    }, [selectedAssetId, selectedVersionId, updateFrameRect]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !verifiedMediaUrls || mediaReadyStatus !== "ready") return;
        video.poster = verifiedMediaUrls.posterUrl;
        video.pause();
        video.removeAttribute("src");
        // Do NOT call video.load() here — HLS.js manages media loading.
        // Calling load() before attaching HLS corrupts the pipeline.
        setCurrentTime(0);
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        let isMounted = true;
        const initHls = async () => {
            const { default: HlsClass } = await import("hls.js");
            if (!isMounted) return;

            if (HlsClass.isSupported()) {
                const hls = new HlsClass();
                // 1. Attach media FIRST (HLS.js requirement)
                hls.attachMedia(video);
                // 2. Apply any pending seek once manifest is ready
                hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                    if (pendingSeekSecondsRef.current != null) {
                        video.currentTime = pendingSeekSecondsRef.current;
                        pendingSeekSecondsRef.current = null;
                    }
                });
                // 3. Handle fatal HLS errors
                hls.on(HlsClass.Events.ERROR, (_event, data) => {
                    if (data.fatal) {
                        if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
                            setMediaReadyStatus("finalizing");
                            setMediaReadyAttempt((a) => a + 1);
                        } else {
                            setMediaReadyStatus("failed");
                        }
                    }
                });
                // 4. Load source LAST
                hls.loadSource(verifiedMediaUrls.playlistUrl);
                hlsRef.current = hls;
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = verifiedMediaUrls.playlistUrl;
            }
        };

        void initHls();

        return () => {
            isMounted = false;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [mediaReadyStatus, verifiedMediaUrls]);

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
    }, [selectedAssetId, selectedVersionId, updateFrameRect]);


    const annotationsByCommentId = useMemo(() => {
        const map = new Map<string, ReviewCoreAnnotation>();
        for (const annotation of annotations) map.set(annotation.comment_id, annotation);
        return map;
    }, [annotations]);

    const activeViewAnnotation = useMemo(() => {
        if (annotatingCommentId) return null;
        const activeComment = comments.find(
            (comment) => Math.abs(comment.timestamp_ms - currentTime * 1000) <= 250 && annotationsByCommentId.has(comment.id)
        );
        return activeComment ? annotationsByCommentId.get(activeComment.id) || null : null;
    }, [annotatingCommentId, annotationsByCommentId, comments, currentTime]);

    const handleGrabFrame = useCallback(async () => {
        if (!selectedVersionId || !selectedAssetId || isShareMode) return;
        setGrabbingFrame(true);
        try {
            await invoke<ReviewCoreExtractFrameResult>("review_core_extract_frame", {
                assetVersionId: selectedVersionId,
                timestampMs: Math.round(currentTime * 1000),
            });
            await refreshFrameNotes();
        } catch (error) {
            console.error("Failed extracting frame", error);
            onError?.({ title: "Grab frame failed", hint: String(error) });
        } finally {
            setGrabbingFrame(false);
        }
    }, [selectedVersionId, selectedAssetId, isShareMode, currentTime, onError, refreshFrameNotes]);

    const openAnnotationEditor = useCallback((comment: ReviewCoreComment) => {
        if (isShareMode) return;
        seekToComment(comment);
        videoRef.current?.pause();
        const existing = annotationsByCommentId.get(comment.id);
        setAnnotatingCommentId(comment.id);
        setAnnotationTool("pointer");
        setSelectedAnnotationItemId(null);
        setActiveDraftItem(null);
        setAnnotationDraft(existing ? parseAnnotationData(existing.vector_data, comment.id, comment.timestamp_ms) : createEmptyAnnotationDraft(comment));
    }, [isShareMode, seekToComment, annotationsByCommentId]);

    const saveAnnotation = useCallback(async () => {
        if (!annotatingCommentId || !annotationDraft || isShareMode) return;
        setSavingAnnotation(true);
        try {
            const saved = await invoke<ReviewCoreAnnotation>("review_core_add_annotation", {
                commentId: annotatingCommentId,
                vectorDataJson: JSON.stringify(annotationDraft),
            });
            setAnnotations((prev) => [...prev.filter((item) => item.comment_id !== annotatingCommentId), saved]);
            setAnnotatingCommentId(null);
            setAnnotationDraft(null);
        } catch (error) {
            console.error("Failed saving annotation", error);
            onError?.({ title: "Save annotation failed", hint: String(error) });
        } finally {
            setSavingAnnotation(false);
        }
    }, [annotatingCommentId, annotationDraft, isShareMode, onError]);


    const runIngest = useCallback(async (filePaths: string[], duplicateMode: "new_version" | "new_asset") => {
        if (!effectiveProjectId) return;
        setImporting(true);
        try {
            await invoke("review_core_ingest_files", { projectId: effectiveProjectId, filePaths, duplicateMode });
            await refreshAssets();
        } catch (error) {
            console.error("Review Core ingest failed", error);
        } finally {
            setImporting(false);
        }
    }, [effectiveProjectId, refreshAssets]);

    const handleImport = useCallback(async () => {
        if (isShareMode) return;
        const selected = await open({
            multiple: true,
            directory: false,
            title: "Import media into Review Core",
        });
        if (!selected || !effectiveProjectId) return;
        const filePaths = Array.isArray(selected) ? selected : [selected];
        await runIngest(filePaths, "new_version");
    }, [isShareMode, effectiveProjectId, runIngest]);

    const handleCreateShareLink = useCallback(async () => {
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
            setCopiedShareLinkId(created.id);
        } catch (error) {
            console.error("Failed creating share link", error);
        } finally {
            setCreatingShareLink(false);
        }
    }, [effectiveProjectId, isShareMode, shareVersionIds, shareExpiryLocal, sharePassword, shareAllowComments, shareAllowDownload]);

    const handleAnnotationMouseDown = useCallback((point: NormalizedPoint) => {
        if (isShareMode || !annotatingCommentId) return;

        dragStateRef.current = { mode: "draw", start: point };
        const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();

        let newItem: AnnotationItem;
        if (annotationTool === "pen") {
            newItem = {
                id,
                type: "pen",
                points: [point],
                style: { stroke: annotationColor, width: 2 }
            };
        } else if (annotationTool === "arrow") {
            newItem = {
                id,
                type: "arrow",
                a: point,
                b: point,
                style: { stroke: annotationColor, width: 2 }
            };
        } else if (annotationTool === "rect") {
            newItem = {
                id,
                type: "rect",
                x: point[0],
                y: point[1],
                w: 0,
                h: 0,
                style: { stroke: annotationColor, width: 2 }
            };
        } else if (annotationTool === "circle") {
            newItem = {
                id,
                type: "circle",
                x: point[0],
                y: point[1],
                w: 0,
                h: 0,
                style: { stroke: annotationColor, width: 2 }
            };
        } else {
            return;
        }

        setActiveDraftItem(newItem);
    }, [isShareMode, annotatingCommentId, annotationTool, annotationColor]);

    const handleAnnotationMouseMove = useCallback((point: NormalizedPoint) => {
        const drag = dragStateRef.current;
        if (!drag || isShareMode) return;

        if (drag.mode === "draw" && activeDraftItem) {
            setActiveDraftItem(updateDraftItem(activeDraftItem, drag.start, point));
        }
    }, [isShareMode, activeDraftItem]);

    const handleAnnotationMouseUp = useCallback(() => {
        const drag = dragStateRef.current;
        dragStateRef.current = null;
        if (drag?.mode === "draw" && activeDraftItem) {
            setAnnotationDraft((current) =>
                current ? { ...current, items: [...current.items, activeDraftItem] } : current
            );
            setActiveDraftItem(null);
        }
    }, [activeDraftItem]);

    const handleUpdateApproval = useCallback(async (status: ApprovalStatus) => {
        if (!selectedVersionId || isShareMode) return;
        setSavingApproval(true);
        try {
            const updated = await invoke<ReviewCoreApprovalState>("review_core_set_approval", {
                assetVersionId: selectedVersionId,
                status,
                approvedBy: approvalName,
            });
            setApproval(updated);
        } catch (error) {
            console.error("Failed updating approval", error);
            onError?.({ title: "Update approval failed", hint: String(error) });
        } finally {
            setSavingApproval(false);
        }
    }, [selectedVersionId, isShareMode, approvalName, onError]);

    const handleCreateProject = useCallback(async (name: string) => {
        if (isShareMode) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        setCreatingProject(true);
        try {
            const created = await invoke<ReviewCoreProjectSummary>("review_core_create_project", { name: trimmed });
            setNewProjectName("");
            setRecentProjects((prev) => [created, ...prev.filter((project) => project.id !== created.id)]);
            setActiveProject(created);
        } catch (error) {
            console.error("Failed to create Review Core project", error);
            onError?.({ title: "Create project failed", hint: String(error) });
        } finally {
            setCreatingProject(false);
        }
    }, [isShareMode, onError]);

    useEffect(() => {
        if (!isShareMode || !shareToken) return;

        setLoading(true);
        setSharePasswordError(null);

        void invoke<ReviewCoreShareLinkResolved>("review_core_resolve_share_link", { token: shareToken })
            .then((resolved) => {
                setShareResolved(resolved);
                setActiveProject({
                    id: resolved.project_id,
                    name: resolved.project_name,
                    last_opened_at: new Date().toISOString(),
                });
                if (!resolved.password_required) {
                    setShareUnlocked(true);
                    setShareSessionToken(null);
                } else {
                    setShareUnlocked(Boolean(shareSessionToken));
                }
            })
            .catch((error) => {
                console.error("Failed to resolve share link", error);
                setShareResolved(null);
                setAssets([]);
                setVersions([]);
                setShareUnlocked(false);
                setSharePasswordError(String(error));
                onError?.({ title: "Shared review unavailable", hint: String(error) });
            })
            .finally(() => {
                setLoading(false);
            });
    }, [isShareMode, onError, shareSessionToken, shareToken]);

    useEffect(() => {
        if (isShareMode) return;
        if (usesEmbeddedProjectPicker) {
            void refreshProjects();
        }
    }, [isShareMode, refreshProjects, usesEmbeddedProjectPicker]);

    useEffect(() => {
        if (isShareMode || !projectId) return;
        setActiveProject((current) => {
            if (current?.id === projectId) {
                if (projectName && current.name !== projectName) {
                    return { ...current, name: projectName };
                }
                return current;
            }
            return {
                id: projectId,
                name: projectName || current?.name || "Review Core",
                last_opened_at: current?.last_opened_at || new Date().toISOString(),
            };
        });
    }, [isShareMode, projectId, projectName]);

    useEffect(() => {
        if (isShareMode) {
            if (shareAccessReady) {
                void refreshShareAssets();
            } else {
                setAssets([]);
                setVersions([]);
                setSelectedAssetId(null);
            }
            return;
        }
        if (!effectiveProjectId) return;

        void invoke("review_core_touch_project", { projectId: effectiveProjectId }).catch((error) => {
            console.error("Failed to touch Review Core project", error);
        });

        void refreshAssets();
        void refreshFrameNotes();

        void invoke<ReviewCoreShareLinkSummary[]>("review_core_list_share_links", { projectId: effectiveProjectId })
            .then(setShareLinks)
            .catch((error) => {
                console.error("Failed to list share links", error);
                setShareLinks([]);
            });
    }, [effectiveProjectId, isShareMode, refreshAssets, refreshFrameNotes, refreshShareAssets, shareAccessReady]);

    useEffect(() => {
        void invoke<string>("review_core_get_server_base_url")
            .then((url) => setServerBaseUrl(url))
            .catch((error) => {
                console.error("Failed to get Review Core server URL", error);
                setServerBaseUrl("");
            });
    }, []);

    useEffect(() => {
        setSelectedAssetId((current) => {
            if (!assets.length) return null;
            if (current && assets.some((asset) => asset.id === current)) return current;
            return assets[0].id;
        });
    }, [assets]);

    useEffect(() => {
        resetMedia();
        processingPollAttemptRef.current = 0;
        setVersions([]);
        setSelectedVersionId(null);
        setComments([]);
        setAnnotations([]);
        setApproval(DEFAULT_APPROVAL);
        setThumbnails([]);

        if (!selectedAssetId) {
            return;
        }

        void refreshVersions(selectedAssetId);
    }, [refreshVersions, resetMedia, selectedAssetId]);

    useEffect(() => {
        setSelectedVersionId((current) => {
            if (!versions.length) return null;
            if (current && versions.some((version) => version.id === current)) return current;
            return [...versions]
                .sort((a, b) => {
                    const versionDelta = (b.version_number ?? 0) - (a.version_number ?? 0);
                    if (versionDelta !== 0) return versionDelta;
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                })[0]?.id ?? null;
        });
    }, [versions]);

    useEffect(() => {
        resetMedia();
        setComments([]);
        setAnnotations([]);
        setApproval(DEFAULT_APPROVAL);
        setThumbnails([]);

        if (isShareMode && !shareAccessReady) {
            return;
        }

        if (!selectedVersionId || !selectedAssetId) {
            return;
        }

        if (!isShareMode) {
            void invoke<ReviewCoreApprovalState>("review_core_get_approval", { assetVersionId: selectedVersionId })
                .then(setApproval)
                .catch((error) => {
                    console.error("Failed to load approval state", error);
                    setApproval({ ...DEFAULT_APPROVAL, asset_version_id: selectedVersionId });
                });
        }

        const commentCommand = isShareMode ? "review_core_share_list_comments" : "review_core_list_comments";
        const annotationCommand = isShareMode ? "review_core_share_list_annotations" : "review_core_list_annotations";
        const thumbnailCommand = isShareMode ? "review_core_share_list_thumbnails" : "review_core_list_thumbnails";
        const shareArgs = isShareMode
            ? { token: shareToken, assetVersionId: selectedVersionId, sessionToken: shareSessionToken }
            : { assetVersionId: selectedVersionId };
        const thumbnailArgs = isShareMode
            ? { token: shareToken, assetVersionId: selectedVersionId, sessionToken: shareSessionToken }
            : { versionId: selectedVersionId };

        void invoke<ReviewCoreComment[]>(commentCommand, shareArgs)
            .then((items) => setComments(items.sort((a, b) => a.timestamp_ms - b.timestamp_ms)))
            .catch((error) => {
                console.error("Failed to load comments", error);
                setComments([]);
            });

        void invoke<ReviewCoreAnnotation[]>(annotationCommand, shareArgs)
            .then(setAnnotations)
            .catch((error) => {
                console.error("Failed to load annotations", error);
                setAnnotations([]);
            });

        void invoke<ReviewCoreThumbnailInfo[]>(thumbnailCommand, thumbnailArgs)
            .then(setThumbnails)
            .catch((error) => {
                console.error("Failed to load thumbnails", error);
                setThumbnails([]);
            });
    }, [isShareMode, resetMedia, selectedAssetId, selectedVersionId, shareAccessReady, shareSessionToken, shareToken]);

    useEffect(() => {
        previousVersionStatusRef.current = selectedVersion?.processing_status || null;
        setMediaProbeNonce((value) => value + 1);

        if (!selectedVersion || !selectedAssetId || !effectiveProjectId) {
            setVerifiedMediaUrls(null);
            setMediaReadyStatus("idle");
            return;
        }

        if (selectedVersion.processing_status === "failed") {
            setVerifiedMediaUrls(null);
            setMediaReadyStatus("failed");
            return;
        }

        if (selectedVersion.processing_status !== "ready") {
            setVerifiedMediaUrls(null);
            setMediaReadyStatus("processing");
            return;
        }

        if (!serverBaseUrl) {
            setVerifiedMediaUrls(null);
            setMediaReadyStatus("finalizing");
            return;
        }

        const params = new URLSearchParams();
        if (isShareMode && shareToken) params.set("t", shareToken);
        if (isShareMode && shareSessionToken) params.set("s", shareSessionToken);
        const query = params.toString();
        const suffix = query ? `?${query}` : "";

        setVerifiedMediaUrls({
            playlistUrl: `${serverBaseUrl}/media/${effectiveProjectId}/${selectedAssetId}/${selectedVersion.id}/hls/index.m3u8${suffix}`,
            posterUrl: `${serverBaseUrl}/media/${effectiveProjectId}/${selectedAssetId}/${selectedVersion.id}/poster.jpg${suffix}`,
        });
        setMediaReadyStatus("finalizing");
        setMediaReadyAttempt(0);
    }, [effectiveProjectId, isShareMode, selectedAssetId, selectedVersion, serverBaseUrl, shareSessionToken, shareToken]);

    useEffect(() => {
        if (!selectedAssetId || !selectedVersion) {
            return;
        }
        if (selectedVersion.processing_status === "ready") {
            return;
        }
        if (selectedVersion.processing_status === "failed") {
            return;
        }

        processingPollAttemptRef.current += 1;
        if (processingPollAttemptRef.current > 30) {
            // ~75s total at 2500ms intervals — give up and surface as failed
            setMediaReadyStatus("failed");
            return;
        }

        const timer = window.setTimeout(() => {
            void refreshVersions(selectedAssetId);
        }, 2500);

        return () => window.clearTimeout(timer);
    }, [refreshVersions, selectedAssetId, selectedVersion]);

    useEffect(() => {
        if (!verifiedMediaUrls || !selectedVersion || selectedVersion.processing_status !== "ready") {
            return;
        }

        let cancelled = false;
        const controller = new AbortController();
        const probeAttempt = mediaReadyAttempt;
        const playlistUrl = `${verifiedMediaUrls.playlistUrl}${verifiedMediaUrls.playlistUrl.includes("?") ? "&" : "?"}probe=${mediaProbeNonce}-${probeAttempt}`;

        const assetId = selectedAssetId;
        if (!assetId) {
            return;
        }

        const probe = async () => {
            try {
                const response = await fetch(playlistUrl, {
                    method: "GET",
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(`Manifest probe failed with ${response.status}`);
                }
                const manifest = await response.text();
                if (!manifest.includes("#EXTM3U")) {
                    throw new Error("Manifest probe returned invalid data");
                }
                if (!cancelled) {
                    setMediaReadyStatus("ready");
                }
            } catch (error) {
                if (cancelled || controller.signal.aborted) {
                    return;
                }
                console.error("Media probe failed", error);
                setMediaReadyStatus("finalizing");
                if (probeAttempt >= 20) {
                    setMediaReadyStatus("failed");
                    return;
                }
                window.setTimeout(() => {
                    if (!cancelled) {
                        setMediaReadyAttempt((attempt) => attempt + 1);
                        // Do NOT call refreshVersions here — the polling effect handles version refresh.
                        // Calling it here creates a cascade that resets mediaReadyAttempt to 0.
                    }
                }, 1500);
            }
        };

        void probe();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [mediaProbeNonce, mediaReadyAttempt, refreshVersions, selectedAssetId, selectedVersion, verifiedMediaUrls]);

    return {
        state: {
            isShareMode,
            usesEmbeddedProjectPicker,
            assets,
            loading,
            importing,
            selectedAssetId,
            versions,
            selectedVersionId,
            serverBaseUrl,
            currentTime,
            duration,
            thumbnails,
            showErrorDetails,

            comments,
            annotations,
            approval,
            approvalName,
            savingApproval,
            commentText,
            commentAuthor,
            selectedCommentId,
            submittingComment,
            editingCommentId,
            editingCommentText,
            savingCommentId,
            annotatingCommentId,
            annotationTool,
            annotationDraft,
            annotationTextValue,
            selectedAnnotationItemId,
            activeDraftItem,
            savingAnnotation,
            frameRect,
            annotationColor,
            shareLinks,
            shareVersionIds,
            shareAllowComments,
            shareAllowDownload,
            sharePassword,
            shareExpiryLocal,
            creatingShareLink,
            copiedShareLinkId,
            shareResolved,
            sharePasswordInput,
            shareUnlocked,
            shareSessionToken,
            verifyingSharePassword,
            sharePasswordError,
            downloading,
            librarySearch,
            librarySort,
            shareVersionSearch,
            reviewerNameInput,
            reviewerNameActive,
            expandedAssetIds,
            markerHoverId,
            activeProject,
            recentProjects,
            loadingProjects,
            creatingProject,
            newProjectName,
            shareLibrary,
            frameNotes,
            grabbingFrame,
            feedbackSearch,
            showFrameNotes,
            selectedFrameNoteId,
            editingFrameNoteId,
            frameNoteDraft,
            savingFrameNote,
            exportingFrameNoteId,
            onionSkinEnabled,
            onionSkinOpacity,
            showQuickNoteComposer,
            activePanelTab,
            mediaReadyStatus,
            isPlaying,
            mediaReadyAttempt,
            verifiedMediaUrls,
            mediaProbeNonce,
            frameNoteImageCache,
            annotationsByCommentId,
            activeViewAnnotation,
        },
        setters: {
            setAssets,
            setLoading,
            setImporting,
            setSelectedAssetId,
            setVersions,
            setSelectedVersionId,
            setServerBaseUrl,
            setCurrentTime,
            setDuration,
            setThumbnails,
            setShowErrorDetails,
            setComments,
            setAnnotations,
            setApproval,
            setApprovalName,
            setSavingApproval,
            setCommentText,
            setCommentAuthor,
            setSelectedCommentId,
            setSubmittingComment,
            setEditingCommentId,
            setEditingCommentText,
            setSavingCommentId,
            setAnnotatingCommentId,
            setAnnotationTool,
            setAnnotationDraft,
            setAnnotationTextValue,
            setSelectedAnnotationItemId,
            setActiveDraftItem,
            setSavingAnnotation,
            setFrameRect,
            setAnnotationColor,
            setShareLinks,
            setShareVersionIds,
            setShareAllowComments,
            setShareAllowDownload,
            setSharePassword,
            setShareExpiryLocal,
            setCreatingShareLink,
            setCopiedShareLinkId,
            setShareResolved,
            setSharePasswordInput,
            setShareUnlocked,
            setShareSessionToken,
            setVerifyingSharePassword,
            setSharePasswordError,
            setDownloading,
            setLibrarySearch,
            setLibrarySort,
            setShareVersionSearch,
            setReviewerNameInput,
            setReviewerNameActive,
            setExpandedAssetIds,
            setMarkerHoverId,
            setActiveProject,
            setRecentProjects,
            setLoadingProjects,
            setCreatingProject,
            setNewProjectName,
            setShareLibrary,
            setFrameNotes,
            setGrabbingFrame,
            setFeedbackSearch,
            setShowFrameNotes,
            setSelectedFrameNoteId,
            setEditingFrameNoteId,
            setFrameNoteDraft,
            setSavingFrameNote,
            setExportingFrameNoteId,
            setOnionSkinEnabled,
            setOnionSkinOpacity,
            setShowQuickNoteComposer,
            setActivePanelTab,
            setMediaReadyStatus,
            setMediaReadyAttempt,
            setVerifiedMediaUrls,
            setMediaProbeNonce,
            setFrameNoteImageCache,
        },
        refs: {
            videoRef,
            videoStageRef,
            hlsRef,
            pendingSeekSecondsRef,
            dragStateRef,
            previousVersionStatusRef,
        },
        handlers: {
            refreshProjects,
            refreshAssets,
            refreshFrameNotes,
            refreshVersions,
            resetMedia,
            handleThumbnailSeek,
            seekToComment,
            updateFrameRect,
            addComment,
            handleGrabFrame,
            openAnnotationEditor,
            saveAnnotation,
            handleImport,
            runIngest,
            handleCreateShareLink,
            handleAnnotationMouseDown,
            handleAnnotationMouseMove,
            handleAnnotationMouseUp,
            handleUpdateApproval,
            handleCreateProject,
        },
    };
}
