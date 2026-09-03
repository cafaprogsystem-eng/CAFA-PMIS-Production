# ─────────────────────────────────────────────────────────────────────────────
# CAFA PMIS — Multi-stage Docker build
#
# Stage 1 (builder): Install all workspace deps, build the API bundle and
#                    the Vite frontend.
# Stage 2 (runner):  Lean production image.  Only the bundled server, the
#                    externalized npm deps (AWS/GCS/nodemailer…), and the
#                    compiled frontend static files.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:24-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# Copy everything (respects .dockerignore — see that file to keep the context lean)
COPY . .

# Install pnpm from the bundled offline tarball in docker-tools/.
# npm pack produces a tarball with a "package/" root; --strip-components=1 removes it.
# We write a thin shell wrapper so `pnpm` is on PATH without any PNPM_HOME magic.
RUN mkdir -p /usr/local/lib/node_modules/pnpm \
 && tar -xzf docker-tools/pnpm-10.26.1.tgz \
        -C /usr/local/lib/node_modules/pnpm \
        --strip-components=1 \
 && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs "$@"\n' \
        > /usr/local/bin/pnpm \
 && chmod +x /usr/local/bin/pnpm

# Install all workspace dependencies.
# --ignore-scripts skips the root preinstall guard (pnpm agent check) which
# fails inside Docker because npm_config_user_agent is not set by corepack.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build compiled workspace libs (composite TS packages)
RUN pnpm run typecheck:libs

# Build the API server — esbuild produces artifacts/api-server/dist/index.mjs
# NOTE: @aws-sdk/*, @google-cloud/* and a few others are externalized (not
#       bundled) so they must be present in node_modules at runtime.
RUN pnpm --filter @workspace/api-server run build

# Build the frontend — Vite config validates PORT + BASE_PATH at load time.
# These values only affect the dev server config; the static output is the same
# regardless of which port is used.
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/cafa-pmis run build

# ─── Stage 2: Production runner ───────────────────────────────────────────────
FROM node:24-slim AS runner

# Trust the official Amazon RDS certificate authorities while preserving
# full TLS certificate and hostname verification for PostgreSQL connections.
#
# ffmpeg (+ ffprobe, same package) is a hard runtime dependency of the
# training-video pipeline (lib/video-generator.ts) and the uploaded-video
# duration probe (routes/training-videos.ts) — both just shell out to the
# system binary, there is no npm package providing it. fonts-dejavu-core
# provides /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf and
# DejaVuSansMono.ttf, the fontfile paths video-generator.ts's drawtext
# filters use — node:24-slim ships neither by default.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fontconfig ffmpeg fonts-dejavu-core \
 && mkdir -p /opt/aws-rds-ca \
 && curl --fail --silent --show-error --location \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      --output /opt/aws-rds-ca/global-bundle.pem \
 && rm -rf /var/lib/apt/lists/*

# Karla — the same body/narration face as the approved training-video design
# proposal, for burned-in captions (lib/video-generator.ts's
# generateASSSubtitles) — fetched from the font's official Google Fonts
# repository (verified reachable and a valid font file before adding this).
# fc-cache registers it with fontconfig so libass finds it by family name
# ("Karla") with no explicit fontsdir, the same way it already finds DejaVu.
RUN mkdir -p /usr/share/fonts/truetype/karla \
 && curl --fail --silent --show-error --location \
      https://raw.githubusercontent.com/google/fonts/main/ofl/karla/Karla%5Bwght%5D.ttf \
      --output /usr/share/fonts/truetype/karla/Karla-Regular.ttf \
 && fc-cache -f

ENV NODE_EXTRA_CA_CERTS="/opt/aws-rds-ca/global-bundle.pem"

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# ── Workspace config (pnpm needs these to resolve workspace packages) ─────────
COPY --from=builder /app/pnpm-workspace.yaml \
                    /app/pnpm-lock.yaml \
                    /app/package.json \
                    /app/docker-tools/pnpm-10.26.1.tgz ./

# ── Packages — only what the API server needs at runtime ─────────────────────
# API server: compiled bundle + package.json (pnpm workspace registration)
COPY --from=builder /app/artifacts/api-server/package.json  ./artifacts/api-server/
COPY --from=builder /app/artifacts/api-server/dist          ./artifacts/api-server/dist

# Other workspace packages: pnpm needs their package.json to resolve the
# workspace graph; their source/dist is already bundled into index.mjs.
COPY --from=builder /app/artifacts/cafa-pmis/package.json   ./artifacts/cafa-pmis/
COPY --from=builder /app/lib                                 ./lib
COPY --from=builder /app/scripts/package.json \
                    /app/scripts/migrate.mjs \
                    /app/scripts/seed.mjs                   ./scripts/

# ── Frontend static assets (Express serves these in production) ───────────────
COPY --from=builder /app/artifacts/cafa-pmis/dist/public    ./public

# ── Install pnpm (offline — same tarball as builder stage) ───────────────────
RUN mkdir -p /usr/local/lib/node_modules/pnpm \
 && tar -xzf pnpm-10.26.1.tgz \
        -C /usr/local/lib/node_modules/pnpm \
        --strip-components=1 \
 && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs "$@"\n' \
        > /usr/local/bin/pnpm \
 && chmod +x /usr/local/bin/pnpm \
 && rm pnpm-10.26.1.tgz

# ── Install production dependencies only ─────────────────────────────────────
# --ignore-scripts: skip native-module compile scripts; all externalized
# packages we actually use (@aws-sdk, @google-cloud, nodemailer) are pure JS.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Chromium for the training-video screenshot-capture tool
# (scripts/capture-training-screenshots.mjs), baked in at build time. The ECS
# task that runs it has no outbound internet access at all (private subnet,
# no NAT gateway) — downloading Chromium there at runtime, as originally
# attempted, is not possible ("Network is unreachable"). This build runs in
# CodeBuild, which does have internet access, so installing it here works;
# --with-deps also apt-installs the system libraries (libnss3, libatk, etc.)
# headless Chromium needs to actually run, not just unpack. @playwright/test
# (the npm package providing the `playwright` CLI) is already installed by
# the step above — it's a root-level "dependencies" entry, not a
# devDependency, specifically so it survives --prod here.
ENV DEBIAN_FRONTEND=noninteractive
RUN npx playwright install --with-deps chromium

# ── Runtime config ────────────────────────────────────────────────────────────
ENV NODE_ENV=production
# Express serves the Vite build from this path when set
ENV STATIC_FILES_PATH=/app/public

EXPOSE 8080

# Tiny healthcheck so Docker / compose knows the container is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
