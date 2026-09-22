# Before launch — what is still blank, and when each blank is due

The Terms and the Privacy Policy ship with `«FILL: …»` placeholders: facts that cannot be read out
of this repository. While any survives, `nulo.sh/terms` and `/privacy` carry a **DRAFT banner and
`noindex`**, so nothing here blocks a merge. It blocks **v1.0.0**.

Find every one: `git grep -n "«FILL" -- legal/`. What each one needs is described in
[`legal/README.md` § Placeholders](./legal/README.md#placeholders). This file is the schedule.

## 1. Any time before v1.0.0 — look these up, do not guess

**Done 2026-09-22** for the privacy policy, every row below; the Terms carry the same security URL
and Presto links. What each fill says, and its source, is in `legal/README.md` § Placeholders.

| Fill | Where | How to find it |
|---|---|---|
| Email provider's legal name + privacy link | `legal/privacy.md` § 5.5 | The provider behind `hello@nulo.sh` |
| Cloudflare contracting entity + privacy link | `legal/privacy.md` § 5.5 | Cloudflare's customer agreement names the entity for your country |
| What the dRPC account exposes to you | `legal/privacy.md` § 5.1 | Open the dashboard and list the categories you can actually see, or confirm you see none |
| What the Cloudflare dashboard exposes to you | `legal/privacy.md` § 5.5 | Same: open it, list it |
| Retention ×3 (website/security records, correspondence, provider schedules) | `legal/privacy.md` § 5.5 | State the real period or the real criterion |
| Transfer safeguards (provider → destination → adequacy decision or SCCs, UK included) | `legal/privacy.md` § 12 | From each provider's DPA |
| EU/UK Article 27 representative | `legal/privacy.md` § 10 | Only if required. **Delete the line** if not; never leave it blank |
| Security-reporting URL | `legal/terms.md` § 24, `legal/privacy.md` § 13 | A URL that resolves for a reader outside the repo (`SECURITY.md` is a repo path) |
| Presto's own licence + privacy links | `legal/terms.md` § 7, `legal/privacy.md` § 5.8 | Published by the Presto native app |

## 2. When the store listings exist

| Fill | Where |
|---|---|
| Chrome Web Store listing URL | `legal/terms.md` § 1 |
| Firefox Add-ons listing URL | `legal/terms.md` § 1 |

Also at this point, not a placeholder but the same deadline: the **Chrome trader disclosure**
([`legal/README.md`](./legal/README.md), blocker 5) is declared non-trader as of 2026-09-21; it
must be re-declared before any funding, revenue or entity. If the trader path applies, Chrome
displays a verified address and phone number publicly, and no clause can waive that.

The store dashboards are filled from `apps/extension/store/listing.md` (one source for both stores;
`scripts/store-listing.test.ts` holds it to the manifests and to the privacy policy). Before the
first submission the privacy page must have lost its DRAFT banner, which takes two things: every
`«FILL»` in § 1 above is filled (a reviewer who opens `nulo.sh/privacy` reads them), **and the
privacy policy's effective date is set to the planned submission day** — the banner stays while
any placeholder survives, and the date is one. Set it in the three places tests hold together:

- [x] `legal/privacy.md` — the version line at the top, and the 1.0 row of the history table
- [x] `packages/legal/src/manifest.ts` — `effective` for `privacy` 1.0 (23 September 2026)

The Terms keep their placeholders until § 3: their effective date is the 1.0 ship day and their
two listing URLs exist only after both submissions, so `/terms` stays draft a little longer, which
the stores do not mind — they require a reachable privacy policy, not terms.

Also before submission, one wording item in the privacy policy that is not a placeholder: § 2
attributes "loads no remote code" to the content security policy, which only forbids remote
*scripts* — WASM bytes are kept local by the bundled loaders, not the policy
(`apps/extension/store/remote-code.md` § What this bears on). **Done 2026-09-22:** § 2 now reads
"forbids loading remote scripts".

## 3. The day v1.0.0 ships — in the `release: promote dev → main` PR that carries it

The Terms' **effective date** is the date the 1.0 listing goes live (the privacy policy's was set
at submission, § 2). It appears in three places that tests hold in agreement, so change them
together:

- [ ] `legal/terms.md` — the version line at the top, and the 1.0 row of the history table
- [ ] `packages/legal/src/manifest.ts` — `effective` for `terms` 1.0 (currently `null`)
- [ ] `legal/privacy.md` + its manifest entry — already dated at submission; confirm unchanged

Then:

- [ ] `git grep -n "«FILL" -- legal/` prints nothing
- [ ] `bun run --cwd packages/legal test` and `bun run --cwd apps/landing test` are green
- [ ] After the deploy, `nulo.sh/terms/v1.0/` shows **no DRAFT banner** and no `noindex` meta
- [ ] The README's "DEMO / PREVIEW BUILD — NOT A PRODUCTION WALLET" banner is rewritten

## 4. Every later `release: promote dev → main`

Nothing to fill unless `legal/terms.md` or `legal/privacy.md` changed since the last release. If one
did, it needs a new version before it reaches users — procedure in
[`packages/legal/README.md` § Shipping a new version](./packages/legal/README.md#shipping-a-new-version):
archive the old text, bump the version line, add the history row **with its effective date**, append
the manifest entry, and mark it `material: true` with hand-written `changes` if people must
re-accept. `git diff <last release tag> -- legal/` answers whether any of this applies.

## Not legal text, same deadline

- `main`'s required-check cut-over, pending before the next promote:
  [`CLAUDE.md` § Release runbook](./CLAUDE.md#release-runbook), step 1.
- Firefox `data_collection_permissions` (`financialAndPaymentInfo`) and the Firefox 153 minimum
  are settled and pinned by `apps/extension/src/manifest.test.ts`; the reasoning is in
  `apps/extension/store/listing.md` § Data collection declaration.
