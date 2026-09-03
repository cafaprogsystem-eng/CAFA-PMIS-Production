import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_SURFACES,
  STORAGE_EVIDENCE_CLASSIFICATIONS,
  buildStorageEvidenceInventory,
  migrationRecordClassification,
} from "./storageEvidenceInventory";

describe("legacy storage evidence inventory", () => {
  it("records the retired provider boundary separately from GCS", () => {
    const inventory = buildStorageEvidenceInventory();

    expect(inventory.genuineGoogleDriveApiDependency).toBe(false);
    expect(inventory.configuredGoogleDriveIntegration).toBe("not_configured");
    expect(inventory.activeDriveNamedProvider).toContain("none");
    expect(inventory.supportedGoogleCloudProvider).toContain("Google Cloud Storage");
    expect(inventory.evidence.some((entry) =>
      entry.reference.includes("mockup-sandbox")
      && entry.classification === "documentation_only"
      && entry.providerDependency.includes("Google Fonts"),
    )).toBe(true);
    expect(inventory.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: expect.stringContaining("objectStorage.ts"),
        classification: "active_operational_code",
      }),
    ]));
  });

  it("covers every evidence classification and never includes provider secrets or identities", () => {
    const inventory = buildStorageEvidenceInventory();
    const classifications = new Set(inventory.evidence.map((entry) => entry.classification));

    for (const classification of STORAGE_EVIDENCE_CLASSIFICATIONS) {
      expect(inventory.evidenceClassificationCounts).toHaveProperty(classification);
    }
    expect(([
      "active_operational_code",
      "legacy_data",
      "migration_compatibility",
      "test_only",
      "documentation_only",
    ] as const).every((classification) => classifications.has(classification))).toBe(true);
    expect(inventory.redaction).toMatchObject({
      rawObjectKeys: false,
      externalProviderIds: false,
      credentials: false,
    });
    expect(JSON.stringify(inventory)).not.toMatch(/AWS_ACCESS_KEY|GCS_PRIVATE_KEY|s3:\/\//);
  });

  it("maps every rendered binary surface to online-only, parent-authorised handling", () => {
    const surfaces = ATTACHMENT_SURFACES.map((surface) => surface.surface);
    expect(surfaces).toEqual(expect.arrayContaining([
      "Projects",
      "Plans",
      "Risks",
      "Project reports",
      "Activity reports",
      "State Programme reports",
      "HQ Sector reports",
      "Communications",
      "File & Archive",
        "Historical storage import",
      "Profile",
      "SOPs, Manual and programme resources",
    ]));
    for (const surface of ATTACHMENT_SURFACES) {
      expect(surface.upload).not.toHaveLength(0);
      expect(surface.metadata).not.toHaveLength(0);
      expect(surface.previewDownload).not.toHaveLength(0);
      expect(surface.lifecycle).not.toHaveLength(0);
      expect(surface.parentAuthorisation).not.toHaveLength(0);
      expect(surface.offlinePolicy).toMatchObject({
        mode: "online_only",
        queuesBinaries: false,
        createsServerAttachment: false,
      });
    }
    expect(ATTACHMENT_SURFACES.some((surface) =>
      surface.offlinePolicy.persistsReselectMetadata,
    )).toBe(true);
  });

  it("uses provider category and reconciliation evidence to produce safe migration outcomes", () => {
    expect(migrationRecordClassification("OBJECT_RECOVERABLE", "historical:record-linked")).toBe("migratable");
    expect(migrationRecordClassification("OBJECT_RECOVERABLE", "s3:object-redacted")).toBe("already_canonical");
    expect(migrationRecordClassification("OBJECT_CONFIRMED_MISSING", "historical:record-linked")).toBe("missing");
    expect(migrationRecordClassification("METADATA_ORPHANED", null)).toBe("orphaned");
    expect(migrationRecordClassification("PARENT_REMOVED", null)).toBe("parent_removed");
    expect(migrationRecordClassification("PROVIDER_MAPPING_STALE", "historical:unknown")).toBe("owner_decision_required");
  });
});