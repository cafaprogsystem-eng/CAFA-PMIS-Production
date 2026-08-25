import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEGACY_NOTIFICATION_KIND_ALIASES,
  NOTIFICATION_KIND_REGISTRY,
  presentNotificationKind,
} from "./notifications";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const route = (name: string) => source(`../routes/${name}.ts`);

/**
 * NOTIF-CALLER sentinels deliberately inspect the production producer surface.
 * They protect the boundary between route-specific event construction and the
 * centrally enforced notification delivery contract.
 */
describe("NOTIF-CALLER: caller and taxonomy contract", () => {
  it("NOTIF-CALLER-01: the current producer taxonomy is fully registered", () => {
    const currentProducerKinds = [
      "system", "message", "mention", "comment_added", "comment_replied",
      "review_requested", "submitted", "resubmitted", "technically_reviewed",
      "coordination_reviewed", "approved", "rejected", "returned", "activated",
      "closed", "started", "delayed", "completed", "cancelled", "archived",
      "reopened", "project_created", "project_assigned", "plan_assigned",
      "risk_assigned", "document_uploaded", "risk_created", "risk_updated",
      "risk_high", "risk_critical", "risk_status_changed",
      "risk_severity_downgraded", "budget_high", "budget_exceeded",
      "password_changed", "email_verified",
      "risk_due_7d", "risk_due_3d", "risk_due_1d", "risk_overdue",
      "project_due_7d", "project_due_3d", "project_due_1d", "project_overdue",
      "plan_due_7d", "plan_due_3d", "plan_due_1d", "plan_overdue",
      "activity_due_7d", "activity_due_3d", "activity_due_1d", "activity_overdue",
    ];

    for (const kind of currentProducerKinds) {
      expect(NOTIFICATION_KIND_REGISTRY, `${kind} must have a delivery policy`).toHaveProperty(kind);
    }
    expect(route("reports")).toContain('technical_review: "technically_reviewed"');
    expect(route("reports")).not.toContain('technical_review: "technically_approved"');
  });

  it("NOTIF-CALLER-02: risk events identify the risk and use project actors only as recipients", () => {
    const risks = route("risks");
    expect(risks).toContain('entityType: "risk",\n        entityId: id,\n        recipientEntityType: "project"');
    expect(risks).toContain('entityType: "risk",\n        entityId: riskId,\n        recipientEntityType: "project"');
    expect(risks).toContain("exceptUserId: req.currentUser?.id ?? null");
    expect(risks).toContain("risk-assignment:");
  });

  it("NOTIF-CALLER-03: direct notification-table writes are centralised", () => {
    const producerFiles = ["auth", "comments", "conversations", "projects", "plans", "reports", "risks"]
      .map(route)
      .join("\n");
    expect(producerFiles).not.toMatch(/INSERT\s+INTO\s+notifications/i);
    expect(source("./notifications.ts")).toMatch(/INSERT\s+INTO\s+notifications/i);
  });

  it("NOTIF-CALLER-04: notification links remain internal application routes", () => {
    const producerFiles = ["auth", "comments", "conversations", "projects", "plans", "reports", "risks"]
      .map(route)
      .join("\n");
    expect(producerFiles).not.toMatch(/link:\s*["']https?:\/\//);
    expect(producerFiles).toContain("reportDeepLink");
  });

  it("NOTIF-CALLER-05: conversation event identities remain distinct", () => {
    const conversations = route("conversations");
    expect(conversations).toContain('kind: "message"');
    expect(conversations).toContain('kind: "mention"');
    expect(conversations).toContain("conversation-message:");
    expect(conversations).toContain("conversation-message-mention:");
    expect(conversations).toContain("conversation-message-pin:");
    expect(conversations).toContain("conversation-announcement:");
  });

  it("NOTIF-CALLER-06: retry keys preserve distinct workflow transitions", () => {
    for (const name of ["projects", "plans", "reports"] as const) {
      const producer = route(name);
      expect(producer).toContain("transition:");
      expect(producer).toContain("dedupeKey:");
    }
    expect(route("comments")).toContain("comment-event:");
    expect(route("comments")).toContain("comment-mention:");
  });

  it("NOTIF-CALLER-07: legacy stored aliases remain readable without rewriting storage", () => {
    expect(LEGACY_NOTIFICATION_KIND_ALIASES.technically_approved).toBe("technically_reviewed");
    expect(presentNotificationKind("technically_approved")).toBe("technically_reviewed");
    expect(presentNotificationKind("historical_unknown_kind")).toBe("historical_unknown_kind");
  });
});