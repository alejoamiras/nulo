# Phase 3 — Q20: single-own the CAIP runtime helpers

Branch `refactor/q20-caip-single-owner` off `dev` (5472733, post-Q16). Developed in
parallel with Q22 (#108, network re-run in flight) — zero file overlap (caip vs wallet-core).

## Re-verified vs current dev (stale-snapshot guard + audit corrections)
- The 4 duplicated functions are **byte-identical** in both copies: `formatCaipChain`,
  `formatCaipAccount`, `parseCaipAccount`, `resolveNetworkByChainId` (generic `<TNetwork>`).
- The bridge **already** exposes them publicly: `wallet-bridge/src/index.ts:13` is `export * from "./caip"`.
- Types already flow downward: `dapp-interaction/spec` imports `CaipChain`/`CaipAccount` from
  `@nulo/wallet-bridge`. Confirms D8 ("types already bridge-owned; dedup the FUNCTIONS only").
- No "Used by: dispatcher" header in either `caip.ts` (the original plan's instruction was wrong — D8).
- Extension extras to preserve: `parseCaipChain` (CAIP-2, no bridge counterpart) + `AZTEC_NAMESPACE`
  (bridge's is a private const, not re-exported). Kept local.

## What shipped
- Extension `caip.ts`: now `export { formatCaipAccount, formatCaipChain, parseCaipAccount, resolveNetworkByChainId } from "@nulo/wallet-bridge"` + local `AZTEC_NAMESPACE` + `parseCaipChain`. Dropped the now-unused `CaipChain`/`CaipAccount` type import.
- All 8 consumers (`@/wallet/utils/caip` importers: connected-apps, capabilities/AccountSelectRow, execute, verify, dapp-interaction, fpc, queued-journal) import only from the 6 preserved symbols → unbroken.
- `getNetworks(chainId?: number)` structurally satisfies the bridge's `NetworksQuery<TNetwork>` (optional arg assignable to required) → `resolveNetworkByChainId` re-export typechecks for extension callers.
- **Parity test** (D8) in `caip.test.ts`: reference-identity (`extCaip.fn === bridgeCaip.fn`) — the strongest single-owner guard, a divergent local re-copy breaks it — plus a fixed-vector output check.

## Gate result (local)
| Check | Exit | Result |
|---|---|---|
| wallet-bridge typecheck | 0 | clean (owner unchanged) |
| wallet-bridge test | 0 | 3 files / 149 tests |
| extension `caip.test.ts` | 0 | 19/19 (17 original + 2 parity) |
| extension typecheck (vue-tsc) | 0 | re-export + generic compat clean |
| lint (repo) | 0 | Q20 files clean (53 pre-existing warnings unrelated) |

Network-e2e: NOT gated (pure CAIP functions, pinned by caip.test.ts + parity). Auto-merge on Quality green.
Caveat (D14): may auto-trigger network-e2e via the `wallet-bridge/**`/paths-filter — advisory, doesn't block.

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-3.md
