import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { TooltipProvider } from "../components/ui/tooltip";

const locale = vi.hoisted(() => ({ language: "ar" as "ar" | "en" }));

vi.mock("react-i18next", async () => {
  const en = (await import("../locales/en/common.json")).default;
  const ar = (await import("../locales/ar/common.json")).default;

  const resolve = (resource: Record<string, unknown>, key: string): string | undefined =>
    key.replace(/^common:/, "").split(".").reduce<unknown>(
      (value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined,
      resource,
    ) as string | undefined;

  return {
    useTranslation: () => ({
      t: (key: string, options: Record<string, unknown> = {}) => {
        const value = resolve(locale.language === "ar" ? ar : en, key);
        if (typeof value !== "string") return key;
        return value.replace(/\{\{([^}]+)\}\}/g, (_, name: string) => String(options[name] ?? `{{${name}}}`));
      },
      i18n: { language: locale.language, dir: () => locale.language === "ar" ? "rtl" : "ltr" },
    }),
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardAgenda: () => ({
    data: {
      items: [
        {
          id: 1,
          date: "2026-06-15",
          type: "project",
          status: "active",
          title: "مشروع تجريبي",
          link: "/projects/1",
          dueLabel: "upcoming",
        },
        {
          id: 2,
          date: "2026-06-15",
          type: "unrecognised_type",
          status: "unrecognised_status",
          title: "عنصر اختبار",
          link: "/projects/2",
          dueLabel: "unrecognised_due",
        },
      ],
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { CalendarGridCard, CalendarProvider, ScheduleCard, RemindersCard } from "../components/calendar-widget";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderCalendar() {
  return render(
    <TooltipProvider>
      <CalendarProvider>
        <CalendarGridCard />
        <ScheduleCard />
        <RemindersCard />
      </CalendarProvider>
    </TooltipProvider>,
  );
}

describe("Calendar Arabic date formatting", () => {
  it("renders Arabic-locale month and date output in badges, schedule headers, and reminders", () => {
    locale.language = "ar";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    render(
      <TooltipProvider>
        <CalendarProvider>
          <ScheduleCard />
          <RemindersCard />
        </CalendarProvider>
      </TooltipProvider>,
    );

    const expected = new Date("2026-06-15T00:00:00").toLocaleDateString("ar", {
      month: "short",
      day: "numeric",
    });
    // The reminder date is rendered as its own text node; the selected schedule
    // heading includes a decorative dash in the same node.
    expect(screen.getAllByText(expected).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText((_, element) =>
      element?.classList.contains("font-normal") === true
        && element.textContent?.includes(expected) === true,
    )).toBeInTheDocument();
    expect(
      screen.getAllByText(new Date("2026-06-15T00:00:00").toLocaleString("ar", { month: "short" })).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders seven distinct Arabic weekday headers without truncating their translated names", () => {
    locale.language = "ar";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    render(
      <TooltipProvider>
        <CalendarProvider>
          <CalendarGridCard />
        </CalendarProvider>
      </TooltipProvider>,
    );

    const weekdayLabels = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
    for (const label of weekdayLabels) {
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(new Set(weekdayLabels).size).toBe(7);
  });

  it.each([
    ["en", "Calendar", "Schedule", "Reminders", "Unknown item type", "Due date status unavailable"],
    ["ar", "التقويم", "الجدول", "التذكيرات", "نوع العنصر غير معروف", "حالة الاستحقاق غير متاحة"],
  ] as const)(
    "renders resolved %s calendar labels and accessible names without raw keys",
    (language, calendar, schedule, reminders, unknownType, unknownDue) => {
      locale.language = language;
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T12:00:00"));
      const { container } = renderCalendar();

      expect(screen.getByText(calendar, { exact: true })).toBeInTheDocument();
      expect(screen.getByText(schedule, { exact: true })).toBeInTheDocument();
      expect(screen.getByText(reminders, { exact: true })).toBeInTheDocument();
      expect(screen.getAllByText(unknownType).length).toBeGreaterThan(0);
      expect(screen.getAllByText(unknownDue).length).toBeGreaterThan(0);
      expect(container.textContent).not.toMatch(/calendarWidget\.[\w.]+/);
      expect(
        [...container.querySelectorAll("[aria-label]")].map((element) => element.getAttribute("aria-label")),
      ).not.toContainEqual(expect.stringMatching(/^calendarWidget\./));
      expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(7);
    },
  );

  it("keeps month navigation and selected-date schedule updates localised", () => {
    locale.language = "en";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    const { container } = renderCalendar();

    expect(screen.getByText("June 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("June 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /16 June 2026/ }));
    expect(screen.getByText("No items are scheduled for this date.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /15 June 2026/ }));
    expect(screen.getAllByText("مشروع تجريبي").length).toBeGreaterThanOrEqual(1);

    const weekdayHeaders = [...container.querySelectorAll('[role="columnheader"]')];
    expect(weekdayHeaders).toHaveLength(7);
    for (const header of weekdayHeaders) {
      expect(header).toHaveClass("min-w-0", "whitespace-nowrap");
    }
    expect(container.querySelector('[role="row"]')).toHaveClass("grid-cols-7");
    expect(container.querySelector('[role="grid"]')).toHaveClass("grid-cols-7");
  });
});