import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import {
  Upload, Search, Download, Eye, Edit2, Archive, Trash2, FileText,
  File, X, Plus, FolderOpen, RefreshCw, MoreHorizontal, BookMarked,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { MAIN_SECTORS } from "@/lib/sectors";

/* ─── Constants ──────────────────────────────────────────────────────────── */
const CATEGORIES = ["SOPs", "Policies", "Templates", "Guidelines", "Manuals", "Technical Resources"] as const;
// Program Resources sector list: General/Cross-Cutting + the 7 canonical Main Sectors
const PR_SECTORS = ["General / Cross-Cutting", ...MAIN_SECTORS] as const;
// Backward-compat alias so local references keep working
const SECTORS = PR_SECTORS;

// Map canonical CAFA project sectors → program-resource sectors for "My Sector" quick filter.
// After migration both sides use canonical names so the map is 1-to-1.
const CANONICAL_TO_DOC_SECTOR: Record<string, string> = {
  "Health": "Health",
  "Nutrition": "Nutrition",
  "WASH": "WASH",
  "Education": "Education",
  "Protection": "Protection",
  "Food Security & Livelihoods": "Food Security & Livelihoods",
  "Shelter & NFI": "Shelter & NFI",
};

const CATEGORY_COLORS: Record<string, string> = {
  "SOPs":                "bg-blue-100 text-blue-800",
  "Policies":            "bg-purple-100 text-purple-800",
  "Templates":           "bg-green-100 text-green-800",
  "Guidelines":          "bg-amber-100 text-amber-800",
  "Manuals":             "bg-rose-100 text-rose-800",
  "Technical Resources": "bg-teal-100 text-teal-800",
};

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface ProgramResource {
  id: number;
  title: string;
  category: string;
  sector: string;
  description: string | null;
  versionNumber: string | null;
  effectiveDate: string | null;
  tags: string | null;
  fileName: string;
  contentType: string | null;
  fileSize: number | null;
  objectPath: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  uploadedById: number | null;
  uploadedByName: string | null;
}
interface Stats {
  total: number; sops: number; policies: number; templates: number;
  guidelines: number; manuals: number; technicalResources: number;
  recentlyUpdated: { id: number; title: string; category: string; updated_at: string }[];
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function getDownloadUrl(objectPath: string): string {
  const p = objectPath.startsWith("/objects/") ? objectPath.slice("/objects/".length) : objectPath;
  return `/api/storage/objects/${p}`;
}

function isImage(ct: string | null): boolean {
  return !!ct && ct.startsWith("image/");
}
function isPdf(ct: string | null): boolean {
  return ct === "application/pdf";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try { return new Date(dt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return dt; }
}

/* ─── Upload Dialog ──────────────────────────────────────────────────────── */
interface UploadForm {
  title: string; category: string; sector: string; description: string;
  versionNumber: string; effectiveDate: string; tags: string;
}
const EMPTY_FORM: UploadForm = { title: "", category: "", sector: "", description: "", versionNumber: "", effectiveDate: "", tags: "" };

function UploadDialog({ open, onClose, editResource }: {
  open: boolean;
  onClose: () => void;
  editResource?: ProgramResource | null;
}) {
  const { t } = useTranslation("knowledge");
  const qc = useQueryClient();
  const [form, setForm]   = useState<UploadForm>(EMPTY_FORM);
  const [file, setFile]   = useState<File | null>(null);
  const [busy, setBusy]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = !!editResource;

  // Populate form on edit
  useEffect(() => {
    if (editResource) {
      setForm({
        title:         editResource.title,
        category:      editResource.category,
        sector:        editResource.sector,
        description:   editResource.description ?? "",
        versionNumber: editResource.versionNumber ?? "",
        effectiveDate: editResource.effectiveDate ?? "",
        tags:          editResource.tags ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setFile(null);
  }, [editResource, open]);

  const set = (k: keyof UploadForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.title.trim())  { toast.error(t("resources.titleRequired")); return; }
    if (!form.category)      { toast.error(t("resources.categoryRequired")); return; }
    if (!form.sector)        { toast.error(t("resources.sectorRequired")); return; }
    if (!isEdit && !file)    { toast.error(t("resources.fileRequired")); return; }

    setBusy(true);
    try {
      let fileMeta: { fileName: string; contentType: string; fileSize: number; objectPath: string } | null = null;

      if (file) {
        // 1. Get presigned upload URL
        const urlRes = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        });
        if (!urlRes.ok) {
          const err = await urlRes.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message ?? "Failed to get upload URL");
        }
        const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

        // 2. Upload to object storage
        const upRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!upRes.ok) throw new Error("Failed to upload file to storage");

        fileMeta = { fileName: file.name, contentType: file.type, fileSize: file.size, objectPath };
      }

      const body = {
        ...form,
        title: form.title.trim(),
        description:   form.description.trim()   || null,
        versionNumber: form.versionNumber.trim()  || null,
        effectiveDate: form.effectiveDate         || null,
        tags:          form.tags.trim()           || null,
        ...(fileMeta ?? {}),
      };

      const method = isEdit ? "PATCH" : "POST";
      const url    = isEdit ? `/api/program-resources/${editResource!.id}` : "/api/program-resources";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to save resource");
      }

      await qc.invalidateQueries({ queryKey: ["program-resources"] });
      toast.success(isEdit ? t("resources.updateSuccess") : t("resources.uploadSuccess"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("resources.editResourceTitle") : t("resources.uploadNewResource")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>{t("resources.titleFieldLabel")} <span className="text-destructive">*</span></Label>
            <Input placeholder={t("resources.titlePlaceholder")} value={form.title} onChange={set("title")} />
          </div>

          {/* Category + Sector */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("resources.categoryFieldLabel")} <span className="text-destructive">*</span></Label>
              <Select value={form.category} onValueChange={(v) => setForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue placeholder={t("resources.selectCategory")} /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("resources.sectorFieldLabel")} <span className="text-destructive">*</span></Label>
              <Select value={form.sector} onValueChange={(v) => setForm(p => ({ ...p, sector: v }))}>
                <SelectTrigger><SelectValue placeholder={t("resources.selectSector")} /></SelectTrigger>
                <SelectContent>
                  {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>{t("resources.descriptionFieldLabel")}</Label>
            <Textarea placeholder={t("resources.descriptionPlaceholder")} rows={2} value={form.description} onChange={set("description")} />
          </div>

          {/* Version + Effective Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("resources.versionNumberLabel")}</Label>
              <Input placeholder={t("resources.versionPlaceholder")} value={form.versionNumber} onChange={set("versionNumber")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("resources.effectiveDateLabel")}</Label>
              <Input type="date" value={form.effectiveDate} onChange={set("effectiveDate")} />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label>{t("resources.tagsLabel")}</Label>
            <Input placeholder={t("resources.tagsPlaceholder")} value={form.tags} onChange={set("tags")} />
          </div>

          {/* File upload */}
          <div className="space-y-1.5">
            <Label>{isEdit ? t("resources.replaceFileLabel") : t("resources.fileLabel")} {!isEdit && <span className="text-destructive">*</span>}</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium truncate max-w-[260px]">{file.name}</span>
                  <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                  <button className="ms-1 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <Upload className="h-6 w-6 mx-auto mb-1 text-muted-foreground/60" />
                  <span>{t("resources.clickOrDrop")}</span>
                  <p className="text-xs mt-0.5">{t("resources.fileTypesHint")}</p>
                  {isEdit && editResource && (
                    <p className="text-xs mt-1 font-medium text-foreground/70">{t("resources.currentFile", { name: editResource.fileName })}</p>
                  )}
                </div>
              )}
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("resources.cancel")}</Button>
          <Button onClick={handleSave} disabled={busy}>
              {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {isEdit ? t("resources.saveChanges") : t("resources.uploadResource")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── PDF.js type stubs (library loaded from CDN at runtime) ─────────────── */
// pdfjs-dist is not available via npm in this environment, so we load the
// ESM build from jsDelivr CDN and use minimal TypeScript interfaces.
interface PdfjsViewport { width: number; height: number }
interface PdfjsRenderTask { promise: Promise<void>; cancel(): void }
interface PdfjsPage {
  getViewport(p: { scale: number }): PdfjsViewport;
  render(p: { canvasContext: CanvasRenderingContext2D; viewport: PdfjsViewport }): PdfjsRenderTask;
  cleanup(): void;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  destroy(): void;
}
interface PdfjsLib {
  getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfjsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build";
let _pdfjsCache: PdfjsLib | null = null;

async function loadPdfjs(): Promise<PdfjsLib> {
  if (_pdfjsCache) return _pdfjsCache;
  // @vite-ignore: intentional CDN dynamic import — no local install
  const lib = (await import(/* @vite-ignore */ `${PDFJS_CDN}/pdf.mjs`)) as unknown as PdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.mjs`;
  _pdfjsCache = lib;
  return lib;
}

/* ─── PDF Canvas Viewer ──────────────────────────────────────────────────── */
// Renders PDF pages on <canvas> — zero iframes, zero X-Frame-Options issues,
// zero frame-ancestors CSP issues. PDF.js handles decoding; we handle layout.
function PdfCanvasViewer({ apiUrl, title }: { apiUrl: string; title: string }) {
  const { t } = useTranslation("knowledge");
  const [pdfDoc,      setPdfDoc]      = useState<PdfjsDocument | null>(null);
  const [numPages,    setNumPages]    = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale,       setScale]       = useState(1.3);
  const [status,      setStatus]      = useState<"loading" | "ready" | "error">("loading");
  const [errMsg,      setErrMsg]      = useState("");
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const renderTaskRef  = useRef<PdfjsRenderTask | null>(null);

  // ── Load PDF bytes and parse with PDF.js ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let docHandle: PdfjsDocument | null = null;

    setStatus("loading");
    setPdfDoc(null);
    setCurrentPage(1);

    (async () => {
      try {
        console.log("[PdfViewer] Fetching:", apiUrl);
        const res = await fetch(apiUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${apiUrl}`);

        const ct = res.headers.get("content-type") ?? "unknown";
        console.log("[PdfViewer] Content-Type:", ct);

        const buffer = await res.arrayBuffer();
        console.log("[PdfViewer] Downloaded bytes:", buffer.byteLength);
        if (cancelled) return;

        console.log("[PdfViewer] Loading PDF.js from CDN…");
        const pdfjs = await loadPdfjs();
        console.log("[PdfViewer] PDF.js ready");

        docHandle = await pdfjs.getDocument({ data: buffer }).promise;
        if (cancelled) { docHandle.destroy(); return; }

        console.log("[PdfViewer] Parsed — total pages:", docHandle.numPages);
        setPdfDoc(docHandle);
        setNumPages(docHandle.numPages);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[PdfViewer] Load error:", msg, err);
        setErrMsg(msg);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      docHandle?.destroy();
    };
  }, [apiUrl]);

  // ── Render the current page on <canvas> ──────────────────────────────────
  useEffect(() => {
    if (status !== "ready" || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    (async () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      try {
        const page     = await pdfDoc.getPage(currentPage);
        if (cancelled) { page.cleanup(); return; }

        const canvas   = canvasRef.current!;
        const viewport = page.getViewport({ scale });
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;

        const ctx  = canvas.getContext("2d")!;
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        console.log(`[PdfViewer] Page ${currentPage}/${numPages} rendered at ${Math.round(scale * 100)}%`);
        page.cleanup();
      } catch (err) {
        if ((err as Error)?.name !== "RenderingCancelledException" && !cancelled) {
          console.error("[PdfViewer] Render error:", err);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, scale, status, numPages]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const prevPage = () => setCurrentPage(p => Math.max(1, p - 1));
  const nextPage = () => setCurrentPage(p => Math.min(numPages, p + 1));
  const zoomOut  = () => setScale(s => Math.max(0.5, parseFloat((s - 0.25).toFixed(2))));
  const zoomIn   = () => setScale(s => Math.min(3.0,  parseFloat((s + 0.25).toFixed(2))));

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] gap-3">
        <RefreshCw className="h-7 w-7 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">{t("resources.loadingPdf")}</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3 p-8 text-center">
        <File className="h-12 w-12 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-destructive">{t("resources.couldNotLoadPdf")}</p>
        <pre className="text-xs bg-muted text-muted-foreground rounded p-2 max-w-sm whitespace-pre-wrap break-all text-start">{errMsg}</pre>
        <p className="text-xs text-muted-foreground">{t("resources.checkConsole")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background/95 shrink-0 text-sm select-none">
        <div className="flex items-center gap-0.5">
          <button
            onClick={prevPage}
            disabled={currentPage <= 1}
            className="px-2.5 py-1 rounded hover:bg-muted disabled:opacity-30 text-lg leading-none font-light"
            title={t("resources.pdfPreviousPage")}
          >‹</button>
          <span className="tabular-nums px-2 text-muted-foreground text-xs">
            {currentPage} / {numPages}
          </span>
          <button
            onClick={nextPage}
            disabled={currentPage >= numPages}
            className="px-2.5 py-1 rounded hover:bg-muted disabled:opacity-30 text-lg leading-none font-light"
            title={t("resources.pdfNextPage")}
          >›</button>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="px-2.5 py-1 rounded hover:bg-muted disabled:opacity-30 font-mono text-base"
            title={t("resources.pdfZoomOut")}
          >−</button>
          <span className="tabular-nums w-12 text-center text-xs text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 3.0}
            className="px-2.5 py-1 rounded hover:bg-muted disabled:opacity-30 font-mono text-base"
            title={t("resources.pdfZoomIn")}
          >+</button>
        </div>
      </div>
      {/* Canvas scroll area */}
      <div className="flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-800 flex justify-center py-4 px-2">
        <canvas
          ref={canvasRef}
          title={title}
          className="shadow-md rounded-sm bg-white block"
        />
      </div>
    </div>
  );
}

/* ─── View Dialog ────────────────────────────────────────────────────────── */
function ViewDialog({ resource, onClose }: { resource: ProgramResource | null; onClose: () => void }) {
  const { t } = useTranslation("knowledge");
  if (!resource) return null;
  const apiUrl = getDownloadUrl(resource.objectPath);

  const handleDownload = () => {
    // Fetch with credentials then trigger a download via a temporary <a> element.
    // This works for S3 signed URLs and all storage backends because the credential
    // headers are applied on the fetch call, not the anchor href.
    fetch(apiUrl, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = resource.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
      .catch(() => toast.error(t("resources.downloadFailed")));
  };

  return (
    <Dialog open={!!resource} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[95vh] flex flex-col gap-0 p-0">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-foreground">{resource.title}</h2>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Badge className={`text-xs ${CATEGORY_COLORS[resource.category] ?? "bg-gray-100 text-gray-800"}`}>{resource.category}</Badge>
              <Badge variant="outline" className="text-xs">{resource.sector}</Badge>
              {resource.versionNumber && <Badge variant="secondary" className="text-xs">{resource.versionNumber}</Badge>}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={handleDownload} className="shrink-0">
              <Download className="h-4 w-4" /> {t("resources.download")}
          </Button>
        </div>

        {/* ── Document viewer ── */}
        <div className="flex-1 min-h-0 mx-4 mb-2 rounded-md border bg-muted/20 overflow-hidden">
          {isPdf(resource.contentType) && (
            <PdfCanvasViewer apiUrl={apiUrl} title={resource.title} />
          )}
          {isImage(resource.contentType) && (
            <div className="flex items-center justify-center h-full min-h-[40vh] p-4 overflow-auto">
              <img
                src={apiUrl}
                alt={resource.title}
                className="max-w-full max-h-[70vh] object-contain rounded"
              />
            </div>
          )}
          {!isPdf(resource.contentType) && !isImage(resource.contentType) && (
            <div className="flex flex-col items-center justify-center min-h-[28vh] gap-3 p-8 text-center">
              <File className="h-14 w-14 text-muted-foreground/40" />
              <p className="text-sm font-semibold">{resource.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {t("resources.previewNotAvailable")}
              </p>
              <Button onClick={handleDownload}>
              <Download className="h-4 w-4" /> {t("resources.downloadToView")}
              </Button>
            </div>
          )}
        </div>

        {/* ── Metadata strip ── */}
        <div className="shrink-0 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground px-5 pb-4 border-t pt-2">
          {resource.description && <span className="w-full text-foreground/80">{resource.description}</span>}
          <span>{t("resources.uploadedByLabel")} <strong className="text-foreground">{resource.uploadedByName ?? "—"}</strong></span>
          {resource.effectiveDate && (
            <span>{t("resources.effectiveLabel")} <strong className="text-foreground">{fmt(resource.effectiveDate)}</strong></span>
          )}
          <span>{t("resources.updatedLabel")} <strong className="text-foreground">{fmt(resource.updatedAt)}</strong></span>
          <span>{formatBytes(resource.fileSize)}</span>
          {resource.tags && (
            <span className="w-full">
              {resource.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                <span key={t} className="inline-block bg-muted rounded px-1.5 py-0.5 me-1 text-xs">{t}</span>
              ))}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function ProgramResourcesPage() {
  const { t } = useTranslation("knowledge");
  const qc  = useQueryClient();
  const { data: me } = useGetMe();
  const perms = (me?.permissions ?? []) as string[];
  const canManage = perms.includes("*") || perms.includes("program_resources.upload");
  const canDelete = perms.includes("*") || perms.includes("program_resources.delete");

  // Determine user's sectors for "My Sector" quick filter
  const userSectors = (me?.user.sector ?? "")
    .split(",").map((s: string) => s.trim()).filter(Boolean)
    .map((s: string) => CANONICAL_TO_DOC_SECTOR[s] ?? null)
    .filter((s: string | null): s is string => s !== null);

  const isTC = me?.user.role === "technical_coordinator";
  const isStateRole = ["state_program_officer", "state_office_manager"].includes(me?.user.role ?? "");

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState("");
  const [category,     setCategory]     = useState("");
  const [sector,       setSector]       = useState("");
  const [uploadedBy,   setUploadedBy]   = useState("");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [mySector,     setMySector]     = useState(false);

  // Apply "My Sector" quick filter
  const effectiveSector = mySector && userSectors.length > 0 ? userSectors[0] : sector;

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [uploadOpen,     setUploadOpen]     = useState(false);
  const [editResource,   setEditResource]   = useState<ProgramResource | null>(null);
  const [viewResource,   setViewResource]   = useState<ProgramResource | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<ProgramResource | null>(null);
  const [archiveTarget,  setArchiveTarget]  = useState<ProgramResource | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const params = new URLSearchParams({
    ...(search        ? { search }                      : {}),
    ...(category      ? { category }                    : {}),
    ...(effectiveSector ? { sector: effectiveSector }   : {}),
    ...(uploadedBy    ? { uploadedBy }                  : {}),
    ...(dateFrom      ? { dateFrom }                    : {}),
    ...(dateTo        ? { dateTo }                      : {}),
    status: statusFilter,
  });

  const { data: statsData } = useQuery<Stats>({
    queryKey: ["program-resources", "stats"],
    queryFn:  () => fetch("/api/program-resources/stats", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: listData, isLoading } = useQuery<{ resources: ProgramResource[]; total: number }>({
    queryKey: ["program-resources", "list", params.toString()],
    queryFn:  () => fetch(`/api/program-resources?${params}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 15_000,
  });

  const { data: uploaders = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["program-resources", "uploaders"],
    queryFn:  () => fetch("/api/program-resources/uploaders", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const archiveMut = useMutation({
    mutationFn: (r: ProgramResource) =>
      fetch(`/api/program-resources/${r.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: r.status === "archived" ? "active" : "archived" }),
      }).then(async res => { if (!res.ok) throw new Error("Failed to update status"); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["program-resources"] }); toast.success(t("resources.statusUpdated")); setArchiveTarget(null); },
    onError: () => toast.error(t("resources.failedUpdateStatus")),
  });

  const deleteMut = useMutation({
    mutationFn: (r: ProgramResource) =>
      fetch(`/api/program-resources/${r.id}`, { method: "DELETE", credentials: "include" })
        .then(async res => { if (!res.ok) throw new Error("Failed to delete"); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["program-resources"] }); toast.success(t("resources.deleteSuccess")); setDeleteTarget(null); },
    onError: () => toast.error(t("resources.failedDeleteResource")),
  });

  const resources = listData?.resources ?? [];

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <BookMarked className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("resources.programmeSOPs")}</h1>
            <p className="text-sm text-muted-foreground">{t("resources.centralRepository")}</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" /> {t("resources.uploadDocument")}
          </Button>
        )}
      </div>

      {/* ── Stats cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t("resources.totalDocuments"),  value: statsData?.total ?? 0,     onClick: () => { setStatusFilter("active"); setCategory(""); } },
          { label: t("resources.sops"),            value: statsData?.sops ?? 0,      onClick: () => { setStatusFilter("active"); setCategory("SOPs"); } },
          { label: t("resources.policies"),        value: statsData?.policies ?? 0,  onClick: () => { setStatusFilter("active"); setCategory("Policies"); } },
          { label: t("resources.templates"),       value: statsData?.templates ?? 0, onClick: () => { setStatusFilter("active"); setCategory("Templates"); } },
        ].map(c => (
          <Card key={c.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={c.onClick}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recently Updated strip */}
      {(statsData?.recentlyUpdated?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground shrink-0">{t("resources.recentlyUpdatedColon")}</span>
          {(statsData?.recentlyUpdated ?? []).map(r => (
            <button
              key={r.id}
              className="text-xs text-primary hover:underline truncate max-w-[200px]"
              onClick={async () => {
                const res = await fetch(`/api/program-resources/${r.id}`, { credentials: "include" });
                if (res.ok) setViewResource(await res.json());
              }}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("resources.searchTitleDesc")}
              className="ps-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={category || "all"} onValueChange={v => setCategory(v === "all" ? "" : v)}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder={t("resources.categoryPlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("resources.allCategories")}</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={(mySector ? effectiveSector : sector) || "all"} onValueChange={v => { setMySector(false); setSector(v === "all" ? "" : v); }}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder={t("resources.sectorPlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("resources.allSectors")}</SelectItem>
              {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={uploadedBy || "all"} onValueChange={v => setUploadedBy(v === "all" ? "" : v)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder={t("resources.uploadedByPlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("resources.allUploaders")}</SelectItem>
              {uploaders.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("resources.statusActive")}</SelectItem>
              <SelectItem value="archived">{t("resources.statusArchived")}</SelectItem>
              <SelectItem value="all">{t("resources.statusAll")}</SelectItem>
            </SelectContent>
          </Select>

          {/* My Sector quick filter — shown for TC and state roles */}
          {(isTC || isStateRole) && userSectors.length > 0 && (
            <Button
              variant={mySector ? "default" : "outline"}
              size="sm"
              onClick={() => { setMySector(v => !v); if (!mySector) setSector(""); }}
            >
              <Filter className="h-3.5 w-3.5" />
              {t("resources.mySector")}
            </Button>
          )}

          {/* Date range */}
          <div className="flex flex-wrap items-center gap-1">
            <Input type="date" className="w-[140px] min-w-0 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder={t("resources.dateFromPlaceholder")} title={t("resources.dateFromTitle")} />
            <span className="text-muted-foreground text-xs">—</span>
            <Input type="date" className="w-[140px] min-w-0 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder={t("resources.dateToPlaceholder")} title={t("resources.dateToTitle")} />
          </div>

          {(search || category || sector || uploadedBy || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setCategory(""); setSector(""); setUploadedBy(""); setDateFrom(""); setDateTo(""); setMySector(false); }}>
              <X className="h-4 w-4" /> {t("resources.clear")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card overflow-x-auto" role="region" aria-label={t("resources.tableAriaLabel")}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow>
              <TableHead className="w-[30%] min-w-[200px]">{t("resources.titleCol")}</TableHead>
              <TableHead>{t("resources.categoryCol")}</TableHead>
              <TableHead>{t("resources.sectorCol")}</TableHead>
              <TableHead>{t("resources.versionCol")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("resources.effectiveDateCol")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("resources.uploadedByCol")}</TableHead>
              <TableHead>{t("resources.updatedCol")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <>
                {[...Array(6)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="space-y-1.5"><Skeleton className="h-4 w-[80%]" /><Skeleton className="h-3 w-[60%]" /></div></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-7 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))}
              </>
            )}
            {!isLoading && resources.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-14 text-muted-foreground">
                  <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="font-medium">{t("resources.noDocumentsFound")}</p>
                  <p className="text-xs mt-1">
                    {canManage ? t("resources.uploadDocumentHint") : t("resources.noDocumentsMatchFilters")}
                  </p>
                </TableCell>
              </TableRow>
            )}
            {resources.map(r => (
              <TableRow key={r.id} className={`${r.status === "archived" ? "opacity-60" : ""} hover:bg-muted/50 transition-colors`}>
                <TableCell>
                  <div>
                    <button
                      className="font-medium text-sm text-start hover:text-primary hover:underline leading-snug"
                      onClick={() => setViewResource(r)}
                    >
                      {r.title}
                    </button>
                    {r.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description}</p>
                    )}
                    {r.tags && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.tags.split(",").map(t => t.trim()).filter(Boolean).slice(0, 3).map(t => (
                          <span key={t} className="inline-block bg-muted text-muted-foreground rounded px-1.5 py-0 text-xs">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={`text-xs ${CATEGORY_COLORS[r.category] ?? "bg-gray-100 text-gray-800"}`}>{r.category}</Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{r.sector}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{r.versionNumber ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{fmt(r.effectiveDate)}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{r.uploadedByName ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{fmt(r.updatedAt)}</span>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setViewResource(r)}>
                        <Eye className="h-4 w-4 me-2" /> {t("resources.view")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => window.open(getDownloadUrl(r.objectPath), "_blank")}>
                        <Download className="h-4 w-4 me-2" /> {t("resources.download")}
                      </DropdownMenuItem>
                      {canManage && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setEditResource(r)}>
                            <Edit2 className="h-4 w-4 me-2" /> {t("resources.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setArchiveTarget(r)}>
                            <Archive className="h-4 w-4 me-2" />
                            {r.status === "archived" ? t("resources.restore") : t("resources.archive")}
                          </DropdownMenuItem>
                          {canDelete && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="h-4 w-4 me-2" /> {t("resources.delete")}
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {resources.length > 0 && (
          <div className="px-4 py-2 border-t text-xs text-muted-foreground bg-muted/30">
            {t("resources.showingDocuments", { count: resources.length, status: statusFilter !== "all" ? statusFilter : "" })}
          </div>
        )}
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <UploadDialog
        open={uploadOpen || !!editResource}
        onClose={() => { setUploadOpen(false); setEditResource(null); }}
        editResource={editResource}
      />

      <ViewDialog resource={viewResource} onClose={() => setViewResource(null)} />

      {/* Archive confirm */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(v) => !v && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveTarget?.status === "archived" ? t("resources.restoreResource") : t("resources.archiveResource")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.status === "archived"
                ? t("resources.restoreResourceDesc", { title: archiveTarget?.title })
                : t("resources.archiveResourceDesc", { title: archiveTarget?.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("resources.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveTarget && archiveMut.mutate(archiveTarget)}>
              {archiveTarget?.status === "archived" ? t("resources.restore") : t("resources.archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resources.deleteResource")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("resources.deleteResourceDesc", { title: deleteTarget?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("resources.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}
            >
              {t("resources.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
