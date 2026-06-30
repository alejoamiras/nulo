#!/usr/bin/env bash
# Compile + AVM-transpile the deployable bridge-aztec contracts.
#
# These contracts pin aztec-nr at the v5.0.0-rc.1 git tag, which needs the matching
# 5.0.0-rc.1 toolchain. The `aztec` CLI + `bb` (the AVM transpiler) live under
# node_modules/.bin; nargo is exposed as `aztec-nargo` in bin/ (5.0 renamed the bundled
# bare binaries to aztec-* on PATH). Plain `nargo compile` produces a NON-transpiled
# artifact that aztec.js loadContractArtifact rejects ("public bytecode has not been
# transpiled"); `aztec compile` does nargo + transpile + VKs. Output: the postprocessed
# target/*.json (the deployable artifact).
set -euo pipefail

AZTEC_HOME="${AZTEC_HOME:-$HOME/.aztec/versions/5.0.0-rc.1}"
AZTEC="$AZTEC_HOME/node_modules/.bin/aztec"
[ -x "$AZTEC" ] || { echo "5.0.0-rc.1 aztec CLI not found at $AZTEC — run: aztec-up install 5.0.0-rc.1" >&2; exit 1; }

export PATH="$AZTEC_HOME/bin:$AZTEC_HOME/node_modules/.bin:$PATH"
export NARGO="$AZTEC_HOME/bin/aztec-nargo"
export BB="$AZTEC_HOME/node_modules/.bin/bb"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
for c in token_minter_proxy token_bridge; do
	echo "=== aztec compile $c ==="
	(cd "$here/$c" && "$AZTEC" compile)
	# `aztec compile` embeds absolute source paths (this machine's repo root + the ~/.aztec and
	# ~/nargo dependency caches) in the artifact's debug file_map. They are not load-bearing, but
	# the artifact is committed (CI has no nargo), so leaving them leaks the contributor's home-dir
	# layout and trips scripts/check-no-brand.sh. Rewrite to repo-relative so the committed artifact
	# is identical regardless of which machine built it.
	perl -i -pe "s{\Q$repo_root\E/}{}g; s{\Q$HOME\E/}{}g" "$here/$c"/target/*.json
done
echo "✅ transpiled + path-scrubbed artifacts in */target/*.json"
