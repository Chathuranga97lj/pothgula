import { Module } from '@nestjs/common';
import { CirculationService } from './circulation.service';
import { LoansController, MemberLoansController, OwnLoansController } from './loans.controller';

@Module({
  controllers: [LoansController, MemberLoansController, OwnLoansController],
  providers: [CirculationService],
})
export class CirculationModule {}
