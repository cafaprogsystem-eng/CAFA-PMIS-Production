import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Chip, Skeleton, Spinner, Tooltip } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { ConfirmModal } from "@/components/confirm-modal";
import { formatDate } from "@/lib/format";
import {
  Upload, FileText, FileImage, FileSpreadsheet, Trash2,
  Download, ExternalLink, Paperclip,
} from "@/components/icons";

/**
 * Plan and risk files use the canonical descriptor → object upload → finalise
 * contract. Storage identities remain server-side throughout this component.
 */
export type DriveModule =
  | "projects" | "project_reports" | "state_reports" | "hq_reports"
  | "plans" | "risks" | "budget" | "users" | "manual"
  | "attachments";

export type AttachmentModule = "plans" | "risks";

/** Endpoint paths are plural, while the canonical descriptor contract is singular. */
function attachmentParentType(module: AttachmentModule): "plan" | "risk" {
  return module === "plans" ? "plan" : "risk";
}

export interface CanonicalAttachment {
  id: number;
  parentType: AttachmentModule;
  parentId: number;
  fileName: string;
  contentType: string;
  size: number;
  status: "active" | "archived" | "deleted" | string;
  availabilityStatus: "available" | "unavailable" | string;
  versionNumber: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

/** @deprecated Use CanonicalAttachment. Kept for existing consumers/tests. */
export type DriveFile = CanonicalAttachment;

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.zip,.txt,.csv";
const BLOCKED_EXTENSIONS = new Set([
  "exe", "js", "sh", "bat", "php", "html", "htm", "mjs", "cjs", "py", "rb",
]);
const MAX_MB = 20;
const MAX_BYTES = MAX_MB * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return <FileImage className="size-4 shrink-0 text-sky-600" aria-hidden="true" />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) {
    return <FileSpreadsheet className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  }
  return <FileText className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />;
}

function blockedByExtension(name: string) {
  return BLOCKED_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

export function attachmentQueryKey(module: AttachmentModule, recordId: number | undefined) {
  return ["attachments", module, recordId ?? null] as const;
}

/** Compatibility key for list badges; it no longer names a Drive request. */
export function driveFilesQueryKey(module: DriveModule, recordId: number | undefined) {
  return attachmentQueryKey(module === "risks" ? "risks" : "plans", recordId);
}

async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
  return body.message ?? body.error ?? fallback;
}

export function useDriveAttachmentCount(module: DriveModule, recordId: number | undefined): number {
  const canonicalModule: AttachmentModule = module === "risks" ? "risks" : "plans";
  const { data } = useQuery<{ items: CanonicalAttachment[] }>({
    queryKey: attachmentQueryKey(canonicalModule, recordId),
    queryFn: async () => {
      if (!recordId) return { items: [] };
      const response = await fetch(`/api/${canonicalModule}/${recordId}/attachments`, { credentials: "include" });
      if (!response.ok) return { items: [] };
      return response.json() as Promise<{ items: CanonicalAttachment[] }>;
    },
    enabled: !!recordId && (module === "plans" || module === "risks"),
    staleTime: 60_000,
  });
  return data?.items.filter((item) => item.status !== "deleted").length ?? 0;
}

export function AttachmentCountBadge({
  module, recordId, className = "",
}: { module: DriveModule; recordId: number | undefined; className?: string }) {
  const count = useDriveAttachmentCount(module, recordId);
  if (!recordId || !count) return null;
  return (
    <Chip size="sm" variant="secondary" className={className} aria-label={String(count)}>
      <Paperclip className="size-3" aria-hidden="true" /> <span className="tabular-nums">{count}</span>
    </Chip>
  );
}

interface DriveAttachmentPanelProps {
  module: AttachmentModule;
  recordId: number | undefined;
  /** Kept for source compatibility. Parent scope is never sent by the client. */
  uploadMeta?: { projectId?: number; projectCode?: string; stateName?: string; sector?: string };
  canDelete?: boolean;
  canUpload?: boolean;
  label?: string;
  variant?: "compact" | "full";
}

export function DriveAttachmentPanel({
  module, recordId, canDelete = false, canUpload = true,
  label, variant = "full",
}: DriveAttachmentPanelProps) {
  const { t } = useTranslation("common");
  const heading = label ?? t("driveAttachment.title");
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<CanonicalAttachment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ items: CanonicalAttachment[] }>({
    queryKey: attachmentQueryKey(module, recordId),
    queryFn: async () => {
      if (!recordId) return { items: [] };
      const response = await fetch(`/api/${module}/${recordId}/attachments`, { credentials: "include" });
      if (!response.ok) throw new Error(await responseMessage(response, t("driveAttachment.loadFailed")));
      return response.json() as Promise<{ items: CanonicalAttachment[] }>;
    },
    enabled: !!recordId,
    staleTime: 30_000,
  });

  const files = data?.items ?? [];
  const isActive = !!recordId;

  async function handleFiles(picked: FileList | null) {
    if (!picked || !recordId) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error(t("sync.internetRequiredDescription"));
      return;
    }
    for (const file of Array.from(picked)) {
      if (blockedByExtension(file.name)) {
        toast.error(`${file.name} — ${t("driveAttachment.fileTypeNotAllowed")}`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} ${t("driveAttachment.fileTooLarge", { maxMb: MAX_MB })}`);
        continue;
      }
      setInFlight((current) => [...current, file.name]);
      try {
        const descriptorResponse = await fetch("/api/attachments/upload-descriptors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            parentType: attachmentParentType(module),
            parentId: recordId,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        if (!descriptorResponse.ok) {
          throw new Error(await responseMessage(descriptorResponse, t("driveAttachment.prepareFailed")));
        }
        const descriptor = await descriptorResponse.json() as {
          operationId: string; uploadURL: string; uploadToken: string;
        };
        const uploadResponse = await fetch(descriptor.uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!uploadResponse.ok) throw new Error(t("driveAttachment.transferFailed"));

        const finalizeResponse = await fetch(
          `/api/attachments/operations/${descriptor.operationId}/finalize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ uploadToken: descriptor.uploadToken }),
          },
        );
        if (!finalizeResponse.ok) {
          throw new Error(await responseMessage(finalizeResponse, t("driveAttachment.finalizeFailed")));
        }
        await qc.invalidateQueries({ queryKey: attachmentQueryKey(module, recordId) });
        toast.success(`${file.name} ${t("driveAttachment.uploaded")}`);
      } catch (error) {
        toast.error(t("driveAttachment.uploadFailed", {
          message: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setInFlight((current) => current.filter((name) => name !== file.name));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/attachments/${deleteTarget.id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("driveAttachment.couldNotRemove")));
      await qc.invalidateQueries({ queryKey: attachmentQueryKey(module, recordId) });
      toast.success(`${deleteTarget.fileName} ${t("driveAttachment.removed")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("driveAttachment.couldNotRemove"));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  function attachmentUrl(file: CanonicalAttachment, action: "download" | "preview") {
    return `/api/attachments/${file.id}/${action}`;
  }

  const hiddenInput = (
    <input ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden"
      aria-label={t("driveAttachment.attachFile")} onChange={(event) => handleFiles(event.target.files)} />
  );

  const unavailable = (file: CanonicalAttachment) => file.availabilityStatus === "unavailable";
  const open = (file: CanonicalAttachment, action: "download" | "preview") => {
    if (!unavailable(file)) window.open(attachmentUrl(file, action), "_blank", "noopener,noreferrer");
  };
  const iconButton = (tip: string, ariaLabel: string, onPress: () => void, icon: React.ReactNode, isDisabled = false, danger = false) => (
    <Tooltip delay={300}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={ariaLabel} isDisabled={isDisabled} onPress={onPress}
        className={danger ? "text-[var(--muted)] hover:text-[var(--danger)]" : undefined}>
        {icon}
      </Button>
      <Tooltip.Content>{tip}</Tooltip.Content>
    </Tooltip>
  );
  const actions = (file: CanonicalAttachment, compact = false) => (
    <div className="flex items-center justify-end gap-0.5">
      {iconButton(t("download"), t("driveAttachment.downloadFile"), () => open(file, "download"), <Download className="size-3.5" aria-hidden="true" />, unavailable(file))}
      {!compact && iconButton(t("driveAttachment.openFile"), t("driveAttachment.openFile"), () => open(file, "preview"), <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />, unavailable(file))}
      {canDelete && iconButton(t("remove"), t("driveAttachment.removeAttachment"), () => setDeleteTarget(file), <Trash2 className="size-3.5" aria-hidden="true" />, false, true)}
    </div>
  );
  const size = (bytes: number) => <bdi dir="ltr" className="tabular-nums">{formatBytes(bytes)}</bdi>;
  const countChip = files.length > 0 && (
    <Chip size="sm" variant="secondary"><Paperclip className="size-3" aria-hidden="true" /><span className="tabular-nums">{files.length}</span></Chip>
  );
  const uploadButton = (compact: boolean) => canUpload && isActive && (
    <Button size="sm" variant="outline" isDisabled={inFlight.length > 0} onPress={() => fileInputRef.current?.click()}>
      {inFlight.length ? <Spinner size="sm" aria-hidden="true" /> : <Upload className="size-3.5" aria-hidden="true" />}
      {compact ? t("add") : t("driveAttachment.attachFile")}
    </Button>
  );
  const deleteDialog = (
    <ConfirmModal
      isOpen={!!deleteTarget}
      title={t("driveAttachment.removeTitle")}
      message={<><bdi dir="ltr" className="font-medium">{deleteTarget?.fileName}</bdi> {t("driveAttachment.removeDesc")}</>}
      cancelLabel={t("cancel")}
      confirmLabel={t("remove")}
      isPending={deleting}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={handleDelete}
    />
  );

  const columns: DataGridColumn<CanonicalAttachment>[] = [
    { id: "file", header: t("driveAttachment.fileCol"), isRowHeader: true,
      cell: (file) => (
        <div className="flex min-w-0 items-center gap-2">
          {fileIcon(file.contentType)}
          <span dir="ltr" className="min-w-0 truncate text-sm font-medium rtl:text-end" title={file.fileName}>{file.fileName}</span>
          {file.versionNumber > 1 && <Chip size="sm" variant="tertiary" className="shrink-0"><bdi dir="ltr">v{file.versionNumber}</bdi></Chip>}
          {unavailable(file) && <Chip size="sm" variant="soft" color="danger" className="shrink-0">{t("driveAttachment.fileUnavailable")}</Chip>}
        </div>
      ) },
    { id: "size", header: t("driveAttachment.sizeCol"), width: 96, cell: (file) => <span className="text-xs text-[var(--muted)]">{size(file.size)}</span> },
    { id: "by", header: t("driveAttachment.uploadedByCol"), width: 140, cell: (file) => <span dir="auto" className="text-xs text-[var(--muted)]">{file.uploadedByName ?? "—"}</span> },
    { id: "date", header: t("driveAttachment.dateCol"), width: 112, cell: (file) => <span className="whitespace-nowrap text-xs text-[var(--muted)]"><bdi dir="ltr">{formatDate(file.uploadedAt)}</bdi></span> },
    { id: "actions", header: <span className="sr-only">{t("driveAttachment.actionsCol")}</span>, width: 120, cell: (file) => actions(file) },
  ];

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{heading}</span>
          {countChip}
          {uploadButton(true)}
          {hiddenInput}
        </div>
        {files.map((file) => (
          <div key={file.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--default)] px-2 py-1.5 text-xs">
            {fileIcon(file.contentType)}
            <span dir="ltr" className="min-w-0 flex-1 truncate rtl:text-end" title={file.fileName}>{file.fileName}</span>
            {unavailable(file) ? <span className="shrink-0 text-[var(--danger)]">{t("driveAttachment.fileUnavailable")}</span> : <span className="shrink-0 text-[var(--muted)]">{size(file.size)}</span>}
            {actions(file, true)}
          </div>
        ))}
        {inFlight.map((name) => <PendingFile key={name} name={name} compact />)}
        {deleteDialog}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">{heading}</h4>
          {countChip}
        </div>
        <div className="flex items-center gap-2">
          {canUpload && isActive && <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("driveAttachment.allowedTypes", { maxMb: MAX_MB })}</span>}
          {uploadButton(false)}
          {hiddenInput}
        </div>
      </div>
      {!isActive && <p className="text-xs text-[var(--muted)]">{t("driveAttachment.saveFirstHint")}</p>}
      {inFlight.map((name) => <PendingFile key={name} name={name} />)}
      {isLoading ? <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
        : isError ? (
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] p-3 text-sm">
            <p>{t("driveAttachment.loadFailed", { defaultValue: "Could not load attachments." })}</p>
            <Button size="sm" variant="outline" className="mt-2" onPress={() => refetch()}>{t("driveAttachment.retry", { defaultValue: "Try again" })}</Button>
          </div>
        ) : files.length === 0 && !inFlight.length ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
            <Paperclip className="mx-auto mb-2 size-8 text-[var(--muted)] opacity-40" aria-hidden="true" />
            <p className="text-sm text-[var(--muted)]">{t("driveAttachment.noAttachments")}</p>
            {canUpload && isActive && <p className="mt-1 text-xs text-[var(--muted)]">{t("driveAttachment.noAttachmentsHint")}</p>}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <DataGrid
              aria-label={heading}
              data={files}
              columns={columns}
              getRowId={(file) => file.id}
              contentClassName="min-w-[640px]"
              verticalAlign="middle"
            />
          </div>
        )}
      {deleteDialog}
    </div>
  );
}

function PendingFile({ name, compact = false }: { name: string; compact?: boolean }) {
  const { t } = useTranslation("common");
  return <div className={`flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--default)] ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-xs"}`}>
    <Spinner size="sm" aria-hidden="true" /><span dir="ltr" className="truncate text-[var(--muted)]">{name}</span>
    {!compact && <span className="ms-auto shrink-0 text-[var(--muted)]">{t("uploadingFile")}</span>}
  </div>;
}
