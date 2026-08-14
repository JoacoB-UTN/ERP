import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.check();
    // 200 for ok/degraded (API is usable), 503 only when a hard
    // dependency (Postgres) is down.
    res.status(result.status === 'error' ? 503 : 200);
    return result;
  }
}
