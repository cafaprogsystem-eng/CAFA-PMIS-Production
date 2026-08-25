import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockWarn } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
}));

vi.mock("./logger", () => ({
  logger: { warn: mockWarn },
}));

import {
  isPlaceholderLikeDonorName,
  runProjectDataIntegrityScan,
  scanFocusedProjectDonors,
  validateDonorName,
} from "./projectDataIntegrity";

beforeEach(() => {
  mockQuery.mockReset();
  mockWarn.mockReset();
});

describe("project donor integrity", () => {
  it("identifies placeholder donor values without rejecting legitimate acronyms", () => {
    expect(isPlaceholderLikeDonorName("hrthtrhtrhtr")).toBe(true);
    expect(isPlaceholderLikeDonorName("TBD")).toBe(true);
    expect(isPlaceholderLikeDonorName("AAAA")).toBe(true);
    expect(isPlaceholderLikeDonorName("UNICEF")).toBe(false);
    expect(isPlaceholderLikeDonorName("WFP")).toBe(false);
  });

  it("returns a field-safe rejection for supplied placeholder data", () => {
    expect(validateDonorName("placeholder")).toEqual({
      ok: false,
      error: "placeholder_donor",
      message: "Enter a confirmed donor organisation or select a registered donor.",
    });
  });

  it("logs only existing projects that need authorised administrator review", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 68,
          code: "CAFA-PROJ-2026-007",
          title: "Draft project",
          status: "draft",
          donor: "hrthtrhtrhtr",
          donor_id: null,
          budget_total: "0",
          currency: "USD",
        },
        {
          id: 69,
          code: "CAFA-PROJ-2026-008",
          title: "Valid project",
          status: "draft",
          donor: "UNICEF",
          donor_id: null,
          budget_total: "0",
          currency: "USD",
        },
      ],
    });

    await runProjectDataIntegrityScan();

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("FROM projects"));
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        projects: [expect.objectContaining({ id: 68, donor: "hrthtrhtrhtr" })],
      }),
      expect.stringContaining("authorised administrator review"),
    );
  });

  it("scans only submitted, approved, and active confirmed placeholders without flagging Unknown or legitimate names", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 19, code: "CAFA-MPLQLM3M", title: "Submitted legacy project",
          status: "submitted", donor: "Test", donor_id: null, donor_registry_name: null,
          budget_total: "50000", currency: "USD",
        },
        {
          id: 20, code: "CAFA-PROJ-2026-020", title: "Explicitly unconfirmed",
          status: "approved", donor: "Unknown", donor_id: null, donor_registry_name: null,
          budget_total: "0", currency: "USD",
        },
        {
          id: 21, code: "CAFA-PROJ-2026-021", title: "Legitimate acronym",
          status: "active", donor: "WFP", donor_id: null, donor_registry_name: null,
          budget_total: "0", currency: "USD",
        },
        {
          id: 22, code: "CAFA-PROJ-2026-022", title: "Linked donor",
          status: "active", donor: "Test", donor_id: 7, donor_registry_name: "Test Foundation",
          budget_total: "0", currency: "USD",
        },
        {
          id: 23, code: "CAFA-PROJ-2026-023", title: "Linked Unknown donor",
          status: "active", donor: "Unknown", donor_id: 8, donor_registry_name: "Unknown Foundation",
          budget_total: "0", currency: "USD",
        },
      ],
    });

    const scan = await scanFocusedProjectDonors();

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("p.status IN ('submitted', 'approved', 'active')"));
    expect(scan.confirmedPlaceholders).toEqual([
      expect.objectContaining({
        id: 19,
        donor: "Test",
        classification: "confirmed_placeholder",
        provenance: "unlinked_free_text",
      }),
    ]);
    expect(scan.explicitMissingDonors).toEqual([
      expect.objectContaining({
        id: 20,
        donor: "Unknown",
        classification: "explicit_missing_donor",
        provenance: "explicit_missing_marker",
      }),
    ]);
  });
});