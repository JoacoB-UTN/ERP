import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import * as forge from 'node-forge';
import { z } from 'zod';
import { isValidCuitChecksum } from '@erp/shared';

const cuitSchema = z
  .string()
  .regex(/^\d{11}$/)
  .refine(isValidCuitChecksum);
const representationSchema = z
  .object({
    issuerCuit: cuitSchema,
    certificateCuit: cuitSchema,
  })
  .strict();

export interface ArcaCredentials {
  certificatePem: string;
  privateKeyPem: string;
  fingerprint: string;
  validUntil: string;
}

@Injectable()
export class ArcaCredentialsService {
  async load(companyId: string, issuerCuit: string): Promise<ArcaCredentials> {
    try {
      const root = process.env.ERP_ARCA_CREDENTIALS_DIR;
      if (
        !root ||
        !isAbsolute(root) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          companyId,
        ) ||
        !cuitSchema.safeParse(issuerCuit).success
      )
        throw new Error();
      // Provisioning is server-only. Reject symlinked directories and path aliases.
      if ((await realpath(root)) !== resolve(root)) throw new Error();
      for (const directory of [root, join(root, companyId)]) {
        const info = await lstat(directory);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          (process.platform !== 'win32' && (info.mode & 0o022) !== 0)
        )
          throw new Error();
      }
      const certificatePem = await this.readRegularFile(
        join(root, companyId, 'certificate.pem'),
        false,
      );
      const privateKeyPem = await this.readRegularFile(
        join(root, companyId, 'private-key.pem'),
        true,
      );
      const certificate = new X509Certificate(certificatePem);
      const privateKey = createPrivateKey(privateKeyPem);
      const now = Date.now();
      if (
        Date.parse(certificate.validFrom) > now ||
        Date.parse(certificate.validTo) <= now ||
        certificate.publicKey.asymmetricKeyType !== 'rsa' ||
        (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) <
          2048 ||
        !certificate.checkPrivateKey(privateKey)
      )
        throw new Error();
      const parsed = forge.pki.certificateFromPem(certificatePem);
      const serials = parsed.subject.attributes.filter(
        (attr) => attr.type === '2.5.4.5',
      );
      if (serials.length !== 1 || typeof serials[0].value !== 'string')
        throw new Error();
      const match = /^CUIT (\d{11})$/.exec(serials[0].value);
      if (!match || !cuitSchema.safeParse(match[1]).success) throw new Error();
      const certificateCuit = match[1];
      const representation = await this.readRepresentation(
        join(root, companyId, 'representation.json'),
      );
      if (representation) {
        if (
          representation.issuerCuit !== issuerCuit ||
          representation.certificateCuit !== certificateCuit
        )
          throw new Error();
      } else if (certificateCuit !== issuerCuit) throw new Error();
      return {
        certificatePem,
        privateKeyPem,
        fingerprint: certificate.fingerprint256,
        validUntil: new Date(certificate.validTo).toISOString(),
      };
    } catch {
      // No filenames, certificate subjects, OpenSSL diagnostics or key bytes leave this boundary.
      throw new ServiceUnavailableException(
        'Las credenciales de homologación no están disponibles o no son válidas para esta empresa.',
      );
    }
  }

  private async readRepresentation(
    path: string,
  ): Promise<z.infer<typeof representationSchema> | null> {
    // Only initial absence permits the same-CUIT fallback. A removal during reading fails closed.
    try {
      await lstat(path);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw error;
    }
    const content = await this.readRegularFile(path, false, true);
    return representationSchema.parse(JSON.parse(content) as unknown);
  }

  private async readRegularFile(
    path: string,
    secret: boolean,
    protectedConfig = false,
  ): Promise<string> {
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 1 ||
      before.size > 32_768 ||
      (process.platform !== 'win32' &&
        ((secret && (before.mode & 0o077) !== 0) ||
          (protectedConfig && (before.mode & 0o022) !== 0)))
    )
      throw new Error();
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const after = await handle.stat();
      if (
        !after.isFile() ||
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.size > 32_768 ||
        (process.platform !== 'win32' &&
          ((secret && (after.mode & 0o077) !== 0) ||
            (protectedConfig && (after.mode & 0o022) !== 0)))
      )
        throw new Error();
      const buffer = Buffer.alloc(32_769);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== after.size || bytesRead > 32_768) throw new Error();
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
}
