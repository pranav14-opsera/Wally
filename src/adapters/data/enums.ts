/**
 * String literal unions (not TS `enum`) for consistency with the rest of
 * the codebase (e.g. src/config/schema.ts's zod enums) — serializes
 * cleanly to/from JSON and Postgres/Mongo string columns with no extra
 * runtime object.
 */

export type AgentType = 'integration' | 'validation' | 'load_testing' | 'api_lifecycle';

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type UserRole = 'admin' | 'manager' | 'viewer';

export type SloVerdict = 'pass' | 'fail';

export type DriftType = 'value_mismatch' | 'missing_metric' | 'threshold_exceeded';
