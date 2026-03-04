import React, { useMemo } from "react";
import {
    MessageSquare,
    Send,
    Search,
    Filter,
    User,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { ReviewCoreComment, ReviewCoreApprovalState, ApprovalStatus } from "./types";
import { getReviewerInitials, getReviewerColor, formatDuration } from "./utils";

interface FeedbackSidebarProps {
    comments: ReviewCoreComment[];
    selectedCommentId: string | null;
    onSelectComment: (comment: ReviewCoreComment) => void;
    onAddComment: () => void;
    commentText: string;
    setCommentText: (text: string) => void;
    commentAuthor: string;
    setCommentAuthor: (name: string) => void;
    submitting: boolean;
    approval: ReviewCoreApprovalState;
    onUpdateApproval: (status: ApprovalStatus) => void;
    savingApproval: boolean;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    reviewerName: string | null;
}

export const FeedbackSidebar: React.FC<FeedbackSidebarProps> = ({
    comments,
    selectedCommentId,
    onSelectComment,
    onAddComment,
    commentText,
    setCommentText,
    commentAuthor,
    setCommentAuthor,
    submitting,
    approval,
    onUpdateApproval,
    savingApproval,
    searchQuery,
    onSearchChange,
    reviewerName,
}) => {
    const filteredComments = useMemo(() => {
        if (!searchQuery) return comments;
        const lower = searchQuery.toLowerCase();
        return comments.filter(c =>
            c.text.toLowerCase().includes(lower) ||
            (c.author_name || "").toLowerCase().includes(lower)
        );
    }, [comments, searchQuery]);

    return (
        <div className="w-[380px] border-l border-white/5 bg-black/20 flex flex-col shrink-0">
            {/* Header / Tabs */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-white/40" />
                    <h2 className="text-sm font-semibold tracking-tight uppercase">Feedback</h2>
                    <span className="px-1.5 py-0.5 bg-white/5 rounded text-[10px] text-white/40 font-mono">
                        {comments.length}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/40 hover:text-white">
                        <Filter className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Approval Status */}
            <div className="p-4 bg-white/[0.01] border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/20">Approval Status</span>
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${approval.status === "approved" ? "bg-emerald-500/10 text-emerald-500" :
                        approval.status === "changes_requested" ? "bg-orange-500/10 text-orange-500" :
                            "bg-white/5 text-white/40"
                        }`}>
                        {approval.status.replace("_", " ")}
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => onUpdateApproval("approved")}
                        disabled={savingApproval || approval.status === "approved"}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${approval.status === "approved"
                            ? "bg-emerald-500 text-black"
                            : "bg-white/5 text-white/60 hover:bg-emerald-500/20 hover:text-emerald-500 hover:border-emerald-500/30 border border-white/5"
                            }`}
                    >
                        Approve
                    </button>
                    <button
                        onClick={() => onUpdateApproval("changes_requested")}
                        disabled={savingApproval || approval.status === "changes_requested"}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${approval.status === "changes_requested"
                            ? "bg-orange-500 text-black"
                            : "bg-white/5 text-white/60 hover:bg-orange-500/20 hover:text-orange-500 hover:border-orange-500/30 border border-white/5"
                            }`}
                    >
                        Request Changes
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="px-4 py-3 bg-white/[0.01]">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-focus-within:text-white/60 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search feedback..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-lg py-2 pl-9 pr-4 text-xs tracking-tight outline-none focus:bg-white/[0.08] focus:border-white/10 transition-all placeholder:text-white/10"
                    />
                </div>
            </div>

            {/* Comment List */}
            <div className="flex-1 min-h-0">
                <Virtuoso
                    style={{ height: "100%" }}
                    data={filteredComments}
                    itemContent={(_index, comment) => {
                        const isSelected = selectedCommentId === comment.id;
                        const initials = getReviewerInitials(comment.author_name);
                        const color = getReviewerColor(comment.author_name);

                        return (
                            <div
                                onClick={() => onSelectComment(comment)}
                                className={`
                  px-4 py-4 border-b border-white/[0.03] cursor-pointer transition-all
                  ${isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.02]"}
                `}
                            >
                                <div className="flex gap-3">
                                    <div
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 shadow-inner"
                                        style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
                                    >
                                        {initials}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-semibold truncate text-white/90">
                                                {comment.author_name || "Anonymous"}
                                            </span>
                                            <span className="text-[10px] font-mono text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
                                                {formatDuration(comment.timestamp_ms)}
                                            </span>
                                        </div>
                                        <p className="text-[13px] leading-relaxed text-white/70 break-words">
                                            {comment.text}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    }}
                />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-black/40 border-t border-white/5">
                <div className="mb-3">
                    <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                onAddComment();
                            }
                        }}
                        placeholder="Write a comment..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm min-h-[100px] resize-none outline-none focus:bg-white/[0.08] focus:border-white/20 transition-all placeholder:text-white/10"
                    />
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 group">
                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                            <User className="w-3 h-3 text-white/40" />
                        </div>
                        <input
                            type="text"
                            value={commentAuthor === "Anonymous" && reviewerName ? reviewerName : commentAuthor}
                            onChange={(e) => setCommentAuthor(e.target.value)}
                            placeholder="Your name"
                            className="bg-transparent border-none outline-none text-[11px] text-white/40 focus:text-white transition-colors w-24 placeholder:text-white/10"
                        />
                    </div>

                    <button
                        onClick={onAddComment}
                        disabled={submitting || !commentText.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-xs font-bold hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none transition-all"
                    >
                        {submitting ? (
                            <div className="w-3.5 h-3.5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                        ) : (
                            <Send className="w-3.5 h-3.5" />
                        )}
                        <span>Post</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
