#!/usr/bin/env bash
# Rebuilds the Firefox add-on from a source archive, exactly as a Mozilla reviewer does. This script
# IS the procedure store/SOURCE-BUILD.md describes: the document invokes it and explains it, so there
# is no second copy of the commands to drift.
#
# Usage, from anywhere inside the unpacked archive: apps/extension/scripts/source-rebuild.sh <version>
# Output: apps/extension/dist/firefox, to be diffed byte for byte against the shipped add-on.
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
	echo "usage: $0 <version>   (e.g. 0.27.0, the version_name of the add-on under review)" >&2
	exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# The archive of a release tag already carries the release version (release-please commits it), so
# the version under review and the tree's version must agree before anything is built.
TREE_VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' apps/extension/package.json | head -n 1)"
if [ "$TREE_VERSION" != "$VERSION" ]; then
	echo "error: apps/extension/package.json is at version $TREE_VERSION, not $VERSION — this archive is not the source of the add-on under review" >&2
	exit 1
fi

WANT_BUN="$(sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"bun@\([^"]*\)".*/\1/p' package.json | head -n 1)"
HAVE_BUN="$(bun --version)"
if [ "$HAVE_BUN" != "$WANT_BUN" ]; then
	echo "error: bun $HAVE_BUN on PATH, but the archive was built with bun $WANT_BUN (package.json#packageManager); install that exact release" >&2
	exit 1
fi

# Bun runs the package scripts, but `cross-env` and `vite` are Node programs (their shebangs), so
# the ambient Node is a build input too; it is named so a differing rebuild can be explained.
echo "== node $(node --version) runs vite"

if git rev-parse --git-dir >/dev/null 2>&1; then
	echo "note: running inside a git checkout; the reference procedure unpacks the archive outside any repository" >&2
fi

# Dependencies come from the npm registry as pinned by bun.lock; the browser download Puppeteer
# would attempt is skipped because nothing here needs a browser. The build itself makes no request.
echo "== bun install (frozen lockfile, bun $HAVE_BUN)"
PUPPETEER_SKIP_DOWNLOAD=1 bun install --frozen-lockfile

echo "== build:firefox"
bun run --cwd apps/extension build:firefox

echo "== done: $ROOT/apps/extension/dist/firefox"
