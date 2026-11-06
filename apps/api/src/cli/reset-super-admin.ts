/**
 * Last resort when no super admin can sign in (FR-AUT-14, risk D12). Run on the server:
 *   pnpm --filter @pothgula/api reset-super-admin --phone 0771234567
 * Unlocks and reactivates that super admin, ends their sessions and prints a
 * temporary password. The reset is written to the activity log.
 */
import { parseArgs } from 'node:util';
import { UnitOfWork } from '../audit/unit-of-work';
import { serverResetSuperAdmin } from '../auth/bootstrap';
import { databaseUrl } from '../config';
import { createDb } from '../db/client';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { phone: { type: 'string' } } });
  if (!values.phone) throw new Error('Usage: reset-super-admin --phone 07XXXXXXXX');
  const handle = createDb(databaseUrl());
  try {
    const result = await serverResetSuperAdmin(new UnitOfWork(handle.db), {
      whatsappPhone: values.phone,
    });
    console.log(`Super admin ${result.userId} reset.`);
    console.log(`Temporary password: ${result.temporaryPassword}`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
