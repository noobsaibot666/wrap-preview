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

async function getIconDataUrl(iconName: string, size = 56, color = "#38bdf8"): Promise<string> {
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
              const dpr = window.devicePixelRatio || 2;
              const scaledSize = size * dpr;
              canvas.width = scaledSize;
              canvas.height = scaledSize;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                URL.revokeObjectURL(url);
                return reject(new Error("Canvas context unavailable"));
              }
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.scale(dpr, dpr);
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
        const parts = entry.split(CAMERA_SETUP_DELIMITER).map((part) => part.trim());
        const formatted = (parts.length >= 8
          ? [parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[7]]
          : parts)
          .filter(Boolean)
          .join(" / ");
        return formatted ? `Cam ${index + 1}: ${formatted}` : "";
      }
      return `Cam ${index + 1}: ${entry}`;
    })
    .filter(Boolean)
    .join(" • ");
}

function getPrimaryCameraMovement(row: ShotListRow) {
  const entries = (row.camera_lens || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > 0 && entries[0].includes(CAMERA_SETUP_DELIMITER)) {
    const parts = entries[0].split(CAMERA_SETUP_DELIMITER).map((entry) => entry.trim());
    if (parts.length >= 8 && parts[5]) return parts[5];
  }
  return row.camera_movement || row.movement || "Static";
}

function formatLocationTimingForExport(row: ShotListRow) {
  if (row.location || row.timing) {
    return [row.location, row.timing].filter(Boolean).join(" / ") || "—";
  }
  if (!row.location_time || !row.location_time.includes(LOCATION_TIME_DELIMITER)) {
    return row.location_time || "—";
  }
  const [location = "", start = "", end = ""] = row.location_time.split(LOCATION_TIME_DELIMITER).map((entry) => entry.trim());
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

const EXPORT_PAGE_WIDTH = 3508; // A4 @ 300 DPI
const EXPORT_PAGE_HEIGHT = 2480;
const EXPORT_MARGIN_X = 120;

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

function drawMetaInfoChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  accent: string = "#38bdf8"
) {
  ctx.fillStyle = "rgba(0,0,0,0.03)";
  roundRect(ctx, x, y, width, 72, 14, true, false);
  ctx.fillStyle = accent;
  roundRect(ctx, x + 16, y + 20, 8, 32, 4, true, false);
  ctx.fillStyle = "#6b7280";
  ctx.font = "800 12px Inter, system-ui, sans-serif";
  ctx.fillText(label.toUpperCase(), x + 34, y + 28);
  ctx.fillStyle = "#111827";
  ctx.font = "700 20px Inter, system-ui, sans-serif";
  ctx.fillText(value, x + 34, y + 54);
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

  drawMetaInfoChip(ctx, chipX, 64, chipWidth, "DAY SHEET", payload.project.day_label || "Day 1");
  chipX += chipWidth + chipGap;
  if (pageLabel) {
    drawMetaInfoChip(ctx, chipX, 64, chipWidth, "PROGRESS", pageLabel, "#a855f7");
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

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = "#ffffff";
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

  const rowsPerPage = 5;
  const rowHeight = (EXPORT_PAGE_HEIGHT - 320 - 120) / rowsPerPage;
  let y = 240;

  for (let i = 0; i < pageRows.length; i += 1) {
    const row = pageRows[i];
    const rowY = y + i * rowHeight;
    const rowWidth = EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2;

    // Row Background (Clean & Premium)
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, EXPORT_MARGIN_X, rowY, rowWidth, rowHeight - 20, 24, true, false);
    
    // Border
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 2;
    roundRect(ctx, EXPORT_MARGIN_X, rowY, rowWidth, rowHeight - 20, 24, false, true);

    // Sidebar Accent (Lavender for Shot List)
    ctx.fillStyle = "#6366f1";
    roundRect(ctx, EXPORT_MARGIN_X + 16, rowY + 16, 6, rowHeight - 52, 3, true, false);

    // Number + Icon Group
    const labelX = EXPORT_MARGIN_X + 48;
    ctx.fillStyle = "#0f1115";
    ctx.font = "800 32px Inter, system-ui, sans-serif";
    ctx.fillText(`${row.sort_order}`.padStart(2, "0"), labelX, rowY + 70);

    // Capture Type Icon
    const iconDataUrl = await getIconDataUrl(row.capture_type === "photo" ? "Camera" : "Video", 88, "#6366f1");
    const iconImg = await loadImage(iconDataUrl);
    ctx.drawImage(iconImg, labelX + 72, rowY + 34, 72, 72);

    // Shot Number / Scene
    ctx.fillStyle = "#111827";
    ctx.font = "800 34px Inter, system-ui, sans-serif";
    const title = `${row.shot_number || "SHOT"} ${row.scene ? `— ${row.scene}` : ""}`;
    ctx.fillText(trimText(ctx, title, 1000), labelX + 168, rowY + 68);

    // Shot Type / Movement sub-header
    ctx.fillStyle = "#6366f1";
    ctx.font = "700 20px Inter, system-ui, sans-serif";
    const subTitle = `${row.shot_type || "Medium"} • ${getPrimaryCameraMovement(row)}`;
    ctx.fillText(trimText(ctx, subTitle.toUpperCase(), 1000), labelX + 168, rowY + 98);

    // Description / Action (Left Column)
    ctx.fillStyle = "#4b5563";
    ctx.font = "500 22px Inter, system-ui, sans-serif";
    const desc = row.description || "No specific instructions provided for this setup.";
    ctx.fillText(trimText(ctx, desc, 1200), labelX + 168, rowY + 138);

    // Details Grid (Layout below)
    let detailsY = rowY + 180;
    const detailColWidth = 600;
    
    // Talent / Props
    ctx.fillStyle = "#111827";
    ctx.font = "700 18px Inter, system-ui, sans-serif";
    ctx.fillText("TALENT / PROPS", labelX + 168, detailsY);
    ctx.fillStyle = "#6b7280";
    ctx.font = "500 18px Inter, system-ui, sans-serif";
    const talentProps = [row.talent_subjects, row.props_details].filter(Boolean).join(" • ") || "None";
    ctx.fillText(trimText(ctx, talentProps, detailColWidth), labelX + 168, detailsY + 28);

    // Audio / Lighting
    ctx.fillStyle = "#111827";
    ctx.font = "700 18px Inter, system-ui, sans-serif";
    ctx.fillText("AUDIO / LIGHTING", labelX + 168 + detailColWidth + 40, detailsY);
    ctx.fillStyle = "#6b7280";
    ctx.font = "500 18px Inter, system-ui, sans-serif";
    const audioLight = [row.audio_notes, row.lighting_notes].filter(Boolean).join(" • ") || "Default Setup";
    ctx.fillText(trimText(ctx, audioLight, detailColWidth), labelX + 168 + detailColWidth + 40, detailsY + 28);

    // Info Chips (Right Aligned)
    let metaX = EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X - 1000;

    // Camera / Equipment Chip
    drawMetaInfoChip(ctx, metaX, rowY + 34, 380, "EQUIPMENT", trimText(ctx, formatCameraSetupsForExport(row.camera_lens || ""), 220), "#a855f7");
    metaX += 400;

    // Location / Timing Chip
    drawMetaInfoChip(ctx, metaX, rowY + 34, 580, "LOCATION / TIMING", formatLocationTimingForExport(row), "#14b8a6");
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

    let y = 260;
    let column = 0;
    let rowHeight = 0;
    const gap = 48;
    const cardWidth = (EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2 - gap) / 2;
    const xPositions = [EXPORT_MARGIN_X, EXPORT_MARGIN_X + cardWidth + gap];

    while (cardIndex < cards.length) {
      const { section, items } = cards[cardIndex];
      const itemsHeight = items.length * 72;
      const cardHeight = Math.max(340, 160 + itemsHeight);
      
      // If the card is too tall for this column or page
      if (column === 0 && y + cardHeight > EXPORT_PAGE_HEIGHT - 120) break;
      if (column === 1 && y + cardHeight > EXPORT_PAGE_HEIGHT - 120) break;

      const x = xPositions[column];
      
      // Card Container
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, x, y, cardWidth, cardHeight, 32, true, false);
      ctx.strokeStyle = "rgba(0,0,0,0.06)";
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, cardWidth, cardHeight, 32, false, true);

      // Section Header (Dark/Premium)
      ctx.fillStyle = "#0f1115";
      roundRect(ctx, x + 16, y + 16, cardWidth - 32, 110, 24, true, false);

      const sectionIcon = await loadImage(await getIconDataUrl(section.icon_name, 80, "#ffffff"));
      ctx.drawImage(sectionIcon, x + 36, y + 31, 80, 80);
      
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 32px Inter, system-ui, sans-serif";
      ctx.fillText(section.section_name.toUpperCase(), x + 136, y + 68);
      
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "600 18px Inter, system-ui, sans-serif";
      ctx.fillText(`${items.length} ITEMS LOGGED`, x + 136, y + 100);

      let itemY = y + 146;
      for (const item of items) {
        // Item Row
        ctx.fillStyle = "rgba(0,0,0,0.02)";
        roundRect(ctx, x + 16, itemY, cardWidth - 32, 60, 16, true, false);

        const itemIcon = await loadImage(await getIconDataUrl(item.icon_name, 56, "#6366f1"));
        ctx.drawImage(itemIcon, x + 24, itemY + 12, 36, 36);

        ctx.fillStyle = "#111827";
        ctx.font = "700 22px Inter, system-ui, sans-serif";
        ctx.fillText(trimText(ctx, item.item_name || "Gear", cardWidth - 180), x + 76, itemY + 28);
        
        ctx.fillStyle = "#6b7280";
        ctx.font = "500 16px Inter, system-ui, sans-serif";
        const meta = formatEquipmentItemMetaForExport(item) || item.item_type || "Item";
        ctx.fillText(trimText(ctx, meta, cardWidth - 180), x + 76, itemY + 48);
        
        itemY += 72;
      }

      rowHeight = Math.max(rowHeight, cardHeight + gap);
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
  // Ensure fonts are loaded before starting expensive canvas operations
  if (typeof document !== "undefined") {
    await document.fonts.ready;
  }
  
  const pages: HTMLCanvasElement[] = [];
  const rowsPerPage = 5;
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
  doc.setProperties({
    title: `${payload.project.title} - Shot List`,
    subject: "Shot List & Equipment Inventory",
    author: payload.brandName || "Wrap Preview",
    creator: "Wrap Preview",
  });
  const pages = await buildShotListExportPages(payload);
  for (let index = 0; index < pages.length; index += 1) {
    if (index > 0) doc.addPage();
    const pageDataUrl = pages[index].toDataURL("image/jpeg", 1.0);
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
    }, "image/jpeg", 1.0);
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
  image.decoding = "sync";
  image.crossOrigin = "anonymous";
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Shot list export image failed to load"));
  });
  return image;
}
