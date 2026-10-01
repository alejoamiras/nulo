# Phase 1 — Runtime: public Transfer events RPC

Log for Phase 1 (`packages/aztec-runtime` — `getPublicTokenTransferEvents` D1 + class gate D2).

## Verified API facts (node_modules, 5.0.1)

- **Transfer event metadata** lives on the bundled user-token = `@aztec-foundation/aztec-standards`
  (NOT `@aztec/noir-contracts.js/Token` — that's the catalog's protocol test token). Import
  `TokenContract` / `TokenContractArtifact` from
  `@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js` (no `exports` field on the
  package → subpath resolves to the file; same path the existing
  `token/functions/descriptors-real-artifact.test.ts` uses).
  `TokenContract.events.Transfer = { abiType, eventSelector: EventSelector.fromString("0x70a1894e"),
  fieldNames: ["from","to","amount"] }`. `from`/`to` are AztecAddress structs, `amount` is u128.
- **Decode recipe** (mirrors aztec.js `getPublicEvents`, `@aztec/aztec.js/dest/api/events.js`):
  `computeLogTag(eventSelector.toField(), DomainSeparator.EVENT_LOG_TAG)` (`@aztec/stdlib/hash` +
  `@aztec/constants`, async → memoize) → `new Tag(field)` → `node.getPublicLogsByTags({
  contractAddress, tags:[afterLog ? {tag,afterLog} : tag], fromBlock, toBlock, referenceBlock })`
  returns `LogResult[][]` (one inner array per tag) → per log `decodeFromAbi([abiType],
  log.logData.slice(1))` yields `{ from: AztecAddress, to: AztecAddress, amount: bigint }`.
- **LogResult** carries `logData, blockNumber, blockHash, blockTimestamp, txHash,
  txIndexWithinBlock, logIndexWithinTx` — all fields the record + cursor + reorg anchor need.
- **`toBlock` EXCLUSIVE** (`logs_query.d.ts` "Upper block bound, exclusive"). `toBlock =
  checkpointed + 1` to include the checkpointed tip.
- **`referenceBlock: BlockHash`** — node THROWS if reorged out (the D6 detection mechanism).
- **Tips**: `node.getBlockNumber("checkpointed"|"finalized")` → plain branded `BlockNumber`
  (`L2BlockTag = 'proposed'|'checkpointed'|'proven'|'finalized'`). NO arithmetic on `getChainTips()`.
- **Class gate (D2)**: `node.getContract(address, "finalized")` (`BlockParameter` accepts the
  `"finalized"` tag) → `ContractInstanceWithAddress | undefined` carrying `currentContractClassId`.
  Compare vs bundled Token class id (`getContractClassFromArtifact(TokenContractArtifact).id`).
  undefined/throw → "unresolved" (fail closed, transient — don't cache); mismatch → "non-standard".
- `MAX_LOGS_PER_TAG = 20`. `AztecAddress.fromBigIntUnsafe(0x1ea7…n).toString()` = MAGIC (32-byte pad).

## Attempts

### Attempt 1 — build the runtime surface (SUCCESS)
- New module `packages/aztec-runtime/src/pxe/public-events.ts`: types + wire zod schemas
  (`PublicTransferEvent`/`PublicEventCursor`/`PublicTransferPage`/`PublicScanTips`/
  `PublicTokenClassStatus`), the `PRIVATE_ADDRESS_MAGIC_VALUE` constant, memoized
  `getTransferLogTag()` + `getBundledTokenClassId()`, and three pure node-facing functions:
  `fetchPublicTokenTransferEvents` (D1 decode+validate), `getPublicScanTips` (D6 tips),
  `resolveTokenClassStatus` (D2 gate).
- **RPC surface decision** — THREE new methods, all `{ rpc: true, ipxe: false, requiresNetwork: true }`
  (SW-only, called by the incoming-transfer service via the SW-side `PxeServiceClient`, exactly like
  the note arm's `getNotes`/`getBlockTimestamp`): `getPublicTokenTransferEvents`, `getPublicScanTips`,
  `getPublicTokenClassStatus`. Split so the Phase-2 service can cache the class gate keyed by the
  finalized tip (cheap tips probe every tick; getContract only when finalized advances).
- Wired `spec.ts` (Methods + type re-exports), `descriptors.ts` (3 entries — the type-asserts
  passed, IPXE subset unchanged at 17), `client.ts` (zod response validation per method),
  `service.ts` (dispatch list + bodies under `withPxeRead`, node-only reads).
- **Gotcha**: `descriptors.test.ts` hardcodes the method count — updated 22 → 25 and extended the
  representative `SW_ONLY` sample.
- **Gotcha**: `BlockNumber` is a branded number — construct query bounds via the `BlockNumber(n)`
  factory from `@aztec/foundation/branded-types`, NOT `as never`/`as BlockNumber`.
- **Gotcha (lint)**: `biome check` reports UNFORMATTED code as *error* severity; ran
  `biome check --write` on the touched files. Repo baseline is 41 pre-existing warnings / 0 errors.

### Validation gate — PASS
- `bun run --cwd packages/aztec-runtime test` → **119 passed** (incl. 20 new in `public-events.test.ts`).
- `bun run lint` → exit 0 (41 pre-existing warnings, 0 errors; verified against stashed baseline).
- `bun run typecheck:all` → exit 0 (all 13 `@nulo/*` packages).
- Named tests all green + present (reviewer-grep: `scannedThrough` ×10, `monotonic` ×2): tag memo,
  from-sentinel decode (pub/private/mint), malformed-log skip, NON-monotonic rejection,
  cursor-beyond-checkpointed rejection, partial-page `scannedThrough`, empty-page `null`, `fromBlock`
  honored (toBlock = checkpointed+1 exclusive), cursor zod round-trip, class-id constant matches
  bundled artifact, upgraded-class → non-standard (node-direct), unresolved fail-closed.

No codex consults needed this phase (surface fully mapped by the plan; APIs verified in node_modules).
</content>
</invoke>
