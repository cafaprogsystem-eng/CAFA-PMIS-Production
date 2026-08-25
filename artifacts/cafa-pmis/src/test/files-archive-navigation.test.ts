import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFileArchiveLocation,
  FILE_ARCHIVE_PATH,
  getFileArchiveRouteContext,
  legacyFileArchiveRedirect,
} from "../lib/file-archive-route";
import { canManageArchiveLifecycle } from "../lib/file-archive-lifecycle";

const root = join(process.cwd(), "src");
const app = readFileSync(join(root, "App.tsx"), "utf8");
const layout = readFileSync(join(root, "components/layout.tsx"), "utf8");
const palette = readFileSync(join(root, "components/command-palette.tsx"), "utf8");
const page = readFileSync(join(root, "pages/files.tsx"), "utf8");
const enNav = JSON.parse(readFileSync(join(root, "locales/en/nav.json"), "utf8"));
const arNav = JSON.parse(readFileSync(join(root, "locales/ar/nav.json"), "utf8"));
const enKnowledge = JSON.parse(readFileSync(join(root, "locales/en/knowledge.json"), "utf8"));
const arKnowledge = JSON.parse(readFileSync(join(root, "locales/ar/knowledge.json"), "utf8"));

describe("FILE-FUNC / FILE-VIS — File & Archive workspace", () => {
  it("DOC-NAV-01/02/03 — has one canonical route with safe one-way legacy redirects", () => {
    expect(app).toContain('<Route path="/document-management/file-archive" component={FilesPage} />');
    expect(app).toContain('<Route path="/document-management"><Redirect to={FILE_ARCHIVE_PATH} /></Route>');
    expect(app).toContain('<Route path="/files"><LegacyFilesRedirect /></Route>');
    expect(app).toContain('<Route path="/drive"><LegacyFilesRedirect /></Route>');
    expect(app).toContain('<LegacyFilesRedirect source="resource" />');
    expect(app).toContain('window.location.search');
    expect(app).toContain('legacyFileArchiveRedirect(');
    expect(app).not.toContain('component={DrivePage}');
    expect(app).not.toContain('component={ProgramResourcesPage}');
  });

  it("DOC-NAV-03 — carries the allowed legacy context into both the canonical URL and workspace filters", () => {
    const filesTarget = legacyFileArchiveRedirect("?search=policy&unexpected=https://example.com");
    const legacyTarget = legacyFileArchiveRedirect("?status=archived&bad=1");
    const resourcesTarget = legacyFileArchiveRedirect("?search=test&bad=1", "resource");

    expect(filesTarget).toBe(`${FILE_ARCHIVE_PATH}?search=policy`);
    expect(getFileArchiveRouteContext(new URL(filesTarget, "https://cafa-pmis.invalid").search)).toEqual({
      search: "policy", source: "all", status: "active", classification: "all", view: "table",
    });
    expect(legacyTarget).toBe(`${FILE_ARCHIVE_PATH}?status=archived`);
    expect(getFileArchiveRouteContext(new URL(legacyTarget, "https://cafa-pmis.invalid").search)).toEqual({
      search: "", source: "all", status: "archived", classification: "all", view: "table",
    });
    expect(resourcesTarget).toBe(`${FILE_ARCHIVE_PATH}?source=resource&search=test`);
    expect(getFileArchiveRouteContext(new URL(resourcesTarget, "https://cafa-pmis.invalid").search)).toEqual({
      search: "test", source: "resource", status: "active", classification: "all", view: "table",
    });
    expect(page).toContain('getFileArchiveRouteContext(');
    expect(page).toContain("useSearch");
    expect(page).toContain("buildFileArchiveLocation");
    expect(page).toContain('rawSearch.startsWith("?") ? rawSearch : `?${rawSearch}`');
  });

  it("DATA-NAV-01…08 — renders a permission-aware DATA MANAGEMENT label with a direct archive link", () => {
    const dataManagement = layout.slice(layout.indexOf('title: tNav("groups.dataManagement")'), layout.indexOf('title: tNav("groups.administration")'));
    const administrationItems = layout.slice(layout.indexOf("const administrationItems"), layout.indexOf("const navEntries"));
    const navEntries = layout.indexOf("const navEntries");
    const administrationStart = layout.indexOf('title: tNav("groups.administration")', navEntries);
    const administration = layout.slice(administrationStart, layout.indexOf('kind: "item"', administrationStart));
    expect(dataManagement).toContain('title: tNav("groups.dataManagement")');
    expect(dataManagement).toContain("items: canViewFileArchive");
    expect(dataManagement).toContain('href: "/document-management/file-archive"');
    expect(dataManagement).toContain('label: tNav("items.fileArchive")');
    expect(dataManagement).not.toContain('href: "/document-management"');
    expect(dataManagement).not.toContain("children:");
    expect(dataManagement).not.toContain("ChevronDown");
    expect(layout).toContain('const canViewFileArchive = myPerms.includes("*")');
    expect(layout).toContain('myPerms.includes("program_resources.view")');
    expect(layout).toContain('myPerms.includes("documents.view")');
    expect((dataManagement.match(/href: "\/document-management\/file-archive"/g) ?? []).length).toBe(1);
    expect(palette).toContain('id: "nav-/document-management/file-archive"');
    expect(palette).toContain('href: "/document-management/file-archive"');
    expect(palette).toContain("if (canViewFileArchive)");
    expect(palette).not.toContain('id: "nav-/sops"');
    expect(palette).not.toContain('id: "nav-/drive"');
    expect(palette).not.toContain('href: "/files"');

    const userManagement = administrationItems.indexOf('href: "/users"');
    const states = administrationItems.indexOf('href: "/states"');
    const auditLog = administrationItems.indexOf('href: "/audit-log"');
    const ai = administrationItems.indexOf('href: "/ai"');
    expect(layout).not.toContain('groups.knowledgeSupport');
    expect(administrationItems).toContain('href: "/ai"');
    expect(administrationItems).toContain('label: tNav("items.ai")');
    expect(administrationItems).not.toContain('onClick: () => document.dispatchEvent(new CustomEvent("open-ai-chat"))');
    expect(administration).not.toContain('href: "/ai-settings"');
    expect(userManagement).toBeLessThan(states);
    expect(states).toBeLessThan(auditLog);
    expect(auditLog).toBeLessThan(ai);
    expect(administration).not.toContain('href: "/design-system"');
  });

  it("FILE-CLASS-VIS-01…08 / FILE-UPLOAD-VIS-01…10 — provides translated, accessible archive refinements", () => {
    expect(enNav.groups.dataManagement).toBe("Data Management");
    expect(arNav.groups.dataManagement).toBe("إدارة البيانات");
    expect(enNav.items.documentManagement).toBeUndefined();
    expect(arNav.items.documentManagement).toBeUndefined();
    expect(enNav.items.fileArchive).toBe("File & Archive");
    expect(arNav.items.fileArchive).toBe("الملفات والأرشيف");
    expect(enNav.items.sopsResources).toBeUndefined();
    expect(enNav.items.documentRepository).toBeUndefined();
    expect(arNav.items.sopsResources).toBeUndefined();
    expect(arNav.items.documentRepository).toBeUndefined();
    expect(enNav.cmdSubtitles.sopsResources).toBeUndefined();
    expect(enNav.cmdSubtitles.documentRepository).toBeUndefined();
    expect(arNav.cmdSubtitles.sopsResources).toBeUndefined();
    expect(arNav.cmdSubtitles.documentRepository).toBeUndefined();
    expect(layout).not.toContain('"/document-management": "Document Management"');
    expect(layout).toContain('"/document-management/file-archive": "File & Archive"');
    expect(layout).toContain('const segments = location.split("/").filter(Boolean);');
    expect(layout).toContain('const label = routeTitleMap[built]');
    expect(arKnowledge.fileArchive.title).toBe("الملفات والأرشيف");
    expect(page).toContain('t("fileArchive.uploadDocument")');
    expect(page).toContain('(["total", "active", "archived"] as const)');
    expect(page).toContain('grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[272px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]');
    expect(page).toContain('data-file-archive-workspace');
    expect(page).toContain('data-classification-rail');
    expect(page).toContain('rounded-lg border bg-card p-3.5 lg:flex');
    expect(page).toContain('lg:h-full');
    expect(page).toContain('role="region"');
    expect(page).toContain('tabIndex={0}');
    expect(page).toContain('min-h-0 flex-1 space-y-1 overflow-y-auto');
    expect(page).toContain('data-selected-classification={selected ? "true" : undefined}');
    expect(page).toContain('const rail = classificationRailRef.current;');
    expect(page).toContain('revealedClassificationRef.current === classification');
    expect(page).toContain('rail.scrollTop += rowBounds.bottom - railBounds.bottom;');
    expect(page).not.toContain('scrollIntoView');
    expect(page).toContain('break-words leading-4 line-clamp-2');
    expect(page).toContain('selectLifecycle("all")');
    expect(page).toContain('selectLifecycle("archived")');
    expect(page).toContain("groupedClassifications");
    expect(page).toContain("CLASSIFICATION_PRESENTATION");
    expect(page).toContain('colour: "text-');
    expect(page).not.toContain('max-h-[min(64vh,560px)]');
    expect(page).not.toContain('min-h-[calc(100dvh-15rem)]');
    expect(page).toContain('classificationLabel(option.name)');
    expect(page).toContain('pageSize: String(pageSize)');
    expect(page).toContain('queryKey: ["files", "classifications", status, source, search, sectorFilter, confidentialityFilter]');
    expect(page).toContain('isOutOfRangePage');
    expect(page).toContain('canManageArchiveItem');
    expect(page).toContain("canManageArchiveLifecycle(item as ArchiveLifecycleItem, canManageArchive)");
    expect(page).toContain('paginationSummary');
    expect(page).toContain('files.refetch()');
    expect(page).toContain('emptyArchive');
    expect(page).toContain('emptyClassification');
    expect(page).toContain('emptyFiltered');
    expect(page).toContain('aria-pressed={isAllDocumentsView}');
    expect(page).toContain('bg-primary text-primary-foreground');
    expect(page).toContain('w-9 shrink-0 text-end text-xs tabular-nums');
    expect(page).toContain('aria-busy={files.isLoading}');
    expect(page).toContain('aria-label={t("fileArchive.repositoryLabel")}');
    expect(page).toContain('className="hidden overflow-x-auto md:block"');
    expect(page).toContain('className="space-y-2 p-3 md:hidden"');
    expect(page).toContain('min-w-[1160px]');
    expect(page).toContain('t("fileArchive.reference")');
    expect(page).toContain('data-archive-actions-column');
    expect(page).toContain('w-[144px] min-w-[144px]');
    expect(page).toContain('justify-end gap-0.5 whitespace-nowrap');
    expect(page).toContain('min-w-[144px] text-end');
    expect(page).toContain('data-classification-taxonomy');
    expect(page).toContain('data-archive-registry-body');
    expect(page).toContain('lg:flex-1 lg:overflow-y-auto');
    expect(page).toContain('bg-card lg:flex lg:flex-col');
    expect(page).toContain('confidentialityVariant(item.confidentiality)');
    expect(page).toContain('item.reference ?? "—"');
    expect(page).toContain('item.tags.slice(0, 2)');
    expect(page).toContain('t("fileArchive.moreTags"');
    expect(page).toContain('t("fileArchive.viewDocument"');
    expect(page).toContain('t("fileArchive.downloadDocument"');
    expect(page).toContain('className="lg:hidden"');
    expect(page).toContain('__archived_lifecycle__');
    expect(page).toContain("<AlertDialog");
    expect(page).toContain('i18n.language === "ar" ? "ar" : "en-GB"');
    expect(page).toContain("max-h-[calc(100dvh-2rem)]");
    expect(page).toContain("max-w-2xl");
    expect(page).toContain('max-w-2xl flex flex-col overflow-hidden');
    expect(page).toContain('<DialogHeader className="shrink-0">');
    expect(page).toContain('min-h-0 flex-1 overflow-y-auto pe-1 pb-1');
    expect(page).toContain('<DialogFooter className="shrink-0 border-t border-border/60 pt-4">');
    expect(page).toContain('t("fileArchive.changeFile")');
    expect(page).toContain('t("fileArchive.removeFile"');
    expect(page).toContain('htmlFor="archive-file-input"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain('aria-live="assertive"');
    expect(page).toContain('invalidateQueries({ queryKey: ["files"] })');
    expect(page).toContain('mutation.isPending');
    expect(page).toContain("confidentiality");
    expect(page).not.toContain("department");

    const desktopTableStart = page.indexOf('<Table className="min-w-[1160px]">');
    const desktopTableEnd = page.indexOf('</Table>', desktopTableStart);
    const desktopTable = page.slice(desktopTableStart, desktopTableEnd);
    const desktopHeaders = [
      't("fileArchive.reference")',
      't("fileArchive.titleLabel")',
      't("fileArchive.classification")',
      't("fileArchive.confidentiality")',
      't("fileArchive.sector")',
      't("fileArchive.date")',
      't("fileArchive.status")',
      't("fileArchive.actions")',
    ];
    let headerOffset = -1;
    for (const header of desktopHeaders) {
      const nextOffset = desktopTable.indexOf(header);
      expect(nextOffset).toBeGreaterThan(headerOffset);
      headerOffset = nextOffset;
    }
    expect(desktopTable).not.toContain("versionShort");
    expect(desktopTable).not.toContain("item.versionLabel");
    expect(page).toContain('t("fileArchive.version")');
    expect(page).toContain('t("fileArchive.versionHistory")');
    expect(page).toContain('item.versionLabel ?? "—"');

    for (const key of ["reference", "versionShort", "allSectors", "allConfidentiality", "source", "moreTags", "viewDocument", "downloadDocument"] as const) {
      expect(enKnowledge.fileArchive[key]).toEqual(expect.any(String));
      expect(arKnowledge.fileArchive[key]).toEqual(expect.any(String));
    }
    expect(page).toContain("fileArchive.sourceValues.${item.sourceKind}");
    expect(enKnowledge.fileArchive.sourceValues).toEqual(expect.objectContaining({ direct_upload: "Direct upload", report_attachment: "Report attachment" }));
    expect(arKnowledge.fileArchive.sourceValues).toEqual(expect.objectContaining({ direct_upload: "رفع مباشر", report_attachment: "مرفق تقرير" }));
  });

  it("FILE-UPLOAD-FORM — keeps the approved record form order, structure, metadata payload, and accessible upload states", () => {
    const titleIndex = page.indexOf('id="archive-title"');
    const descriptionIndex = page.indexOf('id="archive-description"');
    const classificationIndex = page.indexOf('id="archive-classification"');
    const confidentialityIndex = page.indexOf('id="archive-confidentiality"');
    const sectorIndex = page.indexOf('id="archive-sector"');
    const retentionIndex = page.indexOf('id="archive-retention"');
    const tagsIndex = page.indexOf('id="archive-tags"');
    const fileIndex = page.indexOf('id="archive-file-input"');

    expect(titleIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeLessThan(descriptionIndex);
    expect(descriptionIndex).toBeLessThan(classificationIndex);
    expect(classificationIndex).toBeLessThan(confidentialityIndex);
    expect(confidentialityIndex).toBeLessThan(sectorIndex);
    expect(sectorIndex).toBeLessThan(retentionIndex);
    expect(retentionIndex).toBeLessThan(tagsIndex);
    expect(tagsIndex).toBeLessThan(fileIndex);
    expect(page).toContain('<Textarea id="archive-description"');
    expect(page).toContain('className="grid gap-4 sm:grid-cols-2"');
    expect((page.match(/className="grid gap-4 sm:grid-cols-2"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('min-h-[11rem]');
    expect(page).toContain('onDrop={(event) =>');
    expect(page).toContain('aria-describedby="archive-file-guidance"');
    expect(page).toContain('role="alert" aria-live="assertive"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain('fetch("/api/storage/uploads/request-url"');
    expect(page).toContain('scope: "documents"');
    expect(page).toContain('const storageResponse = await fetch(descriptor.uploadURL');
    expect(page).toContain('method: "PUT"');
    expect(page).toContain('fetch("/api/files/upload"');
    expect(page).toContain('objectPath: descriptor.objectPath');
    expect(page).toContain('fileName: file.name');
    expect(page).toContain('tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean)');
    expect(page).toContain('fetch(`/api/files/resource/${item.id}/replace`');
  });

  it("FILE-UPLOAD-VIEWPORT — keeps the header and actions visible while only the form body scrolls", () => {
    const uploadDialog = page.slice(page.indexOf("function UploadDialog"), page.indexOf("function DetailDialog"));
    const headerIndex = uploadDialog.indexOf('<DialogHeader className="shrink-0">');
    const bodyIndex = uploadDialog.indexOf('min-h-0 flex-1 overflow-y-auto pe-1 pb-1');
    const footerIndex = uploadDialog.indexOf('<DialogFooter className="shrink-0 border-t border-border/60 pt-4">');

    expect(uploadDialog).toContain('max-h-[calc(100dvh-2rem)]');
    expect(uploadDialog).toContain('max-w-2xl flex flex-col overflow-hidden');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(bodyIndex);
    expect(bodyIndex).toBeLessThan(footerIndex);
    expect((uploadDialog.match(/overflow-y-auto/g) ?? [])).toHaveLength(1);
    expect(uploadDialog).toContain('pe-1 pb-1');
  });

  it("FILE-UPLOAD-I18N — resolves every upload label, placeholder, option, guidance message, error, and action in English and Arabic", () => {
    const requiredKeys = [
      "uploadDocument", "uploadTitle", "uploadDescription", "titleLabel", "titlePlaceholder",
      "descriptionLabel", "descriptionPlaceholder", "classification", "selectClassification",
      "confidentiality", "sector", "selectSector", "retentionYears", "tags", "tagsPlaceholder",
      "fileLabel", "selectFile", "fileGuidance", "changeFile", "removeFile", "unknownFileType",
      "uploading", "uploadSuccess", "cancel",
    ] as const;

    for (const key of requiredKeys) {
      expect(enKnowledge.fileArchive[key]).toEqual(expect.any(String));
      expect(arKnowledge.fileArchive[key]).toEqual(expect.any(String));
    }
    for (const failure of ["file_required", "file_too_large", "file_type_not_allowed", "forbidden", "upload_failed"]) {
      expect(enKnowledge.fileArchive.uploadErrors[failure]).toEqual(expect.any(String));
      expect(arKnowledge.fileArchive.uploadErrors[failure]).toEqual(expect.any(String));
    }
    expect(enKnowledge.fileArchive.titlePlaceholder).toBe("Document title");
    expect(enKnowledge.fileArchive.descriptionPlaceholder).toBe("Brief description of the document");
    expect(enKnowledge.fileArchive.confidentiality).toBe("Confidentiality Level");
    expect(enKnowledge.fileArchive.retentionYears).toBe("Retention (Years)");
    expect(enKnowledge.fileArchive.tags).toBe("Tags (comma-separated)");
    expect(enKnowledge.fileArchive.fileGuidance).not.toMatch(/\b(?:PDF|DOCX|50 MB)\b/);
    expect(arKnowledge.fileArchive.titlePlaceholder).toBe("عنوان الوثيقة");
    expect(arKnowledge.fileArchive.descriptionPlaceholder).toBe("وصف موجز للوثيقة");
    expect(Object.keys(enKnowledge.fileArchive.classificationValues)).toHaveLength(16);
    expect(Object.keys(arKnowledge.fileArchive.classificationValues)).toHaveLength(16);
    expect(Object.keys(enKnowledge.fileArchive.sectorValues)).toHaveLength(7);
    expect(Object.keys(arKnowledge.fileArchive.sectorValues)).toHaveLength(7);
  });

  it("FILE-CLASS-VIS-04/05 — persists a classification while intersecting source, lifecycle, and search filters", () => {
    const current = `${FILE_ARCHIVE_PATH}?search=annual&source=report&status=archived`;
    expect(buildFileArchiveLocation(current, { classification: "reports" })).toBe(
      `${FILE_ARCHIVE_PATH}?search=annual&source=report&status=archived&classification=reports`,
    );
    expect(getFileArchiveRouteContext("?classification=reports&source=report&status=archived")).toEqual({
      search: "", source: "report", status: "archived", classification: "reports", view: "table",
    });
    expect(buildFileArchiveLocation(`${FILE_ARCHIVE_PATH}?classification=reports`, { status: "deleted" })).toBe(
      `${FILE_ARCHIVE_PATH}?status=deleted&classification=reports`,
    );
  });

  it("FILE-VIEW-01/02 — bounds the URL-backed presentation while preserving supported registry context", () => {
    const current = `${FILE_ARCHIVE_PATH}?search=annual&source=report&status=archived&classification=Programme+Reports&unexpected=drop`;
    expect(buildFileArchiveLocation(current, { view: "card" })).toBe(
      `${FILE_ARCHIVE_PATH}?search=annual&source=report&status=archived&classification=Programme+Reports&view=card`,
    );
    expect(buildFileArchiveLocation(`${current}&view=card`, { view: "compact" })).toBe(
      `${FILE_ARCHIVE_PATH}?search=annual&source=report&status=archived&classification=Programme+Reports&view=compact`,
    );
    expect(buildFileArchiveLocation(`${current}&view=card`, { view: "table" })).toBe(
      `${FILE_ARCHIVE_PATH}?search=annual&source=report&status=archived&classification=Programme+Reports`,
    );
    expect(getFileArchiveRouteContext("?view=kanban&classification=Programme+Reports")).toEqual({
      search: "", source: "all", status: "active", classification: "Programme Reports", view: "table",
    });
  });

  it("FILE-VIEW-03…08 — branches the same result shell into Table, Grid/Card, and Compact List without changing registry authority", () => {
    expect(page).toContain('<ViewModeSwitcher available={["table", "card", "compact"]}');
    expect(page).toContain('current={view}');
    expect(page).toContain('view === "table"');
    expect(page).toContain('data-archive-card-grid');
    expect(page).toContain('data-archive-card');
    expect(page).toContain('data-archive-compact-list');
    expect(page).toContain('data-archive-compact-row');
    expect(page).toContain('actions={actionsFor(item)}');
    expect(page).toContain('actionsFor={actionsFor}');
    expect(page).toContain('onView={setDetail}');
    expect(page).toContain('fileTypeLabel(item');
    expect(page).toContain("FileSpreadsheet");
    expect(page).toContain('fileIcon(item.contentType, item.fileName)');
    expect(page).toContain('["csv", "xls", "xlsx"].includes(extension ?? "")');
    expect(page).toContain('sourceContext');
    expect(page).toContain('const queryKey = ["files", searchParams.toString()];');
    expect(page).not.toContain('view, page, pageSize');
    expect(page).toContain('data-classification-rail');
    expect(page).toContain('data-classification-taxonomy');
    expect(page).toContain('paginationSummary');
  });

  it("FILE-SEC — exposes lifecycle controls only for authorised canonical resources", () => {
    expect(canManageArchiveLifecycle({
      source: "resource",
      canManageArchiveLifecycle: false,
    }, true)).toBe(false);
    expect(canManageArchiveLifecycle({
      source: "resource",
      canManageArchiveLifecycle: true,
    }, true)).toBe(true);
    expect(canManageArchiveLifecycle({
      source: "project",
      canManageArchiveLifecycle: true,
    }, true)).toBe(false);
  });
});