/**
 * LOGIN-ERROR-MESSAGES — every non-2xx login response (wrong credentials
 * 401, deactivated account 403, lockout 429) and even a network failure
 * (catch block) collapsed to the exact same "Invalid username or password"
 * string, with no way for a user to tell they need to contact an admin,
 * wait out a lockout, or check their connection. Fixed: the too-many-
 * requests and account-not-active cases now get their own distinct
 * messages, and a network failure gets a distinct message from a genuine
 * wrong-password rejection — matching the branching pattern already used by
 * forgot-password.tsx. Wrong credentials / missing fields still collapse to
 * one generic message deliberately, to avoid account enumeration.
 *
 * Uses a stubbed localStorage (not the ambient jsdom one, which is
 * unreliable in this test environment — see other localStorage-dependent
 * test files) so this file's assertions don't depend on that gap.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigation = vi.hoisted(() => ({ setLocation: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigation.setLocation],
}));

vi.mock("@/contexts/language-context", () => ({
  useLanguage: () => ({ direction: "ltr" }),
}));

vi.mock("react-i18next", () => {
  const strings: Record<string, string> = {
    signInTo: "Sign in to CAFA PMIS",
    signInAccount: "Internal access only.",
    signInFooter: "Contact your admin.",
    identifier: "Username Or Email",
    identifierPh: "your.name@cafa-sd.org",
    password: "Password",
    forgotPassword: "Forgot password?",
    showPassword: "Show password",
    hidePassword: "Hide password",
    rememberMe: "Remember me",
    signIn: "Sign In",
    signingIn: "Signing in…",
    invalidCredentials: "Invalid username or password. Please try again.",
    requiredFields: "Username and password are required.",
    tooManyRequests: "Too many requests. Please wait 15 minutes and try again.",
    networkError: "Network error. Please check your connection and try again.",
    accountNotActive: "This account is not active. Please contact your system administrator.",
    internalSystemLabel: "Internal Programme Management System",
    systemTagline: "One secure platform.",
    copyright: "CAFA PMIS © 2026",
  };
  return { useTranslation: () => ({ t: (key: string) => strings[key] ?? key }) };
});

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

import LoginPage from "../pages/login";

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeMemoryStorage());
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Username Or Email"), "staff.user");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign In" }));
}

describe("LOGIN-ERROR-MESSAGES", () => {
  it("shows a distinct lockout message for 429, not the generic credentials message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "too_many_requests" }) }));
    const user = userEvent.setup();
    renderLogin();
    await submit(user);

    expect(await screen.findByText("Too many requests. Please wait 15 minutes and try again.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid username or password. Please try again.")).not.toBeInTheDocument();
  });

  it("shows a distinct deactivated-account message for 403 account_not_active", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "account_not_active", status: "suspended" }) }));
    const user = userEvent.setup();
    renderLogin();
    await submit(user);

    expect(await screen.findByText("This account is not active. Please contact your system administrator.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid username or password. Please try again.")).not.toBeInTheDocument();
  });

  it("still shows the generic message for wrong credentials (401) — no account enumeration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "invalid_credentials" }) }));
    const user = userEvent.setup();
    renderLogin();
    await submit(user);

    expect(await screen.findByText("Invalid username or password. Please try again.")).toBeInTheDocument();
  });

  it("shows a distinct network-error message for a fetch rejection, not the credentials message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const user = userEvent.setup();
    renderLogin();
    await submit(user);

    expect(await screen.findByText("Network error. Please check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid username or password. Please try again.")).not.toBeInTheDocument();
  });

  it("does not mark the browser as a returning user after any failed or errored attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "account_not_active" }) }));
    const user = userEvent.setup();
    renderLogin();
    await submit(user);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(localStorage.getItem("cafa.hasSignedIn")).toBeNull();
  });
});
