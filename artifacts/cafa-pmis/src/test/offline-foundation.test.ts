import { describe, expect, it } from "vitest";
import {
  explainOfflinePolicy,
  isAuthorisedOfflineRead,
  isQueueableDraftMutation,
} from "../lib/offline/policy";
import en from "../locales/en/common.json";
import ar from "../locales/ar/common.json";

describe("secure offline policy", () => {
  it("allows only reviewed reads and draft saves", () => {
    expect(isAuthorisedOfflineRead("/api/projects?stateId=1")).toBe(true);
    expect(isAuthorisedOfflineRead("/api/users")).toBe(false);
    expect(isQueueableDraftMutation("PATCH", "/api/reports/42", "{}")).toBe(true);
    expect(isQueueableDraftMutation("POST", "/api/reports/42/transitions", '{"action":"submit"}')).toBe(false);
    expect(isQueueableDraftMutation("DELETE", "/api/risks/42", null)).toBe(false);
    expect(isQueueableDraftMutation("PATCH", "/api/budget/42", "{}")).toBe(false);
  });

  it("has an explicit online-required outcome for sensitive actions", () => {
    expect(explainOfflinePolicy("POST", "/api/plans/3/transitions", '{"action":"approve"}')).toEqual({
      kind: "blocked",
      reason: "This action requires an internet connection",
    });
  });

  it("does not defer finance, attachments, or lifecycle fields from operational forms", () => {
    expect(isQueueableDraftMutation("POST", "/api/projects", '{"title":"Field work","budgetTotal":0}')).toBe(false);
    expect(isQueueableDraftMutation("POST", "/api/projects", '{"outputs":[{"activities":[{"budgetSpent":1}]}]}')).toBe(false);
    expect(isQueueableDraftMutation("PATCH", "/api/plans/3", '{"documents":[]}')).toBe(false);
    expect(isQueueableDraftMutation("PATCH", "/api/risks/3", '{"status":"closed"}')).toBe(false);
    expect(isQueueableDraftMutation("POST", "/api/risks", '{"title":"Road access","stateId":2}')).toBe(true);
  });
});

describe("offline status localisation", () => {
  for (const locale of [en, ar]) {
    it("contains every secure replay state", () => {
      expect(locale.sync.status["local-draft"]).toBeTruthy();
      expect(locale.sync.status.pending).toBeTruthy();
      expect(locale.sync.status.syncing).toBeTruthy();
      expect(locale.sync.status.synced).toBeTruthy();
      expect(locale.sync.status.failed).toBeTruthy();
      expect(locale.sync.status.conflict).toBeTruthy();
      expect(locale.sync.draftState["local-draft"]).toBeTruthy();
      expect(locale.sync.draftState.pending).toBeTruthy();
      expect(locale.sync.draftState.synced).toBeTruthy();
      expect(locale.sync.draftState.failed).toBeTruthy();
      expect(locale.sync.draftState.conflict).toBeTruthy();
      expect(locale.sync.internetRequired).toBeTruthy();
    });
  }
});