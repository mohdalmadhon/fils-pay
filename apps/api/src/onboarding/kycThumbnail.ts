import sharp from "sharp";
import { UnprocessableEntityError } from "../lib/errors.js";
import type { DetectedFileType } from "./fileSignature.js";

/**
 * Longest side, in pixels.
 */
const THUMBNAIL_MAX_DIMENSION_PX = 320;

/**
 * Largest image (width x height) we will decode. The 8 MiB upload cap limits
 * bytes on the wire, not pixels: a PNG of a few KB can declare a canvas that
 * takes gigabytes to decode, and sharp's own default limit is ~268 MP. 25 MP
 * is well above any phone photo or scan of an ID.
 */
export const KYC_MAX_IMAGE_PIXELS = 25_000_000;

export interface GeneratedThumbnail {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Generates a review-UI-sized thumbnail from an already-validated upload
 * buffer. Only `jpeg`/`png` documents get one — a `pdf` (commercial
 * registration, bank letter) has no image to thumbnail, and this returns
 * `null` rather than attempting a PDF-to-image conversion. Always
 * re-encodes to JPEG regardless of the source format, so the admin
 * console's `<img>` tag never needs to branch on thumbnail mime type the
 * way the original-file endpoint does.
 */
export async function generateKycThumbnail(
  buffer: Buffer,
  detectedType: DetectedFileType,
): Promise<GeneratedThumbnail | null> {
  if (detectedType !== "jpeg" && detectedType !== "png") {
    return null;
  }
  // Read the header first (cheap) and refuse oversized canvases before any
  // decoding; limitInputPixels is the backstop for the decode itself.
  let width: number | undefined;
  let height: number | undefined;
  try {
    // metadata() reads only the header; no pixels are decoded here.
    ({ width, height } = await sharp(buffer, { limitInputPixels: false }).metadata());
  } catch {
    throw new UnprocessableEntityError("invalid_image", "the image could not be read");
  }
  if (!width || !height || width * height > KYC_MAX_IMAGE_PIXELS) {
    throw new UnprocessableEntityError("image_too_large", `images may be at most ${KYC_MAX_IMAGE_PIXELS} pixels`);
  }
  try {
    const resized = await sharp(buffer, { limitInputPixels: KYC_MAX_IMAGE_PIXELS, failOn: "error" })
      .resize(THUMBNAIL_MAX_DIMENSION_PX, THUMBNAIL_MAX_DIMENSION_PX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return { buffer: resized, mimeType: "image/jpeg" };
  } catch {
    throw new UnprocessableEntityError("invalid_image", "the image could not be read");
  }
}
