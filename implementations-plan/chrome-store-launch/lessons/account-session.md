# Account session — the store launch's account half

Owner at the keyboard; the assistant drives the owner's Chrome, signed into `alejo@nulo.sh`, over
CDP (`chrome-devtools-mcp`; step 0 explains why the Playwright extension driver could not be used).
Non-secret values only. Started 2026-09-22.

## Action log (every change, with its rollback)

Times are UTC. Read-only actions are in the step sections below, not here.

| When | Where | Change | Approved | Rollback |
|---|---|---|---|---|
| 09-22 ~21:20 | owner's Mac | Bun 1.4.0 → 1.4.2 (official installer, pinned) | owner, in session | `curl -fsSL https://bun.sh/install \| bash -s "bun-v1.4.0"` |
| 09-22 ~21:25 | owner's Mac | `~/.agents/clones.md`: nulo row repointed from a vanished `nulo-2` path to the real clone | owner, in session | restore the old row by hand |
| 09-22 ~21:30 | Claude Code user config | MCP `chrome-live` (`@playwright/mcp@0.0.81 --extension --profile-dir-name "Profile 1"`) | owner (setup) | `claude mcp remove chrome-live -s user` |
| 09-22 ~21:55 | Claude Code local config (this repo) | MCP `chrome-cdp` (`chrome-devtools-mcp@1.9.0 --autoConnect …`) | owner, in session | `claude mcp remove chrome-cdp -s local` |
| 09-22 ~22:15 | assistant memory | Two notes: the publishers and the dashboard driver | owner asked | delete the two files under the project's memory dir |
| 09-22 22:35:20 | GitHub | Environment `chrome-web-store` (reviewer, `main` only, no admin bypass) | owner, in session | `gh api -X DELETE repos/alejoamiras/nulo/environments/chrome-web-store` |
| 09-22 22:35:26 | GitHub | Environment `firefox-add-ons` (same protection) | owner, in session | `gh api -X DELETE repos/alejoamiras/nulo/environments/firefox-add-ons` |
| 09-22 22:37:56–58 | GitHub | `chrome-web-store` variables `CWS_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`, `CWS_PUBLISH_TYPE=STAGED_PUBLISH` | owner, in session | `gh variable delete <NAME> --env chrome-web-store --repo alejoamiras/nulo` |
| 09-22 22:47:14 | GitHub Actions | Dispatched `nightly.yml` on `dev` @ `a5374be2` (run 35794198759), for the first nightly containing Arc 1 | owner, in session | none needed: a prerelease can be deleted with `gh release delete <tag> --cleanup-tag` |
| 09-22 22:47:33 | GitHub | Private vulnerability reporting enabled on `alejoamiras/nulo` (was off) | owner, in session | `gh api -X DELETE repos/alejoamiras/nulo/private-vulnerability-reporting` |
| 09-22 evening | GitHub | Pushed branch `worktree-privacy-policy-fills` @ `27b0215a` (signed; the step-4 fills, no PR yet) | standing authorization | `git push origin --delete worktree-privacy-policy-fills` |
| 09-22 evening | GitHub | Opened PR #672 into `dev` (the step-4 fills) | owner, in session | `gh pr close 672` |
| 09-22 evening | Chrome Web Store, publisher Nulo | New item from `nulo-chrome-0.27.0-nightly.26266.zip`: item ID `jlmiaokmjoicmclelpiiocdhncddkdmc`, status Draft | runbook step 3 | an unpublished draft can be deleted from the item's ⋮ menu (ask first; it uses one of Nulo's two item slots) |
| 09-23 01:46:05 | GitHub | `chrome-web-store` variable `CWS_ITEM_ID=jlmiaokmjoicmclelpiiocdhncddkdmc` | owner, in session | `gh variable delete CWS_ITEM_ID --env chrome-web-store --repo alejoamiras/nulo` |
| 09-23 01:47:15 | GitHub | Squash-merged PR #672 into `dev` → `e062f4d2`; remote branch deleted | owner, in session | revert PR on `dev` (`git revert e062f4d2`) |
| 09-23 ~01:48 | Chrome Web Store, item draft | Visibility Public (default) → Unlisted ("Sin mostrar"), saved as draft, still not submitted | owner, in session | Distribution tab → Público → Guardar borrador |
| 09-23 ~01:50 | GitHub | Opened promote PR #673 `dev` → `main` (292 commits, expected 0.28.0) | owner, in session | `gh pr close 673` |
| 09-23 ~02:10 | GitHub | Pushed `fix/ratchet-base-predates-baseline` @ `cc76b562`; opened PR #674 into `dev` (the ratchet fix #673 needs) | owner, in session | `gh pr close 674 --delete-branch` |
| 09-23 02:13:48 | GitHub | Squash-merged PR #674 into `dev` → `2760e13c`; #673's head moved to it and its CI restarted | owner, in session | revert PR on `dev` (`git revert 2760e13c`) |
| 09-23 11:17:31 | GitHub, `main` branch protection | Cut-over: `required-checks.sh --apply --branch main --expect <snapshot>`. `smoke-e2e-status` / `network-e2e-status` became `extension-smoke-e2e-status` / `extension-network-e2e-status`; `quality-status`, `strict: true` and app_id 15368 are unchanged, and the script verified the write | owner, in session | `gh api --method PATCH repos/alejoamiras/nulo/branches/main/protection/required_status_checks --input <pre-apply backup>`. The backup holds the three legacy contexts with app_id 15368 and `strict: true` |
| 09-23 12:23:26 | GitHub Actions | `gh run rerun 35809523654 --failed` (#673's Tools e2e run: shards 3/6 and 4/6 plus the aggregate). They are advisory flakes, re-run for a clean board before the owner merges | owner, in session | none needed (a re-run changes nothing but the check results) |
| 09-23 12:29:02 | GitHub | #671 (docs) merged into `dev` → `509f4ddc` (the owner's merge). #673's head moved with it, which cancelled the tools re-run and started a full third CI round | owner | — |
| 09-23 ~12:35 | — | The owner authorized babysitting #673 until green and then merging it (merge commit) | owner, in session | — |
| 09-23 13:08:28 | GitHub | Merged promote PR #673 → `main` @ `6a09d4e8` (merge commit, `--match-head-commit 509f4ddc`). The third CI round was 64/64 green, advisory tools e2e included | owner (explicit authorization) | revert the merge on `main` through a PR (`git revert -m 1 6a09d4e8`); never force-push |
| 09-23 13:09:51 | GitHub | release-please opened #676 `chore(main): release 0.28.0` (head `5e623a18`). It bumps the version in the root, the extension and the manifest, adds the CHANGELOG, and reflows the root `workspaces` array onto two lines (same array). Two `pull_request` events 1 s apart meant concurrency cancelled the first CI batch, so its aggregators read "fail" until the live batch reports | — | — |
| 09-23 ~13:20 | — | The owner reviewed the 0.28.0 CHANGELOG summary (3 breaking: #539 tools wizard, #483 portal retirement, the popup reset path) and authorized babysitting #676 and merging it | owner, in session | — |
| 09-23 13:40:09 | GitHub Actions | `gh run rerun 35865182201 --failed` on #676's Tools e2e. Its live batch had every required check, both Firefox lanes and bridge green; the only red was shard 3/6 `deposit-token.spec.ts:89` cell 2, "stood down four times in a row" | owner (babysit authorization) | none needed |
| 09-23 14:29:50 | GitHub | Merged release PR #676 → `main` @ `95eb2902` (merge commit, `--match-head-commit 5e623a18`). The board was 62 pass / 13 skipped after the tools re-run went green | owner (explicit authorization) | the release is published by this merge; roll back by shipping a fix forward, and never move or delete the tag |
| 09-23 14:32:59 | GitHub | `auto-unstick` tagged `v0.28.0` and published its release with the placeholder body "Filled by publish run." and no assets, as designed; `attach-assets` fills both later. release-please aborted on the v4 bug in 2m22s, as expected | automation | — |
| 09-23 ~14:36 | — | The owner authorized finishing step 5: merge the `sync main → dev` PR (merge commit) and verify | owner, in session | — |
| 09-23 14:58 | GitHub Actions | Release run 35874600024 green end to end. Gates, both builds, the Chrome and Firefox smokes against the artifact, `attach-assets` (both zips plus `SHASUMS256.txt`), the landing and tools deploy hooks (tools hook unset, so the Git integration deploys it), `sync main → dev`, `status` and `verify-live` all passed. The store publish jobs were skipped on the push, as designed. The "exit code 1" annotation is the advisory `bun audit` step (`continue-on-error`) | automation | — |
| 09-23 14:59 | GitHub | `sync-main-to-dev` opened #677 `chore: sync main → dev` (head `ed92e5e5`: 4 commits touching the two manifests, the CHANGELOG and both `package.json`) | automation | — |
| 09-23 15:28:37 | GitHub | Merged #677 into `dev` → `89ed746f` (merge commit, `--match-head-commit ed92e5e5`; board 62 pass / 2 skipped). Two parents, signed; `main`'s release commit `95eb2902` is now an ancestor of `dev` | owner, in session | revert the merge on `dev` through a PR (`git revert -m 1 89ed746f`); never force-push |
| 09-23 15:41:42 | GitHub Actions | Dispatched `store-check.yml` on `main`, `store=chrome` (run 35883435741). The dry run is pre-approved to follow if it passes | owner, in session | none needed (read-only: one `fetchStatus`) |
| 09-23 17:00:56 | GitHub Actions | store-check passed after the owner approved the `chrome-web-store` deployment: `check ok: item jlmiaokmjoicmclelpiiocdhncddkdmc — published none; submitted none` (OIDC → WIF → service account → publisher link, both ids right) | owner (approval click) | — |
| 09-23 17:01:45 | GitHub Actions | Dispatched `release.yml` on `main`, `tag=v0.28.0 dry_run=true publish_chrome=true` (run 35892813695). Dry means `attach-assets` previews only; the deploy hooks, `verify-live`, and the push-only jobs (release-please, auto-unstick, sync) skip; network e2e is off | owner, in session (pre-approved to follow a green check) | none needed (uploads nothing, authenticates nowhere) |
| 09-23 ~17:30 | — | The owner chose the CI path for step 6.3: once the dry run is green, dispatch `dry_run=false publish_chrome=true` for v0.28.0. The side effects were stated when asking: asset re-upload with new hashes, notes rewrite, deploy hooks | owner, in session | — |
| 09-23 17:31:18 | GitHub Actions | Dry run 35892813695 green after the owner's approval click. The Chrome job verified `nulo-chrome-0.28.0.zip: OK` against the run's SHASUMS, skipped Google auth, and printed `dry run: would preflight, upload and publish (STAGED_PUBLISH) item jlmiaokmjoicmclelpiiocdhncddkdmc at 0.28.0.0; no request was made`. Both smokes and `status` passed | owner (approval click) | — |
| 09-23 17:31:54 | GitHub Actions | Dispatched `release.yml` on `main`, `tag=v0.28.0 dry_run=false publish_chrome=true` (run 35896243253): the real publish | owner, in session | withdraw a pending submission from the item's dashboard (ask first); the release assets it re-uploads are content-identical rebuilds |
| 09-23 17:54:20 | GitHub | That run's `attach-assets` replaced the v0.28.0 zips and `SHASUMS256.txt` with content-identical rebuilds (Chrome `sha256:0e619ad9…`, Firefox `sha256:0c4df62d…`). The landing and tools deploy hooks re-fired for the same commit, and `verify-live` passed | automation | none needed (same contents) |
| 09-23 19:26:49 | Chrome Web Store, item | After the owner's approval click: `preflight ok: published none, submitted none`, then `upload ok: 0.28.0.0` (the draft now holds 0.28.0), then the publish call was **refused**: HTTP 400 `FAILED_PRECONDITION`, reason `MANUAL_CONFIRMATION_REQUIRED`, warning `BROAD_HOST_USAGE` ("requesting broad host permissions which may require an in-depth review"). Nothing was submitted. The run is red only through `status`; both smokes passed | owner (approval click) | none needed (an unsubmitted draft; a newer upload replaces its package) |
| by 09-23 20:25 | Chrome Web Store, item | **The owner submitted the uploaded 0.28.0 draft by hand**, the runbook's branch for a refused API submit. The dashboard reads "Pendiente de revisión": a compliance review that "may take several business days". Its note: unpublishing does not cancel the review, and the item cannot be resubmitted until the review ends | owner | wait for the verdict; the item stays Unlisted |
| 09-23 ~20:31 | AMO, account `hello@nulo.sh` (Firefox user 20185983) | First-time developer profile created: Display Name **Nulo**, other fields empty, email opt-in "new add-ons or Firefox features" unticked, "replies to my review" kept | owner, in session | AMO → Edit My Profile (the name can be changed; "Delete My Profile" exists but ask first) |
| 09-23 20:32:29 | AMO, account `hello@nulo.sh` | Accepted the Firefox Add-on Distribution Agreement and the Review Policies and Rules (both boxes, then Accept) | owner, in session (chose "Yes, you accept") | none (an agreement acceptance is not undone; the account can be closed) |
| 09-23 ~20:34 | AMO | Uploaded `nulo-firefox-0.28.0.zip` (`0c4df62d…`) on "On this site" (listed). It validated with 0 errors and 10 warnings, compatibility Firefox only. AMO then created add-on **`nulo-v5`** as an incomplete draft holding version `0.28.0.0` | owner, in session (runbook step 7; desktop-only decision) | "Cancel and Disable Version" before submit; after submit, see the next row. **The version number 0.28.0 is consumed on AMO forever** |
| 09-23 20:43:21 | AMO, add-on `nulo-v5` | **Submitted version 0.28.0.0 for review** (version id 6509472), with `nulo-0.28.0-source.zip` attached on the post-details source step. Listing: summary and description from `listing.md`, experimental ticked, category Privacy & Security, support email `hello@nulo.sh`, Apache 2.0, the privacy policy text, and the reviewer notes with the corrected linter paragraph. AMO: "may take up to 24 hours before publication, or longer if selected for manual review" | owner, in session ("Yes, submit + attach source") | disable the version or the add-on in the Developer Hub (ask first); a disabled version's number is never reusable |
| 09-23 ~20:46 | AMO, add-on `nulo-v5` listing | Edit Product Page → Additional Details → Homepage `https://nulo.sh` (the submit form has no homepage field). Saved and confirmed after a reload; status reads "Awaiting Review" | owner, in session | set the field back to empty in the same section |
| 09-23 21:02:10–22 | GitHub, environment `firefox-add-ons` | The owner generated an AMO API key pair and set the secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` in their own terminal. No browser calls between the hand-off and "done" (hard rule 2); the assistant only listed the secret names afterwards. Advice given: keep no copy of the values (regenerate to recover) | owner | Developer Hub → Manage API Keys → revoke/regenerate, then `gh secret set` both again |
| 09-23 21:03:22 | GitHub Actions | Dispatched `store-check.yml` on `main`, `store=both` (run 35920010610) | owner, in session | none needed (read-only) |
| 09-23 22:14:57 | GitHub Actions | store-check `both` passed after the owner approved both environments. Firefox: `check ok: wallet@nulo.sh is authored by this key pair — status nominated`. Chrome: `check ok: item jlmiaokmjoicmclelpiiocdhncddkdmc — published none; submitted none` | owner (approval clicks) | — |

**Standing authorization (22:36):** the owner said to drive independently. Routine and reversible
actions proceed without a check-in and are logged here. These still wait for an explicit yes:
store submit or publish, opening or merging a PR, any `gh workflow run`,
`required-checks.sh --apply`, and every legal fact. The legal wording was already reviewed by
Codex, so it is not re-audited.

## 0. Preflight — 2026-09-22

- `gh auth status`: `alejoamiras`, scopes include `repo` and `workflow`. ✅
- Canonical clone updated (`git fetch origin`); `origin/dev` is `a5374be2`, so it contains it. ✅
  The first fetch failed until 1Password's SSH agent was unlocked.
- gcloud audit (read-only, as `alejo@nulo.sh`, project `nulo-cws` = `754934686324`): matches the
  prompt exactly. ✅
  - Enabled: `chromewebstore`, `iam`, `iamcredentials`, `sts`.
  - One service account, `cws-publisher@nulo-cws.iam.gserviceaccount.com`, enabled.
  - Provider `github/nulo-repo`: `ACTIVE`; issuer `https://token.actions.githubusercontent.com`;
    7 mappings (`google.subject`, `repository_id`, `repository_owner_id`, `environment`, `ref`,
    `event_name`, `workflow_ref`); attribute condition identical to `plan.md` § Security.
  - Service-account policy: one binding, `roles/iam.workloadIdentityUser` for the pool's
    `attribute.repository_id/1243703739` principal set.
- Playwright MCP attached; public pages load. **The Chrome Web Store dashboard does not:**
  `Page.navigate` to `https://chrome.google.com/webstore/devconsole` fails with
  `Protocol error … "Not allowed"`, in the existing tab and in a new one. Chrome refuses extension
  debugger access to Web Store pages, so no extension-based driver can reach the dashboard.
- Owner's call: drive the dashboard over CDP instead. Added `chrome-devtools-mcp@1.9.0`
  (published 2026-09-08) in local scope with `--autoConnect --no-usage-statistics
  --no-performance-crux --no-javascript-evaluation`; Chrome's remote debugging is switched on at
  `chrome://inspect/#remote-debugging` only while the dashboard is being driven. Trade-off
  accepted: while on, the debug server exposes every Chrome profile, not just the `nulo.sh` one.

- Devconsole reached over CDP, signed in as `alejo@nulo.sh`. ✅

## 1. The Chrome publishers — 2026-09-22

**The mistake being cleaned up.** Meaning to link the service account, the owner instead used
Profile → "Creación de editor" and created a second publisher, naming it after the service account
("cws-publisher"). The service account was also added under Settings → "Cuenta de servicio" on one
of the two publishers, and publisher ID `2b82e4fb-…` had been noted without knowing whose it was.

**Audit (read-only).**

| Publisher | ID | Service account | Trader status | Contact email | Members | Items | Pending |
|---|---|---|---|---|---|---|---|
| Nulo | `2b82e4fb-1162-4f10-93f0-1e63defaf8e9` | `cws-publisher@nulo-cws.iam.gserviceaccount.com`, linked 22 Sept 2026 | non-trader | `hello@nulo.sh`, verified | `alejo@nulo.sh`, Admin since 21 Sept | none (limit 0/2) | none |
| cws-publisher | `c36858ea-adbd-4e71-acc5-d6dd857cbf7f` | none | non-trader | `cws-publisher@nulo-cws.iam.gserviceaccount.com`, **unverified** | `alejo@nulo.sh`, Admin since 22 Sept | none (limit 0/2) | the unverified contact address only |

- Developer account (Profile page, shared by both): registration fee paid, account
  `alejo@nulo.sh`; "Creación de editor": "Has creado 1 de 1 permitidos", listing cws-publisher,
  with "Crear un editor nuevo" disabled. The dashboard's Notifications page, which spans every
  publisher and item, reads "No tienes notificaciones".
- Nulo's ID was read off Nulo's own settings page after choosing Nulo in the publisher switcher,
  not from a typed URL. The dashboard's URL carries the selected publisher's ID
  (`/webstore/devconsole/<publisher-id>/…`), which is the quickest way to tell the two apart.
- Nulo's settings match every intended value (name, verified contact, non-trader, the service
  account). The dashboard shows no change history, so "unchanged by the mistake" rests on that
  match; the only 22-Sept-dated entry on Nulo is the intended service-account link.
- The service account is on Nulo only; cws-publisher's field is empty. No unlink or relink needed.

**The stray publisher: kept, by decision.** Google's documentation, checked 2026-09-22:
- It can be deleted: it has no published items and the owner is its Admin ("You can't delete a
  publisher that still has published items", "Publishers can only be deleted by an Admin of the
  publisher" — developer.chrome.com/docs/webstore/account-deletion).
- Deletion is permanent ("There is no 'undo' for this action", same page).
- Deletion does **not** free the slot: "You can only create one publisher in your account
  lifetime" and "Deleting the publisher does not restore your lifetime quota of one publisher
  activation" (developer.chrome.com/docs/webstore/share-ownership, updated 2026-04-15). Not
  having published anything is irrelevant to the quota; creating the publisher spent it.
- Owner's decision: **keep it**, empty and unused. Deleting it gains nothing and permanently
  removes the account's only extra publisher, which could be renamed and reused later. It holds
  no items and no service account, and its contact address is shown only alongside items. Whether
  an item-less publisher has any public page is undocumented (moderate confidence it has none).
- `CWS_PUBLISHER_ID` = `2b82e4fb-1162-4f10-93f0-1e63defaf8e9` (Nulo).

## 2. GitHub environments — 2026-09-22

Before: only `production` (admin bypass on, no rules). It was left untouched. Created with
`PUT repos/alejoamiras/nulo/environments/<name>` and one deployment-branch policy each; read back:

| Environment | Required reviewer | Self-review | Admin bypass | Deployment branches |
|---|---|---|---|---|
| `chrome-web-store` | `alejoamiras` (2982991) | allowed (`prevent_self_review: false`) | off | custom: `branch:main` only |
| `firefox-add-ons` | `alejoamiras` (2982991) | allowed | off | custom: `branch:main` only |

The workflows on `dev` reference exactly these names: `release.yml` and `store-check.yml` use
`environment: chrome-web-store` / `firefox-add-ons`, `vars.CWS_{WIF_PROVIDER,SERVICE_ACCOUNT,PUBLISHER_ID,ITEM_ID,PUBLISH_TYPE}`
and `secrets.AMO_JWT_{ISSUER,SECRET}`.

Variables on `chrome-web-store`, read back: `CWS_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT` and
`CWS_PUBLISHER_ID` equal the gcloud audit and step 1; `CWS_PUBLISH_TYPE=STAGED_PUBLISH` is one of
the two values `scripts/release/publish-chrome-store-run.ts` accepts. `CWS_ITEM_ID` waits for
step 3. `firefox-add-ons` has no variables or secrets yet (step 7).
Gotcha: in zsh, `R="--env x --repo y"; gh variable set N $R` passes one argument, because zsh
does not word-split unquoted variables. Write the flags out.

## 3. Chrome item — waiting on a nightly

No nightly contains Arc 1 yet: `v0.27.0-nightly.26263`/`26264`/`26265` all predate `0af7d9bc`.
`nightly.yml` computes `date -u +%y%j` and increments past any existing tag, so a dispatch before
00:00 UTC cannot collide with `26265`; it produces `26266`, and the 03:23 scheduled run then
quiet-skips because dev HEAD is already released.

**Draft filled (09-22 evening), never submitted.** Item `jlmiaokmjoicmclelpiiocdhncddkdmc` on Nulo,
saved as Draft. The dashboard took Title and Summary from the manifest. Filled from `listing.md`:
- Listing: description (paragraphs unwrapped from the Markdown's hard wraps, 1057 characters),
  category Herramientas (Tools), language inglés, homepage `https://nulo.sh`, screenshots 1–3 in
  order, and the 440×280 promo tile.
- Privacy: single purpose, six per-permission justifications, one host-permission field, the four
  data-use ticks (personal information, financial, authentication, web history), all three
  certifications, and the privacy URL `https://nulo.sh/privacy`.
- Distribution: free and all regions were already the defaults.

Where the dashboard differs from `listing.md`:
- **Store icon** (required, 128×128): `listing.md` names none. Used the packaged
  `src/assets/icons/128.png`, whose hash matches the zip's copy.
- **Support URL**: the field accepts URLs only. `mailto:hello@nulo.sh` fails submit validation, so
  it is left empty; the publisher's verified contact is `hello@nulo.sh`. `listing.md`'s Support
  row should say so.
- **Host permissions**: Chrome has a single field for all host permissions and the content script.
  The four `listing.md` justifications went in, each prefixed with its pattern (856 of 1000 chars).
- **Remote code**: when "No" is selected, Chrome disables the justification box, so the text
  cannot be entered on Chrome.
- **Single purpose**: dropped the trailing "(The full statement: `legal/privacy.md` § Appendix.)"
  pointer, which is meant for the repo, and stripped Markdown backticks in every field.
- **Visibility**: the default is Public. Set to Unlisted on the owner's yes; confirmed after a reload.
- CDP gotcha: `fill` with `""` does not fire the input event. A select-all key chord does nothing
  either, so one stray save stored a truncated `mailto:hello@nulo.s`. Fix: fill `x`, then press
  Backspace. It was re-saved and confirmed empty after a reload.

After all this, "¿Por qué no puedo enviar?" lists nothing and "Enviar a revisión" is enabled. It was
not clicked.

Result: run 35794198759 succeeded on `a5374be2`, and `v0.27.0-nightly.26266` carries
`nulo-chrome-0.27.0-nightly.26266.zip`, the Firefox zip and `SHASUMS256.txt`. Checked locally:
the tag contains `0af7d9bc`; the Chrome zip matches its `SHASUMS256.txt` line; its manifest reads
`name: "Nulo V5"`, `version: "0.27.0.26266"`, `version_name: "0.27.0-nightly.26266"`.

## 4. Privacy policy fills — research (sources checked 2026-09-22; owner confirmed 22:45)

- **Email provider:** `dig MX nulo.sh` → `smtp.google.com`; SPF `include:_spf.google.com`, so the
  provider is Google Workspace. Google's contracting-entity table
  (cloud.google.com/terms/google-entity, last modified 2026-06-30) maps a Workspace billing
  address outside the listed regions (Argentina is not listed) to **Google LLC**.
- **Cloudflare:** the Self-Serve Subscription Agreement (updated 2025-09-12), § 20: "The Service
  is offered by Cloudflare, Inc., located at 101 Townsend St., San Francisco, California 94107."
  It does not vary by country. DNS for `nulo.sh` is on Cloudflare (`ignacio`/`selah.ns.cloudflare.com`).
- **Transfers:** Cloudflare's DPA v6.4 (effective 2026-04-03) relies on the EU SCCs (Modules 2/3),
  the UK Addendum and the EU–US Data Privacy Framework. Google's Cloud Data Processing Addendum
  (last modified 2026-06-08; it covers Workspace) relies on SCCs or an "Alternative Transfer
  Solution".
- **Presto:** the app and server are AGPL-3.0-only (the four npm SDKs are MIT). The only resolving
  legal URLs are `github.com/alejoamiras/presto/blob/main/LICENSE` and `…/PRIVACY.md` (updated
  2026-09-18). `presto.build` serves its homepage for every path, so it has no legal pages.
- **Hosting in the repo:** the landing is Cloudflare Pages with a `_headers` file; `passkey.nulo.sh`
  is the `infra/passkey-rp` Worker, and its `wrangler.jsonc` enables no observability, Logpush,
  Analytics Engine or tail consumers.
- **Cloudflare dashboard (read-only, 22:50–23:05 UTC):** the account is the owner's personal Cloudflare
  account; `nulo.sh` is Active on the **Free** plan (self-serve, so Cloudflare, Inc.). What it
  exposes: HTTP Traffic has aggregates only (requests, bandwidth, unique visitors, requests by
  country). Security → Analytics has top-N breakdowns (source IPs, device type, OS, browser, HTTP
  method and version, countries, cache status, security service and action) and **sampled
  per-request logs**, each with time, IP, country, ASN, user agent, method, protocol, host, path,
  cache status, mitigation and bot category. The time picker reaches "Last 30 days". Web Analytics
  (RUM) reads "RUM is currently disabled for this zone". The `nulo-passkey-rp` Worker has Logs off,
  Traces off and no export destinations. No visitor data was copied out of the dashboard.
- **dRPC dashboard (read-only, 09-22 evening):** the owner signed in. The first session was, by
  mistake, an unrelated organisation's dRPC account; the owner switched to their own, and nothing
  from the first one is used or recorded here. On the owner's account, the Personal team's key is
  the one embedded in Nulo's default endpoints. What the dashboard exposes: aggregate statistics
  (request counts, compute units and cost by network, method, key and request type, and average
  latency) over selectable periods, and an error log grouping failed requests from the past 3 days
  by error, method and network. No per-request view, IP address or request body was found.

**Owner decisions (22:45):** dispatch the nightly; remove the Art. 27 line; use GitHub private
vulnerability reporting for the security URL; effective date 23 September 2026 (the documents'
date format); accept the other proposed fills (Google LLC, Cloudflare, Inc., the transfer lines, the
Presto links, and the retention wording).

**Drafted in worktree `privacy-policy-fills` (uncommitted):**
- `legal/privacy.md`: version line and 1.0 history row dated; § 2 now reads "forbids loading
  remote scripts"; § 5.5 fills for Cloudflare, Inc., hosting-tool categories, Google LLC, and the
  three retention statements; § 5.8 Presto links; § 10 Art. 27 line deleted; § 12 per-provider
  transfer list; § 13 security URL; § 5.1 what the dRPC account exposes, from the dashboard
  finding above. `git grep "«FILL" -- legal/privacy.md` prints nothing.
- `BEFORE-LAUNCH.md` § 1 and § 2 marked done; `legal/README.md` § Placeholders rows struck through
  with what each was filled with.
- `legal/terms.md`: § 7.6 Presto links and § 24 security URL, the same facts in both documents.
  Its date and listing URLs stay open until step 8.
- `packages/legal/src/manifest.ts`: privacy 1.0 `effective: "23 September 2026"`.
- `apps/extension/store/remote-code.md`: "What this bears on" no longer lists § 2 as an open item,
  and its line citations are updated.
- `apps/landing/scripts/legal-pages.test.ts`: the real-documents check that no rendered `href`
  contains `.md` now exempts absolute `https:` links. It existed to catch unrewritten internal
  `x.md` links, which it still does (and the unit test on line 26 is unchanged); it had started
  failing on the legitimate external link to Presto's `PRIVACY.md`. The renderer's `isSafeHref`
  already limits absolute links to `https:` and `mailto:`.
- Gates: `packages/legal` 54/54, `apps/landing` 40/40, the extension's `store-listing.test.ts`
  8/8, `bun run lint` exit 0 (its warnings predate this change). Full `bun run test`: 7042 passed,
  1 failed, the failure being `apps/extension/scripts/store-icons.test.ts` (see Noticed), which this
  change does not touch.
- Security URL: `https://github.com/alejoamiras/nulo/security` rather than `…/advisories/new`, because
  the latter sends logged-out readers to a login page; the former is public and shows the policy
  and the "Report a vulnerability" button.
- The `agent-worktree` helper on this machine has no `register` subcommand, so the worktree is not
  in `~/.agents/workspaces.md`. From here on this worktree's copy of the log is the live one; the
  main clone's untracked copy is stale.

## 5. Promote and release — 2026-09-23

- PR #673 `dev` @ `e062f4d2` → `main`: 292 first-parent commits since 0.27.0, three of them
  breaking. `bump-minor-pre-major` caps that at 0.28.0.
- Cut-over snapshot (read-only `print`, taken while CI ran): `main` requires `quality-status`,
  `smoke-e2e-status` and `network-e2e-status`, all with app_id 15368 and `strict: true`.
  `--apply` renames only the two legacy names to `extension-smoke-e2e-status` and
  `extension-network-e2e-status` (`RENAMES` in `scripts/ci-cd/required-checks.ts`). It refuses if
  the live state differs from the snapshot, then writes a backup and prints the rollback command.
- Because the head is `dev`, any merge into `dev` while #673 is open changes the PR and restarts
  its roughly 45-minute CI. #671 (docs) is held until the promote merges.
- **Blocker found on #673: `Unit tests / Vitest` red (not a flake).** All unit suites pass; the
  failure is `test:ci-gating` → `complexity-baseline.test.ts` "shrink-only ratchet". On a PR
  run it reads the manifest at the event's `base.sha`. `main` @ `d4c0e97a` predates
  `scripts/complexity-baseline/`, and the fail-closed branch treats "base has no manifest" the
  same as "base unreachable". Every promote is blocked until `main` contains the manifest, and
  only a promote can put it there. The runbook does not cover this.
- Drafted fix `cc76b562` on branch `fix/ratchet-base-predates-baseline` (off `origin/dev`, local,
  not pushed). A base commit that was read and holds no manifest now skips with a warning; an
  unfetchable base or an unreadable manifest still fails closed. Simulated the exact CI path locally
  (`GITHUB_ACTIONS=true`, `GITHUB_BASE_REF`, a fake event file). Base `main` skips with "predates
  the complexity baseline". Base `dev` runs the full ratchet and passes. An unreachable SHA still
  fails. The whole file passes 15/15 and lint is clean. The path is dead once `main` has the manifest.
- PR #674 (the fix) went green: 26 pass, 19 skipped, all three required checks. Its CI log shows the
  shrink-only ratchet ran against `dev` for about 3 s and passed, with no skip line. Merged as
  `2760e13c`. On #673's first run, every other gate passed: commitlint over the whole range,
  lint/typecheck, all builds, and every unit suite. Only `Unit tests` (the ratchet) and its
  aggregate `quality-status` were red.
- **Advisory tools e2e flaked on both #673 runs, on functionally identical tools code** (the only
  diff between the runs is a CI script). Each failure was in a shard that passed on the other run:
  - Run 1, shard 1/6: `apps/tools/tests/browser/specs/activity.spec.ts:91` "cell 40 — two tabs, two
    sends racing": `toHaveAttribute` expected `dep-pending-…`.
  - Run 2, shard 4/6: `fee-states.spec.ts:91` "cell 12 — the confirm's gas re-read fails". The stale
    banner showed the generic "Something changed while you were on the review…" instead of "could
    not be read just now", so a different stale reason won a race.
  - Run 2, shard 3/6: `deposit-token.spec.ts:89` "cell 2 — plain, private, registered token: the
    private claim is paid from credit" failed with "the review was stood down four times in a row".
    The same shard passed on run 1.
  - Release PR #676 (whose tools code is the same as #673's): shard 3/6 failed on `deposit-token`
    cell 2 again. Tally on identical tools code: 2 passes, 2 fails. That is the most frequent flake
    and the first to deflake; it also covers a flow `tools.nulo.sh` ships, so the product-race
    question matters.
  - Two of the three failing tests are the send review standing itself down under CI timing. The
    recurring `No artifact registered for contract class …` page errors also appear in passing
    tests, so they are noise and not the cause.

  `tools-e2e-status` is advisory, so the promote is not blocked. Follow-up for the tools app: decide
  whether cell 12's reason precedence is a product race or a test race, and deflake both.
- Run 2 final, at head `2760e13c`: 61 pass, 3 fail. The fails are tools e2e shards 3/6 and 4/6 and
  their aggregate. `quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status`,
  both Firefox lanes and `bridge-contracts-status` all pass. Before applying, a fresh `print` was
  re-run and matched the reviewed snapshot byte for byte. After the cut-over, #673 reads
  `UNSTABLE` / `MERGEABLE`: the required checks are satisfied and only the advisory red remains.
- `CLAUDE.md` (§ Branching, § Release runbook steps 1 twice) and `BEFORE-LAUNCH.md` ("Not legal
  text") still carry the "cut-over pending on `main`" notes. Delete them in the step-8/9 docs PR.

- **Verified after publish (09-23 ~15:05).**
  - The `v0.28.0` assets are `nulo-chrome-0.28.0.zip`, `nulo-firefox-0.28.0.zip` and
    `SHASUMS256.txt`.
  - Live `nulo.sh/privacy` has no `data-legal-banner` and no `noindex`, reads "Version 1.0 —
    effective 23 September 2026", and contains zero «FILL».
  - `/terms` still carries `data-legal-banner="draft"` and `noindex`, as expected until v1.0.0.
- **The release notes are empty on every release (a pre-existing bug, not caused today).** The
  v0.28.0, v0.27.0 and v0.26.0 bodies are all the same 402 characters: the install header, then
  `---`, then no commits. `attach-assets` runs `git-cliff --tag vX.Y.Z --unreleased …`, and
  `--unreleased` keeps only commits after the latest tag. By then `auto-unstick` (or the manual
  unstick) has created `vX.Y.Z` at HEAD, so nothing is left (high confidence; the step log shows
  git-cliff emitting no entries). Likely fix: `--unreleased` → `--latest` in `release.yml`, then
  regenerate the 0.28.0 body with `gh release edit v0.28.0 --notes-file …`. Follow-up; the
  release-please `CHANGELOG.md` holds the full notes.
- #677 merged as a true merge commit. `GET compare/95eb2902...dev` reads `ahead`, `behind_by 0`,
  so the next rc cut has its version anchor.

## 6. Chrome credential and CI publish — 2026-09-23

- The live WIF condition admits exactly `release.yml` and `store-check.yml` at `refs/heads/main`,
  on `workflow_dispatch`, in environment `chrome-web-store` (plan § Security; step 0 matched it).
- **store-check passed** (run 35883435741). It waited about 79 minutes for the approval click,
  then ran in 16 s: `check ok: item jlmiaokmjoicmclelpiiocdhncddkdmc — published none; submitted
  none`. A never-submitted draft reports no revision at all, which `interpretPreflight` treats as
  eligible, so a real publish would get past preflight.
- The watcher (`gh run watch --exit-status`) died once on `connection reset by peer` while the run
  was still waiting. Its exit 1 looked like a failed run. Use a retry loop without
  `--exit-status`, then read the conclusion.
- **v0.28.0 vs the draft's package.** Both published zips match `SHASUMS256.txt`. The Chrome
  manifest differs from the nightly now in the draft (`0.27.0-nightly.26266`) only in `version`
  (`0.27.0.26266` → `0.28.0.0`) and `version_name`. Permissions, hosts, content scripts and CSP
  are unchanged, so the Privacy-tab justifications still hold.
- Firefox zip, checked ahead of step 7: `gecko.id` is `wallet@nulo.sh`;
  `data_collection_permissions` is `{"required": ["financialAndPaymentInfo"]}`; `version_name`
  is `0.28.0` and `version` is `0.28.0.0`; `strict_min_version` is `153.0`; there is no
  `gecko_android` block.
- **Rebuilds are content-reproducible but not byte-reproducible.** The dry run's `release-0.28.0`
  artifact matches the published zips file for file: 578 files each, zero content hashes differ.
  The zip bytes differ, though: Chrome `8c487668…` became `0bf00c9d…`, Firefox `2138536…` became
  `1e73260e…`. That is container metadata, most likely entry timestamps. So a non-dry
  `release.yml` dispatch, the only way to publish from CI, replaces the release's zips and
  `SHASUMS256.txt` with new hashes. Consequence: step 7 must download the Firefox zip after the
  last non-dry dispatch. Follow-up: fixed entry mtimes (e.g. `SOURCE_DATE_EPOCH`) would make a
  republish byte-stable.
- **The real publish uploaded, then stopped at a store warning** (run 35896243253). The script
  always sends `blockOnWarnings: true`; the plan chose that and two tests pin it. The store
  answered with one warning, `BROAD_HOST_USAGE`, and reason `MANUAL_CONFIRMATION_REQUIRED`. That
  warning comes from the wallet's own host permissions and content-script matches, so it is not a
  defect to fix. Expect every future CI publish to hit it (moderate confidence; the next release
  will show whether a confirmed first review changes that). This is the runbook's "API refuses a
  never-published item" branch: the owner submits the uploaded draft by hand.
- **Follow-up (design, owner's call):** CI publishing cannot finish while any warning blocks. One
  option is an explicit accepted-warnings list, e.g. an environment variable
  `CWS_ACCEPTED_WARNINGS=BROAD_HOST_USAGE`: retry with `blockOnWarnings: false` only when every
  warning's reason is on the list, and still fail closed on anything else. The other is to keep
  CI to the upload and confirm each release's submit in the dashboard.
- Reopening the dashboard's package page over CDP, to confirm the submission, redirected to a
  Google re-auth prompt (`signin/confirmidentifier`, `passive=180`). Stopped there, per hard rule 1.
  The owner's pasted status stands as the record.

## 7. Firefox first submission — 2026-09-23

- The final v0.28.0 assets (after the step-6 re-upload) match `SHASUMS256.txt`: Chrome
  `0e619ad9…`, Firefox `0c4df62d…`. The Firefox manifest checks pass on these bytes too:
  `wallet@nulo.sh`, `{"required": ["financialAndPaymentInfo"]}`, `version_name 0.28.0`.
- Tag `v0.28.0` fetched over HTTPS (the SSH agent is not needed for a public repo). It is the
  annotated tag `bf97f995…` on commit `95eb2902…`, the same as GitHub.
- Source archive: `git archive --format=zip --prefix=nulo-0.28.0/ -o nulo-0.28.0-source.zip v0.28.0`,
  written outside the repo. It is 28.7 MB with 6,168 entries, all prefixed, and includes
  `apps/extension/store/SOURCE-BUILD.md`. A name scan for key or env files found only benign
  matches (`Secret*` components, `apps/tools/.env.example`, audit docs); the repo is public anyway.
- Listing text is read from `listing.md` at the tag, not the working tree.
- Opening AMO's submit page redirected to a Mozilla accounts sign-in (`acr_values=AAL2`). Left to the
  owner.
- **Owner decisions:** desktop only (Firefox for Android unticked); slug `nulo-v5`, so the listing
  URL will be `https://addons.mozilla.org/firefox/addon/nulo-v5/`.
- AMO's flow on this date: distribution, then upload with validation and compatibility, then
  Describe (AMO creates the add-on and its slug here), then Source ("Do you need to submit source
  code?" Yes, then the upload), then Finish. The source step comes after Describe; a guessed
  `/submit/source` URL returns 404.
- **AMO linter: 0 errors, 10 warnings, all under General Tests; security, extension, localization
  and compatibility are clean.** Each flagged location was traced in the shipped zip:
  - `innerHTML` ×3: Vue `runtime-dom` `insertStaticContent`, and `@alejoamiras/presto`'s banner
    element twice. That element's link goes through `new URL` with an http(s)-only rule, and its
    variant and state come from fixed lists.
  - `Function` ×2: zod's eval-capability probe (`try { Function('') } catch`) and msgpackr's record
    decoder (`catch { return Pe = 1/0, n() }`, a non-evaluating fallback).
  - `eval` ×1: get-intrinsic's `"%eval%": eval` table entry, a reference, not a call.
  - `offscreen.createDocument` / `closeDocument`: gated.
  - `sidePanel.setPanelBehavior`: `chrome.sidePanel?.`.
  - `sidePanel.open`: only reachable through a settings row that `appearance.vue` offers only when
    `chrome.sidePanel` exists.
  - The Firefox CSP is `script-src 'self' 'wasm-unsafe-eval'`.
- **`listing.md`'s reviewer notes were wrong on the linter paragraph.** They said the warnings "come
  from bundled `@aztec` packages and their WASM glue" and named only `chrome.offscreen`. The owner
  chose to submit that paragraph corrected, with the rest verbatim.
  - The step-8 PR must carry the same correction, because CI sends this block as `approval_notes`
    with every version.
  - Two more `listing.md` corrections go in that PR. AMO's "Other" category is "My add-on doesn't
    fit into any of the categories", which cannot be combined with Privacy & Security, so only
    Privacy & Security was picked. The submit form has "Support website" but no "Homepage": support
    website was left empty and the homepage was set afterwards on the listing.
- The privacy policy field got `legal/privacy.md` v1.0 at the tag, with its two `](terms.md…)` links
  made absolute (`https://nulo.sh/terms`), the way the landing's renderer rewrites them.
- Every long field was filled over CDP and then read back from the accessibility snapshot. Summary,
  description, privacy text (23,378 characters) and reviewer notes are byte-identical to their
  sources.
- **store-check `both` passed.** The Firefox check sees the add-on as `nominated`, i.e. awaiting
  review. **Open question on Chrome:** about two hours after the owner's hand submission, which the
  dashboard confirmed as "Pendiente de revisión", `fetchStatus` returned no
  `submittedItemRevisionStatus` at all. Check mode prints `none` only when the field is absent.
  Either the v2 API lags, or it does not report a revision submitted from the dashboard. Unresolved.
  - It does not weaken the gate: a CI upload during a pending review is refused by the API anyway.
  - It does contradict `plan.md`'s expectation that check mode would read "the hand-made
    submission, pending or published". The next publish's `preflight ok:` line will show which it is.
- Firefox API publishing starts at the next stable release: AMO holds 0.28.0.0, and a duplicate
  version is refused forever.

## Noticed

- `plan.md` § Delivery checklist item 3 names the Cloud project `nulo-store-publish`; the real
  project is `nulo-cws`.
- Each publisher shows "Límite de extensiones: 0/2". Nulo V6 would take Nulo's second slot.
- After a Claude Code restart, the first `chrome-live` call hung for more than 120 s (probably
  waiting for the extension's connect approval) and was stopped. Dashboards were read over
  `chrome-cdp` instead.
- The default dRPC endpoints in `apps/extension/src/wallet/services/network/service.ts` embed the
  account's API key in the public source. That is presumably intended for a client-side key, but
  it means anyone can spend the account's quota; whatever the dRPC dashboard shows about that key
  is what § 5.1 must disclose.
- `apps/extension/scripts/store-icons.test.ts` ("the committed icons match the master") fails on
  macOS with Bun 1.4.2: all five sizes differ byte-for-byte. The icons were rendered on CI's Linux
  runner and the nightly on `a5374be2` is green, so `Bun.Image`'s PNG output apparently differs by
  platform. The byte-exact check therefore fails locally for anyone on a Mac. Follow-up: compare
  decoded pixels, or run the check on CI only.
