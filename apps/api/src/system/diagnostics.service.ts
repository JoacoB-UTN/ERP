import fs from 'node:fs';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DiskUsage, SystemDiagnosticsResponse } from '@erp/shared';
import type { Env } from '@erp/config';
import { PrismaService } from '../database/prisma.service';

/**
 * Version of the installed build, read once at module load.
 *
 * Read from disk rather than imported: `package.json` sits outside `rootDir`,
 * so `import ... from '../../package.json'` fails the build even with
 * `resolveJsonModule` on. The relative depth is the same compiled
 * (`dist/system/`) as it is under ts-jest (`src/system/`), so one path covers
 * both. An unreadable file yields "unknown" — a diagnostics endpoint that
 * refuses to answer because it cannot introduce itself would be absurd.
 */
const PACKAGE_VERSION = ((): string => {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', '..', 'package.json'),
      'utf8',
    );
    return String(
      (JSON.parse(raw) as { version?: string }).version ?? 'unknown',
    );
  } catch {
    return 'unknown';
  }
})();

/**
 * What an operator needs to answer "why is this machine behaving like this?"
 * without a remote session — the gap `docs/implementation-status.md` names
 * when it says the Estado del sistema panel is "not local diagnostics in any
 * complete sense".
 *
 * Every measurement here is instance-wide, read-only and free of business
 * data, for the same reason BackupsService is: a single PostgreSQL serves
 * every company, so nothing measured about the server can be company-scoped
 * without lying about what it covers.
 *
 * What it deliberately does NOT do: take any action. Restarting a service or
 * freeing disk is the installer's and the operator's job, and an API that
 * could restart PostgreSQL would be a remote-execution surface guarded by a
 * read permission.
 */
@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async get(): Promise<SystemDiagnosticsResponse> {
    // Measured in parallel: the database probe dominates, and an operator
    // looking at a sick machine should not wait for three sequential I/O
    // round-trips.
    const [database, backupsDisk] = await Promise.all([
      this.probeDatabase(),
      Promise.resolve(this.probeDisk(this.backupDir)),
    ]);

    const uptimeSeconds = Math.floor(process.uptime());

    return {
      server: {
        version: PACKAGE_VERSION,
        startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
        uptimeSeconds,
        nodeVersion: process.version,
      },
      database,
      disk: { backups: backupsDisk },
    };
  }

  private get backupDir(): string {
    return this.configService.get('ERP_BACKUP_DIR', { infer: true });
  }

  /**
   * One round-trip that asks the server about itself.
   *
   * `pg_postmaster_start_time()` is the reason this method exists. It is the
   * database's own idea of when it started, which no amount of looking at
   * Windows services can tell you — and it is what makes an orphaned
   * postmaster visible from the product.
   */
  private async probeDatabase(): Promise<
    SystemDiagnosticsResponse['database']
  > {
    const startedMeasuringAt = process.hrtime.bigint();
    try {
      const rows = await this.prisma.$queryRaw<
        { startedAt: Date; sizeBytes: bigint }[]
      >`
        SELECT pg_postmaster_start_time() AS "startedAt",
               pg_database_size(current_database()) AS "sizeBytes"
      `;
      const latencyMs =
        Number(process.hrtime.bigint() - startedMeasuringAt) / 1_000_000;
      const row = rows[0];
      if (!row) return this.unmeasurableDatabase(latencyMs);

      const startedAt = row.startedAt;
      return {
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.max(
          0,
          Math.floor((Date.now() - startedAt.getTime()) / 1000),
        ),
        latencyMs: Math.round(latencyMs * 100) / 100,
        // BIGINT crosses Prisma as a bigint; JSON cannot serialize one, and a
        // database bigger than 9 PB is not the failure mode worth guarding.
        sizeBytes: Number(row.sizeBytes),
      };
    } catch (error) {
      // A database that cannot be probed is not a 500: `GET /health` already
      // answers "is PostgreSQL up", and the operator opening this panel is
      // usually looking at a machine where something is already wrong.
      this.logger.warn(
        `Could not probe the database: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.unmeasurableDatabase(null);
    }
  }

  private unmeasurableDatabase(
    latencyMs: number | null,
  ): SystemDiagnosticsResponse['database'] {
    return {
      startedAt: null,
      uptimeSeconds: null,
      latencyMs: latencyMs === null ? null : Math.round(latencyMs * 100) / 100,
      sizeBytes: null,
    };
  }

  /**
   * Free space on the filesystem holding `dir`.
   *
   * Only the numbers are returned, never `dir` itself: this response reaches
   * a browser, and where the operator's backups live is not something the
   * product needs to publish to read a gauge.
   */
  private probeDisk(dir: string): DiskUsage | null {
    // The backup directory does not exist until the agent writes its first
    // archive, which is the normal state of a fresh install — and a fresh
    // install is exactly when an operator wants to know whether this machine
    // has room. `statfs` measures a filesystem, not a directory, so the
    // nearest existing ancestor gives the same answer.
    let target = path.resolve(dir);
    while (!fs.existsSync(target)) {
      const parent = path.dirname(target);
      if (parent === target) return null;
      target = parent;
    }

    try {
      const stats = fs.statfsSync(target);
      return {
        totalBytes: stats.blocks * stats.bsize,
        // `bavail`, not `bfree`: the blocks reserved for root are not space
        // the ERP Server can actually use.
        freeBytes: stats.bavail * stats.bsize,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read free space for the backup directory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
