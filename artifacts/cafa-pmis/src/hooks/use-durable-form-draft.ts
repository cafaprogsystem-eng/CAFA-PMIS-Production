import { useEffect, useRef, useState } from "react";
import type { FormDraftModule, FormDraftScope } from "@/lib/offline/db";
import {
  getFormDraft, makeDraftKey, makeLocalEntityId, removeFormDraft, saveFormDraft,
  type DraftStatus,
} from "@/lib/offline/draft-store";

interface UseDurableFormDraftOptions<T> {
  enabled: boolean;
  userId?: number;
  module: FormDraftModule;
  recordKey: string;
  label: string;
  value: T;
  scope?: Partial<FormDraftScope>;
  onRecover: (value: T) => void;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Saves only the caller-provided operational form shape. The hook deliberately
 * knows nothing about APIs, files, or workflow transitions, so it cannot turn
 * an in-progress form into an unsafe offline transaction.
 */
export function useDurableFormDraft<T>({
  enabled, userId, module, recordKey, label, value, scope, onRecover,
}: UseDurableFormDraftOptions<T>) {
  const [status, setStatus] = useState<DraftStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recovered = useRef(false);
  const localEntityId = useRef<string | null>(null);
  const valueRef = useRef(value);
  const persistedValueKey = useRef<string | null>(null);
  valueRef.current = value;
  const valueKey = JSON.stringify(value);

  useEffect(() => {
    recovered.current = false;
    setStatus(null);
    setError(null);
    if (!enabled || !userId) return;
    if (!hasIndexedDb()) {
      recovered.current = true;
      return;
    }
    let active = true;
    void getFormDraft(module, recordKey, userId).then((draft) => {
      if (!active || !draft) {
        recovered.current = true;
        return;
      }
      try {
        localEntityId.current = draft.localEntityId;
        onRecover(JSON.parse(draft.payload) as T);
        persistedValueKey.current = draft.payload;
        setStatus(draft.status);
        setError(draft.lastError);
      } catch {
        setError("This local draft could not be recovered.");
      } finally {
        recovered.current = true;
      }
    });
    return () => { active = false; };
  // A form is intentionally reloaded only when its owner/identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, module, recordKey]);

  useEffect(() => {
    if (!enabled || !userId || !recovered.current || !hasIndexedDb()) return;
    // Recovery itself is not an edit. Do not accidentally detach a queue
    // operation from the exact snapshot it was created to replay.
    if (persistedValueKey.current === valueKey) return;
    const timeout = window.setTimeout(() => {
      void saveFormDraft({
        userId, module, recordKey, label,
        localEntityId: localEntityId.current ??= makeLocalEntityId(module),
        payload: valueRef.current, scope,
        // A changed payload is a new local revision, not part of the older
        // queued operation. Its result must therefore not settle this draft.
        status: "local-draft",
        operationId: null,
      }).then((draft) => {
        persistedValueKey.current = draft.payload;
        setStatus(draft.status);
        setError(draft.lastError);
      }).catch(() => setError("This device could not save the local draft."));
    }, 750);
    return () => window.clearTimeout(timeout);
  }, [enabled, userId, module, recordKey, label, valueKey, scope, status]);

  return {
    status,
    error,
    draftKey: userId ? makeDraftKey(userId, module, recordKey) : null,
    saveNow: async (nextValue = valueRef.current) => {
      if (!userId || !hasIndexedDb()) return null;
      const draft = await saveFormDraft({
        userId, module, recordKey, label,
        localEntityId: localEntityId.current ??= makeLocalEntityId(module),
        payload: nextValue, scope,
        status: "local-draft",
        operationId: null,
      });
      persistedValueKey.current = draft.payload;
      setStatus(draft.status);
      setError(draft.lastError);
      return draft;
    },
    clear: async () => {
      if (!userId || !hasIndexedDb()) return;
      await removeFormDraft(module, recordKey, userId);
      localEntityId.current = null;
      setStatus(null);
      setError(null);
    },
    getLocalEntityId: () => localEntityId.current,
  };
}