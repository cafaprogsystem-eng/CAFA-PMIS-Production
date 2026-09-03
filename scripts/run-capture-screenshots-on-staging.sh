#!/usr/bin/env bash
set -Eeuo pipefail

# Runs scripts/capture-training-screenshots.mjs as a standalone ECS Fargate
# task against the LIVE cafa-pmis-staging deployment — same pattern as
# run-seed-on-staging.sh, reusing the already-deployed migration task
# definition, subnets, and security group untouched, so this needs no
# CloudFormation change and no rebuild.
#
# Chromium itself is installed fresh inside the task's own (ephemeral)
# container filesystem at run time via `npx playwright install --with-deps`
# — the production image deliberately never bakes it in permanently (it's
# only needed for this rare, one-off operation). @playwright/test and sharp,
# the two npm packages the capture script needs, are already present: both
# are root-level "dependencies" (not devDependencies), so they survive the
# image's own `pnpm install --prod`.
#
# A one-off ECS task has no disk shared with the running app service, so
# captured screenshots would vanish the moment this task stops — the
# capture script uploads each one instead, over HTTPS, to
# POST /api/training-videos/screenshots/:key on the target itself
# (authenticated with the demo account), which stores it in the app's own
# S3 bucket; see routes/training-videos.ts and
# video-generator.ts's resolveScreenshotPath().
#
# The base migration task definition's 512 CPU / 1024 MB is sized for
# running SQL migrations, not a headless browser — this overrides both
# upward for this run only (Fargate requires paired CPU/memory values).
#
# Usage:
#   CAFA_STAGING_APPROVED_REGION=<approved-region> \
#   STAGING_DEMO_EMAIL=<demo account email> \
#   STAGING_DEMO_PASSWORD=<demo account password> \
#   [STAGING_BASE_URL=https://staging.pmis.cafa.systems] \
#   ./scripts/run-capture-screenshots-on-staging.sh [key1 key2 ...]
#
# With no keys given, captures every target the script knows about.

: "${CAFA_STAGING_APPROVED_REGION:?CAFA_STAGING_APPROVED_REGION is required}"
: "${STAGING_DEMO_EMAIL:?STAGING_DEMO_EMAIL is required}"
: "${STAGING_DEMO_PASSWORD:?STAGING_DEMO_PASSWORD is required}"

STACK_NAME="cafa-pmis-staging"
CAPTURE_CONTAINER_NAME="cafa-pmis-migration"
STAGING_BASE_URL_VALUE="${STAGING_BASE_URL:-https://staging.pmis.cafa.systems}"
TARGET_KEYS="$*"

OUTPUT() {
  aws cloudformation describe-stacks \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='${1}'].OutputValue" \
    --output text
}

CLUSTER_NAME="$(OUTPUT ClusterName)"
MIGRATION_TASK_DEFINITION="$(OUTPUT MigrationTaskDefinition)"
APP_SG="$(OUTPUT ApplicationSecurityGroupId)"
APP_SUBNET_1="$(OUTPUT AppSubnet1Id)"
APP_SUBNET_2="$(OUTPUT AppSubnet2Id)"

if [[ -z "${CLUSTER_NAME}" || "${CLUSTER_NAME}" == "None" ]]; then
  echo "Screenshot capture blocked: could not read stack outputs for '${STACK_NAME}' in ${CAFA_STAGING_APPROVED_REGION} — is the stack deployed there?" >&2
  exit 1
fi

echo "Running scripts/capture-training-screenshots.mjs as a one-off ECS task on cluster ${CLUSTER_NAME}."
echo "Task definition: ${MIGRATION_TASK_DEFINITION} (reused unmodified, command/cpu/memory overridden for this run only)."
echo "Target: ${STAGING_BASE_URL_VALUE}"
if [[ -n "${TARGET_KEYS}" ]]; then echo "Requested keys: ${TARGET_KEYS}"; else echo "No keys given — capturing every known target."; fi

# JSON-string-encodes one value (quotes included in the output) so a
# password or key containing a literal quote, backslash, or newline can't
# break the --overrides payload below — plain "\"...\"" interpolation can't
# do this safely.
json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

CAPTURE_COMMAND="npx playwright install --with-deps chromium && node scripts/capture-training-screenshots.mjs ${TARGET_KEYS}"
CAPTURE_COMMAND_JSON="$(json_string "${CAPTURE_COMMAND}")"
STAGING_BASE_URL_JSON="$(json_string "${STAGING_BASE_URL_VALUE}")"
STAGING_DEMO_EMAIL_JSON="$(json_string "${STAGING_DEMO_EMAIL}")"
STAGING_DEMO_PASSWORD_JSON="$(json_string "${STAGING_DEMO_PASSWORD}")"

CAPTURE_TASK_ARN="$(
  aws ecs run-task \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --task-definition "${MIGRATION_TASK_DEFINITION}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${APP_SUBNET_1},${APP_SUBNET_2}],securityGroups=[${APP_SG}],assignPublicIp=DISABLED}" \
    --overrides "{
      \"cpu\": \"1024\",
      \"memory\": \"3072\",
      \"containerOverrides\": [{
        \"name\": \"${CAPTURE_CONTAINER_NAME}\",
        \"command\": [\"sh\", \"-c\", ${CAPTURE_COMMAND_JSON}],
        \"cpu\": 1024,
        \"memory\": 3072,
        \"environment\": [
          { \"name\": \"STAGING_BASE_URL\", \"value\": ${STAGING_BASE_URL_JSON} },
          { \"name\": \"STAGING_DEMO_EMAIL\", \"value\": ${STAGING_DEMO_EMAIL_JSON} },
          { \"name\": \"STAGING_DEMO_PASSWORD\", \"value\": ${STAGING_DEMO_PASSWORD_JSON} }
        ]
      }]
    }" \
    --count 1 \
    --query "tasks[0].taskArn" \
    --output text
)"

if [[ -z "${CAPTURE_TASK_ARN}" || "${CAPTURE_TASK_ARN}" == "None" ]]; then
  echo "Screenshot capture blocked: ecs run-task did not return a task ARN." >&2
  exit 1
fi

echo "Capture task started: ${CAPTURE_TASK_ARN}"
echo "Waiting for it to finish — this includes a fresh Chromium install, so it will take a few minutes longer than the seed task…"
aws ecs wait tasks-stopped \
  --region "${CAFA_STAGING_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --tasks "${CAPTURE_TASK_ARN}"

CAPTURE_EXIT="$(
  aws ecs describe-tasks \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${CAPTURE_TASK_ARN}" \
    --query "tasks[0].containers[0].exitCode" \
    --output text
)"

if [[ "${CAPTURE_EXIT}" != "0" ]]; then
  echo "Screenshot capture FAILED: container exit code ${CAPTURE_EXIT}." >&2
  echo "Task evidence pointer: ${CAPTURE_TASK_ARN}" >&2
  echo "Logs: CloudWatch, same log group as the migration task (stream prefix 'migration'), this task's ID in the stream name." >&2
  exit 1
fi

echo "Screenshot capture completed successfully."
echo "Task evidence pointer: ${CAPTURE_TASK_ARN}"
