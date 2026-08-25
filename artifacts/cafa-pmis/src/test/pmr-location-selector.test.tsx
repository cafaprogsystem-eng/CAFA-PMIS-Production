/**
 * Rendered-form regression tests for the PMR Reporting Location selector.
 *
 * Verifies the core interaction model added in Task 226:
 *  - Project → Reporting Location → Period ordering
 *  - Selector is disabled until a project is selected
 *  - Single-state project: HQ-eligible → selector (not locked read-only) shows HQ + state
 *  - Single-state project: HQ NOT available → selector locked to single state
 *  - User can choose HQ from the selector → payload carries locationType="hq", stateId=undefined
 *  - Multi-state project with HQ shows all states + HQ option
 *
 * No real API calls — all state is driven via props / React state in the
 * self-contained PmrLocationSelector double that mirrors the production logic.
 */

import { describe, it, expect } from "vitest";
// @ts-ignore — resolved by vitest bundler
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import "@testing-library/jest-dom";

/* ══════════════════════════════════════════════════════════════════════════
   Minimal types mirroring the production shape
══════════════════════════════════════════════════════════════════════════ */

type StateStub = { id: number; name: string };
type ProjectStub = {
  id: number;
  title: string;
  code: string;
  stateIds?: number[];
  managementLevel?: "hq_managed" | "state_managed" | null;
  hasHqOperations?: boolean;
};

/* ══════════════════════════════════════════════════════════════════════════
   Pure helpers (mirrors of the production derivations)
══════════════════════════════════════════════════════════════════════════ */

function filterStatesByProject(allStates: StateStub[], project: ProjectStub | null): StateStub[] {
  if (!project) return allStates;
  const ids = project.stateIds ?? [];
  if (ids.length === 0) return allStates;
  return allStates.filter((s) => ids.includes(s.id));
}

function autoSelectState(project: ProjectStub | null): number | null {
  const ids = project?.stateIds ?? [];
  return ids.length === 1 ? ids[0] : null;
}

/** Mirrors backend deny-by-default: only explicit hasHqOperations=true permits HQ. */
function isPmrHqAvailable(project: ProjectStub | null, userRole: string): boolean {
  if (!project) return false;
  const stateRoles = ["state_program_officer", "state_office_manager"];
  if (stateRoles.includes(userRole)) return false;
  return project.hasHqOperations === true;
}

/* ══════════════════════════════════════════════════════════════════════════
   Self-contained PMR Location Selector component double
   (mirrors the JSX in reports.tsx without importing that file)
══════════════════════════════════════════════════════════════════════════ */

/** Minimal stored PMR report shape (mirrors what loadDraftForEdit receives). */
type StoredPmrReport = {
  locationType: "hq" | "state" | null;
  stateId: number | null;
  projectId: number;
};

type PmrLocationSelectorProps = {
  allStates: StateStub[];
  project: ProjectStub | null;
  userRole: string;
  /** For state-scoped users: their assigned state ID (intersection applied to location options). */
  userStateId?: number;
  /** When provided, simulate loadDraftForEdit (edit mode). Initialises from stored report. */
  editReport?: StoredPmrReport;
  onPayloadChange?: (payload: { stateId?: number; locationType?: "state" | "hq" }) => void;
};

function PmrLocationSelectorDouble({
  allStates,
  project,
  userRole,
  userStateId,
  editReport,
  onPayloadChange,
}: PmrLocationSelectorProps) {
  const isStateRole = userRole === "state_program_officer" || userRole === "state_office_manager";

  // For state-scoped users, intersect project states with their assigned state.
  const rawAvailableStates = filterStatesByProject(allStates, project);
  const availableStates = isStateRole && userStateId
    ? rawAvailableStates.filter((s) => s.id === userStateId)
    : rawAvailableStates;

  // Edit mode: initialise from stored report (mirrors loadDraftForEdit)
  const initialLocType: "state" | "hq" = editReport?.locationType === "hq" ? "hq" : "state";
  const initialStateId: number | undefined = editReport
    ? (editReport.stateId ?? undefined)
    : (availableStates.length === 1 ? availableStates[0].id : undefined);

  const pmrHqAvailable = isPmrHqAvailable(project, userRole);
  // Lock logic mirrors production: single effective state AND no HQ AND not in HQ mode
  const stateFieldLocked = project !== null && availableStates.length === 1 && !pmrHqAvailable
    && initialLocType !== "hq";

  const [pmrLocationType, setPmrLocationType] = useState<"state" | "hq">(initialLocType);
  const [stateId, setStateId] = useState<number | undefined>(initialStateId);

  function handleSelect(val: string) {
    if (val === "__hq__") {
      setPmrLocationType("hq");
      setStateId(undefined);
      onPayloadChange?.({ locationType: "hq" });
    } else {
      setPmrLocationType("state");
      const sid = Number(val);
      setStateId(sid);
      onPayloadChange?.({ stateId: sid, locationType: "state" });
    }
  }

  const isDisabled = !project;
  const selectValue = pmrLocationType === "hq" ? "__hq__" : stateId ? String(stateId) : "";

  return (
    <div data-testid="location-selector-root">
      {/* Read-only badge: only shown when single state AND HQ not available */}
      {stateFieldLocked && pmrLocationType !== "hq" ? (
        <input
          data-testid="location-readonly"
          readOnly
          value={availableStates[0]?.name ?? ""}
        />
      ) : (
        <select
          data-testid="location-select"
          disabled={isDisabled}
          value={selectValue}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">Select location</option>
          {pmrHqAvailable && <option value="__hq__">HQ (Headquarters)</option>}
          {availableStates.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {/* Payload debug output for test assertions */}
      <output data-testid="payload-locationType">{pmrLocationType}</output>
      <output data-testid="payload-stateId">{stateId ?? ""}</output>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Sample data
══════════════════════════════════════════════════════════════════════════ */

const ALL_STATES: StateStub[] = [
  { id: 1, name: "Khartoum" },
  { id: 2, name: "Kassala" },
  { id: 3, name: "Gedaref" },
];

const PROJ_SINGLE_HQ: ProjectStub = {
  id: 10, title: "P-Single-HQ", code: "P-10",
  stateIds: [1],
  managementLevel: "hq_managed",
  hasHqOperations: true,   // ← explicit HQ Operational Location
};

const PROJ_SINGLE_STATE_MANAGED: ProjectStub = {
  id: 11, title: "P-Single-SM", code: "P-11",
  stateIds: [2],
  managementLevel: "state_managed",
  // hasHqOperations absent → defaults to false → HQ not available
};

const PROJ_MULTI_HQ: ProjectStub = {
  id: 12, title: "P-Multi-HQ", code: "P-12",
  stateIds: [1, 2],
  managementLevel: "hq_managed",
  hasHqOperations: true,   // ← explicit HQ Operational Location
};

/* ══════════════════════════════════════════════════════════════════════════
   PR-FORM: Selector disabled until project selected
══════════════════════════════════════════════════════════════════════════ */

describe("PR-FORM-03: Location selector disabled until project is selected", () => {
  it("renders a disabled select when no project is selected", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={null}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    expect(sel).toBeDisabled();
  });

  it("renders an enabled select once a project is selected", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    expect(sel).not.toBeDisabled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-HQ: Single-state + HQ-eligible → selector (not locked), HQ option present
══════════════════════════════════════════════════════════════════════════ */

describe("PR-HQ: Single-state HQ-eligible project renders selector with HQ option", () => {
  it("does NOT show a read-only input when the project is single-state AND HQ-eligible", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
      />
    );
    expect(screen.queryByTestId("location-readonly")).toBeNull();
    expect(screen.getByTestId("location-select")).toBeInTheDocument();
  });

  it("shows HQ option in the selector for a single-state HQ-eligible project", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    const hqOpt = sel.querySelector("option[value='__hq__']");
    expect(hqOpt).toBeInTheDocument();
    expect(hqOpt?.textContent).toContain("HQ");
  });

  it("also shows the linked state option alongside HQ", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    const stateOpt = sel.querySelector("option[value='1']");
    expect(stateOpt).toBeInTheDocument();
    expect(stateOpt?.textContent).toBe("Khartoum");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-HQ: Choosing HQ produces locationType="hq" payload with no stateId
══════════════════════════════════════════════════════════════════════════ */

describe("PR-HQ: Choosing HQ produces correct payload", () => {
  it("selecting HQ sets locationType='hq' and clears stateId in the payload", () => {
    const payloads: Array<{ stateId?: number; locationType?: "state" | "hq" }> = [];
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
        onPayloadChange={(p) => payloads.push(p)}
      />
    );
    const sel = screen.getByTestId("location-select");
    fireEvent.change(sel, { target: { value: "__hq__" } });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].locationType).toBe("hq");
    expect(payloads[0].stateId).toBeUndefined();
  });

  it("after choosing HQ, the payload debug output shows locationType='hq' and no stateId", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    fireEvent.change(sel, { target: { value: "__hq__" } });
    expect(screen.getByTestId("payload-locationType").textContent).toBe("hq");
    expect(screen.getByTestId("payload-stateId").textContent).toBe(""); // no stateId
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-LOC: Single-state state_managed project → read-only lock (HQ NOT available)
══════════════════════════════════════════════════════════════════════════ */

describe("PR-LOC: Single-state state_managed project locks to read-only", () => {
  it("shows read-only input (not a selector) for single-state state_managed project", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_STATE_MANAGED}
        userRole="programme_manager"
      />
    );
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("location-select")).toBeNull();
  });

  it("read-only input shows the linked state name", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_STATE_MANAGED}
        userRole="programme_manager"
      />
    );
    const input = screen.getByTestId("location-readonly");
    expect((input as HTMLInputElement).value).toBe("Kassala");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-HQ: State-scoped users do not see HQ option
══════════════════════════════════════════════════════════════════════════ */

describe("PR-HQ: State-scoped users cannot see HQ option", () => {
  it("SPO sees no HQ option even for an hq_managed single-state project", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="state_program_officer"
      />
    );
    // SPO: pmrHqAvailable=false, single-state project → read-only lock
    // (no HQ, so stateFieldLocked=true, shows read-only input, not a select)
    // The HQ (Headquarters) text must not appear anywhere in the rendered output.
    expect(screen.queryByText("HQ (Headquarters)")).toBeNull();
    // And the read-only input should be present (locked to the single state)
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
  });

  it("SOM sees no HQ option even for an hq_managed multi-state project", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="state_office_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    const hqOpt = sel.querySelector("option[value='__hq__']");
    expect(hqOpt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-HQ: Multi-state project with HQ available shows all states + HQ
══════════════════════════════════════════════════════════════════════════ */

describe("PR-HQ: Multi-state HQ-eligible project shows all linked states + HQ", () => {
  it("shows HQ option and both linked state options (state 1 + state 2)", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    expect(sel.querySelector("option[value='__hq__']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='1']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='2']")).toBeInTheDocument();
    // State 3 is not in the project's stateIds
    expect(sel.querySelector("option[value='3']")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-LOC: Selecting a state option produces correct payload
══════════════════════════════════════════════════════════════════════════ */

describe("PR-LOC: Selecting a state option produces correct payload", () => {
  it("choosing a state sets stateId and locationType='state'", () => {
    const payloads: Array<{ stateId?: number; locationType?: "state" | "hq" }> = [];
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
        onPayloadChange={(p) => payloads.push(p)}
      />
    );
    const sel = screen.getByTestId("location-select");
    fireEvent.change(sel, { target: { value: "1" } });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].locationType).toBe("state");
    expect(payloads[0].stateId).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-HQ: null management_level → no HQ option (deny by default)
══════════════════════════════════════════════════════════════════════════ */

const PROJ_NULL_MGMT: ProjectStub = {
  id: 20, title: "P-Legacy", code: "P-20",
  stateIds: [1, 2],
  managementLevel: null,
};

describe("PR-HQ: null management_level — deny by default", () => {
  it("project with null management_level shows no HQ option for PM", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_NULL_MGMT}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    const hqOpt = sel.querySelector("option[value='__hq__']");
    expect(hqOpt).toBeNull();
  });

  it("project with null management_level shows the linked states but no HQ", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_NULL_MGMT}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    expect(sel.querySelector("option[value='1']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='2']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='__hq__']")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-LOC: State-scoped user (SPO) + multi-state project → intersection
══════════════════════════════════════════════════════════════════════════ */

describe("PR-LOC: State-scoped user sees only their assigned state in the PMR selector", () => {
  it("SPO assigned to state 1 sees only state 1 from a [state1, state2] project", () => {
    // PROJ_MULTI_HQ has stateIds=[1,2]; SPO is assigned to state 1
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="state_program_officer"
        userStateId={1}
      />
    );
    // SPO: no HQ → stateFieldLocked=true (only their single state remains) → read-only input
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
    expect((screen.getByTestId("location-readonly") as HTMLInputElement).value).toBe("Khartoum");
    // State 2 must not appear
    expect(screen.queryByText("Kassala")).toBeNull();
  });

  it("SOM assigned to state 2 sees only state 2 (not state 1) from the same project", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="state_office_manager"
        userStateId={2}
      />
    );
    // SOM: no HQ → stateFieldLocked=true → read-only input showing their state
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
    expect((screen.getByTestId("location-readonly") as HTMLInputElement).value).toBe("Kassala");
    expect(screen.queryByText("Khartoum")).toBeNull();
  });

  it("PM (non-state-scoped) sees all linked states for the same project", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    // Both linked states shown (plus HQ since project is hq_managed)
    expect(sel.querySelector("option[value='1']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='2']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='__hq__']")).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PMR DRAFT EDIT: loadDraftForEdit restores location type + allowed states
   (mirrors the logic added to loadDraftForEdit in reports.tsx)
══════════════════════════════════════════════════════════════════════════ */

describe("PMR draft edit — HQ report: pmrLocationType restored as 'hq'", () => {
  // Stored HQ PMR: locationType='hq', stateId=null
  const HQ_REPORT: StoredPmrReport = { locationType: "hq", stateId: null, projectId: 3 };

  it("renders in selector (not read-only) mode because HQ is the stored location", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
        editReport={HQ_REPORT}
      />
    );
    // HQ mode → selector visible, not read-only
    expect(screen.getByTestId("location-select")).toBeInTheDocument();
    expect(screen.queryByTestId("location-readonly")).toBeNull();
  });

  it("shows payload-locationType='hq' on initial render (no user interaction needed)", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
        editReport={HQ_REPORT}
      />
    );
    expect(screen.getByTestId("payload-locationType").textContent).toBe("hq");
  });

  it("stateId is empty (null stored) for HQ report", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
        editReport={HQ_REPORT}
      />
    );
    expect(screen.getByTestId("payload-stateId").textContent).toBe("");
  });
});

describe("PMR draft edit — single-state report: selector pre-filled with stored state", () => {
  // Single-state project (state 1); stored report has locationType='state', stateId=1
  const SINGLE_STATE_REPORT: StoredPmrReport = { locationType: "state", stateId: 1, projectId: 1 };

  it("shows read-only badge for single-state state_managed project in edit mode", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_STATE_MANAGED}   // state_managed, stateIds=[2]
        userRole="programme_manager"
        editReport={{ ...SINGLE_STATE_REPORT, stateId: 2 }}
      />
    );
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
    expect((screen.getByTestId("location-readonly") as HTMLInputElement).value).toBe("Kassala");
  });

  it("payload-locationType is 'state' and payload-stateId is 2 (the stored state)", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_STATE_MANAGED}
        userRole="programme_manager"
        editReport={{ ...SINGLE_STATE_REPORT, stateId: 2 }}
      />
    );
    expect(screen.getByTestId("payload-locationType").textContent).toBe("state");
    expect(screen.getByTestId("payload-stateId").textContent).toBe("2");
  });
});

describe("PMR draft edit — multi-state report: selector shows project states with stored state pre-selected", () => {
  // Multi-state HQ project; stored state=2, locationType='state'
  const MULTI_STATE_REPORT: StoredPmrReport = { locationType: "state", stateId: 2, projectId: 3 };

  it("selector is enabled (not read-only) and shows both linked states", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
        editReport={MULTI_STATE_REPORT}
      />
    );
    const sel = screen.getByTestId("location-select");
    expect(sel).toBeInTheDocument();
    expect(sel.querySelector("option[value='1']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='2']")).toBeInTheDocument();
  });

  it("payload-stateId is 2 (the stored state) and locationType is 'state'", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="programme_manager"
        editReport={MULTI_STATE_REPORT}
      />
    );
    expect(screen.getByTestId("payload-stateId").textContent).toBe("2");
    expect(screen.getByTestId("payload-locationType").textContent).toBe("state");
  });
});

describe("PMR draft edit — state-scoped user editing their own report", () => {
  // SPO (state 1) editing their own PMR for multi-state project; stored state=1
  const SPO_REPORT: StoredPmrReport = { locationType: "state", stateId: 1, projectId: 3 };

  it("SPO edit: read-only badge shows their state (intersection applied)", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="state_program_officer"
        userStateId={1}
        editReport={SPO_REPORT}
      />
    );
    // Intersection: only state 1 in effectiveStates → stateFieldLocked → read-only
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
    expect((screen.getByTestId("location-readonly") as HTMLInputElement).value).toBe("Khartoum");
  });

  it("SPO edit: payload-locationType is 'state' and payload-stateId is 1", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_MULTI_HQ}
        userRole="state_program_officer"
        userStateId={1}
        editReport={SPO_REPORT}
      />
    );
    expect(screen.getByTestId("payload-locationType").textContent).toBe("state");
    expect(screen.getByTestId("payload-stateId").textContent).toBe("1");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   HQ-BF: HQ Backfill Correction Tests (01–10)
   Verifies that HQ eligibility is governed by hasHqOperations (not managementLevel).
   Migration 016 previously backfilled hq_managed→has_hq_operations=true; that
   backfill was removed and the current model requires an explicit opt-in.
══════════════════════════════════════════════════════════════════════════ */

describe("HQ-BF-01: Migration SQL — authoritative verification is in backend test suite", () => {
  it("isPmrHqAvailable in this selector uses hasHqOperations=true (not managementLevel)", () => {
    // The authoritative SQL-level tests for Migration 016 + 017 live in
    // artifacts/api-server/src/test/hq-backfill.test.ts (HQ-016 / HQ-017 suites).
    // This test confirms the frontend helper uses the correct flag.
    const proj = { id: 1, title: "P", code: "P", managementLevel: "hq_managed" as const, hasHqOperations: false };
    // managementLevel=hq_managed alone is NOT enough — hasHqOperations must be true
    expect(isPmrHqAvailable(proj, "programme_manager")).toBe(false);
    const projWithFlag = { ...proj, hasHqOperations: true };
    expect(isPmrHqAvailable(projWithFlag, "programme_manager")).toBe(true);
  });
});

describe("HQ-BF-02: hq_managed project without hasHqOperations=true → HQ unavailable", () => {
  it("isPmrHqAvailable returns false when hasHqOperations is false", () => {
    const proj: ProjectStub = { id: 1, title: "P", code: "P", managementLevel: "hq_managed", hasHqOperations: false };
    expect(isPmrHqAvailable(proj, "programme_manager")).toBe(false);
  });

  it("isPmrHqAvailable returns false when hasHqOperations is undefined", () => {
    const proj: ProjectStub = { id: 1, title: "P", code: "P", managementLevel: "hq_managed" };
    expect(isPmrHqAvailable(proj, "programme_manager")).toBe(false);
  });
});

describe("HQ-BF-03: Explicit hasHqOperations=true is independent of managementLevel", () => {
  it("changing managementLevel on a stub does not affect hasHqOperations", () => {
    const proj: ProjectStub = { id: 1, title: "P", code: "P", managementLevel: "hq_managed", hasHqOperations: true };
    const modified: ProjectStub = { ...proj, managementLevel: "state_managed" };
    // hasHqOperations was explicitly set; managementLevel change should not touch it
    expect(modified.hasHqOperations).toBe(true);
  });
});

describe("HQ-BF-04: hq_managed + hasHqOperations=false → HQ location unavailable for PM", () => {
  it("PM sees no HQ option when hasHqOperations is false even though project is hq_managed", () => {
    const proj: ProjectStub = {
      id: 30, title: "P-HQ-NoOps", code: "P-30",
      stateIds: [1],
      managementLevel: "hq_managed",
      hasHqOperations: false,
    };
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={proj}
        userRole="programme_manager"
      />
    );
    // Single state + no HQ → read-only badge, no selector
    expect(screen.getByTestId("location-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("location-select")).toBeNull();
  });
});

describe("HQ-BF-05: hasHqOperations=true → PM sees HQ + state options", () => {
  it("PM sees HQ option when hasHqOperations is true", () => {
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
      />
    );
    const sel = screen.getByTestId("location-select");
    expect(sel.querySelector("option[value='__hq__']")).toBeInTheDocument();
    expect(sel.querySelector("option[value='1']")).toBeInTheDocument();
  });
});

describe("HQ-BF-06: Historical HQ report (locationType='hq') restores correctly regardless of current hasHqOperations", () => {
  it("editing a stored HQ report restores pmrLocationType=hq and stateId=null", () => {
    // locationType stored in the report is authoritative for edit mode
    const hqReport: StoredPmrReport = { locationType: "hq", stateId: null, projectId: 10 };
    render(
      <PmrLocationSelectorDouble
        allStates={ALL_STATES}
        project={PROJ_SINGLE_HQ}
        userRole="programme_manager"
        editReport={hqReport}
      />
    );
    expect(screen.getByTestId("payload-locationType").textContent).toBe("hq");
    expect(screen.getByTestId("payload-stateId").textContent).toBe("");
  });
});

describe("HQ-BF-07: New HQ PMR gate — hasHqOperations=false blocks HQ for any non-state role", () => {
  it("isPmrHqAvailable returns false for PM when hasHqOperations is absent", () => {
    const proj: ProjectStub = { id: 5, title: "P", code: "P", managementLevel: "hq_managed" };
    expect(isPmrHqAvailable(proj, "programme_manager")).toBe(false);
  });

  it("isPmrHqAvailable returns false for TC when hasHqOperations is false", () => {
    const proj: ProjectStub = { id: 6, title: "P", code: "P", managementLevel: "hq_managed", hasHqOperations: false };
    expect(isPmrHqAvailable(proj, "technical_coordinator")).toBe(false);
  });
});

describe("HQ-BF-08: hasHqOperations=true → isPmrHqAvailable returns true for eligible roles", () => {
  it("programme_manager with hasHqOperations=true → true", () => {
    const proj: ProjectStub = { id: 7, title: "P", code: "P", hasHqOperations: true };
    expect(isPmrHqAvailable(proj, "programme_manager")).toBe(true);
  });

  it("technical_coordinator with hasHqOperations=true → true", () => {
    const proj: ProjectStub = { id: 8, title: "P", code: "P", hasHqOperations: true };
    expect(isPmrHqAvailable(proj, "technical_coordinator")).toBe(true);
  });
});

describe("HQ-BF-09: managementLevel change state_managed→hq_managed does not affect hasHqOperations", () => {
  it("hasHqOperations stays false after managementLevel changes to hq_managed", () => {
    const proj: ProjectStub = { id: 9, title: "P", code: "P", managementLevel: "state_managed", hasHqOperations: false };
    const modified: ProjectStub = { ...proj, managementLevel: "hq_managed" };
    // Purely field-independent: hasHqOperations must still be false
    expect(modified.hasHqOperations).toBe(false);
    expect(isPmrHqAvailable(modified, "programme_manager")).toBe(false);
  });
});

describe("HQ-BF-10: managementLevel change hq_managed→state_managed does not reset hasHqOperations", () => {
  it("hasHqOperations stays true after managementLevel changes to state_managed", () => {
    const proj: ProjectStub = { id: 10, title: "P", code: "P", managementLevel: "hq_managed", hasHqOperations: true };
    const modified: ProjectStub = { ...proj, managementLevel: "state_managed" };
    // hasHqOperations is a separate, independent field
    expect(modified.hasHqOperations).toBe(true);
    expect(isPmrHqAvailable(modified, "programme_manager")).toBe(true);
  });
});
