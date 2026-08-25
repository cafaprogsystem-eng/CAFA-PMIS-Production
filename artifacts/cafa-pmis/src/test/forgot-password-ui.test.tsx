import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ForgotPasswordPage from "@/pages/forgot-password";

const navigation = vi.hoisted(() => ({ setLocation: vi.fn() }));
const PAGES_DIR = join(process.cwd(), "src/pages");

vi.mock("wouter", () => ({
  useLocation: () => ["/forgot-password", navigation.setLocation],
}));

vi.mock("@/contexts/language-context", () => ({
  useLanguage: () => ({ direction: "ltr" }),
}));

vi.mock("react-i18next", () => {
  const strings: Record<string, string> = {
    internalSystemLabel: "Internal Programme Management System",
    systemTagline: "One secure platform for CAFA programme teams.",
    copyright: "CAFA PMIS © 2026",
    forgotPasswordEyebrow: "PASSWORD RESET",
    forgotPasswordTitle: "Forgot your password?",
    forgotPasswordDesc: "Enter your email address and we'll send you a reset link.",
    emailAddress: "Email Address",
    emailPh: "your.name@cafa-sd.org",
    sendResetLink: "Send Reset Link",
    sending: "Sending…",
    backToSignIn: "Back to sign in",
    returnToSignIn: "Return to sign in",
    emailRequired: "Please enter your email address.",
    tooManyRequests: "Too many requests. Please wait 15 minutes and try again.",
    somethingWentWrong: "Something went wrong. Please try again.",
    networkError: "Network error. Please check your connection and try again.",
    checkEmail: "Check your email",
    checkEmailDesc: "If an account exists for {{email}}, reset instructions have been sent.",
    linkExpires: "The link expires in 60 minutes. Check your spam folder if you don't see it.",
    devMode: "Dev mode",
    copied: "Copied!",
    copy: "Copy",
    openResetPage: "Open reset page",
  };
  return {
    useTranslation: () => ({
      t: (key: string, values?: { email?: string }) =>
        strings[key]?.replace("{{email}}", values?.email ?? "") ?? key,
    }),
  };
});

describe("forgot-password shared authentication UI", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    navigation.setLocation.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the shared brand and retains an empty, email-specific reset form", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByText("Internal Programme Management System")).toBeInTheDocument();
    expect(screen.getByText("CAFA PMIS")).toBeInTheDocument();
    expect(screen.getByText("One secure platform for CAFA programme teams.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email Address")).toHaveValue("");
    expect(screen.getByLabelText("Email Address")).toHaveAttribute("placeholder", "your.name@cafa-sd.org");
    expect(screen.getByLabelText("Email Address")).toHaveAttribute("autocomplete", "email");
    expect(screen.queryByText(/Programme Management Information System/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /terms|privacy/i })).not.toBeInTheDocument();
  });

  it("submits the unchanged reset contract with Enter and returns to the canonical sign-in route", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText("Email Address"), " person@example.org ");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/forgot-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "person@example.org" }),
      }),
    );
    expect(navigation.setLocation).toHaveBeenCalledWith(
      "/password-reset-sent?email=person%40example.org",
    );

    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(navigation.setLocation).toHaveBeenCalledWith("/login");
  });

  it("announces safe validation feedback and uses the scrolling responsive shell", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter your email address.");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("form")).toHaveAttribute("aria-describedby", "forgot-password-error");

    const shell = readFileSync(join(process.cwd(), "src/components/auth-shell.tsx"), "utf8");
    expect(shell).toContain("overflow-x-hidden overflow-y-auto");
    expect(shell).toContain("hidden lg:flex");
  });

  it("keeps Reset Password and invitation setup on their existing actions after shell alignment", () => {
    const resetPassword = readFileSync(join(PAGES_DIR, "reset-password.tsx"), "utf8");
    const inviteAccept = readFileSync(join(PAGES_DIR, "invite-accept.tsx"), "utf8");
    const resetSent = readFileSync(join(PAGES_DIR, "password-reset-sent.tsx"), "utf8");

    expect(resetPassword).toContain("<AuthShell>");
    expect(resetPassword).toContain('fetch("/api/auth/reset-password"');
    expect(resetPassword).not.toContain('t("termsAgree")');
    expect(resetSent).toContain("<AuthShell>");
    expect(resetSent).toContain('setLocation("/login")');
    expect(inviteAccept).toContain('fetch("/api/auth/accept-invite"');
  });
});