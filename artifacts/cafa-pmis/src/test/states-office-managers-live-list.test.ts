/**
 * STATES-OFFICE-MANAGERS-LIVE-LIST — states.manager_user_id was schema-defined
 * and displayed as "read-only" in two UI locations, but written by zero code
 * paths anywhere in the system: managerName was permanently null for every
 * State, forever. Investigation found more than one active
 * state_office_manager user CAN be assigned to the same State at once (no
 * uniqueness constraint prevents it), so a single manager_user_id foreign
 * key could never represent that correctly in the first place. Business
 * decision: don't add or use manager_user_id at all — resolve every active
 * State Office Manager for a State live from users and list them all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const statesSrc = readFileSync(resolve(__dirname, "../pages/states.tsx"), "utf8");
const detailSrc = readFileSync(resolve(__dirname, "../pages/state-detail.tsx"), "utf8");

describe("STATES-OFFICE-MANAGERS-LIVE-LIST", () => {
  it("officeManagerLabel renders every manager's name, joined, or the fallback when empty", () => {
    expect(statesSrc).toContain("function officeManagerLabel(managers: Array<{ id: number; name: string }> | undefined, fallback: string): string {");
    expect(statesSrc).toContain("return managers.map((manager) => manager.name).join(\", \");");
  });

  it("no rendering site still reads the dead managerName field", () => {
    expect(statesSrc).not.toContain("managerName");
    expect(detailSrc).not.toContain("managerName");
  });

  it("the desktop table, mobile card, and edit dialog all use officeManagerLabel", () => {
    const callSites = [...statesSrc.matchAll(/\{officeManagerLabel\(/g)];
    expect(callSites.length).toBe(3);
  });

  it("state-detail.tsx renders the full officeManagers list, not a single name", () => {
    expect(detailSrc).toContain("data.officeManagers.length > 0 ? data.officeManagers.map((manager) => manager.name).join(\", \") : t(\"stateDetailPage.noManager\")");
  });

  it("the search filter includes every office manager's name, not a single managerName field", () => {
    expect(statesSrc).toContain("...(state.officeManagers?.map((manager) => manager.name) ?? [])");
  });
});
