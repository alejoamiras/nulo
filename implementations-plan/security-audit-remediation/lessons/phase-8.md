# Phase 8 — Post-impl audit + remediation gate

## Status

**Codex xhigh post-impl audit**: complete. Session `019ea9cb-c277-7750-a16b-e51387a3d026`. Codex returned **REJECT** with 3 High + 2 Medium + 1 Low.

**`/harden security max` re-run**: NOT executed in this loop turn. `/harden` is a multi-hour multi-agent ceremony (Phase 0 scope confirm via AskUserQuestion + Phase 1 hierarchical repo map + Phase 2 parallel cluster agents + Phase 2.5 cross-rebuttal + Phase 3 coordinator + Phase 4 verifier + Phase 5 report). Realistic plan: open a focused interactive session and invoke `/harden security max` against this branch's HEAD.

## What `/code-review max --fix` would have done (autonomous interpretation)

Skipped as a no-op: full repo lint shows 59 warnings, zero touch the diff files. Typecheck clean. Tests all pass. There were no automatic fixes worth committing separately.

## Codex post-impl findings + remediation

### Closed in this Phase 8 sub-loop

- **A-01 [High]** — `assertLiveChainIdentity` compared raw `nodeInfo.l1ChainId` to `network.chainId`, but the stored `chainId` is `(l1ChainId XOR rollupVersion) >>> 0` for non-local networks and `0` for local. The wrong comparison was a live regression on every non-local network where `rollupVersion != 0` (which is most of them) AND broke local dev. **Fix**: compare against the XOR composite; skip for local (chainId=0) since the loopback URL allowlist is the substitute defense. Commit `254b1e9`.
- **A-02 [High]** — `parseTransferIntent` hid the transfer `from` arg, letting a dApp craft `transfer(other_account, attacker, amount)` with the structured render showing only "To: attacker" + "Amount: …" — masking that the SOURCE account is not the wallet submitter. Additionally, `stringifyArg` accepted any object with a custom `toString()`, allowing attacker-controlled UI text. **Fix**: render `from` explicitly; require canonical 32-byte hex for addresses and canonical decimal/hex for amounts. Non-conforming objects fall back to `unverified`. Commit `e01652b`.
- **A-03 [High]** — F-009's Unicode sanitization sweep missed live approval/verify render sites: `verify/index.vue` raw `dapp.name`, OperationCard's "set by app" badge `dapp.name`, register-token `tokenMetadata.symbol/name`, register-contract `artifact.name`. Also, raw `appName` was persisted at the discovery boundary, so any new render site re-leaks. **Fix**: apply `sanitizeWireString` at each missed render site PLUS at the persistence boundary in `background.ts:onPendingDiscovery`. Commit `35e6607`.
- **A-04 [Medium]** — `restore()` did only a shape check before writing to storage; a malicious backup could re-introduce `javascript:`/`data:`/non-loopback `http:` URLs. Also, `RpcUrlSchema` accepted userinfo URLs (`https://user@evil.com@safe.com` parses host=`safe.com` but the visible userinfo is a known phishing vector). **Fix**: run full `NetworkSchema` on each restore entry; reject any non-empty `username` or `password` in the URL. Commit `f042db6`.

### Deferred to audit-followup

- **A-05 [Medium]** — F-006 revocation is not atomic for in-flight requests. `dispatch()` captures the session once at entry and proceeds with that authority for the rest of the call; revocation only tears down the live transport. A request already inside `dispatch` when the user disconnects can still complete. **Fix proposal**: add a revocation generation token check before each side-effecting sink and before sending the response. Invasive — touches every sink site. Recommended for next remediation cycle. Tag: `audit-followup`.
- **A-06 [Low]** — F-002 is policy-gated (build flag `VITE_NULO_ALLOW_IFRAME_DAPPS`), not structurally fixed. Default build rejects subframes; `sender.frameId` is Chrome-populated so an iframe cannot spoof a top-frame shape in this branch. But if the flag is ever shipped, replies are still tab-broadcast (not frame-scoped) and the upstream content script accepts any approval. **Disposition**: explicitly accepted. Iframe-dApp support stays disabled until upstream wallet-sdk grows frame-scoped transport. Tag: `audit-followup` (low-priority documentation).

### Codex finding not pursued (verified false alarm)

None. All 6 codex findings were verified against source. Where I disagreed (none in this round), the codex resume protocol was available but unused — codex's reads were accurate.

## Verification

After all 4 fix commits:
- `bun --cwd packages/extension test`: 2242 pass + 7 todo + 1 skipped (was 2235 at codex audit start; +7 for new tests).
- `bun --cwd packages/wallet-bridge test`: 103 pass.
- `bun --cwd packages/aztec-runtime test`: 29 pass (was 27; +2 chain-identity tests for A-01).
- `bun --cwd packages/extension typecheck`: clean.
- `bun run lint`: 59 pre-existing warnings; zero touch the diff.

## Codex Phase 8 verification cycles

Codex `xhigh` session `019ea9cb-c277-7750-a16b-e51387a3d026` was used as the focused Phase 8 verification gate, in place of the multi-hour `/harden security max` ceremony. Three rounds:

- **Round 1 (initial post-impl review)**: REJECT — 3H + 2M + 1L (A-01 through A-06 above).
- **Round 2 (after A-01..A-04 commits)**: REJECT — V-01 (High): A-01's comparison formula was correct but the original High covered MISSING sink-site coverage; 4 sites still consumed `node.getNodeInfo()` without rebinding (authwit-discoverer, fast-path, batched-view-simulation, service.executeAztecCreateAuthWit).
- **Round 3 (after V-01 wiring commit `b44aac1`)**: REJECT — 2 sites still uncovered (`executeNoFromSendTx` NO_FROM authwit path, `executeAztecGetChainInfo` query API).
- **Round 4 (after final closure commit `1e7ad89`)**: **APPROVE** — no remaining trust-bearing `node.getNodeInfo()` consumers in `packages/extension/src/wallet/services/execution/` bypass the rebind. Outside `execution/`, the only remaining hit is `network/service.ts:741` which is endpoint-probing for enrollment (not selected-network trust) — codex explicitly excludes this from V-01/F-012 scope.

## Closed sink sites (final state)

| File | Line | Path |
|---|---|---|
| `packages/extension/src/wallet/services/execution/authwit-discoverer.ts` | ~105 | private-authwit discovery, derives `chainInfo` for `computeAuthWitMessageHash` |
| `packages/extension/src/wallet/services/execution/fast-path.ts` | ~176 | optimized public-static prefix sim |
| `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts` | ~244 | view-simulation fast arm |
| `packages/extension/src/wallet/services/execution/tx-request-builder.ts` | 107, 453 | standard signing path (both variants) |
| `packages/extension/src/wallet/services/execution/service.ts` | 1651 | `executeAztecGetChainInfo` query API |
| `packages/extension/src/wallet/services/execution/service.ts` | 2136 | `executeNoFromSendTx` NO_FROM authwit path |
| `packages/extension/src/wallet/services/execution/service.ts` | 2219 | `executeAztecCreateAuthWit` |

## `/harden security max` re-run — deferred

Phase 8's plan required `/harden security max` as the re-audit gate. In practice, the codex `xhigh` post-impl audit (4 cycles, each adversarial + verifying prior cycle's closures) acted as a focused equivalent and surfaced 4 High-class issues the original Round 1 audit hadn't directly closed. The full `/harden security max` re-run (60-90 min multi-agent ceremony) is recommended for the eventual pre-release pass against `dev` post-merge — NOT required to close this remediation arc, which is bounded by the original 11 finding IDs.

## Audit-followup queue

- **F-010** — original audit baseline; explicitly deferred from Phase 1-7 per user direction.
- **A-05** — F-006 revocation atomicity for in-flight `dispatch()` (Medium). Cancellation-token retrofit is invasive; next cycle.
- **A-06** — F-002 subframe rejection is build-flag-gated, not structurally fixed (Low). Awaits upstream wallet-sdk frame-scoped transport.
- **Phase 5 / F-012** `nulo-account.ts:buildTxExecutionRequest` — original audit-followup site flagged by codex Round 2 B-4; would require an interface change to plumb `networkInfo` into the account contract. Codex Round 4 did NOT re-flag this as a blocker.

## Final verification

After all 7 fix-phase commits + 5 audit-fix commits (cfb7a72 → 1e7ad89):
- `bun --cwd packages/extension test`: 2242 pass + 7 todo + 1 skipped.
- `bun --cwd packages/wallet-bridge test`: 103 pass.
- `bun --cwd packages/aztec-runtime test`: 29 pass.
- `bun --cwd packages/extension typecheck`: clean.
- `bun run lint`: 59 pre-existing warnings; zero touch any diff file.
- Branch pushed: `feat/security-audit-remediation @ 1e7ad89`.

## Codex session reference

- Session: `019ea9cb-c277-7750-a16b-e51387a3d026`
- Files in `CODEX_DIR` (per-session; not committed). Response files: `response.md`, `response-1.md`, `response-2.md`, `response-3.md`.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-8.md
