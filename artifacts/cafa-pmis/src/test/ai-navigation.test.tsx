import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { inferItemMeta, isRetiredNavigationPath } from "@/lib/recent-items";

let currentRole = "program_manager";

// Mirrors the AI-relevant slice of permissionsFor() in middlewares/currentUser.ts:
// super_admin gets everything via "*"; executive_director gets both
// ai.settings.manage and ai.logs.view; program_manager gets ai.logs.view only
// (monitoring oversight, no settings access); every other role gets neither.
function aiPermsForRole(role: string): string[] {
  if (role === "super_admin") return ["*"];
  if (role === "executive_director") return ["ai.settings.manage", "ai.logs.view"];
  if (role === "program_manager") return ["ai.logs.view"];
  return [];
}

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { user: { role: currentRole }, permissions: aiPermsForRole(currentRole) } }),
}));

vi.mock("@/components/ai-chat-widget", () => ({
  AIChatWidget: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="assistant" data-embedded={String(embedded)}>Assistant conversation</div>
  ),
}));

vi.mock("@/pages/ai-settings", () => ({
  AIAdministrationPanel: () => <div data-testid="administration">Administration controls</div>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      title: "AI",
      subtitle: "Ask anything about your programmes, projects, and data.",
      "workspace.assistantHeading": "Assistant",
      "workspace.administrationHeading": "Administration",
    }[key] ?? key),
  }),
}));

import AIPage from "@/pages/ai";

const root = join(process.cwd(), "src");
const app = readFileSync(join(root, "App.tsx"), "utf8");
const layout = readFileSync(join(root, "components/layout.tsx"), "utf8");
const palette = readFileSync(join(root, "components/command-palette.tsx"), "utf8");
const widget = readFileSync(join(root, "components/ai-chat-widget.tsx"), "utf8");
const enNav = JSON.parse(readFileSync(join(root, "locales/en/nav.json"), "utf8"));
const arNav = JSON.parse(readFileSync(join(root, "locales/ar/nav.json"), "utf8"));

describe("AI navigation consolidation", () => {
  it("uses /ai as the canonical route and safely redirects legacy settings bookmarks", () => {
    expect(app).toContain('<Route path="/ai"><AiPage /></Route>');
    expect(app).toContain('<Route path="/ai-settings"><Redirect to="/ai" /></Route>');
  });

  it("offers exactly one canonical AI destination in Administration and the command palette", () => {
    const administrationItems = layout.slice(
      layout.indexOf("const administrationItems"),
      layout.indexOf("const navEntries"),
    );
    const navEntries = layout.indexOf("const navEntries");
    const administrationStart = layout.indexOf('title: tNav("groups.administration")', navEntries);
    const administration = layout.slice(
      administrationStart,
      layout.indexOf('kind: "item"', administrationStart),
    );

    expect(administration).toContain("items: administrationItems");
    expect(administrationItems).toContain('href: "/ai"');
    expect(administrationItems).toContain('label: tNav("items.ai")');
    expect(administrationItems).not.toContain('open-ai-chat');
    expect((layout.match(/href: "\/ai"/g) ?? [])).toHaveLength(1);
    expect(layout).not.toContain('href: "/ai-settings"');
    expect(palette).toContain('id: "nav-/ai"');
    expect(palette).toContain('href: "/ai"');
    expect(palette).not.toContain('id: "nav-/ai-cfg"');
    expect(palette).not.toContain('id: "action-ai"');
  });

  it("keeps Administration child visibility independent while allowing authenticated AI access", () => {
    const administrationItems = layout.slice(
      layout.indexOf("const administrationItems"),
      layout.indexOf("const navEntries"),
    );
    const users = administrationItems.indexOf('href: "/users"');
    const states = administrationItems.indexOf('href: "/states"');
    const audit = administrationItems.indexOf('href: "/audit-log"');
    const ai = administrationItems.indexOf('href: "/ai"');

    expect(layout).toContain("const canViewAi = Boolean(meData?.user);");
    expect(administrationItems).toContain("...(hasUsersPerm");
    expect(administrationItems).toContain("...(isAuditVisible");
    expect(administrationItems).toContain("...(canViewAi");
    expect(users).toBeLessThan(states);
    expect(states).toBeLessThan(audit);
    expect(audit).toBeLessThan(ai);
    expect(administrationItems).not.toContain('href: "/manual"');
  });

  it("removes the retired group while keeping Manual standalone in every responsive sidebar mode", () => {
    expect(layout).not.toContain('groups.knowledgeSupport');
    expect(layout).not.toContain("Knowledge & Support");
    expect(enNav.groups.knowledgeSupport).toBeUndefined();
    expect(arNav.groups.knowledgeSupport).toBeUndefined();

    const navEntries = layout.indexOf("const navEntries");
    const administrationStart = layout.indexOf('title: tNav("groups.administration")', navEntries);
    const manualStart = layout.indexOf('kind: "item"', administrationStart);
    const administration = layout.slice(administrationStart, manualStart);
    const manualEntry = layout.slice(manualStart);
    expect(administration).not.toContain('href: "/manual"');
    expect(manualEntry).toContain('href: "/manual"');
    expect(manualEntry).toContain('label: tNav("items.systemManual")');
    expect(layout).toContain('{entry.kind === "group" && !sidebarCollapsed && (');
    expect(layout).toContain('{entry.kind === "group" && sidebarCollapsed && <div');
    expect(layout).toContain('href={item.href}');
    expect(layout).toContain('focus-visible:ring-2');
    expect((layout.match(/navEntries\.map/g) ?? []).length).toBe(1);
  });

  it("keeps canonical AI and Manual destinations available to saved navigation consumers", () => {
    expect(inferItemMeta("/ai")).toMatchObject({ iconKey: "ai", subtitle: "AI assistant and administration" });
    expect(inferItemMeta("/manual")).toMatchObject({ iconKey: "manual", subtitle: "System manual" });
    expect(isRetiredNavigationPath("/ai")).toBe(false);
    expect(isRetiredNavigationPath("/manual")).toBe(false);
    expect(palette).toContain('id: "nav-/manual"');
    expect(palette).toContain('href: "/manual"');
  });

  it("keeps the assistant available while hiding administration from a role with no AI permissions at all", () => {
    currentRole = "state_program_officer";
    render(<AIPage />);
    expect(screen.getByTestId("assistant")).toHaveAttribute("data-embedded", "true");
    expect(screen.queryByTestId("administration")).not.toBeInTheDocument();
  });

  it("shows administration to program_manager (ai.logs.view — monitoring oversight), matching the backend permission exactly", () => {
    currentRole = "program_manager";
    render(<AIPage />);
    expect(screen.getByTestId("assistant")).toHaveAttribute("data-embedded", "true");
    expect(screen.getByTestId("administration")).toBeInTheDocument();
  });

  it("keeps the embedded assistant's history control while restricting activation guidance to administrators", () => {
    expect(widget).toContain('{!minimized && enabled && (');
    expect(widget).toContain('{isAdminRole && (');
    expect(widget).toContain('AI → Administration');
  });

  it("shows the existing administration controls only to established AI administrators", () => {
    currentRole = "executive_director";
    render(<AIPage />);
    expect(screen.getByTestId("assistant")).toBeInTheDocument();
    expect(screen.getByTestId("administration")).toBeInTheDocument();
  });
});