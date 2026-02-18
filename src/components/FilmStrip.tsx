import { Thumbnail } from "../App";

interface FilmStripProps {
    clipId: string;
    thumbnails: Thumbnail[];
    thumbnailCache: Record<string, string>;
    status: string;
    count: number;
}

export function FilmStrip({ clipId, thumbnails, thumbnailCache, status, count }: FilmStripProps) {
    const indices = Array.from({ length: count }, (_, i) => i);

    if (status === "fail") {
        return (
            <div className="film-strip">
                {indices.map((i) => (
                    <div key={i} className="film-strip-placeholder">
                        {i === Math.floor(count / 2) ? "Failed" : ""}
                    </div>
                ))}
            </div>
        );
    }

    if (thumbnails.length === 0) {
        return (
            <div className="film-strip">
                {indices.map((i) => (
                    <div key={i} className="film-strip-placeholder">
                        {i === Math.floor(count / 2) && <span className="spinner" style={{ width: 16, height: 16 }} />}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="film-strip">
            {indices.map((idx) => {
                const thumb = thumbnails.find((t) => t.index === idx);
                const cacheKey = `${clipId}_${idx}`;
                const src = thumbnailCache[cacheKey];

                if (src) {
                    return (
                        <div key={idx} className="film-strip-thumb">
                            <img src={src} alt={`Frame ${idx + 1}`} />
                            <span className="thumb-time">
                                {formatTimestamp(thumb?.timestamp_ms || 0)}
                            </span>
                        </div>
                    );
                }

                return (
                    <div key={idx} className="film-strip-placeholder">
                        <span className="spinner" style={{ width: 12, height: 12 }} />
                    </div>
                );
            })}
        </div>
    );
}

function formatTimestamp(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}
