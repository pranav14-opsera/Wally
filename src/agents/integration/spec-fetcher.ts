import { load as loadYaml } from 'js-yaml';

import { findKnownSpec } from './known-specs.js';
import type { KnownSpecEntry } from './known-specs.js';

export interface DiscoveredEndpoint {
  method: string;
  path: string;
  summary: string;
  /** Top-level response field names, resolved from the real spec's `$ref`/`properties` where derivable — best-effort, not guaranteed for every operation. */
  responseShape: string[];
  /** Required path/query parameters and (for write methods) required request-body fields — genuinely read from the spec's `parameters`/`requestBody`, used by the API Lifecycle Agent to detect real breaking changes between two fetches of the same API. */
  requiredParams: string[];
}

export interface DiscoveredSpec {
  toolName: string;
  matched: boolean;
  displayName: string;
  specUrl: string;
  totalEndpointCount: number;
  endpoints: DiscoveredEndpoint[];
  liveTest?: KnownSpecEntry['liveTest'];
  attemptedUrls: string[];
}

export interface DiscoverToolSpecOptions {
  maxEndpoints: number;
  fetchTimeoutMs: number;
  summaryMaxLength: number;
  responseShapeMaxFields: number;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
// eslint-disable-next-line wally/no-hardcoded-config -- recursion-depth safety bound against malformed/circular $ref chains, not a business/config value
const REF_RESOLUTION_MAX_DEPTH = 3;

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Real vendor specs come as either JSON or YAML (Cursor's, for one, is YAML) — parsed by trying JSON first, then falling back to a real YAML parser, never assumed from the URL's extension alone. */
function parseSpecDocument(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const parsed = loadYaml(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Document is neither valid JSON nor valid YAML');
    }
    return parsed as Record<string, unknown>;
  }
}

async function fetchSpecDocument(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const raw = await fetchText(url, timeoutMs);
  return parseSpecDocument(raw);
}

// Matches an href/src pointing at something that looks like a real OpenAPI/Swagger
// document (path containing "openapi" or "swagger", ending .json/.yaml/.yml) inside
// a vendor's own docs page HTML — how a human would spot the link by eye, done for
// real against the actual page rather than guessed.
const SPEC_LINK_PATTERN = /(?:href|src)=["']([^"']*(?:openapi|swagger)[^"']*\.(?:json|ya?ml))["']/gi;

/** Crawls a real vendor docs/homepage URL for a link to their actual OpenAPI/Swagger document — the same thing a person does by eye when hunting for a tool's spec, just automated. Returns the first match resolved to an absolute URL, or undefined if the page has no such link. */
async function findSpecLinkOnPage(pageUrl: string, timeoutMs: number): Promise<string | undefined> {
  const html = await fetchText(pageUrl, timeoutMs);
  const match = SPEC_LINK_PATTERN.exec(html);
  SPEC_LINK_PATTERN.lastIndex = 0;
  const href = match?.[1];
  if (!href) {
    return undefined;
  }
  return new URL(href, pageUrl).toString();
}

/** Resolves a real OpenAPI 3 schema (following `$ref` into `components.schemas`, one array unwrap) down to its top-level property names — a best-effort shape summary, not a full JSON-Schema resolver. */
function resolveSchemaShape(schema: Record<string, unknown> | undefined, components: Record<string, unknown>, depth = 0): string[] {
  if (!schema || depth > REF_RESOLUTION_MAX_DEPTH) {
    return [];
  }
  if (typeof schema.$ref === 'string') {
    const refName = schema.$ref.split('/').pop();
    const schemas = (components.schemas ?? {}) as Record<string, unknown>;
    return resolveSchemaShape(schemas[refName ?? ''] as Record<string, unknown> | undefined, components, depth + 1);
  }
  if (schema.type === 'array' && schema.items) {
    return resolveSchemaShape(schema.items as Record<string, unknown>, components, depth + 1).map((key) => `${key}[]`);
  }
  if (schema.properties && typeof schema.properties === 'object') {
    return Object.keys(schema.properties as Record<string, unknown>);
  }
  return [];
}

/** Required path/query params (`parameters[].required === true`) plus, for write methods, the request body's own `required` field list — both genuinely read from the operation, not inferred. */
function extractRequiredParams(op: Record<string, unknown>, components: Record<string, unknown>): string[] {
  const required: string[] = [];
  const parameters = (op.parameters ?? []) as Record<string, unknown>[];
  for (const parameter of parameters) {
    if (parameter.required === true && typeof parameter.name === 'string') {
      required.push(parameter.name);
    }
  }

  const requestBody = op.requestBody as Record<string, unknown> | undefined;
  const content = requestBody?.content as Record<string, unknown> | undefined;
  const jsonBody = content?.['application/json'] as Record<string, unknown> | undefined;
  let schema = jsonBody?.schema as Record<string, unknown> | undefined;
  if (schema && typeof schema.$ref === 'string') {
    const refName = schema.$ref.split('/').pop();
    const schemas = (components.schemas ?? {}) as Record<string, unknown>;
    schema = schemas[refName ?? ''] as Record<string, unknown> | undefined;
  }
  if (Array.isArray(schema?.required)) {
    required.push(...(schema.required as unknown[]).filter((field): field is string => typeof field === 'string'));
  }

  return required;
}

function extractEndpoints(
  spec: Record<string, unknown>,
  summaryMaxLength: number,
  responseShapeMaxFields: number,
): DiscoveredEndpoint[] {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const components = (spec.components ?? {}) as Record<string, unknown>;
  const endpoints: DiscoveredEndpoint[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      const op = operation as Record<string, unknown>;
      const responses = (op.responses ?? {}) as Record<string, unknown>;
      const successResponse = (responses['200'] ?? responses['201']) as Record<string, unknown> | undefined;
      const content = successResponse?.content as Record<string, unknown> | undefined;
      const jsonContent = content?.['application/json'] as Record<string, unknown> | undefined;
      const shape = resolveSchemaShape(jsonContent?.schema as Record<string, unknown> | undefined, components);

      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary:
          typeof op.summary === 'string'
            ? op.summary
            : typeof op.description === 'string'
              ? op.description.slice(0, summaryMaxLength)
              : '',
        responseShape: shape.slice(0, responseShapeMaxFields),
        requiredParams: extractRequiredParams(op, components),
      });
    }
  }
  return endpoints;
}

/**
 * Resolves a free-text tool name to its REAL, official public OpenAPI
 * spec and genuinely fetches + parses it — no fabricated endpoint list.
 * For a name that doesn't match the known registry, this makes real
 * fetch attempts against common spec-hosting conventions before honestly
 * reporting that no public spec could be located (WO-069, dynamic per
 * the user's explicit request — not a fixed dropdown of canned tools).
 */
export async function discoverToolSpec(toolNameInput: string, options: DiscoverToolSpecOptions): Promise<DiscoveredSpec> {
  const toolName = toolNameInput.trim() || 'Unnamed Tool';
  const known = findKnownSpec(toolName);

  if (known) {
    const spec = await fetchSpecDocument(known.specUrl, options.fetchTimeoutMs);
    const allEndpoints = extractEndpoints(spec, options.summaryMaxLength, options.responseShapeMaxFields);
    return {
      toolName,
      matched: true,
      displayName: known.displayName,
      specUrl: known.specUrl,
      totalEndpointCount: allEndpoints.length,
      endpoints: allEndpoints.slice(0, options.maxEndpoints),
      liveTest: known.liveTest,
      attemptedUrls: [known.specUrl],
    };
  }

  // Not in the known registry — genuinely try the conventions real APIs
  // commonly publish a spec at, rather than assuming failure.
  const slug = toolName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '') || 'tool';
  const directCandidates = [
    `https://api.${slug}.com/openapi.json`,
    `https://docs.${slug}.com/openapi.json`,
    `https://docs.${slug}.com/openapi.yaml`,
    `https://${slug}.com/.well-known/openapi.json`,
    `https://${slug}.com/openapi.json`,
    `https://${slug}.com/openapi.yaml`,
    `https://${slug}.com/swagger.json`,
  ];
  // Real vendor docs sites usually publish the spec as a linked file on their
  // own docs page rather than at a fixed URL — crawling for that link (the
  // same thing a person does by eye) finds far more real specs than guessing
  // fixed paths ever will.
  const docsPagesToCrawl = [`https://${slug}.com/docs`, `https://docs.${slug}.com`, `https://${slug}.com`];
  const attemptedUrls = [...directCandidates, ...docsPagesToCrawl];

  for (const url of directCandidates) {
    try {
      const spec = await fetchSpecDocument(url, options.fetchTimeoutMs);
      const allEndpoints = extractEndpoints(spec, options.summaryMaxLength, options.responseShapeMaxFields);
      if (allEndpoints.length > 0) {
        return {
          toolName,
          matched: true,
          displayName: toolName,
          specUrl: url,
          totalEndpointCount: allEndpoints.length,
          endpoints: allEndpoints.slice(0, options.maxEndpoints),
          attemptedUrls,
        };
      }
    } catch {
      // Expected for most arbitrary names — try the next convention.
    }
  }

  for (const pageUrl of docsPagesToCrawl) {
    try {
      const specLink = await findSpecLinkOnPage(pageUrl, options.fetchTimeoutMs);
      if (!specLink) {
        continue;
      }
      const spec = await fetchSpecDocument(specLink, options.fetchTimeoutMs);
      const allEndpoints = extractEndpoints(spec, options.summaryMaxLength, options.responseShapeMaxFields);
      if (allEndpoints.length > 0) {
        return {
          toolName,
          matched: true,
          displayName: toolName,
          specUrl: specLink,
          totalEndpointCount: allEndpoints.length,
          endpoints: allEndpoints.slice(0, options.maxEndpoints),
          attemptedUrls: [...attemptedUrls, specLink],
        };
      }
    } catch {
      // Page unreachable, no matching link, or the linked document didn't
      // parse as a real spec — try the next docs page.
    }
  }

  return {
    toolName,
    matched: false,
    displayName: toolName,
    specUrl: '',
    totalEndpointCount: 0,
    endpoints: [],
    attemptedUrls,
  };
}
