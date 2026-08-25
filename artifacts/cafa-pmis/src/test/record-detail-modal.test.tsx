import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecordDetailModal } from "@/components/record-detail-modal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "recordDetails.close": "Close record details",
      "recordDetails.loading": "Loading record details",
      "recordDetails.unavailable": "Record unavailable",
      "recordDetails.retry": "Try again",
    }[key] ?? key),
  }),
}));

afterEach(cleanup);

function ControlledModal() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open record
      </button>
      <RecordDetailModal
        open={open}
        onClose={() => setOpen(false)}
        title="Quarterly Project Report"
        description="Project report detail and review"
        metadata={<span>Submitted</span>}
        footer={<button type="button">Approve report</button>}
        restoreFocusRef={triggerRef}
      >
        <p>Long record body</p>
      </RecordDetailModal>
    </>
  );
}

describe("RecordDetailModal", () => {
  it("provides a labelled, wide modal with a fixed header/footer and independently scrolling body", () => {
    render(<ControlledModal />);
    fireEvent.click(screen.getByRole("button", { name: "Open record" }));

    const dialog = screen.getByRole("dialog", { name: "Quarterly Project Report" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.className).toContain("w-[92vw]");
    expect(dialog.className).toContain("max-w-[1400px]");
    expect(dialog.className).not.toContain("max-w-[1180px]");
    expect(dialog.className).toContain("h-[calc(100dvh-3rem)]");
    expect(dialog.className).toContain("max-sm:w-full");
    expect(dialog.className).toContain("overflow-hidden");
    expect(dialog.className).not.toContain("overflow-y-auto");
    // Physical centre + transform remains correctly centred in both LTR and RTL.
    expect(dialog.className).toContain("left-1/2");
    expect(dialog.className).not.toContain("start-1/2");

    const header = dialog.querySelector("header");
    const footer = dialog.querySelector("footer");
    const scrollBody = dialog.querySelector(".overflow-y-auto");
    const bodyRail = scrollBody?.firstElementChild;
    const footerRail = footer?.firstElementChild;
    expect(header?.className).toContain("shrink-0");
    expect(header?.className).toContain("px-5");
    expect(header?.className).toContain("sm:px-8");
    expect(footer?.className).toContain("shrink-0");
    expect(scrollBody?.className).toContain("min-h-0");
    expect(scrollBody?.className).toContain("flex-1");
    expect(bodyRail?.className).toContain("w-full");
    expect(bodyRail?.className).not.toContain("max-w-[1060px]");
    expect(bodyRail?.className).not.toContain("mx-auto");
    expect(footerRail?.className).toContain("w-full");
    expect(footer?.className).toContain("px-5");
    expect(footer?.className).toContain("sm:px-8");
    expect(screen.getByText("Long record body")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve report" })).toBeVisible();
  });

  it("has an explicit close control and restores focus to the supplied list trigger", async () => {
    render(<ControlledModal />);
    const trigger = screen.getByRole("button", { name: "Open record" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close record details" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes with Escape and keeps layout logical for RTL", async () => {
    render(<ControlledModal />);
    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("text-start");
    expect(screen.getByRole("button", { name: "Close record details" }).className).toContain("ms-auto");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders safe loading, unavailable, and retryable error presentations without raw errors", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <RecordDetailModal open onClose={() => {}} title="Record" state="loading">
        Never shown
      </RecordDetailModal>,
    );
    expect(screen.getByLabelText("Loading record details")).toHaveAttribute("aria-busy", "true");

    rerender(
      <RecordDetailModal open onClose={() => {}} title="Record" state="unavailable">
        Never shown
      </RecordDetailModal>,
    );
    expect(screen.getByText("Record unavailable")).toBeVisible();

    rerender(
      <RecordDetailModal open onClose={() => {}} title="Record" state="error" onRetry={retry}>
        Never shown
      </RecordDetailModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});