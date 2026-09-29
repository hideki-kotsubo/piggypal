#!/usr/bin/env bash
# Bump api/'s version, tag it, and push — run this right before you actually
# deploy, so the tag always means "this is what's live," not just "this is
# what merged." See docs/55-versioning-and-release-tagging.md.
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

(cd api && npm version "$BUMP" --tag-version-prefix="api-v" -m "api: bump to %s" >/dev/null)

VERSION="$(node -p "require('./api/package.json').version")"
TAG="api-v${VERSION}"

git push origin main
git push origin "$TAG"

cat <<EOF

Tagged and pushed ${TAG}.

Now deploy it for real (deploy/README.md step 3):
  ssh <your-host>
  cd flowtab && git pull
  cd deploy && docker compose up -d --build
  curl https://<api-host>/health   # should report "version":"${VERSION}"
EOF
