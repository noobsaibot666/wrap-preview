import { useMemo } from "react";
import { useReviewLogic } from "./ReviewCore/useReviewLogic";
import { ReviewCoreHeader } from "./ReviewCore/ReviewCoreHeader";
import { AssetLibrary } from "./ReviewCore/AssetLibrary";
import { ReviewPlayer } from "./ReviewCore/ReviewPlayer";
import { FeedbackSidebar } from "./ReviewCore/FeedbackSidebar";
import { AnnotationOverlay } from "./ReviewCore/AnnotationOverlay";
import {
  ReviewProjectPicker,
} from "./ReviewCore/ReviewProjectPicker";
import { ReviewCoreProps } from "./ReviewCore/types";
import {
  CommonAsset,
  CommonVersion,
} from "./ReviewCore/types";

export function ReviewCore(props: ReviewCoreProps) {
  const { state, handlers, setters, refs } = useReviewLogic(props);

  const {
    isShareMode,
    usesEmbeddedProjectPicker,
    assets,
    loading,
    selectedAssetId,
    activeProject,
    recentProjects,
    loadingProjects,
    creatingProject,
    newProjectName,
    currentTime,
    duration,
    mediaReadyStatus,
    grabbingFrame,
    comments,
    selectedCommentId,
    commentText,
    commentAuthor,
    submittingComment,
    approval,
    savingApproval,
    feedbackSearch,
    annotationDraft,
    activeDraftItem,
    frameRect,
    librarySearch,
    librarySort,
    activeViewAnnotation,
    selectedVersionId,
    versions,
  } = state;

  const selectedAsset = useMemo(() =>
    assets.find((a: CommonAsset) => a.id === selectedAssetId) || null
    , [assets, selectedAssetId]);

  const selectedVersion = useMemo(() =>
    versions.find((v: CommonVersion) => v.id === selectedVersionId) || null
    , [versions, selectedVersionId]);

  if (usesEmbeddedProjectPicker && !state.activeProject) {
    return (
      <div className="h-full w-full bg-[#050505]">
        <ReviewProjectPicker
          projects={recentProjects}
          activeProject={activeProject}
          onSelectProject={(id) => {
            const p = recentProjects.find(x => x.id === id);
            if (p) setters.setActiveProject(p);
          }}
          loading={loadingProjects}
          onCreateProject={handlers.refreshProjects}
          newProjectName={newProjectName}
          setNewProjectName={setters.setNewProjectName}
          creating={creatingProject}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#050505] text-white overflow-hidden font-sans selection:bg-white/20">
      <ReviewCoreHeader
        project={activeProject}
        subtitle={selectedAsset?.filename || "No asset selected"}
        isShareMode={isShareMode}
        onImport={handlers.handleImport}
        onBackToProjects={() => setters.setActiveProject(null)}
        importing={state.importing}
        onShowShare={() => setters.setActivePanelTab("share")}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {!isShareMode && (
          <aside className="w-[300px] shrink-0 overflow-hidden">
            <AssetLibrary
              assets={assets}
              selectedAssetId={selectedAssetId}
              onSelectAsset={(id) => setters.setSelectedAssetId(id)}
              loading={loading}
              searchQuery={librarySearch}
              onSearchChange={setters.setLibrarySearch}
              sortOrder={librarySort}
              onSortChange={setters.setLibrarySort}
            />
          </aside>
        )}

        {/* Main Player Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-black relative">
          <ReviewPlayer
            videoRef={refs.videoRef}
            videoStageRef={refs.videoStageRef}
            asset={selectedAsset}
            version={selectedVersion}
            currentTime={currentTime}
            duration={duration}
            mediaReadyStatus={mediaReadyStatus || "ready"}
            grabbingFrame={grabbingFrame}
            onSeek={handlers.handleThumbnailSeek}
            onGrabFrame={handlers.handleGrabFrame}
            onTogglePlay={() => {
              const v = refs.videoRef.current;
              if (v) v.paused ? v.play() : v.pause();
            }}
            isPaused={refs.videoRef.current?.paused ?? true}
            onShowSettings={() => { }}
            overlay={
              <AnnotationOverlay
                rect={frameRect}
                activeAnnotation={activeViewAnnotation}
                draft={annotationDraft}
                activeDraftItem={activeDraftItem}
                onMouseDown={handlers.openAnnotationEditor as any} // Temporary cast
                onMouseMove={handlers.handleAnnotationMouseMove}
                onMouseUp={handlers.handleAnnotationMouseUp}
              />
            }
          />
        </main>

        {/* Feedback Sidebar */}
        <FeedbackSidebar
          comments={comments}
          selectedCommentId={selectedCommentId}
          onSelectComment={handlers.seekToComment}
          onAddComment={handlers.addComment}
          commentText={commentText}
          setCommentText={setters.setCommentText}
          commentAuthor={commentAuthor}
          setCommentAuthor={setters.setCommentAuthor}
          submitting={submittingComment}
          approval={approval}
          onUpdateApproval={handlers.handleUpdateApproval}
          savingApproval={savingApproval}
          searchQuery={feedbackSearch}
          onSearchChange={setters.setFeedbackSearch}
          reviewerName={state.reviewerNameActive}
        />
      </div>
    </div>
  );
}
