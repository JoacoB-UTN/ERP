import { Controller, Get } from '@nestjs/common';
import type { SystemDiagnosticsResponse } from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { DiagnosticsService } from './diagnostics.service';

/**
 * Deep diagnostics for the machine this ERP Server runs on.
 *
 * Behind `system.backups.read` rather than a new permission code, and behind
 * one at all rather than riding on `GET /health`:
 *
 * - `GET /health` is **unauthenticated** — the desktop client polls it before
 *   anyone logs in — so a version, an uptime or a disk size there would be
 *   readable by anyone who can reach the port. Liveness is public; the shape
 *   of the installation is not.
 * - Reusing `system.backups.read` keeps this on the one screen that already
 *   exists for it (Servidor y backups) without touching the permission
 *   catalog, the system roles and the provisioning upgrade path for a
 *   read-only panel. Both answer the same operator question — "is this
 *   machine healthy?" — so the grant that shows one has no reason to withhold
 *   the other.
 */
@Controller('system/diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @RequirePermissions('system.backups.read')
  @Get()
  get(): Promise<SystemDiagnosticsResponse> {
    return this.diagnosticsService.get();
  }
}
