import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { DriveAttachmentPanel } from "../components/drive-attachment-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canonical Plan/Risk attachment descriptor contract", () => {
  it.each([
    ["plans", "plan"],
    ["risks", "risk"],
  ] as const)("uploads a %s attachment using parentType=%s and finalises its descriptor", async (module, parentType) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/${module}/99/attachments`) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url === "/api/attachments/upload-descriptors") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          parentType,
          parentId: 99,
          fileName: "evidence.pdf",
          contentType: "application/pdf",
          size: 4,
        });
        return new Response(JSON.stringify({
          operationId: `${parentType}-operation`,
          uploadURL: `https://storage.example/${parentType}`,
          uploadToken: `${parentType}-token`,
        }), { status: 200 });
      }
      if (url === `https://storage.example/${parentType}`) {
        expect(init?.method).toBe("PUT");
        return new Response(null, { status: 200 });
      }
      if (url === `/api/attachments/operations/${parentType}-operation/finalize`) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ uploadToken: `${parentType}-token` });
        return new Response(JSON.stringify({ id: 1 }), { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(DriveAttachmentPanel, { module, recordId: 99 }),
    ));

    const input = await screen.findByLabelText("driveAttachment.attachFile");
    fireEvent.change(input, {
      target: { files: [new File(["test"], "evidence.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/attachments/operations/${parentType}-operation/finalize`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});