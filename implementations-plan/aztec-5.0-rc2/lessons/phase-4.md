# Phase 4 ✓ — PR + post-impl audit + network-e2e

**FINAL: all 3 required checks GREEN on the final head (`dfe996e`)** — `quality-status` ✓ · `smoke-e2e-status` ✓ · **`network-e2e-status` ✓ twice** (pre-fix head `901a34f` AND the post-audit-fix head): the native-proving suite proves rc.2 txs end-to-end, with the v1.0.6 accelerator binary unbumped (bb injected per the SDK version, as the corrected Fact predicted).

## PR #248 (labels `e2e:network` + `e2e:smoke`)
- First push produced **zero CI runs** — the PR was `CONFLICTING` (dev advanced with the v0.24.0-rc.0 release arc), and GitHub doesn't build the `pull_request` merge ref for conflicting PRs → no workflows fire at all. Lesson: **a silent no-CI PR = check `mergeable` first.** Resolved by merging dev in (one trivial `implementations-plan/index.md` conflict, `901a34f`).
- On the mergeable head: **all 3 required checks GREEN** — `quality-status` ✓ `smoke-e2e-status` ✓ **`network-e2e-status` ✓ (the native-proving suite against rc.2 — the protocol proof)**.

## Post-impl codex audit (`019f23b0`) — reject → all findings fixed same-session (`631a9da`)
1. **HIGH:** v9's wipe missed EntityStorage `<root>@<id>` rows (a latent v8 gap — ghost pending txs could reload). Fixed: 6 chain-coupled `@`-prefixes added to the wipe list (verified against the live `new EntityStorage(` root inventory); `contacts@` deliberately preserved (user-authored, v8 parity).
2. **MED/HIGH:** the promoted manifest carried the DEAD rollup's `l1.fuel.feeJuicePortal` (the fuel-carry copied it verbatim; masked because forge had already Etherscan-verified the router → verify-l1 skipped its reconstruct). Fixed: manifests re-pointed + the writer now refreshes the field from `nodeL1Addresses()` (rollup-coupled ⇒ never carried); `verify-l1` re-run — 4/4 verified.
3. **LOW:** `DeployFuelLive.s.sol` + fork test defaulted to the old AZLO (a future no-env rerun would seed the dead pool). Fixed: constants → the live token.

Gates on the fixes: typecheck 0 · bridge-core 129 · extension 2637 · lint 0. CI re-running on the final head; Phase 4 ✓ when the 3 required checks re-green there.

## Also in this phase
- Storage **v9** (CURRENT_VERSION 8→9, document-the-reset) + the ARCHITECTURE.md migration paragraph rewrite.
- Stale rc.1 comment sweep (`_network-e2e.yml`, the 3 `nulo-schema-patch.ts` copies); historical rc.1 mentions (bunfig, migrate v8 doc) deliberately kept.
- The final goal gates in-transcript: `typecheck:all` 0 · `test:all` 0 (2637/423/129) · `lint` 0.
