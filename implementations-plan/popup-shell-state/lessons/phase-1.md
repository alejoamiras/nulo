# Plan 7 — popup-shell-state — lessons (phase 1: both PRs)

Round-2 plan 7 of 7 — closes the round at manifest 49. PR-a the shell/state batch (BL/C, 62 → 53),
PR-b the mechanical rider (M/E, 53 → 49). One codex session for the plan (blueprint audit → PR-a review →
PR-b review).

## Codex consults

| Turn | Ask | Verdict | Folded |
|---|---|---|---|
| 1 | Blueprint audit | conditional approve | (a) the `next(await …)` guard shape deferred the three synchronous branches by a microtask (the cold-boot strand) → discriminated early result + `createPopupGuard` calling `next` synchronously, pinned with "no service calls" + "next before the callback settles"; (b) `pickFile`'s plain-file path resolves synchronously today → sync classifier + async settler owning resolve/reject (PR-b); (c) `cacheStore.importPromise` holds the CONTROLS, not the promise; (d) the outcome literal is `"unconfirmed"`; (e) test counts corrected (13/15/12/33); (f) app.store: keep factories but explicit named results + documented order + pins for `$state`/`storeToRefs`/classification/return order/alias/`$reset`/one client/watcher order; (g) two activity builders kept (token filter, upstream journal filter, slot accounting, slicing differ) + equal-sort-key and token-presence coverage; (h) one sync unlock-error ladder, re-read `profile.id` at both sites; (i) contact pins: don't duplicate cap/minimal/dedupe/adds-only; add control identity, all early-exit cleanup, partial/total sender toasts, error-object/log order; (j) PR-b pins: ArrowUp + wrap boundaries, files settlement order |
| 2 | PR-a review | conditional approve | (a) BLOCKING: my sync-shaped `registerSenderForRow` returned `addSender(...).then(ok, warn)` — a DERIVED promise the caller awaited (one extra microtask per row) and it moved the `addSender()` call outside the old `try`, so a synchronous throw would escape to the outer import error instead of counting as a sender failure → the caller-owned `try { await addSender; senderOk++ } catch { warn }` is back inline, verbatim; (b) the recent-rows helper declared parallel interfaces (`tokenId: string` where the domain says `number`) that the JS caller hid from typecheck → it now takes `Tx` / `OperationRecord` / `IncomingTransferRecord`; (c) pin counts corrected (11 contact / 5 store / 8 popup); (d) accepted: `unlockActiveProfile`'s adoption microtask (the activation wait checks success/failure before registering its watcher) and `getProfileApi()` being evaluated eagerly on non-early routes |
| 3 | PR-b review | — | — |

## Lessons

- **A Pinia setup store's action identity is not observable.** Pinia wraps every returned function
  separately, so `store.withScopeChangeAllowed === store.commitScopeChange` is false even though the
  setup returned the same function twice; pin the alias behaviorally (both admit a commit when idle).
- **Pre-flush watchers close a guard one tick late.** After `store.profile = …` the in-flight guard
  is still open until `nextTick()`; a pin that asserts "closed until the journal answers" must await
  the tick first, then `waitFor` the reopen.
- **"Sync-shaped helper" is not a free pass: a `.then` relay is a DERIVED promise.** Returning
  `addSender(...).then(ok, warn)` for the caller to await adds a microtask per row and moves the call
  out of the original `try` (a synchronous throw changes class). When a span mixes an awaited branch
  and a sync branch, leave that span inline in the loop — the extraction must happen elsewhere.
- **Parallel "shape" interfaces lie when the caller is JS.** `RecentIncoming.tokenId: string` compiled
  because the `.vue` caller is untyped; the domain type says `number`. Type helpers with the real
  domain types (`Tx`, `OperationRecord`, `IncomingTransferRecord`) and cast the test fixtures instead.
- **JS SFCs take no annotations.** Three of the targets (`NewNetworkPopup`, `auth`, `DropdownRoot`) are
  plain `<script setup>`; helpers there are untyped by necessity, while `Input.vue` is TS.
- **`clearAllMocks` keeps implementations.** A `mockImplementation` installed in one test leaks into the
  next; reset the specific mock in `beforeEach` when a test installs an implementation.
- **A route guard's "early" branches are a timing contract, not just a decision.** Extracting the
  callback itself (`createPopupGuard`) is what makes "next before the first await" testable without
  mounting the app.
- **Narrowing does not survive extraction (again).** The unlock ladder reads `activeProfile?.id` — pass
  the id, not the object, so the helper's identity check compares exactly what the inline code did.

## Gotchas (tooling)

- commitlint's 100-char header bites on descriptive subjects; keep the burn count in the body.
- The pre-commit hook's `biome check --staged` rejects a single over-width fixture line; run
  `biome format --write` on any hand-edited test before committing.
