# Phase 9 · Store upload

Run from follow-ups on 2026-10-02, on the owner's call: "I'd love to release + upload the latest to
the stores + close-out that arc. But I'd love for you to be able to do that with playwright /
leveraging my browser. I don't think you can do it from this headless machine." The dashboards went
to a Claude Code session on the owner's Mac ("mac session, claude --chrome with you designing a very
clear prompt of what's needed"), step 7 below.

## Steps 1, 2, 3 and 5 · The art, the listing, the Terms and the sign-off

- #749 (`20b7773e`, 2026-10-01): the listing for both stores, the manifest summary, a dark promo
  tile and five 1280×800 frames from the opt-in capture run (`STORE_CAPTURES=1`), the reviewer
  notes, the `alarms` justification, `remote-code.md`'s citations re-read against the 6.0 code,
  and `legal/terms.md` § 1 naming both store items. `scripts/store-listing.test.ts` holds the
  listing to the manifests, privacy § 6, the stores' length caps and the Firefox data-collection
  declaration.
- The owner's sign-off, as #749 records it: on the owner's store review page (2026-10-01), promo
  tile A ("PRIVATE AZTEC WALLET"), all five frames labelled, the short description, the copy,
  Chrome visibility unlisted, the five flagged captions kept, the headline kept, and the Terms
  linking AMO by id; in chat, "Can you use asciis for bullet points instead of "-"? Other htan that
  looks good."
- Step 3 departs from its spec: § 1 links AMO by add-on id `3077967`, not by the `nulo-v6` slug
  (the owner's call, 2026-10-01). Each store redirects its id to the current listing, so the
  rename breaks neither link.
- Codex on #749 did not converge as Post-implementation prescribes: round 3, the cap, still found
  one material issue (app names and origins in exported diagnostic logs). It was fixed and
  checked by hand, and no fourth round ran (#749's body).
- #753 (`93036d32`, 2026-10-02): the reviewer notes send testers to unleashed's faucet
  ("Get SIGNAL"), in the owner's words.

## Release 0.30.0 (2026-10-02)

0.29.0's package carried the old manifest summary, so the upload needed a release after #749.
- The owner, asked "Start the release now? I'd open the promote PR, merge it into main once its
  checks are green, then merge the 0.30.0 Release PR and its sync back to dev. The store submission
  waits until the dashboards are done.", answered "Yes, start now".
- #755 `release: promote dev → main (v6 testnet tokens, unserved-chain notice, home token rows)`,
  opened 18:55Z from `dev` at `3ae81774`: 15 commits since `v0.29.0`, none breaking. All 44 check
  runs green, the network and smoke suites on Chrome and on Firefox included. Merged by the driver
  at 19:17:07Z, `gh pr merge 755 --merge`: `0a039e0a`, signature valid, parents `2bfce1d3`
  (`v0.29.0`'s release commit) and `3ae81774`.
- release-please opened #756, `chore(main): release 0.30.0`, at 19:17:52Z. Its first runs were
  cancelled when its labels landed, and their four aggregator failures stay on the commit; every
  newest run was green. Merged by the driver at 19:40:50Z, `gh pr merge 756 --merge`: `82d08d9d`,
  signature valid, parents `0a039e0a` and `77be321e`.
- `release.yml` run `37055688605` on that push, green: release-please aborted as expected, and
  `auto-unstick` tagged `v0.30.0` (annotated, tag object `f993b89d`, on `82d08d9d`) and created
  the release at 19:44:09Z. Lint and typecheck, unit tests and both builds green; smoke against the
  Chrome zip 19:51:26Z to 20:09:52Z and, advisory, against the Firefox zip 19:51:20Z to 20:12:22Z,
  both green; `attach-assets` 20:10:09Z to 20:10:55Z. `network-e2e` skipped (opt-in), and both
  store jobs skipped (no store flags).
- Assets: `nulo-chrome-0.30.0.zip` (`8ba41009…a342`), `nulo-firefox-0.30.0.zip`
  (`a47e0972…e469`) and `SHASUMS256.txt`.
- The sync job opened #757, `chore: sync main → dev`, at 20:11:36Z; every check green. Merged by
  the driver at 20:37:14Z, `gh pr merge 757 --merge`: `8cfee502`, signature valid, parents
  `3ae81774` and `9b1371bc`.
- The owner re-ran the `nulo-landing` production build from the Cloudflare dashboard after
  `attach-assets`. nulo.sh linked `releases/tag/v0.30.0` by 20:37Z, and `curl -sI`
  returned every header in `apps/landing/public/_headers` with its value: the six `/*` headers on
  `/`, the `/*.html` `Cache-Control` on `/index.html` and the `/assets/*` one on a hashed asset.

## Step 4 · The in-place update (Firefox, 2026-10-02)

Method: the e2e harness's Firefox (geckodriver, Puppeteer over BiDi), a fresh scratch profile per
run. The unpacked `v0.28.0` release zip (`nulo-firefox-0.28.0.zip`, `0c4df62d…e4e9`) was installed
as a temporary add-on, and a profile and an account were created and left unlocked. Its files were
then replaced with the unpacked `v0.30.0` release zip (`a47e0972…e469`, equal to the release's
`SHASUMS256.txt`), and the add-on was reinstalled from the same path. A throwaway spec under
`apps/extension/tests/e2e/`, never committed, recorded each screen: route, session, network row,
storage keys and pointer hit-tests. Four runs: two full ones, then two probes of the locked user's
reset path with real pointer clicks, one after an unlock attempt and one without. A dry run with
`v0.29.0` showed the same behaviour as 0.30.0.

- **After the update:** version `0.30.0.0`, the lock screen (`#/popup/auth`), no session, no
  migration screen, no crash loop. The profile and its active account are still stored.
- **Unlock with the right password:** no session and no error on screen. The integrity
  coordinator writes a block record under `nulo:core:account-integrity-blocked@<id>`. Locking and
  unlocking again changes nothing. The session never returns, so Settings is never reached.
- **The active network row:** the lock screen has none, and the stored network was not read, so
  no network shows until the new profile below.
- **The lock screen's Delete profile, after that attempt:** Delete profile, then the popup's reset
  button, opens `#/popup/settings/security/reset`. The integrity barrier ("ACCOUNT VERIFICATION
  FAILED") covers it: `elementFromPoint` at the centre of `reset-checkbox-permanent`,
  `reset-confirm-input` and `reset-submit-btn` returns `account-integrity-blocked` each time. The
  harness's `clickByTestId` still completed the reset, because a programmatic click ignores what
  covers its target; a person cannot.
- **Delete profile before any unlock attempt:** no block record and no overlay, and the reset
  completes.
- **After the reset:** register opens, and a new profile lands on `Testnet` with the four seeded
  tokens (Test USDC, USDT, EURC and GBPC).

Root cause, from the code: `handleUnlockError` (`apps/extension/src/popup/pages/auth.vue`) has no
branch for `AccountAddressInconsistencyError`, so the refusal is silent; and
`AccountIntegrityBarrier.vue` skips its overlay only on `popup-auth` and `popup-register`, so it
covers the settings reset route its own comment says deletion stays on. Once an unlock has failed,
no V6 screen offers a usable reset. The barrier's own remedy, a compatible version that re-runs
the verification, was not tried.

Step 4 sends an unreachable reset to the owner. The owner, offered a fix before the upload or the
upload with a follow-up: "Ship now, add as a follow-up." The driver had also said Chrome's V5 build
was never published; `store-check` then showed `0.28.0.0` published (unlisted), since the Mac
session had published it during step 7, so the question was put again with that correction: "Ship
now regardless". The follow-up is in `follow-ups.md`
§ Aztec V6.

## Step 6 · Live checks and store-check (2026-10-02, read-only, origin only)

- Two passes, 18:57Z (before the promote) and 20:15Z (before `store-check`), each on
  `https://lb.drpc.live`:
  - `node_getNodeInfo`: `nodeVersion 6.0.0-rc.1`, `l1ChainId 11155111`, `rollupVersion 2914217885`,
    matching the pins.
  - `seed-preflight.ts 0x06a9…924b 0x2f85ee9e…f433`: exit 0, `currentContractClassId` matching.
  - The SponsoredFPC's public Fee Juice (second pass): 4,277.5060 FJ, above the 100 FJ floor.
- `gh workflow run store-check.yml --ref main -f store=both`, run `37059450225`, dispatched
  20:15:54Z and approved by the owner; both jobs green at 20:36:46Z:
  - `check ok: item jlmiaokmjoicmclelpiiocdhncddkdmc — published PUBLISHED (0.28.0.0); submitted none`
  - `check ok: wallet@nulo.sh is authored by this key pair — status public`

## Step 7 · The dashboards (the owner's Mac session)

The driver wrote the Mac session's prompt (a private artifact, not committed). It takes every value
from `apps/extension/store/listing.md` at `3ae81774`, with each downloaded file's SHA-256 checked;
drives AMO with Claude in Chrome and the Chrome Web Store dashboard with `chrome-devtools-mcp` 1.9.0
over CDP, since Chrome blocks extensions on Web Store pages
(`archive/chrome-store-launch/lessons/account-session.md`); and changes only listing fields: it
never submits, uploads or approves. It then watches GitHub for three states: the release's assets
(rebuild the landing), the store run waiting on its approvals (make the AMO listing visible, which
AMO needs before it reviews a listed version, then ask the owner to approve), and both publish jobs
done (read both dashboards back).

What the session reported, relayed by the owner:
- Chrome Web Store: the item held an approved, staged 0.28.0 ("Nulo V5"), whose draft locked every
  listing field. On the owner's call the session published it, unlisted, to unlock the draft, which
  is why `store-check` read `published PUBLISHED (0.28.0.0)` (step 6). Then it entered the V6
  description, the five screenshots, the V6 promo tile and the `alarms` and `sidePanel`
  justifications.
- AMO: the add-on renamed "Nulo V6" with the slug `nulo-v6`; the V6 summary and description;
  Privacy & Security as its only category; the five screenshots; and the icon
  (`apps/extension/src/assets/icons/128.png`), since the listing showed the default puzzle piece.
  The privacy policy is unchanged, the licence is Apache-2.0, and the "This add-on is experimental"
  flag is still ticked. The listing went from Invisible to Visible before the upload.
- After the upload: Chrome's draft 0.30.0 is "Pendiente de revisión" (pending review) and titled
  "Nulo V6", with 0.28.0 still the published version; AMO's 0.30.0.0 is below.

## Step 8 · The upload

- Dispatched by the driver on the owner's request above (step 8 names the owner; the approvals
  stayed the owner's): `gh workflow run release.yml --ref main -f tag=v0.30.0 -f dry_run=false
  -f publish_chrome=true -f publish_firefox=true`, run `37062096394`, 20:40:32Z.
- Gates, builds and smoke against both zips green; `attach-assets` re-uploaded the release's
  assets at 21:07:52Z to 21:07:54Z with `SHASUMS256.txt` unchanged, and both downloaded zips verify
  against it.
  Both publish jobs waited on the owner's approvals from 21:07:58Z and ran at 21:22:08Z.
- **Chrome Web Store: green** (21:22:08Z to 21:22:35Z). `zip ok` (`0.30.0.0`), `preflight ok:
  published PUBLISHED, submitted none`, `upload ok: 0.30.0.0`, then `publish (STAGED_PUBLISH)
  submitted: the revision is in review`.
- **Firefox Add-ons: red** (21:22:08Z to 21:22:53Z). `zip ok`, `source ok … reviewer notes: 3107
  chars`, `upload ok: b8a9abfc… validated`, then `create version: HTTP 400 — approval_notes:
  Ensure this field has no more than 3000 characters.` No `version ok` was printed: AMO rejected
  the request, so no 0.30.0 version should exist. A rerun reads the notes from the tag's
  `listing.md` and fails the same way, so none was made.
  - Cause: #753's faucet lines took the reviewer notes from 2,950 characters (#749) to 3,107
    (`v0.28.0` had 2,279). No check knows AMO's cap: `store-listing.test.ts` bounds only the
    name and summary, and `reviewerNotes` in `scripts/release/publish-firefox-amo.ts` only
    refuses an empty block.
  - The owner, offered a hand upload of 0.30.0 in the Developer Hub, a 0.30.1 for Firefox, or a
    hold: "Hold. The Mac session is fixing." The session submitted 0.30.0.0 by hand on the listed
    channel: the release's `nulo-firefox-0.30.0.zip` (`a47e0972…e469`, as `SHASUMS256.txt`
    lists it), with `nulo-0.30.0-source.zip` attached, made by the job's own command
    (`git archive --format=zip --prefix=nulo-0.30.0/` of `82d08d9d`, sha256 `f205dad1…8e99`).
    Its reviewer notes drop only #753's faucet paragraph, the owner's call: 2,950 characters,
    the block as #749 left it. Validation reported 0 errors and 10 warnings, as for 0.28.0.
  - AMO approved it automatically the same day. Its public API reads `nulo-v6`, "Nulo V6",
    status `public`, `current_version` 0.30.0.0 (version `6536242`, file `5080385`, public).
    The version notes the owner approved, which are public: "Nulo V6, on the Aztec v6 testnet."
    and three bullets, for #754, #752 and #748.
  - #758, which the Mac session opened, cuts the faucet paragraph from `listing.md`'s
    reviewer-notes block, leaving the 2,950 characters submitted; refuses notes over 3,000
    characters, counted in code points as AMO counts them, before the upload; and reports a 400
    on the version request as "created no version" instead of with the do-not-re-run recovery,
    adding that a cause in the tag's files fails a re-run the same way.

## The final cross-arc pass (codex, high, adversarial, read-only)

Post-implementation asks for it before the later arc's PR opens; #749 and #751 each merged after
their own loops without it. It ran at the archive on 2026-10-02: a fresh session over the seams
between arc A (`80663b61`), the store arc (`20b7773e`, `93036d32`), arc C (`73a31f1b`,
`3ae81774`) and #752 (`a5bacef6`), with the plan's two rules.

- Round 1, "Changes required", six findings:
  1. High, accepted as a follow-up: the V5 lock-out. Codex confirmed the root cause from the code
     (no branch for the error in `handleUnlockError`, and no generic fallback; the barrier covers
     the reset route against its own comment) and added that nothing exports a blocked profile's
     recovery phrase or backup, while a reset or an uninstall erases them. It asked to hold the
     submission for the owner's disposition, which the owner had already given twice (step 4).
     The follow-up carries the export question and the keep-installed advice.
  2. Medium, rejected: seeded names are only length-checked, though P8 step 2 lists the name
     among the pins. Leaving it out was arc C's choice (`lessons/phase-8.md`); a node that can
     rename a pinned token can already misreport its balance, and the class, symbol and decimals
     pins keep the token itself genuine. The Outcome now says the name is unpinned.
  3. Low, accepted as a follow-up: Privacy § 5 never names `testnet.app.unleashed.systems`, the
     get-gas link's site. Editing a legal document is the owner's call.
  4. Low, rejected: `listing.md` repeats the gas URL, and `price-map.ts` keys its ticker map by
     CoinGecko ids its entries also hold. The copies agree, and the plan's first rule leaves
     working code alone.
  5. Low, accepted: P8's gate asked for the hands-on run's transaction hashes, and none were
     recorded. The Outcome now says step 4 rests on the owner's word.
  6. Low, three comments. `(F-009 A-03)` in `wallet-sdk/background.ts`: kept as a deliberate
     exception, not a false positive. It is an audit reference the comment rules forbid, but it
     matches the other audit-finding references in `apps/extension/src` (29 lines in 17 files),
     and this docs-only close-out touches no code. Rejected: "per plan Ask 3" in `price-map.ts`
     dates from #309, before this plan; the Escape comment in `network-unavailable/index.vue`
     says why the key is marked handled (round 2 withdrew that one).
- Checked and fine, per codex: chain identity and the seed addresses are defined once, and the
  prices reuse them; CoinGecko gets a fixed id set, whatever the user holds; #752 refuses before
  it opens its notice, cannot approve through a dismissal, caps and deduplicates, sanitizes the
  name and takes the origin from the content script; seeding loads bundled artifacts; and, at
  moderate confidence, no dApp path can poison a healthy profile's account rows, while a crafted
  backup can block only the profile it imports.
- Round 2, on the close-out's records: "needs a few record corrections". All accepted:
  - this log called removing the add-on the only way out, which nothing supports; it now says no
    V6 screen offers a usable reset after a failed unlock;
  - finding 6 records `(F-009 A-03)` as a kept exception rather than a false positive, and
    codex withdrew its objection to the Escape comment;
  - the Outcome dates its 2026-10-01 statements and names #752, #754 and the deferred privacy
    edit; #749's loop is recorded as not converged; step 4 records the network row;
  - the store-upload follow-up keeps only what is still open: its open store results move to
    `follow-ups.md` § Release, and the entry goes.
  It confirmed the triage of findings 2 and 4, the lock-out's symbols and routes, the follow-ups'
  paths, the release commits' parents and the tag.
- Round 3, the loop's last, on the finished close-out and #758: "No material blocker remains".
  - Accepted, this log: the line on #758 said it puts "those notes" into `listing.md`, right
    after the public version notes; it now names the reviewer-notes block.
  - Accepted, `CLAUDE.md`: the row for a 400 on the version request said a re-run of the tag
    fails the same way. The job checks out the tag's commit, so that holds for a cause in its
    files; the row now allows a re-run once a cause outside the tag is fixed.
  - Two low findings in #758's code, the Mac session's PR, went to the owner before its merge:
    `REJECTED` says "fix the cause and re-run", which a cause in the tag's files cannot meet;
    and the cap counts `.length`, UTF-16 units, where AMO's validator counts code points, so it
    can refuse notes AMO would take, those with characters such as emoji, and never passes
    notes AMO refuses. The owner's call, "Fix both, then merge": #758's second commit counts
    with `amoChars`, in code points, puts an emoji in the cap test's block, and words the 400
    message like the runbook row.
  - It found no supported path where AMO creates a version and then answers the request with a
    400 (addons-server validates before it creates, and rolls the request back on a validation
    error), and confirmed that the cut leaves exactly 2,950 characters, that the rebase should
    delete the store-upload entry #758 edits, and that the three commits are signed.

## Validation gate (2026-10-02)

On the close-out tree (`dev` at `8cfee502`, whose code is 0.30.0's, plus this documentation):
- `bun run lint`: exit 0.
- `bun run test:all`: exit 0, every workspace green; the extension 634 files passed and 3 skipped,
  8,685 tests passed, 4 skipped and 7 todo.
- `bun run test:ci-gating`: exit 0, 255 passed and 2 skipped across 17 files, the plans gate at
  0 findings, on the archived tree; again, with `bun run lint`, after the rebase on #758
  (`6a006fb9`), whose own CI covered its code.
- `bun run --cwd apps/landing build`: exit 0, its prebuild writing `release.json` for `v0.30.0`.
- The capture run (step 1) ran for #749's art and was not repeated; the art has not changed.
- Smoke on both browsers: #755's Chrome and Firefox smoke lanes on `3ae81774`, the code 0.30.0
  released, and smoke
  against the released zips in run `37055688605` and again in the store run `37062096394`
  (Chrome 20:48:43Z to 21:07:11Z, Firefox 20:48:41Z to 21:10:15Z), all green.
- `git grep -n -i -E 'nulo v5|nulo-v5|alpha v5'` outside `implementations-plan/archive` and the
  changelogs, each hit classified; none is copy a user sees:
  - the V5 regime record and its pins, which stay: `address-freeze.ts` and its test;
  - tests of the V5 refusal and the regime: `useFullBackupImport.test.ts:687` (compat-epoch 4),
    `backup-migration-registry.test.ts:214`, `blocked-repository.test.ts:12`,
    `account-export.test.ts:23`;
  - "Alpha V5" as a network name in test data, the name a V5 backup carries: the restore
    warning's, the import pages', `ImportFullBackupForm`'s, `useFullBackupImport`'s, the network
    settings pages' and `Header`'s tests;
  - history: `publish-chrome-store-run.test.ts:7` (a 0.27.0 manifest), the regime artifact's
    `PROVENANCE.md`, `legal/README.md`'s row for the store URLs filled on 2026-09-23, and the raw
    notes of the 2026-09-13 security audit.
- `store-check`: run `37059450225`, green (step 6).
- `gh run view 37062096394`: red. Every job is green except `publish-firefox-amo`, which AMO
  refused over the notes cap (step 8).

Pass criteria:
- The in-place result is recorded for both session states (step 4): the session did not come
  back, and an unlock attempt is refused and leaves the reset covered; deleting first works.
- The owner's sign-off is quoted (steps 1, 2, 3 and 5).
- Both publish jobs green: not met. Chrome's is; Firefox's failed on the notes cap, and the owner's
  Mac session submitted the same zip by hand, which AMO approved.
- The owner confirms both dashboards show the release submitted: met, through the Mac session's
  report the owner relayed (step 7), and for AMO also through its public API.

Pass with two deviations, both on the owner's calls: the Firefox publish job is red and the version
went to AMO by hand, and the upload carries a V5 lock-out that is a follow-up instead of a fix.
