#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const required = [
  ["CAFA_STAGING_APPROVED_REGION", "approved AWS region"],
  ["CAFA_STAGING_HOSTNAME", "approved HTTPS hostname"],
  ["CAFA_STAGING_CERTIFICATE_ARN", "ACM certificate ARN"],
];

function fail(message) {
  console.error(`AWS staging preflight blocked: ${message}`);
  process.exit(1);
}

function value(name) {
  return process.env[name]?.trim() ?? "";
}

for (const [name, description] of required) {
  if (!value(name)) fail(`${description} is not available (${name}).`);
}

const approvedRegion = value("CAFA_STAGING_APPROVED_REGION");
const hostname = value("CAFA_STAGING_HOSTNAME");
const certificateArn = value("CAFA_STAGING_CERTIFICATE_ARN");

if (
  hostname.includes("/") ||
  hostname.includes(":") ||
  hostname.includes("*") ||
  hostname.includes("://") ||
  hostname.includes(" ") ||
  !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(hostname)
) {
  fail("the staging hostname must be a bare hostname, not a URL, wildcard, or path.");
}

if (!/^arn:[^:]+:acm:[^:]+:[0-9]{12}:certificate\/[A-Za-z0-9-]+$/.test(certificateArn)) {
  fail("the staging certificate ARN is malformed.");
}

function aws(args, options = {}) {
  try {
    return execFileSync("aws", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    if (detail && /AccessDenied|Unauthorized|InvalidClientToken|ExpiredToken|UnrecognizedClient/i.test(detail)) {
      fail("the configured AWS identity cannot perform the required read-only verification.");
    }
    fail(`AWS CLI verification failed (${args[0]}).`);
  }
}

const identity = aws([
  "sts",
  "get-caller-identity",
  "--query",
  "{Account:Account,Arn:Arn}",
  "--output",
  "json",
]);

const configuredRegion =
  value("AWS_REGION") ||
  value("AWS_DEFAULT_REGION") ||
  aws(["configure", "get", "region"]);

if (!configuredRegion) fail("no AWS CLI region is configured.");
if (configuredRegion !== approvedRegion) {
  fail(`configured AWS region does not match the approved region (${approvedRegion}).`);
}

const azJson = aws([
  "ec2",
  "describe-availability-zones",
  "--region",
  approvedRegion,
  "--filters",
  "Name=state,Values=available",
  "--query",
  "AvailabilityZones[].ZoneName",
  "--output",
  "json",
]);
let azs;
try {
  azs = JSON.parse(azJson);
} catch {
  fail("AWS returned an unreadable Availability Zone response.");
}
if (!Array.isArray(azs) || azs.length < 2) {
  fail("the approved region does not expose at least two available Availability Zones.");
}

const certificateJson = aws([
  "acm",
  "describe-certificate",
  "--region",
  approvedRegion,
  "--certificate-arn",
  certificateArn,
  "--query",
  "{DomainName:Certificate.DomainName,Status:Certificate.Status,Names:Certificate.SubjectAlternativeNames}",
  "--output",
  "json",
]);
let certificate;
try {
  certificate = JSON.parse(certificateJson);
} catch {
  fail("AWS returned an unreadable ACM certificate response.");
}
const names = Array.isArray(certificate?.Names) ? certificate.Names : [];
const certificateCoversHost =
  certificate?.DomainName === hostname ||
  names.includes(hostname) ||
  names.includes(`*.${hostname.split(".").slice(1).join(".")}`);
if (certificate?.Status !== "ISSUED" || !certificateCoversHost) {
  fail("the ACM certificate is not issued for the approved staging hostname.");
}

// This read must succeed or return the normal "stack does not exist" response.
// AccessDenied is handled by aws() and fails closed.
try {
  execFileSync(
    "aws",
    ["cloudformation", "describe-stacks", "--region", approvedRegion, "--stack-name", "cafa-pmis-staging"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  const detail = error.stderr?.toString() ?? "";
  if (!/does not exist|ValidationError/i.test(detail)) {
    fail("the deployment identity cannot verify access to the staging CloudFormation stack.");
  }
}

console.log(`AWS staging preflight passed: identity=${identity}, region=${approvedRegion}, az_count=${azs.length}`);
console.log("No secret values were read or printed.");