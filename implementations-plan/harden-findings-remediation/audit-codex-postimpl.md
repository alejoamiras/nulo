# Post-implementation codex audit (xhigh) — fix/harden-findings

Ran `codex exec -s read-only -c model_reasoning_effort=xhigh` over the full `fix/harden-findings` vs `origin/dev` diff (all 11 units + the 5-lens code-review fixes), asking for adversarial + completeness + regression + crypto/least-privilege review. Codex confirmed **crypto L/I sound** and surfaced **two findings** — both rooted in the SAME pre-existing lossy chain-identity representation.

## Findings (verbatim, condensed)

### HIGH — `packages/aztec-runtime/src/utils/chain-identity.ts:53` / `apps/extension/src/wallet/services/network/spec.ts:27`
Chain identity is validated and session-scoped by `(l1ChainId ^ rollupVersion) >>> 0` (a **lossy XOR composite**), not by the exact signing-domain tuple. An attacker-controlled/drifted RPC can return a **different** `(l1ChainId, rollupVersion)` tuple whose XOR **collides** with the stored composite:
- configured node `(11155111, 1)` → stored `chainId = 11155110`
- malicious `getNodeInfo()` later returns `(11155110, 0)` → `11155110 ^ 0 = 11155110` → `assertLiveChainIdentity` **passes**
- but `chainInfoFrom(nodeInfo)` commits the **spoofed** `{chainId: 11155110, version: 0}` into signing/authwit.

Collision is trivial to construct: `(a, b)` and `(a^k, b^k)` share a XOR for any `k`. Dapp-session scoping (also keyed on the composite) has the same collision risk. → the F-03 check catches composite-*changing* drift but misses composite-*preserving* drift.

**Codex's proposed fix:** persist + compare exact `l1ChainId` and `rollupVersion` everywhere security decisions are made; migrate session/network keys away from the XOR (re-consent ambiguous old grants).

### MEDIUM — `apps/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:439`
`runSlowArm` re-fetches `node.getNodeInfo()` and passes it into `buildTxExecutionRequest` **without** `assertLiveChainIdentity`. Codex: "I did not find a dApp-facing route to this helper, so I would not rank it high." Verified: it's a **simulation-only** path (`pxe.simulateTx({simulatePublic:true})`, never broadcast) — the spoofed identity skews an internal balance/gas projection, not a broadcast tx. Consistent with the internal storage/config reviewer's "read-only, not trust-load-bearing" verdict.

**Codex's proposed fix:** thread a previously-validated `chainInfo` into `runSlowArm`, or validate the fetched `nodeInfo` before use.

## Root cause + blast radius
Both stem from the **pre-existing** `Network.chainId` representation (`network/spec.ts:22-28`) being the XOR composite. The exact `(l1ChainId, rollupVersion)` tuple is **discarded at enrollment** — only the composite is stored, keyed on throughout the network layer (dedup / `DUPLICATE_CHAIN`, per-`(profileId,chainId)` purge, `onChainPurged`) AND dapp-session scoping. Unit C (F-03) added `assertLiveChainIdentity` *on top of* this lossy representation; it did not introduce the composite.

**There is no purely-local fix:** the enrollment-time exact tuple is gone, so exact comparison REQUIRES storing the tuple → a schema change that ripples into network keying + dapp-session scoping + a migration/re-consent.

## Decision: SURFACE AND HOLD (per the campaign's hard limits)
- This is an **emergent 15th finding**, not one of the original 14 the campaign scoped.
- The proper fix is a **cross-cutting network-schema change** (store/compare the exact tuple, re-key dapp-session scoping, migration) — **beyond Unit C's plan.md scope** ("required chainInfo param + re-fetch deleted") and beyond the campaign's no-schema-migration posture (cf. F-11 option (a)).
- The remediation `/goal`'s hard limits are explicit: *never expand scope beyond plan.md; if a decision needs crossing one, surface and hold.* A schema migration is unambiguous scope expansion.
- ⇒ **NOT auto-remediated.** Surfaced here + in the promote-PR body + the wrap-up for a scoping decision. The promote PR is opened but **held** (not merged) so the user decides at merge time: (a) spin a scoped follow-up plan to harden the chain-identity representation before merging, or (b) accept the residual (F-03 remains partially effective — catches the common drift, misses the XOR collision) and ship, tracking the follow-up.

## Recommended follow-up (NEW plan, when scoped)
1. Add optional `l1ChainId?` + `rollupVersion?` to the `Network` record (additive, non-destructive — mirrors the `Session.lockedAt` additive-optional pattern; NO version bump). Capture both at enrollment (the probe already fetches them before discarding into the XOR).
2. `assertLiveChainIdentity`: compare the **exact tuple** when the network carries it; fall back to the composite for legacy records (closes the collision for all networks enrolled after the change).
3. Re-key dapp-session scoping off the composite (the harder, migration-bearing half — needs its own design + re-consent story).
4. Then thread a validated `chainInfo` into `runSlowArm` (the MEDIUM) — trivial once the exact-tuple check exists.

## Sound (codex-confirmed)
Crypto L (`SessionSecretBox`: random token+salt, HKDF domain separation, AES-GCM 12-byte IV, AAD=profile.id, version check, null-on-failure unwrap; leak-of-both-token-and-wrapped still recovers the secret = intended bearer model) and I (DappSession MAC: HMAC domain-separated from the profile master secret, verifies full canonical rows excluding `mac`, no forged-row acceptance path). No high/critical in A/B/D/E/F/G/J/K/L beyond the above.
