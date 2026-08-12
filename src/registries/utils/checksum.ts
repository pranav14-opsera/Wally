import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 hex digest of a JSON-serializable value — keys
 * are sorted recursively before stringifying, so semantically-identical
 * spec content always produces the same checksum regardless of key
 * insertion order (WO-026's edge case: "checksum determinism...key
 * ordering matters").
 *
 * Throws the native `TypeError` JSON.stringify raises on a circular
 * structure — callers (SpecRegistryService.register) catch it and wrap
 * it in a RegistryError, per the WO's edge case list.
 */
export function computeChecksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeysDeep(value))).digest('hex');
}

/**
 * `ancestors` tracks the current recursion path (added on entry, removed
 * on exit) — not every object ever visited. The same object reachable
 * from two unrelated branches (a legitimate DAG, common in OpenAPI specs
 * via shared $ref targets after a hypothetical resolution step) is not
 * circular; only an object appearing in its *own* ancestor chain is.
 * Matches JSON.stringify's actual circular-reference semantics, which a
 * naive "seen everything" set would falsely trigger on shared references.
 */
function sortKeysDeep(value: unknown, ancestors: Set<object> = new Set()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (ancestors.has(value)) {
    throw new TypeError('Converting circular structure to JSON');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sortKeysDeep(item, ancestors));
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key], ancestors);
    }
    return sorted;
  } finally {
    ancestors.delete(value);
  }
}
