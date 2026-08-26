# CAFA PMIS AWS staging

This directory contains the single reproducible CloudFormation definition for
the isolated staging environment. It is deliberately staging-only:

- every named resource uses the `cafa-pmis-staging-*` convention;
- resources are tagged `Application=cafa-pmis` and `Environment=staging`;
- the stack creates one VPC with public, private application, and private
  database subnets across two approved Availability Zones;
- the ALB is the only public application entry point;
- RDS is encrypted and private, and the S3 attachment bucket is private,
  encrypted, versioned, and retained on stack deletion;
- one ECS Fargate task owns the API, PWA, Socket.IO endpoint, and scheduler;
- the migration task uses the same immutable image and has
  `SCHEDULER_ENABLED=false`.

Do not copy values into a repository file. The stack generates the staging-only
RDS master password and session secret in Secrets Manager. The RDS password is
used only through a dynamic secret reference to create the private database; it
is never injected into ECS, command-line parameters, logs, or task definitions.

## Required operator inputs

The preflight must verify all of these before any AWS mutation:

| Input | Purpose |
| --- | --- |
| `CAFA_STAGING_APPROVED_REGION` | Region approved for the staging account. |
| `CAFA_STAGING_HOSTNAME` | Approved HTTPS hostname, without scheme/path/wildcard. |
| `CAFA_STAGING_CERTIFICATE_ARN` | ACM certificate covering that hostname. |
| AWS CLI credentials | An authorized deployment identity, never static keys in this repository. |

The AWS CLI region must match `CAFA_STAGING_APPROVED_REGION`. The preflight
also confirms the certificate and two available AZs without printing
credentials or secret values. If any decision or authorization is missing, it
fails closed.

## Migration-gated release

Run from the repository root:

```sh
CAFA_STAGING_APPROVED_REGION=<approved-region> \
CAFA_STAGING_HOSTNAME=<approved-hostname> \
CAFA_STAGING_CERTIFICATE_ARN=<certificate-arn> \
./infra/aws-staging/deploy-staging.sh
```

The script uses one CloudFormation template in two fixed staging-only stacks:
`cafa-pmis-staging-ecr` owns the immutable ECR repository and the isolated
remote image-build infrastructure (private source bucket, CodeBuild project,
build role, and build logs), while `cafa-pmis-staging` owns the networking and
service platform. This separation prevents an image-bootstrap action from
changing or deleting a live platform.

The deployment does not build Docker images in the operator shell. It performs
these phases:

1. create/update the immutable ECR repository and remote CodeBuild
   infrastructure;
2. check for the immutable `source-<git-sha>` image in ECR and reuse it when
   present;
3. when the image is absent, stream `git archive` for the clean source revision
   to the private staging build-source bucket, run the root `Dockerfile` in
   CodeBuild, and push the immutable source tag to ECR;
4. resolve the resulting ECR image digest and create/update the VPC, ALB, RDS,
   S3, Secrets Manager, IAM, ECS task definitions, logs, and alarms while
   preserving the currently running service;
5. run one ECS Fargate migration task using
   `node --enable-source-maps /app/scripts/migrate.mjs`;
6. stop on a non-zero migration exit and preserve its log pointer;
7. only after exit code zero, enable the ECS service at desired count one.

The uploaded build-source archive is removed after the remote build. The
private source bucket also applies a one-day lifecycle expiry as a fallback if
cleanup cannot complete.

The service task definition always sets:

```text
STORAGE_PROVIDER=s3
RUN_MIGRATIONS_ON_STARTUP=false
SCHEDULER_ENABLED=true
```

No Redis, autoscaling, second worker, public task IP, SSH route, legacy
`/socket.io` listener, production resource, production secret, production
database, or production object is part of this stack.

After DNS points the approved hostname at the ALB, run the non-authenticated
baseline from the repository root:

```sh
CAFA_STAGING_BASE_URL=https://<approved-staging-hostname> \
node scripts/aws-staging-baseline.mjs
```

It verifies the real HTTPS origin, `/api/healthz`, `/api/readyz`, same-origin
PWA/service-worker registration, Socket.IO polling and WebSocket upgrade, and
rejection of a foreign credentialed origin. It does not substitute a local
preview, use credentials, or claim authenticated, offline, attachment, email,
Arabic, or restore certification.

## Safe repeat runs and cleanup

Repeat runs use the fixed staging stacks and immutable image digests. If the
current `source-<git-sha>` image already exists in ECR, the remote build is
skipped and that immutable image is reused. On later releases, the existing ECS
service stays on its current task definition while the new task definition
migrates; only a successful migration allows the script to update the service.
The build does not depend on local Docker storage in CloudShell or another
operator workstation. The attachment bucket and RDS instance
intentionally retain data/snapshots if the stack is deleted, so cleanup
requires an explicit, separately approved data-retention decision.

This is infrastructure evidence, not release certification. Full Arabic,
authenticated offline/PWA, attachment lifecycle, email sandbox, and restore
certification remain pending until their guarded prerequisites are run against
the isolated HTTPS staging origin.