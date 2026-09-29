import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import "./aws-sdk-polyfills";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Bindings } from "./db";

/**
 * Ported from artifacts/api-server/src/lib/objectStorage.ts — the "s3"
 * provider path only. Cloudflare R2 speaks the same S3-compatible API that
 * path already targets (S3_ENDPOINT_URL), so this is the same AWS SDK v3
 * calls against R2 credentials instead of AWS ones; the gcs/replit provider
 * branches (dev-only / Replit-only) have no equivalent need here and are
 * dropped, not ported.
 */

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface ObjectEntityMetadata {
  size: number;
  contentType?: string;
}

/**
 * Ported from artifacts/api-server/src/lib/objectStorage.ts's
 * isStorageConfigured — the "s3" provider branch only (this file has no gcs
 * or replit equivalent to report on). Workers always runs against the R2
 * binding's secrets, so there is no provider-selection question here, just
 * whether the required R2 secrets were actually set on this Worker.
 */
export interface StorageStatus {
  configured: boolean;
  provider: "r2";
  reason?: string;
}

export function isStorageConfigured(env: Bindings): StorageStatus {
  const missing: string[] = [];
  if (!env.R2_BUCKET?.trim()) missing.push("R2_BUCKET");
  if (!env.R2_ENDPOINT_URL?.trim()) missing.push("R2_ENDPOINT_URL");
  if (!env.R2_ACCESS_KEY_ID?.trim()) missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY?.trim()) missing.push("R2_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    return {
      configured: false,
      provider: "r2",
      reason: `Missing required environment variables: ${missing.join(", ")}`,
    };
  }
  return { configured: true, provider: "r2" };
}

const PRIVATE_PREFIX = "objects";
const PUBLIC_PREFIX = "public";

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

/** Presigned PUT URL for a client-direct upload into objects/uploads/<uuid>. */
export async function getObjectEntityUploadURL(
  env: Bindings,
  contentType = "application/octet-stream",
): Promise<string> {
  const objectId = randomUUID();
  const key = `${PRIVATE_PREFIX}/uploads/${objectId}`;
  return getSignedUrl(
    s3Client(env),
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 900 },
  );
}

/** Confirms a `public/<filePath>` key actually exists in the bucket. */
export async function searchPublicObject(
  env: Bindings,
  filePath: string,
): Promise<{ bucket: string; key: string } | null> {
  const key = `${PUBLIC_PREFIX}/${filePath}`;
  try {
    await s3Client(env).send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return { bucket: env.R2_BUCKET, key };
  } catch {
    return null;
  }
}

/** Confirms a canonical `/objects/...` path actually exists in the bucket. */
export async function getObjectEntityFile(
  env: Bindings,
  objectPath: string,
): Promise<{ bucket: string; key: string }> {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  const entityId = objectPath.slice("/objects/".length);
  if (!entityId) throw new ObjectNotFoundError();

  const key = `${PRIVATE_PREFIX}/${entityId}`;
  try {
    await s3Client(env).send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return { bucket: env.R2_BUCKET, key };
  } catch {
    throw new ObjectNotFoundError();
  }
}

export async function getObjectEntityMetadata(
  env: Bindings,
  objectPath: string,
): Promise<ObjectEntityMetadata> {
  const { bucket, key } = await getObjectEntityFile(env, objectPath);
  const metadata = await s3Client(env).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const size = metadata.ContentLength;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new Error("Storage object metadata has an invalid size");
  }
  return { size, ...(metadata.ContentType ? { contentType: metadata.ContentType } : {}) };
}

/** Promotes a verified upload from uploads/<uuid> to a server-controlled key. */
export async function finalizeObjectEntityUpload(
  env: Bindings,
  objectPath: string,
  namespace: "messages" | "profiles" | "files" = "messages",
  objectId: string = randomUUID(),
): Promise<string> {
  const source = await getObjectEntityFile(env, objectPath);
  const entityId = `${namespace}/${objectId}`;
  const finalObjectPath = `/objects/${entityId}`;
  const key = `${PRIVATE_PREFIX}/${entityId}`;
  const client = s3Client(env);

  try {
    await client.send(new HeadObjectCommand({ Bucket: source.bucket, Key: key }));
    await client.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.key }));
    return finalObjectPath;
  } catch {
    // Destination does not exist yet; perform the promotion below.
  }
  const copySource = `${source.bucket}/${source.key.split("/").map(encodeURIComponent).join("/")}`;
  await client.send(new CopyObjectCommand({ Bucket: source.bucket, Key: key, CopySource: copySource }));
  await client.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.key }));
  return finalObjectPath;
}

export async function downloadObject(
  env: Bindings,
  storageFile: { bucket: string; key: string },
  cacheTtlSec = 3600,
): Promise<Response> {
  const { bucket, key } = storageFile;
  const result = await s3Client(env).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = result.Body;
  if (!body) throw new Error("Empty object response body");
  const webStream = Readable.toWeb(
    Readable.from(body as unknown as NodeJS.ReadableStream),
  ) as unknown as ReadableStream;
  const isPublic = key.startsWith(`${PUBLIC_PREFIX}/`);
  const headers: Record<string, string> = {
    "Content-Type": result.ContentType ?? "application/octet-stream",
    "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
  };
  if (result.ContentLength != null) headers["Content-Length"] = String(result.ContentLength);
  return new Response(webStream, { headers });
}

/** Server-side byte upload for administrative imports and generated assets. */
export async function uploadBuffer(
  env: Bindings,
  buffer: Uint8Array,
  fileName: string,
  contentType: string,
  namespace = "files",
  objectId: string = randomUUID(),
): Promise<string> {
  const entityId = `${namespace}/${objectId}`;
  await s3Client(env).send(new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: `${PRIVATE_PREFIX}/${entityId}`,
    Body: buffer,
    ContentType: contentType,
    ContentDisposition: `inline; filename="${fileName.replace(/["\r\n]/g, "_")}"`,
  }));
  return `/objects/${entityId}`;
}

export async function deleteObject(
  env: Bindings,
  objectPath: string,
): Promise<{ deleted: boolean; notFound: boolean }> {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  const entityId = objectPath.slice("/objects/".length);
  if (!entityId) throw new ObjectNotFoundError();
  // DELETE is idempotent on S3-compatible stores — 204 even for missing keys.
  await s3Client(env).send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: `${PRIVATE_PREFIX}/${entityId}` }));
  return { deleted: true, notFound: false };
}

/**
 * Ported from artifacts/api-server/src/lib/objectStorage.ts's
 * deleteStorageObjectSafely: idempotent wrapper used by deletion routes
 * (e.g. the Project permanent-delete cascade) — treats a malformed/missing
 * objectPath as already-deleted instead of failing the whole deletion.
 */
export async function deleteObjectSafely(
  env: Bindings,
  objectPath: string,
): Promise<{ deleted: boolean }> {
  try {
    const result = await deleteObject(env, objectPath);
    return { deleted: !result.notFound };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { deleted: false }; // treat as already gone
    }
    throw err; // propagate transient/auth errors
  }
}

/** Parses a presigned upload URL back into its canonical `/objects/...` path. */
export function normalizeObjectEntityPath(env: Bindings, rawPath: string): string {
  if (!rawPath.startsWith("http")) return rawPath;
  try {
    const url = new URL(rawPath);
    const pathParts = url.pathname.replace(
      new RegExp(`^/${env.R2_BUCKET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`),
      "/",
    );
    if (pathParts.startsWith(`/${PRIVATE_PREFIX}/`)) {
      return `/objects/${pathParts.slice(`/${PRIVATE_PREFIX}/`.length)}`;
    }
  } catch {
    // not a URL
  }
  return rawPath;
}
