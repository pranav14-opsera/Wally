#!/bin/bash
# Runs the contract test suite once per DATA_ENGINE value to verify
# behavioral parity between the Postgres/Prisma and Mongo/Mongoose adapters.
# Both engines always run — a failure in one must not skip the other — and
# the script exits non-zero if either run fails.

set -u

FAILED=0

echo "=== Running contract tests with DATA_ENGINE=postgres ==="
DATA_ENGINE=postgres npx vitest run --config vitest.config.contract.ts
POSTGRES_EXIT=$?
if [ "$POSTGRES_EXIT" -ne 0 ]; then
  echo "Contract tests FAILED for DATA_ENGINE=postgres (exit $POSTGRES_EXIT)"
  FAILED=1
fi

echo "=== Running contract tests with DATA_ENGINE=mongo ==="
DATA_ENGINE=mongo npx vitest run --config vitest.config.contract.ts
MONGO_EXIT=$?
if [ "$MONGO_EXIT" -ne 0 ]; then
  echo "Contract tests FAILED for DATA_ENGINE=mongo (exit $MONGO_EXIT)"
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Contract test suite FAILED — see above for per-engine results."
  exit 1
fi

echo "Contract test suite PASSED for both DATA_ENGINE=postgres and DATA_ENGINE=mongo."
exit 0
