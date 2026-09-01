/**
 * Stable, redacted inventory of storage dependencies and rendered attachment
 * surfaces. This is deliberately a checked-in manifest rather than a runtime
 * filesystem walk: the API can be deployed without source checkout access and
 * the same evidence can be reviewed and reproduced from the repository.
 */

export const STORAGE_EVIDENCE_CLASSIFICATIONS = [
  "active_operational_code",
  "legacy_data",
  "migration_compatibility",
  "test_only",
  "dead_code",
  "documentation_only",
] as const;
export type StorageEvidenceClassification = (typeof STORAGE_EVIDENCE_CLASSIFICATIONS)[number];

export type StorageEvidenceEntry = {
  reference: string;
  classification: StorageEvidenceClassification;
  operationalPurpose: string;
  providerDependency: string;
  evidenceBasis: string;
};

export type AttachmentSurface = {
  surface: string;
  renderedIn: string;
  upload: string;
  metadata: string;
  previewDownload: string;
  lifecycle: string;
  parentAuthorisation: string;
  offlinePolicy: {
    mode: "online_only";
    queuesBinaries: false;
    persistsReselectMetadata: boolean;
    createsServerAttachment: false;
    behaviour: string;
  };
  providerDependency: string;
};

const ONLINE_ONLY_RESELECT_METADATA = {
  mode: "online_only" as const,
  queuesBinaries: false as const,
  persistsReselectMetadata: true,
  createsServerAttachment: false as const,
  behaviour: "Block the binary operation offline. The client may retain a local re-select-required metadata notice, but never binary data or a server attachment record.",
};

const ONLINE_ONLY_NO_METADATA = {
  mode: "online_only" as const,
  queuesBinaries: false as const,
  persistsReselectMetadata: false,
  createsServerAttachment: false as const,
  behaviour: "Block the binary operation offline; do not queue binary data, persist upload metadata, or create a server attachment record.",
};

/**
 * Every repository search result related to storage/Drive naming is grouped
 * here by operational purpose. The manifest intentionally names source areas,
 * routes, tables and contracts only; it never includes object keys, bucket
 * names, file IDs or credentials.
 */
export const STORAGE_EVIDENCE_MANIFEST: readonly StorageEvidenceEntry[] = [
  {
    reference: "artifacts/api-server/src/lib/awsS3.ts",
    classification: "dead_code",
    operationalPurpose: "Retired legacy façade retained only until its source can be removed safely.",
    providerDependency: "None in active runtime.",
    evidenceBasis: "The main router does not mount the legacy route and active attachment flows use ObjectStorageService.",
  },
  {
    reference: "artifacts/api-server/src/lib/objectStorage.ts",
    classification: "active_operational_code",
    operationalPurpose: "Central private-object upload, metadata verification, finalisation and download abstraction.",
    providerDependency: "Supported providers are Replit sidecar, Google Cloud Storage, or S3-compatible storage.",
    evidenceBasis: "Provider selection is STORAGE_PROVIDER=gcs|s3|replit; Google Cloud Storage SDK is used, not Drive API.",
  },
  {
    reference: "artifacts/api-server/src/routes/historical-storage-import.ts",
    classification: "migration_compatibility",
    operationalPurpose: "Explicit, administrator-operated import of evidence-backed plan/risk records into canonical storage.",
    providerDependency: "An optional historical S3 source, constructed only for an authorised import request.",
    evidenceBasis: "Destination is derived from the source record; unsupported historical modules remain reconciliation evidence.",
  },
  {
    reference: "artifacts/cafa-pmis/src/components/drive-attachment-panel.tsx",
    classification: "active_operational_code",
    operationalPurpose: "Rendered plan and risk attachment workflow using descriptors, canonical upload finalisation and parent-authorised downloads.",
    providerDependency: "ObjectStorageService through provider-neutral API routes.",
    evidenceBasis: "Production UI calls canonical attachment endpoints and receives no storage identity.",
  },
  {
    reference: "artifacts/api-server/src/routes/files.ts",
    classification: "active_operational_code",
    operationalPurpose: "File & Archive projection over canonical resources and parent-owned attachments.",
    providerDependency: "ObjectStorageService through source-specific authenticated proxies.",
    evidenceBasis: "Archive projection joins program_resources, project documents, plan attachments and report attachments only.",
  },
  {
    reference: "artifacts/api-server/src/routes/storage.ts",
    classification: "active_operational_code",
    operationalPurpose: "Central upload descriptors and authenticated object download proxy.",
    providerDependency: "ObjectStorageService selected provider.",
    evidenceBasis: "Requires parent permissions and validates provider metadata before registration.",
  },
  {
    reference: "artifacts/api-server/src/lib/attachmentReconciliation.ts",
    classification: "active_operational_code",
    operationalPurpose: "Canonical-owner scan (including managed profile avatars), exact provider metadata checks and redacted reconciliation evidence.",
    providerDependency: "ObjectStorageService for canonical rows; historical evidence remains unavailable until an explicit import.",
    evidenceBasis: "Checks exact object identity, size and MIME; never searches by filename or contacts historical sources.",
  },
  {
    reference: "artifacts/api-server/src/routes/attachment-reconciliation.ts",
    classification: "active_operational_code",
    operationalPurpose: "Restricted administrator report and owner-disposition workflow.",
    providerDependency: "Reconciliation evidence only; no provider copy or import.",
    evidenceBasis: "storage.admin gate and durable disposition/audit fields.",
  },
  {
    reference: "artifacts/api-server/src/routes/projects.ts",
    classification: "active_operational_code",
    operationalPurpose: "Project document registration, download, replacement and deletion.",
    providerDependency: "Central object storage.",
    evidenceBasis: "Parent project access is checked before document operations.",
  },
  {
    reference: "artifacts/api-server/src/routes/plans.ts",
    classification: "active_operational_code",
    operationalPurpose: "Plan attachment ownership and project/plan deletion lifecycle.",
    providerDependency: "Central object storage.",
    evidenceBasis: "plan_attachments is deleted only as part of an authorised plan lifecycle transaction.",
  },
  {
    reference: "artifacts/api-server/src/routes/reports.ts",
    classification: "active_operational_code",
    operationalPurpose: "Project, activity, state programme and HQ sector report attachments.",
    providerDependency: "Central object storage.",
    evidenceBasis: "report_attachments retains canonical object paths server-side and exposes only parent-authorised proxies.",
  },
  {
    reference: "artifacts/api-server/src/routes/attachments.ts",
    classification: "active_operational_code",
    operationalPurpose: "Plan and risk attachment access through canonical parents.",
    providerDependency: "Central object storage.",
    evidenceBasis: "Risk parent state/sector and mutation permission are enforced before registration or lifecycle change.",
  },
  {
    reference: "artifacts/api-server/src/routes/conversations.ts + routes/voice-notes.ts",
    classification: "active_operational_code",
    operationalPurpose: "Communication message attachments and voice-note upload/playback.",
    providerDependency: "Central object storage; message attachment URLs are parent-authorised proxies.",
    evidenceBasis: "Message JSON metadata and voice_notes are scanned as canonical owners.",
  },
  {
    reference: "artifacts/api-server/src/routes/profile.ts",
    classification: "active_operational_code",
    operationalPurpose: "Authenticated profile photo upload, verification, replacement and streaming.",
    providerDependency: "Central object storage.",
    evidenceBasis: "Photo is bound to the signed-in user and served through an authenticated proxy.",
  },
  {
    reference: "artifacts/api-server/src/routes/program-resources.ts + routes/manual.ts",
    classification: "active_operational_code",
    operationalPurpose: "SOPs, policies, manuals, templates and programme resources.",
    providerDependency: "Central object storage and File & Archive registry.",
    evidenceBasis: "program_resources is the canonical metadata owner; category distinguishes SOP/manual content.",
  },
  {
    reference: "artifacts/api-server/src/routes/training-videos.ts",
    classification: "active_operational_code",
    operationalPurpose: "Training-video upload, replacement and streaming.",
    providerDependency: "Application-managed local file is primary; configured S3 façade receives a non-fatal backup recorded in training_videos.drive_file_id.",
    evidenceBasis: "Multipart lifecycle writes file_path, then asyncBackupToS3 conditionally calls awsS3 and preserves local primary availability on backup failure.",
  },
  {
    reference: "lib/db/src/schema/index.ts",
    classification: "migration_compatibility",
    operationalPurpose: "Schema for drive_files and optional drive_file_id links on project/report attachments.",
    providerDependency: "Legacy S3 façade identity plus central object paths.",
    evidenceBasis: "drive_files is retained as metadata/provider compatibility, not a Google Drive API table.",
  },
  {
    reference: "drive_files rows and optional project_documents/report_attachments drive_file_id links",
    classification: "legacy_data",
    operationalPurpose: "Historical attachment metadata and S3 façade identity retained for existing records.",
    providerDependency: "AWS S3-compatible object identity; no Google Drive API dependency.",
    evidenceBasis: "Canonical reconciliation scans these rows by exact stored identity and preserves unavailable metadata for owner review.",
  },
  {
    reference: "artifacts/api-server/src/lib/run-migrations.ts",
    classification: "migration_compatibility",
    operationalPurpose: "Historical attachment-link and reconciliation schema evolution.",
    providerDependency: "Database metadata only; migrations do not copy provider bytes.",
    evidenceBasis: "Tracked migrations add compatibility links and durable reconciliation evidence.",
  },
  {
    reference: "lib/api-spec/openapi.yaml",
    classification: "migration_compatibility",
    operationalPurpose: "Published contracts for storage, archive and reconciliation routes.",
    providerDependency: "Provider-neutral response contracts; raw paths are excluded from public DTOs.",
    evidenceBasis: "Contracts describe proxy/download endpoints and restricted reconciliation operations.",
  },
  {
    reference: ".replit integrations = google-drive:1.0.0",
    classification: "migration_compatibility",
    operationalPurpose: "Configured legacy connector retained outside the application runtime path.",
    providerDependency: "Google Drive connector configuration exists, but no server/client Google Drive SDK or REST call site was found.",
    evidenceBasis: "Connector configuration alone is not an attachment-provider implementation; any future import must use the isolated administrative boundary.",
  },
  {
    reference: "lib/api-zod/src/generated/api.ts (if present)",
    classification: "migration_compatibility",
    operationalPurpose: "Generated Zod declarations may carry legacy driveFileId for historical record hydration only.",
    providerDependency: "AWS S3-backed Drive façade historical FK; no operational upload path.",
    evidenceBasis: "ProjectDocumentInput.driveFileId removed from openapi.yaml and generated api.schemas.ts in Task-790 cleanup; only server-side DB FK usage remains.",
  },
  {
    reference: "artifacts/cafa-pmis/src/components/project-registration-form.tsx",
    classification: "migration_compatibility",
    operationalPurpose: "Project-document form retains driveFileId only as a DB identity for edit-mode document listings; googleDriveFileId/googleDriveUrl aliases removed in Task-790.",
    providerDependency: "Legacy metadata identity only; upload handling remains through the existing application routes.",
    evidenceBasis: "The form has no Google Drive SDK/REST call; operational Drive-specific aliases removed.",
  },
  {
    reference: "artifacts/cafa-pmis/src/components/program-state-report-form.tsx + artifacts/cafa-pmis/src/components/hq-sector-report-form.tsx",
    classification: "documentation_only",
    operationalPurpose: "Developer comments around legacy report attachment upload fields.",
    providerDependency: "No provider client; comments are corrected to call the path a Drive-named S3 façade.",
    evidenceBasis: "Runtime uploads use application proxy routes and stored drive_files identifiers.",
  },
  {
    reference: "artifacts/cafa-pmis/src/locales/en/common.json + artifacts/cafa-pmis/src/locales/ar/common.json",
    classification: "migration_compatibility",
    operationalPurpose: "User-facing legacy attachment configuration messages.",
    providerDependency: "Copy only; corrected to provider-neutral attachment-storage wording.",
    evidenceBasis: "Locale keys do not configure or invoke a provider and remain keyed for backwards-compatible translations.",
  },
  {
    reference: "artifacts/cafa-pmis/src/locales/en/knowledge.json + artifacts/cafa-pmis/src/locales/ar/knowledge.json",
    classification: "documentation_only",
    operationalPurpose: "In-app knowledge-base storage descriptions and status messages.",
    providerDependency: "Copy only; corrected to managed attachment storage rather than Google Drive.",
    evidenceBasis: "These strings are informational and contain no provider calls or identifiers.",
  },
  {
    reference: "artifacts/api-server/src/routes/manual.ts + artifacts/api-server/src/routes/ai.ts",
    classification: "documentation_only",
    operationalPurpose: "System manual and assistant knowledge text describing document storage.",
    providerDependency: "Generated guidance only; corrected to the existing CAFA-managed attachment storage/proxy model.",
    evidenceBasis: "Neither route imports a Google Drive client; text must not be treated as provider evidence.",
  },
  {
    reference: "docs/final-go-live-audit.md + docs/audit-reports/system-interactive-actions-audit.md",
    classification: "documentation_only",
    operationalPurpose: "Historical go-live/audit statements that use obsolete Google Drive terminology.",
    providerDependency: "Historical documentation only; not runtime configuration or an active provider dependency.",
    evidenceBasis: "Retained for audit history and explicitly superseded by this inventory baseline.",
  },
  {
    reference: "docs/audit-reports/**/*drive_file* + BACKUP_RESTORE.md",
    classification: "documentation_only",
    operationalPurpose: "Historical migration/audit evidence and an optional human-directed external backup runbook.",
    providerDependency: "drive_file references document database compatibility; the backup runbook is not an application attachment workflow.",
    evidenceBasis: "No normal runtime route downloads, copies, or authenticates to an external Drive provider from these documents.",
  },
  {
    reference: "artifacts/api-server/src/**/*storage*test* + src/routes/**/*file*test*",
    classification: "test_only",
    operationalPurpose: "Regression coverage for upload signing, access control, redaction and legacy route compatibility.",
    providerDependency: "Test doubles and provider-independent contract assertions.",
    evidenceBasis: "Test-only references are not imported by production route registration.",
  },
  {
    reference: "docs/FILE_ARCHIVE_IMPLEMENTATION_AUDIT.md + docs/FILE_ARCHIVE_RECONCILIATION_REGISTER.md",
    classification: "documentation_only",
    operationalPurpose: "Architecture, preservation, access-control and owner-decision record.",
    providerDependency: "Documentation distinguishes the S3 façade from Google Cloud Storage support.",
    evidenceBasis: "These files record non-destructive behaviour and preflight evidence.",
  },
  {
    reference: "artifacts/mockup-sandbox/index.html",
    classification: "documentation_only",
    operationalPurpose: "Design preview font loading.",
    providerDependency: "Google Fonts only; not Google Drive or a file provider.",
    evidenceBasis: "Reference is a CSS font URL and has no Drive SDK/API usage.",
  },
];

export const ATTACHMENT_SURFACES: readonly AttachmentSurface[] = [
  {
    surface: "Projects",
    renderedIn: "Project registration/detail Documents section; File & Archive",
    upload: "POST /storage/uploads/request-url (documents), then project document registration",
    metadata: "project_documents: file name, MIME, size, object path, optional legacy drive link",
    previewDownload: "GET /api/projects/:projectId/documents/:documentId/download",
    lifecycle: "Project document delete/replacement follows project permissions; parent deletion governs metadata.",
    parentAuthorisation: "Canonical project access and project document permissions; legacy links are not trusted for access.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage; optional legacy S3 drive_files mapping.",
  },
  {
    surface: "Plans",
    renderedIn: "Plan detail Attachments section; File & Archive",
    upload: "POST /storage/uploads/request-url (documents), then plan attachment registration",
    metadata: "plan_attachments: file name, MIME, size, object path",
    previewDownload: "File & Archive plan proxy; plan attachment download flow",
    lifecycle: "Plan attachment metadata and objects are handled by authorised plan lifecycle/deletion transactions.",
    parentAuthorisation: "Canonical plan scope, including effective sectors and state scope.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    // routes/drive.ts (the previous entry here) is dead code — it is never
    // imported or mounted in routes/index.ts. The live path, confirmed via
    // components/drive-attachment-panel.tsx, is the operation-based
    // upload/finalize flow in routes/attachments.ts (parentType: "risk").
    surface: "Risks",
    renderedIn: "Risk detail attachment panel",
    upload: "POST /attachments/upload-descriptors → POST /attachments/operations/:operationId/finalize (parentType: risk)",
    metadata: "attachments: file name, MIME, size, object path, keyed by (parent_type='risk', parent_id)",
    previewDownload: "GET /attachments/:attachmentId/download, GET /attachments/:attachmentId/preview",
    lifecycle: "POST /attachments/:attachmentId/archive; DELETE /attachments/:attachmentId (best-effort object cleanup).",
    parentAuthorisation: "Canonical parent risk state/sector scope plus risks.update for mutations; DTO strips provider internals.",
    offlinePolicy: ONLINE_ONLY_NO_METADATA,
    providerDependency: "Central object storage (ObjectStorageService) — same provider-neutral upload contract as Plans.",
  },
  {
    surface: "Project reports",
    renderedIn: "Project report form/viewer; File & Archive",
    upload: "POST /storage/uploads/request-url with report attachment entity",
    metadata: "report_attachments joined to reports; optional linked legacy drive_file_id",
    previewDownload: "GET /api/reports/:reportId/attachments/:attachmentId/download",
    lifecycle: "Report draft edits and report deletion govern attachment metadata; unavailable files remain represented.",
    parentAuthorisation: "Report view/mutation authorization and report parent scope.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "Activity reports",
    renderedIn: "Activity report form/viewer",
    upload: "POST /storage/uploads/request-url with report attachment entity",
    metadata: "report_attachments keyed to the canonical activity report",
    previewDownload: "GET /api/reports/:reportId/attachments/:attachmentId/download",
    lifecycle: "Follows the activity report draft/submission lifecycle; no binary deletion during offline replay.",
    parentAuthorisation: "Activity report author and reviewer scope, with canonical project/activity sector rules.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "State Programme reports",
    renderedIn: "State programme report form/viewer",
    upload: "POST /storage/uploads/request-url with report attachment entity",
    metadata: "report_attachments keyed to the state programme report",
    previewDownload: "GET /api/reports/:reportId/attachments/:attachmentId/download",
    lifecycle: "Follows report lifecycle; unavailable metadata is retained for review.",
    parentAuthorisation: "Canonical report state scope and report mutation/view permissions.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "HQ Sector reports",
    renderedIn: "HQ sector report evidence panel/viewer",
    upload: "POST /storage/uploads/request-url, then report attachment registration with a report-bound token",
    metadata: "report_attachments with a canonical object identity retained server-side",
    previewDownload: "GET /api/reports/:reportId/attachments/:attachmentId/download",
    lifecycle: "Report lifecycle; historical records remain unavailable until an administrator imports verified evidence.",
    parentAuthorisation: "HQ report authorization; historical import has a separate storage.admin and operator-role boundary.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "Communications",
    renderedIn: "Conversation message composer, message history, voice-note controls",
    upload: "POST /storage/uploads/request-url with messages scope; voice-note upload descriptor",
    metadata: "messages.attachments JSON and voice_notes rows",
    previewDownload: "Parent-authorised message attachment proxy and voice-note URL/stream",
    lifecycle: "Message deletion/hide semantics and voice-note deletion; attachment bytes are not queued.",
    parentAuthorisation: "Conversation membership/canonical conversation access; possession of an object path is insufficient.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "File & Archive",
    renderedIn: "File & Archive list, preview and download actions",
    upload: "Direct unlinked archive upload through the central upload contract",
    metadata: "Projection over program_resources, project_documents, plan_attachments and report_attachments",
    previewDownload: "Source-specific authenticated preview/download proxies",
    lifecycle: "Source-owned lifecycle; archive actions do not create a second file store.",
    parentAuthorisation: "Source parent scope; standalone uploads are uploader-scoped except for archive managers.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "Historical storage import",
    renderedIn: "Administrator storage-history controls only",
    upload: "No normal upload path; an explicit import copies an evidence-verified historical source into canonical storage",
    metadata: "legacy_storage_records, historical import runs/attempts, and resulting canonical attachments",
    previewDownload: "No historical runtime proxy; imported bytes use the canonical parent-authorised attachment proxy",
    lifecycle: "Administrator-only import of source-mapped plan/risk records, idempotent retries and reconciliation-required outcomes; no automatic deletion or fabricated bytes.",
    parentAuthorisation: "storage.admin plus super_admin or executive_director role; normal users cannot access historical source credentials or identifiers.",
    offlinePolicy: ONLINE_ONLY_NO_METADATA,
    providerDependency: "Optional historical S3 source for this isolated operation; central object storage for the destination.",
  },
  {
    surface: "Profile",
    renderedIn: "Profile photo control and authenticated profile views",
    upload: "POST /profile/photo/upload-url, then POST /profile/photo",
    metadata: "User profile avatar reference bound to the current user",
    previewDownload: "GET /profile/photo authenticated stream",
    lifecycle: "Replace/remove profile photo; old object cleanup is source-controlled.",
    parentAuthorisation: "Signed-in user only.",
    offlinePolicy: ONLINE_ONLY_NO_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "SOPs, Manual and programme resources",
    renderedIn: "Programme resources, System Manual and File & Archive",
    upload: "Central documents upload contract through programme-resource creation",
    metadata: "program_resources category, version, effective date, tags and object metadata",
    previewDownload: "Resource/File & Archive authenticated proxy",
    lifecycle: "Resource archive/restore, metadata update and authorised delete.",
    parentAuthorisation: "program_resources permissions; category identifies SOP/manual semantics.",
    offlinePolicy: ONLINE_ONLY_RESELECT_METADATA,
    providerDependency: "Central object storage.",
  },
  {
    surface: "Training videos",
    renderedIn: "Training video administration and playback",
    upload: "Multipart training-video upload routes",
    metadata: "Training video record and application-managed file_path",
    previewDownload: "Authenticated training-video stream",
    lifecycle: "Create, replace and delete according to training administration permissions.",
    parentAuthorisation: "Training administration permissions and record ownership rules.",
    offlinePolicy: ONLINE_ONLY_NO_METADATA,
    providerDependency: "Local application-managed file is primary; it is independent of the retired attachment façade.",
  },
];

export function migrationRecordClassification(
  reconciliationClassification: string,
  providerReference: unknown,
): "migratable" | "already_canonical" | "missing" | "orphaned" | "parent_removed" | "owner_decision_required" {
  if (reconciliationClassification === "PARENT_REMOVED") return "parent_removed";
  if (reconciliationClassification === "METADATA_ORPHANED") return "orphaned";
  if (reconciliationClassification === "OBJECT_CONFIRMED_MISSING") return "missing";
  if (
    reconciliationClassification === "OBJECT_RECOVERABLE"
    && typeof providerReference === "string"
    && providerReference.startsWith("historical:")
  ) {
    return "migratable";
  }
  if (reconciliationClassification === "OBJECT_RECOVERABLE") return "already_canonical";
  return "owner_decision_required";
}

export function buildStorageEvidenceInventory() {
  const referenceCounts = Object.fromEntries(
    STORAGE_EVIDENCE_CLASSIFICATIONS.map((classification) => [
      classification,
      STORAGE_EVIDENCE_MANIFEST.filter((entry) => entry.classification === classification).length,
    ]),
  ) as Record<StorageEvidenceClassification, number>;

  return {
    manifestVersion: "canonical-storage-cutover-1",
    searchMethod: "Checked-in evidence manifest covering source, configuration, API contracts, schema, tests and documentation. Repeat by reviewing the declared search roots/patterns and updating this manifest when references change.",
    searchRoots: [
      "artifacts/api-server/src",
      "artifacts/cafa-pmis/src",
      "lib/db/src/schema",
      "lib/api-spec",
      "lib/api-client-react/src/generated",
      "lib/api-zod/src/generated",
      "docs",
      "BACKUP_RESTORE.md",
      "attached_assets",
      ".replit",
      "artifacts/mockup-sandbox",
    ],
    searchPatterns: ["drive", "driveFileId", "googleDriveFileId", "googleDriveUrl", "google-drive:", "storage", "attachment", "object_path", "objectPath", "Google Drive", "@google-cloud/storage"],
    genuineGoogleDriveApiDependency: false,
    configuredGoogleDriveIntegration: "not_configured",
    activeDriveNamedProvider: "none; normal runtime uses ObjectStorageService only.",
    supportedGoogleCloudProvider: "Google Cloud Storage is supported by ObjectStorageService when STORAGE_PROVIDER=gcs; it is distinct from Google Drive.",
    evidence: STORAGE_EVIDENCE_MANIFEST,
    evidenceClassificationCounts: referenceCounts,
    attachmentSurfaces: ATTACHMENT_SURFACES,
    redaction: {
      rawObjectKeys: false,
      externalProviderIds: false,
      credentials: false,
      providerReferences: "category-only or short hash in reconciliation records",
    },
  };
}