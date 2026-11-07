import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  addCopiesRequestSchema,
  type CatalogueResponse,
  categoryCodeSchema,
  createTitleRequestSchema,
  mergeTitlesRequestSchema,
  moveCopyRequestSchema,
  type SimilarTitle,
  type TitleDetail,
  updateCopyRequestSchema,
  updateTitleRequestSchema,
  withdrawCopyRequestSchema,
} from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { CatalogueService } from './catalogue.service';

function optionalId(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : parseId(value);
}

/** Browsing: every signed-in person, applicants included (FR-AUT-16, FR-CAT-05 – FR-CAT-07). */
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  search(
    @Auth() ctx: AuthContext,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('category') category?: string,
    @Query('writer') writer?: string,
    @Query('available') available?: string,
    @Query('page') page?: string,
  ): Promise<CatalogueResponse> {
    if (category && !categoryCodeSchema.safeParse(category).success) {
      throw AppError.badRequest('invalid_request', 'Not a category code');
    }
    return this.catalogue.search(ctx, {
      q,
      branchId: optionalId(branchId),
      categoryCode: category || undefined,
      writer,
      available: available === 'true',
      page: page ? Math.max(0, Number.parseInt(page, 10) || 0) : 0,
    });
  }
}

@Controller('titles')
export class TitlesController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** FR-CAT-01: possible duplicates of a title about to be created. */
  @Get('similar')
  @Roles('admin', 'super_admin')
  similar(@Query('title') text?: string, @Query('isbn') isbn?: string): Promise<SimilarTitle[]> {
    return this.catalogue.similar(text ?? '', isbn);
  }

  @Get(':id')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<TitleDetail> {
    return this.catalogue.detail(ctx, parseId(id));
  }

  @Post()
  @Roles('admin', 'super_admin')
  create(@Auth() ctx: AuthContext, @Body() body: unknown) {
    const input = parseBody(createTitleRequestSchema, body);
    return this.catalogue.createTitle(ctx, {
      ...input,
      copies: input.copies ? { ...input.copies } : undefined,
    });
  }

  @Patch(':id')
  @Roles('admin', 'super_admin')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.catalogue.updateTitle(ctx, parseId(id), parseBody(updateTitleRequestSchema, body));
  }

  @Post(':id/copies')
  @Roles('admin', 'super_admin')
  addCopies(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.catalogue.addCopies(ctx, parseId(id), parseBody(addCopiesRequestSchema, body));
  }

  @Post(':id/merge')
  @HttpCode(200)
  @Roles('super_admin')
  merge(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.catalogue.merge(
      ctx,
      parseId(id),
      parseBody(mergeTitlesRequestSchema, body).intoTitleId,
    );
  }
}

@Controller('copies')
export class CopiesController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** A copy by accession number, typed with or without hyphens (the counter, M6). */
  @Get('by-accession/:no')
  @Roles('admin', 'super_admin')
  byAccession(@Auth() ctx: AuthContext, @Param('no') no: string) {
    return this.catalogue.copyByAccession(ctx, no);
  }

  @Patch(':id')
  @Roles('admin', 'super_admin')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.catalogue.updateCopy(ctx, parseId(id), parseBody(updateCopyRequestSchema, body));
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  withdraw(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.catalogue.withdraw(
      ctx,
      parseId(id),
      parseBody(withdrawCopyRequestSchema, body).reason,
    );
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @Roles('super_admin')
  reinstate(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.catalogue.reinstate(ctx, parseId(id));
  }

  @Post(':id/move')
  @HttpCode(200)
  @Roles('super_admin')
  move(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.catalogue.move(ctx, parseId(id), parseBody(moveCopyRequestSchema, body).branchId);
  }
}
