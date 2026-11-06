import type { INestApplication } from '@nestjs/common';

/** Settings shared by the running server and the tests, so both see the same routes. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
