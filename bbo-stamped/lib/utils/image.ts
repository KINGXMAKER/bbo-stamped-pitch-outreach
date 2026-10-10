/**
 * 1568px is Anthropic's native maximum image edge, so anything larger is
 * re-scaled by the provider anyway — this is the most detail that survives the
 * trip. Measured on a 4032x3024 phone photo: 452 KB source becomes ~70 KB
 * (~94 KB as base64), so a full 20-photo set is ~1.8 MB on the wire, sent once.
 * Quality 0.82 keeps signage, menu text and food texture legible; lower values
 * start smearing small lettering, which is exactly what the scout reads.
 */
const MAX_EDGE = 1568;
const QUALITY = 0.82;

export const MAX_PHOTOS = 20;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type PreparedImage = { base64: string; mediaType: string; previewUrl: string };

/**
 * Downscales and re-encodes before anything leaves the browser. Full-resolution
 * camera files are the single biggest lever on vision latency and payload size,
 * so they never reach React state or the network untouched.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process this image in the browser.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { base64, mediaType: 'image/jpeg', previewUrl: dataUrl };
}

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type) && file.size <= MAX_SOURCE_BYTES;
}
