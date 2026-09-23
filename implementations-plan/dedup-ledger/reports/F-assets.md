# Cluster F — asset services (incoming-transfer, token, token-balance, price, note, contact)

## Cluster verdict

This cluster is markedly denser and more careful than typical LLM output — most of the ~8.4k
lines are concurrency-audited financial bookkeeping (epoch fences, generation fences, lock
discipline) with comments that exist because a specific race was found and fixed, not filler.
`incoming-transfer/service.ts` (2247 lines) is the biggest file but its two scan arms (private
notes vs public events) resist collapsing: their per-copy duplication mostly runs under ~20 lines
each, which the review's own threshold rules out as a new-abstraction target, and the file's
extensive "codex R1/R2 audit" trail shows every asymmetry between the two arms is likely
deliberate. The real, cheap wins are mechanical: `note/service.ts` has eight one-line
try/catch accessor methods that are pure copy-paste, `token/service.ts` has a 9-way
copy-pasted resolve-candidates block inside `parseTokenInterface`, and `token-balance/service.ts`
repeats the same delete-and-invalidate triplet three times. None of the balance/token
bookkeeping split between `token/` and `token-balance/` is actually duplicated logic — the two
services intentionally keep independent copies of `Token` metadata for different reasons (SoR vs
active-profile cache) and share the real cross-cutting pieces (`rowMatchesToken`, `getTokenInfo`,
`purgeRows`) already. Rough total removable: **60–90 LOC**, concentrated in the three findings
below; the single biggest lever is the `note/service.ts` safe-accessor collapse (best LOC/risk
ratio).

## Findings

### F1 [duplication] Eight near-identical single-line safe accessors in `note/service.ts`

- **Where:** `apps/extension/src/wallet/services/note/service.ts:144-206` (8 methods), called from `apps/extension/src/wallet/services/note/service.ts:105-127`.
- **Evidence:**
  ```ts
  private safeContractAddress(note: NoteDao): string {
      try { return note.contractAddress.toString() } catch { return "" }
  }
  private safeStorageSlot(note: NoteDao): string {
      try { return note.storageSlot.toString() } catch { return "" }
  }
  private safeTxHash(note: NoteDao): string {
      try { return note.txHash.toString() } catch { return "" }
  }
  private safeSiloedNullifier(note: NoteDao): string {
      try { return note.siloedNullifier.toString() } catch { return "" }
  }
  private safeNoteHash(note: NoteDao): string {
      try { return note.noteHash.toString() } catch { return "" }
  }
  ```
  and the numeric trio:
  ```ts
  private safeBlockNumber(note: NoteDao): number {
      try { return Number(note.l2BlockNumber) } catch { return 0 }
  }
  private safeTxIndex(note: NoteDao): number {
      try { return Number(note.txIndexInBlock) } catch { return 0 }
  }
  private safeNoteIndex(note: NoteDao): number {
      try { return Number(note.noteIndexInTx) } catch { return 0 }
  }
  ```
  Both the success and failure branches of `getNotesRaw` (lines 105-112 and 116-127) call all
  eight, each in its own field position.
- **Refactor:** Replace all eight with two generic private helpers:
  ```ts
  private safeToString(get: () => { toString(): string }): string {
      try { return get().toString() } catch { return "" }
  }
  private safeToNumber(get: () => unknown): number {
      try { return Number(get()) } catch { return 0 }
  }
  ```
  Call sites become `this.safeToString(() => note.contractAddress)`, etc. Optionally also fold the
  5-field identity object built identically in both the success and failure branches of
  `getNotesRaw` (`siloedNullifier`/`noteHash`/`l2BlockNumber`/`txIndexInBlock`/`noteIndexInTx`) into
  one `buildSafeIdentity(note)` helper used by both branches. Lives entirely inside
  `apps/extension/src/wallet/services/note/service.ts` — no cross-package change.
- **LOC delta:** -30 to -35.
- **Risk / tests:** low. Covered by `apps/extension/src/wallet/services/note/service.test.ts`
  (specifically the "malformed entry preserves contract/slot/tx fields when those parse ok" and
  "a single malformed note does NOT blank out the rest of the list" cases, which exercise both the
  success and catch paths through every one of these fields).
- **Confidence:** high.

### F2 [duplication] Nine-way copy-pasted candidate/fn resolution in `token/service.ts#parseTokenInterface`

- **Where:** `apps/extension/src/wallet/services/token/service.ts:612-643`.
- **Evidence:**
  ```ts
  const getNameFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getName, artifact)
  const getNameFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.getName, getNameFnCandidates)

  const getSymbolFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getSymbol, artifact)
  const getSymbolFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.getSymbol, getSymbolFnCandidates)

  const getDecimalsFnCandidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.getDecimals, artifact)
  const getDecimalsFn = getDefaultTokenFn(TOKEN_FN_DESCRIPTORS.getDecimals, getDecimalsFnCandidates)
  ```
  …repeated verbatim (same two-line shape) for `balanceOfPrivate`, `balanceOfPublic`,
  `transferPublic`, `transferPrivate`, `transferPrivateToPublic`, `transferPublicToPrivate` — 9
  kinds total, exactly `TokenFnKind`'s full union (`apps/extension/src/wallet/services/token/functions/types.ts:9-18`).
- **Refactor:** The kind list and per-kind descriptor lookup already exist
  (`TOKEN_FN_DESCRIPTORS`, `TokenFnKind`). Replace the 32-line block with a loop over the 9 kinds
  into two `Map<TokenFnKind, …>`s (fully typed, no cast needed):
  ```ts
  const candidatesByKind = new Map<TokenFnKind, Fn[]>()
  const fnByKind = new Map<TokenFnKind, Fn | undefined>()
  for (const kind of ALL_TOKEN_FN_KINDS) {
      const candidates = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS[kind], artifact)
      candidatesByKind.set(kind, candidates)
      fnByKind.set(kind, getDefaultTokenFn(TOKEN_FN_DESCRIPTORS[kind], candidates))
  }
  ```
  Leave the final `TokenInterface` object literal (lines 645-667) as explicit named fields reading
  from `fnByKind.get("getName")`/`candidatesByKind.get("getName")` etc. — that keeps the public,
  widely-consumed `TokenInterface` shape fully type-checked with zero `as`/`any`, and confines the
  change to a private local inside `parseTokenInterface`. (Do not attempt to also collapse the
  `TokenInterface` literal itself into a loop — its 18 fields are the wire shape consumed across
  the tools/extension UI, and a dynamic-keyed construction there would need an unsafe cast; not
  worth the risk for this cluster's scope.)
- **LOC delta:** -20 to -24.
- **Risk / tests:** low-medium (touches token-import parsing, but the change is a pure mechanical
  loop over already-tested descriptor lookups). Covered by
  `apps/extension/src/wallet/services/token/service.test.ts`,
  `apps/extension/src/wallet/services/token/functions/token-functions.characterization.test.ts`,
  and `apps/extension/src/wallet/services/token/functions/descriptors-real-artifact.test.ts`.
- **Confidence:** medium (mechanical, but `parseTokenInterface` is a security-sensitive
  contract-introspection path, so verify no code depends on the exact declaration order of the
  9 `const`s, e.g. via error-ordering — none observed, but flagging for reviewer attention).

### F3 [duplication] Repeated delete-and-invalidate triplet in `token-balance/service.ts`

- **Where:** `apps/extension/src/wallet/services/token-balance/service.ts:509-528` (`onTokenDeleted`),
  `:535-561` (`purgeForTokens`), `:569-598` (`purgeForAccounts`) — same 4-line body inside three
  different filter loops.
- **Evidence:**
  ```ts
  // onTokenDeleted (522-526)
  for (const tb of (await this.repo.getAll()).filter((x) => rowMatchesToken(x, token))) {
      this.invalidatedBalanceIds.add(tb.id)
      await this.repo.delete(tb.id)
      this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb, token))
  }
  ```
  ```ts
  // purgeForTokens (541-547)
  for (const tb of (await this.repo.getAll()).filter((x) => set.has(x.token) && x.profileId === profileId)) {
      this.invalidatedBalanceIds.add(tb.id)
      await this.repo.delete(tb.id)
      const live = this.tokens.get(tb.token)
      if (live && rowMatchesToken(tb, live)) this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb))
  }
  ```
  ```ts
  // purgeForAccounts (575-584)
  for (const tb of (await this.repo.getAll()).filter(
      (row) => row.profileId === profileId && keys.has(`${row.chainId}:${row.account}`),
  )) {
      this.invalidatedBalanceIds.add(tb.id)
      await this.repo.delete(tb.id)
      const live = this.tokens.get(tb.token)
      if (live && rowMatchesToken(tb, live)) this.emit("onTokenBalanceDeleted", this.getTokenBalanceInfo(tb))
  }
  ```
- **Refactor:** Extract a private helper (in the same file, private — this is service-local
  bookkeeping, not a candidate for a shared package):
  ```ts
  private async deleteAndInvalidate(tb: TokenBalanceRaw, tokenInfo?: TokenInfo): Promise<void> {
      this.invalidatedBalanceIds.add(tb.id)
      await this.repo.delete(tb.id)
      const info = tokenInfo ?? (() => {
          const live = this.tokens.get(tb.token)
          return live && rowMatchesToken(tb, live) ? undefined : undefined // see note below
      })()
      ...
  }
  ```
  Simpler and safer: keep the emit-gating logic explicit at each call site (it legitimately
  differs — `onTokenDeleted` always has a `TokenDeleted` to hand in; the two purge paths must
  re-check `this.tokens` liveness because the row may already be foreign/dead) but factor only the
  invariant three lines (`invalidatedBalanceIds.add` + `repo.delete` + the shared filter idiom)
  into `private async deleteBalanceRow(id: number): Promise<void> { this.invalidatedBalanceIds.add(id); await this.repo.delete(id) }`,
  then keep each call site's own emit-decision one line below it. This is the lower-risk cut (2
  lines saved ×3 instead of trying to unify the emit-gating asymmetry).
- **LOC delta:** -8 to -12 (conservative cut); up to -18 if the emit-gating is also unified behind
  a `(tb, tokenInfoOrNull) => void` callback param.
- **Risk / tests:** low-medium — this is concurrency-sensitive purge code (fenced by
  `invalidatedBalanceIds` and the service lock), so preserve exact ordering
  (`invalidate → delete → emit`) in the extracted helper. Covered by the very large
  `apps/extension/src/wallet/services/token-balance/service.test.ts` (1268 lines), which exercises
  `onTokenDeleted`, `purgeForTokens`, and `purgeForAccounts` directly.
- **Confidence:** high on the pattern match, medium on the exact extraction shape (the three
  call sites' emit-gating genuinely differs, so don't over-collapse).

## Not worth it

- **`incoming-transfer/service.ts`'s parallel note/public-event arms** (`resolveNoteTrust` vs
  `resolvePublicTrust`, `commitDiscoveredNote` vs `commitPublicRecord`, `startScheduler` vs
  `startPublicScheduler`) look like textbook duplication but each pairwise copy is under 20 lines,
  which this review's own bar excludes from a new-abstraction proposal at only 2 occurrences; the
  file's dense "codex R1/R2/R3 audit" comments also indicate the asymmetries between the two arms
  (e.g. the public arm's extra post-park epoch re-checks) are deliberate hardening, not oversight —
  merging them risks silently dropping a check one arm has and the other doesn't.
- **`token/functions/descriptors.ts`** (437 lines, 9 near-mechanically-structured descriptor
  objects) is explicitly documented as "the data-driven replacement for the 9 copy-paste
  token-function modules… reproduce the old module's literals EXACTLY… Do not 'improve' while
  transcribing" and is pinned by characterization + real-artifact tests. Already the result of a
  prior dedup pass; not a re-dedup target.
- **`TokenInterface`'s 18-field shape** (`token/spec.ts:84-137`, 9 kinds × `{fn, candidates}`) is
  repetitive by construction but is a wire type consumed across the tools/extension UI outside
  this cluster — collapsing it into a keyed record would ripple far beyond `apps/extension/src/wallet/services/**` and was left alone.
- **The `browserApi ? new X(...) : new X(..., chrome.storage.local, ...)` fallback ternary**
  appears in `contact/service.ts:58-60` and `price/service.ts:108-110` (2 occurrences, each
  2-3 lines) — below both the line-count and occurrence-count bar for a new abstraction; a
  one-line `const area = browserApi?.storage.local ?? chrome.storage.local` per site would be a
  trivial local simplification but isn't worth a cross-file finding.
- **The six `client.ts` files** (`incoming-transfer`, `token`, `token-balance`, `price`, `note`,
  `contact`) all follow the identical `definePassthroughsExhaustive` + declaration-merge
  boilerplate, including a verbatim `biome-ignore` comment. This is already the minimal shape the
  shared `extension-messaging` framework requires per service (a method-name list plus event
  handler declarations) — not further reducible from inside this cluster.
- **Dead-code sweep**: `token/default-tokens.ts:72` (`seedsForChain`), and several
  `incoming-transfer`/`price` pure helpers (`comparePublicPositions`, `trustKey`,
  `orderByBlockIndex`, `rateToMicroUsdCeil`) have no importer outside their own unit test — but
  each is 1-3 lines with a dedicated pin test, so removing the `export` would save ~0 real LOC and
  isn't worth flagging against the ≥20-line dead-code bar.
