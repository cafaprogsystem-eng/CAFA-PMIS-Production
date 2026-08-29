import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  establishAuthenticatedSession,
  getAuthenticatedSessionSnapshot,
  invalidateAuthenticatedSession,
} from "@/lib/authenticated-session";
import { cacheAuthenticatedResponse } from "@/lib/offline/fetch-interceptor";
import { cacheKey, clearOfflineData, db } from "@/lib/offline/db";

describe("authenticated session cache generation", () => {
  beforeEach(async () => {
    invalidateAuthenticatedSession();
    await clearOfflineData();
  });

  afterEach(async () => {
    invalidateAuthenticatedSession();
    await clearOfflineData();
  });

  it("rejects a protected response captured before logout invalidated authority", async () => {
    establishAuthenticatedSession(44);
    const requestSession = getAuthenticatedSessionSnapshot();
    invalidateAuthenticatedSession();

    await cacheAuthenticatedResponse(
      "/api/projects",
      JSON.stringify([{ id: 9 }]),
      requestSession,
    );

    expect(await db.apiCache.get(cacheKey(44, "/api/projects"))).toBeUndefined();
  });

  it("persists a response only while its exact authenticated generation is current", async () => {
    establishAuthenticatedSession(44);
    const requestSession = getAuthenticatedSessionSnapshot();

    await cacheAuthenticatedResponse(
      "/api/projects",
      JSON.stringify([{ id: 9 }]),
      requestSession,
    );

    expect(await db.apiCache.get(cacheKey(44, "/api/projects"))).toMatchObject({
      userId: 44,
      url: "/api/projects",
    });
  });
});
