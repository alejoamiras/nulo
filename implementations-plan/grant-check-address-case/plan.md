---
plan: grant-check-address-case
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: (one Artifact covers the program's four follow-up plans; its URL is filled in here once published)
branch: fix/grant-check-address-case
worktree: a harness-created agent worktree (its path is recorded in lessons/phase-1.md)
program: the ux-feedback follow-ups, four independent PRs off dev (this is the security-and-privacy one)
---

# Contract-address case in the grant check

A dApp's granted scope names contracts; the wallet checks every later call against it. The check
compares addresses as exact strings, so a scope that lists a contract as `0xABCD…` refuses every
call to `0xabcd…`, the same contract. The permission window's Details table merges the two
spellings into one row, so the window can show an operation the check then refuses. This plan makes
every listed-contract comparison in the grant check compare the 32-byte value, through one function
the Details table also keys by. For valid addresses the table and the check then agree by
construction, and a listed scope still never reaches a different contract. Wildcard scopes keep
authorizing exactly what they authorize today.

The follow-up it resolves, verbatim from `implementations-plan/ux-feedback/plan.md` § Follow-ups:

> Contract addresses in the permission window: its Details table merges them case-blind, while
> `matchesPattern` (`packages/wallet-bridge/src/method-scope-checkers.ts:39`) compares a scope's
> listed contract to the call by exact string. A scope listed in another case never matches (it
> fails closed), so its Details row can show an operation the check refuses. Normalising both
> sides changes the grant check, so it is its own PR; codex accepted the deferral in batch 5b's
> rounds 1 and 2.

PR #704's body: "The Details table merges a contract listed in two cases into one row, so it can
show more reach than the grant enforces (the scope check compares addresses exactly, and fails
closed); never less." The driver's framing: "Contract-address case in the grant check goes in its
own PR, because normalising it changes what the check allows (today it fails closed)."

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, audit input).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner, 2026-09-28: "Can you ultracode 1 to 5 + security
and privacy + test rliability + trivial? Assigning blueprinting level to each of those and just
needing me to answer the open questons that it may come."

- **Success**: a scope listing a contract in any case authorizes calls to that contract and to no
  other; the Details table and the check share one key; every gate below green on Chrome and
  Firefox.
- **Scope**: every listed contract, class-id and event-contract comparison between a grant and a
  call (`method-scope-checkers.ts`), the three re-prompt coverage comparisons (`dispatcher.ts`),
  the Details table's merge key, and deleting `handleSendTx`'s three interpolating debug calls,
  which the fix would newly reach (§ Security). Out:
  - account-side comparisons (`account-resolution.ts`, `checkCreateAuthWit`'s accounts list,
    `validateAccountScopes`, `sessionAccountsOf`, `projectSessionAccounts`): Ask C-4;
  - fee routing (`fee-payer.ts`): Ask C-5;
  - validating a call target before a wildcard scope returns (a tightening; follow-up);
  - the `createAuthWit` refusal messages (the `wallet-safety-fixes` package owns them);
  - the stored form of a grant, the window's copy and layout;
  - `apps/playground` (it stays generic and unchanged).
- **Constraints**: pre-production, no migrations; no new dependency; complexity budgets hold with
  no new acceptance; the logging policy (no new log line); the account freeze untouched; Bun 1.4.2.
- **Tier**: `mid`, under the owner's standing cap "never blueprint more than mid, to keep our
  credits safe". Phase 0.5 rubric (1 low, 5 high):

  | Novelty | Blast radius | Irreversibility | Migration cost | External coupling | Security sensitivity |
  |---|---|---|---|---|---|
  | 1 | 3 | 1 | 1 | 2 | 4 |

  An authorization check widens, on every scoped grant: that earns the dual audit. One function,
  one package, no storage or wire change keeps it out of `deep`.
- **Reviewers**: foreign `/codex high` (GPT-6 Astra); same-family leg an Opus 5.5 subagent (the
  owner, 2026-09-28: "use opus5.5 instead of fable please").
- **Quality bar**: production. **`/code-review`**: off. **`/harden`**: not scheduled.
- **Validation layers**: typecheck and lint; unit (wallet-bridge) and component-level (the
  window's pure table and rows); network e2e on Chrome and Firefox (one new test plus the
  scoped-grant specs); smoke on both browsers, since `apps/extension/src` changes.
- **Decisions**: UI and product asks go to the owner, technical asks to `/codex high`. Every Ask
  carries a recommendation and a confidence.
- **Delivery**: single arc, one PR off `dev`, plain `gh pr create` after the codex loop converges.

## Outcome & Quality Bar

For whom: a person who connected a dApp and approved "Details · 1 contract", and the dApp's
developer, who wrote the contract's address by hand in a case the SDK does not emit.

Excellent means:

1. **The grant does what the window showed.** A scope listing a contract in any case authorizes
   calls, simulations, utilities, authwits and metadata reads on that contract, exactly as if it
   were written in lower case; a re-request of a held scope in another case is covered.
2. **Never another contract.** Listed-address matching is strict value equality: two addresses
   match only when both are `0x` plus 64 hex digits below the field modulus and encode the same
   value. Anything else (no prefix, `0X`, 63 or 65 digits, non-hex or non-ASCII, embedded in a
   longer string, at or above the modulus) matches no listed address, and two such values never
   match each other. A wildcard scope (`"*"` contract, scope or list) keeps authorizing what it
   authorizes today, including targets execution would parse and targets it would not; each
   method's later rejection boundary is in § Non-obvious mechanics.
3. **One key, shared.** The checkers, the coverage functions and the Details table key addresses
   with the same `fieldAddressKey`. A component test pins parity over valid spellings (same row
   exactly when the check matches); a held malformed value renders as today. The test proves the
   behaviour; the shared import is checked in review.
4. **Nothing is rewritten.** Serialization is unchanged and nothing writes a canonical spelling:
   stored grants, their MACs and their spellings stay as sent. What does change is which decisions
   run: a request covered only by case writes no decision and opens no window (UI impact).

Good enough: the account-side and fee-routing comparisons keep exact matching (they fail closed);
follow-ups record them.

## UI impact

No screen's copy or layout changes. Coverage decides whether the window opens and which rows it
shows, so the case fix changes both for a request that differs from a held grant only in case
(`dispatcher.ts:514-521` filters the delta; `build-items.ts:153-160` reads `dataFieldsCovered`):

| Situation | Before | After |
|---|---|---|
| Re-request of a held scope, differing only in case | the window opens with that permission as new | no window; the answer comes from the held grant |
| Request for the address book and private events on `0xabc…`, private events held on `0xABC…` | window rows: address book, private events | window row: address book only |
| Request for a transaction scope on `0xabc…` (held on `0xABC…`) plus a new type | window rows: the transaction permission and the new type | window row: the new type only |
| Details table, valid addresses | merged case-blind, first spelling shown | unchanged |
| Details table, a held malformed value | keyed by its lower-case spelling | unchanged (`fieldAddressKey(contract) ?? contract.toLowerCase()`) |

Outside the window, a dApp whose scope was written in another case stops being refused; today it
receives the wallet's unclassified-error constant, "The wallet could not process the request."
(`apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:177-199`). Under an On
authorizations switch its covered call intent signs without a window, as the same scope in lower
case already does. All of this is Ask O-1, the owner's sign-off.

## Architecture & Implementation

### Proposed architecture

One new leaf module in `@nulo/wallet-bridge`, `packages/wallet-bridge/src/field-address.ts`, owns
the definition of a field address and its comparison key. It takes `FIELD_ADDRESS` and
`isFieldAddress` from `dispatcher.ts:314-319` unchanged (the dispatcher imports them back), and
adds the key and the equality. The checkers, the dispatcher's coverage functions and the
extension's Details table import it; nothing else changes shape.

The fix is at the comparison, not at storage: both sides are keyed when compared. Stored grants
keep the case the dApp sent, as `dispatcher.test.ts:1992-2009` pins; a grant already saved in
upper or mixed case starts matching with no rewrite and no migration.

### Key interfaces

```ts
// packages/wallet-bridge/src/field-address.ts (exported through the barrel)

/** `0x` + 64 hex digits below the field modulus: the only listed-contract form projection admits. */
export function isFieldAddress(value: unknown): value is string

/** The lower-case spelling `AztecAddress.toString()` writes, or `undefined` for any other string. */
export function fieldAddressKey(value: string): string | undefined

/** The same 32-byte value; false whenever either side is not a field address. Every grant-to-call
 *  contract comparison goes through this. */
export function sameFieldAddress(a: string, b: string): boolean
```

`sameFieldAddress` is `const k = fieldAddressKey(a); return k !== undefined && k === fieldAddressKey(b)`.
It exists so no caller writes `fieldAddressKey(a) === fieldAddressKey(b)`, which is `true` for two
invalid values.

### Data and control flow

1. `requestCapabilities` → `projectRequestedCapabilities` validates every listed address with
   `isFieldAddress` (unchanged) and keeps its case. A held grant is not re-projected
   (`dispatcher.ts:665-667`, forwarded as `heldGrants` at `:1403`).
2. Coverage (`isCapabilityCovered`) compares the request with the held grants through
   `sameFieldAddress`: a held scope in another case covers the request, so it leaves the delta
   (`:514-521`), and with an empty delta no window opens (`:1346`).
3. A later call reaches `enforceScopeWithSession` with the raw JSON args (`dispatcher.ts:879-907`).
   Each checker coerces the target with `String(...)` as today, and `matchesPattern` /
   `inAddressList` compare it with `sameFieldAddress`; the explicit `"*"` branches run first.
4. `createAuthWit`: `isCreateAuthWitCoveredByTxOrSimulationScope` uses the same `matchesPattern`,
   so the silent-sign decision (`dispatcher.ts:1176-1182`) and the enforcement agree.
5. Execution parses the target and signs or sends over the parsed value (Fact 16), the same 32-byte
   value the key compared.
6. The window builds its table from `effectiveGrants(heldGrants, delta)` (`index.vue:232-236`);
   `rowFor` keys each contract with `fieldAddressKey(contract) ?? contract.toLowerCase()`. Its rows
   read `dataFieldsCovered` (`build-items.ts:153-160`), which step 2 changed.

### File-level change map

| File | Change |
|---|---|
| `packages/wallet-bridge/src/field-address.ts` | new: `isFieldAddress` (moved), `fieldAddressKey`, `sameFieldAddress` |
| `packages/wallet-bridge/src/field-address.test.ts` | new: the key's table, the invalid-pair rule, the seeded property loop |
| `packages/wallet-bridge/src/index.ts` | `export * from "./field-address"` |
| `packages/wallet-bridge/README.md` | a `src/field-address.ts` row in the file map (`:22-36`) |
| `packages/wallet-bridge/src/dispatcher.ts` | import `isFieldAddress` from the leaf; delete `:314-319`; `:208`, `:224`, `:268` use `sameFieldAddress`; delete the three debug calls at `:1119`, `:1122`, `:1126-1128` |
| `packages/wallet-bridge/src/method-scope-checkers.ts` | header `:4`: the leaf claim names the second leaf; import; `:38-40`, `:54-57` use `sameFieldAddress`. Nothing in `:273-329` |
| `packages/wallet-bridge/src/scope-enforcement.test.ts` | new `describe("a contract in another case")` and `describe("wildcard scopes")`; `CLASS_A` and `"0xbbbb"` become 64-hex values |
| `packages/wallet-bridge/src/dispatcher.test.ts` | the fixture rewrites (Fact 13); in `the grant boundary`: coverage in another case, and the mixed request; in the `createAuthWit` consent suite: a listed scope in another case signs without a window |
| `apps/extension/src/popup/windows/capabilities/details-table.ts` | `rowFor` keys with `fieldAddressKey(contract) ?? contract.toLowerCase()`; its comment states valid-address parity with the check |
| `apps/extension/src/popup/windows/capabilities/details-table.test.ts` | the parity test (below); the existing case-blind test (`:42`) stays |
| `apps/extension/src/popup/windows/capabilities/build-items.test.ts` | one case: private events held in another case add no row |
| `apps/extension/tests/e2e/network/authwit-variants.test.ts` | `connect` takes an optional token address; a fourth test (Ask C-7) |
| `implementations-plan/grant-check-address-case/` + `implementations-plan/index.md` | the plan's first commit |
| `implementations-plan/follow-ups.md` | four entries (§ Follow-ups this plan records) |

### Non-obvious mechanics

- **Why the key cannot widen reach.** A field address is `0x` plus exactly 64 hex digits, and each
  integer in `[0, 2^256)` has exactly one lower-case 64-digit representation. Lower-casing maps
  every spelling of a value to that representation (many spellings, one key), so equal keys imply
  equal bytes; the modulus check keeps out-of-field values out of the relation. Execution parses a
  target to the same value (`AztecAddress.isAddress` accepts either case,
  `aztec-address/index.js:30-31`). The key is stricter than every parser in Fact 16 (it demands
  `0x` and exactly 64 digits), so a spelling execution accepts that the key refuses stays refused
  under a listed scope, as today.
- **Rejection boundaries.** Under a listed scope the checker refuses every target that is not a
  field address of a listed value. Under a wildcard the checker returns before any address is read
  (`method-scope-checkers.ts:39`, `:50`, `:55`), and the target meets the next boundary, unchanged
  by this plan:

  | Method (target) | After a wildcard, rejected by |
  |---|---|
  | `sendTx`, `profileTx`, `simulateTx` (`calls[].to`) | `FunctionCall.schema` → `AztecAddress.schema`: hex, `0x` optional, either case, or a 32-byte buffer form (`operation-planner.ts:207`, `tx-request-builder.ts:338`, `fast-path.ts:110`) |
  | `createAuthWit` (`call.to`, `consumer`) | `AztecAddress.schema.parseAsync` (`execution/service.ts:1051`, `:1065`) |
  | `registerContract` (`instance.address`) | `ContractInstanceWithAddressSchema.parseAsync` (`execution/service.ts:946`) |
  | `getContractMetadata` (address) | `AztecAddress.schema.parseAsync` (`packages/aztec-runtime/src/pxe/service.ts:326`) |
  | `getContractClassMetadata` (class id) | `Fr.schema.parseAsync` (`packages/aztec-runtime/src/pxe/service.ts:369`) |
  | `getPrivateEvents` (`contractAddress`) | `PrivateEventFilterSchema.parseAsync` (`packages/aztec-runtime/src/pxe/service.ts:633`) |
  | `executeUtility`, `grantPublicAuthwit` (`to`, `contract`) | `AztecAddress.fromStringUnsafe`: `Buffer.from(hex)` after an optional `0x`, stopping at the first non-hex pair, then a 32-byte length check (`contract-resolver.ts:129`, `authwit-discoverer.ts:164`; `@aztec/foundation` `dest/string/index.js:13-15`, `@aztec/stdlib` `dest/aztec-address/index.js:19-23`, `:79-81`) |
  | `isTokenRegistered` (address) | nothing: the reader lower-cases and compares against the profile's tokens (`apps/extension/src/wallet/services/wallet-sdk/background.ts:204-207`) |

  So "malformed matches nothing" is a property of listed scopes. A wildcard admits, today and
  after, whatever its downstream admits. Validating before the wildcard returns would tighten
  behaviour beyond this brief; it is a follow-up.
- **The `String(...)` coercion stays.** Over the wire every value is JSON. A one-element array
  `["0x…"]` coerces to its element and matches a listed scope, today and after; the strict
  `AztecAddress.schema` sites above refuse an array, the lenient ones and the reader do not parse
  it as an address. The change neither creates nor widens that path (Ask C-3).
- **Cost.** One regex and one `BigInt` per side per comparison, over at most a scope's patterns
  times a transaction's calls; no caching.
- **The table's parity test** builds the table from grants listing one address in lower, upper and
  mixed case and a second address, and asserts for every pair of those valid spellings: same row
  exactly when `enforceScope("sendTx", …)` with a scope of the first spelling passes a call to the
  second. A malformed string `X` gets one-way assertions only: the table keys it as today (its
  lower-case spelling), and the check refuses `X` paired with every spelling, itself included. The
  valid-pair half is red today (the check refuses the case pairs); it would also pass with P2
  alone, since today's table key already equals the new key for valid addresses, so it proves the
  behaviour and review checks the shared import.
- **Property loop.** 256 values from a fixed-seed generator (a local xorshift, no dependency):
  each value in a random per-digit case matches its lower-case form; flipping any one digit, or
  dropping the prefix, never matches.

### Trade-offs and alternatives not taken

- **Canonicalise at storage** (lower-case in `patternOf` / `addressListOf`, and the call args once
  in the dispatcher): comparisons stay plain `===`. Rejected: it breaks the pin that stored grants
  keep the case sent (`dispatcher.test.ts:1992-2009`), changes the dApp-facing answer, which echoes
  the projected request (`dispatcher.ts:1536-1539`), leaves grants saved today mismatched, and
  needs a second, canonical view of the call args beside the raw ones every handler reads
  (`:879-884` exists to avoid that split). It is `outline-alt.md`.
- **Refuse any address that is not lower case** at projection, and make the table split by exact
  spelling: the check stays exact and the table agrees. Rejected: it fails closed harder for the
  same honest dApp (connect itself errors), and the SDK's own schema accepts either case
  (`AztecAddress.isAddress`), so the wallet would refuse what the protocol allows.
- **Lower-case inline** at each of the six sites: rejected by the brief ("one canonicalisation at a
  boundary, not ad hoc lowercasing"), and inline `toLowerCase()` accepts invalid strings.
- **Reuse `canonicalizeAddress`** (`packages/wallet-core/src/activity/scope.ts:34-36`): it trims and
  lower-cases with no validation, so `"  0xAB "` and `"0xab"` would match. Not reused.
- **A lint or grep gate** against a future exact comparison outside the two matchers: not worth a
  gate; the `sameFieldAddress` TSDoc states the rule.

## Security & Adversarial Considerations

- **Threat model.** The attacker is a connected dApp: it writes the manifest and every call. Its
  aims: a grant that reaches a contract the person did not see, or a silent authwit for one. The
  person's view is the window; the enforcement is the checkers.
- **Widening, bounded.** The change can only make a comparison `true` where both sides are field
  addresses of the same value (§ Non-obvious mechanics). A different contract, a truncated or
  padded spelling, a missing or upper-case prefix, a non-hex or lookalike digit, an embedded
  address or a value at or above the modulus never matches a listed address. `sameFieldAddress` is
  `false` when either side has no key, so two malformed values never match each other; tests pin
  it at the helper and at enforcement, since a bare key comparison would be a fail-open.
- **The wildcard.** `"*"` has no key; `matchesPattern` and `inAddressList` test it before the
  comparison, as today, and what a wildcard admits is unchanged (the boundary table). A call target
  of `"*"` matches only a wildcard scope, as today.
- **Silent signing.** Under an effective consent, a covered call intent signs without a window
  (`dispatcher.ts:1176-1182`). After the change a scope in another case covers it; the authwit is
  computed over `AztecAddress.schema.parseAsync(call.to)` (`execution/service.ts:1051`), the same
  value, and the ABI bind on the name and selector is unchanged (`:1027-1046`). An inner hash still
  always opens the window. The consent logic (`coversAnyContract` / `isAnyContractScope`,
  `method-scope-checkers.ts:422-435`) reads no address value.
- **Window vs enforcement.** Today the table can overstate reach; afterwards, for valid addresses,
  the table and the check use one key, pinned by the parity test. A held malformed value (held
  grants are not re-projected) can still share a row with its other spellings while the check
  refuses it; the table then overstates, never understates, as today.
- **Input validation.** Scope-side validation is unchanged (projection, `dispatcher.ts:332-354`).
  Call-side values are coerced as today and validated by the key at listed-address comparison.
- **Storage and integrity.** No stored byte changes and nothing writes a canonical spelling; the
  row HMAC (`integrity.ts:49-51`) signs the same rows. A request covered only by case skips its
  decision, so a held spelling is kept where an approval would have replaced it. No migration
  (pre-production rule).
- **Logging.** `handleSendTx`'s three debug calls (`dispatcher.ts:1119`, `:1122`, `:1126-1128`)
  interpolate the account, the origin, the session accounts, the fee payer and the additional
  scopes into finished strings the redaction walker cannot read. A request newly admitted by case
  would reach them, so this PR deletes the three calls, and a logger-spy test pins that a
  case-covered `sendTx` logs none of its request values (P2). Otherwise no log line is added; the
  refusal texts are untouched (another package owns them); the key never reaches a log.
- **Fee routing.** `classifyFeePayer` compares `feePayer` with `from` exactly (`fee-payer.ts:63`):
  a case mismatch classifies the payload as `fpc`. `isClaimAndEndSetup` compares the target, the
  selector and the credited payer exactly (`:45-53`); the Fee Juice address has no hex letters
  (`:14`), so only the credited payer can differ by case, and that miss routes `self-pay`, never a
  false `fjwc`. The dApp writes both the scope and the payload, so every such spelling was already
  reachable (write both the same way, or use `"*"`). No new reachability; a follow-up records it
  (Ask C-5).
- **Cryptography, least privilege, supply chain.** None involved: no dependency added, no key
  material, no workflow or permission change. `@aztec/foundation`'s `Fr.MODULUS` (5.2.0, already
  imported by `dispatcher.ts:54`) is the only external value the leaf reads.

## Assumptions

### Facts (verified at `624117cd` by reading the file)

1. `matchesPattern` compares `String(pattern.contract) === contract`
   (`packages/wallet-bridge/src/method-scope-checkers.ts:38-40`); `inAddressList` compares
   `String(item) === address` (`:54-57`).
2. `matchesScope` → `matchesPattern` serves `checkTransactionCalls` (`:119`),
   `checkGrantPublicAuthwit` (`:137`), `checkSimulationTransactions` (`:169`),
   `checkExecuteUtility` (`:191`) and `callWithinTxOrSimulationScope` (`:233-238`), which serves
   `createAuthWit`'s call intent (`:300`), its inner-hash consumer as function `"*"` (`:315`) and
   `isCreateAuthWitCoveredByTxOrSimulationScope` (`:267-271`). `inAddressList` serves
   `requireContractsGrant` (`:67-78`; `registerContract`, `getContractMetadata`,
   `isTokenRegistered`, `:80-93`), `checkGetContractClassMetadata` (`:95-105`) and
   `checkGetPrivateEvents` (`:198-213`).
3. The silent authwit path requires `isCreateAuthWitCoveredByTxOrSimulationScope` and
   `authorizationsEffective` (`packages/wallet-bridge/src/dispatcher.ts:1176-1182`).
4. Projection accepts a listed contract only as `"*"` or `/^0x[0-9a-fA-F]{64}$/` below
   `Fr.MODULUS`, kept in the case sent (`dispatcher.ts:314-319`, `:332-337`, `:350-354`); the
   window's answer is projected again before storage, but an echoed held grant is not
   (`:665-667`, pinned at `dispatcher.test.ts:1970`); held grants reach the window unprojected
   (`dispatcher.ts:1403`). A test pins "valid wire strings pass unchanged, in the case sent"
   (`dispatcher.test.ts:1992-2009`) and the refusals of a short address, a missing prefix and
   values at the modulus (`:2038-2069`).
5. Coverage compares exactly: `contractsRequestCovered` (`dispatcher.ts:208`), `scopeCovers`
   (`:224`), `privateEventsCovered` (`:268`); `:214-217` says coverage mirrors enforcement.
   `contractClasses` coverage is type-only (`:725-726`, pinned by the DRIFT PIN at
   `dispatcher.test.ts:681-684`), an existing limitation this plan leaves alone.
6. The Details table keys rows by `contract.toLowerCase()` and keeps the first spelling
   (`apps/extension/src/popup/windows/capabilities/details-table.ts:69-80`), looks names up by
   that key (`:34-37`) in a list lower-cased at the source
   (`apps/extension/src/wallet/services/dapp-interaction/known-contracts.ts:21`), and is built
   from `effectiveGrants(heldGrants, delta)` (`index.vue:232-236`); its test pins the case-blind
   merge (`details-table.test.ts:42-43`).
7. dApp args reach the checkers as raw JSON: the SDK client posts them untouched
   (`@aztec/wallet-sdk` 5.2.0 `dest/extension/provider/extension_wallet.js:122-126`, `:196-204`),
   the background `JSON.parse`s the decrypted message (`dest/crypto.js:315-316`,
   `dest/extension/handlers/background_connection_handler.js:206-207`), and the dispatcher keeps
   the exact wire values (`dispatcher.ts:879-884`, called from
   `apps/extension/src/wallet/services/wallet-sdk/background.ts:1161`).
8. An `AztecAddress` serializes as `0x` + 64 lower-case hex (`@aztec/stdlib` 5.2.0
   `dest/aztec-address/index.js:146-151`, `@aztec/foundation` 5.2.0
   `dest/curves/bn254/field.js:49-51`); its schema accepts either case and an optional prefix
   (`aztec-address/index.js:30-31`, `:152-158`); the SDK types a pattern's contract
   `AztecAddress | '*'` (`@aztec/aztec.js` 5.2.0 `dest/wallet/capabilities.d.ts:28`).
9. `createAuthWit` signs over the parsed target (`apps/extension/src/wallet/services/execution/service.ts:1051`)
   and consumer (`:1065`), after binding the name to the selector's ABI function (`:1027-1046`).
10. Session rows carry an HMAC over the canonical row
    (`apps/extension/src/wallet/services/dapp-session/integrity.ts:49-51`).
11. The playground writes its `tokenAddress` input verbatim into the scoped bundles
    (`apps/playground/src/lib/bundles.ts:48-51`, `:94-108`), unless a `tokenAddress` URL parameter
    overrides it (`:48-50`); the e2e page carries only `?test=1`
    (`apps/extension/tests/e2e/fixtures/playground.ts:27-28`). Its call-intent button builds the
    call from `AztecAddress.fromStringUnsafe` (`apps/playground/src/sections/authwit.ts:106-110`,
    `:80-94`); `requestPgBundle` sets that input (`fixtures/playground.ts:64-66`).
12. Account-side comparisons are exact: `account-resolution.ts:54`, `:58`,
    `method-scope-checkers.ts:284`, `scope-enforcement.ts:37-45`, `dispatcher.ts:445-456`, and the
    membership filter in `projectSessionAccounts` (`dispatcher.ts:1053`); three others are already
    case-blind (`dispatcher.ts:477-481`, `:610-635`, `:1445-1454`).
13. Non-wire contract fixtures in the tests the strict key reaches:
    - `scope-enforcement.test.ts` passes targets as `{ toString }` objects (`:13`) and uses the
      short class ids `"0xaaaa"` (`:18`) and `"0xbbbb"` (`:231`); its `ADDR_A`/`ADDR_B` are 64 hex
      digits with no letters (`:16-17`), so case-flipping them changes nothing.
    - `dispatcher.test.ts`, turning red under the strict key: `:1632-1636` (`isTokenRegistered` on
      `"0xtok"` expects `true`), `:1653-1661` (expects `/not available/`), `:2484-2521`
      (`executeUtility` on `"0xtok"` expects `/No network configured/`), `:2523-2547` (the reader
      stickiness pin on `"0xtok"`), `:2579-2653` (`grantPublicAuthwit` on `"0xtoken"` expects
      `0xtxhash`), `:2655-2685` (`"0xt"`, expects `/not authorized for this dApp session/`);
      passing vacuously (both sides invalid): `:1638-1641` (`"0xother"` vs `"0xtok"`),
      `:1643-1646` (flag off on `"0xtok"`), `:2734-2778` (`"0xtoken"` vs `"0xOTHER"`).
    - The `createAuthWit` consent suite's `TOKEN` is `0x` + `"07".repeat(32)` (`:2198`): digits
      only.
    - `build-items.test.ts` and `details-table.test.ts` already use wire-shaped `A` / `B` with hex
      letters (`build-items.test.ts:6-7`, `details-table.test.ts:6-9`).
14. `packages/wallet-bridge/package.json` declares no `fast-check`; `apps/extension` and
    `packages/wallet-core` do.
15. The `wallet-safety-fixes` package's `createAuthWit` refusals are at
    `method-scope-checkers.ts:287`, `:302-304`, `:317-319`; this plan edits none of `:273-329`.
16. Execution parses call targets per the boundary table (§ Non-obvious mechanics): `sendTx` /
    `simulateTx` / `profileTx` through `FunctionCall.schema`, whose `to` is `schemas.AztecAddress`
    (`@aztec/stdlib` 5.2.0 `dest/abi/function_call.js:40-50`; parsed at
    `execution/operation-planner.ts:207`, `tx-request-builder.ts:338`, `fast-path.ts:110`).
17. Coverage decides the window's rows as well as whether it opens: the delta keeps only
    uncovered requests (`dispatcher.ts:514-521`), an empty delta returns early without a window
    (`:1346-1357`), and the data rows read `dataFieldsCovered` (`build-items.ts:15`, `:153-160` →
    `dispatcher.ts:255-271`).
18. The answer to a covered request echoes the request for every type but `accounts` and `data`:
    the `accounts` answer carries the stored flags and the projected session accounts
    (`dispatcher.ts:1514-1534`), and the `data` answer comes from the stored grant (`:1536-1537`,
    `dataAnswer` `:732-737`).
19. A checker's `Scope violation` is a plain `Error`; the dApp receives the unclassified-error
    constant "The wallet could not process the request."
    (`apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:177-199`).

### Inferences

1. No production dApp is broken today in a way users have reported; the trigger is a hand-written
   address in another case, since the SDK always emits lower case (Facts 7, 8). The playground e2e
   proves the trigger is reachable on the real wire (Fact 11).
2. The coverage change removes only windows whose request the held grant already reaches (same
   contracts, same functions); whether the person should be asked again anyway is a product
   choice, which O-1 puts to the owner.

### Asks

| # | Who | Question | Recommendation | Confidence |
|---|---|---|---|---|
| O-1 | owner | Should a scope that names a contract in another letter case count as naming that contract? Four consequences: (1) calls to that contract, refused today (the dApp gets "The wallet could not process the request."), are authorized; (2) grants already stored in another case start working, with no rewrite; (3) a re-request differing only in case opens no window, and a window that does open omits a row already held in another case (UI impact's table); (4) under an On authorizations switch, the covered call intent signs without a window. Options: **yes**, ship all four; **no, split**: keep exact matching and make the Details table split by exact spelling, so one contract can show as two rows; **no, refuse**: reject a non-lower-case address when the dApp connects. | Yes: it is the reach the window already shows, it never reaches another contract, and a wildcard's reach is unchanged | high |
| C-1 | codex | Where does the key live: a new leaf `field-address.ts`, or inside `method-scope-checkers.ts`? | New leaf, with `isFieldAddress` moved into it. **Codex: approve.** | high |
| C-2 | codex | Do the three coverage comparisons change with enforcement? | Yes; coverage is documented to mirror enforcement (`dispatcher.ts:214-217`). **Codex: approve**, with Fact 5's `contractClasses` qualification recorded. | high |
| C-3 | codex | Keep `String(...)` coercion on the call side, or require `typeof === "string"`? | Keep it, with the per-method guarantee stated precisely (the boundary table), representative wildcard-path tests, and the coerced-array claim corrected (`isTokenRegistered` does not parse). **Codex: amend**, applied. | moderate |
| C-4 | codex | Account-side comparisons (Fact 12): same PR or follow-up? | Follow-up entry in `implementations-plan/follow-ups.md`, `dispatcher.ts:1053` included: they fail closed, and `account-resolution.ts:1-13` requires the dispatcher and the journal to change together. **Codex: approve.** | moderate |
| C-5 | codex | `fee-payer.ts`'s exact comparisons? | A durable `follow-ups.md` entry, not only PR prose: routing affects setup execution (`fee-payer.ts:1-10`). **Codex: amend**, applied. | moderate |
| C-6 | codex | The table's key for a contract string that is not a field address? | `fieldAddressKey(contract) ?? contract.toLowerCase()`: a held malformed value renders exactly as today, since held grants are not re-projected (Fact 4). **Codex: amend**, applied. | high |
| C-7 | codex | The e2e: a new one-test file, or a fourth test in `authwit-variants.test.ts`? | A fourth test in `authwit-variants.test.ts`, `connect` taking an optional token address, the flake bar filtered by test name. **Codex: amend**, applied: the helpers make it no worse. | high |

### Follow-ups this plan records

Written to `implementations-plan/follow-ups.md` in the delivery PR:

1. Account-side address comparisons are exact (Fact 12, `dispatcher.ts:1053` included); they fail
   closed, and the dispatcher and the journal must change together (`account-resolution.ts:1-13`).
2. `fee-payer.ts` compares exactly: a `feePayer` that differs from `from` only by case is
   classified `fpc` (`fee-payer.ts:63`), and a claim crediting the payer in another case is not a
   claim, so the payload routes `self-pay` (`:45-53`). The Fee Juice address has no hex letters
   (`:14`).
3. A wildcard scope authorizes a call target before it is validated as an address
   (`method-scope-checkers.ts:39`, `:50`, `:55`); the downstream boundaries differ per method, and
   `isTokenRegistered` parses nothing. Tightening it is a behaviour change.

### Plan audit ledger

Round 1 ran in parallel, both legs seeing `plan.md`, `recon.md` and `outline-alt.md`, with the
full packet: adversarial and security, assumption-attack, implementation critique.

- `/codex high` (GPT-6 Astra), session `01a0e970-3cfc-7c00-b6c8-f4613f5016b7`: **conditional
  approve, confidence high** (conditions: its findings 1–7 and the expanded O-1).
- Opus 5.5 (same-family leg): **conditional approve, confidence high** (conditions F1–F3).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex 1 | major | "Malformed matches nothing" ignores wildcard paths; `isTokenRegistered` never parses; the coerced-array claim is not universal | accepted: Outcome 2 and § Security state strict listed-address equality and an unchanged wildcard; the rejection-boundary table; wildcard-path tests in P1; coercion text corrected; tightening recorded as follow-up 3 |
| 2 | codex 2 · Opus F3 | major · medium | The parity test's invalid-string pair is red after the fix; held grants are not re-projected, so a raw-spelling fallback changes rendering | accepted: parity over valid spellings, one-way assertions for `X`; the key is `fieldAddressKey(contract) ?? contract.toLowerCase()`; "agree by construction" scoped to valid-address identity |
| 3 | codex 3 · Opus F1 | major · medium | Non-wire fixtures in `dispatcher.test.ts` turn P2 red or vacuous; the consent suite's `TOKEN` has no letters; missing enforcement-level invalid pair and edge spellings; P3's gate cannot prove the shared import | accepted: Fact 13 inventories both legs' lists, P2 rewrites them with 64-hex constants; the consent case uses an address with letters and asserts its spellings differ; P1 adds the enforcement-level invalid pair, Unicode lookalikes, embedded patterns, a leading-zero-stripped form and the reversed direction; P3 says the gate proves behaviour and review checks the import |
| 4 | codex 4a | major | Newly admitted `sendTx` requests reach `handleSendTx`'s interpolated debug log; remove the interpolation here | accepted after the final pass (disputed in round 1): the three debug calls are deleted in P2, with a logger-spy test; the follow-up is dropped |
| 5 | codex 4b | major | The dApp never receives the literal "Scope violation"; unclassified errors become a constant | accepted: Fact 19; UI impact, O-1 and the P1 e2e text corrected |
| 6 | codex 5 | minor | "Byte-identical answer and storage" is too strong: a covered request skips a decision that would have rewritten storage, and the data answer returns the held spelling | accepted: Outcome 4 reworded; Fact 18; P1's coverage cases assert the repeat answer and the unchanged held grant |
| 7 | codex 6 | minor | Recon misses `dispatcher.ts:1053`; `contractClasses` coverage is type-only; the playground trigger needs its URL override checked | accepted: Fact 12 and C-4 include `:1053`; Fact 5 records the limitation; Fact 11 confirms the e2e page sets no override |
| 8 | codex 7 | minor | Lower-casing is not a bijection; comment rules for the key, the validator and the table | accepted: the unique-lower-case-representation proof; the TSDoc keeps the invalid-pair rule; `:316`'s rationale replaced; the table comment states valid-address parity; the checker header gets a one-phrase correction, no import narration |
| 9 | Opus F2 | medium | Coverage also decides the window's rows, so "UI impact: none" and Outcome 4 are wrong | accepted: UI impact's before/after table, folded into O-1; Fact 17; a `build-items.test.ts` case and the mixed-request dispatcher case |
| 10 | Opus F4 | low | Inference 2 is settled: the tx/simulate parse is `FunctionCall.schema` → `schemas.AztecAddress` | accepted: Fact 16; P1's stop step dropped |
| 11 | Opus F5 | low | The wallet-bridge README file map lacks the new module | accepted: a README row in the change map and P2 |
| 12 | Opus F6 | low | Fact 7 cites `background.ts:1161` without its path | accepted: the repo-relative path |

Final fresh-context pass: `/codex high` (GPT-6 Astra), a new session
`01a0e986-687a-7e60-b8dd-bcb3b5f54fa8`, given this plan with both ledgers: **conditional approve,
confidence high** (conditions 1–4). After the fixes below, the same session re-read the plan:
**approve, confidence high** ("No new material issues or comment concerns").

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 13 | final 1 | major | The fix newly admits requests into `handleSendTx`'s interpolating debug calls; settle the dispute by deleting them | accepted: P2 deletes the three calls and adds a logger-spy test; ledger row 4 and the Decision ledger updated |
| 14 | final 2 | minor | P1 wrongly expects the invalid-pair cases to pass today; identical malformed strings match now | accepted: P1 lists them as expected red, P2 requires them green |
| 15 | final 3 | minor | Fact 18: the `accounts` answer does not echo the request either | accepted: Fact 18 excludes `accounts` and `data` |
| 16 | final 4 | minor | The fee-routing follow-up names the wrong failure: a payer mismatch routes `fpc`, not `self-pay` | accepted: § Security and follow-up 2 distinguish the two routes; the Fee Juice address has no hex letters |

### Decision ledger

- **Outline**: the main outline (key at comparison, stored form unchanged) over `outline-alt.md`
  (canonicalise at storage and at the call boundary); both legs confirmed it: the alternative
  rewrites stored grants and the dApp-facing echo, breaks the `:1992` pin, and splits check from
  use across raw and canonical args. Its one kept idea is the TSDoc rule on `sameFieldAddress`.
- **Rejected**: strict lower-case at projection; inline lower-casing; reusing
  `canonicalizeAddress`; a lint or grep gate (§ Trade-offs); validating before the wildcard returns
  (a tightening, follow-up 3).
- **Settled by the final pass**: `handleSendTx`'s debug interpolation (codex 4a), disputed in round
  1. Ours: the lines already receive a lower-case or wildcard scope's values, so the fix adds no
  data class. Codex: requests the fix newly admits reach the sink, so the "no new request data
  reaches a log" guarantee needs it gone. The final pass sided with codex; the three calls are
  deleted in P2. No point is disputed now.

## Approval

Pending. Done: both legs' round-1 verdicts, the final fresh-context codex pass (approve,
confidence high), C-1 to C-7 logged above. Open: O-1 answered by the owner (it carries the
window change in UI impact), and the ELI5 Artifact URL.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/grant-check-address-case/lessons/phase-N.md`.

### P1 · Red first ✓

1. Commit `implementations-plan/grant-check-address-case/` (`plan.md`, `recon.md`) and its line in
   `implementations-plan/index.md`: `- [grant-check-address-case](grant-check-address-case/plan.md) — in progress — one field-address key for every contract comparison in the grant check and the Details table`.
2. Write the tests that prove the bug, without the fix. Wire-shaped constants throughout: `A` a
   64-hex value with hex letters, `A_UPPER` its upper-case spelling (`0x` kept), `A_MIXED`, and `B`.
   - `scope-enforcement.test.ts`, `describe("a contract in another case")`:
     - `test.each` over sendTx, simulateTx, profileTx, executeUtility, grantPublicAuthwit,
       createAuthWit (call intent and inner-hash consumer), registerContract,
       getContractMetadata, isTokenRegistered, getContractClassMetadata, getPrivateEvents: a grant
       listing `A_UPPER` passes a target `A`, and a grant listing `A` passes a target `A_UPPER`
       (the inner-hash row's pattern names function `"*"`, which an inner hash requires,
       `method-scope-checkers.ts:315`);
     - the same rows throw `Scope violation` for a target `B`; `A`'s digits without `0x`; `0X` +
       digits; `A` with one letter replaced by a Unicode lookalike (Cyrillic `а`, fullwidth `Ａ`);
       `A` embedded (`x${A}`, `${A}${A}`, `${A}\n`); and `A` with its leading zero digit dropped;
     - the invalid pair at enforcement: a grant listing `"0xtok"` refuses a target `"0xtok"`
       (through `matchesPattern` on sendTx, through `inAddressList` on getContractMetadata);
     - `isCreateAuthWitCoveredByTxOrSimulationScope`: covered for `A` under an `A_UPPER` scope;
       not covered without the prefix.
     - `CLASS_A` and `"0xbbbb"` become 64-hex values (they pass today and after).
   - `scope-enforcement.test.ts`, `describe("wildcard scopes")` (pins of today's behaviour; they
     pass before and after): a `contract: "*"` pattern passes a sendTx target without `0x`; a
     `contracts: "*"` grant passes an isTokenRegistered target `"not-an-address"`; a
     `privateEvents: { contracts: "*" }` grant passes a malformed `contractAddress`.
   - `dispatcher.test.ts`:
     - in `the grant boundary`: `test.each` over transaction, simulation, contracts and
       `data.privateEvents`: with a held grant listing `MIXED_CASE`, a request listing its
       lower-case spelling opens no window and writes no decision; the answer equals the request
       for the first three and carries the held `MIXED_CASE` spelling for `data`, and the stored
       grant is unchanged;
     - the mixed request: held transaction on `MIXED_CASE`, a request for a transaction on its
       lower-case spelling plus a `contracts` grant: the window opens with a delta of `contracts`
       only;
     - in the `createAuthWit` consent suite (`:2196`): with a local constant containing hex
       letters (asserting its upper-case spelling differs), a listed scope in upper case, a narrow
       consent and a call intent to the lower-case contract sign without a window.
   - `details-table.test.ts`: the parity test (§ Non-obvious mechanics).
   - `build-items.test.ts`: a held `data` grant with private events on `A_UPPER`, a delta asking
     for the address book plus private events on `A`: only the address-book row is new.
   - `authwit-variants.test.ts`: `connect` gains an optional token address (default
     `aztecConfig!.tokenAddress`); the fourth test, "authwit-callIntent — a request listing its
     contract in upper case starts On: the call intent signs without a window", connects
     `transaction-listed` with the token's address upper-cased (`0x` kept), approves, and requires
     `pg-btn-createAuthWit-callIntent` to answer `ok` with no window (`signWithoutWindow`).
3. Run them and record each red result in `lessons/phase-1.md`. The tests stay uncommitted until
   P2's fix commit (the table and window tests until P3's, the e2e until P4's).

Gate:

- Commands: `bun --bun vitest run src/scope-enforcement.test.ts src/dispatcher.test.ts` in
  `packages/wallet-bridge`; `bun --bun vitest run src/popup/windows/capabilities/details-table.test.ts src/popup/windows/capabilities/build-items.test.ts`
  in `apps/extension`;
  `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/authwit-variants.test.ts -t "in upper case"`
  (it builds the extension itself; `authwit-variants` carries no `@requires-proverless` marker);
  `bun run e2e:reap`.
- Pass criteria: every "passes", "opens no window" and "no row" case above fails, each on its own
  assertion (a `Scope violation` throw, a window opened, a row present, the parity assertion, the
  e2e's `ok` check reading `error`). The invalid-pair cases fail too: today identical malformed
  strings match (`method-scope-checkers.ts:39`, `:56`), so a grant listing `"0xtok"` passes
  `"0xtok"`, and the parity test's malformed self-pair fails. Every "throws" and wildcard case and
  every pre-existing test passes.
- Layers: unit, component, network e2e (Chrome).

### P2 · One key for every contract comparison ✓

1. `field-address.ts`: move `FIELD_ADDRESS` and `isFieldAddress` from `dispatcher.ts:314-319`;
   add `fieldAddressKey` and `sameFieldAddress` with TSDoc stating the contract (the invalid-pair
   rule, and that every grant-to-call contract comparison goes through `sameFieldAddress`). The
   `:316` comment's "coverage compares addresses as strings" rationale is replaced by what the key
   is for. Barrel export; the README file-map row.
2. `field-address.test.ts`:
   - the key: lower, upper and mixed case of one value give the same lower-case string;
     `undefined` for no prefix, `0X`, 63 and 65 digits, a non-hex digit, a Unicode lookalike,
     `Fr.MODULUS`, all `f`, `""`, `"*"`, and a value with surrounding spaces or a trailing newline;
   - `sameFieldAddress` of two invalid values, and of an invalid value with itself, is `false`;
   - the seeded loop (§ Non-obvious mechanics).
3. `method-scope-checkers.ts`: `matchesPattern` and `inAddressList` compare with
   `sameFieldAddress`; the header's leaf sentence (`:4`) names the second leaf.
4. `dispatcher.ts`: import `isFieldAddress`; `:208`, `:224`, `:268` compare with
   `sameFieldAddress`.
   Delete `handleSendTx`'s three debug calls (`:1119`, `:1122`, `:1126-1128`). In
   `dispatcher.test.ts`, one logger-spy test: a held grant listing `A_UPPER`, a `sendTx` to `A`
   from a session account with a fee payer and additional scopes; no logger call at any level
   carries the account, the origin, the session accounts, the fee payer or the scopes (errors
   serialized with their message and stack). It fails before the deletion.
5. `dispatcher.test.ts`: rewrite every red or vacuous fixture in Fact 13 with 64-hex constants
   (distinct values where a test needs two contracts). The old `"0xtok"` success case becomes the
   dispatcher-level invalid pair: a held grant listing `"0xtok"` refuses `isTokenRegistered("0xtok")`.
   Any further red fixture `test:all` finds is rewritten the same way and logged.
6. Commit: `fix(permissions): compare granted contracts by value, not by spelling` with P1's
   wallet-bridge tests.

Gate:

- Commands: `bun run lint`; `bun run typecheck:all`; `bun --bun vitest run` in
  `packages/wallet-bridge`; `bun run test:all`.
- Pass criteria: all exit 0; every P1 wallet-bridge case now passes, including the invalid-pair
  cases; the "throws" and wildcard cases still pass; the logger-spy test passes; `dispatcher.test.ts:1992-2009` passes untouched (stored spellings
  kept); no complexity acceptance added (`bun run lint` runs the baseline check).
- Layers: typecheck and lint, unit.

### P3 · The Details table on the check's key

1. `details-table.ts`: `rowFor` keys with `fieldAddressKey(contract) ?? contract.toLowerCase()`;
   the comment at `:69-70` says the table keys valid addresses as the scope check compares them;
   the `DetailsRow.address` doc stays ("as the app sent it").
2. Commit: `fix(permissions): key the details table by the grant check's address key` with P1's
   parity and `build-items` tests.

Gate:

- Commands: `bun run lint`; `bun run typecheck:all`; `bun --bun vitest run src/popup/windows/capabilities/`
  in `apps/extension`; `bun run test:all`.
- Pass criteria: all exit 0; the parity test, the `build-items` case and the existing case-blind
  test (`details-table.test.ts:42`) pass; the window's component tests (`index.test.ts`) pass
  unchanged. This gate proves behaviour; that `rowFor` imports `fieldAddressKey` is checked in
  review (Outcome 3).
- Layers: typecheck and lint, unit, component.

### P4 · The wire proof and the full gate

1. The new e2e test green on Chrome and Firefox; commit it:
   `test(permissions): a scope in upper case signs a covered call intent without a window`.
2. The scoped-grant network specs on both browsers, retry 0: `authwit-variants`, `cap-window`,
   `cap-request-partial`, `cap-request-repeat-noPopup`, `cap-widening`, `contracts-register`,
   `contracts-getMetadata`, `contracts-getClassMetadata`, `data-privateEvents`,
   `err-scope-and-cap`, `tx-sendTx-multicall`. The list is checked against the files that request
   a scoped bundle or re-request one, and recorded in `lessons/phase-4.md`.
3. Flake bar: the new test, `-t "in upper case"`, three consecutive retry-0 runs per browser.
4. Smoke on Chrome and Firefox (the window's module changed).
5. Every Local gates row: lint, `typecheck:all`, `test:all`, `test:ci-gating`, `build`.
6. `bun run e2e:reap`.

Gate:

- Commands:
  - `bun run lint && bun run typecheck:all && bun run test:all && bun run test:ci-gating && bun run build`;
  - `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent <the eleven files>`;
  - `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent <the eleven files>`;
  - the flake bar: the Chrome and Firefox commands above on `tests/e2e/network/authwit-variants.test.ts -t "in upper case"`, three times each;
  - for `<b>` in `chrome`, `firefox`: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`, then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`;
  - `bun run e2e:reap`.
- Pass criteria: every command exits 0; the flake bar is six consecutive greens; the red result
  from P1 is quoted beside the green in `lessons/phase-4.md`.
- Layers: typecheck and lint, unit, component, smoke e2e, network e2e (both browsers).

## Post-implementation (read by the implementing session)

Single arc: the loop runs once, over the whole diff (`origin/dev...HEAD`), after P4 is green.
`/code-review` is off, so it does not run.

1. **Codex audit**: `/codex high` (GPT-6 Astra) with the diff, this `plan.md` and its decision
   ledger, and the adversarial ask: "What could go wrong? What would an attacker target? What are
   we trusting that we shouldn't? Could any spelling now match a contract it should not? Is there
   an `undefined === undefined` or wildcard path? Do the table and the check disagree anywhere for
   a valid address?"
   Every codex prompt, initial and resumed, carries both rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each
     real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code first (codex can misread it); apply the
   accepted ones, each in its own commit; log the round, its verdict and every rejection with its
   reason in `lessons/phase-4.md`; rerun P4's fast layers (lint, `typecheck:all`, `test:all`) and
   any e2e file the fix touches; then RESUME the same codex session with the fix diff. Stop when a
   round reports nothing material. Still material after three rounds: stop and surface it to the
   owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. **Delivery**, below: the first time a PR exists.

## Delivery

- Single arc, one PR off `dev`, branch `fix/grant-check-address-case`, plain `gh pr create`
  after the loop converges, then `gh pr checks --watch`. `/code-review`: off.
- Title: `fix(permissions): compare granted contract addresses by value, not by spelling` (≤ 93
  characters).
- Commits: conventional, lower-case, signed per this machine's mode; the plan commit first, one
  per phase at least, loop fixes separate.
- Body: the summary; UI impact's before/after table with O-1's answer quoted as the sign-off; the
  Facts behind "never another contract" and the wildcard boundary table; P1's red and P4's green;
  the follow-up it resolves; the three follow-ups it records.
- Do not edit `implementations-plan/ux-feedback/plan.md`: the program's close PR marks the
  follow-up resolved.
- Closing this plan (in the same PR): an `## Outcome` block after the front matter, a
  `lessons.md` line only if a generalizable gotcha came out of it (the `undefined === undefined`
  trap is a candidate), and the three follow-ups in `follow-ups.md`. The move to `archive/` waits
  for the merge.

## Seeds

DRAFT until the approval gate. `/goal` is recommended: every completion signal (gates, codex
quotes, the PR) is in the transcript. Use exactly one per session.

```
/goal Deliver implementations-plan/grant-check-address-case/plan.md from inside .claude/worktrees/grant-check-address-case. Done when plan.md marks P1–P4 ✓, each backed by its validation gate reported passing in the transcript (P1's gate is the recorded red results, P4's includes both browsers' network runs, the six-run flake bar on the new authwit-variants test and both smokes); LESSONS_FILE=implementations-plan/grant-check-address-case/lessons/phase-N.md printed for each phase; /code-review NOT run (code_review: off); the /codex high loop converged, evidenced by a resumed codex pass quoted with no new material findings; `gh pr view` shows the single PR against dev, opened only after the loop converged; `bun run test:all` and `bun run lint` both exit 0 in the transcript. Never merge; UI or product questions go to the owner, technical ones to /codex high; nothing outside plan.md's scope.
```

```
/loop 15m Drive implementations-plan/grant-check-address-case forward from .claude/worktrees/grant-check-address-case. Never idle. Each firing: read plan.md (its Outcome & Quality Bar included) and lessons/; if plan.md has an ## Outcome block or the plan moved to archive/, stop. git status; git log --oneline -5; gh pr view --json statusCheckRollup if a PR exists. No task in hand: take the next unchecked step, run bun run lint and bun --bun vitest run in the touched workspace after each edit, commit. Phase green means its gate as written passes: paste it, mark ✓, write lessons/phase-N.md, print LESSONS_FILE=…. A decision you would bring to me: technical → /codex high, logged; UI/product → hold and ask me. All phases ✓: the Post-implementation loop (codex high, both rules verbatim, resume until nothing material, max 3 rounds), then gh pr create and gh pr checks --watch, then the wrap-up report. Same step failed 5 times: reassess with codex. Hard limits: never merge, never push to dev or main, never expand scope.
```
