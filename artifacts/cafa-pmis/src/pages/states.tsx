import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStatesQueryKey,
  useCreateState,
  useGetMe,
  useListStates,
  useUpdateState,
  useUpdateStateLifecycle,
  type StateInput,
  type StateRecord,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { AlertCircle, Building2, MapPin, Pencil, Plus, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATE_ADMIN_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
const blankForm: StateInput = { name: "", nameAr: "", code: "", officeAddress: null };

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data && "error" in data && (data as { error?: string }).error === "state_identity_conflict") {
      return fallback;
    }
  }
  return fallback;
}

function StateDialog({
  record,
  onClose,
}: {
  record: StateRecord | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("planning");
  const queryClient = useQueryClient();
  const createState = useCreateState();
  const updateState = useUpdateState();
  const [form, setForm] = useState<StateInput>(
    record ? { name: record.name, nameAr: record.nameAr, code: record.code, officeAddress: record.officeAddress } : blankForm,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isEditing = Boolean(record);
  const isPending = createState.isPending || updateState.isPending;

  const updateField = (field: keyof StateInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = t("statesPage.validation.nameRequired");
    if (!form.nameAr.trim()) nextErrors.nameAr = t("statesPage.validation.nameArRequired");
    if (!form.code.trim()) nextErrors.code = t("statesPage.validation.codeRequired");
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    const data: StateInput = {
      name: form.name,
      nameAr: form.nameAr,
      code: form.code,
      officeAddress: form.officeAddress?.trim() || null,
    };
    try {
      if (record) {
        await updateState.mutateAsync({ stateId: record.id, data });
        toast.success(t("statesPage.saved"));
        await queryClient.invalidateQueries({ queryKey: getListStatesQueryKey() });
        await queryClient.invalidateQueries({ queryKey: [`/api/states/${record.id}`] });
      } else {
        await createState.mutateAsync({ data });
        toast.success(t("statesPage.created"));
        await queryClient.invalidateQueries({ queryKey: getListStatesQueryKey() });
      }
      onClose();
    } catch (error) {
      const data = typeof error === "object" && error && "data" in error
        ? (error as { data?: { fields?: Record<string, string> } }).data
        : undefined;
      if (data?.fields) setFieldErrors(data.fields);
      toast.error(errorMessage(error, t("statesPage.saveFailed")));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t(isEditing ? "statesPage.editTitle" : "statesPage.addTitle")}</DialogTitle>
            <DialogDescription>{t("statesPage.formDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="grid gap-2">
              <Label htmlFor="state-name">{t("statesPage.name")}</Label>
              <Input
                id="state-name"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                maxLength={120}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? "state-name-error" : undefined}
                autoFocus
              />
              {fieldErrors.name && <p id="state-name-error" role="alert" className="text-sm text-destructive">{fieldErrors.name}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state-code">{t("statesPage.code")}</Label>
              <Input
                id="state-code"
                value={form.code}
                onChange={(event) => updateField("code", event.target.value)}
                maxLength={24}
                aria-invalid={Boolean(fieldErrors.code)}
                aria-describedby={fieldErrors.code ? "state-code-error" : undefined}
              />
              {fieldErrors.code && <p id="state-code-error" role="alert" className="text-sm text-destructive">{fieldErrors.code}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state-name-ar">{t("statesPage.nameAr")}</Label>
              <Input
                id="state-name-ar"
                value={form.nameAr}
                onChange={(event) => updateField("nameAr", event.target.value)}
                maxLength={120}
                dir="rtl"
                aria-invalid={Boolean(fieldErrors.nameAr)}
                aria-describedby={fieldErrors.nameAr ? "state-name-ar-error" : undefined}
              />
              {fieldErrors.nameAr && <p id="state-name-ar-error" role="alert" className="text-sm text-destructive">{fieldErrors.nameAr}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state-office-address">{t("statesPage.officeAddress")}</Label>
              <textarea
                id="state-office-address"
                value={form.officeAddress ?? ""}
                onChange={(event) => updateField("officeAddress", event.target.value)}
                maxLength={500}
                rows={3}
                className="flex w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary/50"
                aria-invalid={Boolean(fieldErrors.officeAddress)}
                aria-describedby={fieldErrors.officeAddress ? "state-office-address-error" : undefined}
              />
              {fieldErrors.officeAddress && <p id="state-office-address-error" role="alert" className="text-sm text-destructive">{fieldErrors.officeAddress}</p>}
            </div>
            {record && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                <p className="font-medium">{t("statesPage.manager")}</p>
                <p className="mt-1 text-muted-foreground">{record.managerName ?? t("statesPage.noManager")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("statesPage.managerReadOnly")}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>{t("statesPage.cancel")}</Button>
            <Button type="submit" isLoading={isPending} loadingText={t("statesPage.saving")}>
              {t(isEditing ? "statesPage.save" : "statesPage.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StateRows({
  states,
  canManage,
  onEdit,
  onLifecycle,
}: {
  states: StateRecord[];
  canManage: boolean;
  onEdit: (state: StateRecord) => void;
  onLifecycle: (state: StateRecord, changes: { operationalStatus?: "active" | "inactive"; officeStatus?: "present" | "absent" | "unknown" }) => void;
}) {
  const { t } = useTranslation("planning");
  const { i18n } = useTranslation();
  const stateLabel = (state: StateRecord) => i18n?.language === "ar" ? state.nameAr || state.name : state.name;

  return (
    <>
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("statesPage.name")}</TableHead>
                <TableHead>{t("statesPage.code")}</TableHead>
                <TableHead>{t("statesPage.operationalStatus")}</TableHead>
                <TableHead>{t("statesPage.officeStatus")}</TableHead>
                <TableHead>{t("statesPage.officeAddress")}</TableHead>
                <TableHead>{t("statesPage.manager")}</TableHead>
                <TableHead className="text-end">{t("statesPage.localities")}</TableHead>
                {canManage && <TableHead className="w-24"><span className="sr-only">{t("statesPage.actions")}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {states.map((state) => (
                <TableRow key={state.id}>
                  <TableCell className="font-medium">
                    <Link href={`/states/${state.id}`} className="inline-flex items-center gap-2 hover:text-primary hover:underline">
                      <MapPin className="h-4 w-4 text-primary" aria-hidden />{stateLabel(state)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{state.code}</TableCell>
                  <TableCell>{t(`statesPage.status.${state.operationalStatus}`)}</TableCell>
                  <TableCell>{state.officeStatus}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{state.officeAddress ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{state.managerName ?? t("statesPage.noManager")}</TableCell>
                  <TableCell className="text-end">{state.localitiesCount}</TableCell>
                  {canManage && (
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-sm" variant="ghost" onClick={() => onEdit(state)} aria-label={t("statesPage.editState", { name: stateLabel(state) })}><Pencil aria-hidden /></Button>
                        <Button size="sm" variant="outline" onClick={() => onLifecycle(state, { operationalStatus: state.operationalStatus === "active" ? "inactive" : "active" })}>
                          {t(state.operationalStatus === "active" ? "statesPage.deactivate" : "statesPage.activate")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onLifecycle(state, { officeStatus: state.officeStatus === "present" ? "absent" : "present" })}>
                          {t(state.officeStatus === "present" ? "statesPage.markNoOffice" : "statesPage.markOfficePresent")}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:hidden">
        {states.map((state) => (
          <Card key={state.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/states/${state.id}`} className="font-medium hover:text-primary hover:underline">{stateLabel(state)}</Link>
                <span className="rounded border border-border px-2 py-0.5 font-mono text-xs">{state.code}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.manager")}</dt><dd>{state.managerName ?? t("statesPage.noManager")}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.localities")}</dt><dd>{state.localitiesCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.operationalStatus")}</dt><dd>{t(`statesPage.status.${state.operationalStatus}`)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.officeStatus")}</dt><dd>{t(`statesPage.office.${state.officeStatus}`)}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t("statesPage.officeAddress")}</dt><dd>{state.officeAddress ?? "—"}</dd></div>
              </dl>
              {canManage && <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit(state)}><Pencil aria-hidden />{t("statesPage.edit")}</Button>
                <Button size="sm" variant="outline" onClick={() => onLifecycle(state, { operationalStatus: state.operationalStatus === "active" ? "inactive" : "active" })}>{t(state.operationalStatus === "active" ? "statesPage.deactivate" : "statesPage.activate")}</Button>
                <Button size="sm" variant="outline" onClick={() => onLifecycle(state, { officeStatus: state.officeStatus === "present" ? "absent" : "present" })}>{t(state.officeStatus === "present" ? "statesPage.markNoOffice" : "statesPage.markOfficePresent")}</Button>
              </div>}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function StatesPage() {
  const { t } = useTranslation("planning");
  const { data: me } = useGetMe();
  const canManage = STATE_ADMIN_ROLES.has(me?.user.role ?? "");
  const { data: states, isLoading, isError, refetch } = useListStates(canManage ? { includeInactive: true } : undefined);
  const updateLifecycle = useUpdateStateLifecycle();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StateRecord | null | "new">(null);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return states ?? [];
    return (states ?? []).filter((state) =>
      [state.name, state.nameAr, state.code, state.officeAddress, state.managerName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [search, states]);
  const updateStateLifecycle = async (state: StateRecord, changes: { operationalStatus?: "active" | "inactive"; officeStatus?: "present" | "absent" | "unknown" }) => {
    const description = changes.operationalStatus
      ? t("statesPage.confirmOperational", { action: t(changes.operationalStatus === "active" ? "statesPage.activate" : "statesPage.deactivate"), name: state.name })
      : t("statesPage.confirmOffice", { action: t(changes.officeStatus === "present" ? "statesPage.markOfficePresent" : "statesPage.markNoOffice"), name: state.name });
    if (!window.confirm(description)) return;
    try {
      await updateLifecycle.mutateAsync({ stateId: state.id, data: { confirmed: true, ...changes } });
      toast.success(t("statesPage.lifecycleSaved"));
      await refetch();
    } catch {
      toast.error(t("statesPage.lifecycleFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">{t("statesPage.heading")}</h1>
          <p className="mt-1 text-muted-foreground">{t("statesPage.description")}</p>
        </div>
        {canManage && <Button onClick={() => setEditing("new")}><Plus aria-hidden />{t("statesPage.add")}</Button>}
      </div>

      <Alert>
        <Building2 className="h-4 w-4" aria-hidden />
        <AlertTitle>{t("statesPage.registryNoticeTitle")}</AlertTitle>
        <AlertDescription>{t("statesPage.registryNotice")}</AlertDescription>
      </Alert>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("statesPage.searchPlaceholder")}
          aria-label={t("statesPage.searchLabel")}
          className="ps-9"
        />
      </div>

      {isLoading ? (
        <Card><CardContent className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}</CardContent></Card>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("statesPage.loadError")}</AlertTitle>
          <AlertDescription className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span>{t("statesPage.loadErrorDescription")}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>{t("statesPage.retry")}</Button>
          </AlertDescription>
        </Alert>
      ) : !states?.length ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <MapPin className="h-10 w-10 opacity-40" aria-hidden />
          <p className="font-medium">{t("statesPage.emptyTitle")}</p>
          <p className="max-w-md text-sm">{t(canManage ? "statesPage.emptyAdminDescription" : "statesPage.emptyDescription")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Search className="h-10 w-10 opacity-40" aria-hidden />
          <p className="font-medium">{t("statesPage.noResultsTitle")}</p>
          <p className="text-sm">{t("statesPage.noResultsDescription", { search })}</p>
        </div>
      ) : (
        <StateRows states={filtered} canManage={canManage} onEdit={setEditing} onLifecycle={updateStateLifecycle} />
      )}

      {editing !== null && <StateDialog record={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}