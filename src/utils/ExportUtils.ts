import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";
import { Clip, Thumbnail } from "../types";
import { drawFooter, drawHeader } from "./ExportBranding";
import { formatDuration, formatCodecLabel, getAudioBadge } from "./clipMetadata";
import { getDisplayedThumbsForClip } from "./shotPlannerThumbnails";
import { invokeGuarded } from "./tauri";

interface ExportOptions {
  projectName: string;
  clips: Clip[];
  thumbnailsByClipId: Record<string, Thumbnail[]>;
  thumbnailCache: Record<string, string>;
  thumbCount: number;
  jumpSeconds: number;
  cacheKeyContext?: string;
  projectLutHash?: string | null;
  brandName?: string;
  appVersion?: string;
  onWarning?: (message: string) => void;
  shuffle?: boolean;
  useOriginalRatio?: boolean;
}

interface MosaicAsset {
  clip: Clip;
  dataUrl: string;
}

function assetUrlToPath(url: string): string {
  if (url.startsWith("data:")) return url;
  if (url.includes("asset.localhost/")) {
    const path = decodeURIComponent(url.split("asset.localhost/")[1] || "");
    return path.startsWith("/") ? path : `/${path}`;
  }
  if (url.includes("asset://localhost/")) {
    const path = decodeURIComponent(url.split("asset://localhost/")[1] || "");
    return path.startsWith("/") ? path : `/${path}`;
  }
  return url;
}

async function readThumbAsDataUrl(urlOrPath: string): Promise<string | null> {
  try {
    if (urlOrPath.startsWith("data:")) return urlOrPath;
    const fsPath = assetUrlToPath(urlOrPath);
    return await invokeGuarded<string>("read_thumbnail", { path: fsPath });
  } catch (e) {
    console.warn("readThumbAsDataUrl failed:", urlOrPath, e);
    return null;
  }
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
  return img;
}

async function normalizePdfImageDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, img.width);
  canvas.height = Math.max(1, img.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("pdf image normalization context unavailable");
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function getContainRect(
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
) {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.min(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  const x = targetX + (targetWidth - width) / 2;
  const y = targetY + (targetHeight - height) / 2;
  return { x, y, width, height };
}

async function collectMosaicAssets(
  clips: Clip[],
  thumbnailsByClipId: Record<string, Thumbnail[]>,
  thumbnailCache: Record<string, string>,
  thumbCount: number,
  jumpSeconds: number,
  onWarning?: (message: string) => void,
  cacheKeyContext?: string,
  shuffle?: boolean,
): Promise<MosaicAsset[]> {
  const assets: MosaicAsset[] = [];
  let skipped = 0;

  for (const clip of clips) {
    const displayedThumbs = getDisplayedThumbsForClip({
      clipId: clip.id,
      thumbnails: thumbnailsByClipId[clip.id] ?? [],
      thumbnailCache,
      thumbCount,
      jumpSeconds,
      cacheKeyContext,
    });
    
    if (displayedThumbs.length === 0) {
      skipped += 1;
      continue;
    }
    
    let clipThumbsAdded = 0;
    for (const thumb of displayedThumbs) {
      const src = thumb.src;
      if (!src) continue;
      
      const dataUrl = await readThumbAsDataUrl(src);
      if (!dataUrl) continue;
      
      assets.push({ clip, dataUrl });
      clipThumbsAdded++;
    }
    
    if (clipThumbsAdded === 0) {
      skipped += 1;
    }
  }

  if (skipped > 0) {
    onWarning?.("Some clips had no thumbnails yet and were skipped.");
  }
  
  if (shuffle) {
    for (let i = assets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [assets[i], assets[j]] = [assets[j], assets[i]];
    }
  }

  return assets;
}

export async function exportPdf(options: ExportOptions): Promise<boolean> {
  const {
    projectName,
    clips,
    thumbnailsByClipId,
    thumbnailCache,
    thumbCount,
    jumpSeconds,
    cacheKeyContext,
    projectLutHash,
    brandName,
    appVersion = "unknown",
    onWarning,
  } = options;

  const filePath = await save({
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    defaultPath: `${projectName}_ContactSheet.pdf`,
  });
  if (!filePath) return false;

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = 297;
  const pageH = 210;
  const margin = 10;
  const usableW = pageW - margin * 2;
  const clipsPerPage = 3;
  const pages = chunkArray(clips, clipsPerPage);
  const exportDate = new Date();

  if (import.meta.env.DEV) {
    console.info("[Wrap Preview] PDF export soak helper", {
      projectName,
      clipCount: clips.length,
      pageCount: pages.length,
    });
  }

  for (let pi = 0; pi < pages.length; pi++) {
    if (pi > 0) pdf.addPage();
    const pageClips = pages[pi];

    await drawHeader(
      {
        kind: "pdf",
        doc: pdf,
        pageWidth: pageW,
        margin,
      },
      {
        appName: brandName || "Wrap Preview",
        appVersion,
        exportedAt: exportDate,
        projectName,
        title: "Contact Sheet",
      },
      onWarning
    );

    const totalDur = clips.reduce((a, c) => a + c.duration_ms, 0);
    const resolutions = [...new Set(clips.map((c) => `${c.width}×${c.height}`))];
    const fpsValues = [...new Set(clips.map((c) => c.fps))];
    const statsLine = [
      `${clips.length} clips`,
      `${formatDuration(totalDur)} total`,
      resolutions.length === 1 ? resolutions[0] : `${resolutions.length} resolutions`,
      fpsValues.length === 1 ? `${fpsValues[0]}fps` : `${fpsValues.join("/")}fps`,
    ].join("  •  ");

    pdf.setFontSize(5.4);
    pdf.setTextColor(140);
    pdf.text(statsLine, pageW / 2, margin + 7, { align: "center" });

    const clipAreaTop = margin + 16;
    const clipAreaH = pageH - clipAreaTop - 12;
    const clipRowH = clipAreaH / clipsPerPage;

    for (let ci = 0; ci < pageClips.length; ci++) {
      const clip = pageClips[ci];
      const rowY = clipAreaTop + ci * clipRowH;
      const thumbStripH = clipRowH * 0.65;
      const displayedThumbs = getDisplayedThumbsForClip({
        clipId: clip.id,
        thumbnails: thumbnailsByClipId[clip.id] ?? [],
        thumbnailCache,
        thumbCount,
        jumpSeconds,
        cacheKeyContext,
      });
      const thumbW = usableW / Math.max(displayedThumbs.length, 1);

      pdf.setFillColor(20, 20, 20);
      pdf.rect(margin, rowY, usableW, thumbStripH, "F");

      for (let ti = 0; ti < displayedThumbs.length; ti++) {
        let thumbPath = displayedThumbs[ti].file_path || displayedThumbs[ti].src;

        if (!thumbPath.startsWith("data:") && projectLutHash && clip.lut_enabled === 1) {
          const parts = thumbPath.split("/");
          const filename = parts.pop();
          const newFilename = `lut_${projectLutHash}_${filename}`;
          thumbPath = [...parts, newFilename].join("/");
        }

        const dataUrl = await readThumbAsDataUrl(thumbPath);
        if (!dataUrl) continue;

        try {
          const image = await loadImage(dataUrl);
          const x = margin + ti * thumbW;
          const normalized = await normalizePdfImageDataUrl(dataUrl);
          const frameX = x + 0.3;
          const frameY = rowY + 0.3;
          const frameW = thumbW - 0.6;
          const frameH = thumbStripH - 0.6;
          const fitted = getContainRect(image.width, image.height, frameX, frameY, frameW, frameH);
          pdf.addImage(normalized, "JPEG", fitted.x, fitted.y, fitted.width, fitted.height, undefined, "FAST");
        } catch (e) {
          console.warn("Failed to add thumbnail to PDF:", e);
        }
      }

      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.rect(margin, rowY, usableW, thumbStripH);

      const metaY = rowY + thumbStripH + 3.5;
      pdf.setFontSize(7);
      pdf.setTextColor(30);
      pdf.setFont("helvetica", "bold");
      pdf.text(clip.filename, margin, metaY);

      const filenameW = pdf.getTextWidth(clip.filename);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100);
      pdf.text(`   ${formatDuration(clip.duration_ms)}`, margin + filenameW, metaY);

      const audioBadge = getAudioBadge(clip.audio_summary, clip.audio_envelope);
      const metaParts: string[] = [
        `${clip.width}×${clip.height}`,
        formatCodecLabel(clip),
        clip.fps > 0 ? `${clip.fps}fps` : "",
      ].filter(Boolean);
      if (clip.shot_size) metaParts.push(clip.shot_size);
      if (clip.movement) metaParts.push(clip.movement);
      if (audioBadge) metaParts.push(audioBadge);

      pdf.setFontSize(5.8);
      pdf.text(metaParts.join("  •  "), margin, metaY + 3.2);

      let rightX = margin + usableW;
      if (clip.flag !== "none") {
        const flagText = clip.flag.toUpperCase();
        const flagW = pdf.getTextWidth(flagText) + 4;
        pdf.setTextColor(clip.flag === "pick" ? 0 : 200, clip.flag === "pick" ? 180 : 60, clip.flag === "pick" ? 100 : 60);
        pdf.setFont("helvetica", "bold");
        pdf.text(flagText, rightX, metaY, { align: "right" });
        pdf.setFont("helvetica", "normal");
        rightX -= flagW + 2;
      }
      if (clip.rating > 0) {
        pdf.setTextColor(0, 209, 255);
        pdf.setFont("helvetica", "bold");
        pdf.text("★".repeat(clip.rating), rightX, metaY, { align: "right" });
        pdf.setFont("helvetica", "normal");
      }
    }

    drawFooter(
      {
        kind: "pdf",
        doc: pdf,
        pageWidth: pageW,
        pageHeight: pageH,
        margin,
        pageLabel: `Page ${pi + 1} of ${pages.length}`,
      },
      brandName || "Wrap Preview"
    );
  }

  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: pdf.output("datauristring") });
  return true;
}

export async function exportImage(options: ExportOptions): Promise<boolean> {
  const {
    projectName,
    clips,
    thumbnailsByClipId,
    thumbnailCache,
    thumbCount,
    jumpSeconds,
    cacheKeyContext,
    projectLutHash,
    brandName,
    appVersion = "unknown",
    onWarning,
  } = options;

  const filePath = await save({
    filters: [{ name: "Image", extensions: ["jpeg"] }],
    defaultPath: `${projectName}_ContactSheet.jpeg`,
  });
  if (!filePath) return false;

  const thumbW = 240;
  const thumbH = 135;
  const metaAreaH = 60;
  const rowH = thumbH + metaAreaH;
  const stripW = thumbW * thumbCount;
  const marginX = 40;
  const canvasW = stripW + marginX * 2;
  const headerH = 100;
  const footerH = 40;
  const canvasH = headerH + clips.length * rowH + footerH;
  const exportDate = new Date();
  const dateStr = exportDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  await drawHeader(
    {
      kind: "canvas",
      ctx,
      canvasWidth: canvasW,
      marginX,
    },
    {
      appName: brandName || "Wrap Preview",
      appVersion,
      exportedAt: exportDate,
      projectName,
      title: "Contact Sheet",
    },
    onWarning
  );

  const totalDur = clips.reduce((a, c) => a + c.duration_ms, 0);
  const resolutions = [...new Set(clips.map((c) => `${c.width}×${c.height}`))];
  const fpsValues = [...new Set(clips.map((c) => c.fps))];
  const statsLine = [
    `${clips.length} clips`,
    `${formatDuration(totalDur)} total`,
    resolutions.length === 1 ? resolutions[0] : `${resolutions.length} resolutions`,
    fpsValues.length === 1 ? `${fpsValues[0]}fps` : `${fpsValues.join("/")}fps`,
  ].join("   •   ");
  ctx.fillStyle = "#777";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(statsLine, canvasW / 2, 70);

  for (let ci = 0; ci < clips.length; ci++) {
    const clip = clips[ci];
    const rowY = headerH + ci * rowH;
    const displayedThumbs = getDisplayedThumbsForClip({
      clipId: clip.id,
      thumbnails: thumbnailsByClipId[clip.id] ?? [],
      thumbnailCache,
      thumbCount,
      jumpSeconds,
      cacheKeyContext,
    });
    const displayedCount = Math.max(displayedThumbs.length, 1);
    const rowThumbW = stripW / displayedCount;

    for (let ti = 0; ti < displayedThumbs.length; ti++) {
      let thumbPath = displayedThumbs[ti].file_path || displayedThumbs[ti].src;

      if (!thumbPath.startsWith("data:") && projectLutHash && clip.lut_enabled === 1) {
        const parts = thumbPath.split("/");
        const filename = parts.pop();
        thumbPath = [...parts, `lut_${projectLutHash}_${filename}`].join("/");
      }

      const dataUrl = await readThumbAsDataUrl(thumbPath);
      if (!dataUrl) continue;
      try {
        const img = await loadImage(dataUrl);
        const x = marginX + ti * rowThumbW;
        const frameW = rowThumbW - 2;
        const fitted = getContainRect(img.width, img.height, x, rowY, frameW, thumbH);
        ctx.fillStyle = "#111215";
        ctx.fillRect(x, rowY, frameW, thumbH);
        ctx.drawImage(img, fitted.x, fitted.y, fitted.width, fitted.height);
      } catch {
        ctx.fillStyle = "#222";
        ctx.fillRect(marginX + ti * rowThumbW, rowY, rowThumbW - 2, thumbH);
      }
    }

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.strokeRect(marginX, rowY, stripW, thumbH);

    const line1Y = rowY + thumbH + 18;
    ctx.fillStyle = "#000000";
    ctx.font = "bold 14px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(clip.filename, marginX, line1Y);

    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#444";
    const fnW = ctx.measureText(clip.filename).width;
    ctx.fillText(`   ${formatDuration(clip.duration_ms)}`, marginX + fnW, line1Y);

    const line2Y = line1Y + 18;
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#555";
    const audioBadge = getAudioBadge(clip.audio_summary, clip.audio_envelope);
    const metaParts: string[] = [
      `${clip.width}×${clip.height}`,
      formatCodecLabel(clip),
      clip.fps > 0 ? `${clip.fps}fps` : "",
    ].filter(Boolean);
    if (clip.shot_size) metaParts.push(clip.shot_size);
    if (clip.movement) metaParts.push(clip.movement);
    if (audioBadge) metaParts.push(audioBadge);
    ctx.fillText(metaParts.join("   •   "), marginX, line2Y);

    ctx.textAlign = "right";
    const rightEdge = marginX + stripW;
    let rx = rightEdge;
    if (clip.flag !== "none") {
      ctx.font = "bold 13px Inter, system-ui, sans-serif";
      ctx.fillStyle = clip.flag === "pick" ? "#00b464" : "#e04040";
      const flagText = clip.flag.toUpperCase();
      ctx.fillText(flagText, rx, line1Y);
      rx -= ctx.measureText(flagText).width + 10;
    }
    if (clip.rating > 0) {
      ctx.font = "bold 14px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#00a0cc";
      ctx.fillText("★".repeat(clip.rating), rx, line1Y);
    }
    ctx.textAlign = "left";
  }

  drawFooter(
    {
      kind: "canvas",
      ctx,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      marginX,
      pageLabel: `${clips.length} clips  •  ${dateStr}`,
    },
    brandName || "Wrap Preview"
  );

  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  return true;
}

export async function exportMosaicImage(options: ExportOptions): Promise<boolean> {
  const { projectName, clips, thumbnailsByClipId, thumbnailCache, thumbCount, jumpSeconds, onWarning, cacheKeyContext, shuffle, useOriginalRatio } = options;
  const assets = await collectMosaicAssets(clips, thumbnailsByClipId, thumbnailCache, thumbCount, jumpSeconds, onWarning, cacheKeyContext, shuffle);
  if (assets.length === 0) {
    onWarning?.("Some clips had no thumbnails yet and were skipped.");
    return false;
  }

  const pages = chunkArray(assets, 100);
  let baseFilePath: string | null = null;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    let filePath: string | null = null;

    if (pageIndex === 0) {
      filePath = await save({
        filters: [{ name: "Image", extensions: ["jpeg"] }],
        defaultPath: `${projectName}_Mosaic.jpeg`,
      });
      if (!filePath) return false;
      baseFilePath = filePath;
    } else if (baseFilePath) {
      // For subsequent pages, derive the name from the first one
      const extIndex = baseFilePath.lastIndexOf(".");
      const base = extIndex !== -1 ? baseFilePath.substring(0, extIndex) : baseFilePath;
      const ext = extIndex !== -1 ? baseFilePath.substring(extIndex) : ".jpeg";
      filePath = `${base}_p${pageIndex + 1}${ext}`;
    }

    if (!filePath) continue;

    const pageAssets = pages[pageIndex];
    const grid = getMosaicGrid(pageAssets.length);
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 2048;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");

    ctx.fillStyle = "#111215";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gap = 20;
    const margin = 28;
    const tileSize = Math.floor((canvas.width - margin * 2 - gap * (grid - 1)) / grid);

    for (let index = 0; index < pageAssets.length; index += 1) {
      const { dataUrl } = pageAssets[index];
      const img = await loadImage(dataUrl);
      const column = index % grid;
      const row = Math.floor(index / grid);
      const x = margin + column * (tileSize + gap);
      const y = margin + row * (tileSize + gap);
      if (useOriginalRatio) {
        drawOriginalTile(ctx, img, x, y, tileSize);
      } else {
        drawSquareTile(ctx, img, x, y, tileSize);
      }
    }

    await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  }
  return true;
}

export async function exportMosaicPdf(options: ExportOptions): Promise<boolean> {
  const { projectName, clips, thumbnailsByClipId, thumbnailCache, thumbCount, jumpSeconds, onWarning, cacheKeyContext, shuffle, useOriginalRatio } = options;
  const filePath = await save({
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    defaultPath: `${projectName}_Mosaic.pdf`,
  });
  if (!filePath) return false;

  const assets = await collectMosaicAssets(clips, thumbnailsByClipId, thumbnailCache, thumbCount, jumpSeconds, onWarning, cacheKeyContext, shuffle);
  if (assets.length === 0) {
    onWarning?.("Some clips had no thumbnails yet and were skipped.");
    return false;
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [210, 210] });
  const pageW = 210;
  const pageH = 210;
  const margin = 10;
  const gap = 3;
  const pages = chunkArray(assets, 144);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (pageIndex > 0) pdf.addPage();
    pdf.setFillColor(17, 18, 21);
    pdf.rect(0, 0, pageW, pageH, "F");

    const pageAssets = pages[pageIndex];
    const grid = getMosaicGrid(pageAssets.length);
    const tileSize = (pageW - margin * 2 - gap * (grid - 1)) / grid;
    for (let index = 0; index < pageAssets.length; index += 1) {
      const column = index % grid;
      const row = Math.floor(index / grid);
      const x = margin + column * (tileSize + gap);
      const y = margin + row * (tileSize + gap);
      const { dataUrl } = pageAssets[index];
      try {
        const img = await loadImage(dataUrl);
        if (useOriginalRatio) {
          const fitted = getContainRect(img.width, img.height, x, y, tileSize, tileSize);
          const normalized = await normalizePdfImageDataUrl(dataUrl);
          pdf.addImage(normalized, "JPEG", fitted.x, fitted.y, fitted.width, fitted.height, undefined, "FAST");
        } else {
          const square = cropToSquare(img);
          const normalized = await normalizePdfImageDataUrl(square.toDataURL("image/png"));
          pdf.addImage(normalized, "JPEG", x, y, tileSize, tileSize, undefined, "FAST");
        }
      } catch (error) {
        console.warn("Failed to add mosaic thumb to PDF", error);
      }
    }
  }

  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: pdf.output("datauristring") });
  return true;
}

function cropToSquare(img: HTMLImageElement): HTMLCanvasElement {
  const size = Math.min(img.width, img.height);
  const sx = (img.width - size) / 2;
  const sy = (img.height - size) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("square crop context unavailable");
  ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
  return canvas;
}

function drawSquareTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
) {
  const square = cropToSquare(img);
  ctx.fillStyle = "#17181c";
  ctx.fillRect(x, y, size, size);
  ctx.drawImage(square, x, y, size, size);
}

function drawOriginalTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
) {
  ctx.fillStyle = "#17181c";
  ctx.fillRect(x, y, size, size);
  const fitted = getContainRect(img.width, img.height, x, y, size, size);
  ctx.drawImage(img, fitted.x, fitted.y, fitted.width, fitted.height);
}

function getMosaicGrid(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  if (count <= 25) return 5;
  if (count <= 36) return 6;
  if (count <= 49) return 7;
  if (count <= 64) return 8;
  if (count <= 81) return 9;
  if (count <= 100) return 10;
  if (count <= 121) return 11;
  return 12;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
