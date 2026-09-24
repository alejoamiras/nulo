# legal/

Canonical source for the two documents the extension links to. Everything here is written to be
**checkable against the code** — the whole point of the drafting exercise was that a factual claim a
routine change silently falsifies is a misrepresentation claim, not a typo.

| File | Published at | Linked from |
|---|---|---|
| [`terms.md`](terms.md) | `nulo.sh/terms` | the onboarding Terms gate, the popup re-acceptance sheet, popup register, Settings → About |
| [`privacy.md`](privacy.md) | `nulo.sh/privacy` | the same places |

The landing generates both pages, plus one permalink per version (`nulo.sh/terms/v1.0/`), from these
files at build time — `apps/landing/scripts/build-legal.ts`, rendered with Bun's built-in markdown.
The version list, which versions are material, and what changed in each live in
[`@nulo/legal`](../packages/legal/README.md), whose tests fail when the manifest and these documents
disagree. While any `«FILL»` survives, the published page carries a DRAFT banner and `noindex`.

## Placeholders

**When each one is due: [`BEFORE-LAUNCH.md`](../BEFORE-LAUNCH.md) at the repo root.**

Every `«FILL: …»` must be substituted before publication. They are deliberate: each one is a fact
that cannot be read out of this repository.

| Placeholder | What it needs |
|---|---|
| ~~`legal name`~~ | Filled: Alejo Amiras. |
| ~~`country/state of residence`~~ | Filled: Argentina; venue is the Ciudad Autónoma de Buenos Aires. |
| ~~`contact email`~~ | Filled: `hello@nulo.sh`. |
| `effective date` | Privacy 1.0: filled, 23 September 2026 (the submission day). Terms 1.0: the date the 1.0 listing goes live. |
| ~~`official Chrome Web Store / Firefox Add-ons listing URL`~~ | Filled 2026-09-23, after both first submissions: Chrome item `jlmiaokmjoicmclelpiiocdhncddkdmc` (slug `nulo-v5`) and the AMO add-on `nulo-v5`. Neither resolves publicly until its store publishes it. |
| ~~`published security-reporting URL`~~ | Filled: `https://github.com/alejoamiras/nulo/security` (GitHub private vulnerability reporting, enabled 2026-09-22). |
| ~~`provider legal name and privacy-policy link`~~ | Filled: Google LLC (Google Workspace, from the MX record and Google's contracting-entity table). |
| ~~`applicable Cloudflare contracting entity and privacy-policy link`~~ | Filled: Cloudflare, Inc. (Self-Serve Subscription Agreement; `nulo.sh` is on the Free plan). |
| ~~`verified categories and access`~~ ×2 | Filled from both dashboards on 2026-09-22. Re-check them if a plan, Worker logging or browser analytics setting changes. |
| ~~`actual period or criteria`~~ ×3 | Filled: the hosting dashboard's own window (I keep no copies), correspondence for up to two years after resolution, and the providers' DPAs. |
| ~~`actual native-application legal links`~~ | Filled: Presto's `LICENSE` (AGPL-3.0-only) and `PRIVACY.md` on GitHub. |
| ~~EU/UK Article 27 representative~~ | Deleted: the owner's call that none is required. |

## Release blockers beyond the text

These came out of the two-round review and are **not** fixed by editing the documents.

1. ~~**Publish `/terms` and `/privacy`**~~ — done; see above. Original note: publish on the landing, with archived previous versions. Cloudflare
   serves `terms.html` at `/terms`, so multi-entry Vite inputs are enough — no router, no redirects
   file. Keep the markdown canonical and generate the pages from it, so the published text cannot
   drift from what is reviewed here.
2. ~~**Implement versioned acceptance.**~~ — done. § 3's unchecked "I agree" control is the
   onboarding gate (`apps/extension/src/onboarding/pages/terms.vue`) and the popup sheet for installs
   with an older or no record; the version and time are recorded on the device by
   `LegalAcceptanceService`. The "By continuing…" browsewrap footers are gone.
3. ~~**Preserve export access on decline.**~~ — done, and proved end to end: nothing but
   broadcasting and dApp requests is gated, and the sheet cannot cover an export page
   (`apps/extension/tests/e2e/legal-acceptance.test.ts`, scenarios S5, S6, S8).

   Blockers 1–3 shipped as one arc: `implementations-plan/legal-terms/`.
4. ~~**Verify the Presto MIT relicense reached the bundled artifacts.**~~ — done. The lockfile
   resolves the MIT versions (`@alejoamiras/presto@5.2.0-revision.3`, `presto-core@1.1.0`,
   `presto-banners@1.1.0`; their tarballs differ from the AGPL ones only in the licence files and
   field), `apps/extension/src/presto/presto-licence.test.ts` reds if a bump pulls an
   AGPL-declared version back in, and every build emits `THIRD-PARTY-NOTICES.txt` into the
   extension root, carrying each bundled component's own copyright and permission notice
   (`packages/third-party-notices/`; Settings → About → Open-source licences opens it). The build
   refuses any licence outside its allowlist, and CI asserts the file in both targets. The five
   bundled fonts are listed, each bound to its file by hash. **Stated limit:** the barretenberg and
   noir wasm are attributed to the projects that publish them, under their licences; what they
   compile in is not itemised, because upstream publishes no inventory (the notices file says so,
   and `implementations-plan/third-party-notices/follow-ups.md` records what would reopen it).
5. **Chrome trader disclosure — declared non-trader (2026-09-21).** The developer account answered
   Chrome's trader question as a non-trader (no revenue, no entity, no professional activity), so the
   listing shows no address or phone number. A natural person acting professionally can still be a
   trader, and "solo / free / open source" does not settle it: revisit the declaration before any
   funding, revenue or entity, because if the trader path applies Chrome requires a verified address
   and phone number displayed publicly — which a clause in these Terms cannot waive. See § Identity
   below.

Owned elsewhere, tracked here so nothing falls between worktrees:

- **Firefox** `data_collection_permissions` is settled: `["financialAndPaymentInfo"]` (transactions
  and balance queries leave for the configured node; the reasoning and the one contestable reading,
  the passkey label, are in `apps/extension/store/listing.md` § Data collection declaration). The
  minimum version is Firefox 153. Both are pinned by `apps/extension/src/manifest.test.ts`.
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
  publicly. The account is declared non-trader (2026-09-21, blocker 5 above); re-check that
  declaration before any funding, revenue or entity, because if it flips the address becomes public
  without any of the liability separation an entity would have provided, which is the worst of both
  outcomes and the trigger to revisit this.

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
