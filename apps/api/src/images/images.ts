/**
 * Every picture lives inside the system's own database, resized on upload, and
 * is served only by the API (NFR-16, FR-BRN-04, FR-PUB-05). The file's real
 * format is read from its content — the name and declared type are ignored —
 * and the stored copy is re-encoded, so nothing uploaded is ever served as-is
 * (NFR-06).
 */
import { IMAGE_MAX_BYTES } from '@pothgula/shared';
import sharp from 'sharp';
import type { Tx } from '../db/client';
import { image } from '../db/schema';
import { AppError } from '../common/app-error';
import type { Log } from '../audit/unit-of-work';

const ACCEPTED = new Set(['png', 'jpeg', 'webp']);

export type ImagePurpose = 'logo';

/** Logos: kept as PNG (transparency, and pdfmake embeds PNG and JPEG only). */
const PROFILES: Record<ImagePurpose, { max: number; thumb: number }> = {
  logo: { max: 512, thumb: 128 },
};

export interface ProcessedImage {
  data: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

export async function processImage(input: Buffer, purpose: ImagePurpose): Promise<ProcessedImage> {
  if (input.length === 0) throw AppError.badRequest('image_missing', 'Choose an image to upload.');
  if (input.length > IMAGE_MAX_BYTES) {
    throw AppError.unprocessable('image_too_large', 'The image must be 2 MB or smaller.');
  }

  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    format = undefined;
  }
  if (!format || !ACCEPTED.has(format)) {
    throw AppError.unprocessable('image_type', 'Upload a PNG, JPEG or WebP image.');
  }

  const profile = PROFILES[purpose];
  const resize = (size: number) =>
    sharp(input, { limitInputPixels: 50_000_000 })
      .rotate() // respect the camera's orientation, then drop the metadata
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });

  try {
    const [main, thumb] = await Promise.all([resize(profile.max), resize(profile.thumb)]);
    return {
      data: main.data,
      thumbnail: thumb.data,
      width: main.info.width,
      height: main.info.height,
    };
  } catch {
    throw AppError.unprocessable('image_unreadable', 'That image could not be read.');
  }
}

/** Stores a processed image inside the caller's unit of work and returns its id. */
export async function storeImage(
  tx: Tx,
  log: Log,
  processed: ProcessedImage,
  uploadedBy: number,
  branchId: number | null,
): Promise<number> {
  const [row] = await tx
    .insert(image)
    .values({
      data: processed.data,
      thumbnail: processed.thumbnail,
      mimeType: 'image/png',
      width: processed.width,
      height: processed.height,
      bytes: processed.data.length,
      uploadedBy,
    })
    .returning({ id: image.id });
  if (!row) throw new Error('image insert returned nothing');
  await log({
    action: 'image.upload',
    entity: 'image',
    entityId: row.id,
    branchId,
    after: { width: processed.width, height: processed.height, bytes: processed.data.length },
  });
  return row.id;
}
