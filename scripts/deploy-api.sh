#!/usr/bin/env bash
# Bump api/'s version, tag it, and push — run this when you cut an api
# release, so the tag means "this is a released version," not just "this
# merged." The tag is then rolled out to staging (this machine) and
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

# npm version only commits and tags when run at the git root, and api/ is
# a workspace, so it just bumps the files here; the commit and tag are ours.
(cd api && npm version "$BUMP" --no-git-tag-version >/dev/null)

VERSION="$(node -p "require('./api/package.json').version")"
TAG="api-v${VERSION}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  git checkout -- api/package.json package-lock.json
  echo "Tag ${TAG} already exists, nothing bumped." >&2
  exit 1
fi

git add api/package.json package-lock.json
git commit -q -m "api: bump to ${VERSION}"
git tag -a "$TAG" -m "api ${VERSION}"

git push origin main
git push origin "$TAG"

cat <<EOF

Tagged and pushed ${TAG}.

1. Staging (this machine) — migrations apply on api startup (docs/58):
     deploy/up.sh api
     curl https://api.flowtab.codexbase.dev/health   # "version":"${VERSION}"

2. Production (its own server), once staging looks right:
     cd flowtab && git fetch --tags && git checkout ${TAG}
     deploy/up.sh api
     curl <prod-api-host>/health                    # "version":"${VERSION}"
EOF
