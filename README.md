# Wally

A multi-agent automation platform. Each agent does one real job end to end — no mocked
data, no fabricated results. If an agent can't verify something real, it says so.

## The three agents

| Agent | What it actually does |
|---|---|
| **Load Testing** | Runs a real [k6](https://k6.io) load test against a target URL and reports p50/p95/p99 latency, throughput, and an SLO pass/fail verdict. |
| **Integration** | Given *any* tool or API name you type, it fetches that vendor's real public OpenAPI spec (when one exists), discovers every endpoint and response shape, tests one live endpoint for real, and registers the tool. If no public spec exists (most closed/authenticated-only products), it honestly reports that — with the exact URLs it checked — instead of inventing endpoints. |
| **API Lifecycle** | Fetches an API's current spec and diffs it against the last time Wally checked that same API, classifying every change as breaking or non-breaking. The first check for a name records a baseline; every check after that is a genuine diff. |

Every run streams live progress over SSE and persists a full step-by-step history, so a run
you open after it finished still shows exactly what happened and when.

## Architecture

```
frontend/          React 19 + Vite SPA — dashboard UI, SSE client, RBAC-aware routing
src/gateway/        Fastify 5 API — JWT (RS256) auth, RBAC, SSE, health checks
src/agents/         BaseAgent + three concrete agents (load-testing, integration, api-lifecycle)
src/adapters/       Pluggable data/cloud/compute adapters (Mongo or Postgres, local or cloud secrets/runners)
```

- **Auth**: RS256-signed JWTs in httpOnly cookies, double-submit CSRF, role-based access
  (`admin` / `manager` / `viewer`) enforced server-side — the frontend's route guards are UX
  only, never the real boundary.
- **Agents**: each extends `BaseAgent`, which runs named steps sequentially, persists every
  step, and publishes progress events — the same shape whether the "work" is a k6 subprocess,
  a real HTTP fetch against a vendor's docs, or a live API call.
- **Integration/API Lifecycle discovery**: a small registry of verified real spec URLs for
  well-known vendors (GitHub, Stripe, OpenAI, xAI, Swagger Petstore), plus live fallback probes
  (`api.<name>.com/openapi.json`, `docs.<name>.com/openapi.json`, `<name>.com/.well-known/openapi.json`)
  for anything else. Nothing is templated or guessed — a "spec not found" result means exactly
  that.

## Running it locally

Prerequisites: Node 20+, a MongoDB or PostgreSQL instance, and the [k6](https://k6.io) binary
on your PATH (or set `K6_BINARY_PATH`).

```bash
# Backend
npm install
cp .env.example .env        # fill in DATA_ENGINE, MONGO_URI/DATABASE_URL, etc.
npm run db:seed             # creates demo users + a couple of sample load-test runs
npm run start                # or: npm run dev:gateway

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                  # http://localhost:5173, proxies /api to the gateway on :3000
```

Demo accounts (seeded, all share one password):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@wally.dev` | `WallyDemo2026!` |
| Manager | `manager@wally.dev` | `WallyDemo2026!` |
| Viewer | `viewer@wally.dev` | `WallyDemo2026!` |

Viewers can watch runs; managers and admins can also trigger new ones.

## Testing

```bash
npm test              # unit + integration + contract + e2e + typecheck
npm run lint
```

## Known limitations

This is a local-first build: there's no Redis/queue-backed job runner (agents run in-process
via `BaseAgent`), and SSE fan-out is a single-process `EventEmitter`, not pub/sub. Both are
fine for a single-gateway deployment and are the natural next step for horizontal scaling.
