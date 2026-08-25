import { describe, expect, it } from "vitest";
import {
  classifyReconciliationEvidence,
  providerKindForLinkedAttachment,
} from "./attachmentReconciliation";

const complete = {
  sourceKind: "project_document" as const,
  parentExists: true,
  parentRemoved: false,
  providerKind: "object_storage" as const,
  fileSize: 42,
  contentType: "application/pdf",
};

describe("attachment reconciliation classification", () => {
  it("uses every required class deterministically without filename matching", () => {
    expect(classifyReconciliationEvidence(complete, {
      resolution: "confirmed", size: 42, contentType: "application/pdf", detail: "confirmed",
    }).classification).toBe("OBJECT_RECOVERABLE");
    expect(classifyReconciliationEvidence({ ...complete, providerKind: "historical" }, {
      resolution: "malformed", detail: "missing_mapping",
    }).classification).toBe("PROVIDER_MAPPING_STALE");
    expect(classifyReconciliationEvidence({ ...complete, parentExists: false }, {
      resolution: "confirmed", detail: "ignored",
    }).classification).toBe("METADATA_ORPHANED");
    expect(classifyReconciliationEvidence({ ...complete, parentExists: false, parentRemoved: true }, {
      resolution: "confirmed", detail: "ignored",
    }).classification).toBe("PARENT_REMOVED");
    expect(classifyReconciliationEvidence(complete, {
      resolution: "missing", detail: "not_found",
    }).classification).toBe("OBJECT_CONFIRMED_MISSING");
    expect(classifyReconciliationEvidence({ ...complete, fileSize: null }, {
      resolution: "confirmed", size: 42, contentType: "application/pdf", detail: "confirmed",
    }).classification).toBe("OWNER_DECISION_REQUIRED");
  });

  it("keeps a soft-deleted parent removed even when the row still exists", () => {
    expect(classifyReconciliationEvidence({ ...complete, parentRemoved: true }, {
      resolution: "confirmed", size: 42, contentType: "application/pdf", detail: "confirmed",
    }).classification).toBe("PARENT_REMOVED");
  });

  it("allows a Drive-backed document only with a valid canonical mapping and exact metadata", () => {
    expect(classifyReconciliationEvidence({ ...complete, providerKind: "historical" }, {
      resolution: "confirmed", size: 42, contentType: "application/pdf", detail: "confirmed",
    }).classification).toBe("OBJECT_RECOVERABLE");
  });

  it("prefers a canonical object path over a retained Drive compatibility link", () => {
    expect(providerKindForLinkedAttachment("/objects/canonical-object", "legacy-drive-key")).toBe("object_storage");
    expect(providerKindForLinkedAttachment(null, "legacy-provider-key")).toBe("historical");
    expect(providerKindForLinkedAttachment(null, null)).toBe("object_storage");
  });

  it("classifies an imported historical record by its canonical object, while its retired evidence stays unavailable", () => {
    expect(providerKindForLinkedAttachment("/objects/imported-historical-object", "legacy-provider-key"))
      .toBe("object_storage");
    expect(classifyReconciliationEvidence({
      ...complete,
      sourceKind: "legacy_storage_record",
      providerKind: "object_storage",
    }, {
      resolution: "confirmed",
      size: 42,
      contentType: "application/pdf",
      detail: "provider_metadata_confirmed",
    }).classification).toBe("OBJECT_RECOVERABLE");
  });

  it("treats a provider-confirmed managed avatar as canonical without inventing historic size or MIME metadata", () => {
    expect(classifyReconciliationEvidence({
      ...complete,
      sourceKind: "profile_avatar",
      fileSize: null,
      contentType: null,
    }, {
      resolution: "confirmed",
      size: 4812,
      contentType: "image/png",
      detail: "provider_metadata_confirmed",
    })).toMatchObject({
      classification: "OBJECT_RECOVERABLE",
      reason: "canonical_profile_avatar_identity_confirmed_historical_size_mime_unavailable",
    });
  });

  it("keeps an unavailable managed avatar in the owner-decision path", () => {
    expect(classifyReconciliationEvidence({
      ...complete,
      sourceKind: "profile_avatar",
      fileSize: null,
      contentType: null,
    }, {
      resolution: "unavailable",
      detail: "provider_metadata_unavailable",
    })).toMatchObject({
      classification: "OWNER_DECISION_REQUIRED",
      reason: "provider_metadata_unavailable",
    });
  });
});