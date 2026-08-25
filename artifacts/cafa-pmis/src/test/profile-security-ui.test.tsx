import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import ProfilePage from "@/pages/profile";
import { LanguageProvider } from "@/contexts/language-context";

const api = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  saveProfile: vi.fn(),
  changePassword: vi.fn(),
  requestPhotoUpload: vi.fn(),
  completePhotoUpload: vi.fn(),
  removePhoto: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetProfileQueryKey: () => ["/api/profile"],
  useGetProfile: () => ({ data: api.profile, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateProfile: () => ({ mutateAsync: api.saveProfile }),
  useChangePassword: () => ({ mutateAsync: api.changePassword }),
  useRequestProfilePhotoUploadUrl: () => ({ mutateAsync: api.requestPhotoUpload }),
  useCompleteProfilePhotoUpload: () => ({ mutateAsync: api.completePhotoUpload }),
  useRemoveProfilePhoto: () => ({ mutateAsync: api.removePhoto }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type TestAccess = { kind: string; stateNames: string[]; sectors: string[] };

function makeProfile(access: TestAccess = { kind: "organisation_wide", stateNames: [], sectors: [] }) {
  return {
    id: 7,
    name: "Amina Hassan",
    email: "amina@example.test",
    username: "amina",
    role: "program_manager",
    roleLabel: "Program Manager",
    scope: "hq",
    stateId: null,
    stateName: null,
    sector: null,
    avatarUrl: null,
    jobTitle: "Programme Officer",
    phone: "+249912345678",
    status: "active",
    emailVerified: true,
    timezone: "Africa/Khartoum",
    languagePreference: "en",
    createdAt: "2026-01-02T03:04:00.000Z",
    lastLoginAt: "2026-08-20T10:00:00.000Z",
    access,
  };
}

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LanguageProvider><ProfilePage /></LanguageProvider></QueryClientProvider>);
}

describe("Secure My Profile UI", () => {
  beforeEach(async () => {
    api.profile = makeProfile();
    api.saveProfile.mockResolvedValue(api.profile);
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders canonical access as read-only and keeps only supported personal controls editable", () => {
    renderProfile();

    expect(screen.getByText("Organisation & Access")).toBeInTheDocument();
    expect(screen.getByText("Organisation-wide access")).toBeInTheDocument();
    expect(screen.getByText("Program Manager")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("amina@example.test")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Manage Notification Preferences" })).toHaveAttribute("href", "/notification-preferences");
  });

  it("enables a dirty personal save, retains safe edits after an API failure, and exposes password controls", async () => {
    api.saveProfile.mockRejectedValueOnce({ data: { error: "invalid_phone" } });
    const user = userEvent.setup();
    renderProfile();

    const name = screen.getByLabelText(/Full name/);
    await user.clear(name);
    await user.type(name, "Amina A. Hassan");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(api.saveProfile).toHaveBeenCalledWith({ data: { name: "Amina A. Hassan", phone: "+249912345678", jobTitle: "Programme Officer" } });
    expect(name).toHaveValue("Amina A. Hassan");
    expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(3);
  });

  it("renders scoped and unassigned access truthfully and preserves responsive RTL hooks", async () => {
    api.profile = makeProfile({ kind: "state_scoped", stateNames: ["Khartoum"], sectors: [] });
    renderProfile();
    expect(screen.getByText("Khartoum")).toBeInTheDocument();
    cleanup();

    api.profile = makeProfile({ kind: "not_assigned", stateNames: [], sectors: [] });
    renderProfile();
    expect(screen.getByText("Not Assigned")).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.querySelector(".grid.lg\\:grid-cols-3")).toBeInTheDocument();

    cleanup();
    localStorage.setItem("cafa.lang", "ar");
    api.profile = { ...makeProfile({ kind: "not_assigned", stateNames: [], sectors: [] }), languagePreference: "ar" };
    renderProfile();
    expect(await screen.findByText("المنظمة والوصول")).toBeInTheDocument();
    expect(screen.getByText("اسم المستخدم")).toBeInTheDocument();
    expect(screen.getByText("تاريخ الانضمام")).toBeInTheDocument();
    expect(screen.getByText(/يناير/)).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
  });
});