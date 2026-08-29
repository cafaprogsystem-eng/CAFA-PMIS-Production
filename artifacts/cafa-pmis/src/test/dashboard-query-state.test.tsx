import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ error: undefined as unknown, language: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "calendarWidget.schedule": state.language === "ar" ? "الجدول" : "Schedule",
      "calendarWidget.loadFailedTitle": state.language === "ar" ? "تعذر تحميل جدول الأعمال" : "Unable to load agenda",
      "calendarWidget.loadFailedDescription": "load failed",
      "calendarWidget.unavailableTitle": state.language === "ar" ? "جدول الأعمال غير متاح" : "Agenda unavailable",
      "calendarWidget.unavailableDescription": "offline",
      "calendarWidget.accessDeniedTitle": state.language === "ar" ? "تم رفض الوصول إلى جدول الأعمال" : "Agenda access denied",
      "calendarWidget.accessDeniedDescription": "denied",
      "calendarWidget.retry": state.language === "ar" ? "حاول مرة أخرى" : "Try again",
    } as Record<string, string>)[key] ?? key,
    i18n: { language: state.language, dir: () => state.language === "ar" ? "rtl" : "ltr" },
  }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardAgenda: () => ({
    data: state.error ? { items: [{ id: 1, date: "2026-01-01", type: "project", title: "STALE", link: "/" }] } : { items: [] },
    isLoading: false, isFetching: false, isError: Boolean(state.error), error: state.error, refetch: vi.fn(),
  }),
}));

import { CalendarProvider, ScheduleCard } from "../components/calendar-widget";

afterEach(() => { state.error = undefined; state.language = "en"; cleanup(); });
describe("dashboard query-state rendering", () => {
  it("renders a successful true zero as an empty schedule", () => {
    render(<CalendarProvider><ScheduleCard /></CalendarProvider>);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });
  it.each([[{ status: 500 }, "Unable to load agenda"], [{ status: 403 }, "Agenda access denied"]])(
    "withholds stale agenda data on current error", (error, label) => {
      state.error = error;
      render(<CalendarProvider><ScheduleCard /></CalendarProvider>);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    },
  );
  it("renders the Arabic restricted state", () => {
    state.language = "ar"; state.error = { status: 403 };
    render(<div dir="rtl"><CalendarProvider><ScheduleCard /></CalendarProvider></div>);
    expect(screen.getByText("تم رفض الوصول إلى جدول الأعمال")).toBeInTheDocument();
  });
});