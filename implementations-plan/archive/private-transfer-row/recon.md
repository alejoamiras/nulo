# Recon: private-transfer-row

Read-only sweep at `3452ac3b` (origin/dev, 2026-10-01): one batched reuse agent over eight
capabilities, plus the driver's own reads of the Token sources and the card. Line numbers were read
in that tree. Paths are repo-relative; a `node_modules` path names the installed package.

## Reuse map

| # | Capability needed | Existing code | Verdict |
|---|---|---|---|
| 1 | One list of the names the authwit nonce goes by, read by the wallet's predicate and the card | None shared. Inline at `descriptors.ts:247` (the emitted role), `:279` (the predicate's two names), `call-surface.ts:84-89` and `:100` (the card's one name). | **build new** (`AUTHWIT_NONCE_NAMES` in `descriptors.ts`: the predicate already holds the alias, and the vocabulary already imports that leaf, so no cycle); **adapt** the predicate and `corroborates` |
| 2 | Whether an interface's parameter name fills a vocabulary role | `corroborates` compares strings (`call-surface.ts:98-101`) | **build new** (`abiNameFitsRole` in `token-transfer-vocabulary.ts`, the display vocabulary's home); **adapt** `corroborates` |
| 3 | Reading the transfer's arguments by role | `parseTransferIntent` (`transfer-intent.ts:38-70`) reads by role position, keys the nonce on the role name (`:62-66`) | **reuse-as-is** |
| 4 | Rendering the nonce | `CallArguments.vue:67-70`, the only renderer, mounted three times (`OperationCard.vue:228`, `:271`, `:502`) | **adapt** the cell; reuse `valueText`/`valueTitle` (`call-surface.ts:150-180`) and `smallFieldDecimal` (`transfer-intent.ts:110-113`) |
| 5 | A real-decode card test on the standard Token | `OperationCard.wire.test.ts` (jsdom, real interface, selector stood in for `transfer_private_to_private` only, `:32-37`) | **adapt** (its pins at `:104-106` describe today's decoded reading) |
| 6 | Role-valued fixture helpers | `value()`/`abi()` in `call-surface.test.ts:17-30` and `OperationCard.fallback.test.ts:40-52` (both hard-code `role === "authwit_nonce"` for the field kind) | **adapt** (map `_nonce` to the field kind too) |
| 7 | A node-environment test with real selectors over the installed Tokens | None. Precedents: `authwit-discoverer.real.test.ts`, `stale-anchor.real.test.ts`, `fast-path.test.ts` | **build new** (`token-transfer-vocabulary.real.test.ts`): it pins row 13's table against the real hash and both installed Tokens. A real decode-to-card test was planned and dropped after the audits: the jsdom wire test runs the real decoder over all four transfers once its stand-in maps their selectors |
| 8 | A network e2e that registers the token and reads the card | None. Every execute-window spec drives `pg-btn-sendTx-*` with the token unregistered; `register-token.test.ts` reads the `registerToken` window only | **build new** (`tx-transfer-row.test.ts`), reusing `importToken` (`fixtures/helpers.ts:906`), `rejectExecute` (`fixtures/popups.ts:468`), `shotSend` (`fixtures/send-page.ts:209-235`) |
| 9 | Pictures without a network | No Storybook story covers `src/popup/**` (`.storybook/main.ts:20-26`); `shotSend` needs the sandbox | **adapt** a throwaway harness for the plan's pictures (never committed); `shotSend` for the as-built ones |
| 10 | Display interface resolution that prefers the compiled-in copy | `ArtifactPolicy.byClassId`, `setPolicy`, `hasKnownClassId` (`packages/aztec-runtime/src/pxe/artifact-registry.ts:24-31`, `:98-104`, `:122-125`, `:165`), no production caller | **out of scope** (Ask A2); the seams exist |
| 11 | Glossary and copy rules | `glossary.ts` (nine keys, none for authwit or nonce), `copy-dash-ban.test.ts` | **reuse-as-is**: no new term, no new dotted term |
| 12 | The title above a structured row | `callName` (`call-surface.ts:124-129`) uses the decoded name for a `decoded` surface only; a `transfer` or `mint` surface is titled by the wire label (`OperationCard.vue:225`, `:498`). Found by both plan audits, missed by this sweep | **adapt**: the structured surfaces carry `fn`, and `callName` uses it |
| 13 | Which function a call runs, whatever interface the wallet holds | None. The decoder trusts the interface's own name-to-selector mapping (`contract-resolver.ts:64-74`); nothing compares a call's selector with a selector the wallet derives itself. Searched `vocabulary`, `fromNameAndParameters`, `selector` under `apps/extension/src/{utils,popup}` | **build new**: a static table of the vocabulary's 16 selectors in `token-transfer-vocabulary.ts`, pinned by row 7's test |

## 1. Where the nonce's name lives

- `descriptors.ts:247` mints the role (`nonceParam`, `authwit_nonce`), used by `transfer4Abi` at
  `:255`; `:279` accepts `authwit_nonce` or `_nonce`; `:329` builds wallet transfers with nonce 0.
  The header (`:6-11`) says each entry reproduces its original module verbatim, pinned by
  `token-functions.characterization.test.ts` (it also names a `registry-equivalence.test.ts` that
  no longer exists). No unit test exercises the predicate's `_nonce` branch on its own; only
  `descriptors-real-artifact.test.ts:48-63` reaches it through the real interface.
- `token-transfer-vocabulary.ts:42` derives role lists from `abiBuilder`; it imports the
  descriptors leaf directly (`:11`, to keep the runtime out of popup bundles).
- `call-surface.ts:84-89` (`ROLE_KIND`), `:98-101` (`corroborates`: equality, then a lookup keyed
  by the decoded name, so `_nonce` fails twice).
- `transfer-intent.ts:62-66` reads the nonce by the role name from the vocabulary, never the
  decoded name; renaming the role would drop the nonce silently.
- Snapshot `functions/__snapshots__/token-functions.characterization.test.ts.snap` holds
  `authwit_nonce` ten times from `abiBuilder`; the plan leaves the role alone, so it does not move.
- Absence trail: `grep -rIn "authwit_nonce"` over `apps packages scripts infra` (no node_modules):
  11 files, all named above or tests; `grep -rIn "\b_nonce\b"`: only `descriptors.ts:236,279` and
  `OperationCard.wire.test.ts:94,106`. Every other `nonce` hit is a transaction, account, session
  or chunk nonce.

## 2. Consumers

- `findTransferSignature`/`findMintSignature`: `call-surface.ts:92`, `transfer-intent.ts:44-46`.
- `transferLabel` → `getMethodLabel` → `humanizeMethodName` (`tx-enrichment.ts:7,36`): labels by
  name only. Which name it gets depends on the surface (row 12): the decoded name for decoded rows,
  the dApp's label for transfer and mint rows. So the title of a call that moves from decoded to
  transfer changes source, and a lying label shows (corrected after the plan audits; this line
  first said the titles could not change).
- `parseTransferIntent`: `call-surface.ts:73` only.
- Activity, journal and history never read the transfer nonce or argument names; `pages/tx/[id].vue`
  shows the entrypoint's transaction nonce, a different value.
- The card's "registered" test is `tokenAt` (`call-surface.ts:59-66`), fed by
  `tokenService.getTokens` in `execute/index.vue:430-436`; the popup's `TokenInfo` carries no class
  id.
- `src/utils` is auto-imported (`apps/extension/vite.config.ts:111`): a new export there rewrites
  the tracked `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` on the next
  dev server or build; test runs do not (`dts: false`).

## 3. Test conventions to match

- Tests through the real decoder need field-valid values (`0x00` + 62 hex digits): `Fr` refuses a
  value at or above the modulus, and the decoder turns that into `undecoded/arguments`.
- CLAUDE.md § UI changes: a dApp-facing card test feeds at least one wire-shaped fixture.
- Selector stand-ins under jsdom: per-file `vi.spyOn(FunctionSelector, "fromNameAndParameters")`
  with recorded real selectors (`OperationCard.wire.test.ts:35`). Real hashing needs
  `// @vitest-environment node` on line 1 (13 files use it); jsdom makes poseidon take the sync
  bb.js branch, which throws `std::bad_cast` (`authwit-discoverer.real.test.ts:1-10`). A mounted
  card needs jsdom, so a card test and a real-hash test are different files.
- File names: `Name.variant.test.ts`, colocated.
- Four card tests rebuild the same `sendTx()` shape (wire, fallback, createAuthwit, discovered);
  there is no shared helper module, and the plan does not add one.

## 4. The display decode and interface resolution

- `execute/index.vue:412-427` and `:455` call `decodeCallsForDisplay` (`service.ts:632-653`):
  instance (`pxe/service.ts:324-366`), then the class's interface through `ArtifactRegistry.resolve`
  (`artifact-registry.ts:159-175`), order `["pxe-local", "known"]` (`:33-35`). A PXE-local copy is
  checked against the class id (`:183-185`, `:203-215`); the compiled-in copy is not recomputed.
- `decodeCallForDisplay` (`call-decoder.ts:30-48`) finds the function by selector (`:61`;
  `contract-resolver.ts:64-74` hashes each entry's name and parameter types), and emits parameter
  names verbatim.
- A dApp-supplied interface is accepted by both registration paths when it hashes to the
  instance's class (`service.ts:815-851`, `register_contract`; `:956-997`, `aztec_registerContract`).
  stdlib's class id does not cover parameter names or public interface entries
  (`@aztec-labs/stdlib` 6.0.0-rc.1, `dest/contract/artifact_hash.js:55-117`,
  `dest/contract/contract_class_id.js:19-36`). So the same class can show different parameter names
  in the decoded rows, depending on which copy the PXE holds. Nothing in the display path compares
  a class id with the catalog (`packages/aztec-runtime/src/pxe/artifact-catalog.ts`, twelve keys,
  `wonderlandToken` at `:69`).

## 5. The tokens

- aztec-standards 6.0.0-rc.1 Token (`@wonderland-token-artifact`, the playground's and every e2e
  token): `_nonce` 18 times, `authwit_nonce` none. The four transfers, two burns and three
  commitment transfers all take `_nonce`. The embedded sources (`target/token_contract-Token.json`,
  `file_map`) show `#[authorize_once("from", "_nonce")]` on each (main.nr 125-314, 474-493) and the
  macro's expansion (aztec-nr v6.0.0-rc.1 `helpers.nr` 48-124).
- aztec-nr's sample Token (`@aztec-labs/noir-contracts.js` 6.0.0-rc.1, catalog key `token`):
  `authwit_nonce` 16 times, `_nonce` none.
- `DEFAULT_TOKEN_SEEDS` is empty (`default-tokens.ts:36`).

## 6. The playground

- Default send: `transfer_public_to_public(from, to, amount, BigInt(i))`
  (`apps/playground/src/sections/transactions.ts:64`), nonces 0 to N−1 in the multicall.
- Call-intent authorization: `transfer_public_to_public` with the `authwitNonce` input (default
  `"1"`), `pg-btn-createAuthWit-callIntent` (`apps/playground/src/sections/authwit.ts:79-111`).
- No private transfer of the standard Token is reachable from the playground; the node test covers
  the other three by real selector.

## 7. Copy and glossary

- `CallArguments.vue` copy: "Caller:", "none", "From:", "this account (…)", "To:", "Mint to:",
  "Amount:", "base units", "Authwit nonce:". None dotted, none in the glossary. No test pins
  "From:", "To:", "Amount:" or "Authwit nonce:".
- The e2e suite selects by `data-testid` only and counts payload rows in one place
  (`tx-sendTx-multicall.test.ts:66`).
