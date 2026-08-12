export interface KnownSpecEntry {
  matchNames: string[];
  displayName: string;
  specUrl: string;
  /** A real, safe, unauthenticated GET request the agent actually issues during `test_apis`. Omitted where every real endpoint requires an API key (true for OpenAI, xAI, Stripe — there is no anonymous-safe request to make against them, so `test_apis` honestly reports 0 tested rather than faking one). */
  liveTest?: { method: 'GET'; url: string; description: string };
}

/**
 * A small registry mapping common names to each vendor's REAL, official,
 * publicly-published OpenAPI specification — verified reachable at
 * session time, not invented URLs. A name that doesn't match anything
 * here falls through to `integration-agent.ts`'s honest "no public spec
 * located" path instead of a fabricated endpoint list.
 */
export const KNOWN_SPECS: KnownSpecEntry[] = [
  {
    matchNames: ['openai', 'codex', 'gpt', 'chatgpt'],
    displayName: 'OpenAI',
    specUrl: 'https://raw.githubusercontent.com/openai/openai-openapi/main/openapi.json',
  },
  {
    matchNames: ['xai', 'x.ai', 'grok'],
    displayName: 'xAI (Grok)',
    specUrl: 'https://docs.x.ai/openapi.json',
  },
  {
    matchNames: ['github'],
    displayName: 'GitHub',
    specUrl: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
    liveTest: {
      method: 'GET',
      url: 'https://api.github.com/repos/openai/openai-openapi',
      description: 'GET /repos/{owner}/{repo} — a real public, unauthenticated repository lookup',
    },
  },
  {
    matchNames: ['stripe'],
    displayName: 'Stripe',
    specUrl: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
  },
  {
    matchNames: ['petstore', 'swagger petstore', 'pet store'],
    displayName: 'Swagger Petstore',
    specUrl: 'https://petstore3.swagger.io/api/v3/openapi.json',
    liveTest: {
      method: 'GET',
      url: 'https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available',
      description: 'GET /pet/findByStatus — a real, public, unauthenticated demo endpoint',
    },
  },
];

export function findKnownSpec(toolName: string): KnownSpecEntry | undefined {
  const normalized = toolName.trim().toLowerCase();
  return KNOWN_SPECS.find((entry) => entry.matchNames.some((name) => normalized.includes(name)));
}
