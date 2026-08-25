export const FILE_ARCHIVE_PATH = "/document-management/file-archive";

export type FileArchiveSource = "all" | "resource" | "project" | "plan" | "report";
export type FileArchiveStatus = "active" | "archived" | "deleted" | "all";
export type FileArchiveViewMode = "table" | "card" | "compact";

export function isFileArchiveViewMode(value: string | null | undefined): value is FileArchiveViewMode {
  return value === "table" || value === "card" || value === "compact";
}

export type FileArchiveRouteContext = {
  search: string;
  source: FileArchiveSource;
  status: FileArchiveStatus;
  classification: string;
  view: FileArchiveViewMode;
};

const MAX_QUERY_VALUE_LENGTH = 200;

export function archiveQueryValue(search: string, key: string): string | null {
  const value = new URLSearchParams(search).get(key);
  return value && value.length <= MAX_QUERY_VALUE_LENGTH ? value : null;
}

export function getFileArchiveRouteContext(search: string): FileArchiveRouteContext {
  const source = archiveQueryValue(search, "source");
  const status = archiveQueryValue(search, "status");
  const view = archiveQueryValue(search, "view");

  return {
    search: archiveQueryValue(search, "search") ?? "",
    source: source === "resource" || source === "project" || source === "plan" || source === "report" ? source : "all",
    status: status === "active" || status === "archived" || status === "deleted" || status === "all"
      ? status
      : "active",
    classification: archiveQueryValue(search, "classification") ?? "all",
    view: isFileArchiveViewMode(view) ? view : "table",
  };
}

export type FileArchiveRoutePatch = Partial<FileArchiveRouteContext>;

export function buildFileArchiveLocation(
  currentLocation: string,
  patch: FileArchiveRoutePatch,
): string {
  const currentSearch = currentLocation.includes("?")
    ? currentLocation.slice(currentLocation.indexOf("?"))
    : "";
  const current = getFileArchiveRouteContext(currentSearch);
  const next = { ...current, ...patch };
  const nextView = isFileArchiveViewMode(next.view) ? next.view : "table";
  const params = new URLSearchParams();

  if (next.search.trim()) params.set("search", next.search.trim());
  if (next.source !== "all") params.set("source", next.source);
  if (next.status !== "active") params.set("status", next.status);
  if (next.classification !== "all") params.set("classification", next.classification);
  if (nextView !== "table") params.set("view", nextView);

  const pathname = currentLocation.split("?")[0] || FILE_ARCHIVE_PATH;
  const queryString = params.toString();
  return `${pathname}${queryString ? `?${queryString}` : ""}`;
}

export function legacyFileArchiveRedirect(
  search: string,
  source?: Exclude<FileArchiveSource, "all">,
): string {
  const params = new URLSearchParams();
  if (source) params.set("source", source);

  for (const key of ["search", "status", "classification", "view"]) {
    const value = archiveQueryValue(search, key);
    if (value && (key !== "view" || isFileArchiveViewMode(value))) params.set(key, value);
  }

  const queryString = params.toString();
  return `${FILE_ARCHIVE_PATH}${queryString ? `?${queryString}` : ""}`;
}