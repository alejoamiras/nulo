# Consolidated audit (4 investigations) — fan-out per user request

## 1. CDP / protocolTimeout (subagent) — env-gate CORRECT
The lifecycle e2e (~10 serial proofs) can't run on the shared shard pool;
protocolTimeout is the wrong lever (proving is offscreen; CPU saturation is
the cause). Env-gate (RUN_AUTHWIT_E2E) was the right call and already removes
them from PR CI. Real automation path: dedicated isolated heavy job +
accelerator (concrete steps in cdp-rootcause.md). Latent inversion: launch
protocolTimeout 300s < test waitForPgResult 360s.

## 2. Flake attribution (subagent) — my tests caused it; fixture CLEAN
Clean A/B vs a baseline green run: concurrent-sendtx passed in 20s without my
file, timed out WITH my heavy smoke on the same shard (aggravation, HIGH conf).
authwit-lifecycle/smoke failed on their own (too heavy). multi-account-from is
independent baseline flake (not on my shards; identical file-set passed 1h
earlier). My fixture change is clean (failure was deep in the test body, no
fixture-assertion errors). Env-gate resolves all self-failures + the
aggravation.

## 3. Code audit (Opus adversarial) — REJECT → F1 FIXED, F2/F3 open
- **F1 HIGH (FIXED, commit 834b403):** grantPublicAuthwit was MISSING from
  METHOD_CAPABILITY_MAP → enforceCapability returned [] → the entire scope
  block was skipped → checkGrantPublicAuthwit was DEAD CODE. A dApp with only
  an `accounts` grant could mint an arbitrary on-chain authwit. FIX: added
  `grantPublicAuthwit: "transaction"` + 2 regression guards (accounts-only
  rejected; out-of-scope contract rejected). The plan (D7v2) explicitly
  required "its own entry in the scope-checker table … the granted capability
  is the control" — I wired the checker but missed the capability map.
- **F2 HIGH (OPEN):** OperationCard.vue renders add_public_authwit as the
  opaque label "add public authwit" — the user does NOT see the caller/
  contract/method/args they authorize. Blind approval for a persisted on-chain
  spend grant. (With F1 fixed the attack needs a real transaction scope, but
  the residual blind-approval gap remains.)
- **F3 MED (OPEN):** scope check covers contract+method only, not caller
  (future spender) or args (recipient+amount). Consistent with the existing
  checkCreateAuthWit precedent. Recommend rendering caller+args (F2); consider
  scope-binding caller.
- F4-F8 LOW: all CLEAN (owner authz fail-closed; builder fires set_authorized+
  trackAuthwit only + fee selection intact; cancelJob D6 safe; beginJournal
  move byte-identical; schema drift-guard fail-closed).

## 4. Codex retry (offline→reconnected) — no usable verdict (echoed context,
did not complete). The Opus audit is the audit of record; its F1 finding is
corroborated by the plan's own D7v2 design intent.

## F2/F3 resolution (user: fix both)

- **F2 FIXED (HIGH):** OperationCard.vue now renders an `add_public_authwit`
  action's spender (caller) / method / contract / args on the primary
  approval surface (testids `execute-authwit-spender`, `execute-authwit-args`),
  replacing the opaque "add public authwit" label. Regression-pinned by
  OperationCard.authwit.test.ts (asserts spender+token+args render, opaque
  label absent).
- **F3 RESOLVED (MED):** the audit's stated minimum ("render caller+args") is
  satisfied by F2. Literal "scope-bind the caller" is NOT implemented, by
  analysis:
  - `TransactionCapability.scope` is `Scope` = `"*"` | `{contract,function}[]`
    — there is NO caller dimension (capabilities.ts:42-45). Adding one is a
    capability-schema extension (types + cap-request UI + enforcement), not a
    quick fix, and would BREAK the legitimate case (a DEX/contract spender is
    never in an allowlist).
  - The authwit binds funds to the SIGNER: on-chain `_validate_from_public`
    requires `from == authwit signer`, so a dApp can only grant authority over
    the GRANTER's OWN funds — no third-party theft. Residual risk ("authorize
    spender X to move MY funds to Y for Z") is now fully VISIBLE via F2 +
    popup-confirmed. Consistent with the existing checkCreateAuthWit precedent
    (contract+function only). Recorded as a deliberate decision; a
    transaction-capability `allowedCallers` field is a possible future feature.
