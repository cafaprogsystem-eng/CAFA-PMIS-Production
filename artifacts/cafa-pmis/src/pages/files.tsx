import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Archive, BarChart3, BookOpen, BriefcaseBusiness, ClipboardList, Download, Eye,
  File, FileArchive, FileSpreadsheet, FileText, FolderKanban, FolderOpen, Handshake, Image,
  Landmark, Megaphone, MoreHorizontal, Package, RotateCcw, Scale,
  Search, ShieldCheck, Trash2, Upload, Users, WalletCards, Wrench, X,
} from "@/components/icons";
import type { IconComponent } from "@/components/icons";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import {
  Alert, Button, Card, Chip, Dropdown, Input, Label, Modal, SearchField, Skeleton, TextArea, Tooltip,
} from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
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
import { getLinkedStateLabel, getStateLabel } from "@/components/state-label";
import { SelectField } from "@/components/select-field";
import { FilterKpi } from "@/components/filter-kpi";
import { ConfirmModal } from "@/components/confirm-modal";
import { RegistryPagination } from "@/components/registry-pagination";

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
  stateId: number | null;
  stateName: string | null;
  stateNameAr: string | null;
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

/**
 * Left-to-right isolate for technical text inside a joined line (file names,
 * sizes, references), so "163.1 KB" does not render as "KB 163.1" and a file
 * name keeps its start visible in Arabic. Plain text, so it also works in titles.
 */
const ltr = (text: string) => `⁦${text}⁩`;

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function fileIcon(contentType: string | null, fileName?: string) {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (contentType?.startsWith("image/")) return <Image className="size-4 text-sky-600" />;
  if (contentType?.includes("excel") || contentType?.includes("spreadsheet") || contentType === "text/csv" || ["csv", "xls", "xlsx"].includes(extension ?? "")) return <FileSpreadsheet className="size-4 text-emerald-600" />;
  if (contentType?.includes("pdf") || contentType?.includes("word") || contentType?.includes("document")) return <FileText className="size-4 text-rose-600" />;
  if (contentType?.includes("zip") || contentType?.includes("compressed") || ["zip", "7z", "rar", "tar", "gz"].includes(extension ?? "")) return <FileArchive className="size-4 text-amber-600" />;
  return <File className="size-4 text-[var(--muted)]" />;
}

function classificationIcon(classification: string) {
  return CLASSIFICATION_PRESENTATION[classification]?.icon ?? File;
}

const CLASSIFICATION_PRESENTATION: Record<string, {
  icon: IconComponent;
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
  return CLASSIFICATION_PRESENTATION[classification]?.colour ?? "text-[var(--muted)]";
}

function statusColor(status: ArchiveItem["status"]): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "archived") return "warning";
  return "danger";
}

function confidentialityColor(confidentiality: ArchiveItem["confidentiality"]): "accent" | "default" | "warning" | "danger" {
  if (confidentiality === "public") return "accent";
  if (confidentiality === "confidential") return "warning";
  if (confidentiality === "restricted") return "danger";
  return "default";
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

/** Joined secondary line for a document: file name, related record, uploader, source, size. */
function metaLine(item: ArchiveItem, title: string, source: string, withReference = false) {
  return [
    withReference && item.reference ? ltr(item.reference) : null,
    item.fileName !== title ? ltr(item.fileName) : null,
    item.relatedRecordTitle,
    item.uploadedByName,
    source,
    item.size != null ? ltr(formatBytes(item.size)) : null,
  ].filter(Boolean).join(" · ");
}

function TagChips({ tags, max, className = "" }: { tags: string[]; max: number; className?: string }) {
  const { t } = useTranslation("knowledge");
  if (!tags.length) return null;
  const visible = tags.slice(0, max);
  const rest = tags.slice(visible.length);
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {visible.map((tag) => <Chip key={tag} size="sm" variant="secondary" className="max-w-[140px]"><span className="truncate" title={tag}>{tag}</span></Chip>)}
      {rest.length > 0 && <Chip size="sm" variant="tertiary"><span title={rest.join(", ")}>{t("fileArchive.moreTags", { count: rest.length })}</span></Chip>}
    </div>
  );
}

function DocumentMeta({ label, value, isCode = false }: { label: string; value: string; isCode?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-[var(--muted)]">{label}</dt>
      <dd dir={isCode ? "ltr" : undefined} className="truncate text-sm font-medium rtl:text-end" title={value}>{value}</dd>
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
  const sourceContext = [sourceLabel, item.relatedRecordTitle].filter(Boolean).join(" · ");

  return (
    <Card data-archive-card className="group min-w-0 gap-0 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onView(item)}
          className="flex min-w-0 items-start gap-2 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label={t("fileArchive.viewDocument", { name: title })}
        >
          <span className="mt-0.5 shrink-0" aria-hidden="true">{fileIcon(item.contentType, item.fileName)}</span>
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-sm font-medium group-hover:text-[var(--accent)] text-page-start">{title}</span>
            {item.fileName && item.fileName !== title && <span dir="ltr" className="mt-0.5 block truncate text-xs text-[var(--muted)] rtl:text-end" title={item.fileName}>{item.fileName}</span>}
          </span>
        </button>
        <div className="shrink-0">{actions}</div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <DocumentMeta label={t("fileArchive.fileType")} value={fileTypeLabel(item, t("fileArchive.unknownFileType"))} />
        <DocumentMeta label={t("fileArchive.reference")} value={item.reference ?? "—"} isCode />
        <DocumentMeta label={t("fileArchive.classification")} value={classificationLabel} />
        <DocumentMeta label={t("fileArchive.confidentiality")} value={t(`fileArchive.confidentialityValues.${item.confidentiality}`)} />
        <DocumentMeta label={t("fileArchive.sector")} value={item.sector ? t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector }) : "—"} />
        <DocumentMeta label={t("fileArchive.date")} value={formatDate(item.effectiveDate ?? item.updatedAt, locale)} />
        <DocumentMeta label={t("fileArchive.status")} value={t(`fileArchive.${item.status}`)} />
        {item.size != null && <DocumentMeta label={t("fileArchive.size")} value={ltr(formatBytes(item.size))} />}
      </dl>
      {sourceContext && <p className="mt-4 truncate border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]" title={sourceContext}>{t("fileArchive.sourceContext")}: {sourceContext}</p>}
      <TagChips tags={item.tags} max={2} className="mt-3" />
    </Card>
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
  const cols = "grid-cols-[minmax(92px,1fr)_minmax(190px,2fr)_minmax(150px,1.5fr)_minmax(120px,1.2fr)_minmax(92px,0.9fr)_minmax(112px,1fr)_120px]";
  return (
    <div data-archive-compact-list className="overflow-x-auto">
      <div className="min-w-[880px]">
        <div className={`grid ${cols} items-center gap-3 border-b border-[var(--border)] bg-[var(--default)] px-3 py-2 text-xs font-medium text-[var(--muted)]`}>
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
            <div key={`${item.source}-${item.id}`} data-archive-compact-row className={`grid ${cols} items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-sm last:border-b-0 hover:bg-[var(--default)]`}>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]" title={fileTypeLabel(item, t("fileArchive.unknownFileType"))}><span aria-hidden="true">{fileIcon(item.contentType, item.fileName)}</span><span className="truncate">{fileTypeLabel(item, t("fileArchive.unknownFileType"))}</span></span>
              <button type="button" onClick={() => onView(item)} dir="auto" className="min-w-0 truncate rounded-sm text-start font-medium outline-none hover:text-[var(--accent)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)] text-page-start" aria-label={t("fileArchive.viewDocument", { name: title })} title={title}>{title}</button>
              <span className="truncate text-xs text-[var(--muted)]" title={item.classification}>{classificationLabel(item.classification)}</span>
              <span className="truncate text-xs text-[var(--muted)]">{item.sector ? t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector }) : "—"}</span>
              <span><Chip size="sm" variant="soft" color={statusColor(item.status)}>{t(`fileArchive.${item.status}`)}</Chip></span>
              <span className="whitespace-nowrap text-xs text-[var(--muted)]">{formatDate(item.effectiveDate ?? item.updatedAt, locale)}</span>
              <span className="flex justify-end">{actionsFor(item)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Dashed drop / pick area for choosing one file. */
function FilePicker({
  id, file, onPick, onRemove, disabled, guidance,
}: {
  id: string;
  file: File | null;
  onPick: () => void;
  onRemove: () => void;
  disabled: boolean;
  guidance?: { id: string; text: string };
}) {
  const { t } = useTranslation("knowledge");
  if (file) {
    return (
      <div aria-live="polite" className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--default)] p-4">
        <FileText aria-hidden="true" className="size-5 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <p dir="ltr" className="truncate text-sm font-medium rtl:text-end" title={file.name}>{file.name}</p>
          <p className="text-xs text-[var(--muted)]">{file.type || t("fileArchive.unknownFileType")} · <bdi dir="ltr">{formatBytes(file.size)}</bdi></p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" isDisabled={disabled} onPress={onPick}>{t("fileArchive.changeFile")}</Button>
          <Button size="sm" variant="ghost" isIconOnly isDisabled={disabled} onPress={onRemove} aria-label={t("fileArchive.removeFile", { name: file.name })}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <button
      id={id}
      type="button"
      onClick={onPick}
      aria-describedby={guidance?.id}
      className="flex min-h-[11rem] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border)] p-8 text-center outline-none transition-colors hover:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] group-data-[dragging=true]:border-[var(--accent)] group-data-[dragging=true]:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]"
    >
      <Upload aria-hidden="true" className="mb-3 size-8 text-[var(--accent)]" />
      <span className="text-sm font-medium">{t("fileArchive.selectFile")}</span>
      {guidance && <span id={guidance.id} className="mt-1 max-w-md text-xs leading-relaxed text-[var(--muted)]">{guidance.text}</span>}
    </button>
  );
}

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation("knowledge");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stateId, setStateId] = useState("");
  const { data: statesData } = useQuery<Array<{ id: number; name: string; nameAr?: string | null }>>({
    queryKey: ["states-list"],
    queryFn: async () => {
      const response = await fetch("/api/states", { credentials: "include" });
      if (!response.ok) throw new Error("states_load_failed");
      return response.json();
    },
    enabled: open,
  });
  const states = Array.isArray(statesData) ? statesData : [];
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
          stateId: stateId ? Number(stateId) : undefined,
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
      setTitle(""); setDescription(""); setClassification(""); setConfidentiality("internal"); setSector(""); setStateId(""); setRetentionYears(""); setTags("");
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
    <Modal isOpen={open} onOpenChange={handleOpenChange}>
      <Modal.Backdrop isDismissable={!mutation.isPending}>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t("fileArchive.uploadTitle")}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("fileArchive.uploadDescription")}</p>
            </Modal.Header>
            <Modal.Body className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="archive-title" isRequired>{t("fileArchive.titleLabel")}</Label>
                <Input id="archive-title" fullWidth dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("fileArchive.titlePlaceholder")} maxLength={500} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="archive-description">{t("fileArchive.descriptionLabel")}</Label>
                <TextArea id="archive-description" fullWidth dir="auto" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("fileArchive.descriptionPlaceholder")} maxLength={20000} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="archive-classification"
                  label={t("fileArchive.classification")}
                  isRequired
                  value={classification}
                  onChange={setClassification}
                  placeholder={t("fileArchive.selectClassification")}
                  className="w-full"
                  options={DOCUMENT_CLASSIFICATIONS.map((item) => ({ value: item, label: t(`fileArchive.classificationValues.${item}`) }))}
                />
                <SelectField
                  id="archive-confidentiality"
                  label={t("fileArchive.confidentiality")}
                  value={confidentiality}
                  onChange={setConfidentiality}
                  className="w-full"
                  options={CONFIDENTIALITY_VALUES.map((item) => ({ value: item, label: t(`fileArchive.confidentialityValues.${item}`) }))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="archive-sector"
                  label={t("fileArchive.sector")}
                  isRequired
                  value={sector}
                  onChange={setSector}
                  placeholder={t("fileArchive.selectSector")}
                  className="w-full"
                  options={[
                    { value: "General / Cross-Cutting", label: t("fileArchive.generalSector") },
                    ...MAIN_SECTORS.map((item) => ({ value: item, label: t(`fileArchive.sectorValues.${item}`) })),
                  ]}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="archive-retention">{t("fileArchive.retentionYears")}</Label>
                  <Input id="archive-retention" fullWidth type="number" min="1" max="100" value={retentionYears} onChange={(event) => setRetentionYears(event.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <SelectField
                  id="archive-state"
                  label={t("fileArchive.state")}
                  aria-describedby="archive-state-hint"
                  value={stateId || "none"}
                  onChange={(value) => setStateId(value === "none" ? "" : value)}
                  className="w-full"
                  options={[
                    { value: "none", label: <>{t("fileArchive.noSpecificState")}</>, textValue: t("fileArchive.noSpecificState") },
                    ...states.map((s) => ({ value: String(s.id), label: getStateLabel(s, i18n.language) })),
                  ]}
                />
                <p id="archive-state-hint" className="text-xs text-[var(--muted)]">{t("fileArchive.stateHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="archive-tags">{t("fileArchive.tags")}</Label>
                <Input id="archive-tags" fullWidth dir="auto" value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("fileArchive.tagsPlaceholder")} />
              </div>
              <div
                className="group space-y-1.5"
                data-dragging={isDragging || undefined}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => { event.preventDefault(); setIsDragging(false); selectFile(event.dataTransfer.files?.[0] ?? null); }}
              >
                <Label htmlFor="archive-file-input" isRequired>{t("fileArchive.fileLabel")}</Label>
                <FilePicker
                  id="archive-file"
                  file={file}
                  onPick={() => inputRef.current?.click()}
                  onRemove={removeFile}
                  disabled={mutation.isPending}
                  guidance={{ id: "archive-file-guidance", text: t("fileArchive.fileGuidance") }}
                />
                <input ref={inputRef} id="archive-file-input" className="sr-only" type="file" required={!file} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
                {error && <p role="alert" aria-live="assertive" className="text-sm text-[var(--danger)]">{t(`fileArchive.uploadErrors.${error}`)}</p>}
                {mutation.isPending && <p aria-live="polite" className="text-sm text-[var(--muted)]">{t("fileArchive.uploading")}</p>}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline" isDisabled={mutation.isPending} onPress={() => handleOpenChange(false)}>{t("fileArchive.cancel")}</Button>
              <Button
                isDisabled={!file || !title.trim() || !classification || !sector || mutation.isPending}
                isPending={mutation.isPending}
                onPress={() => mutation.mutate()}
              >
                {t("fileArchive.uploadDocument")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function DetailRow({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
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
  const panel = "flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center";
  return (
    <Modal isOpen={!!item} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-3xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true">{fileIcon(item.contentType, item.fileName)}</span>
                <span dir="auto" className="truncate">{item.name}</span>
              </Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("fileArchive.detailDescription")}</p>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              {isUnavailable ? (
                <div role="status" className={`${panel} border-[color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--warning)_6%,transparent)]`}>
                  <FileArchive className="size-8 text-[var(--warning)]" aria-hidden="true" />
                  <p className="text-sm font-medium">{t("fileArchive.fileUnavailable")}</p>
                  <p className="text-xs text-[var(--muted)]">{t("fileArchive.fileUnavailableDesc")}</p>
                </div>
              ) : canPreview && previewUrl ? (
                <iframe title={t("fileArchive.previewTitle", { name: item.name })} src={previewUrl} className="h-[45vh] w-full rounded-xl border border-[var(--border)] bg-[var(--default)]" />
              ) : canPreview && previewFailed ? (
                <div role="alert" className={`${panel} border-[color-mix(in_oklab,var(--danger)_30%,transparent)]`}>
                  <FileArchive className="size-8 text-[var(--danger)]" aria-hidden="true" />
                  <p className="text-sm text-[var(--danger)]">{t("fileArchive.actionFailed")}</p>
                </div>
              ) : canPreview ? (
                <div className={`${panel} border-[var(--border)] bg-[var(--default)]`}>
                  <Skeleton className="h-4 w-40 rounded-md" />
                  <p className="text-sm text-[var(--muted)]">{t("fileArchive.previewLoading", { defaultValue: "Loading preview…" })}</p>
                </div>
              ) : (
                <div className={`${panel} border-[var(--border)] bg-[var(--default)]`}>
                  <FileArchive className="size-8 text-[var(--muted)]" aria-hidden="true" />
                  <p className="text-sm text-[var(--muted)]">{t("fileArchive.previewUnavailable")}</p>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <DetailRow label={t("fileArchive.classification")}>{t(`fileArchive.classificationValues.${item.classification}`, { defaultValue: item.classification })}</DetailRow>
                <DetailRow label={t("fileArchive.version")}>{item.versionLabel ?? "—"}</DetailRow>
                <DetailRow label={t("fileArchive.size")}><bdi dir="ltr">{formatBytes(item.size)}</bdi></DetailRow>
                <DetailRow label={t("fileArchive.updated")}>{formatDate(item.updatedAt, i18n.language === "ar" ? "ar" : "en-GB")}</DetailRow>
                <DetailRow label={t("fileArchive.source")}>{t(`fileArchive.sourceValues.${item.sourceKind}`, { defaultValue: item.sourceLabel ?? "—" })}{item.relatedRecordTitle ? ` · ${item.relatedRecordTitle}` : ""}</DetailRow>
                <DetailRow label={t("fileArchive.confidentiality")}>{t(`fileArchive.confidentialityValues.${item.confidentiality}`)}</DetailRow>
                {item.stateId != null && (
                  <DetailRow label={t("fileArchive.state")}>{getLinkedStateLabel(item, i18n.language)}</DetailRow>
                )}
                <DetailRow label={t("fileArchive.retentionYears")}>{item.retentionYears ?? "—"}</DetailRow>
                <DetailRow label={t("fileArchive.tagList")} wide>{item.tags.length ? <TagChips tags={item.tags} max={item.tags.length} /> : "—"}</DetailRow>
              </dl>
            </Modal.Body>
            <Modal.Footer>
              <Button isDisabled={isUnavailable} onPress={() => { void downloadArchiveItem(item).catch(() => toast.error(t("fileArchive.actionFailed"))); }}>
                <Download className="size-4" aria-hidden="true" />{t("fileArchive.download")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
  return (
    <Modal isOpen={!!item} onOpenChange={(open) => { if (!mutation.isPending) onOpenChange(open); }}>
      <Modal.Backdrop isDismissable={!mutation.isPending}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t("fileArchive.replace")}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("fileArchive.replaceDescription", { name: item.name })}</p>
            </Modal.Header>
            <Modal.Body>
              <FilePicker
                id="archive-replace-file"
                file={file}
                onPick={() => inputRef.current?.click()}
                onRemove={() => { setFile(null); if (inputRef.current) inputRef.current.value = ""; }}
                disabled={mutation.isPending}
              />
              <input ref={inputRef} className="hidden" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline" isDisabled={mutation.isPending} onPress={() => onOpenChange(false)}>{t("fileArchive.cancel")}</Button>
              <Button isDisabled={!file || mutation.isPending} isPending={mutation.isPending} onPress={() => mutation.mutate()}>{t("fileArchive.replace")}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** Icon button with a HeroUI tooltip (the tooltip shows on hover and keyboard focus). */
function IconAction({ label, tip, onPress, isDisabled, children }: { label: string; tip: string; onPress: () => void; isDisabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip delay={300}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} isDisabled={isDisabled} onPress={onPress}>{children}</Button>
      <Tooltip.Content>{tip}</Tooltip.Content>
    </Tooltip>
  );
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
    if (classification !== "all" && !isSearchingOrFiltered) return t("fileArchive.emptyClassification", { classification: classificationLabel(classification) });
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
    const menu: Array<{ id: string; label: string; icon: ReactNode; danger?: boolean; run: () => void }> = [];
    if (canReplace) menu.push({ id: "replace", label: t("fileArchive.replace"), icon: <RotateCcw className="size-4" aria-hidden="true" />, run: () => setReplaceItem(item) });
    if (canManage && item.status === "active") menu.push({ id: "archive", label: t("fileArchive.archive"), icon: <Archive className="size-4" aria-hidden="true" />, run: () => setPendingAction({ item, action: "archive" }) });
    if (canManage && item.status === "archived") menu.push({ id: "restore", label: t("fileArchive.restore"), icon: <RotateCcw className="size-4" aria-hidden="true" />, run: () => setPendingAction({ item, action: "restore" }) });
    if (canDelete && item.source === "resource") menu.push({ id: "delete", label: t("fileArchive.delete"), icon: <Trash2 className="size-4" aria-hidden="true" />, danger: true, run: () => setPendingAction({ item, action: "delete" }) });
    return (
      <div data-archive-actions className="flex items-center justify-end gap-0.5 whitespace-nowrap">
        <IconAction label={t("fileArchive.viewDocument", { name: item.name })} tip={t("fileArchive.view")} onPress={() => setDetail(item)}>
          <Eye aria-hidden="true" className="size-4" />
        </IconAction>
        <IconAction
          label={t("fileArchive.downloadDocument", { name: item.name })}
          tip={isUnavailable ? t("fileArchive.fileUnavailable") : t("fileArchive.download")}
          isDisabled={isUnavailable}
          onPress={() => { void downloadArchiveItem(item).catch(() => toast.error(t("fileArchive.actionFailed"))); }}
        >
          <Download aria-hidden="true" className="size-4" />
        </IconAction>
        {menu.length > 0 ? (
          <Dropdown>
            <Button isIconOnly size="sm" variant="ghost" aria-label={t("fileArchive.actionsFor", { name: item.name })}>
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu onAction={(key) => menu.find((m) => m.id === key)?.run()}>
                {menu.map((m) => (
                  <Dropdown.Item key={m.id} id={m.id} textValue={m.label} variant={m.danger ? "danger" : undefined}>
                    {m.icon}{m.label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ) : <span aria-hidden="true" className="size-8 shrink-0" />}
      </div>
    );
  };

  const columns = useMemo<DataGridColumn<ArchiveItem>[]>(() => [
    { id: "title", header: t("fileArchive.titleLabel"), isRowHeader: true, width: 290, pinned: "start", headerClassName: "w-[290px]",
      cell: (item) => {
        const title = item.name || item.fileName || "—";
        // The file name sits in the title's tooltip: an LTR name at the end of an
        // RTL line would be truncated from its start and read as noise.
        const meta = metaLine(item, item.fileName, sourceLabel(item), true);
        return (
          <div className="min-w-0">
            <button type="button" onClick={() => setDetail(item)} className="flex min-w-0 max-w-full items-center gap-2 rounded-sm text-start text-sm font-medium outline-none hover:text-[var(--accent)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
              <span aria-hidden="true" className="shrink-0">{fileIcon(item.contentType, item.fileName)}</span>
              <span dir="auto" className="line-clamp-2 whitespace-normal break-words text-page-start" title={item.fileName && item.fileName !== title ? `${title}\n${item.fileName}` : title}>{title}</span>
            </button>
            <p className="ms-6 mt-1 truncate text-xs text-[var(--muted)]" title={meta}>{meta || "—"}</p>
            <TagChips tags={item.tags} max={2} className="ms-6 mt-1" />
          </div>
        );
      } },
    // Classification with the sector beneath it, and confidentiality with the
    // lifecycle status, keep the register inside the workspace without scrolling.
    { id: "classification", header: t("fileArchive.classification"), width: 176, headerClassName: "w-[176px]",
      cell: (item) => {
        const Icon = classificationIcon(item.classification);
        return (
          <div className="min-w-0 whitespace-normal">
            <span className="flex items-start gap-1.5 text-sm">
              <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${classificationColour(item.classification)}`} />
              {classificationLabel(item.classification)}
            </span>
            <span className="mt-0.5 block ps-5 text-xs text-[var(--muted)]">{item.sector ? t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector }) : "—"}</span>
          </div>
        );
      } },
    { id: "status", header: t("fileArchive.status"), width: 120, headerClassName: "w-[120px]",
      cell: (item) => (
        <div className="flex flex-col items-start gap-1">
          <Chip size="sm" variant="soft" color={confidentialityColor(item.confidentiality)}>{t(`fileArchive.confidentialityValues.${item.confidentiality}`)}</Chip>
          <Chip size="sm" variant="soft" color={statusColor(item.status)}>{t(`fileArchive.${item.status}`)}</Chip>
        </div>
      ) },
    { id: "date", header: t("fileArchive.date"), width: 104, headerClassName: "w-[104px]",
      cell: (item) => <span className="whitespace-nowrap text-sm text-[var(--muted)]">{formatDate(item.effectiveDate ?? item.updatedAt, locale)}</span> },
    { id: "actions", header: <span className="sr-only">{t("fileArchive.actions")}</span>, width: 120, pinned: "end", headerClassName: "w-[120px]",
      cell: (item) => actionsFor(item) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, locale, canEditResources, canDeleteResources, canManageArchive]);

  const railButton = (selected: boolean) =>
    `flex min-h-9 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${selected ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "hover:bg-[var(--default)]"}`;
  const railCount = (selected: boolean) => `w-9 shrink-0 text-end text-xs tabular-nums ${selected ? "opacity-80" : "text-[var(--muted)]"}`;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <header className="flex shrink-0 flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><FileArchive className="size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />{t("fileArchive.title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("fileArchive.description")}</p>
        </div>
        {canUpload && <Button className="shrink-0" onPress={() => setUploadOpen(true)}><Upload className="size-4" aria-hidden="true" />{t("fileArchive.uploadDocument")}</Button>}
      </header>

      <section aria-label={t("fileArchive.summaryLabel")} className="grid shrink-0 grid-cols-3 gap-3">
        {(["total", "active", "archived"] as const).map((key) => (
          <FilterKpi
            key={key}
            icon={key === "archived" ? Archive : key === "active" ? File : FileText}
            status={key === "active" ? "success" : key === "archived" ? "warning" : undefined}
            label={t(`fileArchive.summary.${key}`)}
            value={<span aria-live="polite">{summary.isLoading ? <Skeleton className="h-7 w-12 rounded-md" /> : summary.isError ? "—" : summary.data?.[key] ?? "—"}</span>}
          />
        ))}
      </section>

      <div data-file-archive-workspace className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[272px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
        <aside data-classification-rail className="hidden min-h-0 flex-col overflow-hidden rounded-lg border bg-card p-3.5 lg:flex lg:h-full" aria-label={t("fileArchive.classificationsLabel")}>
          <p className="mb-2 shrink-0 px-1 text-xs font-medium text-[var(--muted)]">{t("fileArchive.classifications")}</p>
          <div className="shrink-0 space-y-1">
            <button type="button" aria-pressed={isAllDocumentsView} onClick={() => selectLifecycle("all")} className={railButton(isAllDocumentsView)}><FolderOpen aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 leading-4">{t("fileArchive.allDocuments")}</span><span aria-hidden="true" className={railCount(isAllDocumentsView)}>{classifications.isLoading ? "—" : classifications.data?.total ?? "—"}</span></button>
            <button type="button" aria-pressed={isArchivedView} onClick={() => selectLifecycle("archived")} className={railButton(isArchivedView)}><Archive aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 leading-4">{t("fileArchive.archivedDocuments")}</span><span aria-hidden="true" className={railCount(isArchivedView)}>{classifications.isLoading ? "—" : classifications.data?.archived ?? "—"}</span></button>
          </div>
          <div className="my-2 shrink-0 border-t border-[var(--border)]" />
          <div ref={classificationRailRef} role="region" tabIndex={0} aria-label={t("fileArchive.allClassifications")} data-classification-taxonomy className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md pe-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
            {classifications.isLoading ? [0, 1, 2].map((value) => <Skeleton key={value} className="h-9 w-full rounded-xl" />) : groupedClassifications.map((option) => {
              const Icon = classificationIcon(option.name);
              const selected = classification === option.name;
              return (
                <button type="button" key={option.name} data-selected-classification={selected ? "true" : undefined} aria-pressed={selected} onClick={() => selectClassification(option.name)} className={`${railButton(selected)} items-start`}>
                  <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${selected ? "" : classificationColour(option.name)}`} />
                  <span className="min-w-0 flex-1 break-words leading-4 line-clamp-2">{classificationLabel(option.name)}</span>
                  <span aria-hidden="true" className={`${railCount(selected)} pt-0.5`}>{option.count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <Card className="min-h-0 min-w-0 gap-0 overflow-hidden p-0 lg:flex lg:flex-col" aria-label={t("fileArchive.repositoryLabel")} aria-busy={files.isLoading}>
          <div className="flex flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0">
            <SearchField
              aria-label={t("fileArchive.searchLabel")}
              value={search}
              onChange={(value) => updateArchiveRoute({ search: value }, true)}
              className="w-full min-w-[12rem] flex-1"
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder={t("fileArchive.searchPlaceholder")} />
                <SearchField.ClearButton aria-label={t("fileArchive.clearFilters")} />
              </SearchField.Group>
            </SearchField>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <div className="lg:hidden">
                <SelectField
                  aria-label={t("fileArchive.classificationsLabel")}
                  value={isArchivedView ? "__archived_lifecycle__" : classification}
                  onChange={(value) => value === "__archived_lifecycle__" ? selectLifecycle("archived") : value === "all" ? selectLifecycle("all") : selectClassification(value)}
                  className="w-full"
                  options={[
                    { value: "all", label: t("fileArchive.allDocuments") },
                    { value: "__archived_lifecycle__", label: t("fileArchive.archivedDocuments") },
                    ...groupedClassifications.map((option) => ({ value: option.name, label: `${classificationLabel(option.name)} (${option.count})` })),
                  ]}
                />
              </div>
              <SelectField
                aria-label={t("fileArchive.sourceFilter")}
                value={source}
                onChange={(value) => updateArchiveRoute({ source: value as FileArchiveSource })}
                triggerClassName="sm:w-[138px]"
                options={[
                  { value: "all", label: t("fileArchive.allSources") },
                  { value: "resource", label: t("fileArchive.resources") },
                  { value: "project", label: t("fileArchive.projectAttachments") },
                  { value: "plan", label: t("fileArchive.planAttachments") },
                  { value: "report", label: t("fileArchive.reportAttachments") },
                ]}
              />
              <SelectField
                aria-label={t("fileArchive.sector")}
                value={sectorFilter}
                onChange={setSectorFilter}
                triggerClassName="sm:w-[150px]"
                options={[
                  { value: "all", label: t("fileArchive.allSectors") },
                  { value: "General / Cross-Cutting", label: t("fileArchive.generalSector") },
                  ...MAIN_SECTORS.map((item) => ({ value: item, label: t(`fileArchive.sectorValues.${item}`, { defaultValue: item }) })),
                ]}
              />
              <SelectField
                aria-label={t("fileArchive.confidentiality")}
                value={confidentialityFilter}
                onChange={setConfidentialityFilter}
                triggerClassName="whitespace-nowrap sm:w-[204px]"
                options={[
                  { value: "all", label: t("fileArchive.allConfidentiality") },
                  ...CONFIDENTIALITY_VALUES.map((item) => ({ value: item, label: t(`fileArchive.confidentialityValues.${item}`) })),
                ]}
              />
              <SelectField
                aria-label={t("fileArchive.statusFilter")}
                value={status}
                onChange={(value) => updateArchiveRoute({ status: value as FileArchiveStatus })}
                triggerClassName="sm:w-[130px]"
                options={[
                  { value: "active", label: t("fileArchive.active") },
                  { value: "archived", label: t("fileArchive.archived") },
                  { value: "deleted", label: t("fileArchive.deleted") },
                  { value: "all", label: t("fileArchive.allStatuses") },
                ]}
              />
              <ViewModeSwitcher available={["table", "card", "compact"]} current={view} onChange={(nextView) => { if (nextView === "table" || nextView === "card" || nextView === "compact") selectView(nextView); }} />
            </div>
          </div>

          <div data-archive-registry-body className="min-h-0 lg:flex-1 lg:overflow-y-auto">
            {files.isError ? (
              <div className="p-4">
                <Alert status="danger" role="alert">
                  <Alert.Indicator />
                  <Alert.Content><Alert.Description>{t("fileArchive.loadError")}</Alert.Description></Alert.Content>
                  <Button variant="outline" size="sm" onPress={() => void files.refetch()}>{t("fileArchive.retry")}</Button>
                </Alert>
              </div>
            ) : files.isLoading || isOutOfRangePage ? (
              <div className="space-y-3 p-4">{[0, 1, 2, 3, 4].map((value) => <Skeleton key={value} className="h-12 w-full rounded-xl" />)}</div>
            ) : items.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center">
                <FolderOpen aria-hidden="true" className="size-8 text-[var(--muted)] opacity-50" />
                <p className="max-w-sm text-sm text-[var(--muted)]">{emptyMessage()}</p>
                {(classification !== "all" || isSearchingOrFiltered) && <Button variant="outline" size="sm" onPress={clearFilters}>{t("fileArchive.clearFilters")}</Button>}
              </div>
            ) : (
              <>
                {view === "table" ? (
                  <>
                    <div className="hidden md:block">
                      <DataGrid
                        aria-label={t("fileArchive.repositoryLabel")}
                        data={items}
                        columns={columns}
                        getRowId={(item) => `${item.source}-${item.id}`}
                        contentClassName="min-w-[810px] table-fixed"
                        verticalAlign="middle"
                      />
                    </div>
                    <div className="space-y-2 p-3 md:hidden">
                      {items.map((item) => {
                        const title = item.name || item.fileName || "—";
                        const meta = metaLine(item, item.fileName, sourceLabel(item), true);
                        return (
                          <Card key={`${item.source}-${item.id}`} variant="secondary" className="gap-2 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <button type="button" onClick={() => setDetail(item)} className="flex min-w-0 items-center gap-2 rounded-sm text-start text-sm font-medium outline-none hover:text-[var(--accent)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                                <span aria-hidden="true" className="shrink-0">{fileIcon(item.contentType, item.fileName)}</span>
                                <span dir="auto" className="truncate text-page-start" title={title}>{title}</span>
                              </button>
                              {actionsFor(item)}
                            </div>
                            <p className="truncate text-xs text-[var(--muted)]" title={meta}>{meta || "—"}</p>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                              <Chip size="sm" variant="secondary"><span className={classificationColour(item.classification)}>{classificationLabel(item.classification)}</span></Chip>
                              <Chip size="sm" variant="soft" color={confidentialityColor(item.confidentiality)}>{t(`fileArchive.confidentialityValues.${item.confidentiality}`)}</Chip>
                              <Chip size="sm" variant="soft" color={statusColor(item.status)}>{t(`fileArchive.${item.status}`)}</Chip>
                              {item.sector && <span>{t(`fileArchive.sectorValues.${item.sector}`, { defaultValue: item.sector })}</span>}
                              <span aria-hidden="true">·</span>
                              <span>{formatDate(item.effectiveDate ?? item.updatedAt, locale)}</span>
                            </div>
                            <TagChips tags={item.tags} max={2} />
                          </Card>
                        );
                      })}
                    </div>
                  </>
                ) : view === "card" ? (
                  <div data-archive-card-grid className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {items.map((item) => <ArchiveDocumentCard key={`${item.source}-${item.id}`} item={item} actions={actionsFor(item)} onView={setDetail} classificationLabel={classificationLabel(item.classification)} sourceLabel={sourceLabel(item)} locale={locale} />)}
                  </div>
                ) : (
                  <ArchiveCompactList items={items} actionsFor={actionsFor} onView={setDetail} classificationLabel={classificationLabel} sourceLabel={sourceLabel} locale={locale} />
                )}
                <div className="border-t border-[var(--border)]">
                  <RegistryPagination
                    className="px-3 py-2.5"
                    page={resultPage}
                    totalPages={totalPages}
                    onPageChange={(next) => setPage(Math.min(totalPages, Math.max(1, next)))}
                    summary={t("fileArchive.paginationSummary", { from: firstResult, to: lastResult, total: resultTotal })}
                    pageSize={pageSize}
                    pageSizes={[10, 25, 50, 100]}
                    onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                    labels={{
                      region: t("fileArchive.paginationLabel", { defaultValue: "Pages" }),
                      rowsPerPage: t("fileArchive.pageSizeLabel"),
                      first: t("fileArchive.firstPage", { defaultValue: "First page" }),
                      previous: t("fileArchive.previousPage"),
                      next: t("fileArchive.nextPage"),
                      last: t("fileArchive.lastPage", { defaultValue: "Last page" }),
                      pageOf: `${resultPage} / ${totalPages}`,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <DetailDialog item={detail} onOpenChange={(open) => !open && setDetail(null)} />
      <ReplaceDialog item={replaceItem} onOpenChange={(open) => !open && setReplaceItem(null)} />
      <ConfirmModal
        isOpen={!!pendingAction}
        tone={pendingAction?.action === "delete" ? "danger" : "primary"}
        title={t(`fileArchive.confirm.${pendingAction?.action ?? "archive"}Title`)}
        message={t(`fileArchive.confirm.${pendingAction?.action ?? "archive"}Description`, { name: pendingAction?.item.name ?? "" })}
        cancelLabel={t("fileArchive.cancel")}
        confirmLabel={t("fileArchive.confirmAction")}
        isPending={action.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => pendingAction && action.mutate({ item: pendingAction.item, nextAction: pendingAction.action })}
      />
    </div>
  );
}
