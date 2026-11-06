import { UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_MAX_BYTES } from '@pothgula/shared';
import { memoryStorage } from 'multer';

/**
 * Accepts one image as multipart field `file`, held in memory (never written to
 * disk) and capped at 2 MB plus a little for the multipart envelope; the exact
 * 2 MB limit is checked again on the bytes themselves.
 */
export const ImageUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMAGE_MAX_BYTES + 1, files: 1 },
    }),
  );
