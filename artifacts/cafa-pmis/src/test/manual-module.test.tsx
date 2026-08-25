/**
 * Regression tests for Task 708 — System Manual rebuild
 *
 * Covers:
 *   (a) System Manual is standalone, Knowledge & Support not restored
 *   (b) Design System is not a PMIS module in the Manual
 *   (c) AI documentation links to /ai* (not /ai-settings)
 *   (d) Obsolete terminology absent from Manual UI
 *   (e) Correct terminology present
 *   (f) Search functionality (results + empty state)
 *   (g) Topic deep-link (/manual/:slug) renders correct chapter
 *   (h) Invalid topic shows safe fallback (not crash)
 *   (j) Browse By Module renders current module cards
 *   (k) Role guide uses canonical role taxonomy
 *   (l) FAQ uses correct navigation labels (no "Back to Knowledge Centre")
 *   (m) RTL: key labels exist in ar/knowledge.json
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "../contexts/language-context";

// ── mock api-client-react ────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({
    data: { user: { id: 1, role: "program_manager", name: "Test PM" }, permissions: [] },
  }),
}));

// ── mock fetch globally ──────────────────────────────────────────────────
const mockChapters = [
  { id: 1, title: "Getting Started", slug: "introduction", description: "Introduction", icon: "BookOpen", order: 1, status: "published", sectionCount: 3, sopCount: 0, updatedAt: new Date().toISOString() },
  { id: 2, title: "Projects", slug: "projects", description: "Project management", icon: "FolderKanban", order: 2, status: "published", sectionCount: 5, sopCount: 2, updatedAt: new Date().toISOString() },
  { id: 3, title: "Communication Centre", slug: "communication", description: "Messaging", icon: "MessageSquare", order: 3, status: "published", sectionCount: 2, sopCount: 0, updatedAt: new Date().toISOString() },
  { id: 4, title: "File & Archive", slug: "document-repository", description: "Documents", icon: "Archive", order: 4, status: "published", sectionCount: 4, sopCount: 1, updatedAt: new Date().toISOString() },
  { id: 5, title: "AI", slug: "ai-assistant", description: "AI module", icon: "Bot", order: 5, status: "published", sectionCount: 2, sopCount: 0, updatedAt: new Date().toISOString() },
];

const mockChapterDetail = {
  ...mockChapters[0],
  sections: [
    { id: 101, chapterId: 1, title: "Welcome to CAFA PMIS", content: "This guide covers Programme Manager and State Programme Officer workflows.", order: 1 },
    { id: 102, chapterId: 1, title: "Navigation", content: "Use the sidebar to navigate to each module.", order: 2 },
  ],
  sops: [],
};

const mockArabicProjectDetail = {
  ...mockChapters[1],
  title: "المشاريع",
  description: "تسجيل المشاريع وإدارة دورة حياتها ومخرجاتها وأنشطتها ووثائقها.",
  sections: [
    {
      id: 77,
      chapterId: 2,
      title: "نظرة عامة على المشاريع",
      content: "المشاريع هي الوحدة الأساسية لنظام CAFA PMIS. يمثل كل مشروع تدخلاً إنسانياً ممولاً مع جغرافيا محددة وسكان مستهدفين.",
      order: 1,
    },
  ],
  sops: [],
};

const mockFaqs = {
  Projects: [
    { id: 1, question: "Why can't I see a project?", answer: "Your access is limited to projects you are assigned to.", order: 1 },
    { id: 2, question: "Continue Editing is unavailable — why?", answer: "The project may be submitted or under review.", order: 2 },
  ],
  Reports: [
    { id: 3, question: "Why can't I submit a report?", answer: "Required fields must be completed before submission.", order: 3 },
  ],
};

const mockSearchResults = [
  { id: 1, slug: "projects", chapterTitle: "Projects", sectionTitle: "How to register a project", excerpt: "Navigate to Projects and click Create Project…" },
];

function mockFetch(url: string) {
  if (url.includes("/api/manual/chapters") && !url.includes("/api/manual/chapters/")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockChapters) });
  }
  if (url.includes("/api/manual/chapters/introduction")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockChapterDetail) });
  }
  if (url.includes("/api/manual/chapters/projects") && url.includes("locale=ar")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockArabicProjectDetail) });
  }
  if (url.includes("/api/manual/faqs")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFaqs) });
  }
  if (url.includes("/api/manual/search") && url.includes("project")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSearchResults) });
  }
  if (url.includes("/api/manual/search") && url.includes("xyznotfound")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  if (url.includes("/api/manual/search")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  if (url.includes("/api/manual/chapters/") && url.includes("feedback")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ helpful: 0, notHelpful: 0 }) });
  }
  if (url.includes("/api/manual/chapters/")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockChapterDetail) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

function setup() {
  vi.stubGlobal("fetch", vi.fn((url: string) => mockFetch(url)));
}

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <LanguageProvider>
        <QueryClientProvider client={makeQC()}>
          {children}
        </QueryClientProvider>
      </LanguageProvider>
    </I18nextProvider>
  );
}

afterEach(async () => {
  localStorage.removeItem("cafa.lang");
  await i18n.changeLanguage("en");
});

// ── Dynamic imports (after mocks are set up) ─────────────────────────────
async function importManualHome() {
  const { default: ManualHome } = await import("../pages/manual");
  return ManualHome;
}
async function importManualChapter() {
  const { default: ManualChapter } = await import("../pages/manual-chapter");
  return ManualChapter;
}
async function importManualRoleGuide() {
  const { default: ManualRoleGuide } = await import("../pages/manual-role-guide");
  return ManualRoleGuide;
}
async function importManualFaq() {
  const { default: ManualFaqPage } = await import("../pages/manual-faq");
  return ManualFaqPage;
}

// ── AR/EN translations ───────────────────────────────────────────────────
import arKnowledge from "../locales/ar/knowledge.json";
// Use unknown cast so deeply-nested JSON structure doesn't break assertion types
const enKnowledge = (await import("../locales/en/knowledge.json")).default as unknown as Record<string, Record<string, string>>;

// ────────────────────────────────────────────────────────────────────────
// (a) Standalone route — no "Knowledge & Support" label in the module
// ────────────────────────────────────────────────────────────────────────
describe("(a) System Manual standalone navigation", () => {
  it("does not contain 'Knowledge & Support' anywhere in knowledge.json", () => {
    const allValues = JSON.stringify(enKnowledge);
    expect(allValues).not.toContain("Knowledge & Support");
  });

  it("en/nav.json uses 'systemManual' key, not 'knowledgeSupport'", async () => {
    const navJson = await import("../locales/en/nav.json");
    const nav = navJson.default as Record<string, unknown>;
    const allNav = JSON.stringify(nav);
    expect(allNav).not.toContain("Knowledge & Support");
    // systemManual lives under nav.items
    const items = nav.items as Record<string, string>;
    expect(items).toHaveProperty("systemManual");
  });
});

// ────────────────────────────────────────────────────────────────────────
// (b) Design System is NOT listed as a PMIS module
// ────────────────────────────────────────────────────────────────────────
describe("(b) Design System not listed as a module", () => {
  beforeEach(() => setup());

  it("Manual landing page does not render a 'Design System' module card", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.queryByText("Design System")).toBeNull();
  });

  it("knowledge.json does not contain 'Design System' as a module entry", () => {
    const text = JSON.stringify(enKnowledge);
    expect(text).not.toContain('"Design System"');
  });
});

// ────────────────────────────────────────────────────────────────────────
// (c) AI module links correctly
// ────────────────────────────────────────────────────────────────────────
describe("(c) AI module links correctly", () => {
  beforeEach(() => setup());

  it("Browse By Module contains an 'AI' card that does not link to /ai-settings", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    const aiCards = screen.getAllByText("AI");
    // All links for the AI module should not contain /ai-settings
    const links = aiCards.map((el) => el.closest("a")).filter(Boolean);
    const hasAiSettingsLink = links.some((l) => l?.getAttribute("href")?.includes("ai-settings"));
    expect(hasAiSettingsLink).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// (d) Obsolete terminology absent from Manual UI components
// ────────────────────────────────────────────────────────────────────────
describe("(d) Obsolete terminology absent", () => {
  beforeEach(() => setup());

  it("en/knowledge.json: manual.knowledgeCentre is 'System Manual'", () => {
    expect(enKnowledge.manual?.knowledgeCentre).toBe("System Manual");
  });

  it("en/knowledge.json: faq.backToKnowledge is 'Back to System Manual'", () => {
    expect(enKnowledge.faq?.backToKnowledge).toBe("Back to System Manual");
  });

  it("en/knowledge.json: documentRepository is 'File & Archive'", () => {
    // documentRepository is a top-level string key
    expect((enKnowledge as unknown as Record<string, string>).documentRepository).toBe("File & Archive");
  });

  it("Manual landing does not render 'Program Manager' as role label text", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.queryByText("Program Manager")).toBeNull();
  });

  it("Manual landing does not render 'Communication Center'", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.queryByText("Communication Center")).toBeNull();
  });

  it("Manual landing does not render 'Document Repository'", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.queryByText("Document Repository")).toBeNull();
  });

  it("Role guide for program_manager shows 'Programme Manager' (British), not 'Program Manager'", async () => {
    const ManualRoleGuide = await importManualRoleGuide();
    render(<Wrapper><ManualRoleGuide role="program_manager" /></Wrapper>);
    // "Programme Manager" must appear at least once (heading, badge, sidebar)
    expect(screen.getAllByText("Programme Manager").length).toBeGreaterThan(0);
    // "Program Manager" (American) must NOT appear anywhere
    expect(screen.queryByText("Program Manager")).toBeNull();
  });

  it("FAQ page does not render 'Back to Knowledge Centre'", async () => {
    const ManualFaqPage = await importManualFaq();
    render(<Wrapper><ManualFaqPage /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /frequently asked questions/i }));
    expect(screen.queryByText("Back to Knowledge Centre")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// (e) Correct terminology present
// ────────────────────────────────────────────────────────────────────────
describe("(e) Correct terminology present", () => {
  beforeEach(() => setup());

  it("Manual landing renders 'Communication Centre'", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.getByText("Communication Centre")).toBeTruthy();
  });

  it("Manual landing renders 'File & Archive'", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.getAllByText("File & Archive").length).toBeGreaterThan(0);
  });

  it("Quick Start Guides include 'Continue Editing a Draft Project'", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.getByText("Continue Editing a Draft Project")).toBeTruthy();
  });

  it("Quick Start Guides include 'Continue Editing a Draft Plan'", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.getByText("Continue Editing a Draft Plan")).toBeTruthy();
  });

  it("FAQ back-link is 'Back to System Manual' (not Knowledge Centre)", async () => {
    const ManualFaqPage = await importManualFaq();
    render(<Wrapper><ManualFaqPage /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /frequently asked questions/i }));
    expect(screen.getByText(/Back to System Manual/i)).toBeTruthy();
  });

  it("Role guide: Senior Programme Coordinator label is present", async () => {
    const ManualRoleGuide = await importManualRoleGuide();
    render(<Wrapper><ManualRoleGuide role="senior_program_coordinator" /></Wrapper>);
    expect(screen.getAllByText("Senior Programme Coordinator").length).toBeGreaterThan(0);
  });

  it("Role guide: State Programme Officer label is present", async () => {
    const ManualRoleGuide = await importManualRoleGuide();
    render(<Wrapper><ManualRoleGuide role="state_program_officer" /></Wrapper>);
    expect(screen.getAllByText("State Programme Officer").length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// (f) Search: results and empty state
// ────────────────────────────────────────────────────────────────────────
describe("(f) Manual search", () => {
  beforeEach(() => setup());

  it("search input has an accessible label", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    const searchInput = screen.getByRole("textbox", { name: /search the system manual/i });
    expect(searchInput).toBeTruthy();
  });

  it("renders empty state when search returns no results", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    const searchInput = screen.getByRole("textbox", { name: /search the system manual/i });
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "xyznotfound" } });
    await waitFor(() => {
      expect(screen.getByText(/no manual results found/i)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("renders search results when query matches", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    const searchInput = screen.getByRole("textbox", { name: /search the system manual/i });
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "project" } });
    await waitFor(() => {
      // Chapter title from search results
      expect(screen.getAllByText("Projects").length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });
});

// ────────────────────────────────────────────────────────────────────────
// (g) Topic deep-link renders correct chapter
// ────────────────────────────────────────────────────────────────────────
describe("(g) Topic deep-link", () => {
  beforeEach(() => setup());

  it("ManualChapter renders with the given slug prop", async () => {
    const ManualChapter = await importManualChapter();
    render(<Wrapper><ManualChapter slug="introduction" /></Wrapper>);
    await waitFor(() => {
      expect(screen.getAllByText("Getting Started").length).toBeGreaterThan(0);
    });
  });

  it("ManualChapter shows section titles from the chapter", async () => {
    const ManualChapter = await importManualChapter();
    render(<Wrapper><ManualChapter slug="introduction" /></Wrapper>);
    // Section title appears in both the section h2 and the "On This Page" sidebar — use getAllByText
    await waitFor(() => {
      expect(screen.getAllByText(/Welcome to CAFA PMIS/i).length).toBeGreaterThan(0);
    }, { timeout: 5000 });
  });
});

// ────────────────────────────────────────────────────────────────────────
// (h) Invalid slug shows safe fallback state
// ────────────────────────────────────────────────────────────────────────
describe("(h) Invalid slug fallback", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/manual/chapters/invalid-nonexistent-slug")) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "not_found" }) });
      }
      return mockFetch(url);
    }));
  });

  it("renders a 'Topic Not Found' state instead of crashing", async () => {
    const ManualChapter = await importManualChapter();
    render(<Wrapper><ManualChapter slug="invalid-nonexistent-slug" /></Wrapper>);
    await waitFor(() => {
      const notFound = screen.queryByText(/topic not found/i)
        ?? screen.queryByRole("button", { name: /system manual/i });
      expect(notFound).toBeTruthy();
    }, { timeout: 3000 });
  });
});

// ────────────────────────────────────────────────────────────────────────
// (j) Browse By Module renders current module cards
// ────────────────────────────────────────────────────────────────────────
describe("(j) Browse By Module", () => {
  beforeEach(() => setup());

  const EXPECTED_MODULES = [
    "Dashboard",
    "Projects",
    "Planning",
    "Budgets",
    "Reports",
    "Risk Register",
    "Communication Centre",
    "File & Archive",
  ];

  it("renders all expected current PMIS modules", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    for (const mod of EXPECTED_MODULES) {
      expect(screen.getAllByText(mod).length).toBeGreaterThan(0);
    }
  });

  it("does not list 'Design System' in Browse By Module", async () => {
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /system manual/i }));
    expect(screen.queryByText("Design System")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// (k) Role guide canonical taxonomy
// ────────────────────────────────────────────────────────────────────────
describe("(k) Role guide canonical taxonomy", () => {
  beforeEach(() => setup());

  const CANONICAL_ROLES: [string, string][] = [
    ["super_admin", "Super Admin"],
    ["executive_director", "Executive Director"],
    ["program_manager", "Programme Manager"],
    ["senior_program_coordinator", "Senior Programme Coordinator"],
    ["technical_coordinator", "Technical Coordinator"],
    ["state_program_officer", "State Programme Officer"],
    ["state_office_manager", "State Office Manager"],
    ["project_officer", "Project Officer"],
    ["program_assistant", "Programme Assistant"],
    ["viewer", "Viewer"],
  ];

  it.each(CANONICAL_ROLES)("role %s displays canonical label '%s'", async (roleKey, expectedLabel) => {
    const ManualRoleGuide = await importManualRoleGuide();
    render(<Wrapper><ManualRoleGuide role={roleKey} /></Wrapper>);
    // Label appears in sidebar nav list and/or main content — both are acceptable
    expect(screen.getAllByText(expectedLabel).length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// (l) FAQ accessibility: aria-expanded on accordion controls
// ────────────────────────────────────────────────────────────────────────
describe("(l) FAQ accessibility", () => {
  beforeEach(() => setup());

  it("FAQ accordion buttons have aria-expanded attribute", async () => {
    const ManualFaqPage = await importManualFaq();
    render(<Wrapper><ManualFaqPage /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /frequently asked questions/i }));
    await waitFor(() => {
      const buttons = screen.getAllByRole("button").filter((b) =>
        b.hasAttribute("aria-expanded")
      );
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("FAQ does not reference 'Back to Knowledge Centre'", async () => {
    const ManualFaqPage = await importManualFaq();
    render(<Wrapper><ManualFaqPage /></Wrapper>);
    await waitFor(() => screen.getByRole("heading", { name: /frequently asked questions/i }));
    expect(screen.queryByText(/back to knowledge centre/i)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// (m) RTL / Arabic — key stubs exist
// ────────────────────────────────────────────────────────────────────────
describe("(m) Arabic i18n key stubs exist", () => {
  const ar = arKnowledge as unknown as Record<string, Record<string, string>>;

  it("ar/knowledge.json has faq.backToManual", () => {
    expect(ar.faq?.backToManual).toBeTruthy();
  });

  it("ar/knowledge.json has manual.title", () => {
    expect(ar.manual?.title).toBeTruthy();
  });

  it("ar/knowledge.json has roleGuide.title", () => {
    expect(ar.roleGuide?.title).toBeTruthy();
  });

  it("requests Arabic Manual data with locale-aware, cache-safe URLs", async () => {
    localStorage.setItem("cafa.lang", "ar");
    await i18n.changeLanguage("ar");
    setup();
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    await waitFor(() => {
      const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/manual/chapters") && url.includes("locale=ar"))).toBe(true);
      expect(urls.some((url) => url.includes("/api/manual/faqs") && url.includes("locale=ar"))).toBe(true);
    });
  });

  it("renders the Arabic Project chapter body from the locale-specific response", async () => {
    localStorage.setItem("cafa.lang", "ar");
    await i18n.changeLanguage("ar");
    setup();
    const ManualChapter = await importManualChapter();
    render(<Wrapper><ManualChapter slug="projects" /></Wrapper>);

    expect(await screen.findByText("المشاريع هي الوحدة الأساسية لنظام CAFA PMIS. يمثل كل مشروع تدخلاً إنسانياً ممولاً مع جغرافيا محددة وسكان مستهدفين.")).toBeTruthy();
    expect(screen.queryByText("This guide covers Programme Manager and State Programme Officer workflows.")).toBeNull();
    await waitFor(() => {
      const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
      expect(urls).toContain("/api/manual/chapters/projects?locale=ar");
    });
  });

  it("keeps search keyboard-operable with an active option", async () => {
    setup();
    const ManualHome = await importManualHome();
    render(<Wrapper><ManualHome /></Wrapper>);
    const input = await screen.findByRole("textbox", { name: /search the system manual/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "project" } });
    await waitFor(() => expect(screen.getByRole("option")).toBeTruthy());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "manual-search-option-0");
  });
});
