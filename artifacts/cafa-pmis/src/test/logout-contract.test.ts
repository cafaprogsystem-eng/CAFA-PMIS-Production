import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../components/layout.tsx"),
  "utf8",
);

describe("logout client contract", () => {
  it("uses one guarded handler for every visible logout entry point", () => {
    expect(source.match(/onClick=\{handleLogout\}/g)).toHaveLength(5);
    expect(source).toContain(
      "const [isLoggingOut, setIsLoggingOut] = useState(false)",
    );
  });

  it("does not discard authenticated state until the API confirms logout", () => {
    const request = source.indexOf('fetch("/api/auth/logout"');
    const clearRecent = source.indexOf("clearItems(meData.user.id)");
    const redirect = source.indexOf("window.location.assign");
    expect(request).toBeGreaterThan(-1);
    expect(clearRecent).toBeGreaterThan(request);
    expect(redirect).toBeGreaterThan(clearRecent);
    expect(source).toContain("if (!response.ok) throw new Error");
    expect(source).toContain("if (body?.ok !== true) throw new Error");
    expect(source).toContain('toast.error(tCommon("logoutFailed")');
  });

  it("clears account-scoped state and disconnects realtime without touching public preferences", () => {
    const stopBackground = source.indexOf("stopAuthenticatedBackgroundWork()");
    const cancelQueries = source.indexOf("await queryClient.cancelQueries");
    const disconnect = source.indexOf("socket?.disconnect()");
    const clearQueries = source.indexOf("queryClient.clear()", disconnect);
    expect(stopBackground).toBeGreaterThan(-1);
    expect(cancelQueries).toBeGreaterThan(stopBackground);
    expect(disconnect).toBeGreaterThan(cancelQueries);
    expect(clearQueries).toBeGreaterThan(disconnect);
    expect(source).toContain("socket?.disconnect()");
    expect(source).toContain("clearFavorites(meData.user.id)");
    expect(source).toContain('window.localStorage.removeItem("cafa.userId")');
    expect(source).toContain("clearOfflineData()");
    expect(source).toContain("clearAllAttachmentData()");
    expect(source).toContain("setOfflineUser(null)");
    expect(source).not.toContain('localStorage.removeItem("cafa.lang")');
    expect(source).not.toContain(
      'localStorage.removeItem("cafa.sidebarCollapsed")',
    );
  });

  it("redirects directly to the sign-in route after a confirmed termination", () => {
    expect(source).toContain("window.location.assign(`${base}/login`)");
  });
});
