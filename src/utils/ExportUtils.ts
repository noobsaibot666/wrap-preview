import { toJpeg, toPng } from 'html-to-image';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/**
 * Captures an element and saves it as an image via Tauri's save dialog.
 */
export async function exportElementAsImage(
    element: HTMLElement,
    filename: string,
    format: 'jpeg' | 'png' = 'jpeg'
) {
    try {
        const dataUrl = format === 'jpeg'
            ? await toJpeg(element, { quality: 0.95, backgroundColor: '#ffffff' })
            : await toPng(element);

        // Prompt user for save location
        const filePath = await save({
            filters: [{
                name: 'Image',
                extensions: [format]
            }],
            defaultPath: `${filename}.${format}`
        });

        if (filePath) {
            // Convert dataUrl to bytes
            const base64Data = dataUrl.split(',')[1];
            const binaryData = atob(base64Data);
            const bytes = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                bytes[i] = binaryData.charCodeAt(i);
            }

            await writeFile(filePath, bytes);
            return true;
        }
    } catch (error) {
        console.error('Failed to export image:', error);
        throw error;
    }
    return false;
}
