import { invoke } from "@tauri-apps/api/core";
import { jsPDF } from "jspdf";
import { drawFooter, drawHeader } from "./ExportBranding";

export interface SafeCopyVerificationJob {
  id: string;
  project_id: string;
  created_at: string;
  source_path: string;
  source_root: string;
  source_label: string;
  dest_path: string;
  dest_root: string;
  dest_label: string;
  mode: string;
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  total_files: number;
  total_bytes: number;
  verified_ok_count: number;
  missing_count: number;
  size_mismatch_count: number;
  hash_mismatch_count: number;
  unreadable_count: number;
  extra_in_dest_count: number;
}

export interface SafeCopyVerificationItem {
  rel_path: string;
  source_size: number;
  dest_size?: number;
  status: string;
  error_message?: string;
}

export interface SafeCopyQueueItem {
  idx: number;
  label?: string | null;
}

interface SavePdfOptions {
  filePath: string;
  appVersion: string;
  projectName?: string;
  onWarning?: (message: string) => void;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;
const PAGE_BOTTOM = 278;

function formatDurationMs(durationMs?: number | null) {
  const value = durationMs ?? 0;
  if (value < 1000) return `${value} ms`;
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function statusTone(status: string) {
  switch (status.toUpperCase()) {
    case "DONE":
    case "OK":
      return { fill: [20, 24, 27], border: [42, 46, 52], text: [245, 245, 245] };
    case "FAILED":
    case "MISSING":
    case "HASH_MISMATCH":
    case "SIZE_MISMATCH":
      return { fill: [38, 18, 20], border: [94, 35, 40], text: [255, 92, 92] };
    case "CANCELLED":
      return { fill: [24, 24, 26], border: [54, 54, 58], text: [160, 160, 165] };
    default:
      return { fill: [20, 24, 27], border: [42, 46, 52], text: [215, 215, 220] };
  }
}

function drawSectionLabel(doc: jsPDF, label: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(label.toUpperCase(), MARGIN, y);
  return y + 6;
}

function drawKeyValueLine(doc: jsPDF, label: string, value: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(54);
  doc.text(label, MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(92);
  doc.text(value, MARGIN + 28, y);
  return y + 5.5;
}

function drawWrappedText(doc: jsPDF, text: string, x: number, y: number, width: number, lineHeight = 4.5) {
  const lines = doc.splitTextToSize(text, width) as string[];
  lines.forEach((line, index) => {
    doc.text(line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function drawSummaryChips(doc: jsPDF, job: SafeCopyVerificationJob, y: number) {
  const stats = [
    { label: "Verified", value: String(job.verified_ok_count), tone: "neutral" },
    { label: "Missing", value: String(job.missing_count), tone: "fail" },
    { label: "Size", value: String(job.size_mismatch_count), tone: "fail" },
    { label: "Hash", value: String(job.hash_mismatch_count), tone: "fail" },
    { label: "Unreadable", value: String(job.unreadable_count), tone: "fail" },
    { label: "Extra", value: String(job.extra_in_dest_count), tone: "neutral" },
  ];

  const cols = 3;
  const gap = 4;
  const cardW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cardH = 18;

  stats.forEach((stat, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = MARGIN + col * (cardW + gap);
    const cardY = y + row * (cardH + gap);
    const isFail = stat.tone === "fail" && Number(stat.value) > 0;

    doc.setFillColor(isFail ? 37 : 20, isFail ? 16 : 21, isFail ? 18 : 24);
    doc.setDrawColor(isFail ? 100 : 45, isFail ? 42 : 48, isFail ? 46 : 54);
    doc.roundedRect(x, cardY, cardW, cardH, 4, 4, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(stat.label.toUpperCase(), x + 4, cardY + 6);

    doc.setFontSize(15);
    doc.setTextColor(isFail ? 255 : 245, isFail ? 92 : 245, isFail ? 92 : 245);
    doc.text(stat.value, x + 4, cardY + 14);
  });

  return y + Math.ceil(stats.length / cols) * (cardH + gap) - gap + 4;
}

function writeJobSummaryBlock(doc: jsPDF, y: number, job: SafeCopyVerificationJob, label?: string | null) {
  const tone = statusTone(job.status);
  doc.setFillColor(tone.fill[0], tone.fill[1], tone.fill[2]);
  doc.setDrawColor(tone.border[0], tone.border[1], tone.border[2]);
  doc.roundedRect(MARGIN, y, CONTENT_W, 18, 5, 5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(245);
  doc.text(label || "Verification Pair", MARGIN + 6, y + 7);

  doc.setFontSize(8);
  doc.setTextColor(tone.text[0], tone.text[1], tone.text[2]);
  doc.text(job.status.toUpperCase(), PAGE_W - MARGIN - 6, y + 7, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(168);
  const meta = [`Mode ${job.mode}`, `${job.total_files} files`, formatBytes(job.total_bytes), formatDurationMs(job.duration_ms)].join("  •  ");
  doc.text(meta, MARGIN + 6, y + 13);

  y += 26;
  y = drawSectionLabel(doc, "Paths", y);
  y = drawKeyValueLine(doc, "Source", job.source_root, y);
  y = drawKeyValueLine(doc, "Destination", job.dest_root, y);
  y += 3;

  y = drawSectionLabel(doc, "Summary", y);
  y = drawSummaryChips(doc, job, y);

  return y;
}

function issueRowHeight(doc: jsPDF, item: SafeCopyVerificationItem, width: number) {
  const pathLines = doc.splitTextToSize(item.rel_path, width) as string[];
  const detail = item.error_message ? item.error_message.slice(0, 180) : "";
  const detailLines = detail ? (doc.splitTextToSize(detail, width) as string[]) : [];
  return 8 + pathLines.length * 4.5 + detailLines.length * 3.8;
}

function drawIssueTableHeader(doc: jsPDF, y: number) {
  doc.setFillColor(18, 19, 22);
  doc.roundedRect(MARGIN, y, CONTENT_W, 10, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(160);
  doc.text("STATUS", MARGIN + 4, y + 6.5);
  doc.text("FILE", MARGIN + 30, y + 6.5);
  doc.text("DETAILS", PAGE_W - MARGIN - 4, y + 6.5, { align: "right" });
  return y + 12;
}

function writeIssueRows(
  doc: jsPDF,
  y: number,
  items: SafeCopyVerificationItem[],
  pageNumber: number,
  options: SavePdfOptions,
  title: string,
) {
  const issues = items.filter((item) => item.status !== "OK");
  y = drawSectionLabel(doc, "Problems", y);

  if (issues.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(96);
    doc.text("No problems detected.", MARGIN, y);
    return { y: y + 8, pageNumber };
  }

  y = drawIssueTableHeader(doc, y);

  for (const item of issues) {
    const rowH = issueRowHeight(doc, item, 112);
    if (y + rowH > PAGE_BOTTOM) {
      finalizePage(doc, pageNumber);
      pageNumber += 1;
      y = preparePageSync(doc, pageNumber, title, options.appVersion, options.projectName);
      y = drawSectionLabel(doc, "Problems", y);
      y = drawIssueTableHeader(doc, y);
    }

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(230, 232, 236);
    doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 3, 3, "FD");

    const tone = statusTone(item.status);
    doc.setFillColor(tone.fill[0], tone.fill[1], tone.fill[2]);
    doc.setDrawColor(tone.border[0], tone.border[1], tone.border[2]);
    doc.roundedRect(MARGIN + 4, y + 4, 18, 7, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(tone.text[0], tone.text[1], tone.text[2]);
    doc.text(item.status.toUpperCase(), MARGIN + 13, y + 8.6, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6);
    doc.setTextColor(36);
    const pathX = MARGIN + 30;
    const detailsRight = PAGE_W - MARGIN - 4;
    const detailsWidth = 46;
    const pathWidth = CONTENT_W - 30 - detailsWidth - 8;
    const afterPathY = drawWrappedText(doc, item.rel_path, pathX, y + 7, pathWidth, 4.3);

    const detailText = item.error_message
      ? item.error_message.slice(0, 180)
      : item.dest_size != null
        ? `src ${formatBytes(item.source_size)}  •  dst ${formatBytes(item.dest_size)}`
        : `src ${formatBytes(item.source_size)}`;
    doc.setFontSize(7.6);
    doc.setTextColor(118);
    const detailLines = doc.splitTextToSize(detailText, detailsWidth) as string[];
    detailLines.forEach((line, index) => {
      doc.text(line, detailsRight, y + 7 + index * 3.8, { align: "right" });
    });

    y = Math.max(afterPathY, y + 7 + detailLines.length * 3.8) + 4;
  }

  return { y, pageNumber };
}

async function preparePage(
  doc: jsPDF,
  pageNumber: number,
  title: string,
  appVersion: string,
  projectName?: string,
  onWarning?: (message: string) => void
) {
  if (pageNumber > 1) {
    doc.addPage("a4", "portrait");
  }
  await drawHeader(
    {
      kind: "pdf",
      doc,
      pageWidth: PAGE_W,
      margin: MARGIN,
    },
    {
      appName: "CineFlow Suite",
      appVersion,
      exportedAt: new Date(),
      projectName,
      title,
    },
    onWarning
  );
  return 42;
}

function preparePageSync(
  doc: jsPDF,
  pageNumber: number,
  title: string,
  appVersion: string,
  projectName?: string,
) {
  if (pageNumber > 1) {
    doc.addPage("a4", "portrait");
  }
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(24);
  doc.text("CineFlow Suite", MARGIN, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(130);
  doc.text(`${title}  •  v${appVersion}`, MARGIN, 25.5);
  if (projectName) {
    doc.text(projectName, PAGE_W - MARGIN, 20, { align: "right" });
  }
  return 34;
}

function finalizePage(doc: jsPDF, pageNumber: number) {
  drawFooter(
    {
      kind: "pdf",
      doc,
      pageWidth: PAGE_W,
      pageHeight: PAGE_H,
      margin: MARGIN,
      pageLabel: `Page ${pageNumber}`,
    },
    "CineFlow Suite"
  );
}

export async function saveSafeCopyJobPdf(
  options: SavePdfOptions,
  job: SafeCopyVerificationJob,
  items: SafeCopyVerificationItem[]
) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let pageNumber = 1;
  let y = await preparePage(doc, pageNumber, "Verification Report", options.appVersion, options.projectName, options.onWarning);
  y = writeJobSummaryBlock(doc, y, job, `${job.source_label} → ${job.dest_label}`);
  const result = writeIssueRows(doc, y, items, pageNumber, options, "Verification Report");
  finalizePage(doc, result.pageNumber);
  await invoke("save_image_data_url", { path: options.filePath, dataUrl: doc.output("datauristring") });
}

export async function saveSafeCopyQueuePdf(
  options: SavePdfOptions,
  rows: Array<{ queue: SafeCopyQueueItem; job: SafeCopyVerificationJob; items: SafeCopyVerificationItem[] }>
) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let pageNumber = 1;
  let y = await preparePage(doc, pageNumber, "Verification Queue Report", options.appVersion, options.projectName, options.onWarning);

  for (const row of rows) {
    const label = row.queue.label || `Check ${String(row.queue.idx).padStart(2, "0")}`;
    const estimatedHeight = 76;
    if (y + estimatedHeight > PAGE_BOTTOM) {
      finalizePage(doc, pageNumber);
      pageNumber += 1;
      y = await preparePage(doc, pageNumber, "Verification Queue Report", options.appVersion, options.projectName, options.onWarning);
    }
    y = writeJobSummaryBlock(doc, y, row.job, label);
    y += 6;
  }

  finalizePage(doc, pageNumber);
  await invoke("save_image_data_url", { path: options.filePath, dataUrl: doc.output("datauristring") });
}
