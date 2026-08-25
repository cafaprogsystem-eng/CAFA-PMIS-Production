/**
 * SPR-010 — Frontend taxonomy tests for the shared CommentsPanel.
 *
 *  - SPR-COM-FE-01/02: SPR sections prop renders the composer section selector
 *    including "General / Report-Level"
 *  - SPR-COM-FE-03: comment with section = "activities" shows "Activities"
 *  - SPR-COM-FE-04: presetSection pre-fills the composer section
 *  - SPR-COM-FE-05: null-section comment renders the General label
 *  - SPR-COM-FE-08: filter dropdown lists only represented sections
 *  - SPR-COM-FE-09: non-SPR usage (no sectionLabels) shows raw sections, no
 *    SPR taxonomy labels
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommentsPanel, type Comment } from "@/components/comments-panel";
import { SPR_SECTION_KEYS, SPR_SECTION_LABELS } from "@/lib/spr-sections";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const baseComment: Comment = {
  id: 1, entityType: "report", entityId: 9, parentId: null,
  section: "activities", commentType: "revision_request",
  authorId: 5, authorName: "Reviewer", authorRoleLabel: "Senior Programme Coordinator",
  body: "Please revise the activity figures.", status: "open",
  resolvedAt: null, resolvedById: null,
  createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z",
};

let commentsResponse: Comment[] = [];

beforeEach(() => {
  commentsResponse = [];
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => commentsResponse,
  })) as never;
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderPanel(extra: Partial<React.ComponentProps<typeof CommentsPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommentsPanel
        entityType="report"
        entityId={9}
        sections={[...SPR_SECTION_KEYS]}
        sectionLabels={SPR_SECTION_LABELS}
        currentUserId={5}
        currentUserRole="senior_program_coordinator"
        {...extra}
      />
    </QueryClientProvider>,
  );
}

describe("CommentsPanel — SPR section taxonomy", () => {
  it("FE-01/02: composer section selector renders with General / Report-Level option", async () => {
    renderPanel();
    const trigger = await screen.findByRole("combobox", { name: "comments.tagSection" });
    expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(await screen.findByText("General / Report-Level")).toBeInTheDocument();
    expect(screen.getByText("Activities")).toBeInTheDocument();
  });

  it("FE-03: comment tagged 'activities' displays the human label", async () => {
    commentsResponse = [baseComment];
    renderPanel();
    expect(await screen.findByText("§ Activities")).toBeInTheDocument();
    expect(screen.queryByText("§ activities")).not.toBeInTheDocument();
  });

  it("FE-04: presetSection pre-fills the composer section", async () => {
    renderPanel({ presetSection: { section: "activities", nonce: 1 } });
    const trigger = await screen.findByRole("combobox", { name: "comments.tagSection" });
    await waitFor(() => expect(trigger).toHaveTextContent("Activities"));
  });

  it("FE-05: null-section comment renders as General / Report-Level", async () => {
    commentsResponse = [{ ...baseComment, section: null }];
    renderPanel();
    expect(await screen.findByText("§ General / Report-Level")).toBeInTheDocument();
  });

  it("FE-08: filter dropdown lists only represented sections", async () => {
    commentsResponse = [baseComment];
    renderPanel();
    await screen.findByText("§ Activities");
    const filter = screen.getByRole("combobox", { name: "comments.allSections" });
    await userEvent.click(filter);
    const options = await screen.findAllByRole("option");
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain("Activities");
    expect(labels).not.toContain("Risks & Issues");
  });

  it("General filter includes null-section (report-level) comments", async () => {
    commentsResponse = [{ ...baseComment, section: null }, { ...baseComment, id: 2, section: "risks" }];
    renderPanel();
    await screen.findByText("§ General / Report-Level");
    const filter = screen.getByRole("combobox", { name: "comments.allSections" });
    await userEvent.click(filter);
    // "general" is offered because a null-section comment is present
    await userEvent.click(await screen.findByRole("option", { name: "General / Report-Level" }));
    expect(screen.getByText("§ General / Report-Level")).toBeInTheDocument();
    expect(screen.queryByText("§ Risks & Issues")).not.toBeInTheDocument();
  });

  it("readOnly hides composer and action buttons", async () => {
    commentsResponse = [baseComment];
    renderPanel({ readOnly: true });
    await screen.findByText("§ Activities");
    expect(screen.queryByRole("combobox", { name: "comments.tagSection" })).not.toBeInTheDocument();
    expect(screen.queryByText("comments.postComment")).not.toBeInTheDocument();
    expect(screen.queryByText("comments.reply")).not.toBeInTheDocument();
  });

  it("FE-09: non-SPR usage without sectionLabels shows raw section names, no SPR labels", async () => {
    commentsResponse = [{ ...baseComment, section: "Narrative" }];
    renderPanel({ sections: ["Narrative", "Budget"], sectionLabels: undefined });
    expect(await screen.findByText("§ Narrative")).toBeInTheDocument();
    expect(screen.queryByText("General / Report-Level")).not.toBeInTheDocument();
  });
});
