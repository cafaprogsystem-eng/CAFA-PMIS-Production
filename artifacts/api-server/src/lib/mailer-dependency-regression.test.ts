import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockClose,
  mockCreateTransport,
  mockPoolQuery,
  mockSendMail,
} = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockCreateTransport: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockSendMail: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("nodemailer", () => ({
  createTransport: mockCreateTransport,
}));

async function loadMailer(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("./mailer");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Mailer dependency regression coverage", () => {
  it("keeps invitation, reset, and verification messages deliverable through the configured stub", async () => {
    const mailer = await loadMailer({
      EMAIL_ENABLED: "false",
      APP_BASE_URL: "https://cafa.example.test",
    });
    const expiresAt = new Date("2026-08-24T12:00:00.000Z");
    const invitation = mailer.renderInviteEmail({
      name: "Amina",
      email: "amina@example.test",
      roleLabel: "Technical Coordinator",
      stateName: "Khartoum",
      sector: "Health",
      token: "invite token",
      expiresAt,
    });
    const reset = mailer.renderPasswordResetEmail({
      name: "Amina",
      email: "amina@example.test",
      token: "reset token",
      expiresAt,
    });
    const verification = mailer.renderVerifyEmail({
      name: "Amina",
      email: "amina@example.test",
      token: "verify token",
      expiresAt,
    });

    expect(invitation.html).toContain("accept-invitation?token=invite%20token");
    expect(reset.html).toContain("reset-password?token=reset%20token");
    expect(verification.html).toContain("verify-email?token=verify%20token");

    await expect(mailer.sendEmail({
      to: "amina@example.test",
      subject: invitation.subject,
      html: invitation.html,
      text: invitation.text,
      kind: "user.invite",
      userId: 10,
    })).resolves.toEqual({ delivered: false, provider: "stub", status: "pending" });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO email_logs"),
      expect.arrayContaining([10, "amina@example.test", "user.invite", "pending", "stub"]),
    );
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it("uses the SMTP transport without changing the fail-closed delivery result contract", async () => {
    mockSendMail.mockResolvedValue({ messageId: "smtp-message-1" });
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail, close: mockClose });
    const mailer = await loadMailer({
      EMAIL_ENABLED: "true",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "mailer",
      SMTP_PASS: "not-a-real-secret",
      SMTP_SECURE: "false",
      EMAIL_FROM_ADDRESS: "noreply@example.test",
    });

    await expect(mailer.sendEmail({
      to: "recipient@example.test",
      subject: "Test subject",
      html: "<p>Test</p>",
      text: "Test",
      kind: "email_verification",
    })).resolves.toEqual({ delivered: true, provider: "smtp", status: "sent" });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      auth: { user: "mailer", pass: "not-a-real-secret" },
    });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "recipient@example.test",
      subject: "Test subject",
      html: "<p>Test</p>",
    }));
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO email_logs"),
      expect.arrayContaining(["recipient@example.test", "email_verification", "sent", "smtp", "smtp-message-1"]),
    );
  });
});