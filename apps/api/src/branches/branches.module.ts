import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { CategoriesController } from './categories.controller';
import { LibraryController } from './library.controller';

@Module({
  controllers: [LibraryController, BranchesController, CategoriesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
