import { randomUUID } from 'node:crypto';

/** Every schema uses created_at/updated_at (matching BaseEntity), not Mongoose's camelCase createdAt/updatedAt default. */
export const TIMESTAMPS_OPTION = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

/**
 * Every domain entity (src/adapters/data/entities/*.ts) is identified by
 * a UUID string `id`, matching the Postgres/Prisma side's `@default(uuid())`
 * primary keys — not MongoDB's native ObjectId, so cross-engine callers
 * (and any future migration between engines) see the same identifier
 * format regardless of DATA_ENGINE. `_id` is declared as a String (with
 * this as its default generator) in every schema built from these
 * options; Mongoose's built-in `id` virtual then exposes that same
 * string as `.id` with no extra mapping needed, since `_id` is already
 * a plain string rather than something requiring `.toString()`.
 */
export function defaultStringId(): string {
  return randomUUID();
}

/**
 * Shared schema options: created_at/updated_at timestamps, and
 * toJSON/toObject configured so a serialized document exposes `id`
 * (via Mongoose's built-in virtual) and omits the internal `__v`
 * version key — matching each entity's `BaseEntity`-derived TS shape
 * with no extra transform logic needed per schema.
 *
 * A function, not a shared typed constant: Mongoose's `SchemaOptions`
 * type is generic over the exact document type it's applied to, so a
 * single pre-typed object can't be reused as-is across `Schema<T>`
 * instances with different `T` — TypeScript locks the first usage's
 * generic instantiation in and every other schema's `_id: string`
 * conflicts with it (inferred as ObjectId instead). Returning a fresh,
 * structurally-typed plain object lets each call site's own `Schema<T>`
 * generic parameters check it correctly.
 */
export function baseSchemaOptions() {
  return {
    timestamps: TIMESTAMPS_OPTION,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  };
}
