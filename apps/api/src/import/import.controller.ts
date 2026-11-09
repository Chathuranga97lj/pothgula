import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IMPORT_MAX_BYTES,
  importDecisionsSchema,
  type ImportPreview,
  type ImportResult,
  labelsRequestSchema,
} from '@pothgula/shared';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { ImportService } from './import.service';
import { LabelsService } from './labels.service';

/** One CSV as multipart field `file`, held in memory, at most 5 MB. */
const CsvUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
    }),
  );

interface ImportForm {
  branchId?: string;
  decisions?: string;
}

function fileOf(file: Express.Multer.File | undefined): { name: string; bytes: Uint8Array } {
  if (!file) throw AppError.badRequest('file_required', 'Choose the CSV file to import.');
  // Multer reads the name as Latin-1; browsers send UTF-8.
  return { name: Buffer.from(file.originalname, 'latin1').toString('utf8'), bytes: file.buffer };
}

/** FR-CAT-13: staff of the branch, or a super admin. */
@Controller()
@Roles('admin', 'super_admin')
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly labels: LabelsService,
  ) {}

  /** What the file would do, with its errors and probable duplicates. Writes nothing. */
  @Post('imports/preview')
  @HttpCode(200)
  @CsvUpload()
  preview(
    @Auth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() form: ImportForm,
  ): Promise<ImportPreview> {
    const f = fileOf(file);
    return this.imports.preview(ctx, parseId(form.branchId ?? ''), f.name, f.bytes);
  }

  /** The same file again with the review's decisions: numbers every copy. */
  @Post('imports')
  @CsvUpload()
  commit(
    @Auth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() form: ImportForm,
  ): Promise<ImportResult> {
    const f = fileOf(file);
    let decisions: unknown;
    try {
      decisions = JSON.parse(form.decisions ?? '[]');
    } catch {
      throw AppError.badRequest('invalid_request', 'decisions must be JSON');
    }
    return this.imports.commit(
      ctx,
      parseId(form.branchId ?? ''),
      f.name,
      f.bytes,
      parseBody(importDecisionsSchema, decisions),
    );
  }

  /** FR-CAT-10: spine labels for the given copies, as a PDF. */
  @Post('labels')
  async printLabels(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { accessionNumbers } = parseBody(labelsRequestSchema, body);
    const pdf = await this.labels.render(ctx, accessionNumbers);
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="spine-labels.pdf"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(pdf);
  }
}
