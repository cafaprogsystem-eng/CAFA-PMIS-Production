import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTIVITY_CONFIRMATION_WINDOW_MS,
  INITIAL_CONNECTIVITY,
  getConnectivitySnapshot,
  recordConnectivityEvidence,
  reduceConnectivity,
  resetConnectivityState,
  type ConnectivitySnapshot,
} from "../lib/connectivity-state";

const reduce = (
  evidence: Parameters<typeof reduceConnectivity>[1],
  state: ConnectivitySnapshot = INITIAL_CONNECTIVITY,
) => reduceConnectivity(state, evidence);

describe("canonical connectivity evidence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectivityState();
  });
  it("requires two transport failures before verified Offline", () => {
    const checking = reduceConnectivity(INITIAL_CONNECTIVITY, { kind: "transport-failure" }, 1_000);
    expect(checking.status).toBe("checking");
    expect(checking.reason).toBe("transport-failure");

    const offline = reduceConnectivity(checking, { kind: "transport-failure" }, 1_100);
    expect(offline.status).toBe("offline");
    expect(offline.reason).toBe("offline-confirmed");
  });

  it("expires stale failure evidence before a later transport error", () => {
    const checking = reduceConnectivity(INITIAL_CONNECTIVITY, { kind: "transport-failure" }, 1_000);
    const later = reduceConnectivity(
      checking,
      { kind: "transport-failure" },
      1_000 + CONNECTIVITY_CONFIRMATION_WINDOW_MS + 1,
    );
    expect(later.status).toBe("checking");
    expect(later.consecutiveTransportFailures).toBe(1);
  });

  it("does not turn one failed request, timeout, or browser hint into Offline", () => {
    expect(reduce({ kind: "browser-offline" }).status).toBe("checking");
    expect(reduce({ kind: "transport-failure" }).status).not.toBe("offline");
  });

  it("keeps HTTP outcomes distinct from transport loss", () => {
    expect(reduce({ kind: "api-http", status: 401 }).status).toBe("auth-required");
    expect(reduce({ kind: "api-http", status: 403 }).status).toBe("access-denied");
    expect(reduce({ kind: "api-http", status: 422 }).status).toBe("online");
    expect(reduce({ kind: "api-http", status: 500 }).status).toBe("online");
  });

  it("does not let a public health probe clear auth or access outcomes", () => {
    const authRequired = reduce({ kind: "api-http", status: 401 });
    const accessDenied = reduce({ kind: "api-http", status: 403 });
    expect(reduce({ kind: "probe-success" }, authRequired).status).toBe("auth-required");
    expect(reduce({ kind: "probe-success" }, accessDenied).status).toBe("access-denied");
    expect(reduce({ kind: "api-success" }, authRequired).status).toBe("online");
  });

  it("requires health confirmation rather than counting ordinary request failures", () => {
    const once = reduce({ kind: "api-transport-failure" });
    const twice = reduce({ kind: "api-transport-failure" }, once);
    expect(once.status).toBe("online");
    expect(twice.status).toBe("online");
    expect(twice.consecutiveTransportFailures).toBe(0);
  });

  it("only shows Degraded after bounded repeated service failures", () => {
    const once = reduceConnectivity(INITIAL_CONNECTIVITY, { kind: "api-http", status: 503 }, 1_000);
    expect(once.status).toBe("online");
    expect(once.consecutiveServiceFailures).toBe(1);

    const degraded = reduceConnectivity(once, { kind: "probe-http", status: 503 }, 1_100);
    expect(degraded.status).toBe("degraded");
    expect(degraded.reason).toBe("api-unavailable");

    const recovered = reduceConnectivity(degraded, { kind: "probe-success" }, 1_200);
    expect(recovered.status).toBe("online");
    expect(recovered.consecutiveServiceFailures).toBe(0);
  });

  it("expires stale service-failure evidence without showing Degraded", () => {
    const once = reduceConnectivity(INITIAL_CONNECTIVITY, { kind: "api-http", status: 500 }, 1_000);
    const later = reduceConnectivity(
      once,
      { kind: "probe-http", status: 500 },
      1_000 + CONNECTIVITY_CONFIRMATION_WINDOW_MS + 1,
    );
    expect(later.status).toBe("online");
    expect(later.consecutiveServiceFailures).toBe(1);
  });

  it("uses successful API traffic as recovery evidence", () => {
    const offline = reduce(
      { kind: "transport-failure" },
      reduce({ kind: "transport-failure" }),
    );
    const online = reduce({ kind: "api-success" }, offline);
    expect(online.status).toBe("online");
    expect(online.consecutiveTransportFailures).toBe(0);
  });

  it("retains a refreshed confirmation timestamp in the global store", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    recordConnectivityEvidence({ kind: "transport-failure" });

    now.mockReturnValue(1_000 + CONNECTIVITY_CONFIRMATION_WINDOW_MS + 1);
    recordConnectivityEvidence({ kind: "transport-failure" });
    expect(getConnectivitySnapshot().consecutiveTransportFailures).toBe(1);

    now.mockReturnValue(1_000 + CONNECTIVITY_CONFIRMATION_WINDOW_MS + 2);
    recordConnectivityEvidence({ kind: "transport-failure" });
    expect(getConnectivitySnapshot().status).toBe("offline");
  });
});