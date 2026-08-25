/**
 * Risk Register Final Visual Closure sentinels.
 *
 * RISK-FINAL-VIS-01 through RISK-FINAL-VIS-12 reconcile the Phase 1–3 visual
 * work with the Edit status-parity and functional-security closure contracts.
 * These assertions intentionally test user-visible behaviour and protected
 * boundaries rather than cosmetic class-count snapshots.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRiskRegisterLocation, parseRiskRegisterState } from "@/pages/risks";
import { RISK_STATUS_VALUES } from "@/lib/risk-statuses";

const risksPage = readFileSync("src/pages/risks.tsx", "utf8");
const commentsPanel = readFileSync("src/components/comments-panel.tsx", "utf8");
const attachmentsPanel = readFileSync("src/components/drive-attachment-panel.tsx", "utf8");
const commentsRoute = readFileSync("../api-server/src/routes/comments.ts", "utf8");
const attachmentsRoute = readFileSync("../api-server/src/routes/attachments.ts", "utf8");
const risksRoute = readFileSync("../api-server/src/routes/risks.ts", "utf8");

describe("Risk Register final visual closure", () => {
  it("RISK-FINAL-VIS-01: Register preserves the compact, semantic baseline", () => {
    expect(risksPage).toContain('className="space-y-4"');
    expect(risksPage).toContain("risksRaw?.summary");
    expect(risksPage).toContain('title={r.title}');
    expect(risksPage).toContain('role="region" aria-label={t("common:risksPage.registerLabel")}');
  });

  it("RISK-FINAL-VIS-02: pagination and URL state remain shareable and recoverable", () => {
    const state = parseRiskRegisterState("/risks?search=water&page=3&riskLevel=high");
    expect(state).toMatchObject({ search: "water", page: 3, riskLevel: "high" });
    expect(buildRiskRegisterLocation("/risks?page=3&riskLevel=high", { page: 1 }))
      .toBe("/risks?riskLevel=high");
    expect(risksPage).toContain("limit = DEFAULT_LIMIT");
    expect(risksPage).toContain("updateRegisterState({ page: 1 }, true)");
  });

  it("RISK-FINAL-VIS-03: every Register row remains keyboard-operable", () => {
    expect(risksPage).toContain('role="button"');
    expect(risksPage).toContain("tabIndex={0}");
    expect(risksPage).toContain('event.key === "Enter" || event.key === " "');
    expect(risksPage).toContain('t("accessibility.openRisk"');
  });

  it("RISK-FINAL-VIS-04: Create remains responsive and server-owned as open", () => {
    expect(risksPage).toContain("max-w-2xl max-h-[90vh] overflow-y-auto");
    expect(risksPage).toContain('grid gap-3 sm:grid-cols-2');
    expect(risksPage).not.toContain("create-status");
    expect(risksPage).toContain("CreateRiskBody.parse(cleaned)");
    const createRoute = risksRoute.slice(
      risksRoute.indexOf('router.post("/risks"'),
      risksRoute.indexOf('router.patch("/risks/'),
    );
    expect(createRoute).toMatch(/INSERT INTO risks[\s\S]*'open'/);
  });

  it("RISK-FINAL-VIS-05: Edit presents all nine direct status values without filtering", () => {
    expect(RISK_STATUS_VALUES).toHaveLength(9);
    expect(risksPage).toContain("RISK_STATUS_OPTIONS.map((option)");
    expect(risksPage).not.toMatch(/RISK_STATUS_OPTIONS\.filter/);
    expect(risksPage).toContain('form.setValue("status", v)');
  });

  it("RISK-FINAL-VIS-06: Edit keeps explicit null clears for assignee and due date", () => {
    expect(risksPage).toContain("cleaned.assignedToId = values.assignedToId ?? null");
    expect(risksPage).toContain("cleaned.dueDate = values.dueDate ? values.dueDate : null");
  });

  it("RISK-FINAL-VIS-07: Detail is a semantic read view with safe context and wrapping", () => {
    expect(risksPage).toContain('<dl className="grid gap-x-6 gap-y-4 text-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">');
    expect(risksPage).toContain('t("projectRemoved"');
    expect(risksPage).toContain("whitespace-pre-wrap break-words");
    expect(risksPage).toContain('overflow-x-auto pb-1');
  });

  it("RISK-FINAL-VIS-08: Risk enums are formatted rather than CSS-capitalised", () => {
    expect(risksPage).toContain("function displayCategory(");
    expect(risksPage).toContain("function displayImpact(");
    expect(risksPage).toContain("function displayRiskLevel(");
    expect(risksPage).toContain('t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) })');
    expect(risksPage).not.toContain('className="capitalize"');
  });

  it("RISK-FINAL-VIS-09: Comments retain authorised actions and readable failure states", () => {
    expect(commentsPanel).toContain("whitespace-pre-wrap break-words");
    expect(commentsPanel).toContain('t("comments.loadFailed")');
    expect(commentsPanel).toContain('aria-label={t("comments.delete")}');
    expect(commentsRoute).toContain('entityType === "risk" && hasPerm(perms, "risks.update")');
  });

  it("RISK-FINAL-VIS-10: Evidence uses secured downloads without storage leakage", () => {
    expect(attachmentsPanel).toContain("`/api/attachments/${file.id}/${action}`");
    expect(attachmentsPanel).toContain('aria-label={t("driveAttachment.downloadFile")}');
    const tableRows = attachmentsPanel.slice(
      attachmentsPanel.indexOf("{files.map((file) => <TableRow"),
      attachmentsPanel.indexOf("</TableBody>"),
    );
    expect(tableRows).not.toContain("file.driveFileId");
    expect(tableRows).not.toContain("file.driveLink");
    expect(attachmentsRoute).toContain('router.get("/risks/:riskId/attachments"');
    expect(attachmentsRoute).toContain('parentType === "risk"');
  });

  it("RISK-FINAL-VIS-11: History and narrow surfaces protect long content", () => {
    expect(risksPage).toContain("formatDateTime(h.createdAt)");
    expect(risksPage).toContain('value.startsWith("{") || value.startsWith("[")');
    expect(risksPage).toContain('className="font-medium break-words"');
    expect(attachmentsPanel).toContain("overflow-x-auto rounded-md border");
  });

  it("RISK-FINAL-VIS-12: visual presentation leaves functional and API boundaries intact", () => {
    expect(risksPage).toContain('import { CreateRiskBody, UpdateRiskBody } from "@workspace/api-zod"');
    expect(risksPage).toContain("UpdateRiskBody.parse(cleaned)");
    expect(risksPage).toContain('entityType="risk"');
    expect(risksPage).toContain('module="risks"');
    expect(risksRoute).toContain('router.patch("/risks/:riskId"');
  });
});