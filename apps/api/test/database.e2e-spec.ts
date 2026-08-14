import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Database connectivity (integration)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('connects to Postgres and can run a raw query', async () => {
    const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    expect(result).toEqual([{ ok: 1 }]);
  });

  it('isHealthy() reports true against a live database', async () => {
    await expect(prisma.isHealthy()).resolves.toBe(true);
  });

  it('can query the foundation schema (tenants table exists and is reachable)', async () => {
    await expect(prisma.tenant.count()).resolves.toEqual(expect.any(Number));
  });
});
