import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Reply, CheckCircle2, RotateCcw, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type CommentEntityType = "project" | "report" | "plan" | "risk";

export type Comment = {
  id: number;
  entityType: CommentEntityType;
  entityId: number;
  parentId: number | null;
  section: string | null;
  commentType: string;
  authorId: number;
  authorName: string;
  authorRoleLabel: string;
  body: string;
  status: "open" | "resolved" | "reopened";
  resolvedAt: string | null;
  resolvedById: number | null;
  createdAt: string;
  updatedAt: string;
};

const TYPE_META: Record<string, { color: string }> = {
  general: { color: "bg-slate-100 text-slate-700 border-slate-200" },
  technical: { color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  required_correction: { color: "bg-red-100 text-red-700 border-red-200" },
  approval_note: { color: "bg-green-100 text-green-700 border-green-200" },
  rejection_reason: { color: "bg-rose-100 text-rose-700 border-rose-200" },
  revision_request: { color: "bg-amber-100 text-amber-700 border-amber-200" },
  coordination: { color: "bg-blue-100 text-blue-700 border-blue-200" },
  observation: { color: "bg-violet-100 text-violet-700 border-violet-200" },
};

const TYPE_LABELS: Record<string, string> = {
  general: "comments.typeGeneral",
  technical: "comments.typeTechnical",
  required_correction: "comments.typeRequiredCorrection",
  approval_note: "comments.typeApprovalNote",
  rejection_reason: "comments.typeRejection",
  revision_request: "comments.typeRevisionRequest",
  coordination: "comments.typeCoordination",
  observation: "comments.typeObservation",
};

const ROLE_TYPE_ALLOW: Record<string, string[]> = {
  super_admin: Object.keys(TYPE_META),
  executive_director: Object.keys(TYPE_META),
  program_manager: ["general", "approval_note", "rejection_reason", "required_correction", "revision_request"],
  senior_program_coordinator: ["general", "coordination", "required_correction", "revision_request"],
  technical_coordinator: ["general", "technical", "required_correction", "revision_request"],
  // state_office_manager and state_program_officer have no comments access per RBAC spec.
};

export function useUnresolvedRequiredCorrections(entityType: CommentEntityType, entityId: number | null): number {
  const { data } = useQuery<Comment[]>({
    queryKey: ["comments", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/comments?entityType=${entityType}&entityId=${entityId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: entityId != null,
  });
  return (data ?? []).filter((c) => c.commentType === "required_correction" && c.status === "open").length;
}

export function CommentsPanel({
  entityType,
  entityId,
  sections = [],
  sectionLabels,
  presetSection,
  readOnly = false,
  currentUserId,
  currentUserRole,
}: {
  entityType: CommentEntityType;
  entityId: number;
  sections?: string[];
  /** Optional map of section key → human-readable display label (SPR-010). */
  sectionLabels?: Record<string, string>;
  /**
   * When set (with a fresh nonce), pre-seeds the composer's section and
   * scrolls/focuses the composer — used by contextual "Add comment" buttons.
   */
  presetSection?: { section: string; nonce: number } | null;
  /**
   * Read-only mode (SPR-010): shows the comment thread without the composer
   * or reply/resolve/delete actions — used for roles that may view a report's
   * reviewer feedback but have no comment-posting authority (e.g. SPO/SOM
   * returned-draft authors).
   */
  readOnly?: boolean;
  currentUserId: number | null;
  currentUserRole: string | null;
}) {
  const { t } = useTranslation("reports");
  const qc = useQueryClient();
  const [section, setSection] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [body, setBody] = useState("");
  const [commentType, setCommentType] = useState<string>("general");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [postingSection, setPostingSection] = useState<string>("");

  const allowedTypes: string[] = (currentUserRole ? ROLE_TYPE_ALLOW[currentUserRole] : null) ?? ["general"];
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const labelFor = (key: string) => sectionLabels?.[key] ?? key;

  // Contextual "Add comment" entry-points: pre-seed the composer section,
  // scroll it into view and focus it.
  useEffect(() => {
    if (!presetSection) return;
    setPostingSection(presetSection.section);
    setReplyTo(null);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    composerRef.current?.focus({ preventScroll: true });
  }, [presetSection]);

  const { data: comments = [], isLoading, isError, refetch } = useQuery<Comment[]>({
    queryKey: ["comments", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/comments?entityType=${entityType}&entityId=${entityId}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (payload: { body: string; commentType: string; parentId: number | null; section: string | null }) => {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entityType, entityId, ...payload }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setBody(""); setReplyTo(null); setPostingSection("");
      qc.invalidateQueries({ queryKey: ["comments", entityType, entityId] });
      toast.success(t("comments.posted"));
    },
    onError: (e: Error) => toast.error(t("comments.postFailed", { message: e.message })),
  });

  const resolveMut = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "resolve" | "reopen" }) => {
      const res = await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", entityType, entityId] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error("failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", entityType, entityId] }),
  });

  // Filtered + threaded view
  const visible = useMemo(() => {
    return comments.filter((c) => {
      if (section !== "all") {
        // Null-section comments are report-level: they belong to the
        // "general" bucket when a general key exists in the taxonomy.
        const effective = c.section ?? (sectionLabels?.general ? "general" : "");
        if (effective !== section) return false;
      }
      if (filterType !== "all" && c.commentType !== filterType) return false;
      return true;
    });
  }, [comments, section, filterType, sectionLabels]);

  const childrenOf = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of comments) {
      if (c.parentId != null) {
        const arr = m.get(c.parentId) ?? [];
        arr.push(c);
        m.set(c.parentId, arr);
      }
    }
    return m;
  }, [comments]);

  const roots = visible.filter((c) => c.parentId == null);
  const unresolvedRC = comments.filter((c) => c.commentType === "required_correction" && c.status === "open").length;

  function renderComment(c: Comment, depth: number) {
    const meta = TYPE_META[c.commentType] ?? TYPE_META.general;
    const kids = childrenOf.get(c.id) ?? [];
    const canDelete = currentUserId != null && (c.authorId === currentUserId || currentUserRole === "super_admin");
    const typeLabel = t(TYPE_LABELS[c.commentType] ?? "comments.typeGeneral");
    return (
        <div key={c.id} className="space-y-2" style={{ marginLeft: depth * 20 }}>
        <div className={`rounded-md border p-3 ${c.status === "resolved" ? "bg-muted/30 opacity-70" : "bg-card"}`}>
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{c.authorName}</span>
              <span className="text-xs text-muted-foreground">{c.authorRoleLabel}</span>
              <Badge variant="outline" className={`text-xs ${meta.color}`}>{typeLabel}</Badge>
              {c.section ? (
                <Badge variant="secondary" className="text-xs">§ {labelFor(c.section)}</Badge>
              ) : sectionLabels?.general ? (
                <Badge variant="secondary" className="text-xs">§ {sectionLabels.general}</Badge>
              ) : null}
              {c.status === "resolved" && <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">{t("comments.statusResolved")}</Badge>}
            </div>
              <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">{new Date(c.createdAt).toLocaleString("en-GB")}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
          {!readOnly && <div className="flex items-center gap-2 mt-2">
            <Button size="sm" variant="ghost" onClick={() => { setReplyTo(c.id); setCommentType("general"); }}>
              <Reply className="h-3 w-3" /> {t("comments.reply")}
            </Button>
            {c.commentType === "required_correction" && (
              c.status === "open" ? (
                <Button size="sm" variant="ghost" onClick={() => resolveMut.mutate({ id: c.id, action: "resolve" })}>
              <CheckCircle2 className="h-3 w-3" /> {t("comments.resolve")}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => resolveMut.mutate({ id: c.id, action: "reopen" })}>
              <RotateCcw className="h-3 w-3" /> {t("comments.reopen")}
                </Button>
              )
            )}
            {canDelete && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={t("comments.delete")} onClick={() => deleteMut.mutate(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>}
        </div>
        {kids.map((k) => renderComment(k, depth + 1))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          {t("comments.title")}
          {unresolvedRC > 0 && (
            <Badge variant="outline" className="ms-auto bg-red-50 text-red-700 border-red-200">
              {t("comments.unresolvedCorrections", { count: unresolvedRC })}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {sections.length > 0 && (
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger aria-label={t("comments.allSections")} className="h-8 min-w-36 w-auto max-w-full text-xs"><SelectValue placeholder={t("comments.sectionPlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("comments.allSections")}</SelectItem>
                {sections
                  .filter((s) => comments.some((c) =>
                    c.section === s || (c.section == null && s === "general" && !!sectionLabels?.general)))
                  .map((s) => <SelectItem key={s} value={s}>{labelFor(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger aria-label={t("comments.allTypes")} className="h-8 min-w-36 w-auto max-w-full text-xs"><SelectValue placeholder={t("comments.typePlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("comments.allTypes")}</SelectItem>
              {Object.keys(TYPE_META).map((k) => (
                <SelectItem key={k} value={k}>{t(TYPE_LABELS[k] ?? "comments.typeGeneral")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Thread */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t("comments.loading")}</div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>{t("comments.loadFailed")}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
                {t("comments.retry")}
              </Button>
            </div>
          ) : roots.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-md">{t("comments.empty")}</div>
          ) : (
            roots.map((c) => renderComment(c, 0))
          )}
        </div>

        {/* Composer (hidden in read-only mode) */}
        {!readOnly && <div className="border-t pt-4 space-y-2">
          {replyTo != null && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {t("comments.replyingTo", { id: replyTo })}
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setReplyTo(null)}>{t("comments.cancel")}</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={commentType} onValueChange={setCommentType} disabled={replyTo != null}>
              <SelectTrigger aria-label={t("comments.typePlaceholder")} className="h-8 min-w-40 w-auto max-w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowedTypes.map((k: string) => (
                  <SelectItem key={k} value={k}>{t(TYPE_LABELS[k] ?? "comments.typeGeneral")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sections.length > 0 && replyTo == null && (
              <Select value={postingSection || "_none"} onValueChange={(v) => setPostingSection(v === "_none" ? "" : v)}>
                <SelectTrigger aria-label={t("comments.tagSection")} className="h-8 min-w-36 w-auto max-w-full text-xs"><SelectValue placeholder={t("comments.tagSection")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{t("comments.noSection")}</SelectItem>
                  {sections.map((s) => <SelectItem key={s} value={s}>{labelFor(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <Textarea
            ref={composerRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={replyTo != null ? t("comments.placeholderReply") : t("comments.placeholderNew")}
            rows={3}
            className="resize-y"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!body.trim() || createMut.isPending}
              onClick={() => createMut.mutate({
                body: body.trim(),
                commentType: replyTo != null ? "general" : commentType,
                parentId: replyTo,
                section: replyTo != null ? null : (postingSection || null),
              })}
            >
              {createMut.isPending
                ? <><Loader2 className="h-3 w-3 animate-spin" /> {t("comments.posting")}</>
                : (replyTo != null ? t("comments.postReply") : t("comments.postComment"))
              }
            </Button>
          </div>
        </div>}
      </CardContent>
    </Card>
  );
}
