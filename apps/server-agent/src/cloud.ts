import { createReadStream } from 'node:fs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { BackupCloudResult } from '@erp/shared';
import type { AgentEnv } from './config';
import type { Logger } from './logger';

/**
 * Optional offsite copy to any S3-compatible object store (AWS S3, Backblaze
 * B2, Cloudflare R2, MinIO). Off by default — see config.ts on why local-first
 * means the product must be fully operable with no account and no internet.
 *
 * The offsite copy is explicitly best-effort: a failed upload is recorded on
 * the run but does NOT fail the backup, because the local archive — the copy
 * that restores fastest and works during an outage — already succeeded. The
 * operator still needs to see the failure, which is why it lands in the
 * manifest rather than only in a log nobody reads.
 */

export function isCloudEnabled(env: AgentEnv): boolean {
  return env.ERP_BACKUP_CLOUD_ENABLED;
}

function buildClient(env: AgentEnv): S3Client {
  return new S3Client({
    region: env.ERP_BACKUP_CLOUD_REGION,
    // Custom endpoints need path-style addressing; virtual-host style assumes
    // an AWS-shaped DNS name that B2/MinIO do not necessarily provide.
    ...(env.ERP_BACKUP_CLOUD_ENDPOINT
      ? { endpoint: env.ERP_BACKUP_CLOUD_ENDPOINT, forcePathStyle: true }
      : {}),
    credentials: {
      accessKeyId: env.ERP_BACKUP_CLOUD_ACCESS_KEY_ID as string,
      secretAccessKey: env.ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY as string,
    },
  });
}

export function buildObjectKey(prefix: string, fileName: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/${fileName}` : fileName;
}

export async function uploadArchive(
  env: AgentEnv,
  archivePath: string,
  fileName: string,
  sizeBytes: number,
  logger: Logger,
): Promise<BackupCloudResult> {
  if (!isCloudEnabled(env)) return { status: 'disabled' };

  const key = buildObjectKey(env.ERP_BACKUP_CLOUD_PREFIX, fileName);
  const client = buildClient(env);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.ERP_BACKUP_CLOUD_BUCKET as string,
        Key: key,
        Body: createReadStream(archivePath),
        ContentLength: sizeBytes,
        ContentType: 'application/octet-stream',
      }),
    );
    logger.info(`Offsite copy uploaded as "${key}".`);
    return { status: 'uploaded', key };
  } catch (error) {
    // The message may name the bucket/endpoint but never the credentials —
    // the SDK does not echo them into errors.
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Offsite copy failed: ${message}`);
    return { status: 'failed', key, error: message };
  } finally {
    client.destroy();
  }
}
