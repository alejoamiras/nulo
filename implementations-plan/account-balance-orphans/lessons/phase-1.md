# Phase 1 — schema, predicate, stamping, sweep, transition proof

## What landed

- `spec.ts`: `profileId`/`chainId`/`contract` required on `TokenBalanceRaw` + schema.
- `balance-identity.ts` (new): `rowMatchesToken` (FK + triple) and `isLegacyBalanceRow`
  (complete old codec + canonical numeric key identity, per the discharge condition).
- Create path stamps from the held `Token`; `restore()` derives all three fields from
  `tokenService.getTokensRaw(profileId)`, rejects unowned tokens, dedupes `(token, account)`
  pairs (`seen` set, AccountService.restore precedent).
- Legacy sweep at init under the balance lock, before reconcile, via `repo.purgeMalformed`
  (wrapper now threads `storageId` through to the predicate).
- Relink chain map: authority moved to `newTokens[i].chainId`, failed rows excluded from
  BOTH maps (codex Fact 9 / fable C-4a+b).

## Gate evidence

- `bun run lint` — 0 errors (32 pre-existing warnings, untouched).
- `bun run typecheck` — 0 errors.
- token-balance suite: 6 files / 151→27+… all green, including the new
  `balance-identity.test.ts` (19 cases) and the transition describe.
- `useFullBackupImport.test.ts` — 72/72 green with the relink change (its existing relink
  key tests cover the chain-map behavior).

## Findings / notes

- The stricter schema broke exactly 10 type sites, all test fixtures (factories in
  queue/repo/service tests, 4 inline literals, storage-codecs `satisfies` rows, the
  projector factory). `cross-profile-isolation.test.ts`'s `as`-casts did NOT red at
  compile or runtime in this phase — its rows go through paths not yet identity-filtered
  (Phase 2 will revisit).
- The restore suite's token fake had `getTokensRaw: async () => []` — with service-side
  derivation that made every restore row "unowned". Fixed by giving the fake profile-gated
  owned tokens; this is the correct pin of the new invariant, not a workaround.
- Transition test: 200 legacy rows swept + 2 non-legacy survivors (partial-new row,
  key-mismatched row) held; single canonical pair recreated; init bounded (<10s asserted,
  ~ms actual).
- Sweep predicate exactness (the discharge condition) is unit-pinned in
  `balance-identity.test.ts`: type drift per field, new-field presence, `"03"`/`"3e0"`/
  `" 3"` non-canonical keys all refused.
