/**
 * Object Storage abstraction — AWS S3 is the production standard, with
 * alternate providers retained for development and explicitly selected
 * deployments:
 *
 *  • "s3"      — AWS S3 / Cloudflare R2 / MinIO.
 *                Production standard. Set: STORAGE_PROVIDER=s3
 *                     S3_BUCKET, S3_REGION (required in production)
 *                     S3_ENDPOINT_URL   (for R2/MinIO; omit for standard AWS S3)
 *                Credentials come from the AWS SDK default provider chain
 *                (prefer an attached IAM role; static keys are optional).
 *
 *  • "gcs"     — Google Cloud Storage with a service account key.
 *                Alternate provider; select explicitly when needed.
 *                Set: STORAGE_PROVIDER=gcs
 *                     GCS_PROJECT_ID, GCS_BUCKET_NAME,
 *                     GCS_CLIENT_EMAIL, GCS_PRIVATE_KEY
 *                Optional: GCS_PUBLIC_BASE_URL  (CDN/public bucket URL prefix)
 *
 *  • "replit"  — Replit GCS sidecar. Works ONLY on Replit hosting.
 *                Default when STORAGE_PROVIDER is not set.
 *
 * In production (NODE_ENV=production), startup rejects an incomplete selected
 * provider before the server accepts traffic. isStorageConfigured() still
 * returns a human-readable status for the authenticated admin status endpoint.
 */

import { Readable } from "stream";
import { randomUUID } from "crypto";
import { Storage, File as GCSFile } from "@google-cloud/storage";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// ─── Provider selection ────────────────────────────────────────────────────────

export type StorageProvider = "gcs" | "s3" | "replit";

export function activeProvider(): StorageProvider {
  const p = process.env.STORAGE_PROVIDER?.trim();
  if (!p || p === "replit") return "replit";
  if (p === "gcs" || p === "s3") return p;
  throw new Error(
    `Unsupported STORAGE_PROVIDER="${p}". Expected one of: s3, gcs, replit.`,
  );
}

// ─── Storage configuration health ─────────────────────────────────────────────

export interface StorageStatus {
  configured: boolean;
  provider: StorageProvider;
  reason?: string;
}

function configuredValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

function hasInvalidWhitespace(value: string | undefined): boolean {
  return value !== undefined && value !== value.trim();
}

export function isStorageConfigured(): StorageStatus {
  const provider = activeProvider();

  if (provider === "gcs") {
    const missing: string[] = [];
    if (!configuredValue("GCS_BUCKET_NAME")) missing.push("GCS_BUCKET_NAME");
    if (!configuredValue("GCS_CLIENT_EMAIL")) missing.push("GCS_CLIENT_EMAIL");
    if (!configuredValue("GCS_PRIVATE_KEY")) missing.push("GCS_PRIVATE_KEY");
    if (missing.length > 0) {
      return {
        configured: false,
        provider,
        reason: `Missing required environment variables: ${missing.join(", ")}`,
      };
    }
    return { configured: true, provider };
  }

  if (provider === "s3") {
    const missing: string[] = [];
    const bucket = configuredValue("S3_BUCKET");
    const region = configuredValue("S3_REGION");
    if (!bucket) missing.push("S3_BUCKET");
    // Development keeps the historical "auto" default for S3-compatible
    // local services. Production must name the region explicitly so an
    // incomplete AWS configuration cannot reach the listener.
    if (process.env.NODE_ENV === "production" && !region) missing.push("S3_REGION");

    if (missing.length > 0) {
      return {
        configured: false,
        provider,
        reason: `Missing required environment variables: ${missing.join(", ")}`,
      };
    }

    if (hasInvalidWhitespace(bucket) || (region !== undefined && hasInvalidWhitespace(region))) {
      return {
        configured: false,
        provider,
        reason: "S3_BUCKET and S3_REGION must not have leading or trailing whitespace",
      };
    }

    const endpoint = configuredValue("S3_ENDPOINT_URL");
    if (endpoint) {
      try {
        const parsed = new URL(endpoint);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      } catch {
        return {
          configured: false,
          provider,
          reason: "S3_ENDPOINT_URL must be a valid http(s) URL when provided",
        };
      }
    }

    return { configured: true, provider };
  }

  // "replit" provider
  if (process.env.NODE_ENV === "production") {
    return {
      configured: false,
      provider,
      reason:
        "STORAGE_PROVIDER=replit is only available on Replit hosting. " +
          "Set STORAGE_PROVIDER=s3 with S3_BUCKET and S3_REGION for production, " +
          "or select the alternate provider explicitly.",
    };
  }
  return { configured: true, provider };
}

/**
 * Validates the selected storage provider at process startup. The runtime
 * keeps provider-specific health reporting for the admin status endpoint, but
 * production must fail before migrations or HTTP listen when its selected
 * provider is incomplete or malformed.
 */
export function validateStorageConfiguration(): void {
  const status = isStorageConfigured();
  if (process.env.NODE_ENV === "production" && !status.configured) {
    throw new Error(`Storage configuration invalid: ${status.reason ?? "unknown error"}`);
  }
}

// ─── StorageFile discriminated union ──────────────────────────────────────────
// Callers never inspect internals — they pass the opaque value from
// searchPublicObject / getObjectEntityFile straight into downloadObject().

export type StorageFile =
  | { readonly _p: "gcs"; readonly file: GCSFile; readonly isGcsServiceAccount: boolean }
  | { readonly _p: "s3"; readonly bucket: string; readonly key: string };

export interface ObjectEntityMetadata {
  size: number;
  contentType?: string;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ─── GCS: Replit sidecar client ───────────────────────────────────────────────

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const replitGcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as Record<string, unknown>,
  projectId: "",
});

// ─── GCS: Service account client (production) ─────────────────────────────────

let _gcsServiceAccount: Storage | null = null;
function gcsServiceAccountClient(): Storage {
  if (!_gcsServiceAccount) {
    const privateKey = process.env.GCS_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!process.env.GCS_CLIENT_EMAIL || !privateKey) {
      throw new Error(
        "GCS_CLIENT_EMAIL and GCS_PRIVATE_KEY are required when STORAGE_PROVIDER=gcs"
      );
    }
    _gcsServiceAccount = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: {
        client_email: process.env.GCS_CLIENT_EMAIL,
        private_key: privateKey,
      },
    });
  }
  return _gcsServiceAccount;
}

function gcsBucketName(): string {
  const b = process.env.GCS_BUCKET_NAME;
  if (!b) throw new Error("GCS_BUCKET_NAME is required when STORAGE_PROVIDER=gcs");
  return b;
}

function gcsClientForProvider(): Storage {
  return activeProvider() === "gcs" ? gcsServiceAccountClient() : replitGcsClient;
}

// ─── S3 client ────────────────────────────────────────────────────────────────

let _s3: S3Client | null = null;
function s3Client(): S3Client {
  if (!_s3) {
    const endpoint = process.env.S3_ENDPOINT_URL;
    _s3 = new S3Client({
      region: configuredValue("S3_REGION") ?? "auto",
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),

    });
  }
  return _s3;
}

function s3Bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is required when STORAGE_PROVIDER=s3");
  return b;
}

// ─── GCS path helpers ─────────────────────────────────────────────────────────

function parseGCSPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid GCS path: must contain at least a bucket name");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

// ─── Replit sidecar URL signer ────────────────────────────────────────────────

async function signReplitObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: string;
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to sign object URL (${response.status}). Are you running on Replit?`);
  }
  const data = (await response.json()) as { signed_url: string };
  return data.signed_url;
}

// ─── ObjectStorageService ─────────────────────────────────────────────────────

export class ObjectStorageService {

  // ── Replit path helpers ──────────────────────────────────────────────────

  private getReplitPublicSearchPaths(): string[] {
    const raw = process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "";
    const paths = [...new Set(raw.split(",").map((p) => p.trim()).filter(Boolean))];
    if (paths.length === 0) {
      throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set (required for Replit storage).");
    }
    return paths;
  }

  private getReplitPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set (required for Replit storage).");
    return dir;
  }

  // ── searchPublicObject ───────────────────────────────────────────────────

  async searchPublicObject(filePath: string): Promise<StorageFile | null> {
    const provider = activeProvider();

    if (provider === "gcs") {
      const bucket = gcsServiceAccountClient().bucket(gcsBucketName());
      const publicPrefix = (process.env.GCS_PUBLIC_PREFIX ?? "public").replace(/\/$/, "");
      const file = bucket.file(`${publicPrefix}/${filePath}`);
      const [exists] = await file.exists();
      if (!exists) return null;
      return { _p: "gcs", file, isGcsServiceAccount: true };
    }

    if (provider === "s3") {
      const bucket = s3Bucket();
      const prefix = (process.env.S3_PUBLIC_PREFIX ?? "public").replace(/\/$/, "");
      const key = `${prefix}/${filePath}`;
      try {
        await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { _p: "s3", bucket, key };
      } catch {
        return null;
      }
    }

    // Replit GCS sidecar
    for (const searchPath of this.getReplitPublicSearchPaths()) {
      const { bucketName, objectName } = parseGCSPath(`${searchPath}/${filePath}`);
      const file = replitGcsClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return { _p: "gcs", file, isGcsServiceAccount: false };
    }
    return null;
  }

  // ── getObjectEntityFile ──────────────────────────────────────────────────

  async getObjectEntityFile(objectPath: string): Promise<StorageFile> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) throw new ObjectNotFoundError();

    const provider = activeProvider();

    if (provider === "gcs") {
      const privatePrefix = (process.env.GCS_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const file = gcsServiceAccountClient().bucket(gcsBucketName()).file(`${privatePrefix}/${entityId}`);
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError();
      return { _p: "gcs", file, isGcsServiceAccount: true };
    }

    if (provider === "s3") {
      const bucket = s3Bucket();
      const privatePrefix = (process.env.S3_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const key = `${privatePrefix}/${entityId}`;
      try {
        await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { _p: "s3", bucket, key };
      } catch {
        throw new ObjectNotFoundError();
      }
    }

    // Replit GCS sidecar
    let entityDir = this.getReplitPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    const { bucketName, objectName } = parseGCSPath(`${entityDir}${entityId}`);
    const objectFile = replitGcsClient.bucket(bucketName).file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return { _p: "gcs", file: objectFile, isGcsServiceAccount: false };
  }

  /**
   * Reads provider-authoritative metadata for a private upload before a
   * parent record accepts it. Direct-upload descriptors bind declared
   * metadata, but this verifies the bytes that actually reached storage.
   */
  async getObjectEntityMetadata(objectPath: string): Promise<ObjectEntityMetadata> {
    const objectFile = await this.getObjectEntityFile(objectPath);

    if (objectFile._p === "s3") {
      const metadata = await s3Client().send(
        new HeadObjectCommand({ Bucket: objectFile.bucket, Key: objectFile.key }),
      );
      const size = metadata.ContentLength;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
        throw new Error("Storage object metadata has an invalid size");
      }
      return {
        size,
        ...(metadata.ContentType ? { contentType: metadata.ContentType } : {}),
      };
    }

    const [metadata] = await objectFile.file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Storage object metadata has an invalid size");
    }
    return {
      size,
      ...(typeof metadata.contentType === "string" ? { contentType: metadata.contentType } : {}),
    };
  }

  /**
   * Promotes a verified temporary upload to a fresh, server-controlled key.
   * Upload URLs only target uploads/*, so callers cannot overwrite the key a
   * parent record ultimately stores after this succeeds.
   */
  async finalizeObjectEntityUpload(
    objectPath: string,
    namespace: "messages" | "profiles" | "files" = "messages",
    objectId?: string,
  ): Promise<string> {
    const source = await this.getObjectEntityFile(objectPath);
    const entityId = `${namespace}/${objectId ?? randomUUID()}`;
    const finalObjectPath = `/objects/${entityId}`;

    if (source._p === "s3") {
      const privatePrefix = (process.env.S3_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const key = `${privatePrefix}/${entityId}`;
      try {
        await s3Client().send(new HeadObjectCommand({ Bucket: source.bucket, Key: key }));
        await s3Client().send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.key }));
        return finalObjectPath;
      } catch {
        // Destination does not exist yet; perform the promotion below.
      }
      const copySource = `${source.bucket}/${source.key.split("/").map(encodeURIComponent).join("/")}`;
      await s3Client().send(new CopyObjectCommand({
        Bucket: source.bucket,
        Key: key,
        CopySource: copySource,
      }));
      await s3Client().send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.key }));
      return finalObjectPath;
    }

    let destination: GCSFile;
    if (source.isGcsServiceAccount) {
      const privatePrefix = (process.env.GCS_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      destination = gcsServiceAccountClient().bucket(gcsBucketName()).file(`${privatePrefix}/${entityId}`);
    } else {
      const { bucketName, objectName } = parseGCSPath(`${this.getReplitPrivateObjectDir()}/${entityId}`);
      destination = replitGcsClient.bucket(bucketName).file(objectName);
    }
    try {
      const [exists] = await destination.exists();
      if (exists) {
        await source.file.delete().catch(() => {});
        return finalObjectPath;
      }
    } catch {
      // Destination lookup failure is not proof of existence; copy below.
    }
    await source.file.copy(destination);
    await source.file.delete();
    return finalObjectPath;
  }

  // ── downloadObject ───────────────────────────────────────────────────────

  async downloadObject(storageFile: StorageFile, cacheTtlSec = 3600): Promise<Response> {
    if (storageFile._p === "s3") {
      const { bucket, key } = storageFile;
      const result = await s3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = result.Body;
      if (!body) throw new Error("Empty S3 response body");
      const webStream = Readable.toWeb(
        Readable.from(body as unknown as NodeJS.ReadableStream)
      ) as ReadableStream;
      const isPublicKey = (process.env.S3_PUBLIC_PREFIX ?? "public").replace(/\/$/, "") + "/";
      const isPublic = key.startsWith(isPublicKey);
      const headers: Record<string, string> = {
        "Content-Type": result.ContentType ?? "application/octet-stream",
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      };
      if (result.ContentLength != null) headers["Content-Length"] = String(result.ContentLength);
      return new Response(webStream, { headers });
    }

    // GCS (both Replit sidecar and service account)
    const { file, isGcsServiceAccount } = storageFile;
    const [metadata] = await file.getMetadata();
    let isPublic = false;
    if (!isGcsServiceAccount) {
      // Replit: check ACL metadata
      const aclPolicy = await getObjectAclPolicy(file);
      isPublic = aclPolicy?.visibility === "public";
    } else {
      // Service account: treat as private unless key starts with public prefix
      const publicPrefix = (process.env.GCS_PUBLIC_PREFIX ?? "public").replace(/\/$/, "") + "/";
      isPublic = file.name.startsWith(publicPrefix);
    }
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers["Content-Length"] = String(metadata.size);
    return new Response(webStream, { headers });
  }

  // ── getObjectEntityUploadURL ─────────────────────────────────────────────

  async getObjectEntityUploadURL(contentType = "application/octet-stream"): Promise<string> {
    const objectId = randomUUID();
    const provider = activeProvider();

    if (provider === "gcs") {
      const privatePrefix = (process.env.GCS_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const key = `${privatePrefix}/uploads/${objectId}`;
      const file = gcsServiceAccountClient().bucket(gcsBucketName()).file(key);
      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + 15 * 60 * 1000,
        contentType,
      });
      return signedUrl;
    }

    if (provider === "s3") {
      const bucket = s3Bucket();
      const privatePrefix = (process.env.S3_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const key = `${privatePrefix}/uploads/${objectId}`;
      return s3GetSignedUrl(
        s3Client(),
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: 900 },
      );
    }

    // Replit GCS sidecar
    const fullPath = `${this.getReplitPrivateObjectDir()}/uploads/${objectId}`;
    const { bucketName, objectName } = parseGCSPath(fullPath);
    return signReplitObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  /**
   * Stores bytes under a server-controlled canonical object identity.
   * This is intentionally the only server-side byte upload primitive used by
   * administrative imports and generated assets; user uploads use the
   * descriptor/finalisation flow above.
   */
  async uploadBuffer(
    buffer: Buffer,
    fileName: string,
    contentType: string,
    namespace = "files",
    objectId: string = randomUUID(),
  ): Promise<string> {
    const entityId = `${namespace}/${objectId}`;
    const provider = activeProvider();

    if (provider === "s3") {
      const bucket = s3Bucket();
      const privatePrefix = (process.env.S3_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      await s3Client().send(new PutObjectCommand({
        Bucket: bucket,
        Key: `${privatePrefix}/${entityId}`,
        Body: buffer,
        ContentType: contentType,
        ContentDisposition: `inline; filename="${fileName.replace(/["\r\n]/g, "_")}"`,
      }));
      return `/objects/${entityId}`;
    }

    if (provider === "gcs") {
      const privatePrefix = (process.env.GCS_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const file = gcsServiceAccountClient().bucket(gcsBucketName()).file(`${privatePrefix}/${entityId}`);
      await file.save(buffer, { contentType, resumable: false });
      return `/objects/${entityId}`;
    }

    let entityDir = this.getReplitPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    const { bucketName, objectName } = parseGCSPath(`${entityDir}${entityId}`);
    const url = await signReplitObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: buffer,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Canonical object upload failed (${response.status})`);
    return `/objects/${entityId}`;
  }

  // ── normalizeObjectEntityPath ────────────────────────────────────────────

  normalizeObjectEntityPath(rawPath: string): string {
    const provider = activeProvider();

    if (provider === "gcs") {
      // GCS signed URLs: https://storage.googleapis.com/BUCKET/objects/uploads/UUID?X-Goog-...
      if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
      try {
        const url = new URL(rawPath);
        // pathname = /BUCKET/PREFIX/...
        const bucketName = gcsBucketName();
        const afterBucket = url.pathname.slice(`/${bucketName}/`.length);
        const privatePrefix = (process.env.GCS_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
        if (afterBucket.startsWith(`${privatePrefix}/`)) {
          const entityId = afterBucket.slice(`${privatePrefix}/`.length);
          return `/objects/${entityId}`;
        }
        return rawPath;
      } catch {
        return rawPath;
      }
    }

    if (provider === "s3") {
      if (!rawPath.startsWith("http")) return rawPath;
      try {
        const url = new URL(rawPath);
        const privatePrefix = (process.env.S3_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
        // Standard AWS S3 signed URLs are virtual-hosted: the bucket is in
        // the hostname and `/objects/...` is already the object key. Custom
        // endpoints are configured forcePathStyle, so only those URLs carry
        // the bucket as their first pathname component.
        const pathParts = process.env.S3_ENDPOINT_URL
          ? url.pathname.replace(new RegExp(`^/${s3Bucket().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "/")
          : url.pathname;
        if (pathParts.startsWith(`/${privatePrefix}/`)) {
          const entityId = pathParts.slice(`/${privatePrefix}/`.length);
          // Storage paths are provider-neutral. S3_PRIVATE_PREFIX only maps
          // the canonical `/objects` identity to the provider key.
          return `/objects/${entityId}`;
        }
      } catch {
        // not a URL
      }
      return rawPath;
    }

    // Replit GCS sidecar
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    try {
      const url = new URL(rawPath);
      let entityDir = this.getReplitPrivateObjectDir();
      if (!entityDir.endsWith("/")) entityDir += "/";
      if (!url.pathname.startsWith(entityDir)) return url.pathname;
      return `/objects/${url.pathname.slice(entityDir.length)}`;
    } catch {
      return rawPath;
    }
  }

  // ── deleteObject ─────────────────────────────────────────────────────────

  /**
   * Delete a stored object by its normalised object path.
   * Returns { deleted: true, notFound: false } on success.
   * Returns { deleted: false, notFound: true } when the object was already absent (idempotent).
   * Throws on all other storage errors.
   */
  async deleteObject(objectPath: string): Promise<{ deleted: boolean; notFound: boolean }> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) throw new ObjectNotFoundError();

    const provider = activeProvider();

    if (provider === "gcs") {
      const privatePrefix = (process.env.GCS_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const file = gcsServiceAccountClient().bucket(gcsBucketName()).file(`${privatePrefix}/${entityId}`);
      try {
        await file.delete();
        return { deleted: true, notFound: false };
      } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        if (code === 404) return { deleted: false, notFound: true };
        throw err;
      }
    }

    if (provider === "s3") {
      const bucket = s3Bucket();
      const privatePrefix = (process.env.S3_PRIVATE_PREFIX ?? "objects").replace(/\/$/, "");
      const key = `${privatePrefix}/${entityId}`;
      // S3 DELETE is idempotent — returns 204 even for missing objects
      await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return { deleted: true, notFound: false };
    }

    // Replit GCS sidecar — same GCS client path, different credentials
    let entityDir = this.getReplitPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    const { bucketName, objectName } = parseGCSPath(`${entityDir}${entityId}`);
    const objectFile = replitGcsClient.bucket(bucketName).file(objectName);
    try {
      await objectFile.delete();
      return { deleted: true, notFound: false };
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 404) return { deleted: false, notFound: true };
      throw err;
    }
  }

  // ── ACL helpers ──────────────────────────────────────────────────────────

  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const provider = activeProvider();
    if (provider === "s3" || provider === "gcs") {
      // S3/GCS service account: ACL managed via bucket policy, not per-object tags
      return this.normalizeObjectEntityPath(rawPath);
    }
    // Replit: use object ACL metadata
    const normalized = this.normalizeObjectEntityPath(rawPath);
    if (!normalized.startsWith("/")) return normalized;
    const sf = await this.getObjectEntityFile(normalized);
    if (sf._p === "gcs" && !sf.isGcsServiceAccount) {
      await setObjectAclPolicy(sf.file, aclPolicy);
    }
    return normalized;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StorageFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const provider = activeProvider();
    // S3 and GCS service account: access is fully controlled by backend RBAC
    if (provider === "s3" || provider === "gcs") return true;
    // Replit: also check object-level ACL
    if (objectFile._p !== "gcs" || objectFile.isGcsServiceAccount) return true;
    return canAccessObject({
      userId,
      objectFile: objectFile.file,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

// Keep legacy export for anything that imported the GCS client directly
export const objectStorageClient = replitGcsClient;

// ─── deleteStorageObjectSafely ────────────────────────────────────────────────
// Thin helper used by deletion routes: treats NotFound as already-deleted.
// On any non-NotFound storage error, throws so the caller can decide ordering.

const _sharedObjectStorageService = new ObjectStorageService();

/**
 * Deletes a storage object, treating NotFound as already-deleted (idempotent).
 * On any non-NotFound storage error, throws so the caller can handle ordering.
 */
export async function deleteStorageObjectSafely(
  objectPath: string,
): Promise<{ deleted: boolean }> {
  try {
    const result = await _sharedObjectStorageService.deleteObject(objectPath);
    return { deleted: !result.notFound };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { deleted: false }; // treat as already gone
    }
    throw err; // propagate transient/auth errors
  }
}
