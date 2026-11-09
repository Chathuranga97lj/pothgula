import { UnitOfWork } from '../audit/unit-of-work';
import { databaseUrl } from '../config';
import { createDb } from '../db/client';
import { seedDemo } from '../db/seed';

async function main(): Promise<void> {
  // NFR-17: invented data never goes near the real installation. A public
  // demonstration runs the production build, so it must say so explicitly.
  if (process.env.NODE_ENV === 'production' && process.env.POTHGULA_DEMO !== 'yes') {
    throw new Error(
      'Refusing to load demonstration data into a production database (NFR-17). ' +
        'For a public demonstration with invented data only, set POTHGULA_DEMO=yes.',
    );
  }
  const handle = createDb(databaseUrl());
  try {
    const result = await seedDemo(new UnitOfWork(handle.db));
    console.log(result.skipped ? 'Database is not empty; nothing seeded.' : 'Seeded:', result);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
