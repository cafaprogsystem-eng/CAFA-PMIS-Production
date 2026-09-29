import type { Bindings } from "./db";
import type { QueryExecutor } from "./db";

/**
 * Ported from artifacts/api-server/src/lib/mailer.ts — the Resend and
 * SendGrid providers only (both a single fetch() call, no platform
 * coupling). SMTP is dropped: nodemailer's transport needs a raw TCP socket
 * per send, which Workers' networking model doesn't give nodejs_compat, and
 * production only ever configures Resend anyway (see
 * infra/aws-production/template.yaml's ResendApiKeySecret). Config comes
 * from env bindings instead of process.env; everything else — retry loop,
 * DB logging, HTML templates — is unchanged.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  kind: string;
  userId?: number | null;
  meta?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type EmailDeliveryStatus = "pending" | "sent" | "failed";
type SendResult = { delivered: boolean; provider: string; messageId?: string; error?: string };

/**
 * Ported from artifacts/api-server/src/lib/mailer.ts. Monthly reporting
 * reminder emails need server-side idempotency (a crash between "sent" and
 * "settled" must never double-send) — Resend supports this the same way
 * sendEmail already uses it (Idempotency-Key header), SendGrid does not.
 */
export function mailerSupportsIdempotentDelivery(env: Bindings): boolean {
  const cfg = config(env);
  return !cfg.enabled || cfg.provider === "resend";
}

/**
 * Server-side-only check of the current FROM domain's verification status
 * with the configured provider. The raw API key never leaves the Worker —
 * only a status string reaches the caller. Resend-only for now (SendGrid
 * has no equivalent single-domain lookup used elsewhere in this file).
 */
export async function checkFromDomainVerification(env: Bindings): Promise<
  { domain: string; provider: string; status: string; region?: string } | { domain: string; provider: string; error: string }
> {
  const cfg = config(env);
  const domain = cfg.fromAddress.split("@")[1] ?? cfg.fromAddress;
  if (cfg.provider !== "resend") {
    return { domain, provider: cfg.provider, error: "domain_status_not_supported_for_provider" };
  }
  if (!cfg.apiKey) {
    return { domain, provider: cfg.provider, error: "no_api_key_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown");
      return { domain, provider: cfg.provider, error: `HTTP ${res.status}: ${err}` };
    }
    const data = (await res.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string; region?: string }> };
    const match = (data.data ?? []).find((d) => d.name.toLowerCase() === domain.toLowerCase());
    if (!match) return { domain, provider: cfg.provider, error: "domain_not_found_in_provider" };
    return { domain, provider: cfg.provider, status: match.status, region: match.region };
  } catch (e) {
    return { domain, provider: cfg.provider, error: e instanceof Error ? e.message : "unknown_error" };
  }
}

function config(env: Bindings) {
  return {
    enabled: String(env.EMAIL_ENABLED ?? "").toLowerCase() === "true",
    provider: (env.EMAIL_PROVIDER ?? "stub").toLowerCase(),
    apiKey: env.EMAIL_API_KEY ?? "",
    fromAddress: env.EMAIL_FROM_ADDRESS ?? "noreply@cafa.org",
    fromName: env.EMAIL_FROM_NAME ?? "CAFA Program Management System",
    replyTo: env.EMAIL_REPLY_TO ?? "",
  };
}

async function sendViaResend(env: Bindings, email: OutboundEmail): Promise<SendResult> {
  const cfg = config(env);
  const body: Record<string, unknown> = {
    from: `${cfg.fromName} <${cfg.fromAddress}>`,
    to: [email.to],
    subject: email.subject,
    html: email.html,
  };
  if (email.text) body.text = email.text;
  if (cfg.replyTo) body.reply_to = cfg.replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
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

async function sendViaSendGrid(env: Bindings, email: OutboundEmail): Promise<SendResult> {
  const cfg = config(env);
  const body = {
    personalizations: [{ to: [{ email: email.to }] }],
    from: { email: cfg.fromAddress, name: cfg.fromName },
    subject: email.subject,
    content: [
      { type: "text/html", value: email.html },
      ...(email.text ? [{ type: "text/plain", value: email.text }] : []),
    ],
    ...(cfg.replyTo ? { reply_to: { email: cfg.replyTo } } : {}),
    ...(email.idempotencyKey ? {
      custom_args: { cafa_delivery_id: email.idempotencyKey },
      headers: { "X-CAFA-Delivery-ID": email.idempotencyKey },
    } : {}),
  };
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    return { delivered: false, provider: "sendgrid", error: `HTTP ${res.status}: ${err}` };
  }
  return { delivered: true, provider: "sendgrid", messageId: res.headers.get("x-message-id") ?? undefined };
}

async function logEmailToDB(
  db: QueryExecutor,
  opts: {
    userId?: number | null;
    emailTo: string;
    emailType: string;
    subject: string;
    status: "sent" | "failed" | "pending";
    provider: string;
    providerMessageId?: string;
    errorMessage?: string;
  },
): Promise<void> {
  try {
    await db.query(
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
  } catch {
    // The realtime.ts precedent: a side-effect logging failure must not turn
    // a successful (or already-handled) send into a hard error for the caller.
  }
}

export async function sendEmail(
  env: Bindings,
  db: QueryExecutor,
  email: OutboundEmail,
): Promise<{ delivered: boolean; provider: string; status: EmailDeliveryStatus }> {
  const cfg = config(env);

  if (!cfg.enabled) {
    await logEmailToDB(db, {
      userId: email.userId, emailTo: email.to, emailType: email.kind,
      subject: email.subject, status: "pending", provider: "stub",
    });
    return { delivered: false, provider: "stub", status: "pending" };
  }

  if (!cfg.apiKey) {
    await logEmailToDB(db, {
      userId: email.userId, emailTo: email.to, emailType: email.kind,
      subject: email.subject, status: "failed", provider: cfg.provider, errorMessage: "EMAIL_API_KEY not set",
    });
    return { delivered: false, provider: "noop", status: "failed" };
  }

  const MAX_ATTEMPTS = 3;
  let lastResult: SendResult = { delivered: false, provider: cfg.provider };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (cfg.provider === "resend") lastResult = await sendViaResend(env, email);
      else if (cfg.provider === "sendgrid") lastResult = await sendViaSendGrid(env, email);
      else {
        lastResult = { delivered: false, provider: cfg.provider, error: "unknown provider" };
        break;
      }

      if (lastResult.delivered) {
        await logEmailToDB(db, {
          userId: email.userId, emailTo: email.to, emailType: email.kind,
          subject: email.subject, status: "sent", provider: lastResult.provider,
          providerMessageId: lastResult.messageId,
        });
        return { delivered: true, provider: lastResult.provider, status: "sent" };
      }
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1000));
    } catch (e) {
      lastResult = { delivered: false, provider: cfg.provider, error: String(e) };
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }

  await logEmailToDB(db, {
    userId: email.userId, emailTo: email.to, emailType: email.kind,
    subject: email.subject, status: "failed", provider: lastResult.provider, errorMessage: lastResult.error,
  });
  return { delivered: false, provider: lastResult.provider, status: "failed" };
}

export function publicAppUrl(env: Bindings): string {
  return (env.PUBLIC_APP_URL ?? "http://localhost").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Email templates — pure functions, ported verbatim (no I/O, no platform
// dependency in the original either).
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

export function renderPasswordResetEmail(env: Bindings, opts: {
  name: string; email: string; token: string; expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const link = `${publicAppUrl(env)}/reset-password?token=${encodeURIComponent(opts.token)}`;
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

export function renderPasswordResetConfirmEmail(_env: Bindings, opts: { name: string; email: string }): { subject: string; html: string; text: string } {
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

export function renderInviteEmail(env: Bindings, opts: {
  name: string; email: string; roleLabel: string;
  stateName: string | null; sector: string | null;
  token: string; expiresAt: Date; message?: string | null;
}): { subject: string; html: string; text: string } {
  const link = `${publicAppUrl(env)}/accept-invitation?token=${encodeURIComponent(opts.token)}`;
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

export function renderVerifyEmail(env: Bindings, opts: {
  name: string; email: string; token: string; expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const link = `${publicAppUrl(env)}/verify-email?token=${encodeURIComponent(opts.token)}`;
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

export function renderAccountActivatedEmail(env: Bindings, opts: { name: string; email: string }): { subject: string; html: string; text: string } {
  const loginLink = publicAppUrl(env);
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

export function renderAccountSuspendedEmail(_env: Bindings, opts: { name: string; email: string }): { subject: string; html: string; text: string } {
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

export function renderAccountDeactivatedEmail(_env: Bindings, opts: { name: string; email: string }): { subject: string; html: string; text: string } {
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
