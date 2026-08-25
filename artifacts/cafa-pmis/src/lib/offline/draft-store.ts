import { db, getOfflineUser, type FormDraft, type FormDraftModule, type FormDraftScope, type LocalIdentityMapping } from "./db";

export type DraftStatus = FormDraft["status"];

export function makeDraftKey(userId: number, module: FormDraftModule, recordKey: string): string {
  return `${userId}:${module}:${recordKey}`;
}

export function makeLocalEntityId(module: FormDraftModule): string {
  return `local:${module}:${crypto.randomUUID()}`;
}

function requireUser(userId?: number): number {
  const resolved = userId ?? getOfflineUser();
  if (!resolved) throw new Error("offline_user_required");
  return resolved;
}

export async function saveFormDraft(input: {
  userId?: number;
  module: FormDraftModule;
  recordKey: string;
  localEntityId?: string | null;
  serverEntityId?: number | null;
  label?: string;
  payload: unknown;
  scope?: Partial<FormDraftScope>;
  baseRevision?: string | null;
  status?: DraftStatus;
  operationId?: string | null;
  lastError?: string | null;
}): Promise<FormDraft> {
  const userId = requireUser(input.userId);
  const key = makeDraftKey(userId, input.module, input.recordKey);
  const now = Date.now();
  const existing = await db.formDrafts.get(key);
  const hasOperationId = Object.prototype.hasOwnProperty.call(input, "operationId");
  const hasStatus = Object.prototype.hasOwnProperty.call(input, "status");
  const draft: FormDraft = {
    key,
    userId,
    module: input.module,
    recordKey: input.recordKey,
    localEntityId: input.localEntityId ?? existing?.localEntityId ?? null,
    serverEntityId: input.serverEntityId ?? existing?.serverEntityId ?? null,
    label: input.label ?? existing?.label ?? input.module,
    payload: JSON.stringify(input.payload),
    scope: {
      stateIds: input.scope?.stateIds ?? existing?.scope.stateIds ?? [],
      sectors: input.scope?.sectors ?? existing?.scope.sectors ?? [],
      projectIds: input.scope?.projectIds ?? existing?.scope.projectIds ?? [],
    },
    baseRevision: input.baseRevision ?? existing?.baseRevision ?? null,
    status: hasStatus ? input.status! : existing?.status ?? "local-draft",
    // Callers explicitly clear this when the user edits a queued snapshot.
    // A prior queue operation must never settle a newer payload as synced.
    operationId: hasOperationId ? input.operationId! : existing?.operationId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastError: input.lastError ?? existing?.lastError ?? null,
  };
  await db.formDrafts.put(draft);
  return draft;
}

export async function getFormDraft(
  module: FormDraftModule,
  recordKey: string,
  userId?: number,
): Promise<FormDraft | undefined> {
  const id = requireUser(userId);
  return db.formDrafts.get(makeDraftKey(id, module, recordKey));
}

export async function listFormDrafts(module?: FormDraftModule, userId?: number): Promise<FormDraft[]> {
  const id = requireUser(userId);
  const rows = await db.formDrafts.where("userId").equals(id).toArray();
  return (module ? rows.filter((row) => row.module === module) : rows)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeFormDraft(module: FormDraftModule, recordKey: string, userId?: number): Promise<void> {
  const id = requireUser(userId);
  await db.formDrafts.delete(makeDraftKey(id, module, recordKey));
}

export async function markDraftQueued(
  module: FormDraftModule,
  recordKey: string,
  operationId: string,
  userId?: number,
): Promise<void> {
  const id = requireUser(userId);
  const key = makeDraftKey(id, module, recordKey);
  const draft = await db.formDrafts.get(key);
  if (!draft) return;
  await db.formDrafts.update(key, { status: "pending", operationId, updatedAt: Date.now(), lastError: null });
}

export async function markDraftResult(
  draftKey: string,
  operationId: string,
  status: Extract<DraftStatus, "synced" | "failed" | "conflict">,
  error?: string | null,
  removeOnSynced = false,
): Promise<void> {
  const draft = await db.formDrafts.get(draftKey);
  // A newer edit must never be overwritten by an older replay result.
  if (!draft || draft.operationId !== operationId) return;
  if (status === "synced" && removeOnSynced) {
    await db.formDrafts.delete(draftKey);
    return;
  }
  await db.formDrafts.update(draftKey, {
    status,
    updatedAt: Date.now(),
    lastError: error ?? null,
    ...(status === "synced" ? { operationId: null } : {}),
  });
}

export async function saveIdentityMapping(input: Omit<LocalIdentityMapping, "key" | "syncedAt">): Promise<void> {
  const key = `${input.userId}:${input.localEntityId}`;
  await db.localIdentityMappings.put({ ...input, key, syncedAt: Date.now() });
}

export async function getIdentityMapping(localEntityId: string, userId?: number): Promise<LocalIdentityMapping | undefined> {
  const id = requireUser(userId);
  return db.localIdentityMappings.get(`${id}:${localEntityId}`);
}

export async function resolveLocalEntityId(localEntityId: string, userId?: number): Promise<number | null> {
  return (await getIdentityMapping(localEntityId, userId))?.serverEntityId ?? null;
}