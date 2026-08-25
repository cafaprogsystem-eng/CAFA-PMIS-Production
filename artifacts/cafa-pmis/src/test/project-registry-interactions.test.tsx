import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CardGrid } from "@/components/view-modes/card-grid";
import { ListView } from "@/components/view-modes/list-view";
import { CompactView } from "@/components/view-modes/compact-view";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import { CalendarGrid } from "@/components/view-modes/calendar-grid";
import { StateMap } from "@/components/view-modes/state-map";
import type { ViewRecord } from "@/lib/view-modes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) =>
    options?.count ? `${options.count} scheduled items` : key }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

function record(onView: ReturnType<typeof vi.fn>, onEdit?: ReturnType<typeof vi.fn>): ViewRecord {
  return {
    id: 42,
    title: "Draft water project",
    code: "CAFA-PRJ-042",
    status: "draft",
    date: new Date().toISOString(),
    onClick: onView as unknown as (trigger?: HTMLElement | null) => void,
    actions: onEdit ? <button type="button" onClick={onEdit as unknown as React.MouseEventHandler<HTMLButtonElement>}>Continue Edit</button> : undefined,
  };
}

const views = [
  ["card", (item: ViewRecord) => <CardGrid items={[item]} />],
  ["list", (item: ViewRecord) => <ListView items={[item]} />],
  ["compact", (item: ViewRecord) => <CompactView items={[item]} />],
  ["kanban", (item: ViewRecord) => (
    <KanbanBoard items={[item]} columns={[{ key: "draft", label: "Draft", color: "bg-muted" }]} />
  )],
] as const;

describe("Project registry record controls", () => {
  it.each(views)("%s view opens a record by pointer and keyboard without making child edit actions open it", async (_name, View) => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(View(record(onView, onEdit)));

    const recordControl = screen.getByRole("button", { name: "View Draft water project" });
    recordControl.focus();
    expect(recordControl).toHaveFocus();

    fireEvent.click(recordControl);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onView).toHaveBeenCalledTimes(3);
    expect(onView.mock.calls.every(([trigger]) => trigger === recordControl)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Continue Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onView).toHaveBeenCalledTimes(3);
  });

  it("calendar entries are real buttons, retain focusable triggers, and keep Continue Edit isolated", () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    render(<CalendarGrid items={[record(onView, onEdit)]} />);

    const entry = screen.getByRole("button", { name: "View Draft water project" });
    fireEvent.click(entry);
    expect(onView).toHaveBeenCalledWith(entry);

    fireEvent.click(screen.getByRole("button", { name: "Continue Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onView).toHaveBeenCalledOnce();
  });

  it("calendar overflow expands to every hidden record instead of concealing draft actions", () => {
    const date = new Date().toISOString();
    const items = ["First", "Second", "Third", "Fourth"].map((title, index) => ({
      ...record(vi.fn(), vi.fn()),
      id: index + 1,
      title: `${title} draft`,
      date,
    }));
    render(<CalendarGrid items={items} />);

    expect(screen.queryByRole("button", { name: "View Fourth draft" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(screen.getByRole("button", { name: "View Fourth draft" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Continue Edit" })).toHaveLength(4);
  });

  it("state map cells remain static aggregate information", () => {
    render(
      <StateMap
        items={[record(vi.fn())]}
        states={[{ id: 1, name: "Khartoum" }]}
      />,
    );

    expect(screen.getByText("Khartoum")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});