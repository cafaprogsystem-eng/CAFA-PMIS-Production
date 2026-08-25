export type ArchiveLifecycleItem = {
  source: "resource" | "project" | "plan" | "report";
  canManageArchiveLifecycle: boolean;
};

/**
 * The API calculates this non-sensitive capability from canonical linkage.
 * The UI must not infer ownership from the visible record ID because older
 * linked attachments can use project_id without a record_id.
 */
export function canManageArchiveLifecycle(
  item: ArchiveLifecycleItem,
  userCanManageArchive: boolean,
): boolean {
  return userCanManageArchive && item.source === "resource" && item.canManageArchiveLifecycle;
}