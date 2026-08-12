import { z } from 'zod';

import type { AppConfig } from '../../config/schema.js';

// The WO's API contract names this field `username`, but Wally's User
// entity (src/adapters/data/entities/User.ts) has no separate username
// column — only `email` — so `username` here IS the account's email
// address. Kept as `username` in the schema/wire format to match the
// documented contract; mapped to `email` when querying the repository.
//
// The password minimum is read from config (AUTH_MIN_PASSWORD_LENGTH)
// rather than hardcoded, so a personal local instance can loosen it via
// its own gitignored .env without touching this file's committed default.
export function createLoginRequestSchema(config: AppConfig) {
  return z.object({
    username: z.string().min(3).max(100).describe('Account email address'),
    password: z.string().min(config.AUTH_MIN_PASSWORD_LENGTH).max(128).describe('Account password'),
  });
}

export type LoginRequest = z.infer<ReturnType<typeof createLoginRequestSchema>>;
