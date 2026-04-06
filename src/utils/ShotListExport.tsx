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

// Senior Developer Design System Tokens - Carbon Grey High Contrast
const EXPORT_PAGE_WIDTH = 2480; 
const EXPORT_PAGE_HEIGHT = 3508;
const EXPORT_MARGIN_X = 120;
const EXPORT_SAFE_Y = 180;

const COLORS = {
  PAGE_BG: "#cbd5e1", // Slate 300 (Deep Grey Page)
  CARD_BG: "#f8fafc", // Slate 50 (Very Light Grey, No Pure White)
  CARD_ACCENT: "#ffffff",
  BLACK: "#020617",   // Slate 950 (Absolute Black)
  PRIMARY: "#0f172a", // Slate 900 (Main Header)
  SECONDARY: "#334155", // Slate 700
  ACCENT: "#10b981",  // Emerald 600
  LABEL: "#020617",   // Absolute Black Labels
  MUTED: "#475569",   // Slate 600
  BORDER: "#020617",  // Absolute Black Border (High Contrast Layering)
  SUCCESS: "#10b981", // Emerald 600
  ACCENT_BG: "#dcfce7", // Emerald 100
} as const;

const CAMERA_SETUP_DELIMITER = "__SLCAM__";
const LOCATION_TIME_DELIMITER = "__SLTIME__";
const LOGO_DATA_URL = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXBCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxOCIgZmlsbD0id2hpdGUiLz48cmVjdCB4PSIxMiIgeT0iMTIiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcng9IjExIiBmaWxsPSIjMDkwOTA5Ii8+PHJlY3QgeD0iNDMiIHk9IjEyIiB3aWR0aD0iOSIgaGVpZ2h0PSI0MCIgcng9IjQiIGZpbGw9IiMxMGI5ODEiLz48L3N2Zz4=";

interface ShotListExportPayload {
  project: ShotListProject;
  rows: ShotListRow[];
  sections: ShotListEquipmentSection[];
  items: ShotListEquipmentItem[];
  appVersion?: string;
  brandName?: string;
  clientName?: string;
}

interface RowLayoutInfo {
  row: ShotListRow;
  height: number;
  descriptionLines: string[];
  setups: string[];
}

const iconCacheMap = new Map<string, Promise<string>>();

/**
 * High-performance SVG to Raster converter.
 */
async function getRasterIconUrl(name: string, size = 64, color: string = COLORS.ACCENT): Promise<string> {
  const key = `${name}:${size}:${color}`;
  if (!iconCacheMap.has(key)) {
    iconCacheMap.set(key, (async () => {
      try {
        const Icon = getShotListIconComponent(name);
        const svg = renderToStaticMarkup(createElement(Icon, { size: size - 16, color, strokeWidth: 3.5 }));
        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(8, 8)">${svg}</g></svg>`;
        const blob = new Blob([fullSvg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        return await new Promise<string>((res) => {
          img.onload = () => {
            const cv = document.createElement("canvas");
            cv.width = size * 2; cv.height = size * 2;
            const ctx = cv.getContext("2d")!; ctx.scale(2, 2);
            ctx.drawImage(img, 0, 0, size, size);
            URL.revokeObjectURL(url);
            res(cv.toDataURL("image/png"));
          };
          img.onerror = () => res("");
          img.src = url;
        });
      } catch { return ""; }
    })());
  }
  return iconCacheMap.get(key)!;
}

/**
 * Smart Canvas Text Wrapper.
 */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (ctx.measureText(`${cur} ${w}`).width < maxW) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  lines.push(cur);
  return lines;
}

/**
 * High-fidelity layout pass.
 */
function solveProductionLayout(ctx: CanvasRenderingContext2D, rows: ShotListRow[]): RowLayoutInfo[][] {
  const pages: RowLayoutInfo[][] = [];
  let currentBatch: RowLayoutInfo[] = [];
  let cy = 350;
  const limit = EXPORT_PAGE_HEIGHT - (EXPORT_SAFE_Y + 150);

  for (const row of rows) {
    ctx.font = "700 38px Inter, sans-serif";
    const dLines = wrapCanvasText(ctx, row.description || "Action description not defined.", EXPORT_PAGE_WIDTH - 400);
    const setups = (row.camera_lens || "").split("\n").filter(s => s.trim().length > 0);
    const h = 220 + (dLines.length * 56) + 280 + (setups.length > 0 ? 120 + (setups.length * 104) : 0) + 60;
    
    if (cy + h > limit && currentBatch.length > 0) {
      pages.push(currentBatch); currentBatch = []; cy = 350;
    }
    currentBatch.push({ row, height: h, descriptionLines: dLines, setups });
    cy += h + 60;
  }
  if (currentBatch.length > 0) pages.push(currentBatch);
  return pages;
}

async function renderPremiumHeader(ctx: CanvasRenderingContext2D, payload: ShotListExportPayload, title: string, pageLabel: string) {
  // Main Backdrop (Absolute Contrast)
  ctx.fillStyle = COLORS.PRIMARY;
  roundRect(ctx, EXPORT_MARGIN_X, 64, EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2, 240, 24, true, false);
  ctx.strokeStyle = COLORS.BLACK; ctx.lineWidth = 4;
  roundRect(ctx, EXPORT_MARGIN_X, 64, EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2, 240, 24, false, true);

  const logo = await safeLoad(LOGO_DATA_URL);
  if (logo) ctx.drawImage(logo, EXPORT_MARGIN_X + 64, 104, 112, 112);

  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "900 24px Inter, sans-serif";
  ctx.fillText("PRODUCTION PORTAL", EXPORT_MARGIN_X + 210, 126);

  ctx.fillStyle = "#ffffff"; ctx.font = "900 85px Inter, sans-serif";
  ctx.fillText(trimText(ctx, title, 900), EXPORT_MARGIN_X + 210, 204);

  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "700 30px Inter, sans-serif";
  ctx.fillText(payload.clientName || "Wrap Studio", EXPORT_MARGIN_X + 210, 252);

  const sx = EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X - 600;
  const drawStat = (x: number, lbl: string, val: string, cr: string, w: number) => {
     ctx.fillStyle = "rgba(0,0,0,0.5)";
     roundRect(ctx, x, 88, w, 192, 16, true, false);
     ctx.fillStyle = cr; roundRect(ctx, x + 24, 134, 12, 100, 6, true, false);
     ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "900 18px Inter, sans-serif"; ctx.fillText(lbl.toUpperCase(), x + 56, 136);
     ctx.fillStyle = "#ffffff"; ctx.font = "900 36px Inter, sans-serif"; ctx.fillText(trimText(ctx, val, w - 100), x + 56, 190);
  };
  drawStat(sx, "Day / Status", payload.project.day_label || "Day 01", "#10b981", 360);
  drawStat(sx + 390, "Page", pageLabel, COLORS.ACCENT, 210);
}

async function exportProductionPage(payload: ShotListExportPayload, items: RowLayoutInfo[], idx: number, total: number, targetH?: number) {
  const cn = document.createElement("canvas");
  cn.width = EXPORT_PAGE_WIDTH; cn.height = targetH || EXPORT_PAGE_HEIGHT;
  const ctx = cn.getContext("2d")!;
  ctx.fillStyle = COLORS.PAGE_BG; ctx.fillRect(0, 0, cn.width, cn.height);
  await renderPremiumHeader(ctx, payload, "Production Shot List", `${idx + 1}/${total}`);

  let y = 350;
  for (const info of items) {
    const isDone = info.row.status?.toLowerCase() === "done";
    const accent = isDone ? COLORS.SUCCESS : COLORS.ACCENT;
    const rw = EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2;
    const mx = EXPORT_MARGIN_X;

    // Carbon Card (Non-white)
    ctx.shadowColor = "rgba(0,0,0,0.2)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
    ctx.fillStyle = COLORS.CARD_BG; roundRect(ctx, mx, y, rw, info.height, 32, true, false);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = COLORS.BLACK; ctx.lineWidth = 5; roundRect(ctx, mx, y, rw, info.height, 32, false, true);

    // Identity Strip
    ctx.fillStyle = accent; roundRect(ctx, mx + 20, y + 40, 14, info.height - 84, 7, true, false);

    ctx.fillStyle = COLORS.PRIMARY; ctx.font = "900 64px Inter, sans-serif"; ctx.fillText(`${info.row.sort_order}`.padStart(2, "0"), mx + 90, y + 90);
    const mIcoData = await getRasterIconUrl(info.row.capture_type === "photo" ? "photo" : "video", 80, accent as string);
    const mIco = await safeLoad(mIcoData);
    if (mIco) ctx.drawImage(mIco, mx + 180, y + 36, 80, 80);
    
    ctx.fillStyle = COLORS.BLACK; ctx.font = "900 75px Inter, sans-serif";
    const titleText = [info.row.shot_number || "SHOT", info.row.scene].filter(Boolean).join(" — ");
    ctx.fillText(trimText(ctx, titleText, rw - 480), mx + 290, y + 95);

    ctx.fillStyle = accent; ctx.font = "900 36px Inter, sans-serif";
    const subline = `${info.row.shot_type || "Medium"} • ${(info.setups[0] || "").split(CAMERA_SETUP_DELIMITER)[5] || "Static"}`.toUpperCase();
    ctx.fillText(trimText(ctx, subline, rw - 400), mx + 290, y + 148);

    ctx.fillStyle = COLORS.PRIMARY; ctx.font = "700 40px Inter, sans-serif";
    info.descriptionLines.forEach((line, i) => ctx.fillText(line, mx + 90, y + 225 + i * 58));

    const gy = y + 245 + (info.descriptionLines.length * 58);
    const cw = (rw - 180) / 3;
    const drawMetaCell = async (c: number, r: number, ico: string, lbl: string, val: string, clr: string) => {
      const gx = mx + 90 + c * cw; const gcy = gy + r * 115;
      ctx.fillStyle = `${clr}33`; roundRect(ctx, gx, gcy - 52, 72, 72, 16, true, false);
      const iconUrl = await getRasterIconUrl(ico, 60, clr);
      const iconImg = await safeLoad(iconUrl);
      if (iconImg) ctx.drawImage(iconImg, gx + 6, gcy - 46, 60, 60);
      ctx.fillStyle = COLORS.SECONDARY; ctx.font = "900 18px Inter, sans-serif"; ctx.fillText(lbl.toUpperCase(), gx + 96, gcy - 24);
      ctx.fillStyle = COLORS.BLACK; ctx.font = "900 34px Inter, sans-serif"; ctx.fillText(trimText(ctx, val || "—", cw - 120), gx + 96, gcy + 22);
    };

    const locText = getFormattedLoc(info.row);
    await drawMetaCell(0, 0, "location", "LOCATION / TIMING", locText, "#0d9488");
    await drawMetaCell(1, 0, "timing", "SCENE GROUP", info.row.scene || "Intro", "#ea580c");
    await drawMetaCell(2, 0, "rig", "TALENT", info.row.talent_subjects || "—", "#7c3aed");
    await drawMetaCell(0, 1, "grip", "PROPS", info.row.props_details || "—", "#db2777");
    await drawMetaCell(1, 1, "sound", "AUDIO NOTES", info.row.audio_notes || "Muted", "#0891b2");
    await drawMetaCell(2, 1, "light", "LIGHTING", info.row.lighting_notes || "Available", "#c2410c");

    if (info.setups.length > 0) {
      const sy = y + 490 + (info.descriptionLines.length * 58);
      ctx.fillStyle = COLORS.BLACK; roundRect(ctx, mx + 90, sy - 44, 340, 52, 8, true, false);
      ctx.fillStyle = "#ffffff"; ctx.font = "900 20px Inter, sans-serif"; ctx.fillText("CAMERA REGISTRATIONS", mx + 116, sy - 10);
      for (let si = 0; si < info.setups.length; si++) {
        const parts = info.setups[si].split(CAMERA_SETUP_DELIMITER).map(v => v.trim());
        const by = sy + 44 + si * 104;
        ctx.fillStyle = "rgba(0,0,0,0.05)"; roundRect(ctx, mx + 90, by - 48, rw - 180, 92, 12, true, false);
        ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 2; roundRect(ctx, mx + 90, by - 48, rw - 180, 92, 12, false, true);
        ctx.fillStyle = accent; ctx.font = "900 30px Inter, sans-serif"; ctx.fillText(`CAM 0${si+1}`, mx + 130, by + 12);
        const drawSub = (ox: number, sl: string, sv: string, sw: number) => {
          ctx.fillStyle = COLORS.MUTED; ctx.font = "900 15px Inter, sans-serif"; ctx.fillText(sl.toUpperCase(), mx + ox, by - 16);
          ctx.fillStyle = COLORS.BLACK; ctx.font = "900 25px Inter, sans-serif"; ctx.fillText(trimText(ctx, sv || "—", sw), mx + ox, by + 18);
        };
        drawSub(300, "BODY", parts[0], 360); drawSub(720, "LENS", parts[1], 360); drawSub(1140, "MEDIA", parts[3], 260); drawSub(1460, "SUPPORT", parts[4], 260); drawSub(1780, "MOVEMENT", parts[5], 260);
      }
    }
    y += info.height + 60;
  }
  drawFooter({ kind: "canvas", ctx, canvasWidth: EXPORT_PAGE_WIDTH, canvasHeight: targetH || EXPORT_PAGE_HEIGHT, marginX: EXPORT_MARGIN_X }, payload.brandName || "Wrap Preview");
  return cn;
}

export async function exportShotListPdf(payload: ShotListExportPayload) {
  try {
    const p = await save({ filters: [{ name: "PDF Export", extensions: ["pdf"] }], defaultPath: `${payload.project.title}_Carbon_HD.pdf` });
    if (!p) return false;
    const dummy = document.createElement("canvas"); dummy.width = 1; dummy.height = 1;
    const layouts = solveProductionLayout(dummy.getContext("2d")!, payload.rows);
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    for (let i = 0; i < layouts.length; i++) {
        if (i > 0) doc.addPage();
        const cn = await exportProductionPage(payload, layouts[i], i, layouts.length);
        doc.addImage(cn.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
    }
    if (payload.sections.length > 0) {
      const inv = await renderPremiumInventory(payload);
      for (const ic of inv) { doc.addPage(); doc.addImage(ic.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297); }
    }
    await writeFile(p, new Uint8Array(doc.output("arraybuffer")));
    return true;
  } catch (e) { return false; }
}

export async function exportShotListImage(payload: ShotListExportPayload) {
  try {
    const p = await save({ filters: [{ name: "Image Export", extensions: ["png"] }], defaultPath: "ShotList_Carbon_Master.png" });
    if (!p) return false;
    const dummy = document.createElement("canvas"); dummy.width = 1; dummy.height = 1;
    const layouts = solveProductionLayout(dummy.getContext("2d")!, payload.rows);
    const totalH = layouts.length * EXPORT_PAGE_HEIGHT;
    const finalCn = document.createElement("canvas");
    finalCn.width = EXPORT_PAGE_WIDTH; finalCn.height = totalH;
    const fctx = finalCn.getContext("2d")!;
    fctx.fillStyle = COLORS.PAGE_BG; fctx.fillRect(0, 0, finalCn.width, finalCn.height);
    for (let i = 0; i < layouts.length; i++) {
        const pageCn = await exportProductionPage(payload, layouts[i], i, layouts.length);
        fctx.drawImage(pageCn, 0, i * EXPORT_PAGE_HEIGHT);
    }
    const bin = atob(finalCn.toDataURL("image/png").split(",")[1]);
    const b = new Uint8Array(bin.length);
    for (let l = 0; l < bin.length; l++) b[l] = bin.charCodeAt(l);
    await writeFile(p, b);
    return true;
  } catch (e) { return false; }
}

function getFormattedLoc(r: ShotListRow) {
  if (r.location || r.timing) return [r.location, r.timing].filter(Boolean).join(" / ") || "—";
  const p = (r.location_time || "").split(LOCATION_TIME_DELIMITER).map(s => s.trim());
  return [p[0], p[1] && p[2] ? `${p[1]}-${p[2]}` : p[1] || p[2]].filter(Boolean).join(" / ") || "—";
}

async function safeLoad(u: string): Promise<HTMLImageElement | null> {
  const i = new Image(); i.src = u;
  return new Promise(res => { i.onload = () => res(i); i.onerror = () => res(null); });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, f: boolean, s: boolean) {
  const r2 = Math.min(r, w/2, h/2); ctx.beginPath(); ctx.moveTo(x+r2, y); ctx.arcTo(x+w, y, x+w, y+h, r2); ctx.arcTo(x+w, y+h, x, y+h, r2); ctx.arcTo(x, y+h, x, y, r2); ctx.arcTo(x, y, x+w, y, r2); ctx.closePath();
  if (f) ctx.fill(); if (s) ctx.stroke();
}

function trimText(ctx: CanvasRenderingContext2D, t: string, m: number) {
  if (ctx.measureText(t || "—").width <= m) return t || "—";
  let s = t || "—"; while (s.length > 1 && ctx.measureText(`${s}…`).width > m) s = s.slice(0, -1);
  return `${s}…`;
}

async function renderPremiumInventory(p: ShotListExportPayload) {
  const pgs: HTMLCanvasElement[] = [];
  let cy = 350; let col = 0; const gap = 60; const cw = (EXPORT_PAGE_WIDTH - EXPORT_MARGIN_X * 2 - gap) / 2;
  const offs = [EXPORT_MARGIN_X, EXPORT_MARGIN_X + cw + gap];
  const setupBase = async (pg: number) => {
    const res = await createExportCanvas(p, "Equipment Inventory", `${pg + 1}/?`);
    return res;
  };
  let res = await setupBase(0); let canvas = res.cn; let ctx = res.ctx;
  for (const s of p.sections) {
    const its = p.items.filter(i => i.section_id === s.id).sort((a,b) => a.sort_order - b.sort_order);
    if (!its.length) continue;
    const h = 200 + its.length * 88;
    if (cy + h > EXPORT_PAGE_HEIGHT - 240) {
      if (col === 0) { col = 1; cy = 350; }
      else {
        drawFooter({ kind: "canvas", ctx, canvasWidth: EXPORT_PAGE_WIDTH, canvasHeight: EXPORT_PAGE_HEIGHT, marginX: EXPORT_MARGIN_X }, p.brandName || "Wrap Preview");
        pgs.push(canvas); res = await setupBase(pgs.length);
        canvas = res.cn; ctx = res.ctx; cy = 350; col = 0;
      }
    }
    const x = offs[col];
    ctx.fillStyle = COLORS.CARD_BG; roundRect(ctx, x, cy, cw, h, 32, true, false);
    ctx.strokeStyle = COLORS.BLACK; ctx.lineWidth = 5; roundRect(ctx, x, cy, cw, h, 32, false, true);
    ctx.fillStyle = COLORS.PRIMARY; roundRect(ctx, x+24, cy+24, cw-48, 130, 16, true, false);
    const icoData = await getRasterIconUrl(s.icon_name, 96, "#ffffff");
    const img = await safeLoad(icoData); if (img) ctx.drawImage(img, x+56, cy+42, 90, 90);
    ctx.fillStyle = "#ffffff"; ctx.font = "900 40px Inter, sans-serif"; ctx.fillText(s.section_name.toUpperCase(), x+164, cy+95);
    let iy = cy + 180;
    for (const i of its) {
      ctx.fillStyle = "rgba(0,0,0,0.06)"; roundRect(ctx, x+24, iy, cw-48, 76, 12, true, false);
      const ii = await getRasterIconUrl(i.icon_name, 64, COLORS.ACCENT as string);
      const ig = await safeLoad(ii); if (ig) ctx.drawImage(ig, x+36, iy+14, 48, 48);
      ctx.fillStyle = COLORS.BLACK; ctx.font = "900 26px Inter, sans-serif"; ctx.fillText(trimText(ctx, i.item_name, cw - 140), x+98, iy+34);
      const m = [i.camera_label, i.media_type, i.capacity_value ? `${i.capacity_value}${i.capacity_unit}` : "", i.notes].filter(Boolean).join(" • ");
      ctx.fillStyle = COLORS.SECONDARY; ctx.font = "900 19px Inter, sans-serif"; ctx.fillText(trimText(ctx, m, cw - 140), x+98, iy+62);
      iy += 88;
    }
    cy += h + 40;
  }
  drawFooter({ kind: "canvas", ctx, canvasWidth: EXPORT_PAGE_WIDTH, canvasHeight: EXPORT_PAGE_HEIGHT, marginX: EXPORT_MARGIN_X }, p.brandName || "Wrap Preview");
  pgs.push(canvas);
  return pgs;
}

async function createExportCanvas(p: ShotListExportPayload, t: string, pl: string) {
  const cn = document.createElement("canvas");
  cn.width = EXPORT_PAGE_WIDTH; cn.height = EXPORT_PAGE_HEIGHT;
  const ctx = cn.getContext("2d")!;
  ctx.fillStyle = COLORS.PAGE_BG; ctx.fillRect(0, 0, EXPORT_PAGE_WIDTH, EXPORT_PAGE_HEIGHT);
  await renderPremiumHeader(ctx, p, t, pl);
  return { cn, ctx };
}
