import type { StateRecord } from "@workspace/api-client-react";

export type StateReferenceStatus = "loading" | "error" | "empty" | "ready";

type StateQueryLike = {
  data?: StateRecord[];
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
};

export type StateReferenceData = {
  states: StateRecord[];
  status: StateReferenceStatus;
  isReady: boolean;
  retry: () => Promise<unknown>;
};

export function deriveStateReferenceData(query: StateQueryLike): StateReferenceData {
  const states = Array.isArray(query.data) ? query.data : [];
  const status: StateReferenceStatus = query.isLoading
    ? "loading"
    : query.isError
      ? "error"
      : query.isSuccess && states.length === 0
        ? "empty"
        : query.isSuccess
          ? "ready"
          : "loading";

  return {
    states,
    status,
    isReady: status === "ready",
    retry: query.refetch,
  };
}