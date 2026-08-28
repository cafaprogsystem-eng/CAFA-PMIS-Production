import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const openapi = readFileSync(
  fileURLToPath(new URL("../../../../../lib/api-spec/openapi.yaml", import.meta.url)),
  "utf8",
);
const operation = openapi.slice(
  openapi.indexOf("  /dashboard/state-performance:"),
  openapi.indexOf("\n  /dashboard/notifications-summary:"),
);

describe("state-performance API contract", () => {
  it("documents exactly the supported state and sector query filters", () => {
    expect(operation).toContain("name: stateId");
    expect(operation).toContain("name: sector");
    expect(operation).not.toContain("name: donor");
    expect(operation).not.toContain("name: dateFrom");
    expect(operation).not.toContain("name: dateTo");
  });
});