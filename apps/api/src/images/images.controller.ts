import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { Public } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseId } from '../common/validate';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { image } from '../db/schema';

/**
 * Logos (and later notice pictures) are public: they appear on the sign-in page
 * and carry no personal data. An image never changes once stored — a new
 * upload is a new id — so browsers may cache it for good.
 */
@Controller('images')
export class ImagesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':id')
  @Public()
  async get(
    @Param('id') id: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const thumb = size === 'thumb';
    const [row] = await this.db
      .select({
        body: thumb ? image.thumbnail : image.data,
        mimeType: image.mimeType,
      })
      .from(image)
      .where(eq(image.id, parseId(id)));
    if (!row) throw AppError.notFound('image_not_found', 'No such image.');

    res
      .status(200)
      .set({
        'Content-Type': row.mimeType,
        'Content-Length': String(row.body.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Content-Disposition': 'inline',
      })
      .end(row.body);
  }
}
