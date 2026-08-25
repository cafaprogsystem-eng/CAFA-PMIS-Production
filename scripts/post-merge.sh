#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm exec tsx artifacts/api-server/src/migrate.ts
