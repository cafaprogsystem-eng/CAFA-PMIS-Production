import { describe, expect, it, vi } from "vitest";
import { deriveStateReferenceData } from "@/lib/state-reference-data";

const state = {
  id: 1,
  name: "Khartoum",
  nameAr: "الخرطوم",
  code: "SD-KH",
  operationalStatus: "active" as const,
  officeStatus: "unknown" as const,
  officeAddress: null,
  managerName: null,
  localitiesCount: 0,
};

describe("State reference-data contract", () => {
  it.each([
    [{ isLoading: true, isError: false, isSuccess: false, data: undefined }, "loading"],
    [{ isLoading: false, isError: true, isSuccess: false, data: undefined }, "error"],
    [{ isLoading: false, isError: false, isSuccess: true, data: [] }, "empty"],
    [{ isLoading: false, isError: false, isSuccess: true, data: [state] }, "ready"],
  ] as const)("preserves query lifecycle state as %s", (query, expected) => {
    const result = deriveStateReferenceData({ ...query, refetch: vi.fn() });
    expect(result.status).toBe(expected);
    expect(result.isReady).toBe(expected === "ready");
    expect(result.states).toEqual(query.data ?? []);
  });
});