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

## `send-picker`'s race

CI's Firefox network shard 2/5 on #702 (run 36446684616, on `b210769d`) failed `send-picker`
as the earlier sightings did: no ALT row within 15 s of the click on the Send page's token
trigger (`send-picker.test.ts:35`). A probe then reproduced a race in the test's wait that fits
this failure and the earlier ones. No failed run recorded which popup opened: CI's failure
artifacts hold the services' logs, not the page.

- **Cause.** The Send page draws its token trigger (`SelectTokenCard.vue`) before its tokens
  load. Until they do, the card reads "No available tokens" and "Import token", and a click opens
  the import popup instead of the picker. The test clicked the trigger as soon as it was
  visible, so a token load slower than the test's next step sends the click to the import popup,
  and no picker row ever appears. The other network tests that drive the Send page wait for
  `send-from-type` before they act, and the page draws it only once its token has loaded.
- **Evidence.** A throwaway spec, never committed, set up as the test does, then opened Send
  again and again. On alternate mounts it clicked the trigger the moment it was drawn or the way
  the test does, and recorded when the trigger and the token's symbol were drawn, in ms from just
  before the click on Send, and what the click opened (the table below).
- **Fix.** The test opens Send through `openSend` (`fixtures/send-page.ts`), which waits for
  `send-from-type`. Nothing else in the test or the fixtures changes. The `e2e-testing` skill's
  flake ledger has the fingerprint as row 37.
- **Retries.** The file-scoped `tokenReadyExtension` keeps the wallet between attempts, so once
  an attempt has imported ALT, each retry imports another. The nightly's first retry failed on
  the rows, `['ALT', 'ALT', 'TST']`, and its second, with four rows, on the search box, which the
  picker shows above three. Not changed here.
- **The card.** A person who taps the card in that window gets the import popup too. What the
  card shows while it loads is a UI decision for the owner; nothing here changes it.
- **Flake bar.** On `cf8118a1`, the stack top with the fix and before these records, three
  consecutive retry-0 runs a browser: Chrome prover on, exit 0 each (118 s, 122 s, 137 s);
  Firefox proverless, exit 0 each (131 s, 135 s, 155 s), at load averages up to 165.
- **Review.** The codex session at high (`01a0e7ab-…`, its eleventh round): "Material findings:
  no." It found no path where `send-from-type` is drawn while the card still takes its empty
  branch, and raised three minors, all taken: the retries fail on the rows first and on the
  search box only at four rows; only an attempt that has imported ALT spoils the next; and the
  probe shows a race consistent with the sightings, not which popup each of them opened.

| Probe | Clicked when drawn | Clicked as the test does | Trigger without its token |
|---|---|---|---|
| Firefox, stack top (`c387fbce`) | import popup, 10 of 10 | picker, 10 of 10; the token drawn 11 ms or more before the click | 67 to 120 ms |
| Chrome, stack top (`0071773e`) | import popup, 6 of 6 | picker, 6 of 6; the token drawn 3 ms or more before the click | 12 to 20 ms |
| Firefox, `dev` (`e476e919`) | import popup, 10 of 10 | picker, 9 of 10; once the import popup, the click at 205 ms and the token at 278 ms | 52 to 206 ms |
| Chrome, `dev` (`e476e919`) | import popup, 6 of 6 | picker, 6 of 6; the token drawn 3 ms or more before the click | 13 to 26 ms |

`c387fbce` and `0071773e` differ only in CI files and docs. The race predates this stack; one run
of each on a shared host does not show whether the stack changes its odds.
