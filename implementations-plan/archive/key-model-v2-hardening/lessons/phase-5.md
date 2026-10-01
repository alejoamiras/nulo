# Phase 5 lessons — duplicate-phrase warn-and-confirm UI

- **One shared helper, three call sites.** `withDuplicateConfirm(run)` lives in
  `useProfileImportFlow` and wraps the seed, passkey, AND full-backup paths (the backup composable
  receives it as an injected `confirmDuplicate` option). The alternative — three copies of
  catch→dialog→retry — is exactly the drift the plan's own round-1 audit warned about for policy
  checks ("a policy check's guarantee equals the completeness of its call-site coverage").
- **`ConfirmPopup` has NO cancel hook** — it invokes `cacheStore.confirm.callback` on confirm and
  merely emits `onClose` on cancel/dismiss. A naive `new Promise(resolve => callback = resolve)`
  therefore HANGS forever when the user dismisses. Fix: treat the popup-store close transition as
  the cancel signal (`watch(() => popupStore.isOpened("confirm"))`) with an idempotent `settle()`
  so a confirm that also closes can't resolve twice. Worth remembering for any future
  await-the-user dialog.
- **The passkey retry must not re-run the ceremony.** The retry re-invokes the same closure, which
  captures the ALREADY-obtained `credentialData` — so the confirm path costs zero extra WebAuthn
  prompts (pinned by a test asserting the identical credential object on both calls).
- **Adding a store dependency to a composable breaks its unit tests** — `useProfileImportFlow` now
  calls `useCacheStore`/`usePopupStore`, so the test harness needs `setActivePinia(createPinia())`
  in `beforeEach`. Cheap, but it's the kind of thing that turns a green suite red for a reason
  unrelated to the change under test.
- Gate: `bun run audit:vue` typecheck/unit/lint/build legs green (4449 tests; the one red was the
  P6 e2e file's formatting, fixed) + smoke green on P5's code; 14/14 in
  `useProfileImportFlow.test.ts` including the 4 new dup-confirm cases (confirm-retries,
  decline-abandons, passkey-no-second-ceremony, non-duplicate-passthrough).

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-5.md
