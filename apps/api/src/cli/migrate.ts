import { databaseUrl } from '../config';
import { runMigrations } from '../db/migrate';

runMigrations(databaseUrl())
  .then(() => console.log('Migrations applied.'))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
