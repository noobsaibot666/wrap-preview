import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { jsPDF } from 'jspdf';

export interface ExportClip {
    id: string;
    filename: string;
    duration_ms: number;
    fps: number;
    width: number;
    height: number;
    video_codec: string;
    audio_codec: string;
    rating: number;
    flag: string;
    shot_size?: string | null;
    movement?: string | null;
    lut_enabled: number;
}

interface ExportOptions {
    projectName: string;
    clips: ExportClip[];
    thumbnailCache: Record<string, string>;
    thumbCount: number;
    projectLutHash?: string | null;
    brandName?: string;
}

/**
 * Convert a convertFileSrc URL (asset://localhost/path or https://asset.localhost/path)
 * back to a filesystem path.
 */
function assetUrlToPath(url: string): string {
    if (url.startsWith('data:')) return url;
    // https://asset.localhost/Users/foo/bar.jpg
    if (url.includes('asset.localhost/')) {
        const path = decodeURIComponent(url.split('asset.localhost/')[1] || '');
        return path.startsWith('/') ? path : '/' + path;
    }
    // asset://localhost/Users/foo/bar.jpg
    if (url.includes('asset://localhost/')) {
        const path = decodeURIComponent(url.split('asset://localhost/')[1] || '');
        return path.startsWith('/') ? path : '/' + path;
    }
    // Already a filesystem path
    return url;
}

/**
 * Read a thumbnail file from disk and return a data URL.
 * Handles both raw filesystem paths and convertFileSrc asset URLs.
 */
async function readThumbAsDataUrl(urlOrPath: string): Promise<string | null> {
    try {
        if (urlOrPath.startsWith('data:')) return urlOrPath;
        const fsPath = assetUrlToPath(urlOrPath);
        return await invoke<string>("read_thumbnail", { path: fsPath });
    } catch (e) {
        console.warn("readThumbAsDataUrl failed:", urlOrPath, e);
        return null;
    }
}

function formatDuration(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── PDF Export ───

export async function exportPdf(options: ExportOptions): Promise<boolean> {
    const { projectName, clips, thumbnailCache, thumbCount, projectLutHash, brandName } = options;

    const filePath = await save({
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
        defaultPath: `${projectName}_ContactSheet.pdf`,
    });
    if (!filePath) return false;

    // A4 Landscape: 297 x 210 mm
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297;
    const pageH = 210;
    const margin = 10;
    const usableW = pageW - margin * 2;

    const clipsPerPage = 3;
    const pages = chunkArray(clips, clipsPerPage);
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    for (let pi = 0; pi < pages.length; pi++) {
        if (pi > 0) pdf.addPage();
        const pageClips = pages[pi];

        // ── Header ──
        pdf.setFontSize(7);
        pdf.setTextColor(120);
        pdf.text(brandName || 'Wrap Preview', margin, margin + 3);
        pdf.setFontSize(11);
        pdf.setTextColor(30);
        pdf.setFont('helvetica', 'bold');
        pdf.text(projectName, pageW / 2, margin + 3, { align: 'center' });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(120);
        pdf.text(dateStr, pageW - margin, margin + 3, { align: 'right' });

        // Stats line below project name
        const totalDur = clips.reduce((a, c) => a + c.duration_ms, 0);
        const resolutions = [...new Set(clips.map(c => `${c.width}×${c.height}`))];
        const fpsValues = [...new Set(clips.map(c => c.fps))];
        const statsLine = [
            `${clips.length} clips`,
            formatDuration(totalDur) + ' total',
            resolutions.length === 1 ? resolutions[0] : `${resolutions.length} resolutions`,
            fpsValues.length === 1 ? `${fpsValues[0]}fps` : `${fpsValues.join('/')}fps`,
        ].join('  •  ');

        pdf.setFontSize(6.5);
        pdf.setTextColor(140);
        pdf.text(statsLine, pageW / 2, margin + 7, { align: 'center' });

        // Header line
        pdf.setDrawColor(0, 209, 255);
        pdf.setLineWidth(0.5);
        pdf.line(margin, margin + 9, pageW - margin, margin + 9);

        // ── Clips ──
        const clipAreaTop = margin + 13;
        const clipAreaH = pageH - clipAreaTop - 12; // leave room for footer
        const clipRowH = clipAreaH / clipsPerPage;

        for (let ci = 0; ci < pageClips.length; ci++) {
            const clip = pageClips[ci];
            const rowY = clipAreaTop + ci * clipRowH;
            const thumbStripH = clipRowH * 0.65;
            const thumbW = usableW / thumbCount;
            const thumbH = thumbStripH;

            // Draw thumbnail strip background
            pdf.setFillColor(20, 20, 20);
            pdf.rect(margin, rowY, usableW, thumbStripH, 'F');

            // Draw each thumbnail
            for (let ti = 0; ti < thumbCount; ti++) {
                const cacheKey = `${clip.id}_${ti}`;
                let thumbPath = thumbnailCache[cacheKey];
                if (!thumbPath) continue;

                // Apply LUT path if enabled
                if (projectLutHash && clip.lut_enabled === 1) {
                    const parts = thumbPath.split('/');
                    const filename = parts.pop();
                    const newFilename = `lut_${projectLutHash}_${filename}`;
                    thumbPath = [...parts, newFilename].join('/');
                }

                const dataUrl = await readThumbAsDataUrl(thumbPath);
                if (dataUrl) {
                    try {
                        const x = margin + ti * thumbW;
                        // Add image with contain-like sizing inside the cell
                        pdf.addImage(dataUrl, 'JPEG', x + 0.3, rowY + 0.3, thumbW - 0.6, thumbH - 0.6);
                    } catch (e) {
                        console.warn('Failed to add thumbnail to PDF:', e);
                    }
                }
            }

            // Draw border around the thumbnail strip
            pdf.setDrawColor(0);
            pdf.setLineWidth(0.3);
            pdf.rect(margin, rowY, usableW, thumbStripH);

            // ── Metadata row ──
            const metaY = rowY + thumbStripH + 3.5;
            pdf.setFontSize(8);
            pdf.setTextColor(30);
            pdf.setFont('helvetica', 'bold');
            pdf.text(clip.filename, margin, metaY);

            // Technical metadata
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(6.5);
            pdf.setTextColor(100);

            const metaParts: string[] = [
                formatDuration(clip.duration_ms),
                `${clip.width}×${clip.height}`,
                `${clip.fps}fps`,
                clip.video_codec,
            ];
            if (clip.audio_codec && clip.audio_codec !== 'none') metaParts.push(clip.audio_codec);
            if (clip.shot_size) metaParts.push(clip.shot_size);
            if (clip.movement) metaParts.push(clip.movement);

            const metaStr = metaParts.join('  •  ');
            const filenameW = pdf.getTextWidth(clip.filename);
            pdf.text(metaStr, margin + filenameW + 4, metaY);

            // Rating and flag on right side
            let rightX = margin + usableW;
            if (clip.flag !== 'none') {
                const flagText = clip.flag.toUpperCase();
                const flagW = pdf.getTextWidth(flagText) + 4;
                if (clip.flag === 'pick') {
                    pdf.setTextColor(0, 180, 100);
                } else {
                    pdf.setTextColor(200, 60, 60);
                }
                pdf.setFont('helvetica', 'bold');
                pdf.text(flagText, rightX, metaY, { align: 'right' });
                pdf.setFont('helvetica', 'normal');
                rightX -= flagW + 2;
            }
            if (clip.rating > 0) {
                pdf.setTextColor(0, 209, 255);
                pdf.setFont('helvetica', 'bold');
                const ratingStr = '★'.repeat(clip.rating);
                pdf.text(ratingStr, rightX, metaY, { align: 'right' });
                pdf.setFont('helvetica', 'normal');
            }
        }

        // ── Footer ──
        pdf.setFontSize(6.5);
        pdf.setTextColor(100);
        pdf.text(`Page ${pi + 1} of ${pages.length}`, pageW / 2, pageH - 6, { align: 'center' });
        pdf.text(brandName || 'Wrap Preview', margin, pageH - 6);
        pdf.text(`${clips.length} clips`, pageW - margin, pageH - 6, { align: 'right' });
    }

    const pdfDataUri = pdf.output('datauristring');
    await invoke("save_image_data_url", { path: filePath, dataUrl: pdfDataUri });
    return true;
}

// ─── Image Export (single-page JPEG) ───

export async function exportImage(options: ExportOptions): Promise<boolean> {
    const { projectName, clips, thumbnailCache, thumbCount, projectLutHash, brandName } = options;

    const filePath = await save({
        filters: [{ name: 'Image', extensions: ['jpeg'] }],
        defaultPath: `${projectName}_ContactSheet.jpeg`,
    });
    if (!filePath) return false;

    // Build a canvas-based image — render at final pixel resolution (no scaling)
    const thumbW = 240;
    const thumbH = 135; // 16:9
    const metaAreaH = 60; // two lines of text below filmstrip
    const rowH = thumbH + metaAreaH;
    const stripW = thumbW * thumbCount;
    const marginX = 40;
    const canvasW = stripW + marginX * 2;
    const headerH = 100;
    const footerH = 40;
    const canvasH = headerH + clips.length * rowH + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // ── Header ──
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(projectName, canvasW / 2, 32);

    // Brand + date
    ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#555';
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    ctx.fillText(`${brandName || 'Wrap Preview'}  •  ${dateStr}`, canvasW / 2, 52);

    // Stats line
    const totalDur = clips.reduce((a, c) => a + c.duration_ms, 0);
    const resolutions = [...new Set(clips.map(c => `${c.width}×${c.height}`))];
    const fpsValues = [...new Set(clips.map(c => c.fps))];
    const statsLine = [
        `${clips.length} clips`,
        formatDuration(totalDur) + ' total',
        resolutions.length === 1 ? resolutions[0] : `${resolutions.length} resolutions`,
        fpsValues.length === 1 ? `${fpsValues[0]}fps` : `${fpsValues.join('/')}fps`,
    ].join('   •   ');
    ctx.fillStyle = '#777';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(statsLine, canvasW / 2, 70);

    // Accent divider
    ctx.strokeStyle = '#00d1ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, headerH - 6);
    ctx.lineTo(canvasW - marginX, headerH - 6);
    ctx.stroke();

    // ── Clip rows ──
    for (let ci = 0; ci < clips.length; ci++) {
        const clip = clips[ci];
        const rowY = headerH + ci * rowH;

        // Draw thumbnails
        for (let ti = 0; ti < thumbCount; ti++) {
            const cacheKey = `${clip.id}_${ti}`;
            let thumbPath = thumbnailCache[cacheKey];
            if (!thumbPath) continue;

            if (projectLutHash && clip.lut_enabled === 1) {
                const parts = thumbPath.split('/');
                const filename = parts.pop();
                thumbPath = [...parts, `lut_${projectLutHash}_${filename}`].join('/');
            }

            const dataUrl = await readThumbAsDataUrl(thumbPath);
            if (dataUrl) {
                try {
                    const img = new Image();
                    await new Promise<void>((resolve, reject) => {
                        img.onload = () => resolve();
                        img.onerror = () => reject();
                        img.src = dataUrl;
                    });
                    const x = marginX + ti * thumbW;
                    ctx.drawImage(img, x, rowY, thumbW - 2, thumbH);
                } catch {
                    ctx.fillStyle = '#222';
                    ctx.fillRect(marginX + ti * thumbW, rowY, thumbW - 2, thumbH);
                }
            }
        }

        // Border around filmstrip
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(marginX, rowY, stripW, thumbH);

        // ── Line 1: Filename (bold black) + duration ──
        const line1Y = rowY + thumbH + 18;
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 16px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(clip.filename, marginX, line1Y);

        // Duration after filename
        ctx.font = '14px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#444';
        const fnW = ctx.measureText(clip.filename).width;
        ctx.fillText(`   ${formatDuration(clip.duration_ms)}`, marginX + fnW, line1Y);

        // ── Line 2: Technical specs ──
        const line2Y = line1Y + 18;
        ctx.font = '13px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#555';
        const metaParts: string[] = [
            `${clip.width}×${clip.height}`,
            `${clip.fps}fps`,
            clip.video_codec,
        ];
        if (clip.audio_codec && clip.audio_codec !== 'none') metaParts.push(clip.audio_codec);
        if (clip.shot_size) metaParts.push(clip.shot_size);
        if (clip.movement) metaParts.push(clip.movement);
        ctx.fillText(metaParts.join('   •   '), marginX, line2Y);

        // ── Rating + Flag (right-aligned on line 1) ──
        ctx.textAlign = 'right';
        const rightEdge = marginX + stripW;
        let rx = rightEdge;
        if (clip.flag !== 'none') {
            ctx.font = 'bold 15px Inter, system-ui, sans-serif';
            ctx.fillStyle = clip.flag === 'pick' ? '#00b464' : '#e04040';
            const flagText = clip.flag.toUpperCase();
            ctx.fillText(flagText, rx, line1Y);
            rx -= ctx.measureText(flagText).width + 10;
        }
        if (clip.rating > 0) {
            ctx.font = 'bold 16px Inter, system-ui, sans-serif';
            ctx.fillStyle = '#00a0cc';
            ctx.fillText('★'.repeat(clip.rating), rx, line1Y);
        }
        ctx.textAlign = 'left';
    }

    // ── Footer ──
    ctx.textAlign = 'center';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#999';
    ctx.fillText(`${brandName || 'Wrap Preview'}  •  ${clips.length} clips  •  Generated ${dateStr}`, canvasW / 2, canvasH - 12);

    // Save
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    await invoke("save_image_data_url", { path: filePath, dataUrl });
    return true;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
