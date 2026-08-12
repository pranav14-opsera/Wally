import type { CreateSpecInput } from '../../src/registries/types/spec.types.js';

/** Three API specs with multiple versions each, including $ref pointers stored as-is (WO-026 AC: "at least 3 API specs with multiple versions each"). */

export const petstoreV1Fixture: CreateSpecInput = {
  api_name: 'petstore',
  version: '1.0',
  spec_content: {
    openapi: '3.0.0',
    info: { title: 'Petstore API', version: '1.0' },
    paths: {
      '/pets': {
        get: {
          responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/PetList' } } } } },
        },
      },
    },
    components: {
      schemas: {
        Pet: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
        PetList: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
      },
    },
  },
};

export const petstoreV1_1Fixture: CreateSpecInput = {
  api_name: 'petstore',
  version: '1.1',
  spec_content: {
    ...petstoreV1Fixture.spec_content,
    info: { title: 'Petstore API', version: '1.1' },
    paths: {
      ...(petstoreV1Fixture.spec_content.paths as Record<string, unknown>),
      '/pets/{id}': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
        },
      },
    },
  },
};

export const petstoreV2Fixture: CreateSpecInput = {
  api_name: 'petstore',
  version: '2.0',
  spec_content: {
    openapi: '3.1.0',
    info: { title: 'Petstore API', version: '2.0', description: 'Breaking change: id is now a UUID string, not an integer.' },
    paths: {
      '/pets': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/PetList' } } } } } } },
    },
    components: {
      schemas: {
        Pet: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
        PetList: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
      },
    },
  },
};

export const usersApiV1Fixture: CreateSpecInput = {
  api_name: 'users-api',
  version: '1.0',
  spec_content: {
    openapi: '3.0.0',
    info: { title: 'Users API', version: '1.0' },
    paths: {
      '/users': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/UserList' } } } } } } },
    },
    components: {
      schemas: {
        User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' } } },
        UserList: { type: 'array', items: { $ref: '#/components/schemas/User' } },
      },
    },
  },
};

export const usersApiV1_1Fixture: CreateSpecInput = {
  api_name: 'users-api',
  version: '1.1',
  spec_content: {
    ...usersApiV1Fixture.spec_content,
    info: { title: 'Users API', version: '1.1', description: 'Added ünïcödé example text to prove correct round-tripping.' },
  },
};

export const paymentsApiV1Fixture: CreateSpecInput = {
  api_name: 'payments-api',
  version: '1.0',
  spec_content: {
    openapi: '3.0.0',
    info: { title: 'Payments API', version: '1.0' },
    paths: {
      '/charges': {
        post: {
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ChargeRequest' } } } },
          responses: { '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } } } },
        },
      },
    },
    components: {
      schemas: {
        ChargeRequest: { type: 'object', properties: { amount_cents: { type: 'integer' }, currency: { type: 'string' } } },
        Charge: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'succeeded', 'failed'] } } },
      },
    },
  },
};
