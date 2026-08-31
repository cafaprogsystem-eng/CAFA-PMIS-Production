import { createTransport } from "nodemailer";
import { logger } from "./logger";
import { pool } from "@workspace/db";

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  kind: string;
  userId?: number | null;
  meta?: Record<string, unknown>;
  /** Stable logical delivery identity for providers/transports that support deduplication. */
  idempotencyKey?: string;
};

const EMAIL_ENABLED =
  String(process.env.EMAIL_ENABLED ?? process.env.MAILER_ENABLED ?? "").toLowerCase() === "true";
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER ?? "stub").toLowerCase();
const EMAIL_API_KEY = process.env.EMAIL_API_KEY ?? "";
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? "noreply@cafa.org";
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME ?? "CAFA Program Management System";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "";

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587", 10);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true";

/**
 * Whether the active transport can suppress a repeated logical send after the
 * provider accepted it but before the caller durably recorded success.
 * Resend supports this through Idempotency-Key. Stub mode has no external side
 * effect. SendGrid correlation fields and SMTP Message-ID are not sufficient.
 */
export function mailerSupportsIdempotentDelivery(env = process.env): boolean {
  const enabled =
    String(env.EMAIL_ENABLED ?? env.MAILER_ENABLED ?? "").toLowerCase() === "true";
  const provider = (env.EMAIL_PROVIDER ?? "stub").toLowerCase();
  return !enabled || provider === "resend";
}

export function assertMonthlyReminderMailerConfiguration(env = process.env): void {
  if (!mailerSupportsIdempotentDelivery(env)) {
    throw new Error(
      "Monthly reporting reminders require EMAIL_PROVIDER=resend when email delivery is enabled; SendGrid and SMTP cannot guarantee crash-safe idempotency.",
    );
  }
}

type SendResult = { delivered: boolean; provider: string; messageId?: string; error?: string };
export type EmailDeliveryStatus = "pending" | "sent" | "failed";

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function sendViaResend(email: OutboundEmail): Promise<SendResult> {
  const body: Record<string, unknown> = {
    from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
    to: [email.to],
    subject: email.subject,
    html: email.html,
  };
  if (email.text) body.text = email.text;
  if (EMAIL_REPLY_TO) body.reply_to = EMAIL_REPLY_TO;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EMAIL_API_KEY}`,
      ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    return { delivered: false, provider: "resend", error: `HTTP ${res.status}: ${err}` };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { delivered: true, provider: "resend", messageId: data.id };
}

async function sendViaSendGrid(email: OutboundEmail): Promise<SendResult> {
  const body = {
    personalizations: [{ to: [{ email: email.to }] }],
    from: { email: EMAIL_FROM_ADDRESS, name: EMAIL_FROM_NAME },
    subject: email.subject,
    content: [
      { type: "text/html", value: email.html },
      ...(email.text ? [{ type: "text/plain", value: email.text }] : []),
    ],
    ...(EMAIL_REPLY_TO ? { reply_to: { email: EMAIL_REPLY_TO } } : {}),
    ...(email.idempotencyKey ? {
      custom_args: { cafa_delivery_id: email.idempotencyKey },
      headers: { "X-CAFA-Delivery-ID": email.idempotencyKey },
    } : {}),
  };
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMAIL_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    return { delivered: false, provider: "sendgrid", error: `HTTP ${res.status}: ${err}` };
  }
  return { delivered: true, provider: "sendgrid", messageId: res.headers.get("x-message-id") ?? undefined };
}

async function sendViaSmtp(email: OutboundEmail): Promise<SendResult> {
  const transport = createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  const info = await transport.sendMail({
    from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM_ADDRESS}>`,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: EMAIL_REPLY_TO || undefined,
    messageId: email.idempotencyKey ? `<${email.idempotencyKey}@cafa-pmis>` : undefined,
    headers: email.idempotencyKey ? { "X-CAFA-Delivery-ID": email.idempotencyKey } : undefined,
  });
  transport.close();
  return { delivered: true, provider: "smtp", messageId: info.messageId };
}

// ---------------------------------------------------------------------------
// Log to DB
// ---------------------------------------------------------------------------

async function logEmailToDB(opts: {
  userId?: number | null;
  emailTo: string;
  emailType: string;
  subject: string;
  status: "sent" | "failed" | "pending";
  provider: string;
  providerMessageId?: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO email_logs (user_id, email_to, email_type, subject, status, provider_name, provider_message_id, error_message, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        opts.userId ?? null,
        opts.emailTo,
        opts.emailType,
        opts.subject,
        opts.status,
        opts.provider,
        opts.providerMessageId ?? null,
        opts.errorMessage ?? null,
        opts.status === "sent" ? new Date() : null,
      ],
    );
  } catch (e) {
    logger.warn({ err: e }, "[mailer] failed to write email_log row");
  }
}

// ---------------------------------------------------------------------------
// Main send function with retry
// ---------------------------------------------------------------------------

export async function sendEmail(email: OutboundEmail): Promise<{ delivered: boolean; provider: string; status: EmailDeliveryStatus }> {
  if (!EMAIL_ENABLED) {
    logger.info(
      { mailer: "stub", kind: email.kind, to: email.to, subject: email.subject, meta: email.meta ?? null },
      `[mailer:stub] would send "${email.subject}" to ${email.to}`,
    );
    await logEmailToDB({
      userId: email.userId, emailTo: email.to, emailType: email.kind,
      subject: email.subject, status: "pending", provider: "stub",
    });
    return { delivered: false, provider: "stub", status: "pending" };
  }

  if (!EMAIL_API_KEY && EMAIL_PROVIDER !== "smtp") {
    logger.warn({ kind: email.kind, to: email.to }, "[mailer] EMAIL_ENABLED=true but EMAIL_API_KEY not set");
    await logEmailToDB({
      userId: email.userId, emailTo: email.to, emailType: email.kind,
      subject: email.subject, status: "failed", provider: EMAIL_PROVIDER, errorMessage: "EMAIL_API_KEY not set",
    });
    return { delivered: false, provider: "noop", status: "failed" };
  }

  const MAX_ATTEMPTS = 3;
  let lastResult: SendResult = { delivered: false, provider: EMAIL_PROVIDER };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (EMAIL_PROVIDER === "resend") lastResult = await sendViaResend(email);
      else if (EMAIL_PROVIDER === "sendgrid") lastResult = await sendViaSendGrid(email);
      else if (EMAIL_PROVIDER === "smtp") lastResult = await sendViaSmtp(email);
      else {
        logger.warn({ provider: EMAIL_PROVIDER }, "[mailer] unknown EMAIL_PROVIDER");
        lastResult = { delivered: false, provider: EMAIL_PROVIDER, error: "unknown provider" };
        break;
      }

      if (lastResult.delivered) {
        logger.info({ kind: email.kind, to: email.to, provider: lastResult.provider, messageId: lastResult.messageId }, "[mailer] sent");
        await logEmailToDB({
          userId: email.userId, emailTo: email.to, emailType: email.kind,
          subject: email.subject, status: "sent", provider: lastResult.provider,
          providerMessageId: lastResult.messageId,
        });
        return { delivered: true, provider: lastResult.provider, status: "sent" };
      }

      logger.warn({ kind: email.kind, to: email.to, attempt, error: lastResult.error }, `[mailer] attempt ${attempt} failed`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1000));
    } catch (e) {
      lastResult = { delivered: false, provider: EMAIL_PROVIDER, error: String(e) };
      logger.warn({ kind: email.kind, to: email.to, attempt, err: e }, `[mailer] attempt ${attempt} threw`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }

  await logEmailToDB({
    userId: email.userId, emailTo: email.to, emailType: email.kind,
    subject: email.subject, status: "failed", provider: lastResult.provider, errorMessage: lastResult.error,
  });
  return { delivered: false, provider: lastResult.provider, status: "failed" };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function publicAppUrl(): string {
  const fromEnv = process.env.APP_BASE_URL ?? process.env.PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const domains = process.env.REPLIT_DOMAINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (domains.length > 0) return `https://${domains[0]}`;
  return "http://localhost";
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

const HEADER = (accent = "#1a2744") => `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:580px;margin:0 auto;color:#111;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
<div style="background:${accent};padding:20px 24px">
  <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.3px">CAFA Program Management System</span>
</div>
<div style="padding:28px 24px">
`;

const FOOTER = `
</div>
<div style="background:#f9fafb;padding:14px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">
  This email was sent by CAFA Program Management System. If you didn't request this, you can safely ignore it.
  For support, contact your system administrator.
</div>
</div>
`;

function actionBtn(label: string, url: string, color = "#1a2744"): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;display:inline-block;font-weight:600;font-size:14px">${label}</a></p>`;
}

function fallbackUrl(url: string): string {
  return `<p style="font-size:12px;color:#6b7280;margin-top:4px">Or copy this link into your browser:<br/><span style="word-break:break-all;color:#1a2744">${url}</span></p>`;
}

// --- Password Reset --------------------------------------------------------

export function renderPasswordResetEmail(opts: {
  name: string; email: string; token: string; expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const link = `${publicAppUrl()}/reset-password?token=${encodeURIComponent(opts.token)}`;
  const expires = opts.expiresAt.toUTCString();
  const subject = "Reset your CAFA system password";
  const html = HEADER() + `
    <h2 style="margin:0 0 16px;font-size:20px">Reset your password</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>We received a request to reset the password for your CAFA PMIS account (<strong>${opts.email}</strong>). Click below — this link is valid for <strong>60 minutes</strong> and can only be used once.</p>
    ${actionBtn("Reset my password", link)}
    ${fallbackUrl(link)}
    <p style="font-size:12px;color:#6b7280;margin-top:16px">Expires: <strong>${expires}</strong><br/>If you didn't request this, ignore this email — your password won't change.</p>
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nReset your CAFA PMIS password:\n${link}\n\nExpires: ${expires}\n\nIf you didn't request this, ignore this email.`;
  return { subject, html, text };
}

// --- Password Changed Confirmation ----------------------------------------

export function renderPasswordResetConfirmEmail(opts: { name: string; email: string }): { subject: string; html: string; text: string } {
  const subject = "Your CAFA system password has been changed";
  const html = HEADER() + `
    <h2 style="margin:0 0 16px;font-size:20px">Password changed</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>Your CAFA Program Management System password was successfully changed.</p>
    <p style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:12px 16px;font-size:14px;color:#166534">✓ Your account is secure. You can now sign in with your new password.</p>
    <p style="font-size:13px;color:#6b7280;margin-top:16px">If you did not make this change, contact your administrator immediately.</p>
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nYour CAFA PMIS password was successfully changed.\n\nIf you did not make this change, contact your administrator immediately.`;
  return { subject, html, text };
}

// --- User Invitation -------------------------------------------------------

export function renderInviteEmail(opts: {
  name: string; email: string; roleLabel: string;
  stateName: string | null; sector: string | null;
  token: string; expiresAt: Date; message?: string | null;
}): { subject: string; html: string; text: string } {
  const link = `${publicAppUrl()}/accept-invitation?token=${encodeURIComponent(opts.token)}`;
  const expires = opts.expiresAt.toUTCString();
  const subject = "You're invited to join CAFA Program Management System";
  const roleRows = [
    `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Role</td><td style="padding:4px 0;font-size:13px;font-weight:600">${opts.roleLabel}</td></tr>`,
    opts.stateName ? `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">State</td><td style="padding:4px 0;font-size:13px">${opts.stateName}</td></tr>` : "",
    opts.sector ? `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Sector</td><td style="padding:4px 0;font-size:13px">${opts.sector}</td></tr>` : "",
  ].join("");
  const messageBlock = opts.message
    ? `<blockquote style="border-left:3px solid #0d3b66;margin:16px 0;padding:8px 16px;background:#f0f4ff;border-radius:0 4px 4px 0;font-style:italic;color:#374151;font-size:14px">${opts.message}</blockquote>`
    : "";
  const html = HEADER("#0d3b66") + `
    <h2 style="margin:0 0 16px;font-size:20px">You've been invited</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>Your account has been created on the <strong>CAFA Program Management System</strong>. Click below to activate your account and set your password.</p>
    <table style="margin:16px 0;border-collapse:collapse"><tbody>${roleRows}</tbody></table>
    ${messageBlock}
    ${actionBtn("Activate my account", link, "#0d3b66")}
    ${fallbackUrl(link)}
    <p style="font-size:12px;color:#6b7280;margin-top:16px">This link expires on <strong>${expires}</strong>. For security, do not share this link with anyone.</p>
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nYou've been invited to CAFA PMIS.\nRole: ${opts.roleLabel}${opts.stateName ? `\nState: ${opts.stateName}` : ""}${opts.sector ? `\nSector: ${opts.sector}` : ""}${opts.message ? `\n\nMessage from admin:\n${opts.message}` : ""}\n\nActivate your account: ${link}\nExpires: ${expires}\n\nDo not share this link with anyone.`;
  return { subject, html, text };
}

// --- Email Verification ---------------------------------------------------

export function renderVerifyEmail(opts: {
  name: string; email: string; token: string; expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const link = `${publicAppUrl()}/verify-email?token=${encodeURIComponent(opts.token)}`;
  const expires = opts.expiresAt.toUTCString();
  const subject = "Verify your CAFA Program Management System email";
  const html = HEADER() + `
    <h2 style="margin:0 0 16px;font-size:20px">Verify your email address</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>Please verify your email address <strong>${opts.email}</strong> to complete your CAFA PMIS account setup.</p>
    ${actionBtn("Verify email address", link)}
    ${fallbackUrl(link)}
    <p style="font-size:12px;color:#6b7280;margin-top:16px">This link expires on <strong>${expires}</strong> (24 hours). If you didn't create an account, ignore this email.</p>
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nVerify your CAFA PMIS email:\n${link}\n\nExpires: ${expires}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Startup config validation
// ---------------------------------------------------------------------------

/**
 * Call once at server boot when EMAIL_ENABLED=true.
 * Throws a descriptive Error if the active provider is missing required credentials.
 * Logs a warning (but does not throw) when EMAIL_ENABLED is false — stub mode is allowed in dev.
 */
export function validateEmailConfig(): void {
  if (!EMAIL_ENABLED) {
    logger.warn("[mailer] EMAIL_ENABLED is not set to 'true' — running in stub mode. No emails will be delivered.");
    return;
  }

  const missing: string[] = [];

  if (EMAIL_PROVIDER === "smtp") {
    if (!SMTP_HOST)              missing.push("SMTP_HOST");
    if (!SMTP_PORT || SMTP_PORT <= 0) missing.push("SMTP_PORT");
    if (!SMTP_USER)              missing.push("SMTP_USER");
    if (!SMTP_PASS)              missing.push("SMTP_PASS");
    if (!EMAIL_FROM_ADDRESS)     missing.push("EMAIL_FROM_ADDRESS (SMTP_FROM)");
  } else if (EMAIL_PROVIDER === "resend" || EMAIL_PROVIDER === "sendgrid") {
    if (!EMAIL_API_KEY) missing.push("EMAIL_API_KEY");
    if (!EMAIL_FROM_ADDRESS) missing.push("EMAIL_FROM_ADDRESS");
  } else {
    throw new Error(
      `[mailer] EMAIL_ENABLED=true but EMAIL_PROVIDER="${EMAIL_PROVIDER}" is not recognised. ` +
      `Valid values: resend, sendgrid, smtp.`,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `[mailer] EMAIL_ENABLED=true with provider="${EMAIL_PROVIDER}" but the following required ` +
      `environment variables are missing or empty: ${missing.join(", ")}. ` +
      `Set them in the Replit Secrets panel before starting the server.`,
    );
  }

  logger.info({ provider: EMAIL_PROVIDER, from: EMAIL_FROM_ADDRESS }, "[mailer] Email configuration validated — provider ready.");
}

// --- Account Activated -----------------------------------------------------

export function renderAccountActivatedEmail(opts: { name: string; email: string }): { subject: string; html: string; text: string } {
  const loginLink = publicAppUrl();
  const subject = "Your CAFA system account has been activated";
  const html = HEADER() + `
    <h2 style="margin:0 0 16px;font-size:20px">Account activated</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>Your CAFA Program Management System account (<strong>${opts.email}</strong>) has been <strong>activated</strong>. You can now sign in.</p>
    ${actionBtn("Sign in", loginLink)}
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nYour CAFA PMIS account has been activated. Sign in at: ${loginLink}`;
  return { subject, html, text };
}

// --- Account Suspended -----------------------------------------------------

export function renderAccountSuspendedEmail(opts: { name: string; email: string }): { subject: string; html: string; text: string } {
  const subject = "Your CAFA system account has been suspended";
  const html = HEADER("#78350f") + `
    <h2 style="margin:0 0 16px;font-size:20px">Account suspended</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>Your CAFA Program Management System account (<strong>${opts.email}</strong>) has been <strong>temporarily suspended</strong> and you will not be able to sign in until the suspension is lifted.</p>
    <p style="font-size:13px;color:#6b7280">If you believe this is a mistake, please contact your system administrator.</p>
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nYour CAFA PMIS account has been temporarily suspended. Contact your administrator if you believe this is a mistake.`;
  return { subject, html, text };
}

// --- Account Deactivated ---------------------------------------------------

export function renderAccountDeactivatedEmail(opts: { name: string; email: string }): { subject: string; html: string; text: string } {
  const subject = "Your CAFA system account has been deactivated";
  const html = HEADER("#7f1d1d") + `
    <h2 style="margin:0 0 16px;font-size:20px">Account deactivated</h2>
    <p>Hello <strong>${opts.name}</strong>,</p>
    <p>Your CAFA Program Management System account (<strong>${opts.email}</strong>) has been <strong>deactivated</strong> and you will no longer be able to sign in.</p>
    <p style="font-size:13px;color:#6b7280">If you believe this is a mistake, please contact your system administrator.</p>
  ` + FOOTER;
  const text = `Hello ${opts.name},\n\nYour CAFA PMIS account has been deactivated. Contact your administrator if this is a mistake.`;
  return { subject, html, text };
}
