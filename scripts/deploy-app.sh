#!/usr/bin/env bash
# Bump app/'s version, tag it, build, and push — run this right before you
# actually deploy the web PWA, so the tag always means "this is what's
# live." See docs/55-versioning-and-release-tagging.md.
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

Tagged, pushed, and built ${TAG} (app/dist).

Now deploy it for real (deploy/README.md step 5):
  upload app/dist/ (and website/, if it changed) to wherever nginx serves them
  reload the site and confirm Settings/About shows v${VERSION}
EOF
