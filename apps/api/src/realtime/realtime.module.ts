import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/**
 * Small realtime notification infrastructure — see
 * docs/desktop-lan-architecture.md "Realtime architecture". Deliberately
 * minimal: one gateway (connection/auth/company-room lifecycle) and one
 * publisher (the only thing domain services talk to). Not a generic
 * enterprise event bus — no Redis adapter, no durable outbox, single API
 * process only (see the doc's "Explicitly not part of this phase").
 */
@Module({
  imports: [AuthModule, CompanyContextModule],
  providers: [RealtimeGateway, RealtimePublisher],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
