-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('integration', 'validation', 'load_testing', 'api_lifecycle');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'manager', 'viewer');

-- CreateEnum
CREATE TYPE "SloVerdict" AS ENUM ('pass', 'fail');

-- CreateEnum
CREATE TYPE "DriftType" AS ENUM ('value_mismatch', 'missing_metric', 'threshold_exceeded');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'viewer',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_type" "AgentType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "input_params" JSONB NOT NULL,
    "result_summary" JSONB,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "total_steps" INTEGER NOT NULL,
    "error_message" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_steps" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "step_order" INTEGER NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'pending',
    "input_data" JSONB,
    "output_data" JSONB,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_registry" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "spec_url" TEXT,
    "endpoints" JSONB NOT NULL,
    "credential_ref" TEXT,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "last_health_check" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_registry" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_query" TEXT NOT NULL,
    "dashboard_ref" TEXT,
    "thresholds" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_registry" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_registry" (
    "id" UUID NOT NULL,
    "api_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "spec_content" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spec_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "change_details" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_events" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,
    "source_value" DOUBLE PRECISION NOT NULL,
    "dashboard_value" DOUBLE PRECISION NOT NULL,
    "drift_type" "DriftType" NOT NULL,
    "affected_records" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drift_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_test_results" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "profile_config" JSONB NOT NULL,
    "p50_latency_ms" DOUBLE PRECISION NOT NULL,
    "p95_latency_ms" DOUBLE PRECISION NOT NULL,
    "p99_latency_ms" DOUBLE PRECISION NOT NULL,
    "throughput_rps" DOUBLE PRECISION NOT NULL,
    "error_rate_pct" DOUBLE PRECISION NOT NULL,
    "slo_verdict" "SloVerdict" NOT NULL,
    "raw_metrics" JSONB NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "load_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "agent_jobs_agent_type_status_created_at_idx" ON "agent_jobs"("agent_type", "status", "created_at");

-- CreateIndex
CREATE INDEX "agent_jobs_user_id_created_at_idx" ON "agent_jobs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_steps_job_id_step_order_key" ON "job_steps"("job_id", "step_order");

-- CreateIndex
CREATE UNIQUE INDEX "tool_registry_name_key" ON "tool_registry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "metric_registry_name_key" ON "metric_registry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "config_registry_key_key" ON "config_registry"("key");

-- CreateIndex
CREATE UNIQUE INDEX "spec_registry_api_name_version_key" ON "spec_registry"("api_name", "version");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "drift_events_job_id_metric_id_idx" ON "drift_events"("job_id", "metric_id");

-- CreateIndex
CREATE INDEX "load_test_results_job_id_idx" ON "load_test_results"("job_id");

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "agent_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "agent_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metric_registry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_test_results" ADD CONSTRAINT "load_test_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "agent_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

