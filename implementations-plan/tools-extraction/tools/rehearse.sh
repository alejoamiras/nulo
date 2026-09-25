#!/usr/bin/env bash
# R, the local rehearsal: applies B1's changes to an extract.sh output on a throwaway branch, installs
# the staged 0.1.0 tarballs as file: dependencies, and runs R's validation gate phase by phase.
# Nothing is published, pushed or deployed.
#
#   rehearse.sh <workdir> <tgz-dir> [phase ...]
#
# <workdir> is extract.sh's output; <tgz-dir> holds the three packed tarballs. Phases run in order,
# each logging to <workdir>/report/rehearse-<phase>.log; name phases to resume from a failure.
# Toolchains: Foundry from $FOUNDRY_BIN, halmos from $EXTRACTION_TOOLS, Aztec CLIs under ~/.aztec/versions.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
PHASES=(prepare preinstall install fast identity tools e2e contracts history)

die() {
  echo "rehearse: $*" >&2
  exit 1
}

[ $# -ge 2 ] || die "usage: rehearse.sh <workdir> <tgz-dir> [phase ...]"
work=$(cd "$1" && pwd)
tgz=$(cd "$2" && pwd)
shift 2
[ $# -gt 0 ] || set -- "${PHASES[@]}"
repo=$work/unleashed
report=$work/report
export PATH="${FOUNDRY_BIN:-$HOME/.cache/unleashed-rehearsal/foundry/bin}:${EXTRACTION_TOOLS:-$HOME/.local/share/extraction-tools/bin}:$PATH"

tarball() {
  local found=("$tgz"/alejoamiras-nulo-"$1"-0.1.0.tgz)
  [ -f "${found[0]}" ] || die "missing the $1 tarball in $tgz"
  echo "${found[0]}"
}

# The Aztec line a crate's Nargo.toml pins, as _bridge-contracts.yml resolves it.
aztec_pin() {
  sed -n 's/.*aztec-packages\/".*tag = "v\([^"]*\)".*/\1/p' "$repo/contracts/bridge/aztec/$1/Nargo.toml" | head -1
}

phase_prepare() {
  # Always from the audited main, so a failed prepare can simply be re-run.
  git -C "$repo" switch -q -f main
  git -C "$repo" clean -q -fdx
  git -C "$repo" branch -q -D rehearsal 2>/dev/null || true
  git -C "$repo" switch -q -c rehearsal
  bun "$here/design.ts" "$work/freeze" "$repo"
  git -C "$repo" add -A
  bun "$here/codemod.ts" "$repo" \
    "wallet-crypto=file:$(tarball wallet-crypto)" \
    "resolve-asset=file:$(tarball resolve-asset)" \
    "wallet-sdk-schema-patch=file:$(tarball wallet-sdk-schema-patch)"
  # Seeding nulo's lockfile keeps every shared dependency at the version nulo's gates ran against.
  cp "$work/freeze/bun.lock" "$repo/bun.lock"
  git -C "$repo" add -A
  git -C "$repo" -c commit.gpgsign=false commit -q --no-verify -m "rehearsal: design package, codemod, tarball dependencies"
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

phase_install() {
  # The longer specifiers push some lines past the formatter's width; B1 reformats after the codemod.
  (cd "$repo" && bun install && bun run format)
  git -C "$repo" add -A
  git -C "$repo" -c commit.gpgsign=false commit -q --no-verify -m "rehearsal: lockfile, reformat"
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
  ')
  (cd "$repo" && bun run --cwd apps/tools build:testnet)
  local method
  for method in registerToken isTokenRegistered grantPublicAuthwit; do
    grep -rqF -- "$method" "$repo/apps/tools/dist/assets" || die "the production bundle lost the schema patch's $method"
  done
  echo "identity: the production bundle carries all three patched methods"
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
    [ -d lib/forge-std ] || forge install \
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

phase_e2e() {
  forge_prep
  # A host-wide browser store may be read-only and hold other revisions; the install then hangs.
  export PLAYWRIGHT_BROWSERS_PATH=${REHEARSAL_BROWSERS:-$HOME/.cache/ms-playwright}
  (cd "$repo" && apps/tools/node_modules/.bin/playwright install chromium)
  (cd "$repo" && PATH="$HOME/.aztec/versions/$(bridge_core_pin)/bin:$PATH" bun run e2e:tools)
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
  # The e2e specs may change in their specifiers and in the formatter's reflow of them, nothing else.
  (cd "$repo" && bun -e '
    const git = (...args) => Bun.spawnSync(["git", ...args]).stdout.toString()
    const norm = (text) =>
      text.replaceAll("@unleashed/", "@nulo/").replaceAll("@alejoamiras/nulo-", "@nulo/").replace(/,(\s*[}\])])/g, "$1").replace(/\s+/g, "")
    const changed = git("diff", "--name-only", "main", "--", "apps/tools/tests").split("\n").filter(Boolean)
    const bad = changed.filter((f) => norm(git("show", `main:${f}`)) !== norm(git("show", `HEAD:${f}`)))
    if (bad.length) { console.error("changed beyond specifiers:", bad); process.exit(1) }
    console.log(`history: ${changed.length} spec file(s) differ only in specifiers and their reflow`)
  ')
  git -C "$repo" log --follow --format=%H -- apps/tools/src/main.ts | tail -1 >"$report/main-ts-root.txt"
  git -C "$repo" log --follow --name-status --format= -- apps/tools/src/main.ts | grep -q "packages/faucet/src/main.ts" ||
    die "apps/tools/src/main.ts does not follow back to packages/faucet"
  echo "history: specifier-only test diff; main.ts reaches the packages/faucet era"
}

for phase in "$@"; do
  declare -F "phase_$phase" >/dev/null || die "unknown phase $phase (phases: ${PHASES[*]})"
  echo "rehearse: $phase"
  # A function called from a condition runs with errexit off, so each phase gets its own shell.
  set +e
  (set -e; "phase_$phase") > >(tee "$report/rehearse-$phase.log") 2>&1
  status=$?
  set -e
  [ "$status" -eq 0 ] || die "$phase failed ($status); see $report/rehearse-$phase.log"
done
echo "rehearse: all requested phases passed"
