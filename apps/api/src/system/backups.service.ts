import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BACKUP_MANIFEST_FILENAME,
  nextRunAt,
  type BackupManifest,
  type BackupRunRecord,
  type BackupStatusResponse,
} from '@erp/shared';
import type { Env } from '@erp/config';

/**
 * Read-only view of the ERP Server's backup state.
 *
 * The API deliberately does NOT take, download or restore backups — see
 * docs/backups.md. A pg_dump covers every company in the instance, so no
 * company-scoped role can be allowed to trigger or move one without breaking
 * the tenant-isolation invariant in AGENTS.md. Backups are owned by
 * `apps/server-agent`, which runs as its own service; this module only reads
 * the manifest that agent writes, so Gestión can show whether the business is
 * actually protected.
 *
 * Consequently nothing here is company-scoped: the response contains server
 * health facts (dates, sizes, success/failure), never business data.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);

  constructor(private readonly configService: ConfigService<Env, true>) {}

  private get backupDir(): string {
    return this.configService.get('ERP_BACKUP_DIR', { infer: true });
  }

  private async readManifest(): Promise<BackupManifest | null> {
    try {
      const raw = await fs.readFile(
        path.join(this.backupDir, BACKUP_MANIFEST_FILENAME),
        'utf8',
      );
      const parsed = JSON.parse(raw) as BackupManifest;
      return Array.isArray(parsed?.runs) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      // A manifest we cannot read is reported as "not configured" rather than a
      // 500: the operator's question is "am I protected?", and the honest
      // answer when the file is unreadable is "we cannot tell you that you are".
      this.logger.warn(
        `Could not read the backup manifest: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async archiveStats(): Promise<{
    count: number;
    totalSizeBytes: number;
  }> {
    try {
      const entries = await fs.readdir(this.backupDir);
      const archives = entries.filter((entry) => entry.endsWith('.dump'));
      const sizes = await Promise.all(
        archives.map(async (entry) => {
          const stat = await fs
            .stat(path.join(this.backupDir, entry))
            .catch(() => null);
          return stat?.size ?? 0;
        }),
      );
      return {
        count: archives.length,
        totalSizeBytes: sizes.reduce((total, size) => total + size, 0),
      };
    } catch {
      return { count: 0, totalSizeBytes: 0 };
    }
  }

  async getStatus(): Promise<BackupStatusResponse> {
    const manifest = await this.readManifest();

    if (!manifest) {
      // No manifest at all: the agent has never run here. This is the state a
      // fresh install is in until the ERP Server installer registers the
      // service, and it must be visible rather than look like "all fine".
      return {
        configured: false,
        lastRun: null,
        lastSuccessfulRun: null,
        schedule: [],
        retentionDays: 0,
        nextRunAt: null,
        storedBackups: 0,
        totalSizeBytes: 0,
        cloudEnabled: false,
        recentRuns: [],
      };
    }

    const { count, totalSizeBytes } = await this.archiveStats();
    const runs: BackupRunRecord[] = manifest.runs;
    const schedule = manifest.settings?.times ?? [];

    return {
      configured: true,
      lastRun: runs[0] ?? null,
      lastSuccessfulRun: runs.find((run) => run.status === 'success') ?? null,
      schedule,
      retentionDays: manifest.settings?.retentionDays ?? 0,
      nextRunAt:
        schedule.length > 0
          ? nextRunAt(schedule, new Date()).toISOString()
          : null,
      storedBackups: count,
      totalSizeBytes,
      cloudEnabled: manifest.settings?.cloudEnabled ?? false,
      recentRuns: runs.slice(0, 20),
    };
  }
}
