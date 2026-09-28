# Phase 8 · The owner's stack sign-off ✓

The owner answered the stack's sign-off page on 2026-09-28
(<https://claude.ai/artifact/WD1NGANFrHcE7fsrJKXPMp>, its `answers` store): "No chip when fiat
is off" and "Keep today's row", both as built. The note on "Everything else" said the onboarding
import's toast "should not pop-up on the onboarding"; the rest was signed off as built.

## The change

- `onboarding/pages/import.vue` no longer opens a success snack when an import finishes
  ("Profile imported", or "Profile imported. Unlock to continue." when the session could not be
  confirmed). It still goes on to `/onboarding/learn`. The popup's import keeps its snack, and
  onboarding keeps the Terms page's error and the import form's "Error is copied".
- `onboarding/pages/import.test.ts` pins it. A phrase import runs through the real
  `useProfileImportFlow` handler for both outcomes, a session that activates and one left
  locked. Each case asserts one `importMnemonic` call, the push to `/onboarding/learn` and an
  empty `@nulo/design` toast singleton, so a snack opened by any caller fails it.
  - Against the page before the fix, both cases failed with the success snack open.
  - With the fix and a success snack opened in the shared flow right after the page's
    completion, both failed the same way.
  - With the fix alone, 4 of 4 passed.
- A throwaway smoke spec, never committed, imported the canonical phrase through onboarding on
  Chrome at `49a42355` (this code without the pin), recording every `snackbar-title` from the
  submit on. The page reached `#/onboarding/learn` and recorded none. Its capture is on the
  sign-off page.

## Review

The codex session at high (`01a0e7ab-…`) read the three changes in its first two rounds (batch
3's P5 log quotes them), then the pin.

- Round 3: "No material findings; one minor coverage gap". Calling the page's captured
  completion bypassed the shared flow, so a snack added there would have passed. Taken: the pin
  now runs the real handler, and the second failing variant above proves it.
- Round 4: "No material findings or further nits. The previous coverage gap is closed."

## The gate

The stack-top gate, on `df1849a2` and then Firefox's whole network suite on `9900de28`, is in
[batch 3's P5 log](../../b3-tooltips-glossary/lessons/phase-5.md). `onboarding-import` and
`import-paths` passed in both browsers' smoke suites. Firefox's one red network file on
`df1849a2`, `send-picker`, and its reruns are in that log.

## CI's smoke budget

After the push, CI's Firefox smoke job on #702 and #704 ran into its 20-minute limit
(`timeout-minutes` in `_extension-smoke-e2e.yml`), and the status check failed. No test did.
On #704 the suite had finished, 39 files passed and 2 skipped, in 1,163 s, and the job died in
its cleanup two seconds past the limit. On #702, 40 of 41 files had passed.

- **Cause.**
  - A smoke job's wall time is its suite plus about 45 s, against 1,200 s.
  - That day a PR off `dev` without this stack used 1,087 s of wall time on Firefox.
  - Against #704's run on 2026-09-26, nearly every file in its run that day was 10 to 25%
    slower.
  - This arc's `snackbar` and `rows` add 80 s (59.5 and 20.3 on #704's run), taking the suite
    from 39 files to 41.
  - #703's job passed in 1,077 s of wall time with the same 41 files, consistent with runner
    variability; a rerun would not fix the budget.
- **Fix.** The smoke job has 30 minutes on both browsers, as the network shards do. Every test,
  retry and required check is unchanged. `CI.md`, `FIREFOX.md`, the `e2e-testing` skill and
  `release.yml`'s comment state the new limit.
- **Review.** The codex session at high (`01a0e7ab-…`, its eighth round) chose it over a
  rerun, a per-browser input or sharding: "Raising the job timeout to 30 minutes legitimately
  adjusts execution capacity. It preserves assertions, coverage, retries and failure
  propagation."
