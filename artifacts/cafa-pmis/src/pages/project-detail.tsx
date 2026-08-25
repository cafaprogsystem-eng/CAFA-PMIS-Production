import { useState, useRef, useEffect } from "react";
import { uploadDocumentFile } from "@/lib/upload-document";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useGetMe,
  useCorrectProjectDonor,
  useRetireDevelopmentTestProject,
  useListDonors,
  useTransitionProject,
  useListProjectStateAllocations,
  useCreateRisk,
  requestUploadUrl,
  scanProjectDonorIntegrity,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatDateTime, formatPercent, formatStatusLabel, hasPerm, severityBadgeVariant } from "@/lib/format";
import { ProjectStatusBadge, ProgressBar } from "./projects";
import { CheckCircle2, ArrowLeft, DollarSign, Users, Target, Activity as ActivityIcon, AlertCircle, FileText, TrendingUp, Plus, Shield, Building2, CalendarDays, Hash, Tag, Pencil, Trash2, Lock, Upload, Archive } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { StatCard } from "@/components/ui/stat-card";
import { CommentsPanel, useUnresolvedRequiredCorrections } from "@/components/comments-panel";
import { EditProjectDialog } from "@/components/project-registration-form";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VoiceNotePanel } from "@/components/voice-note-panel";
import { PmrCompletenessPanel } from "@/components/pmr-completeness-panel";
import { useTranslation } from "react-i18next";
import { getLinkedStateLabel } from "@/components/state-label";
import { StateLabel } from "@/components/state-label";
import { ContinueEditingAction } from "@/components/continue-editing-action";

type Action = "submit" | "technical_review" | "coordination_review" | "final_approve" | "activate" | "close" | "reject" | "request_revision";

interface ActionDef {
  action: Action;
  label: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  perm: string;
  fromStatuses: string[];
  managementLevels?: ("hq_managed" | "state_managed")[];
}

// Approval chain per CAFA Program Department spec:
// State Program Officer -> Technical Coordinator -> Senior Program Coordinator -> Program Manager.
// State Office Manager is monitoring-only and not in the chain.
const ACTIONS: ActionDef[] = [
  { action: "submit", label: "Submit", perm: "projects.create", fromStatuses: ["draft"] },
  { action: "technical_review", label: "Technical Coordinator Review", perm: "projects.approve.technical", fromStatuses: ["submitted", "state_reviewed"] },
  { action: "coordination_review", label: "Senior Programme Coordinator Review", perm: "projects.approve.coordination", fromStatuses: ["technically_approved"] },
  { action: "final_approve", label: "Programme Manager Approve", perm: "projects.approve.final", fromStatuses: ["coordination_approved"], variant: "default" },
  { action: "activate", label: "Activate Project", perm: "projects.activate", fromStatuses: ["approved"], variant: "default" },
  { action: "close", label: "Close Project", perm: "projects.close", fromStatuses: ["active"], variant: "secondary" },
  // PRJ-BD-02: stage-aware negative actions — the reviewer who owns a stage can
  // also return or reject at that stage (mirrors the backend stage-aware perms).
  { action: "request_revision", label: "Request Revision", perm: "projects.approve.technical", fromStatuses: ["submitted", "state_reviewed"], variant: "outline" },
  { action: "request_revision", label: "Request Revision", perm: "projects.approve.coordination", fromStatuses: ["technically_approved"], variant: "outline" },
  { action: "request_revision", label: "Request Revision", perm: "projects.approve.final", fromStatuses: ["coordination_approved"], variant: "outline" },
  { action: "reject", label: "Reject", perm: "projects.approve.technical", fromStatuses: ["submitted", "state_reviewed"], variant: "destructive" },
  { action: "reject", label: "Reject", perm: "projects.approve.coordination", fromStatuses: ["technically_approved"], variant: "destructive" },
  { action: "reject", label: "Reject", perm: "projects.approve.final", fromStatuses: ["coordination_approved"], variant: "destructive" },
];

function TransitionDialog({ projectId, action, label, open, onOpenChange }: {
  projectId: number;
  action: Action;
  label: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [comment, setComment] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("projects");
  const transition = useTransitionProject();
  // Spec: rationale required for revision/rejection.
  const commentRequired = action === "request_revision" || action === "reject";

  const submit = () => {
    transition.mutate(
      { projectId, data: { action, comment: comment || undefined } },
      {
        onSuccess: () => {
          toast({ title: t("detail.actionRecorded"), description: `${label} applied.` });
          qc.invalidateQueries();
          setComment("");
          onOpenChange(false);
        },
        onError: (e: unknown) => {
          const err = e as { response?: { data?: { error?: string; count?: number } } };
          const code = err.response?.data?.error;
          const msg = code === "unresolved_required_corrections"
            ? `Cannot approve — ${err.response?.data?.count ?? 0} unresolved Required Correction(s). Resolve them first.`
            : code === "comment_required_for_revision_or_reject"
            ? t("detail.reasonCommentRequired")
            : String(e);
          toast({ title: t("detail.actionFailed"), description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {commentRequired ? t("detail.reasonRequired") : t("detail.commentOptional")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={4}
          placeholder={commentRequired ? t("detail.reasonPlaceholder") : t("detail.commentPlaceholder")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("detail.confirm") === "تأكيد" ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={transition.isPending || (commentRequired && !comment.trim())}>
            {transition.isPending ? t("detail.saving") : t("detail.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DonorCorrectionDialog({
  projectId,
  projectCode,
  onCorrected,
}: {
  projectId: number;
  projectCode: string;
  onCorrected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [donorChoice, setDonorChoice] = useState("");
  const [reason, setReason] = useState("");
  const { data: donors = [] } = useListDonors();
  const correctDonor = useCorrectProjectDonor();
  const { toast } = useToast();
  const { t } = useTranslation("projects");
  const { t: tCommon } = useTranslation("common");

  function close() {
    setOpen(false);
    setDonorChoice("");
    setReason("");
  }

  async function submit() {
    if (!donorChoice || !reason.trim()) {
      toast({ title: t("detail.donorCorrectionReasonRequired"), variant: "destructive" });
      return;
    }
    try {
      await correctDonor.mutateAsync({
        projectId,
        data: {
          donorId: donorChoice === "unknown" ? null : Number(donorChoice),
          reason: reason.trim(),
        },
      });
      toast({ title: t("detail.donorCorrectionSuccess") });
      close();
      onCorrected();
    } catch (error) {
      toast({
        title: t("detail.donorCorrectionFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-9 gap-1.5">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          {t("detail.correctDonor")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("detail.correctDonor")}</DialogTitle>
          <DialogDescription>{t("detail.donorCorrectionDescription", { projectCode })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="donor-correction-donor">{t("detail.replacementDonor")}</Label>
            <Select value={donorChoice} onValueChange={setDonorChoice}>
              <SelectTrigger id="donor-correction-donor">
                <SelectValue placeholder={t("detail.selectReplacementDonor")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t("detail.markDonorUnknown")}</SelectItem>
                {donors.map((donor) => (
                  <SelectItem key={donor.id} value={String(donor.id)}>{donor.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("detail.donorCorrectionNoFreeText")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="donor-correction-reason">{t("detail.donorCorrectionReason")}</Label>
            <Textarea
              id="donor-correction-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("detail.donorCorrectionReasonPlaceholder")}
              maxLength={1000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={correctDonor.isPending}>{tCommon("cancel")}</Button>
          <Button onClick={submit} disabled={correctDonor.isPending || !donorChoice || !reason.trim()}>
            {correctDonor.isPending ? t("detail.saving") : t("detail.confirmDonorCorrection")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DevelopmentTestRetirementDialog({
  projectId,
  projectCode,
  onRetired,
}: {
  projectId: number;
  projectCode: string;
  onRetired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const retire = useRetireDevelopmentTestProject();
  const { toast } = useToast();
  const { t } = useTranslation("projects");

  function close() {
    setOpen(false);
    setReason("");
    setConfirmation("");
  }

  async function submit() {
    if (reason.trim().length < 5 || confirmation.trim() !== projectCode) return;
    const confirmationCode = confirmation.trim() as "CAFA-MPLQLM3M";
    try {
      await retire.mutateAsync({ projectId, data: { reason: reason.trim(), confirmationCode } });
      toast({ title: t("detail.developmentFixtureRetired") });
      close();
      onRetired();
    } catch (error) {
      toast({
        title: t("detail.developmentFixtureRetirementFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-9 gap-1.5 text-amber-700 border-amber-400 hover:bg-amber-50 hover:text-amber-800">
          <Archive className="h-4 w-4" aria-hidden="true" />
          {t("detail.retireDevelopmentFixture")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("detail.retireDevelopmentFixture")}</DialogTitle>
          <DialogDescription>{t("detail.developmentFixtureRetirementDescription", { projectCode })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {t("detail.developmentFixtureRetirementWarning")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="development-fixture-retirement-reason">{t("detail.developmentFixtureRetirementReason")}</Label>
            <Textarea
              id="development-fixture-retirement-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("detail.developmentFixtureRetirementReasonPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="development-fixture-retirement-confirmation">
              {t("detail.developmentFixtureRetirementConfirm", { projectCode })}
            </Label>
            <Input
              id="development-fixture-retirement-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>{t("detail.cancel")}</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={retire.isPending || reason.trim().length < 5 || confirmation.trim() !== projectCode}
          >
            {retire.isPending ? t("detail.saving") : t("detail.confirmDevelopmentFixtureRetirement")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Frontend risk-level helper (mirrors backend computeRiskLevel) ────────────
function computeRiskLevelFE(likelihood: string, impact: string): string {
  const m: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const score = (m[likelihood] ?? 2) * (m[impact] ?? 2);
  if (score >= 9) return "critical";
  if (score >= 6) return "high";
  if (score >= 2) return "medium";
  return "low";
}

const RISK_CATS = ["Security", "Programmatic", "Operational", "Financial", "Compliance", "Access"] as const;

function CreateProjectRiskDialog({
  projectId,
  projectStates,
  onCreated,
}: {
  projectId: number;
  projectStates: { id: number; name: string }[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    title: "", category: "Programmatic",
    likelihood: "medium", impact: "medium",
    stateId: projectStates.length === 1 ? String(projectStates[0].id) : "",
    mitigationPlan: "", dueDate: "",
  });
  const createRisk = useCreateRisk();
  const { toast } = useToast();
  const { t } = useTranslation("projects");
  const { t: tCommon } = useTranslation("common");

  function reset() {
    setF({ title: "", category: "Programmatic", likelihood: "medium", impact: "medium",
      stateId: projectStates.length === 1 ? String(projectStates[0].id) : "",
      mitigationPlan: "", dueDate: "" });
  }

  async function submit() {
    if (!f.title.trim()) { toast({ title: t("detail.riskTitleRequired"), variant: "destructive" }); return; }
    if (!f.stateId) { toast({ title: t("detail.riskSelectStateError"), variant: "destructive" }); return; }
    try {
      await createRisk.mutateAsync({
        data: {
          title: f.title.trim(), category: f.category.toLowerCase(),
          severity: f.impact, impact: f.impact, likelihood: f.likelihood,
          stateId: Number(f.stateId), projectId,
          mitigationPlan: f.mitigationPlan.trim() || undefined,
          dueDate: f.dueDate || undefined,
        },
      } as Parameters<typeof createRisk.mutateAsync>[0]);
      toast({ title: t("detail.actionRecorded") });
      setOpen(false); reset(); onCreated();
    } catch (e) {
      toast({ title: t("detail.riskFailedToCreate"), description: String(e), variant: "destructive" });
    }
  }

  const level = computeRiskLevelFE(f.likelihood, f.impact);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Plus className="h-3 w-3" />{t("detail.newRisk")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("detail.logNewRisk")}</DialogTitle>
          <DialogDescription>{t("detail.logNewRiskDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label>{t("detail.riskTitle")}</Label>
            <Input value={f.title} onChange={(e) => setF(p => ({ ...p, title: e.target.value }))} placeholder={t("detail.riskBriefDesc")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("detail.riskCategory")}</Label>
              <Select value={f.category} onValueChange={(v) => setF(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RISK_CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("detail.riskState")}</Label>
              <Select value={f.stateId} onValueChange={(v) => setF(p => ({ ...p, stateId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("detail.riskSelectState")} /></SelectTrigger>
                <SelectContent>{projectStates.map(s => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("detail.riskProbability")}</Label>
              <Select value={f.likelihood} onValueChange={(v) => setF(p => ({ ...p, likelihood: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{tCommon("low")}</SelectItem>
                  <SelectItem value="medium">{tCommon("medium")}</SelectItem>
                  <SelectItem value="high">{tCommon("high")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("detail.riskImpact")}</Label>
              <Select value={f.impact} onValueChange={(v) => setF(p => ({ ...p, impact: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{tCommon("low")}</SelectItem>
                  <SelectItem value="medium">{tCommon("medium")}</SelectItem>
                  <SelectItem value="high">{tCommon("high")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t("detail.riskComputedLevel")}</span>
            <Badge variant={severityBadgeVariant(level)}>{level}</Badge>
          </div>
          <div>
            <Label>{t("detail.riskDueDate")}</Label>
            <Input type="date" value={f.dueDate} onChange={(e) => setF(p => ({ ...p, dueDate: e.target.value }))} />
          </div>
          <div>
            <Label>{t("detail.riskMitigationPlan")}</Label>
            <Textarea rows={2} value={f.mitigationPlan} onChange={(e) => setF(p => ({ ...p, mitigationPlan: e.target.value }))} placeholder={t("detail.riskMitigationPlaceholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>{tCommon("cancel")}</Button>
          <Button onClick={submit} disabled={createRisk.isPending}>{createRisk.isPending ? tCommon("savingData") : t("detail.saveRisk")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ReportKpis = {
  reportCount: number;
  beneficiariesReached: number;
  totalPlannedBudget: number;
  totalActualExpenditure: number;
  burnRatePct: number;
  totalActivities: number;
  completedActivities: number;
  activityCompletionPct: number;
  avgActivityProgressPct: number;
  latestPeriod: string | null;
  activitiesOnBudget: number;
  activitiesUnderBudget: number;
  activitiesOverBudget: number;
};

function useProjectReportKpis(projectId: number) {
  return useQuery<ReportKpis>({
    queryKey: ["project-report-kpis", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/report-kpis`);
      if (!res.ok) throw new Error("Failed to load report KPIs");
      return res.json() as Promise<ReportKpis>;
    },
    staleTime: 60_000,
  });
}

export default function ProjectDetailPage({
  params,
  embedded = false,
  onContinueEdit,
  onRecordLoaded,
}: {
  params: { projectId: string };
  embedded?: boolean;
  onContinueEdit?: () => void;
  onRecordLoaded?: (header: { title: string; description?: string }) => void;
}) {
  const projectId = Number(params.projectId);
  const [, setLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useGetProject(projectId);
  const { data: kpis } = useProjectReportKpis(projectId);
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const [activeAction, setActiveAction] = useState<{ action: Action; label: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const unresolvedRC = useUnresolvedRequiredCorrections("project", projectId);
  const {
    data: stateAllocations,
    isLoading: isStateAllocationsLoading,
    isError: isStateAllocationsError,
    refetch: refetchStateAllocations,
  } = useListProjectStateAllocations(projectId);
  const { t, i18n } = useTranslation("projects");
  const { t: tCommon } = useTranslation("common");
  const { toast } = useToast();
  const hasEditParam = !embedded && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("edit");
  const canRunDonorIntegrityScan = hasPerm(me?.permissions, "projects.donor.correct");
  const { data: donorIntegrityScan } = useQuery({
    queryKey: ["/api/projects/donor-integrity-scan"],
    queryFn: () => scanProjectDonorIntegrity(),
    enabled: canRunDonorIntegrityScan,
    staleTime: 30_000,
  });
  const isReviewedDevelopmentFixture = import.meta.env.DEV
    && projectId === 19
    && data?.project.code === "CAFA-MPLQLM3M"
    && data.project.title === "TX Test"
    && data.project.status === "submitted";
  const canRetireDevelopmentFixture = isReviewedDevelopmentFixture && hasPerm(me?.permissions, "projects.delete");
  const canCorrectDonor = !isReviewedDevelopmentFixture
    && (donorIntegrityScan?.confirmedPlaceholders.some((finding) => finding.id === projectId) ?? false);

  useEffect(() => {
    if (hasEditParam) setEditOpen(true);
  }, [hasEditParam]);

  useEffect(() => {
    if (!data?.project) return;
    onRecordLoaded?.({
      title: data.project.title,
      description: [data.project.code, formatStatusLabel(data.project.status)].filter(Boolean).join(" · "),
    });
  }, [data, onRecordLoaded]);

  // PRJ-BD-04: Document management state
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [overrideDeleteDialog, setOverrideDeleteDialog] = useState<{ docId: number; fileName: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideReasonError, setOverrideReasonError] = useState("");
  const [isOverrideDeleting, setIsOverrideDeleting] = useState(false);

  // PRJ-BD-04: Standalone documents query (bypasses the PATCH-only form)
  const { data: projectDocuments = [], refetch: refetchProjectDocs } = useQuery<Array<{
    id: number; category: string; kind: string; fileName: string;
    contentType: string; size: number;
    uploadedByName: string | null; uploadedAt: string;
    availabilityStatus?: "available" | "unavailable";
  }>>({
    queryKey: ["project-documents", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/documents`);
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json() as Promise<Array<{ id: number; category: string; kind: string; fileName: string; contentType: string; size: number; uploadedByName: string | null; uploadedAt: string; availabilityStatus?: "available" | "unavailable"; }>>;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  if (isError) {
    return (
      <div className="space-y-6">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          {t("backToProjects")}
        </Link>
        <ErrorState
          variant="server"
          title={t("loadErrorProject")}
          description={t("loadErrorProjectDesc")}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb skeleton */}
        <Skeleton className="h-4 w-24 rounded" />
        {/* Identity skeleton */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Skeleton className="h-8 w-64 rounded-lg" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-4 w-36 rounded" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        {/* Overview card grid (matches 2-column overview cards) */}
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[180px] rounded-xl" />)}
        </div>
        {/* Tabs bar */}
        <Skeleton className="h-10 w-full rounded-lg" />
        {/* Content */}
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const { project, outputs, activities, indicators, risks, reports, beneficiariesReached, beneficiariesTarget, budgetTotal, budgetSpent, states, approvalHistory } = data;

  // BUD-006: project ISO currency threaded through every monetary display —
  // never rely on the USD fallback in formatCurrency.
  const projectCurrency = (project as { currency?: string }).currency;

  // PRJ-BD-04: Lifecycle gate derived from project status.
  // Frozen set matches server: both "completed" and "closed" are fully locked.
  const docGate: "mutable" | "operational" | "frozen" =
    (project.status === "closed" || project.status === "completed") ? "frozen"
    : (project.status === "approved" || project.status === "active") ? "operational"
    : "mutable";
  const isDocOverrideActor = me?.user?.role === "program_manager" || me?.user?.role === "super_admin";

  // PRJ-BD-04: Upload handler — uses uploadDocumentFile utility (PUT → POST guard)
  async function handleDocumentUpload(file: File) {
    if (isUploading) return;
    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl({
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      });
      const result = await uploadDocumentFile(projectId, file, uploadURL, objectPath, {
        category: "optional",
        kind: "other",
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });
      if (!result.ok) {
        const title = result.error === "storage_put_failed"
          ? "Upload failed — storage service rejected the file. Please try again."
          : result.error ?? "Upload failed.";
        toast({ title, variant: "destructive" });
        return;
      }
      await refetchProjectDocs();
      toast({ title: "Document uploaded successfully." });
    } catch {
      toast({ title: "Upload failed. Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }

  // Downloads stay inside the product flow: a missing legacy object must show
  // a truthful in-app failure rather than navigate the user to API JSON.
  async function handleDocumentDownload(doc: { id: number; fileName: string }) {
    try {
      const response = await fetch(`/api/projects/${projectId}/documents/${doc.id}/download`, {
        credentials: "include",
      });
      if (!response.ok) {
        toast({
          title: "Document download unavailable.",
          description: "The file could not be retrieved. It may no longer be available.",
          variant: "destructive",
        });
        return;
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = doc.fileName.replace(/[/\\\r\n"]/g, "_") || "download";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      toast({
        title: "Document download unavailable.",
        description: "Please try again when the connection is restored.",
        variant: "destructive",
      });
    }
  }

  // PRJ-BD-04: Normal delete (mutable projects)
  async function handleNormalDocDelete(docId: number) {
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Delete failed." })) as { message?: string };
        toast({ title: body.message ?? "Delete failed.", variant: "destructive" });
        return;
      }
      await refetchProjectDocs();
      toast({ title: "Document deleted." });
    } catch {
      toast({ title: "Delete failed. Please try again.", variant: "destructive" });
    }
  }

  // PRJ-BD-04: Override delete (PM/SA on operational projects)
  async function handleOverrideDocDelete() {
    const reason = overrideReason.trim();
    if (!reason) { setOverrideReasonError("An override reason is required."); return; }
    if (!overrideDeleteDialog) return;
    setIsOverrideDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/${overrideDeleteDialog.docId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideReason: reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Override delete failed." })) as { message?: string };
        toast({ title: body.message ?? "Override delete failed.", variant: "destructive" });
        return;
      }
      await refetchProjectDocs();
      toast({ title: "Document deleted with override. This action has been recorded in the audit history." });
      setOverrideDeleteDialog(null);
      setOverrideReason("");
      setOverrideReasonError("");
    } catch {
      toast({ title: "Override delete failed. Please try again.", variant: "destructive" });
    } finally {
      setIsOverrideDeleting(false);
    }
  }

  const availableActions = ACTIONS.filter(a =>
    a.fromStatuses.includes(project.status)
    && hasPerm(me?.permissions, a.perm)
    && (!a.managementLevels || a.managementLevels.includes(project.managementLevel as "hq_managed" | "state_managed"))
  );
  const indicatorAvg = indicators.length > 0
    ? Math.round(indicators.reduce((acc, i) => acc + (i.target > 0 ? Math.min(100, (i.achieved / i.target) * 100) : 0), 0) / indicators.length)
    : 0;
  const activitiesCompletion = activities.length > 0
    ? Math.round(activities.reduce((acc, a) => acc + a.progressPct, 0) / activities.length)
    : 0;

  return (
    <div className="space-y-6">

      {/* ── Breadcrumb ── */}
      {!embedded && <nav aria-label={tCommon("breadcrumb")}>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          {t("title")}
        </Link>
      </nav>}

      {/* ── Project identity + actions ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">

        {/* Left: identity */}
        <div className="space-y-2 min-w-0">

          {/* Title + status badge */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight leading-tight">{project.title}</h1>
            <ProjectStatusBadge status={project.status} />
          </div>

          {/* Metadata row — code, donor, sector, dates */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 shrink-0">
              <Hash className="h-4 w-4" aria-hidden="true" />
              <code className="font-mono text-xs"><bdi dir="ltr">{project.code}</bdi></code>
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[200px]">{project.donor}</span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Tag className="h-4 w-4" aria-hidden="true" />
              {project.sector}
              {project.assistanceModality && (
                <Badge variant="outline" className="text-xs ms-1">{project.assistanceModality}</Badge>
              )}
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {formatDate(project.startDate)} – {formatDate(project.endDate)}
            </span>
          </div>

          {/* Operational Locations badges */}
          {(() => {
            const hasHq = Boolean((project as unknown as Record<string, unknown>).hasHqOperations);
            const totalLocs = (hasHq ? 1 : 0) + states.length;
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                {totalLocs === 0 && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">{t("coverage.stateNotAssigned")}</Badge>
                )}
                {totalLocs === 1 && !hasHq && (
                  <Badge variant="submitted" className="text-xs cursor-default">{t("coverage.singleState")}</Badge>
                )}
                {totalLocs > 1 && (
                  <Badge variant="completed" className="text-xs cursor-default">{t("coverage.multiState")}</Badge>
                )}
                {hasHq && (
                  <Badge variant="outline" className="text-xs font-medium">HQ</Badge>
                )}
                {states.map(s => <Badge key={s.id} variant="outline" className="text-xs"><StateLabel state={s} /></Badge>)}
              </div>
            );
          })()}
        </div>

        {/* Right: edit + workflow actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Edit button for draft projects */}
          {project.status === "draft" && hasPerm(me?.permissions, "projects.update") && (
            embedded ? (
              <ContinueEditingAction
                recordTitle={project.title}
                onClick={() => onContinueEdit?.()}
              />
            ) : (
              <Button
                size="sm"
                variant="default"
                className="h-9 gap-1.5"
                onClick={() => setEditOpen(true)}
                aria-label={t("editProject")}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {tCommon("edit")}
              </Button>
            )
          )}
          {availableActions.map(a => {
              const blocked = a.action === "final_approve" && unresolvedRC > 0;
              const btn = (
                <Button
                  key={a.action}
                  variant={a.variant || "default"}
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={blocked}
                  onClick={() => setActiveAction({ action: a.action, label: a.label })}
                >
                  {blocked && <AlertCircle className="h-4 w-4" aria-hidden="true" />}
                  {a.label}
                </Button>
              );
              if (!blocked) return btn;
              return (
                <Tooltip key={a.action}>
                  <TooltipTrigger asChild><span>{btn}</span></TooltipTrigger>
                  <TooltipContent>{unresolvedRC} {t("detail.unresolvedCorrections")}{unresolvedRC === 1 ? "" : "s"} {t("detail.unresolvedCorrectionsMust")}</TooltipContent>
                </Tooltip>
              );
            })}
          {/* Delete Project — visible to users with projects.delete permission */}
          {hasPerm(me?.permissions, "projects.delete") && !isReviewedDevelopmentFixture && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
              aria-label={t("detail.deleteProjectAria")}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          )}
          {canRetireDevelopmentFixture && (
            <DevelopmentTestRetirementDialog
              projectId={projectId}
              projectCode={project.code}
              onRetired={() => {
                void qc.invalidateQueries({ queryKey: ["/api/projects"] });
                void qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
                void qc.invalidateQueries({ queryKey: ["/api/projects/donor-integrity-scan"] });
                setLocation("/projects");
              }}
            />
          )}
          {canCorrectDonor && (
            <DonorCorrectionDialog
              projectId={projectId}
              projectCode={(project as unknown as Record<string, string>).code ?? ""}
              onCorrected={() => {
                void qc.invalidateQueries({ queryKey: ["/api/projects"] });
                void qc.invalidateQueries({ queryKey: ["/api/projects/donor-integrity-scan"] });
                void refetch();
              }}
            />
          )}
          </div>
      </div>

      {activeAction && (
        <TransitionDialog
          projectId={projectId}
          action={activeAction.action}
          label={activeAction.label}
          open={!!activeAction}
          onOpenChange={(o) => !o && setActiveAction(null)}
        />
      )}

      <EditProjectDialog
        projectId={projectId}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />

      <DeleteProjectDialog
        projectId={projectId}
        projectCode={(project as unknown as Record<string, string>).code ?? ""}
        projectTitle={project.title}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />

      {/* KPI strip — sourced from submitted/approved Project Reports */}
      {kpis && kpis.reportCount > 0 ? (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground -mb-2">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {t("detail.kpisFrom")} {kpis.reportCount} {kpis.reportCount !== 1 ? t("detail.kpisReports") : t("detail.kpisReport")}
            {kpis.latestPeriod && <> · {t("detail.latestPeriod")}: <strong>{kpis.latestPeriod}</strong></>}
          </div>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              icon={TrendingUp} iconBg="bg-blue-500"
              label={t("detail.progress")}
              value={`${kpis.avgActivityProgressPct}%`}
              sub={t("detail.avgProgress")}
            />
            <StatCard
              icon={DollarSign} iconBg="bg-amber-500"
              label={t("detail.burnRate")}
              value={`${kpis.burnRatePct}%`}
              sub={`${formatCurrency(kpis.totalActualExpenditure, projectCurrency)} ${t("detail.spentLabel").toLowerCase()}`}
            />
            <StatCard
              icon={Users} iconBg="bg-emerald-500"
              label={t("detail.beneficiaries")}
              value={kpis.beneficiariesReached.toLocaleString()}
              sub={`${t("detail.of")} ${beneficiariesTarget.toLocaleString()} ${t("detail.target")}`}
            />
            <StatCard
              icon={ActivityIcon} iconBg="bg-violet-500"
              label={t("detail.activityCompletion")}
              value={`${kpis.activityCompletionPct}%`}
              sub={`${kpis.completedActivities} ${t("detail.of")} ${kpis.totalActivities} ${t("detail.completed")}`}
            />
            <StatCard
              icon={Target} iconBg="bg-teal-500"
              label={t("detail.indicatorProgress")}
              value={`${indicatorAvg}%`}
              sub={`${t("detail.avgAcross")} ${indicators.length} ${indicators.length !== 1 ? t("detail.indicators_plural") : t("detail.indicator")}`}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            icon={DollarSign} iconBg="bg-amber-500"
            label={t("detail.budget")}
            value={formatCurrency(budgetSpent, projectCurrency)}
            sub={`${t("detail.of")} ${formatCurrency(budgetTotal, projectCurrency)}`}
          />
          <StatCard
            icon={Users} iconBg="bg-emerald-500"
            label={t("detail.beneficiaries")}
            value={beneficiariesReached.toLocaleString()}
            sub={`${t("detail.of")} ${beneficiariesTarget.toLocaleString()} ${t("detail.target")}`}
          />
          <StatCard
            icon={Target} iconBg="bg-teal-500"
            label={t("detail.indicatorAchievement")}
            value={`${indicatorAvg}%`}
            sub={`${t("detail.avgAcross")} ${indicators.length} ${indicators.length !== 1 ? t("detail.indicators_plural") : t("detail.indicator")}`}
          />
          <StatCard
            icon={ActivityIcon} iconBg="bg-violet-500"
            label={t("detail.activities")}
            value={`${activitiesCompletion}%`}
            sub={`${activities.length} ${t("detail.totalPlanned")}`}
          />
        </div>
      )}

      <Tabs defaultValue="overview" className="w-full">
        {/* Horizontally scrollable tab bar — no wrapping rows */}
        <div className="overflow-x-auto pb-px -mx-px px-px">
          <TabsList className="inline-flex h-10 w-max min-w-full gap-0 rounded-lg">
            <TabsTrigger value="overview">{t("detail.overview")}</TabsTrigger>
            <TabsTrigger value="activities" className="gap-1.5">
              {t("detail.activities")}
              {activities.length > 0 && (
                <span className="text-xs font-medium bg-muted-foreground/15 rounded-full px-1.5 py-px tabular-nums leading-none">
                  {activities.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="indicators" className="gap-1.5">
              {t("detail.indicators")}
              {indicators.length > 0 && (
                <span className="text-xs font-medium bg-muted-foreground/15 rounded-full px-1.5 py-px tabular-nums leading-none">
                  {indicators.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="budget">{t("detail.budget_tab")}</TabsTrigger>
            <TabsTrigger value="risks" className="gap-1.5">
              {t("detail.risks")}
              {risks.length > 0 && (
                <span className="text-xs font-medium bg-muted-foreground/15 rounded-full px-1.5 py-px tabular-nums leading-none">
                  {risks.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5">
              {t("detail.reports")}
              {reports.length > 0 && (
                <span className="text-xs font-medium bg-muted-foreground/15 rounded-full px-1.5 py-px tabular-nums leading-none">
                  {reports.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="beneficiaries">{t("detail.beneficiaries")}</TabsTrigger>
            <TabsTrigger value="state-allocations" className="gap-1.5">
              {t("detail.stateAllocations")}
              {stateAllocations && stateAllocations.length > 0 && (
                <span className="text-xs font-medium bg-muted-foreground/15 rounded-full px-1.5 py-px tabular-nums leading-none">
                  {stateAllocations.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">{t("detail.approvalHistory")}</TabsTrigger>
            <TabsTrigger value="voice-notes">{t("detail.voiceNotes")}</TabsTrigger>
            {hasPerm(me?.permissions, "documents.view") && (
              <TabsTrigger value="documents" className="gap-1.5">
                Documents
                {projectDocuments.length > 0 && (
                  <span className="text-xs font-medium bg-muted-foreground/15 rounded-full px-1.5 py-px tabular-nums leading-none">
                    {projectDocuments.length}
                  </span>
                )}
              </TabsTrigger>
            )}
            {hasPerm(me?.permissions, "comments.create") && (
              <TabsTrigger value="comments" className="gap-1.5">
                {t("detail.comments")}
                {unresolvedRC > 0 && (
                  <span className="text-xs font-medium bg-destructive/15 text-destructive rounded-full px-1.5 py-px tabular-nums leading-none">
                    {unresolvedRC}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-5">

          {/* ── A: Budget & Progress ── */}
          <div className="grid gap-5 md:grid-cols-2">

            {/* Budget summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("detail.budget")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">{t("detail.totalLabel")}</div>
                    <div className="text-sm font-semibold tabular-nums leading-snug">{formatCurrency(budgetTotal, projectCurrency)}</div>
                  </div>
                  <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-3">
                    <div className="text-xs text-amber-700 dark:text-amber-400 mb-1">{t("detail.spentLabel")}</div>
                    <div className="text-sm font-semibold tabular-nums leading-snug text-amber-700 dark:text-amber-400">{formatCurrency(budgetSpent, projectCurrency)}</div>
                  </div>
                  <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 p-3">
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 mb-1">{t("detail.remainingLabel")}</div>
                    <div className="text-sm font-semibold tabular-nums leading-snug text-emerald-700 dark:text-emerald-400">{formatCurrency(budgetTotal - budgetSpent, projectCurrency)}</div>
                  </div>
                </div>
                {(() => {
                  // BUD-006: 0/0 utilisation is undefined — show "—", never 0% or 100%.
                  const pct = budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : null;
                  const barPct = pct ?? 0;
                  const barColor = barPct >= 90 ? "bg-destructive" : barPct >= 75 ? "bg-warning" : "bg-primary";
                  const txtColor = barPct >= 90 ? "text-destructive" : barPct >= 75 ? "text-warning" : "text-foreground";
                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{t("detail.utilisation")}</span>
                        <span className={`font-medium tabular-nums ${txtColor}`}>{formatPercent(pct)}</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${barPct}%` }}
                          role="progressbar"
                          aria-label={`Budget utilisation ${formatPercent(pct)}`}
                          aria-valuenow={barPct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Implementation progress */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("detail.progressCard")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Activities */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("detail.activities")}</span>
                    <span className="font-medium tabular-nums">{activitiesCompletion}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{ width: `${activitiesCompletion}%` }} role="progressbar" aria-label={`Activities completion ${activitiesCompletion}%`} aria-valuenow={activitiesCompletion} aria-valuemin={0} aria-valuemax={100} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {activities.filter(a => a.status === "completed").length} {t("detail.of")} {activities.length} {t("detail.completed")}
                  </div>
                </div>
                <Separator />
                {/* Indicators */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("detail.indicatorProgressLabel")}</span>
                    <span className="font-medium tabular-nums">{indicatorAvg}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${indicatorAvg}%` }} role="progressbar" aria-label={`Indicator progress ${indicatorAvg}%`} aria-valuenow={indicatorAvg} aria-valuemin={0} aria-valuemax={100} />
                  </div>
                  <div className="text-xs text-muted-foreground">{t("detail.avgAcross")} {indicators.length} {indicators.length !== 1 ? t("detail.indicators_plural") : t("detail.indicator")}</div>
                </div>
                <Separator />
                {/* Beneficiaries */}
                {(() => {
                  const pct = beneficiariesTarget > 0 ? Math.min(100, Math.round((beneficiariesReached / beneficiariesTarget) * 100)) : 0;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t("detail.beneficiaries")}</span>
                        <span className="font-medium tabular-nums">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} role="progressbar" aria-label={`Beneficiaries reached ${pct}%`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {beneficiariesReached.toLocaleString()} {t("detail.of")} {beneficiariesTarget.toLocaleString()} {t("detail.target")}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* ── B: Reporting & Risks ── */}
          <div className="grid gap-5 md:grid-cols-2">

            {/* Reporting status */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t("detail.reports")}</CardTitle>
                  <span className="text-xs text-muted-foreground tabular-nums">{reports.length} {t("detail.reportsTotal")}</span>
                </div>
              </CardHeader>
              <CardContent>
                {reports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("detail.noReports")}</p>
                ) : (() => {
                  const approved = reports.filter(r => r.status === "approved").length;
                  const reviewing = reports.filter(r => ["submitted", "technically_approved", "state_reviewed", "coordination_approved"].includes(r.status)).length;
                  const draft = reports.filter(r => r.status === "draft").length;
                  const rejected = reports.filter(r => r.status === "rejected").length;
                  return (
                    <div className="divide-y divide-border/50">
                      {approved > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                            <span>{t("detail.approved")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums">{approved}</span>
                        </div>
                      )}
                      {reviewing > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm">
                            <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                            <span>{t("detail.underReview")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums">{reviewing}</span>
                        </div>
                      )}
                      {draft > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <FileText className="h-4 w-4" aria-hidden="true" />
                            <span>{t("detail.draft")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">{draft}</span>
                        </div>
                      )}
                      {rejected > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertCircle className="h-4 w-4" aria-hidden="true" />
                            <span>{t("detail.rejected")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums text-destructive">{rejected}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Risks summary */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t("detail.risks")}</CardTitle>
                  <span className="text-xs text-muted-foreground tabular-nums">{risks.length} {t("detail.risksLogged")}</span>
                </div>
              </CardHeader>
              <CardContent>
                {risks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("detail.noRisks")}</p>
                ) : (() => {
                  const open = risks.filter(r => r.status !== "closed");
                  const critical = open.filter(r => { const rl = (r as typeof r & { riskLevel?: string }).riskLevel; return rl === "critical" || (!rl && r.severity === "critical"); }).length;
                  const high = open.filter(r => { const rl = (r as typeof r & { riskLevel?: string }).riskLevel; return rl === "high" || (!rl && r.severity === "high"); }).length;
                  const medium = open.filter(r => { const rl = (r as typeof r & { riskLevel?: string }).riskLevel; return rl === "medium" || (!rl && r.severity === "medium"); }).length;
                  const overdue = open.filter(r => { const dd = (r as typeof r & { dueDate?: string }).dueDate; return dd ? new Date(dd) < new Date() : false; }).length;
                  const noFlags = (critical + high + medium + overdue) === 0;
                  return (
                    <div className="divide-y divide-border/50">
                      {(critical + high) > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertCircle className="h-4 w-4" aria-hidden="true" />
                            <span>{t("detail.criticalHigh")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums text-destructive">{critical + high}</span>
                        </div>
                      )}
                      {medium > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Shield className="h-4 w-4 text-warning" aria-hidden="true" />
                            <span>{t("detail.medium")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums">{medium}</span>
                        </div>
                      )}
                      {overdue > 0 && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertCircle className="h-4 w-4" aria-hidden="true" />
                            <span>{t("detail.overdueMitigation")}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums text-destructive">{overdue}</span>
                        </div>
                      )}
                      {noFlags && (
                        <p className="text-sm text-muted-foreground py-1">{open.length} {open.length !== 1 ? t("detail.openRisks") : t("detail.openRisk")}, {t("detail.openRisksLow")}</p>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* ── C: Description & Outputs ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("detail.descriptionObjectives")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm whitespace-pre-wrap text-foreground/80">
                {project.description || <span className="text-muted-foreground">{t("detail.noDescription")}</span>}
              </p>
              <Separator />
              {outputs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.noOutputs")}</p>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    {outputs.length} {outputs.length !== 1 ? t("detail.plannedOutputs") : t("detail.plannedOutput")}
                  </div>
                  <ul className="space-y-3">
                    {outputs.map(o => (
                      <li key={o.id} className="border-s-2 border-primary ps-3">
                        <div className="text-xs font-mono text-muted-foreground"><bdi dir="ltr">{o.code}</bdi></div>
                        <div className="text-sm font-medium">{o.title}</div>
                        {o.description && <div className="text-sm text-muted-foreground mt-0.5">{o.description}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── D: Project details ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("detail.projectDetails")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.donor")}</dt>
                  <dd className="font-medium">{project.donor}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.sector")}</dt>
                  <dd className="font-medium">
                    {project.sector}
                    {project.assistanceModality && (
                      <Badge variant="outline" className="ms-2 text-xs font-normal">{project.assistanceModality}</Badge>
                    )}
                    {project.subSectors && project.subSectors.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {project.subSectors.map(s => <Badge key={s} variant="secondary" className="text-xs font-normal">{s}</Badge>)}
                      </div>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.agreementNumber")}</dt>
                  <dd className="font-mono text-sm"><bdi dir="ltr">{project.code}</bdi></dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.management")}</dt>
                  <dd className="font-medium">{(project.managementLevel as string) === "hq_managed" ? t("detail.hqManaged") : t("detail.stateManaged")}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.scheduledReportingFrequency")}</dt>
                  <dd className="font-medium" data-testid="text-reporting-frequency">
                    {(() => {
                      const rf = (project as unknown as Record<string, unknown>).reportingFrequency as string | undefined;
                      return rf
                        ? ({ monthly: tCommon("monthly"), quarterly: tCommon("quarterly"), annual: tCommon("annual") } as Record<string, string>)[rf] ?? rf
                        : <span className="text-muted-foreground">{t("detail.notConfigured")}</span>;
                    })()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.startDate")}</dt>
                  <dd className="font-medium">{formatDate(project.startDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.endDate")}</dt>
                  <dd className="font-medium">{formatDate(project.endDate)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* ── E: Recent activity (from approval history) ── */}
          {approvalHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("detail.recentActivity")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {approvalHistory.slice(0, 4).map(h => (
                    <li key={h.id} className="flex items-start gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5" aria-hidden="true">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {h.action.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {h.actorName} · {formatDateTime(h.timestamp)}
                        </div>
                        {h.comment && (
                          <div className="mt-1.5 text-xs bg-muted rounded-lg px-3 py-2 text-muted-foreground">
                            {h.comment}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

        </TabsContent>

        <TabsContent value="activities">
          <Card><CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tCommon("code")}</TableHead><TableHead>{tCommon("title")}</TableHead><TableHead>{tCommon("status")}</TableHead>
                  <TableHead>{t("detail.progress")}</TableHead><TableHead>{tCommon("startDate")}</TableHead><TableHead>{tCommon("output")}</TableHead>
                  <TableHead>{tCommon("state")}</TableHead><TableHead>{tCommon("budget")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {t("detail.noActivities")}
                    </TableCell>
                  </TableRow>
                )}
                {activities.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="w-20 font-mono text-xs"><bdi dir="ltr">{a.code}</bdi></TableCell>
                    <TableCell className="font-medium">
                      <span className="block max-w-[200px] truncate" title={a.title}>{a.title}</span>
                    </TableCell>
                    <TableCell><Badge variant="outline">{formatStatusLabel(a.status)}</Badge></TableCell>
                    <TableCell className="w-32"><ProgressBar value={a.progressPct} max={100} /></TableCell>
                    <TableCell className="text-xs"><bdi dir="ltr">{formatDate(a.plannedStart)} – {formatDate(a.plannedEnd)}</bdi></TableCell>
                    <TableCell className="text-sm">{a.outputTitle || "—"}</TableCell>
                    <TableCell className="text-sm">{a.stateName ? getLinkedStateLabel(a, i18n?.language) : "—"}</TableCell>
                    <TableCell className="text-xs text-end min-w-[130px]"><bdi dir="ltr">{formatCurrency(a.budgetSpent, projectCurrency)} / {formatCurrency(a.budgetPlanned, projectCurrency)}</bdi></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="indicators">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tCommon("code")}</TableHead><TableHead>{tCommon("title")}</TableHead><TableHead>{tCommon("unit")}</TableHead>
                  <TableHead className="text-end">{tCommon("target")}</TableHead><TableHead className="text-end">{tCommon("actual")}</TableHead>
                  <TableHead>{t("detail.progress")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {indicators.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                      {t("detail.noIndicators")}
                    </TableCell>
                  </TableRow>
                )}
                {indicators.map(i => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.code}</TableCell>
                    <TableCell className="font-medium">{i.title}</TableCell>
                    <TableCell className="text-sm">{i.unit}</TableCell>
                    <TableCell className="text-end">{i.target.toLocaleString()}</TableCell>
                    <TableCell className="text-end">{i.achieved.toLocaleString()}</TableCell>
                    <TableCell><ProgressBar value={i.achieved} max={i.target} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="budget">
          {(() => {
            // These are display-only values derived from the canonical project fields.
            // Keep 0, negative remaining balances, and over-100% utilisation visible.
            const utilisation = budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : null;
            const remaining = budgetTotal - budgetSpent;
            const isOverspent = utilisation !== null && utilisation > 100;
            const hasNegativeRemaining = remaining < 0;
            return (
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="space-y-1">
                      <CardTitle>{t("detail.projectBudget")}</CardTitle>
                      <CardDescription>{t("detail.projectBudgetDescription")}</CardDescription>
                    </div>
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-end">
                      <p className="text-xs text-muted-foreground">{t("detail.projectCurrency")}</p>
                      <p className="font-medium tabular-nums">{projectCurrency || "—"}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border bg-card p-4">
                      <dt className="text-xs font-medium text-muted-foreground">{t("detail.projectBudget")}</dt>
                      <dd className="mt-1.5 text-lg font-medium tabular-nums">{formatCurrency(budgetTotal, projectCurrency)}</dd>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                      <dt className="text-xs font-medium text-amber-800 dark:text-amber-300">{t("detail.spentLabel")}</dt>
                      <dd className="mt-1.5 text-lg font-medium tabular-nums text-amber-800 dark:text-amber-300">{formatCurrency(budgetSpent, projectCurrency)}</dd>
                    </div>
                    <div className={`rounded-lg border p-4 ${hasNegativeRemaining ? "border-destructive/50 bg-destructive/5" : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"}`}>
                      <dt className={`text-xs font-medium ${hasNegativeRemaining ? "text-destructive" : "text-emerald-800 dark:text-emerald-300"}`}>{t("detail.remainingLabel")}</dt>
                      <dd className={`mt-1.5 text-lg font-medium tabular-nums ${hasNegativeRemaining ? "text-destructive" : "text-emerald-800 dark:text-emerald-300"}`}>{formatCurrency(remaining, projectCurrency)}</dd>
                      {hasNegativeRemaining && <p className="mt-1 text-xs text-destructive">{t("detail.negativeRemaining")}</p>}
                    </div>
                    <div className={`rounded-lg border p-4 ${isOverspent ? "border-destructive/50 bg-destructive/5" : "bg-muted/30"}`}>
                      <dt className={`text-xs font-medium ${isOverspent ? "text-destructive" : "text-muted-foreground"}`}>{t("detail.utilisation")}</dt>
                      <dd className={`mt-1.5 text-lg font-medium tabular-nums ${isOverspent ? "text-destructive" : ""}`}>{formatPercent(utilisation)}</dd>
                      {isOverspent && <p className="mt-1 text-xs text-destructive">{t("detail.overBudget")}</p>}
                    </div>
                  </dl>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{t("detail.utilisation")}</span>
                      <span className={`font-medium tabular-nums ${isOverspent ? "text-destructive" : ""}`}>{formatPercent(utilisation)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-label={`${t("detail.utilisation")} ${formatPercent(utilisation)}`}>
                      {utilisation !== null && (
                        <div
                          className={`h-full rounded-full ${isOverspent ? "bg-destructive" : utilisation >= 75 ? "bg-warning" : "bg-primary"}`}
                          style={{ width: `${Math.min(100, utilisation)}%` }}
                        />
                      )}
                    </div>
                    {isOverspent && <p className="text-xs text-muted-foreground">{t("detail.utilisationScaleNote")}</p>}
                  </div>

                  <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t("detail.stateAllocationContext")}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{t("detail.stateAllocationContextDescription")}</p>
                    </div>
                    <Link href={`/budget?projectId=${projectId}`} className="shrink-0">
                      <Button variant="outline" size="sm">{t("detail.openFullBudget")}</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        <TabsContent value="risks">
          <Card>
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {risks.length} {t("detail.riskForProject")}
              </CardTitle>
              <div className="flex items-center gap-2">
                {hasPerm(me?.permissions, "risks.create") && (
                  <CreateProjectRiskDialog
                    projectId={projectId}
                    projectStates={states as { id: number; name: string }[]}
                    onCreated={() => qc.invalidateQueries({ queryKey: ["getProject", projectId] })}
                  />
                )}
                <Link href="/risks" className="text-xs text-muted-foreground hover:text-primary">
                  {t("detail.viewAll")}
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{tCommon("title")}</TableHead><TableHead>{tCommon("category")}</TableHead>
                <TableHead>{t("detail.riskProbability")}</TableHead><TableHead>{t("detail.riskImpact")}</TableHead>
                <TableHead>{t("detail.riskComputedLevel").replace(":", "")}</TableHead>
                <TableHead>{tCommon("status")}</TableHead><TableHead>{tCommon("dueDate")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {risks.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">{t("detail.noRisks")} {t("detail.newRisk")}</TableCell></TableRow>
                )}
                {risks.map(r => {
                  const rl = (r as typeof r & { riskLevel?: string }).riskLevel;
                  const impact = (r as typeof r & { impact?: string }).impact || r.severity;
                  const dueDate = (r as typeof r & { dueDate?: string }).dueDate;
                  const isOverdue = dueDate && new Date(dueDate) < new Date() && r.status !== "closed";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <span className="block max-w-[200px] truncate" title={r.title}>{r.title}</span>
                      </TableCell>
                      <TableCell className="capitalize">{r.category}</TableCell>
                      <TableCell className="text-sm capitalize">{r.likelihood}</TableCell>
                      <TableCell className="text-sm capitalize">{impact}</TableCell>
                      <TableCell>
                        {rl ? <Badge variant={severityBadgeVariant(rl)}>{rl}</Badge> : <Badge variant="outline">{r.severity}</Badge>}
                      </TableCell>
                      <TableCell><Badge variant="outline">{(r.status ?? "open").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className={`text-sm ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {dueDate ? formatDate(dueDate) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          {hasPerm(me?.permissions, "reports.view") && (
            <PmrCompletenessPanel projectId={projectId} projectReportingFrequency={((project as unknown as Record<string, unknown>).reportingFrequency as "monthly" | "quarterly" | "annual" | null) ?? null} />
          )}
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{tCommon("title")}</TableHead><TableHead>{tCommon("period")}</TableHead>
                <TableHead>{tCommon("type")}</TableHead><TableHead>{tCommon("status")}</TableHead>
                <TableHead>{tCommon("submittedBy")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {reports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                      {t("detail.noReportsProject")}
                    </TableCell>
                  </TableRow>
                )}
                {reports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-sm">{r.period}</TableCell>
                    <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                    <TableCell><ProjectStatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-sm">{r.submittedByName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="beneficiaries">
          <StatCard
            icon={Users}
            iconBg="bg-emerald-500"
            label={t("detail.beneficiaries")}
            value={beneficiariesReached.toLocaleString()}
            sub={`${t("detail.of")} ${beneficiariesTarget.toLocaleString()} ${t("detail.target")}`}
            href={`/beneficiaries?projectId=${projectId}`}
          />
        </TabsContent>

        <TabsContent value="state-allocations" className="space-y-4">
          {(() => {
            const isStateRole = me?.user?.role === "state_program_officer" || me?.user?.role === "state_office_manager";
            const myStateId = me?.user?.stateId ?? null;
            return (
              <>
                {isStateRole && (
                  <div className="mb-4 rounded-md border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
                    {t("detail.stateRoleInfo")}
                  </div>
                )}
                {isStateAllocationsLoading ? (
                  <Card aria-busy="true" aria-label={t("detail.loadingAllocations")}>
                    <CardHeader className="pb-3">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-80 max-w-full" />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-4/5" />
                    </CardContent>
                  </Card>
                ) : isStateAllocationsError ? (
                  <Card>
                    <ErrorState
                      compact
                      variant="server"
                      title={t("detail.allocationsLoadError")}
                      description={t("detail.allocationsLoadErrorDescription")}
                      onRetry={() => refetchStateAllocations()}
                      retryLabel={t("detail.retry")}
                    />
                  </Card>
                ) : !stateAllocations || stateAllocations.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <p className="text-sm font-medium">{isStateRole
                        ? t("detail.noStateAllocation")
                        : t("detail.noAllocations")}</p>
                      {!isStateRole && <p className="mt-1 text-xs text-muted-foreground">{t("detail.noAllocationsDescription")}</p>}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* Project-level donor targets — only for HQ roles */}
                    {!isStateRole && (
                      <div className="grid grid-cols-2 gap-4">
                        <StatCard
                          icon={ActivityIcon}
                          iconBg="bg-sky-500"
                          label={t("detail.activityTargetDonor")}
                          value={(project as { activityTarget?: number }).activityTarget?.toLocaleString() ?? "—"}
                          sub={t("detail.totalDonorActivities")}
                        />
                        <StatCard
                          icon={Target}
                          iconBg="bg-indigo-500"
                          label={t("detail.indicatorTargetDonor")}
                          value={(project as { indicatorTarget?: number }).indicatorTarget?.toLocaleString() ?? "—"}
                          sub={t("detail.totalDonorIndicators")}
                        />
                      </div>
                    )}

                    {/* State user: prominent single-state card */}
                    {isStateRole && stateAllocations.length === 1 && (() => {
                      const alloc = stateAllocations[0];
                      return (
                          <Card className="border-primary/20 bg-primary/5">
                          <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                                <CardTitle className="text-base">{t("detail.yourStateAllocation")} {getLinkedStateLabel(alloc, i18n?.language)}</CardTitle>
                              {myStateId && alloc.stateId === myStateId && (
                                <Badge variant="submitted" className="text-xs">{t("detail.yourStateTag")}</Badge>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div><p className="text-xs text-muted-foreground">{t("detail.budgetAllocation")}{projectCurrency ? ` (${projectCurrency})` : ""}</p><p className="font-medium tabular-nums">{alloc.budgetAllocation != null ? formatCurrency(alloc.budgetAllocation, projectCurrency) : "—"}</p></div>
                              <div><p className="text-xs text-muted-foreground">{t("detail.beneficiaryTarget")}</p><p className="font-medium tabular-nums">{alloc.beneficiaryTarget != null ? alloc.beneficiaryTarget.toLocaleString() : "—"}</p></div>
                              <div><p className="text-xs text-muted-foreground">{t("detail.activityTarget")}</p><p className="font-medium tabular-nums">{alloc.activityTarget != null ? alloc.activityTarget.toLocaleString() : "—"}</p></div>
                              <div><p className="text-xs text-muted-foreground">{t("detail.indicatorTarget")}</p><p className="font-medium tabular-nums">{alloc.indicatorTarget != null ? alloc.indicatorTarget.toLocaleString() : "—"}</p></div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                              <div><p className="text-xs text-muted-foreground">{t("detail.adultMen")}</p><p className="font-medium tabular-nums">{alloc.beneficiaryMale != null ? alloc.beneficiaryMale.toLocaleString() : "—"}</p></div>
                              <div><p className="text-xs text-muted-foreground">{t("detail.adultWomen")}</p><p className="font-medium tabular-nums">{alloc.beneficiaryFemale != null ? alloc.beneficiaryFemale.toLocaleString() : "—"}</p></div>
                              <div><p className="text-xs text-muted-foreground">{t("detail.boys")}</p><p className="font-medium tabular-nums">{alloc.beneficiaryBoys != null ? alloc.beneficiaryBoys.toLocaleString() : "—"}</p></div>
                              <div><p className="text-xs text-muted-foreground">{t("detail.girls")}</p><p className="font-medium tabular-nums">{alloc.beneficiaryGirls != null ? alloc.beneficiaryGirls.toLocaleString() : "—"}</p></div>
                            </div>
                            {alloc.stateLead && <p className="mt-3 text-xs text-muted-foreground">{t("detail.stateLead")}: <span className="font-medium text-foreground">{alloc.stateLead}</span></p>}
                            {alloc.notes && <p className="mt-1 text-xs text-muted-foreground">{t("detail.notes")}: {alloc.notes}</p>}
                          </CardContent>
                        </Card>
                      );
                    })()}

                    {/* HQ roles: full per-state allocation table */}
                    {!isStateRole && (
                      <>
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle>{t("detail.allocationTitle")}</CardTitle>
                            <CardDescription>{t("detail.allocationDescription", { currency: projectCurrency || "—" })}</CardDescription>
                          </CardHeader>
                          <CardContent className="p-0">
                            <div className="overflow-x-auto">
                            <Table aria-label={t("detail.allocationTableAria")}>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="min-w-[220px]">{tCommon("state")}</TableHead>
                                  <TableHead className="min-w-[160px] text-end">{t("detail.budgetAllocation")}{projectCurrency ? ` (${projectCurrency})` : ""}</TableHead>
                                  <TableHead className="min-w-[130px] text-end">{t("detail.beneficiaryTarget")}</TableHead>
                                  <TableHead className="min-w-[105px] text-end">{t("detail.adultMen")}</TableHead>
                                  <TableHead className="min-w-[115px] text-end">{t("detail.adultWomen")}</TableHead>
                                  <TableHead className="min-w-[80px] text-end">{t("detail.boys")}</TableHead>
                                  <TableHead className="min-w-[80px] text-end">{t("detail.girls")}</TableHead>
                                  <TableHead className="min-w-[115px] text-end">{t("detail.activityTarget")}</TableHead>
                                  <TableHead className="min-w-[115px] text-end">{t("detail.indicatorTarget")}</TableHead>
                                  <TableHead className="min-w-[160px]">{t("detail.stateLead")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {stateAllocations.map(alloc => (
                                  <TableRow key={alloc.id}>
                                    <TableCell className="font-medium"><span className="block max-w-[280px] break-words" title={getLinkedStateLabel(alloc, i18n?.language)}>{getLinkedStateLabel(alloc, i18n?.language)}</span></TableCell>
                                    <TableCell className="whitespace-nowrap text-end font-medium tabular-nums">{alloc.budgetAllocation != null ? formatCurrency(alloc.budgetAllocation, projectCurrency) : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end tabular-nums">{alloc.beneficiaryTarget != null ? alloc.beneficiaryTarget.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end text-xs tabular-nums">{alloc.beneficiaryMale != null ? alloc.beneficiaryMale.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end text-xs tabular-nums">{alloc.beneficiaryFemale != null ? alloc.beneficiaryFemale.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end text-xs tabular-nums">{alloc.beneficiaryBoys != null ? alloc.beneficiaryBoys.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end text-xs tabular-nums">{alloc.beneficiaryGirls != null ? alloc.beneficiaryGirls.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end tabular-nums">{alloc.activityTarget != null ? alloc.activityTarget.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="whitespace-nowrap text-end tabular-nums">{alloc.indicatorTarget != null ? alloc.indicatorTarget.toLocaleString() : "—"}</TableCell>
                                    <TableCell className="text-sm"><span className="block max-w-[200px] break-words" title={alloc.stateLead || undefined}>{alloc.stateLead || "—"}</span></TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            </div>
                          </CardContent>
                        </Card>
                        {(() => {
                          const totalBudget = stateAllocations.reduce((s, a) => s + a.budgetAllocation, 0);
                          const totalBenef = stateAllocations.reduce((s, a) => s + a.beneficiaryTarget, 0);
                          const totalAct = stateAllocations.reduce((s, a) => s + (a.activityTarget ?? 0), 0);
                          const totalInd = stateAllocations.reduce((s, a) => s + (a.indicatorTarget ?? 0), 0);
                          return (
                            <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted/40 p-3 text-sm md:grid-cols-4">
                              <div><div className="text-xs text-muted-foreground">{t("detail.totalAllocatedBudget")}{projectCurrency ? ` (${projectCurrency})` : ""}</div><div className="font-medium tabular-nums">{formatCurrency(totalBudget, projectCurrency)}</div></div>
                              <div><div className="text-xs text-muted-foreground">{t("detail.totalBeneficiaryTargets")}</div><div className="font-medium tabular-nums">{totalBenef.toLocaleString()}</div></div>
                              <div><div className="text-xs text-muted-foreground">{t("detail.totalActivityTargets")}</div><div className="font-medium tabular-nums">{totalAct.toLocaleString()}</div></div>
                              <div><div className="text-xs text-muted-foreground">{t("detail.totalIndicatorTargets")}</div><div className="font-medium tabular-nums">{totalInd.toLocaleString()}</div></div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle>{t("detail.approvalHistory")}</CardTitle></CardHeader>
            <CardContent>
              {approvalHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t("detail.noTransitions")}</p>
              ) : (
                <ol className="relative border-s border-border ms-3 space-y-6">
                  {approvalHistory.map(h => (
                    <li key={h.id} className="ms-6">
                      <span className="absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckCircle2 className="h-3 w-3" />
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{h.action.replaceAll("_", " ")}</span>
                        <Badge variant="outline" className="text-xs">{h.fromStatus} → {h.toStatus}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {h.actorName} ({h.actorRole}) • {formatDateTime(h.timestamp)}
                      </div>
                      {h.comment && (
                        <div className="mt-2 text-sm bg-muted p-2 rounded">{h.comment}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice-notes">
          <VoiceNotePanel entityType="project" entityId={projectId} />
        </TabsContent>

        {/* PRJ-BD-04: Standalone Documents tab — accessible for all project statuses */}
        {hasPerm(me?.permissions, "documents.view") && (
          <TabsContent value="documents">
            {/* Hidden file input for upload */}
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              aria-hidden="true"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await handleDocumentUpload(file);
                e.target.value = "";
              }}
            />
            {/* Document gate status messages */}
            {docGate === "operational" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 mb-4" role="note">
                <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>Documents are locked — you may upload supporting files but cannot delete existing documents without an override.</span>
              </div>
            )}
            {docGate === "frozen" && (
              <div className="flex items-start gap-2 rounded-md border border-muted-foreground/30 bg-muted px-4 py-3 text-sm text-muted-foreground mb-4" role="note">
                <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>Documents are locked because this Project is completed.</span>
              </div>
            )}
            <Card>
              <CardHeader className="py-3 px-4 flex flex-row items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {projectDocuments.length} {projectDocuments.length === 1 ? "Document" : "Documents"}
                  {docGate === "frozen" && (
                    <Badge variant="outline" className="ms-2 text-xs gap-1 font-normal text-muted-foreground">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      Closed — locked
                    </Badge>
                  )}
                  {docGate === "operational" && (
                    <Badge variant="outline" className="ms-2 text-xs gap-1 font-normal text-amber-700 border-amber-300">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      Approved — protected
                    </Badge>
                  )}
                </CardTitle>
                {hasPerm(me?.permissions, "documents.upload") && docGate !== "frozen" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    disabled={isUploading}
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    {isUploading ? "Uploading…" : "Upload Document"}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tCommon("fileName")}</TableHead>
                      <TableHead>{tCommon("category")}</TableHead>
                      <TableHead>{tCommon("type")}</TableHead>
                      <TableHead>{tCommon("uploadedBy")}</TableHead>
                      <TableHead>{tCommon("date")}</TableHead>
                      <TableHead className="w-[52px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectDocuments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                          {docGate === "frozen"
                            ? "No documents are stored for this project."
                            : "No documents uploaded yet. Use the Upload button to add files."}
                        </TableCell>
                      </TableRow>
                    )}
                    {projectDocuments.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell>
                          {doc.availabilityStatus === "unavailable" ? (
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground max-w-[320px]">
                              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">{doc.fileName}</span>
                              <span role="status" className="shrink-0 text-xs">File Unavailable</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { void handleDocumentDownload(doc); }}
                              className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1.5 max-w-[320px] truncate"
                              title={doc.fileName}
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">{doc.fileName}</span>
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{doc.category}</TableCell>
                        <TableCell className="text-sm capitalize">{doc.kind}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{doc.uploadedByName ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(doc.uploadedAt)}</TableCell>
                        <TableCell>
                          {/* mutable → normal delete */}
                          {docGate === "mutable" && hasPerm(me?.permissions, "documents.upload") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => handleNormalDocDelete(doc.id)}
                              aria-label={`Delete ${doc.fileName}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          {/* operational + override actor → amber trash with dialog */}
                          {docGate === "operational" && isDocOverrideActor && hasPerm(me?.permissions, "documents.upload") && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                                  onClick={() => {
                                    setOverrideDeleteDialog({ docId: doc.id, fileName: doc.fileName });
                                    setOverrideReason("");
                                    setOverrideReasonError("");
                                  }}
                                  aria-label={`Delete ${doc.fileName} (override required)`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete document (override required — will be audited)</TooltipContent>
                            </Tooltip>
                          )}
                          {/* operational + ordinary actor → lock icon */}
                          {docGate === "operational" && !isDocOverrideActor && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground/50" aria-label={t("detail.documentLockedAria")}>
                                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Documents cannot be deleted after project approval.</TooltipContent>
                            </Tooltip>
                          )}
                          {/* frozen → no affordance */}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Override delete dialog — PM / Super Admin only on operational projects */}
            <Dialog
              open={!!overrideDeleteDialog}
              onOpenChange={(o) => {
                if (!o && !isOverrideDeleting) {
                  setOverrideDeleteDialog(null);
                  setOverrideReason("");
                  setOverrideReasonError("");
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Approved Project Document?</DialogTitle>
                  <DialogDescription>
                    This project has already been approved. Deleting an existing document
                    requires an exceptional override and will be recorded in the audit history.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="doc-override-reason">Override Reason (required)</Label>
                  <Textarea
                    id="doc-override-reason"
                    rows={3}
                    placeholder={t("detail.overrideReasonPlaceholder")}
                    value={overrideReason}
                    onChange={(e) => {
                      setOverrideReason(e.target.value);
                      if (overrideReasonError) setOverrideReasonError("");
                    }}
                  />
                  {overrideReasonError && (
                    <p className="text-sm text-destructive" role="alert">{overrideReasonError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => { setOverrideDeleteDialog(null); setOverrideReason(""); setOverrideReasonError(""); }}
                    disabled={isOverrideDeleting}
                  >
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleOverrideDocDelete} disabled={isOverrideDeleting}>
                    {isOverrideDeleting ? "Deleting…" : "Delete Document"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
        )}

        <TabsContent value="comments">
          <CommentsPanel
            entityType="project"
            entityId={projectId}
            sections={["Basics", "Geography", "Budget", "Beneficiaries", "Outputs", "Documents"]}
            currentUserId={me?.user?.id ?? null}
            currentUserRole={me?.user?.role ?? null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
