import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Renders Page 1 of a PDF ArrayBuffer onto an offscreen canvas at compact thumbnail
 * dimensions (~260x360px max) and exports a lightweight WebP (or PNG fallback) data URL.
 */
export async function renderPdfPage1Thumbnail(
  bytes: ArrayBuffer,
  maxWidth = 260,
  maxHeight = 360
): Promise<string | null> {
  const copy = bytes.slice(0);
  const loadingTask = getDocument({ data: new Uint8Array(copy) });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      maxWidth / Math.max(1, baseViewport.width),
      maxHeight / Math.max(1, baseViewport.height)
    );
    const viewport = page.getViewport({ scale: Math.max(0.15, Math.min(2.0, scale)) });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;

    ctx.fillStyle = "#faf8f4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({ canvas, viewport });
    await renderTask.promise;

    const webp = canvas.toDataURL("image/webp", 0.82);
    if (webp.startsWith("data:image/webp")) {
      return webp;
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    void loadingTask.destroy();
  }
}
