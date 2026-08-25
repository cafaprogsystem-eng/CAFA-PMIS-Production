# CAFA PMIS AWS staging evidence

**Classification:** Blocked  
**Environment:** Staging only  
**Production status:** Untouched; no production resource, DNS record, secret,
database, object, image, or deployment was accessed or modified.  
**Release status:** Not production-ready; no release candidate was certified.

## Preflight result

The repository now contains the single staging CloudFormation definition and
migration-gated deployment script described in
[`infra/aws-staging/README.md`](../infra/aws-staging/README.md). Applying it was
intentionally not attempted because the required deployment authority and
operator decisions were not available in this workspace:

| Gate | Result | Evidence |
| --- | --- | --- |
| Authorized AWS identity | **Blocked** | AWS CLI is not installed, so `sts get-caller-identity` could not be verified. |
| Approved AWS region | **Blocked** | No `CAFA_STAGING_APPROVED_REGION` was supplied. |
| Approved HTTPS hostname | **Blocked** | No `CAFA_STAGING_HOSTNAME` or certificate ARN was supplied. |
| Deployment permissions | **Blocked** | No AWS identity was available to verify CloudFormation/ECS/ECR/RDS/S3 permissions. |
| AWS resource provisioning | **Not attempted** | Fail-closed prerequisite; local Docker is not accepted as AWS evidence. |
| Production isolation | **Preserved** | No AWS commands capable of changing production resources were run. |

The current repository source revision was observed as `8dc97eee` during
preflight. It is recorded only as repository context, not as a built, pushed,
deployed, or final release image.

## Capability matrix

| Capability | Status | Required evidence before marking complete |
| --- | --- | --- |
| Single CloudFormation definition and deterministic staging naming | **Implemented in repository** | Successful CloudFormation validation and repeat run in the approved account. |
| Public/application/database subnet separation across two AZs | **Defined, not provisioned** | VPC, route, subnet, and security-group inspection. |
| HTTPS ALB and same-origin `/`, `/api`, `/api/socket.io` routing | **Defined, not provisioned** | Issued ACM certificate, DNS, ALB health, polling, and WebSocket checks. |
| Immutable production-process image | **Not built/pushed** | ECR digest and source revision evidence. |
| Migration-first ECS release | **Defined, not run** | Migration task exit code 0, advisory-lock/checksum logs, then service update. |
| One ECS Fargate API/realtime/scheduler task | **Defined, not provisioned** | Desired/running count one, no public IP, and `SCHEDULER_ENABLED=true`. |
| Private encrypted RDS PostgreSQL | **Defined, not provisioned** | Endpoint privacy, encryption, backup/PITR, and metric evidence. |
| Private encrypted/versioned S3 bucket | **Defined, not provisioned** | Block Public Access, bucket policy, versioning/lifecycle, and IAM evidence. |
| Staging-only Secrets Manager values | **Defined, not populated** | Secret ARNs and task injection inspection without recording values. |
| CloudWatch logs and baseline alarms | **Defined, not provisioned** | Log groups, filters, alarm state, and sensitive-log review. |
| HTTPS health/readiness/PWA/Socket.IO baseline | **Not run** | Real staging origin checks after service health. |
| Authenticated cookie smoke and later E2E readiness | **Pending** | Isolated staging identities and `E2E_BASE_URL`; never production credentials. |
| Arabic, offline, attachment lifecycle, email sandbox, and restore certification | **Pending / out of scope here** | Guarded certification runs against isolated staging only. |

## Operator completion record

Do not mark this report complete by replacing blocked rows with local Docker,
Replit preview, or guessed AWS values. After approved inputs are available,
append a non-sensitive record containing:

- AWS account identifier, region, two AZ names, stack name, and resource IDs;
- staging hostname, ALB DNS name, and certificate status;
- source revision, immutable ECR tag/digest, and task-definition revisions;
- migration task ARN, exit code, log group/stream pointer, and checksum result;
- ECS desired/running count, readiness/health results, and same-origin routing checks;
- RDS/S3 privacy, encryption, backup/versioning/lifecycle, and IAM inspection;
- CloudWatch alarm/log review and any failed-release evidence;
- pending certification gaps and the operator/change authority.

Never record secret values, credentials, cookies, signed URLs, database URLs,
raw email, production data, or an unredacted task definition.