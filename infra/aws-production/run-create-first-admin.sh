#!/usr/bin/env bash
set -Eeuo pipefail

# Runs scripts/create-first-admin.mjs as a standalone ECS Fargate task
# against the LIVE cafa-pmis-production RDS instance, the same way
# scripts/run-seed-on-staging.sh runs scripts/seed.mjs on staging — reusing
# the already-deployed migration task definition, subnets, and security
# group unmodified, so this needs no CloudFormation change and no rebuild.
# RDS is private to the production VPC, so this has to run as a task inside
# that VPC; there is no direct network path from an operator machine to it.
#
# Meant to be run EXACTLY ONCE, immediately after the first successful
# ./deploy-production.sh, to create the one and only account that can then
# invite everyone else through the normal in-app invite flow. See
# infra/aws-production/README.md, "First administrator account".
#
# The name/email/username/password are never written to this repository or
# to any file — they exist only in this shell's environment for the
# duration of this one run, and are passed to the ECS task as a container
# environment override, not as a command-line argument (so they never
# appear in `ps`, shell history expansion, or the task definition itself).
# This script does not print the password anywhere, and neither does
# create-first-admin.ts — it goes straight into a bcrypt hash. Re-running
# this script with the same ADMIN_EMAIL is a no-op: it reports the existing
# account and changes nothing.
#
# Usage:
#   CAFA_PRODUCTION_APPROVED_REGION=<approved-region> \
#   ADMIN_NAME="Full Name" \
#   ADMIN_EMAIL="admin@example.org" \
#   ADMIN_USERNAME="admin_username" \
#   ADMIN_PASSWORD="choose-a-strong-password-yourself" \
#   ./infra/aws-production/run-create-first-admin.sh

: "${CAFA_PRODUCTION_APPROVED_REGION:?CAFA_PRODUCTION_APPROVED_REGION is required}"
: "${ADMIN_NAME:?ADMIN_NAME is required}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL is required}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"

STACK_NAME="cafa-pmis-production"
TASK_CONTAINER_NAME="cafa-pmis-migration"

# JSON-string-encodes one value (quotes included in the output) so a name,
# email, or password containing a literal quote, backslash, or newline
# can't break the --overrides payload below — plain "\"...\"" interpolation
# can't do this safely.
json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

ENV_OVERRIDES="{ \"name\": \"ADMIN_NAME\", \"value\": $(json_string "${ADMIN_NAME}") }"
ENV_OVERRIDES="${ENV_OVERRIDES}, { \"name\": \"ADMIN_EMAIL\", \"value\": $(json_string "${ADMIN_EMAIL}") }"
ENV_OVERRIDES="${ENV_OVERRIDES}, { \"name\": \"ADMIN_PASSWORD\", \"value\": $(json_string "${ADMIN_PASSWORD}") }"
if [[ -n "${ADMIN_USERNAME:-}" ]]; then
  ENV_OVERRIDES="${ENV_OVERRIDES}, { \"name\": \"ADMIN_USERNAME\", \"value\": $(json_string "${ADMIN_USERNAME}") }"
fi

OUTPUT() {
  aws cloudformation describe-stacks \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
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
  echo "Blocked: could not read stack outputs for '${STACK_NAME}' in ${CAFA_PRODUCTION_APPROVED_REGION} — is the stack deployed there?" >&2
  exit 1
fi

echo "Running scripts/create-first-admin.mjs as a one-off ECS task on cluster ${CLUSTER_NAME}."
echo "Task definition: ${MIGRATION_TASK_DEFINITION} (reused unmodified, command overridden for this run only)."
echo "Target account email: ${ADMIN_EMAIL} (password is not printed by this script)."

ADMIN_TASK_ARN="$(
  aws ecs run-task \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --task-definition "${MIGRATION_TASK_DEFINITION}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${APP_SUBNET_1},${APP_SUBNET_2}],securityGroups=[${APP_SG}],assignPublicIp=DISABLED}" \
    --overrides "{
      \"containerOverrides\": [{
        \"name\": \"${TASK_CONTAINER_NAME}\",
        \"command\": [\"node\", \"--enable-source-maps\", \"/app/scripts/create-first-admin.mjs\"],
        \"environment\": [${ENV_OVERRIDES}]
      }]
    }" \
    --count 1 \
    --query "tasks[0].taskArn" \
    --output text
)"

if [[ -z "${ADMIN_TASK_ARN}" || "${ADMIN_TASK_ARN}" == "None" ]]; then
  echo "Blocked: ecs run-task did not return a task ARN." >&2
  exit 1
fi

echo "Task started: ${ADMIN_TASK_ARN}"
echo "Waiting for it to finish…"
aws ecs wait tasks-stopped \
  --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --tasks "${ADMIN_TASK_ARN}"

TASK_EXIT="$(
  aws ecs describe-tasks \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${ADMIN_TASK_ARN}" \
    --query "tasks[0].containers[0].exitCode" \
    --output text
)"

if [[ "${TASK_EXIT}" != "0" ]]; then
  echo "FAILED: container exit code ${TASK_EXIT}." >&2
  echo "Task evidence pointer: ${ADMIN_TASK_ARN}" >&2
  echo "Logs: CloudWatch, same log group as the migration task (stream prefix 'migration'), this task's ID in the stream name." >&2
  exit 1
fi

echo "Completed successfully. Check the task's CloudWatch log for confirmation of the account id created (or the 'already exists' notice)."
echo "Task evidence pointer: ${ADMIN_TASK_ARN}"
