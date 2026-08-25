import { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetPlanQueryKey,
  getGetProjectBudgetQueryKey,
  getGetProjectQueryKey,
  getGetReportAggregatesQueryKey,
  getGetUserEffectiveAccessQueryKey,
  getGetUserQueryKey,
  getListPlansQueryKey,
  getListProjectsQueryKey,
  getListReportsQueryKey,
  getListRisksQueryKey,
} from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import {
  invalidateDomainEventQueries,
  invalidateLegacyModuleEventQueries,
  invalidateRealtimeCatchupQueries,
  parseDomainRealtimeEvent,
  queryKeysForDomainEvent,
  type DomainRealtimeEvent,
} from "@/lib/socket";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function event(entityType: DomainRealtimeEvent["entityType"], entityId = 12): DomainRealtimeEvent {
  return {
    version: 1,
    entityType,
    entityId,
    action: "updated",
    revision: 3,
    occurredAt: "2026-08-25T10:00:00.000Z",
  };
}

function invalidated(client: QueryClient, queryKey: readonly unknown[]): boolean {
  return client.getQueryState(queryKey)?.isInvalidated === true;
}

describe("realtime query invalidation registry", () => {
  it("validates canonical event metadata before changing a cache", () => {
    expect(parseDomainRealtimeEvent(event("project"))).toMatchObject({
      entityType: "project",
      entityId: 12,
    });
    expect(parseDomainRealtimeEvent({ ...event("project"), version: 2 })).toBeNull();
    expect(parseDomainRealtimeEvent({ ...event("project"), entityId: 0 })).toBeNull();
    expect(parseDomainRealtimeEvent({ ...event("project"), occurredAt: "not-a-date" })).toBeNull();
  });

  it("targets generated project detail/list, budget, dashboard and archive keys", () => {
    const client = makeClient();
    const listKey = getListProjectsQueryKey({ status: "active" });
    const detailKey = getGetProjectQueryKey(12);
    const budgetKey = getGetProjectBudgetQueryKey(12);
    const dashboardKey = getGetDashboardSummaryQueryKey({ stateId: 4 });
    const fileKey = ["files", "status=active"] as const;
    const documentsKey = ["project-documents", 12] as const;
    const reportKpisKey = ["project-report-kpis", 12] as const;
    const hierarchyKey = ["hierarchical-performance", { stateId: 4 }] as const;
    const unrelated = ["ai-settings"] as const;
    for (const key of [
      listKey, detailKey, budgetKey, dashboardKey, fileKey,
      documentsKey, reportKpisKey, hierarchyKey, unrelated,
    ]) {
      client.setQueryData(key, { cached: true });
    }

    invalidateDomainEventQueries(client, event("project"));

    expect(invalidated(client, listKey)).toBe(true);
    expect(invalidated(client, detailKey)).toBe(true);
    expect(invalidated(client, budgetKey)).toBe(true);
    expect(invalidated(client, dashboardKey)).toBe(true);
    expect(invalidated(client, fileKey)).toBe(true);
    expect(invalidated(client, documentsKey)).toBe(true);
    expect(invalidated(client, reportKpisKey)).toBe(true);
    expect(invalidated(client, hierarchyKey)).toBe(true);
    expect(invalidated(client, unrelated)).toBe(false);
  });

  it("covers the generated and custom detail/list variants for reports, plans and risks", () => {
    const client = makeClient();
    const reportList = getListReportsQueryKey({ reportType: "project" });
    const reportAggregate = getGetReportAggregatesQueryKey(12);
    const reportComments = ["comments", "report", 12] as const;
    const planList = getListPlansQueryKey({ status: "draft" });
    const planDetail = getGetPlanQueryKey(12);
    const planComments = ["comments", "plan", 12] as const;
    const riskList = getListRisksQueryKey({ stateId: 4 });
    const riskHistory = ["risk-history", 12] as const;
    for (const key of [
      reportList, reportAggregate, reportComments,
      planList, planDetail, planComments,
      riskList, riskHistory,
    ]) client.setQueryData(key, { cached: true });

    invalidateDomainEventQueries(client, event("report"));
    invalidateDomainEventQueries(client, event("plan"));
    invalidateDomainEventQueries(client, event("risk"));

    for (const key of [
      reportList, reportAggregate, reportComments,
      planList, planDetail, planComments,
      riskList, riskHistory,
    ]) expect(invalidated(client, key)).toBe(true);
  });

  it("uses the real query namespaces rather than obsolete module-name prefixes", () => {
    const keys = queryKeysForDomainEvent(event("project"));
    expect(keys).toContainEqual(getListProjectsQueryKey());
    expect(keys).toContainEqual(getGetProjectQueryKey(12));
    expect(keys).toContainEqual(getGetProjectBudgetQueryKey(12));
    expect(keys).not.toContainEqual(["projects"]);
    expect(keys).not.toContainEqual(["dashboard"]);
  });

  it("refreshes user detail and access-inspector keys from a legacy user event", () => {
    const client = makeClient();
    const detail = getGetUserQueryKey(7);
    const access = getGetUserEffectiveAccessQueryKey(7);
    client.setQueryData(detail, { cached: true });
    client.setQueryData(access, { cached: true });

    invalidateLegacyModuleEventQueries(client, {
      module: "users",
      action: "updated",
      entityId: 7,
    });

    expect(invalidated(client, detail)).toBe(true);
    expect(invalidated(client, access)).toBe(true);
  });

  it("catches up only operational, communication and recipient-private cached views", () => {
    const client = makeClient();
    const projects = getListProjectsQueryKey({ status: "draft" });
    const projectDetail = getGetProjectQueryKey(12);
    const projectBudget = getGetProjectBudgetQueryKey(12);
    const projectDocuments = ["project-documents", 12] as const;
    const planDetail = getGetPlanQueryKey(12);
    const reportAggregates = getGetReportAggregatesQueryKey(12);
    const riskHistory = ["risk-history", 12] as const;
    const conversations = ["conversations", "all", ""] as const;
    const notification = ["notifications", 44, "bell"] as const;
    const unrelated = ["manual", "chapters", "en"] as const;
    for (const key of [
      projects, projectDetail, projectBudget, projectDocuments,
      planDetail, reportAggregates, riskHistory,
      conversations, notification, unrelated,
    ]) {
      client.setQueryData(key, { cached: true });
    }

    invalidateRealtimeCatchupQueries(client, 44);

    expect(invalidated(client, projects)).toBe(true);
    expect(invalidated(client, projectDetail)).toBe(true);
    expect(invalidated(client, projectBudget)).toBe(true);
    expect(invalidated(client, projectDocuments)).toBe(true);
    expect(invalidated(client, planDetail)).toBe(true);
    expect(invalidated(client, reportAggregates)).toBe(true);
    expect(invalidated(client, riskHistory)).toBe(true);
    expect(invalidated(client, conversations)).toBe(true);
    expect(invalidated(client, notification)).toBe(true);
    expect(invalidated(client, unrelated)).toBe(false);
  });
});