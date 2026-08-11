# Custom Lint Rules

## `wally/no-hardcoded-config`

**Scope:** `src/agents/**/*.ts` only.

### Why this rule exists

Wally's zero-hardcoding policy requires that agent code never bakes in
fixed tool names, metric names, cloud provider references, database
driver references, or magic numbers. Every one of those values must come
from a config table entry, an environment variable, or a registry lookup
— that's what makes providers/engines/tools swappable at runtime without
touching agent code. This rule is the automated enforcement of that
policy; without it, the guardrail metric "hardcoded literal count = 0"
degrades over time as developers take shortcuts under deadline pressure.

### What it detects

1. **Bare numeric literals** — any number literal that isn't `0`, `1`,
   `-1`, an HTTP status code (`200`–`599`), an enum member initializer, a
   type-level literal, or a computed array/member index (`arr[0]`).

   ```ts
   // ❌ flagged
   await sleep(3600);

   // ✅ ok — comes from config
   await sleep(config.retryDelayMs);
   ```

2. **Hardcoded provider/engine strings** — string literals that exactly
   match a banned value (`aws`, `gcp`, `azure`, `postgres`, `mongo`,
   `mongodb`, `redis`, `s3`, `dynamodb`, `secretsmanager`, `ecs`),
   outside of type annotations, enum declarations, and import sources.

   ```ts
   // ❌ flagged
   if (provider === 'aws') { ... }

   // ✅ ok — resolved from config, not a fixed string
   if (provider === config.CLOUD_PROVIDER) { ... }
   ```

3. **Template literals containing a banned string** — same banned-string
   set, checked as a substring against each template literal segment.

   ```ts
   // ❌ flagged
   const key = `mongo:${id}`;

   // ✅ ok — no banned substring
   const key = `${entityName}:${id}`;
   ```

4. **Direct SDK imports** — `import` statements whose source starts with
   `@aws-sdk/`, `@prisma/client`, `mongoose`, or `ioredis`.

   ```ts
   // ❌ flagged
   import { S3Client } from '@aws-sdk/client-s3';

   // ✅ ok — depend on the adapter interface instead
   import type { ICloudStorageService } from '../../adapters/cloud/index.js';
   ```

### Default allow-list

- Numbers: `0`, `1`, `-1`, plus any integer `200`–`599` (HTTP status codes).
- Everything else numeric is a violation unless it's structural (enum
  member, type-level literal, or a computed member/array index like
  `arr[0]`).

### Configuring additional exceptions

Pass rule options in `eslint.config.js` — do not edit the rule source to
add project-specific exceptions:

```js
rules: {
  'wally/no-hardcoded-config': ['error', {
    allowedNumbers: [8080],       // extends the default allow-list
    allowedStrings: ['dynamodb'], // exempts this banned string
  }],
},
```

### Legitimate one-off exceptions

For a single justified exception, use `eslint-disable-next-line` with a
comment explaining *why* — not just that the line is exempted:

```ts
// eslint-disable-next-line wally/no-hardcoded-config -- retry backoff
// base defined by the load-testing spec (WO-093), not a config value
const BACKOFF_BASE_MS = 3600;
```

Prefer adding the value to `allowedNumbers`/`allowedStrings` (or, better,
moving it into config/the registry) over `eslint-disable` when the
exception isn't truly one-off.
