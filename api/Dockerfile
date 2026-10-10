# Build context is the repo root, not api/ — npm workspaces need the root
# package.json + package-lock.json (plus every workspace's own package.json,
# just to resolve the workspace list) to install correctly. See
# deploy/docker-compose.yaml's `api` service, which sets `context: ..`.
#
# `npm ci --workspace api` scopes the actual dependency install to api/ (and
# the root) — confirmed empirically that this does NOT pull in app/'s much
# heavier deps (react, vite, etc.), even though app/package.json has to be
# present on disk for npm to parse the workspace list at all.

FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY app/package.json app/package.json
# The root postinstall (docs/64) runs this script; it only links app/'s
# Capacitor plugins, so here it finds nothing to do, but it must exist.
COPY scripts/link-capacitor-plugins.mjs scripts/link-capacitor-plugins.mjs
RUN npm ci --workspace api --include-workspace-root

COPY api ./api
RUN npm run build -w api

# Drop devDependencies (typescript, tsx, @types/*) now that the build's
# done — npm workspaces can nest a dep under api/node_modules instead of
# hoisting it to the root (confirmed for express specifically), so the
# runtime stage below copies both locations rather than guessing which.
RUN npm prune --workspace api --include-workspace-root --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/api ./api

# docs/58 D220 — api/src/migrate.ts applies these at startup, reading them
# from ../../db/migrations relative to api/dist, i.e. /repo/db/migrations.
COPY db/migrations ./db/migrations

# docs/58 D218 — the image has no .git (.dockerignore), so deploy/up.sh
# passes the commit in. Declared last so a new commit only rebuilds this
# one tiny layer, not the npm install above.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Matches api/.env.example's PORT default; deploy/docker-compose.yaml
# overrides this via the API_PORT env var if you change it there.
EXPOSE 3002

CMD ["node", "api/dist/index.js"]
