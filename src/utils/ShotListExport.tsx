import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { jsPDF } from "jspdf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  drawFooter,
} from "./ExportBranding";
import type {
  ShotListEquipmentItem,
  ShotListEquipmentSection,
  ShotListProject,
  ShotListRow,
} from "../types";
import { getShotListIconComponent } from "../modules/PreProduction/ShotListConfig";

interface ShotListExportPayload {
  project: ShotListProject;
  rows: ShotListRow[];
  sections: ShotListEquipmentSection[];
  items: ShotListEquipmentItem[];
  appVersion?: string;
  brandName?: string;
  clientName?: string;
}

const PREPROD_ACCENT = "#38bdf8";
const PREPROD_ACCENT_SOFT = "#f0f9ff";
const EXPORT_TEXT = "#111827";
const EXPORT_MUTED = "#4b5563";
const EXPORT_BORDER = "#e2e8f0";
const EXPORT_HEADER_BG = "#0f1115";
const iconCache = new Map<string, Promise<string>>();
const CAMERA_SETUP_DELIMITER = "__SLCAM__";
const LOCATION_TIME_DELIMITER = "__SLTIME__";

function sectionItems(
  sectionId: string,
  items: ShotListEquipmentItem[],
) {
  return items
    .filter((item) => item.section_id === sectionId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

async function getIconDataUrl(iconName: string, size = 56, color = PREPROD_ACCENT): Promise<string> {
  const cacheKey = `${iconName}:${size}:${color}`;
  if (!iconCache.has(cacheKey)) {
    iconCache.set(
      cacheKey,
      (async () => {
        try {
          const Icon = getShotListIconComponent(iconName);
          const svgBody = renderToStaticMarkup(
            createElement(Icon, { size: size - 12, strokeWidth: 1.8, color }),
          );
          
          // Re-wrap the Lucide icon SVG with a custom rounded background container
          const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${Math.round(size * 0.28)}" fill="#ffffff" stroke="${color}" stroke-opacity="0.25" />
            <g transform="translate(6, 6)">
              ${svgBody}
            </g>
          </svg>`;

          const svgBlob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          
          const image = new Image();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            image.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = size;
              canvas.height = size;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                URL.revokeObjectURL(url);
                return reject(new Error("Canvas context unavailable"));
              }
              ctx.drawImage(image, 0, 0, size, size);
              const result = canvas.toDataURL("image/png");
              URL.revokeObjectURL(url);
              resolve(result);
            };
            image.onerror = () => {
              URL.revokeObjectURL(url);
              reject(new Error(`Failed to rasterize icon: ${iconName}`));
            };
            image.src = url;
          });
          
          return dataUrl;
        } catch (err) {
          console.error(`Rasterization error for ${iconName}:`, err);
          // Fallback to a plain colored square or empty string if it fails
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (ctx) {
              ctx.fillStyle = color;
              ctx.globalAlpha = 0.1;
              ctx.fillRect(2, 2, size - 4, size - 4);
          }
          return canvas.toDataURL("image/png");
        }
      })(),
    );
  }
  return iconCache.get(cacheKey)!;
}

function formatCameraSetupsForExport(value: string) {
  const entries = value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return "—";
  return entries
    .map((entry, index) => {
      if (entry.includes(CAMERA_SETUP_DELIMITER)) {
        const formatted = entry
          .split(CAMERA_SETUP_DELIMITER)
          .map((part) => part.trim())
          .filter(Boolean)
          .join(" / ");
        return formatted ? `Cam ${index + 1}: ${formatted}` : "";
      }
      return `Cam ${index + 1}: ${entry}`;
    })
    .filter(Boolean)
    .join(" • ");
}

function formatLocationTimingForExport(value: string) {
  if (!value.includes(LOCATION_TIME_DELIMITER)) {
    return value || "—";
  }
  const [location = "", start = "", end = ""] = value.split(LOCATION_TIME_DELIMITER).map((entry) => entry.trim());
  return [location, start && end ? `${start}-${end}` : start || end].filter(Boolean).join(" / ") || "—";
}

function formatEquipmentItemMetaForExport(item: ShotListEquipmentItem) {
  return [
    item.camera_label?.trim(),
    item.media_type?.trim(),
    item.capacity_value ? `${item.capacity_value}${item.capacity_unit || ""}` : "",
    item.notes?.trim(),
  ]
    .filter(Boolean)
    .join(" • ");
}

const EXPORT_PAGE_WIDTH = 1600;
const EXPORT_PAGE_HEIGHT = 900;
const EXPORT_MARGIN_X = 56;
const EXPORT_ROW_CARD_HEIGHT = 88;

function sanitizeFileStem(value: string) {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "_").replace(/\s+/g, "_");
  return cleaned || "ShotList";
}

function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, 40, 40, 11, true, false);
  ctx.fillStyle = "#0f1115";
  roundRect(ctx, x + 8, y + 8, 24, 24, 7, true, false);
  ctx.fillStyle = "#38bdf8";
  roundRect(ctx, x + 25, y + 8, 7, 24, 3, true, false);
}

function drawMetaChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  accent: string = "#38bdf8"
) {
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, x, y, width, 46, 14, true, false);
  ctx.fillStyle = accent;
  roundRect(ctx, x + 14, y + 15, 8, 16, 4, true, false);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "700 10px Inter, system-ui, sans-serif";
  ctx.fillText(label.toUpperCase(), x + 30, y + 18);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  ctx.fillText(value, x + 30, y + 34);
}

async function drawBrantedHeader(
  ctx: CanvasRenderingContext2D,
  payload: ShotListExportPayload,
  title: string,
  pageLabel?: string
) {
  const margin = EXPORT_MARGIN_X;
  const width = EXPORT_PAGE_WIDTH;

  ctx.fillStyle = EXPORT_HEADER_BG;
  roundRect(ctx, margin, 32, width - margin * 2, 160, 32, true, false);

  drawBrandMark(ctx, margin + 32, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 16px Inter, system-ui, sans-serif";
  ctx.fillText((payload.brandName || "WRAP PREVIEW").toUpperCase(), margin + 88, 76);
  ctx.font = "800 34px Inter, system-ui, sans-serif";
  ctx.fillText(title, margin + 88, 118);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "600 18px Inter, system-ui, sans-serif";
  const projectInfo = [payload.project.title || "Untitled Project", payload.clientName && `Client: ${payload.clientName}`].filter(Boolean).join(" • ");
  ctx.fillText(projectInfo, margin + 88, 150);

  const chipWidth = 200;
  const chipGap = 16;
  let chipX = width - margin - (pageLabel ? chipWidth * 2 + chipGap : chipWidth) - 32;

  drawMetaChip(ctx, chipX, 64, chipWidth, "DAY SHEET", payload.project.day_label || "Day 1");
  chipX += chipWidth + chipGap;
  if (pageLabel) {
    drawMetaChip(ctx, chipX, 64, chipWidth, "PROGRESS", pageLabel, "#a855f7");
    chipX += chipWidth + chipGap;
  }
}

async function createExportPage(
  payload: ShotListExportPayload,
  title: string,
  pageLabel?: string
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_PAGE_WIDTH;
  canvas.height = EXPORT_PAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Shot list export canvas unavailable");

  ctx.fillStyle = "#f8f9fb";
  ctx.fillRect(0, 0, EXPORT_PAGE_WIDTH, EXPORT_PAGE_HEIGHT);
  await drawBrantedHeader(ctx, payload, title, pageLabel);
  return { canvas, ctx };
}

// Removed drawExportPageMeta as it is handled by drawBrantedHeader

async function renderRowsCanvasPage(
  payload: ShotListExportPayload,
  pageRows: ShotListRow[],
  pageIndex: number,
  totalPages: number,
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = await createExportPage(payload, "Production Shot List", `Sheet ${pageIndex + 1}/${totalPages}`);

  let y = 232;
  for (const row of pageRows) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = EXPORT_BORDER;
    ctx.lineWidth = 1;
    roundRect(ctx, EXPORT_MARGIN_X, y, EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2, EXPORT_ROW_CARD_HEIGHT, 20, true, true);

    const icon = await getIconDataUrl(row.capture_type, 66);
    const img = await loadImage(icon);
    ctx.drawImage(img, EXPORT_MARGIN_X + 24, y + 11, 42, 42);

    ctx.fillStyle = EXPORT_TEXT;
    ctx.font = "800 20px Inter, system-ui, sans-serif";
    ctx.fillText(row.shot_number || "—", EXPORT_MARGIN_X + 88, y + 32);
    ctx.font = "700 17px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, row.scene_setup || "—", 280), EXPORT_MARGIN_X + 132, y + 32);

    ctx.fillStyle = EXPORT_MUTED;
    ctx.font = "500 15px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, row.description || "—", 560), EXPORT_MARGIN_X + 88, y + 58);

    ctx.fillStyle = EXPORT_TEXT;
    ctx.font = "600 16px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, formatCameraSetupsForExport(row.camera_lens), 320), 880, y + 36);
    ctx.fillStyle = "#6366f1";
    ctx.font = "700 15px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, (row.movement || "STATIC").toUpperCase(), 140), 1220, y + 36);
    ctx.fillStyle = EXPORT_MUTED;
    ctx.font = "500 15px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, formatLocationTimingForExport(row.location_time), 220), 1380, y + 36);

    drawCanvasPill(ctx, (row.status || "planned").toUpperCase(), EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X - 146, y + 26);
    y += EXPORT_ROW_CARD_HEIGHT + 16;
  }

  drawFooter(
    {
      kind: "canvas",
      ctx,
      canvasWidth: EXPORT_PAGE_WIDTH,
      canvasHeight: EXPORT_PAGE_HEIGHT,
      marginX: EXPORT_MARGIN_X,
    },
    payload.brandName || "Wrap Preview",
  );
  return canvas;
}

async function renderEquipmentCanvasPages(payload: ShotListExportPayload): Promise<HTMLCanvasElement[]> {
  const pages: HTMLCanvasElement[] = [];
  const cards = payload.sections.map((section) => ({
    section,
    items: sectionItems(section.id, payload.items),
  }));

  let cardIndex = 0;
  while (cardIndex < cards.length) {
    const { canvas, ctx } = await createExportPage(payload, "Equipment Inventory", `Pack ${pages.length + 1}`);

    let y = 232;
    let column = 0;
    let rowHeight = 0;
    const cardWidth = (EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2 - 24) / 2;
    const xPositions = [EXPORT_MARGIN_X, EXPORT_MARGIN_X + cardWidth + 24];

    while (cardIndex < cards.length) {
      const { section, items } = cards[cardIndex];
      const cardHeight = Math.max(164, 94 + items.length * 52);
      if (column === 0 && y + cardHeight > EXPORT_PAGE_HEIGHT - 64) break;

      const x = xPositions[column];
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = EXPORT_BORDER;
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, cardWidth, cardHeight, 28, true, true);

      // Section Header within Card
      ctx.fillStyle = "#f1f5f9";
      roundRect(ctx, x + 8, y + 8, cardWidth - 16, 68, 20, true, false);

      const sectionIcon = await loadImage(await getIconDataUrl(section.icon_name, 64));
      ctx.drawImage(sectionIcon, x + 20, y + 16, 52, 52);
      ctx.fillStyle = EXPORT_TEXT;
      ctx.font = "800 24px Inter, system-ui, sans-serif";
      ctx.fillText(section.section_name, x + 86, y + 44);
      ctx.fillStyle = EXPORT_MUTED;
      ctx.font = "600 14px Inter, system-ui, sans-serif";
      ctx.fillText(`${items.length} items logged`, x + 86, y + 66);

      let itemY = y + 86;
      for (const item of items) {
        ctx.fillStyle = "transparent";
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 1;
        roundRect(ctx, x + 12, itemY, cardWidth - 24, 44, 16, false, true);

        const itemIcon = await loadImage(await getIconDataUrl(item.icon_name, 52, "#6366f1"));
        ctx.drawImage(itemIcon, x + 18, itemY + 4, 36, 36);

        ctx.fillStyle = EXPORT_TEXT;
        ctx.font = "700 17px Inter, system-ui, sans-serif";
        ctx.fillText(trimText(ctx, item.item_name || "Unnamed item", cardWidth - 140), x + 64, itemY + 20);
        ctx.fillStyle = EXPORT_MUTED;
        ctx.font = "500 12px Inter, system-ui, sans-serif";
        ctx.fillText(trimText(ctx, formatEquipmentItemMetaForExport(item) || item.item_type || "Gear item", cardWidth - 140), x + 64, itemY + 36);
        itemY += 50;
      }

      rowHeight = Math.max(rowHeight, cardHeight + 18);
      if (column === 1) {
        column = 0;
        y += rowHeight;
        rowHeight = 0;
      } else {
        column = 1;
      }
      cardIndex += 1;
    }

    drawFooter(
      {
        kind: "canvas",
        ctx,
        canvasWidth: EXPORT_PAGE_WIDTH,
        canvasHeight: EXPORT_PAGE_HEIGHT,
        marginX: EXPORT_MARGIN_X,
      },
      payload.brandName || "Wrap Preview",
    );

    pages.push(canvas);
  }

  return pages;
}

async function buildShotListExportPages(payload: ShotListExportPayload): Promise<HTMLCanvasElement[]> {
  const pages: HTMLCanvasElement[] = [];
  const rowsPerPage = 6;
  const rowPages: ShotListRow[][] = [];
  for (let index = 0; index < payload.rows.length; index += rowsPerPage) {
    rowPages.push(payload.rows.slice(index, index + rowsPerPage));
  }
  if (rowPages.length === 0) rowPages.push([]);

  for (let index = 0; index < rowPages.length; index += 1) {
    pages.push(await renderRowsCanvasPage(payload, rowPages[index], index, rowPages.length));
  }
  if (payload.sections.length > 0) {
    pages.push(...(await renderEquipmentCanvasPages(payload)));
  }
  return pages;
}

export async function exportShotListPdf(payload: ShotListExportPayload): Promise<boolean> {
  const filePath = await save({
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    defaultPath: `${sanitizeFileStem(payload.project.title)}_ShotList.pdf`,
  });
  if (!filePath) return false;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pages = await buildShotListExportPages(payload);
  for (let index = 0; index < pages.length; index += 1) {
    if (index > 0) doc.addPage();
    const pageDataUrl = pages[index].toDataURL("image/jpeg", 0.92);
    doc.addImage(pageDataUrl, "JPEG", 0, 0, 297, 210);
  }

  await writeFile(filePath, new Uint8Array(doc.output("arraybuffer")));
  return true;
}

export async function exportShotListImage(payload: ShotListExportPayload): Promise<boolean> {
  const filePath = await save({
    filters: [{ name: "JPEG Image", extensions: ["jpg", "jpeg"] }],
    defaultPath: `${sanitizeFileStem(payload.project.title)}_ShotList.jpg`,
  });
  if (!filePath) return false;

  const pages = await buildShotListExportPages(payload);
  const canvas = document.createElement("canvas");
  const gap = 28;
  canvas.width = EXPORT_PAGE_WIDTH;
  canvas.height = pages.reduce((sum, page) => sum + page.height, 0) + gap * Math.max(0, pages.length - 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Shot list image export canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const page of pages) {
    ctx.drawImage(page, 0, y, page.width, page.height);
    y += page.height + gap;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error("Shot list image export failed to create a blob"));
    }, "image/jpeg", 0.92);
  });
  await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
  return true;
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

function drawCanvasPill(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  const textWidth = ctx.measureText(label).width;
  const width = Math.max(92, textWidth + 32);
  ctx.fillStyle = PREPROD_ACCENT_SOFT;
  roundRect(ctx, x, y, width, 36, 14, true, false);
  ctx.fillStyle = "#0369a1";
  ctx.font = "800 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + width / 2, y + 22);
  ctx.textAlign = "left";
}

function trimText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const clean = text || "—";
  if (ctx.measureText(clean).width <= maxWidth) return clean;
  let trimmed = clean;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Shot list export image failed to load"));
  });
  return image;
}
