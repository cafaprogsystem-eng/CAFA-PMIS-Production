#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "Remote staging image build blocked: $*" >&2
  exit 1
}

: "${AWS_DEFAULT_REGION:?AWS_DEFAULT_REGION is required}"
: "${ECR_URI:?ECR_URI is required}"
: "${ECR_REPOSITORY:?ECR_REPOSITORY is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${SOURCE_REVISION:?SOURCE_REVISION is required}"

if [[ ! "${SOURCE_REVISION}" =~ ^[a-f0-9]{40}$ ]]; then
  fail "SOURCE_REVISION is not a valid Git commit SHA."
fi

if [[ "${IMAGE_TAG}" != "source-${SOURCE_REVISION}" ]]; then
  fail "IMAGE_TAG does not match SOURCE_REVISION."
fi

if [[ "${ECR_URI##*/}" != "${ECR_REPOSITORY}" ]]; then
  fail "ECR_URI does not match ECR_REPOSITORY."
fi

ECR_LOOKUP_ERROR="$(mktemp)"
trap 'rm -f "${ECR_LOOKUP_ERROR}"' EXIT

if aws ecr describe-images \
  --region "${AWS_DEFAULT_REGION}" \
  --repository-name "${ECR_REPOSITORY}" \
  --image-ids "imageTag=${IMAGE_TAG}" \
  >/dev/null 2>"${ECR_LOOKUP_ERROR}"; then

  echo "Immutable image ${IMAGE_TAG} already exists; reusing it."
  exit 0

elif grep -q "ImageNotFoundException" "${ECR_LOOKUP_ERROR}"; then

  echo "Immutable image ${IMAGE_TAG} is absent; building it remotely."

else
  echo "Unable to determine immutable ECR image state." >&2
  cat "${ECR_LOOKUP_ERROR}" >&2
  exit 1
fi

rm -f "${ECR_LOOKUP_ERROR}"
trap - EXIT

aws ecr get-login-password \
  --region "${AWS_DEFAULT_REGION}" \
  | docker login \
      --username AWS \
      --password-stdin "${ECR_URI%/*}"

docker build \
  --label "org.opencontainers.image.revision=${SOURCE_REVISION}" \
  --label "org.opencontainers.image.source=CAFA-PMIS" \
  --tag "${ECR_URI}:${IMAGE_TAG}" \
  .

docker push "${ECR_URI}:${IMAGE_TAG}"

IMAGE_DIGEST="$(
  aws ecr describe-images \
    --region "${AWS_DEFAULT_REGION}" \
    --repository-name "${ECR_REPOSITORY}" \
    --image-ids "imageTag=${IMAGE_TAG}" \
    --query "imageDetails[0].imageDigest" \
    --output text
)"

if [[ ! "${IMAGE_DIGEST}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  fail "ECR did not return a valid immutable image digest after push."
fi

echo "Remote immutable image build complete."
echo "Source revision: ${SOURCE_REVISION}"
echo "Image digest: ${IMAGE_DIGEST}"
