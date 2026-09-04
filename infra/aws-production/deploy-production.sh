#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_NAME="cafa-pmis-production"
ECR_STACK_NAME="cafa-pmis-production-ecr"
TEMPLATE="${ROOT_DIR}/infra/aws-production/template.yaml"

: "${CAFA_PRODUCTION_APPROVED_REGION:?CAFA_PRODUCTION_APPROVED_REGION is required}"
: "${CAFA_PRODUCTION_HOSTNAME:?CAFA_PRODUCTION_HOSTNAME is required}"
: "${CAFA_PRODUCTION_CERTIFICATE_ARN:?CAFA_PRODUCTION_CERTIFICATE_ARN is required}"

node "${ROOT_DIR}/scripts/aws-production-preflight.mjs"

if [[ -n "$(git -C "${ROOT_DIR}" status --porcelain)" ]]; then
  echo "AWS production deployment blocked: source tree is not clean; commit or remove parallel changes before building an immutable image." >&2
  exit 1
fi

SOURCE_REVISION="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
IMAGE_TAG="source-${SOURCE_REVISION}"

COMMON_PARAMS=(
  ProvisionEcrOnly=false
  EnableApplicationService=false
  ProductionHostname="${CAFA_PRODUCTION_HOSTNAME}"
  CertificateArn="${CAFA_PRODUCTION_CERTIFICATE_ARN}"
  AvailabilityZone1="${CAFA_PRODUCTION_AZ1:-}"
  AvailabilityZone2="${CAFA_PRODUCTION_AZ2:-}"
)

if [[ -z "${CAFA_PRODUCTION_AZ1:-}" || -z "${CAFA_PRODUCTION_AZ2:-}" ]]; then
  mapfile -t AVAILABLE_AZS < <(
    aws ec2 describe-availability-zones \
      --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
      --filters Name=state,Values=available \
      --query 'AvailabilityZones[0:2].ZoneName' \
      --output text
  )
  if (( ${#AVAILABLE_AZS[@]} != 2 )); then
    echo "AWS production deployment blocked: provide two approved Availability Zones with CAFA_PRODUCTION_AZ1/AZ2." >&2
    exit 1
  fi
  COMMON_PARAMS[4]="AvailabilityZone1=${AVAILABLE_AZS[0]}"
  COMMON_PARAMS[5]="AvailabilityZone2=${AVAILABLE_AZS[1]}"
fi

echo "Creating or updating immutable production ECR and remote build infrastructure."
aws cloudformation deploy \
  --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
  --stack-name "${ECR_STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ProvisionEcrOnly=true \
  >/dev/null

ECR_URI="$(
  aws cloudformation describe-stacks \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --stack-name "${ECR_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" \
    --output text
)"

BUILD_SOURCE_BUCKET="$(
  aws cloudformation describe-stacks \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --stack-name "${ECR_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='BuildSourceBucketName'].OutputValue" \
    --output text
)"

IMAGE_BUILD_PROJECT="$(
  aws cloudformation describe-stacks \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --stack-name "${ECR_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='ImageBuildProjectName'].OutputValue" \
    --output text
)"

if [[ -z "${ECR_URI}" || "${ECR_URI}" == "None" ]]; then
  echo "AWS production deployment blocked: ECR repository output was not returned." >&2
  exit 1
fi

if [[ -z "${BUILD_SOURCE_BUCKET}" || "${BUILD_SOURCE_BUCKET}" == "None" ]]; then
  echo "AWS production deployment blocked: remote build source bucket output was not returned." >&2
  exit 1
fi

if [[ -z "${IMAGE_BUILD_PROJECT}" || "${IMAGE_BUILD_PROJECT}" == "None" ]]; then
  echo "AWS production deployment blocked: CodeBuild project output was not returned." >&2
  exit 1
fi

ECR_ARN="$(
  aws ecr describe-repositories \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --repository-names cafa-pmis-production \
    --query "repositories[0].repositoryArn" \
    --output text
)"

if [[ ! "${ECR_ARN}" =~ ^arn:[^:]+:ecr: ]]; then
  echo "AWS production deployment blocked: immutable ECR repository ARN was not returned." >&2
  exit 1
fi

COMMON_PARAMS+=("EcrRepositoryArn=${ECR_ARN}")
ECR_REPOSITORY="${ECR_URI#*/}"

if ECR_LOOKUP_OUTPUT="$(
  aws ecr describe-images \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --repository-name "${ECR_REPOSITORY}" \
    --image-ids "imageTag=${IMAGE_TAG}" \
    2>&1
)"; then
  echo "Immutable production image ${IMAGE_TAG} already exists; reusing it."

elif grep -q "ImageNotFoundException" <<<"${ECR_LOOKUP_OUTPUT}"; then
  BUILD_SOURCE_KEY="sources/${SOURCE_REVISION}-$(date -u +%Y%m%dT%H%M%SZ)-$$.zip"

  cleanup_build_source() {
    if [[ -n "${BUILD_SOURCE_KEY:-}" ]]; then
      if ! aws s3 rm \
        "s3://${BUILD_SOURCE_BUCKET}/${BUILD_SOURCE_KEY}" \
        --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
        --only-show-errors \
        >/dev/null 2>&1; then
        echo "Warning: remote build source cleanup failed; bucket lifecycle will expire it automatically." >&2
      fi
    fi
  }

  trap cleanup_build_source EXIT

  echo "Streaming source revision ${SOURCE_REVISION} to the private remote build bucket."

  git -C "${ROOT_DIR}" archive \
    --format=zip \
    "${SOURCE_REVISION}" \
    | aws s3 cp \
        - \
        "s3://${BUILD_SOURCE_BUCKET}/${BUILD_SOURCE_KEY}" \
        --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
        --only-show-errors

  echo "Starting remote CodeBuild image build."

  BUILD_ID="$(
    aws codebuild start-build \
      --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
      --project-name "${IMAGE_BUILD_PROJECT}" \
      --source-type-override S3 \
      --source-location-override "${BUILD_SOURCE_BUCKET}/${BUILD_SOURCE_KEY}" \
      --environment-variables-override \
        "name=IMAGE_TAG,value=${IMAGE_TAG},type=PLAINTEXT" \
        "name=SOURCE_REVISION,value=${SOURCE_REVISION},type=PLAINTEXT" \
      --query "build.id" \
      --output text
  )"

  if [[ -z "${BUILD_ID}" || "${BUILD_ID}" == "None" ]]; then
    echo "AWS production deployment blocked: CodeBuild did not return a build ID." >&2
    exit 1
  fi

  echo "Remote build started: ${BUILD_ID}"

  while true; do
    BUILD_STATUS="$(
      aws codebuild batch-get-builds \
        --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
        --ids "${BUILD_ID}" \
        --query "builds[0].buildStatus" \
        --output text
    )"

    case "${BUILD_STATUS}" in
      SUCCEEDED)
        echo "Remote image build succeeded."
        break
        ;;
      IN_PROGRESS)
        sleep 10
        ;;
      FAILED|FAULT|STOPPED|TIMED_OUT)
        echo "AWS production deployment blocked: remote image build ended with ${BUILD_STATUS}." >&2
        echo "CodeBuild evidence pointer: ${BUILD_ID}" >&2
        exit 1
        ;;
      *)
        echo "AWS production deployment blocked: unexpected CodeBuild status '${BUILD_STATUS}'." >&2
        echo "CodeBuild evidence pointer: ${BUILD_ID}" >&2
        exit 1
        ;;
    esac
  done

  cleanup_build_source
  trap - EXIT

else
  echo "AWS production deployment blocked: unable to determine whether ${IMAGE_TAG} already exists." >&2
  printf '%s\n' "${ECR_LOOKUP_OUTPUT}" >&2
  exit 1
fi

IMAGE_DIGEST="$(
  aws ecr describe-images \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --repository-name "${ECR_REPOSITORY}" \
    --image-ids "imageTag=${IMAGE_TAG}" \
    --query "imageDetails[0].imageDigest" \
    --output text
)"

if [[ ! "${IMAGE_DIGEST}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "AWS production deployment blocked: ECR did not return an immutable image digest." >&2
  exit 1
fi

IMAGE_URI="${ECR_URI%@*}@${IMAGE_DIGEST}"

EXISTING_SERVICE_TASK_DEFINITION="$(
  aws ecs describe-services \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --cluster cafa-pmis-production \
    --services cafa-pmis-production \
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
  --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
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
APPLICATION_TASK_DEFINITION="$(OUTPUT ApplicationTaskDefinition)"

echo "Running the standalone tracked migration task before enabling ECS service."
MIGRATION_TASK_ARN="$(
  aws ecs run-task \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --task-definition "${MIGRATION_TASK_DEFINITION}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${APP_SUBNET_1},${APP_SUBNET_2}],securityGroups=[${APP_SG}],assignPublicIp=DISABLED}" \
    --count 1 \
    --query "tasks[0].taskArn" \
    --output text
)"
aws ecs wait tasks-stopped \
  --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --tasks "${MIGRATION_TASK_ARN}"
MIGRATION_EXIT="$(
  aws ecs describe-tasks \
    --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${MIGRATION_TASK_ARN}" \
    --query "tasks[0].containers[0].exitCode" \
    --output text
)"
if [[ "${MIGRATION_EXIT}" != "0" ]]; then
  echo "AWS production deployment stopped: migration task exit code ${MIGRATION_EXIT}. Application service was not enabled." >&2
  echo "Migration task evidence pointer: ${MIGRATION_TASK_ARN}" >&2
  exit 1
fi

echo "Migration succeeded; enabling the ECS application service (desired count two, rolling deploy)."
aws cloudformation deploy \
  --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
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
  --region "${CAFA_PRODUCTION_APPROVED_REGION}" \
  --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}"

echo "Production service is enabled at desired count two."
echo "Source revision: ${SOURCE_REVISION}"
echo "Image digest: ${IMAGE_DIGEST}"
echo "Origin: https://${CAFA_PRODUCTION_HOSTNAME}"
echo "ALB DNS evidence: $(OUTPUT LoadBalancerDnsName)"