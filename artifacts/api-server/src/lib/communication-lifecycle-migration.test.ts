import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./run-migrations";

describe("Communication lifecycle membership migration", () => {
  const migration = MIGRATIONS.find(
    (entry) => entry.name === "033_communication_membership_write_integrity",
  );

  it("is tracked after the original lifecycle migration", () => {
    expect(migration).toBeDefined();
    expect(MIGRATIONS.findIndex((entry) => entry.name === "033_communication_membership_write_integrity"))
      .toBeGreaterThan(MIGRATIONS.findIndex((entry) => entry.name === "032_communication_lifecycle_integrity"));
  });

  it("locks and rejects future duplicate memberships without deleting legacy rows", () => {
    expect(migration?.sql).toContain("pg_advisory_xact_lock(NEW.conversation_id, NEW.user_id)");
    expect(migration?.sql).toContain("RAISE EXCEPTION 'duplicate conversation membership");
    expect(migration?.sql).toContain("BEFORE INSERT OR UPDATE OF conversation_id, user_id");
    expect(migration?.sql).not.toContain("DELETE FROM conversation_members");
  });
});