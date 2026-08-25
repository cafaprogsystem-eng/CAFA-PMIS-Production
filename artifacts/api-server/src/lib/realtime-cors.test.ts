import { createHmac, randomBytes } from "crypto";
import { createServer, request as httpRequest, type Server as HttpServer } from "http";
import { Socket } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeService } from "./realtime";
import {
  getConfiguredPublicAppOrigins,
  isAllowedCredentialedOrigin,
} from "./security-config";

const mockPoolQuery = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

const TEST_SECRET = "realtime-cors-test-secret";
const APPROVED_ORIGIN = "https://cafa.example.com";
const USER = {
  id: 42,
  name: "Realtime Test User",
  role: "state_officer",
  state_id: 7,
  status: "active",
};

type Harness = {
  httpServer: HttpServer;
  service: RealtimeService;
  port: number;
};

const SESSION_TOKEN = "realtime-test-session-token";
const SESSION = {
  id: "realtime-session-42",
  user_id: USER.id,
  expires_at: new Date("2030-01-01T00:00:00.000Z"),
};

function signedSessionCookie(token = SESSION_TOKEN): string {
  const value = token;
  const signature = createHmac("sha256", TEST_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `cafa_sid=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

function mockActiveSession(): void {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM auth_sessions")) return Promise.resolve({ rows: [SESSION], rowCount: 1 });
    if (sql.includes("SELECT id, name, role, state_id, status FROM users")) {
      return Promise.resolve({ rows: [USER], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

async function startHarness(
  allowedOrigins: readonly string[],
): Promise<Harness> {
  const httpServer = createServer();
  const service = new RealtimeService();
  service.init(httpServer, TEST_SECRET, allowedOrigins);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("test HTTP server did not expose a port");
  }

  return { httpServer, service, port: address.port };
}

async function stopHarness(harness: Harness): Promise<void> {
  harness.service.close();
  if (!harness.httpServer.listening) return;
  await new Promise<void>((resolve) => harness.httpServer.close(() => resolve()));
}

function pollingHandshake(
  port: number,
  origin?: string,
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/api/socket.io/?EIO=4&transport=polling",
      headers: {
        ...(origin ? { Origin: origin } : {}),
        Cookie: signedSessionCookie(),
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers,
        body,
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

function connectPollingSocket(port: number, sid: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: `/api/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`,
      headers: {
        Origin: origin,
        Cookie: signedSessionCookie(),
        "Content-Type": "text/plain",
        "Content-Length": "2",
      },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end("40");
  });
}

function websocketHandshake(
  port: number,
  origin?: string,
): Promise<{ statusCode: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const key = randomBytes(16).toString("base64");
    let response = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback();
    };

    socket.setTimeout(3000, () => {
      finish(() => reject(new Error("WebSocket handshake timed out")));
    });
    socket.on("error", (error) => {
      if (!settled) finish(() => reject(error));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      const headerEnd = response.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;

      const lines = response.slice(0, headerEnd).split("\r\n");
      const statusCode = Number(lines[0]?.split(" ")[1] ?? 0);
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const separator = line.indexOf(":");
        if (separator > 0) {
          headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
        }
      }
      finish(() => resolve({ statusCode, headers }));
    });
    socket.connect(port, "127.0.0.1", () => {
      socket.write([
        "GET /api/socket.io/?EIO=4&transport=websocket HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        ...(origin ? [`Origin: ${origin}`] : []),
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        `Cookie: ${signedSessionCookie()}`,
        "",
        "",
      ].join("\r\n"));
    });
  });
}

describe("realtime credentialed origin boundary", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const harnesses: Harness[] = [];

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    mockPoolQuery.mockReset();
    await Promise.all(harnesses.splice(0).map(stopHarness));
  });

  it("accepts the exact configured origin for polling and authenticates normally", async () => {
    process.env.NODE_ENV = "production";
    mockActiveSession();
    const harness = await startHarness([APPROVED_ORIGIN]);
    harnesses.push(harness);

    const response = await pollingHandshake(harness.port, APPROVED_ORIGIN);

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(APPROVED_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.body).toMatch(/^0\{/);
    const sid = JSON.parse(response.body.slice(1)).sid as string;
    expect(await connectPollingSocket(harness.port, sid, APPROVED_ORIGIN)).toBe(200);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM auth_sessions"),
      expect.any(Array),
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id, name, role, state_id, status, sector FROM users"),
      [USER.id],
    );
  });

  it.each([
    "https://foreign.example.com",
    "https://cafa.example.com.attacker.example",
    "http://cafa.example.com",
    "https://cafa.example.com:8443",
  ])("rejects %s before credential authentication on polling", async (origin) => {
    process.env.NODE_ENV = "production";
    mockActiveSession();
    const harness = await startHarness([APPROVED_ORIGIN]);
    harnesses.push(harness);

    const response = await pollingHandshake(harness.port, origin);

    expect(response.statusCode).toBe(400);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(response.body).not.toContain(TEST_SECRET);
    expect(response.body).not.toContain("cafa_sid");
  });

  it("applies the same exact-origin boundary to WebSocket upgrades", async () => {
    process.env.NODE_ENV = "production";
    mockActiveSession();
    const harness = await startHarness([APPROVED_ORIGIN]);
    harnesses.push(harness);

    const approved = await websocketHandshake(harness.port, APPROVED_ORIGIN);
    expect(approved.statusCode).toBe(101);

    for (const origin of [
      "https://foreign.example.com",
      "https://cafa.example.com.attacker.example",
      "http://cafa.example.com",
      "https://cafa.example.com:8443",
    ]) {
      const rejected = await websocketHandshake(harness.port, origin);
      expect(rejected.statusCode).toBe(400);
    }
  });

  it("preserves originless server-side clients without allowing foreign browser origins", () => {
    process.env.NODE_ENV = "production";
    expect(isAllowedCredentialedOrigin(undefined, [APPROVED_ORIGIN])).toBe(true);
    expect(isAllowedCredentialedOrigin("https://foreign.example.com", [APPROVED_ORIGIN])).toBe(false);
  });

  it("accepts originless server-side polling clients in production", async () => {
    process.env.NODE_ENV = "production";
    mockActiveSession();
    const harness = await startHarness([APPROVED_ORIGIN]);
    harnesses.push(harness);

    const response = await pollingHandshake(harness.port);

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps empty-list localhost and Replit development access usable", async () => {
    process.env.NODE_ENV = "development";
    mockActiveSession();
    const harness = await startHarness([]);
    harnesses.push(harness);

    const response = await pollingHandshake(harness.port, "http://localhost:5173");

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(isAllowedCredentialedOrigin("https://workspace.replit.dev", [], true)).toBe(true);
    expect(isAllowedCredentialedOrigin("https://foreign.example.com", [], false)).toBe(false);
  });

  it("fails closed when production configuration is missing or malformed", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PUBLIC_APP_URL;
    expect(() => getConfiguredPublicAppOrigins()).toThrow("PUBLIC_APP_URL is required in production");
    expect(() => new RealtimeService().init(createServer(), TEST_SECRET))
      .toThrow("PUBLIC_APP_URL is required in production");

    process.env.PUBLIC_APP_URL = "https://cafa.example.com/path";
    expect(() => getConfiguredPublicAppOrigins()).toThrow(
      "PUBLIC_APP_URL must contain only valid http(s) origins",
    );
  });
});