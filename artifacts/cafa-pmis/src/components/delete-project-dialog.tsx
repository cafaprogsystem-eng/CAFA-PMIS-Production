/**
 * DeleteProjectDialog
 *
 * Mode-aware project deletion dialog.  The dialog fetches the deletion
 * mode (permanent vs. soft) from the backend when it opens, then renders
 * mode-specific copy, requires a free-text reason, and requires the user
 * to confirm by typing the exact Project Code before the destructive
 * action becomes available.
 *
 * Users never see the terms "hard delete" or "soft delete" — only
 * "Permanent Deletion" vs "Soft Delete" as defined in the spec.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Alert, Button, Chip, Input, Label, Modal, TextArea } from "@heroui/react";
import { AlertTriangle, Archive, Loader2, Trash2 } from "@/components/icons";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeletionInfo {
  canDelete: boolean;
  mode: "permanent" | "soft" | null;
}

interface DeleteProjectDialogProps {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function fetchDeletionInfo(projectId: number): Promise<DeletionInfo> {
  const res = await fetch(`/api/projects/${projectId}/deletion-info`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "deletion_info_failed");
  }
  return res.json() as Promise<DeletionInfo>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DeleteProjectDialog({
  projectId,
  projectCode,
  projectTitle,
  open,
  onOpenChange,
}: DeleteProjectDialogProps) {
  const { t } = useTranslation("common");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [codeConfirm, setCodeConfirm] = useState("");

  // Reset form fields every time the dialog opens.
  useEffect(() => {
    if (!open) {
      setReason("");
      setCodeConfirm("");
    }
  }, [open]);

  // Fetch deletion mode while the dialog is open.
  const {
    data: info,
    isLoading: infoLoading,
    error: infoError,
  } = useQuery<DeletionInfo>({
    queryKey: ["project-deletion-info", projectId],
    queryFn: () => fetchDeletionInfo(projectId),
    enabled: open && projectId > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(err.message ?? err.error ?? "deletion_failed");
      }
      return res.json() as Promise<{ deletionMode: string }>;
    },
    onSuccess: (data) => {
      toast.success(data.deletionMode === "permanent"
        ? t("deleteProject.deletedPermanently", { code: projectCode })
        : t("deleteProject.archived", { code: projectCode }));
      // ["projects"]/["dashboard"] never matched the generated hooks' real
      // keys (["/api/projects", ...], ["/api/dashboard/...", ...]), so the
      // list/dashboard silently kept showing the deleted project until a
      // manual reload. A bare invalidateQueries() refreshes everything
      // mounted, matching the pattern already used by projects.tsx's own
      // submit/duplicate mutations.
      qc.invalidateQueries();
      qc.removeQueries({ queryKey: ["project-deletion-info", projectId] });
      onOpenChange(false);
      setLocation("/projects");
    },
    onError: (err: Error) => {
      toast.error(err.message === "deletion_failed" ? t("deleteProject.failed") : err.message);
    },
  });

  // Derived state
  const mode = info?.mode ?? null;
  const isPermanent = mode === "permanent";
  const codeMatches = codeConfirm.trim() === projectCode;
  const reasonValid = reason.trim().length >= 5;
  const canSubmit =
    info?.canDelete === true &&
    codeMatches &&
    reasonValid &&
    !deleteMutation.isPending &&
    !infoLoading &&
    !!mode;

  const handleClose = () => {
    if (!deleteMutation.isPending) onOpenChange(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const codeMismatch = codeConfirm.length > 0 && !codeMatches;

  return (
    <Modal isOpen={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Modal.Backdrop isDismissable={!deleteMutation.isPending}>
        <Modal.Container size="md" scroll="inside">
          <Modal.Dialog className="max-h-[calc(100dvh-2rem)] sm:max-w-lg">
            <Modal.CloseTrigger aria-label={t("close")} />
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2">
                {isPermanent ? (
                  <AlertTriangle className="size-5 shrink-0 text-[var(--danger)]" aria-hidden="true" />
                ) : (
                  <Archive className="size-5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                )}
                {t("deleteProject.title")}
              </Modal.Heading>
              <div className="space-y-0.5 text-start">
                <span className="block font-medium leading-snug" dir="auto">{projectTitle}</span>
                <bdi dir="ltr" className="font-mono text-xs text-[var(--muted)]">{projectCode}</bdi>
              </div>
            </Modal.Header>

            <Modal.Body className="space-y-4">
              {/* ── Loading ── */}
              {infoLoading && (
                <div className="flex items-center justify-center gap-2 py-10 text-[var(--muted)]">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span className="text-sm">{t("deleteProject.loading")}</span>
                </div>
              )}

              {/* ── Error ── */}
              {!infoLoading && infoError && (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      {(infoError as Error).message === "deletion_info_failed" ? t("deleteProject.infoFailed") : (infoError as Error).message}
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {/* ── Not authorised ── */}
              {!infoLoading && !infoError && info && !info.canDelete && (
                <Alert status="default">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{t("deleteProject.noPermission")}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {/* ── Main form ── */}
              {!infoLoading && !infoError && info?.canDelete && mode && (
                <>
                  {/* Deletion type banner */}
                  <Alert status={isPermanent ? "danger" : "warning"}>
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title className="flex flex-wrap items-center gap-2">
                        {t("deleteProject.deletionType")}
                        <Chip size="sm" variant="soft" color={isPermanent ? "danger" : "warning"}>
                          {isPermanent ? t("deleteProject.permanent") : t("deleteProject.soft")}
                        </Chip>
                      </Alert.Title>
                      <Alert.Description>
                        {isPermanent ? t("deleteProject.permanentExplanation") : t("deleteProject.softExplanation")}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>

                  {/* Reason */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="deletion-reason" isRequired>{t("deleteProject.reason")}</Label>
                    <TextArea
                      id="deletion-reason"
                      fullWidth
                      dir="auto"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("deleteProjectReasonPlaceholder")}
                      className="resize-none text-page-start"
                      rows={3}
                      aria-required="true"
                      aria-describedby="deletion-reason-hint"
                    />
                    <p id="deletion-reason-hint" className="text-xs text-[var(--muted)]">{t("deleteProject.reasonHint")}</p>
                  </div>

                  {/* Project code confirmation */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="deletion-code-confirm">
                      {t("deleteProject.typeToConfirm")}{" "}
                      <bdi dir="ltr" className="rounded bg-[var(--default)] px-1.5 py-0.5 font-mono text-xs">{projectCode}</bdi>
                    </Label>
                    <Input
                      id="deletion-code-confirm"
                      fullWidth
                      dir="ltr"
                      value={codeConfirm}
                      onChange={(e) => setCodeConfirm(e.target.value)}
                      placeholder={projectCode}
                      autoComplete="off"
                      spellCheck={false}
                      aria-required="true"
                      aria-invalid={codeMismatch || undefined}
                      aria-describedby={codeMismatch ? "deletion-code-error" : undefined}
                      className="rtl:text-end"
                    />
                    {codeMismatch && (
                      <p id="deletion-code-error" className="text-xs text-[var(--danger)]" role="alert">
                        {t("deleteProject.codeMismatch")}
                      </p>
                    )}
                  </div>
                </>
              )}
            </Modal.Body>

            <Modal.Footer>
              <Button variant="tertiary" onPress={handleClose} isDisabled={deleteMutation.isPending}>
                {t("cancel")}
              </Button>
              {info?.canDelete && mode && (
                <Button
                  variant="danger"
                  onPress={() => deleteMutation.mutate()}
                  isDisabled={!canSubmit && !deleteMutation.isPending}
                  isPending={deleteMutation.isPending}
                  aria-label={isPermanent
                    ? t("deleteProject.permanentAria", { code: projectCode })
                    : t("deleteProject.softAria", { code: projectCode })}
                >
                  {!deleteMutation.isPending && <Trash2 className="size-4" aria-hidden="true" />}
                  {isPermanent ? t("deleteProject.permanentButton") : t("deleteProject.softButton")}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
