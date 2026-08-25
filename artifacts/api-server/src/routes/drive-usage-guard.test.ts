/**
 * DRIVE-GUARD — Repository Guard: Drive/awsS3 Usage Boundary (Task-790)
 *
 * Rejects operational Drive or awsS3 usage from active application flows.
 * Historical evidence is isolated to the administrator-only import boundary;
 * it is never an attachment runtime provider.
 *
 * Permitted operational files (must be justified with a comment in the source):
 *   - src/routes/drive.ts          — legacy Drive-named S3-compatible façade route (operational)
 *   - src/routes/files.ts          — File & Archive; reads drive_files as a source (operational)
 *   - src/routes/reports.ts        — report attachment download proxy (migration compatibility)
 *   - src/routes/risks.ts          — risk attachment download using drive_files (migration compatibility)
 *   - src/routes/projects.ts       — project document comment reference only (documentation)
 *   - src/lib/awsS3.ts             — the awsS3 utility itself
 *   - src/lib/attachmentReconciliation.ts — reconciliation scan (storage admin only)
 *   - src/lib/storageEvidenceInventory.ts — inventory narrative (documentation)
 *   - src/lib/run-migrations.ts    — migration SQL includes drive_files schema
 *
 * This test does NOT check:
 *   - Historical import routes (src/routes/historical-storage-import.ts) — that
 *     file is the explicitly scoped administrative importer and is excluded.
 *   - Test files themselves (*.test.ts) — mocks and assertions may reference
 *     these identifiers.
 *
 * British English spelling used throughout (per project convention).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";

// ── Allowed-list ─────────────────────────────────────────────────────────────

/**
 * Source files that are explicitly permitted to contain operational
 * Drive/awsS3 references, identified by their basename within src/.
 * Each entry must have a documented justification above.
 */
const PERMITTED_OPERATIONAL_FILES = new Set([
  "drive.ts",
  "files.ts",
  "reports.ts",
  "risks.ts",
  "projects.ts",
  "awsS3.ts",
  "attachmentReconciliation.ts",
  "attachment-reconciliation.ts",
  "storageEvidenceInventory.ts",
  "run-migrations.ts",
  "historical-storage-import.ts",
]);

/**
 * Identifiers that constitute operational Drive/awsS3 usage.
 * A file is considered a violation if it contains ANY of these outside the
 * permitted list.
 */
const OPERATIONAL_IDENTIFIERS = [
  "from \"../lib/awsS3\"",
  "from \"./awsS3\"",
  "from \"../../lib/awsS3\"",
  "FROM drive_files",
  "INTO drive_files",
  "UPDATE drive_files",
  "DELETE FROM drive_files",
  "drive_files WHERE",
  "drive_files df",
];

/**
 * These Google Drive / legacy alias identifiers must not appear in any
 * user-facing or operational contract files (schema, form components,
 * API client, or route DTOs outside the permitted set).
 */
const BANNED_USER_FACING_IDENTIFIERS = [
  "googleDriveFileId",
  "googleDriveUrl",
  "google_drive_file_id",
  "google_drive_url",
];

/**
 * User-facing contract files that must never contain Drive-specific
 * operational identifiers.
 */
const CONTRACT_FILES = [
  join(process.cwd(), "../../lib/api-spec/openapi.yaml"),
  join(process.cwd(), "../../lib/api-client-react/src/generated/api.schemas.ts"),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      results.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DRIVE-GUARD-01: awsS3 imports are confined to permitted files", () => {
  const sourceRoot = join(process.cwd(), "src");
  const allFiles = collectSourceFiles(sourceRoot);

  for (const filePath of allFiles) {
    const name = basename(filePath);
    if (PERMITTED_OPERATIONAL_FILES.has(name)) continue;

    it(`${name} must not import from awsS3`, () => {
      const src = readFileSync(filePath, "utf8");
      const hasAwsS3Import = src.includes('from "../lib/awsS3"') ||
        src.includes('from "./awsS3"') ||
        src.includes('from "../../lib/awsS3"') ||
        src.includes("require(\"../lib/awsS3\")") ||
        src.includes("require('./awsS3')");
      expect(hasAwsS3Import).toBe(false);
    });
  }
});

describe("DRIVE-GUARD-02: drive_files SQL is confined to permitted files", () => {
  const sourceRoot = join(process.cwd(), "src");
  const allFiles = collectSourceFiles(sourceRoot);

  for (const filePath of allFiles) {
    const name = basename(filePath);
    if (PERMITTED_OPERATIONAL_FILES.has(name)) continue;

    it(`${name} must not contain drive_files SQL outside permitted files`, () => {
      const src = readFileSync(filePath, "utf8");
      const violations = OPERATIONAL_IDENTIFIERS.filter((id) => src.includes(id));
      expect(violations).toEqual([]);
    });
  }
});

describe("DRIVE-GUARD-03: googleDriveFileId / googleDriveUrl banned from user-facing contracts", () => {
  it("openapi.yaml ProjectDocumentInput must not contain googleDriveFileId or googleDriveUrl", () => {
    const yamlSrc = readFileSync(CONTRACT_FILES[0], "utf8");
    for (const id of BANNED_USER_FACING_IDENTIFIERS) {
      expect(yamlSrc, `openapi.yaml must not contain ${id}`).not.toContain(id);
    }
  });

  it("generated api.schemas.ts must not contain googleDriveFileId or googleDriveUrl", () => {
    const schemaSrc = readFileSync(CONTRACT_FILES[1], "utf8");
    for (const id of BANNED_USER_FACING_IDENTIFIERS) {
      expect(schemaSrc, `api.schemas.ts must not contain ${id}`).not.toContain(id);
    }
  });

  it("openapi.yaml ProjectDocumentInput must not expose driveFileId as a public field", () => {
    const yamlSrc = readFileSync(CONTRACT_FILES[0], "utf8");
    const projectDocInputBlock = yamlSrc.slice(
      yamlSrc.indexOf("ProjectDocumentInput:"),
      yamlSrc.indexOf("VoiceNote:"),
    );
    expect(projectDocInputBlock, "ProjectDocumentInput must not contain driveFileId").not.toContain("driveFileId");
  });

  it("generated api.schemas.ts ProjectDocumentInput must not expose driveFileId", () => {
    const schemaSrc = readFileSync(CONTRACT_FILES[1], "utf8");
    const projectDocInputBlock = schemaSrc.slice(
      schemaSrc.indexOf("export interface ProjectDocumentInput"),
      schemaSrc.indexOf("export interface ProjectIndicatorInput"),
    );
    expect(projectDocInputBlock, "ProjectDocumentInput must not contain driveFileId").not.toContain("driveFileId");
  });
});

describe("DRIVE-GUARD-04: project-registration-form must not contain googleDriveFileId or googleDriveUrl", () => {
  it("project-registration-form.tsx must not contain googleDriveFileId", () => {
    const formSrc = readFileSync(
      join(process.cwd(), "../../artifacts/cafa-pmis/src/components/project-registration-form.tsx"),
      "utf8",
    );
    expect(formSrc).not.toContain("googleDriveFileId");
    expect(formSrc).not.toContain("googleDriveUrl");
  });
});

describe("DRIVE-GUARD-05: pages/drive.tsx must not exist as a user-facing page", () => {
  it("pages/drive.tsx has been removed", () => {
    const { existsSync } = require("node:fs");
    const drivePage = join(process.cwd(), "../../artifacts/cafa-pmis/src/pages/drive.tsx");
    expect(existsSync(drivePage), "pages/drive.tsx must be removed (use LegacyFilesRedirect in App.tsx instead)").toBe(false);
  });
});

describe("DRIVE-GUARD-06: published storage documents describe the cutover", () => {
  for (const docName of [
    "FILE_ARCHIVE_IMPLEMENTATION_AUDIT.md",
    "FILE_ARCHIVE_RECONCILIATION_REGISTER.md",
  ]) {
    it(`docs/${docName} documents canonical storage and historical reconciliation`, () => {
      const docPath = join(process.cwd(), "../../docs", docName);
      const source = readFileSync(docPath, "utf8");
      expect(source.toLowerCase()).toContain("historical");
      expect(source.toLowerCase()).toContain("canonical");
      expect(source).not.toContain("/api/drive");
    });
  }

  it("removes the obsolete pre-cutover dependency inventory", () => {
    const { existsSync } = require("node:fs");
    expect(existsSync(join(process.cwd(), "../../docs/LEGACY_STORAGE_DEPENDENCY_INVENTORY.md"))).toBe(false);
  });
});

describe("DRIVE-GUARD-07: active routes use only canonical object storage", () => {
  const activeRoutes = [
    "attachments.ts",
    "files.ts",
    "reports.ts",
    "risks.ts",
    "projects.ts",
  ];

  it("does not mount the retired Drive router and mounts the isolated historical importer after authentication", () => {
    const indexSource = readFileSync(join(process.cwd(), "src/routes/index.ts"), "utf8");
    expect(indexSource).not.toMatch(/import\s+driveRouter\s+from/);
    expect(indexSource).not.toMatch(/router\.use\(driveRouter\)/);
    expect(indexSource.indexOf("router.use(historicalStorageImportRouter)")).toBeGreaterThan(
      indexSource.indexOf("router.use(requireAuth)"),
    );
  });

  for (const routeName of activeRoutes) {
    it(`${routeName} has no Drive façade, legacy table, or historical-import credential dependency`, () => {
      const source = readFileSync(join(process.cwd(), "src/routes", routeName), "utf8");
      expect(source).not.toMatch(/\bdrive_files\b|drive_file_id|driveFileId|awsS3|downloadFileStream/);
      expect(source).not.toMatch(/HISTORICAL_IMPORT_S3_|HISTORICAL_IMPORT_/);
    });
  }

  it("keeps historical provider configuration and AWS SDK construction inside the importer only", () => {
    const importer = readFileSync(join(process.cwd(), "src/routes/historical-storage-import.ts"), "utf8");
    expect(importer).toContain("new S3Client");
    expect(importer).toContain("function legacyClient()");
    expect(importer).toContain('requirePerm("storage.admin")');
    expect(importer).toContain('new Set(["super_admin", "executive_director"])');
  });
});
