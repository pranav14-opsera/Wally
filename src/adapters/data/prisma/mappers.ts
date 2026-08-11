/**
 * Prisma model fields and domain entity fields (src/adapters/data/entities/*.ts)
 * are named identically by design — see schema.prisma's header comment.
 * The only thing separating a Prisma query result from a domain entity is
 * TypeScript's view of a couple of column types (`Prisma.JsonValue` vs.
 * `Record<string, unknown>` for JSONB columns), which carries no runtime
 * difference to resolve: the object Prisma returns already has the right
 * shape. This function is the single, audited place that bridges the two
 * type systems — if a future schema change ever needs real value
 * transformation (not just a type-level cast), it belongs here.
 */
export function toDomainEntity<TDomain>(prismaRecord: object): TDomain {
  return prismaRecord as unknown as TDomain;
}
