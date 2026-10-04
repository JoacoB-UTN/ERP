import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import * as forge from 'node-forge';

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
        !/^\d{11}$/.test(issuerCuit)
      )
        throw new Error();
      // Provisioning is server-only. Reject symlinked directories and path aliases.
      if ((await realpath(root)) !== resolve(root)) throw new Error();
      for (const directory of [root, join(root, companyId)]) {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      }
      const certificatePem = await this.readPem(
        join(root, companyId, 'certificate.pem'),
        false,
      );
      const privateKeyPem = await this.readPem(
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
      if (serials.length !== 1 || serials[0].value !== `CUIT ${issuerCuit}`)
        throw new Error();
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

  private async readPem(path: string, secret: boolean): Promise<string> {
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 1 ||
      before.size > 32_768 ||
      (secret && process.platform !== 'win32' && (before.mode & 0o077) !== 0)
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
        (secret && process.platform !== 'win32' && (after.mode & 0o077) !== 0)
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
