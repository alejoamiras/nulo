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
| `legal name` | The natural person who is the counterparty. There is no entity, so the contract needs an identifiable human. |
| `country/state of residence` | Governing law. Also used in § 22's venue. |
| `city or judicial district…` | § 22 venue — a court location, not just a country. Do not let governing law float with a future move. |
| `contact email` | Contract notices, rights requests, pre-action contact. |
| `effective date` | The date the 1.0 listing goes live. |
| `official Chrome Web Store / Firefox Add-ons listing URL` | Where store-required publisher disclosures live. |
| `published security-reporting URL` | `SECURITY.md` is a repo path; a rendered legal page needs a URL that resolves for a reader who is not in the repo. |
| `provider legal name and privacy-policy link` ×2 | The form provider and the email provider behind `nulo.sh/forms/*`. |
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
4. **Resolve the Presto licensing.** Three bundled packages declare `AGPL-3.0-only` and are runtime
   value imports, not type-only: `@alejoamiras/presto-core@1.0.1` (`PrestoClient` in
   `apps/extension/src/presto/client.ts`), `@alejoamiras/presto@5.2.0-revision.2`, and
   `@alejoamiras/presto-banners@1.0.0` (`apps/extension/src/onboarding/pages/presto.vue`,
   `apps/extension/src/utils/presto-ui-state.ts`). They ship inside an extension the repo presents as
   Apache-2.0. Same copyright holder, so this is fixable by an explicit alternative grant for the
   exact versions incorporated — republishing with `(Apache-2.0 OR AGPL-3.0-only)` is the cleaner
   maintenance path — and the licence files must travel **in the distributed extension**, not only on
   GitHub. The Terms describe the resolved position; they cannot substitute for resolving it.
5. **Firefox data-collection consent.** `manifest.firefox.config.ts` declares no
   `data_collection_permissions`. New AMO submissions require Mozilla's built-in consent system, and
   a privacy page does not replace it.
6. **Declare a Firefox minimum version.** The passkey RP-ID-via-host-permission flow needs Firefox
   150+; the manifest declares no floor. Either declare it or explain the flow's absence on older
   versions.
7. **Chrome trader disclosure.** A natural person acting professionally can still be a trader, and
   "solo / free / open source" does not settle it. If the trader path applies, Chrome requires a
   verified address and phone number displayed publicly — which a clause in these Terms cannot waive.
8. **Rewrite the README banner.** It still says "Aztec testnet only. Do not use with real funds",
   while the seeded default network is mainnet. That contradiction is itself a liability.

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
