#!/usr/bin/env bash
# Bump app/'s version, tag it, push, and build app/dist for staging — run
# this when you cut a web app release. The tag is then rolled out to
# production (its own server). See docs/55 and docs/58.
set -euo pipefail

BUMP="${1:-patch}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
  echo "Not on main — merge your work into main first, then re-run this from main." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree not clean — commit or stash before deploying." >&2
  exit 1
fi

git pull --ff-only

(cd app && npm version "$BUMP" --tag-version-prefix="app-v" -m "app: bump to %s" >/dev/null)

VERSION="$(node -p "require('./app/package.json').version")"
TAG="app-v${VERSION}"

git push origin main
git push origin "$TAG"

npm run build -w app

cat <<EOF

Tagged and pushed ${TAG}, and built app/dist — staging (this machine) is
live once nginx serves the new files. Check About shows ${VERSION} and its
commit.

Production (its own server), once staging looks right:
  cd flowtab && git fetch --tags && git checkout ${TAG}
  npm ci && npm run build -w app        # reads app/.env.production.local there
  reload the site and check About shows ${VERSION}
EOF
