#!/usr/bin/env bash
# The local validation gate of the unleashed import, phase by phase, on an unleashed checkout at
# <workdir>/unleashed. Nothing is published, pushed or deployed. The phases that built that checkout
# from an extract.sh output are retired: they copied nulo's design package, which unleashed no
# longer carries, and unleashed's own commits now do that work.
#
#   rehearse.sh <workdir> [phase ...]
#
# The checkout must be installed (`bun install`). Phases run in order, each logging to
# <workdir>/report/rehearse-<phase>.log; name phases to resume from a failure. `history` compares
# HEAD with $REHEARSE_BASE (default `main`, the audited import) and refuses to compare it with itself.
# Toolchains: Foundry from $FOUNDRY_BIN, halmos from $EXTRACTION_TOOLS, Aztec CLIs under ~/.aztec/versions.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
PHASES=(preinstall fast identity tools e2e control contracts history audit)

die() {
  echo "rehearse: $*" >&2
  exit 1
}

[ $# -ge 1 ] || die "usage: rehearse.sh <workdir> [phase ...]"
work=$(cd "$1" && pwd)
shift
[ $# -gt 0 ] || set -- "${PHASES[@]}"
repo=$work/unleashed
report=$work/report
base=${REHEARSE_BASE:-main}
[ -d "$repo/node_modules" ] || die "$repo is not installed: run bun install there first"
mkdir -p "$report"
export PATH="${FOUNDRY_BIN:-$HOME/.cache/unleashed-rehearsal/foundry/bin}:${EXTRACTION_TOOLS:-$HOME/.local/share/extraction-tools/bin}:$PATH"

# The Aztec line a crate's Nargo.toml pins, as _bridge-contracts.yml resolves it.
aztec_pin() {
  sed -n 's/.*aztec-packages\/".*tag = "v\([^"]*\)".*/\1/p' "$repo/contracts/bridge/aztec/$1/Nargo.toml" | head -1
}

phase_preinstall() {
  (cd "$repo" && bun -e '
    import { existsSync, readdirSync, readFileSync } from "node:fs"
    const pkg = JSON.parse(readFileSync("package.json", "utf8"))
    const texts = [...Object.values(pkg.scripts), ...readdirSync(".githooks").map((h) => readFileSync(`.githooks/${h}`, "utf8"))]
    const paths = texts.flatMap((t) => t.match(/(?:\.\/)?(?:apps|packages|scripts|contracts)\/[\w./-]*/g) ?? [])
    const missing = [...new Set(paths)].filter((p) => !existsSync(p))
    if (missing.length) { console.error("missing:", missing); process.exit(1) }
    console.log(`preinstall: ${new Set(paths).size} script/hook path(s) exist`)
  ')
  git -C "$repo" check-ignore -q packages/bridge-core/.env || die "packages/bridge-core/.env is not ignored"
  git -C "$repo" check-ignore -q apps/tools/.env.local || die "apps/tools/.env.local is not ignored"
}

phase_fast() {
  (cd "$repo" && bun run baseline:complexity && bun run lint && bun run typecheck:all && bun run test:all)
}

phase_identity() {
  (cd "$repo/apps/tools" && bun -e '
    import { assertPackageIdentity } from "@alejoamiras/nulo-resolve-asset"
    const from = new URL("./package.json", `file://${process.cwd()}/`).href
    const checks = [
      ["@aztec/aztec.js", "@alejoamiras/nulo-wallet-sdk-schema-patch"],
      ["@aztec/stdlib", "@alejoamiras/nulo-wallet-sdk-schema-patch"],
      ["@aztec/accounts", "@alejoamiras/nulo-wallet-crypto"],
      ["@aztec/foundation", "@alejoamiras/nulo-wallet-crypto"],
    ]
    for (const [pkg, via] of checks) {
      const r = assertPackageIdentity(pkg, { from, expectVersion: "5.2.0", lockstepVia: via })
      console.log(`identity: ${pkg}@${r.version} is one copy through ${via}`)
    }
    const { WalletSchema } = await import("@aztec/aztec.js/wallet")
    const methods = ["registerToken", "isTokenRegistered", "grantPublicAuthwit"]
    if (methods.some((m) => m in WalletSchema)) throw new Error("WalletSchema carries a patched method before register ran")
    await import("@alejoamiras/nulo-wallet-sdk-schema-patch/register")
    const missing = methods.filter((m) => !(m in WalletSchema))
    if (missing.length) throw new Error(`register left the WalletSchema apps/tools resolves without ${missing.join(", ")}`)
    console.log("identity: register adds all three methods to the WalletSchema apps/tools resolves")
  ')
  (cd "$repo" && bun run --cwd apps/tools build:testnet)
  # The patch body is referenced only by register, so it survives tree-shaking only if the call
  # does. Whether the browser's wallet proxy uses it is e2e cell 36, with the control phase.
  grep -rqF -- "Nulo schema-patch: upstream WalletSchema." "$repo/apps/tools/dist/assets" ||
    die "the production bundle does not carry the schema patch"
  echo "identity: the production bundle carries the schema patch"
}

phase_tools() {
  (
    cd "$repo"
    bun run --cwd apps/tools verify:deployments
    for target in testnet mainnet; do
      bun run --cwd apps/tools "build:$target"
      bun run --cwd apps/tools verify:build-target "$target"
    done
    bun run --cwd apps/tools test:e2e
  )
}

# The pinned forge libraries, remappings and artifacts: the sandbox deploys from them too.
forge_prep() {
  (
    cd "$repo/contracts/bridge/evm"
    [ -d lib/forge-std ] || forge install --no-git \
      foundry-rs/forge-std@bf647bd6046f2f7da30d0c2bf435e5c76a780c1b \
      OpenZeppelin/openzeppelin-contracts@cab19933c33c2ad1d4c7a84864a3601dddfd16f3 \
      Uniswap/v4-core@e50237c43811bd9b526eff40f26772152a42daba
  )
  (cd "$repo" && bun packages/bridge-core/scripts/gen-remappings.ts && forge build --root contracts/bridge/evm)
}

# The Aztec line bridge-core pins, which the sandbox and the integration suite run.
bridge_core_pin() {
  (cd "$repo" && bun -e 'console.log(JSON.parse(require("fs").readFileSync("packages/bridge-core/package.json", "utf8")).dependencies["@aztec/aztec.js"])')
}

e2e_tools() {
  forge_prep
  # A host-wide browser store may be read-only and hold other revisions; the install then hangs.
  export PLAYWRIGHT_BROWSERS_PATH=${REHEARSAL_BROWSERS:-$HOME/.cache/ms-playwright}
  (cd "$repo" && apps/tools/node_modules/.bin/playwright install chromium)
  [ $# -eq 0 ] || set -- -- "$@"
  (cd "$repo" && PATH="$HOME/.aztec/versions/$(bridge_core_pin)/bin:$PATH" bun run e2e:tools "$@")
}

phase_e2e() {
  e2e_tools
}

# Cells 35 and 36 are the browser proof that the production-mode build's wallet proxy carries the
# patch: add-to-wallet reaches a test wallet only through registerToken. The control removes the
# register import and runs control.spec.ts, which asserts per profile that the call throws inside
# the app (status `error`, and the wallet frame never receives it) on a transport that works.
phase_control() {
  local session=$repo/apps/tools/src/composables/createAztecWalletSession.ts
  local import='import "@alejoamiras/nulo-wallet-sdk-schema-patch/register"'
  local spec=$repo/apps/tools/tests/browser/specs/control-no-patch.spec.ts
  local log=$report/control-e2e.log status=0
  [ "$(grep -cxF "$import" "$session")" = 1 ] || die "the session module does not import register exactly once"
  cp "$session" "$work/session.orig"
  # Expanded now: the trap fires after this function's locals are gone.
  trap "cp -- $(printf '%q' "$work/session.orig") $(printf '%q' "$session"); rm -f -- $(printf '%q' "$spec")" EXIT
  grep -vxF "$import" "$work/session.orig" >"$session"
  cp "$here/control.spec.ts" "$spec"
  NULO_E2E_RETRIES=0 e2e_tools specs/control-no-patch.spec.ts 2>&1 | tee "$log" || status=$?
  cp "$work/session.orig" "$session"
  rm -f -- "$spec"
  trap - EXIT
  # The build also regenerates src/types/components.d.ts, so only the edited module is checked.
  git -C "$repo" diff --quiet -- "$session" || die "the session module was not restored"
  [ "$status" = 0 ] || die "without the patch, a wallet profile did not throw in the app's proxy"
  grep -qE '^\s+3 passed' "$log" || die "the control did not run its three profiles"
  echo "control: without the register import add-to-wallet throws in the app's proxy on all three profiles"
}

phase_contracts() {
  local pin
  forge_prep
  (
    cd "$repo/contracts/bridge/evm"
    forge test --no-match-contract Fork
    forge snapshot --match-test test_gas_ --no-match-contract Fork --check --tolerance 2
    [ "$(halmos --version 2>&1 | tail -1)" = "halmos $(cat halmos.version)" ] || die "halmos is not $(cat halmos.version)"
    forge build --ast --force
    halmos --match-contract '^Formal' 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g' >"$report/halmos.log"
  )
  bash "$here/halmos-proofs.sh" "$report/halmos.log"
  (cd "$repo" && bun run --cwd packages/bridge-core test -- factory-abi router-abi quoter-abi)
  pin=$(aztec_pin keystone)
  (cd "$repo/contracts/bridge/aztec/keystone" && PATH="$HOME/.aztec/versions/$pin/bin:$PATH" aztec-nargo test --force)
  pin=$(aztec_pin token_bridge_hub)
  (
    cd "$repo/contracts/bridge/aztec/token_bridge_hub"
    PATH="$HOME/.aztec/versions/$pin/bin:$PATH" aztec-nargo test --force keystone 2>&1 | tee "$report/hub-keystone.log"
  )
  grep -qE "[1-9][0-9]* tests? passed" "$report/hub-keystone.log" || die "the hub keystone suite ran no test"
  (cd "$repo" && AZTEC_HOME="$HOME/.aztec/versions/$pin" bash contracts/bridge/aztec/scripts/compile.sh --check token_bridge_hub)
  (cd "$repo" && AZTEC_HOME="$HOME/.aztec/versions/$pin" bash contracts/bridge/aztec/scripts/run-txe-tests.sh --crate token_bridge_hub)
  (cd "$repo" && PATH="$HOME/.aztec/versions/$(bridge_core_pin)/bin:$PATH" bun run --cwd packages/bridge-core test:integration)
  (cd "$repo" && bash contracts/bridge/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/bridge/aztec/scripts/check-sole-consumer.sh)
}

phase_history() {
  [ -z "$(git -C "$repo" status --porcelain -- apps/tools/tests)" ] || die "apps/tools/tests has uncommitted changes"
  [ "$(git -C "$repo" rev-parse "$base^{commit}")" != "$(git -C "$repo" rev-parse HEAD)" ] ||
    die "HEAD is $base itself; set REHEARSE_BASE to the import HEAD should be compared with"
  # The e2e specs may differ from the import only in specifiers: undoing the renames and formatting
  # both sides must give identical text, so a changed literal or statement cannot hide in a reflow.
  (cd "$repo" && BASE=$base bun -e '
    const run = (cmd, input) => {
      const r = Bun.spawnSync(cmd, { stdin: input === undefined ? "ignore" : new Blob([input]) })
      if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} exited ${r.exitCode}`)
      return r.stdout.toString()
    }
    // Biome formats only these; any other file must match exactly once the renames are undone.
    const formats = /\.(?:[cm]?[jt]sx?|jsonc?|css)$/
    const format = (file, text) =>
      formats.test(file) ? run(["node_modules/.bin/biome", "format", `--stdin-file-path=${file}`], text) : text
    const unrename = (text) => text.replaceAll("@unleashed/", "@nulo/").replaceAll("@alejoamiras/nulo-", "@nulo/")
    const base = process.env.BASE
    const changed = run(["git", "diff", "--name-only", base, "HEAD", "--", "apps/tools/tests"]).split("\n").filter(Boolean)
    const bad = changed.filter((f) => format(f, run(["git", "show", `${base}:${f}`])) !== format(f, unrename(run(["git", "show", `HEAD:${f}`]))))
    if (bad.length) { console.error("changed beyond specifiers:", bad); process.exit(1) }
    console.log(`history: ${changed.length} spec file(s) differ from ${base} only in specifiers`)
  ')
  # Captured first: under pipefail, `grep -q` exiting on its match can SIGPIPE git log into a false failure.
  local renames
  renames=$(git -C "$repo" log --follow --name-status --format= -- apps/tools/src/main.ts)
  grep -q "packages/faucet/src/main.ts" <<<"$renames" ||
    die "apps/tools/src/main.ts does not follow back to packages/faucet"
  echo "history: apps/tools/src/main.ts follows back to packages/faucet"
}

# The workspace commits are new content too: the same audit, over main and the rehearsal branch.
phase_audit() {
  mkdir -p "$report/workspace"
  python3 "$here/audit.py" "$repo" "$report/workspace" "$here/audit-allowlist.txt" "$here/audit-allowlist-workspace.txt"
  python3 "$here/upstream-scan.py" "$repo"
}

for phase in "$@"; do
  declare -F "phase_$phase" >/dev/null || die "unknown phase $phase (phases: ${PHASES[*]})"
  echo "rehearse: $phase"
  # A function called from a condition runs with errexit off, so each phase gets its own shell.
  set +e
  (set -e; "phase_$phase") 2>&1 | tee "$report/rehearse-$phase.log"
  statuses=("${PIPESTATUS[@]}")
  set -e
  [ "${statuses[1]}" -eq 0 ] || die "$phase: could not write $report/rehearse-$phase.log"
  [ "${statuses[0]}" -eq 0 ] || die "$phase failed (${statuses[0]}); see $report/rehearse-$phase.log"
done
echo "rehearse: all requested phases passed"
