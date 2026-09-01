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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Archive, Loader2, Trash2 } from "lucide-react";
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
    throw new Error(err.error ?? "Failed to load deletion information");
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
        throw new Error(err.message ?? err.error ?? "Deletion failed");
      }
      return res.json() as Promise<{ deletionMode: string }>;
    },
    onSuccess: (data) => {
      const archived = data.deletionMode === "permanent" ? "permanently deleted" : "archived";
      toast.success(`Project ${projectCode} has been ${archived}.`);
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
      toast.error(err.message);
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPermanent ? (
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" aria-hidden="true" />
            ) : (
              <Archive className="h-5 w-5 text-amber-500 shrink-0" aria-hidden="true" />
            )}
            Delete Project
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-0.5 text-start">
              <span className="block font-medium text-foreground leading-snug">
                {projectTitle}
              </span>
              <code className="text-xs font-mono text-muted-foreground">{projectCode}</code>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* ── Loading ── */}
        {infoLoading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading deletion information…</span>
          </div>
        )}

        {/* ── Error ── */}
        {!infoLoading && infoError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {(infoError as Error).message}
          </div>
        )}

        {/* ── Not authorised ── */}
        {!infoLoading && !infoError && info && !info.canDelete && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            You do not have permission to delete this project.
          </div>
        )}

        {/* ── Main form ── */}
        {!infoLoading && !infoError && info?.canDelete && mode && (
          <div className="space-y-4">
            {/* Deletion type banner */}
            <div
              className={`rounded-lg border px-4 py-3 space-y-1.5 ${
                isPermanent
                  ? "bg-destructive/5 border-destructive/30"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Deletion Type
                </span>
                <Badge
                  variant={isPermanent ? "destructive" : "outline"}
                  className={
                    isPermanent
                      ? ""
                      : "border-amber-400 text-amber-700 bg-amber-50 font-semibold"
                  }
                >
                  {isPermanent ? "Permanent Deletion" : "Soft Delete"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-snug">
                {isPermanent
                  ? "This Project has not reached Final Approval. Deleting it will permanently remove the Project and its non-protected draft records from CAFA PMIS."
                  : "This Project has reached Final Approval. It will be removed from active CAFA PMIS records but retained for audit and historical purposes."}
              </p>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="deletion-reason" className="text-sm font-medium">
                Reason for Deletion{" "}
                <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Textarea
                id="deletion-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("deleteProjectReasonPlaceholder")}
                className="resize-none"
                rows={3}
                aria-required="true"
              />
            </div>

            {/* Project code confirmation */}
            <div className="space-y-1.5">
              <Label htmlFor="deletion-code-confirm" className="text-sm font-medium">
                To confirm, type{" "}
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {projectCode}
                </code>
              </Label>
              <Input
                id="deletion-code-confirm"
                value={codeConfirm}
                onChange={(e) => setCodeConfirm(e.target.value)}
                placeholder={projectCode}
                autoComplete="off"
                spellCheck={false}
                aria-required="true"
                aria-invalid={codeConfirm.length > 0 && !codeMatches}
                className={
                  codeConfirm.length > 0 && !codeMatches ? "border-destructive" : ""
                }
              />
              {codeConfirm.length > 0 && !codeMatches && (
                <p className="text-xs text-destructive" role="alert">
                  Project code does not match.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>

          {info?.canDelete && mode && (
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={!canSubmit}
              className="gap-1.5"
              aria-label={
                isPermanent
                  ? `Permanently delete project ${projectCode}`
                  : `Delete project ${projectCode}`
              }
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {isPermanent ? "Permanently Delete Project" : "Delete Project"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
