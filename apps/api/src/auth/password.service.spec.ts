import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password (the hash is never the plaintext)', async () => {
    const hash = await service.hash('a-correct-horse-battery-staple');
    expect(hash).not.toBe('a-correct-horse-battery-staple');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('validates the correct password against its hash', async () => {
    const hash = await service.hash('correct password here');
    await expect(service.verify(hash, 'correct password here')).resolves.toBe(
      true,
    );
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct password here');
    await expect(service.verify(hash, 'wrong password here')).resolves.toBe(
      false,
    );
  });

  it('rejects gracefully (not throw) against a malformed hash', async () => {
    await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(
      false,
    );
  });
});
