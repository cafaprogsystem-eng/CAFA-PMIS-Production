import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isStorageConfigured, validateStorageConfiguration } from "./objectStorage";

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_ENDPOINT_URL: process.env.S3_ENDPOINT_URL,
  AWS_REGION: process.env.AWS_REGION,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME,
  GCS_CLIENT_EMAIL: process.env.GCS_CLIENT_EMAIL,
  GCS_PRIVATE_KEY: process.env.GCS_PRIVATE_KEY,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnvironment);

describe("selected object-storage configuration", () => {
  it("accepts a production S3 configuration without GCS values or static AWS keys", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_PROVIDER = "s3";
    process.env.S3_BUCKET = "private-production-bucket";
    process.env.S3_REGION = "eu-west-1";
    delete process.env.GCS_BUCKET_NAME;
    delete process.env.GCS_CLIENT_EMAIL;
    delete process.env.GCS_PRIVATE_KEY;

    expect(isStorageConfigured()).toEqual({
      configured: true,
      provider: "s3",
    });
    expect(() => validateStorageConfiguration()).not.toThrow();
  });

  it("requires the canonical S3 bucket and explicit production region", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_PROVIDER = "s3";
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;

    expect(isStorageConfigured()).toMatchObject({
      configured: false,
      provider: "s3",
      reason: "Missing required environment variables: S3_BUCKET, S3_REGION",
    });
    expect(() => validateStorageConfiguration()).toThrow(
      "Storage configuration invalid: Missing required environment variables: S3_BUCKET, S3_REGION",
    );
  });

  it("does not accept obsolete AWS variable names as the S3 contract", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_PROVIDER = "s3";
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    process.env.AWS_REGION = "eu-west-1";
    process.env.AWS_S3_BUCKET = "legacy-bucket";

    expect(isStorageConfigured()).toMatchObject({
      configured: false,
      provider: "s3",
    });
    expect(() => validateStorageConfiguration()).toThrow(/S3_BUCKET, S3_REGION/);
  });

  it("keeps development S3-compatible convenience and rejects malformed endpoints", () => {
    process.env.NODE_ENV = "development";
    process.env.STORAGE_PROVIDER = "s3";
    process.env.S3_BUCKET = "local-bucket";
    delete process.env.S3_REGION;
    expect(isStorageConfigured()).toEqual({ configured: true, provider: "s3" });

    process.env.S3_ENDPOINT_URL = "not-a-url";
    expect(isStorageConfigured()).toMatchObject({
      configured: false,
      reason: "S3_ENDPOINT_URL must be a valid http(s) URL when provided",
    });
  });

  it("validates only the selected provider and rejects unknown provider fallback", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_PROVIDER = "gcs";
    process.env.GCS_BUCKET_NAME = "private-bucket";
    process.env.GCS_CLIENT_EMAIL = "service@example.test";
    process.env.GCS_PRIVATE_KEY = "private-key";
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    expect(isStorageConfigured()).toEqual({ configured: true, provider: "gcs" });

    process.env.STORAGE_PROVIDER = "legacy";
    expect(() => isStorageConfigured()).toThrow(
      'Unsupported STORAGE_PROVIDER="legacy". Expected one of: s3, gcs, replit.',
    );
  });

  it("keeps Replit configuration conditional on the selected provider", () => {
    process.env.STORAGE_PROVIDER = "replit";
    process.env.NODE_ENV = "development";
    expect(isStorageConfigured()).toEqual({ configured: true, provider: "replit" });

    process.env.NODE_ENV = "production";
    expect(isStorageConfigured()).toMatchObject({
      configured: false,
      provider: "replit",
    });
    expect(() => validateStorageConfiguration()).toThrow(/STORAGE_PROVIDER=replit/);
  });
});

describe("production storage contract wiring", () => {
  it("keeps Compose and production examples on canonical S3 settings", () => {
    const compose = readFileSync(join(process.cwd(), "../../docker-compose.yml"), "utf8");
    const productionEnv = readFileSync(join(process.cwd(), "../../.env.production.example"), "utf8");
    const deployment = readFileSync(join(process.cwd(), "../../DEPLOYMENT.md"), "utf8");
    const backup = readFileSync(join(process.cwd(), "../../BACKUP_RESTORE.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "../../docs/backup-recovery-runbook.md"), "utf8");
    const handover = readFileSync(join(process.cwd(), "../../HANDOVER.md"), "utf8");

    expect(compose).toContain("STORAGE_PROVIDER: s3");
    expect(compose).toContain("S3_BUCKET:            ${S3_BUCKET}");
    expect(compose).toContain("S3_REGION:            ${S3_REGION}");
    expect(compose).not.toContain("AWS_REGION:");
    expect(compose).not.toContain("AWS_S3_BUCKET:");
    expect(compose).not.toContain("GCS_BUCKET_NAME:");
    expect(compose).not.toContain("S3_PUBLIC_URL:");

    expect(productionEnv).toContain("STORAGE_PROVIDER=s3");
    expect(productionEnv).toContain("S3_BUCKET=<PRODUCTION_PRIVATE_BUCKET>");
    expect(productionEnv).toContain("S3_REGION=<AWS_REGION>");
    expect(productionEnv).not.toContain("STORAGE_PROVIDER=gcs");
    expect(productionEnv).not.toContain("AWS_S3_BUCKET");
    expect(productionEnv).not.toContain("GCS_PRIVATE_KEY");
    expect(productionEnv).not.toContain("S3_PUBLIC_URL");

    expect(deployment).toContain("STORAGE_PROVIDER=s3");
    expect(deployment).toContain("private S3\nattachment bucket");
    expect(deployment).toContain("private per-environment bucket");
    expect(deployment).toContain("AWS deployment and operations runbook");
    expect(deployment).not.toContain("Google Cloud Storage Setup");
    expect(handover).toContain("STORAGE_PROVIDER=s3");
    expect(handover).toContain("S3_BUCKET=YOUR_PRIVATE_PRODUCTION_BUCKET");
    expect(handover).toContain("S3_REGION=YOUR_AWS_REGION");
    expect(handover).not.toContain("STORAGE_PROVIDER=gcs");
    expect(handover).not.toContain("GCS_BUCKET_NAME");

    expect(backup).toContain("metadata and canonical object keys, not attachment bytes");
    expect(backup).toMatch(/S3 Block Public\s+Access/);
    expect(backup).toContain("staging bucket");
    expect(backup).not.toContain("GCS File Backups");

    expect(runbook).toContain("Superseded backup and disaster recovery runbook");
    expect(runbook).toContain("canonical backup and recovery guide");
    expect(runbook).toContain("AWS deployment and operations runbook");
  });

  it("runs storage validation before migrations and HTTP listen", () => {
    const index = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(index).toContain("validateStorageConfiguration();");
    expect(index.indexOf("validateStorageConfiguration();")).toBeLessThan(
      index.indexOf("verifyRequiredSchema();"),
    );
    expect(index.indexOf("validateStorageConfiguration();")).toBeLessThan(
      index.indexOf("httpServer.listen"),
    );
  });
});