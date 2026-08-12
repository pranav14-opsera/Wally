import { z } from 'zod';

const CLOUD_PROVIDERS = ['aws', 'gcp', 'azure', 'local'] as const;
const DATA_ENGINES = ['postgres', 'mongo'] as const;
const COMPUTE_RUNNERS = ['local', 'cloud'] as const;
// Includes 'silent' (a valid Pino level, not just the 6 severity levels)
// so LOG_LEVEL=silent can fully disable log output — required by WO-004's
// logging module edge case; added here since AppConfig.LOG_LEVEL is its
// source of truth.
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

const LOCAL_SECRETS_MASTER_KEY_MIN_LENGTH = 32;

/**
 * Base shape: every variable that may be present, independent of which
 * provider/engine is selected. Provider-specific requirements are enforced
 * separately in `envSchema` via `.superRefine()` so that, for example,
 * MONGO_* variables can be safely omitted when DATA_ENGINE=postgres.
 */
// Trims and lowercases DATA_ENGINE before the enum check (WO-013 edge
// cases: ' postgres ' or 'Postgres' must resolve the same as 'postgres',
// not fail validation on whitespace/casing a human typing an env var by
// hand is likely to introduce) — non-string values pass through unchanged
// so `z.enum`'s own type error still fires for those, and `undefined`
// still reaches `.default('postgres')` below rather than becoming the
// string "undefined".
const normalizedDataEngine = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim().toLowerCase() : val),
  z.enum(DATA_ENGINES),
);

const baseEnvSchema = z.object({
  CLOUD_PROVIDER: z.enum(CLOUD_PROVIDERS).default('local'),
  DATA_ENGINE: normalizedDataEngine.default('postgres'),
  COMPUTE_RUNNER: z.enum(COMPUTE_RUNNERS).default('local'),

  POSTGRES_DB: z.string().min(1).optional(),
  POSTGRES_USER: z.string().min(1).optional(),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).optional(),
  POSTGRES_PORT: z.coerce.number().int().positive().optional(),

  MONGO_URI: z.string().min(1).optional(),
  MONGO_INITDB_DATABASE: z.string().min(1).optional(),

  REDIS_URL: z.string().min(1),
  JWT_PRIVATE_KEY_PATH: z.string().min(1),
  JWT_PUBLIC_KEY_PATH: z.string().min(1),
  LOCAL_SECRETS_MASTER_KEY: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  // Gateway graceful shutdown (WO-035) — how long `server.ts` waits for
  // Fastify to drain in-flight requests (`app.close()`) before it stops
  // waiting and lets the process exit anyway.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Base directory for FilesystemStorageAdapter (CLOUD_PROVIDER=local).
  // Only meaningful for the local provider, so it has a default rather
  // than a conditional-required check like LOCAL_SECRETS_MASTER_KEY.
  STORAGE_LOCAL_PATH: z.string().min(1).default('./data/storage'),

  // Encrypted secrets file for LocalSecretsAdapter (CLOUD_PROVIDER=local).
  // Same default-rather-than-required rationale as STORAGE_LOCAL_PATH —
  // LOCAL_SECRETS_MASTER_KEY (not this path) is what's conditionally
  // required when CLOUD_PROVIDER=local.
  SECRETS_LOCAL_PATH: z.string().min(1).default('./data/secrets.enc'),

  // LocalComputeRunner (COMPUTE_RUNNER=local) k6 process management —
  // all configurable per WO-017's "never hardcoded literals" constraint.
  K6_BINARY_PATH: z.string().min(1).default('k6'),
  COMPUTE_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  COMPUTE_GRACE_PERIOD_MS: z.coerce.number().int().positive().default(10_000),
  COMPUTE_TASK_RETENTION_MS: z.coerce.number().int().positive().default(3_600_000),

  // How long audit log entries are retained. Drives the Mongoose
  // AuditLog schema's TTL index (expireAfterSeconds); Postgres has no
  // native equivalent and instead relies on a scheduled purge job (a
  // later WO under REQ-009's data retention work) reading this same
  // value — one config field, not a per-engine duplicate.
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  // SecretsManagerAdapter (CLOUD_PROVIDER=aws, WO-019) — a safe default
  // rather than a conditional-required check, same rationale as
  // STORAGE_LOCAL_PATH/SECRETS_LOCAL_PATH: harmless to have a value even
  // when CLOUD_PROVIDER=local, and it's the namespace *prefix* itself
  // that's the meaningful configuration, not its mere presence.
  SECRETS_NAMESPACE: z.string().min(1).default('wally/'),
  // "true"/"false" strings, not z.coerce.boolean() — that coerces via
  // JS's `Boolean(str)`, under which the string "false" is truthy (any
  // non-empty string is), which would make SECRETS_FORCE_DELETE_WITHOUT_RECOVERY=false
  // silently mean true. Defaults to false: skipping Secrets Manager's
  // recovery window is destructive and must be opted into explicitly.
  SECRETS_FORCE_DELETE_WITHOUT_RECOVERY: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim().toLowerCase() === 'true' : val),
    z.boolean(),
  ).default(false),

  // Gateway CORS (WO-037) — comma-separated list, parsed by the CORS
  // plugin itself (this field stays the raw string so the plugin owns
  // trimming/normalizing each origin, not duplicated validation logic here).
  CORS_ALLOWED_ORIGINS: z.string().min(1).default('http://localhost:5173'),

  // Gateway security headers (WO-038) — raw CSP override string, parsed
  // by the security-headers plugin. Left as a plain string (not
  // structured here) because @fastify/helmet's CSP directive shape is
  // that plugin's concern, not config's.
  CSP_DIRECTIVES: z.string().optional(),

  // Gateway auth (WO-042) — bcrypt cost factor for password hashing.
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(12),

  // Gateway auth (WO-042) — minimum accepted login password length.
  // Defaults to a real complexity floor; only ever lower this in a local,
  // gitignored .env for a personal dev instance — never in committed config.
  AUTH_MIN_PASSWORD_LENGTH: z.coerce.number().int().positive().default(12),

  // Gateway health checks (WO-046) — per-dependency timeout for /api/v1/health/ready.
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  // Load Testing Agent (WO-093/096) — profile validation bounds and k6
  // run progress-heartbeat interval. Config-driven per the zero-hardcoding
  // policy (src/agents/** may not contain bare numeric literals — RULES.md).
  LOADTEST_NAME_MAX_LENGTH: z.coerce.number().int().positive().default(100),
  LOADTEST_MAX_VUS: z.coerce.number().int().positive().default(1_000),
  LOADTEST_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(3_600),
  LOADTEST_DEFAULT_VUS: z.coerce.number().int().positive().default(10),
  LOADTEST_DEFAULT_DURATION_SECONDS: z.coerce.number().int().positive().default(30),
  LOADTEST_DEFAULT_P95_THRESHOLD_MS: z.coerce.number().positive().default(500),
  LOADTEST_DEFAULT_ERROR_RATE_PCT: z.coerce.number().min(0).max(100).default(1),
  LOADTEST_PROGRESS_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  LOADTEST_STDERR_TAIL_LENGTH: z.coerce.number().int().positive().default(2_000),

  // BaseAgent (all agents) — floor on how long any single step takes
  // before it's marked completed, even if the underlying work finished
  // faster. Purely a demo/UX pacing knob (steps like "validate profile"
  // finish in a few ms; without a floor, agent runs feel like an instant
  // flash to "completed" rather than a visible, step-by-step analysis).
  AGENT_MIN_STEP_DURATION_MS: z.coerce.number().int().nonnegative().default(1_500),

  // Integration Agent / API Lifecycle Agent (WO-069/WO-100) — real
  // OpenAPI-spec fetch/parse bounds.
  TOOL_NAME_MAX_LENGTH: z.coerce.number().int().positive().default(100),
  SPEC_API_KEY_MAX_LENGTH: z.coerce.number().int().positive().default(200),
  SPEC_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  SPEC_MAX_ENDPOINTS_TO_SHOW: z.coerce.number().int().positive().default(20),
  SPEC_SUMMARY_MAX_LENGTH: z.coerce.number().int().positive().default(140),
  SPEC_RESPONSE_SHAPE_MAX_FIELDS: z.coerce.number().int().positive().default(10),
  API_LIFECYCLE_MAX_ENDPOINTS_TO_DIFF: z.coerce.number().int().positive().default(5_000),
});

function requireField(
  ctx: z.RefinementCtx,
  value: string | number | undefined,
  path: string,
  message: string,
): void {
  if (value === undefined || value === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  }
}

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.DATA_ENGINE === 'postgres') {
    requireField(ctx, env.POSTGRES_HOST, 'POSTGRES_HOST', 'Required when DATA_ENGINE=postgres');
    requireField(ctx, env.POSTGRES_USER, 'POSTGRES_USER', 'Required when DATA_ENGINE=postgres');
    requireField(
      ctx,
      env.POSTGRES_PASSWORD,
      'POSTGRES_PASSWORD',
      'Required when DATA_ENGINE=postgres',
    );
    requireField(ctx, env.POSTGRES_DB, 'POSTGRES_DB', 'Required when DATA_ENGINE=postgres');
    requireField(ctx, env.POSTGRES_PORT, 'POSTGRES_PORT', 'Required when DATA_ENGINE=postgres');
  }

  if (env.DATA_ENGINE === 'mongo') {
    requireField(ctx, env.MONGO_URI, 'MONGO_URI', 'Required when DATA_ENGINE=mongo');
    requireField(
      ctx,
      env.MONGO_INITDB_DATABASE,
      'MONGO_INITDB_DATABASE',
      'Required when DATA_ENGINE=mongo',
    );
  }

  if (env.CLOUD_PROVIDER === 'local') {
    if (!env.LOCAL_SECRETS_MASTER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOCAL_SECRETS_MASTER_KEY'],
        message: 'Required when CLOUD_PROVIDER=local',
      });
    } else if (env.LOCAL_SECRETS_MASTER_KEY.length < LOCAL_SECRETS_MASTER_KEY_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOCAL_SECRETS_MASTER_KEY'],
        message: `Must be at least ${LOCAL_SECRETS_MASTER_KEY_MIN_LENGTH} characters (AES-256 key material) when CLOUD_PROVIDER=local`,
      });
    }
  }
});

export type AppConfig = z.infer<typeof envSchema>;

// Convenience aliases so adapter factories (src/adapters/**) can reference
// these provider/engine types by name without depending on AppConfig's
// full shape — CLOUD_PROVIDERS/DATA_ENGINES/COMPUTE_RUNNERS above remain
// the single source of truth for the allowed values.
export type CloudProvider = AppConfig['CLOUD_PROVIDER'];
export type DataEngine = AppConfig['DATA_ENGINE'];
export type ComputeRunner = AppConfig['COMPUTE_RUNNER'];
