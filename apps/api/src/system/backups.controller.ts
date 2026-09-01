import { Controller, Get } from '@nestjs/common';
import type { BackupStatusResponse } from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { BackupsService } from './backups.service';

/**
 * Server backup status. Read-only by design — see BackupsService and
 * docs/backups.md for why taking or restoring a backup is not an API
 * operation.
 */
@Controller('system/backups')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @RequirePermissions('system.backups.read')
  @Get('status')
  getStatus(): Promise<BackupStatusResponse> {
    return this.backupsService.getStatus();
  }
}
