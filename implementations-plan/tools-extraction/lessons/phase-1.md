# Stage 1 — nulo wallet-only (A1, F0, A5a, A5b)

## F0 — recorded baseline (2026-09-24)

Both suites dispatched on `dev` at `5ee1d77a5716e58e90a3093abcbedba8b642b6a9`, both **green**:

- `bridge-contracts.yml` — run 36034918254 (`https://github.com/alejoamiras/nulo/actions/runs/36034918254`), success.
- `pr-tools-e2e.yml` — run 36034921684 (`https://github.com/alejoamiras/nulo/actions/runs/36034921684`), success.

Re-dispatch if the extracted paths, a shared package, `bun.lock`, `patches/` or either suite's harness changes on `dev` before A5a merges.

Owner steps (pause both tools Pages projects, delete the tools deploy hooks and their secrets, note the serving deployment ids): pending.

## Recon (ultracode workflow `stage1-recon`)

Seven read-only mappers + a completeness critic re-derived every Stage 1 edit against `dev` 55 commits past the draft base. Findings that changed the plan:

- The wallet's bridged-USDC seeds (`default-tokens.ts`, `price-map.ts`) are the retired single-token bridge's L2 tokens; #539 removed them from both manifests. § 8's "the wallet mirrors `tokens[].l2Token`" was false — the plan now says so, and comments state the fact.
- Bun 1.4.2 `--frozen-lockfile` passes a lock that still lists a workspace missing on disk (pruned checkout), so N5a's gate now checks the lock was actually regenerated.
- `.githooks/pre-commit` runs `scripts/check-no-local-paths.sh` (paths only); `check-no-brand.sh` is gone, so unleashed's brand check is a new guard.
- The Firefox e2e filter twins are pinned by exact equality to their Chrome twins (`behavior-gating.test.ts`), so A1 edits all four in one commit.
- `renovate.json`'s foundry hold and the `apps/extension/src/utils/chain-ids.ts` comment were bridge residue no earlier list named.

## A1

- **Min-age re-gate on a manifest edit.** Dropping `@nulo/bridge-core` from `apps/extension/package.json` made a plain `bun install` re-gate `@alejoamiras/presto{,-core,-banners}` (younger than 7 days, already locked) and fail. Resolved the documented way: an uncommitted local `minimumReleaseAgeExcludes` for the three names, `bun install`, then the exclude removed (bunfig restored from a scratch copy) and `bun install --frozen-lockfile` re-run clean. The lock diff: the extension's bridge-core line, plus its stale `0.27.0` version label synced to `0.28.0`.
- **Trimmed, not verbatim.** The wallet uses only `predictedWorstMinFees` + `MinFeeNode`; the other nine exports are bridge-only and would be dead in aztec-runtime once A5a lands, and the verbatim copy carried workflow-reference comments. bridge-core keeps its full copy until A5a.
- **PrivateFPC pin location.** aztec-runtime can hash but cannot import the wallet's params, and the network e2e fixtures compute their own instance, so the pin is an extension unit test under `// @vitest-environment node` (bb.js poseidon2 throws `std::bad_cast` under jsdom), deriving through the same `protocol-fpcs.ts` helpers the service calls.
- **Mutation proof.** Salt `new Fr(1n)` → `new Fr(2n)` in `protocol-fpcs.ts`: the pin test went red with salt `0x…02` and address `0x2d6d5a03989f02266f21d8c600d8c7c79f35baa9c7f870c82a395eb0c5d2bcef`; reverted.
- **Gates.** `lint`, `typecheck:all`, `test:all` (every workspace), `lint:actions`, `test:ci-gating` (148 pass) green at `e84607dc`.

### A1 review round 1 (2026-09-24)

- **Codex** (`/codex high`, session `01a0d49f-7f22-75b2-a8ea-21184e2a6d79`): **approve**. Confirmed the pin exercises production's derivation (both service sites call `derivePrivateFpc`; production and vitest share `artifactAliases`; debug stripping keeps the class id), `service.ts` is behavior-identical, the fee helper is executable-code identical and the five filters cover the new closure. Two P3 comment nits, both adopted: the fee docstring misdescribed the algorithm and the README's fallback clause; the FPC invariant was repeated at paragraph length.
- **Claude workflow** (5 lenses × 2 refuters, 21 agents): 8 raw findings, 4 survived. Adopted: the README "only" fallback claim (also falls back on an empty prediction); the docstring cited `@aztec/wallets` for `getMinFees` (it lives in `@aztec/wallet-sdk`) and described upstream's single-slot pick, not our per-component max; the PrivateFPC params and artifact were exported only for a control test that exercised Aztec's hash, not the wallet — the control test is gone (the manual mutation covers it) and the module now exports only the two derive helpers and `ProtocolFpc`. Refuted by both skeptics: exported params as a fund-safety hole, `audit:vue` not running the fee test, an unreachable `if (!first)` guard (a type-narrowing guard, kept verbatim).
- Salt mutation re-run after the fix: still red with `0x2d6d…bcef`.
