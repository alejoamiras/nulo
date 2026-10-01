# Recon · grant-check-address-case

Read at `624117cd` (dev). Every line reference below was opened and read; `@aztec/*` references
are to the installed 5.2.0 packages under `node_modules/.bun/`.

## Where a contract address enters the grant check

| Input | Wire shape | Validated where | Case today |
|---|---|---|---|
| Scope pattern `contract` in `requestCapabilities` (transaction, simulation.transactions, simulation.utilities) | a JSON string; the SDK types it `AztecAddress \| '*'` (`@aztec/aztec.js` `dest/wallet/capabilities.d.ts:28`), and an `AztecAddress` serializes as `0x` + 64 lower-case hex (`@aztec/stdlib` `dest/aztec-address/index.js:146-151` → `@aztec/foundation` `dest/curves/bn254/field.js:49-51`) | `patternOf`, `packages/wallet-bridge/src/dispatcher.ts:332-337`: `"*"` or `isFieldAddress` | kept as sent (`dispatcher.ts:316`, "Kept in the case sent: coverage compares addresses as strings.") |
| `contracts.contracts`, `contractClasses.classes`, `data.privateEvents.contracts` | JSON string list or `"*"` | `addressListOf`, `dispatcher.ts:350-354` | kept as sent |
| The window's answer (what is stored) | the popup's echo | projected again, `collectNewGrants`, `dispatcher.ts:665-667` | kept as sent; pinned by `dispatcher.test.ts:1992-2009` ("valid wire strings pass unchanged, in the case sent") |
| A call's `to` (sendTx, simulateTx, profileTx, executeUtility), `grantPublicAuthwit`'s `contract`, `createAuthWit`'s `call.to` / `consumer`, `registerContract`'s `instance.address`, `getContractMetadata` / `isTokenRegistered`'s address, `getContractClassMetadata`'s id, `getPrivateEvents`'s `contractAddress` | raw JSON: the SDK client posts `args` untouched (`@aztec/wallet-sdk` `dest/extension/provider/extension_wallet.js:122-126`, `:196-204`), the background decrypts with `JSON.parse` (`dest/crypto.js:315-316`) and hands the message on (`dest/extension/handlers/background_connection_handler.js:206-207`); the dispatcher never replaces the array (`dispatcher.ts:879-884`) | not validated as an address anywhere before the checker; `assertAuthRelevantArgShape` checks only that `to` exists (`dispatcher.ts:770-774`) | compared as `String(x)` |

`FIELD_ADDRESS` is `/^0x[0-9a-fA-F]{64}$/` with `BigInt(value) < Fr.MODULUS` (`dispatcher.ts:314-319`),
so every projected scope address is already the canonical 32-byte form in some case (held grants
are not re-projected: `dispatcher.ts:665-667`, `:1403`). Downstream parsing differs per method:

- strict `AztecAddress.schema` (either case, `0x` optional, `/^(0x)?[a-fA-F0-9]{64}$/`,
  `dest/aztec-address/index.js:30-31`, `:152-158`): `sendTx` / `simulateTx` / `profileTx` via
  `FunctionCall.schema` (`dest/abi/function_call.js:40-50`; `execution/operation-planner.ts:207`,
  `tx-request-builder.ts:338`, `fast-path.ts:110`), `createAuthWit` (`execution/service.ts:1051`,
  consumer `:1065`), `getContractMetadata` (`packages/aztec-runtime/src/pxe/service.ts:326`);
  `registerContract` via `ContractInstanceWithAddressSchema` (`execution/service.ts:946`),
  `getContractClassMetadata` via `Fr.schema` (`pxe/service.ts:369`), `getPrivateEvents` via
  `PrivateEventFilterSchema` (`pxe/service.ts:633`);
- lenient `AztecAddress.fromStringUnsafe` (`Buffer.from(hex)` after an optional `0x`, stopping at
  the first non-hex pair, then a 32-byte check; `@aztec/foundation` `dest/string/index.js:13-15`,
  `dest/aztec-address/index.js:19-23`, `:79-81`): `executeUtility` (`contract-resolver.ts:129`),
  `grantPublicAuthwit` (`contract-resolver.ts:112`, `:129`, `authwit-discoverer.ts:164`);
- none: `isTokenRegistered`'s reader lower-cases and compares against the profile's tokens
  (`apps/extension/src/wallet/services/wallet-sdk/background.ts:204-207`).

Under a listed scope only a field address of a listed value passes the checker, so these differences
matter only after a wildcard (`method-scope-checkers.ts:39`, `:50`, `:55`), which returns before
reading any address.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Recognise a canonical 32-byte field string | `FIELD_ADDRESS` + `isFieldAddress`, `packages/wallet-bridge/src/dispatcher.ts:314-319` | **adapt**: move both, unchanged, into a new leaf `packages/wallet-bridge/src/field-address.ts` so the checkers can import them without importing the dispatcher; `dispatcher.ts` imports them back |
| One canonical comparison key | none in wallet-bridge. Search trail: `git grep -nE "function (normalize\|canonical)"` over `apps/extension/src` and `packages` finds `canonicalAddress` (`apps/extension/src/utils/transfer-intent.ts:84-88`, validates, never lower-cases, display-only), `canonicalizeAddress` (`packages/wallet-core/src/activity/scope.ts:34-36`, `trim().toLowerCase()` with no validation), `canonicalSlotHex` (`packages/aztec-runtime/src/pxe/note-schemas.ts:31`, storage slots). None validates and lower-cases; wallet-bridge may not import `@nulo/wallet-core/activity` for this without a layering argument, and `transfer-intent.ts` is in the extension app | **build new**: `fieldAddressKey(value: string): string \| undefined` in `field-address.ts`. It is `isFieldAddress` plus `toLowerCase()`, the form `AztecAddress.toString()` produces; nothing existing is both strict and canonical |
| An equality that never matches two invalid values | none | **build new**: `sameFieldAddress(a, b)`, `false` when either key is `undefined` (see "Traps") |
| The scope matcher | `matchesPattern` / `matchesScope`, `packages/wallet-bridge/src/method-scope-checkers.ts:38-52` | **adapt**: `matchesPattern` compares with `sameFieldAddress`; `matchesScope` untouched |
| The address-list matcher | `inAddressList`, `method-scope-checkers.ts:54-57` | **adapt**: same |
| Re-prompt coverage | `contractsRequestCovered` `dispatcher.ts:203-212`, `scopeCovers` `:218-228`, `privateEventsCovered` `:262-271` | **adapt**: same key; `:214-217` says coverage "deliberately mirrors enforcement's shape" |
| The Details table's merge | `rowFor`, `apps/extension/src/popup/windows/capabilities/details-table.ts:69-80` (`contract.toLowerCase()`, `:76`) | **adapt**: key through `fieldAddressKey(contract) ?? contract.toLowerCase()`, imported from `@nulo/wallet-bridge`, so a held malformed value keys as today (the window already imports that package: `details-table.test.ts:2`, `index.vue:38`, `permission-rows.ts:7`) |
| Known-contract names | `knownContracts`, `apps/extension/src/wallet/services/dapp-interaction/known-contracts.ts:13-22`, lower-cases every entry (`:21`) | **reuse-as-is**: for a canonical address, lower-case is the key; the table looks names up by its row key (`details-table.ts:34-37`) |
| Barrel export | `packages/wallet-bridge/src/index.ts:24-30` exports named checker helpers | **adapt**: add `export * from "./field-address"` |
| Property-style tests | `fast-check` is declared by `apps/extension` and `packages/wallet-core`, not by `packages/wallet-bridge/package.json` (isolated linker: an undeclared import is a phantom dependency) | **build new** as a plain seeded loop in the test; no new dependency |
| A real-wire e2e with a scope in another case | the playground puts its `tokenAddress` input verbatim into the scoped bundles (`apps/playground/src/lib/bundles.ts:48-51`, `:94-108`) while its call-intent button builds the call from `AztecAddress.fromStringUnsafe(...)` (`apps/playground/src/sections/authwit.ts:106-110`, `:80-94`), which goes out lower-case; `requestPgBundle` sets that input (`apps/extension/tests/e2e/fixtures/playground.ts:64-66`); `authwit-variants.test.ts:41-83` already drives `transaction-listed` → call intent → no window; a `tokenAddress` URL parameter would override the input (`bundles.ts:48-50`), and the e2e page carries only `?test=1` (`fixtures/playground.ts:27-28`) | **reuse-as-is** (fixtures, bundle, button); **adapt** `authwit-variants`' `connect` with an optional token address and add a fourth test there |

## Every exact-string address comparison in `packages/wallet-bridge/src`

`git grep -n "String(.*) === \|=== String("` plus reading every `.has(`/`===` on an address:

| Site | Compares | Verdict |
|---|---|---|
| `method-scope-checkers.ts:39` `matchesPattern` | scope contract vs call target | **fix** |
| `method-scope-checkers.ts:56` `inAddressList` | contracts / classes / private-events list vs target | **fix** |
| `dispatcher.ts:208` `contractsRequestCovered` | held list vs requested list | **fix** (coverage mirrors enforcement) |
| `dispatcher.ts:224` `scopeCovers` | held pattern vs requested pattern | **fix** |
| `dispatcher.ts:268` `privateEventsCovered` | held list vs requested list | **fix** |
| `method-scope-checkers.ts:284` `checkCreateAuthWit` | accounts grant `item` vs `from` | **account side, out of scope** (lines 276-289 are also where `wallet-safety-fixes` edits the refusal) |
| `account-resolution.ts:54`, `:58` | wallet account vs `requestedFrom` / session set | **account side, out of scope** |
| `scope-enforcement.ts:37-45` `validateAccountScopes` | dApp scope array entry vs session CAIP-10 set | **account side, out of scope** |
| `dispatcher.ts:445-456` `sessionAccountsOf` | builds the exact set the above reads | **account side, out of scope** |
| `dispatcher.ts:1053` `projectSessionAccounts` | `sessionAddresses.has(acc.address)` | **account side, out of scope** |
| `dispatcher.ts:477-481`, `:610-635`, `:1445-1454` | account membership, offered accounts, held-account names | **already case-blind** (`toLowerCase` on both sides) |
| `fee-payer.ts:47-55`, `:62-65` | Fee Juice target, claim beneficiary, `feePayer` vs `from` | **not the grant check** (fee routing); out of scope, a `follow-ups.md` entry |

Coverage does not mirror enforcement everywhere: `contractClasses` coverage is type-only
(`dispatcher.ts:725-726`, the DRIFT PIN at `dispatcher.test.ts:681-684`), an existing limitation.

The account side fails closed today in the same way (an explicit `from` in another case is
"not-authorized"). It is a different surface: `account-resolution.ts:1-13` requires the
dispatcher's and the journal's answers to agree, so changing one comparison there is its own
change.

## Conventions to match

- `method-scope-checkers.ts:1-13` describes itself as a leaf importing only capability types;
  the new import is another leaf, and the header says so.
- Checker refusals are `Scope violation: …` Errors; this change adds none and edits none.
- Tests in `scope-enforcement.test.ts` pass call targets as `{ toString }` objects (`:13`) and the
  checkers coerce with `String(...)`; the new key takes the coerced string, so both keep working.
  Two fixtures there are not wire-shaped and would stop matching under a strict key: `CLASS_A =
  "0xaaaa"` (`:18`) and `"0xbbbb"` (`:231`). Projection refuses both (`dispatcher.test.ts:2045`),
  so they become 64-hex values. `ADDR_A` / `ADDR_B` (`:16-17`) are digits only: a case test needs
  a value with hex letters.
- `dispatcher.test.ts` grants non-wire ids directly in session rows. Red under a strict key:
  `:1632-1636`, `:1653-1661` (`"0xtok"`, `isTokenRegistered`), `:2484-2521` (`executeUtility` on
  `"0xtok"`), `:2523-2547` (reader stickiness on `"0xtok"`), `:2579-2653` (`grantPublicAuthwit` on
  `"0xtoken"`), `:2655-2685` (`"0xt"`); vacuous (both sides invalid): `:1638-1641`, `:1643-1646`,
  `:2734-2778`. The consent suite's `TOKEN` (`:2198`) is digits only.
- The `dispatcher — the grant boundary` suite (`dispatcher.test.ts:1928-2124`) already owns
  `MIXED_CASE`, `BELOW_MODULUS`, `AT_MODULUS`, `ALL_F` (`:1929-1935`): reuse them.
- Component-level window tests colocate (`details-table.test.ts`).

## Traps and collision risks

- **`undefined === undefined`.** A key that returns `undefined` for an invalid string makes two
  invalid values "equal". Every comparison goes through `sameFieldAddress`, which is `false` when
  either side has no key; a test pins an invalid pattern against an invalid target.
- **The wildcard.** `"*"` has no key; `matchesPattern` and `inAddressList` keep their explicit
  `"*"` branch before the comparison.
- **Silent signing.** `isCreateAuthWitCoveredByTxOrSimulationScope` feeds the no-window authwit
  path (`dispatcher.ts:1176-1182`). The fix lets a covered call intent in another case sign
  without a window when the consent is effective. It signs over the same parsed value (above).
- **Stored rows are MAC'd** (`apps/extension/src/wallet/services/dapp-session/integrity.ts:49-51`):
  a comparison-only fix writes nothing new, but a request covered only by case now skips the
  decision that would have replaced the held spelling; the answer then echoes the request, except
  `data`, which comes from the stored grant (`dispatcher.ts:1536-1539`, `:732-737`).
- **Coverage drives the window's rows.** `build-items.ts:153-160` reads `dataFieldsCovered`, and
  the delta filter (`dispatcher.ts:514-521`) decides which types reach the window at all: the
  coverage fix removes rows as well as windows.
- **Held grants are not re-projected** (`dispatcher.ts:665-667`, `:1403`, pinned at
  `dispatcher.test.ts:1970`): a malformed held value can reach the Details table, so the table's
  fallback key must stay `contract.toLowerCase()`.
- **A dApp never sees "Scope violation".** It is a plain `Error`, answered with the
  unclassified-error constant (`apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:177-199`).
- **Overlap with `wallet-safety-fixes`**: it edits the `createAuthWit` refusal messages in
  `method-scope-checkers.ts` (the three `throw`s at `:287`, `:302-304`, `:317-319`). This package
  touches `:1-25` (the header's leaf sentence and imports), `:38-40` and `:54-57` only.
- **Dedup risk**: `transfer-intent.ts:77` defines its own `HEX_ADDRESS_RE` for display; unifying
  it is out of scope (it is an app-side display rule that does not lower-case).
