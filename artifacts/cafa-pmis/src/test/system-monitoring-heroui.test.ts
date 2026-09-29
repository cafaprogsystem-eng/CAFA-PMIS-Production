/**
 * System Monitoring (email log + presence) on HeroUI. The first version (merged
 * from main) used shadcn and lucide directly, dropped the live presence
 * listener when presence moved here from Users, showed English relative times
 * and raw role codes in Arabic, and searched on every keystroke.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/system-monitoring.tsx", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/settings.json", "utf8")).systemMonitoring;
const ar = JSON.parse(readFileSync("src/locales/ar/settings.json", "utf8")).systemMonitoring;

describe("SYSTEM-MONITORING-HEROUI", () => {
  it("uses HeroUI / Pro components and the Gravity icon module only", () => {
    expect(page).not.toMatch(/from "lucide-react"|@\/components\/ui\/(card|badge|button|input|table|select|tabs|skeleton)"/);
    expect(page).toContain('from "@heroui-pro/react/data-grid"');
    expect(page).toContain("<FilterKpi");
    expect(page).toContain("<RegistryPagination");
  });

  it("keeps presence live after it moved here from Users", () => {
    expect(page).toContain('socket.on("presence:update"');
    expect(page).toContain('socket.off("presence:update"');
  });

  it("KPIs are exact server totals and filter the log", () => {
    expect(page).toContain("STATUSES.map((s) => fetchEmailLogs({ ...base, status: s }))");
    expect(page).toContain('pressed={status === "failed"} onToggle={() => toggleStatus("failed")}');
  });

  it("pages on the server and waits for typing to pause", () => {
    expect(page).toContain("offset: String(offset)");
    expect(page).toContain("useDebounced(searchInput.trim())");
  });

  it("relative times, roles and States follow the interface language", () => {
    expect(page).not.toContain("formatDistanceToNow");
    expect(page).toContain('"ar-u-nu-latn"');
    expect(page).toContain("t(`users:roles.${u.role}`");
    expect(page).toContain("getLinkedStateLabel(u, i18n.language)");
  });

  it("every email type has a label in both languages, and Arabic says البريد الإلكتروني", () => {
    expect(Object.keys(ar.emailTypes).sort()).toEqual(Object.keys(en.emailTypes).sort());
    expect(JSON.stringify(ar)).not.toContain("إيميل");
  });
});
