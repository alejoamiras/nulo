# Terms of Use

**Version 1.0 — effective «FILL: effective date»**

These Terms are a binding agreement between you and the developer of Nulo. Read them before you
install or use Nulo. If you do not agree, do not install or use it.

> **The short version.** Nulo is free, open-source software that runs in your browser. It is not a
> company, a bank, an exchange or a custodian. Nobody but you can access your keys or your funds —
> which also means nobody, including the developer, can recover them if you lose them, and nobody
> can reverse a transaction you send. Nulo has not been audited by an independent security firm, and
> the network it connects to is early-stage. You can lose everything you put into it. It is provided
> as-is, with no warranty and effectively no liability.
>
> *This box is a convenience summary. It is not part of the agreement — the numbered sections below
> are what you are agreeing to, and they control if the two ever differ.*

---

## 1. Who you are agreeing with

Nulo is an independent, open-source project maintained by **«FILL: legal name»**, a natural person
resident in «FILL: country/state of residence» ("**the Developer**", "**I**", "**me**", "**my**").

There is no company, foundation, DAO or other legal entity behind Nulo. There are no employees, no
support desk and no service organisation. These Terms are an agreement between you and one
individual.

Contact: **«FILL: contact email»**.

In these Terms, "**Nulo**" means the Nulo browser extension for Chrome and Firefox, the website at
`nulo.sh` and its subdomains, and any other software or content the Developer publishes under the
Nulo name. "**You**" means the person using Nulo.

## 2. What Nulo is, and what it is not

**Nulo is a self-custody wallet interface.** It is software that runs entirely inside your own web
browser on your own device. It generates and stores cryptographic keys locally, builds and signs
transactions locally, generates zero-knowledge proofs locally, and sends the results to a node on
the Aztec network that you have chosen.

**Nulo is not, and the Developer does not operate:**

- a bank, a trust, a broker, a dealer, an exchange, a custodian or a depository;
- a money transmitter, money services business, payment institution, payment processor, e-money
  issuer, virtual asset service provider or crypto-asset service provider;
- an investment adviser, financial adviser, tax adviser or legal adviser;
- the Aztec network, any node on it, any smart contract on it, any token on it, or any application
  that connects to it.

**The Developer never has custody of anything of yours.** I do not hold, receive, transmit, control,
freeze, seize or have any access to your keys, your recovery phrase, your password, your passkey or
your funds. I hold no account for you and no assets of yours. There is nothing for me to return,
refund, reverse or recover, and no lawful order can compel me to produce what I have never had.

**Nulo does not intermediate your transactions.** When you send a transaction, your browser sends it
to a node. It does not pass through me, and I have no ability to approve, delay, block, screen,
censor or undo it. Nothing in these Terms should be read as the Developer assuming any duty to
monitor, review or intervene in what you or anyone else does with Nulo.

## 3. Eligibility and how you accept these Terms

You may use Nulo only if you:

1. are at least **18 years old** and have full legal capacity to enter into this agreement;
2. are not a person with whom dealing is prohibited under applicable sanctions law (see § 10);
3. are not located in, ordinarily resident in, or organised under the laws of a jurisdiction where
   use of Nulo, self-custody wallet software or the underlying assets is unlawful; and
4. will comply with all laws that apply to you.

You accept these Terms by ticking the acceptance control shown when you first set up Nulo, and in
any case by installing or using it. If you do not meet the conditions above, or do not agree, you
must not install or use Nulo, and you should uninstall it.

**You will be asked to confirm that you understand, specifically, that:** you alone hold your keys;
that losing your recovery phrase, password or passkey means permanent and unrecoverable loss of
access to your funds; that transactions are irreversible; and that Nulo is unaudited software
connected to an early-stage network on which you may lose everything.

## 4. Self-custody: what that actually means for you

This section is the most important one in this document.

**4.1 Your keys are yours alone.** Nulo derives your keys on your device from a recovery phrase and
protects them with a password or a passkey that only you hold. None of these ever leave your device
in usable form, and none of them are known to, recoverable by, or escrowed with the Developer or
anyone else.

**4.2 There is no recovery, reset or backdoor.** If you lose your recovery phrase, forget your
password, or lose the device or authenticator holding your passkey, **your funds are permanently and
irreversibly lost**. There is no "forgot password" path, no support ticket, no identity check, no
override. This is not a limitation that will be fixed later; it is the design.

**4.3 Passkeys are bound to the authenticator that created them.** A passkey-protected profile
depends on a credential held by a specific authenticator (a device, a security key or a platform
keychain). If that authenticator is lost, wiped, reset or becomes unavailable, and you did not
separately back up your recovery phrase, that profile and everything in it is unrecoverable. Passkey
credentials are generally not portable between vendors or platforms. **Back up your recovery phrase
separately, in a form that does not depend on any single device.**

**4.4 Backups are your responsibility.** Nulo can export your recovery phrase and an encrypted
backup file. Where you put those, how you protect them, and who can reach them is entirely up to
you. Anyone who obtains your recovery phrase — or your backup file together with its password — can
take everything, immediately and irreversibly.

**4.5 Transactions are final.** A transaction accepted by the network cannot be cancelled, reversed,
charged back, refunded or recalled by anyone, including you, the Developer, any node operator or any
court. Funds sent to the wrong address, to a contract that cannot return them, or to an address
controlled by a fraudster are gone.

**4.6 You are responsible for what you approve.** When an application asks Nulo to do something, you
decide. Nulo shows you what is being requested, but it cannot know whether the request is honest,
whether a contract does what it claims, whether a token is genuine, or whether a counterparty will
perform. Read what you sign. Grants you give to applications — including authorisation witnesses and
capability grants — can be used later, and you are responsible for reviewing and revoking them.

**4.7 Your device is part of your security.** Nulo cannot protect you from malware, a compromised or
rooted device, a malicious browser extension, a hostile operating system, clipboard-hijacking
software, screen capture, shoulder surfing, someone with physical access to your unlocked device, or
your own disclosure of a secret to a third party. Keep your device and browser secure and up to
date.

**4.8 Install Nulo only from official sources.** The Chrome Web Store and Firefox Add-ons listings
linked from `nulo.sh` are the only distributions I publish. Wallet software is a favourite target
for impersonation; a copy obtained anywhere else may be built to steal from you. The Developer has
no responsibility for any software you did not obtain from an official listing.

## 5. Experimental software on an early-stage network

**5.1 No independent security audit.** As at the effective date of these Terms, Nulo has **not** been
reviewed by an independent third-party security firm. It has been reviewed internally and by
automated tooling. That is not equivalent, and you should not treat it as equivalent.

**5.2 Software has bugs.** Nulo is complex software built on complex, rapidly changing dependencies:
the Aztec protocol, its client libraries, zero-knowledge proving systems, browser extension
platforms and browser cryptography APIs. Defects in any of these — in Nulo, in a dependency, or in
the protocol itself — can cause incorrect balances, failed or stuck transactions, corrupted local
data, disclosure of information you expected to stay private, or total and permanent loss of funds.

**5.3 The Aztec network is not mine and is early in its life.** The Developer does not operate,
govern, control or speak for the Aztec network. That network may be upgraded, forked, halted,
reorganised, reset or abandoned; its rules, fees, addresses and deployed contracts may change; and
state you rely on — including balances and history — may be invalidated or destroyed. None of that
is within my control, and none of it creates any obligation or liability for me.

**5.4 Use only what you can afford to lose entirely.** Treat every asset you hold through Nulo as at
risk of total loss. This is not a formality. It is the honest expected-case advice.

**5.5 Local data can be lost.** Nulo's data lives in your browser's storage for this extension.
Clearing browser data, removing the extension, a browser or profile reset, disk failure, a failed
storage upgrade, or a change to the Aztec protocol can destroy it. **Your recovery phrase — kept
somewhere outside the browser — is the only thing that survives all of these.**

**5.6 Future versions may not be backward compatible.** Certain changes, particularly to how
accounts are derived, cannot be applied to existing profiles. If such a change becomes necessary,
it may ship as a **separate new extension** rather than an update, and profiles created in an
earlier version may remain usable only in that earlier version. Your recovery phrase remains yours
in every case, but the addresses derived from it may differ between versions.

## 6. Privacy is not anonymity

Nulo is built for a network that keeps certain information confidential on-chain. That is a real and
meaningful property, and it is also narrower than "anonymous".

- **Public transactions are public.** Some tokens and some operations only work publicly. Amounts,
  addresses and timing of those are visible to everyone, permanently.
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
withdrawn at any time. You may replace them with your own at any time in Settings, and doing so is
the only way to remove that third party from your data path. A default is not an endorsement, a
recommendation or a warranty.

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
to a block explorer, and edge hosting for the passkey helper page. These are described in the
[Privacy Policy](privacy.md). They are governed by their own terms and privacy practices, and the
Developer is not responsible for them.

**7.6 Optional local proving software.** Nulo can use a separate, locally installed proving
application to generate proofs faster. That is separate software with its own licence and terms,
installed by you at your choice. Nulo works without it.

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

You are responsible for your own conduct and for everything done through your installation of Nulo.

**You must not** use Nulo:

- to commit, facilitate, conceal or benefit from any crime, including fraud, theft, money
  laundering, terrorist financing, proliferation financing, sanctions evasion, trafficking of any
  kind, or the sale of material whose sale is unlawful;
- to interfere with, attack, overload, or gain unauthorised access to any system, network, account
  or data, including the Aztec network, any node, or any other user;
- to impersonate the Developer, the Nulo project or any other person, or to distribute software that
  passes itself off as Nulo (see § 13.2);
- in a way that breaches any law, regulation, sanction or court order that applies to you.

You must not remove, disable or work around any warning, confirmation or security control in Nulo
and then treat the consequences as my problem.

## 10. Sanctions and compliance

You represent, each time you use Nulo, that you are not:

- listed on any sanctions list maintained by the United States (including OFAC's Specially
  Designated Nationals list), the United Nations, the European Union, the United Kingdom, or
  «FILL: country/state of residence»;
- owned or controlled by, or acting for, any such person; or
- located in, ordinarily resident in, or organised under the laws of any territory subject to
  comprehensive sanctions.

You are responsible for your own compliance with sanctions, export control, anti-money-laundering,
securities, tax and any other law that applies to you.

**The Developer cannot and does not screen, monitor or block anything.** Nulo runs on your device and
connects to a public network. I have no mechanism to identify users, inspect transactions or prevent
any transaction from being sent, and nothing in these Terms creates a duty to try. Your
representations in this section are yours to keep, not mine to verify.

## 11. Taxes

Any tax arising from your use of Nulo or from what you do with your assets is yours to determine,
report and pay. Nulo does not calculate, withhold, report or advise on tax, and the figures it shows
are not tax records. Fiat values displayed are indicative estimates from a third-party price feed and
should not be relied on for any purpose.

## 12. No advice, no relationship of trust

Nothing in Nulo or in any material published under the Nulo name is financial, investment, legal,
tax or accounting advice, or a recommendation, solicitation or offer to buy, sell or hold anything.
Information shown in the interface — balances, prices, estimates, labels, warnings — is provided for
convenience, may be incomplete, delayed or wrong, and must not be relied on as accurate.

The Developer is not your agent, adviser, trustee, fiduciary, partner or broker, and owes you no
fiduciary duty, duty of care in respect of your financial decisions, or duty of best execution. You
make your own decisions.

## 13. Open source, licence and the Nulo name

**13.1 The code.** Nulo's source code is published under the **Apache License, Version 2.0**. That
licence governs your rights to use, copy, modify and distribute the source code, and it contains its
own disclaimer of warranties and limitation of liability. These Terms govern your use of the built
extension and the Nulo services as I distribute them. Where the two overlap in respect of the source
code, the Apache-2.0 licence controls; these Terms do not reduce any right the licence grants you.

**13.2 The name and the mark.** "Nulo", the Nulo logo and the Nulo visual identity are **not**
licensed under Apache-2.0 (see section 6 of that licence) and are reserved. You may refer to Nulo by
name descriptively and truthfully. You may not use the name or logo in a way that suggests your
build, fork, service or product is Nulo, is endorsed by Nulo, or comes from me. **If you fork Nulo,
rename it.** This is a user-safety rule before it is a branding one: a wallet that looks like Nulo
but is not Nulo is the most effective way to rob its users.

**13.3 Contributions.** Contributions to the repository are made under the Apache-2.0 licence and
the project's contribution guidelines.

**13.4 Contributors are protected too.** Every disclaimer, exclusion and limitation in these Terms
applies for the benefit of the Developer **and** of every contributor to and maintainer of the Nulo
project, each of whom may rely on it.

## 14. Availability, changes and discontinuation

Nulo is provided on an "as available" basis. The Developer may, at any time and without notice or
liability:

- change, add to or remove any feature or behaviour;
- change or remove default network endpoints, supported networks or bundled contract addresses;
- stop publishing updates; unpublish Nulo from any store; or discontinue the project entirely.

There is no service level, no uptime commitment, no support obligation and no guarantee that any
version will keep working. Updates are delivered by your browser's extension store and may install
automatically; you should keep Nulo up to date, and running an outdated version is at your own risk.

**If I stop, you are not locked out.** Your keys are yours and your recovery phrase works in any
compatible wallet. The source code remains available under Apache-2.0.

## 15. Feedback

If you send me feedback, bug reports, suggestions or ideas, you grant me a perpetual, irrevocable,
worldwide, royalty-free, sublicensable licence to use them for any purpose without restriction,
attribution or compensation. Do not send me anything you consider confidential, and do not include
your recovery phrase, password, private keys or backup files in any report — I will never ask for
them, and anyone who does is trying to rob you.

## 16. NO WARRANTY

**NULO IS PROVIDED "AS IS" AND "AS AVAILABLE", WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND.**

TO THE FULLEST EXTENT PERMITTED BY LAW, THE DEVELOPER AND EVERY CONTRIBUTOR TO NULO DISCLAIM ALL
WARRANTIES, CONDITIONS, REPRESENTATIONS AND TERMS, WHETHER EXPRESS, IMPLIED, STATUTORY OR ARISING
FROM COURSE OF DEALING OR USAGE OF TRADE, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY,
SATISFACTORY QUALITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, ACCURACY, AND
NON-INFRINGEMENT.

WITHOUT LIMITING THE ABOVE, THE DEVELOPER DOES NOT WARRANT THAT: NULO WILL BE UNINTERRUPTED, TIMELY,
SECURE, ACCURATE OR ERROR-FREE; THAT DEFECTS WILL BE CORRECTED; THAT NULO IS FREE OF VULNERABILITIES
OR HARMFUL CODE; THAT IT WILL PROTECT YOUR FUNDS OR YOUR PRIVACY; THAT IT WILL DETECT OR WARN YOU
ABOUT FRAUDULENT TOKENS, CONTRACTS, APPLICATIONS OR COUNTERPARTIES; THAT ANY TRANSACTION WILL
CONFIRM, SETTLE OR PRODUCE THE RESULT YOU INTENDED; OR THAT ANY INFORMATION DISPLAYED IS CORRECT.

NO ADVICE OR INFORMATION, ORAL OR WRITTEN, OBTAINED FROM THE DEVELOPER OR THROUGH NULO CREATES ANY
WARRANTY NOT EXPRESSLY STATED HERE.

## 17. LIMITATION OF LIABILITY

TO THE FULLEST EXTENT PERMITTED BY LAW:

**17.1 Excluded losses.** THE DEVELOPER AND EVERY CONTRIBUTOR TO NULO WILL NOT BE LIABLE FOR ANY
INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF OR
INABILITY TO ACCESS **DIGITAL ASSETS, TOKENS, KEYS, RECOVERY PHRASES OR PASSWORDS**, LOSS OF PROFITS,
REVENUE, BUSINESS, OPPORTUNITY, GOODWILL OR ANTICIPATED SAVINGS, LOSS OR CORRUPTION OF DATA, LOSS OF
PRIVACY OR CONFIDENTIALITY, OR THE COST OF SUBSTITUTE SOFTWARE OR SERVICES — IN EACH CASE HOWEVER
CAUSED, UNDER ANY THEORY OF LIABILITY (CONTRACT, TORT INCLUDING NEGLIGENCE, STRICT LIABILITY,
STATUTE OR OTHERWISE), AND EVEN IF ADVISED OF THE POSSIBILITY OF SUCH LOSS.

**17.2 Aggregate cap.** THE TOTAL AGGREGATE LIABILITY OF THE DEVELOPER AND ALL CONTRIBUTORS TO YOU,
FOR ALL CLAIMS ARISING OUT OF OR RELATING TO NULO OR THESE TERMS, WILL NOT EXCEED THE GREATER OF
(A) THE TOTAL AMOUNT YOU HAVE ACTUALLY PAID THE DEVELOPER FOR NULO (WHICH IS ZERO), AND
(B) **ONE HUNDRED UNITED STATES DOLLARS (US$100)**.

**17.3 No liability for third parties or the network.** THE DEVELOPER IS NOT LIABLE FOR ANYTHING
DONE OR NOT DONE BY THE AZTEC NETWORK, ANY NODE OR ENDPOINT OPERATOR, ANY SMART CONTRACT, ANY TOKEN
ISSUER, ANY APPLICATION, ANY PRICE OR EXPLORER SERVICE, ANY BROWSER OR EXTENSION STORE, ANY
AUTHENTICATOR OR PASSKEY PROVIDER, OR ANY OTHER THIRD PARTY — INCLUDING WHERE NULO REFERS TO,
DEFAULTS TO, OR INTEROPERATES WITH THEM.

**17.4 Basis of the bargain.** THESE EXCLUSIONS AND LIMITS APPLY EVEN IF A REMEDY FAILS OF ITS
ESSENTIAL PURPOSE, AND ARE A FUNDAMENTAL BASIS ON WHICH NULO IS MADE AVAILABLE TO YOU FREE OF
CHARGE. WITHOUT THEM, NULO WOULD NOT BE PUBLISHED AT ALL.

## 18. Your indemnity

You will indemnify and hold harmless the Developer and every contributor to Nulo against any claim,
demand, loss, liability, damage, penalty, cost and expense (including reasonable legal fees) brought
by a third party and arising out of: (a) your use or misuse of Nulo; (b) your breach of these Terms
or of any law; (c) your infringement of anyone's rights; or (d) anything you do with your keys or
your assets.

This does not apply to the extent the claim arises from my own fraud, wilful misconduct, or anything
for which liability cannot lawfully be excluded. If you are a consumer, this section applies only to
the extent permitted by the consumer law that protects you.

## 19. Rights you keep, whatever this document says

**Nothing in these Terms limits or excludes liability for death or personal injury caused by
negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be
limited or excluded.**

If you are a consumer, you have rights under the mandatory consumer protection law of the country
where you live, and these Terms do not affect them. Where a provision of these Terms is
unenforceable against you under that law, it applies to the maximum extent that law permits, and
everything else in these Terms stays in force.

Some jurisdictions do not allow the exclusion of implied warranties or the limitation of certain
damages, so parts of §§ 16–18 may not apply to you.

## 20. Changes to these Terms

I may change these Terms. Each version carries a version number and an effective date, and the
current version is always published at `nulo.sh/terms`.

- **Material changes** — ones that meaningfully affect your rights or obligations — will be shown to
  you in Nulo, and you will be asked to accept the new version before you continue using it.
- **Non-material changes** (typos, clarifications, updated links) take effect when published.

If you do not accept a new version, stop using Nulo and uninstall it. **You will always be able to
export your recovery phrase first** — declining new Terms never locks you out of your own keys.

## 21. Ending this agreement

You may end it at any time by uninstalling Nulo. There is nothing to cancel and no account to close.

I may stop publishing or supporting Nulo at any time (§ 14). I cannot cut off your access to your
own keys or assets, because I never had it.

Sections 2, 4, 5, 8, 10, 11, 12, 13, 15, 16, 17, 18, 19, 22 and 23 survive the end of this
agreement.

## 22. Governing law and where disputes are heard

These Terms, and any dispute or claim arising out of or in connection with them or with Nulo
(including non-contractual disputes), are governed by the laws of **«FILL: country/state of
residence»**, without regard to its conflict-of-laws rules.

The courts of **«FILL: country/state of residence»** have exclusive jurisdiction, and you and I both
submit to them.

**If you are a consumer**, nothing above deprives you of the protection of the mandatory law of your
country of residence, or of the right to bring proceedings in the courts of that country where the
law gives you that right.

Before starting proceedings, please contact me at «FILL: contact email» and describe the problem. I
would much rather fix it.

## 23. General

- **Entire agreement.** These Terms and the [Privacy Policy](privacy.md) are the whole agreement
  between you and me about Nulo, and replace anything said before. Nothing in any marketing
  material, README, social post or conversation adds a warranty or an obligation.
- **Severability.** If any provision is held unenforceable, it is modified to the minimum extent
  needed to make it enforceable, or severed, and the rest stays in force.
- **No waiver.** Not enforcing a provision is not a waiver of it.
- **Assignment.** You may not assign or transfer these Terms. I may assign them to a successor of
  the Nulo project — for example, if the project is later placed under a foundation or entity — on
  notice published at `nulo.sh`.
- **No third-party rights**, except that contributors and maintainers may enforce §§ 13.4, 16, 17
  and 18 (see § 13.4).
- **Force majeure.** I am not liable for any failure or delay caused by anything outside my
  reasonable control, including network, protocol, infrastructure, platform, hardware or supplier
  failures, or acts of government.
- **Electronic communications.** You agree that notices may be given electronically — in Nulo, at
  `nulo.sh`, or by email — and that this satisfies any requirement that a communication be in
  writing.
- **Language.** These Terms are written in English. Any translation is for convenience only; the
  English version controls.
- **Headings** are for navigation and do not affect interpretation.

## 24. Contact

**«FILL: legal name»** — «FILL: contact email»

Security vulnerabilities: please follow the disclosure process in
[`SECURITY.md`](../SECURITY.md) rather than the public forms.

---

## Version history

| Version | Effective | Change |
|---|---|---|
| 1.0 | «FILL: effective date» | First published version. |
