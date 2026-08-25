import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload, FileText, FileImage, FileSpreadsheet, Loader2, Trash2,
  Download, ExternalLink, Paperclip,
} from "lucide-react";

/**
 * Plan and risk files use the canonical descriptor → object upload → finalise
 * contract. Storage identities remain server-side throughout this component.
 */
export type DriveModule =
  | "projects" | "project_reports" | "state_reports" | "hq_reports"
  | "plans" | "risks" | "budget" | "users" | "manual" | "training"
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
  if (mime.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-500 shrink-0" />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />;
  }
  return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
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
    <Badge variant="secondary" className={`gap-1 text-xs font-normal ${className}`}>
      <Paperclip className="h-3 w-3" /> {count}
    </Badge>
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
  label = "Attachments", variant = "full",
}: DriveAttachmentPanelProps) {
  const { t } = useTranslation("common");
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
      if (!response.ok) throw new Error(await responseMessage(response, "Could not load attachments."));
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
          throw new Error(await responseMessage(descriptorResponse, "Could not prepare upload."));
        }
        const descriptor = await descriptorResponse.json() as {
          operationId: string; uploadURL: string; uploadToken: string;
        };
        const uploadResponse = await fetch(descriptor.uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!uploadResponse.ok) throw new Error("The file could not be uploaded.");

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
          throw new Error(await responseMessage(finalizeResponse, "The upload could not be finalised."));
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
      if (!response.ok) throw new Error(await responseMessage(response, "Could not remove attachment."));
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
  const actions = (file: CanonicalAttachment, compact = false) => (
    <div className="flex items-center justify-end gap-0.5">
      <Button type="button" size="icon" variant="ghost" className={compact ? "h-7 w-7" : "h-8 w-8"}
        disabled={unavailable(file)} title={t("download")} aria-label={t("driveAttachment.downloadFile")}
        onClick={() => { if (!unavailable(file)) window.open(attachmentUrl(file, "download"), "_blank", "noopener,noreferrer"); }}>
        <Download className="h-3.5 w-3.5" />
      </Button>
      {!compact && (
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8"
          disabled={unavailable(file)} title={t("driveAttachment.openFile")} aria-label={t("driveAttachment.openFile")}
          onClick={() => { if (!unavailable(file)) window.open(attachmentUrl(file, "preview"), "_blank", "noopener,noreferrer"); }}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
      {canDelete && (
        <Button type="button" size="icon" variant="ghost"
          className={`${compact ? "h-7 w-7" : "h-8 w-8"} text-muted-foreground hover:text-destructive`}
          title={t("remove")} aria-label={t("driveAttachment.removeAttachment")} onClick={() => setDeleteTarget(file)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          {files.length > 0 && <Badge variant="secondary" className="text-xs gap-1"><Paperclip className="h-3 w-3" />{files.length}</Badge>}
          {canUpload && isActive && (
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
              disabled={inFlight.length > 0} onClick={() => fileInputRef.current?.click()}>
              {inFlight.length ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} {t("add")}
            </Button>
          )}
          {hiddenInput}
        </div>
        {files.map((file) => (
          <div key={file.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5 bg-muted/20">
            {fileIcon(file.contentType)}
            <span className="truncate flex-1" title={file.fileName}>{file.fileName}</span>
            {unavailable(file) ? <span className="text-destructive shrink-0">{t("driveAttachment.fileUnavailable")}</span> : <span className="text-muted-foreground shrink-0">{formatBytes(file.size)}</span>}
            {actions(file, true)}
          </div>
        ))}
        {inFlight.map((name) => <PendingFile key={name} name={name} compact />)}
        <DeleteConfirmDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} loading={deleting} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">{label}</h4>
          {files.length > 0 && <Badge variant="secondary" className="text-xs gap-1"><Paperclip className="h-3 w-3" />{files.length}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {canUpload && isActive && <span className="text-xs text-muted-foreground hidden sm:inline">PDF, Word, Excel, PPT, Images · max {MAX_MB} MB</span>}
          {canUpload && isActive && (
            <Button type="button" size="sm" variant="outline" disabled={inFlight.length > 0}
              onClick={() => fileInputRef.current?.click()}>
              {inFlight.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {t("driveAttachment.attachFile")}
            </Button>
          )}
          {hiddenInput}
        </div>
      </div>
      {!isActive && <p className="text-xs text-muted-foreground italic">{t("driveAttachment.saveFirstHint")}</p>}
      {inFlight.map((name) => <PendingFile key={name} name={name} />)}
      {isLoading ? <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>{t("driveAttachment.loadFailed", { defaultValue: "Could not load attachments." })}</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>{t("driveAttachment.retry", { defaultValue: "Try again" })}</Button>
          </div>
        ) : files.length === 0 && !inFlight.length ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Paperclip className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{t("driveAttachment.noAttachments")}</p>
            {canUpload && isActive && <p className="text-xs text-muted-foreground mt-1">{t("driveAttachment.noAttachmentsHint")}</p>}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table><TableHeader><TableRow>
              <TableHead>{t("driveAttachment.fileCol")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("driveAttachment.sizeCol")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("driveAttachment.uploadedByCol")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("driveAttachment.dateCol")}</TableHead>
              <TableHead className="w-24 text-end">{t("driveAttachment.actionsCol")}</TableHead>
            </TableRow></TableHeader><TableBody>
              {files.map((file) => <TableRow key={file.id}>
                <TableCell><div className="flex items-center gap-2">{fileIcon(file.contentType)}
                  <span className="max-w-[160px] truncate text-sm font-medium sm:max-w-xs" title={file.fileName}>{file.fileName}</span>
                  {file.versionNumber > 1 && <Badge variant="outline" className="text-xs px-1 shrink-0">v{file.versionNumber}</Badge>}
                  {unavailable(file) && <Badge variant="destructive" className="text-xs shrink-0">{t("driveAttachment.fileUnavailable")}</Badge>}
                </div></TableCell>
                <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{formatBytes(file.size)}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{file.uploadedByName ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">{new Date(file.uploadedAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-end">{actions(file)}</TableCell>
              </TableRow>)}
            </TableBody></Table>
          </div>
        )}
      <DeleteConfirmDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} loading={deleting} />
    </div>
  );
}

function PendingFile({ name, compact = false }: { name: string; compact?: boolean }) {
  const { t } = useTranslation("common");
  return <div className={`flex items-center gap-2 ${compact ? "text-xs px-2 py-1.5" : "text-xs px-3 py-2"} rounded border bg-muted/20 animate-pulse`}>
    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" /><span className="truncate text-muted-foreground">{name}</span>
    {!compact && <span className="text-muted-foreground shrink-0 ms-auto">{t("uploadingFile")}</span>}
  </div>;
}

function DeleteConfirmDialog({ target, onClose, onConfirm, loading }: {
  target: CanonicalAttachment | null; onClose: () => void; onConfirm: () => void; loading: boolean;
}) {
  const { t } = useTranslation("common");
  return <AlertDialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
    <AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{t("driveAttachment.removeTitle")}</AlertDialogTitle>
      <AlertDialogDescription><strong>{target?.fileName}</strong> {t("driveAttachment.removeDesc")}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter>
      <AlertDialogCancel disabled={loading}>{t("cancel")}</AlertDialogCancel>
      <AlertDialogAction disabled={loading} className="inline-flex items-center justify-center gap-2 whitespace-nowrap bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}{t("remove")}
      </AlertDialogAction>
    </AlertDialogFooter></AlertDialogContent>
  </AlertDialog>;
}