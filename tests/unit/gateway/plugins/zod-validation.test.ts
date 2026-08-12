import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../../../src/gateway/app.js';
import { Role } from '../../../../src/gateway/auth/roles.js';
import { paginationQuerySchema, uuidParamsSchema } from '../../../../src/gateway/schemas/index.js';
import { fakeGatewayContainer } from '../../../helpers/fake-gateway-container.js';

const PUBLIC = { config: { requiredRole: Role.PUBLIC } };

async function appWithSchemaRoutes() {
  const app = await buildApp(fakeGatewayContainer());
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/v1/test/paginated',
    { ...PUBLIC, schema: { querystring: paginationQuerySchema } },
    async (request) => request.query,
  );
  typed.get(
    '/api/v1/test/resource/:id',
    { ...PUBLIC, schema: { params: uuidParamsSchema } },
    async (request) => request.params,
  );
  typed.post(
    '/api/v1/test/nested',
    { ...PUBLIC, schema: { body: z.object({ config: z.object({ limits: z.object({ maxVUs: z.number() }) }) }) } },
    async (request) => request.body,
  );
  typed.post(
    '/api/v1/test/array',
    { ...PUBLIC, schema: { body: z.object({ items: z.array(z.object({ name: z.string() })) }) } },
    async (request) => request.body,
  );

  return app;
}

describe('zod validation plugin (via buildApp + inject)', () => {
  it('coerces valid query params to their declared types', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/paginated?page=2&limit=10' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: 2, limit: 10 });
    await app.close();
  });

  it('applies schema defaults when query params are omitted', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/paginated' });

    expect(response.json()).toEqual({ page: 1, limit: 20 });
    await app.close();
  });

  it('rejects an invalid query param with a structured 400', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/paginated?limit=9999' });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { field: string }[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0]?.field).toBe('limit');
    await app.close();
  });

  it('rejects a non-UUID path param', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/resource/not-a-uuid' });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { details: { field: string }[] } };
    expect(body.error.details[0]?.field).toBe('id');
    await app.close();
  });

  it('produces a dot-notation field path for a nested body validation error (edge case)', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/test/nested',
      payload: { config: { limits: { maxVUs: 'not-a-number' } } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { details: { field: string }[] } };
    expect(body.error.details[0]?.field).toBe('config.limits.maxVUs');
    await app.close();
  });

  it('includes the array index in the field path for an array item validation error (edge case)', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/test/array',
      payload: { items: [{ name: 'ok' }, { name: 123 }] },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { details: { field: string }[] } };
    expect(body.error.details[0]?.field).toBe('items.1.name');
    await app.close();
  });

  it('returns 400, not 500, for a missing body when the body schema is required (edge case)', async () => {
    const app = await appWithSchemaRoutes();

    const response = await app.inject({ method: 'POST', url: '/api/v1/test/nested' });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
