# Phase 3 · The dApp's answer on a refusal (O2)

Built as O2 (b), the recommendation; the owner's answer is pending (P6).

## Red run

- The envelope was never changed before this phase, so `85c4d20f` and the P2 head answer a scope
  refusal the same way; the run was taken at the P2 head.
- `error-envelope.test.ts`: the new `ScopeViolationError` case is red, `expected 'The wallet could
  not process the requ…' to deeply equal { code: 4100, …(2) }`; its plain-`Error` line is green (a
  regression control).
- `background.refusal-log.test.ts`: every scope refusal row (21) is red on the envelope alone, the
  wallet answering `"The wallet could not process the request."`. The expected side read `undefined`
  because the envelope constant did not exist yet; the received side is the behavioural fact.
- The raw-hash row moved out of the table into its own test, green before and after: it logs at
  `Error` and answers the unclassified constant (a regression control).
- Totals: 22 failed, 25 passed (47).

## Decisions

- The envelope arm sits after `CapabilityNotGrantedError`'s, the other 4100 grant answer.
  `SCOPE_VIOLATION_ENVELOPE` is one frozen object (its `data` too) shared by every refusal, so no
  sink can edit what the next dApp receives; the unit test pins the literal text and that the
  arm returns that very object.
- The background matrix and the private-events e2e compare against the exported constant (wiring);
  `error-envelope.test.ts` is where the literal public text is pinned.
- The SDK wraps with `jsonStringify(error)`, which is `JSON.stringify` with a replacer and no
  indentation (`@aztec/foundation` `json-rpc/convert.js`), so the e2e's
  `JSON.stringify(SCOPE_VIOLATION_ENVELOPE)` is byte-identical to what the playground records.
- README: the `SCOPE_VIOLATION` shape joins § What other error shapes look like. The stale note
  under § getAccounts said only `getAccounts` throws `CapabilityNotGrantedError`; `enforceCapability`
  throws it for every gated method whose type the session lacks, so the note now says that and
  points at the new shape.
- Lint passed with the new arm: `toWalletResponseError` stays within the cognitive budget
  (Inference 3).

## Gate

- `bun --bun vitest run src/wallet/services/wallet-sdk/error-envelope.test.ts
  src/wallet/services/wallet-sdk/background.refusal-log.test.ts` in `apps/extension`: exit 0,
  2 files, 47 passed. The whole `src/wallet/services/wallet-sdk/` directory: exit 0, 21 files,
  224 passed.
- `bun run lint`: exit 0 (pre-existing warnings only; complexity baseline unchanged).
- `bun run typecheck:all`: exit 0, 15 workspaces.
- `data-privateEvents.test.ts` runs in P5 (network e2e).
