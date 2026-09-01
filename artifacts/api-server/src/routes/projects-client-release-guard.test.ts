/**
 * PROJ-RELEASE-GUARD — pooled DB client is released exactly once per request.
 *
 * POST /projects, PATCH /projects/:projectId, and POST
 * /projects/:projectId/merge each open a pooled client and correctly release
 * it in a `finally` block — but several early-validation branches used to
 * ALSO call `client.release()` before `return`ing. pg-pool throws
 * ("Release called on client which has already been released to the pool")
 * on the second release, and since Express 4 does not await async route
 * handlers, that throw becomes an unhandled promise rejection — which
 * crashes the whole process on Node's default unhandledRejection behaviour.
 * This meant an ordinary validation failure (negative budget, duplicate
 * sector, invalid date range, etc.) could take down the API.
 *
 * These sentinels read the live source and assert `client.release()`
 * appears exactly once in each handler — the single call inside its own
 * `finally` block — so an early release can never be reintroduced silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "projects.ts"), "utf8");

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = SRC.indexOf(startMarker);
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start + startMarker.length);
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

/** Drop `//`-comment lines so a "deliberately omitted" note mentioning the
 * literal text `client.release()` isn't counted as an actual call. */
function countReleaseCalls(handler: string): number {
  const codeOnly = handler
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return (codeOnly.match(/client\.release\(\)/g) ?? []).length;
}

describe("PROJ-RELEASE-GUARD — single client.release() per handler", () => {
  it("POST /projects releases the pooled client exactly once (in its finally block)", () => {
    const handler = sliceBetween(
      'router.post("/projects", requirePerm("projects.create")',
      'router.get("/projects/duplicate-check"',
    );
    expect(countReleaseCalls(handler)).toBe(1);
  });

  it("POST /projects/:projectId/merge releases the pooled client exactly once (in its finally block)", () => {
    const handler = sliceBetween(
      'router.post("/projects/:projectId/merge"',
      'router.get("/projects/:projectId"',
    );
    expect(countReleaseCalls(handler)).toBe(1);
  });

  it("PATCH /projects/:projectId releases the pooled client exactly once (in its finally block)", () => {
    const handler = sliceBetween(
      'router.patch("/projects/:projectId", requirePerm("projects.update")',
      'router.post("/projects/:projectId/transitions"',
    );
    expect(countReleaseCalls(handler)).toBe(1);
  });
});
