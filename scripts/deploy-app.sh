#!/usr/bin/env bash
# Bump app/'s version, tag it, push, and build app/dist for staging — run
# this when you cut a web app release. The tag is then rolled out to
# production (its own server). See docs/55, docs/58 and docs/59.
#
#   scripts/deploy-app.sh [patch|minor|major] [--no-changelog]
#
# Releases the notes under "## Unreleased" in app/CHANGELOG.md: they're
# stamped with the new version and today's date, and website/changelog.html
# is regenerated, in the same commit as the bump. --no-changelog releases
# without notes (a silent fix nobody would notice).
set -euo pipefail

BUMP="patch"
CHANGELOG=1
for arg in "$@"; do
  case "$arg" in
    patch|minor|major) BUMP="$arg" ;;
    --no-changelog) CHANGELOG=0 ;;
    *) echo "Unknown argument: $arg (expected patch|minor|major, --no-changelog)" >&2; exit 1 ;;
  esac
done
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

if [[ "$CHANGELOG" == 1 ]]; then
  status=0
  npm run -s changelog -- --has-unreleased || status=$?
  if [[ "$status" == 3 ]]; then
    echo "No notes under \"## Unreleased\" in app/CHANGELOG.md. Write them first," >&2
    echo "or pass --no-changelog for a release users won't notice." >&2
    exit 1
  elif [[ "$status" != 0 ]]; then
    echo "The changelog check itself failed (see above), nothing was released." >&2
    exit 1
  fi
fi

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
if [[ "$CHANGELOG" == 1 ]]; then
  npm run -s changelog -- --release "$VERSION"
  git add app/CHANGELOG.md website/changelog.html
fi
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

if [[ "$CHANGELOG" == 1 ]]; then
  cat <<EOF

website/changelog.html was updated: publish website/ wherever it's served.

Release notes for the App Store / Play Store:
------------------------------------------------------------
$(npm run -s changelog -- --plain "$VERSION")
------------------------------------------------------------
EOF
fi
