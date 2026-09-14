import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns a healthy response', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);

    const body = response.body as {
      status: string;
      services: { database: string; redis: string };
      currentAccountsBackfill: string;
    };

    expect(body.status).toBe('ok');
    expect(body.services).toEqual({ database: 'ok', redis: 'ok' });

    // The backfill state is reported, but its VALUE is not asserted: it is a
    // fact about the whole database, and nineteen suites share one. Pinning
    // it to 'complete' here would make this suite fail whenever a sibling's
    // fixtures happen to be waiting — which says nothing about health.
    expect(['pending', 'running', 'complete', 'failed', 'disabled']).toContain(
      body.currentAccountsBackfill,
    );

    // And nothing else leaked into an unauthenticated endpoint.
    expect(Object.keys(body).sort()).toEqual([
      'currentAccountsBackfill',
      'services',
      'status',
    ]);
  });
});
