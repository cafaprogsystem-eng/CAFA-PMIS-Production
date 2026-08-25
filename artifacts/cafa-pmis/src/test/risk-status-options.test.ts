/**
 * Risk Edit Status Parity sentinels.
 * RISK-STATUS-01 through RISK-STATUS-10
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CreateRiskBody, UpdateRiskBody } from "@workspace/api-zod";
import enRisks from "@/locales/en/risks.json";
import arRisks from "@/locales/ar/risks.json";
import {
  RISK_STATUS_OPTIONS,
  RISK_STATUS_VALUES,
  formatRiskStatus,
} from "@/lib/risk-statuses";

const CANONICAL_STATUSES = [
  "open",
  "under_mitigation",
  "closed",
  "identified",
  "assigned",
  "mitigation_plan",
  "follow_up",
  "escalation",
  "mitigated",
] as const;

const risksPage = readFileSync("src/pages/risks.tsx", "utf8");
const risksRoute = readFileSync("../api-server/src/routes/risks.ts", "utf8");

describe("Risk Edit Status Parity", () => {
  it("RISK-STATUS-01: frontend Edit values exactly match the canonical API set", () => {
    expect(RISK_STATUS_VALUES).toEqual(CANONICAL_STATUSES);
    expect(UpdateRiskBody.shape.status.unwrap().options).toEqual(CANONICAL_STATUSES);
  });

  it("RISK-STATUS-02: Create has no editable Status field and sends no status override", () => {
    expect(risksPage).not.toContain("create-status");
    expect(CreateRiskBody.shape).not.toHaveProperty("status");
    expect(risksPage).toContain("CreateRiskBody.parse(cleaned)");
    const createRoute = risksRoute.slice(
      risksRoute.indexOf('router.post("/risks"'),
      risksRoute.indexOf('router.patch("/risks/'),
    );
    expect(createRoute).toMatch(/INSERT INTO risks[\s\S]*'open'/);
  });

  it("RISK-STATUS-03: Edit renders every supported status option", () => {
    expect(risksPage).toContain("RISK_STATUS_OPTIONS.map((option)");
    expect(RISK_STATUS_OPTIONS).toHaveLength(CANONICAL_STATUSES.length);
  });

  it("RISK-STATUS-04: the shared Edit options do not apply transition filtering", () => {
    expect(RISK_STATUS_OPTIONS.map((option) => option.value)).toEqual(CANONICAL_STATUSES);
    expect(risksPage).not.toMatch(/RISK_STATUS_OPTIONS\.filter/);
  });

  it("RISK-STATUS-05: a closed risk can be changed to another supported status", () => {
    expect(RISK_STATUS_VALUES).toContain("closed");
    expect(RISK_STATUS_VALUES).toContain("open");
  });

  it("RISK-STATUS-06: a mitigated risk can be changed to another supported status", () => {
    expect(RISK_STATUS_VALUES).toContain("mitigated");
    expect(RISK_STATUS_VALUES).toContain("under_mitigation");
  });

  it("RISK-STATUS-07: every option has clear English and Arabic labels", () => {
    for (const option of RISK_STATUS_OPTIONS) {
      expect(enRisks.status[option.value]).toMatch(/\S/);
      expect(arRisks.status[option.value]).toMatch(/\S/);
      expect(option.fallback).not.toContain("_");
    }
    expect(formatRiskStatus("future_status")).toBe("Future Status");
  });

  it("RISK-STATUS-08: PATCH preserves the selected raw canonical enum", () => {
    const selected = "mitigation_plan";
    expect(UpdateRiskBody.parse({ status: selected }).status).toBe(selected);
    expect(risksPage).toContain('form.setValue("status", v)');
    expect(risksPage).toContain("UpdateRiskBody.parse(cleaned)");
  });

  it("RISK-STATUS-09: existing Edit permission and scope gates remain in place", () => {
    expect(risksPage).toContain('hasPerm(me?.permissions as string[], "risks.update")');
    expect(risksPage).toContain("{canUpdate && (");
  });

  it("RISK-STATUS-10: Edit stays within the existing frontend/API contract boundary", () => {
    expect(risksPage).toContain('from "@/lib/risk-statuses"');
    expect(risksPage).toContain('import { CreateRiskBody, UpdateRiskBody } from "@workspace/api-zod"');
    expect(UpdateRiskBody.shape.status.unwrap().options).toEqual(CANONICAL_STATUSES);
  });
});