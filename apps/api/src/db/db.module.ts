import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { databaseUrl } from '../config';
import { createDb, type DbHandle } from './client';

export const DB_HANDLE = Symbol('DB_HANDLE');
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    { provide: DB_HANDLE, useFactory: (): DbHandle => createDb(databaseUrl()) },
    { provide: DB, useFactory: (handle: DbHandle) => handle.db, inject: [DB_HANDLE] },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
