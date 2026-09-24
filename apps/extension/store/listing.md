# Store listing — one source for both stores

What each dashboard field is filled with. `scripts/store-listing.test.ts` holds this file to the
built manifests (every permission has a justification heading), to `legal/privacy.md` § 6 (the policy
and the listing name the same permissions), to the stores' length caps, and to the Firefox build's
data-collection declaration. Edit here, then copy into the dashboards; never the other way round.

## Shared

### Single purpose

Nulo's single purpose is to act as a self-custody wallet for the Aztec network: it holds the user's
keys on the device, shows balances and activity, sends transactions, and lets web applications the
user approves interact with those accounts. (The full statement: `legal/privacy.md` § Appendix.)

### Long description

Nulo is a self-custody wallet for the Aztec network.

Your keys stay on your device. A password profile is protected by a password-derived key; a passkey
profile is protected by your authenticator and has no recovery phrase. Nulo has no server, no
account system and no telemetry. The extension talks to the Aztec node you configure, to the price
service you can turn off, to the public hosts that serve proving parameters, to a local proving
application if you install one, and to the applications you approve — and to nothing else.

Aztec transactions can be private. Nulo proves them in your browser, or through an optional local
proving application on your own machine when one is installed. Nothing about a private transaction
is sent to anyone except the node that includes it, in the form the protocol defines.

Connected applications see what you approve: an account address, and the details of each action you
confirm. Settings → Connected Apps shows every grant and lets you revoke it.

Open source, Apache-2.0: https://github.com/alejoamiras/nulo

### Data inventory

One row per kind of data the extension handles. "Leaves the device" names every destination; a
destination the user chooses (the node) or installs (the local prover) is still a destination.

| Data | Where it lives | Leaves the device | Destination |
|---|---|---|---|
| Recovery entropy, master secret, signing keys | Extension local storage, encrypted | Only when the user exports a backup file | The file the user saves (`downloads`) |
| Passkey credential id and sealed key material | Extension local storage | No | — |
| Passkey label (profile name + short handle) | Handed to WebAuthn at creation, `wallet/utils/passkey-ceremony.ts:45-55` | Yes | The browser and the user's authenticator; the authenticator's provider may sync it (`legal/privacy.md` § 5.4) |
| Account addresses | Extension local storage | Yes | The configured Aztec node (queries name the address); approved applications |
| Balances, transactions, proofs | Extension local storage; private state in the browser's OPFS, encrypted | Yes | The configured Aztec node; approved applications for what the user confirms |
| Proving inputs (witnesses) | Process memory | Only with the optional local prover installed | `127.0.0.1` (`legal/privacy.md` § 5.8) |
| Public proving parameters | Browser cache | Downloaded, never uploaded | `crs.aztec-cdn.foundation`, fallback `crs.aztec-labs.com` (§ 5.9) |
| Token prices | Extension local storage (cache) | A request naming the tokens, no address | CoinGecko, unless fiat display is off (§ 5.2) |
| Contacts (name, address), profile names | Extension local storage, `wallet/services/contact/spec.ts:9-17` | No | — |
| Connected-app origins, names, icons, URLs, grants | Extension local storage, `wallet/services/dapp-session/spec.ts:35-50` | No | — |
| Diagnostic logs | Memory; session storage with Developer Mode on | Only when the user exports them | The file the user saves |
| Terms-acceptance record | Extension local storage | No | — |

### Permissions

One heading per manifest entry (`manifest/manifest.config.ts`; Firefox drops `offscreen` and
`sidePanel`). The sentence under each is the dashboard justification.

#### `storage`

Keeps profiles, accounts, contacts, settings, granted app permissions and encrypted key material on
the device. The wallet has no server; this is its only persistent store.

#### `unlimitedStorage`

Private execution state (notes, proving state, synced chain data) lives in the browser's origin
private file system and grows with use; the default quota would evict it.

#### `alarms`

Schedules the background balance refresh and the session auto-lock timer while the wallet is
unlocked (`wallet/index.ts:96`, `wallet/services/profile/session-manager.ts:75`).

#### `offscreen`

Chrome only. Runs the private execution environment (the Aztec PXE, WASM-heavy) in a hidden
extension document, because a service worker cannot host it (`wallet/utils/offscreen.ts:196-215`).
Firefox hosts the same page as a frame of the background page and does not declare it.

#### `sidePanel`

Chrome only. Lets the user open the wallet in the browser's side panel instead of the popup
(`popup/app.vue:73`). Every call is feature-gated; Firefox does not declare it.

#### `downloads`

Saves backups, account exports, contacts and diagnostic logs when the user asks for an export
(`utils/files.ts:63`). Nothing is downloaded without a click.

#### Host `https://passkey.nulo.sh/`

The WebAuthn relying-party domain for passkey profiles: an extension page must be allowed to call
WebAuthn under that RP id (`legal/privacy.md` § 5.4). The host serves no content and the content
script is excluded from it.

#### Host `https://127.0.0.1/*`

The optional local proving application answers on loopback over HTTPS; proving inputs go there and
nowhere else (`legal/privacy.md` § 5.8).

#### Host `http://127.0.0.1/*`

The same application's witness-free health check, plain HTTP. Holding both schemes keeps extension
pages out of Chrome's local-network-access prompt.

#### A script on web pages (content script, `*://*/*`)

Relays wallet-discovery and connection messages between a page and the extension so an application
can find and connect to the wallet (`legal/privacy.md` § 5.7). It reads no page content and injects
no page script; it is excluded from the passkey host.

### Data handling

See the Data inventory above and `legal/privacy.md` § Appendix. Sold: no. Used for purposes
unrelated to the wallet: no. Used for creditworthiness or lending: no.

## Chrome Web Store

| Field | Value |
|---|---|
| Title | Nulo V5 |
| Summary | User-friendly self-custody wallet for Aztec network, preserving your privacy and revealing the power of account abstraction. |
| Category | Tools |
| Language | English |
| Privacy policy URL | https://nulo.sh/privacy |
| Support URL | Empty: the field takes URLs only and rejects `mailto:`. The publisher's verified contact email, `hello@nulo.sh`, is shown instead |
| Homepage | https://nulo.sh |
| Visibility (first upload) | Unlisted |

The Title and Summary are the built manifest's `name` and `description` (`package.json`
`displayName` and `description`); the store shows the manifest values, so the dashboard fields must
match them.

### Privacy tab

- **Single purpose:** the statement above.
- **Permission justifications:** the sentences above, one per permission.
- **Remote code:** *No, I am not using remote code.* Justification: "The package bundles all of its
  code. Applications send contract artifacts as data; a bundled WASM virtual machine interprets them
  under a `script-src 'self' 'wasm-unsafe-eval'` policy, with no `eval`, no script injection and no
  fetched code. Details: `store/remote-code.md` in the repository."
- **Data usage** (ticked; Google requires disclosure even for data processed or stored locally):
  - *Financial and payment information* — balances, transactions.
  - *Authentication information* — passwords and keys (local, encrypted); the passkey label handed
    to the authenticator.
  - *Personally identifiable information* — contact names and addresses, profile names (local); the
    passkey label above.
  - *Web history* — the origins and URLs of connected applications (local only).
- **Certifications:** all three — not sold to third parties; not used or transferred for purposes
  unrelated to the item's single purpose; not used or transferred to determine creditworthiness or
  for lending purposes.

## Firefox Add-ons

| Field | Value |
|---|---|
| Name | Nulo V5 |
| Summary | Self-custody wallet for the Aztec network. Keys stay on your device; private transactions are proven in your browser. |
| Categories | Privacy & Security (AMO's "Other" is "My add-on doesn't fit into any of the categories", exclusive of the rest) |
| License | Apache-2.0 |
| Support email | hello@nulo.sh |
| Support website | Empty |
| Homepage | https://nulo.sh — not on the submission form; set afterwards under Edit Product Page → Additional Details |
| Privacy policy | The text of `legal/privacy.md` at its current version, as published at https://nulo.sh/privacy |
| Channel | Listed |

### Data collection declaration

`browser_specific_settings.gecko.data_collection_permissions.required` in the Firefox build:

```
financialAndPaymentInfo
```

The value here must equal the manifest's; the test enforces it. Firefox's taxonomy is about what is
**transmitted**, so the other categories were assessed against outbound flows and left out:
`authenticationInfo` (passwords and keys never leave the device), `browsingActivity` /
`websiteActivity` / `websiteContent` (connected-app origins are stored locally and sent nowhere),
`personallyIdentifyingInfo` (contacts and profile names stay local). One reading is contestable
and is stated in `legal/privacy.md` § 5.4: for passkey profiles a label derived from the profile
name and an identifier are handed to the browser's WebAuthn API and on to the user's authenticator
(`wallet/utils/passkey-label.ts:51-53`); the declaration treats that as the browser acting at the
user's request, not the add-on sending data to a party of its choosing. Chrome's form covers local
handling as well and so ticks more boxes; the two differ by design.

### Reviewer notes

The block between the two markers is sent as `approval_notes` with every version.

<!-- reviewer-notes:start -->
Testing without funds: install, choose "Create profile", set a password. The wallet opens on
mainnet with a zero balance; Settings → Networks switches to Testnet. Every screen is reachable
without a transaction. A funded flow needs Aztec test tokens from a faucet on Testnet.

Build: the add-on is bundled (Vite). Source is attached to this version as a `git archive` of the
tagged commit. `apps/extension/store/SOURCE-BUILD.md` inside it names the exact Bun version and the
one script to run; the output must match `dist/firefox` byte for byte.

Modifications to third-party code, stated exactly:
- `@aztec/noir-noirc_abi` and `@aztec/noir-acvm_js` (two versions each, `patches/`): the
  `package.json` `module` entry is replaced with an `exports` map so bundlers pick the web build.
  Only package resolution metadata changes; no JavaScript or WASM is altered.
- `detect-node` is aliased to a module that exports `false` (`apps/extension/vite.config.ts:54-58`)
  so `@aztec/foundation`'s logger uses its browser transport.
- `function-bind` is aliased to a stub that delegates to the native `Function.prototype.bind`
  (`vite.config.ts:61-76`); the upstream package builds a function from a string, which the
  extension's CSP forbids.
- `@aztec/bb.js`'s browser `fetch_code` module is replaced by a shim that `fetch()`es the bundled
  WASM asset (`vite.config.ts:96-111`); upstream uses a dynamic `import()` that MV3 service
  workers forbid.
- The bundled contract artifacts (`apps/extension/vite.shared.ts:43-46`) have their `debug_symbols` blanked
  (`vite.config.ts:92`, `scripts/strip-artifact-debug-info.ts`); this removes source snippets from
  error traces and changes no bytecode.

Linter warnings and their origin: `innerHTML` is assigned by Vue's
runtime (`insertStaticContent`) and by the `@alejoamiras/presto` banner element, which renders its
own template (its link is normalized to an http(s) URL; variant and state come from fixed lists).
`Function` and `eval` appear in zod's eval-capability probe and msgpackr's record decoder, both inside
try/catch with a non-evaluating fallback, and in get-intrinsic's intrinsics table, which references
`eval` without calling it; the extension CSP (`script-src 'self' 'wasm-unsafe-eval'`) forbids
evaluating strings, so none of them evaluates one. `UNSUPPORTED_API` is `chrome.offscreen` and
`chrome.sidePanel`, both feature-gated and never called on Firefox.

Remote code: the package loads no code from the network. Applications send contract artifacts
(ACIR and Brillig bytecode with an ABI) as data over the wallet-sdk channel; a bundled WASM virtual
machine interprets them and can reach nothing outside the wallet's own oracle callbacks. The full
account is `apps/extension/store/remote-code.md` in the attached source.
<!-- reviewer-notes:end -->
