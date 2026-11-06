import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApplicationsController, MeController, MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [AuthModule],
  controllers: [ApplicationsController, MembersController, MeController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
