import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { LabelsService } from './labels.service';

@Module({
  imports: [PdfModule],
  controllers: [ImportController],
  providers: [ImportService, LabelsService],
})
export class ImportModule {}
