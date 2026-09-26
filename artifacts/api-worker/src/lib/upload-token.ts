/**
 * Ported from artifacts/api-server/src/lib/uploadToken.ts — stateless
 * HMAC-signed upload descriptor. Only `verifyUploadToken` is currently called
 * (by projects.ts's document-upload validation); `signUploadToken` is ported
 * alongside it since both halves of the same small file belong together and
 * the signing side will be needed once the dedicated upload-URL routes are
 * ported. Adapted like lib/session.ts: the secret is passed in explicitly
 * (`c.env.SESSION_SECRET`) rather than read from `process.env`, since Workers
 * has no process.env.
 *
 * Token format (no third-party JWT library):
 *   <base64url(JSON.stringify(payload))>.<hex_hmac_sha256(base64url_payload, secret)>
 *
 * Verification:
 *   1. Split on the LAST dot.
 *   2. Recompute HMAC over the base64url payload.
 *   3. Compare with timingSafeEqual (constant-time).
 *   4. Check exp > Date.now()/1000.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UploadDescriptor {
  /** Server-generated canonical path: /objects/uploads/<uuid> */
  objectPath: string;
  /** User who requested the upload URL. */
  userId: number;
  /** Parent report the upload is bound to, or 0 for a message attachment/profile photo. */
  reportId: number;
  /** Kind of evidence being registered. */
  entityType: "attachment" | "voice_note" | "message_attachment" | "profile_photo";
  /** Scope that distinguishes special-purpose descriptors from report evidence. */
  scope?: "messages" | "profile" | "documents";
  /** Original safe filename, required when scope is messages. */
  fileName?: string;
  /** Server-approved MIME at issuance. */
  contentType: string;
  /** Declared size at issuance (server's copy). */
  maxSize: number;
  /** Issued-at epoch seconds. */
  iat: number;
  /** Expiry epoch seconds (iat + 86400 — 24 hours). */
  exp: number;
  /** Canonical attachment upload operation, when this is an attachment descriptor. */
  operationId?: string;
  /** Canonical attachment parent, when this is an attachment descriptor. */
  parentType?: "plan" | "risk";
  parentId?: number;
}

// ─── Custom error ────────────────────────────────────────────────────────────

export class UploadTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadTokenError";
  }
}

// ─── Encoding helpers ────────────────────────────────────────────────────────

function base64urlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): string {
  // Re-pad and convert to standard base64
  const padded = str + "==".slice(0, (4 - (str.length % 4)) % 4);
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64").toString("utf8");
}

function computeHmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign an UploadDescriptor and return a compact token string.
 *
 * Format: `<base64url_payload>.<hex_hmac>`
 */
export function signUploadToken(payload: UploadDescriptor, secret: string): string {
  const encoded = base64urlEncode(JSON.stringify(payload));
  const sig = computeHmac(encoded, secret);
  return `${encoded}.${sig}`;
}

/**
 * Verify a token string and return the parsed UploadDescriptor.
 *
 * Throws `UploadTokenError` when:
 *   - The token format is invalid (missing dot, not parseable JSON)
 *   - The HMAC signature does not match (tampered)
 *   - The token has expired (`exp <= now`)
 */
export function verifyUploadToken(token: string, secret: string): UploadDescriptor {
  // Split on the LAST dot to isolate payload and signature
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 1) {
    throw new UploadTokenError("malformed_upload_token");
  }

  const encodedPayload = token.slice(0, lastDot);
  const providedSig = token.slice(lastDot + 1);

  // Constant-time HMAC comparison
  const expectedSig = computeHmac(encodedPayload, secret);
  let sigsMatch = false;
  try {
    sigsMatch = timingSafeEqual(
      Buffer.from(providedSig, "hex"),
      Buffer.from(expectedSig, "hex"),
    );
  } catch {
    // Buffer lengths differ — signature is definitely wrong
    sigsMatch = false;
  }
  if (!sigsMatch) {
    throw new UploadTokenError("invalid_upload_token_signature");
  }

  // Parse the payload
  let descriptor: UploadDescriptor;
  try {
    descriptor = JSON.parse(base64urlDecode(encodedPayload)) as UploadDescriptor;
  } catch {
    throw new UploadTokenError("invalid_upload_token_payload");
  }

  // Expiry check
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!descriptor.exp || descriptor.exp <= nowSeconds) {
    throw new UploadTokenError("upload_token_expired");
  }

  return descriptor;
}
