#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-closure.sh — build an ISOLATED, single-version @aztec 5.0.1 closure for
# running the bridge-core deploy scripts (deploy-bridge-testnet.ts L1+L2 path,
# deploy-sandbox.ts, etc.).
#
# WHY THIS EXISTS
# The nulo workspace is mid-migration: bridge-core pins @aztec/* 5.0.1 but the rest
# (wallet-*, apps, pxe/simulator/...) still pin 5.0.0. In a hoisted bun workspace that
# yields MULTIPLE physical copies of the shared @aztec libs (foundation/stdlib/
# constants/ethereum): root = 5.0.0 (majority), nested = 5.0.1. Two physical copies of
# the same class (Fr/AztecAddress/BlockHash) => "Type 'object' ... passed to BaseField
# ctor" the moment @aztec/stdlib's block_hash.js constructs GENESIS_BLOCK_HEADER_HASH.
#
# We can't fix that in-workspace without either (a) migrating the WHOLE monorepo to
# 5.0.1, or (b) a blanket `overrides` pin — which collides with the root's
# patchedDependencies (@aztec/noir-noirc_abi@5.0.0, @aztec/noir-acvm_js@5.0.0). Both are
# out of scope. Instead we build a throwaway mini-workspace OUTSIDE nulo's package.json
# graph and OUTSIDE nulo's bunfig, where EVERY package agrees on @aztec 5.0.1 -> exactly
# one physical copy -> no crash.
#
# The closure has NO bunfig, so:
#   - nulo's 7-day minimumReleaseAge supply-chain gate does NOT apply here (the real
#     control in nulo/bunfig.toml is untouched — see the "do not edit min-age" rule),
#   - there are NO patchedDependencies to collide with an all-5.0.1 resolution.
#
# USAGE
#   packages/bridge-core/scripts/deploy-closure.sh            # build the closure
#   packages/bridge-core/scripts/deploy-closure.sh --verify   # build + verify (no deploy)
#
#   Then run a deploy script from the closure (example — DO NOT run without real keys):
#     cd "$CLOSURE/bridge-core"
#     BRIDGE_EVM_OUT=<repo>/contracts/bridge/evm/out \
#     BRIDGE_EVM_ROOT=<repo>/contracts/bridge/evm \
#     BRIDGE_AZTEC_DIR=<repo>/contracts/bridge/aztec \
#     AZTEC_STANDARDS_DIR=<clone>/aztec-standards \
#     bun scripts/deploy-sandbox.ts            # or deploy-bridge-testnet.ts (needs L1 keys)
#
# The closure dir is transient (gitignored). Re-run this script any time source changes.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_CORE="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRIDGE_CORE/../.." && pwd)"
CLOSURE="${DEPLOY_CLOSURE_DIR:-$REPO_ROOT/.deploy-closure}"

# bun is not on PATH in non-interactive shells on this box.
export PATH="$HOME/.bun/bin:$PATH"
command -v bun >/dev/null || { echo "bun not found on PATH (expected ~/.bun/bin/bun)"; exit 1; }

echo "── building deploy closure ──────────────────────────────────────────────"
echo "  repo:    $REPO_ROOT"
echo "  closure: $CLOSURE"
rm -rf "$CLOSURE"
mkdir -p "$CLOSURE/vendor"

# 1) copy bridge-core sources (never node_modules) into the closure
mkdir -p "$CLOSURE/bridge-core"
cp -R "$BRIDGE_CORE/src" "$CLOSURE/bridge-core/src"
cp -R "$BRIDGE_CORE/scripts" "$CLOSURE/bridge-core/scripts"
cp "$BRIDGE_CORE/tsconfig.json" "$CLOSURE/bridge-core/tsconfig.json"
cp "$BRIDGE_CORE/tsconfig.scripts.json" "$CLOSURE/bridge-core/tsconfig.scripts.json"
cp "$BRIDGE_CORE/package.json" "$CLOSURE/bridge-core/package.json"

# 2) vendor the workspace deps bridge-core imports (only @nulo/wallet-crypto, which
#    pulls @nulo/wallet-core). wallet-core is dependency-free; wallet-crypto pins
#    @aztec/{accounts,constants,foundation}@5.0.0 -> rewrite to 5.0.1 so the whole
#    closure agrees on one @aztec version.
cp -R "$REPO_ROOT/packages/wallet-core" "$CLOSURE/vendor/wallet-core"
cp -R "$REPO_ROOT/packages/wallet-crypto" "$CLOSURE/vendor/wallet-crypto"
rm -rf "$CLOSURE/vendor/wallet-core/node_modules" "$CLOSURE/vendor/wallet-crypto/node_modules"

python3 - "$CLOSURE" <<'PY'
import json, sys
closure = sys.argv[1]
# wallet-crypto: bump its @aztec/* pins 5.0.0 -> 5.0.1 (keeps @nulo/wallet-core workspace:*)
p = f"{closure}/vendor/wallet-crypto/package.json"
d = json.load(open(p))
for k in list(d.get("dependencies", {})):
    if k.startswith("@aztec/"):
        d["dependencies"][k] = "5.0.1"
json.dump(d, open(p, "w"), indent="\t")
open(p, "a").write("\n")
PY

# 3) closure root: a self-contained mini-workspace (bridge-core + the two vendored @nulo
#    packages). No bunfig => no min-age gate, no patchedDependencies. Hoisted linker so
#    "one @aztec version" == "one physical copy" (easy to verify with find).
cat > "$CLOSURE/package.json" <<'JSON'
{
	"name": "bridge-deploy-closure",
	"private": true,
	"version": "0.0.0",
	"workspaces": ["bridge-core", "vendor/wallet-crypto", "vendor/wallet-core"]
}
JSON
cat > "$CLOSURE/bunfig.toml" <<'TOML'
[install]
linker = "hoisted"
TOML

# 4) install (isolated). All members agree on @aztec 5.0.1 -> single physical copy.
echo "── bun install (isolated closure) ──────────────────────────────────────"
( cd "$CLOSURE" && bun install )

echo "── single-copy verification ────────────────────────────────────────────"
copies_ok=1
for pkg in foundation stdlib constants ethereum; do
	mapfile -t hits < <(find "$CLOSURE" -path "*/@aztec/$pkg/package.json" 2>/dev/null)
	n=${#hits[@]}
	vers=""
	for h in "${hits[@]}"; do
		vers+=" $(python3 -c "import json,sys;print(json.load(open('$h'))['version'])")"
	done
	printf "  @aztec/%-10s copies=%s versions=%s\n" "$pkg" "$n" "$vers"
	[ "$n" -eq 1 ] || copies_ok=0
done
if [ "$copies_ok" -eq 1 ]; then
	echo "  ✅ exactly one physical copy of each shared @aztec package"
else
	echo "  ❌ more than one physical copy found — closure is NOT single-version"
	exit 1
fi

if [ "${1:-}" = "--verify" ]; then
	echo "── (b) tsc --noEmit (deploy-bridge-testnet.ts + all scripts) ───────────"
	( cd "$CLOSURE/bridge-core" && bun run typecheck )
	echo "  ✅ tsc green"

	echo "── (c)+(3) runtime import probe (no deploy) ────────────────────────────"
	# Imports the same @aztec/@nulo/@alejoamiras module graph deploy-bridge-testnet.ts
	# pulls in (WITHOUT running its main()), and disk-reads the AztecProtocol token the
	# way deploy-sandbox.ts does. Reproduces the "two instances / BaseField" crash if the
	# closure were multi-copy; prints CLOSURE_IMPORT_OK if single-copy.
	cat > "$CLOSURE/bridge-core/scripts/_closure_probe.ts" <<'TS'
import "@aztec/aztec.js/abi"
import "@aztec/aztec.js/contracts"
import "@aztec/wallets/embedded"
import "@aztec/noir-contracts.js/SponsoredFPC"
import "@aztec/l1-artifacts"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/foundation/curves/bn254"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import "@nulo/wallet-crypto"
import "./deploy-manifest"
import "./portal-artifact"

// Force a foundation-class construction — this is what crashes under multi-copy.
console.log("Fr ok:", new Fr(1n).toString().slice(0, 10), "addr ok:", AztecAddress.ZERO.toString().slice(0, 10))

// (3) AztecProtocol/aztec-standards@v5.0.1 token disk-read path (same as deploy-sandbox.ts).
const std = process.env.AZTEC_STANDARDS_DIR
if (std) {
	const art = loadContractArtifact(JSON.parse(readFileSync(join(std, "target", "token_contract-Token.json"), "utf8")))
	console.log("token disk-read ok:", art.name, art.functions.length, "fns")
} else {
	console.log("token disk-read: AZTEC_STANDARDS_DIR not set — skipped")
}
console.log("CLOSURE_IMPORT_OK")
TS
	( cd "$CLOSURE/bridge-core" && bun scripts/_closure_probe.ts )
	rm -f "$CLOSURE/bridge-core/scripts/_closure_probe.ts"
fi

echo "── closure ready ───────────────────────────────────────────────────────"
echo "  $CLOSURE"
