# QUALITY findings — cluster `extension/wallet-services-platform` + platform/host seam

Scope audited (non-test): `src/core/**` (adapters + testing), `src/utils/core.ts`, and the
`src/utils/**` host-adapter helpers (`files.ts`, `general.js`/`general.d.ts`,
`console-sniffer.ts`, `lastActiveProfile.ts`). The cluster's named `platform` service dir
(`wallet/services/platform/**`) does **not exist** — there is no such directory. The dispatch's
real target was the host seam, audited below.

**Headline verdict on the candidate hypothesis ("chrome.* seam typed with double-casts
*instead of* a typed port boundary"): FALSIFIED.** The `BrowserApi` port exists in
`@nulo/wallet-core/ports` and `core/adapters/chrome-browser-api.ts` *honors* it — every class
`implements` its port (`RealChromeBrowserApi implements BrowserApi`, `ChromeStorageAdapter
implements StoragePort`, etc.), and all 5 `as unknown as` are correctly localized to `chrome.*`
globals where `@types/chrome` overloads are wrong, each with a reason comment, never leaking past
the adapter (every public method returns a port-typed value). This is textbook "cast at the
untrusted edge, clean types inward." **Do not refactor those 5 casts — they are correct.** The
genuine smells are below.

---

### P-1 `AppServices` type-lie: lazily-assigned service clients typed as always-non-null
- Smell: Temporal Coupling (+ "lying types" typing analog — the type asserts a guarantee that
  only holds *after* a separate runtime step, so the type system can't enforce the ordering)
- Lens: typing
- Maintenance impact: structural
- Blast radius: ~44 consumer read-sites across the popup (23× `managers.network`, 16×
  `managers.account`, 5× `managers.transaction`) — `app.vue`, `stores/app.store.ts`,
  `composables/useProfileBootstrap.ts`, the `popups/New*Endpoint`/`NewNetwork`/`EditEndpoint`
  family, `pages/settings/networks/[id].vue`, etc.
- Instances:
  - `src/utils/core.ts:44-50` — `interface AppServices` declares all 5 clients as required,
    non-null.
  - `src/utils/core.ts:75-77` — the lie: `network: null as unknown as NetworkServiceClient`,
    `transaction: null as unknown as TransactionServiceClient`, `account: null as unknown as
    AccountServiceClient` (3 of the 5 `as unknown as` in the file).
  - The ~44 reads above inherit the false "always a live client" guarantee.
- Evidence: only `profile` and `contact` are constructed in `createAppServices()`; the other
  three stay `null` until the popup's unlock flow assigns them (`initTransactionService` at
  `core.ts:132-139` is one such late assigner). The interface and the 3 double-casts exist
  precisely to hide that gap. The file's own JSDoc (`core.ts:38-43`) documents this as a
  "pre-existing contract, intentionally unchanged… tightening it is deferred."
- Why it harms future change: any new popup code that reads `managers.account` (or `.network` /
  `.transaction`) before unlock dereferences `null`/`undefined` at runtime with **zero**
  compile-time warning — the type promises a `…ServiceClient`. Every one of the ~44 sites is
  type-checked against a guarantee the runtime doesn't keep, so the compiler can't catch the one
  call ordered too early.
- Refactoring: *Replace Type Lie with Honest Optionality* — type the 3 lazy fields
  `NetworkServiceClient | undefined` (or split a `LazyAppServices` from the eager
  `{ profile, contact }`). The 3 `as unknown as` casts vanish and all ~44 sites are forced to
  null-check (or assert at a single chokepoint), turning a class of silent runtime nulls into
  compile errors.
- Effort: days (≈44 call-sites need null-handling or a single asserted accessor)
- Confidence: high

### P-2 `chrome.runtime.lastError` workaround duplicated outside the port, with divergent cast idioms
- Smell: Duplicate Code (the same `@types/chrome` `lastError` shim reimplemented), aggravated by
  Inconsistent idiom (`as any` vs `as unknown as` for the identical access)
- Lens: dedup
- Maintenance impact: local
- Blast radius: 2 files
- Instances:
  - `src/core/adapters/chrome-browser-api.ts:136-139` — the canonical version inside the port:
    `(chrome.runtime as unknown as { lastError?: { message?: string } }).lastError`, exposed as
    `RuntimePort.lastError` (the port even documents this contract at `runtime-port.ts:50-54`).
  - `src/utils/files.ts:71-72` — a second copy, **bypassing** the port: `// biome-ignore
    lint/suspicious/noExplicitAny … const err = (chrome.runtime as any).lastError as
    { message?: string } | undefined`. Different idiom (`as any`), same workaround, same shape.
- Evidence: `files.ts` reaches `chrome.runtime`/`chrome.downloads` globals directly instead of
  taking a `RuntimePort`, so it can't use the already-built `RuntimePort.lastError` getter and
  re-derives the cast inline. The two copies will drift when the `@types/chrome` shape changes
  (one is `as any`, one is `as unknown as`).
- Why it harms future change: a fix to the lastError shape (new `@types/chrome`, MV3 change) must
  be found and applied in two places with two different cast styles; missing the `files.ts` copy
  silently reintroduces the bug only on the download path.
- Refactoring: *Extract / Reuse the port getter* — hoist the lastError read into one helper (or
  route `files.ts` through an injected `RuntimePort`). One cast, one idiom.
- Effort: hours
- Confidence: high
- Note for coordinator: popup-side utils accessing `chrome.*` directly (`core.ts` storage,
  `files.ts` downloads, `general.js` permissions, `lastActiveProfile.ts` storage — see scan) is
  a *sanctioned* convention here (biome bans `chrome.*` only in `wallet-core`, not the
  extension; the `BrowserApi` port is a background-DI abstraction never wired into the popup
  process). Per the audit rules it's only flaggable where it costs — i.e. this one duplicated
  cast — not as a blanket "use the port everywhere" finding.

### P-3 `utils/general.js` — lone hand-written `.js` shadowed by a hand-maintained `.d.ts` in a strict-TS package
- Smell: Schema/Type Drift (analog — a type surface maintained in parallel to, and decoupled
  from, its implementation; the `.js` body is invisible to `tsc`)
- Lens: typing
- Maintenance impact: local
- Blast radius: 1 impl file + its `.d.ts`, production-wired (`files.ts` imports
  `ensurePermissions`; theme code imports `persistThemeHint`/`THEME_HINT_KEY`)
- Instances:
  - `src/utils/general.js` — plain JS, no type checking on `debounce`, `ensurePermissions`,
    `persistThemeHint`, etc.
  - `src/utils/general.d.ts` — a separate, hand-written declaration file asserting signatures
    (e.g. `ensurePermissions(perms: chrome.permissions.Permissions)`, `debounce<T extends …>`)
    that nothing verifies against the `.js`.
- Evidence: this is the only hand-authored `.js`+`.d.ts` pair among the ~19 util modules (the
  rest are `.ts`). The declared types are asserted, not inferred — e.g. `general.js`'s
  `ensurePermissions(perms)` takes an untyped param while `general.d.ts` claims
  `chrome.permissions.Permissions`.
- Why it harms future change: edit a signature in `general.js` (add a param, change a return)
  and the `.d.ts` keeps lying to every consumer until someone manually syncs it — the compiler
  can't catch the drift because it only sees the `.d.ts`.
- Refactoring: *Inline the declaration* — rename `general.js` → `general.ts`, delete
  `general.d.ts`, let real annotations/inference carry the types. The parallel drift surface
  disappears and the bodies become type-checked.
- Effort: hours
- Confidence: high (the smell exists); moderate (that it rises to "strong")

### P-4 (minor) Self-inflicted `tb.id as number` from a gratuitously-loose local annotation
- Smell: Primitive Obsession (loosening a domain id to `number | string`) forcing a cast
- Lens: typing
- Maintenance impact: cosmetic/local
- Blast radius: 1 file
- Instances: `src/utils/core.ts:113` annotates the local array `Array<{ id: number | string;
  updatedAt: number }>`, then `core.ts:126` casts it back: `refreshTokenBalance(tb.id as number)`.
- Evidence: the real type is already exact — `TokenBalanceInfo.id` is `number`
  (`token-balance/spec.ts:6,15`) and `refreshTokenBalance(id: number)`
  (`token-balance/client.ts:26`, `spec.ts:41`). The `number | string` union is invented locally
  for no source reason and the cast only undoes it.
- Why it harms future change: a reader can't tell whether the id is genuinely sometimes a string
  (it isn't); the cast suppresses the very check that would catch a future real type change.
- Refactoring: drop the local annotation (let it infer from `getTokenBalances`) — both the union
  and the cast disappear.
- Effort: minutes
- Confidence: high

---

## Out-of-focus notes (not scored — correctness/other, surfaced per audit rules)
- `src/utils/core.ts:97-107` — `managers` is a `Proxy` whose `get`/`set` use `as unknown as
  Record<string|symbol, unknown>` (the other 2 of the file's 5 `as unknown as`). These are the
  *legitimate* internal cost of the deferred-init Proxy mechanism; the external `AppServices`
  type is preserved. Not flagged (defensible; the real issue is P-1's nullability lie, not the
  Proxy).
- `src/utils/files.ts:245` — `inputStream.pipeThrough(compressionStream as any)`, biome-ignored
  ("DOM `CompressionStream` typings diverge across TS lib versions"). A genuine
  lib.dom.d.ts-skew boundary cast, isolated, justified. Not a quality defect.
- `src/utils/console-sniffer.ts:2,8` — 2 `: any` (`pendingLogs: any[][]`, `(...args: any[])`),
  biome-ignored "console.* genuinely accepts any arguments." Correct use of `any` at a truly
  variadic boundary. Not flagged.

## Summary
4 findings (1 structural, 2 local, 1 cosmetic) + the candidate hypothesis falsified (the
chrome.* adapter correctly honors the `BrowserApi` port). Highest-value: **P-1** — `utils/core.ts`'s
`AppServices` types 3 lazily-assigned clients as always-non-null via `null as unknown as T`,
lying to ~44 popup read-sites that get no compile-time protection against accessing a client
before the unlock flow assigns it.
