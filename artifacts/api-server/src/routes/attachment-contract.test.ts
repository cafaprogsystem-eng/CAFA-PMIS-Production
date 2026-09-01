import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RequestAttachmentUploadDescriptorBody,
  FinalizeAttachmentUploadResponse,
} from "@workspace/api-zod";

const route = readFileSync(new URL("./attachments.ts", import.meta.url), "utf8");
const specification = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");

describe("canonical Plan and Risk attachment contract", () => {
  it("generates strict descriptor validation from the OpenAPI specification", () => {
    expect(RequestAttachmentUploadDescriptorBody.safeParse({
      parentType: "plan",
      parentId: 7,
      fileName: "evidence.pdf",
      contentType: "application/pdf",
      size: 1024,
    }).success).toBe(true);
    expect(RequestAttachmentUploadDescriptorBody.safeParse({
      parentType: "plan",
      parentId: 7,
      fileName: "evidence.pdf",
      contentType: "application/x-executable",
      size: 1024,
    }).success).toBe(false);
    expect(RequestAttachmentUploadDescriptorBody.safeParse({
      parentType: "risk",
      parentId: 7,
      fileName: "unsafe.svg",
      contentType: "image/svg+xml",
      size: 1024,
    }).success).toBe(false);
    const descriptorHandler = route.slice(
      route.indexOf('router.post("/attachments/upload-descriptors"'),
      route.indexOf('router.post("/attachments/operations/:operationId/finalize"'),
    );
    expect(descriptorHandler).not.toContain("body.objectPath");
    expect(specification).toContain("/attachments/upload-descriptors:");
    expect(specification).toContain("/attachments/operations/{operationId}/finalize:");
  });

  it("returns only the canonical public metadata projection", () => {
    const publicProjection = route.slice(route.indexOf("function publicAttachment"), route.indexOf("function descriptorError"));
    expect(publicProjection).not.toContain("objectPath:");
    expect(publicProjection).not.toContain("provider:");
    expect(publicProjection).not.toContain("uploadOperationId:");
    expect(FinalizeAttachmentUploadResponse.safeParse({
      id: 9,
      parentType: "risk",
      parentId: 6,
      fileName: "risk-evidence.pdf",
      contentType: "application/pdf",
      size: 200,
      status: "active",
      availabilityStatus: "available",
      versionNumber: 1,
      uploadedAt: "2026-08-22T00:00:00.000Z",
      uploadedByName: null,
    }).success).toBe(true);
  });

  it("locks the canonical parent and rechecks mutation authority before metadata is registered", () => {
    const descriptor = route.slice(
      route.indexOf('router.post("/attachments/upload-descriptors"'),
      route.indexOf('router.post("/attachments/operations/:operationId/finalize"'),
    );
    const finalisation = route.slice(
      route.indexOf('router.post("/attachments/operations/:operationId/finalize"'),
      route.indexOf("function currentModule"),
    );
    expect(descriptor).toContain("assertCanonicalParent(req, parentType, parentId, true, client)");
    expect(descriptor).toContain("attachment_upload_operations");
    expect(finalisation).toContain("FROM attachment_upload_operations WHERE operation_id = $1 FOR UPDATE");
    expect(finalisation).toContain("assertCanonicalParent(req, op.parentType, op.parentId)");
    expect(finalisation).toContain("req, op.parentType, op.parentId, false, client");
    expect(finalisation).toContain("req, current.parentType, current.parentId, true, client");
    expect(finalisation).toContain("metadata.size !== current.declaredSize");
    expect(finalisation).toContain('normaliseMime(metadata.contentType) !== current.contentType');
    expect(finalisation.indexOf("req, op.parentType, op.parentId, false, client"))
      .toBeLessThan(finalisation.indexOf("FROM attachment_upload_operations WHERE operation_id = $1 FOR UPDATE"));
  });

  it("derives plan and risk access from parents and keeps proxy unavailable responses redacted", () => {
    expect(route).toContain("assertAnySectorAllowed(req, parent.sectors)");
    expect(route).toContain("assertPlanStateAllowed(req, parent.stateId, parent.locationType)");
    expect(route).toContain("assertSectorAllowed(req, row.sector)");
    expect(route).toContain('hasPerm(permissionsFor(req.currentUser!), "risks.update")');
    expect(route).toContain('requiredPermission: "plans.view"');
    expect(route).toContain('requiredPermission: "risks.view"');
    expect(route).toContain("isPlanCurrentlyEditable(id, parent.status, parent.lastFinalApprovedAt)");
    expect(route).toContain('{ error: "file_unavailable", message: "File Unavailable" }');
  });

  it("makes provider promotion deterministic for replay and serialises parent deletion", () => {
    const storage = readFileSync(new URL("../lib/objectStorage.ts", import.meta.url), "utf8");
    const plans = readFileSync(new URL("./plans.ts", import.meta.url), "utf8");
    const projects = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
    expect(storage).toContain('const entityId = `${namespace}/${objectId ?? randomUUID()}`');
    expect(plans).toContain("SELECT object_path FROM attachments WHERE parent_type = 'plan' AND parent_id = $1");
    expect(projects).toContain("DELETE FROM attachments");
    expect(projects).toContain("parent_type = 'risk' AND parent_id = ANY($1)");
  });
});