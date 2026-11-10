import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { addClosureSchema, type BranchHours, saveWeekSchema } from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { parseBody, parseId } from '../common/validate';
import { HoursService } from './hours.service';

/** §11: any signed-in person reads any branch's hours (FR-SCH-03); staff change their own. */
@Controller()
export class HoursController {
  constructor(private readonly hours: HoursService) {}

  @Get('branches/:id/hours')
  get(@Param('id') id: string): Promise<BranchHours> {
    return this.hours.get(parseId(id));
  }

  /** FR-SCH-01: the weekly pattern, all seven days at once. */
  @Patch('branches/:id/hours')
  @Roles('admin', 'super_admin')
  saveWeek(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BranchHours> {
    return this.hours.saveWeek(ctx, parseId(id), parseBody(saveWeekSchema, body));
  }

  /** FR-SCH-02, FR-SCH-05: a date, or a run of dates, closed with a reason. */
  @Post('branches/:id/closures')
  @Roles('admin', 'super_admin')
  addClosure(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BranchHours> {
    return this.hours.addClosure(ctx, parseId(id), parseBody(addClosureSchema, body));
  }

  @Post('closures/:id/withdraw')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  withdraw(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<BranchHours> {
    return this.hours.withdrawClosure(ctx, parseId(id));
  }
}
