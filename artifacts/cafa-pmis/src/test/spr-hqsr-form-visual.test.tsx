/**
 * REP-SPRHQ-FORM-VIS-01 through REP-SPRHQ-FORM-VIS-10
 *
 * Phase 4 visual contract tests for the SPR (ProgramStateReportForm) and
 * HQSR (HqSectorReportForm) create/edit/revision authoring forms.
 *
 * Renders the real form components directly (they are Dialog-mounted in the
 * app; the DialogFooter renders fine standalone) with stable mocked API hooks
 * — same pattern as spr-draft-edit.test.tsx / hqsr-draft-edit.test.tsx.
 *
 * i18n note: the t() mock returns the translation key, so i18n-driven text
 * appears in the DOM as its key (e.g. "hqForm.titleRevise"). Hard-coded
 * strings ("Edit HQ Sector Report") appear literally.
 *
 * Zero-residual: no backend routes, APIs, validators, or workflow logic changed.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Environment shims for Radix in jsdom ────────────────────────────────────
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as never;
  }
});

// ── i18n mock ────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown) => ({
      "stateForm.titleEdit": "Edit State Programme Report",
      "stateForm.titleRevise": "Revise State Programme Report",
      "stateForm.revisionBannerTitle": "This report was returned for revision.",
      "stateForm.revisionBannerBody": "Please review the reviewer feedback below and resubmit once the requested changes are made.",
      "hqForm.titleEdit": "Edit HQ Sector Report",
      "hqForm.titleRevise": "Revise HQ Sector Report",
    }[key] ?? (typeof def === "string" ? def : key)),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── API hook mocks ───────────────────────────────────────────────────────────
const { createMutateAsync, transitionMutateAsync, meHolder } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(async () => ({ id: 999 })),
  transitionMutateAsync: vi.fn(async () => ({})),
  meHolder: {
    user: { id: 21, name: "SPO User", role: "super_admin", stateId: 1, sector: "Health" } as Record<string, unknown>,
    permissions: ["reports.create", "comments.view", "comments.create"],
  },
}));

vi.mock("@workspace/api-client-react", () => {
  const stable = <T,>(data: T) => {
    const res = { data, isLoading: false, isError: false, isPending: false, refetch: () => {} };
    return () => res;
  };
  const stableMe = {
    data: {
      get user() { return meHolder.user; },
      get permissions() { return meHolder.permissions; },
    },
    isLoading: false,
  };
  const stableMutation = { mutateAsync: createMutateAsync, isPending: false };
  const stableTransition = { mutateAsync: transitionMutateAsync, isPending: false };
  return {
    useGetMe: () => stableMe,
    useListStates: stable([{ id: 1, name: "Khartoum" }, { id: 2, name: "Kassala" }]),
    useListProjects: stable([{ id: 5, code: "PRJ-005", title: "Water Project" }]),
    useCreateReport: () => stableMutation,
    useTransitionReport: () => stableTransition,
    requestUploadUrl: vi.fn(),
    ListReportsQueryResult: undefined,
  };
});

// fetch mock — records calls; snapshot/comments/risks GETs return safe data.
type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
beforeEach(() => {
  fetchCalls.length = 0;
  createMutateAsync.mockClear();
  transitionMutateAsync.mockClear();
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).includes("/snapshot")) {
      return { ok: true, json: async () => ({}) } as never;
    }
    return { ok: true, json: async () => [] } as never;
  }) as never;
});
afterEach(() => cleanup());

import { ProgramStateReportForm, type ExistingSprReport } from "../components/program-state-report-form";
import { HqSectorReportForm, type ExistingHqsrReport } from "../components/hq-sector-report-form";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const sprBase = {
  id: 55,
  title: "Khartoum — Monthly Programme Report — June 2026",
  status: "draft",
  reportType: "program_state",
  kind: "monthly",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  stateId: 1,
  periodStart: null,
  periodEnd: null,
  authorId: 21,
  approvalHistory: [] as Array<Record<string, unknown>>,
  activities: [],
  sections: {
    frequency: "monthly",
    officerName: "SPO User",
    sectors: ["WASH"],
    localitiesCovered: ["Bahri"],
    relatedProjectIds: [],
    humanitarianContext: { securitySituation: "Stable" },
    keyAchievements: "Wells restored",
    mainChallenges: "Fuel shortages",
    attachments: [{
      fileName: "a-very-long-photograph-evidence-filename-for-truncation-check-2026.pdf",
      contentType: "application/pdf", size: 1234, objectPath: "", driveFileId: 77, attachmentType: "Photos",
    }],
  },
};
const sprEdit = sprBase as unknown as ExistingSprReport;
const sprRevise = {
  ...sprBase,
  approvalHistory: [{ action: "submit" }, { action: "request_revision" }],
} as unknown as ExistingSprReport;

const hqsrBase = {
  id: 88,
  title: "Health — Monthly HQ Sector Report — June 2026",
  status: "draft",
  reportType: "hq_sector",
  sector: "Health",
  kind: "monthly",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  stateId: null,
  projectId: null,
  authorId: 21,
  approvalHistory: [] as Array<Record<string, unknown>>,
  sections: {
    frequency: "monthly",
    period: "2026-06",
    officerName: "TC User",
    technicalAnalysis: "Coverage improved",
    keyFindings: "Immunisation up",
    technicalRatings: [{ entityType: "state", entityLabel: "Khartoum", rating: "Good", reason: "Consistent delivery" }],
    attachments: [{
      fileName: "another-extremely-long-sector-coverage-report-filename-2026-quarter.pdf",
      contentType: "application/pdf", size: 4321, objectPath: "", driveFileId: 42, attachmentType: "Photos",
    }],
  },
};
const hqsrEdit = hqsrBase as unknown as ExistingHqsrReport;
const hqsrRevise = {
  ...hqsrBase,
  approvalHistory: [{ action: "submit" }, { action: "request_revision" }],
} as unknown as ExistingHqsrReport;

function renderSpr(report?: ExistingSprReport) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProgramStateReportForm onClose={() => {}} existingReport={report} />
    </QueryClientProvider>,
  );
}
function renderHqsr(report?: ExistingHqsrReport) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HqSectorReportForm onClose={() => {}} existingReport={report} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("REP-SPRHQ-FORM-VIS — SPR + HQSR Authoring Form Visual Contracts", () => {

  it("REP-SPRHQ-FORM-VIS-01: SPR shows Create / Edit / Revise heading variants", () => {
    renderSpr(undefined);
    // Create mode: i18n key for the heading
    expect(screen.getByText("stateForm.heading")).toBeInTheDocument();
    cleanup();
    renderSpr(sprEdit);
    expect(screen.getByText("Edit State Programme Report")).toBeInTheDocument();
    cleanup();
    renderSpr(sprRevise);
    expect(screen.getByText("Revise State Programme Report")).toBeInTheDocument();
  });

  it("REP-SPRHQ-FORM-VIS-02: HQSR shows Create / Edit / Revise heading variants", () => {
    renderHqsr(undefined);
    expect(screen.getByText("hqForm.formTitle")).toBeInTheDocument();
    cleanup();
    renderHqsr(hqsrEdit);
    expect(screen.getByText("Edit HQ Sector Report")).toBeInTheDocument();
    cleanup();
    renderHqsr(hqsrRevise);
    expect(screen.getByText("Revise HQ Sector Report")).toBeInTheDocument();
  });

  it("REP-SPRHQ-FORM-VIS-03: SPR state + period context visible in edit mode", () => {
    renderSpr(sprEdit);
    // State shown as a locked read-only input
    const stateInput = screen.getByDisplayValue("Khartoum");
    expect(stateInput).toBeInTheDocument();
    expect(stateInput).toHaveAttribute("readonly");
    // Report information section heading present
    expect(screen.getByText("stateForm.section1Title")).toBeInTheDocument();
  });

  it("REP-SPRHQ-FORM-VIS-04: HQSR sector + period context visible in edit mode", () => {
    renderHqsr(hqsrEdit);
    expect(screen.getByDisplayValue("Health")).toBeInTheDocument();
    expect(screen.getByText("hqForm.section1Title")).toBeInTheDocument();
  });

  it("REP-SPRHQ-FORM-VIS-05: revision banner (role=alert) present when returned for revision", () => {
    renderSpr(sprRevise);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    cleanup();
    renderHqsr(hqsrRevise);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    cleanup();
    // Not present in plain edit mode
    renderSpr(sprEdit);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("REP-SPRHQ-FORM-VIS-06: narrative Textareas sit under an accessible Label in a labelled section", () => {
    renderSpr(sprEdit);
    const textareas = Array.from(document.querySelectorAll("textarea"));
    expect(textareas.length).toBeGreaterThan(5);
    for (const ta of textareas) {
      const container = ta.closest("div");
      const labelled =
        ta.hasAttribute("aria-label") ||
        ta.hasAttribute("aria-labelledby") ||
        (ta.id && document.querySelector(`label[for="${ta.id}"]`) !== null) ||
        container?.querySelector("label") !== null ||
        ta.closest("section")?.hasAttribute("aria-labelledby") === true;
      expect(labelled).toBe(true);
    }
  });

  it("REP-SPRHQ-FORM-VIS-07: Save Draft button is secondary (not primary) in both forms", () => {
    renderSpr(undefined);
    let draft = screen.getByRole("button", { name: /stateForm\.saveDraft/i });
    expect(draft.className).not.toMatch(/\bbg-primary\b/);
    cleanup();
    renderHqsr(undefined);
    draft = screen.getByRole("button", { name: /hqForm\.saveDraft/i });
    expect(draft.className).not.toMatch(/\bbg-primary\b/);
  });

  it("REP-SPRHQ-FORM-VIS-08: Submit Report button is the primary action in both forms", () => {
    renderSpr(undefined);
    let submit = screen.getByRole("button", { name: /stateForm\.submitReport/i });
    expect(submit.className).toMatch(/\bbg-primary\b/);
    cleanup();
    renderHqsr(undefined);
    submit = screen.getByRole("button", { name: /hqForm\.submitReport/i });
    expect(submit.className).toMatch(/\bbg-primary\b/);
  });

  it("REP-SPRHQ-FORM-VIS-09: Save Draft + Submit carry aria-busy wiring and are enabled when idle", () => {
    for (const renderFn of [() => renderSpr(undefined), () => renderHqsr(undefined)]) {
      renderFn();
      const busyBtns = Array.from(document.querySelectorAll("button[aria-busy]"));
      expect(busyBtns.length).toBeGreaterThanOrEqual(2);
      for (const b of busyBtns) {
        expect(b.getAttribute("aria-busy")).toBe("false");
        expect(b).not.toBeDisabled();
      }
      cleanup();
    }
  });

  it("REP-SPRHQ-FORM-VIS-10: no mutation fired on mount; long filenames truncated with title attr", () => {
    renderSpr(sprEdit);
    renderHqsr(hqsrEdit);
    // No POST/PATCH/DELETE fired just from rendering the forms
    const writes = fetchCalls.filter((c) =>
      ["POST", "PATCH", "DELETE", "PUT"].includes(String(c.init?.method ?? "GET").toUpperCase()),
    );
    expect(writes.length).toBe(0);
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(transitionMutateAsync).not.toHaveBeenCalled();
    // Attachment filenames render truncated with an accessible title attribute
    const sprFile = screen.getByText(/a-very-long-photograph-evidence-filename/i);
    expect(sprFile.className).toMatch(/truncate/);
    expect(sprFile).toHaveAttribute("title");
    const hqFile = screen.getByText(/another-extremely-long-sector-coverage-report/i);
    expect(hqFile.className).toMatch(/truncate/);
    expect(hqFile).toHaveAttribute("title");
  });

  it("REP-SPRHQ-FORM-VIS-11: no parent+child border-b divider duplication on section headers", async () => {
    // Each authoring section must have exactly ONE divider owner: either the
    // wrapper row (button-bearing headers) or the <h4> itself — never both.
    const fs = await import("node:fs/promises");
    const files = [
      "src/components/program-state-report-form.tsx",
      "src/components/hq-sector-report-form.tsx",
    ];
    for (const f of files) {
      const src = await fs.readFile(f, "utf8");
      // A wrapper carrying border-b immediately followed by an <h4> that also
      // carries border-b renders a double divider.
      const dup = /border-b[^"]*"\s*>\s*<h4[^>]*border-b/.test(src);
      expect(dup, `${f} has a parent+child border-b duplication`).toBe(false);
    }
  });
});
