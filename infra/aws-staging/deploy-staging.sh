#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_NAME="cafa-pmis-staging"
ECR_STACK_NAME="cafa-pmis-staging-ecr"
TEMPLATE="${ROOT_DIR}/infra/aws-staging/template.yaml"

: "${CAFA_STAGING_APPROVED_REGION:?CAFA_STAGING_APPROVED_REGION is required}"
: "${CAFA_STAGING_HOSTNAME:?CAFA_STAGING_HOSTNAME is required}"
: "${CAFA_STAGING_CERTIFICATE_ARN:?CAFA_STAGING_CERTIFICATE_ARN is required}"

node "${ROOT_DIR}/scripts/aws-staging-preflight.mjs"

if [[ -n "$(git -C "${ROOT_DIR}" status --porcelain)" ]]; then
  echo "AWS staging deployment blocked: source tree is not clean; commit or remove parallel changes before building an immutable image." >&2
  exit 1
fi

SOURCE_REVISION="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
IMAGE_TAG="source-${SOURCE_REVISION}"

stack_exists() {
  local stack_name="$1"
  local detail
  if detail="$(aws cloudformation describe-stacks \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --stack-name "${stack_name}" 2>&1 >/dev/null)"; then
    return 0
  fi
  if [[ "${detail}" =~ does\ not\ exist|ValidationError ]]; then
    return 1
  fi
  echo "AWS staging deployment blocked: cannot inspect CloudFormation stack ${stack_name}." >&2
  exit 1
}

COMMON_PARAMS=(
  ProvisionEcrOnly=false
  EnableApplicationService=false
  StagingHostname="${CAFA_STAGING_HOSTNAME}"
  CertificateArn="${CAFA_STAGING_CERTIFICATE_ARN}"
  AvailabilityZone1="${CAFA_STAGING_AZ1:-}"
  AvailabilityZone2="${CAFA_STAGING_AZ2:-}"
)

if [[ -z "${CAFA_STAGING_AZ1:-}" || -z "${CAFA_STAGING_AZ2:-}" ]]; then
  mapfile -t AVAILABLE_AZS < <(
    aws ec2 describe-availability-zones \
      --region "${CAFA_STAGING_APPROVED_REGION}" \
      --filters Name=state,Values=available \
      --query 'AvailabilityZones[0:2].ZoneName' \
      --output text
  )
  if (( ${#AVAILABLE_AZS[@]} != 2 )); then
    echo "AWS staging deployment blocked: provide two approved Availability Zones with CAFA_STAGING_AZ1/AZ2." >&2
    exit 1
  fi
  COMMON_PARAMS[4]="AvailabilityZone1=${AVAILABLE_AZS[0]}"
  COMMON_PARAMS[5]="AvailabilityZone2=${AVAILABLE_AZS[1]}"
fi

if ! stack_exists "${ECR_STACK_NAME}"; then
  echo "Creating the immutable staging ECR bootstrap stack (source revision ${SOURCE_REVISION})."
  aws cloudformation deploy \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --stack-name "${ECR_STACK_NAME}" \
    --template-file "${TEMPLATE}" \
    --no-fail-on-empty-changeset \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides ProvisionEcrOnly=true \
    >/dev/null
fi

ECR_URI="$(
  aws cloudformation describe-stacks \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --stack-name "${ECR_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" \
    --output text
)"
if [[ -z "${ECR_URI}" || "${ECR_URI}" == "None" ]]; then
  echo "AWS staging deployment blocked: ECR repository output was not returned." >&2
  exit 1
fi
ECR_ARN="$(
  aws ecr describe-repositories \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --repository-names cafa-pmis-staging \
    --query "repositories[0].repositoryArn" \
    --output text
)"
if [[ ! "${ECR_ARN}" =~ ^arn:[^:]+:ecr: ]]; then
  echo "AWS staging deployment blocked: immutable ECR repository ARN was not returned." >&2
  exit 1
fi
COMMON_PARAMS+=("EcrRepositoryArn=${ECR_ARN}")

echo "Building the root production Docker image."
docker build \
  --label "org.opencontainers.image.revision=${SOURCE_REVISION}" \
  --label "org.opencontainers.image.source=CAFA-PMIS" \
  --tag "${ECR_URI}:${IMAGE_TAG}" \
  "${ROOT_DIR}"

aws ecr get-login-password --region "${CAFA_STAGING_APPROVED_REGION}" |
  docker login --username AWS --password-stdin "${ECR_URI%/*}" >/dev/null
docker push "${ECR_URI}:${IMAGE_TAG}" >/dev/null

IMAGE_DIGEST="$(
  aws ecr describe-images \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --repository-name cafa-pmis-staging \
    --image-ids "imageTag=${IMAGE_TAG}" \
    --query "imageDetails[0].imageDigest" \
    --output text
)"
if [[ ! "${IMAGE_DIGEST}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "AWS staging deployment blocked: ECR did not return an immutable image digest." >&2
  exit 1
fi
IMAGE_URI="${ECR_URI%@*}@${IMAGE_DIGEST}"

EXISTING_SERVICE_TASK_DEFINITION="$(
  aws ecs describe-services \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster cafa-pmis-staging \
    --services cafa-pmis-staging \
    --query "services[?status=='ACTIVE'].taskDefinition | [0]" \
    --output text 2>/dev/null || true
)"
if [[ "${EXISTING_SERVICE_TASK_DEFINITION}" == "None" ]]; then
  EXISTING_SERVICE_TASK_DEFINITION=""
fi
if [[ -n "${EXISTING_SERVICE_TASK_DEFINITION}" ]]; then
  SERVICE_PRESERVATION_PARAMS=(
    EnableApplicationService=true
    ServiceTaskDefinitionArn="${EXISTING_SERVICE_TASK_DEFINITION}"
  )
  echo "Preserving the current ECS service while the new image is migrated."
else
  SERVICE_PRESERVATION_PARAMS=(
    EnableApplicationService=false
    ServiceTaskDefinitionArn=
  )
  echo "No existing ECS service found; creating core infrastructure with service disabled."
fi

echo "Creating or updating isolated core infrastructure with the new service task definition held back."
aws cloudformation deploy \
  --region "${CAFA_STAGING_APPROVED_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "${COMMON_PARAMS[@]}" \
    "${SERVICE_PRESERVATION_PARAMS[@]}" \
    ImageUri="${IMAGE_URI}" \
  >/dev/null

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
APPLICATION_TASK_DEFINITION="$(OUTPUT ApplicationTaskDefinition)"

echo "Running the standalone tracked migration task before enabling ECS service."
MIGRATION_TASK_ARN="$(
  aws ecs run-task \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --task-definition "${MIGRATION_TASK_DEFINITION}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${APP_SUBNET_1},${APP_SUBNET_2}],securityGroups=[${APP_SG}],assignPublicIp=DISABLED}" \
    --count 1 \
    --query "tasks[0].taskArn" \
    --output text
)"
aws ecs wait tasks-stopped \
  --region "${CAFA_STAGING_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --tasks "${MIGRATION_TASK_ARN}"
MIGRATION_EXIT="$(
  aws ecs describe-tasks \
    --region "${CAFA_STAGING_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${MIGRATION_TASK_ARN}" \
    --query "tasks[0].containers[0].exitCode" \
    --output text
)"
if [[ "${MIGRATION_EXIT}" != "0" ]]; then
  echo "AWS staging deployment stopped: migration task exit code ${MIGRATION_EXIT}. Application service was not enabled." >&2
  echo "Migration task evidence pointer: ${MIGRATION_TASK_ARN}" >&2
  exit 1
fi

echo "Migration succeeded; enabling exactly one ECS application task."
aws cloudformation deploy \
  --region "${CAFA_STAGING_APPROVED_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "${COMMON_PARAMS[@]}" \
    EnableApplicationService=true \
    ServiceTaskDefinitionArn="${APPLICATION_TASK_DEFINITION}" \
    ImageUri="${IMAGE_URI}" \
  >/dev/null

SERVICE_NAME="$(OUTPUT ApplicationServiceName)"
aws ecs wait services-stable \
  --region "${CAFA_STAGING_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}"

echo "Staging service is enabled at desired count one."
echo "Source revision: ${SOURCE_REVISION}"
echo "Image digest: ${IMAGE_DIGEST}"
echo "Origin: https://${CAFA_STAGING_HOSTNAME}"
echo "ALB DNS evidence: $(OUTPUT LoadBalancerDnsName)"