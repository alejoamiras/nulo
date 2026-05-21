# Opus 4.7 audit — plan v3

Independent senior reviewer audit. Plan reviewed: `plan-v3.md`.

---

## 1. Verdict

**Ship-with-changes.** The pivot is correct, the surface is smaller, and the core design is sound — but the plan misattributes a load-bearing file path (the error-to-response writer is in `background.ts`, not `dispatcher.ts`), oversells what dApps will see on the wire ("dApps catch on `code === 4100`" is false for this SDK transport), and leaves one structural decision unexamined (where the new error class lives given the layering rules).

## 2. Is the v2→v3 pivot sound?

**Yes, decisively.** The user was right. v2's lazy implicit grant fixes only one click; the very next step (`feeJuice.methods.claim(...).send(...)` at `claim-via-wallet.ts:140` and `BatchCall.send` at `:123`) hits the dispatcher's `enforceCapability` for `sendTx`, which requires the `transaction` capability that was NOT granted by the implicit accounts-only popup. v2 would have produced a "looks fixed, then breaks 8 seconds later" UX — exactly the failure mode v1's silent `[]` already gave us. v3 forces Nethermind's `catch` block to call `requestCapabilities(faucetCapabilities())`, which I verified covers all four needed capabilities (`wallet-capabilities.ts:18-43`).

**Throw is strictly better than lazy grant for the verified user agents.** Smaller PR, smaller blast radius, no `RejectedCapabilityRecord.implicit`, no TTL, no inflight dedupe, no popup hollow-state work. Roughly 50% of v2's complexity disappears.

**The "third option both missed."** There is one. Option E: **return `[]` AND emit an out-of-band notification event** (e.g., the wallet sets a flag the dApp can observe via the existing `dappInteractionService` channel). I'd reject it — dApps don't subscribe, it changes the protocol, and it doesn't trigger Nethermind's `try { } catch { }` fallback. Throw remains correct.

## 3. v3 standalone evaluation

If I'd never seen v1/v2 and only saw v3: I'd ship it with the fixes below. The plan is well-structured, the contract change is small and clearly motivated, the test scope is right-sized. The only standalone red flag is §11 Q5 — "is there a code path between dispatcher entry and `handleGetAccounts` where the throw could leak in a way that breaks the wire response shape?" — and §3 saying the writer is at `dispatcher.ts:461-475` when it's actually `background.ts:461-475`. These are the same defect: the plan doesn't fully understand where the error-to-envelope conversion happens.

## 4. EIP-1193 code 4100 — right code?

**4100 is the right code.** It's the EIP-1193-defined "Unauthorized" code, and dApps that DO inspect codes will match on it. Custom (`4101`) or "Reserved" (`4200`, "Method not supported") are wrong — the method IS supported, the request is unauthorized.

**But the plan oversells what dApps see.** Reality check from `node_modules/.bun/@aztec+wallet-sdk@4.2.0/.../extension_wallet.ts:181-182`:

```ts
if (error) { reject(new Error(jsonStringify(error))); }
```

When the wallet's `response.error` is an object, the SDK does `new Error(JSON.stringify(error))`. The dApp gets a plain `Error` whose `.message` is `'{"code":4100,"message":"accounts capability not granted...","data":{"walletErrorCode":"CAPABILITY_NOT_GRANTED",...}}'`. There is no `.code` property on the rejected error. The plan's §3 sentence — *"Web3 dApps that follow EIP-1193 catch on `code === 4100`"* — is factually wrong for this transport. They CAN parse the JSON message and extract code 4100, but they cannot read it directly off `err.code`.

This is fine in practice — Nethermind's `catch {}` is bare and triggers regardless. But the plan should be honest about it, and it might be worth adding a one-line note to the wallet-bridge README explaining the JSON-in-`.message` quirk so dApp authors know how to discriminate.

**Recommendation**: keep code 4100, rewrite the §3 "Why 4100" paragraph to say *dApps that parse `JSON.parse(err.message).code` see 4100; dApps that bare-`catch` (Nethermind) trigger fallback regardless*. Add the parse recipe to the README append in §9.

## 5. Phase 1.5 — still right?

**Yes, unchanged from v2 is the right call.** Bug B (silent `canCreateAuthWit` escalation via the type-only delta filter at `dispatcher.ts:380-382`) is independent of v3's pivot. It's a real authority-escalation surface. Both prior auditors flagged it; codex final review confirmed `accounts`-only is acceptable scope. The breadth fix (`contracts`, `simulation`, `transaction`, `data`) was filed as a follow-up under v2 and that hasn't changed.

**Should breadth land in this PR?** I'd say no, for one reason: a broader field-aware diff for `contracts.contracts` (an array) and `simulation.utilities.scope` (a structured set) needs more careful equality semantics than `accountsCapsEqual`'s 2-boolean compare. Mis-specifying it could BREAK previously-working flows by re-popping every same-shape `requestCapabilities` call. The follow-up plan deserves its own audit cycle. **Leave Phase 1.5 scoped to `accounts`.**

## 6. Test adequacy

**Mostly fine. One gap, one weak spot.**

- Test #1 (round-trip via `walletErrorFromPayload`): correct. Needs to assert `instanceof CapabilityNotGrantedError` survives the JSON boundary.
- Tests #2–#4 (dispatcher contract rows): cover the throw, the fast path, and the desync path. **Gap**: no test for "session not found" (line 256). v3's wording in §1.2 keeps `throw new Error('No dApp session found for origin ...')` — but if that throws BEFORE the `CapabilityNotGrantedError` check, the dApp sees a plain string error, not the structured envelope. That's fine but should be pinned so a future refactor doesn't accidentally swap order.
- Test #5, #6 (Phase 1.5 regression): correct.
- Test #7 (wire-response writer): **this is the test the plan needs most, and it's mis-located.** Plan says "wire-response writer" lives in `dispatcher.ts` — it does NOT. It's in `packages/extension/src/wallet/services/wallet-sdk/background.ts:461-475`. The test goes there, not in `dispatcher.test.ts`. The plan needs to be re-pointed.
- E2E #8 (flipped pregrant test): correct. Add the regression that the subsequent `requestCapabilities` succeeds — the plan already calls this out as "also assert that calling `requestCapabilities` next succeeds".

**Redundancy**: none. Each test pins a distinct row.

**One test I'd add**: an e2e or unit assertion that the `response.error` JSON, when passed through `new Error(JSON.stringify(error))` (the SDK's transformer), produces an `err.message` that is valid JSON containing `"code":4100`. That's the contract that the dApp's parse-the-message recipe depends on. Cheap to write; load-bearing for the README claim.

## 7. Security & adversarial review

Plan's §5 is solid for the surface v3 has. New risks to add:

- **`CapabilityNotGrantedError` cross-package placement.** The plan puts the error in `@nulo/extension-messaging`. Reasonable — that's where `WalletError`/`JobCancelledError` already live, and `wallet-bridge` already imports from it. But check the layer rules: `wallet-bridge` → `extension-messaging` is allowed (extension-messaging is lower in the layer hierarchy per `CLAUDE.md`). No layering violation. Fine.
- **Error-message info leakage**: §5 dismisses this as "low risk." Mostly right, but the message ends with the literal function name `requestCapabilities()`. Any prefix/substring matching on the message string in a dApp's error handler becomes a brittle wallet-API fingerprint over time. Mitigation: keep the message stable across versions (treat the literal as a public contract).
- **Mis-attribution attack (carried from v2's §6)**: REMOVED in v3 because there's no popup. Good. But adjacent risk: a dApp that catches and silently retries `getAccounts()` in a loop will fail-spam our log line at LogLevel.Info (`getAccounts pre-grant from <origin> — throwing CAPABILITY_NOT_GRANTED...`). Not a security issue, but bound the log rate or move to `LogLevel.Debug` if the dApp can do this every render.
- **Malicious dApp showing a fake "wallet" UI after the throw**: the question you asked. The dApp can ABSOLUTELY do this — it could pop a modal styled to look like Nulo's UI saying "Nulo needs you to enter your seed phrase." But this is **NOT new with v3**: any dApp can do this any time, with or without a throw. The throw doesn't provide new attack material. Mitigation lives in user education + browser-extension chrome (the extension popup has trusted chrome the dApp can't spoof). No code change needed.
- **JSON injection via `error.message`**: when the SDK does `new Error(jsonStringify(error))`, any newlines or quotes in our message string flow through unescaped JSON. Our message is a fixed literal, so safe today. **Add an invariant note**: the error message MUST be a fixed-string literal, never include user input or session/origin data. Otherwise a malicious origin name could break the JSON envelope. Pin it with a TS string-literal type or a test.
- **Supply chain / crypto / least privilege**: no delta, agreed.

## 8. §11 open-question triage

1. **Throw vs lazy — does the spec-alignment argument hold?** Yes. The wallet-sdk skill (line 1472) is unambiguous. v3 enforces; v2 normalized the footgun.
2. **EIP-1193 4100 — right code?** Right code. Wrong claim about how dApps receive it — see §4 above. Fix the README recipe.
3. **Test coverage adequacy?** Move Test #7 to the right file. Add the "session not found" pin. Add the JSON-envelope round-trip assertion.
4. **Phase 1.5 scope?** Unchanged. Defer breadth. Right call.
5. **Throw timing — leak risk between dispatcher entry and handler?** Verified: `enforceCapability` exempts `getAccounts` (`capability-map.ts:14`), `enforceScope` runs only if `grants.length > 0`. The throw inside `handleGetAccounts` propagates cleanly to `background.ts:460` which catches → envelope. No leak.
6. **Adversarial review explicit ask**: see §7 above.
7. **Branch name change**: appropriate. The plan-dir staying as `wallet-sdk-implicit-account-grant/` for audit-history continuity is fine, but add a `README.md` (or top-of-`plan-v3.md` banner) noting "directory name is legacy; current direction is the CAPABILITY_NOT_GRANTED throw." You already do this in v3 §0.

## 9. Concrete edits to plan-v3.md

- **§3 "Why 4100"**: rewrite to acknowledge the wire reality — SDK does `new Error(JSON.stringify(error))` at `extension_wallet.ts:181`, dApps see `err.message` as JSON, need `JSON.parse(err.message).code` to read 4100. Mention this is fine for `try { } catch { fallback }` patterns and document the parse-the-message recipe.
- **§1.2 file pointer**: replace every "dispatcher.ts:461-475" with "background.ts:461-475". This is the actual error-to-response writer location. The dispatcher only throws; the wallet-sdk background handler converts.
- **§4 Phase 2 Test #7**: move from `dispatcher.test.ts` to `packages/extension/src/wallet/services/wallet-sdk/background.test.ts` (verify file exists; if not, create or pick the closest existing harness).
- **§1.2 handler ordering**: keep `tryGetDappSessionByOriginAndChain` throw BEFORE the `hasAccountsGrant` check (current sketch), and add a unit test pinning that order. A future "no session = no accounts = throw `CapabilityNotGrantedError`" refactor would be a behavioral change for dApps that rely on the "session expired" diagnostic.
- **§5 Threat: stable error-message contract**: add a row stating the message string is a public contract and must not include user-supplied data; pin with a test.
- **§5 Threat: log-spam rate**: drop the `LogLevel.Info` for the pre-grant throw to `LogLevel.Debug`, OR add a per-origin debounce. A misbehaving dApp re-fires `getAccounts()` once per React render → log noise.
- **§4 Phase 2 add Test #9**: `JSON.parse(error.message).code === 4100` round-trip — verifies the dApp's parse recipe works after `new Error(JSON.stringify(error))`.
- **§9 README append**: include the parse-the-`err.message` recipe so dApp authors who want code discrimination have a copy-pasteable snippet.
- **§11 Q5 answer**: bake it in — "Verified: `enforceCapability` exempts `getAccounts`, throw propagates to background-handler envelope. Pinned by Test #7."
- **§9 follow-up plans**: the v2 `wallet-sdk-capability-popup-dedupe` is correctly dropped. Keep the other two. Add a third: `wallet-sdk-error-envelope-typed-codes` — explore exposing `walletErrorCode` as a top-level discriminator the SDK can read without `JSON.parse`. Optional, low priority.

## 10. What looks fine

After actually trying to break it: the pivot rationale is sound (verified Nethermind's flow end-to-end), the Phase 1.5 carry-over is correct, the test count reduction (16 → 8) is honest, the file-touched list is otherwise complete, the fallthrough between "no grant → throw" and "grant exists but accounts empty → return `[]`" preserves the desync diagnostic path, the cross-origin/cross-chain scoping is inherited cleanly, the comment fix at `background.ts:391` is the right one-liner, and the inheritance from `WalletError` correctly mirrors the established `JobCancelledError` pattern. The new error class doesn't introduce new authority — it just narrows a passive failure into an active one.

**Ship with the §9 edits.** No re-pivot needed. The plan is closer to merge-ready than v2 was at the same audit stage.
