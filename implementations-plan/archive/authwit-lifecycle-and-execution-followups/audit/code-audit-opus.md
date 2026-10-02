# Adversarial post-impl code audit (Opus Plan subagent) — REJECT

BLOCKING:
- F1 HIGH: grantPublicAuthwit scope gate is DEAD CODE. Missing from
  METHOD_CAPABILITY_MAP (capability-map.ts) → enforceCapability returns []
  → dispatcher.ts:266 `if (grants.length)` skips scope enforcement →
  checkGrantPublicAuthwit never runs. A dApp with only an `accounts` grant
  can mint an arbitrary on-chain public authwit (token-spend authorization).
  The shipped dispatcher test even uses an accounts-only session and passes —
  gap uncaught. FIX: add `grantPublicAuthwit: "transaction"` to
  METHOD_CAPABILITY_MAP + a scope-violation test. (Secondary: the
  `if (!caps.length) return` early-return in checkGrantPublicAuthwit no-ops
  without a transaction grant — fixed automatically once the capability is
  required, mirroring checkTransactionCalls.)
- F2 HIGH: OperationCard.vue:123-125 renders add_public_authwit as the opaque
  label "add public authwit" — user does NOT see caller/contract/method/args
  they authorize. Blind approval surface for a persisted on-chain spend grant.
  FIX: render the authwit caller/contract/method/args (ideally transfer-intent)
  on the execute card primary surface.

MED:
- F3: scope check covers only contract+method, NOT caller (future spender) or
  args (recipient+amount). Consistent with checkCreateAuthWit precedent. Even
  gated, a transaction scope of method@contract permits an arbitrary caller+
  args. Recommend rendering caller+args (F2); consider scope-binding caller.

LOW (all clean — positives):
- F4 owner authz (args[0] vs session accounts) correct, fail-closed.
- F5 builder path fires set_authorized + trackAuthwit only; fee selection intact
  (dispatcher builds no fee field → requiresFeeSelection forces fee pick).
- F6 cancelJob D6 profile-only safe (not dApp-reachable; popup-only; TOCTOU
  benign; existence non-disclosure preserved).
- F7 beginJournal relocation byte-identical, no double/lost start.
- F8 schema drift-guard fail-closed + 3 copies executable-identical (one
  comment-only drift). Residual: guard checks param COUNT not types (same as
  pre-existing registerToken guard).

VERDICT: reject — fix F1 (capability map + test) and F2 (popup rendering)
before merge; F3 recommended.
