import { toJpeg, toPng } from 'html-to-image';
import { invoke } from "@tauri-apps/api/core";
import { save } from '@tauri-apps/plugin-dialog';

/**
 * Captures an element and saves it as an image via Tauri's save dialog.
 */
export async function exportElementAsImage(
    element: HTMLElement,
    filename: string,
    format: 'jpeg' | 'png' = 'jpeg'
) {
    try {
        const images = Array.from(element.querySelectorAll("img"));
        await Promise.all(
            images.map((img) => {
                if (img.complete) return Promise.resolve();
                return new Promise<void>((resolve) => {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                });
            })
        );

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
            await invoke("save_image_data_url", {
                path: filePath,
                dataUrl
            });
            return true;
        }
    } catch (error) {
        console.error('Failed to export image:', error);
        throw error;
    }
    return false;
}
