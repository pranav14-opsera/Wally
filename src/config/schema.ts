import { z } from 'zod';

const CLOUD_PROVIDERS = ['aws', 'gcp', 'azure', 'local'] as const;
const DATA_ENGINES = ['postgres', 'mongo'] as const;
const COMPUTE_RUNNERS = ['local', 'cloud'] as const;
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const LOCAL_SECRETS_MASTER_KEY_MIN_LENGTH = 32;

/**
 * Base shape: every variable that may be present, independent of which
 * provider/engine is selected. Provider-specific requirements are enforced
 * separately in `envSchema` via `.superRefine()` so that, for example,
 * MONGO_* variables can be safely omitted when DATA_ENGINE=postgres.
 */
const baseEnvSchema = z.object({
  CLOUD_PROVIDER: z.enum(CLOUD_PROVIDERS).default('local'),
  DATA_ENGINE: z.enum(DATA_ENGINES).default('postgres'),
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
