import { BrandProfile, ClipWithThumbnails } from "../types";
import { PdfHeader } from "./print/PdfHeader";
import { PdfFooter } from "./print/PdfFooter";
import { buildClipMetadataTags, getAudioBadge } from "../utils/clipMetadata";

interface PrintLayoutProps {
  projectName: string;
  clips: ClipWithThumbnails[];
  thumbnailCache: Record<string, string>;
  brandProfile: BrandProfile | null;
  logoSrc?: string;
  appVersion?: string;
  thumbCount: number;
  jumpSeconds: number;
  cacheKeyContext?: string;
  onClose: () => void;
  projectLutHash?: string | null;
}

export function PrintLayout({ projectName, clips, thumbnailCache, brandProfile, logoSrc, appVersion = "unknown", thumbCount, jumpSeconds, cacheKeyContext, onClose, projectLutHash }: PrintLayoutProps) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Generate dynamic styles based on brand
  const dynamicStyles = (brandProfile && brandProfile.colors) ? `
        :root {
            --color-primary: ${brandProfile.colors.primary || "#00d1ff"};
        }
    ` : "";

  return (
    <div className="print-layout" onClick={onClose}>
      <style>{printStyles + dynamicStyles}</style>

      {/* Split clips into pages (roughly 3 clips per A4 landscape page) */}
      {chunkArray(clips, 3).map((pageClips, pageIdx, allPages) => (
        <div key={pageIdx} className="print-page">
          <PdfHeader projectName={projectName} dateStr={dateStr} logoSrc={logoSrc} appVersion={appVersion} />

          {/* Clips */}
          <div className="print-clips">
            {pageClips.map((item) => (
              <PrintClipRow
                key={item.clip.id}
                item={item}
                thumbnailCache={thumbnailCache}
                thumbCount={thumbCount}
                jumpSeconds={jumpSeconds}
                cacheKeyContext={cacheKeyContext}
                projectLutHash={projectLutHash}
              />
            ))}
          </div>

          {/* Footer */}
          <PdfFooter brandName={brandProfile?.name || "Wrap Preview"} page={pageIdx + 1} totalPages={allPages.length} />
        </div>
      ))}
    </div>
  );
}

function PrintClipRow({
  item,
  thumbnailCache,
  thumbCount,
  jumpSeconds,
  cacheKeyContext,
  projectLutHash,
}: {
  item: ClipWithThumbnails;
  thumbnailCache: Record<string, string>;
  thumbCount: number;
  jumpSeconds: number;
  cacheKeyContext?: string;
  projectLutHash?: string | null;
}) {
  const { clip } = item;
  const printAudioBadge = getAudioBadge(clip.audio_summary, clip.audio_envelope);
  const metadataTags = buildClipMetadataTags(clip, printAudioBadge);

  return (
    <div className="print-clip-row">
      {/* Thumbnail strip */}
      <div className="print-film-strip">
        {Array.from({ length: thumbCount }, (_, idx) => {
          const cacheKey = `${clip.id}_${idx}|${cacheKeyContext ?? `jump=${jumpSeconds}`}`;
          let src = thumbnailCache[cacheKey];

          if (src && !src.startsWith("data:") && projectLutHash && clip.lut_enabled === 1) {
            const parts = src.split('/');
            const filename = parts.pop();
            const newFilename = `lut_${projectLutHash}_${filename}`;
            src = [...parts, newFilename].join('/');
          }

          if (src) {
            return (
              <div key={idx} className="print-thumb">
                <img src={src} alt="" onError={(e) => {
                  if (projectLutHash && clip.lut_enabled === 1) {
                    (e.target as HTMLImageElement).src = thumbnailCache[cacheKey];
                  }
                }} />
                {idx === 0 && clip.lut_enabled === 1 && (
                  <div className="lut-badge-label">LUT ENABLED</div>
                )}
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
        {metadataTags.map((tag) => (
          <span key={`${clip.id}-${tag.label}-${tag.value}`} className="print-meta-item">
            {tag.value}
          </span>
        ))}
        {clip.rating > 0 && <span className="print-meta-item">★{clip.rating}</span>}
        {clip.flag !== "none" && <span className="print-meta-item">{clip.flag.toUpperCase()}</span>}
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
    padding: 15mm 18mm;
    background: white;
    color: #1a1a1a;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 9pt;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  }

  .print-layout.printing-offscreen {
    background: none !important;
    position: static !important;
  }
  
  .print-layout.printing-offscreen .print-page {
    box-shadow: none !important;
    margin: 0 !important;
  }

  .print-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8mm;
    border-bottom: 2px solid var(--color-primary, #00d1ff);
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
    background: var(--color-primary, #00d1ff);
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

  .print-smart-copy {
    margin-top: 4mm;
    font-size: 8pt;
    color: #333;
    line-height: 1.35;
    border-top: 1px solid #d4d4d8;
    padding-top: 2mm;
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
    position: relative;
    background: #000;
  }
  
  .lut-badge-label {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: #000;
    color: #fff;
    font-size: 6pt;
    font-weight: 800;
    padding: 1px 4px;
    border-radius: 2px;
    border: 0.5pt solid #fff;
    pointer-events: none;
    line-height: 1;
  }

  .print-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
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
    gap: 8mm;
    align-items: center;
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
