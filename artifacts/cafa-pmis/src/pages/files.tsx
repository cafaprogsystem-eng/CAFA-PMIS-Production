import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Archive, BarChart3, BookOpen, BriefcaseBusiness, ClipboardList, Download, Eye,
  File, FileArchive, FileSpreadsheet, FileText, FolderKanban, FolderOpen, Handshake, Image,
  Landmark, Loader2, Megaphone, MoreHorizontal, Package, RotateCcw, Scale,
  Search, ShieldCheck, Trash2, Upload, Users, WalletCards, Wrench, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildFileArchiveLocation,
  getFileArchiveRouteContext,
  type FileArchiveSource,
  type FileArchiveStatus,
  type FileArchiveViewMode,
} from "@/lib/file-archive-route";
import { canManageArchiveLifecycle } from "@/lib/file-archive-lifecycle";
import type { ArchiveLifecycleItem } from "@/lib/file-archive-lifecycle";
import { MAIN_SECTORS } from "@/lib/sectors";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";

export type ArchiveItem = {
  source: "resource" | "project" | "plan" | "report";
  id: number;
  name: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
  status: "active" | "archived" | "deleted";
  availabilityStatus?: "available" | "unavailable";
  classification: string;
  sector: string | null;
  module: string | null;
  recordId: number | null;
  reference: string | null;
  canManageArchiveLifecycle: boolean;
  versionLabel: string | null;
  description: string | null;
  effectiveDate: string | null;
  updatedAt: string;
  createdAt: string;
  uploadedByName: string | null;
  confidentiality: "public" | "internal" | "confidential" | "restricted";
  retentionYears: number | null;
  tags: string[];
  sourceKind: string | null;
  sourceLabel: string | null;
  relatedRecordTitle: string | null;
  previewUrl: string;
  downloadUrl: string;
};

type FileList = { items: ArchiveItem[]; total: number; page: number; pageSize: number };
type Summary = { total: number; active: number; archived: number };
type Classification = { source: ArchiveItem["source"]; classification: string; count: number };
type ClassificationAggregate = { classifications: Classification[]; total: number; archived: number };
type PendingAction = { item: ArchiveItem; action: "archive" | "restore" | "delete" } | null;
type ArchiveAction = "archive" | "restore" | "delete";
type UploadFailure = "file_required" | "file_too_large" | "file_type_not_allowed" | "forbidden" | "upload_failed";

async function downloadArchiveItem(item: ArchiveItem) {
  const response = await fetch(item.downloadUrl, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("download_failed");
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = item.fileName.replace(/[/\\\r\n"]/g, "_") || "download";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

const DOCUMENT_CLASSIFICATIONS = [
  "Governance & Legal", "Policies & Procedures", "Strategy & Planning",
  "Project Documents", "Plans & Workplans", "Programme Reports", "Donor Reports",
  "Financial & Budget", "Procurement & Logistics", "Monitoring & Evaluation",
  "Assessments & Research", "Partnerships", "Communications", "Training Materials",
  "Templates & Tools", "Technical Resources",
] as const;

const CONFIDENTIALITY_VALUES = ["public", "internal", "confidential", "restricted"] as const;

function formatBytes(size: number | null) {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function fileIcon(contentType: string | null, fileName?: string) {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (contentType?.startsWith("image/")) return <Image className="h-4 w-4 text-sky-600" />;
  if (contentType?.includes("excel") || contentType?.includes("spreadsheet") || contentType === "text/csv" || ["csv", "xls", "xlsx"].includes(extension ?? "")) return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />;
  if (contentType?.includes("pdf") || contentType?.includes("word") || contentType?.includes("document")) return <FileText className="h-4 w-4 text-rose-600" />;
  if (contentType?.includes("zip") || contentType?.includes("compressed") || ["zip", "7z", "rar", "tar", "gz"].includes(extension ?? "")) return <FileArchive className="h-4 w-4 text-amber-600" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function classificationIcon(classification: string) {
  return CLASSIFICATION_PRESENTATION[classification]?.icon ?? File;
}

const CLASSIFICATION_PRESENTATION: Record<string, {
  icon: LucideIcon;
  colour: string;
}> = {
  "Governance & Legal": { icon: Scale, colour: "text-violet-600" },
  "Policies & Procedures": { icon: ShieldCheck, colour: "text-indigo-600" },
  "Strategy & Planning": { icon: BriefcaseBusiness, colour: "text-blue-600" },
  "Project Documents": { icon: FolderKanban, colour: "text-sky-600" },
  "Plans & Workplans": { icon: ClipboardList, colour: "text-cyan-600" },
  "Programme Reports": { icon: FileText, colour: "text-emerald-600" },
  "Donor Reports": { icon: Landmark, colour: "text-amber-600" },
  "Financial & Budget": { icon: WalletCards, colour: "text-green-600" },
  "Procurement & Logistics": { icon: Package, colour: "text-orange-600" },
  "Monitoring & Evaluation": { icon: BarChart3, colour: "text-sky-700" },
  "Assessments & Research": { icon: Search, colour: "text-purple-600" },
  "Partnerships": { icon: Handshake, colour: "text-rose-600" },
  "Communications": { icon: Megaphone, colour: "text-pink-600" },
  "Training Materials": { icon: BookOpen, colour: "text-teal-600" },
  "Templates & Tools": { icon: Wrench, colour: "text-slate-600" },
  "Technical Resources": { icon: Users, colour: "text-slate-700" },
};

function classificationColour(classification: string) {
  return CLASSIFICATION_PRESENTATION[classification]?.colour ?? "text-muted-foreground";
}

function statusVariant(status: ArchiveItem["status"]) {
  if (status === "active") return "success";
  if (status === "archived") return "warning";
  return "destructive";
}

function fileTypeLabel(item: ArchiveItem, unknownLabel: string) {
  if (item.contentType) {
    const knownType: Record<string, string> = {
      "application/pdf": "PDF",
      "application/msword": "Word",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
      "application/vnd.ms-excel": "Excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
      "application/vnd.ms-powerpoint": "PowerPoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
      "application/zip": "ZIP",
      "application/x-7z-compressed": "7Z",
      "application/x-rar-compressed": "RAR",
      "text/plain": "Text",
    };
    return knownType[item.contentType] ?? item.contentType.split("/").pop()?.split(";")[0]?.toUpperCase() ?? item.contentType;
  }
  const extension = item.fileName.split(".").pop()?.trim();
  return extension && extension !== item.fileName ? extension.toUpperCase() : unknownLabel;
}

function DocumentMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium" title={value}>{value}</dd>
    </div>
  );
}

export function ArchiveDocumentCard({
  item,
  actions,
  onView,
  classificationLabel,
  sourceLabel,
  locale,
}: {
  item: ArchiveItem;
  actions: ReactNode;
  onView: (item: ArchiveItem) => void;
  classificationLabel: string;
  sourceLabel: string;
  locale: string;
}) {
  const { t } = useTranslation("knowledge");
  const title = item.name || item.fileName || "—";
  const visibleTags = item.tags.slice(0, 2);
  const remainingTagCount = Math.max(0, item.tags.length - visibleTags.length);
  const sourceContext = [sourceLabel, item.relatedRecordTitle].filter(Boolean).join(" · ");

  return (
    <article data-archive-card className="group flex min-w-0 flex-col rounded-lg border bg-background p-4 transition-colors hover:border-primary/40 hover:shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onView(item)}
          className="flex min-w-0 items-start gap-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("fileArchive.viewDocument", { name: title })}
        >
          <span className="mt-0.5 shrink-0" aria-hidden="true">{fileIcon(item.contentType, item.fileName)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-primary">{title}</span>
            {item.fileName && item.fileName !== title && <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={item.fileName}>{item.fileName}</span>}
          </span>
        </button>
        <div className="shrink-0">{actions}</div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <DocumentMeta label={t("fileArchive.fileType")} value={fileTypeLabel(item, t("fileArchive.unknownFileType"))} />
        <DocumentMeta label={t("fileArchive.reference")} value={item.reference ?? "—"} />
        <DocumentMeta label={t("fileArchive.classification")} value={classificationLabel} />
        <DocumentMeta label={t("fileArchive.confidentiality")} value={t(`fileArchive.confidentialityValues.${item.confidentiality}`)} />
        <DocumentMeta label={t("fileArchive.sector")} value={item.sector ? t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector }) : "—"} />
        <DocumentMeta label={t("fileArchive.date")} value={formatDate(item.effectiveDate ?? item.updatedAt, locale)} />
        <DocumentMeta label={t("fileArchive.status")} value={t(`fileArchive.${item.status}`)} />
        {item.size != null && <DocumentMeta label={t("fileArchive.size")} value={formatBytes(item.size)} />}
      </dl>
      {sourceContext && <p className="mt-4 truncate border-t border-border/60 pt-3 text-xs text-muted-foreground" title={sourceContext}>{t("fileArchive.sourceContext")}: {sourceContext}</p>}
      {visibleTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {visibleTags.map((tag) => <span key={tag} className="max-w-[140px] truncate rounded border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={tag}>{tag}</span>)}
          {remainingTagCount > 0 && <span className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={item.tags.slice(visibleTags.length).join(", ")}>{t("fileArchive.moreTags", { count: remainingTagCount })}</span>}
        </div>
      )}
    </article>
  );
}

export function ArchiveCompactList({
  items,
  actionsFor,
  onView,
  classificationLabel,
  sourceLabel: _sourceLabel,
  locale,
}: {
  items: ArchiveItem[];
  actionsFor: (item: ArchiveItem) => ReactNode;
  onView: (item: ArchiveItem) => void;
  classificationLabel: (value: string) => string;
  sourceLabel: (item: ArchiveItem) => string;
  locale: string;
}) {
  const { t } = useTranslation("knowledge");
  return (
    <div data-archive-compact-list className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="grid grid-cols-[minmax(92px,1fr)_minmax(190px,2fr)_minmax(150px,1.5fr)_minmax(120px,1.2fr)_minmax(92px,0.9fr)_minmax(112px,1fr)_144px] items-center gap-3 border-b bg-muted/30 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>{t("fileArchive.fileType")}</span>
          <span>{t("fileArchive.titleLabel")}</span>
          <span>{t("fileArchive.classification")}</span>
          <span>{t("fileArchive.sector")}</span>
          <span>{t("fileArchive.status")}</span>
          <span>{t("fileArchive.date")}</span>
          <span className="text-end">{t("fileArchive.actions")}</span>
        </div>
        {items.map((item) => {
          const title = item.name || item.fileName || "—";
          return (
            <div key={`${item.source}-${item.id}`} data-archive-compact-row className="grid grid-cols-[minmax(92px,1fr)_minmax(190px,2fr)_minmax(150px,1.5fr)_minmax(120px,1.2fr)_minmax(92px,0.9fr)_minmax(112px,1fr)_144px] items-center gap-3 border-b border-border/60 px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/30">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={fileTypeLabel(item, t("fileArchive.unknownFileType"))}><span aria-hidden="true">{fileIcon(item.contentType, item.fileName)}</span><span className="truncate">{fileTypeLabel(item, t("fileArchive.unknownFileType"))}</span></span>
              <button type="button" onClick={() => onView(item)} className="min-w-0 truncate text-start font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("fileArchive.viewDocument", { name: title })} title={title}>{title}</button>
              <span className="truncate text-xs text-muted-foreground" title={item.classification}>{classificationLabel(item.classification)}</span>
              <span className="truncate text-xs text-muted-foreground">{item.sector ? t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector }) : "—"}</span>
              <span><Badge variant={statusVariant(item.status)}>{t(`fileArchive.${item.status}`)}</Badge></span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(item.effectiveDate ?? item.updatedAt, locale)}</span>
              <span className="flex justify-end">{actionsFor(item)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function confidentialityVariant(confidentiality: ArchiveItem["confidentiality"]): BadgeVariant {
  if (confidentiality === "public") return "info";
  if (confidentiality === "confidential") return "warning";
  if (confidentiality === "restricted") return "destructive";
  return "outline";
}

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("knowledge");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classification, setClassification] = useState("");
  const [confidentiality, setConfidentiality] = useState("internal");
  const [sector, setSector] = useState("");
  const [retentionYears, setRetentionYears] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<UploadFailure | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const selectFile = (nextFile: File | null) => {
    setFile(nextFile);
    setError(null);
  };
  const removeFile = () => {
    selectFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("file_required");
      const descriptorResponse = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          scope: "documents",
        }),
      });
      if (!descriptorResponse.ok) {
        const payload = await descriptorResponse.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "upload_failed");
      }
      const descriptor = await descriptorResponse.json() as { uploadURL: string; objectPath: string; uploadToken: string };
      const storageResponse = await fetch(descriptor.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!storageResponse.ok) throw new Error("storage_put_failed");
      const response = await fetch("/api/files/upload", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description, classification, confidentiality, sector, retentionYears,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          objectPath: descriptor.objectPath, uploadToken: descriptor.uploadToken, fileName: file.name, contentType: file.type || "application/octet-stream",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "upload_failed");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success(t("fileArchive.uploadSuccess"));
      removeFile();
      setTitle(""); setDescription(""); setClassification(""); setConfidentiality("internal"); setSector(""); setRetentionYears(""); setTags("");
      onOpenChange(false);
    },
    onError: (uploadError) => {
      const code = uploadError instanceof Error ? uploadError.message : "upload_failed";
      setError(
        code === "file_required" || code === "file_too_large" || code === "file_type_not_allowed" || code === "forbidden"
          ? code
          : "upload_failed",
      );
    },
  });
  const handleOpenChange = (nextOpen: boolean) => {
    if (mutation.isPending) return;
    if (!nextOpen) {
      removeFile();
      setError(null);
      setIsDragging(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("fileArchive.uploadTitle")}</DialogTitle>
          <DialogDescription>{t("fileArchive.uploadDescription")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pe-1 pb-1">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="archive-title">{t("fileArchive.titleLabel")} <span aria-hidden="true" className="text-destructive">*</span></Label>
              <Input id="archive-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("fileArchive.titlePlaceholder")} maxLength={500} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="archive-description">{t("fileArchive.descriptionLabel")}</Label>
              <Textarea id="archive-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("fileArchive.descriptionPlaceholder")} maxLength={20000} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="archive-classification">{t("fileArchive.classification")} <span aria-hidden="true" className="text-destructive">*</span></Label>
                <Select value={classification} onValueChange={setClassification}>
                  <SelectTrigger id="archive-classification" aria-label={t("fileArchive.classification")} aria-required="true"><SelectValue placeholder={t("fileArchive.selectClassification")} /></SelectTrigger>
                  <SelectContent>{DOCUMENT_CLASSIFICATIONS.map((item) => <SelectItem key={item} value={item}>{t(`fileArchive.classificationValues.${item}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="archive-confidentiality">{t("fileArchive.confidentiality")}</Label>
                <Select value={confidentiality} onValueChange={setConfidentiality}>
                  <SelectTrigger id="archive-confidentiality" aria-label={t("fileArchive.confidentiality")}><SelectValue /></SelectTrigger>
                  <SelectContent>{CONFIDENTIALITY_VALUES.map((item) => <SelectItem key={item} value={item}>{t(`fileArchive.confidentialityValues.${item}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="archive-sector">{t("fileArchive.sector")}</Label>
                <Select value={sector} onValueChange={setSector}>
                  <SelectTrigger id="archive-sector" aria-label={t("fileArchive.sector")}><SelectValue placeholder={t("fileArchive.selectSector")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="General / Cross-Cutting">{t("fileArchive.generalSector")}</SelectItem>
                    {MAIN_SECTORS.map((item) => <SelectItem key={item} value={item}>{t(`fileArchive.sectorValues.${item}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="archive-retention">{t("fileArchive.retentionYears")}</Label>
                <Input id="archive-retention" type="number" min="1" max="100" value={retentionYears} onChange={(event) => setRetentionYears(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="archive-tags">{t("fileArchive.tags")}</Label>
              <Input id="archive-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("fileArchive.tagsPlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="archive-file-input">{t("fileArchive.fileLabel")} <span aria-hidden="true" className="text-destructive">*</span></Label>
              {file ? (
                <div aria-live="polite" className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                  <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
                    <p className="text-xs text-muted-foreground">{file.type || t("fileArchive.unknownFileType")} · {formatBytes(file.size)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => inputRef.current?.click()}>
                      {t("fileArchive.changeFile")}
                    </Button>
                    <Button type="button" size="icon" variant="ghost" disabled={mutation.isPending} onClick={removeFile} aria-label={t("fileArchive.removeFile", { name: file.name })}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  id="archive-file"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setIsDragging(false); selectFile(event.dataTransfer.files?.[0] ?? null); }}
                  aria-describedby="archive-file-guidance"
                  className={`flex min-h-[11rem] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"}`}
                >
                  <Upload aria-hidden="true" className="mb-3 h-8 w-8 text-primary" />
                  <span className="text-sm font-medium text-foreground">{t("fileArchive.selectFile")}</span>
                  <span id="archive-file-guidance" className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{t("fileArchive.fileGuidance")}</span>
                </button>
              )}
              <input ref={inputRef} id="archive-file-input" className="sr-only" type="file" required={!file} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
              {error && <p role="alert" aria-live="assertive" className="text-sm text-destructive">{t(`fileArchive.uploadErrors.${error}`)}</p>}
              {mutation.isPending && <p aria-live="polite" className="text-sm text-muted-foreground">{t("fileArchive.uploading")}</p>}
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-border/60 pt-4">
          <Button variant="outline" disabled={mutation.isPending} onClick={() => handleOpenChange(false)}>{t("fileArchive.cancel")}</Button>
          <Button disabled={!file || !title.trim() || !classification || !sector || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t("fileArchive.uploadDocument")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ item, onOpenChange }: { item: ArchiveItem | null; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation("knowledge");
  const isUnavailable = item?.availabilityStatus === "unavailable";
  const canPreview = !isUnavailable && (item?.contentType === "application/pdf" || item?.contentType?.startsWith("image/") === true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    if (!item || !canPreview) {
      setPreviewUrl(null);
      setPreviewFailed(false);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setPreviewFailed(false);
    void (async () => {
      try {
        const response = await fetch(item.previewUrl, { credentials: "include" });
        if (!response.ok) throw new Error("preview_failed");
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPreviewUrl(objectUrl);
      } catch {
        if (active) setPreviewFailed(true);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canPreview, item]);
  if (!item) return null;
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{fileIcon(item.contentType, item.fileName)}<span className="truncate">{item.name}</span></DialogTitle>
          <DialogDescription>{t("fileArchive.detailDescription")}</DialogDescription>
        </DialogHeader>
        {isUnavailable ? (
          <div role="status" className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-warning/30 bg-warning/5 text-center">
            <FileArchive className="h-8 w-8 text-warning" />
            <p className="text-sm font-medium text-foreground">File Unavailable</p>
            <p className="text-xs text-muted-foreground">This file is retained for review but cannot be opened or downloaded.</p>
          </div>
        ) : canPreview && previewUrl ? (
          <iframe title={t("fileArchive.previewTitle", { name: item.name })} src={previewUrl} className="h-[45vh] w-full rounded-md border bg-muted" />
        ) : canPreview && previewFailed ? (
          <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 text-center">
            <FileArchive className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{t("fileArchive.actionFailed")}</p>
          </div>
        ) : canPreview ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">{t("fileArchive.uploading")}</div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border bg-muted/30 text-center">
            <FileArchive className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("fileArchive.previewUnavailable")}</p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-muted-foreground">{t("fileArchive.classification")}</dt><dd>{item.classification}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.version")}</dt><dd>{item.versionLabel ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.size")}</dt><dd>{formatBytes(item.size)}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.updated")}</dt><dd>{formatDate(item.updatedAt, i18n.language === "ar" ? "ar" : "en-GB")}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.source")}</dt><dd>{t(`fileArchive.sourceValues.${item.sourceKind}`, { defaultValue: item.sourceLabel ?? "—" })}{item.relatedRecordTitle ? ` · ${item.relatedRecordTitle}` : ""}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.confidentiality")}</dt><dd>{t(`fileArchive.confidentialityValues.${item.confidentiality}`)}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.retentionYears")}</dt><dd>{item.retentionYears ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">{t("fileArchive.tags")}</dt><dd>{item.tags.length ? item.tags.join(", ") : "—"}</dd></div>
          <div className="col-span-2"><dt className="text-muted-foreground">{t("fileArchive.versionHistory")}</dt><dd>{item.versionLabel ?? "—"}</dd></div>
        </dl>
        <DialogFooter><Button disabled={isUnavailable} onClick={() => { void downloadArchiveItem(item).catch(() => toast.error(t("fileArchive.actionFailed"))); }}><Download className="h-4 w-4" />{t("fileArchive.download")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReplaceDialog({ item, onOpenChange }: { item: ArchiveItem | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("knowledge");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [item?.id, item?.source]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!item || !file) throw new Error("file_required");
      const contentType = file.type || "application/octet-stream";
      const descriptorResponse = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType, scope: "documents" }),
      });
      if (!descriptorResponse.ok) throw new Error("replace_failed");
      const descriptor = await descriptorResponse.json() as { uploadURL: string; objectPath: string; uploadToken: string };
      const storageResponse = await fetch(descriptor.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!storageResponse.ok) throw new Error("replace_failed");
      const response = await fetch(`/api/files/resource/${item.id}/replace`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectPath: descriptor.objectPath,
          uploadToken: descriptor.uploadToken,
          fileName: file.name,
          contentType,
        }),
      });
      if (!response.ok) throw new Error("replace_failed");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success(t("fileArchive.replaceSuccess"));
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onOpenChange(false);
    },
    onError: () => toast.error(t("fileArchive.actionFailed")),
  });
  if (!item) return null;
  return <Dialog open={!!item} onOpenChange={(open) => !mutation.isPending && onOpenChange(open)}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{t("fileArchive.replace")}</DialogTitle><DialogDescription>{t("fileArchive.replaceDescription", { name: item.name })}</DialogDescription></DialogHeader>
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg border-2 border-dashed border-border p-5 text-sm hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {file ? file.name : t("fileArchive.selectFile")}
      </button>
      <input ref={inputRef} className="hidden" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("fileArchive.cancel")}</Button><Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t("fileArchive.replace")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function FilesPage() {
  const { t, i18n } = useTranslation("knowledge");
  const queryClient = useQueryClient();
  const [pathname, navigate] = useLocation();
  const rawSearch = useSearch();
  const location = rawSearch ? `${pathname}${rawSearch.startsWith("?") ? rawSearch : `?${rawSearch}`}` : pathname;
  const { data: me } = useGetMe();
  const permissions = me?.permissions ?? [];
  const role = me?.user?.role;
  const canUpload = permissions.includes("*") || permissions.includes("documents.upload") || permissions.includes("program_resources.upload");
  const canEditResources = permissions.includes("*") || permissions.includes("program_resources.edit");
  const canDeleteResources = permissions.includes("*") || permissions.includes("program_resources.delete");
  const canManageArchive = ["super_admin", "executive_director", "program_manager"].includes(role ?? "");
  const routeContext = useMemo(() => getFileArchiveRouteContext(rawSearch), [rawSearch]);
  const { search, source, classification, status, view } = routeContext;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sectorFilter, setSectorFilter] = useState("all");
  const [confidentialityFilter, setConfidentialityFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<ArchiveItem | null>(null);
  const [replaceItem, setReplaceItem] = useState<ArchiveItem | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const classificationRailRef = useRef<HTMLDivElement>(null);
  const revealedClassificationRef = useRef<string | null>(null);

  useEffect(() => setPage(1), [search, source, classification, status]);

  const updateArchiveRoute = (
    patch: Parameters<typeof buildFileArchiveLocation>[1],
    replace = false,
  ) => {
    const nextLocation = buildFileArchiveLocation(location, patch);
    if (nextLocation !== location) navigate(nextLocation, { replace });
  };

  const searchParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
    if (search.trim()) params.set("search", search.trim());
    if (source !== "all") params.set("source", source);
    if (classification !== "all") params.set("classification", classification);
    if (sectorFilter !== "all") params.set("sector", sectorFilter);
    if (confidentialityFilter !== "all") params.set("confidentiality", confidentialityFilter);
    return params;
  }, [search, source, classification, status, sectorFilter, confidentialityFilter, page, pageSize]);
  const queryKey = ["files", searchParams.toString()];
  const files = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/files?${searchParams}`, { credentials: "include" });
      if (!response.ok) throw new Error("files_load_failed");
      return response.json() as Promise<FileList>;
    },
  });
  const summary = useQuery({
    queryKey: ["files", "summary"],
    queryFn: async () => {
      const response = await fetch("/api/files/summary", { credentials: "include" });
      if (!response.ok) throw new Error("summary_load_failed");
      return response.json() as Promise<Summary>;
    },
  });
  const classifications = useQuery({
    queryKey: ["files", "classifications", status, source, search, sectorFilter, confidentialityFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ status });
      if (source !== "all") params.set("source", source);
      if (search.trim()) params.set("search", search.trim());
      if (sectorFilter !== "all") params.set("sector", sectorFilter);
      if (confidentialityFilter !== "all") params.set("confidentiality", confidentialityFilter);
      const response = await fetch(`/api/files/classifications?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("classifications_load_failed");
      return response.json() as Promise<ClassificationAggregate>;
    },
  });
  const action = useMutation({
    mutationFn: async ({ item, nextAction }: { item: ArchiveItem; nextAction: ArchiveAction }) => {
      const endpoint = `/api/files/${item.source}/${item.id}`;
      const response = nextAction === "delete"
        ? await fetch(endpoint, { method: "DELETE", credentials: "include" })
        : await fetch(endpoint, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextAction === "archive" ? "archived" : "active" }) });
      if (!response.ok) throw new Error("file_action_failed");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      toast.success(t("fileArchive.actionSuccess"));
      setPendingAction(null);
    },
    onError: () => toast.error(t("fileArchive.actionFailed")),
  });
  const classificationOptions = classifications.data?.classifications;
  const items = files.data?.items ?? [];
  const locale = i18n.language === "ar" ? "ar" : "en-GB";
  const classificationLabel = (value: string | null) => value
    ? t(`fileArchive.classificationValues.${value}`, { defaultValue: value })
    : "—";
  const sourceLabel = (item: ArchiveItem) => t(`fileArchive.sourceValues.${item.sourceKind}`, {
    defaultValue: item.sourceLabel ?? "—",
  });
  const groupedClassifications = useMemo(() => {
    const optionsByName = new Map<string, { name: string; count: number }>();
    for (const option of classificationOptions ?? []) {
      const existing = optionsByName.get(option.classification);
      optionsByName.set(option.classification, {
        name: option.classification,
        count: (existing?.count ?? 0) + option.count,
      });
    }
    return [...optionsByName.values()];
  }, [classificationOptions]);

  useEffect(() => {
    const rail = classificationRailRef.current;
    if (classification === "all") {
      revealedClassificationRef.current = null;
      return;
    }
    if (!rail || revealedClassificationRef.current === classification) return;
    const selectedRow = rail.querySelector<HTMLElement>(
      '[data-selected-classification="true"]',
    );
    if (!selectedRow) return;

    const railBounds = rail.getBoundingClientRect();
    const rowBounds = selectedRow.getBoundingClientRect();
    if (rowBounds.top < railBounds.top) {
      rail.scrollTop -= railBounds.top - rowBounds.top;
    } else if (rowBounds.bottom > railBounds.bottom) {
      rail.scrollTop += rowBounds.bottom - railBounds.bottom;
    }
    revealedClassificationRef.current = classification;
  }, [classification, groupedClassifications]);

  const resultTotal = files.data?.total ?? 0;
  const resultPage = files.data?.page ?? page;
  const resultPageSize = files.data?.pageSize ?? pageSize;
  const totalPages = Math.max(1, Math.ceil(resultTotal / resultPageSize));
  const firstResult = resultTotal === 0 ? 0 : (resultPage - 1) * resultPageSize + 1;
  const lastResult = Math.min(resultTotal, resultPage * resultPageSize);
  const isOutOfRangePage = resultTotal > 0 && resultPage > totalPages;
  const isAllDocumentsView = classification === "all" && status !== "archived";
  const isActiveDocumentsView = classification === "all" && status === "active";
  const isArchivedView = classification === "all" && status === "archived";
  const isSearchingOrFiltered = Boolean(search.trim()) || source !== "all" || status === "deleted";

  useEffect(() => {
    if (isOutOfRangePage) setPage(totalPages);
  }, [isOutOfRangePage, totalPages]);

  const selectLifecycle = (nextStatus: FileArchiveStatus) => {
    updateArchiveRoute({ status: nextStatus, classification: "all" });
  };
  const selectClassification = (nextClassification: string) => {
    updateArchiveRoute({ classification: nextClassification });
  };
  const selectView = (nextView: FileArchiveViewMode) => {
    updateArchiveRoute({ view: nextView });
  };
  const clearFilters = () => {
    updateArchiveRoute({ search: "", source: "all", classification: "all", status: "active" });
  };
  const emptyMessage = () => {
    if (summary.data?.total === 0) return t("fileArchive.emptyArchive");
    if (isArchivedView) return t("fileArchive.emptyArchived");
    if (classification !== "all" && !isSearchingOrFiltered) return t("fileArchive.emptyClassification", { classification });
    if (isActiveDocumentsView && !search.trim() && source === "all") return t("fileArchive.emptyActive");
    return t("fileArchive.emptyFiltered");
  };
  const actionsFor = (item: ArchiveItem) => {
    const canManageArchiveItem = canManageArchiveLifecycle(item as ArchiveLifecycleItem, canManageArchive);
    const canManage = item.source === "resource" ? canEditResources : canManageArchiveItem;
    const canDelete = item.source === "resource" ? canDeleteResources : canManageArchive;
    const canReplace = item.status === "active" && (
      (item.source === "resource" && canEditResources) || canManageArchiveItem
    );
    const isUnavailable = item.availabilityStatus === "unavailable";
    return (
      <div data-archive-actions className="flex items-center justify-end gap-0.5 whitespace-nowrap">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetail(item)} aria-label={t("fileArchive.viewDocument", { name: item.name })} title={t("fileArchive.view")}>
          <Eye aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isUnavailable} onClick={() => { void downloadArchiveItem(item).catch(() => toast.error(t("fileArchive.actionFailed"))); }} aria-label={t("fileArchive.downloadDocument", { name: item.name })} title={t("fileArchive.download")}>
          <Download aria-hidden="true" className="h-4 w-4" />
        </Button>
        {(canManage || (canManageArchiveItem && item.status === "active") || (canDelete && item.source === "resource")) && (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t("fileArchive.actionsFor", { name: item.name })} title={t("fileArchive.actionsFor", { name: item.name })} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canReplace && <DropdownMenuItem onClick={() => setReplaceItem(item)}><RotateCcw className="me-2 h-4 w-4" />{t("fileArchive.replace")}</DropdownMenuItem>}
              {canManage && item.status === "active" && <DropdownMenuItem onClick={() => setPendingAction({ item, action: "archive" })}><Archive className="me-2 h-4 w-4" />{t("fileArchive.archive")}</DropdownMenuItem>}
              {canManage && item.status === "archived" && <DropdownMenuItem onClick={() => setPendingAction({ item, action: "restore" })}><RotateCcw className="me-2 h-4 w-4" />{t("fileArchive.restore")}</DropdownMenuItem>}
              {canDelete && item.source === "resource" && <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setPendingAction({ item, action: "delete" })}><Trash2 className="me-2 h-4 w-4" />{t("fileArchive.delete")}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-full flex-col gap-4">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div className="min-w-0"><h1 className="flex items-center gap-2 text-xl font-medium tracking-tight sm:text-2xl"><FileArchive className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />{t("fileArchive.title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("fileArchive.description")}</p></div>
        {canUpload && <Button className="shrink-0" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" />{t("fileArchive.uploadDocument")}</Button>}
      </header>

      <section aria-label={t("fileArchive.summaryLabel")} className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {(["total", "active", "archived"] as const).map((key) => {
          const MetricIcon = key === "archived" ? Archive : key === "active" ? File : FileText;
          return <Card key={key} className="shadow-none"><CardContent className="flex items-start justify-between p-3.5"><div><p className="text-xs text-muted-foreground">{t(`fileArchive.summary.${key}`)}</p><div className="mt-1 text-2xl font-medium tabular-nums" aria-live="polite">{summary.isLoading ? <Skeleton className="h-7 w-12" /> : summary.isError ? "—" : summary.data?.[key] ?? "—"}</div></div><MetricIcon aria-hidden="true" className="mt-0.5 h-4 w-4 text-muted-foreground/60" /></CardContent></Card>;
        })}
      </section>

      <div data-file-archive-workspace className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[272px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
        <aside data-classification-rail className="hidden min-h-0 flex-col overflow-hidden rounded-lg border bg-card p-3.5 lg:flex lg:h-full" aria-label={t("fileArchive.classificationsLabel")}>
          <p className="mb-2 shrink-0 px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t("fileArchive.classifications")}</p>
          <div className="shrink-0 space-y-1">
            <button type="button" aria-pressed={isAllDocumentsView} onClick={() => selectLifecycle("all")} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isAllDocumentsView ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 leading-4">{t("fileArchive.allDocuments")}</span><span aria-hidden="true" className={`w-9 shrink-0 text-end text-xs tabular-nums ${isAllDocumentsView ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{classifications.isLoading ? "—" : classifications.data?.total ?? "—"}</span></button>
            <button type="button" aria-pressed={isArchivedView} onClick={() => selectLifecycle("archived")} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isArchivedView ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><Archive aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 leading-4">{t("fileArchive.archivedDocuments")}</span><span aria-hidden="true" className={`w-9 shrink-0 text-end text-xs tabular-nums ${isArchivedView ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{classifications.isLoading ? "—" : classifications.data?.archived ?? "—"}</span></button>
          </div>
          <div className="shrink-0 border-t border-border/70 pt-1" />
          <div ref={classificationRailRef} role="region" tabIndex={0} aria-label={t("fileArchive.allClassifications")} data-classification-taxonomy className="min-h-0 flex-1 space-y-1 overflow-y-auto pe-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {classifications.isLoading ? [0, 1, 2].map((value) => <Skeleton key={value} className="h-9 w-full" />) : groupedClassifications.map((option) => {
              const Icon = classificationIcon(option.name);
              const selected = classification === option.name;
              return <button type="button" key={option.name} data-selected-classification={selected ? "true" : undefined} aria-pressed={selected} onClick={() => selectClassification(option.name)} className={`flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><Icon aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${selected ? "text-primary-foreground" : classificationColour(option.name)}`} /><span className="min-w-0 flex-1 break-words leading-4 line-clamp-2">{classificationLabel(option.name)}</span><span aria-hidden="true" className={`w-9 shrink-0 pt-0.5 text-end text-xs tabular-nums ${selected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{option.count}</span></button>;
            })}
            </div>
        </aside>
        <section className="min-h-0 min-w-0 overflow-hidden rounded-lg border bg-card lg:flex lg:flex-col" aria-label={t("fileArchive.repositoryLabel")} aria-busy={files.isLoading}>
              <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap lg:shrink-0"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-muted-foreground" /><Input aria-label={t("fileArchive.searchLabel")} className="ps-9" placeholder={t("fileArchive.searchPlaceholder")} value={search} onChange={(event) => updateArchiveRoute({ search: event.target.value }, true)} /></div><div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"><div className="lg:hidden"><Select value={isArchivedView ? "__archived_lifecycle__" : classification} onValueChange={(value) => value === "__archived_lifecycle__" ? selectLifecycle("archived") : value === "all" ? selectLifecycle("all") : selectClassification(value)}><SelectTrigger aria-label={t("fileArchive.classificationsLabel")} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("fileArchive.allDocuments")}</SelectItem><SelectItem value="__archived_lifecycle__">{t("fileArchive.archivedDocuments")}</SelectItem>{groupedClassifications.map((option) => <SelectItem key={option.name} value={option.name}>{classificationLabel(option.name)} ({option.count})</SelectItem>)}</SelectContent></Select></div><Select value={source} onValueChange={(value) => updateArchiveRoute({ source: value as FileArchiveSource })}><SelectTrigger aria-label={t("fileArchive.sourceFilter")} className="w-full sm:w-[138px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("fileArchive.allSources")}</SelectItem><SelectItem value="resource">{t("fileArchive.resources")}</SelectItem><SelectItem value="project">{t("fileArchive.projectAttachments")}</SelectItem><SelectItem value="plan">{t("fileArchive.planAttachments")}</SelectItem><SelectItem value="report">{t("fileArchive.reportAttachments")}</SelectItem></SelectContent></Select><Select value={sectorFilter} onValueChange={setSectorFilter}><SelectTrigger aria-label={t("fileArchive.sector")} className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("fileArchive.allSectors")}</SelectItem><SelectItem value="General / Cross-Cutting">{t("fileArchive.generalSector")}</SelectItem>{MAIN_SECTORS.map((item) => <SelectItem key={item} value={item}>{t(`fileArchive.sectorValues.${item}`, { defaultValue: item })}</SelectItem>)}</SelectContent></Select><Select value={confidentialityFilter} onValueChange={setConfidentialityFilter}><SelectTrigger aria-label={t("fileArchive.confidentiality")} className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("fileArchive.allConfidentiality")}</SelectItem>{["public", "internal", "confidential", "restricted"].map((item) => <SelectItem key={item} value={item}>{t(`fileArchive.confidentialityValues.${item}`)}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={(value) => updateArchiveRoute({ status: value as FileArchiveStatus })}><SelectTrigger aria-label={t("fileArchive.statusFilter")} className="w-full sm:w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">{t("fileArchive.active")}</SelectItem><SelectItem value="archived">{t("fileArchive.archived")}</SelectItem><SelectItem value="deleted">{t("fileArchive.deleted")}</SelectItem><SelectItem value="all">{t("fileArchive.allStatuses")}</SelectItem></SelectContent></Select><ViewModeSwitcher available={["table", "card", "compact"]} current={view} onChange={(nextView) => { if (nextView === "table" || nextView === "card" || nextView === "compact") selectView(nextView); }} /></div></div>
             <div data-archive-registry-body className="min-h-0 lg:flex-1 lg:overflow-y-auto">
              {files.isError ? <div role="alert" className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-destructive">{t("fileArchive.loadError")}</p><Button variant="outline" size="sm" onClick={() => void files.refetch()}>{t("fileArchive.retry")}</Button></div> : files.isLoading || isOutOfRangePage ? <div className="space-y-3 p-4">{[0, 1, 2, 3, 4].map((value) => <Skeleton key={value} className="h-12 w-full" />)}</div> : items.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center"><FolderOpen aria-hidden="true" className="h-8 w-8 text-muted-foreground/50" /><p className="max-w-sm text-sm text-muted-foreground">{emptyMessage()}</p>{(classification !== "all" || isSearchingOrFiltered) && <Button variant="outline" size="sm" onClick={clearFilters}>{t("fileArchive.clearFilters")}</Button>}</div> : <>{view === "table" ? <>
              <div className="hidden overflow-x-auto md:block">
                 <Table className="min-w-[1160px]">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                       <TableHead className="w-[110px] min-w-[110px]">{t("fileArchive.reference")}</TableHead>
                       <TableHead className="min-w-[332px]">{t("fileArchive.titleLabel")}</TableHead>
                      <TableHead className="w-[172px]">{t("fileArchive.classification")}</TableHead>
                      <TableHead className="w-[128px]">{t("fileArchive.confidentiality")}</TableHead>
                      <TableHead className="w-[140px]">{t("fileArchive.sector")}</TableHead>
                      <TableHead className="w-[112px]">{t("fileArchive.date")}</TableHead>
                      <TableHead className="w-[96px]">{t("fileArchive.status")}</TableHead>
                       <TableHead data-archive-actions-column className="w-[144px] min-w-[144px] text-end">{t("fileArchive.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const visibleTags = item.tags.slice(0, 2);
                      const remainingTagCount = Math.max(0, item.tags.length - visibleTags.length);
                      const title = item.name || item.fileName || "—";
                      return (
                        <TableRow key={`${item.source}-${item.id}`}>
                          <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">{item.reference ?? "—"}</TableCell>
                          <TableCell className="py-2.5">
                            <button onClick={() => setDetail(item)} className="flex max-w-[360px] items-center gap-2 text-start text-sm font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                               {fileIcon(item.contentType, item.fileName)}
                              <span className="truncate" title={title}>{title}</span>
                            </button>
                            <div className="ms-6 mt-1 max-w-[360px] space-y-1">
                              <p className="truncate text-xs text-muted-foreground" title={[item.fileName !== title ? item.fileName : null, item.relatedRecordTitle, item.uploadedByName, sourceLabel(item), item.size != null ? formatBytes(item.size) : null].filter(Boolean).join(" · ")}>
                                {[item.fileName !== title ? item.fileName : null, item.relatedRecordTitle, item.uploadedByName, sourceLabel(item), item.size != null ? formatBytes(item.size) : null].filter(Boolean).join(" · ") || "—"}
                              </p>
                              {visibleTags.length > 0 && <div className="flex flex-wrap gap-1">{visibleTags.map((tag) => <Badge key={tag} variant="outline" className="max-w-[104px] truncate px-1.5 py-0 text-[10px]" title={tag}>{tag}</Badge>)}{remainingTagCount > 0 && <Badge variant="outline" className="px-1.5 py-0 text-[10px]" title={item.tags.slice(visibleTags.length).join(", ")}>{t("fileArchive.moreTags", { count: remainingTagCount })}</Badge>}</div>}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5"><Badge variant="outline" className="max-w-[164px] bg-muted/30 font-medium"><span className={classificationColour(item.classification)}>{classificationLabel(item.classification)}</span></Badge></TableCell>
                          <TableCell className="py-2.5"><Badge variant={confidentialityVariant(item.confidentiality)}>{t(`fileArchive.confidentialityValues.${item.confidentiality}`)}</Badge></TableCell>
                          <TableCell className="py-2.5 text-sm text-muted-foreground">{item.sector ? t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector }) : "—"}</TableCell>
                          <TableCell className="py-2.5 whitespace-nowrap text-sm text-muted-foreground">{formatDate(item.effectiveDate ?? item.updatedAt, locale)}</TableCell>
                          <TableCell className="py-2.5"><Badge variant={statusVariant(item.status)}>{t(`fileArchive.${item.status}`)}</Badge></TableCell>
                           <TableCell data-archive-actions-column className="w-[144px] min-w-[144px] py-2.5 text-end">{actionsFor(item)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-2 p-3 md:hidden">{items.map((item) => {
                const title = item.name || item.fileName || "—";
                const visibleTags = item.tags.slice(0, 2);
                return <article key={`${item.source}-${item.id}`} className="rounded-md border p-3"><div className="flex items-start justify-between gap-2"><button onClick={() => setDetail(item)} className="flex min-w-0 items-center gap-2 text-start text-sm font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{fileIcon(item.contentType, item.fileName)}<span className="truncate" title={title}>{title}</span></button>{actionsFor(item)}</div><p className="mt-1 truncate text-xs text-muted-foreground" title={[item.reference, item.relatedRecordTitle, item.uploadedByName, sourceLabel(item), item.size != null ? formatBytes(item.size) : null].filter(Boolean).join(" · ")}>{[item.reference, item.relatedRecordTitle, item.uploadedByName, sourceLabel(item), item.size != null ? formatBytes(item.size) : null].filter(Boolean).join(" · ") || "—"}</p><div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Badge variant="outline" className="max-w-[180px] bg-muted/30"><span className={classificationColour(item.classification)}>{classificationLabel(item.classification)}</span></Badge><Badge variant={confidentialityVariant(item.confidentiality)}>{t(`fileArchive.confidentialityValues.${item.confidentiality}`)}</Badge><Badge variant={statusVariant(item.status)}>{t(`fileArchive.${item.status}`)}</Badge>{item.sector && <span>{t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector })}</span>}<span>{item.versionLabel ?? "—"}</span><span aria-hidden="true">·</span><span>{formatDate(item.effectiveDate ?? item.updatedAt, locale)}</span></div>{visibleTags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{visibleTags.map((tag) => <Badge key={tag} variant="outline" className="max-w-[110px] truncate px-1.5 py-0 text-[10px]" title={tag}>{tag}</Badge>)}{item.tags.length > visibleTags.length && <Badge variant="outline" className="px-1.5 py-0 text-[10px]" title={item.tags.slice(visibleTags.length).join(", ")}>{t("fileArchive.moreTags", { count: item.tags.length - visibleTags.length })}</Badge>}</div>}</article>;
               })}</div></> : view === "card" ? <div data-archive-card-grid className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <ArchiveDocumentCard key={`${item.source}-${item.id}`} item={item} actions={actionsFor(item)} onView={setDetail} classificationLabel={classificationLabel(item.classification)} sourceLabel={sourceLabel(item)} locale={locale} />)}</div> : <ArchiveCompactList items={items} actionsFor={actionsFor} onView={setDetail} classificationLabel={classificationLabel} sourceLabel={sourceLabel} locale={locale} />}
              <footer className="flex flex-col gap-2 border-t px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">{t("fileArchive.paginationSummary", { from: firstResult, to: lastResult, total: resultTotal })}</span><div className="flex items-center justify-between gap-2 sm:justify-end"><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger aria-label={t("fileArchive.pageSizeLabel")} className="h-8 w-[112px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">{t("fileArchive.pageSizeValue", { count: 10 })}</SelectItem><SelectItem value="25">{t("fileArchive.pageSizeValue", { count: 25 })}</SelectItem><SelectItem value="50">{t("fileArchive.pageSizeValue", { count: 50 })}</SelectItem><SelectItem value="100">{t("fileArchive.pageSizeValue", { count: 100 })}</SelectItem></SelectContent></Select><div className="flex items-center gap-1"><Button variant="outline" size="sm" aria-label={t("fileArchive.previousPage")} disabled={resultPage <= 1} onClick={() => setPage((value) => value - 1)}>{t("fileArchive.previous")}</Button><span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{t("fileArchive.pageOf", { page: resultPage, total: totalPages })}</span><Button variant="outline" size="sm" aria-label={t("fileArchive.nextPage")} disabled={resultPage >= totalPages} onClick={() => setPage((value) => value + 1)}>{t("fileArchive.next")}</Button></div></div></footer>
             </>}
             </div>
        </section>
      </div>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <DetailDialog item={detail} onOpenChange={(open) => !open && setDetail(null)} />
      <ReplaceDialog item={replaceItem} onOpenChange={(open) => !open && setReplaceItem(null)} />
      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t(`fileArchive.confirm.${pendingAction?.action ?? "archive"}Title`)}</AlertDialogTitle><AlertDialogDescription>{t(`fileArchive.confirm.${pendingAction?.action ?? "archive"}Description`, { name: pendingAction?.item.name ?? "" })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("fileArchive.cancel")}</AlertDialogCancel><AlertDialogAction className="inline-flex items-center justify-center gap-2 whitespace-nowrap" disabled={action.isPending} onClick={() => pendingAction && action.mutate({ item: pendingAction.item, nextAction: pendingAction.action })}>{action.isPending && <Loader2 className="inline h-4 w-4 animate-spin" />}{t("fileArchive.confirmAction")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}