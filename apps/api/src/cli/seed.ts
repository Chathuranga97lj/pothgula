import { UnitOfWork } from '../audit/unit-of-work';
import { databaseUrl } from '../config';
import { createDb } from '../db/client';
import { seedDemo } from '../db/seed';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to load demonstration data into a production database (NFR-17)');
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
