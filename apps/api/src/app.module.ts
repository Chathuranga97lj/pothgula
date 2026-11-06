import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, AuditModule],
  controllers: [HealthController],
})
export class AppModule {}
