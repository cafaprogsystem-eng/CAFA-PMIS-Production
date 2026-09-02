/**
 * CERT-VERIFY-PUBLIC-ROUTE — /manual/certificate/:certId used to live only
 * inside the authenticated Router(), so AuthGate redirected any signed-out
 * visitor to /login before the certificate-verification page ever rendered —
 * defeating the point of a public "verify a certificate" lookup. It must be
 * reachable from the public Switch in App(), before the <AuthGate/> catch-all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

describe("CERT-VERIFY-PUBLIC-ROUTE", () => {
  it("mounts the certificate-verify route in the public Switch, before the AuthGate catch-all", () => {
    const publicSwitchStart = app.indexOf('<Route path="/login" component={LoginPage} />');
    const certRouteIndex = app.indexOf('<Route path="/manual/certificate/:certId">');
    const authGateIndex = app.indexOf("<Route><AuthGate /></Route>");

    expect(publicSwitchStart).toBeGreaterThan(-1);
    expect(certRouteIndex).toBeGreaterThan(publicSwitchStart);
    expect(certRouteIndex).toBeLessThan(authGateIndex);
  });

  it("is not duplicated inside the authenticated Router() (would be dead code, unreachable behind the public route above)", () => {
    expect((app.match(/<Route path="\/manual\/certificate\/:certId">/g) ?? [])).toHaveLength(1);
  });
});
