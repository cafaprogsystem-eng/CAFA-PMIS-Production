import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

// ── Configuration ─────────────────────────────────────────────────────────────
// All values come from environment variables — no hardcoded secrets.
//
// Required env vars:
//   AWS_REGION             e.g. us-east-1
//   AWS_S3_BUCKET          e.g. cafa-pmis-attachments
// Credentials are provided by the AWS SDK default provider chain.
// On EC2 production, this uses the attached IAM Role automatically.

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.AWS_S3_BUCKET;

export const MAX_ATTACHMENT_BYTES =
  Number(process.env.MAX_ATTACHMENT_SIZE_MB ?? "25") * 1024 * 1024;

// ── Config status (safe — no secrets ever surfaced) ───────────────────────────

export interface S3ConfigStatus {
  hasRegion: boolean;
  hasBucket: boolean;
  hasAccessKey: boolean;
  hasSecretKey: boolean;

  configured: boolean;
  bucket: string | null; // bucket name is safe to expose (not a secret)
  region: string | null;
}

export function getConfigStatus(): S3ConfigStatus {
  const hasRegion = !!(REGION && REGION.trim());
  const hasBucket = !!(BUCKET && BUCKET.trim());
  const hasAccessKey = !!(process.env.AWS_ACCESS_KEY_ID?.trim());
  const hasSecretKey = !!(process.env.AWS_SECRET_ACCESS_KEY?.trim());

  return {
    hasRegion,
    hasBucket,
    hasAccessKey,
    hasSecretKey,
    configured: hasRegion && hasBucket,
    bucket: hasBucket ? BUCKET! : null,
    region: hasRegion ? REGION! : null,
  };
}

export function isConfigured(): boolean {
  return getConfigStatus().configured;
}

export interface S3ObjectMetadata {
  size: number;
  contentType: string | null;
}

/**
 * Reads provider-authoritative metadata without returning a signed URL or
 * provider credentials. Reconciliation uses the distinction between a
 * confirmed absence and an unavailable provider to avoid false "missing"
 * classifications.
 */
export async function headFile(fileKey: string): Promise<
  | { resolution: "confirmed"; metadata: S3ObjectMetadata }
  | { resolution: "missing" }
  | { resolution: "unavailable" }
> {
  if (!isConfigured()) return { resolution: "unavailable" };
  try {
    const result = await getClient().send(
      new HeadObjectCommand({ Bucket: BUCKET!, Key: fileKey }),
    );
    if (
      typeof result.ContentLength !== "number" ||
      !Number.isSafeInteger(result.ContentLength) ||
      result.ContentLength < 0
    ) {
      return { resolution: "unavailable" };
    }
    return {
      resolution: "confirmed",
      metadata: {
        size: result.ContentLength,
        contentType: result.ContentType ?? null,
      },
    };
  } catch (error) {
    const code = (error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } })?.name
      ?? (error as { Code?: string })?.Code;
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (code === "NotFound" || code === "NoSuchKey" || status === 404) {
      return { resolution: "missing" };
    }
    logger.warn({ msg: "S3 object metadata unavailable", detail: String(error).slice(0, 160) });
    return { resolution: "unavailable" };
  }
}

// ── S3 client (lazy singleton) ────────────────────────────────────────────────

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    const s = getConfigStatus();
    if (!s.configured) {
      logger.error({
        msg: "AWS S3 is not configured",
        hasRegion: s.hasRegion,
        hasBucket: s.hasBucket,

      });
      throw new Error("AWS S3 storage is not configured");
    }
    _client = new S3Client({
      region: REGION!,

    });
  }
  return _client;
}

// ── Key helpers ────────────────────────────────────────────────────────────────

// S3 key structure: {module}/{YYYY-MM}/{uuid}-{sanitized-filename}
export function buildObjectKey(module: string, originalName: string): string {
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
  return `${module}/${ym}/${randomUUID()}-${safe}`;
}

// Archive key: archive/{original-key}
function archiveKey(key: string): string {
  return `archive/${key}`;
}

// ── Upload ────────────────────────────────────────────────────────────────────

export interface UploadOptions {
  key?: string; // if omitted, generated from module + name
  module: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface S3UploadResult {
  fileKey: string;
  fileUrl: string; // canonical s3:// URI (not a presigned URL; use getPresignedUrl for access)
  fileName: string;
  fileSize: number;
  uploadedAt: string; // ISO 8601
}

export async function uploadFile(opts: UploadOptions): Promise<S3UploadResult> {
  const client = getClient();
  const key = opts.key ?? buildObjectKey(opts.module, opts.name);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET!,
        Key: key,
        Body: opts.buffer,
        ContentType: opts.mimeType,
        ContentDisposition: `attachment; filename="${opts.name.replace(/"/g, "_")}"`,
        Metadata: {
          "original-name": opts.name,
          module: opts.module,
        },
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "S3 upload failed", detail: msg.slice(0, 200) });
    if (msg.includes("InvalidAccessKeyId") || msg.includes("SignatureDoesNotMatch")) {
      throw new Error("AWS S3 authentication failed — check IAM Role permissions");
    }
    if (msg.includes("NoSuchBucket") || msg.includes("AccessDenied")) {
      throw new Error("AWS S3 bucket access denied — check AWS_S3_BUCKET and IAM permissions");
    }
    throw new Error("AWS S3 upload failed");
  }

  return {
    fileKey: key,
    fileUrl: `s3://${BUCKET!}/${key}`,
    fileName: opts.name,
    fileSize: opts.buffer.length,
    uploadedAt: new Date().toISOString(),
  };
}

// ── Presigned URL (for client-side "Open" links) ──────────────────────────────

export async function getPresignedUrl(
  fileKey: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: BUCKET!, Key: fileKey }),
    { expiresIn: expiresInSeconds },
  );
}

// Generate presigned URLs for a batch of keys efficiently
export async function batchPresignedUrls(
  fileKeys: string[],
  expiresInSeconds = 3600,
): Promise<Map<string, string>> {
  const client = getClient();
  const results = new Map<string, string>();
  await Promise.all(
    fileKeys.map(async (key) => {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: BUCKET!, Key: key }),
          { expiresIn: expiresInSeconds },
        );
        results.set(key, url);
      } catch {
        results.set(key, ""); // gracefully omit broken keys
      }
    }),
  );
  return results;
}

// ── Download (server-side stream) ─────────────────────────────────────────────

export async function downloadFileStream(fileKey: string): Promise<ReadableStream<Uint8Array> | null> {
  const client = getClient();
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET!, Key: fileKey }),
    );
    if (!res.Body) return null;
    // AWS SDK v3 returns a SdkStreamMixin which has transformToWebStream()
    return res.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "S3 download failed", detail: msg.slice(0, 200) });
    return null;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteFile(fileKey: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET!, Key: fileKey }));
}

// ── Archive (non-destructive "delete" — moves to archive/ prefix) ─────────────

export async function archiveFile(fileKey: string): Promise<void> {
  const client = getClient();
  const destination = archiveKey(fileKey);
  try {
    // Copy to archive prefix
    await client.send(
      new CopyObjectCommand({
        Bucket: BUCKET!,
        CopySource: `${BUCKET!}/${fileKey}`,
        Key: destination,
      }),
    );
    // Remove original
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET!, Key: fileKey }));
  } catch (err) {
    // Non-fatal — log and continue
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg: "S3 archive failed — original not removed", key: fileKey, detail: msg.slice(0, 200) });
  }
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; lastError?: string }> {
  if (!isConfigured()) {
    return { ok: false, lastError: "AWS S3 storage is not configured" };
  }
  const client = getClient();
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET! }));
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe =
      msg.includes("InvalidAccessKeyId") || msg.includes("SignatureDoesNotMatch")
        ? "AWS S3 authentication failed — check credentials"
        : msg.includes("NoSuchBucket")
        ? `Bucket '${BUCKET}' not found`
        : msg.includes("AccessDenied") || msg.includes("403")
        ? "Access denied — check IAM permissions for s3:HeadBucket"
        : `S3 connection error: ${msg.slice(0, 80)}`;
    logger.error({ msg: "S3 health check failed", detail: msg.slice(0, 200) });
    return { ok: false, lastError: safe };
  }
}
