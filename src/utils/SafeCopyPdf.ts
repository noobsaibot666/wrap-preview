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

function writeJobSummary(doc: jsPDF, y: number, job: SafeCopyVerificationJob, label?: string | null) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text(label || `${job.source_label} → ${job.dest_label}`, MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const lines = [
    `Status: ${job.status}   Mode: ${job.mode}   Duration: ${job.duration_ms ?? 0} ms`,
    `Source: ${job.source_root}`,
    `Destination: ${job.dest_root}`,
    `Verified ${job.verified_ok_count}   Missing ${job.missing_count}   Size ${job.size_mismatch_count}   Hash ${job.hash_mismatch_count}   Unreadable ${job.unreadable_count}   Extra ${job.extra_in_dest_count}`,
  ];
  for (const line of lines) {
    doc.text(line, MARGIN, y);
    y += 5;
  }
  return y + 2;
}

function writeIssueTable(doc: jsPDF, y: number, items: SafeCopyVerificationItem[]) {
  const issues = items.filter((item) => item.status !== "OK");
  doc.setFont("helvetica", "bold");
  doc.text("Problems", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");

  if (issues.length === 0) {
    doc.text("No problems detected.", MARGIN, y);
    return y + 6;
  }

  for (const item of issues.slice(0, 40)) {
    doc.text(`[${item.status}] ${item.rel_path}`, MARGIN, y);
    y += 4.5;
    if (item.error_message) {
      doc.setTextColor(110);
      doc.text(item.error_message.slice(0, 130), MARGIN + 4, y);
      doc.setTextColor(30);
      y += 4.5;
    }
  }
  return y + 2;
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
      appName: "Wrap Preview",
      appVersion,
      exportedAt: new Date(),
      projectName,
      title,
    },
    onWarning
  );
  return 42;
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
    "Wrap Preview"
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
  y = writeJobSummary(doc, y, job);
  if (y > 150) {
    finalizePage(doc, pageNumber);
    pageNumber += 1;
    y = await preparePage(doc, pageNumber, "Verification Report", options.appVersion, options.projectName, options.onWarning);
  }
  writeIssueTable(doc, y, items);
  finalizePage(doc, pageNumber);
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
    if (y > 230) {
      finalizePage(doc, pageNumber);
      pageNumber += 1;
      y = await preparePage(doc, pageNumber, "Verification Queue Report", options.appVersion, options.projectName, options.onWarning);
    }
    y = writeJobSummary(doc, y, row.job, row.queue.label || `Check ${String(row.queue.idx).padStart(2, "0")}`);
  }

  finalizePage(doc, pageNumber);
  await invoke("save_image_data_url", { path: options.filePath, dataUrl: doc.output("datauristring") });
}
