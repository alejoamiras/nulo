**Findings**

No blocking findings. The prior conditions are substantively closed, not just referenced.

One non-blocking wording drift: Unit B’s table title says “sanitized ABI-verified labels” (`plan.md:35`) and execution order says B “needs A’s resolved name” (`plan.md:50`), while the detailed design correctly chooses display hardening plus execution rejection, not pre-popup ABI resolution (`plan.md:84-90`). The detail is clear enough to execute, but the title could mislead.

**Prior Conditions**

- CI strategy closed: unit PRs into `fix/harden-findings` explicitly get no GitHub CI; each unit requires local gates, and only the promote PR to `dev` runs required CI (`plan.md:13-16`, `plan.md:180`, `plan.md:200`).
- Unit A closed: binds name↔selector in execution, not dispatcher scope checks, across all three sinks including `createAuthWit` `service.ts:657-672` (`plan.md:62-67`, `plan.md:174`); keeps synchronous scope checking (`plan.md:67`); rejects raw authwit hashes via `isCallIntent`/`isIntentInnerHash` guards (`plan.md:68`); confirms `IntentInnerHash` with explicit popup instead of silent signing or hard rejection (`plan.md:69`); adds faucet serialization coverage (`plan.md:79`).
- Unit B closed: explicitly chooses display+execution-reject, not pre-popup PXE resolution (`plan.md:84-85`, `plan.md:176`), and assigns `canCreateAuthWit` surfacing to the capabilities UI (`plan.md:88`, `plan.md:190`).
- Unit G closed: requires `sender.id === chrome.runtime.id` and rejection of `sender.tab` senders, adds Firefox sender-shape parity tests, and states the durable token is stale-instance separation, not sender authentication (`plan.md:109-113`, `plan.md:177`).
- Unit I closed: wipe-and-reseed is explicit; MAC key is derived from the active profile master secret and not stored beside rows; gate includes real grant→reconnect network e2e (`plan.md:115-118`, `plan.md:178`).
- Unit L closed: wipeable buffer before `Fr` wrapping, session-stored `wrappedSecret`, strict-mode suppression retained, no AES-GCM/PBKDF2 changes, storage bump and migration/session assertions included (`plan.md:128-137`, `plan.md:179`).
- E→L dependency closed: execution order, hard edges, Unit E note, Unit L strict-mode note, assumptions, and decision ledger all make E prerequisite to L (`plan.md:50-52`, `plan.md:102`, `plan.md:133`, `plan.md:160`, `plan.md:179`).

**Adversarial Review**

No new blocking contradiction between units. Shared-file conflicts are acknowledged and ordered: B after A, L after E, L last (`plan.md:50-52`). G correctly separates sender authentication from the Firefox durable token (`plan.md:111-112`). L’s threat property is honest: session storage can restore until TTL, but no password-equivalence/offline-crack claim beyond that (`plan.md:135`).

Remaining execution risks are captured as deep-pass questions rather than unsafe assumptions: especially whether the `createAuthWit` path can resolve `call.to`’s artifact at execution time (`plan.md:74`, `plan.md:165`). That is acceptable for autonomous execution because Unit A is DEEP and must resolve it before coding (`plan.md:26`, `plan.md:72-74`).

**Assumption Attack**

The unsafe prior assumptions have been downgraded or gated. CI reality is now a verified fact (`plan.md:158`). ABI-not-at-authz is a fact and drives execution binding (`plan.md:156`). Raw authwit faucet compatibility has a required serialization gate (`plan.md:79`, `plan.md:157`). “No prod users” remains a product assertion, not a security fact (`plan.md:164`), but the plan’s destructive choices are explicit and approval-gated where necessary.

Ready to execute autonomously after the approval gate selects Unit L scope, with no additional remediation-plan conditions.

VERDICT: approve