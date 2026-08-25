import { afterEach, describe, expect, it, vi } from "vitest";

const mockGetSignedUrl = vi.hoisted(() => vi.fn());
const mockCopy = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockExists = vi.hoisted(() => vi.fn().mockResolvedValue([false]));
const mockFile = vi.hoisted(() => ({
  getSignedUrl: mockGetSignedUrl,
  copy: mockCopy,
  delete: mockDelete,
  exists: mockExists,
}));
const mockBucket = vi.hoisted(() => ({ file: vi.fn(() => mockFile) }));

vi.mock("@google-cloud/storage", () => ({
  Storage: class MockStorage {
    bucket = vi.fn(() => mockBucket);
  },
}));

const originalEnvironment = {
  storageProvider: process.env.STORAGE_PROVIDER,
  bucketName: process.env.GCS_BUCKET_NAME,
  clientEmail: process.env.GCS_CLIENT_EMAIL,
  privateKey: process.env.GCS_PRIVATE_KEY,
  s3Bucket: process.env.S3_BUCKET,
  s3Region: process.env.S3_REGION,
  s3Endpoint: process.env.S3_ENDPOINT_URL,
  s3PrivatePrefix: process.env.S3_PRIVATE_PREFIX,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries({
    STORAGE_PROVIDER: originalEnvironment.storageProvider,
    GCS_BUCKET_NAME: originalEnvironment.bucketName,
    GCS_CLIENT_EMAIL: originalEnvironment.clientEmail,
    GCS_PRIVATE_KEY: originalEnvironment.privateKey,
    S3_BUCKET: originalEnvironment.s3Bucket,
    S3_REGION: originalEnvironment.s3Region,
    S3_ENDPOINT_URL: originalEnvironment.s3Endpoint,
    S3_PRIVATE_PREFIX: originalEnvironment.s3PrivatePrefix,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  vi.clearAllMocks();
  restoreEnvironment();
});

describe("direct GCS private upload signing", () => {
  it("signs the same canonical MIME type that the message client PUTs", async () => {
    process.env.STORAGE_PROVIDER = "gcs";
    process.env.GCS_BUCKET_NAME = "private-bucket";
    process.env.GCS_CLIENT_EMAIL = "service@example.test";
    process.env.GCS_PRIVATE_KEY = "test-private-key";
    mockGetSignedUrl.mockResolvedValue(["https://storage.example.test/signed-upload"]);

    const { ObjectStorageService } = await import("./objectStorage");
    const url = await new ObjectStorageService().getObjectEntityUploadURL("audio/webm");

    expect(url).toBe("https://storage.example.test/signed-upload");
    expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.objectContaining({
      version: "v4",
      action: "write",
      contentType: "audio/webm",
    }));
  });

  it("promotes an accepted upload to a fresh message key and removes the temporary key", async () => {
    process.env.STORAGE_PROVIDER = "gcs";
    process.env.GCS_BUCKET_NAME = "private-bucket";
    process.env.GCS_CLIENT_EMAIL = "service@example.test";
    process.env.GCS_PRIVATE_KEY = "test-private-key";
    mockCopy.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockExists.mockResolvedValueOnce([true]).mockResolvedValueOnce([false]);

    const { ObjectStorageService } = await import("./objectStorage");
    const finalPath = await new ObjectStorageService().finalizeObjectEntityUpload("/objects/uploads/temporary");

    expect(finalPath).toMatch(/^\/objects\/messages\//);
    expect(mockCopy).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockBucket.file).toHaveBeenCalledWith("objects/uploads/temporary");
    expect(mockBucket.file).toHaveBeenCalledWith(expect.stringMatching(/^objects\/messages\//));
  });

  it("uses an operation-derived final key and treats a prior promotion as idempotent", async () => {
    process.env.STORAGE_PROVIDER = "gcs";
    process.env.GCS_BUCKET_NAME = "private-bucket";
    process.env.GCS_CLIENT_EMAIL = "service@example.test";
    process.env.GCS_PRIVATE_KEY = "test-private-key";
    mockExists.mockResolvedValueOnce([true]).mockResolvedValueOnce([true]);

    const { ObjectStorageService } = await import("./objectStorage");
    const finalPath = await new ObjectStorageService().finalizeObjectEntityUpload(
      "/objects/uploads/temporary",
      "files",
      "a0f7f2c7-86f7-453c-89b9-8a9b58da4d66",
    );

    expect(finalPath).toBe("/objects/files/a0f7f2c7-86f7-453c-89b9-8a9b58da4d66");
    expect(mockCopy).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledOnce();
  });
});

describe("S3 signed upload path normalisation", () => {
  it("preserves the object prefix for standard virtual-hosted S3 URLs", async () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.S3_BUCKET = "canonical-attachments";
    delete process.env.S3_ENDPOINT_URL;
    delete process.env.S3_PRIVATE_PREFIX;

    const { ObjectStorageService } = await import("./objectStorage");
    const path = new ObjectStorageService().normalizeObjectEntityPath(
      "https://canonical-attachments.s3.us-east-1.amazonaws.com/objects/uploads/operation-1?X-Amz-Signature=test",
    );

    expect(path).toBe("/objects/uploads/operation-1");
  });

  it("maps non-default provider prefixes back to canonical paths for both URL forms", async () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.S3_BUCKET = "canonical-attachments";
    process.env.S3_PRIVATE_PREFIX = "private";
    delete process.env.S3_ENDPOINT_URL;

    const { ObjectStorageService } = await import("./objectStorage");
    const storage = new ObjectStorageService();
    expect(storage.normalizeObjectEntityPath(
      "https://canonical-attachments.s3.us-east-1.amazonaws.com/private/uploads/virtual-hosted",
    )).toBe("/objects/uploads/virtual-hosted");

    process.env.S3_ENDPOINT_URL = "https://objects.example.test";
    expect(storage.normalizeObjectEntityPath(
      "https://objects.example.test/canonical-attachments/private/uploads/path-style",
    )).toBe("/objects/uploads/path-style");
  });
});