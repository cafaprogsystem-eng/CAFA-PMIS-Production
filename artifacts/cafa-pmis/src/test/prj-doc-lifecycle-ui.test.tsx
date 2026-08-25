/**
 * PRJ-DOC-UI — Project Document Lifecycle UI Gate Tests (Task #472)
 *
 * Verifies that DocUploadSlot renders the correct buttons/icons/dialogs
 * for each lifecycle gate (mutable / operational / frozen) and user role.
 *
 * Test IDs:
 *   PRJ-DOC-UI-01  Draft project: authorised actor sees Upload + Delete buttons
 *   PRJ-DOC-UI-02  Approved project: ordinary actor sees Upload, no Delete (lock icon)
 *   PRJ-DOC-UI-03  Approved project: PM sees exceptional Delete (override Trash) button
 *   PRJ-DOC-UI-04  Override dialog requires non-blank reason
 *   PRJ-DOC-UI-05  Closed project: document area is read-only (no Upload, no Delete)
 *   PRJ-DOC-UI-06  Active project: same gates as approved
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { useForm } from "react-hook-form";

// ── Environment shims ────────────────────────────────────────────────────────
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as never;
  }
  // Mock fetch globally (used by override delete handler)
  global.fetch = vi.fn();
});

// ── i18n mock ────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown) => (typeof def === "string" ? def : key),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// ── API client mock ──────────────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  requestUploadUrl: vi.fn().mockResolvedValue({ uploadURL: "http://s3.test/up", key: "file.pdf" }),
}));

// ── Toast mock ───────────────────────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── sectors / utils mock ─────────────────────────────────────────────────────
vi.mock("@/lib/sectors", () => ({
  SECTORS: [],
  SUB_SECTORS: {},
  ASSISTANCE_MODALITIES: [],
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ── Radix UI mocks (minimal — avoids portal/pointer issues in jsdom) ─────────
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip-content" style={{ display: "none" }}>{children}</span>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-footer">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled, type, ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? "button"} {...rest as object}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

// ── Import the component under test ─────────────────────────────────────────
// Dynamic import after mocks are registered
const { DocUploadSlot } = await import("../components/project-registration-form");

// ─── Test fixture helpers ─────────────────────────────────────────────────────

const KINDS = [{ value: "other", label: "Other" }, { value: "report", label: "Report" }];

/** A document that already has a DB id (simulates a loaded existing doc) */
const EXISTING_DOC = {
  id: 42,
  category: "optional" as const,
  kind: "other",
  fileName: "proposal.pdf",
  contentType: "application/pdf",
  size: 2048,
  objectPath: "uploads/proposal.pdf",
};

/**
 * Wrapper component that provides a react-hook-form context to DocUploadSlot.
 */
function Wrapper({
  docGate,
  userRole,
  projectId,
  initialDocs = [],
}: {
  docGate: "mutable" | "operational" | "frozen";
  userRole: string;
  projectId?: number;
  initialDocs?: typeof EXISTING_DOC[];
}) {
  const form = useForm<{ documents: typeof EXISTING_DOC[] }>({
    defaultValues: { documents: initialDocs },
  });
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <DocUploadSlot category="optional" kinds={KINDS} form={form as any} docGate={docGate} userRole={userRole} projectId={projectId} />
  );
}

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PRJ-DOC-UI — DocUploadSlot lifecycle gates", () => {
  it("PRJ-DOC-UI-01: Draft project — authorised actor sees Upload and Delete (X) buttons", () => {
    render(
      <Wrapper docGate="mutable" userRole="technical_coordinator" projectId={1} initialDocs={[EXISTING_DOC]} />,
    );

    // Upload control present (label wrapping file input)
    const fileInputs = document.querySelectorAll("input[type='file']");
    expect(fileInputs.length).toBeGreaterThan(0);

    // X (delete) button present
    // The X icon renders inside a button; verify the button has the click handler area
    const buttons = screen.getAllByRole("button");
    // At least the X button for the doc should be present (ghost, no text)
    expect(buttons.some(b => b.classList.contains("p-0") || b.getAttribute("class")?.includes("p-0"))).toBe(true);
  });

  it("PRJ-DOC-UI-02: Approved project — ordinary actor sees Upload but no Delete (lock shown)", () => {
    render(
      <Wrapper docGate="operational" userRole="technical_coordinator" projectId={1} initialDocs={[EXISTING_DOC]} />,
    );

    // Upload input should be present (operational projects allow uploads)
    const fileInputs = document.querySelectorAll("input[type='file']");
    expect(fileInputs.length).toBeGreaterThan(0);

    // Lock tooltip content should be visible (rendered in DOM even if hidden)
    const lockTooltip = screen.getByText("Documents cannot be deleted after project approval.");
    expect(lockTooltip).toBeInTheDocument();
  });

  it("PRJ-DOC-UI-03: Approved project — PM sees override Trash button (not lock, not X)", () => {
    render(
      <Wrapper docGate="operational" userRole="program_manager" projectId={1} initialDocs={[EXISTING_DOC]} />,
    );

    // Upload input present
    const fileInputs = document.querySelectorAll("input[type='file']");
    expect(fileInputs.length).toBeGreaterThan(0);

    // Override delete tooltip content
    const overrideTooltip = screen.getByText("Delete document (override required — will be audited)");
    expect(overrideTooltip).toBeInTheDocument();

    // Lock (ordinary actor) tooltip should NOT be present
    expect(
      screen.queryByText("Documents cannot be deleted after project approval."),
    ).not.toBeInTheDocument();
  });

  it("PRJ-DOC-UI-04: Override dialog requires non-blank reason — shows error when submitted empty", async () => {
    render(
      <Wrapper docGate="operational" userRole="program_manager" projectId={1} initialDocs={[EXISTING_DOC]} />,
    );

    // The override button wrapper renders with amber colour — find a button near the Trash icon
    // Click any button that would open the override dialog (the amber trash button)
    const buttons = screen.getAllByRole("button");
    // The override button has no label text, only an icon — click the one in the doc row
    // It's the only button besides "Select" and "Upload" in the form when operational+PM
    const amberBtn = buttons.find(
      b => b.className.includes("amber") || (b as HTMLElement).getAttribute("class")?.includes("amber"),
    );
    if (amberBtn) {
      fireEvent.click(amberBtn);
    } else {
      // Fallback: click first p-0 button (the icon-only button in the doc row)
      const iconBtn = buttons.find(b => (b as HTMLElement).getAttribute("class")?.includes("h-6 w-6 p-0"));
      expect(iconBtn).toBeTruthy();
      fireEvent.click(iconBtn!);
    }

    // Dialog should now be open
    await waitFor(() => {
      expect(screen.queryByTestId("dialog")).toBeTruthy();
    });

    // Click Delete Document with empty reason
    const deleteBtn = screen.getByRole("button", { name: /Delete Document/i });
    fireEvent.click(deleteBtn);

    // Error message appears
    await waitFor(() => {
      expect(screen.getByText("An override reason is required.")).toBeInTheDocument();
    });
  });

  it("PRJ-DOC-UI-05: Closed project — no Upload button, no Delete button (fully read-only)", () => {
    render(
      <Wrapper docGate="frozen" userRole="program_manager" projectId={1} initialDocs={[EXISTING_DOC]} />,
    );

    // No file input for upload
    const fileInputs = document.querySelectorAll("input[type='file']");
    expect(fileInputs.length).toBe(0);

    // "Locked" label shown instead of Upload
    expect(screen.getByText("Locked")).toBeInTheDocument();

    // No override tooltip for delete
    expect(
      screen.queryByText("Delete document (override required — will be audited)"),
    ).not.toBeInTheDocument();

    // No lock tooltip (since no delete affordance at all for frozen)
    expect(
      screen.queryByText("Documents cannot be deleted after project approval."),
    ).not.toBeInTheDocument();
  });

  it("PRJ-DOC-UI-06: Active project — same gates as approved (upload present, ordinary actor locked)", () => {
    // The docGate prop abstracts the status — "operational" covers both approved and active.
    render(
      <Wrapper docGate="operational" userRole="senior_program_coordinator" projectId={1} initialDocs={[EXISTING_DOC]} />,
    );

    // Upload present
    const fileInputs = document.querySelectorAll("input[type='file']");
    expect(fileInputs.length).toBeGreaterThan(0);

    // Lock shown (SPC is not an override actor)
    expect(
      screen.getByText("Documents cannot be deleted after project approval."),
    ).toBeInTheDocument();

    // No override trash button
    expect(
      screen.queryByText("Delete document (override required — will be audited)"),
    ).not.toBeInTheDocument();
  });
});

// ─── PRJ-DOC-UI-07 — uploadDocumentFile PUT guard ────────────────────────────
//
// Tests the actual uploadDocumentFile utility (src/lib/upload-document.ts) used
// by handleDocumentUpload in project-detail.tsx. Using the real module ensures
// the guard is tested through the production code path, not a simulation.

vi.mock("@/lib/upload-document", async (importOriginal) => {
  // Import the real module so tests call the actual implementation
  return importOriginal();
});

describe("PRJ-DOC-UI-07 — uploadDocumentFile PUT-before-POST guard (real code)", () => {
  it("PRJ-DOC-UI-07: Storage PUT failure → uploadDocumentFile returns storage_put_failed, metadata POST never called", async () => {
    let metadataPostCalled = false;

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          // Storage service rejects the upload
          return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
        }
        if (
          init?.method === "POST" &&
          String(typeof url === "string" ? url : url.toString()).includes("/documents")
        ) {
          metadataPostCalled = true;
        }
        return { ok: true, json: async () => ({ id: 99 }) } as Response;
      },
    );

    const { uploadDocumentFile } = await import("@/lib/upload-document");
    const file = new File(["budget content"], "budget.pdf", { type: "application/pdf" });
    const result = await uploadDocumentFile(
      1,
      file,
      "http://fake-storage.test/upload-slot",
      "uploads/budget.pdf",
      { category: "optional", kind: "other", contentType: "application/pdf", size: file.size },
    );

    // Result must indicate failure
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe("storage_put_failed");
    // Metadata POST must NOT have been called — no phantom record
    expect(metadataPostCalled).toBe(false);
  });

  it("PRJ-DOC-UI-07b: Storage PUT success → uploadDocumentFile posts metadata and returns ok", async () => {
    let metadataPostCalled = false;

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return { ok: true, status: 200 } as Response;
        }
        if (
          init?.method === "POST" &&
          String(typeof url === "string" ? url : url.toString()).includes("/documents")
        ) {
          metadataPostCalled = true;
          return { ok: true, json: async () => ({ id: 99 }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    const { uploadDocumentFile } = await import("@/lib/upload-document");
    const file = new File(["contract content"], "contract.pdf", { type: "application/pdf" });
    const result = await uploadDocumentFile(
      1,
      file,
      "http://fake-storage.test/upload-slot",
      "uploads/contract.pdf",
      { category: "agreement", kind: "contract", contentType: "application/pdf", size: file.size },
    );

    expect(result.ok).toBe(true);
    expect(metadataPostCalled).toBe(true);
  });

  it("PRJ-DOC-UI-07c: Server rejects metadata POST (e.g. frozen project) → uploadDocumentFile returns error, does not throw", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return { ok: true, status: 200 } as Response;
        }
        // Metadata POST fails (project frozen)
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: "project_documents_frozen", message: "Project documents are locked." }),
        } as Response;
      },
    );

    const { uploadDocumentFile } = await import("@/lib/upload-document");
    const file = new File(["doc"], "report.pdf", { type: "application/pdf" });
    const result = await uploadDocumentFile(
      1, file, "http://fake-storage.test/slot", "uploads/report.pdf",
      { category: "optional", kind: "other", contentType: "application/pdf", size: file.size },
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("locked");
  });
});
