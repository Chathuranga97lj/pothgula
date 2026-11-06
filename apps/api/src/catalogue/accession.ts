import { ACCESSION_MAX, formatAccession } from '@pothgula/shared';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { branch } from '../db/schema';

export class AccessionRangeExhaustedError extends Error {
  constructor(branchCode: string, categoryCode: string) {
    super(`No accession numbers left for ${branchCode}-${categoryCode} (limit ${ACCESSION_MAX})`);
    this.name = 'AccessionRangeExhaustedError';
  }
}

/**
 * Takes the next `count` running numbers for a branch and category and returns
 * them as printed accession numbers (FR-CAT-02). The counter row is locked by
 * the upsert until the transaction ends, so two counters allocating at once can
 * never receive the same number, and a rolled-back transaction gives its
 * numbers back.
 */
export async function allocateAccessionNumbers(
  tx: Tx,
  branchId: number,
  categoryCode: string,
  count = 1,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Invalid count: ${count}`);

  const [owner] = await tx
    .select({ code: branch.branchCode })
    .from(branch)
    .where(eq(branch.id, branchId));
  if (!owner) throw new Error(`No branch with id ${branchId}`);

  let first: number;
  try {
    const result = await tx.execute<{ first: number }>(sql`
      INSERT INTO accession_counter (branch_id, category_code, next_running)
      VALUES (${branchId}, ${categoryCode}, ${1 + count})
      ON CONFLICT (branch_id, category_code)
        DO UPDATE SET next_running = accession_counter.next_running + ${count}
      RETURNING next_running - ${count} AS first
    `);
    first = Number(result.rows[0]?.first);
  } catch (error) {
    if (isCheckViolation(error, 'accession_counter_range')) {
      throw new AccessionRangeExhaustedError(owner.code, categoryCode);
    }
    throw error;
  }

  return Array.from({ length: count }, (_, i) =>
    formatAccession(owner.code, categoryCode, first + i),
  );
}

function isCheckViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === '23514' && pg.constraint === constraint;
}
