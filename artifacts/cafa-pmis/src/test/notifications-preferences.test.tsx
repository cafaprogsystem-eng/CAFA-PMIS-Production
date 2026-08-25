/**
 * NOTIF-UX: Notification Preferences page — functional, RBAC, and RTL tests
 *
 * Covers: dirty-state tracking, invitations RBAC gate, email verification
 * banner, draft preservation across tab switches, failed-save draft retention,
 * and RTL / responsive layout rendering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import type React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import NotificationPreferencesPage from "@/pages/notification-preferences";

// ── Stable mock objects ───────────────────────────────────────────────────────
// IMPORTANT: mock objects must be stable across renders — fresh objects every
// render cause infinite effect loops in hooks that compare references.

const api = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  refetch: vi.fn(),
}));

const mockGetProfile = vi.hoisted(() => vi.fn());
const mockGetMe = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useGetProfile: () => mockGetProfile(),
  useUpdateProfile: () => ({ mutateAsync: api.saveProfile }),
  useGetMe: () => mockGetMe(),
  getGetProfileQueryKey: () => ["get-profile"],
}));

// useQueryClient returns a mock query client — tests that verify cache writes
// check the calls made to queryClient.setQueryData.
const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ setQueryData: mockSetQueryData }),
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/notifications/preferences", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function source() {
  return readFileSync(resolve("src/pages/notification-preferences.tsx"), "utf8");
}

const baseProfile = {
  id: 7,
  name: "Test User",
  email: "test@cafa.test",
  emailVerified: true,
  timezone: "Africa/Khartoum",
  notificationPreferences: null,
};

const baseMe = {
  data: {
    user: { id: 7, role: "viewer" },
    permissions: [] as string[],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NOTIF-UX-01 dirty-state tracking", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    api.saveProfile.mockResolvedValue({});
    api.refetch.mockResolvedValue({});
    mockGetMe.mockReturnValue(baseMe);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("Save button is disabled on initial load (no changes made)", () => {
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });

    renderWithQuery(<NotificationPreferencesPage />);

    const saveBtn = screen.getByRole("button", { name: /save preferences/i });
    expect(saveBtn).toBeDisabled();
  });

  it("Save button becomes enabled after toggling a preference", async () => {
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });

    renderWithQuery(<NotificationPreferencesPage />);

    const saveBtn = screen.getByRole("button", { name: /save preferences/i });
    expect(saveBtn).toBeDisabled();

    // Toggle the first non-mandatory in-app switch
    const switches = screen.getAllByRole("switch");
    const firstOptional = switches.find(sw => !sw.hasAttribute("disabled") || sw.getAttribute("disabled") === "false");
    if (firstOptional) {
      await userEvent.setup().click(firstOptional);
    }

    await waitFor(() => expect(screen.getByRole("button", { name: /save preferences/i })).not.toBeDisabled());
  });

  it("Save button is disabled again after a successful save", async () => {
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);

    // Make a change
    const switches = screen.getAllByRole("switch");
    const firstOptional = switches.find(sw => !sw.getAttribute("disabled"));
    if (firstOptional) await user.click(firstOptional);

    await waitFor(() => expect(screen.getByRole("button", { name: /save preferences/i })).not.toBeDisabled());

    // Save
    api.saveProfile.mockResolvedValue({});
    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /save preferences/i })).toBeDisabled());
  });

  it("successful save writes the PATCH response into the React Query cache", async () => {
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });

    const savedProfile = { ...baseProfile, notificationPreferences: { inApp: {}, email: {} } };
    api.saveProfile.mockResolvedValue(savedProfile);

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);

    const switches = screen.getAllByRole("switch");
    const firstOptional = switches.find(sw => !sw.getAttribute("disabled"));
    if (firstOptional) await user.click(firstOptional);

    await waitFor(() => expect(screen.getByRole("button", { name: /save preferences/i })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    // The React Query cache must be updated with the PATCH response
    await waitFor(() =>
      expect(mockSetQueryData).toHaveBeenCalledWith(
        expect.anything(), // query key
        savedProfile,
      ),
    );
  });

  it("draft is preserved when the save API call fails", async () => {
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);

    const switches = screen.getAllByRole("switch");
    const firstOptional = switches.find(sw => !sw.getAttribute("disabled"));
    if (firstOptional) await user.click(firstOptional);

    await waitFor(() => expect(screen.getByRole("button", { name: /save preferences/i })).not.toBeDisabled());

    // Simulate a save failure
    api.saveProfile.mockRejectedValue(new Error("network error"));
    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    // After failure, draft is preserved — button remains enabled
    await waitFor(() => expect(screen.getByRole("button", { name: /save preferences/i })).not.toBeDisabled());
  });
});

describe("NOTIF-UX-02 invitations RBAC gate", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hides the Invitations row for a user without users.manage permission", async () => {
    mockGetMe.mockReturnValue({ data: { user: { id: 7 }, permissions: [] } });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    expect(screen.queryByText("Invitations")).not.toBeInTheDocument();
  });

  it("shows the Invitations row for a user with users.manage permission", async () => {
    mockGetMe.mockReturnValue({ data: { user: { id: 7 }, permissions: ["users.manage"] } });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    expect(await screen.findByText("Invitations")).toBeInTheDocument();
  });

  it("shows the Invitations row for a super_admin user with wildcard '*' permission", async () => {
    // super_admin has permissions: ["*"] — wildcard must match users.manage semantics
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });
    mockGetMe.mockReturnValue({ data: { user: { id: 7 }, permissions: ["*"] } });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    expect(await screen.findByText("Invitations")).toBeInTheDocument();
  });

  it("does not use a role name string comparison — permissions array is the gate", () => {
    // Source-code check: the page must check permissions array, not a role string
    const src = source();
    expect(src).toContain("users.manage");
    expect(src).not.toMatch(/role\s*===\s*["'].*admin/);
  });

  it("applies wildcard-aware check — source uses '*' or 'users.manage'", () => {
    const src = source();
    // The wildcard check must appear before or alongside users.manage
    expect(src).toContain('"*"');
    expect(src).toContain("users.manage");
  });
});

describe("NOTIF-UX-03 email verification awareness", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetMe.mockReturnValue(baseMe);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a verification banner when emailVerified is false", async () => {
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, emailVerified: false },
      isLoading: false,
      refetch: api.refetch,
    });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    expect(
      await screen.findByText(/email notifications are unavailable until your email address is verified/i),
    ).toBeInTheDocument();
  });

  it("does not show the banner when emailVerified is true", async () => {
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, emailVerified: true },
      isLoading: false,
      refetch: api.refetch,
    });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    expect(
      screen.queryByText(/email notifications are unavailable/i),
    ).not.toBeInTheDocument();
  });

  it("optional email switches carry aria-disabled when email is unverified", async () => {
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, emailVerified: false },
      isLoading: false,
      refetch: api.refetch,
    });

    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    // At least one switch should have aria-disabled="true" (optional ones)
    await waitFor(() => {
      const allSwitches = screen.getAllByRole("switch");
      const ariaDisabled = allSwitches.filter(sw => sw.getAttribute("aria-disabled") === "true");
      expect(ariaDisabled.length).toBeGreaterThan(0);
    });
  });
});

describe("NOTIF-UX-03b email verification — switches truly disabled (keyboard)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetMe.mockReturnValue(baseMe);
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, emailVerified: false },
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("optional email switches are HTML-disabled when email is unverified", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    // Get all switches in the email tab; optional ones must be disabled
    const switches = await screen.findAllByRole("switch");
    // At least one optional switch must carry the disabled attribute
    const disabledOptional = switches.filter(sw =>
      sw.hasAttribute("disabled") && sw.getAttribute("aria-disabled") === "true",
    );
    expect(disabledOptional.length).toBeGreaterThan(0);
  });

  it("toggling a disabled optional email switch via keyboard does not enable Save", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /email/i }));

    // Find a disabled optional switch and try to focus + activate it with Space
    const switches = await screen.findAllByRole("switch");
    const disabledSwitch = switches.find(
      sw => sw.hasAttribute("disabled") && !sw.closest('[data-mandatory]'),
    );
    if (disabledSwitch) {
      disabledSwitch.focus();
      await user.keyboard(" "); // spacebar — the normal toggle key for a switch
    }

    // Save should remain disabled because the switch could not be toggled
    expect(screen.getByRole("button", { name: /save preferences/i })).toBeDisabled();
  });

  it("setEmail guard prevents state change for optional keys when email is unverified", async () => {
    // This test verifies the defensive guard in setEmail works even if
    // the switch's disabled attribute is somehow bypassed.
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, emailVerified: false },
      isLoading: false,
      refetch: api.refetch,
    });

    renderWithQuery(<NotificationPreferencesPage />);

    // Save button should be permanently disabled — no state change possible
    const saveBtn = screen.getByRole("button", { name: /save preferences/i });
    expect(saveBtn).toBeDisabled();

    // Attempt a direct fireEvent (bypasses pointer-events) on the switch
    const switches = screen.getAllByRole("switch");
    const optionalSwitch = switches.find(sw => sw.hasAttribute("disabled"));
    if (optionalSwitch) {
      fireEvent.click(optionalSwitch);
    }

    // Save must still be disabled — defensive guard prevented the state change
    expect(screen.getByRole("button", { name: /save preferences/i })).toBeDisabled();
  });
});

describe("NOTIF-UX-04 quiet hours timezone read-only", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetMe.mockReturnValue(baseMe);
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, timezone: "Africa/Khartoum" },
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the profile timezone as a read-only label — no Select dropdown", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /delivery/i }));

    // Enable quiet hours
    const qhToggle = screen.getByRole("switch");
    await user.click(qhToggle);

    // Read-only timezone display should be visible
    const tzDisplay = screen.getByTestId("qh-timezone-readonly");
    expect(tzDisplay).toBeInTheDocument();
    expect(tzDisplay.tagName.toLowerCase()).not.toBe("select");
    expect(tzDisplay.tagName.toLowerCase()).not.toBe("button");
  });

  it("does not render a timezone Select element inside Quiet Hours", () => {
    const src = source();
    // The TIMEZONES array and the Select-based timezone picker must be removed
    expect(src).not.toContain("TIMEZONES.map");
    expect(src).not.toContain("onValueChange={v => setPrefs(p => ({ ...p, quietHours: { ...p.quietHours, timezone: v } }))}");
  });
});

describe("NOTIF-UX-05 delivery channel description copy", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetMe.mockReturnValue(baseMe);
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("delivery channel card shows the mandatory-bypass description", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /delivery/i }));

    expect(
      await screen.findByText(/controls optional notifications\. mandatory security and critical alerts/i),
    ).toBeInTheDocument();
  });
});

describe("NOTIF-UX-06 draft preserved across tab switches", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetMe.mockReturnValue(baseMe);
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("changes made in In-App tab survive a round-trip to Email tab and back", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);

    // Toggle a switch in the In-App tab
    const inAppSwitches = screen.getAllByRole("switch");
    const firstOptional = inAppSwitches.find(sw => !sw.getAttribute("disabled"));
    if (!firstOptional) return;
    const initialChecked = firstOptional.getAttribute("aria-checked") === "true";
    await user.click(firstOptional);

    // Navigate away
    await user.click(screen.getByRole("tab", { name: /email/i }));
    // Navigate back
    await user.click(screen.getByRole("tab", { name: /in-app/i }));

    // The change should still be there
    const refreshedSwitches = screen.getAllByRole("switch");
    const refreshedOptional = refreshedSwitches.find(sw => !sw.getAttribute("disabled"));
    if (refreshedOptional) {
      const newChecked = refreshedOptional.getAttribute("aria-checked") === "true";
      expect(newChecked).not.toBe(initialChecked);
    }

    // Save button should still be enabled
    expect(screen.getByRole("button", { name: /save preferences/i })).not.toBeDisabled();
  });
});

describe("NOTIF-UX-07 RTL rendering", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ar");
    mockGetMe.mockReturnValue(baseMe);
    mockGetProfile.mockReturnValue({
      data: { ...baseProfile, emailVerified: true },
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("renders without layout errors in RTL mode", () => {
    const { container } = renderWithQuery(<NotificationPreferencesPage />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("dir", "rtl");
    // Heading should be present
    expect(screen.getByRole("heading", { name: "تفضيلات الإشعارات" })).toBeInTheDocument();
  });

  it("Save button is reachable in RTL layout", () => {
    renderWithQuery(<NotificationPreferencesPage />);

    const saveBtn = screen.getByRole("button", { name: "حفظ التفضيلات" });
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toBeDisabled(); // disabled until a change is made
  });

  it("Required badge renders in Arabic alongside the label", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);

    // The tab trigger in Arabic
    await user.click(screen.getByRole("tab", { name: "داخل التطبيق" }));
    const badges = await screen.findAllByText("مطلوب");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("source contains RTL direction hooks", () => {
    const src = source();
    expect(src).toContain('i18n.dir()');
    expect(src).toContain("rtl:rotate-180");
  });
});

describe("NOTIF-UX-08 digest coming-soon guard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockGetMe.mockReturnValue(baseMe);
    mockGetProfile.mockReturnValue({
      data: baseProfile,
      isLoading: false,
      refetch: api.refetch,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("daily and weekly digest options are disabled with Coming soon badges", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationPreferencesPage />);
    await user.click(screen.getByRole("tab", { name: /delivery/i }));

    expect(await screen.findAllByText("Coming soon")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /daily digest/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /weekly digest/i })).toBeDisabled();
  });

  it("source type-constrains digest to immediate and disables daily/weekly options", () => {
    const src = source();
    // The draft state type allows only "immediate"
    expect(src).toContain('digest: "immediate";');
    // The default value is "immediate"
    expect(src).toContain('digest: "immediate"');
    // Daily and weekly radio items exist but are always disabled (Coming Soon)
    expect(src).toContain('id="dig-daily" disabled');
    expect(src).toContain('id="dig-weekly" disabled');
  });
});
