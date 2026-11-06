import { Controller, Get, Inject } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { branch } from '../db/schema';

export interface BranchSummary {
  id: number;
  code: string;
  name: string;
}

/** The list of branches for pickers. Full branch management arrives in M3. */
@Controller('branches')
export class BranchesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(): Promise<BranchSummary[]> {
    return this.db
      .select({ id: branch.id, code: branch.branchCode, name: branch.branchName })
      .from(branch)
      .orderBy(asc(branch.branchName));
  }
}
