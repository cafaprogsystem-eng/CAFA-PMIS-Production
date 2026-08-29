import { describe, expect, it } from "vitest";
import { shouldSignalSessionExpiry } from "@/lib/offline/fetch-interceptor";

describe("expired-session response boundary", () => {
  it("signals only authenticated staff-route 401 responses", () => {
    expect(shouldSignalSessionExpiry("/api/projects", 401)).toBe(true);
    expect(shouldSignalSessionExpiry("/api/notifications?limit=30", 401)).toBe(true);
    expect(shouldSignalSessionExpiry("/api/me", 401)).toBe(false);
    expect(shouldSignalSessionExpiry("/api/auth/login", 401)).toBe(false);
    expect(shouldSignalSessionExpiry("/api/projects", 403)).toBe(false);
  });
});