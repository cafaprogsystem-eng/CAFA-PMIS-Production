import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ContinueEditingAction } from "@/components/continue-editing-action";

const translation = vi.hoisted(() => ({ language: "en" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) => {
      const messages = translation.language === "ar"
        ? {
            continueEditing: "متابعة التحرير",
            continueEditingAriaLabel: `متابعة تحرير ${options?.title ?? ""}`,
          }
        : {
            continueEditing: "Continue Editing",
            continueEditingAriaLabel: `Continue Editing ${options?.title ?? ""}`,
          };
      return messages[key as keyof typeof messages] ?? key;
    },
  }),
}));

afterEach(() => {
  cleanup();
  translation.language = "en";
});

describe("ContinueEditingAction", () => {
  it("uses the shared English copy, a record-specific accessible name, and keeps a nested route action isolated", () => {
    const onParentClick = vi.fn();
    const onActionClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <ContinueEditingAction
          recordTitle="Draft Project"
          onClick={onActionClick}
        />
      </div>,
    );

    const action = screen.getByRole("button", { name: "Continue Editing Draft Project" });
    expect(action).toHaveTextContent("Continue Editing");
    fireEvent.click(action);
    expect(onActionClick).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("uses Arabic copy and compact direction-safe sizing without changing the action name", () => {
    translation.language = "ar";
    render(
      <div dir="rtl">
        <ContinueEditingAction recordTitle="مسودة المشروع" onClick={() => {}} />
      </div>,
    );

    const action = screen.getByRole("button", { name: "متابعة تحرير مسودة المشروع" });
    expect(action).toHaveTextContent("متابعة التحرير");
    expect(action).toHaveClass("max-w-full", "shrink-0", "sm:h-9");
  });
});