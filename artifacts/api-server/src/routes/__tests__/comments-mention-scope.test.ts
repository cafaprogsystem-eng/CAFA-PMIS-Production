/**
 * COMMENTS-MENTION-SCOPE — @mention in comments used to resolve any
 * `@username` in the comment body against ALL active users org-wide, with no
 * check that the mentioned person actually has any relationship to (or view
 * authority over) the entity being commented on. A state officer commenting
 * on a report in their own state could @mention any username they could
 * guess/enumerate — including a Technical Coordinator scoped to a different
 * sector — and that person would receive a notification carrying the
 * entity's real type/id and a working deep link, disclosing its existence to
 * someone never authorised to view it.
 *
 * Fixed by routing every resolved username through
 * authorizedMentionRecipientIds(), which only returns users who pass the
 * SAME visibility rule that gates a direct GET of the entity: org-wide roles
 * (everyone except technical_coordinator and state_program_officer/
 * state_office_manager) always qualify; a technical_coordinator only
 * qualifies when the entity's sector is in their own sector list; a state
 * role only qualifies when the entity's state matches their own stateId.
 * Mirrors routes/conversations.ts's own mention-validation principle
 * ("Never resolve identities from text").
 *
 * Uses source-inspection for the route wiring (the established pattern for
 * comments.ts — see risk-comments-closure.test.ts) plus a direct behavioural
 * test of the exported authorizedMentionRecipientIds against a mocked pool.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../comments.ts"), "utf8");

describe("COMMENTS-MENTION-SCOPE: the naive org-wide username lookup is gone", () => {
  it("no longer resolves @mentions against every active user with zero entity-scope check", () => {
    expect(SRC).not.toContain("SELECT id FROM users WHERE username = ANY($1::text[]) AND status = 'active' AND id != $2");
  });

  it("the mention block now calls authorizedMentionRecipientIds instead", () => {
    const mentionBlock = SRC.slice(SRC.indexOf("mentionMatches.length > 0"), SRC.indexOf("res.status(201)"));
    expect(mentionBlock).toContain("await authorizedMentionRecipientIds(entityType, entityId, usernames, req.currentUser.id)");
    expect(mentionBlock).not.toContain("pool.query");
  });
});

describe("COMMENTS-MENTION-SCOPE: authorizedMentionRecipientIds encodes the same view-scope rule for every entity type", () => {
  const fnSrc = SRC.slice(
    SRC.indexOf("export async function authorizedMentionRecipientIds"),
    SRC.indexOf("router.get(", SRC.indexOf("export async function authorizedMentionRecipientIds")),
  );

  it("org-wide roles (everyone except TC and SPO/SOM) always qualify", () => {
    const occurrences = [...fnSrc.matchAll(/u\.role NOT IN \('technical_coordinator', 'state_program_officer', 'state_office_manager'\)/g)];
    expect(occurrences.length).toBe(1); // defined once (ORG_WIDE_CLAUSE), reused for all 4 entity types
  });

  it("technical_coordinator qualifies only when the entity's sector is in their own trimmed sector list", () => {
    const occurrences = [...fnSrc.matchAll(/u\.role = 'technical_coordinator'/g)];
    expect(occurrences.length).toBe(1); // SECTOR_CLAUSE helper, reused for all 4 entity types
    expect(fnSrc).toContain("unnest(string_to_array(u.sector, ','))");
    expect(fnSrc).toContain("trim(seg.val)");
  });

  it("project: SPO/SOM qualify via project_states, matching projectScopeSql's own join", () => {
    expect(fnSrc).toContain("EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = u.state_id)");
  });

  it("report: SPO/SOM qualify via reports.state_id, and TC sector uses the canonical project/activity/effective-sector CASE", () => {
    const reportBlock = fnSrc.slice(fnSrc.indexOf('entityType === "report"'), fnSrc.indexOf('entityType === "plan"'));
    expect(reportBlock).toContain("WHEN r.report_type = 'project' THEN p.sector");
    expect(reportBlock).toContain("WHEN r.report_type = 'activity' THEN CASE WHEN r.project_id IS NULL THEN act.sector ELSE p.sector END");
    expect(reportBlock).toContain("u.state_id = rc.state_id");
  });

  it("plan: SPO/SOM qualify via plans.state_id, excluding HQ-scoped plans", () => {
    const planBlock = fnSrc.slice(fnSrc.indexOf('entityType === "plan"'), fnSrc.indexOf('entityType === "risk"'));
    expect(planBlock).toContain("pl.location_type IS DISTINCT FROM 'hq'");
    expect(planBlock).toContain("u.state_id = pl.state_id");
  });

  it("risk: standalone (no project) risks have no sector to match — only org-wide roles or a state match qualify", () => {
    const riskBlock = fnSrc.slice(fnSrc.indexOf('entityType === "risk"'));
    expect(riskBlock).toContain("RISK-BD-07");
    expect(riskBlock).toContain("LEFT JOIN projects p ON p.id = r.project_id");
    expect(riskBlock).toContain("u.state_id = r.state_id");
  });
});

describe("COMMENTS-MENTION-SCOPE: authorizedMentionRecipientIds behaviour against a mocked pool", () => {
  const mockPoolQuery = vi.fn();
  vi.doMock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("returns the ids pool.query resolves, and forwards entityId/usernames/excludeUserId in that order", async () => {
    const { authorizedMentionRecipientIds } = await import("../comments");
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 42 }, { id: 43 }] });

    const ids = await authorizedMentionRecipientIds("report", 7, ["alice", "bob"], 99);

    expect(ids).toEqual([42, 43]);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7, ["alice", "bob"], 99]);
  });

  it("returns an empty list for an unrecognised entity type without querying the database", async () => {
    const { authorizedMentionRecipientIds } = await import("../comments");
    const ids = await authorizedMentionRecipientIds("unknown-entity", 1, ["alice"], 99);
    expect(ids).toEqual([]);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
