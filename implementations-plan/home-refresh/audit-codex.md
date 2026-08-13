# Codex plan audit — home-refresh (light tier)

Session: gpt-5.6-sol @ xhigh, read-only sandbox, 2026-08-13. Prompt: full audit packet
(adversarial/security + assumption-attack + implementation-critique + recon reuse-map check).
Paths rewritten repo-relative for commit. Round 2 (resumed re-review of the revised plan) appended below.

## Round 1 response (verbatim, paths rewritten)

## Blocking findings

- **Facts — lag is computed from the wrong datum.** `PublicEventCursor.blockNumber` is the last returned public log, not contiguous scan coverage ([public-events.ts](packages/aztec-runtime/src/pxe/public-events.ts:51)). A quiet token can repeatedly scan successfully while its cursor remains null or ancient. One subsequent dropped/RPC-error pass becomes `backfilling` with an enormous `blocksBehind`, violating “RPC blips never show it.” The existing quiet-token regression test already models this exact condition ([service.scenarios.test.ts](apps/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:3528)). The plan needs a real coverage watermark—probably last successfully covered checkpoint—not the log cursor, plus a quiet-token→transient-failure test.

- **Inferences — state-only dedup breaks the central feature.** The map remains frozen at the last transition; reconnect merely reads that same stale map, so the plan’s “reseed refreshes it” claim is false. A long `backfilling` episode cannot begin or stop displaying when it crosses the threshold. Always update the snapshot, and emit while backfilling when the threshold bucket changes—or emit changed lag during backfill. Test crossings in both directions and the subsequent `getSyncState` snapshot. This is necessary, not over-engineering.

- **Inferences — 25 blocks is not a defensible 15-minute conversion.** Aztec v5 supports multiple L2 blocks per slot and exposes a separate block-duration setting; official CLI documentation currently describes a 3-second default and up to 24 blocks per checkpoint ([Aztec CLI reference](https://docs.aztec.network/developers/docs/cli/aztec_cli_reference)). Slot duration therefore cannot be multiplied directly into block height. A single constant may also be wrong across mainnet, testnet, and local networks.

- **Facts — the validation gate omits the changed design-package test.** Root `bun run test` runs only the extension ([package.json](package.json:17)); neither it nor `audit:vue` executes `packages/design/src/base.css.test.ts`. Every phase touching design must run `bun run --cwd packages/design test`, and the final gate should use `bun run test:all`.

## Material findings

- **Security/adversarial:** “Worst case the dot shows” is incomplete. A malicious RPC can under-report the tip, trigger unresolved/non-standard handling, or otherwise suppress the dot, creating false reassurance about history completeness. Treat the indicator explicitly as advisory and validate/clamp non-finite, fractional, and negative inputs. No new dependency or cryptography risk exists, but a new node-derived trust signal means threat-surface delta is not zero.

- **Security/adversarial:** The clipboard E2E checks only a toast; it passes if nothing—or a truncated/wrong address—is copied. Reuse `stripWireControl`, await `writeText`, show success only after resolution, and add a component test for the exact active address plus rejection behavior. No new clipboard manifest permission should be added.

- **Facts:** `account-selector` occurs four times across three e2e files, not “three usage sites.” Repo-wide inspection found no test reading its text or assuming it wraps the address, so moving it to the name button does not break current tests. It remains a trap if treated as proof of the whole header contract.

- **Facts:** Repo-wide grep confirms exactly three `cursor: copy` declarations.

- **Inferences:** Smoke can probably drive the header popup—the header and global popup manager are mounted—but no current smoke test proves it. Avatar/name checks must be separate or explicitly close the first overlay before clicking the second.

- **Implementation:** TokensView owning the policy and TokenCard receiving a boolean is the right split. Changing the snapshot return shape is also sound because event-only data leaves initial mount blind. Tests must additionally pin tooltip copy, unknown snapshot `{state:"caught-up", blocksBehind:0}`, hostile/quiet-token lag, and threshold-crossing emissions.

- **Asks missing:** Owner must decide the authoritative, possibly per-network threshold; behavior during RPC outage versus confirmed backlog; copy-failure UX; whether seeded “dRPC” is cleared when its URL is edited; and the visual/accessibility acceptance method. The current Tooltip is hover/touch-only, so the status explanation is unavailable on keyboard focus.

## Nitpicks

Phase ordering is sensible, but Phase 4’s gate proves nothing about Header. Run its component test or targeted smoke there. Full gates also cannot prove padding, hover, focus, or reduced-motion visuals; require a focused manual/render comparison covering home, Activity, and token detail.

## Looks fine

AccountAvatar, sanitization, toast, Tooltip, icon-stub, and endpoint-label reuse are appropriate. Preserving the loading branch, adding fractional gas fixtures and BalanceView icon coverage, and surfacing shared activity-density blast radius are all correct.

reject (with blocking findings: incorrect lag source, stale state-only dedup, invalid block-time conversion, and incomplete test gates)

## Round 2 response (resumed session, revised plan; verbatim, paths rewritten)

The revised watermark is still not sound across restarts:

- `lastScanFinalized` is capped at the finalized tip ([service.ts](apps/extension/src/wallet/services/incoming-transfer/service.ts:1430)), not the checkpoint actually covered. If a scan covers checkpoint 100 while finalized is 50, restart seeds coverage at 50; the first dropped pass can falsely show a 50-block backlog. Persist a distinct coverage watermark and add this exact restart regression.
- Reconciliation leaves the old high watermark unchanged. A genuine, long reorg repair can therefore remain below threshold. While `cursor.reconciling` exists, lag should derive from its safe progress (`lowerBound - 1` / `progress`) and be tested across a mid-reconciliation restart.

Three material findings remain diluted:

- `Number.isFinite(x) && x >= threshold` accepts large fractional values despite the stated policy. Require a nonnegative safe integer.
- The shared Tooltip currently has only mouse/touch handlers ([Tooltip.vue](packages/design/src/ui/Tooltip.vue:148)). If modified for focus, add a design-package focus test and run that package in Phase 2.
- A pure helper test proves only that the helper copies its argument; it does not prove Header supplies the full `appStore.account.address`. Either make the helper own that lookup or add one narrow integration assertion—component or E2E clipboard inspection.

The remaining revisions are materially stronger and correctly adopt the earlier findings. The 120-second cadence measurement is acceptable only if raw timestamps/tips and conservative rounding are recorded; it is a thin estimate, not protocol truth.

conditional approve (with conditions: persist and reconciliation-correct the coverage watermark with restart tests; enforce safe-integer lag validation; test keyboard Tooltip focus; and prove Header passes the full active address)

## Disposition

All four round-2 conditions folded into plan.md (see its Audit log): persisted `lastCoveredBlock` uncapped by finality + restart and mid-reconciliation regression tests; `Number.isSafeInteger` lag gate; Tooltip focus trigger + design-package focus test (design tests added to the Phase 2 gate); narrow Header integration test asserting the full active address reaches the clipboard. Cadence measurement records raw tips/timestamps with conservative rounding.
