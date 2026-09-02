#!/usr/bin/env bash
set -Eeuo pipefail

# Runs scripts/seed.mjs as a standalone ECS Fargate task against the LIVE
# cafa-pmis-staging RDS instance, the same way infra/aws-staging/deploy-staging.sh
# runs the migration task — reusing the already-deployed migration task
# definition, subnets, and security group untouched, so this needs no
# CloudFormation change and no rebuild. RDS is private to the staging VPC, so
# this has to run as a task inside that VPC; there is no direct network path
# from a developer machine to it.
#
# The migration task definition's container bakes in NODE_ENV=production
# (correct for running migrations), but scripts/seed.mjs itself refuses to
# run in production as a safety check — so this overrides NODE_ENV to
# "staging" for this one run only. The container's other environment
# variables (and the DATABASE_URL secret) are untouched: an ECS container
# override only replaces variables you name, it does not clear the rest.
#
# The demo account's password is generated at insert time and printed once,
# in this task's own CloudWatch logs, unless you set SEED_DEMO_PASSWORD
# yourself — set it if you'd rather choose the password up front than go
# looking for it in CloudWatch afterward. It only takes effect the first time
# the demo account is created; re-running this script leaves an
# already-existing demo account's password untouched either way.
#
# Usage:
#   CAFA_STAGING_APPROVED_REGION=<approved-region> \
#   [SEED_DEMO_PASSWORD=<your-chosen-password>] \
#   ./scripts/run-seed-on-staging.sh

: "${CAFA_STAGING_APPROVED_REGION:?CAFA_STAGING_APPROVED_REGION is required}"

STACK_NAME="cafa-pmis-staging"
SEED_CONTAINER_NAME="cafa-pmis-migration"

ENV_OVERRIDES="{ \"name\": \"NODE_ENV\", \"value\": \"staging\" }"
if [[ -n "${SEED_DEMO_PASSWORD:-}" ]]; then
  ENV_OVERRIDES="${ENV_OVERRIDES}, { \"name\": \"SEED_DEMO_PASSWORD\", \"value\": \"${SEED_DEMO_PASSWORD}\" }"
  echo "Using the SEED_DEMO_PASSWORD you set — it will not be printed anywhere by this script."
fi

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
  echo "Staging seed run blocked: could not read stack outputs for '${STACK_NAME}' in ${CAFA_STAGING_APPROVED_REGION} — is the stack deployed there?" >&2
  exit 1
fi

echo "Running scripts/seed.mjs as a one-off ECS task on cluster ${CLUSTER_NAME}."
echo "Task definition: ${MIGRATION_TASK_DEFINITION} (reused unmodified, command overridden for this run only)."

SEED_TASK_ARN="$(
  aws ecs run-task \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --task-definition "${MIGRATION_TASK_DEFINITION}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${APP_SUBNET_1},${APP_SUBNET_2}],securityGroups=[${APP_SG}],assignPublicIp=DISABLED}" \
    --overrides "{
      \"containerOverrides\": [{
        \"name\": \"${SEED_CONTAINER_NAME}\",
        \"command\": [\"node\", \"--enable-source-maps\", \"/app/scripts/seed.mjs\"],
        \"environment\": [${ENV_OVERRIDES}]
      }]
    }" \
    --count 1 \
    --query "tasks[0].taskArn" \
    --output text
)"

if [[ -z "${SEED_TASK_ARN}" || "${SEED_TASK_ARN}" == "None" ]]; then
  echo "Staging seed run blocked: ecs run-task did not return a task ARN." >&2
  exit 1
fi

echo "Seed task started: ${SEED_TASK_ARN}"
echo "Waiting for it to finish…"
aws ecs wait tasks-stopped \
  --region "${CAFA_STAGING_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --tasks "${SEED_TASK_ARN}"

SEED_EXIT="$(
  aws ecs describe-tasks \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${SEED_TASK_ARN}" \
    --query "tasks[0].containers[0].exitCode" \
    --output text
)"

if [[ "${SEED_EXIT}" != "0" ]]; then
  echo "Staging seed run FAILED: container exit code ${SEED_EXIT}." >&2
  echo "Task evidence pointer: ${SEED_TASK_ARN}" >&2
  echo "Logs: CloudWatch, same log group as the migration task (stream prefix 'migration'), this task's ID in the stream name." >&2
  exit 1
fi

echo "Seed completed successfully on staging."
echo "Task evidence pointer: ${SEED_TASK_ARN}"
