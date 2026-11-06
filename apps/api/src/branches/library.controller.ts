import { Body, Controller, Get, HttpCode, Inject, Patch, Post, UploadedFile } from '@nestjs/common';
import { type LibraryInfo, renameLibraryRequestSchema } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '../audit/unit-of-work';
import { Auth, type AuthContext, Public, Roles } from '../auth/auth-context';
import { parseBody } from '../common/validate';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { library } from '../db/schema';
import { processImage, storeImage } from '../images/images';
import { ImageUpload } from '../images/upload';

/** The library-wide name and logo (FR-BRN-03, FR-BRN-04). */
@Controller('library')
export class LibraryController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  /** Public: the sign-in page shows the library's name and logo. */
  @Get()
  @Public()
  async get(): Promise<LibraryInfo> {
    const [row] = await this.db.select().from(library).where(eq(library.id, 1));
    return { name: row?.name ?? 'Pothgula', logoImageId: row?.logoImageId ?? null };
  }

  @Patch()
  @Roles('super_admin')
  async rename(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<LibraryInfo> {
    const { name } = parseBody(renameLibraryRequestSchema, body);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [before] = await tx.select().from(library).where(eq(library.id, 1));
      const [after] = await tx.update(library).set({ name }).where(eq(library.id, 1)).returning();
      await log({
        action: 'library.rename',
        entity: 'library',
        entityId: 1,
        branchId: null,
        before: { name: before?.name },
        after: { name },
      });
      return { name: after!.name, logoImageId: after!.logoImageId };
    });
  }

  @Post('logo')
  @HttpCode(200)
  @Roles('super_admin')
  @ImageUpload()
  async uploadLogo(
    @Auth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<LibraryInfo> {
    const processed = await processImage(file?.buffer ?? Buffer.alloc(0), 'logo');
    return this.uow.run(ctx.actor, async (tx, log) => {
      const imageId = await storeImage(tx, log, processed, ctx.user.id, null);
      const [before] = await tx.select().from(library).where(eq(library.id, 1));
      const [after] = await tx
        .update(library)
        .set({ logoImageId: imageId })
        .where(eq(library.id, 1))
        .returning();
      await log({
        action: 'library.logo',
        entity: 'library',
        entityId: 1,
        branchId: null,
        before: { logoImageId: before?.logoImageId ?? null },
        after: { logoImageId: imageId },
      });
      return { name: after!.name, logoImageId: imageId };
    });
  }
}
