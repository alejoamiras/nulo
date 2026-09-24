# Terms of Use

**Version 1.0 — effective «FILL: effective date»**

These Terms are a binding agreement between you and the developer of Nulo. Read them before you
install or use Nulo. If you do not agree, do not install or use it.

> **The short version.** Nulo is free, open-source software that runs in your browser. It is not a
> company, a bank, an exchange or a custodian. The Developer does not hold your signing credentials
> or custody your assets. Anyone who obtains usable credentials or an effective authorisation may be
> able to access your assets. Recovery and transaction finality have the limitations described in
> § 4. Nulo has not been audited by an independent security
> firm, it connects to Aztec mainnet by default, and the network it connects to is early-stage. You
> can lose everything you put into it. Warranty exclusions and liability limits appear in §§ 16–19
> and are subject to rights that applicable law does not permit you to waive.
>
> *This box is a convenience summary. It is not part of the agreement — the numbered sections below
> are what you are agreeing to, and they control if the two ever differ.*

---

## 1. Who you are agreeing with

Nulo is an independent, open-source project maintained by **Alejo Amiras**, a natural person
resident in Argentina ("**the Developer**", "**I**", "**me**", "**my**").

There is no company, foundation, DAO or other legal entity behind Nulo. There are no employees, no
support desk and no service organisation. These Terms are an agreement between you and one
individual.

Contact: **hello@nulo.sh**. Any additional publisher disclosures required by the applicable
extension store are available at
https://chromewebstore.google.com/detail/nulo-v5/jlmiaokmjoicmclelpiiocdhncddkdmc and
https://addons.mozilla.org/firefox/addon/nulo-v5/.

In these Terms, "**Nulo**" means the Nulo browser extension distributed for Chrome and Firefox.
These Terms do not govern separate applications or websites. The [Privacy Policy](privacy.md)
separately describes relevant website and supporting-service processing. "**You**" means the person
using Nulo.

## 2. What Nulo is, and what it is not

**Nulo is a self-custody wallet interface.** The extension runs in your browser on your own device.
It generates and stores cryptographic keys locally, builds and signs transactions locally, and sends
the results to an Aztec node that you have chosen. Proofs are generated in-browser or, when
available, by the separately installed local proving application described in § 7.6.

**What the Developer does, stated as function rather than as a legal conclusion:** the Developer
supplies self-custody wallet software. The Developer does not accept assets for transmission, hold
customer assets or signing credentials, execute exchanges for customers, or maintain customer
balances on the Developer's own ledger.

**Nulo is not, and the Developer does not operate:**

- a bank, a trust, a broker, a dealer, an exchange, a custodian or a depository;
- an investment adviser, financial adviser, tax adviser or legal adviser;
- the Aztec network, any node on it, any smart contract on it, any token on it, or any application
  that connects to it.

**The Developer does not possess the credentials needed to recover your wallet or to transfer its
assets.** I hold no account for you and no assets of yours. Legal obligations concerning records or
actions otherwise within the Developer's possession or control remain unaffected by this.

**Nulo does not intermediate your transactions.** Transactions submitted by the extension go
directly to the configured node. The Developer does not operate a transaction-approval or screening
service and cannot unilaterally reverse finalised transactions on the network. Nothing in these
Terms should be read as the Developer assuming a duty to monitor, review or intervene in what you or
anyone else does with Nulo.

**No insurance or compensation scheme.** The Developer does not provide insurance or a compensation
fund for assets accessed through Nulo. Do not assume that wallet losses qualify for deposit
insurance or investor-compensation protection.

## 3. Eligibility and how you accept these Terms

You may use Nulo only if you:

1. are at least **18 years old** and have full legal capacity to enter into this agreement;
2. are not a person with whom dealing is prohibited under the sanctions or export-control law
   described in § 10;
3. are not located in, ordinarily resident in, or organised under the laws of a jurisdiction where
   use of Nulo, self-custody wallet software or the underlying assets is unlawful; and
4. will comply with all laws that apply to you.

**You accept this version of the Terms by selecting the unchecked "I agree to the Terms of Use"
control and then selecting Continue.** Nulo records that acceptance on your device, with the version
you accepted and the time; the record is not sent anywhere and is not part of a backup. These Terms
apply from that acceptance and do not retrospectively change rights or liabilities arising before it.

Before accepting, review the mainnet, security and recovery risks in §§ 4–5. **Recovery options
differ between password and passkey profiles** — see § 4.3.

If you do not meet the conditions above, or do not agree, you must not install or use Nulo, and you
should uninstall it.

## 4. Self-custody: what that actually means for you

This section is the most important one in this document.

**4.1 How your keys are protected.** Password profiles derive their master secret from a recovery
phrase. Passkey profiles derive it from the original WebAuthn credential's PRF output. Separately
imported accounts may use signing keys that are not derived from either profile's master secret.

The Developer does not receive or escrow your signing credentials through normal wallet operation.
Your ability to control them depends on the security of your device, your authenticator and your
recovery material.

**4.2 There is no reset and no backdoor.** The Developer cannot reset your credentials or recover
your keys. Losing access becomes permanent if no working credential or supported recovery material
remains. A password-profile recovery phrase can restore accounts derived from that phrase in a
compatible version; it does not restore separately imported account keys or every item of local
wallet data.

**4.3 Passkey profiles do not have a recovery phrase.** This is the most important sentence on this
page for anyone using a passkey. Nulo cannot export a recovery phrase for a passkey profile, and no
phrase exists that would restore one.

Recovery requires the same passkey credential identifier and the same PRF output used to create the
profile, through a compatible browser and authenticator. A synced copy or supported cross-device use
can satisfy this requirement; the original physical device is not necessarily required. A full
backup does not replace that credential. Recreating a passkey with the same name does not recreate
the wallet. Do not assume that moving a passkey between providers preserves the credential and PRF
behaviour that Nulo requires.

The credential alone does not restore separately imported account keys or all local wallet data;
those require appropriate intact backup material. **Successful profile restoration is not proof that
every account was recovered.**

**4.4 Backups and exports are your responsibility.** Available exports depend on profile type and
include full backups and, for supported profiles or accounts, recovery phrases or account-key
exports. **Nulo can produce both unencrypted and password-encrypted exports** — check which one you
saved. Anyone obtaining spendable recovery material, or an encrypted export together with the
credentials needed to use it, may be able to take the associated assets.

**4.5 Transactions may become impossible to stop or undo.** After submission, Nulo may be unable to
stop a transaction. Once final under the applicable protocol, a transaction generally cannot be
reversed through Nulo. A recipient's return transfer, a contract-specific refund, a network
reorganisation or a legal remedy is a separate matter and is not guaranteed. The Developer cannot
unilaterally retrieve funds sent to another address.

**4.6 You are responsible for what you approve.** Nulo displays available request information and,
where supported, decoded summaries. These may not identify every downstream effect of contract
execution or of an authorisation. Review the account, network, recipient, amounts, fees and
permissions before approving.

Disconnecting an application removes its wallet connection permissions; it does not necessarily
invalidate authorisations already issued or recorded on-chain. Revocation may require a separate
transaction, fees and network confirmation, and cannot undo an authorisation already used.

**4.7 Your device is part of your security.** Nulo cannot protect you from malware, a compromised or
rooted device, a malicious browser extension, a hostile operating system, clipboard-hijacking
software, screen capture, shoulder surfing, someone with physical access to your unlocked device, or
your own disclosure of a secret to a third party. Keep your device and browser secure and up to
date.

**4.8 Install Nulo from official sources.** Use the official store listings linked from `nulo.sh`.
Developer-published release archives, where offered, are identified through the official repository.
Verify the publisher and the source before installing; independent builds and impersonating
distributions are not official releases. The Developer does not control independent modifications or
impersonating distributions; responsibility for them remains subject to applicable law.

## 5. Experimental software on an early-stage network

**Nulo selects Aztec mainnet by default.** Mainnet transactions may involve assets with real value.
Selecting a network labelled testnet or local changes the environment. A version number, a store
listing or a mainnet connection is not a security certification.

**5.1 No independent security audit.** As at the effective date of these Terms, Nulo has **not** been
reviewed by an independent third-party security firm. It has been reviewed internally and with
automated tooling. That is not equivalent, and you should not treat it as equivalent.

**5.2 Software has bugs.** Nulo is complex software built on complex, rapidly changing dependencies:
the Aztec protocol, its client libraries, zero-knowledge proving systems, browser extension
platforms and browser cryptography APIs. Defects in any of these — in Nulo, in a dependency, or in
the protocol itself — can cause incorrect balances, failed or stuck transactions, corrupted local
data, disclosure of information you expected to stay private, or loss of access to funds.

**5.3 The Aztec network is not mine and is early in its life.** The Developer does not operate,
govern, control or speak for the Aztec network. That network may be upgraded, forked, halted,
reorganised, reset or abandoned; its rules, fees, addresses and deployed contracts may change; and
state you rely on — including balances and history — may be invalidated or destroyed.

The Developer cannot control network decisions or events. Their occurrence alone does not establish
a breach by the Developer; responsibility for the Developer's own conduct remains subject to
§§ 16–19.

**5.4 Use only what you can afford to lose entirely.** Treat every asset you hold through Nulo as at
risk of total loss.

**5.5 Local data can be lost.** Nulo's data lives in your browser's storage for this extension.
Clearing browser data, removing the extension, a browser or profile reset, disk failure, a failed
storage upgrade, or a change to the Aztec protocol can destroy it.

Keep recovery material outside the browser appropriate to your profile and accounts. A recovery
phrase alone does not restore passkey profiles, separately imported keys or all local application
data, and cannot repair an incompatible or unavailable network.

**5.6 Future versions may not be backward compatible.** Certain changes, particularly to how
accounts are derived, cannot be applied to existing profiles. If such a change becomes necessary, it
may ship as a **separate new extension** rather than an update.

A separately released extension major may derive different addresses and reject backups from the
earlier major. Importing the same recovery phrase into a new major does not transfer assets from old
addresses. Continued access may require the old extension, compatible account contracts and an
operational network.

## 6. Privacy is not anonymity

Nulo is built for a network that keeps certain information confidential on-chain. That is a real and
meaningful property, and it is also narrower than "anonymous".

- **Public transactions are public.** Some tokens and some operations only work publicly. Amounts,
  addresses and timing of those are visible to everyone, permanently.
- **A private transaction can still have public effects**, disclosed inputs, fee information and
  metadata.
- **Metadata leaks even when contents do not.** The node you connect to sees your IP address, when
  you are active, and the shape of your requests. Your network provider sees that you connect to it.
  Timing, amounts, fee payment patterns and your own behaviour across applications can be correlated.
- **Your counterparties know what they know.** Anyone you transact with, and anyone they tell, knows
  your side of it.
- **Confidentiality ends where your device ends.** Compromise of your browser, device or operating
  system defeats every on-chain privacy property.
- **No guarantee against any particular adversary.** The Developer makes no representation that
  Nulo, Aztec, or any combination of them will resist analysis by any specific party, including
  chain-analysis firms, well-resourced private actors or state agencies, now or in the future.
  Cryptography that is sound today may not be tomorrow.

**Do not rely on Nulo where being identified would put you in danger.** Nulo is a wallet, not a
protection system for people at risk, and it is not offered as one.

## 7. Third parties: nodes, tokens, applications and services

Nulo is a client. To be useful, it talks to things the Developer does not control.

**7.1 Nodes and network endpoints.** Nulo ships with default Aztec node endpoints purely as a
convenience so the wallet works out of the box. They are operated by third parties under their own
terms, may log your requests, may be slow, wrong, unavailable or hostile, and may be changed or
withdrawn at any time. You can change the endpoint in Settings → Networks. **Pending transactions may
continue to be checked through the endpoint used to submit them, including after you change or
remove that endpoint**, and changing an endpoint does not withdraw information already disclosed. A
default is not an endorsement, a recommendation or a warranty.

**7.2 Tokens and contracts.** Anyone can deploy a token or a contract and give it any name, symbol
or icon they like, including the name of a real one. Nulo showing a token, letting you add one, or
displaying a price for one is **not** a statement that it is genuine, valuable, lawful, solvent or
safe. Verifying a contract address before you interact with it is your responsibility.

**7.3 Applications you connect to.** Applications that connect to Nulo are third parties. I do not
review, vet, endorse or monitor them, and I have no relationship with them. Your dealings with them
are between you and them.

**7.4 Fee-payment contracts.** Paying fees through a third-party fee-payment contract means relying
on that contract and its operator. They may charge what they like, fail, or stop working.

**7.5 Supporting services.** Nulo uses a small number of third-party services — a price feed, links
to a block explorer, downloads of public proving parameters, and edge hosting for the passkey
relying-party domain. These are described in the [Privacy Policy](privacy.md). They are governed by
their own terms and privacy practices. The Developer does not control them or guarantee their
performance; this does not exclude responsibility imposed by law for the Developer's own
implementation, statements, selection or configuration.

**7.6 Optional local proving software.** Nulo can use a separate, locally installed proving
application to generate proofs faster. That is separate software, installed by you at your choice.
Its licence and privacy information are available at
[its licence](https://github.com/alejoamiras/presto/blob/main/LICENSE) (AGPL-3.0-only) and
[its privacy notice](https://github.com/alejoamiras/presto/blob/main/PRIVACY.md).
Nulo works without it.

**7.7 Browser and store platforms.** Your use of Nulo is also subject to the terms of your browser
and of the extension store you installed it from. Those platforms can remove, disable or restrict
extensions at any time, for their own reasons, and I cannot prevent it.

## 8. Fees

The Developer charges you nothing. Nulo is free, and there is no paid tier, subscription, commission
or in-product purchase.

You will pay network fees ("gas" or fee juice) to the Aztec network for transactions, and possibly
fees to third-party services you choose to use. Those are not mine, I do not receive any share of
them, and I cannot refund them. Fee estimates shown in Nulo are estimates and may be wrong.

## 9. Your responsibilities and acceptable use

You are responsible for your decisions and conduct. Responsibility for unauthorised activity,
software defects and third-party conduct is determined under applicable law and §§ 16–19.

**You must not** use Nulo:

- to commit, facilitate, conceal or benefit from any crime, including fraud, theft, money
  laundering, terrorist financing, proliferation financing, sanctions evasion, trafficking of any
  kind, or the sale of material whose sale is unlawful;
- to interfere with, attack, overload, or gain unauthorised access to any system, network, account
  or data, including the Aztec network, any node, or any other user;
- to impersonate the Developer, the Nulo project or any other person, or to distribute software that
  passes itself off as an official Nulo release (see § 13.2);
- in a way that breaches any law, regulation, sanction or court order that applies to you.

You must not bypass authentication or authorisation controls to gain unauthorised access to another
person's wallet or data. This does not prohibit supported settings or modifications permitted by the
applicable open-source licences.

## 10. Sanctions, export control and compliance

You must not use, obtain, export, re-export or transfer Nulo where doing so would violate sanctions
or export-control law applicable to you or to the Developer's provision of it. This includes
dealings with persons or territories where those dealings are prohibited, subject to applicable
exemptions and authorisations.

The extension does not operate a transaction-screening service, and the Developer cannot
unilaterally prevent transactions on the underlying network. Each party remains responsible for the
legal obligations applicable to that party. **Nothing here represents that use of Nulo is lawful for
a particular person, transaction or jurisdiction.**

## 11. Taxes

Any tax arising from your use of Nulo or from what you do with your assets is yours to determine,
report and pay. Nulo does not calculate, withhold, report or advise on tax, and the figures it shows
are not tax records. Fiat values displayed are indicative estimates from a third-party price feed
and should not be relied on for any purpose.

## 12. No advice, no relationship of trust

Nothing in Nulo or in any material published under the Nulo name is financial, investment, legal,
tax or accounting advice, or a recommendation, solicitation or offer to buy, sell or hold anything.
Balances, prices, estimates, labels and warnings shown in the interface may be incomplete, delayed or
affected by errors. Review transaction details before approving. This warning does not remove
responsibility for statements or duties that applicable law makes binding.

The Developer is not your agent, adviser, trustee, fiduciary, partner or broker, and owes you no
fiduciary duty, duty of care in respect of your financial decisions, or duty of best execution. You
make your own decisions.

## 13. Open source, licence and the Nulo name

**13.1 The code.** Nulo's code is licensed under the **Apache License, Version 2.0**, which governs
the rights it grants in source and object form. Parts of it are derived from Azguard Wallet,
Copyright 2026 BB Strategy Pte. Ltd., also licensed under Apache-2.0; the NOTICE file and the notices
accompanying each release identify them. These Terms address use of the Developer's
distributed extension and do not restrict rights granted by that licence. Bundled components are
licensed as identified in the licence files and notices accompanying each release, including any
alternative licence expressly granted by their copyright holders. These Terms do not restrict
permissions granted by those licences.

**13.2 The name and the marks.** Apache-2.0 does not grant trademark rights in the Nulo name or
marks, except for the descriptive uses permitted by that licence. Do not present a modified or
independent distribution as an official Nulo release or imply endorsement. Clearly distinguish
modified distributions from official Nulo releases, while retaining the notices required by
applicable licences. This does not withdraw copyright permissions already granted.

This matters for user safety before it matters for branding: software that looks like Nulo but is
not Nulo is the most effective way to rob its users.

**13.3 Contributions.** Contributions to the repository are made under the Apache-2.0 licence and
the project's contribution guidelines.

**13.4 Contributors are protected too.** Every disclaimer, exclusion and limitation in these Terms
applies for the benefit of the Developer **and** of every contributor to and maintainer of the Nulo
project, each of whom may rely on it.

## 14. Availability, changes and discontinuation

Nulo is provided on an "as available" basis. The Developer may change or discontinue features,
supported networks or distribution for security, technical, legal or maintenance reasons. Any
notice, continued access or remedy required by applicable law remains available.

There is no service level, no uptime commitment and no support obligation. Updates are delivered by
your browser's extension store and may install automatically; you should keep Nulo up to date, and
running an outdated version is at your own risk.

Discontinuation does not transfer ownership of your keys to the Developer. Continued access
nevertheless depends on working software, the relevant network and your recovery material. Another
wallet may not support Nulo's account derivation, account contracts, passkeys or backup format.

## 15. Feedback

If you send me feedback, bug reports, suggestions or ideas, you grant a non-exclusive, worldwide,
royalty-free licence to use, modify and incorporate your technical suggestions into Nulo and its
documentation without attribution or compensation. This licence does not authorise unrelated use of
personal information or public disclosure of confidential security reports.

Do not include your recovery phrase, password, private keys or backup files in any report.

## 16. NO WARRANTY

**This section and §§ 17–18 are subject to § 19**, which states the rights that survive them. If you
are a consumer in the European Union, the United Kingdom or Australia, read § 19 first: substantial
parts of this section do not apply to you, and nothing here is a representation that your statutory
rights do not exist.

**NULO IS PROVIDED "AS IS" AND "AS AVAILABLE", WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND.**

TO THE FULLEST EXTENT PERMITTED BY LAW, THE DEVELOPER AND EVERY CONTRIBUTOR TO NULO DISCLAIM ALL
WARRANTIES, CONDITIONS, REPRESENTATIONS AND TERMS, WHETHER EXPRESS, IMPLIED, STATUTORY OR ARISING
FROM COURSE OF DEALING OR USAGE OF TRADE, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY,
SATISFACTORY QUALITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, ACCURACY, AND
NON-INFRINGEMENT.

WITHOUT LIMITING THE ABOVE, THE DEVELOPER DOES NOT WARRANT THAT: NULO WILL BE UNINTERRUPTED, TIMELY,
SECURE, ACCURATE OR ERROR-FREE; THAT DEFECTS WILL BE CORRECTED; THAT NULO IS FREE OF VULNERABILITIES
OR HARMFUL CODE; THAT IT WILL DETECT OR WARN YOU ABOUT FRAUDULENT TOKENS, CONTRACTS, APPLICATIONS OR
COUNTERPARTIES; THAT ANY TRANSACTION WILL CONFIRM, SETTLE OR PRODUCE THE RESULT YOU INTENDED; OR
THAT ANY INFORMATION DISPLAYED IS CORRECT.

NO ADVICE OR INFORMATION, ORAL OR WRITTEN, OBTAINED FROM THE DEVELOPER OR THROUGH NULO CREATES ANY
WARRANTY NOT EXPRESSLY STATED HERE.

## 17. Limitation of liability

**17.1 Excluded losses.** SUBJECT TO § 19, AND TO THE FULLEST EXTENT PERMITTED BY LAW, THE DEVELOPER
AND EVERY CONTRIBUTOR TO NULO WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF OR INABILITY TO ACCESS **DIGITAL
ASSETS, TOKENS, KEYS, RECOVERY PHRASES OR PASSWORDS**, LOSS OF PROFITS, REVENUE, BUSINESS,
OPPORTUNITY, GOODWILL OR ANTICIPATED SAVINGS, LOSS OR CORRUPTION OF DATA, LOSS OF PRIVACY OR
CONFIDENTIALITY, OR THE COST OF SUBSTITUTE SOFTWARE OR SERVICES — IN EACH CASE HOWEVER CAUSED, UNDER
ANY THEORY OF LIABILITY (CONTRACT, TORT INCLUDING NEGLIGENCE, STRICT LIABILITY, STATUTE OR
OTHERWISE), AND EVEN IF ADVISED OF THE POSSIBILITY OF SUCH LOSS.

**17.2 Aggregate cap.** SUBJECT TO § 19, THE TOTAL AGGREGATE LIABILITY OF THE DEVELOPER AND ALL
CONTRIBUTORS TO YOU, FOR ALL CLAIMS ARISING OUT OF OR RELATING TO NULO OR THESE TERMS, WILL NOT
EXCEED THE GREATER OF (A) THE TOTAL AMOUNT YOU HAVE ACTUALLY PAID THE DEVELOPER FOR NULO (WHICH IS
ZERO), AND (B) **ONE HUNDRED UNITED STATES DOLLARS (US$100)**.

**17.3 Third parties.** The Developer does not control independent third-party services or guarantee
their performance. Responsibility for loss caused solely by those parties is governed by applicable
law and their arrangements with you. This section does not exclude responsibility imposed by law for
the Developer's own implementation, statements, selection or configuration.

**17.4 Independent allocation of risk.** Sections 17.1 and 17.2 are separate allocations of risk
underlying the free distribution of Nulo. Subject to § 19, each applies independently of any other
contractual remedy, including where that other remedy fails of its essential purpose.

## 18. Reimbursement by business users

**This section applies only to Business Users.** A Business User is a person acting mainly for their
trade, business, craft or profession who is not entitled to consumer protection for the claim
concerned under applicable law. It does not apply to a contract protected by the Australian
unfair-contract-terms rules for small-business contracts.

You will reimburse the Developer or a contributor for damages payable under a final judgment or a
settlement you approve, and reasonable external legal costs actually incurred in defending a
third-party claim, but only to the extent directly caused by your intentional unlawful use of Nulo
or your knowing infringement of that third party's rights. No amount may be recovered twice.

This obligation excludes losses attributable to the Developer's or a contributor's breach,
negligence or misconduct, and excludes penalties that cannot lawfully be transferred. The protected
party must give prompt notice, take reasonable steps to limit loss, and obtain your consent before
agreeing to a settlement for which it seeks reimbursement.

Nothing in this section releases any user from liability otherwise imposed by applicable law for
their intentional unlawful conduct. For consumers, any recovery of losses or legal costs is
determined under applicable law.

## 19. Rights you keep, whatever this document says

**Nothing in these Terms limits or excludes liability for death or personal injury caused by
negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be
limited or excluded.**

If you are a consumer, you have rights under the mandatory consumer protection law of the country
where you live, and these Terms do not affect them. Sections 16, 17.1 and 17.2 apply only so far as
that law allows.

**19.1 Argentina.** If you are a consumer under Law No. 24,240 (*Ley de Defensa del Consumidor*) and
Article 42 of the National Constitution, nothing in §§ 16–18 excludes, restricts or waives any right
or remedy that law gives you. Article 37 of that law treats clauses limiting liability for damage,
or waiving or restricting consumer rights, as **not written** — these Terms do not attempt to do so,
and are to be read accordingly.

**19.2 Australia.** If the Australian Consumer Law applies to you, Nulo comes with guarantees that
**cannot be excluded** under that law, and nothing in §§ 16–18 excludes, restricts or modifies any
such guarantee, right or remedy, or purports to represent that it does not exist. Where a guarantee
applies and liability for breach of it may lawfully be limited, the Developer's liability is limited
to resupplying the software or paying the cost of having it resupplied.

**19.3 United Kingdom.** If you are a consumer, nothing in §§ 16–18 excludes or restricts any right
or remedy under the Consumer Rights Act 2015 or other mandatory UK consumer law, and those
provisions bind you only so far as that law permits.

**19.4 European Union.** If you are a consumer habitually resident in an EU member state, nothing in
§§ 16–18 deprives you of the protection of the mandatory provisions of the law of that state.

**19.5 Everywhere else.** If a provision is unlawful, unfair or unenforceable against you, it does
not apply to the extent required by applicable law. The remaining provisions continue where the
agreement can lawfully operate without it. An unfair consumer term will not be rewritten merely to
preserve a restriction that applicable law requires to be disregarded.

## 20. Changes to these Terms

I may change these Terms. Each version carries a version number and an effective date, and the
current version is published at `nulo.sh/terms`. Previous versions remain archived and linked there.

- **Material changes** — ones that meaningfully affect your rights or obligations — will be shown to
  you in Nulo, and you will be asked to accept the new version before you continue using it.
- **Non-material changes** (typos, clarifications, updated links) take effect when published.

If you decline revised Terms, they do not take effect by that refusal alone. Declining will not
itself disable the backup or export functions available for your profile under the previously
accepted Terms. Those functions still require the relevant credentials and functioning software, and
passkey backups still require the original credential for recovery. Changes do not retrospectively
alter accrued claims.

## 21. Ending this agreement

You may end it at any time by uninstalling Nulo. There is nothing to cancel and no account to close.

I may stop publishing or supporting Nulo at any time (§ 14).

Sections 2, 4, 5, 8, 10, 11, 12, 13, 15, 16, 17, 18, 19, 22 and 23 survive the end of this
agreement.

## 22. Governing law and where disputes are heard

Subject to mandatory consumer rights, these Terms are governed by the laws of **the Argentine
Republic**, and the competent courts of **the Ciudad Autónoma de Buenos Aires, Argentina** have
exclusive jurisdiction.

**If you are a consumer, that exclusive-jurisdiction sentence does not apply to you.** It does not
remove any mandatory protection, does not remove a right to sue in another court available under
applicable law, and does not permit proceedings against you in a court that applicable law
prohibits.

**Consumers in Argentina.** Article 1109 of the Civil and Commercial Code fixes jurisdiction at the
place where the consumer received or should have received performance, and treats a clause extending
jurisdiction elsewhere as **not written**. The choice of Buenos Aires courts above therefore has no
effect on you.

These Terms do not require arbitration and do not waive rights to participate in collective
proceedings. After a dispute arises, the parties may agree to mediation or arbitration.

Claims are subject to the limitation periods imposed by applicable law. Contacting the Developer
does not suspend those periods unless applicable law or a separate written agreement provides
otherwise.

Before starting proceedings, please contact me at hello@nulo.sh and describe the problem. I
would much rather fix it.

## 23. General

- **Scope of this agreement.** These Terms govern the contractual matters they address. The
  [Privacy Policy](privacy.md) explains personal-data processing; accepting these Terms is not
  consent to processing that requires separate consent. Nothing here excludes liability for
  misleading statements or overrides representations or rights that applicable law makes binding.
- **Severability.** As stated in § 19.
- **No waiver.** Not enforcing a provision is not a waiver of it.
- **Assignment.** You may not assign or transfer these Terms. The Developer may transfer contractual
  rights to a successor that assumes the corresponding obligations, subject to applicable law and
  any required notice or consent. A transfer does not reduce your accrued rights or release the
  Developer from existing liability without a legally effective agreement.
- **No third-party rights**, except that contributors and maintainers may enforce §§ 13.4, 16, 17
  and 18 (see § 13.4).
- **Events outside reasonable control.** Where performance is prevented or delayed by something
  outside the Developer's reasonable control — including network, protocol, infrastructure,
  platform, hardware or supplier failures, or acts of government — that alone does not establish a
  breach by the Developer. Responsibility for the Developer's own conduct remains subject to
  §§ 16–19.
- **Electronic communications.** You agree that notices may be given electronically — in Nulo, at
  `nulo.sh`, or by email — and that this satisfies any requirement that a communication be in
  writing.
- **Language.** These Terms are written in English. The English version controls except where
  mandatory law requires another language version or interpretation to prevail.
- **Headings** are for navigation and do not affect interpretation.

## 24. Contact

**Alejo Amiras** — hello@nulo.sh

Security vulnerabilities: please follow the disclosure process at
https://github.com/alejoamiras/nulo/security (GitHub's private vulnerability reporting) rather than the
public feedback forms.

---

## Version history

| Version | Effective | Change |
|---|---|---|
| 1.0 | «FILL: effective date» | First published version. |
