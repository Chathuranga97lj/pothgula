import { Module } from '@nestjs/common';
import { CatalogueController, CopiesController, TitlesController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

@Module({
  controllers: [CatalogueController, TitlesController, CopiesController],
  providers: [CatalogueService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
