# Audit — Harden findings remediation plan (Fable, independent adversarial review)

Reviewer: Fable 5, read-only, verified against source. Repo-relative citations. Companion to `audit-codex.md`.

## 1. ADVERSARIAL

**1a. Unit A puts the name↔selector binding in the wrong layer.** Plan Unit A step 2 says resolve the selector against the artifact inside `method-scope-checkers.ts`. That module is a synchronous leaf importing only capability types (`method-scope-checkers.ts:15-28`); `ScopeCheck` is `(args, grants) => void`. The dispatcher runs `enforceScopeWithSession` (`dispatcher.ts:320`) *before* `buildOperation` (`dispatcher.ts:370`) and has no PXE. The artifact is only resolved async in execution: `resolver.resolveArtifacts(pxe, instances)` (`tx-request-builder.ts:127`), already consulted at `:300-304` (`findFunctionBySelector`) to backfill `type`/`isStatic`. Binding "before authorization" would force scope-checks async + inject PXE into the dispatcher, enlarging the trust surface and risking the FIFO/execution-mutex contract (`dispatcher.ts:114-131,339-349`). **Correct design:** enforce `findFunctionBySelector(artifact, action.selector).name === action.name` (reject mismatch) in **execution**, which makes the existing name-based scope check sound without touching it.

**1b. Unit A is under-scoped: F-02 has three sink sites.** (i) sendTx standard `tx-request-builder.ts:294-328` (selector at :317, label `action.name` at :311, never compared). (ii) sendTx NO_FROM `:437-452`. (iii) **createAuthWit CallIntent `service.ts:657-672`** — `new FunctionCall(call.name, call.to, call.selector, …)` from wire verbatim → `computeAuthWitMessageHash` commits to selector. A dApp with `transfer@TOKEN` scope sends `{caller, call:{to:TOKEN, name:"transfer", selector:approveSelector, args}}`: scope passes on "transfer" (`method-scope-checkers.ts:281`), wallet signs an authwit over `approveSelector`. No artifact is loaded there today. Plan named only `tx-request-builder:304`.

**1c. IntentInnerHash is nearly as dangerous as a raw Fr.** `service.ts:673-679` signs `{consumer, innerHash}` with attacker-chosen `innerHash`; only `consumer` is scope-checked at wildcard function (`method-scope-checkers.ts:296-297`). Hard-reject is a capability regression for inner-hash authwit users; prefer **explicit per-request confirmation**. Faucet does not use it, so compat risk is low.

**1d. Raw-hash reject must key on structure, not primitive-sniffing.** Reuse `isCallIntent`/`isIntentInnerHash` (`method-scope-checkers.ts:239-253`); reject anything that is neither. Sniffing "is it an Fr/hex" lets an attacker wrap the hash in a minimal object. Fail closed.

**1e. Unit G regression vector.** Popup/SW senders carry `sender.id === chrome.runtime.id` with `sender.tab === undefined`; subframe logic already keys on `sender.tab !== undefined && frameId !== 0` (`content-script-validator.ts:88-90`). G must reject `sender.tab`-present senders but accept SW/popup; Firefox `sender`-shape parity is the real hazard.

**1f. Unit L "zeroize in finally" is a no-op.** `zeroize.ts:19-21` states `Fr` internals cannot be zeroed. F-11's passkey issue is exactly that HKDF output is copied into an `Fr`. The secret must be kept in a wipeable `Uint8Array` *before* Fr-wrapping — a code change, not a `finally` add.

## 2. ASSUMPTION-ATTACK

### Facts (verified)
- **F-02 is a 3-site bug:** `tx-request-builder.ts:294-328`, `:437-452`, `service.ts:657-672`.
- **Artifact NOT reachable at authorization time:** only in execution (`tx-request-builder.ts:127`); `service.ts:657-672` loads none; scope-checker is a synchronous leaf; dispatcher has no PXE.
- **AES-GCM/PBKDF2 core sound:** random 12-byte IV, 600k PBKDF2, GCM (`encryption-key.ts:11-47`). Bearer = unsalted `SHA-256(password)` (`encryption-key.ts:97-100`) via `Sealed.passhash` (`password-secret-box.ts:80-85`), consumed by silent restore (`password-secret-box.ts:122`; `session-manager.ts:387`).
- **Storage bump mechanical:** `migrate.ts:54` (`CURRENT_VERSION=9`), wipe-on-mismatch `:110-149`.
- **canCreateAuthWit UI-invisible:** `build-items.ts:36` `if (cap.type === "accounts") continue`. `build-items.ts`/`AccountSelectRow.vue` are in NEITHER Unit A's nor B's file list — the F-01 UI surfacing is orphaned.
- **E and L both edit `session-manager.ts`** — "units otherwise independent (distinct files)" is inaccurate; L rebases over E.

### Inferences (verified/refuted)
- **REFUTED — "ABI reachable at/before authorization time."** Binding must live in execution. Changes Unit A's approach.
- **CONFIRMED (strengthened) — "rejecting raw hashes doesn't break the faucet."** Faucet private withdraw passes structured `CallIntent {caller: BRIDGE_PROXY, call: <FunctionCall burn_private>}` (`useWithdraw.ts:230-233`); public path uses `SetPublicAuthwitContractInteraction`, a tx not `createAuthWit` (`:243-249`). Typed SDK signature forbids raw `Fr`: `createAuthWit(from, messageHashOrIntent: IntentInnerHash | CallIntent)` (`base_wallet.d.ts:99`). `FunctionCall.name` is required `z.string()` (`function_call.js:42`) → survives wire, `isCallIntent` matches. Rejecting raw hashes closes only the hand-crafted-frame path with zero legit impact.
- **CONFIRMED-with-caveat — "bearer redesign preserves silent-restore."** Silent restore decrypts the profile's password-encrypted secret via the passhash (`session-manager.ts:387` → `password-secret-box.ts:122`). A random token cannot decrypt that; the redesign must store `wrappedSecret = encrypt(masterSecret, token)` in the **session** record and unwrap with the token — touching `Session` shape, `open()` (`session-manager.ts:202-218`), `restore()` (`:335-413`), the `SessionSecretUnsealer` contract, PasswordSecretBox. Net gain = "no password-equivalence / no offline-crack," NOT "secret safe from a session-storage reader" (token + wrapped secret co-locate). Strict mode must still suppress the token bearer — **Unit L does not obviate Unit E.**

### Asks
1. Confirm Unit A binds in execution, covering all three F-02 sinks incl. createAuthWit CallIntent.
2. Unit B scope: display+execution-reject (sufficient) vs pre-popup artifact resolution (heavier).
3. Assign the canCreateAuthWit UI surfacing.
4. Reject vs confirm for IntentInnerHash.

## 3. PLAN-QUALITY
- 12-unit decomposition sound; coupling matches report. Sequencing correct (A→B, L-last), but E/L share `session-manager.ts` → make L-after-E explicit.
- Tier=design-rigor is the right call; A's DEEP pass must *correct* the approach (§1a/1b), not merely elaborate it.
- Under-scoped: Unit A (3 sinks); Unit B (`sanitizeWireString` not applied to method names — `OperationCard.vue:29,232`; `parseTransferIntent` keys on call `:179,192,199`); Unit L (§1f + wrapped-secret redesign).
- Gates: `e2e:agent` correctly on A/C/D/G/L. **Under-gated: Unit I** — a bad MAC/key can brick every dApp reconnect; add a grant→reconnect check, not smoke-only.

VERDICT: conditional approve (conditions: Unit A binds name↔selector in execution across all three F-02 sinks incl. createAuthWit CallIntent `service.ts:657-672`; Unit B states display+execution-reject vs pre-popup resolution and routes method labels through `sanitizeWireString`; Unit L keeps the passkey secret in a wipeable buffer before Fr-wrapping and designs a session-stored wrapped-secret with strict-mode suppression (E still required); assign the canCreateAuthWit UI surfacing; strengthen Unit I's gate with a dApp-reconnect check)
