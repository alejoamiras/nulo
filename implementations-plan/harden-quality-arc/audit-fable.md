# Audit — opus (fable-role), harden-quality meta-plan

**Verdict: conditional approve.** Conditions: (a) HALT-on-edit hard limit for the frozen authz oracles; (b) replace "network-e2e proves authz" with an adversarial-bypass gate on every trust-boundary phase; (c) treat the registry-touching trio P18/P19/P20 as bound to P15's standing oracle; (d) fix the Q-09 gate + the Q-06 "type-only" misstatement. The arc is fundamentally sound (the pattern shipped batch-2; the load-bearing frozen-registry test already exists) but as written it can ship a green, fail-open `dev-quality`.

Read: plan, all 22 findings, both verification syntheses, CLAUDE.md; spot-checked `dispatcher.ts`, `method-descriptors.ts`, `capability-map.ts`, `scope-enforcement.ts`, `method-descriptors.test.ts`, storage codecs, profile lock, Q-09 encoders.

### 1. BIGGEST RISK — "network e2e proves authz didn't regress" is FALSE
Network e2e drives the cooperative playground dApp (happy path only). Every fail-open ships green:
- `scope-enforcement.ts:62-64` — `enforceScope` silently returns for any method with no checker; drop a checker (Q-02/03/05 re-derive `METHOD_SCOPE_CHECKER` at `method-descriptors.ts:256-270`) → scope unenforced, happy path unaffected.
- `capability-map.ts:23-27` + `dispatcher.ts:990-993` — unknown method → null capability → `enforceCapability` returns `[]` (permissive); safe ONLY because entry guard `dispatcher.ts:293-294` runs first. Reachability proves callable, never that a denied call is denied.
**Fix:** demote network e2e to a smoke signal for these phases; gate = an adversarial dispatcher suite (hostile protocol-client: scope-widening, missing-grant, batch-smuggling, unknown-method, prototype-name method) + the frozen oracle (#2).

### 2. AUTONOMY GAP — editing a frozen authz oracle must HALT, not be "fixed"
`method-descriptors.test.ts:36-103` freezes the boundary via hand-transcribed `FROZEN_CAPABILITY_MAP`/`FROZEN_EXEMPT`/`FROZEN_SCOPE_CHECKER` (by-reference) + batch/F-003/F-004/F1 asserts. Right net, but editable — under RED "make it green," updating a frozen expectation is how the boundary silently widens, and looks identical to "update an expected value" (legit for Q-22). Listed hard limits are all external side-effects; none covers "a security oracle changed."
**Fix:** hard limit — any diff touching `method-descriptors.test.ts` FROZEN_*, `scope-enforcement.test.ts`, `dispatcher.test.ts` authz cases, or `key-vectors.test.ts` → HALT + surface; explicit RED-policy carve-out.

### 3. SEQUENCING — 4 PRs re-derive the same registry; each can silently moot the last
Q-05(P15)/Q-03(P18)/Q-01(P19)/Q-02(P20) converge on `method-descriptors.ts`/`dispatcher.ts`/codecs. Re-verify checks the SMELL, not P15's authz invariant after P20 re-derives the table — so P20 can invalidate P15's ✓ without tripping re-verify. (This is the steelman for B on this cluster: refactor the boundary ONCE against one frozen oracle, not reopen it 4× against a mutable one.)
**Fix:** keep A for the 15 bounded findings; for the registry cluster, P15's frozen oracle is a STANDING gate P18/P19/P20 must each keep green WITHOUT editing it (ties to #2), or merge Q-02+Q-03.

### 4. Q-09 IS a sleeper + its gate misses the package that matters
Q-09 feeds crypto wire encodings in bridge-core: `content-hash.ts:33-46` (hex→`sha256ToField`→content-addressed recovery field) + `recovery-crypto.ts:35-46` (base64). The finding admits encoders are NOT byte-identical → consolidating is NOT behavior-preserving; a changed encoding at a hash/recovery site breaks cross-device recovery. P1's gate omits bridge-core.
**Fix:** add bridge-core units to P1; adversarial ask "prove byte-identical output per replaced site"; EXCLUDE `content-hash`/`recovery-crypto` from the dedup (all downside, ~zero win).

### 5. Q-06 is mislabeled "type-only"; gate on SW-restart restore
Q-06 also splits the dual-role `masterKey` + restore payloads by profile type (`profile/spec.ts:250-262`) = a RUNTIME change to `restore()`. Asymmetric refactor (write path updated, a read site missed) breaks restore after SW restart.
**Fix:** correct the claim; P14 gate = the sw-restart / sw-resilience restore path; adversarial ask "split restore payload round-trips across a simulated SW restart."

### 6. Q-01 `parseOrDelete` can MASK a codec regression as an empty list
`entity_storage.ts:47-60` drops a row on parse/throw by design. A stricter Q-01 schema rejecting a freshly-written shape → silent empty list, not a throw → "tests pass" while data vanishes. (Mitigating: NO committed old-format fixtures found → "no-backwards-compat" is more defensible than the plan's own worry; the hazard is silent-drop masking.)
**Fix:** during P19, make `parseOrDelete` fail-LOUD under test (throw in `NODE_ENV=test`) + a write→read round-trip corpus test per storage namespace.

### 7. Fail-open landmines each trust-boundary phase must pin VERBATIM
- `method-descriptors.ts:154-159` — `registerContractClass` is a fail-closed "Neutralized" stub; don't "simplify" it open. (Q-02/03/05)
- `dispatcher.ts:480-484` — batch-forbidden set hardcoded `sendTx`/`registerToken`; deriving "popup-gated" from a registry w/o that field risks dropping one → confirmation-popup bypass. Snapshot it. (Q-02)
- `dispatcher.ts:293-294` entry guard must stay strictly UPSTREAM of the permissive `return []` at `:990-993`. (Q-02)
- `base-service.ts invoke` (~:124) safe ONLY because `rpcMethods` allowlist checked first — proxy/typed-dispatch must keep the allowlist upstream of the dynamic invoke. (Q-02/03)
- `dapp-interaction/service.ts:513-514` `getOperationAccessLevel` default `AccessLevel.None` (fail-closed) — registry must map unknown kind → None, never undefined-as-grant; `:455-463` `register_token` always-confirmable special case (anti-phishing) — folding into a generic table silences the popup. (Q-04)

### 8. Sequencing inversion — Q-03's proxy factory builds on the base Q-02 later retypes
Q-03(P18) builds the typed `ServiceClient` factory on extension-messaging `base-client`/`base-service` (`base-service.ts:111,125,130`, `base-client.ts:117,205`) — Q-02 instances retyped at P20. Factory lands on the untyped base, then Q-02 churns it. The "Q-02 builds on Q-03" dependency is backwards for the base-client sub-part.
**Fix:** type the extension-messaging base FORWARD of P18 (fold into P18), do the dispatcher RpcRequest union at P20.

### 9. Q-13 is a PRIVACY boundary, absent from Security
Q-13's shared `ProfileScopedRepository.requireOwned`/cascades are the profile-isolation mechanism in a privacy L2 wallet — a bug = cross-profile leak. Spans 8 services with divergent shapes (only 3 have `repository.ts`); not the "mechanical mid" the plan implies; not in the Security section.
**Fix:** add an adversarial ask to P12 ("can profile A read/delete profile B's rows?") + a cross-profile isolation test; bump toward `deep`.

Minor: Q-02's "novel/first-of-kind → mega-deep" rationale is stale — `method-descriptors.ts`/`capability-map.ts` already exist, so re-verify will find chunks of Q-02/03/05 partly moot (budget for re-scope; over-tiering harmless). Q-17 is one-file but NOT purely mechanical (naive `runExclusive` wrap reorders the zeroization `finally` on unlock) — keep the explicit zeroization-ordering pin.

### What's solid
A over B for the 15 bounded findings; the coupling calls (Q-06-after-Q-09, Q-07-before-Q-01, Q-04+Q-05); the existing frozen oracle as the right net (lean on it, #2, not network e2e, #1); `parseOrDelete` drop-not-throw is a deliberate no-prod-users choice (fine except the Q-01 window); no committed old-format fixtures → "no-backwards-compat" largely defensible; RED policy correct (needs the oracle-edit carve-out); owner-merges-the-promote is the right irreversible-step gate.
