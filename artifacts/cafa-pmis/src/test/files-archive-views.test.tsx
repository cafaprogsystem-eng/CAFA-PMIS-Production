import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ArchiveCompactList,
  ArchiveDocumentCard,
  ReplaceDialog,
  type ArchiveItem,
} from "../pages/files";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

afterEach(cleanup);

const document: ArchiveItem = {
  source: "resource",
  id: 42,
  name: "Quarterly health report",
  fileName: "quarterly-health-report.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size: 4096,
  status: "active",
  classification: "Programme Reports",
  sector: "Health",
  module: null,
  recordId: null,
  reference: "CAFA-REP-042",
  canManageArchiveLifecycle: true,
  versionLabel: null,
  description: null,
  effectiveDate: "2026-08-01",
  updatedAt: "2026-08-02T10:00:00.000Z",
  createdAt: "2026-08-01T10:00:00.000Z",
  uploadedByName: "Archive staff",
  confidentiality: "internal",
  retentionYears: null,
  tags: ["quarterly", "health", "approved"],
  sourceKind: "direct_upload",
  sourceLabel: "Direct upload",
  relatedRecordTitle: "Health programme",
  previewUrl: "/api/files/resource/42/preview",
  downloadUrl: "/api/files/resource/42/download",
};

describe("File & Archive document presentations", () => {
  it("shows the same authorised document metadata and isolated actions in the Grid/Card view", () => {
    const onView = vi.fn();
    const onAction = vi.fn();
    render(
      <ArchiveDocumentCard
        item={document}
        actions={<button type="button" onClick={onAction}>Document actions</button>}
        onView={onView}
        classificationLabel="Programme Reports"
        sourceLabel="Direct upload"
        locale="en-GB"
      />,
    );

    expect(screen.getByText("Quarterly health report")).toBeVisible();
    expect(screen.getByText("Excel")).toBeVisible();
    expect(screen.getByText("CAFA-REP-042")).toBeVisible();
    expect(screen.getByText("Programme Reports")).toBeVisible();
    expect(screen.getByText("quarterly")).toBeVisible();
    expect(screen.getByTitle("approved")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "fileArchive.viewDocument" }));
    fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
    expect(onView).toHaveBeenCalledWith(document);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows the same authorised document and permission-aware action slot in Compact List", () => {
    const onView = vi.fn();
    const onAction = vi.fn();
    render(
      <ArchiveCompactList
        items={[document]}
        actionsFor={() => <button type="button" onClick={onAction}>Document actions</button>}
        onView={onView}
        classificationLabel={(value) => value}
        sourceLabel={() => "Direct upload"}
        locale="en-GB"
      />,
    );

    expect(screen.getByText("Quarterly health report")).toBeVisible();
    expect(screen.getByText("Excel")).toBeVisible();
    expect(screen.getByText("Programme Reports")).toBeVisible();
    expect(screen.getByText("Health")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "fileArchive.viewDocument" }));
    fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
    expect(onView).toHaveBeenCalledWith(document);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("clears a selected replacement before the dialog is reused for another record", async () => {
    const first = { ...document, id: 42, name: "First report" };
    const second = { ...document, id: 43, name: "Second report" };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderDialog = (item: ArchiveItem) => (
      <QueryClientProvider client={queryClient}>
        <ReplaceDialog item={item} onOpenChange={vi.fn()} />
      </QueryClientProvider>
    );
    const rendered = render(renderDialog(first));
    const fileInput = globalThis.document.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, {
      target: { files: [new File(["v1"], "first-version.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByText("first-version.pdf")).toBeVisible();

    rendered.rerender(renderDialog(second));
    await waitFor(() => expect(screen.getByText("fileArchive.selectFile")).toBeVisible());
    expect(screen.queryByText("first-version.pdf")).not.toBeInTheDocument();
  });
});