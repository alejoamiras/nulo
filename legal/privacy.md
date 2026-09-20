# Privacy Policy

**Version 1.0 — effective «FILL: effective date»**

This policy explains what happens to information when you use Nulo. The published source shows the
extension's implemented data handling. Hosting, correspondence, authenticator and store processing
also depend on the configurations and provider practices identified below.

> **The short version.** Nulo has no accounts, no wallet telemetry, no analytics, no tracking, no
> advertising and no third-party scripts. The extension sends no wallet telemetry to the Developer;
> the Developer may receive information you voluntarily submit and the provider-account information
> described in § 5. Wallet
> secrets are protected locally as described below; some wallet metadata is stored without
> application-level encryption, and wallet operation sends the information described in § 5. A few
> things must leave your device for the wallet to work at all — requests to an Aztec node, downloads
> of public proving parameters, and an optional price lookup — and this policy says what each one is,
> what it reveals, and which can be turned off or replaced.
>
> *This box is a summary. The sections below are the policy.*

---

## 1. Who is responsible

Nulo is maintained by **Alejo Amiras**, a natural person resident in Argentina ("**the Developer**",
"**I**"). There is no company.

Where applicable data-protection law applies, I am responsible as controller for processing carried
out for the Nulo website, the passkey relying-party host, and correspondence described below.
Independent providers are responsible for processing they determine themselves; providers acting on
my instructions are processors.

In Argentina that processing is governed by **Law No. 25,326** (*Protección de los Datos
Personales*), and the supervisory authority is the **Agencia de Acceso a la Información Pública
(AAIP)**. Where the GDPR or UK GDPR applies to particular processing, the bases stated below apply to
it.

Contact: **hello@nulo.sh**

## 2. No wallet telemetry; limited website and correspondence processing

I do not operate a backend for the wallet. Nulo requires no Developer-hosted account or sign-up. It
creates local identifiers for wallet operation, including profile identifiers, but does not use them
for wallet telemetry.

Specifically, the extension contains **no** analytics SDK, **no** crash or error reporting service,
**no** telemetry, **no** advertising or marketing tags, **no** cookies set by me, **no**
fingerprinting, and **no** third-party scripts. Its content security policy forbids loading remote
code.

I do not sell personal information or share it for cross-context behavioural advertising. I and the
providers identified below process the limited website, correspondence and service data described in
this policy.

## 3. What Nulo stores on your device

Nulo stores wallet state in browser-managed storage. Local storage and network disclosure are
separate concerns: some locally stored information is also included in the requests or responses
described in § 5.

| What | Where | Protection |
|---|---|---|
| Password-profile recovery entropy and master secret | Extension local storage | AES-GCM encryption under password-derived protection |
| Passkey profile | Credential identifier and sealed supporting key material in extension local storage | Master secret re-derived from the credential's PRF output; **no recovery phrase exists** |
| Separately imported signing keys | Extension local storage | Encrypted using profile-specific key material |
| Account addresses, profile names, settings, contacts | Extension local storage | Stored without application-level encryption |
| Tracked tokens, cached balances, cached prices | Extension local storage | Stored without application-level encryption |
| Transaction history, activity records, networks, granted app permissions | Extension local storage | Stored without application-level encryption |
| Private execution database (notes, proving state) | Browser Origin Private File System, using SQLite | Encrypted with a profile-specific database key |
| Public proving-parameter cache | Browser cache / IndexedDB | Public parameters; not wallet-secret storage |
| Terms acceptance record (version accepted, time, which screen) and the Privacy Policy version shown | Extension local storage; never transmitted, not included in backups | Stored without application-level encryption |
| Session state | Extension session storage and process memory | Strict mode requires fresh authentication after worker loss; disabling it permits a locally stored credential capable of restoring the password-profile session |
| Diagnostic logs | In memory; written to session storage only if you turn on Developer Mode | See § 8 |

**Deleting it.** Uninstalling or clearing the extension's storage removes its local browser-managed
data through the browser's deletion mechanisms. It does not delete exports, device backups,
authenticator credentials, blockchain records or copies held by others, and it is not a guarantee of
forensic erasure.

## 4. Your secrets

Normal wallet operation does not send your recovery phrase, master secret or password to the
Developer, to RPC providers or to connected applications. Secrets are processed within the extension
and your chosen authenticator as needed. User-requested exports and clipboard operations,
authenticator synchronisation, and local-prover processing are described separately in §§ 5.8 and 9.
Diagnostic redaction has the limitations described in § 8.

**Do not send wallet secrets to support contacts, websites or forms.** Enter them only into the
verified extension's own unlock, import or export flow. I will never ask you for them by email, chat
or form.

## 5. What leaves your device, and to whom

The extension's network functions and the destinations it can open on your request are described
below.

### 5.1 The Aztec node you are connected to

**What it is:** to read chain data and submit transactions, Nulo sends requests to the configured
Aztec node. Remote endpoints use HTTPS; loopback endpoints may use HTTP. Nulo ships with default
endpoints operated by a third-party provider so the wallet works on first run.

**What the node receives:** protocol-defined transaction data, including proofs, public effects and
encrypted data, plus ordinary request metadata — your IP address, user agent, timing, and the shape
of your requests, which for some requests reveals the contracts and public addresses you are reading.

**What Nulo does not send:** your recovery phrase, password or master secret are never included in
an RPC request. Private-note plaintext is processed locally unless an application or operation
intentionally discloses it. Protocol privacy does not eliminate inference, and does not protect
information that a transaction makes public.

**Your control:** Settings → Networks lets you replace any endpoint with one you trust or run
yourself. **Pending transactions may continue to be checked through the endpoint used to submit
them, including after you change or remove that endpoint.** Changing an endpoint does not withdraw
information already disclosed.

**What the Developer can see:** the default endpoint uses a provider account belonging to the
Developer. Information available to the Developer through that account is «FILL: verified dashboard/reporting categories, or confirmed absence of such access».

### 5.2 Price data (CoinGecko)

**What it is:** with fiat values enabled, Nulo requests prices for the token-ID list bundled with
that extension version.

**What it reveals:** the list is not selected from your holdings, and requests do not include your
balances, account addresses or transaction contents. CoinGecko still receives ordinary request
metadata and may infer application use from timing or other information.

**When:** refreshes are scheduled approximately every three minutes during unlocked use, and may
also occur on unlock, on re-enabling fiat values, or when refreshing stale interface data.
Transaction execution reads cached prices and never triggers a fetch.

**Your control:** turning off fiat values in Settings disables the feed and clears the cached prices.

### 5.3 Block explorer links

**What it is:** transaction rows can link out to a public block explorer.

**What it reveals:** nothing until you click. When you click, the explorer sees your IP address and
the transaction hash you opened, like any website you visit.

**Your control:** the explorer can be disabled in Settings → Advanced, which removes the links.

### 5.4 `passkey.nulo.sh` — the passkey relying-party domain

If you protect a profile with a passkey, the WebAuthn ceremony is bound to the domain
`passkey.nulo.sh`, which I operate. The application response served by my Worker is a static page
without scripts and with restrictive response policies; it exists as a cryptographic anchor and
contains no application code. **Cloudflare may independently serve infrastructure or security
responses on that hostname, including challenge pages containing its own scripts.**

**The extension does not fetch that page.** Nulo's passkey ceremony code invokes the browser's
WebAuthn API with `passkey.nulo.sh` as the relying-party identifier; it does not make an HTTP request
to that domain or send the passkey secret or PRF output to its web server. Browser and authenticator
services may perform their own communications under their providers' policies.

Your browser and selected authenticator process the credential identifier, a Nulo-generated profile
identifier used as the WebAuthn user handle, and a credential label containing that identifier and a
normalised form of your profile name. Depending on your provider, passkey credentials and related
metadata may be synchronised under that provider's own policies.

If you or a browser visit the domain directly, the hosting provider processes that request like any
website request. I do not run analytics on that host.

**Legal basis (GDPR):** legitimate interests — keeping the domain available and secure — under
Article 6(1)(f).

### 5.5 `nulo.sh`, contacting me, and the uninstall page

The website is static and carries no analytics or tracking of mine.

Hosting for `nulo.sh` and `passkey.nulo.sh` is provided by «FILL: applicable Cloudflare contracting
entity and privacy-policy link». Website requests expose IP addresses, requested URLs and ordinary
browser headers to the hosting provider. Information available to the Developer through hosting tools
is «FILL: verified categories and access». This processing supports delivery and security of the
sites, relying on legitimate interests where applicable. The retention information below and the
international-processing information in § 12 cover these hosting records.

**There are no web forms.** The Feedback, Report Issue and Report Scam items in the wallet open your
own email client addressed to `hello@nulo.sh`; nothing is submitted to a form service, and no
third-party form provider receives anything.

If you email me, I receive what you send — your message, your email address, and any attachments —
through the email provider «FILL: provider legal name and privacy-policy link». I use correspondence
to respond, investigate reported problems and maintain security, relying on legitimate interests
where that basis is available and appropriate. Writing to me is entirely optional. **Do not attach
wallet secrets, recovery phrases or unencrypted backups.**

**Retention.** Website and security records are retained for «FILL: actual period or specific
retention criteria». Correspondence and attachments are retained for «FILL: actual period or criteria
tied to resolving the report and any necessary legal retention». Provider retention is «FILL:
applicable periods or linked schedules». I may retain relevant records longer where necessary to
comply with law or to establish, exercise or defend legal claims.

**Uninstall page.** If you remove the extension, your browser opens the site root, `nulo.sh`. There is
no uninstall survey. The URL the extension configures contains no wallet address and no
per-installation identifier. Opening it still exposes ordinary website request metadata, including IP
address, browser headers and any cookies applicable to that site.

### 5.6 The extension stores

Google and Mozilla distribute Nulo and see installs, updates and whatever their platforms record,
under their own privacy policies. Store dashboards provide aggregate distribution statistics. I may
also see information you submit through reviews or support channels, including the account
information those platforms display.

### 5.7 Applications you connect to

When you connect Nulo to an application, that application learns what you approve: typically your
account address, and the details of what you ask it to do. Settings → Connected Apps shows what you
have granted and lets you revoke it. Disconnecting removes an application's wallet connection
permissions; it does not necessarily invalidate authorisations already issued or recorded on-chain.

A bundled content script relays wallet-discovery and connection messages between participating web
pages and the extension. **It does not scrape page text and does not run browsing analytics.** The
wallet processes the requesting origin, connection messages and approved application metadata in
order to establish and secure connections. The implementation is Nulo's own wrapper plus its bundled
wallet-SDK dependency.

### 5.8 Optional local proving application

When the optional native prover is available, the extension sends proving inputs — which can include
sensitive private transaction data — to a process on `127.0.0.1`. Production proving requests use
HTTPS; a limited HTTP health check may also occur, carrying no proving inputs.

The extension's connection is local. **The native application's own processing, storage and network
activity are governed by its implementation and its own privacy information**, available at «FILL: actual native-application legal links».

### 5.9 Public proving parameters

Browser-based proving may download public cryptographic reference data from
`crs.aztec-cdn.foundation`, with `crs.aztec-labs.com` as a fallback, when the required data is not
already cached. Those hosts receive ordinary request metadata, including your IP address, timing and
the files or byte ranges requested.

These requests **download** public parameters; they do not upload transaction witnesses. Replacing
the RPC endpoint or disabling fiat prices does not disable them.

## 6. Browser permissions, and what they do and do not cover

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | To keep your wallet data on your device; proving data is large |
| `alarms` | To schedule background refreshes while unlocked |
| `offscreen` (Chrome only) | To run the private execution environment in a hidden document; Firefox uses a fallback |
| `sidePanel` | The optional side-panel view |
| `downloads` | To save backups, account exports, contacts and diagnostic logs when **you** request an export |
| Access to `passkey.nulo.sh` | Required for the WebAuthn relying-party identifier (§ 5.4) |
| Access to `127.0.0.1` | The optional local prover (§ 5.8) |
| A script on web pages | Wallet discovery and connection messaging only (§ 5.7) |

Nulo does not request the dedicated history, bookmarks, identity, geolocation or clipboard-read
permissions. Broad page access supports wallet discovery and messaging. The extension can receive
connection-origin metadata, copy information to the clipboard at your request, and read files you
select for import.

## 7. Cookies

The extension sets no cookies. The website sets no cookies of its own; the hosting provider may set a
strictly necessary security cookie, subject to the deployed configuration.

## 8. Diagnostic logs

Nulo keeps a rolling in-memory log to help diagnose problems, capped in size.

- It is **not** sent anywhere — there is no remote logging endpoint in the extension.
- The logger redacts recognised sensitive fields and scrubs recognised endpoint URLs to their
  origin. **Redaction is incomplete:** logs may contain addresses, transaction identifiers,
  application details, or sensitive text carried in errors and dependency messages.
- Logs are written to session storage **only** if you turn on Developer Mode, and turning it off
  purges the stored copy. Session storage is cleared on a full browser shutdown and restart.
- You can export the log as a CSV file. **Review and redact an export before sharing it** — attaching
  it to a public bug report publishes it.

## 9. Backups and exports you create

Nulo supports both unencrypted and password-encrypted exports.

- For **password-profile** full backups, optional file encryption uses the profile password entered
  during export.
- For **passkey-profile** full backups, you choose a file-encryption password.
- **Unencrypted** password-profile and account exports may contain material sufficient to spend
  funds.
- A passkey-profile backup still requires the original passkey credential for restoration, even when
  the file is encrypted.

Protect every export, and verify which format you saved. Nulo does not automatically send the
Developer copies of your exports, and the Developer cannot revoke an exported copy.

## 10. Your rights

Depending on the law applicable to you and the processing concerned, you may have rights to access,
correct, delete, restrict or obtain a copy of personal data, to object to processing, or to withdraw
consent where processing relies on consent.

Contact hello@nulo.sh to exercise applicable rights. I will respond within the applicable
legal period and explain any lawful limitation. I may request proportionate information needed to
locate records or verify a request, but will never ask for wallet secrets.

I cannot remotely access or delete information held only in your extension. Local deletion does not
remove blockchain records, exported files, or records held independently by other providers. You may
complain to the competent data-protection authority — in Argentina, the **Agencia de Acceso a la
Información Pública (AAIP)**; elsewhere, where applicable, the authority where you live or work.

«FILL: if an EU or UK Article 27 representative is required, name the representative and contact details here; otherwise delete this line rather than leaving it blank.»

## 11. Children

Nulo is not intended for anyone under 18, and I do not knowingly collect anything from children. See
the [Terms of Use](terms.md) § 3.

## 12. International processing

Providers used for website hosting and correspondence may process personal data outside your
country. For transfers for which I am responsible, the destinations and applicable safeguards are
«FILL: provider/destination mapping and the actual adequacy decision or contractual safeguard, including the UK mechanism where relevant». Contact me for information about those safeguards.

Independent providers — including the node provider, the price API and the block explorer you reach
directly from your own browser — describe their own international processing in their privacy
notices.

## 13. Security

Wallet secrets are encrypted at rest with modern authenticated encryption, derived from your
password or passkey. The private execution database is encrypted with a profile-specific key. The
extension loads no remote code.

The Developer's passkey-host application response contains no scripts; hosting-provider responses and
their limitations are described in § 5.4. Keeping that domain and its eligible subdomains secure is
part of the passkey security model.

No software is perfectly secure. Nulo has not been audited by an independent security firm, and it
cannot protect you from a compromised device. See the [Terms of Use](terms.md) §§ 4.7 and 5.

To report a vulnerability, use «FILL: published security-reporting URL» rather than a public form.

## 14. Changes to this policy

Each version carries a version number and an effective date, and the current version is published at
`nulo.sh/privacy`. Before materially changing the personal-data processing described here, I will
provide the notice required by applicable law and obtain any required consent before the new
processing begins. Other changes take effect when published.

## 15. Contact

**Alejo Amiras** — hello@nulo.sh

---

## Appendix: extension store data disclosure

For the data-handling declarations required by the Chrome Web Store and Firefox Add-ons. **This table
summarises handling; it is not a substitute for completing each store's own categories from the
actual build.**

| Data | Handling |
|---|---|
| Wallet credentials and signing material | Processed locally; export and optional local-prover handling are described above |
| Account addresses, balances and transactions | Processed locally; the relevant requests and transaction data are transmitted to configured nodes and to approved applications |
| Application connection metadata | Used for discovery, connection security and permission management |
| Proving inputs | Processed in-browser, or sent to the optional local proving application on `127.0.0.1` |
| Public proving parameters | Downloaded from the hosts named in § 5.9 |
| Website requests and voluntary reports | Processed by the identified hosting and correspondence providers and, where described, by the Developer |
| Analytics and advertising data | No wallet analytics or advertising collection is implemented |

Nulo's single purpose is to act as a self-custody wallet for the Aztec network. It handles data to
provide its wallet features and the supporting functions described in this policy. It does not sell
user data, use it for advertising or creditworthiness decisions, or transfer it for purposes
unrelated to those disclosed functions. Disclosures to providers and connected applications are
described in § 5.

## Version history

| Version | Effective | Change |
|---|---|---|
| 1.0 | «FILL: effective date» | First published version. |
