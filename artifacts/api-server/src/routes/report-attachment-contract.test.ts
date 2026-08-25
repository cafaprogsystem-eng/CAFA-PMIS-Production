import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ListReportAttachmentsResponseItem } from "@workspace/api-zod";
import { toPublicReportAttachmentDto } from "./reports";

const routeSource = readFileSync(new URL("./reports.ts", import.meta.url), "utf8");

describe("report attachment generated-contract alignment", () => {
  it("normalises the registration response to the required availability status", () => {
    const dto = toPublicReportAttachmentDto({
      id: 1,
      reportId: 2,
      fileName: "evidence.pdf",
      contentType: "application/pdf",
      size: 128,
      uploadedAt: "2026-08-22T00:00:00.000Z",
      availabilityStatus: null,
    });

    expect(dto.availabilityStatus).toBe("available");
    expect(ListReportAttachmentsResponseItem.safeParse(dto).success).toBe(true);
  });

  it("projects availability status for both inserted and idempotent registration responses", () => {
    const projections = routeSource.match(/availability_status AS "availabilityStatus"/g) ?? [];
    expect(projections.length).toBeGreaterThanOrEqual(3);
    expect(routeSource).toContain("res.status(201).json(toPublicReportAttachmentDto(rows[0]))");
    expect(routeSource).toContain("toPublicReportAttachmentDto(existing[0])");
  });
});