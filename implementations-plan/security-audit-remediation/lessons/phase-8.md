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

## What's left for full Phase 8 closure

1. `git push` of commits `254b1e9 35e6607 e01652b f042db6` — currently blocked by SSH/1Password.
2. Explicit `/harden security max` invocation against `feat/security-audit-remediation` HEAD. Per the plan's failure-mode definition:
   - No new H/C → arc closes.
   - New H/C BY remediation → loop back to fix phases.
   - New H/C unrelated → `audit-followup` tag, arc closes.
   - Medium/Low only → document + close arc.
3. Mark Phase 8 ✓ in `plan.md` after the `/harden` re-run report lands under `audit/security/<new-date>-max-<run-id>/`.

## Codex session reference

- Session: `019ea9cb-c277-7750-a16b-e51387a3d026`
- Files: codex output dir contains the full prompt + response.md + log.jsonl (per-session; not committed).

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-8.md
