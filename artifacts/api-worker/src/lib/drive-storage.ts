import { randomUUID } from "node:crypto";
import "./aws-sdk-polyfills";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Bindings } from "./db";
import { MAX_ATTACHMENT_BYTES } from "./attachment-limits";

/**
 * Ported from artifacts/api-server/src/lib/awsS3.ts — the Drive module's own
 * storage backend, kept deliberately independent from lib/storage.ts (the
 * Filing & Archive / attachments / voice-notes backend), exactly as the
 * source kept awsS3.ts separate from objectStorage.ts.
 *
 * Migrated onto R2 (the same bucket and R2_* secrets already configured for
 * this worker) rather than provisioning a second set of real AWS credentials
 * — this worker's storage is R2 end to end, per the user's explicit choice
 * when this file was ported. Drive's key scheme
 * (`{module}/{YYYY-MM}/{uuid}-{name}`, plus an `archive/{key}` prefix for
 * archived files) shares no prefix with lib/storage.ts's `objects/`/`public/`
 * keys, so both backends can safely share one bucket.
 */

export { MAX_ATTACHMENT_BYTES };

export interface DriveConfigStatus {
  hasRegion: boolean;
  hasBucket: boolean;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  configured: boolean;
  bucket: string | null;
  region: string | null;
}

/**
 * Field names (hasRegion/region) are kept from the source S3ConfigStatus
 * shape for interface parity with the admin diagnostics routes, even though
 * R2 has no region concept of its own — "hasRegion" checks R2_ENDPOINT_URL
 * (the equivalent required piece of R2 config) and "region" always reports
 * "auto" once configured, matching the literal region value this worker's R2
 * S3Client is constructed with.
 */
export function getConfigStatus(env: Bindings): DriveConfigStatus {
  const hasRegion = !!env.R2_ENDPOINT_URL?.trim();
  const hasBucket = !!env.R2_BUCKET?.trim();
  const hasAccessKey = !!env.R2_ACCESS_KEY_ID?.trim();
  const hasSecretKey = !!env.R2_SECRET_ACCESS_KEY?.trim();
  return {
    hasRegion,
    hasBucket,
    hasAccessKey,
    hasSecretKey,
    configured: hasRegion && hasBucket && hasAccessKey && hasSecretKey,
    bucket: hasBucket ? env.R2_BUCKET : null,
    region: hasRegion ? "auto" : null,
  };
}

export function isConfigured(env: Bindings): boolean {
  return getConfigStatus(env).configured;
}

function s3Client(env: Bindings): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT_URL,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

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

export interface UploadOptions {
  key?: string; // if omitted, generated from module + name
  module: string;
  name: string;
  mimeType: string;
  buffer: Uint8Array;
}

export interface DriveUploadResult {
  fileKey: string;
  fileUrl: string; // canonical r2:// URI (not a presigned URL; use batchPresignedUrls for access)
  fileName: string;
  fileSize: number;
  uploadedAt: string; // ISO 8601
}

export async function uploadFile(env: Bindings, opts: UploadOptions): Promise<DriveUploadResult> {
  const key = opts.key ?? buildObjectKey(opts.module, opts.name);
  try {
    await s3Client(env).send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
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
    if (msg.includes("InvalidAccessKeyId") || msg.includes("SignatureDoesNotMatch")) {
      throw new Error("R2 authentication failed — check R2 credentials");
    }
    if (msg.includes("NoSuchBucket") || msg.includes("AccessDenied")) {
      throw new Error("R2 bucket access denied — check R2_BUCKET and credentials");
    }
    throw new Error("R2 upload failed");
  }

  return {
    fileKey: key,
    fileUrl: `r2://${env.R2_BUCKET}/${key}`,
    fileName: opts.name,
    fileSize: opts.buffer.byteLength,
    uploadedAt: new Date().toISOString(),
  };
}

/** Generate presigned URLs for a batch of keys efficiently. */
export async function batchPresignedUrls(
  env: Bindings,
  fileKeys: string[],
  expiresInSeconds = 3600,
): Promise<Map<string, string>> {
  const client = s3Client(env);
  const results = new Map<string, string>();
  await Promise.all(
    fileKeys.map(async (key) => {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
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

export async function downloadFileStream(env: Bindings, fileKey: string): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const res = await s3Client(env).send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: fileKey }));
    if (!res.Body) return null;
    return (res.Body as unknown as { transformToWebStream(): ReadableStream<Uint8Array> }).transformToWebStream();
  } catch {
    return null;
  }
}

export async function deleteFile(env: Bindings, fileKey: string): Promise<void> {
  await s3Client(env).send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: fileKey }));
}

/** Non-destructive "delete" — moves to the archive/ prefix. Non-fatal on failure, matching source. */
export async function archiveFile(env: Bindings, fileKey: string): Promise<void> {
  const destination = archiveKey(fileKey);
  try {
    const client = s3Client(env);
    const copySource = `${env.R2_BUCKET}/${fileKey.split("/").map(encodeURIComponent).join("/")}`;
    await client.send(new CopyObjectCommand({ Bucket: env.R2_BUCKET, CopySource: copySource, Key: destination }));
    await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: fileKey }));
  } catch {
    // Non-fatal — original left in place, matching source's behaviour.
  }
}

export async function testConnection(env: Bindings): Promise<{ ok: boolean; lastError?: string }> {
  if (!isConfigured(env)) {
    return { ok: false, lastError: "R2 storage is not configured" };
  }
  try {
    await s3Client(env).send(new HeadBucketCommand({ Bucket: env.R2_BUCKET }));
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe =
      msg.includes("InvalidAccessKeyId") || msg.includes("SignatureDoesNotMatch")
        ? "R2 authentication failed — check credentials"
        : msg.includes("NoSuchBucket")
        ? `Bucket '${env.R2_BUCKET}' not found`
        : msg.includes("AccessDenied") || msg.includes("403")
        ? "Access denied — check R2 API token permissions"
        : `R2 connection error: ${msg.slice(0, 80)}`;
    return { ok: false, lastError: safe };
  }
}
