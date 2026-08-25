import { describe, expect, it } from "vitest";
import { assertSafeLandingCaptureHost } from "../../e2e/landing-capture-safety";

describe("Landing screenshot capture host policy", () => {
  it("permits localhost as the explicit development-only capture target", () => {
    expect(() => assertSafeLandingCaptureHost("http://127.0.0.1:80", undefined)).not.toThrow();
  });

  it("permits an exact HTTPS non-production host only when configured", () => {
    expect(() => assertSafeLandingCaptureHost(
      "https://preview-123.replit.dev",
      "preview-123.replit.dev",
    )).not.toThrow();
  });

  it("rejects an unconfigured routed host instead of inferring it is safe", () => {
    expect(() => assertSafeLandingCaptureHost(
      "https://preview-123.replit.dev",
      undefined,
    )).toThrow(/E2E_LANDING_ALLOWED_HOSTS/);
  });

  it("rejects deployment hosts even when an operator mistakenly allowlists one", () => {
    expect(() => assertSafeLandingCaptureHost(
      "https://cafa-pmis.replit.app",
      "cafa-pmis.replit.app",
    )).toThrow(/deployment hosts/);
  });

  it("rejects production-like custom hosts even when they are listed", () => {
    expect(() => assertSafeLandingCaptureHost(
      "https://production-preview.example.test",
      "production-preview.example.test",
    )).toThrow(/production hosts/);
  });
});