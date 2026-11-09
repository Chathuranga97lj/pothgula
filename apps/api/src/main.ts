import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // Behind the web server (Caddy), the client's address comes in X-Forwarded-For;
  // the activity log records it (FR-LOG-02). Trust only the proxy's own network.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
