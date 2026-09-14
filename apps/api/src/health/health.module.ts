import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [AccountsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
