#!/usr/bin/env bash
# Run the e2e network suite inside an Ubuntu 24.04 container that mirrors
# our GitHub Actions runner. Lets us iterate on `connectPlayground:awaitVerifyPopup`
# (and similar timing cliffs) without paying the 15-30min CI roundtrip.
#
# Usage (from the host):
#   docker run --rm -it --platform=linux/amd64 \
#     --cpus=4 --memory=12g --shm-size=2g \
#     -v "$PWD":/work -w /work \
#     -v nulo-bun-cache:/root/.bun/install/cache \
#     -v nulo-aztec:/root/.aztec \
#     -v nulo-foundry:/root/.foundry \
#     ubuntu:24.04 \
#     bash -lc './apps/extension/scripts/e2e/docker-ci-like.sh 5/5'
#
# `--cpus` + `--memory` constraints are deliberately tight to approximate the
# GitHub-hosted ubuntu-latest runner profile (4 vCPU, 16GB; we leave 4GB headroom
# for the macOS host's hypervisor). `--shm-size` matters for Chrome (default 64MB
# is way too small for headless puppeteer + multiple tabs).
#
# Named volumes:
#   nulo-bun-cache    — preserves bun's npm cache across runs (~few minutes saved)
#   nulo-aztec        — preserves aztec CLI install (~5 minutes saved)
#   nulo-foundry      — preserves foundry/anvil install
#
# Arg 1: vitest --shard expression (e.g. "5/5"). Default "5/5" (the shard that
#        hits the connectPlayground:awaitVerifyPopup failure deterministically).

set -euo pipefail

SHARD="${1:-5/5}"

echo "::group::apt deps"
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
# Core build deps + Chrome runtime deps (matches what puppeteer needs).
apt-get install -y --no-install-recommends \
	curl ca-certificates git jq unzip xz-utils python3 build-essential pkg-config \
	libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64 libxshmfence1 \
	libxkbcommon0 libdrm2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
	libpango-1.0-0 libcairo2 libcups2 fonts-liberation \
	>/dev/null
echo "::endgroup::"

echo "::group::bun + node 24"
if ! command -v bun >/dev/null; then
	curl -fsSL https://bun.sh/install | bash >/dev/null
fi
export BUN_INSTALL=/root/.bun
export PATH="$BUN_INSTALL/bin:$PATH"
bun --version

if ! command -v node >/dev/null; then
	# Retry-on-network-blip + arch detection (linux/amd64 emulation on macOS).
	# Pin to v24.16.0 (latest 24.x LTS as of bootstrap). Aztec's install script
	# requires Node >= 24.12.0; 24.4.0 (default in setup-node@v6) is too old.
	NODE_VERSION="${NODE_VERSION:-v24.16.0}"
	ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; esac
	for attempt in 1 2 3; do
		if curl -fsSL --retry 5 --retry-delay 2 --retry-max-time 120 \
				"https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${ARCH}.tar.xz" \
				-o /tmp/node.tar.xz; then
			break
		fi
		echo "Node download attempt $attempt failed; retrying in 5s..."
		sleep 5
	done
	mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
	export PATH="/opt/node/bin:$PATH"
fi
node --version
echo "::endgroup::"

echo "::group::foundry"
if [ ! -x /root/.foundry/bin/anvil ]; then
	curl -L https://foundry.paradigm.xyz | bash
	/root/.foundry/bin/foundryup
fi
export PATH="/root/.foundry/bin:$PATH"
anvil --version || true
echo "::endgroup::"

echo "::group::bun install"
bun install --frozen-lockfile
echo "::endgroup::"

echo "::group::aztec cli"
AZTEC_VERSION=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('apps/extension/package.json','utf8')).dependencies['@aztec/aztec.js'])")
echo "Aztec version: $AZTEC_VERSION"
echo "node: $(command -v node) ($(node --version))"
echo "anvil: $(command -v anvil) ($(anvil --version 2>&1 | head -1))"
# Force re-install if the bin dir is empty (previous failed installs left
# stub directories that pass `-d` but contain no binaries).
AZTEC_BIN_DIR="/root/.aztec/versions/$AZTEC_VERSION/bin"
if [ ! -x "$AZTEC_BIN_DIR/aztec-anvil" ]; then
	echo "::warning::aztec install absent or stale at $AZTEC_BIN_DIR; reinstalling"
	rm -rf "/root/.aztec/versions/$AZTEC_VERSION"
	export CI=1
	export FOUNDRY_DIR="$HOME/.foundry"
	curl -fsSL "https://install.aztec.network/${AZTEC_VERSION}/install" | VERSION="$AZTEC_VERSION" bash
fi
# global-setup.ts looks at ~/.aztec/current/bin/aztec-anvil exactly (5.0 renamed the bundled
# bare `anvil` to `aztec-anvil`). The aztec installer SHOULD have put it there; if it didn't
# (foundry already in PATH, or partial install), symlink foundry's anvil so the test stack finds it.
if [ ! -x "$AZTEC_BIN_DIR/aztec-anvil" ]; then
	if [ -x /root/.foundry/bin/anvil ]; then
		echo "::warning::aztec install didn't place anvil; symlinking foundry's"
		mkdir -p "$AZTEC_BIN_DIR"
		ln -sfn /root/.foundry/bin/anvil "$AZTEC_BIN_DIR/aztec-anvil"
	else
		echo "::error::no anvil available anywhere"
		exit 2
	fi
fi
ln -sfn "/root/.aztec/versions/${AZTEC_VERSION}" /root/.aztec/current
ls -la "$AZTEC_BIN_DIR/" || true
export PATH="/root/.aztec/current/bin:/root/.aztec/current/node_modules/.bin:$PATH"
echo "::endgroup::"

echo "::group::env"
export NULO_E2E_WALLET_PROBE=1
env | grep -E 'NULO_E2E|AZTEC_|VITE_' | sort
echo "::endgroup::"

# A path-looking arg targets specific test FILE(s) (mirrors the CI heavy
# jobs, e.g. fee-methods); an N/M arg is a vitest shard expression.
if [[ "$SHARD" == *.test.ts ]]; then
	echo "::group::e2e:agent $SHARD"
	bun run e2e:agent "$SHARD"
else
	echo "::group::e2e:agent --shard=$SHARD"
	bun run e2e:agent --shard="$SHARD"
fi
echo "::endgroup::"
