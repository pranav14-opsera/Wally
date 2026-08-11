// Prisma CLI configuration (migrate/generate/validate). Loaded only by the
// `prisma` CLI, never by the application at runtime — the app builds its
// own Prisma Client connection string from the validated AppConfig (see
// src/adapters/data/prisma/connection-string.ts), so this file exists
// purely to give CLI tooling the same POSTGRES_* variables to work with,
// without requiring developers to duplicate them into a second DATABASE_URL.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

import { buildDatabaseUrl } from './src/adapters/data/prisma/connection-string.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Falls back to placeholder connection values when POSTGRES_* isn't
    // set — keeps schema-only commands (validate, generate, migrate diff)
    // working without a real database. Commands that need a live
    // connection (migrate dev, db push) will fail with Prisma's own
    // connection error if the fallback values don't resolve to anything.
    url: buildDatabaseUrl({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: process.env.POSTGRES_PORT ?? '5432',
      user: process.env.POSTGRES_USER ?? 'wally',
      password: process.env.POSTGRES_PASSWORD ?? 'change-me',
      database: process.env.POSTGRES_DB ?? 'wally',
    }),
  },
});
