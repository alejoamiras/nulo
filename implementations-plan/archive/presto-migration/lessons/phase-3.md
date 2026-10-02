# Phase 3 — CI headless Presto + CI docs (2026-09-15)

## What landed

- `.github/actions/setup-presto-server/action.yml` replaces `setup-accelerator-server`: two required pins (tarball + extracted binary), the upstream `.sha256` sidecar compared as a transfer check only, `tar -tvf` must list exactly one member of type `-` named `presto-server`, only that member is extracted, and on every run (cache hits included) the bin dir must hold exactly one regular non-link file whose sha256 equals the binary pin before `chmod +x` / PATH.
- `_extension-network-e2e.yml`: `disable_presto` input; `VITE_NULO_PRESTO_REQUIRED=1` only when neither `disable_presto` nor `proverless`; `RUST_LOG=info PRESTO_ALLOW_ALL=1 nohup presto-server` (HTTP-only `127.0.0.1:59833`, allow-all scoped to the runner process), health poll on `/tmp/presto-health.json` requiring `bb_available == true`, the activity step greps `Received /prove request` / `Proving succeeded` and prints `PROVE_SUCCESS=<n>` (fails the `canary` shard on 0), teardown `pkill -TERM presto-server`, both log + health JSON uploaded as artifacts.
- `pr-extension-network-e2e.yml` (paths-filter on the new action dir; `disable_presto` from the dispatch input or `vars.NULO_E2E_DISABLE_PRESTO`), `extension-network-e2e-soak.yml` (input passthrough), `nightly.yml`, `_lint-and-typecheck.yml`, `_build-extension.yml` (marker list), `.github/README.md`. A1: the old `NULO_E2E_DISABLE_ACCELERATOR` variable was never set on the repo, so the rename needed no migration.
- Docs: `CI.md` "Presto in CI", `SECURITY.md` "Binary dependencies", `apps/extension/tests/e2e/README.md` "Presto: local vs CI", the `e2e-testing` and `aztec-update` skills.

## Pins (presto-server 1.1.1, `alejoamiras/presto` release `presto-v1.1.1`)

| artifact | sha256 |
|---|---|
| `presto-server-1.1.1-linux-x86_64.tar.gz` | `48f524b159fe84947f767ca2903e06c82eb555eec99ab46052cb3d92bd1b33ef` |
| upstream `.sha256` sidecar | same value — matched |
| extracted `presto-server` (the only member, type `-`) | `7c866bac4023d480de7a0d6a5ad2069ba23979d01fe248a780daad2f369eecdb` |

Local verification (`presto-pins.sh` in the session scratchpad): the archive lists exactly one member; both hashes computed independently of CI, then reproduced by the action's own verify steps in the run below.

## Gate

| layer | command | result |
|---|---|---|
| actions lint | `bun run lint:actions` | exit 0 |
| ci-gating unit | `bun run test:ci-gating` | green (aggregator pin `extension-network-e2e-status` unchanged) |
| lint | `bun run lint` | exit 0 |
| brand guard | `bash scripts/check-no-brand.sh` | ok |
| push | `git push -u origin worktree-presto-migration` | `2bcca329` |
| soak (prover-ON) | `gh workflow run extension-network-e2e-soak.yml --ref worktree-presto-migration -f mode=files -f test_files="tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/frozen-account-canary.test.ts" -f repeats=1 -f proverless=false -f disable_presto=false` | run 34978310183 — **success** (`iter 1 / Aztec agent` 13:56:51Z → 14:01:32Z; `Status` success) |

Soak log evidence (verbatim lines from run 34978310183):

```
Tarball SHA-256 verified: 48f524b159fe84947f767ca2903e06c82eb555eec99ab46052cb3d92bd1b33ef
Binary SHA-256 verified: 7c866bac4023d480de7a0d6a5ad2069ba23979d01fe248a780daad2f369eecdb
Presto ready: {"api_version":1,"available_versions":["unknown"],"aztec_version":"unknown","bb_available":true,"schemes":["chonk","ultra_honk"],"status":"ok","version":"1.1.1","versions":[{"aztec_version":"unknown","bb_version":"unknown"}]}
[e2e:agent] bundle contains NULO_PRESTO_REQUIRED_BUILD_STAMP ✓
Test Files  2 passed (2)
     Tests  3 passed (3)
PROVE_SUCCESS=4
Cache saved with key: Linux-presto-server-1.1.1-7c866bac4023d480de7a0d6a5ad2069ba23979d01fe248a780daad2f369eecdb
```

Both selected tests ran under required mode: any fallback-class phase (`fallback`, `denied`, `secure-connection-unavailable`, `version-mismatch`) throws `[presto-required]` in that build, so a green run with `PROVE_SUCCESS=4` is four native proofs, not a WASM pass.

## Observation — the headless health body reports `"unknown"` versions

On the CI runner the health body carries `available_versions: ["unknown"]` and `aztec_version: "unknown"` with `bb_available: true`. The aztec agent setup puts a `bb` on PATH and presto-server 1.1.1's `find_bb` resolves it outside its versioned cache, so it cannot name a version. Consequences:

- The SDK's `needsDownload = !available_versions.includes("5.2.0")` is `true` in CI, so `assertPrestoReady` logs its needs-download warning at each runtime build. It is a warning by design (P2) and proving proceeds natively; the run above proves the path.
- The P4 CI assertion (`data-backend="presto"`) keys on the SDK's `transmit` phase, which fires on the native path regardless of the version fields, so the "unknown" body does not affect it.
- Nothing to fix in this repo: the body is the server's, and the pins are exact. Worth remembering when reading the `[presto-required]` warnings in CI logs.

## Notes

- The soak was dispatched with `disable_presto=false` explicitly; the input's default is also `false`.
- The `Cache saved` line confirms the first run populated the `presto-server` cache under the version + binary-pin key; the next run restores it and still re-hashes the binary.
