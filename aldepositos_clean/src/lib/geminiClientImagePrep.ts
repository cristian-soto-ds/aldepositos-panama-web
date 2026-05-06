/**
 * Reduce payload hacia Gemini (latencia): imágenes muy grandes pasan por canvas.
 * Los PDF van tal cual — el tamaño suele estar ya acotado en el servidor.
 */

/** Más agresivo = menos bytes hacia la API y respuesta más rápida (sigue legible en packing lists). */
const MAX_SIDE_PX = 1650;
const PASS_THROUGH_MAX_BYTES = 1.25 * 1024 * 1024;

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/**
 * Devuelve base64 sin prefijo data: y el mime efectivo tras posible transcodificación.
 */
export async function prepareFilePayloadForGemini(
  file: File,
  mimeType: string,
): Promise<{ base64: string; mimeType: string }> {
  const mime = (mimeType || file.type || "application/octet-stream").toLowerCase();
  if (mime === "application/pdf") {
    const dataUrl = await readFileAsDataUrl(file);
    return { base64: dataUrlToBase64(dataUrl), mimeType: "application/pdf" };
  }

  if (!/^image\/(png|jpeg|webp)$/i.test(mime)) {
    const dataUrl = await readFileAsDataUrl(file);
    return { base64: dataUrlToBase64(dataUrl), mimeType: mime };
  }

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    const dataUrl = await readFileAsDataUrl(file);
    return { base64: dataUrlToBase64(dataUrl), mimeType: mime };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    const longest = Math.max(w, h);
    const tinyEnough = longest <= MAX_SIDE_PX && file.size <= PASS_THROUGH_MAX_BYTES;
    if (tinyEnough) {
      bitmap.close();
      const dataUrl = await readFileAsDataUrl(file);
      return { base64: dataUrlToBase64(dataUrl), mimeType: mime };
    }

    const scale = longest > MAX_SIDE_PX ? MAX_SIDE_PX / longest : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      const dataUrl = await readFileAsDataUrl(file);
      return { base64: dataUrlToBase64(dataUrl), mimeType: mime };
    }
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();
    bitmap = null;

    const outMime =
      mime === "image/png" ? "image/png" : mime === "image/webp" ? "image/webp" : "image/jpeg";
    let dataUrl: string;
    if (outMime === "image/png") dataUrl = canvas.toDataURL("image/png");
    else if (outMime === "image/webp") dataUrl = canvas.toDataURL("image/webp", 0.82);
    else dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return { base64: dataUrlToBase64(dataUrl), mimeType: outMime };
  } catch {
    if (bitmap) bitmap.close();
    const dataUrl = await readFileAsDataUrl(file);
    return { base64: dataUrlToBase64(dataUrl), mimeType: mime };
  }
}
