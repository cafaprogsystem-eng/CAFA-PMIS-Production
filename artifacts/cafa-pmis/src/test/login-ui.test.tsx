import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginPage from "@/pages/login";

const navigation = vi.hoisted(() => ({ setLocation: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigation.setLocation],
}));

vi.mock("@/contexts/language-context", () => ({
  useLanguage: () => ({ direction: "ltr" }),
}));

vi.mock("react-i18next", () => {
  const strings: Record<string, string> = {
    welcomeBack: "Welcome Back",
    signInTo: "Sign in to CAFA PMIS",
    signInAccount: "Internal access only. Contact your System Administrator if you need an account.",
    signInFooter: "Don't have an account? Please contact your System Administrator.",
    identifier: "Username Or Email",
    identifierPh: "your.name@cafa-sd.org",
    password: "Password",
    forgotPassword: "Forgot password?",
    showPassword: "Show password",
    hidePassword: "Hide password",
    rememberMe: "Remember me for 30 days",
    signIn: "Sign In",
    signingIn: "Signing in…",
    invalidCredentials: "Invalid username or password. Please try again.",
    requiredFields: "Username and password are required.",
    tooManyRequests: "Too many requests. Please wait 15 minutes and try again.",
    networkError: "Network error. Please check your connection and try again.",
    accountNotActive: "This account is not active. Please contact your system administrator.",
    internalSystemLabel: "Internal Programme Management System",
    systemTagline: "One secure platform for CAFA programme teams.",
    copyright: "CAFA PMIS © 2026",
  };
  return {
    useTranslation: () => ({
      t: (key: string) => strings[key] ?? key,
    }),
  };
});

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

describe("sign-in refined UI", () => {
  const fetchMock = vi.fn();
  const returningUserKey = "cafa.hasSignedIn";

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "invalid_credentials" }) });
    window.localStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    navigation.setLocation.mockReset();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the internal-only copy without a returning-user cue on a fresh browser", async () => {
    renderLogin();

    expect(screen.getByRole("heading", { name: "Sign in to CAFA PMIS" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Internal access only. Contact your System Administrator if you need an account.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Don't have an account? Please contact your System Administrator."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Welcome Back")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /account|sign up|register/i })).not.toBeInTheDocument();
  });

  it("keeps the sign-in contract, remember-me wiring, and canonical reset route", async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(screen.getByRole("heading", { name: "Sign in to CAFA PMIS" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username Or Email")).toHaveAttribute(
      "placeholder",
      "your.name@cafa-sd.org",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByText("One secure platform for CAFA programme teams.")).toBeInTheDocument();
    expect(
      screen.getByText("Don't have an account? Please contact your System Administrator."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /terms|privacy/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Remember me for 30 days" }));
    await user.type(screen.getByLabelText("Username Or Email"), " staff.user ");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ identifier: "staff.user", password: "secret", remember: true }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(navigation.setLocation).toHaveBeenCalledWith("/forgot-password");
  });

  it("shows Welcome Back only after a successful authentication response", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: "user-123" } }),
    });
    renderLogin();

    await user.type(screen.getByLabelText("Username Or Email"), "staff.user");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(window.localStorage.getItem(returningUserKey)).toBe("true"));

    cleanup();
    renderLogin();
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
  });

  it("does not activate the returning-user cue after failed or network-error attempts", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username Or Email"), "staff.user");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(returningUserKey)).toBeNull();
    expect(screen.queryByText("Welcome Back")).not.toBeInTheDocument();

    cleanup();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderLogin();
    await user.type(screen.getByLabelText("Username Or Email"), "staff.user");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    await screen.findByRole("alert");
    expect(window.localStorage.getItem(returningUserKey)).toBeNull();
  });

  it("returns to first-time presentation when the browser marker is cleared", () => {
    window.localStorage.setItem(returningUserKey, "true");
    renderLogin();
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();

    cleanup();
    window.localStorage.clear();
    renderLogin();
    expect(screen.queryByText("Welcome Back")).not.toBeInTheDocument();
  });

  it("keeps password visibility keyboard accessible and announces sign-in errors", async () => {
    const user = userEvent.setup();
    renderLogin();

    const password = screen.getByLabelText("Password");
    const visibility = screen.getByRole("button", { name: "Show password" });
    expect(password).toHaveAttribute("type", "password");
    expect(visibility).not.toHaveAttribute("tabindex", "-1");

    visibility.focus();
    expect(visibility).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Username and password are required.",
    );
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("form")).toHaveAttribute("aria-describedby", "login-error");
  });
});