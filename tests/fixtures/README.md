# Test Fixtures

This directory holds test data conventions for the Wally test suite.

## Static seed data — JSON files

Use a JSON file when the data is fixed and doesn't need per-test variation.

- Naming convention: `entity-name.fixture.json` (e.g. `tool-registry-entry.fixture.json`).
- One entity type per file. For a collection, use an array at the top level.
- Keep fixtures minimal — only the fields a test actually asserts on or that
  are required by the schema.

## Dynamic data — factory functions

Use a factory function (in `tests/helpers/`) when a test needs unique or
parameterized data per run (e.g. unique IDs, timestamps, or variations
across test cases).

- Factories live alongside other shared helpers in `tests/helpers/index.ts`
  (or a dedicated `tests/helpers/factories.ts` as the number of entities
  grows).
- Prefer factories over JSON fixtures whenever a test needs more than one
  instance of an entity, since JSON fixtures are singletons.

## Choosing between the two

| Data characteristic | Use |
|---|---|
| Same shape/values every test run | JSON fixture |
| Needs unique IDs per test | Factory function |
| Represents a fixed real-world example (e.g. sample OpenAPI spec) | JSON fixture |
| Built up from a base object with overrides per test | Factory function |
