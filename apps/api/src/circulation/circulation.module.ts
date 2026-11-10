import { Module } from '@nestjs/common';
import { CirculationService } from './circulation.service';
import { OwnExtensionsController, StaffExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';
import { LoansController, MemberLoansController, OwnLoansController } from './loans.controller';

@Module({
  controllers: [
    LoansController,
    MemberLoansController,
    OwnLoansController,
    StaffExtensionsController,
    OwnExtensionsController,
  ],
  providers: [CirculationService, ExtensionsService],
})
export class CirculationModule {}
