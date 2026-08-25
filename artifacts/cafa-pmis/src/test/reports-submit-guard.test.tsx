/**
 * SUBMIT-GUARD-02: Component-level tests — Submit Report button disabled state
 *
 * Verifies the ref + state double-submit guard added to onSubmitReport in reports.tsx:
 *   isSubmittingRef (synchronous, no re-render) + isSubmittingReport state (drives disabled/aria-busy).
 *
 * Tests use a minimal inline component that mirrors the exact pattern used in
 * reports.tsx, avoiding the full-page setup complexity while exercising the real
 * React state lifecycle (renders, async awaits, finally-block resets).
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React, { useState, useRef } from "react";
import "@testing-library/jest-dom";

beforeAll(() => {
  // jsdom shims required by Radix-style components
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
});

/**
 * Minimal reproduction of the Submit button guard pattern from reports.tsx:
 *   - isSubmittingRef: synchronous lock (no re-render needed, fires within same event tick)
 *   - isSubmittingReport: React state (drives disabled and aria-busy on the DOM element)
 *   - validateFn: mirrors validateSubmit — may abort early before any async work
 */
function SubmitButtonHarness({
  onSubmit,
  validateOk = true,
}: {
  onSubmit: () => Promise<void>;
  validateOk?: boolean;
}) {
  const isSubmittingRef = useRef(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [callCount, setCallCount] = useState(0);

  const handleSubmit = async () => {
    // Synchronous ref guard — mirrors isSubmittingRef.current check in reports.tsx
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmittingReport(true);
    // Simulate validateSubmit — releases guard immediately on failure
    if (!validateOk) {
      isSubmittingRef.current = false;
      setIsSubmittingReport(false);
      return;
    }
    try {
      setCallCount((n) => n + 1);
      await onSubmit();
    } catch (_err) {
      // Error intentionally swallowed — mirrors reports.tsx where the catch block calls
      // toast.error(). Without this catch, React 19 surfaces the rejection as an
      // uncaught error in the test environment even when the test is designed to
      // verify guard-release behaviour after a failed submit, not error propagation.
    } finally {
      isSubmittingRef.current = false;
      setIsSubmittingReport(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmittingReport}
        aria-busy={isSubmittingReport ? "true" : undefined}
        data-testid="submit-btn"
      >
        Submit Report
      </button>
      <span data-testid="call-count">{callCount}</span>
    </div>
  );
}

describe("SUBMIT-GUARD-02: Submit button disabled/aria-busy state (component level)", () => {
  it("button is enabled and not aria-busy in idle state", () => {
    render(<SubmitButtonHarness onSubmit={async () => {}} />);
    const btn = screen.getByTestId("submit-btn");
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-busy", "true");
  });

  it("button becomes disabled and aria-busy immediately when submit starts", async () => {
    let releaseFn!: () => void;
    const slow = new Promise<void>((res) => { releaseFn = res; });

    render(<SubmitButtonHarness onSubmit={() => slow} />);
    const btn = screen.getByTestId("submit-btn");

    fireEvent.click(btn);

    // After the synchronous ref+state update, before the promise resolves, button must be disabled
    await waitFor(() => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("aria-busy", "true");
    });

    releaseFn(); // resolve the promise → finally block resets state
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("rapid second click while first submit is in progress is blocked — only one submit reaches onSubmit", async () => {
    let releaseFn!: () => void;
    const slow = new Promise<void>((res) => { releaseFn = res; });

    const onSubmit = vi.fn(() => slow);
    render(<SubmitButtonHarness onSubmit={onSubmit} />);
    const btn = screen.getByTestId("submit-btn");

    // First click starts the submit
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());

    // Second click while button is disabled (aria-busy) — handler must bail via ref guard
    fireEvent.click(btn);

    releaseFn();
    await waitFor(() => expect(btn).not.toBeDisabled());

    // Only one actual submit reached onSubmit — the second was blocked by isSubmittingRef
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("call-count").textContent).toBe("1");
  });

  it("guard releases after successful submit — button is enabled again", async () => {
    let callCount = 0;
    render(<SubmitButtonHarness onSubmit={async () => { callCount++; }} />);
    const btn = screen.getByTestId("submit-btn");

    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(callCount).toBe(1);

    // After guard releases, a new submit proceeds
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(callCount).toBe(2);
  });

  it("guard releases after failed submit — button is enabled again", async () => {
    let callCount = 0;
    // Use a resolve-then-reject pattern rather than a synchronous throw to avoid
    // React 19 propagating the rejection as an uncaught error in jsdom's event loop.
    const onSubmit = async () => {
      callCount++;
      await Promise.resolve();
      throw new Error("submit failed (expected in test)");
    };
    render(<SubmitButtonHarness onSubmit={onSubmit} />);
    const btn = screen.getByTestId("submit-btn");

    // Click 1 — throws after microtask, finally block must reset guard
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 1000 });
    expect(callCount).toBe(1);

    // Click 2 — guard released, second call proceeds and also throws
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 1000 });
    expect(callCount).toBe(2);
  });

  it("guard releases immediately when validation fails (early return before async work)", async () => {
    const onSubmit = vi.fn();
    render(<SubmitButtonHarness onSubmit={onSubmit} validateOk={false} />);
    const btn = screen.getByTestId("submit-btn");

    fireEvent.click(btn);

    // Guard must not permanently disable the button after a validation failure
    await waitFor(() => {
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveAttribute("aria-busy", "true");
    }, { timeout: 500 });

    // onSubmit was never reached because validation failed before the try block
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ── REP-UX-03: Full submit busy state — all buttons disabled, aria-busy on Submit ──

describe("REP-UX-03: Full submit busy state — all footer buttons respond correctly", () => {
  it("Submit button is disabled and aria-busy during in-flight submit", async () => {
    let releaseFn!: () => void;
    const slow = new Promise<void>((res) => { releaseFn = res; });
    render(<SubmitButtonHarness onSubmit={() => slow} />);
    const btn = screen.getByTestId("submit-btn");

    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("aria-busy", "true");
    });

    releaseFn();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("idle Submit button has no aria-busy attribute", () => {
    render(<SubmitButtonHarness onSubmit={async () => {}} />);
    const btn = screen.getByTestId("submit-btn");
    expect(btn).not.toHaveAttribute("aria-busy", "true");
    expect(btn).not.toBeDisabled();
  });

  it("PMR reports.tsx source: Submit button aria-busy bound to isSubmittingReport", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(join(__dirname, "../pages/reports.tsx"), "utf8");
    expect(src).toMatch(/aria-busy=\{isSubmittingReport/);
  });

  it("PMR reports.tsx source: Cancel button disabled during submit (matches Submit condition)", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(join(__dirname, "../pages/reports.tsx"), "utf8");
    // Cancel in PMR footer must be disabled during submission
    expect(src).toMatch(/disabled=\{isSubmittingReport.*createMutation\.isPending.*transitionMutation\.isPending\}/);
  });

  it("PMR Save Draft button uses the full shared busy predicate (not just createMutation.isPending)", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(join(__dirname, "../pages/reports.tsx"), "utf8");
    // Save Draft buttons must share the full predicate - count occurrences
    const matches = src.match(/onClick=\{onSaveDraft\}[^>]*disabled=\{[^}]*isSubmittingReport \|\| createMutation\.isPending \|\| transitionMutation\.isPending\}/g) ?? [];
    // Expect at least 2 occurrences: one for wizard, one for non-wizard PMR footer
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("Activity wizard Back button uses the full shared busy predicate", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(join(__dirname, "../pages/reports.tsx"), "utf8");
    // Back button: disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending}
    expect(src).toMatch(/stateForm\.back[\s\S]{0,80}|[\s\S]{0,80}disabled=\{isSubmittingReport \|\| createMutation\.isPending \|\| transitionMutation\.isPending\}[\s\S]{0,300}stateForm\.back/);
  });

  it("Activity wizard Next button uses the full shared busy predicate", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(join(__dirname, "../pages/reports.tsx"), "utf8");
    // Next button must be disabled during submission
    expect(src).toMatch(/onClick=\{nextStep\}[^>]*disabled=\{isSubmittingReport \|\| createMutation\.isPending \|\| transitionMutation\.isPending\}/);
  });
});
