# Phase 2 — Swap consumers to derived maps; delete the literals

## Outcome — ✓ (2026-06-15, commit `f6ba8ed`)
- **Zero-change gate met:** all 147 wallet-bridge tests green UNCHANGED (134 existing + 13 Phase-1 harness). Not one existing test modified.
- Extension suite: **2392 passed** (no downstream bridge-consumer breakage).
- `typecheck:all` ✓, `lint` ✓.

## What changed
- `capability-map.ts` → thin facade: `getRequiredCapability`/`isCapabilityExempt` read the registry-derived `METHOD_CAPABILITY_MAP`/`EXEMPT_METHODS`; both literals deleted.
- `scope-enforcement.ts` → imports the derived `METHOD_SCOPE_CHECKER`; local literal deleted; `enforceScope`/`enforceScopeWithSession`/`validateAccountScopes` unchanged.
- `dispatcher.ts` → imports `METHOD_TO_KIND`/`NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS` + `METHOD_REGISTRY`; all three literals deleted. Added the **dispatch-entry descriptor guard** (after session capture, before `enforceCapability`): no registry row → `throw "Unsupported wallet method: ${methodName}"`. Corrected the stale `enforceCapability` doc comment that wrongly listed `getAccounts` as exempt.

## Decisions / notes
- **The `if(!kind)` at the kind lookup stays** (now `if (!kind) throw "Unsupported wallet method"` is effectively unreachable for well-configured methods, since the top guard rejects descriptor-less methods and all routing≠handler methods have a kind). Kept for TS narrowing of `METHOD_TO_KIND[methodName]` (`OperationKind | undefined` → `OperationKind`) before `buildOperation(kind,...)`, and as defensive depth. Removing it would force a non-null assertion — not worth it.
- **Retired methods** (`getCompleteAddress`/`simulateViews`): no descriptor → the top guard throws the exact pinned string. `dispatcher.test.ts:813/817/824` stay green. The ordering shift (they now throw before `enforceCapability` instead of after) is observationally identical — no test asserted ordering (opus verified).
- **The matrix prediction held:** parity stayed exact through the literal deletion → Phase 3's latent-bug lane is a documented no-op (nothing surfaced).

## Next (Phase 3)
- Record "parity exact; no latent inconsistency surfaced" (the matrix + the clean Phase-2 swap are the evidence). No bug-pin fixes needed.
- Add the add-a-method meta-proof (scoped to METADATA): one descriptor row centralizes the facts; omitting a descriptor fails exhaustiveness + the runtime guard. A new kind still needs the out-of-scope builder switch.
