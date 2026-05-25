Verdict: **do it now, but skip `act`; use one reusable Ubuntu 24.04 Docker container with mounted repo + persistent Bun/Aztec caches, and run only the failing shard (`5/5`) first.**

1. A naked Ubuntu container will not perfectly match GitHub-hosted timing, but it is good enough for your current phase-timing probes. If the failure is really `DappSessionService` full-store scans, Docker will still show the same phase ordering even if absolute ms differ.

2. `bb.wasm` cold boot will reproduce “enough” in Docker on macOS. It may be slower than GH Actions, not faster. That is acceptable here because you are debugging a timeout cliff, not benchmarking throughput.

3. This is worth doing now. You already have `[wallet-probe]` instrumentation, and the next 2-3 iterations are about confirming which wallet-side phase dominates. Spending ~30 minutes once on Docker is cheaper than 2 more CI cycles.

4. Recommendation: run the existing pipeline, not Actions YAML. Reuse `bun run e2e:agent` because it already builds Chrome, allocates ports, starts anvil/Aztec/playground, and runs the sharded vitest config.

`docker run`:

```bash
docker run --rm -it --platform=linux/amd64 \
  --cpus=4 --memory=12g --shm-size=2g \
  -v "$PWD":/work -w /work \
  -v nulo-bun-cache:/root/.bun/install/cache \
  -v nulo-aztec:/root/.aztec \
  ubuntu:24.04 \
  bash -lc './packages/extension/scripts/e2e/docker-ci-like.sh 5/5'
```

Script to add at `packages/extension/scripts/e2e/docker-ci-like.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
apt-get update
apt-get install -y curl ca-certificates git jq unzip xz-utils python3 build-essential \
  libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64 libxshmfence1
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL=/root/.bun; export PATH="$BUN_INSTALL/bin:$PATH"
bun install --frozen-lockfile
AZTEC_VERSION=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('packages/extension/package.json','utf8')).dependencies['@aztec/aztec.js'])")
curl -fsSL https://install.aztec.network/${AZTEC_VERSION}/install | VERSION="$AZTEC_VERSION" bash
ln -sfn "/root/.aztec/versions/${AZTEC_VERSION}" /root/.aztec/current
bun run e2e:agent --shard="${1:-5/5}"
```

Landmine: a green Docker run does not clear CI. A red Docker run with the same `[wallet-probe]` phase is the useful outcome.
