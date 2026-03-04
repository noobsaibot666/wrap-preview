import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";
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
