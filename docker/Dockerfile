# syntax=docker/dockerfile:1
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# The eduLIMS images, from one file with two final targets:
#
#   runtime (the default)  the TanStack Start server: the built `.output/`
#                          tree on distroless Node.js 26, nothing else.
#   migrate                a one-shot that runs the database migrations
#                          (src/server/db/migrate.ts) against DATABASE_URL
#                          and exits, on the same distroless base.
#
# Build locally from the repository root:
#   docker buildx build -f docker/Dockerfile -t edulims:dev .
#   docker buildx build -f docker/Dockerfile --target migrate -t edulims-migrate:dev .
#
# The release lane (.github/workflows/release-image.yml) builds the runtime
# target with OUTPUT=dist: it copies the `.output/` tree from the tarball that
# release-build.yml built and attested, after verifying that attestation, so
# the image carries the same bytes as the release asset. A local build uses
# the default OUTPUT=source and compiles the tree in the build stage.
#
# Every stage that runs Node.js code runs on the build platform. `.output/` is
# plain JavaScript with no native module, so one build serves linux/amd64 and
# linux/arm64 and the release lane needs no QEMU. The migrate target asks pnpm
# for the target platform's optional binaries instead.

# Where the runtime target takes `.output/` from: `source` (build it here) or
# `dist` (copy dist/.output from the build context).
ARG OUTPUT=source

# ── build: install with the lockfile, build, and deploy the production tree ──
# The official Node.js image at the exact version in .node-version, pinned by
# index digest. Dependabot (docker ecosystem) proposes the bumps.
FROM --platform=$BUILDPLATFORM docker.io/library/node:26.13.0-trixie@sha256:438603bbb5cda404b9416f0b5c8026f61501ab911760d861ec28c36b5d675725 AS build

# Node.js 25 removed corepack, so pnpm comes from the npm registry at the
# exact version package.json names in `packageManager`, checked against the
# registry's sha512 integrity for that version (the same pin as
# scripts/release/install-pnpm.sh). npm runs in /tmp on purpose: in /src the
# `devEngines` field of package.json makes npm refuse to run, because it names
# pnpm as the package manager.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG PNPM_VERSION=12.18.0
ARG PNPM_INTEGRITY=sha512-nXiC1dyCFH7PxOBiqjSDTgrQKWcQoYN6ERWuASEn02txCeMhrBWYod0KZVl2gbHpmRfhLtDXSerpEYeUM2O+sw==
WORKDIR /tmp/pnpm
RUN tarball="$(npm pack --silent "pnpm@${PNPM_VERSION}")" \
 && got="sha512-$(openssl dgst -sha512 -binary "${tarball}" | openssl base64 -A)" \
 && if [ "${got}" != "${PNPM_INTEGRITY}" ]; then echo "pnpm ${PNPM_VERSION} has integrity ${got}, not ${PNPM_INTEGRITY}" >&2; exit 1; fi \
 && npm install --global --no-audit --no-fund "./${tarball}" \
 && rm -rf /tmp/pnpm \
 && pnpm --version

WORKDIR /src
ENV CI=true

# The manifests first, so a source-only change reuses the install layer in a
# local build. The release lane builds with no cache at all.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# The production dependency tree for the migrate target, with the target
# platform's optional native binaries. pnpm names architectures as Node.js
# does (x64, arm64), and buildx names them as Go does (amd64, arm64).
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) cpu=x64 ;; \
      arm64) cpu=arm64 ;; \
      *) echo "no pnpm cpu name for ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && pnpm deploy --prod --frozen-lockfile --os=linux --cpu="${cpu}" --libc=glibc /deploy

# ── the two places `.output/` can come from ──────────────────────────────────
FROM build AS output-source

FROM scratch AS output-dist
COPY dist/.output /src/.output

# DL3006 reads `output-${OUTPUT}` as an untagged image. It names one of the two
# stages above, and both are pinned through the FROM lines they start from.
# hadolint ignore=DL3006
FROM output-${OUTPUT} AS output

# ── migrate: the one-shot schema migration ───────────────────────────────────
# The migrations are TypeScript that Node.js 26 runs directly by stripping the
# types (`pnpm db:migrate` is `node src/server/db/migrate.ts`). The image
# runs that file with node itself, so it needs no shell and no package
# manager, and it shares the runtime target's distroless base: one base to
# scan and to bump. It holds the production node_modules and the sources
# from `pnpm deploy`, root-owned, and writes nothing, so compose runs it with
# a read-only root filesystem.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3 AS migrate

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown

WORKDIR /app
COPY --from=build --chown=0:0 /deploy/ /app/

ENV NODE_ENV=production
USER 65532:65532

# The base's entrypoint is /nodejs/bin/node.
CMD ["/app/src/server/db/migrate.ts"]

LABEL org.opencontainers.image.title="eduLIMS migrate" \
      org.opencontainers.image.description="Applies the eduLIMS database migrations to DATABASE_URL and exits" \
      org.opencontainers.image.source="https://github.com/Vernum-Projecten/eduLIMS" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Ruben Talstra" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.base.name="gcr.io/distroless/nodejs26-debian13:nonroot"

# ── runtime: the server ──────────────────────────────────────────────────────
# distroless Node.js 26 on Debian 13: node, glibc, ca-certificates, tzdata and
# /etc/passwd with the nonroot user (uid 65532). No shell, no package manager,
# no npm. docs/deployment.md records why this base and not node:26-slim or
# Chainguard's node image.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3 AS runtime

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown

WORKDIR /app

# Root-owned and not writable by the runtime user, so the server cannot change
# its own code. The server writes nothing to disk, so compose runs it with a
# read-only root filesystem.
COPY --from=output --chown=0:0 /src/.output /app/.output

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
EXPOSE 3000/tcp

# Numeric on purpose: a runtime that checks for a non-root user cannot resolve
# a user name against an image it does not read.
USER 65532:65532

# The base has no shell and no HTTP client, so the probe is node itself: one
# GET /api/health on the loopback, exit 0 on a 2xx answer.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The base's entrypoint is /nodejs/bin/node, so node is PID 1 and receives
# SIGTERM itself.
CMD ["/app/.output/server/index.mjs"]

# Build-independent labels here; the release lane adds the same keys through
# docker/metadata-action and mirrors them as index annotations for GHCR.
LABEL org.opencontainers.image.title="eduLIMS" \
      org.opencontainers.image.description="A laboratory information management system for practical lab education" \
      org.opencontainers.image.source="https://github.com/Vernum-Projecten/eduLIMS" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Ruben Talstra" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.base.name="gcr.io/distroless/nodejs26-debian13:nonroot"
