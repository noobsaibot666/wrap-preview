import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { jsPDF } from "jspdf";
import { Clip } from "../types";
import { drawFooter, drawHeader } from "./ExportBranding";
import { formatDuration, formatCodecLabel, getAudioBadge } from "./clipMetadata";

interface ExportOptions {
  projectName: string;
  clips: Clip[];
  thumbnailCache: Record<string, string>;
  thumbCount: number;
  projectLutHash?: string | null;
  brandName?: string;
  appVersion?: string;
  onWarning?: (message: string) => void;
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
    return await invoke<string>("read_thumbnail", { path: fsPath });
  } catch (e) {
    console.warn("readThumbAsDataUrl failed:", urlOrPath, e);
    return null;
  }
}

export async function exportPdf(options: ExportOptions): Promise<boolean> {
  const {
    projectName,
    clips,
    thumbnailCache,
    thumbCount,
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

    pdf.setFontSize(6.2);
    pdf.setTextColor(140);
    pdf.text(statsLine, pageW / 2, margin + 7, { align: "center" });

    const clipAreaTop = margin + 16;
    const clipAreaH = pageH - clipAreaTop - 12;
    const clipRowH = clipAreaH / clipsPerPage;

    for (let ci = 0; ci < pageClips.length; ci++) {
      const clip = pageClips[ci];
      const rowY = clipAreaTop + ci * clipRowH;
      const thumbStripH = clipRowH * 0.65;
      const thumbW = usableW / thumbCount;

      pdf.setFillColor(20, 20, 20);
      pdf.rect(margin, rowY, usableW, thumbStripH, "F");

      for (let ti = 0; ti < thumbCount; ti++) {
        const cacheKey = `${clip.id}_${ti}`;
        let thumbPath = thumbnailCache[cacheKey];
        if (!thumbPath) continue;

        if (projectLutHash && clip.lut_enabled === 1) {
          const parts = thumbPath.split("/");
          const filename = parts.pop();
          const newFilename = `lut_${projectLutHash}_${filename}`;
          thumbPath = [...parts, newFilename].join("/");
        }

        const dataUrl = await readThumbAsDataUrl(thumbPath);
        if (!dataUrl) continue;

        try {
          const x = margin + ti * thumbW;
          pdf.addImage(dataUrl, "JPEG", x + 0.3, rowY + 0.3, thumbW - 0.6, thumbStripH - 0.6);
        } catch (e) {
          console.warn("Failed to add thumbnail to PDF:", e);
        }
      }

      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.rect(margin, rowY, usableW, thumbStripH);

      const metaY = rowY + thumbStripH + 3.5;
      pdf.setFontSize(8);
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

      pdf.setFontSize(6.5);
      pdf.text(metaParts.join("  •  "), margin, metaY + 3.5);

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

  await invoke("save_image_data_url", { path: filePath, dataUrl: pdf.output("datauristring") });
  return true;
}

export async function exportImage(options: ExportOptions): Promise<boolean> {
  const {
    projectName,
    clips,
    thumbnailCache,
    thumbCount,
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
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(statsLine, canvasW / 2, 70);

  for (let ci = 0; ci < clips.length; ci++) {
    const clip = clips[ci];
    const rowY = headerH + ci * rowH;

    for (let ti = 0; ti < thumbCount; ti++) {
      const cacheKey = `${clip.id}_${ti}`;
      let thumbPath = thumbnailCache[cacheKey];
      if (!thumbPath) continue;

      if (projectLutHash && clip.lut_enabled === 1) {
        const parts = thumbPath.split("/");
        const filename = parts.pop();
        thumbPath = [...parts, `lut_${projectLutHash}_${filename}`].join("/");
      }

      const dataUrl = await readThumbAsDataUrl(thumbPath);
      if (!dataUrl) continue;
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("thumbnail draw failed"));
          img.src = dataUrl;
        });
        const x = marginX + ti * thumbW;
        ctx.drawImage(img, x, rowY, thumbW - 2, thumbH);
      } catch {
        ctx.fillStyle = "#222";
        ctx.fillRect(marginX + ti * thumbW, rowY, thumbW - 2, thumbH);
      }
    }

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.strokeRect(marginX, rowY, stripW, thumbH);

    const line1Y = rowY + thumbH + 18;
    ctx.fillStyle = "#000000";
    ctx.font = "bold 16px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(clip.filename, marginX, line1Y);

    ctx.font = "14px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#444";
    const fnW = ctx.measureText(clip.filename).width;
    ctx.fillText(`   ${formatDuration(clip.duration_ms)}`, marginX + fnW, line1Y);

    const line2Y = line1Y + 18;
    ctx.font = "13px Inter, system-ui, sans-serif";
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
      ctx.font = "bold 15px Inter, system-ui, sans-serif";
      ctx.fillStyle = clip.flag === "pick" ? "#00b464" : "#e04040";
      const flagText = clip.flag.toUpperCase();
      ctx.fillText(flagText, rx, line1Y);
      rx -= ctx.measureText(flagText).width + 10;
    }
    if (clip.rating > 0) {
      ctx.font = "bold 16px Inter, system-ui, sans-serif";
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

  await invoke("save_image_data_url", { path: filePath, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  return true;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
