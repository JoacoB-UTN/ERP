import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Creates a throwaway backup directory and publishes it as ERP_BACKUP_DIR
 * BEFORE `AppModule` is imported.
 *
 * This has to be its own module rather than a line in `beforeAll`, because
 * `@nestjs/config`'s `forRoot()` reads and validates the environment
 * synchronously while `config.module.ts` is being imported — which happens as
 * soon as a spec imports `AppModule`. Setting the variable inside a hook runs
 * after that, so the API would have already resolved the default `./backups`
 * and every assertion about manifest contents would silently read the wrong
 * directory.
 *
 * Import this module *above* the `AppModule` import; ts-jest preserves import
 * order, so this file's top-level statements run first.
 */
export const testBackupDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'erp-e2e-backups-'),
);

process.env.ERP_BACKUP_DIR = testBackupDir;
