import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";
import { ProductionDetailSection, ProductionQuickSetupRow } from "../types";
import { invokeGuarded } from "./tauri";

interface ExportSection {
  title: string;
  lines: string[];
}

interface ProductionExportOptions {
  fileName: string;
  title: string;
  subtitle: string;
  projectName: string;
  clientName: string;
  sections: ExportSection[];
}

interface ProductionCallSheetOptions {
  fileName: string;
  title: string;
  projectName: string;
  clientName: string;
  intent: Array<{ label: string; value: string }>;
  cameras: Array<{
    slot: string;
    title: string;
    subtitle: string;
    quickRows: ProductionQuickSetupRow[];
    details: ProductionDetailSection[];
  }>;
  includeDetailsPages?: boolean;
}

function drawCanvasReport(options: ProductionExportOptions): HTMLCanvasElement {
  const width = 1600;
  const margin = 72;
  const lineHeight = 30;
  const sectionGap = 24;
  const headerHeight = 160;
  const footerHeight = 40;
  const textLines = options.sections.reduce((count, section) => count + 2 + section.lines.length, 0);
  const height = Math.max(900, headerHeight + footerHeight + textLines * lineHeight + options.sections.length * sectionGap);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas unavailable");
  }

  ctx.fillStyle = "#f7f7f8";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, width, 88);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 34px Helvetica";
  ctx.fillText(options.title, margin, 52);
  ctx.font = "500 18px Helvetica";
  ctx.fillText(options.subtitle, width - margin - ctx.measureText(options.subtitle).width, 52);

  let cursorY = 126;
  ctx.fillStyle = "#16181d";
  ctx.font = "700 42px Helvetica";
  ctx.fillText(options.projectName, margin, cursorY);
  cursorY += 42;
  ctx.fillStyle = "#6b7280";
  ctx.font = "500 22px Helvetica";
  ctx.fillText(`Client: ${options.clientName}`, margin, cursorY);
  cursorY += 44;

  for (const section of options.sections) {
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, cursorY);
    ctx.lineTo(width - margin, cursorY);
    ctx.stroke();
    cursorY += 28;

    ctx.fillStyle = "#111827";
    ctx.font = "700 24px Helvetica";
    ctx.fillText(section.title, margin, cursorY);
    cursorY += 22;

    ctx.fillStyle = "#374151";
    ctx.font = "500 18px Helvetica";
    for (const line of section.lines) {
      const wrapped = wrapText(ctx, line, width - margin * 2);
      for (const part of wrapped) {
        cursorY += lineHeight;
        ctx.fillText(part, margin, cursorY);
      }
      cursorY += 6;
    }
    cursorY += sectionGap;
  }

  return canvas;
}

function drawCallSheetPage(options: ProductionCallSheetOptions): HTMLCanvasElement {
  const width = 1680;
  const height = 1100;
  const margin = 48;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas unavailable");
  }

  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, width, 88);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 30px Helvetica";
  ctx.fillText(options.title, margin, 54);

  ctx.fillStyle = "#16181d";
  ctx.font = "700 34px Helvetica";
  ctx.fillText(options.projectName, margin, 136);
  ctx.fillStyle = "#6b7280";
  ctx.font = "500 18px Helvetica";
  ctx.fillText(`Client: ${options.clientName}`, margin, 166);

  const intentTop = 196;
  const intentHeight = 96;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, margin, intentTop, width - margin * 2, intentHeight, 18, true, false);
  const intentWidth = (width - margin * 2) / 4;
  options.intent.forEach((item, index) => {
    const x = margin + index * intentWidth;
    if (index > 0) {
      ctx.strokeStyle = "#e5e7eb";
      ctx.beginPath();
      ctx.moveTo(x, intentTop + 18);
      ctx.lineTo(x, intentTop + intentHeight - 18);
      ctx.stroke();
    }
    ctx.fillStyle = "#6b7280";
    ctx.font = "700 11px Helvetica";
    ctx.fillText(item.label.toUpperCase(), x + 18, intentTop + 28);
    ctx.fillStyle = "#111827";
    ctx.font = "600 16px Helvetica";
    const valueLines = wrapText(ctx, item.value || "—", intentWidth - 36);
    valueLines.slice(0, 2).forEach((line, lineIndex) => {
      ctx.fillText(line, x + 18, intentTop + 56 + lineIndex * 20);
    });
  });

  const columnGap = 18;
  const columnWidth = (width - margin * 2 - columnGap * 2) / 3;
  const columnsTop = 324;
  const columnHeight = 690;

  options.cameras.forEach((camera, index) => {
    const x = margin + index * (columnWidth + columnGap);
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, columnsTop, columnWidth, columnHeight, 20, true, false);

    ctx.fillStyle = "#6b7280";
    ctx.font = "700 11px Helvetica";
    ctx.fillText(`CAMERA ${camera.slot}`, x + 18, columnsTop + 26);
    ctx.fillStyle = "#111827";
    ctx.font = "700 22px Helvetica";
    ctx.fillText(camera.title, x + 18, columnsTop + 56);
    ctx.fillStyle = "#6b7280";
    ctx.font = "500 13px Helvetica";
    wrapText(ctx, camera.subtitle, columnWidth - 36).slice(0, 2).forEach((line, lineIndex) => {
      ctx.fillText(line, x + 18, columnsTop + 80 + lineIndex * 16);
    });

    let rowY = columnsTop + 122;
    const rowHeight = 76;
    camera.quickRows.slice(0, 6).forEach((row) => {
      ctx.fillStyle = row.status === "missing" ? "#fff7ed" : "#f8fafc";
      roundRect(ctx, x + 14, rowY, columnWidth - 28, rowHeight - 8, 14, true, false);
      ctx.fillStyle = "#6b7280";
      ctx.font = "700 10px Helvetica";
      ctx.fillText(row.label.toUpperCase(), x + 28, rowY + 22);
      ctx.fillStyle = "#111827";
      ctx.font = "600 14px Helvetica";
      wrapText(ctx, row.value || "—", columnWidth - 56).slice(0, 2).forEach((line, lineIndex) => {
        ctx.fillText(line, x + 28, rowY + 46 + lineIndex * 16);
      });
      if (row.badge) {
        drawBadge(ctx, x + 28, rowY + 52, row.badge, row.status === "missing" ? "#f59e0b" : "#3b82f6");
      }
      rowY += rowHeight;
    });
  });

  return canvas;
}

function drawCallSheetDetailsPage(options: ProductionCallSheetOptions): HTMLCanvasElement {
  const width = 1680;
  const height = 1100;
  const margin = 48;
  const gap = 18;
  const columnWidth = (width - margin * 2 - gap * 2) / 3;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas unavailable");
  }

  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, width, 88);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 30px Helvetica";
  ctx.fillText(`${options.title} · Details`, margin, 54);

  options.cameras.forEach((camera, index) => {
    const x = margin + index * (columnWidth + gap);
    let cursorY = 124;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, 104, columnWidth, 944, 20, true, false);
    ctx.fillStyle = "#6b7280";
    ctx.font = "700 11px Helvetica";
    ctx.fillText(`CAMERA ${camera.slot}`, x + 18, cursorY);
    cursorY += 26;
    ctx.fillStyle = "#111827";
    ctx.font = "700 22px Helvetica";
    ctx.fillText(camera.title, x + 18, cursorY);
    cursorY += 26;

    camera.details.forEach((section) => {
      ctx.fillStyle = "#6b7280";
      ctx.font = "700 10px Helvetica";
      ctx.fillText(section.section.toUpperCase(), x + 18, cursorY);
      cursorY += 18;
      section.items.forEach((item) => {
        ctx.fillStyle = "#111827";
        ctx.font = "700 12px Helvetica";
        ctx.fillText(item.label, x + 18, cursorY);
        cursorY += 16;
        ctx.fillStyle = "#374151";
        ctx.font = "500 11px Helvetica";
        wrapText(ctx, item.text, columnWidth - 36).forEach((line) => {
          ctx.fillText(line, x + 18, cursorY);
          cursorY += 14;
        });
        ctx.fillStyle = "#2563eb";
        ctx.font = "500 10px Helvetica";
        wrapText(ctx, `Based on: ${item.source.join(" + ")}`, columnWidth - 36).forEach((line) => {
          ctx.fillText(line, x + 18, cursorY);
          cursorY += 12;
        });
        cursorY += 10;
      });
      cursorY += 8;
    });
  });

  return canvas;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: boolean,
  stroke: boolean,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = "700 10px Helvetica";
  const width = ctx.measureText(text).width + 18;
  ctx.fillStyle = `${color}22`;
  roundRect(ctx, x, y, width, 20, 10, true, false);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 9, y + 13);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export async function exportProductionPdf(options: ProductionExportOptions): Promise<boolean> {
  const filePath = await save({
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    defaultPath: options.fileName,
  });
  if (!filePath) return false;

  const canvas = drawCanvasReport(options);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const imageData = canvas.toDataURL("image/jpeg", 0.92);
  pdf.addImage(imageData, "JPEG", 0, 0, pageWidth, pageHeight);

  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: pdf.output("datauristring") });
  return true;
}

export async function exportProductionImage(options: ProductionExportOptions): Promise<boolean> {
  const filePath = await save({
    filters: [{ name: "JPEG Image", extensions: ["jpg", "jpeg"] }],
    defaultPath: options.fileName,
  });
  if (!filePath) return false;
  const canvas = drawCanvasReport(options);
  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  return true;
}

export async function exportProductionCallSheetPdf(options: ProductionCallSheetOptions): Promise<boolean> {
  const filePath = await save({
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    defaultPath: options.fileName,
  });
  if (!filePath) return false;

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const quickPage = drawCallSheetPage(options);
  pdf.addImage(quickPage.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 297, 210);

  if (options.includeDetailsPages) {
    pdf.addPage("a4", "landscape");
    const detailsPage = drawCallSheetDetailsPage(options);
    pdf.addImage(detailsPage.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 297, 210);
  }

  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: pdf.output("datauristring") });
  return true;
}

export async function exportProductionCallSheetImage(options: ProductionCallSheetOptions): Promise<boolean> {
  const filePath = await save({
    filters: [{ name: "JPEG Image", extensions: ["jpg", "jpeg"] }],
    defaultPath: options.fileName,
  });
  if (!filePath) return false;
  const canvas = drawCallSheetPage(options);
  await invokeGuarded("save_image_data_url", { path: filePath, dataUrl: canvas.toDataURL("image/jpeg", 0.92) });
  return true;
}
