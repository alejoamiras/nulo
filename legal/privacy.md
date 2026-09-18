# Privacy Policy

**Version 1.0 — effective «FILL: effective date»**

This policy explains what happens to information when you use Nulo. It is written to be checkable:
everything in it can be verified against the published source code, and where a claim depends on a
setting, the setting is named.

> **The short version.** Nulo has no accounts, no servers that hold your data, no analytics, no
> telemetry, no tracking, no advertising and no third-party scripts. The Developer receives nothing
> about you and nothing about your wallet. Your keys, balances and history stay in your browser,
> encrypted. A few things must leave your device for the wallet to work at all — requests to an
> Aztec node, and an optional price lookup — and this policy says exactly what those are, what they
> reveal, and how to turn off or replace each one.
>
> *This box is a summary. The sections below are the policy.*

---

## 1. Who is responsible

Nulo is maintained by **«FILL: legal name»**, a natural person resident in «FILL: country/state of
residence» ("**the Developer**", "**I**"). There is no company. For the purposes of the EU/UK General
Data Protection Regulation, I am the controller for the very limited processing described in § 5.4
and § 5.5 — which is all the processing I am in a position to do.

Contact: **«FILL: contact email»**

## 2. What I collect about you: nothing

I do not operate a backend for the wallet. There is no account, no sign-up, no profile on any server
of mine, and no identifier assigned to you.

Specifically, Nulo contains **no** analytics SDK, **no** crash or error reporting service, **no**
telemetry, **no** advertising or marketing tags, **no** cookies set by me, **no** fingerprinting, and
**no** third-party scripts of any kind. The extension's content security policy forbids loading
remote code.

I do not sell, rent, share or trade personal information, because I do not have any to sell.

## 3. What Nulo stores on your device

All of this is held by your browser, in storage belonging to the Nulo extension. It never leaves your
device except when you deliberately export it.

| What | Where | Protection |
|---|---|---|
| Recovery phrase / master secret | Extension local storage | Encrypted with AES-GCM under a key derived from your password, or from your passkey |
| Account addresses and metadata | Extension local storage | Plain (they are not secrets, but they are yours) |
| Profile names, settings, theme | Extension local storage | Plain |
| Contacts you save | Extension local storage | Plain |
| Tracked tokens, cached balances, cached prices | Extension local storage | Plain |
| Transaction history and activity records | Extension local storage | Plain |
| Networks and node endpoints | Extension local storage | Plain |
| Connected applications and permissions you granted | Extension local storage | Plain |
| Unlocked-session state | Extension session storage | Cleared when the browser closes |
| Private execution database (notes, proving state) | Browser IndexedDB, managed by the Aztec client | As provided by that component |
| Diagnostic logs | In memory; written to session storage only if you turn on Developer Mode | See § 8 |

**Deleting it all:** remove the extension, or clear its site data, and all of the above is gone from
that browser. Nothing of it exists anywhere else. Your recovery phrase, kept outside the browser, is
the only way back in — see the [Terms of Use](terms.md) § 4.

## 4. What Nulo never does with your secrets

Your recovery phrase, master secret, password and passkey secret are never transmitted anywhere, in
any form, by any code path. They are never sent to me, never sent to a node, never included in a
diagnostic log, and never exposed to a website or an application you connect to. A password is used
only to derive an encryption key, locally, and is not stored.

I will never ask you for any of them. **Anyone who does — by email, chat, form, or a page that looks
like Nulo — is trying to rob you.**

## 5. What leaves your device, and to whom

This is the complete list.

### 5.1 The Aztec node you are connected to

**What it is:** to read balances, follow the chain and submit transactions, Nulo sends requests to an
Aztec node over HTTPS. Nulo ships with default endpoints operated by a third-party provider so the
wallet works on first run.

**What that party can see:** your IP address, your user agent, when you are active, and the requests
you make — which for some requests reveals what you are interested in (for example, the contracts
and public addresses you are reading). Submitting a transaction reveals to that node that a
transaction came from your IP at that moment. This is inherent to using any network client and is
not specific to Nulo.

**What it cannot see:** your keys, your recovery phrase, your password, or the contents of your
private notes and private transactions, which are decrypted and proven only on your device.

**Your control:** Settings → Networks lets you replace any endpoint with one you trust or run
yourself. Replacing the default is the only way to remove that provider from your data path. The
Developer receives no data from this and gets no report about it.

### 5.2 Price data (CoinGecko)

**What it is:** while a profile is unlocked, Nulo makes one batched request roughly every three
minutes to CoinGecko's public API for fiat prices.

**What it reveals:** your IP address, and that you are running something that asks for that fixed set
of prices. **It does not reveal what you hold.** The request is always for the same fixed, built-in
list of token identifiers and never varies with your balances, your holdings or your activity — so
the request looks identical for every Nulo user. No price request is ever triggered by a
transaction.

**Your control:** turn off fiat values in Settings. That disables the feed entirely and clears the
cached prices.

### 5.3 Block explorer links (Aztecscan)

**What it is:** transaction rows can link out to a public block explorer.

**What it reveals:** nothing until you click. When you click, the explorer sees your IP address and
the transaction hash you opened, like any website you visit.

**Your control:** the explorer can be disabled in Settings → Advanced, which removes the links.

### 5.4 `passkey.nulo.sh` — the passkey helper page

**What it is:** if you protect a profile with a passkey, the WebAuthn ceremony is bound to the domain
`passkey.nulo.sh`, which I operate on Cloudflare. It serves a single static page with no scripts and
a strict content security policy; it exists purely as a cryptographic anchor and contains no
application code and no logic of any kind.

**What it reveals:** loading it makes an ordinary HTTPS request, so Cloudflare's edge processes your
IP address, user agent and the time, as it does for any website. I do not run analytics on this host,
do not build profiles from it, and do not use it to identify or count users. No wallet data, no key
material and no identifier of yours is sent to it — WebAuthn secrets are produced by your
authenticator and never reach the page or the server.

**Legal basis (GDPR):** legitimate interests — serving the page you requested, and keeping it
available and secure — under Article 6(1)(f).

### 5.5 `nulo.sh` and its forms

The website is static and carries no analytics or tracking. If you choose to open a feedback, bug,
or scam-report form, you send me whatever you type into it, plus whatever the form provider records
(such as your IP address). Only send what you are comfortable sending, and never send secrets. Legal
basis: your consent, and my legitimate interest in fixing what you report.

**Uninstall page.** If you remove the extension, your browser opens a page on `nulo.sh` so I can
learn why people leave. This is a plain page request — it carries your IP address and nothing that
identifies you or your wallet. Nothing is attached to it from the extension.

### 5.6 The extension store

Google and Mozilla distribute Nulo and see installs, updates and whatever their platforms record.
That is their processing under their own privacy policies, not mine. I can see only aggregate,
anonymous statistics in the developer dashboards — install counts and similar — never anything about
an individual user.

### 5.7 Applications you connect to

When you connect Nulo to an application, that application learns what you approve: typically your
account address, and the details of what you ask it to do. That is the point of connecting, and it is
between you and them. Settings → Connected Apps shows what you have granted and lets you revoke it.

A small relay script runs on web pages so that applications can discover the wallet, following the
standard Aztec wallet protocol. **It does not read page content, does not observe your browsing, and
sends nothing anywhere.** It only passes messages between a page that is explicitly talking to a
wallet and the extension. Its entire source is a few lines and is published in the repository.

### 5.8 Local proving software

If you install the optional native proving application, Nulo talks to it on your own machine over
`127.0.0.1`. That traffic never leaves your computer. That application is separate software with its
own terms.

## 6. Browser permissions, and why each one exists

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | To keep your wallet data on your device; proving data is large |
| `alarms` | To schedule background refreshes while unlocked |
| `offscreen` | To run the private execution environment in a hidden document |
| `sidePanel` | The optional side-panel view |
| `downloads` | To save a backup file when **you** ask to export one |
| Access to `passkey.nulo.sh` | The passkey ceremony (§ 5.4) |
| Access to `127.0.0.1` | The optional local prover (§ 5.8) |
| A script on web pages | Wallet discovery only (§ 5.7) |

Nulo requests no permission to read your browsing history, your tabs, your bookmarks, your identity,
your location, your clipboard or your files.

## 7. Cookies

The extension sets no cookies. The website sets no cookies of its own; Cloudflare may set a strictly
necessary security cookie at the edge.

## 8. Diagnostic logs

Nulo keeps a rolling in-memory log to help diagnose problems, capped in size and discarded when the
browser closes.

- It is **not** sent anywhere — there is no remote logging endpoint in the extension.
- Values that could be sensitive are stripped before anything is written, and endpoint URLs are
  reduced to their origin so credentials embedded in a path cannot be recorded.
- Logs are written to session storage **only** if you turn on Developer Mode, and turning it off
  purges the stored copy. Session storage is cleared when the browser restarts.
- You can export the log as a CSV file. **If you attach that export to a public bug report, you are
  publishing it** — read it first.

## 9. Backups you export

An exported recovery phrase or backup file contains key material. A backup file is encrypted with
the password you choose at export, and its security is only as good as that password and where you
store it. Once exported, the file is entirely in your hands; I have no copy and no way to revoke it.

## 10. Your rights

Under the GDPR, UK GDPR, the CCPA/CPRA and comparable laws you have rights of access, correction,
erasure, restriction, objection and portability, and the right not to have personal information sold
or shared — which I do not do.

In practice, **I hold no personal data about you to give you, correct or delete.** For the data on
your device, you exercise those rights directly: view it in the interface, export it, or delete it by
clearing the extension's data or uninstalling. For the limited edge processing in §§ 5.4–5.5, write
to me and I will do what I can — noting that I cannot identify you from a request log and so
generally cannot connect a request to a person.

You may also complain to your local data protection authority.

## 11. Children

Nulo is not intended for anyone under 18, and I do not knowingly collect anything from children. See
the [Terms of Use](terms.md) § 3.

## 12. International transfers

The few third parties named above (a node provider, a price API, an explorer, Cloudflare, the
extension stores) operate globally, so a request you make may be served anywhere. Because no data of
mine about you exists, there is no transfer of personal data by me to safeguard.

## 13. Security

Secrets are encrypted at rest with modern authenticated encryption, derived from your password or
passkey. The extension loads no remote code. The passkey helper domain is deliberately kept free of
application code so that nothing served from it can ever take part in deriving your keys.

No software is perfectly secure. Nulo has not been audited by an independent security firm, and it
cannot protect you from a compromised device. See the [Terms of Use](terms.md) §§ 4.7 and 5.

To report a vulnerability, follow [`SECURITY.md`](../SECURITY.md) rather than a public form.

## 14. Changes to this policy

Each version carries a version number and an effective date, and the current version is published at
`nulo.sh/privacy`. If a change materially affects what leaves your device or what I receive, Nulo
will tell you in the interface and ask you to acknowledge it. Otherwise, changes take effect when
published.

## 15. Contact

**«FILL: legal name»** — «FILL: contact email»

---

## Appendix: extension store data disclosure

For the data-handling declarations required by the Chrome Web Store and Firefox Add-ons:

| Category | Collected? |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No — balances and transactions stay on the device and are never transmitted to the developer |
| Authentication information | No — keys and passwords never leave the device |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

Nulo's single purpose is to act as a self-custody wallet for the Aztec network. It does not sell or
transfer user data to third parties, does not use or transfer user data for any purpose unrelated to
that single purpose, and does not use or transfer user data to determine creditworthiness or for
lending purposes.

## Version history

| Version | Effective | Change |
|---|---|---|
| 1.0 | «FILL: effective date» | First published version. |
