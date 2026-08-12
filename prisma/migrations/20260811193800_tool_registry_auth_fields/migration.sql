-- WO-023: tool_registry gains type/base_url/auth_type (the fields the
-- ToolRegistryService actually validates and persists) and drops the
-- unused spec_url placeholder column from the original scaffolding.
-- description becomes nullable/optional per this WO's own field spec.
-- Table has no production data yet (pre-launch), so no backfill/default
-- is needed for the new NOT NULL columns.
ALTER TABLE "tool_registry"
  DROP COLUMN "spec_url",
  ADD COLUMN "type" TEXT NOT NULL,
  ADD COLUMN "base_url" TEXT NOT NULL,
  ADD COLUMN "auth_type" TEXT NOT NULL,
  ALTER COLUMN "description" DROP NOT NULL;
