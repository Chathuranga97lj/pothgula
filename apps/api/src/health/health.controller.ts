import { Controller, Get } from '@nestjs/common';
import { todayColombo, type HealthResponse } from '@pothgula/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    const now = new Date();
    return {
      status: 'ok',
      version: process.env.APP_VERSION ?? '0.0.0-dev',
      time: now.toISOString(),
      libraryDate: todayColombo(now),
    };
  }
}
