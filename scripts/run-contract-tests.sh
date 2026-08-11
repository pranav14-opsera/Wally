#!/bin/bash
# Runs the contract test suite once per DATA_ENGINE value to verify
# behavioral parity between the Postgres/Prisma and Mongo/Mongoose adapters.
# Both engines always run — a failure in one must not skip the other — and
# the script exits non-zero if either run fails.
#
# Also enforces WO-012's CI gate: the two runs must execute the *same
# number* of test cases. Every `*.contract.test.ts` file is engine-agnostic
# (see tests/contract/data-adapter/setup.ts) and asserts identically for
# both engines, so a differing count means a test was silently skipped for
# one engine only — most likely `describe.skipIf(!harness)` firing because
# that engine's database wasn't reachable while the other's was. Passing
# despite a skip would defeat the whole point of a dual-engine gate: it
# would look green while only proving one adapter actually works.

set -u

POSTGRES_RESULTS=".contract-results-postgres.json"
MONGO_RESULTS=".contract-results-mongo.json"
FAILED=0

echo "=== Running contract tests with DATA_ENGINE=postgres ==="
DATA_ENGINE=postgres npx vitest run --config vitest.config.contract.ts --reporter=default --reporter=json --outputFile="$POSTGRES_RESULTS"
POSTGRES_EXIT=$?
if [ "$POSTGRES_EXIT" -ne 0 ]; then
  echo "Contract tests FAILED for DATA_ENGINE=postgres (exit $POSTGRES_EXIT)"
  FAILED=1
fi

echo "=== Running contract tests with DATA_ENGINE=mongo ==="
DATA_ENGINE=mongo npx vitest run --config vitest.config.contract.ts --reporter=default --reporter=json --outputFile="$MONGO_RESULTS"
MONGO_EXIT=$?
if [ "$MONGO_EXIT" -ne 0 ]; then
  echo "Contract tests FAILED for DATA_ENGINE=mongo (exit $MONGO_EXIT)"
  FAILED=1
fi

if [ -f "$POSTGRES_RESULTS" ] && [ -f "$MONGO_RESULTS" ]; then
  # FORCE_COLOR=0 (not just piping) — Node's console.log auto-colors
  # numbers via util.inspect whenever it *thinks* stdout is a TTY, which
  # `$(...)` command substitution doesn't reliably prevent on every
  # platform/shell; an ANSI-wrapped number then fails the plain integer
  # comparison below with a cryptic "integer expression expected" instead
  # of a clear test-count mismatch. process.stdout.write sidesteps
  # util.inspect entirely, so this belt-and-suspenders combination holds
  # regardless of how any given shell reports its TTY-ness.
  POSTGRES_COUNT=$(FORCE_COLOR=0 node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$POSTGRES_RESULTS', 'utf-8')).numTotalTests ?? 0))")
  MONGO_COUNT=$(FORCE_COLOR=0 node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$MONGO_RESULTS', 'utf-8')).numTotalTests ?? 0))")
  echo "=== Test count parity check: postgres=$POSTGRES_COUNT mongo=$MONGO_COUNT ==="
  if [ "$POSTGRES_COUNT" -ne "$MONGO_COUNT" ]; then
    echo "Contract test suite FAILED — test counts differ between engines (postgres=$POSTGRES_COUNT, mongo=$MONGO_COUNT)."
    echo "This almost always means one engine's database wasn't reachable and its tests were skipped via describe.skipIf — a silent skip must not pass this gate."
    FAILED=1
  fi
else
  echo "Contract test suite FAILED — one or both result files ($POSTGRES_RESULTS, $MONGO_RESULTS) are missing, so test counts could not be compared."
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Contract test suite FAILED — see above for per-engine results."
  exit 1
fi

echo "Contract test suite PASSED for both DATA_ENGINE=postgres and DATA_ENGINE=mongo, with matching test counts."
exit 0
