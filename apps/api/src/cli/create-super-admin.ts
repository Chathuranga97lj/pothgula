/**
 * Creates the first super admin at installation (FR-AUT-04). Run on the server:
 *   pnpm --filter @pothgula/api create-super-admin --name "Full Name" --phone 0771234567
 * Refuses if any super admin already exists; later ones are created in the app.
 */
import { parseArgs } from 'node:util';
import { UnitOfWork } from '../audit/unit-of-work';
import { createFirstSuperAdmin } from '../auth/bootstrap';
import { databaseUrl } from '../config';
import { createDb } from '../db/client';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { name: { type: 'string' }, phone: { type: 'string' } },
  });
  if (!values.name || !values.phone) {
    throw new Error('Usage: create-super-admin --name "Full Name" --phone 07XXXXXXXX');
  }
  const handle = createDb(databaseUrl());
  try {
    const result = await createFirstSuperAdmin(new UnitOfWork(handle.db), {
      fullName: values.name,
      whatsappPhone: values.phone,
    });
    console.log(`Super admin created (id ${result.userId}).`);
    console.log(`Temporary password: ${result.temporaryPassword}`);
    console.log('Give it to the person in private. They must change it when they first sign in,');
    console.log('and should then create a second super admin (FR-AUT-14).');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
