#!/usr/bin/env bash
# Compile + AVM-transpile the deployable bridge-aztec contracts.
#
# These contracts pin aztec-nr at the v4.2.0-aztecnr-rc.2 git tag, which needs
# the rc.2 toolchain — the default 4.2.0 `aztec compile` (nargo beta.19) fails
# with Noir 1299 errors. The rc.2 `aztec` CLI + `bb` (the AVM transpiler, via
# `bb aztec_process`) live under node_modules/.bin (NOT bin/, which only has
# nargo+forge). Plain `nargo compile` produces a NON-transpiled artifact that
# aztec.js loadContractArtifact rejects ("public bytecode has not been
# transpiled"); `aztec compile` does nargo + transpile + VKs. Output: the
# postprocessed target/*.json (the deployable artifact).
set -euo pipefail

AZTEC_RC2="${AZTEC_RC2:-$HOME/.aztec/versions/4.2.0-aztecnr-rc.2}"
AZTEC="$AZTEC_RC2/node_modules/.bin/aztec"
[ -x "$AZTEC" ] || { echo "rc.2 aztec CLI not found at $AZTEC — run: aztec-up install 4.2.0-aztecnr-rc.2" >&2; exit 1; }

export PATH="$AZTEC_RC2/bin:$AZTEC_RC2/node_modules/.bin:$PATH"
export NARGO="$AZTEC_RC2/bin/nargo"
export BB="$AZTEC_RC2/node_modules/.bin/bb"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for c in token_minter_proxy token_bridge; do
	echo "=== aztec compile $c ==="
	(cd "$here/$c" && "$AZTEC" compile)
done
echo "✅ transpiled artifacts in */target/*.json"
