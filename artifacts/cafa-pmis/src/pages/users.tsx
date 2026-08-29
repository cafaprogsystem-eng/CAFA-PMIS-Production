import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getLinkedStateLabel } from "@/components/state-label";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListUsers,
  useGetUsersSummary,
  useListStates,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useChangeUserStatus,
  useResetUserPassword,
  useResendUserInvite,
  useCancelUserInvite,
  useResendUserVerification,
  useListUserInvitations,
  useGetMe,
  useGetUserEffectiveAccess,
  getGetUserEffectiveAccessQueryKey,
  getListUsersQueryKey,
  getGetUsersSummaryQueryKey,
} from "@workspace/api-client-react";
import type { ListUserInvitationsParams } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/ui/error-state";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Plus,
  Search,
  MoreHorizontal,
  Copy,
  KeyRound,
  Trash2,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Pencil,
  Mail,
  ShieldCheck,
  Users as UsersIcon,
  Clock,
  AlertCircle,
  Ban,
  RefreshCw,
  CheckCheck,
  Send,
  FilterX,
  Filter,
  Loader2,
  Globe,
  MapPin,
  Building2,
  FolderOpen,
  Circle,
  CircleOff,
} from "lucide-react";
import { formatDate, formatDateTime, hasPerm } from "@/lib/format";
import { SECTORS } from "@/lib/sectors";
import { localizeUserApiError } from "@/lib/user-error-localization";
import { StateLabel } from "@/components/state-label";
import { StateReferenceStatus } from "@/components/state-reference-status";
import { deriveStateReferenceData, type StateReferenceData } from "@/lib/state-reference-data";
import { useSocket } from "@/lib/socket";

// ─── API error helpers ────────────────────────────────────────────────────────

type ApiErrorBody = { error?: string; step?: string; detail?: string };

function extractApiError(e: unknown): { code: string; step?: string; detail?: string; raw: string } {
  const err = e as { data?: ApiErrorBody; status?: number; message?: string };
  const code = err.data?.error ?? "";
  return { code, step: err.data?.step, detail: err.data?.detail, raw: err.message ?? String(e) };
}

// ─── Create User diagnostics ──────────────────────────────────────────────────

type DiagStep = { key: string; labelKey: string; status: "idle" | "loading" | "pass" | "fail" };

const BASE_STEPS: Omit<DiagStep, "status">[] = [
  { key: "validation",      labelKey: "validation.userValidation" },
  { key: "role_validation", labelKey: "validation.roleValidation" },
  { key: "state_validation",labelKey: "validation.stateValidation" },
  { key: "uniqueness_check",labelKey: "validation.uniquenessCheck" },
  { key: "user_record",     labelKey: "validation.userRecord" },
  { key: "audit_log",       labelKey: "validation.auditLog" },
  { key: "invite_email",    labelKey: "validation.inviteEmail" },
];

function buildDiagSteps(
  mode: "idle" | "loading" | "success" | "error",
  failedStep?: string,
  inviteMode?: boolean,
): DiagStep[] {
  const keys = inviteMode ? BASE_STEPS.map((s) => s.key) : BASE_STEPS.filter((s) => s.key !== "invite_email").map((s) => s.key);
  const failIdx = failedStep ? keys.indexOf(failedStep) : -1;
  return BASE_STEPS
    .filter((s) => inviteMode || s.key !== "invite_email")
    .map((s, i) => {
      const key = keys[i];
      if (mode === "idle") return { ...s, status: "idle" as const };
      if (mode === "loading") return { ...s, status: "loading" as const };
      if (mode === "success") return { ...s, status: "pass" as const };
      if (failIdx >= 0) {
        if (i < failIdx) return { ...s, status: "pass" as const };
        if (key === failedStep) return { ...s, status: "fail" as const };
      }
      return { ...s, status: "idle" as const };
    });
}

function CreateDiagnostics({
  mode, failedStep, errorMessage, inviteMode,
}: {
  mode: "idle" | "loading" | "success" | "error";
  failedStep?: string;
  errorMessage?: string;
  inviteMode: boolean;
}) {
  const { t } = useTranslation("users");
  if (mode === "idle") return null;
  const steps = buildDiagSteps(mode, failedStep, inviteMode);
  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
      <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("diagnostics.title")}</p>
      {steps.map((s) => (
        <div key={s.key} className="flex items-center gap-2">
          {s.status === "loading" && <RefreshCw className="h-3.5 w-3.5 text-info animate-spin flex-shrink-0" />}
          {s.status === "pass"    && <CheckCheck className="h-3.5 w-3.5 text-success flex-shrink-0" />}
          {s.status === "fail"    && <XCircle    className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
          {s.status === "idle"    && <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 flex-shrink-0" />}
          <span className={
            s.status === "pass" ? "text-success" :
            s.status === "fail" ? "text-destructive font-medium" :
            s.status === "loading" ? "text-info" :
            "text-muted-foreground"
          }>{t(s.labelKey)}</span>
        </div>
      ))}
      {mode === "error" && errorMessage && (
        <p className="mt-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1.5 flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {errorMessage}
        </p>
      )}
      {mode === "success" && (
        <p className="mt-2 text-xs text-success bg-success/5 border border-success/20 rounded px-2 py-1.5 flex items-center gap-1.5">
          <CheckCheck className="h-3.5 w-3.5 flex-shrink-0" />
          {t("diagnostics.allPassed")}
        </p>
      )}
    </div>
  );
}

const ROLES = [
  { value: "super_admin", scope: "hq" as const },
  { value: "executive_director", scope: "hq" as const },
  { value: "program_manager", scope: "hq" as const },
  { value: "senior_program_coordinator", scope: "hq" as const },
  { value: "technical_coordinator", scope: "hq" as const },
  { value: "state_office_manager", scope: "state" as const },
  { value: "state_program_officer", scope: "state" as const },
  { value: "viewer", scope: "hq" as const },
];

const STATUSES = ["active", "invited", "suspended", "inactive", "deactivated"] as const;
type Status = (typeof STATUSES)[number];

import type { BadgeVariant } from "@/components/ui/badge";
const STATUS_VARIANT: Record<Status, BadgeVariant> = {
  active:      "active",
  invited:     "invited",
  suspended:   "pending",
  inactive:    "inactive",
  deactivated: "rejected",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("users");
  const s = (STATUSES as readonly string[]).includes(status) ? (status as Status) : "inactive";
  return <Badge variant={STATUS_VARIANT[s]}>{t(`status.${s}`)}</Badge>;
}

function RoleBadge({ role, label }: { role: string; label?: string | null }) {
  const { t } = useTranslation("users");
  const def = ROLES.find((r) => r.value === role);
  const isHq = def?.scope === "hq";
  return (
    <Badge variant={isHq ? "completed" : "submitted"}>
      {label ?? (def ? t(`roles.${def.value}`) : role)}
    </Badge>
  );
}

function relativeLastSeen(lastSeenAt: string, language: string): string {
  const timestamp = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  const formatter = new Intl.RelativeTimeFormat(language === "ar" ? "ar" : "en-GB", {
    numeric: "auto",
  });
  if (seconds < 60) return formatter.format(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}

function PresenceValue({
  isOnline,
  lastSeenAt,
}: {
  isOnline: boolean;
  lastSeenAt?: string | null;
}) {
  const { t, i18n } = useTranslation("users");
  const relative = lastSeenAt ? relativeLastSeen(lastSeenAt, i18n.language) : "";
  const label = isOnline
    ? t("presence.online")
    : relative
      ? t("presence.offlineLastSeen", { time: relative })
      : t("presence.offline");

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" aria-label={label}>
      {isOnline
        ? <Circle className="h-3 w-3 fill-success text-success" aria-hidden="true" />
        : <CircleOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
      <span className={isOnline ? "text-success" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

type UserRow = {
  id: number;
  name: string;
  username?: string | null;
  email?: string;
  phone?: string | null;
  role: string;
  roleLabel?: string;
  stateId?: number | null;
  stateName?: string | null;
  stateNameAr?: string | null;
  sector?: string | null;
  status?: string;
  languagePreference?: string;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  isOnline?: boolean;
  createdAt?: string | null;
  emailVerified?: boolean | null;
  emailVerifiedAt?: string | null;
};

type EditingUser = Partial<UserRow> & { password?: string; confirmPassword?: string };

export default function UsersPage() {
  const { t, i18n } = useTranslation(["users", "common"]);
  const qc = useQueryClient();
  const { socket } = useSocket();
  const { data: me } = useGetMe();
  const perms = me?.permissions;
  const canManage = hasPerm(perms, "users.manage") || me?.user?.role === "super_admin";

  // Filters
  const [q, setQ] = useState("");
  const [role, setRole] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [stateId, setStateId] = useState<string>("");
  const [sector, setSector] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const pageSize = 25;

  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = {};
    if (q.trim()) p.q = q.trim();
    if (role) p.role = role;
    if (status) p.status = status;
    if (stateId) p.stateId = Number(stateId);
    if (sector) p.sector = sector;
    p.limit = pageSize;
    p.offset = offset;
    return p;
  }, [q, role, status, stateId, sector, offset]);

  const { data: usersPage, isLoading, isError, refetch } = useListUsers(queryParams);
  const users = useMemo(() => usersPage?.items ?? [], [usersPage]);
  const hasFilters = Boolean(q || role || status || stateId || sector);
  const { data: summary } = useGetUsersSummary();
  const statesQuery = useListStates();
  const stateReference = deriveStateReferenceData(statesQuery);
  const [activeTab, setActiveTab] = useState<"all" | "resets" | "invitations">("all");

  useEffect(() => {
    if (!socket) return;
    const onPresenceUpdate = (event: {
      userId?: unknown;
      isOnline?: unknown;
      lastSeenAt?: unknown;
    }) => {
      const userId = event.userId;
      const isOnline = event.isOnline;
      if (!Number.isSafeInteger(userId) || typeof isOnline !== "boolean") return;
      const lastSeenAt = typeof event.lastSeenAt === "string" ? event.lastSeenAt : null;
      qc.setQueriesData<{ items: UserRow[] }>(
        { queryKey: getListUsersQueryKey() },
        (page) => page
          ? {
              ...page,
              items: page.items.map((user) => user.id === userId
                ? {
                    ...user,
                    isOnline,
                    // Online events do not reset a truthful persisted history.
                    lastSeenAt: isOnline ? user.lastSeenAt ?? null : lastSeenAt,
                  }
                : user),
            }
          : page,
      );
    };
    socket.on("presence:update", onPresenceUpdate);
    return () => { socket.off("presence:update", onPresenceUpdate); };
  }, [qc, socket]);

  // Mutations
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUsersSummaryQueryKey() });
  };
  const createMut = useCreateUser({ mutation: { onSuccess: invalidate } });
  const updateMut = useUpdateUser({ mutation: { onSuccess: invalidate } });
  const deleteMut = useDeleteUser({ mutation: { onSuccess: invalidate } });
  const statusMut = useChangeUserStatus({ mutation: { onSuccess: invalidate } });
  const resetMut = useResetUserPassword({ mutation: { onSuccess: invalidate } });
  const resendInviteMut = useResendUserInvite({ mutation: { onSuccess: invalidate } });
  const cancelInviteMut = useCancelUserInvite({ mutation: { onSuccess: invalidate } });
  const resendVerificationMut = useResendUserVerification({ mutation: { onSuccess: invalidate } });

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditingUser | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);

  const [deleteFor, setDeleteFor] = useState<UserRow | null>(null);
  const [deactivateFor, setDeactivateFor] = useState<UserRow | null>(null);
  const [inspectorFor, setInspectorFor] = useState<UserRow | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Create-user diagnostics
  const [diagMode, setDiagMode] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [diagStep, setDiagStep] = useState<string | undefined>(undefined);
  const [diagError, setDiagError] = useState<string | undefined>(undefined);

  const openCreate = () => {
    setEditing({
      name: "",
      username: "",
      email: "",
      phone: "",
      role: "state_program_officer",
      stateId: null,
      sector: "",
      status: "invited",
      languagePreference: "en",
      password: "",
      confirmPassword: "",
    });
    setFormOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing({ ...u });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!editing) return;
    const requiresState = ["state_office_manager", "state_program_officer"].includes(editing.role ?? "");
    if (requiresState && (!stateReference.isReady || !editing.stateId)) {
      toast.error(t(!stateReference.isReady ? "userForm.statesUnavailable" : "userForm.stateRequired"));
      return;
    }
    const isCreate = !editing.id;
    if (isCreate) {
      const wantsPassword = editing.status !== "invited" && (editing.password ?? "").length > 0;
      if (wantsPassword && editing.password !== editing.confirmPassword) {
        toast.error(t("messages.passwordsDoNotMatch"));
        return;
      }
      setDiagMode("loading");
      setDiagStep(undefined);
      setDiagError(undefined);
      try {
        const res = await createMut.mutateAsync({
          data: {
            name: editing.name ?? "",
            username: editing.username ?? "",
            email: editing.email ?? "",
            phone: editing.phone || null,
            role: editing.role ?? "state_program_officer",
            stateId: editing.stateId ?? null,
            sector: editing.sector || null,
            password: wantsPassword ? editing.password : null,
            status: editing.status ?? "invited",
            languagePreference: editing.languagePreference ?? "en",
          },
        });
        setDiagMode("success");
        const created = res as { inviteToken?: string | null; emailDelivered?: boolean; emailDelivery?: "pending" | "sent" | "failed" };
        const isInviteMode = !!(created.inviteToken);
        if (isInviteMode) {
          if (created.emailDelivery === "failed") {
            toast.error(t("invites.deliveryFailed"));
          } else if (created.emailDelivery === "pending" || created.emailDelivered === false) {
            toast.info(t("messages.inviteSimulation"), { duration: 7000 });
          } else if (created.emailDelivered === true) {
            toast.success(t("messages.inviteEmailSuccess"));
          } else {
            toast.success(t("messages.inviteSuccess"));
          }
        } else {
          toast.success(t("messages.createSuccess"));
        }
        if (created.inviteToken) {
          setInviteLink(`${window.location.origin}/invite/${created.inviteToken}`);
        }
        setTimeout(() => {
          setFormOpen(false);
          setEditing(null);
          setDiagMode("idle");
        }, 1200);
      } catch (e) {
        const { code, step } = extractApiError(e);
        const message = localizeUserApiError(t, code);
        setDiagMode("error");
        setDiagStep(step);
        setDiagError(message);
        toast.error(message, { duration: 8000 });
      }
    } else {
      try {
        await updateMut.mutateAsync({
          id: editing.id!,
          data: {
            name: editing.name,
            username: editing.username ?? undefined,
            email: editing.email,
            phone: editing.phone || null,
            role: editing.role,
            stateId: editing.stateId ?? null,
            sector: editing.sector || null,
            status: editing.status,
            languagePreference: editing.languagePreference,
          },
        });
        toast.success(t("messages.updateSuccess"));
        setFormOpen(false);
        setEditing(null);
      } catch (e) {
        const { code } = extractApiError(e);
        toast.error(localizeUserApiError(t, code));
      }
    }
  };

  const changeStatus = async (u: UserRow, newStatus: Status) => {
    try {
      await statusMut.mutateAsync({ id: u.id, data: { status: newStatus } });
      toast.success(`${u.name} → ${t(`status.${newStatus}`)}`);
    } catch (e) {
      const { code } = extractApiError(e);
      toast.error(localizeUserApiError(t, code));
    }
  };

  const performReset = async (mode: "password" | "invite", password?: string) => {
    if (!resetFor) return;
    try {
      const res = await resetMut.mutateAsync({
        id: resetFor.id,
        data: mode === "invite" ? { invite: true } : { password: password ?? "", invite: false },
      });
      toast.success(mode === "invite" ? t("messages.inviteResent") : t("messages.passwordReset"));
      const token = (res as { inviteToken?: string | null }).inviteToken;
      if (token) setInviteLink(`${window.location.origin}/invite/${token}`);
      setResetFor(null);
    } catch (e) {
      const { code } = extractApiError(e);
      toast.error(localizeUserApiError(t, code));
    }
  };

  const resendInvite = async (u: UserRow) => {
    try {
      const body = await resendInviteMut.mutateAsync({ id: u.id, data: {} });
      if (body.emailDelivery === "failed") {
        toast.error(t("invites.deliveryFailed"));
      } else if (body.emailDelivery === "pending" || body.emailDelivered === false) {
        toast.info(t("messages.inviteResentEmail"), { duration: 7000 });
      } else if (body.emailDelivered === true) {
        toast.success(`${t("messages.inviteEmailResent")} ${u.name}.`);
      } else {
        toast.success(`${t("messages.inviteResentTo")} ${u.name}.`);
      }
      if (body.inviteToken) setInviteLink(`${window.location.origin}/invite/${body.inviteToken}`);
    } catch (e) {
      const { code } = extractApiError(e);
      toast.error(t("invites.couldNotResend", { message: localizeUserApiError(t, code) }));
    }
  };

  const cancelInvite = async (u: UserRow) => {
    try {
      await cancelInviteMut.mutateAsync({ id: u.id });
      toast.success(t("messages.inviteCancelled"));
    } catch (e) {
      const { code } = extractApiError(e);
      toast.error(t("invites.couldNotCancel", { message: localizeUserApiError(t, code) }));
    }
  };

  const resendVerification = async (u: UserRow) => {
    try {
      const body = await resendVerificationMut.mutateAsync({ id: u.id });
      if (body.delivered) {
        toast.success(t("invites.verificationSent", { email: u.email }));
      } else {
        toast.success(t("invites.verificationQueued", { email: u.email }));
      }
    } catch (e) {
      const { code } = extractApiError(e);
      if (code === "already_verified") { toast.info(t("invites.alreadyVerified", { name: u.name })); return; }
      toast.error(t("invites.couldNotSendVerification", { message: localizeUserApiError(t, code) }));
    }
  };

  const performDelete = async () => {
    if (!deleteFor) return;
    try {
      await deleteMut.mutateAsync({ id: deleteFor.id });
      toast.success(t("messages.deleteSuccess"));
      setDeleteFor(null);
    } catch (e) {
      const { code } = extractApiError(e);
      toast.error(localizeUserApiError(t, code));
    }
  };

  // Dashboard cards
  const total = summary?.total ?? 0;
  const active = summary?.byStatus.find((s) => s.status === "active")?.n ?? 0;
  const invited = summary?.byStatus.find((s) => s.status === "invited")?.n ?? 0;
  const suspended = summary?.byStatus.find((s) => s.status === "suspended")?.n ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("subtitle")} {canManage ? "" : t("subtitleReadOnly")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage && activeTab === "all" && (
            <Button onClick={openCreate} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              {t("newUser")}
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | "resets" | "invitations")}>
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="all">
            <UsersIcon className="h-3.5 w-3.5 me-1.5" />
            {t("tabs.allUsers")}
          </TabsTrigger>
          <TabsTrigger value="resets">
            <KeyRound className="h-3.5 w-3.5 me-1.5" />
            {t("tabs.passwordResets")}
          </TabsTrigger>
          <TabsTrigger value="invitations">
            <Mail className="h-3.5 w-3.5 me-1.5" />
            {t("tabs.invitations")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-3 space-y-4">

      {/* Summary cards */}
      <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("stats.totalUsers")}>
        <SummaryCard
          icon={<UsersIcon className="h-4 w-4 text-muted-foreground" />}
          label={t("stats.totalUsers")}
          value={total}
          active={!hasFilters}
          onClick={() => {
            setStatus("");
            setRole("");
            setStateId("");
            setSector("");
            setQ("");
            setOffset(0);
          }}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label={t("stats.active")}
          value={active}
          active={status === "active"}
          onClick={() => { setStatus("active"); setOffset(0); }}
        />
        <SummaryCard
          icon={<Mail className="h-4 w-4 text-info" />}
          label={t("stats.invited")}
          value={invited}
          active={status === "invited"}
          onClick={() => { setStatus("invited"); setOffset(0); }}
        />
        <SummaryCard
          icon={<PauseCircle className="h-4 w-4 text-warning" />}
          label={t("stats.suspended")}
          value={suspended}
          active={status === "suspended"}
          onClick={() => { setStatus("suspended"); setOffset(0); }}
        />
      </div>

      {summary && (summary.byRole.length > 0 || summary.byState.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> {t("usersByRole")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {summary.byRole.map((r) => (
                  <button
                    key={r.role}
                    type="button"
                    aria-pressed={role === r.role}
                    onClick={() => { setRole(r.role); setOffset(0); }}
                    className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                      role === r.role
                        ? "border-primary/60 bg-accent text-accent-foreground"
                        : "border-border/70 bg-card hover:bg-accent"
                    }`}
                  >
                    <span className="min-w-0 truncate" title={t(`roles.${r.role}`)}>{t(`roles.${r.role}`)}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-medium tabular-nums">{r.n}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="text-sm">{t("usersByState")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {summary.byState.map((s) => (
                  <button
                    key={s.stateId}
                    type="button"
                    aria-pressed={stateId === String(s.stateId)}
                    onClick={() => { setStateId(String(s.stateId)); setOffset(0); }}
                    className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                      stateId === String(s.stateId)
                        ? "border-primary/60 bg-accent text-accent-foreground"
                        : "border-border/70 bg-card hover:bg-accent"
                    }`}
                  >
                    <span className="min-w-0 truncate" title={getLinkedStateLabel(s, i18n.language)}>{getLinkedStateLabel(s, i18n.language)}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-medium tabular-nums">{s.n}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
        <Separator orientation="vertical" className="h-5" />
        <div className="relative">
          <Search className="absolute start-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            className="ps-7 h-9 w-full sm:w-52 text-sm"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          />
        </div>
        <Select value={role || "all"} onValueChange={(v) => { setRole(v === "all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="h-9 w-full sm:w-48 text-sm"><SelectValue placeholder={t("allRoles")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allRoles")}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{t(`roles.${r.value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="h-9 w-full sm:w-40 text-sm"><SelectValue placeholder={t("allStatuses")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateId || "all"} onValueChange={(v) => { setStateId(v === "all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="h-9 w-full sm:w-40 text-sm"><SelectValue placeholder={t("allStates")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStates")}</SelectItem>
            {stateReference.states.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sector || "all"} onValueChange={(v) => { setSector(v === "all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="h-9 w-full sm:w-44 text-sm"><SelectValue placeholder={t("allSectors")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allSectors")}</SelectItem>
            {SECTORS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => { setQ(""); setRole(""); setStatus(""); setStateId(""); setSector(""); setOffset(0); }}>
            <FilterX className="h-3.5 w-3.5" /> {t("clear")}
          </Button>
        )}
      </div>

      <Card>
          <CardContent className="p-0">
            <div className="table-scroll" role="region" aria-label={t("ariaLabel.usersTable")} tabIndex={0}>
            <Table className="min-w-[1190px]">
              <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>{t("fields.name")}</TableHead>
                  <TableHead>{t("table.username")}</TableHead>
                  <TableHead>{t("fields.email")}</TableHead>
                  <TableHead>{t("verified")}</TableHead>
                  <TableHead>{t("table.role")}</TableHead>
                  <TableHead>{t("table.state")}</TableHead>
                  <TableHead>{t("table.sector")}</TableHead>
                  <TableHead>{t("statusHeader")}</TableHead>
                  <TableHead>{t("presence.header")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("fields.lastLogin")}</TableHead>
                  <TableHead>{t("fields.createdAt")}</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="py-3"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-4">
                      <ErrorState compact variant="server" title={t("couldNotLoadUsers")} onRetry={() => refetch()} />
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-14">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <UsersIcon className="h-8 w-8 opacity-30" />
                        <p className="text-sm font-medium">{hasFilters ? t("noUsersFilters") : t("noUsers")}</p>
                        {!hasFilters && canManage && <p className="text-xs">{t("clickNewUser")}</p>}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="font-mono text-xs">{u.username ?? "—"}</TableCell>
                      <TableCell className="text-sm"><bdi dir="ltr">{u.email ?? "—"}</bdi></TableCell>
                      <TableCell>
                        {u.emailVerified ? (
                          <span title={`${t("verified")}${u.emailVerifiedAt ? ` on ${formatDate(u.emailVerifiedAt)}` : ""}`}>
                            <ShieldCheck className="h-4 w-4 text-success" />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("unverified")}</span>
                        )}
                      </TableCell>
                      <TableCell><RoleBadge role={u.role} label={u.roleLabel} /></TableCell>
                      <TableCell className="text-sm">{getLinkedStateLabel(u, i18n.language)}</TableCell>
                      <TableCell className="text-sm">{u.sector ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={u.status ?? "active"} /></TableCell>
                      <TableCell><PresenceValue isOnline={u.isOnline === true} lastSeenAt={u.lastSeenAt} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t("table.never")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                      <TableCell>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("ariaLabel.actionsFor", { name: u.name })}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>{t("actionsLabel")}</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => openEdit(u)}>
                                <Pencil className="h-3.5 w-3.5 me-2" /> {t("actions.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setInspectorFor(u)}>
                                <ShieldCheck className="h-3.5 w-3.5 me-2 text-info" /> {t("inspector.menuItem")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setResetFor(u)}>
                                <KeyRound className="h-3.5 w-3.5 me-2" /> {t("actions.resetPassword")}
                              </DropdownMenuItem>
                              {u.status === "invited" && (
                                <>
                                  <DropdownMenuItem onClick={() => resendInvite(u)}>
                                    <Mail className="h-3.5 w-3.5 me-2 text-info" /> {t("actions.resendInvite")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => cancelInvite(u)}>
                                    <XCircle className="h-3.5 w-3.5 me-2 text-warning" /> {t("actions.cancelInvite")}
                                  </DropdownMenuItem>
                                </>
                              )}
                              {!u.emailVerified && u.status === "active" && (
                                <DropdownMenuItem onClick={() => resendVerification(u)}>
                                  <ShieldCheck className="h-3.5 w-3.5 me-2 text-success" /> {t("actions.resendVerification")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {u.status !== "active" && (
                                <DropdownMenuItem onClick={() => changeStatus(u, "active")}>
                                  <CheckCircle2 className="h-3.5 w-3.5 me-2 text-success" /> {t("actions.activate")}
                                </DropdownMenuItem>
                              )}
                              {u.status !== "suspended" && (
                                <DropdownMenuItem onClick={() => changeStatus(u, "suspended")}>
                                  <PauseCircle className="h-3.5 w-3.5 me-2 text-warning" /> {t("actions.suspend")}
                                </DropdownMenuItem>
                              )}
                              {u.status !== "deactivated" && (
                                  <DropdownMenuItem onClick={() => setDeactivateFor(u)}>
                                  <XCircle className="h-3.5 w-3.5 me-2 text-destructive" /> {t("actions.deactivate")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteFor(u)}
                              >
                                <Trash2 className="h-3.5 w-3.5 me-2" /> {t("actions.delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      {!isLoading && !isError && usersPage && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground" aria-live="polite">
          <span>{t("pagination.showing", { from: usersPage.total ? usersPage.offset + 1 : 0, to: usersPage.offset + users.length, total: usersPage.total })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - pageSize))} disabled={offset === 0}>
              {t("pagination.previous")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOffset(usersPage.nextOffset ?? offset)} disabled={!usersPage.hasMore}>
              {t("pagination.next")}
            </Button>
          </div>
        </div>
      )}

        </TabsContent>

        <TabsContent value="resets" className="mt-4">
          <PasswordResetRequestsTab
            canManage={["super_admin", "executive_director", "program_manager"].includes(me?.user?.role ?? "")}
          />
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          <InvitationsTab canManage={canManage} />
        </TabsContent>
      </Tabs>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b px-6 pb-4 pt-6">
            <DialogHeader>
              <DialogTitle>{editing?.id ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
              <DialogDescription>
                {editing?.id
                  ? t("dialog.editDesc")
                  : t("dialog.createDesc")}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {editing && (
              <UserForm editing={editing} setEditing={setEditing} stateReference={stateReference} />
            )}
            {!editing?.id && (
              <CreateDiagnostics
                mode={diagMode}
                failedStep={diagStep}
                errorMessage={diagError}
                inviteMode={editing?.status === "invited" || !(editing?.password ?? "")}
              />
            )}
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => { setFormOpen(false); setEditing(null); setDiagMode("idle"); setDiagStep(undefined); setDiagError(undefined); }}>{t("common:cancel")}</Button>
            <Button
              onClick={submitForm}
              disabled={
                createMut.isPending
                || updateMut.isPending
                || (!!editing && ["state_office_manager", "state_program_officer"].includes(editing.role ?? "")
                  && (!stateReference.isReady || !editing.stateId))
              }
            >
              {editing?.id ? t("form.saveChanges") : t("form.createUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <ResetPasswordDialog
        user={resetFor}
        onCancel={() => setResetFor(null)}
        onSubmit={performReset}
        pending={resetMut.isPending}
      />

      {/* Invite link dialog */}
      <Dialog open={!!inviteLink} onOpenChange={(o) => { if (!o) setInviteLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.inviteLinkTitle")}</DialogTitle>
            <DialogDescription>
              {t("dialog.inviteLinkDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input value={inviteLink ?? ""} readOnly className="font-mono text-xs" />
            <Button
              size="icon"
              variant="outline"
              onClick={async () => {
                if (inviteLink) {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    toast.success(t("messages.inviteLinkCopied"));
                  } catch {
                    toast.info(t("messages.inviteLinkCopyManual"));
                  }
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setInviteLink(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteFor} onOpenChange={(o) => { if (!o) setDeleteFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteUser")} {deleteFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialog.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={performDelete}
            >
              {t("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deactivateFor} onOpenChange={(o) => { if (!o) setDeactivateFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deactivateDialog.title", { name: deactivateFor?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deactivateDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => {
              if (deactivateFor) void changeStatus(deactivateFor, "deactivated");
              setDeactivateFor(null);
            }}>
              {t("actions.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Access & Permissions Inspector */}
      <AccessInspectorSheet
        user={inspectorFor}
        onClose={() => setInspectorFor(null)}
      />
    </div>
  );
}

// ─── Password Reset Requests Tab ──────────────────────────────────────────────

type ResetToken = {
  id: number;
  status: "active" | "used" | "expired" | "revoked";
  source: "forgot_password" | "admin_reset";
  emailStatus: "pending" | "sent" | "failed";
  requestedAt: string;
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  resolvedAt?: string | null;
  handledAt?: string | null;
  handledByName?: string | null;
  userId: number;
  userName: string;
  userEmail: string;
  ipAddress?: string | null;
};

type ResetSummary = {
  total: number;
  active: number;
  used: number;
  expired: number;
  revoked: number;
  selfService: number;
  adminReset: number;
};

function resetStatusLabel(status: ResetToken["status"], t: (key: string) => string) {
  switch (status) {
    case "active": return t("passwordReset.statusLabel.active");
    case "used": return t("passwordReset.statusLabel.used");
    case "expired": return t("passwordReset.statusLabel.expired");
    case "revoked": return t("passwordReset.statusLabel.revoked");
  }
}

function resetStatusVariant(status: ResetToken["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active": return "default";
    case "used": return "secondary";
    case "expired": return "destructive";
    case "revoked": return "outline";
  }
}

function resetLifecycleValue(token: ResetToken): string | null | undefined {
  // Resolution is recorded separately from token status. For a still-active
  // token that an administrator has resolved, surface the actual follow-up
  // time rather than implying the expiry was the resolution.
  if (token.status === "active" && token.resolvedAt) return token.resolvedAt;

  switch (token.status) {
    case "active": return token.expiresAt;
    case "used": return token.usedAt;
    case "revoked": return token.revokedAt;
    case "expired": return token.expiresAt;
  }
}
function PasswordResetRequestsTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation("users");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [offset, setOffset] = useState(0);
  const pageSize = 25;

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (search.trim()) p.search = search.trim();
    if (filterStatus !== "all") p.status = filterStatus;
    if (filterSource !== "all") p.source = filterSource;
    p.limit = String(pageSize);
    p.offset = String(offset);
    return p;
  }, [search, filterStatus, filterSource, offset]);

  const qs = new URLSearchParams(params).toString();

  const { data, isLoading, isError, refetch } = useQuery<{
    tokens: ResetToken[];
    total: number;
    summary: ResetSummary;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  }>({
    queryKey: ["password-reset-tokens", qs],
    queryFn: async () => {
      const response = await fetch(`/api/password-reset-tokens?${qs}`, { credentials: "include" });
      if (!response.ok) throw new Error("password_reset_registry_unavailable");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const doAction = useCallback(async (tokenId: number, action: "cancel" | "resend" | "resolve") => {
    const res = await fetch(`/api/password-reset-tokens/${tokenId}/${action}`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) { toast.error(body.error ?? t("passwordReset.actionFailed")); return; }
    if (action === "resend" && body.resetLink) {
      await navigator.clipboard.writeText(body.resetLink).catch(() => {});
      toast.success(t("passwordReset.linkCopied"));
    } else if (action === "cancel") {
      toast.success(t("passwordReset.requestCancelled"));
    } else {
      toast.success(t("passwordReset.markedResolved"));
    }
    refetch();
  }, [refetch, t]);

  const tokens = data?.tokens ?? [];
  const summary = data?.summary;
  const hasFilters = Boolean(search.trim() || filterStatus !== "all" || filterSource !== "all");
  const columns = canManage ? 7 : 6;

  const resetPage = () => setOffset(0);

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: t("passwordReset.statLabels.total"), value: summary.total, icon: <KeyRound className="h-4 w-4 text-muted-foreground" /> },
            { label: t("passwordReset.statLabels.pending"), value: summary.active, icon: <Clock className="h-4 w-4 text-info" /> },
            { label: t("passwordReset.statLabels.used"), value: summary.used, icon: <CheckCheck className="h-4 w-4 text-success" /> },
            { label: t("passwordReset.statLabels.expired"), value: summary.expired, icon: <AlertCircle className="h-4 w-4 text-destructive" /> },
            { label: t("passwordReset.statLabels.cancelled"), value: summary.revoked, icon: <Ban className="h-4 w-4 text-warning" /> },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  {c.icon}
                </div>
                <div className="text-xl font-medium">{c.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="grid gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(11rem,1fr)_minmax(11rem,1fr)]">
            <div className="relative">
              <Search className="absolute start-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label={t("passwordReset.searchPlaceholder")}
                placeholder={t("passwordReset.searchPlaceholder")}
                className="ps-8"
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              />
            </div>
            <Select value={filterStatus} onValueChange={(value) => { setFilterStatus(value); resetPage(); }}>
              <SelectTrigger aria-label={t("passwordReset.filterStatus.label")}><SelectValue placeholder={t("passwordReset.filterStatus.allStatuses")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("passwordReset.filterStatus.allStatuses")}</SelectItem>
                <SelectItem value="active">{t("passwordReset.filterStatus.pending")}</SelectItem>
                <SelectItem value="used">{t("passwordReset.filterStatus.used")}</SelectItem>
                <SelectItem value="expired">{t("passwordReset.filterStatus.expired")}</SelectItem>
                <SelectItem value="revoked">{t("passwordReset.filterStatus.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSource} onValueChange={(value) => { setFilterSource(value); resetPage(); }}>
              <SelectTrigger aria-label={t("passwordReset.filterSource.label")}><SelectValue placeholder={t("passwordReset.filterSource.allSources")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("passwordReset.filterSource.allSources")}</SelectItem>
                <SelectItem value="forgot_password">{t("passwordReset.filterSource.forgotPassword")}</SelectItem>
                <SelectItem value="admin_reset">{t("passwordReset.filterSource.adminReset")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={t("ariaLabel.passwordResetsTable")}>
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("passwordReset.tableHeaders.user")}</TableHead>
                  <TableHead>{t("passwordReset.tableHeaders.source")}</TableHead>
                  <TableHead>{t("passwordReset.tableHeaders.requestedAt")}</TableHead>
                  <TableHead>{t("passwordReset.tableHeaders.expiryResolution")}</TableHead>
                  <TableHead>{t("passwordReset.tableHeaders.status")}</TableHead>
                  <TableHead>{t("passwordReset.tableHeaders.emailDelivery")}</TableHead>
                  {canManage && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: columns }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={columns}>
                      <ErrorState
                        compact
                        variant="server"
                        title={t("passwordReset.loadFailed.title")}
                        description={t("passwordReset.loadFailed.description")}
                        retryLabel={t("passwordReset.loadFailed.retry")}
                        onRetry={() => refetch()}
                      />
                    </TableCell>
                  </TableRow>
                ) : tokens.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
                      <FilterX className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      {hasFilters ? t("passwordReset.noResults") : t("passwordReset.noRecords")}
                    </TableCell>
                  </TableRow>
                ) : (
                  tokens.map((tok) => (
                    <TableRow key={tok.id} className={tok.resolvedAt ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="font-medium text-sm">{tok.userName}</div>
                        <div className="text-xs text-muted-foreground">{tok.userEmail}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {tok.source === "forgot_password" ? t("passwordReset.source.selfService") : t("passwordReset.source.adminReset")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(tok.requestedAt)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                         {resetLifecycleValue(tok) ? (
                           <span className={tok.status === "expired" ? "font-medium text-destructive" : "text-muted-foreground"}>
                             {formatDateTime(resetLifecycleValue(tok)!)}
                           </span>
                         ) : (
                           <span className="text-muted-foreground">—</span>
                         )}
                       </TableCell>
                       <TableCell>
                         <Badge variant={resetStatusVariant(tok.status)} aria-label={resetStatusLabel(tok.status, t)}>
                           {resetStatusLabel(tok.status, t)}
                         </Badge>
                       </TableCell>
                       <TableCell>
                         <EmailDeliveryBadge status={tok.emailStatus} t={t} />
                       </TableCell>
                       {canManage && (
                         <TableCell>
                           <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("ariaLabel.actionsForReset")}>
                                 <MoreHorizontal className="h-4 w-4" />
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuContent align="end" className="w-48">
                               <DropdownMenuLabel>{t("passwordReset.actions.label")}</DropdownMenuLabel>
                               <DropdownMenuItem onClick={() => doAction(tok.id, "resend")}>
                                 <Send className="me-2 h-3.5 w-3.5 text-info" /> {t("passwordReset.actions.resend")}
                               </DropdownMenuItem>
                               {tok.status === "active" && (
                                 <DropdownMenuItem onClick={() => doAction(tok.id, "cancel")}>
                                   <Ban className="me-2 h-3.5 w-3.5 text-warning" /> {t("passwordReset.actions.cancel")}
                                 </DropdownMenuItem>
                               )}
                               {!tok.resolvedAt && (
                                 <DropdownMenuItem onClick={() => doAction(tok.id, "resolve")}>
                                   <CheckCheck className="me-2 h-3.5 w-3.5 text-success" /> {t("passwordReset.actions.resolve")}
                                 </DropdownMenuItem>
                               )}
                             </DropdownMenuContent>
                           </DropdownMenu>
                         </TableCell>
                       )}
                     </TableRow>
                   ))
                 )}
              </TableBody>
            </Table>
          </div>
          {data && !isError && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
              <span>{t("passwordReset.showing", { count: tokens.length, total: data.total })}</span>
              {data.total > pageSize && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - pageSize))} disabled={offset === 0}>
                    {t("pagination.previous")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setOffset(data.nextOffset ?? offset)} disabled={!data.hasMore}>
                    {t("pagination.next")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Invitations Tab ───────────────────────────────────────────────────────────

type InvitationRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  status: string;
  inviteEmailStatus: "pending" | "sent" | "failed";
  inviteExpiresAt?: string | null;
  inviteAcceptedAt?: string | null;
  invitedAt: string;
  stateName?: string | null;
  stateNameAr?: string | null;
  sector?: string | null;
  invitedByName?: string | null;
};

function inviteStatus(row: InvitationRow): "pending" | "expired" | "cancelled" | "accepted" {
  if (row.inviteAcceptedAt) return "accepted";
  if (row.status === "deactivated") return "cancelled";
  if (row.inviteExpiresAt && new Date(row.inviteExpiresAt) < new Date()) return "expired";
  return "pending";
}

function InviteStatusBadge({ row }: { row: InvitationRow }) {
  const { t } = useTranslation("users");
  const s = inviteStatus(row);
  if (s === "accepted") return <Badge variant="approved">{t("invites.statusBadge.accepted")}</Badge>;
  if (s === "cancelled") return <Badge variant="inactive">{t("invites.statusBadge.cancelled")}</Badge>;
  if (s === "expired") return <Badge variant="rejected">{t("invites.statusBadge.expired")}</Badge>;
  return <Badge variant="submitted">{t("invites.statusBadge.pending")}</Badge>;
}

function InviteEmailStatusBadge({ status }: { status: InvitationRow["inviteEmailStatus"] }) {
  const { t } = useTranslation("users");
  if (status === "sent") {
    return <Badge variant="approved" className="text-xs gap-1"><CheckCheck className="h-3 w-3" />{t("invites.emailStatusBadge.sent")}</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="rejected" className="text-xs gap-1"><AlertCircle className="h-3 w-3" />{t("invites.emailStatusBadge.failed")}</Badge>;
  }
  return <Badge variant="returned" className="text-xs gap-1"><Clock className="h-3 w-3" />{t("invites.emailStatusBadge.pending")}</Badge>;
}

function InvitationsTab({ canManage }: { canManage: boolean }) {
  const { t, i18n } = useTranslation("users");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterState, setFilterState] = useState("all");
  const [filterEmailDelivery, setFilterEmailDelivery] = useState("all");
  const [inviteLinkFor, setInviteLinkFor] = useState<{
    token: string;
    name: string;
    expiresInDays?: number;
    emailDelivery: "pending" | "sent" | "failed";
  } | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const { data: statesData } = useListStates();
  const statesList = Array.isArray(statesData) ? statesData : [];
  const [offset, setOffset] = useState(0);
  const hasFilters = Boolean(search.trim() || filterStatus !== "all" || filterRole !== "all" || filterState !== "all" || filterEmailDelivery !== "all");

  const resetFilters = useCallback(() => {
    setSearch("");
    setFilterStatus("all");
    setFilterRole("all");
    setFilterState("all");
    setFilterEmailDelivery("all");
    setOffset(0);
  }, []);

  const params = useMemo<ListUserInvitationsParams>(() => {
    const p: ListUserInvitationsParams = { limit: 25, offset };
    if (search.trim()) p.search = search.trim();
    if (filterStatus !== "all") p.status = filterStatus as ListUserInvitationsParams["status"];
    if (filterRole !== "all") p.role = filterRole;
    if (filterState !== "all") p.stateId = Number(filterState);
    if (filterEmailDelivery !== "all") p.emailDelivery = filterEmailDelivery as ListUserInvitationsParams["emailDelivery"];
    return p;
  }, [search, filterStatus, filterRole, filterState, filterEmailDelivery, offset]);

  const { data, isLoading, isError, refetch } = useListUserInvitations(params);
  const resendInviteMut = useResendUserInvite();
  const cancelInviteMut = useCancelUserInvite();

  const handleResend = useCallback(async (row: InvitationRow) => {
    try {
      const body = await resendInviteMut.mutateAsync({ id: row.id, data: {} });
      setInviteLinkFor({ token: body.inviteToken, name: row.name, emailDelivery: body.emailDelivery });
      refetch();
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      if (body.emailDelivery === "failed") {
        toast.error(t("invites.deliveryFailed"));
      } else if (body.emailDelivery === "pending" || body.emailDelivered === false) {
        toast.info(t("invites.resendSimulation"), { duration: 7000 });
      } else {
        toast.success(t("invites.resendEmailSent"));
      }
    } catch (err) {
      toast.error(localizeUserApiError(t, extractApiError(err).code));
    }
  }, [refetch, qc, resendInviteMut, t]);

  const handleCancel = useCallback(async (row: InvitationRow) => {
    try {
      await cancelInviteMut.mutateAsync({ id: row.id });
      toast.success(t("invites.cancelSuccess"));
      refetch();
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } catch (err) {
      toast.error(localizeUserApiError(t, extractApiError(err).code));
    }
  }, [refetch, qc, cancelInviteMut, t]);

  const invitations = data?.invitations ?? [];

  // Build invite link — standardised on /invite/:token (also registered as /accept-invitation)
  const buildInviteLink = useCallback((token: string) =>
    `${window.location.origin}/invite/${encodeURIComponent(token)}`, []);

  const inviteLink = inviteLinkFor ? buildInviteLink(inviteLinkFor.token) : null;

  return (
    <div className="space-y-3">
      {/* Header with Invite button */}
      {canManage && (
        <div className="flex items-center justify-end">
          <div />
          <Button size="sm" onClick={() => setShowInviteDialog(true)}>
            <Plus className="h-4 w-4" /> {t("invites.inviteUser")}
          </Button>
        </div>
      )}

      {/* Summary strip */}
      {data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: t("invites.totalInvites"), value: data.summary.total, icon: <Mail className="h-4 w-4 text-muted-foreground" /> },
            { label: t("invites.pending"), value: data.summary.pending, icon: <Clock className="h-4 w-4 text-info" /> },
            { label: t("invites.accepted"), value: data.summary.accepted, icon: <CheckCheck className="h-4 w-4 text-success" /> },
            { label: t("invites.expired"), value: data.summary.expired, icon: <AlertCircle className="h-4 w-4 text-destructive" /> },
            { label: t("invites.cancelled"), value: data.summary.cancelled, icon: <Ban className="h-4 w-4 text-muted-foreground" /> },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  {c.icon}
                </div>
                <div className="text-xl font-medium">{c.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
            <div className="relative md:col-span-2 lg:col-span-1">
              <Search className="absolute start-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input aria-label={t("invites.searchPlaceholder")} placeholder={t("invites.searchPlaceholder")} className="ps-8" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
            </div>
            <Select value={filterStatus} onValueChange={(value) => { setFilterStatus(value); setOffset(0); }}>
              <SelectTrigger><SelectValue placeholder={t("allStatuses")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                <SelectItem value="pending">{t("invites.pending")}</SelectItem>
                <SelectItem value="accepted">{t("invites.accepted")}</SelectItem>
                <SelectItem value="expired">{t("invites.expired")}</SelectItem>
                <SelectItem value="cancelled">{t("invites.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRole} onValueChange={(value) => { setFilterRole(value); setOffset(0); }}>
              <SelectTrigger><SelectValue placeholder={t("allRoles")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allRoles")}</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{t(`roles.${r.value}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterState} onValueChange={(value) => { setFilterState(value); setOffset(0); }}>
              <SelectTrigger><SelectValue placeholder={t("allStates")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStates")}</SelectItem>
                {statesList.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterEmailDelivery} onValueChange={(value) => { setFilterEmailDelivery(value); setOffset(0); }}>
              <SelectTrigger><SelectValue placeholder={t("invites.emailDeliveryFilter")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("invites.emailDeliveryFilter")}</SelectItem>
                <SelectItem value="sent">{t("invites.emailStatusBadge.sent")}</SelectItem>
                <SelectItem value="pending">{t("invites.emailStatusBadge.pending")}</SelectItem>
                <SelectItem value="failed">{t("invites.emailStatusBadge.failed")}</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" className="justify-start lg:col-span-5" onClick={resetFilters}>
                <FilterX className="h-4 w-4" /> {t("invites.resetFilters")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto" role="region" aria-label={t("ariaLabel.invitationsTable")} tabIndex={0}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invites.tableHeaders.user")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.role")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.state")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.sector")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.invitedAt")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.tokenExpiry")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.status")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.emailDelivery")}</TableHead>
                  <TableHead>{t("invites.tableHeaders.invitedBy")}</TableHead>
                  {canManage && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: canManage ? 10 : 9 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 10 : 9} className="py-4">
                      <ErrorState compact variant="server" title={t("invites.couldNotLoad")} onRetry={() => refetch()} />
                    </TableCell>
                  </TableRow>
                ) : invitations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 10 : 9} className="text-center py-10 text-muted-foreground">
                      <FilterX className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p>{hasFilters ? t("invites.noFilteredInvitations") : t("invites.noInvitations")}</p>
                      {hasFilters && (
                        <Button type="button" variant="link" size="sm" className="mt-1" onClick={resetFilters}>
                          {t("invites.resetFilters")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  invitations.map((row) => {
                    const s = inviteStatus(row);
                    return (
                      <TableRow key={row.id} className={s === "cancelled" ? "opacity-50" : ""}>
                        <TableCell>
                          <div className="font-medium text-sm">{row.name}</div>
                          <div className="text-xs text-muted-foreground">{row.email}</div>
                        </TableCell>
                        <TableCell className="text-sm">{t(`roles.${row.role}`, { defaultValue: row.role })}</TableCell>
                        <TableCell className="text-sm">{getLinkedStateLabel(row, i18n.language)}</TableCell>
                        <TableCell className="text-sm">{row.sector ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(row.invitedAt)}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {s === "accepted" && row.inviteAcceptedAt ? (
                            <span className="text-success font-medium">{t("invites.lifecycle.accepted", { date: formatDateTime(row.inviteAcceptedAt) })}</span>
                          ) : row.inviteExpiresAt ? (
                            <span className={s === "expired" ? "text-destructive font-medium" : "text-muted-foreground"}>
                              {t("invites.lifecycle.expires", { date: formatDateTime(row.inviteExpiresAt) })}
                            </span>
                          ) : <span className="text-muted-foreground">{t("invites.lifecycle.unavailable")}</span>}
                        </TableCell>
                        <TableCell><InviteStatusBadge row={row} /></TableCell>
                        <TableCell>
                          <InviteEmailStatusBadge status={row.inviteEmailStatus ?? "pending"} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.invitedByName ?? "—"}
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            {(s === "pending" || s === "expired" || s === "cancelled") ? <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("ariaLabel.actionsForInvite")}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuLabel>{t("invites.dropdownActions.label")}</DropdownMenuLabel>
                                {(s === "pending" || s === "expired") && (
                                  <>
                                    <DropdownMenuItem onClick={() => handleResend(row)}>
                                      <RefreshCw className="h-3.5 w-3.5 me-2 text-info" /> {t("invites.dropdownActions.resend")}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleCancel(row)} className="text-destructive focus:text-destructive">
                                      <XCircle className="h-3.5 w-3.5 me-2" /> {t("invites.dropdownActions.cancel")}
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {s === "cancelled" && (
                                  <DropdownMenuItem onClick={() => handleResend(row)}>
                                    <Send className="h-3.5 w-3.5 me-2 text-info" /> {t("invites.dropdownActions.reInvite")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu> : <span className="text-muted-foreground" aria-label={t("invites.noActions")}>—</span>}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{t("pagination.showing", { from: data.total === 0 ? 0 : data.offset + 1, to: data.offset + invitations.length, total: data.total })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, data.offset - data.limit))} disabled={data.offset === 0}>
              {t("pagination.previous")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOffset(data.nextOffset ?? data.offset)} disabled={!data.hasMore}>
              {t("pagination.next")}
            </Button>
          </div>
        </div>
      )}

      {/* Invite User Dialog */}
      <InviteUserDialog
        open={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onCreated={(token, emailDelivery, name, expiresInDays) => {
          setShowInviteDialog(false);
          if (token) setInviteLinkFor({ token, name, expiresInDays, emailDelivery });
          refetch();
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          if (emailDelivery === "failed") {
            toast.error(t("invites.deliveryFailed"));
          } else if (emailDelivery === "pending") {
            toast.info(t("invites.inviteCreatedSimulation"), { duration: 7000 });
          } else {
            toast.success(t("invites.inviteSentTo", { name }));
          }
        }}
      />

      {/* Invite link dialog */}
      <Dialog open={!!inviteLink} onOpenChange={(o) => { if (!o) setInviteLinkFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invites.linkDialog.title")}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t("invites.linkDialog.shareDesc", { name: inviteLinkFor?.name ?? "" })}</p>
                {inviteLinkFor?.expiresInDays && (
                  <p>{t("invites.linkDialog.expiresIn", {
                    days: inviteLinkFor.expiresInDays,
                    dayWord: inviteLinkFor.expiresInDays !== 1 ? t("invites.linkDialog.days") : t("invites.linkDialog.day"),
                  })}</p>
                )}
                {inviteLinkFor?.emailDelivery === "pending" && (
                  <p className="text-warning text-xs">{t("invites.linkDialog.simulationWarning")}</p>
                )}
                {inviteLinkFor?.emailDelivery === "failed" && (
                  <p className="text-destructive text-xs">{t("invites.linkDialog.deliveryFailed")}</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input value={inviteLink ?? ""} readOnly className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (inviteLink) {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    toast.success(t("invites.linkDialog.linkCopied"));
                  } catch {
                    // clipboard blocked — user can select and copy the field above manually
                    toast.info(t("invites.linkDialog.copyManual"));
                  }
                }
              }}
            >
              <Copy className="h-4 w-4" /> {t("invites.linkDialog.copyLink")}
            </Button>
            <Button onClick={() => setInviteLinkFor(null)}>{t("invites.linkDialog.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Invite User Dialog ────────────────────────────────────────────────────────

const STATE_ROLES_SET = new Set(["state_office_manager", "state_program_officer"]);
const EXPIRY_OPTIONS = [
  { label: "3 days", value: 3 },
  { label: "7 days (default)", value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
];

type InviteForm = {
  name: string;
  email: string;
  role: string;
  stateId: string;
  sector: string;
  expiresInDays: number;
  message: string;
};

function InviteUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (token: string | null, emailDelivery: "pending" | "sent" | "failed", name: string, expiresInDays: number) => void;
}) {
  const { t } = useTranslation("users");
  const { data: statesData } = useListStates();
  const statesList = Array.isArray(statesData) ? statesData : [];

  const [form, setForm] = useState<InviteForm>({
    name: "",
    email: "",
    role: "",
    stateId: "",
    sector: "",
    expiresInDays: 7,
    message: "",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setForm({ name: "", email: "", role: "", stateId: "", sector: "", expiresInDays: 7, message: "" });
    setFormError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const needsState = STATE_ROLES_SET.has(form.role);
  const isTC = form.role === "technical_coordinator";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim() || !form.email.trim() || !form.role) {
      setFormError(t("inviteDialog.nameEmailRoleRequired"));
      return;
    }
    if (needsState && !form.stateId) {
      setFormError(t("inviteDialog.stateRequired"));
      return;
    }
    if (isTC && !form.sector) {
      setFormError(t("inviteDialog.sectorRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          role: form.role,
          stateId: needsState ? (form.stateId || null) : null,
          sector: isTC ? form.sector : null,
          status: "invited",
          inviteExpiresInDays: form.expiresInDays,
          inviteMessage: form.message.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(localizeUserApiError(t, body.error));
        return;
      }
      reset();
      onCreated(
        body.inviteToken ?? null,
        body.emailDelivery === "failed" || body.emailDelivery === "sent" ? body.emailDelivery : "pending",
        form.name.trim(),
        form.expiresInDays,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("inviteDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("inviteDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="inv-name">{t("inviteDialog.fullName")} <span className="text-destructive">{t("inviteDialog.required")}</span></Label>
              <Input
                id="inv-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("inviteDialog.placeholderName")}
                required
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="inv-email">{t("inviteDialog.emailAddress")} <span className="text-destructive">{t("inviteDialog.required")}</span></Label>
              <Input
                id="inv-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={t("inviteDialog.placeholderEmail")}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-role">{t("inviteDialog.role")} <span className="text-destructive">{t("inviteDialog.required")}</span></Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v, stateId: "", sector: "" }))}>
                <SelectTrigger id="inv-role"><SelectValue placeholder={t("inviteDialog.selectRole")} /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{t(`roles.${r.value}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-expiry">{t("inviteDialog.linkExpiresAfter")}</Label>
              <Select value={String(form.expiresInDays)} onValueChange={(v) => setForm((f) => ({ ...f, expiresInDays: Number(v) }))}>
                <SelectTrigger id="inv-expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsState && (
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="inv-state">{t("inviteDialog.assignedState")} <span className="text-destructive">{t("inviteDialog.required")}</span></Label>
                <Select value={form.stateId} onValueChange={(v) => setForm((f) => ({ ...f, stateId: v }))}>
                  <SelectTrigger id="inv-state"><SelectValue placeholder={t("inviteDialog.selectState")} /></SelectTrigger>
                  <SelectContent>
                    {statesList.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isTC && (
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="inv-sector">{t("inviteDialog.assignedSector")} <span className="text-destructive">{t("inviteDialog.required")}</span></Label>
                <Select value={form.sector} onValueChange={(v) => setForm((f) => ({ ...f, sector: v }))}>
                  <SelectTrigger id="inv-sector"><SelectValue placeholder={t("inviteDialog.selectSector")} /></SelectTrigger>
                  <SelectContent>
                    {SECTORS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("inviteDialog.additionalSectors")}</p>
              </div>
            )}
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="inv-message">{t("inviteDialog.personalMessage")} <span className="text-muted-foreground text-xs">{t("inviteDialog.personalMessageHint")}</span></Label>
              <Textarea
                id="inv-message"
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder={t("inviteDialog.placeholderMessage")}
                rows={3}
                maxLength={500}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground text-end"><bdi dir="ltr">{form.message.length}/500</bdi></p>
            </div>
          </div>

          {formError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>{t("inviteDialog.cancel")}</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("inviteDialog.sending")}</> : <><Send className="h-4 w-4" /> {t("inviteDialog.sendInvitation")}</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, active, onClick,
}: { icon: React.ReactNode; label: string; value: number; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-[96px] w-full flex-col rounded-xl border bg-card p-4 text-start shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        active
          ? "border-primary/60 bg-accent/50"
          : "border-card-border hover:border-primary/40 hover:bg-accent/20"
      }`}
    >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </button>
  );
}

function UserForm({
  editing, setEditing, stateReference,
}: {
  editing: EditingUser;
  setEditing: (u: EditingUser) => void;
  stateReference: StateReferenceData;
}) {
  const { t, i18n } = useTranslation("users");
  const { states } = stateReference;
  const set = <K extends keyof EditingUser>(k: K, v: EditingUser[K]) =>
    setEditing({ ...editing, [k]: v });

  const roleDef = ROLES.find((r) => r.value === editing.role);
  const requiresState = roleDef?.scope === "state";
  const isCreate = !editing.id;
  const showPassword = isCreate && editing.status !== "invited";

  return (
    <div className="grid gap-4 py-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("userForm.fullName")}>
          <Input value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("userForm.username")}>
          <Input
            value={editing.username ?? ""}
            onChange={(e) => set("username", e.target.value)}
            placeholder={t("common:usersPlaceholders.exampleName")}
          />
        </Field>
        <Field label={t("userForm.email")}>
          <Input
            type="email"
            value={editing.email ?? ""}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label={t("userForm.phone")}>
          <Input value={editing.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("userForm.role")}>
          <Select
            value={editing.role}
            onValueChange={(v) => {
              const nextRequiresState = ["state_office_manager", "state_program_officer"].includes(v);
              const wasStateRole = ["state_office_manager", "state_program_officer"].includes(editing.role ?? "");
              setEditing({
                ...editing,
                role: v,
                stateId: nextRequiresState && wasStateRole ? editing.stateId : null,
                sector: v === "technical_coordinator" ? editing.sector ?? null : null,
              });
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{t(`roles.${r.value}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {requiresState ? (
          <Field label={t("userForm.assignedStateRequired")}>
            {stateReference.status === "ready" ? (
              <Select
                value={editing.stateId ? String(editing.stateId) : undefined}
                onValueChange={(v) => set("stateId", Number(v))}
                required
              >
                <SelectTrigger aria-required="true"><SelectValue placeholder={t("userForm.selectState")} /></SelectTrigger>
                <SelectContent>
                  {editing.stateId && !states.some((state) => state.id === editing.stateId) && editing.stateName ? (
                    <SelectItem value={String(editing.stateId)} disabled>
                      {i18n.language.startsWith("ar") ? editing.stateNameAr || editing.stateName : editing.stateName}
                    </SelectItem>
                  ) : null}
                  {states.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <StateReferenceStatus
                status={stateReference.status}
                loadingText={t("userForm.statesLoading")}
                errorText={t("userForm.statesError")}
                emptyText={t("userForm.statesEmpty")}
                retryText={t("userForm.statesRetry")}
                onRetry={() => { void stateReference.retry(); }}
              />
            )}
          </Field>
        ) : null}
        {editing.role === "technical_coordinator" ? (
          <Field label={t("userForm.assignedSector")}>
            <SectorMultiSelect
              value={editing.sector ?? ""}
              onChange={(v) => set("sector", v)}
            />
          </Field>
        ) : null}
        <Field label={t("userForm.language")}>
          <Select
            value={editing.languagePreference ?? "en"}
            onValueChange={(v) => set("languagePreference", v)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("english")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("userForm.accountStatus")}>
          <Select value={editing.status ?? "invited"} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {showPassword && (
        <div className="grid gap-3 sm:grid-cols-2 rounded-md border bg-muted/30 p-3">
          <Field label={t("userForm.passwordLabel")}>
            <Input
              type="password"
              value={editing.password ?? ""}
              onChange={(e) => set("password", e.target.value)}
              placeholder={t("userForm.passwordMin")}
            />
          </Field>
          <Field label={t("userForm.confirmPasswordLabel")}>
            <Input
              type="password"
              value={editing.confirmPassword ?? ""}
              onChange={(e) => set("confirmPassword", e.target.value)}
            />
          </Field>
        </div>
      )}
      {isCreate && editing.status === "invited" && (
        <p className="text-xs text-muted-foreground">
          {t("userForm.inviteNote")}
        </p>
      )}
    </div>
  );
}

// Chip-style multi-select for Technical Coordinator sector assignment.
// Value is the comma-separated string stored in users.sector.
function SectorMultiSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = useMemo(
    () => new Set(value.split(",").map((s) => s.trim()).filter(Boolean)),
    [value],
  );
  const toggle = (s: string) => {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s); else next.add(s);
    // Preserve canonical SECTORS order on serialization.
    onChange(SECTORS.filter((x) => next.has(x)).join(","));
  };
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2 min-h-[44px]">
      {SECTORS.map((s) => {
        const on = selected.has(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={
              "rounded-full border px-2.5 py-0.5 text-xs transition " +
              (on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-foreground hover:bg-accent")
            }
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function ResetPasswordDialog({
  user, onCancel, onSubmit, pending,
}: {
  user: UserRow | null;
  onCancel: () => void;
  onSubmit: (mode: "password" | "invite", password?: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation("users");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) { setPwd(""); setConfirm(""); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("resetPasswordDialog.title", { name: user?.name })}</DialogTitle>
          <DialogDescription>
            {t("resetPasswordDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label={t("resetPasswordDialog.newPassword")}>
            <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          </Field>
          <Field label={t("resetPasswordDialog.confirmPassword")}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel}>{t("resetPasswordDialog.cancel")}</Button>
          <Button
            variant="secondary"
            onClick={() => onSubmit("invite")}
            disabled={pending}
          >
            <Mail className="h-4 w-4" /> {t("resetPasswordDialog.sendInvite")}
          </Button>
          <Button
            onClick={() => {
              if (pwd.length < 8) { toast.error(t("resetPasswordDialog.passwordTooShort")); return; }
              if (pwd !== confirm) { toast.error(t("resetPasswordDialog.passwordsDoNotMatch")); return; }
              onSubmit("password", pwd);
              setPwd(""); setConfirm("");
            }}
            disabled={pending}
          >
            {t("resetPasswordDialog.setPassword")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailDeliveryBadge({ status, t }: { status: ResetToken["emailStatus"]; t: (key: string) => string }) {
  if (status === "sent") {
    return <Badge variant="approved" className="gap-1 text-xs"><CheckCheck className="h-3 w-3" />{t("passwordReset.emailStatus.sent")}</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="rejected" className="gap-1 text-xs"><AlertCircle className="h-3 w-3" />{t("passwordReset.emailStatus.failed")}</Badge>;
  }
  if (status === "pending") {
    return <Badge variant="returned" className="gap-1 text-xs"><Clock className="h-3 w-3" />{t("passwordReset.emailStatus.pending")}</Badge>;
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

type EffectiveModuleAction = {
  action: string;
  label: string;
  result: "allowed" | "denied" | "conditional";
  reasonCode: string;
  reason: string;
};

type EffectiveAccessData = {
  userId: number;
  displayName: string;
  email: string;
  role: string;
  roleLabel: string;
  scope: {
    orgWide: boolean;
    stateId: number | null;
    stateName: string | null;
    sectors: string[] | null;
    projectCount: number;
    projectAssignmentsExtendScope: boolean;
  };
  accountStatus: string;
  runtimeActive: boolean;
  modules: EffectiveModuleAccess[];
};

function ScopeRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0 text-sm">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium truncate" title={value}>{value}</span>
    </div>
  );
}

function ResultBadge({
  result,
  t,
}: {
  result: "allowed" | "denied" | "conditional";
  t: (k: string) => string;
}) {
  if (result === "allowed") {
    return (
      <Badge variant="approved" className="shrink-0 gap-1 text-[11px] whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        <span>{t("inspector.allowed")}</span>
      </Badge>
    );
  }
  if (result === "denied") {
    return (
      <Badge variant="rejected" className="shrink-0 gap-1 text-[11px] whitespace-nowrap">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        <span>{t("inspector.denied")}</span>
      </Badge>
    );
  }
  return (
    <Badge variant="returned" className="shrink-0 gap-1 text-[11px] whitespace-nowrap">
      <AlertCircle className="h-3 w-3" aria-hidden="true" />
      <span>{t("inspector.conditional")}</span>
    </Badge>
  );
}

function AccessInspectorSheet({
  user,
  onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("users");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");

  const userId = user?.id ?? 0;
  const { data, isLoading, isError, refetch } = useGetUserEffectiveAccess(userId, {
    query: {
      queryKey: getGetUserEffectiveAccessQueryKey(userId),
      enabled: !!user?.id,
      staleTime: 30_000,
    },
  });

  const access = data as unknown as EffectiveAccessData | undefined;

  const filteredModules = useMemo(() => {
    if (!access?.modules) return [];
    const lc = search.toLowerCase();
    return access.modules
      .filter((m) => moduleFilter === "all" || m.module === moduleFilter)
      .map((m) => ({
        ...m,
        actions: m.actions.filter(
          (a) => !lc || a.label.toLowerCase().includes(lc) || a.reason.toLowerCase().includes(lc),
        ),
      }))
      .filter((m) => m.actions.length > 0);
  }, [access, search, moduleFilter]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setSearch("");
      setModuleFilter("all");
      onClose();
    }
  }

  return (
    <Sheet open={!!user} onOpenChange={handleOpenChange}>
      <SheetContent
        className="w-full sm:max-w-2xl overflow-y-auto flex flex-col"
        side={i18n.dir() === "rtl" ? "left" : "right"}
        dir={i18n.dir()}
      >
        <SheetHeader className="pb-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("inspector.title")}
          </SheetTitle>
          <SheetDescription>{t("inspector.description")}</SheetDescription>
        </SheetHeader>

        {/* Loading */}
        {isLoading && (
          <div className="mt-6 space-y-3 px-1" aria-busy="true" aria-label={t("inspector.title")}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && !isLoading && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center px-4">
            <AlertCircle className="h-8 w-8 text-destructive/60" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("inspector.loadError")}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t("inspector.retry")}
            </Button>
          </div>
        )}

        {/* Content */}
        {access && (
          <div className="mt-4 space-y-4 pb-6 flex-1 overflow-y-auto">
            {/* Header card */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-base truncate">{access.displayName}</p>
                  <p className="text-sm text-muted-foreground truncate">{access.email}</p>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <RoleBadge
                    role={access.role}
                    label={t(`roles.${access.role}`, { defaultValue: access.roleLabel })}
                  />
                  <StatusBadge status={access.accountStatus} />
                </div>
              </div>

              {!access.runtimeActive && (
                <div className="flex items-center gap-2 text-sm text-warning rounded-md bg-warning/10 px-3 py-2" role="alert">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t("inspector.accountInactive", { status: access.accountStatus })}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ScopeRow
                  icon={Globe}
                  label={t("inspector.orgScope")}
                  value={access.scope.orgWide ? t("inspector.orgWide") : t("inspector.stateScoped")}
                />
                <ScopeRow
                  icon={MapPin}
                  label={t("inspector.stateScope")}
                  value={access.scope.stateName ?? t("inspector.notAssigned")}
                />
                <ScopeRow
                  icon={Building2}
                  label={t("inspector.sectorScope")}
                  value={
                    access.scope.sectors === null
                      ? t("inspector.noRestriction")
                      : access.scope.sectors.length === 0
                        ? t("inspector.notAssigned")
                        : access.scope.sectors.join(", ")
                  }
                />
                <ScopeRow
                  icon={FolderOpen}
                  label={t("inspector.projectScope")}
                  value={
                    access.scope.projectAssignmentsExtendScope
                      ? t("inspector.projectAssignmentsExtendScope", { count: access.scope.projectCount })
                      : t("inspector.projectCount", { count: access.scope.projectCount })
                  }
                />
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search
                  className="absolute start-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  className="ps-7 h-9 text-sm"
                  placeholder={t("inspector.searchActions")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("inspector.searchActionsLabel")}
                />
              </div>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger
                  className="h-9 sm:w-48 text-sm"
                  aria-label={t("inspector.filterModuleLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("inspector.allModules")}</SelectItem>
                  {access.modules.map((m) => (
                    <SelectItem key={m.module} value={m.module}>
                      {t(`inspector.modules.${m.module}`, { defaultValue: m.label })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Module sections */}
            {filteredModules.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("inspector.noResults")}
              </p>
            ) : (
              <div className="space-y-4">
                {filteredModules.map((mod) => (
                  <section key={mod.module} aria-labelledby={`inspector-mod-${mod.module}`}>
                    <h3
                      id={`inspector-mod-${mod.module}`}
                      className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {t(`inspector.modules.${mod.module}`, { defaultValue: mod.label })}
                    </h3>
                    <div className="rounded-md border divide-y overflow-hidden">
                      {mod.actions.map((act) => (
                        <div
                          key={act.action}
                          className="flex items-start gap-3 px-3 py-2.5 bg-card"
                        >
                          <ResultBadge result={act.result} t={t} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight">
                              {t(`inspector.actions.${act.action}`, { defaultValue: act.label })}
                            </p>
                            <p
                              className="text-xs text-muted-foreground mt-0.5 leading-snug"
                            >
                              {t(`inspector.reasonCodes.${act.reasonCode}`, { defaultValue: act.reason })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

type EffectiveModuleAccess = {
  module: string;
  label: string;
  actions: EffectiveModuleAction[];
};
