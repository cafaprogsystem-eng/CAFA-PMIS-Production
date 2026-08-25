import { describe, expect, it } from "vitest";
import { canResumeReportDraft } from "@/pages/reports";

type DraftReport = Parameters<typeof canResumeReportDraft>[0];
type DraftUser = NonNullable<Parameters<typeof canResumeReportDraft>[2]>;

function draft(overrides: Record<string, unknown> = {}): DraftReport {
  return {
    id: 41,
    title: "Draft report",
    status: "draft",
    reportType: "project",
    authorId: 7,
    stateId: 3,
    ...overrides,
  } as DraftReport;
}

const author: DraftUser = { id: 7, role: "state_program_officer", stateId: 3 };

describe("report draft resume eligibility", () => {
  it("requires an editable draft authored by the current user for ordinary report authors", () => {
    expect(canResumeReportDraft(draft(), ["reports.update"], author)).toBe(true);
    expect(canResumeReportDraft(draft({ authorId: 8 }), ["reports.update"], author)).toBe(false);
    expect(canResumeReportDraft(draft({ status: "submitted" }), ["reports.update"], author)).toBe(false);
    expect(canResumeReportDraft(draft(), ["reports.delete"], author)).toBe(false);
  });

  it("preserves the full operational access override for PM and super-admin", () => {
    expect(
      canResumeReportDraft(
        draft({ authorId: 8 }),
        ["reports.update"],
        { id: 1, role: "program_manager" },
      ),
    ).toBe(true);
    expect(
      canResumeReportDraft(
        draft({ authorId: 8 }),
        ["reports.update"],
        { id: 2, role: "super_admin" },
      ),
    ).toBe(true);
  });

  it("keeps the State Office Manager fallback limited to its own in-state State Programme draft", () => {
    const som: DraftUser = { id: 9, role: "state_office_manager", stateId: 3 };
    const permissions = ["reports.program_state.create"];

    expect(canResumeReportDraft(draft({ reportType: "program_state", authorId: 9 }), permissions, som)).toBe(true);
    expect(canResumeReportDraft(draft({ reportType: "program_state", authorId: 8 }), permissions, som)).toBe(false);
    expect(canResumeReportDraft(draft({ reportType: "project", authorId: 9 }), permissions, som)).toBe(false);
    expect(canResumeReportDraft(draft({ reportType: "program_state", authorId: 9, stateId: 4 }), permissions, som)).toBe(false);
  });
});