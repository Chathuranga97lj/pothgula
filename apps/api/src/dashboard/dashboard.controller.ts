import { Controller, Get, Query, Res } from '@nestjs/common';
import type { DueLists, MemberDashboard, StaffDashboard } from '@pothgula/shared';
import type { Response } from 'express';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { PdfService } from '../pdf/pdf.service';
import { DashboardService, optionalBranchId } from './dashboard.service';
import { callSheetContent, dailySheetContent } from './sheets';

/** FR-NOT-03, FR-NOT-09, FR-NOT-12: today's work at the branch. */
@Controller()
@Roles('admin', 'super_admin')
export class StaffDashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly pdf: PdfService,
  ) {}

  @Get('dashboard')
  staff(@Auth() ctx: AuthContext): Promise<StaffDashboard> {
    return this.dashboard.staff(ctx);
  }

  /** The overdue list, the five-day list and today's late returns. */
  @Get('due')
  due(@Auth() ctx: AuthContext, @Query('branchId') branchId?: string): Promise<DueLists> {
    return this.dashboard.due(ctx, optionalBranchId(branchId));
  }

  /** FR-RPT-16: the daily loans sheet, printed at opening. */
  @Get('sheets/daily-loans')
  async dailyLoans(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('branchId') branchId?: string,
  ): Promise<void> {
    const sheet = await this.dashboard.dailySheet(ctx, optionalBranchId(branchId));
    const body = await this.pdf.render({
      branding: await this.pdf.branding(sheet.branch.branchId),
      title: `Books out — ${sheet.branch.branchCode} — ${sheet.today}`,
      producedBy: ctx.user.fullName,
      producedAt: sheet.today,
      content: dailySheetContent(sheet.today, sheet.loans),
    });
    send(res, body, `loans-${sheet.branch.branchCode}-${sheet.today}.pdf`);
  }

  /** FR-NOT-04: the call list, printed. */
  @Get('sheets/call-list')
  async calls(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('branchId') branchId?: string,
  ): Promise<void> {
    const sheet = await this.dashboard.callSheet(ctx, optionalBranchId(branchId));
    const body = await this.pdf.render({
      branding: await this.pdf.branding(sheet.branch.branchId),
      title: `Call list — ${sheet.branch.branchCode} — ${sheet.today}`,
      producedBy: ctx.user.fullName,
      producedAt: sheet.today,
      content: callSheetContent(sheet.today, sheet.entries),
    });
    send(res, body, `calls-${sheet.branch.branchCode}-${sheet.today}.pdf`);
  }
}

/** FR-NOT-01, FR-NOT-02, FR-NOT-08: the member's own panel. */
@Controller('me')
export class MemberDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  @Roles('member')
  member(@Auth() ctx: AuthContext): Promise<MemberDashboard> {
    return this.dashboard.member(ctx);
  }
}

function send(res: Response, body: Buffer, filename: string): void {
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(body);
}
