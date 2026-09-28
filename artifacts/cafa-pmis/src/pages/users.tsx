import { useState, useMemo, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
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
import {
  Alert, Button, Card, Chip, Drawer, Dropdown, Header, Input, Label, Modal, SearchField, Separator, Skeleton, Spinner,
  Tabs, TextArea, Tooltip,
} from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { ErrorState } from "@/components/ui/error-state";
import {
  Plus,
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
  Globe,
  MapPin,
  Building2,
  FolderOpen,
  CircleOff,
  CircleFill,
} from "@/components/icons";
import type { IconComponent } from "@/components/icons";
import { formatDate, formatDateTime, hasPerm } from "@/lib/format";
import { SECTORS } from "@/lib/sectors";
import { localizeUserApiError } from "@/lib/user-error-localization";
import { StateLabel } from "@/components/state-label";
import { StateReferenceStatus } from "@/components/state-reference-status";
import { deriveStateReferenceData, type StateReferenceData } from "@/lib/state-reference-data";
import { useSocket } from "@/lib/socket";
import { SelectField } from "@/components/select-field";
import { FilterKpi } from "@/components/filter-kpi";
import { ConfirmModal } from "@/components/confirm-modal";
import { RegistryPagination } from "@/components/registry-pagination";

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
    <div className="mt-4 space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--default)] p-3 text-sm" aria-live="polite">
      <p className="mb-2 text-xs font-medium text-[var(--muted)]">{t("diagnostics.title")}</p>
      {steps.map((s) => (
        <div key={s.key} className="flex items-center gap-2">
          {s.status === "loading" && <Spinner size="sm" className="size-3.5 shrink-0" aria-hidden="true" />}
          {s.status === "pass"    && <CheckCheck className="size-3.5 shrink-0 text-[var(--success)]" aria-hidden="true" />}
          {s.status === "fail"    && <XCircle    className="size-3.5 shrink-0 text-[var(--danger)]" aria-hidden="true" />}
          {s.status === "idle"    && <span className="size-3.5 shrink-0 rounded-full border border-[var(--border)]" aria-hidden="true" />}
          <span className={
            s.status === "pass" ? "text-[var(--success)]" :
            s.status === "fail" ? "font-medium text-[var(--danger)]" :
            s.status === "loading" ? "text-[var(--accent)]" :
            "text-[var(--muted)]"
          }>{t(s.labelKey)}</span>
        </div>
      ))}
      {mode === "error" && errorMessage && (
        <Alert status="danger" className="mt-2">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{errorMessage}</Alert.Description></Alert.Content>
        </Alert>
      )}
      {mode === "success" && (
        <Alert status="success" className="mt-2">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{t("diagnostics.allPassed")}</Alert.Description></Alert.Content>
        </Alert>
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
type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

const STATUS_COLOR: Record<Status, ChipColor> = {
  active:      "success",
  invited:     "accent",
  suspended:   "warning",
  inactive:    "default",
  deactivated: "danger",
};

const PAGE_SIZE = 25;

/** Sectors are stored comma-separated; show them as a readable list. */
const sectorList = (sector?: string | null) => (sector ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("users");
  const s = (STATUSES as readonly string[]).includes(status) ? (status as Status) : "inactive";
  return <Chip size="sm" variant="soft" color={STATUS_COLOR[s]}>{t(`status.${s}`)}</Chip>;
}

function RoleBadge({ role, label }: { role: string; label?: string | null }) {
  const { t } = useTranslation("users");
  const def = ROLES.find((r) => r.value === role);
  // The API's roleLabel is English; the translated role always wins.
  return (
    <Chip size="sm" variant="soft" color={def?.scope === "state" ? "success" : "accent"} className="max-w-full">
      <span className="truncate">{t(`roles.${role}`, { defaultValue: label ?? role })}</span>
    </Chip>
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
    <span className="flex min-w-0 max-w-full items-center gap-1.5 text-xs" aria-label={label}>
      {isOnline
        ? <CircleFill className="size-2.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
        : <CircleOff className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />}
      <span className={`truncate ${isOnline ? "text-[var(--success)]" : "text-[var(--muted)]"}`} title={label}>{label}</span>
    </span>
  );
}

/** Icon + label row for a Dropdown item. */
function MenuLabel({ icon: Icon, label, tone }: { icon: IconComponent; label: string; tone?: string }) {
  return (
    <>
      <Icon className={`size-4 shrink-0 ${tone ?? "text-[var(--muted)]"}`} aria-hidden="true" />
      <Label>{label}</Label>
    </>
  );
}

type MenuEntry = { id: string; label: string; icon: IconComponent; tone?: string; danger?: boolean; run: () => void };

/** Row action menu: groups are separated; the header names the menu. */
function RowMenu({ label, header, groups }: { label: string; header: string; groups: MenuEntry[][] }) {
  const visible = groups.filter((group) => group.length > 0);
  const all = visible.flat();
  return (
    <Dropdown>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label}>
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-52">
        <Dropdown.Menu onAction={(key) => all.find((entry) => entry.id === key)?.run()}>
          {visible.map((group, index) => (
            <Dropdown.Section key={group[0].id}>
              {index === 0 && <Header>{header}</Header>}
              {index > 0 && <Separator />}
              {group.map((entry) => (
                <Dropdown.Item key={entry.id} id={entry.id} textValue={entry.label} variant={entry.danger ? "danger" : undefined}>
                  <MenuLabel icon={entry.icon} label={entry.label} tone={entry.danger ? "text-[var(--danger)]" : entry.tone} />
                </Dropdown.Item>
              ))}
            </Dropdown.Section>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/** Offset-paged footer shared by the three registries. */
function OffsetPagination({
  offset, total, onOffsetChange, summary,
}: { offset: number; total: number; onOffsetChange: (offset: number) => void; summary: string }) {
  const { t } = useTranslation("users");
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <RegistryPagination
      className="px-4 py-3"
      page={page}
      totalPages={totalPages}
      onPageChange={(next) => onOffsetChange((next - 1) * PAGE_SIZE)}
      summary={summary}
      labels={{
        region: t("pagination.region"),
        first: t("pagination.first"),
        previous: t("pagination.previous"),
        next: t("pagination.next"),
        last: t("pagination.last"),
        pageOf: t("pagination.pageOf", { page, totalPages }),
      }}
    />
  );
}

function EmptyRegistry({ icon: Icon, message, hint, action }: { icon: IconComponent; message: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-[var(--muted)]">
      <Icon className="size-8 opacity-40" aria-hidden="true" />
      <p className="text-sm font-medium">{message}</p>
      {hint && <p className="text-xs">{hint}</p>}
      {action}
    </div>
  );
}

function RegistrySkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
    </div>
  );
}

/** A pressable count chip used by the "by role" and "by State" breakdowns. */
function CountToggle({ label, count, pressed, onPress }: { label: string; count: number; pressed: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
        pressed
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--default)]"
      }`}
    >
      <span className="min-w-0 truncate" title={label}>{label}</span>
      <span className={`shrink-0 rounded-full px-1.5 font-medium tabular-nums ${pressed ? "bg-white/20" : "bg-[var(--default)]"}`}>{count}</span>
    </button>
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
type UsersTab = "all" | "resets" | "invitations";

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
  const pageSize = PAGE_SIZE;

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
  }, [q, role, status, stateId, sector, offset, pageSize]);

  const { data: usersPage, isLoading, isError, refetch } = useListUsers(queryParams);
  const users = useMemo(() => usersPage?.items ?? [], [usersPage]);
  const hasFilters = Boolean(q || role || status || stateId || sector);
  const { data: summary } = useGetUsersSummary();
  const statesQuery = useListStates();
  const stateReference = deriveStateReferenceData(statesQuery);
  const [activeTab, setActiveTab] = useState<UsersTab>("all");

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
      languagePreference: i18n.language?.startsWith("ar") ? "ar" : "en",
      password: "",
      confirmPassword: "",
    });
    setFormOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing({ ...u });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setDiagMode("idle");
    setDiagStep(undefined);
    setDiagError(undefined);
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
        setTimeout(closeForm, 1200);
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
        closeForm();
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

  const clearFilters = () => { setQ(""); setRole(""); setStatus(""); setStateId(""); setSector(""); setOffset(0); };
  const toggleStatus = (next: Status) => { setStatus(status === next ? "" : next); setOffset(0); };

  // Dashboard cards
  const total = summary?.total ?? 0;
  const active = summary?.byStatus.find((s) => s.status === "active")?.n ?? 0;
  const invited = summary?.byStatus.find((s) => s.status === "invited")?.n ?? 0;
  const suspended = summary?.byStatus.find((s) => s.status === "suspended")?.n ?? 0;

  const userMenu = (u: UserRow): MenuEntry[][] => [
    [
      { id: "edit", label: t("actions.edit"), icon: Pencil, run: () => openEdit(u) },
      { id: "access", label: t("inspector.menuItem"), icon: ShieldCheck, tone: "text-[var(--accent)]", run: () => setInspectorFor(u) },
      { id: "reset", label: t("actions.resetPassword"), icon: KeyRound, run: () => setResetFor(u) },
      ...(u.status === "invited" ? [
        { id: "resend-invite", label: t("actions.resendInvite"), icon: Mail, tone: "text-[var(--accent)]", run: () => { void resendInvite(u); } },
        { id: "cancel-invite", label: t("actions.cancelInvite"), icon: XCircle, tone: "text-[var(--warning)]", run: () => { void cancelInvite(u); } },
      ] : []),
      ...(!u.emailVerified && u.status === "active" ? [
        { id: "resend-verification", label: t("actions.resendVerification"), icon: ShieldCheck, tone: "text-[var(--success)]", run: () => { void resendVerification(u); } },
      ] : []),
    ],
    [
      ...(u.status !== "active" ? [{ id: "activate", label: t("actions.activate"), icon: CheckCircle2, tone: "text-[var(--success)]", run: () => { void changeStatus(u, "active"); } }] : []),
      ...(u.status !== "suspended" ? [{ id: "suspend", label: t("actions.suspend"), icon: PauseCircle, tone: "text-[var(--warning)]", run: () => { void changeStatus(u, "suspended"); } }] : []),
      ...(u.status !== "deactivated" ? [{ id: "deactivate", label: t("actions.deactivate"), icon: XCircle, tone: "text-[var(--danger)]", run: () => setDeactivateFor(u) }] : []),
    ],
    [{ id: "delete", label: t("actions.delete"), icon: Trash2, danger: true, run: () => setDeleteFor(u) }],
  ];

  // The registry fits a laptop screen: username and email sit under the name,
  // the sector under the State, verification under the account status, and
  // the last login under presence.
  const columns: DataGridColumn<UserRow>[] = [
    { id: "name", header: t("fields.name"), isRowHeader: true, width: 250, pinned: "start", headerClassName: "w-[250px]",
      cell: (u) => (
        <div className="min-w-0">
          <p dir="auto" className="truncate text-sm font-medium text-page-start" title={u.name}>{u.name}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]" title={u.email ?? undefined}>
            <bdi dir="ltr">{u.email ?? "—"}</bdi>
          </p>
          {u.username && <p className="truncate font-mono text-[11px] text-[var(--muted)]"><bdi dir="ltr">@{u.username}</bdi></p>}
        </div>
      ) },
    { id: "role", header: t("table.role"), width: 176, headerClassName: "w-[176px]",
      cell: (u) => <RoleBadge role={u.role} label={u.roleLabel} /> },
    { id: "scope", header: t("table.state"), width: 150, headerClassName: "w-[150px]",
      cell: (u) => (
        <div className="min-w-0 text-sm">
          <p className="truncate">{u.stateId ? getLinkedStateLabel(u, i18n.language) : "—"}</p>
          {u.sector && <p className="mt-0.5 truncate text-xs text-[var(--muted)]" title={sectorList(u.sector)}>{sectorList(u.sector)}</p>}
        </div>
      ) },
    { id: "status", header: t("statusHeader"), width: 124, headerClassName: "w-[124px]",
      cell: (u) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={u.status ?? "active"} />
          {u.emailVerified ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--success)]"
              title={u.emailVerifiedAt ? t("verifiedOn", { date: formatDate(u.emailVerifiedAt) }) : t("verified")}>
              <ShieldCheck className="size-3" aria-hidden="true" />{t("verified")}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--muted)]">{t("unverified")}</span>
          )}
        </div>
      ) },
    { id: "presence", header: t("presence.header"), width: 170, headerClassName: "w-[170px]",
      cell: (u) => (
        <div className="min-w-0">
          <PresenceValue isOnline={u.isOnline === true} lastSeenAt={u.lastSeenAt} />
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
            {t("fields.lastLogin")}: {u.lastLoginAt ? <bdi dir="ltr">{formatDate(u.lastLoginAt)}</bdi> : t("table.never")}
          </p>
        </div>
      ) },
    { id: "created", header: t("fields.createdAt"), width: 100, headerClassName: "w-[100px]",
      cell: (u) => <span className="whitespace-nowrap text-xs text-[var(--muted)]"><bdi dir="ltr">{formatDate(u.createdAt)}</bdi></span> },
    { id: "actions", header: <span className="sr-only">{t("actionsLabel")}</span>, width: 56, pinned: "end", headerClassName: "w-[56px]",
      cell: (u) => canManage ? (
        <RowMenu label={t("ariaLabel.actionsFor", { name: u.name })} header={t("actionsLabel")} groups={userMenu(u)} />
      ) : null },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><UsersIcon className="size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />{t("title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("subtitle")} {canManage ? "" : t("subtitleReadOnly")}
          </p>
        </div>
        {canManage && activeTab === "all" && (
          <Button onPress={openCreate} className="w-full sm:w-auto">
            <Plus className="size-4" aria-hidden="true" />
            {t("newUser")}
          </Button>
        )}
      </header>

      <Tabs selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(key as UsersTab)}>
        <Tabs.ListContainer className="w-fit max-w-full">
          <Tabs.List aria-label={t("title")}>
            <Tabs.Tab id="all" className="gap-1.5 whitespace-nowrap"><UsersIcon className="size-4" aria-hidden="true" />{t("tabs.allUsers")}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="resets" className="gap-1.5 whitespace-nowrap"><KeyRound className="size-4" aria-hidden="true" />{t("tabs.passwordResets")}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="invitations" className="gap-1.5 whitespace-nowrap"><Mail className="size-4" aria-hidden="true" />{t("tabs.invitations")}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="all" className="space-y-4 pt-4">
          {/* Summary: each KPI filters the registry and clears on a second press. */}
          <section className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4" aria-label={t("stats.totalUsers")}>
            <FilterKpi icon={UsersIcon} label={t("stats.totalUsers")} value={total} pressed={!hasFilters} onToggle={clearFilters} />
            <FilterKpi icon={CheckCircle2} status="success" label={t("stats.active")} value={active} pressed={status === "active"} onToggle={() => toggleStatus("active")} />
            <FilterKpi icon={Mail} label={t("stats.invited")} value={invited} pressed={status === "invited"} onToggle={() => toggleStatus("invited")} />
            <FilterKpi icon={PauseCircle} status="warning" label={t("stats.suspended")} value={suspended} pressed={status === "suspended"} onToggle={() => toggleStatus("suspended")} />
          </section>

          {summary && (summary.byRole.length > 0 || summary.byState.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="min-w-0">
                <Card.Header>
                  <Card.Title className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-[var(--muted)]" aria-hidden="true" />{t("usersByRole")}</Card.Title>
                </Card.Header>
                <Card.Content className="flex min-w-0 flex-row flex-wrap items-start gap-1.5">
                  {summary.byRole.map((r) => (
                    <CountToggle key={r.role} label={t(`roles.${r.role}`, { defaultValue: r.label })} count={r.n}
                      pressed={role === r.role} onPress={() => { setRole(role === r.role ? "" : r.role); setOffset(0); }} />
                  ))}
                </Card.Content>
              </Card>
              <Card className="min-w-0">
                <Card.Header>
                  <Card.Title className="flex items-center gap-2 text-sm font-medium"><MapPin className="size-4 text-[var(--muted)]" aria-hidden="true" />{t("usersByState")}</Card.Title>
                </Card.Header>
                <Card.Content className="flex min-w-0 flex-row flex-wrap items-start gap-1.5">
                  {summary.byState.map((s) => (
                    <CountToggle key={s.stateId} label={getLinkedStateLabel(s, i18n.language)} count={s.n}
                      pressed={stateId === String(s.stateId)} onPress={() => { setStateId(stateId === String(s.stateId) ? "" : String(s.stateId)); setOffset(0); }} />
                  ))}
                </Card.Content>
              </Card>
            </div>
          )}

          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 lg:flex-row lg:items-center">
              <SearchField aria-label={t("searchPlaceholder")} value={q} onChange={(value) => { setQ(value); setOffset(0); }} className="w-full lg:max-w-xs">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t("searchPlaceholder")} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <SelectField
                  aria-label={t("table.role")}
                  value={role || "all"}
                  onChange={(v) => { setRole(v === "all" ? "" : v); setOffset(0); }}
                  triggerClassName="whitespace-nowrap sm:w-48"
                  options={[{ value: "all", label: t("allRoles") }, ...ROLES.map((r) => ({ value: r.value, label: t(`roles.${r.value}`) }))]}
                />
                <SelectField
                  aria-label={t("statusHeader")}
                  value={status || "all"}
                  onChange={(v) => { setStatus(v === "all" ? "" : v); setOffset(0); }}
                  triggerClassName="whitespace-nowrap sm:w-36"
                  options={[{ value: "all", label: t("allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]}
                />
                <SelectField
                  aria-label={t("table.state")}
                  value={stateId || "all"}
                  onChange={(v) => { setStateId(v === "all" ? "" : v); setOffset(0); }}
                  triggerClassName="whitespace-nowrap sm:w-40"
                  options={[{ value: "all", label: t("allStates") }, ...stateReference.states.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))]}
                />
                <SelectField
                  aria-label={t("table.sector")}
                  value={sector || "all"}
                  onChange={(v) => { setSector(v === "all" ? "" : v); setOffset(0); }}
                  triggerClassName="whitespace-nowrap sm:w-44"
                  options={[{ value: "all", label: t("allSectors") }, ...SECTORS.map((item) => ({ value: item, label: item }))]}
                />
                {hasFilters && (
                  <Button variant="ghost" size="sm" onPress={clearFilters}>
                    <FilterX className="size-4" aria-hidden="true" /> {t("clear")}
                  </Button>
                )}
              </div>
            </div>
            {isLoading ? (
              <RegistrySkeleton />
            ) : isError ? (
              <div className="p-4"><ErrorState compact variant="server" title={t("couldNotLoadUsers")} onRetry={() => refetch()} /></div>
            ) : (
              <div role="region" aria-label={t("ariaLabel.usersTable")}>
                <DataGrid
                  aria-label={t("ariaLabel.usersTable")}
                  data={users as UserRow[]}
                  columns={columns}
                  getRowId={(u) => u.id}
                  contentClassName="min-w-[1026px] table-fixed"
                  verticalAlign="middle"
                  renderEmptyState={() => (
                    <EmptyRegistry icon={UsersIcon} message={hasFilters ? t("noUsersFilters") : t("noUsers")}
                      hint={!hasFilters && canManage ? t("clickNewUser") : undefined} />
                  )}
                />
              </div>
            )}
            {!isLoading && !isError && usersPage && (
              <div className="border-t border-[var(--border)]">
                <OffsetPagination
                  offset={offset}
                  total={usersPage.total}
                  onOffsetChange={setOffset}
                  summary={t("pagination.showing", { from: usersPage.total ? usersPage.offset + 1 : 0, to: usersPage.offset + users.length, total: usersPage.total })}
                />
              </div>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="resets" className="pt-4">
          <PasswordResetRequestsTab
            canManage={["super_admin", "executive_director", "program_manager"].includes(me?.user?.role ?? "")}
          />
        </Tabs.Panel>

        <Tabs.Panel id="invitations" className="pt-4">
          <InvitationsTab canManage={canManage} />
        </Tabs.Panel>
      </Tabs>

      {/* Create / Edit dialog */}
      <Modal isOpen={formOpen} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <Modal.Backdrop isDismissable={!createMut.isPending && !updateMut.isPending}>
          <Modal.Container size="lg" scroll="inside">
            <Modal.Dialog className="max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{editing?.id ? t("form.editTitle") : t("form.createTitle")}</Modal.Heading>
                <p className="text-sm text-[var(--muted)]">{editing?.id ? t("dialog.editDesc") : t("dialog.createDesc")}</p>
              </Modal.Header>
              <Modal.Body>
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
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={closeForm}>{t("common:cancel")}</Button>
                <Button
                  onPress={() => { void submitForm(); }}
                  isPending={createMut.isPending || updateMut.isPending}
                  isDisabled={
                    !!editing && ["state_office_manager", "state_program_officer"].includes(editing.role ?? "")
                      && (!stateReference.isReady || !editing.stateId)
                  }
                >
                  {editing?.id ? t("form.saveChanges") : t("form.createUser")}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Reset password dialog */}
      <ResetPasswordDialog
        user={resetFor}
        onCancel={() => setResetFor(null)}
        onSubmit={performReset}
        pending={resetMut.isPending}
      />

      {/* Invite link dialog */}
      <InviteLinkModal
        link={inviteLink}
        onClose={() => setInviteLink(null)}
        title={t("dialog.inviteLinkTitle")}
        description={<p>{t("dialog.inviteLinkDesc")}</p>}
        copiedMessage={t("messages.inviteLinkCopied")}
        manualMessage={t("messages.inviteLinkCopyManual")}
        closeLabel={t("done")}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteFor}
        title={t("deleteDialog.title", { name: deleteFor?.name ?? "" })}
        message={t("dialog.deleteDesc")}
        cancelLabel={t("common:cancel")}
        confirmLabel={t("actions.delete")}
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteFor(null)}
        onConfirm={() => { void performDelete(); }}
      />

      <ConfirmModal
        isOpen={!!deactivateFor}
        title={t("deactivateDialog.title", { name: deactivateFor?.name })}
        message={t("deactivateDialog.description")}
        cancelLabel={t("common:cancel")}
        confirmLabel={t("actions.deactivate")}
        onCancel={() => setDeactivateFor(null)}
        onConfirm={() => {
          if (deactivateFor) void changeStatus(deactivateFor, "deactivated");
          setDeactivateFor(null);
        }}
      />

      {/* Access & Permissions Inspector */}
      <AccessInspectorDrawer
        user={inspectorFor}
        onClose={() => setInspectorFor(null)}
      />
    </div>
  );
}

/** Shows a one-time invite or reset link with a copy action. */
function InviteLinkModal({
  link, onClose, title, description, copiedMessage, manualMessage, closeLabel, copyLabel,
}: {
  link: string | null;
  onClose: () => void;
  title: string;
  description: ReactNode;
  copiedMessage: string;
  manualMessage: string;
  closeLabel: string;
  copyLabel?: string;
}) {
  const { t } = useTranslation("users");
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(copiedMessage);
    } catch {
      // clipboard blocked — the field stays selectable for a manual copy
      toast.info(manualMessage);
    }
  };
  return (
    <Modal isOpen={!!link} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
              <div className="space-y-2 text-sm text-[var(--muted)]">{description}</div>
            </Modal.Header>
            <Modal.Body>
              <div className="flex items-center gap-2">
                <Input aria-label={title} value={link ?? ""} readOnly fullWidth dir="ltr" className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
                {!copyLabel && (
                  <Tooltip delay={300}>
                    <Button isIconOnly variant="tertiary" aria-label={t("invites.linkDialog.copyLink")} onPress={() => { void copy(); }}>
                      <Copy className="size-4" aria-hidden="true" />
                    </Button>
                    <Tooltip.Content>{t("invites.linkDialog.copyLink")}</Tooltip.Content>
                  </Tooltip>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              {copyLabel && (
                <Button variant="tertiary" onPress={() => { void copy(); }}>
                  <Copy className="size-4" aria-hidden="true" /> {copyLabel}
                </Button>
              )}
              <Button onPress={onClose}>{closeLabel}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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

function resetStatusColor(status: ResetToken["status"]): ChipColor {
  switch (status) {
    case "active": return "accent";
    case "used": return "success";
    case "expired": return "danger";
    case "revoked": return "default";
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

/** Person cell shared by the reset and invitation registries. */
function PersonCell({ name, email }: { name: string; email: string }) {
  return (
    <div className="min-w-0">
      <p dir="auto" className="truncate text-sm font-medium text-page-start" title={name}>{name}</p>
      <p className="truncate text-xs text-[var(--muted)]" title={email}><bdi dir="ltr">{email}</bdi></p>
    </div>
  );
}

function PasswordResetRequestsTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation("users");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [offset, setOffset] = useState(0);
  const pageSize = PAGE_SIZE;

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (search.trim()) p.search = search.trim();
    if (filterStatus !== "all") p.status = filterStatus;
    if (filterSource !== "all") p.source = filterSource;
    p.limit = String(pageSize);
    p.offset = String(offset);
    return p;
  }, [search, filterStatus, filterSource, offset, pageSize]);

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
    const body = await res.json().catch(() => ({}));
    // Server error codes go through the same localisation as the rest of the page.
    if (!res.ok) { toast.error(body.error ? localizeUserApiError(t, body.error) : t("passwordReset.actionFailed")); return; }
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

  const resetPage = () => setOffset(0);

  const columns: DataGridColumn<ResetToken>[] = [
    { id: "user", header: t("passwordReset.tableHeaders.user"), isRowHeader: true, width: 240, headerClassName: "w-[240px]",
      cell: (tok) => <PersonCell name={tok.userName} email={tok.userEmail} /> },
    { id: "source", header: t("passwordReset.tableHeaders.source"), width: 150, headerClassName: "w-[150px]",
      cell: (tok) => (
        <Chip size="sm" variant="tertiary">
          {tok.source === "forgot_password" ? t("passwordReset.source.selfService") : t("passwordReset.source.adminReset")}
        </Chip>
      ) },
    { id: "requested", header: t("passwordReset.tableHeaders.requestedAt"), width: 150, headerClassName: "w-[150px]",
      cell: (tok) => <span className="whitespace-nowrap text-xs text-[var(--muted)]"><bdi dir="ltr">{formatDateTime(tok.requestedAt)}</bdi></span> },
    { id: "lifecycle", header: t("passwordReset.tableHeaders.expiryResolution"), width: 150, headerClassName: "w-[150px]",
      cell: (tok) => resetLifecycleValue(tok) ? (
        <span className={`whitespace-nowrap text-xs ${tok.status === "expired" ? "font-medium text-[var(--danger)]" : "text-[var(--muted)]"}`}>
          <bdi dir="ltr">{formatDateTime(resetLifecycleValue(tok)!)}</bdi>
        </span>
      ) : <span className="text-[var(--muted)]">—</span> },
    { id: "status", header: t("passwordReset.tableHeaders.status"), width: 110, headerClassName: "w-[110px]",
      cell: (tok) => <Chip size="sm" variant="soft" color={resetStatusColor(tok.status)}>{resetStatusLabel(tok.status, t)}</Chip> },
    { id: "email", header: t("passwordReset.tableHeaders.emailDelivery"), width: 130, headerClassName: "w-[130px]",
      cell: (tok) => <EmailDeliveryBadge status={tok.emailStatus} t={t} /> },
    ...(canManage ? [{
      id: "actions", header: <span className="sr-only">{t("passwordReset.actions.label")}</span>, width: 56, pinned: "end" as const, headerClassName: "w-[56px]",
      cell: (tok: ResetToken) => (
        <RowMenu label={t("ariaLabel.actionsForReset")} header={t("passwordReset.actions.label")} groups={[[
          { id: "resend", label: t("passwordReset.actions.resend"), icon: Send, tone: "text-[var(--accent)]", run: () => { void doAction(tok.id, "resend"); } },
          ...(tok.status === "active" ? [{ id: "cancel", label: t("passwordReset.actions.cancel"), icon: Ban, tone: "text-[var(--warning)]", run: () => { void doAction(tok.id, "cancel"); } }] : []),
          ...(!tok.resolvedAt ? [{ id: "resolve", label: t("passwordReset.actions.resolve"), icon: CheckCheck, tone: "text-[var(--success)]", run: () => { void doAction(tok.id, "resolve"); } }] : []),
        ]]} />
      ),
    }] : []),
  ];

  return (
    <div className="space-y-4">
      {summary && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label={t("passwordReset.statLabels.total")}>
          <FilterKpi icon={KeyRound} label={t("passwordReset.statLabels.total")} value={summary.total} />
          <FilterKpi icon={Clock} label={t("passwordReset.statLabels.pending")} value={summary.active} />
          <FilterKpi icon={CheckCheck} status="success" label={t("passwordReset.statLabels.used")} value={summary.used} />
          <FilterKpi icon={AlertCircle} status="danger" label={t("passwordReset.statLabels.expired")} value={summary.expired} />
          <FilterKpi icon={Ban} status="warning" label={t("passwordReset.statLabels.cancelled")} value={summary.revoked} />
        </section>
      )}

      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-2.5 border-b border-[var(--border)] p-4 md:grid-cols-[minmax(0,2fr)_minmax(11rem,1fr)_minmax(11rem,1fr)]">
          <SearchField aria-label={t("passwordReset.searchPlaceholder")} value={search} onChange={(value) => { setSearch(value); resetPage(); }}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("passwordReset.searchPlaceholder")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <SelectField
            aria-label={t("passwordReset.filterStatus.label")}
            value={filterStatus}
            onChange={(value) => { setFilterStatus(value); resetPage(); }}
            options={[
              { value: "all", label: t("passwordReset.filterStatus.allStatuses") },
              { value: "active", label: t("passwordReset.filterStatus.pending") },
              { value: "used", label: t("passwordReset.filterStatus.used") },
              { value: "expired", label: t("passwordReset.filterStatus.expired") },
              { value: "revoked", label: t("passwordReset.filterStatus.cancelled") },
            ]}
          />
          <SelectField
            aria-label={t("passwordReset.filterSource.label")}
            value={filterSource}
            onChange={(value) => { setFilterSource(value); resetPage(); }}
            options={[
              { value: "all", label: t("passwordReset.filterSource.allSources") },
              { value: "forgot_password", label: t("passwordReset.filterSource.forgotPassword") },
              { value: "admin_reset", label: t("passwordReset.filterSource.adminReset") },
            ]}
          />
        </div>
        {isLoading ? (
          <RegistrySkeleton rows={5} />
        ) : isError ? (
          <div className="p-4">
            <ErrorState
              compact
              variant="server"
              title={t("passwordReset.loadFailed.title")}
              description={t("passwordReset.loadFailed.description")}
              retryLabel={t("passwordReset.loadFailed.retry")}
              onRetry={() => refetch()}
            />
          </div>
        ) : (
          <div role="region" tabIndex={0} aria-label={t("ariaLabel.passwordResetsTable")}>
            <DataGrid
              aria-label={t("ariaLabel.passwordResetsTable")}
              data={tokens}
              columns={columns}
              getRowId={(tok) => tok.id}
              contentClassName={`${canManage ? "min-w-[986px]" : "min-w-[930px]"} table-fixed`}
              verticalAlign="middle"
              renderEmptyState={() => <EmptyRegistry icon={FilterX} message={hasFilters ? t("passwordReset.noResults") : t("passwordReset.noRecords")} />}
            />
          </div>
        )}
        {data && !isError && (
          <div className="border-t border-[var(--border)]">
            <OffsetPagination
              offset={offset}
              total={data.total}
              onOffsetChange={setOffset}
              summary={t("passwordReset.showing", { count: tokens.length, total: data.total })}
            />
          </div>
        )}
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

const INVITE_STATUS_COLOR: Record<ReturnType<typeof inviteStatus>, ChipColor> = {
  accepted: "success", cancelled: "default", expired: "danger", pending: "accent",
};

function InviteStatusBadge({ row }: { row: InvitationRow }) {
  const { t } = useTranslation("users");
  const s = inviteStatus(row);
  return <Chip size="sm" variant="soft" color={INVITE_STATUS_COLOR[s]}>{t(`invites.statusBadge.${s}`)}</Chip>;
}

function DeliveryChip({ status, label }: { status: "pending" | "sent" | "failed"; label: string }) {
  const Icon = status === "sent" ? CheckCheck : status === "failed" ? AlertCircle : Clock;
  return (
    <Chip size="sm" variant="soft" color={status === "sent" ? "success" : status === "failed" ? "danger" : "warning"} className="whitespace-nowrap">
      <Icon className="size-3" aria-hidden="true" />{label}
    </Chip>
  );
}

function InviteEmailStatusBadge({ status }: { status: InvitationRow["inviteEmailStatus"] }) {
  const { t } = useTranslation("users");
  if (status === "sent") return <DeliveryChip status="sent" label={t("invites.emailStatusBadge.sent")} />;
  if (status === "failed") return <DeliveryChip status="failed" label={t("invites.emailStatusBadge.failed")} />;
  return <DeliveryChip status="pending" label={t("invites.emailStatusBadge.pending")} />;
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

  const invitations = (data?.invitations ?? []) as InvitationRow[];

  // Build invite link — standardised on /invite/:token (also registered as /accept-invitation)
  const buildInviteLink = useCallback((token: string) =>
    `${window.location.origin}/invite/${encodeURIComponent(token)}`, []);

  const inviteLink = inviteLinkFor ? buildInviteLink(inviteLinkFor.token) : null;

  const columns: DataGridColumn<InvitationRow>[] = [
    { id: "user", header: t("invites.tableHeaders.user"), isRowHeader: true, width: 230, pinned: "start", headerClassName: "w-[230px]",
      cell: (row) => <PersonCell name={row.name} email={row.email} /> },
    { id: "role", header: t("invites.tableHeaders.role"), width: 170, headerClassName: "w-[170px]",
      cell: (row) => (
        <div className="min-w-0 text-sm">
          <p className="truncate">{t(`roles.${row.role}`, { defaultValue: row.role })}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
            {row.stateName ? getLinkedStateLabel(row, i18n.language) : sectorList(row.sector) || "—"}
          </p>
        </div>
      ) },
    { id: "invited", header: t("invites.tableHeaders.invitedAt"), width: 150, headerClassName: "w-[150px]",
      cell: (row) => (
        <div className="min-w-0 text-xs text-[var(--muted)]">
          <p className="whitespace-nowrap"><bdi dir="ltr">{formatDateTime(row.invitedAt)}</bdi></p>
          {row.invitedByName && <p dir="auto" className="mt-0.5 truncate text-page-start" title={row.invitedByName}>{row.invitedByName}</p>}
        </div>
      ) },
    { id: "expiry", header: t("invites.tableHeaders.tokenExpiry"), width: 190, headerClassName: "w-[190px]",
      cell: (row) => {
        const s = inviteStatus(row);
        return (
          <span className="text-xs">
            {s === "accepted" && row.inviteAcceptedAt ? (
              <span className="font-medium text-[var(--success)]">{t("invites.lifecycle.accepted", { date: `⁦${formatDateTime(row.inviteAcceptedAt)}⁩` })}</span>
            ) : row.inviteExpiresAt ? (
              <span className={s === "expired" ? "font-medium text-[var(--danger)]" : "text-[var(--muted)]"}>
                {t("invites.lifecycle.expires", { date: `⁦${formatDateTime(row.inviteExpiresAt)}⁩` })}
              </span>
            ) : <span className="text-[var(--muted)]">{t("invites.lifecycle.unavailable")}</span>}
          </span>
        );
      } },
    { id: "status", header: t("invites.tableHeaders.status"), width: 160, headerClassName: "w-[160px]",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <InviteStatusBadge row={row} />
          <InviteEmailStatusBadge status={row.inviteEmailStatus ?? "pending"} />
        </div>
      ) },
    ...(canManage ? [{
      id: "actions", header: <span className="sr-only">{t("invites.dropdownActions.label")}</span>, width: 56, pinned: "end" as const, headerClassName: "w-[56px]",
      cell: (row: InvitationRow) => {
        const s = inviteStatus(row);
        if (s === "accepted") return <span className="text-[var(--muted)]" aria-label={t("invites.noActions")}>—</span>;
        return (
          <RowMenu label={t("ariaLabel.actionsForInvite")} header={t("invites.dropdownActions.label")} groups={
            s === "cancelled"
              ? [[{ id: "reinvite", label: t("invites.dropdownActions.reInvite"), icon: Send, tone: "text-[var(--accent)]", run: () => { void handleResend(row); } }]]
              : [
                  [{ id: "resend", label: t("invites.dropdownActions.resend"), icon: RefreshCw, tone: "text-[var(--accent)]", run: () => { void handleResend(row); } }],
                  [{ id: "cancel", label: t("invites.dropdownActions.cancel"), icon: XCircle, danger: true, run: () => { void handleCancel(row); } }],
                ]
          } />
        );
      },
    }] : []),
  ];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onPress={() => setShowInviteDialog(true)} className="w-full sm:w-auto">
            <Plus className="size-4" aria-hidden="true" /> {t("invites.inviteUser")}
          </Button>
        </div>
      )}

      {data && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label={t("invites.totalInvites")}>
          <FilterKpi icon={Mail} label={t("invites.totalInvites")} value={data.summary.total} />
          <FilterKpi icon={Clock} label={t("invites.pending")} value={data.summary.pending} />
          <FilterKpi icon={CheckCheck} status="success" label={t("invites.accepted")} value={data.summary.accepted} />
          <FilterKpi icon={AlertCircle} status="danger" label={t("invites.expired")} value={data.summary.expired} />
          <FilterKpi icon={Ban} label={t("invites.cancelled")} value={data.summary.cancelled} />
        </section>
      )}

      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-2 border-b border-[var(--border)] p-4 md:grid-cols-3 lg:grid-cols-5">
          <SearchField aria-label={t("invites.searchPlaceholder")} value={search} onChange={(value) => { setSearch(value); setOffset(0); }} className="md:col-span-2 lg:col-span-1">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("invites.searchPlaceholder")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <SelectField
            aria-label={t("invites.tableHeaders.status")}
            value={filterStatus}
            onChange={(value) => { setFilterStatus(value); setOffset(0); }}
            options={[
              { value: "all", label: t("allStatuses") },
              { value: "pending", label: t("invites.pending") },
              { value: "accepted", label: t("invites.accepted") },
              { value: "expired", label: t("invites.expired") },
              { value: "cancelled", label: t("invites.cancelled") },
            ]}
          />
          <SelectField
            aria-label={t("invites.tableHeaders.role")}
            value={filterRole}
            onChange={(value) => { setFilterRole(value); setOffset(0); }}
            options={[{ value: "all", label: t("allRoles") }, ...ROLES.map((r) => ({ value: r.value, label: t(`roles.${r.value}`) }))]}
          />
          <SelectField
            aria-label={t("invites.tableHeaders.state")}
            value={filterState}
            onChange={(value) => { setFilterState(value); setOffset(0); }}
            options={[{ value: "all", label: t("allStates") }, ...statesList.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))]}
          />
          <SelectField
            aria-label={t("invites.tableHeaders.emailDelivery")}
            value={filterEmailDelivery}
            onChange={(value) => { setFilterEmailDelivery(value); setOffset(0); }}
            options={[
              { value: "all", label: t("invites.emailDeliveryFilter") },
              { value: "sent", label: t("invites.emailStatusBadge.sent") },
              { value: "pending", label: t("invites.emailStatusBadge.pending") },
              { value: "failed", label: t("invites.emailStatusBadge.failed") },
            ]}
          />
          {hasFilters && (
            <div className="lg:col-span-5">
              <Button type="button" variant="ghost" size="sm" onPress={resetFilters}>
                <FilterX className="size-4" aria-hidden="true" /> {t("invites.resetFilters")}
              </Button>
            </div>
          )}
        </div>
        {isLoading ? (
          <RegistrySkeleton rows={5} />
        ) : isError ? (
          <div className="p-4"><ErrorState compact variant="server" title={t("invites.couldNotLoad")} onRetry={() => refetch()} /></div>
        ) : (
          <div role="region" aria-label={t("ariaLabel.invitationsTable")}>
            <DataGrid
              aria-label={t("ariaLabel.invitationsTable")}
              data={invitations}
              columns={columns}
              getRowId={(row) => row.id}
              contentClassName="min-w-[956px] table-fixed"
              verticalAlign="middle"
              renderEmptyState={() => (
                <EmptyRegistry
                  icon={FilterX}
                  message={hasFilters ? t("invites.noFilteredInvitations") : t("invites.noInvitations")}
                  action={hasFilters ? <Button variant="ghost" size="sm" onPress={resetFilters}>{t("invites.resetFilters")}</Button> : undefined}
                />
              )}
            />
          </div>
        )}
        {data && !isError && (
          <div className="border-t border-[var(--border)]">
            <OffsetPagination
              offset={data.offset}
              total={data.total}
              onOffsetChange={(next) => setOffset(next)}
              summary={t("pagination.showing", { from: data.total === 0 ? 0 : data.offset + 1, to: data.offset + invitations.length, total: data.total })}
            />
          </div>
        )}
      </Card>

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
      <InviteLinkModal
        link={inviteLink}
        onClose={() => setInviteLinkFor(null)}
        title={t("invites.linkDialog.title")}
        description={
          <>
            <p>{t("invites.linkDialog.shareDesc", { name: inviteLinkFor?.name ?? "" })}</p>
            {inviteLinkFor?.expiresInDays && (
              <p>{t("invites.linkDialog.expiresIn", {
                days: inviteLinkFor.expiresInDays,
                dayWord: inviteLinkFor.expiresInDays !== 1 ? t("invites.linkDialog.days") : t("invites.linkDialog.day"),
              })}</p>
            )}
            {inviteLinkFor?.emailDelivery === "pending" && (
              <p className="text-xs text-[var(--warning)]">{t("invites.linkDialog.simulationWarning")}</p>
            )}
            {inviteLinkFor?.emailDelivery === "failed" && (
              <p className="text-xs text-[var(--danger)]">{t("invites.linkDialog.deliveryFailed")}</p>
            )}
          </>
        }
        copiedMessage={t("invites.linkDialog.linkCopied")}
        manualMessage={t("invites.linkDialog.copyManual")}
        copyLabel={t("invites.linkDialog.copyLink")}
        closeLabel={t("invites.linkDialog.close")}
      />
    </div>
  );
}

// ─── Invite User Dialog ────────────────────────────────────────────────────────

const STATE_ROLES_SET = new Set(["state_office_manager", "state_program_officer"]);
const EXPIRY_OPTIONS = [
  { labelKey: "expiryOptions.days3", value: 3 },
  { labelKey: "expiryOptions.days7", value: 7 },
  { labelKey: "expiryOptions.days14", value: 14 },
  { labelKey: "expiryOptions.days30", value: 30 },
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
    <Modal isOpen={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Modal.Backdrop isDismissable={!busy}>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="max-h-[calc(100dvh-2rem)] sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t("inviteDialog.title")}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("inviteDialog.description")}</p>
            </Modal.Header>
            <form onSubmit={handleSubmit} noValidate className="contents">
              <Modal.Body className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-name" isRequired>{t("inviteDialog.fullName")}</Label>
                  <Input id="inv-name" fullWidth dir="auto" value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t("inviteDialog.placeholderName")} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-email" isRequired>{t("inviteDialog.emailAddress")}</Label>
                  <Input id="inv-email" type="email" fullWidth dir="ltr" className="rtl:text-end" value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder={t("inviteDialog.placeholderEmail")} required />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    id="inv-role"
                    label={t("inviteDialog.role")}
                    isRequired
                    placeholder={t("inviteDialog.selectRole")}
                    value={form.role}
                    onChange={(v) => setForm((f) => ({ ...f, role: v, stateId: "", sector: "" }))}
                    options={ROLES.map((r) => ({ value: r.value, label: t(`roles.${r.value}`) }))}
                  />
                  <SelectField
                    id="inv-expiry"
                    label={t("inviteDialog.linkExpiresAfter")}
                    value={String(form.expiresInDays)}
                    onChange={(v) => setForm((f) => ({ ...f, expiresInDays: Number(v) }))}
                    options={EXPIRY_OPTIONS.map((o) => ({ value: String(o.value), label: t(o.labelKey) }))}
                  />
                </div>
                {needsState && (
                  <SelectField
                    id="inv-state"
                    label={t("inviteDialog.assignedState")}
                    isRequired
                    placeholder={t("inviteDialog.selectState")}
                    value={form.stateId}
                    onChange={(v) => setForm((f) => ({ ...f, stateId: v }))}
                    options={statesList.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))}
                  />
                )}
                {isTC && (
                  <div className="space-y-1.5">
                    <SelectField
                      id="inv-sector"
                      label={t("inviteDialog.assignedSector")}
                      isRequired
                      placeholder={t("inviteDialog.selectSector")}
                      value={form.sector}
                      onChange={(v) => setForm((f) => ({ ...f, sector: v }))}
                      aria-describedby="inv-sector-hint"
                      options={SECTORS.map((s) => ({ value: s, label: s }))}
                    />
                    <p id="inv-sector-hint" className="text-xs text-[var(--muted)]">{t("inviteDialog.additionalSectors")}</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="inv-message">
                    {t("inviteDialog.personalMessage")} <span className="text-xs font-normal text-[var(--muted)]">{t("inviteDialog.personalMessageHint")}</span>
                  </Label>
                  <TextArea
                    id="inv-message"
                    fullWidth
                    dir="auto"
                    value={form.message}
                    onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                    placeholder={t("inviteDialog.placeholderMessage")}
                    rows={3}
                    maxLength={500}
                    className="resize-none"
                    aria-describedby="inv-message-count"
                  />
                  <p id="inv-message-count" className="text-end text-xs text-[var(--muted)]"><bdi dir="ltr">{form.message.length}/500</bdi></p>
                </div>

                {formError && (
                  <Alert status="danger" role="alert">
                    <Alert.Indicator />
                    <Alert.Content><Alert.Description>{formError}</Alert.Description></Alert.Content>
                  </Alert>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" variant="tertiary" onPress={handleClose} isDisabled={busy}>{t("inviteDialog.cancel")}</Button>
                <Button type="submit" isPending={busy}>
                  {busy ? <Spinner size="sm" color="current" /> : <Send className="size-4" aria-hidden="true" />}
                  {busy ? t("inviteDialog.sending") : t("inviteDialog.sendInvitation")}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

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
  // An inactive State still assigned to the user stays visible but not selectable.
  const orphanState = editing.stateId && !states.some((state) => state.id === editing.stateId) && editing.stateName
    ? [{ value: String(editing.stateId), label: i18n.language.startsWith("ar") ? editing.stateNameAr || editing.stateName : editing.stateName }]
    : [];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="user-name" label={t("userForm.fullName")} isRequired>
          <Input id="user-name" fullWidth dir="auto" value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id="user-username" label={t("userForm.username")} isRequired>
          <Input
            id="user-username"
            fullWidth
            dir="ltr"
            className="rtl:text-end"
            value={editing.username ?? ""}
            onChange={(e) => set("username", e.target.value)}
            placeholder={t("userForm.usernamePlaceholder")}
          />
        </Field>
        <Field id="user-email" label={t("userForm.email")} isRequired>
          <Input
            id="user-email"
            type="email"
            fullWidth
            dir="ltr"
            className="rtl:text-end"
            value={editing.email ?? ""}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field id="user-phone" label={t("userForm.phone")}>
          <Input id="user-phone" type="tel" fullWidth dir="ltr" className="rtl:text-end" value={editing.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <SelectField
          id="user-role"
          label={t("userForm.role")}
          isRequired
          value={editing.role ?? ""}
          onChange={(v) => {
            const nextRequiresState = ["state_office_manager", "state_program_officer"].includes(v);
            const wasStateRole = ["state_office_manager", "state_program_officer"].includes(editing.role ?? "");
            setEditing({
              ...editing,
              role: v,
              stateId: nextRequiresState && wasStateRole ? editing.stateId : null,
              sector: v === "technical_coordinator" ? editing.sector ?? null : null,
            });
          }}
          options={ROLES.map((r) => ({ value: r.value, label: t(`roles.${r.value}`) }))}
        />
        {requiresState ? (
          stateReference.status === "ready" ? (
            <SelectField
              id="user-state"
              label={t("userForm.assignedState")}
              isRequired
              placeholder={t("userForm.selectState")}
              value={editing.stateId ? String(editing.stateId) : ""}
              onChange={(v) => set("stateId", Number(v))}
              options={[...orphanState, ...states.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))]}
            />
          ) : (
            <div className="space-y-1.5">
              <Label isRequired>{t("userForm.assignedState")}</Label>
              <StateReferenceStatus
                status={stateReference.status}
                loadingText={t("userForm.statesLoading")}
                errorText={t("userForm.statesError")}
                emptyText={t("userForm.statesEmpty")}
                retryText={t("userForm.statesRetry")}
                onRetry={() => { void stateReference.retry(); }}
              />
            </div>
          )
        ) : null}
        {editing.role === "technical_coordinator" ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label id="user-sector-label" isRequired>{t("userForm.assignedSector")}</Label>
            <SectorMultiSelect
              labelledBy="user-sector-label"
              value={editing.sector ?? ""}
              onChange={(v) => set("sector", v)}
            />
          </div>
        ) : null}
        <SelectField
          id="user-language"
          label={t("userForm.language")}
          value={editing.languagePreference === "ar" ? "ar" : "en"}
          onChange={(v) => set("languagePreference", v)}
          options={[
            { value: "ar", label: t("arabic") },
            { value: "en", label: t("english") },
          ]}
        />
        <SelectField
          id="user-status"
          label={t("userForm.accountStatus")}
          isRequired
          value={editing.status ?? "invited"}
          onChange={(v) => set("status", v)}
          options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
        />
      </div>

      {showPassword && (
        <div className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--default)] p-3 sm:grid-cols-2">
          <Field id="user-password" label={t("userForm.passwordLabel")} isRequired>
            <Input
              id="user-password"
              type="password"
              fullWidth
              autoComplete="new-password"
              value={editing.password ?? ""}
              onChange={(e) => set("password", e.target.value)}
              placeholder={t("userForm.passwordMin")}
            />
          </Field>
          <Field id="user-password-confirm" label={t("userForm.confirmPasswordLabel")} isRequired>
            <Input
              id="user-password-confirm"
              type="password"
              fullWidth
              autoComplete="new-password"
              value={editing.confirmPassword ?? ""}
              onChange={(e) => set("confirmPassword", e.target.value)}
            />
          </Field>
        </div>
      )}
      {isCreate && editing.status === "invited" && (
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{t("userForm.inviteNote")}</Alert.Description></Alert.Content>
        </Alert>
      )}
    </div>
  );
}

// Chip-style multi-select for Technical Coordinator sector assignment.
// Value is the comma-separated string stored in users.sector.
function SectorMultiSelect({
  value,
  onChange,
  labelledBy,
}: {
  value: string;
  onChange: (v: string) => void;
  labelledBy?: string;
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
    <div role="group" aria-labelledby={labelledBy} className="flex min-h-[44px] flex-wrap gap-1.5 rounded-xl border border-[var(--border)] p-2">
      {SECTORS.map((s) => (
        <CountToggleChip key={s} label={s} pressed={selected.has(s)} onPress={() => toggle(s)} />
      ))}
    </div>
  );
}

function CountToggleChip({ label, pressed, onPress }: { label: string; pressed: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
        pressed
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
          : "border-[var(--border)] hover:bg-[var(--default)]"
      }`}
    >
      {pressed && <CheckCheck className="size-3" aria-hidden="true" />}
      {label}
    </button>
  );
}

function Field({ id, label, isRequired, children }: { id: string; label: string; isRequired?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} isRequired={isRequired}>{label}</Label>
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
  const cancel = () => { setPwd(""); setConfirm(""); onCancel(); };
  return (
    <Modal isOpen={!!user} onOpenChange={(o) => { if (!o) cancel(); }}>
      <Modal.Backdrop isDismissable={!pending}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-[var(--default)] text-[var(--foreground)]"><KeyRound className="size-5" aria-hidden="true" /></Modal.Icon>
              <Modal.Heading>{t("resetPasswordDialog.title", { name: user?.name })}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("resetPasswordDialog.description")}</p>
            </Modal.Header>
            <Modal.Body className="grid gap-4">
              <Field id="reset-password" label={t("resetPasswordDialog.newPassword")}>
                <Input id="reset-password" type="password" fullWidth autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
              </Field>
              <Field id="reset-password-confirm" label={t("resetPasswordDialog.confirmPassword")}>
                <Input id="reset-password-confirm" type="password" fullWidth autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            </Modal.Body>
            <Modal.Footer className="flex-wrap">
              <Button variant="tertiary" onPress={cancel}>{t("resetPasswordDialog.cancel")}</Button>
              <Button variant="secondary" onPress={() => onSubmit("invite")} isDisabled={pending}>
                <Mail className="size-4" aria-hidden="true" /> {t("resetPasswordDialog.sendInvite")}
              </Button>
              <Button
                onPress={() => {
                  if (pwd.length < 8) { toast.error(t("resetPasswordDialog.passwordTooShort")); return; }
                  if (pwd !== confirm) { toast.error(t("resetPasswordDialog.passwordsDoNotMatch")); return; }
                  onSubmit("password", pwd);
                  setPwd(""); setConfirm("");
                }}
                isPending={pending}
              >
                {t("resetPasswordDialog.setPassword")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function EmailDeliveryBadge({ status, t }: { status: ResetToken["emailStatus"]; t: (key: string) => string }) {
  if (status === "sent") return <DeliveryChip status="sent" label={t("passwordReset.emailStatus.sent")} />;
  if (status === "failed") return <DeliveryChip status="failed" label={t("passwordReset.emailStatus.failed")} />;
  if (status === "pending") return <DeliveryChip status="pending" label={t("passwordReset.emailStatus.pending")} />;
  return <span className="text-xs text-[var(--muted)]">—</span>;
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
  icon: IconComponent;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
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
  const Icon = result === "allowed" ? CheckCircle2 : result === "denied" ? XCircle : AlertCircle;
  return (
    <Chip size="sm" variant="soft" color={result === "allowed" ? "success" : result === "denied" ? "danger" : "warning"} className="shrink-0 whitespace-nowrap">
      <Icon className="size-3" aria-hidden="true" />
      {t(`inspector.${result}`)}
    </Chip>
  );
}

function AccessInspectorDrawer({
  user,
  onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("users");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const isRtl = i18n.dir() === "rtl";

  const userId = user?.id ?? 0;
  const { data, isLoading, isError, refetch } = useGetUserEffectiveAccess(userId, {
    query: {
      queryKey: getGetUserEffectiveAccessQueryKey(userId),
      enabled: !!user?.id,
      staleTime: 30_000,
    },
  });

  const access = data as unknown as EffectiveAccessData | undefined;
  const moduleLabel = (m: EffectiveModuleAccess) => t(`inspector.modules.${m.module}`, { defaultValue: m.label });
  const actionLabel = (a: EffectiveModuleAction) => t(`inspector.actions.${a.action}`, { defaultValue: a.label });
  const reasonLabel = (a: EffectiveModuleAction) => t(`inspector.reasonCodes.${a.reasonCode}`, { defaultValue: a.reason });

  const filteredModules = useMemo(() => {
    if (!access?.modules) return [];
    const lc = search.trim().toLowerCase();
    // Search what the reader sees: the translated action and reason text.
    return access.modules
      .filter((m) => moduleFilter === "all" || m.module === moduleFilter)
      .map((m) => ({
        ...m,
        actions: m.actions.filter(
          (a) => !lc || actionLabel(a).toLowerCase().includes(lc) || reasonLabel(a).toLowerCase().includes(lc),
        ),
      }))
      .filter((m) => m.actions.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, search, moduleFilter, t]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setSearch("");
      setModuleFilter("all");
      onClose();
    }
  }

  // The access API returns the English State name; the directory row carries both.
  const stateLabel = access?.scope.stateId != null && user?.stateId === access.scope.stateId
    ? getLinkedStateLabel(user, i18n.language)
    : access?.scope.stateName ?? t("inspector.notAssigned");

  return (
    <Drawer>
      <Drawer.Backdrop isOpen={!!user} onOpenChange={handleOpenChange}>
        <Drawer.Content placement={isRtl ? "left" : "right"}>
          <Drawer.Dialog className="h-full w-screen max-w-full sm:w-[42rem]">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-[var(--accent)]" aria-hidden="true" />
                {t("inspector.title")}
              </Drawer.Heading>
              <p className="text-sm text-[var(--muted)]">{t("inspector.description")}</p>
            </Drawer.Header>
            <Drawer.Body className="space-y-4">
              {isLoading && (
                <div className="space-y-3" aria-busy="true" aria-label={t("inspector.title")}>
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                </div>
              )}

              {isError && !isLoading && (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <AlertCircle className="size-8 text-[var(--danger)]" aria-hidden="true" />
                  <p className="text-sm text-[var(--muted)]">{t("inspector.loadError")}</p>
                  <Button variant="tertiary" size="sm" onPress={() => refetch()}>{t("inspector.retry")}</Button>
                </div>
              )}

              {access && (
                <>
                  <Card variant="secondary" className="gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p dir="auto" className="truncate text-base font-medium text-page-start">{access.displayName}</p>
                        <p className="truncate text-sm text-[var(--muted)]"><bdi dir="ltr">{access.email}</bdi></p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RoleBadge role={access.role} label={access.roleLabel} />
                        <StatusBadge status={access.accountStatus} />
                      </div>
                    </div>

                    {!access.runtimeActive && (
                      <Alert status="warning">
                        <Alert.Indicator />
                        <Alert.Content>
                          <Alert.Description>
                            {t("inspector.accountInactive", { status: t(`status.${access.accountStatus}`, { defaultValue: access.accountStatus }) })}
                          </Alert.Description>
                        </Alert.Content>
                      </Alert>
                    )}

                    <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
                      <ScopeRow
                        icon={Globe}
                        label={t("inspector.orgScope")}
                        value={access.scope.orgWide ? t("inspector.orgWide") : t("inspector.stateScoped")}
                      />
                      <ScopeRow icon={MapPin} label={t("inspector.stateScope")} value={stateLabel} />
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
                  </Card>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <SearchField aria-label={t("inspector.searchActionsLabel")} value={search} onChange={setSearch} className="flex-1">
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input placeholder={t("inspector.searchActions")} />
                        <SearchField.ClearButton />
                      </SearchField.Group>
                    </SearchField>
                    <SelectField
                      aria-label={t("inspector.filterModuleLabel")}
                      value={moduleFilter}
                      onChange={setModuleFilter}
                      triggerClassName="whitespace-nowrap sm:w-48"
                      options={[{ value: "all", label: t("inspector.allModules") }, ...access.modules.map((m) => ({ value: m.module, label: moduleLabel(m) }))]}
                    />
                  </div>

                  {filteredModules.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[var(--muted)]">{t("inspector.noResults")}</p>
                  ) : (
                    <div className="space-y-4">
                      {filteredModules.map((mod) => (
                        <section key={mod.module} aria-labelledby={`inspector-mod-${mod.module}`}>
                          <h3 id={`inspector-mod-${mod.module}`} className="mb-2 text-xs font-medium text-[var(--muted)]">
                            {moduleLabel(mod)}
                          </h3>
                          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
                            {mod.actions.map((act) => (
                              <li key={act.action} className="flex items-start gap-3 px-3 py-2.5">
                                <ResultBadge result={act.result} t={t} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium leading-tight">{actionLabel(act)}</p>
                                  <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{reasonLabel(act)}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

type EffectiveModuleAccess = {
  module: string;
  label: string;
  actions: EffectiveModuleAction[];
};
