# Data Adapter Contract Test Suite

Verifies behavioral parity between `PrismaRepository` (PostgreSQL, WO-009)
and `MongooseRepository` (MongoDB, WO-011) — the two concrete
implementations of `IRepository<T>` (WO-007) that `DATA_ENGINE` switches
between. This is the mechanism that makes REQ-002's "consumers never know
which engine is behind `DATA_ENGINE`" guarantee real rather than aspirational.

## Architecture: one set of tests, two engines

Every `*.contract.test.ts` file in this directory is **engine-agnostic** —
it contains no `if (engine === 'postgres')` branching and asserts the exact
same behavior regardless of which database backs it. The engine is selected
once, outside the test files entirely, via the `DATA_ENGINE` environment
variable that [`setup.ts`](./setup.ts) reads:

```
DATA_ENGINE=postgres npm run test:contract:postgres   # exercises PrismaRepository
DATA_ENGINE=mongo    npm run test:contract:mongo      # exercises MongooseRepository
```

`setup.ts`'s `createContractHarness()` is the one place that knows how to
build a `ContractRepositories` map (one `IRepository<T>` — or
`IAgentJobRepository` for `agentJob` — per entity type) for whichever
engine is active, so every test file just calls
`activeHarness.repositories.<entity>.<method>(...)` without ever
mentioning Prisma or Mongoose by name.

This is why running the *same* test file twice (once per engine) is a
meaningful parity proof rather than two independently-written suites that
could quietly drift apart: a bug that only breaks one engine's `findMany`
pagination, for example, fails that engine's run of `query.contract.test.ts`
while the other engine's run of the identical file keeps passing — the
diff *is* the parity violation.

## Files

| File | Covers |
|---|---|
| `setup.ts` | `ContractHarness`/`ContractRepositories` types, per-engine repository wiring, DB probing + skip-cleanly, cleanup/teardown |
| `fixtures/index.ts` | Re-exports WO-007's `tests/fixtures/entities/index.ts` fixtures; adds `seedUser`/`seedAgentJob`/`seedMetricRegistry` helpers for FK/parent-document chains |
| `crud.contract.test.ts` | `create`/`findById`/`update`/`delete`/`createMany` for all 10 entity types |
| `query.contract.test.ts` | Every `FilterOperator`, sort asc/desc, offset pagination, cursor pagination, `count()` |
| `transaction.contract.test.ts` | Successful commit, rollback-on-throw, callback return value, nested-transaction rejection |
| `composite.contract.test.ts` | `findByIdWithSteps`/`findByIdWithDriftEvents` — the embedded-array (Mongo) vs. joined-table (Postgres) abstraction |
| `error.contract.test.ts` | `DuplicateKeyError`, `EntityNotFoundError`, `ValidationError` normalization |

## Running locally

Both engines need a real, migrated database reachable — this suite
deliberately does **not** mock anything (see `setup.ts`'s module doc
comment): it's the one place proving the actual driver/query-builder/
error-mapper code paths behave identically, which a mock could never
verify.

```bash
docker compose up -d postgres mongo   # once WO-053's compose stack exists
npm run db:migrate:deploy             # apply Prisma migrations to postgres
npm run test:contract                 # runs both engines + the count-parity gate (scripts/run-contract-tests.sh)

# or one engine at a time:
npm run test:contract:postgres
npm run test:contract:mongo
```

When a database isn't reachable, every test file's top-level
`describe.skipIf(!harness)` skips that whole file cleanly with one
`console.warn` explaining why and how to start one — the same convention
`tests/integration/{prisma-migration,mongoose-schemas}.test.ts` already
use. `npm run test:contract` still exits `0` in that case (vitest doesn't
treat a skip as a failure), which is why `scripts/run-contract-tests.sh`
additionally compares the two engines' total test counts: since both runs
execute the identical files, a genuine engine-specific problem (a crash
before tests even register, e.g.) would show up as a count mismatch even
though neither run's exit code alone would catch it.

## Adding a new contract test

1. Add the assertion to whichever `*.contract.test.ts` file matches its
   category (or create a new file for a new category) — write it once,
   using `activeHarness.repositories.<entity>`, never a concrete
   `PrismaRepository`/`MongooseRepository` import.
2. If it needs a new fixture or seed helper, add it to `fixtures/index.ts`
   rather than inlining ad-hoc entity data in the test file, so later tests
   can reuse it too.
3. Run it against both engines locally before committing (see above) —
   a test that only makes sense for one engine's storage model (there
   shouldn't be one; that's the point of `IRepository<T>`) is a sign the
   interface itself needs to change, not that this suite should special-case
   an engine.
