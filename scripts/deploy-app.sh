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

# npm version only commits and tags when run at the git root, and app/ is
# a workspace, so it just bumps the files here; the commit and tag are ours.
(cd app && npm version "$BUMP" --no-git-tag-version >/dev/null)

VERSION="$(node -p "require('./app/package.json').version")"
TAG="app-v${VERSION}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  git checkout -- app/package.json package-lock.json
  echo "Tag ${TAG} already exists, nothing bumped." >&2
  exit 1
fi

git add app/package.json package-lock.json
git commit -q -m "app: bump to ${VERSION}"
git tag -a "$TAG" -m "app ${VERSION}"

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
