import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { jsPDF } from "jspdf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  drawFooter,
  drawHeader,
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
}

const PREPROD_ACCENT = "#7dd3fc";
const PREPROD_ACCENT_SOFT = "#e0f2fe";
const EXPORT_TEXT = "#111827";
const EXPORT_MUTED = "#64748b";
const EXPORT_BORDER = "#dbe4ef";
const EXPORT_PANEL = "#f8fbff";
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
        const Icon = getShotListIconComponent(iconName);
        const svg = renderToStaticMarkup(
          createElement(Icon, { size: size - 10, strokeWidth: 1.7, color }),
        );
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="1.5" y="1.5" width="${size - 3}" height="${size - 3}" rx="${Math.round(
            size * 0.24,
          )}" fill="#ffffff" stroke="${color}" stroke-opacity="0.35" />${svg.replace(
            "<svg",
            `<svg x="5" y="5" width="${size - 10}" height="${size - 10}"`,
          )}</svg>`,
        )}`;
        const image = new Image();
        image.src = dataUrl;
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Failed to rasterize ${iconName}`));
        });
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Shot list export icon canvas unavailable");
        ctx.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png");
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

async function createExportPage(
  payload: ShotListExportPayload,
  title: string,
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_PAGE_WIDTH;
  canvas.height = EXPORT_PAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Shot list export canvas unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, EXPORT_PAGE_WIDTH, EXPORT_PAGE_HEIGHT);
  await drawHeader(
    {
      kind: "canvas",
      ctx,
      canvasWidth: EXPORT_PAGE_WIDTH,
      marginX: EXPORT_MARGIN_X,
    },
    {
      appName: payload.brandName || "Wrap Preview",
      appVersion: payload.appVersion || "unknown",
      exportedAt: new Date(),
      projectName: payload.project.title,
      title,
    },
  );
  return { canvas, ctx };
}

function drawExportPageMeta(
  ctx: CanvasRenderingContext2D,
  project: ShotListProject,
  rightText?: string,
) {
  ctx.fillStyle = EXPORT_TEXT;
  ctx.font = "700 38px Inter, system-ui, sans-serif";
  ctx.fillText(project.title, EXPORT_MARGIN_X, 152);
  ctx.fillStyle = EXPORT_MUTED;
  ctx.font = "500 20px Inter, system-ui, sans-serif";
  ctx.fillText(`Day Sheet: ${project.day_label}`, EXPORT_MARGIN_X, 184);
  if (rightText) {
    ctx.textAlign = "right";
    ctx.fillText(rightText, EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X, 152);
    ctx.textAlign = "left";
  }
}

async function renderRowsCanvasPage(
  payload: ShotListExportPayload,
  pageRows: ShotListRow[],
  pageIndex: number,
  totalPages: number,
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = await createExportPage(payload, "Shot List");
  drawExportPageMeta(ctx, payload.project, `Rows ${pageIndex + 1}/${totalPages}`);

  let y = 224;
  for (const row of pageRows) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = EXPORT_BORDER;
    ctx.lineWidth = 2;
    roundRect(ctx, EXPORT_MARGIN_X, y, EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2, EXPORT_ROW_CARD_HEIGHT, 20, true, true);

    const icon = await getIconDataUrl(row.capture_type, 66);
    const img = await loadImage(icon);
    ctx.drawImage(img, EXPORT_MARGIN_X + 24, y + 16, 42, 42);

    ctx.fillStyle = EXPORT_TEXT;
    ctx.font = "700 22px Inter, system-ui, sans-serif";
    ctx.fillText(row.shot_number || "—", EXPORT_MARGIN_X + 88, y + 30);
    ctx.font = "700 18px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, row.scene_setup || "—", 280), EXPORT_MARGIN_X + 152, y + 30);

    ctx.fillStyle = EXPORT_MUTED;
    ctx.font = "500 16px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, row.description || "—", 560), EXPORT_MARGIN_X + 152, y + 58);

    ctx.fillStyle = EXPORT_TEXT;
    ctx.font = "600 16px Inter, system-ui, sans-serif";
    ctx.fillText(trimText(ctx, formatCameraSetupsForExport(row.camera_lens), 300), 890, y + 30);
    ctx.fillStyle = EXPORT_MUTED;
    ctx.fillText(trimText(ctx, row.movement || "—", 140), 1210, y + 30);
    ctx.fillText(trimText(ctx, formatLocationTimingForExport(row.location_time), 200), 1360, y + 30);

    drawCanvasPill(ctx, (row.status || "planned").toUpperCase(), EXPORT_PAGE_WIDTH - 214, y + 18);
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
    const { canvas, ctx } = await createExportPage(payload, "Shot List Equipment");
    drawExportPageMeta(ctx, payload.project, `Equipment ${pages.length + 1}`);

    let y = 224;
    let column = 0;
    let rowHeight = 0;
    const cardWidth = (EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2 - 20) / 2;
    const xPositions = [EXPORT_MARGIN_X, EXPORT_MARGIN_X + cardWidth + 20];

    while (cardIndex < cards.length) {
      const { section, items } = cards[cardIndex];
      const cardHeight = Math.max(164, 94 + items.length * 48);
      if (column === 0 && y + cardHeight > EXPORT_PAGE_HEIGHT - 64) break;

      const x = xPositions[column];
      ctx.fillStyle = EXPORT_PANEL;
      ctx.strokeStyle = EXPORT_BORDER;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, cardWidth, cardHeight, 24, true, true);

      const icon = await loadImage(await getIconDataUrl(section.icon_name, 72));
      ctx.drawImage(icon, x + 18, y + 16, 42, 42);
      ctx.fillStyle = EXPORT_TEXT;
      ctx.font = "700 24px Inter, system-ui, sans-serif";
      ctx.fillText(section.section_name, x + 74, y + 38);
      ctx.fillStyle = EXPORT_MUTED;
      ctx.font = "500 15px Inter, system-ui, sans-serif";
      ctx.fillText(`${items.length} items`, x + 74, y + 60);

      let itemY = y + 88;
      for (const item of items) {
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1.5;
        roundRect(ctx, x + 14, itemY, cardWidth - 28, 40, 14, true, true);
        const itemIcon = await loadImage(await getIconDataUrl(item.icon_name, 52, "#8b5cf6"));
        ctx.drawImage(itemIcon, x + 22, itemY + 4, 32, 32);
        ctx.fillStyle = EXPORT_TEXT;
        ctx.font = "700 16px Inter, system-ui, sans-serif";
        ctx.fillText(trimText(ctx, item.item_name || "Unnamed item", cardWidth - 138), x + 64, itemY + 18);
        ctx.fillStyle = EXPORT_MUTED;
        ctx.font = "500 12px Inter, system-ui, sans-serif";
        ctx.fillText(trimText(ctx, formatEquipmentItemMetaForExport(item) || item.item_type || "Gear item", cardWidth - 138), x + 64, itemY + 33);
        itemY += 46;
      }

      rowHeight = Math.max(rowHeight, cardHeight + 16);
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
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawCanvasPill(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  const width = Math.max(92, label.length * 12 + 26);
  ctx.fillStyle = PREPROD_ACCENT_SOFT;
  roundRect(ctx, x, y, width, 32, 16, true, false);
  ctx.fillStyle = "#0e7490";
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  ctx.fillText(label, x + 16, y + 21);
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
