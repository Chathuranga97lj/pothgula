import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { OwnSettlementsController, SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';
import { TariffsService } from './tariffs.service';

@Module({
  imports: [PdfModule],
  controllers: [SettlementsController, OwnSettlementsController],
  providers: [SettlementsService, TariffsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
