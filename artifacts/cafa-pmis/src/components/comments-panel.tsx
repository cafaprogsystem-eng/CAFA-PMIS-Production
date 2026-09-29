import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Reply, CheckCircle2, RotateCcw, Trash2, Loader2 } from "@/components/icons";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Chip, TextArea } from "@heroui/react";
import { SelectField } from "@/components/select-field";
import { ConfirmModal } from "@/components/confirm-modal";

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

type ChipColor = "default" | "accent" | "success" | "warning" | "danger";
const TYPE_META: Record<string, { color: ChipColor }> = {
  general: { color: "default" },
  technical: { color: "accent" },
  required_correction: { color: "danger" },
  approval_note: { color: "success" },
  rejection_reason: { color: "danger" },
  revision_request: { color: "warning" },
  coordination: { color: "accent" },
  observation: { color: "default" },
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
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

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
    onSuccess: () => { setPendingDelete(null); qc.invalidateQueries({ queryKey: ["comments", entityType, entityId] }); },
    onError: () => toast.error(t("comments.deleteFailed")),
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

  const replyingToName = replyTo != null ? comments.find((c) => c.id === replyTo)?.authorName : undefined;

  function renderComment(c: Comment, depth: number) {
    const meta = TYPE_META[c.commentType] ?? TYPE_META.general;
    const kids = childrenOf.get(c.id) ?? [];
    const canDelete = currentUserId != null && (c.authorId === currentUserId || currentUserRole === "super_admin");
    const typeLabel = t(TYPE_LABELS[c.commentType] ?? "comments.typeGeneral");
    const sectionLabel = c.section ? labelFor(c.section) : sectionLabels?.general;
    return (
      // Replies indent from the reading-start edge in both directions.
      <div key={c.id} className="space-y-2" style={{ marginInlineStart: depth * 20 }}>
        <div className={`rounded-xl border border-[var(--border)] p-3 ${c.status === "resolved" ? "bg-[var(--default)] opacity-75" : "bg-[var(--surface)]"}`}>
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{c.authorName}</span>
              <span className="text-xs text-[var(--muted)]">{c.authorRoleLabel}</span>
              <Chip size="sm" variant="soft" color={meta.color}>{typeLabel}</Chip>
              {sectionLabel && <Chip size="sm" variant="tertiary">§ {sectionLabel}</Chip>}
              {c.status === "resolved" && <Chip size="sm" variant="soft" color="success">{t("comments.statusResolved")}</Chip>}
            </div>
            <bdi dir="ltr" className="shrink-0 whitespace-nowrap text-xs text-[var(--muted)]">{new Date(c.createdAt).toLocaleString("en-GB")}</bdi>
          </div>
          <p className="whitespace-pre-wrap break-words text-page-start text-sm" dir="auto">{c.body}</p>
          {!readOnly && <div className="mt-2 flex items-center gap-1">
            <Button size="sm" variant="ghost" onPress={() => { setReplyTo(c.id); setCommentType("general"); composerRef.current?.focus(); }}>
              <Reply className="size-3.5" aria-hidden="true" /> {t("comments.reply")}
            </Button>
            {c.commentType === "required_correction" && (
              c.status === "open" ? (
                <Button size="sm" variant="ghost" onPress={() => resolveMut.mutate({ id: c.id, action: "resolve" })}>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> {t("comments.resolve")}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onPress={() => resolveMut.mutate({ id: c.id, action: "reopen" })}>
                  <RotateCcw className="size-3.5" aria-hidden="true" /> {t("comments.reopen")}
                </Button>
              )
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" isIconOnly className="text-[var(--danger)]" aria-label={t("comments.delete")} onPress={() => setPendingDelete(c.id)}>
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>}
        </div>
        {kids.map((k) => renderComment(k, depth + 1))}
      </div>
    );
  }

  const filterSections = sections.filter((s) => comments.some((c) =>
    c.section === s || (c.section == null && s === "general" && !!sectionLabels?.general)));

  return (
    <Card>
      <Card.Header className="flex-row flex-wrap items-center gap-2">
        <MessageSquare className="size-4" aria-hidden="true" />
        <Card.Title className="text-base">{t("comments.title")}</Card.Title>
        {unresolvedRC > 0 && (
          <Chip size="sm" variant="soft" color="danger" className="ms-auto">
            {t("comments.unresolvedCorrections", { count: unresolvedRC })}
          </Chip>
        )}
      </Card.Header>
      <Card.Content className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {sections.length > 0 && (
            <SelectField
              aria-label={t("comments.sectionPlaceholder")}
              triggerClassName="min-w-40"
              value={section}
              onChange={setSection}
              options={[{ value: "all", label: t("comments.allSections") }, ...filterSections.map((s) => ({ value: s, label: labelFor(s) }))]}
            />
          )}
          <SelectField
            aria-label={t("comments.typePlaceholder")}
            triggerClassName="min-w-40"
            value={filterType}
            onChange={setFilterType}
            options={[{ value: "all", label: t("comments.allTypes") }, ...Object.keys(TYPE_META).map((k) => ({ value: k, label: t(TYPE_LABELS[k] ?? "comments.typeGeneral") }))]}
          />
        </div>

        {/* Thread */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("comments.loading")}</div>
          ) : isError ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{t("comments.loadFailed")}</Alert.Description>
              </Alert.Content>
              <Button size="sm" variant="tertiary" onPress={() => { void refetch(); }}>{t("comments.retry")}</Button>
            </Alert>
          ) : roots.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-[var(--border)] py-6 text-center text-sm text-[var(--muted)]">{t("comments.empty")}</div>
          ) : (
            roots.map((c) => renderComment(c, 0))
          )}
        </div>

        {/* Composer (hidden in read-only mode) */}
        {!readOnly && <div className="space-y-2 border-t border-[var(--border)] pt-4">
          {replyTo != null && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              {replyingToName ? t("comments.replyingToName", { name: replyingToName }) : t("comments.replyingTo", { id: replyTo })}
              <Button size="sm" variant="ghost" onPress={() => setReplyTo(null)}>{t("comments.cancel")}</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              aria-label={t("comments.typePlaceholder")}
              triggerClassName="min-w-40"
              isDisabled={replyTo != null}
              value={commentType}
              onChange={setCommentType}
              options={allowedTypes.map((k) => ({ value: k, label: t(TYPE_LABELS[k] ?? "comments.typeGeneral") }))}
            />
            {sections.length > 0 && replyTo == null && (
              <SelectField
                aria-label={t("comments.tagSection")}
                triggerClassName="min-w-40"
                placeholder={t("comments.tagSection")}
                value={postingSection || "_none"}
                onChange={(v) => setPostingSection(v === "_none" ? "" : v)}
                options={[{ value: "_none", label: t("comments.noSection") }, ...sections.map((s) => ({ value: s, label: labelFor(s) }))]}
              />
            )}
          </div>
          <TextArea
            ref={composerRef}
            fullWidth
            dir="auto"
            className="resize-y text-page-start"
            aria-label={replyTo != null ? t("comments.placeholderReply") : t("comments.placeholderNew")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={replyTo != null ? t("comments.placeholderReply") : t("comments.placeholderNew")}
            rows={3}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              isDisabled={!body.trim()}
              isPending={createMut.isPending}
              onPress={() => createMut.mutate({
                body: body.trim(),
                commentType: replyTo != null ? "general" : commentType,
                parentId: replyTo,
                section: replyTo != null ? null : (postingSection || null),
              })}
            >
              {createMut.isPending ? t("comments.posting") : (replyTo != null ? t("comments.postReply") : t("comments.postComment"))}
            </Button>
          </div>
        </div>}
      </Card.Content>
      <ConfirmModal
        isOpen={pendingDelete != null}
        title={t("comments.deleteConfirmTitle")}
        message={t("comments.deleteConfirmMessage")}
        confirmLabel={t("comments.delete")}
        cancelLabel={t("comments.cancel")}
        isPending={deleteMut.isPending}
        onConfirm={() => { if (pendingDelete != null) deleteMut.mutate(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  );
}
