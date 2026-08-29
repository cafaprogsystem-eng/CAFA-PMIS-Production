/**
 * USER-VIS sentinels for the administration workspace and Arabic namespace.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/users.tsx", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/users.json", "utf8")) as Record<string, unknown>;
const ar = JSON.parse(readFileSync("src/locales/ar/users.json", "utf8")) as Record<string, unknown>;

function leaves(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? leaves(item as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("USER-VIS: localised, accessible administrative directory", () => {
  it("keeps the Arabic namespace structurally complete with non-empty translations", () => {
    const enKeys = leaves(en).sort();
    const arKeys = leaves(ar).sort();
    expect(arKeys).toEqual(enKeys);
    for (const key of arKeys) {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], ar);
      expect(typeof value).toBe("string");
      expect((value as string).trim()).not.toBe("");
    }
  });

  it("routes user-management API errors through locale keys rather than English message maps", () => {
    expect(page).toContain("localizeUserApiError(t, code)");
    expect(page).not.toContain("USER_ERROR_MESSAGES");
    expect(page).not.toContain("humanizeApiError");
  });

  it("uses translated role labels and exposes filters, pagination and a deactivation confirmation", () => {
    expect(page).toContain("t(`roles.${r.value}`)");
    expect(page).toContain("p.sector = sector");
    expect(page).toContain("p.limit = pageSize");
    expect(page).toContain('t("pagination.next")');
    expect(page).toContain("deactivateDialog.description");
    expect(page).toContain('aria-label={t("ariaLabel.actionsFor"');
    expect(page).toContain("start-2.5");
  });

  it("uses the States array and generated invitation paging contract", () => {
    expect(page).toContain("deriveStateReferenceData(statesQuery)");
    expect(page).toContain('status={stateReference.status}');
    expect(page).not.toContain('value="none">{t("userForm.noneHQ")}');
    expect(page).not.toContain('<Field label="Office Location">');
    expect(page).toContain("useListUserInvitations(params)");
    expect(page).toContain("limit: 25, offset");
    expect(page).toContain("data.nextOffset");
    expect(page).toContain("data.summary.total");
    expect(page).toContain("data.summary.pending");
    expect(page).toContain("data.summary.accepted");
    expect(page).toContain("data.summary.expired");
    expect(page).toContain("data.summary.cancelled");
  });

  it("keeps the actionable table as the only All Users registry presentation", () => {
    expect(page).toContain('className="table-scroll"');
    expect(page).toContain('className="min-w-[1190px]"');
    expect(page).toContain('aria-label={t("ariaLabel.usersTable")}');
    expect(page).toContain('t("presence.header")');
    expect(page).toContain("PresenceValue");
    expect(page).toContain('socket.on("presence:update", onPresenceUpdate)');
    expect(page).not.toContain("conversation:presence");
    expect(page).toContain("aria-pressed={active}");
    expect(page).toContain("aria-pressed={role === r.role}");
    expect(page).toContain("aria-pressed={stateId === String(s.stateId)}");
    expect(page).not.toContain("ViewModeSwitcher");
    expect(page).not.toContain("CardGrid");
    expect(page).not.toContain("ListView");
    expect(page).not.toContain("CompactView");
    expect(page).not.toContain("useViewMode");
  });

  it("uses compact, responsive summary hooks and Title Case English headings", () => {
    expect(page).toContain("grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4");
    expect(page).toContain("min-w-0 max-w-full");
    expect(en.usersByState).toBe("Users by State");
    expect(en.subtitle).toContain("CAFA staff accounts");
  });

  it("keeps invitation lifecycle, delivery and account status separate", () => {
    expect(page).toContain('t("invites.searchPlaceholder")');
    expect(page).toContain('t("invites.emailStatusBadge.pending")');
    expect(page).toContain('t("invites.lifecycle.accepted"');
    expect(page).toContain('t("invites.lifecycle.expires"');
    expect(page).toContain('t("invites.lifecycle.unavailable")');
    expect(page).toContain('t(`roles.${row.role}`, { defaultValue: row.role })');
    expect(page).toContain('title={t("invites.couldNotLoad")}');
    expect(page).toContain('t("invites.noFilteredInvitations")');
    expect(page).toContain('onClick={resetFilters}');
    expect(page).toContain('body.emailDelivery === "failed"');
    expect(page).toContain('t("invites.deliveryFailed")');
    expect(page).toContain('inviteLinkFor?.emailDelivery === "pending"');
    expect(page).toContain('inviteLinkFor?.emailDelivery === "failed"');
    expect(page).not.toContain("pendingActivation");
    expect(page).not.toContain("accountActive");
  });

  it("keeps the reset registry compact, truthful, filterable and accessible", () => {
    for (const fragment of [
      "p.limit = String(pageSize)",
      "p.offset = String(offset)",
      "setSearch(e.target.value); resetPage();",
      "setFilterStatus(value); resetPage();",
      "setFilterSource(value); resetPage();",
      "resetLifecycleValue(tok)",
      'if (token.status === "active" && token.resolvedAt) return token.resolvedAt;',
      "case \"used\": return token.usedAt;",
      "case \"revoked\": return token.revokedAt;",
      "case \"expired\": return token.expiresAt;",
      "EmailDeliveryBadge status={tok.emailStatus}",
      'role="region" tabIndex={0}',
      "passwordReset.loadFailed.title",
      "passwordReset.noResults",
      "md:grid-cols-[minmax(0,2fr)_minmax(11rem,1fr)_minmax(11rem,1fr)]",
    ]) expect(page).toContain(fragment);

    expect(page).toContain('t("passwordReset.tableHeaders.expiryResolution")');
    expect(page).not.toContain('t("passwordReset.tableHeaders.handledBy")');
    expect(page).not.toContain('t("passwordReset.tableHeaders.resolved")');
    expect(page).not.toContain('t("passwordReset.tableHeaders.role")');
  });

  it("keeps compact registry language labels complete in English and Arabic", () => {
    const english = en.passwordReset as Record<string, unknown>;
    const arabic = ar.passwordReset as Record<string, unknown>;
    expect(arabic.noResults).toEqual(expect.any(String));
    expect(english.noResults).toEqual(expect.any(String));
    for (const key of ["loadFailed", "statLabels", "filterStatus", "filterSource", "tableHeaders"]) {
      expect(arabic[key]).toEqual(expect.any(Object));
      expect(english[key]).toEqual(expect.any(Object));
    }
    expect((english.tableHeaders as Record<string, string>).expiryResolution).toBe("Expiry / Resolution");
    expect((arabic.tableHeaders as Record<string, string>).expiryResolution).toBe("الانتهاء / الحل");
  });
});
