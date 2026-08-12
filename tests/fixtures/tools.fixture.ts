import type { CreateToolInput } from '../../src/registries/types/tool.types.js';

/** Three sample tool definitions covering different auth_type values and endpoint configurations (WO-023 AC: "at least 3 sample tool definitions"). */

export const apiKeyToolFixture: CreateToolInput = {
  name: 'weather-api',
  description: 'Third-party weather data provider.',
  type: 'rest_api',
  base_url: 'https://api.weather.example.com',
  auth_type: 'api_key',
  endpoints: [
    { name: 'current', method: 'GET', path: '/v1/current' },
    { name: 'forecast', method: 'GET', path: '/v1/forecast' },
  ],
  credential_ref: 'secrets/weather-api-key',
};

export const oauth2ToolFixture: CreateToolInput = {
  name: 'crm-connector',
  description: 'CRM system with OAuth2 delegated access.',
  type: 'rest_api',
  base_url: 'https://api.crm.example.com',
  auth_type: 'oauth2',
  endpoints: [
    {
      name: 'contacts',
      method: 'GET',
      path: '/v2/contacts',
      // Deliberately nested/complex — proves the zod schema's loose
      // record(string, unknown) endpoint shape and the jsonb/Mixed
      // storage round-trip both handle non-flat metadata.
      pagination: { style: 'cursor', param: 'next_token' },
    },
  ],
  credential_ref: 'secrets/crm-oauth-client',
};

export const noAuthToolFixture: CreateToolInput = {
  name: 'public-status-page',
  description: 'Publicly readable status page with no authentication.',
  type: 'rest_api',
  base_url: 'https://status.example.com',
  auth_type: 'none',
  // Empty endpoints array — the "empty vs null" edge case the WO calls
  // out; this fixture pins the empty-array representation.
  endpoints: [],
};
