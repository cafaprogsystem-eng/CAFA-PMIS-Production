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
import { Alert, Button, Card, FieldError, Input, InputGroup, Label, Modal, Skeleton, Table, TextArea, TextField } from "@heroui/react";

const STATE_ADMIN_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
const blankForm: StateInput = { name: "", nameAr: "", code: "", officeAddress: null };

/**
 * More than one active State Office Manager can be assigned to the same
 * State at once (no uniqueness constraint prevents it), so this renders the
 * live list resolved from users rather than a single denormalised name.
 */
function officeManagerLabel(managers: Array<{ id: number; name: string }> | undefined, fallback: string): string {
  if (!managers || managers.length === 0) return fallback;
  return managers.map((manager) => manager.name).join(", ");
}

function errorMessage(error: unknown, fallback: string, revisionConflictMessage?: string): string {
  if (typeof error === "object" && error && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data && "error" in data) {
      const errorCode = (data as { error?: string }).error;
      const conflictCode = (data as { code?: string }).code;
      // Frontend owns the translated copy — never display the server's raw
      // English message field directly.
      if (errorCode === "offline_conflict" && conflictCode === "revision_mismatch" && revisionConflictMessage) {
        return revisionConflictMessage;
      }
      if (errorCode === "state_identity_conflict") return fallback;
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
  // Round-trips the State row's own updatedAt as x-base-revision so two
  // admins editing the same State at once get a clear conflict instead of
  // one silently clobbering the other (same opt-in pattern used by
  // risks/plans/reports).
  const updateState = useUpdateState(
    record?.updatedAt ? { request: { headers: { "x-base-revision": record.updatedAt } } } : undefined,
  );
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
      toast.error(errorMessage(error, t("statesPage.saveFailed"), t("statesPage.revisionConflict")));
    }
  };

  const field = (
    name: keyof StateInput,
    label: string,
    control: React.ReactNode,
    maxLength: number,
    extra: { autoFocus?: boolean } = {},
  ) => (
    <TextField
      value={(form[name] ?? "") as string}
      onChange={(value) => updateField(name, value)}
      maxLength={maxLength}
      isInvalid={Boolean(fieldErrors[name])}
      autoFocus={extra.autoFocus}
      fullWidth
    >
      <Label>{label}</Label>
      {control}
      <FieldError>{fieldErrors[name]}</FieldError>
    </TextField>
  );

  return (
    <Modal isOpen onOpenChange={(open) => !open && !isPending && onClose()}>
      <Modal.Backdrop isDismissable={!isPending}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <form onSubmit={submit}>
              <Modal.Header>
                <Modal.Heading>{t(isEditing ? "statesPage.editTitle" : "statesPage.addTitle")}</Modal.Heading>
                <p className="text-sm text-muted-foreground">{t("statesPage.formDescription")}</p>
              </Modal.Header>
              <Modal.Body className="grid gap-4 py-5">
                {field("name", t("statesPage.name"), <Input id="state-name" />, 120, { autoFocus: true })}
                {field("code", t("statesPage.code"), <Input id="state-code" />, 24)}
                {field("nameAr", t("statesPage.nameAr"), <Input id="state-name-ar" dir="rtl" />, 120)}
                {field("officeAddress", t("statesPage.officeAddress"), <TextArea id="state-office-address" rows={3} />, 500)}
                {record && (
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                    <p className="font-medium">{t("statesPage.manager")}</p>
                    <p className="mt-1 text-muted-foreground">{officeManagerLabel(record.officeManagers, t("statesPage.noManager"))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("statesPage.managerReadOnly")}</p>
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" variant="outline" onPress={onClose} isDisabled={isPending}>{t("statesPage.cancel")}</Button>
                <Button type="submit" isPending={isPending}>
                  {isPending ? t("statesPage.saving") : t(isEditing ? "statesPage.save" : "statesPage.create")}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
      <Table className="hidden md:block">
        <Table.ScrollContainer>
          <Table.Content aria-label={t("statesPage.heading")}>
            <Table.Header>
              <Table.Column isRowHeader>{t("statesPage.name")}</Table.Column>
              <Table.Column>{t("statesPage.code")}</Table.Column>
              <Table.Column>{t("statesPage.operationalStatus")}</Table.Column>
              <Table.Column>{t("statesPage.officeStatus")}</Table.Column>
              <Table.Column>{t("statesPage.officeAddress")}</Table.Column>
              <Table.Column>{t("statesPage.manager")}</Table.Column>
              <Table.Column className="text-end">{t("statesPage.localities")}</Table.Column>
              {canManage && <Table.Column className="w-24"><span className="sr-only">{t("statesPage.actions")}</span></Table.Column>}
            </Table.Header>
            <Table.Body>
              {states.map((state) => (
                <Table.Row key={state.id} id={state.id}>
                  <Table.Cell className="font-medium">
                    <Link href={`/states/${state.id}`} className="inline-flex items-center gap-2 hover:text-primary hover:underline">
                      <MapPin className="h-4 w-4 text-primary" aria-hidden />{stateLabel(state)}
                    </Link>
                  </Table.Cell>
                  <Table.Cell className="font-mono text-xs">{state.code}</Table.Cell>
                  <Table.Cell>{t(`statesPage.status.${state.operationalStatus}`)}</Table.Cell>
                  <Table.Cell>{t(`statesPage.office.${state.officeStatus}`)}</Table.Cell>
                  <Table.Cell className="max-w-xs truncate text-muted-foreground">{state.officeAddress ?? "—"}</Table.Cell>
                  <Table.Cell className="text-muted-foreground">{officeManagerLabel(state.officeManagers, t("statesPage.noManager"))}</Table.Cell>
                  <Table.Cell className="text-end">{state.localitiesCount}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button isIconOnly size="sm" variant="ghost" onPress={() => onEdit(state)} aria-label={t("statesPage.editState", { name: stateLabel(state) })}><Pencil className="h-4 w-4" aria-hidden /></Button>
                        <Button size="sm" variant="outline" onPress={() => onLifecycle(state, { operationalStatus: state.operationalStatus === "active" ? "inactive" : "active" })}>
                          {t(state.operationalStatus === "active" ? "statesPage.deactivate" : "statesPage.activate")}
                        </Button>
                        <Button size="sm" variant="outline" onPress={() => onLifecycle(state, { officeStatus: state.officeStatus === "present" ? "absent" : "present" })}>
                          {t(state.officeStatus === "present" ? "statesPage.markNoOffice" : "statesPage.markOfficePresent")}
                        </Button>
                      </div>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="grid gap-3 md:hidden">
        {states.map((state) => (
          <Card key={state.id}>
            <Card.Content className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/states/${state.id}`} className="font-medium hover:text-primary hover:underline">{stateLabel(state)}</Link>
                <span className="rounded border border-border px-2 py-0.5 font-mono text-xs">{state.code}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.manager")}</dt><dd>{officeManagerLabel(state.officeManagers, t("statesPage.noManager"))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.localities")}</dt><dd>{state.localitiesCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.operationalStatus")}</dt><dd>{t(`statesPage.status.${state.operationalStatus}`)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("statesPage.officeStatus")}</dt><dd>{t(`statesPage.office.${state.officeStatus}`)}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t("statesPage.officeAddress")}</dt><dd>{state.officeAddress ?? "—"}</dd></div>
              </dl>
              {canManage && <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onPress={() => onEdit(state)}><Pencil className="h-4 w-4" aria-hidden />{t("statesPage.edit")}</Button>
                <Button size="sm" variant="outline" onPress={() => onLifecycle(state, { operationalStatus: state.operationalStatus === "active" ? "inactive" : "active" })}>{t(state.operationalStatus === "active" ? "statesPage.deactivate" : "statesPage.activate")}</Button>
                <Button size="sm" variant="outline" onPress={() => onLifecycle(state, { officeStatus: state.officeStatus === "present" ? "absent" : "present" })}>{t(state.officeStatus === "present" ? "statesPage.markNoOffice" : "statesPage.markOfficePresent")}</Button>
              </div>}
            </Card.Content>
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
      [state.name, state.nameAr, state.code, state.officeAddress, ...(state.officeManagers?.map((manager) => manager.name) ?? [])]
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
          <h1 className="text-foreground text-xl font-semibold">{t("statesPage.heading")}</h1>
          <p className="mt-1 text-muted-foreground">{t("statesPage.description")}</p>
        </div>
        {canManage && <Button onPress={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />{t("statesPage.add")}</Button>}
      </div>

      <Alert status="accent">
        <Alert.Indicator><Building2 className="h-4 w-4" aria-hidden /></Alert.Indicator>
        <Alert.Content>
          <Alert.Title>{t("statesPage.registryNoticeTitle")}</Alert.Title>
          <Alert.Description>{t("statesPage.registryNotice")}</Alert.Description>
        </Alert.Content>
      </Alert>

      <TextField value={search} onChange={setSearch} aria-label={t("statesPage.searchLabel")} className="max-w-md">
        <InputGroup fullWidth>
          <InputGroup.Prefix><Search className="h-4 w-4" aria-hidden /></InputGroup.Prefix>
          <InputGroup.Input placeholder={t("statesPage.searchPlaceholder")} />
        </InputGroup>
      </TextField>

      {isLoading ? (
        <Card><Card.Content className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full rounded-lg" />)}</Card.Content></Card>
      ) : isError ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator><AlertCircle className="h-4 w-4" aria-hidden /></Alert.Indicator>
          <Alert.Content>
            <Alert.Title>{t("statesPage.loadError")}</Alert.Title>
            <Alert.Description className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span>{t("statesPage.loadErrorDescription")}</span>
              <Button variant="outline" size="sm" onPress={() => refetch()}>{t("statesPage.retry")}</Button>
            </Alert.Description>
          </Alert.Content>
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