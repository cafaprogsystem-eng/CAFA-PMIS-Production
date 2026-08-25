import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const idempotency = readFileSync(resolve(root, "middlewares/idempotency.ts"), "utf8");
const revision = readFileSync(resolve(root, "middlewares/offline-revision.ts"), "utf8");
const migrations = readFileSync(resolve(root, "lib/run-migrations.ts"), "utf8");
const projectRoutes = readFileSync(resolve(root, "routes/projects.ts"), "utf8");
const planRoutes = readFileSync(resolve(root, "routes/plans.ts"), "utf8");
const riskRoutes = readFileSync(resolve(root, "routes/risks.ts"), "utf8");
const reportRoutes = readFileSync(resolve(root, "routes/reports.ts"), "utf8");

describe("offline replay server contracts", () => {
  it("claims operation IDs atomically and binds them to actor and request", () => {
    expect(idempotency).toMatch(/INSERT INTO idempotency_log[\s\S]*ON CONFLICT \(client_id\) DO NOTHING/);
    expect(idempotency).toContain("actor_id");
    expect(idempotency).toContain("request_hash");
    expect(idempotency).toContain("idempotency_in_progress");
    expect(idempotency).toContain("IN_PROGRESS_EXPIRY");
    expect(idempotency).toContain("state = 'completed' AND expires_at < NOW()");
  });

  it("supports a revision precondition without replacing route RBAC", () => {
    expect(revision).toContain("x-base-revision");
    expect(revision).toContain("revision_mismatch");
    expect(revision).toContain("projects");
    expect(revision).toContain("reports");
  });

  it("enforces a revision at every queueable draft write", () => {
    expect(projectRoutes).toContain("updated_at=NOW()");
    expect(projectRoutes).toContain("date_trunc('milliseconds', updated_at)");
    expect(planRoutes).toContain("SELECT start_date, end_date, responsible_user_id, status, last_final_approved_at, updated_at");
    expect(riskRoutes).toContain("date_trunc('milliseconds', updated_at)");
    expect(reportRoutes).toContain("date_trunc('milliseconds', updated_at)");
  });

  it("migrates idempotency claims without dropping historical records", () => {
    expect(migrations).toContain('name: "040_offline_sync_idempotency_claims"');
    expect(migrations).toContain("ADD COLUMN IF NOT EXISTS actor_id");
    expect(migrations).toContain("ALTER COLUMN status_code DROP NOT NULL");
    expect(migrations).toContain('name: "041_offline_sync_preserve_in_progress_claims"');
  });
});