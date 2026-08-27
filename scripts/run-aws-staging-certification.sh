#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  unset CAFA_STAGING_LOGIN_IDENTIFIER
  unset CAFA_STAGING_LOGIN_PASSWORD
}

trap cleanup EXIT INT TERM

export CAFA_STAGING_BASE_URL="${CAFA_STAGING_BASE_URL:-https://staging.pmis.cafa.systems}"

if [[ -z "${CAFA_STAGING_LOGIN_IDENTIFIER:-}" ]]; then
  read -r -p "Staging login identifier: " CAFA_STAGING_LOGIN_IDENTIFIER
  export CAFA_STAGING_LOGIN_IDENTIFIER
fi

if [[ -z "${CAFA_STAGING_LOGIN_PASSWORD:-}" ]]; then
  read -r -s -p "Staging login password: " CAFA_STAGING_LOGIN_PASSWORD
  echo
  export CAFA_STAGING_LOGIN_PASSWORD
fi

node "$(dirname "$0")/aws-staging-certification.mjs"
