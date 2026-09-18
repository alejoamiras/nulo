# legal/

Canonical source for the two documents the extension links to. Everything here is written to be
**checkable against the code** — the whole point of the drafting exercise was that a factual claim a
routine change silently falsifies is a misrepresentation claim, not a typo.

| File | Published at | Linked from |
|---|---|---|
| [`terms.md`](terms.md) | `nulo.sh/terms` | onboarding welcome, popup register, Settings → About |
| [`privacy.md`](privacy.md) | `nulo.sh/privacy` | the same three places |

**None of those links resolve yet.** The landing app (`apps/landing/`) is a single `index.html` with
no `/terms` or `/privacy` route, so all three call sites currently 404. Publishing is a release
blocker, not a follow-up.

## Placeholders

Every `«FILL: …»` must be substituted before publication. They are deliberate: each one is a fact
that cannot be read out of this repository.

| Placeholder | What it needs |
|---|---|
| ~~`legal name`~~ | Filled: Alejo Amiras. |
| ~~`country/state of residence`~~ | Filled: Argentina; venue is the Ciudad Autónoma de Buenos Aires. |
| ~~`contact email`~~ | Filled: `hello@nulo.sh`. |
| `effective date` | The date the 1.0 listing goes live. |
| `official Chrome Web Store / Firefox Add-ons listing URL` | Where store-required publisher disclosures live. |
| `published security-reporting URL` | `SECURITY.md` is a repo path; a rendered legal page needs a URL that resolves for a reader who is not in the repo. |
| `provider legal name and privacy-policy link` | The email provider behind `hello@nulo.sh`. There is no form provider any more — the wallet's contact items are `mailto:` links. |
| `applicable Cloudflare contracting entity and privacy-policy link` | Hosting for `nulo.sh` and `passkey.nulo.sh`. |
| `verified categories and access` ×2 | What the dRPC provider account and the Cloudflare dashboard actually expose to the Developer. **Check the dashboards; do not guess.** |
| `actual period or criteria` ×3 | Retention for website/security records, correspondence, and provider schedules. |
| `actual native-application legal links` | Presto's own licence and privacy information. |
| EU/UK Article 27 representative | Only if required. **Delete the line rather than leaving it blank.** |

## Release blockers beyond the text

These came out of the two-round review and are **not** fixed by editing the documents.

1. **Publish `/terms` and `/privacy`** on the landing, with archived previous versions. Cloudflare
   serves `terms.html` at `/terms`, so multi-entry Vite inputs are enough — no router, no redirects
   file. Keep the markdown canonical and generate the pages from it, so the published text cannot
   drift from what is reviewed here.
2. **Implement versioned acceptance.** § 3 describes an unchecked "I agree" control and a recorded
   version + timestamp. That control does not exist — the three call sites carry a "By continuing…"
   footer, which is browsewrap and records nothing. **Do not weaken § 3 to match the footer;
   implement the mechanism**, including a path for existing preview installs.
3. **Preserve export access on decline.** § 20 promises that declining revised Terms does not disable
   backup or export. That has to be true in code before it is true on the page.

   Blockers 1–3 are one arc, to be planned with `/blueprint`. The identity and jurisdiction inputs
   the published pages need are now settled (see § Identity below), so nothing gates the plan.
4. **Land the Presto MIT relicense in a published version, and repoint the lockfile.** The SDK is
   being relicensed to MIT in a separate session; the documents are written on the basis that this
   has happened. What closes the blocker is not the decision but the artifact: the versions the
   lockfile resolves still declare `AGPL-3.0-only` in their installed `package.json`, and those are
   what get bundled. All **three** packages need it, not just the SDK — `@alejoamiras/presto-core`
   (`PrestoClient`, a value import in `apps/extension/src/presto/client.ts`), `@alejoamiras/presto`,
   and `@alejoamiras/presto-banners` (value-imported in `apps/extension/src/onboarding/pages/presto.vue`
   and `apps/extension/src/utils/presto-ui-state.ts`). Publish the relicensed versions, bump the
   lockfile, and confirm the licence notices travel **inside the distributed extension**, not only on
   GitHub.
5. **Chrome trader disclosure.** A natural person acting professionally can still be a trader, and
   "solo / free / open source" does not settle it. If the trader path applies, Chrome requires a
   verified address and phone number displayed publicly — which a clause in these Terms cannot waive.
   This is the one blocker a clause genuinely cannot route around; see § Identity below.

Owned elsewhere, tracked here so nothing falls between worktrees:

- **Firefox** `data_collection_permissions` (required for new AMO submissions) and the Firefox 150+
  minimum version the passkey RP-ID flow needs — handled in a separate worktree.
- **The README banner** said "Aztec testnet only. Do not use with real funds" while mainnet is the
  seeded default; corrected in the same commit as this file. The rest of that banner still reads
  "DEMO / PREVIEW BUILD — NOT A PRODUCTION WALLET", which will also need rewriting at the 1.0 cut.

## Identity and jurisdiction — the decision, and what it costs

**Settled:** named individual (Alejo Amiras), no entity, no address; Argentine law; Buenos Aires
venue.

Jurisdiction was not a free choice here, and it is worth recording why, because the question will
come back. A governing-law clause does not move regulatory, tax or sanctions exposure — those follow
residence and activity. Against consumers it is close to inert anyway: Rome I Art. 6 preserves the
mandatory law of the consumer's own country and Brussels I bis Arts. 17–19 let an EU consumer sue at
home; Argentina's own CCyC Art. 1109 does the same thing domestically and treats a contrary clause as
not written. Against business users, a court asks whether the chosen forum has a substantial
relationship to the parties, so an unconnected one gets disregarded. Naming somewhere you do not live
buys nothing and reads as evasion.

What would make jurisdiction genuinely selectable, and would also keep a home address off a store
listing, is an entity that actually publishes — holds the store accounts, owns the domain, and is the
party named in these documents. That was considered and deferred. Two things follow from deferring
it:

- **Argentine consumer law is now the most likely law to be applied to a claim**, and it is
  protective. Ley 24.240 Art. 37 treats a clause limiting liability for damage as not written, and
  CCyC Art. 1109–1110 void the venue clause for consumers. §§ 19.1 and 22 say so openly rather than
  pretending otherwise — a term that misstates a non-excludable guarantee is its own offence in
  several regimes, Argentina included.
- **Chrome's trader disclosure is the one exposure a clause cannot route around.** If the listing is
  classed as a trader listing, Chrome requires a verified name, address and phone number displayed
  publicly. Check the developer account's trader declaration before submitting 1.0: if it forces
  disclosure, the address becomes public without any of the liability separation an entity would have
  provided, which is the worst of both outcomes and the trigger to revisit this.

**Language.** Ley 24.240 Art. 10 expects consumer contracts to be in Spanish. These documents are
English-only. For an Argentine consumer that is a real weakness; a Spanish version of at least the
Terms is worth doing before or shortly after 1.0.

## Changing these documents

- Every change bumps the version and the effective date in the file **and** in its version-history
  table.
- **Material** changes — anything affecting what leaves the device, liability, or governing law —
  bump the minor digit and trigger in-product re-acceptance. Typos and link fixes bump the patch
  digit and take effect on publication.
- Claims that a code change could silently falsify should be pinned by a test rather than softened
  into vagueness. The ones worth pinning: holdings-independent price requests, fiat-off suppression,
  cached-prices-during-execution, local-prover transport, the proving-parameter download
  destinations, and diagnostic persistence and redaction.

## Provenance

Drafted and then reviewed across two adversarial rounds with Codex (`gpt-6-astra`, `xhigh`), which
was asked to attack the text as plaintiff's counsel, as a store/data-protection reviewer, and as a
fact-checker with repo access. Eleven factual contradictions between the drafts and the code were
found and independently verified before being applied — the most serious being that `exportMnemonic`
rejects passkey profiles, so the first draft instructed passkey users to back up a recovery phrase
that cannot exist.

**These documents have not been reviewed by a lawyer.** Two models arguing is not legal advice, and
the liability, consumer-law and sanctions sections in particular are where a qualified review would
earn its fee.
