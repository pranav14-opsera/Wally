import type { DriftEvent } from '../entities/DriftEvent.js';
import type { JobStep } from '../entities/JobStep.js';

/**
 * Unlike the Prisma adapter's `mappers.ts` (a near-identity cast, since
 * Prisma's query results already match the domain entity shape by
 * design — see that file's comment), Mongoose's `.lean()` queries
 * (used throughout this adapter for performance, per the WO) return
 * plain objects with `_id` and `__v` exactly as MongoDB stores them —
 * `.lean()` skips hydration into a full Document, so the schema's
 * `toJSON`/`toObject` transforms (WO-010) never run. This function is
 * the one place that bridges the two shapes for real.
 */
export function toDomainEntity<TDomain>(leanDoc: Record<string, unknown>): TDomain {
  const { _id, __v: _v, ...rest } = leanDoc;
  return { id: _id, ...rest } as unknown as TDomain;
}

export function toDomainEntities<TDomain>(leanDocs: Array<Record<string, unknown>>): TDomain[] {
  return leanDocs.map((doc) => toDomainEntity<TDomain>(doc));
}

/**
 * Embedded job_steps elements have no `job_id` field (see JobStep.schema.ts,
 * WO-010) — it's implicit via the parent AgentJob document. This is the
 * one place that injects it back when producing a full `JobStep` for
 * callers that expect the WO-007 domain shape.
 */
export function mapEmbeddedJobStep(leanStep: Record<string, unknown>, jobId: string): JobStep {
  const { _id, ...rest } = leanStep;
  return { id: _id, job_id: jobId, ...rest } as unknown as JobStep;
}

/** Same job_id-injection need as `mapEmbeddedJobStep`, for drift_events. */
export function mapEmbeddedDriftEvent(leanEvent: Record<string, unknown>, jobId: string): DriftEvent {
  const { _id, ...rest } = leanEvent;
  return { id: _id, job_id: jobId, ...rest } as unknown as DriftEvent;
}
