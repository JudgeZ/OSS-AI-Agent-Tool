import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './index';

describe('memory service placeholder', () => {
  it('returns ok for health checks', async () => {
    const response = await request(createApp()).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('validates cache write payloads', async () => {
    const response = await request(createApp()).post('/state/cache').send({ key: '' });
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error', 'Invalid payload');
  });

  it('returns stub data for cache reads', async () => {
    const response = await request(createApp()).get('/state/cache/example');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      key: 'example',
      value: null,
      message: 'Stub: cache lookup not yet implemented'
    });
  });
});
