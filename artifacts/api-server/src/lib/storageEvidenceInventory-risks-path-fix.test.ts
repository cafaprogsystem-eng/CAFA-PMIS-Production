/**
 * STORAGE-EVIDENCE-INVENTORY-RISKS-PATH-FIX — the ATTACHMENT_SURFACES
 * "Risks" entry documented routes/drive.ts (POST /drive/upload, GET
 * /drive/files/:id/download) as the authoritative surface for risk
 * attachments. routes/drive.ts is never imported or mounted in
 * routes/index.ts — dead code. The real, live path (confirmed via
 * components/drive-attachment-panel.tsx) is the operation-based
 * upload/finalize flow in routes/attachments.ts. A document whose whole
 * purpose is to be the authoritative map of "what serves this file, what
 * authorises it" must not point at a route that can never run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ATTACHMENT_SURFACES } from "./storageEvidenceInventory";

const routesIndex = readFileSync(resolve(__dirname, "../routes/index.ts"), "utf8");

describe("STORAGE-EVIDENCE-INVENTORY-RISKS-PATH-FIX", () => {
  it("routes/drive.ts is confirmed dead — never referenced in routes/index.ts", () => {
    expect(routesIndex).not.toContain("drive");
  });

  it("the Risks surface entry no longer references the dead /drive route", () => {
    const risks = ATTACHMENT_SURFACES.find((s) => s.surface === "Risks");
    expect(risks).toBeDefined();
    expect(risks!.upload).not.toContain("/drive/");
    expect(risks!.previewDownload).not.toContain("/drive/");
    expect(risks!.metadata).not.toContain("drive_files");
  });

  it("the Risks surface entry now points at the real, live attachments.ts operation-based flow", () => {
    const risks = ATTACHMENT_SURFACES.find((s) => s.surface === "Risks")!;
    expect(risks.upload).toContain("/attachments/upload-descriptors");
    expect(risks.upload).toContain("/attachments/operations/:operationId/finalize");
    expect(risks.previewDownload).toContain("/attachments/:attachmentId/download");
    expect(risks.metadata).toContain("parent_type='risk'");
  });
});
