import { BrandProfile, ClipWithThumbnails } from "../types";

interface PrintLayoutProps {
  projectName: string;
  clips: ClipWithThumbnails[];
  thumbnailCache: Record<string, string>;
  brandProfile: BrandProfile | null;
  logoSrc?: string;
  thumbCount: number;
  onClose: () => void;
}

const APP_LOGO_SVG = `
<svg width="250" height="250" viewBox="0 0 250 250" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="250" height="250" rx="20" fill="black"/>
<path d="M164.987 124.211H194L193.986 126.011L162.281 126.08C150.072 126.108 133.296 129.763 122.413 135.413C119.876 136.742 117.38 138.099 115.322 140.121L98.1655 157C97.6862 156.612 97.2492 156.169 96.8121 155.712L113.687 139.082C114.674 138.113 115.393 136.977 115.886 135.759C116.534 134.139 116.14 132.477 114.956 131.203C111.629 127.645 107.498 126.759 99.3356 126.219C98.1373 126.149 97.0941 126.039 95.8676 126.039H56V124.225L95.8958 124.141C108.527 124.114 125.684 120.347 136.849 114.31C139.245 113.009 141.501 111.61 143.447 109.699L160.194 93.1939L162.45 93L144.969 110.779C142.742 112.953 140.796 116.221 143.277 118.977C145.674 121.621 150.284 122.812 153.766 123.421C157.502 124.086 161.139 124.211 164.987 124.211Z" fill="#FFFEEF"/>
</svg>
`;

export function PrintLayout({ projectName, clips, thumbnailCache, brandProfile, logoSrc, thumbCount, onClose }: PrintLayoutProps) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Generate dynamic styles based on brand
  const dynamicStyles = (brandProfile && brandProfile.colors) ? `
        :root {
            --color-primary: ${brandProfile.colors.primary || "#6366f1"};
        }
    ` : "";

  return (
    <div className="print-layout" onClick={onClose}>
      <style>{printStyles + dynamicStyles}</style>

      {/* Split clips into pages (roughly 3 clips per A4 landscape page) */}
      {chunkArray(clips, 3).map((pageClips, pageIdx, allPages) => (
        <div key={pageIdx} className="print-page">
          {/* Header */}
          <div className="print-header">
            <div className="print-header-left">
              {logoSrc ? (
                <div className="print-logo-custom">
                  <img src={logoSrc} alt="Logo" style={{ height: '32px' }} />
                </div>
              ) : (
                <div className="print-logo-custom" dangerouslySetInnerHTML={{ __html: APP_LOGO_SVG }} />
              )}
            </div>
            <div className="print-header-center">
              <div className="print-project-name">{projectName}</div>
              <div className="print-date">{dateStr}</div>
            </div>
            <div className="print-header-right">
              <div className="print-subtitle">Contact Sheet</div>
            </div>
          </div>

          {/* Clips */}
          <div className="print-clips">
            {pageClips.map((item) => (
              <PrintClipRow
                key={item.clip.id}
                item={item}
                thumbnailCache={thumbnailCache}
                thumbCount={thumbCount}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="print-footer">
            <span>{brandProfile?.name || "Wrap Preview"}</span>
            <span>Page {pageIdx + 1} of {allPages.length}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PrintClipRow({
  item,
  thumbnailCache,
  thumbCount,
}: {
  item: ClipWithThumbnails;
  thumbnailCache: Record<string, string>;
  thumbCount: number;
}) {
  const { clip } = item;

  return (
    <div className="print-clip-row">
      {/* Thumbnail strip */}
      <div className="print-film-strip">
        {Array.from({ length: thumbCount }, (_, idx) => {
          const cacheKey = `${clip.id}_${idx}`;
          const src = thumbnailCache[cacheKey];

          if (src) {
            return (
              <div key={idx} className="print-thumb">
                <img src={src} alt="" />
              </div>
            );
          }

          return (
            <div key={idx} className="print-thumb print-thumb-empty">
              {clip.status === "fail" ? "✕" : "—"}
            </div>
          );
        })}
      </div>

      {/* Metadata row */}
      <div className="print-meta-row">
        <span className="print-meta-filename">{clip.filename}</span>
        <span className="print-meta-item">{formatDuration(clip.duration_ms)}</span>
        <span className="print-meta-item">{clip.width > 0 ? `${clip.width}×${clip.height}` : "—"}</span>
        <span className="print-meta-item">{clip.fps > 0 ? `${clip.fps} fps` : "—"}</span>
        <span className="print-meta-item">{clip.video_codec.toUpperCase()}</span>
        <span className="print-meta-item">{formatFileSize(clip.size_bytes)}</span>
        <span className="print-meta-item">{clip.audio_summary}</span>
        {clip.rating > 0 && <span className="print-meta-item">★{clip.rating}</span>}
        {clip.flag !== "none" && <span className="print-meta-item">{clip.flag.toUpperCase()}</span>}
        {clip.timecode && <span className="print-meta-item">TC: {clip.timecode}</span>}
      </div>
    </div>
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const printStyles = `
  @media screen {
    .print-layout {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0,0,0,0.8);
      overflow-y: auto;
      cursor: pointer;
    }
  }

  .print-page {
    width: 297mm;
    min-height: 210mm;
    margin: 20px auto;
    padding: 12mm;
    background: white;
    color: #1a1a1a;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 9pt;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  }

  .print-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8mm;
    border-bottom: 2px solid var(--color-primary, #6366f1);
    margin-bottom: 6mm;
  }

  .print-header-left { flex: 1; }
  .print-header-center { flex: 2; text-align: center; }
  .print-header-right { flex: 1; text-align: right; }

  .print-logo-custom {
    height: 32px;
    display: flex;
    align-items: center;
  }

  .print-logo-custom svg {
    height: 100%;
    width: auto;
  }

  .print-logo {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .print-logo-mark {
    display: inline-flex;
    width: 24px;
    height: 24px;
    background: var(--color-primary, #6366f1);
    color: white;
    border-radius: 4px;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 12px;
  }

  .print-logo-text {
    font-weight: 700;
    font-size: 13pt;
    color: #1a1a1a;
  }

  .print-project-name {
    font-size: 14pt;
    font-weight: 700;
    color: #1a1a1a;
  }

  .print-date {
    font-size: 9pt;
    color: #000;
    margin-top: 2px;
  }

  .print-subtitle {
    font-size: 10pt;
    color: #000;
    font-weight: 700;
  }

  .print-clips {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5mm;
  }

  .print-clip-row {
    border: 1.5pt solid #000;
    border-radius: 4px;
    overflow: hidden;
  }

  .print-film-strip {
    display: flex;
    gap: 1px;
    background: #000;
  }

  .print-thumb {
    flex: 1;
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }

  .print-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .print-thumb-empty {
    background: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
    font-size: 10pt;
  }

  .print-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4mm;
    padding: 3mm 4mm;
    background: #fff;
    border-top: 1.5pt solid #000;
    align-items: baseline;
  }

  .print-meta-filename {
    font-weight: 800;
    color: #000;
    margin-right: auto;
    font-size: 10pt;
  }

  .print-meta-item {
    color: #000;
    font-weight: 600;
    font-size: 9pt;
    font-variant-numeric: tabular-nums;
  }

  .print-footer {
    display: flex;
    justify-content: space-between;
    padding-top: 4mm;
    margin-top: auto;
    border-top: 1.5pt solid #000;
    color: #000;
    font-weight: 600;
    font-size: 9pt;
  }

  @media print {
    .print-layout {
      position: static;
      background: none;
    }

    .print-page {
      margin: 0;
      box-shadow: none;
      page-break-after: always;
    }
  }
`;
