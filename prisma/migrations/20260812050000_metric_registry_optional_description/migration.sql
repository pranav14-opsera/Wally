-- WO-024: metric_registry.description becomes nullable/optional, matching
-- this WO's own database_changes spec ("description (text, nullable)") —
-- same rationale as WO-023's identical fix for tool_registry.
ALTER TABLE "metric_registry" ALTER COLUMN "description" DROP NOT NULL;
