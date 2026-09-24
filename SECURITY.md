# Security

This document captures security-relevant design decisions for the Nulo wallet
extension. It is written for engineers working on the codebase; if you are a
security researcher, see the reporting section at the bottom.

## Crypto-bound invariants (never change without a migration)

These values are cryptographically bound. Changing any of them invalidates
existing keys and profiles.

- **KDF domain separator labels**
  - `nulo:profile:v1` — WebAuthn PRF input label
    (`src/wallet/services/passkey/spec.ts:PASSKEY_PRF_LABEL`)
  - `nulo:kdf:v1` — HKDF salt label
    (`src/wallet/services/passkey/credential.ts:PASSKEY_KDF_LABEL`)
  - `nulo:master:v1` — HKDF info label
    (`src/wallet/services/passkey/credential.ts:PASSKEY_MASTER_LABEL`)
- **`AccountType.Nulo_v1 = 0`** — embedded in the Poseidon hash used to derive
  account secrets from the master secret. The numeric value is part of the
  hash input; renaming the enum is fine, but reassigning the numeric value
  is not (`src/wallet/services/account/spec.ts`).
- **AES-GCM ciphertext format** — `[1 version byte][12 byte IV][ciphertext]`
  stored base64 in `profile.secret` and `profile.guard`
  (`src/wallet/services/profile/encryption/encryption-key.ts`).
- **Passkey RP ID** — `passkey.nulo.sh`, used at credential creation AND at
  WebAuthn `get` (both literals must match — they're the same crypto
  binding). Changing it invalidates every existing passkey credential.
  The host is deliberately content-less: WebAuthn lets every origin whose
  registrable domain suffix-matches the RP ID assert with the credential
  and evaluate its PRF, which is how the wallet master is derived — so the
  RP host serves one static page with a strict CSP and no scripts, never
  application code (`infra/passkey-rp/`: a Cloudflare Worker on a single
  custom domain, no `workers.dev` origin), every `*.passkey.nulo.sh`
  descendant stays unregistered in DNS, and the extension's own content
  script is excluded from them (`manifest.config.ts`
  `content_scripts[].exclude_matches`). The apex `nulo.sh` and the
  application subdomains are therefore not eligible. What remains on the
  hostname is Cloudflare's own (`/cdn-cgi/*`, a challenge page if a rule
  ever challenges it) — the edge that already terminates the host's TLS,
  so no new trust root, and the page's CSP refuses any script a zone
  feature would inject; the README lists the dashboard settings to keep
  off.
  - **M4.9 build-time gate** (`scripts/check-rp-id.ts`): single source
    of truth is `RP_ID` exported from
    `src/wallet/services/passkey/spec.ts`. The gate fails the build if
    (a) `manifest.config.ts:host_permissions` doesn't contain
    `https://${RP_ID}/`, or (b) any passkey-touching source file
    (`src/popup/windows/passkey/index.vue`, etc.) contains a string
    literal of the RP ID value instead of importing the constant.
  - Forks repurposing this extension under a different domain MUST
    change BOTH the constant and the manifest entry atomically. There
    is no migration path for WebAuthn credentials.
- **The Schnorr account artifact** — vendored byte-exact at
  `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json` and pinned by digest +
  class id, precisely so that bumping `@aztec/accounts` (which rebuilds its own copy on any
  toolchain change) cannot move a derived address. Editing those bytes rotates the address
  regime and ships only as a new extension major.

Any PR that touches these must include:
1. Explicit mention of the invariant being changed.
2. A migration plan for existing users.
3. Cross-version regression test vectors.

## Session secret (password profiles)

**Default: strict security mode (M4.2, shipped 0.13.9).**

When a user unlocks a password profile under strict mode (the default):

1. The password is hashed with SHA-256 to produce `passhash`.
2. `passhash` is used transiently to derive the PBKDF2 base key (600k iterations,
   SHA-256) that decrypts the encrypted master secret.
3. The decrypted master secret is held in service-worker memory as an `Fr`.
4. **`passhash` is NOT persisted.** The persisted session record in
   `chrome.storage.session` contains only `{profile, since, lockedAt}` — opaque
   metadata that cannot decrypt anything.
5. After SW death (browser restart, force-stop, true long idle), the in-memory
   `Fr` is gone and the persisted record cannot reconstitute it. The next popup
   interaction shows the lock screen and the user re-authenticates (paying
   ~1s PBKDF2 again).

This converges with passkey profile behavior (which has always required
fresh auth on SW death — see below). M4.8 (passkey symmetry): in strict mode
both profile types behave the same way on SW death.

**Opt-out: lenient mode** — Settings → Security → "Strict security mode" →
toggle OFF (with a confirm dialog). Reverts to the legacy bearer behavior:

1. The password is hashed once with SHA-256 to produce `passhash`.
2. `passhash` is persisted to `chrome.storage.session` (session storage — not
   `local` — cleared when Chrome fully terminates).
3. On SW restart, `restore()` reads `passhash` and silently re-derives the
   PBKDF2 base key + AES-GCM-decrypts the master secret. The user sees no
   prompt.

The consequence under lenient mode is that **`session.passhash` is sufficient
to decrypt the master secret**, not merely to verify it. It is a bearer
credential for the profile during the active browser session. The user sees
this trade-off in the disable-confirm dialog.

### Threat model

| Attacker capability | Impact (strict ON, default) | Impact (strict OFF, opt-out) |
|---|---|---|
| Can read `chrome.storage.session` during an active session | None — only opaque session record | **Full compromise of the master secret via `passhash`** |
| Can observe disk during a browser-locked / Chrome-exited state | No impact — session storage is not persisted across full browser termination | Same as strict ON |
| Can observe disk during a browser-running / wallet-locked state | Partial — can read encrypted `profile.secret`/`profile.guard`, must brute-force password (600k PBKDF2) | Same as strict ON |
| Can read SW process memory during an active session | Full compromise (master secret held as `Fr` in SW memory) | Same as strict ON |

### Strict-mode toggle semantics

- **Default**: ON for new wallets and after upgrade.
- **Toggle ON mid-session**: the in-flight in-memory secret keeps living (no
  force-lock) but any cached `passhash` is dropped from BOTH `chrome.storage.session`
  AND the in-memory `activeSession.session` object (so a subsequent `refresh()`
  cannot re-write it).
- **Toggle OFF mid-session**: no immediate effect. The bearer is restored on
  the NEXT unlock (after the user manually locks + unlocks). The disable-confirm
  dialog states this explicitly.
- **Stale bearer on upgrade**: an existing session record from a prior lenient
  unlock is treated as untrusted by `restore()` when strict mode is ON —
  silentClose + lock screen on first SW restart after upgrade. Pre-launch
  this affects only the developer's own dev wallet.

### Related hardening

- **M4.5** (shipped 0.13.7): proactive TTL via `chrome.alarms` (today the TTL
  was reactive — checked only on method calls).
- **M4.6** (shipped 0.13.7): best-effort zeroization of decrypted secret +
  passhash buffers across the unlock + import + change-password + export paths.

## Session secret (passkey profiles)

Passkey profiles **do not persist any session material**. When the service
worker restarts, the user must re-perform WebAuthn PRF to re-derive the
master secret. WebAuthn PRF requires a user gesture (passkey tap), which is
impossible to satisfy silently — this is a hard API constraint, not a policy
choice.

**M4.8 (passkey symmetry)**: under strict-mode-ON (default), password profiles
follow the same pattern. Under strict-mode-OFF the asymmetry returns and is
documented above.

## Content script injection

The extension injects a content script on `*://*/*` at `document_start`,
`all_frames: true` (`manifest/manifest.config.ts`). **Broad injection is
required by the protocol**, not an expedient default — verified during
M4.1:

- The `@aztec/wallet-sdk` discovery flow is **page-initiated**: a dApp
  calls `ExtensionProvider.discoverWallets(...)` which posts
  `WalletMessageType.DISCOVERY` via `window.postMessage(..., '*')`.
- Without a content script already listening on `window.addEventListener('message', ...)`,
  the discovery is silently dropped — the wallet never sees the dApp.
- There is no alternative protocol (no `chrome.runtime.connect()` from
  the page, no extension-API surface accessible from page context).
- Designs that narrow the scope (allowlist of known dApps, dynamic
  registration via `chrome.scripting`) all break unknown-dApp discovery
  and would require a bootstrap UX (extension-action click first, then
  the dApp can discover) — an ecosystem-breaking change.

The local content script (`src/content-script/content.ts`) is 22 lines:
a thin relay around `ContentScriptConnectionHandler` from the upstream
SDK. The upstream handler:

- Parses page messages with `JSON.parse` inside try/catch (no `eval`).
- Filters incoming events by `event.source !== window` (rejects
  cross-frame spoofing via the synchronous same-origin check).
- Never reads or writes page DOM state.

### M4.1 hardening (defense-in-depth)

Even though the protocol mandates broad injection, M4.1 added a
zod-validated boundary at the SW seam where content-script messages
arrive:

- `validateContentScriptMessage()` (`src/wallet/services/wallet-sdk/content-script-validator.ts`)
  filters envelopes claiming `origin: "content-script"` against an
  allowlist of upstream `InternalMessageType` values that content
  scripts are expected to send (DISCOVERY_REQUEST, KEY_EXCHANGE_REQUEST,
  SECURE_MESSAGE, DISCONNECT_REQUEST). Adversarial envelopes claiming
  background-to-content-script types (DISCOVERY_APPROVED, etc.) from
  the content-script origin are rejected before reaching the upstream
  handler.
- Non-content-script messages (ServiceClient responses, offscreen
  pings) pass through untouched — the upstream handler does its own
  origin filter.

### Threat-model row update

| Attacker capability | Impact |
|---|---|
| Compromised page can post arbitrary `window.postMessage` payloads | Limited — discovery requires user approval via popup; encrypted channel uses ECDH P-256 + AES-GCM with verification hash; content script filters cross-frame spoofing. Bugs in upstream `ContentScriptConnectionHandler` are still page-reachable. |
| Compromised content script (XSS in upstream relay) | High — would bypass the SW envelope check. M4.1 cannot mitigate; depends on upstream code review + minimization. |

## Authorization enforcement

Two layers:

1. **Capability type** (`src/wallet/services/wallet-sdk/capability-map.ts`)
   — maps each wallet-sdk method to the capability type it requires
   (`accounts`, `transaction`, `simulation`, `data`, `contracts`,
   `contractClasses`).
2. **Per-operation scope** (`src/wallet/services/wallet-sdk/scope-enforcement.ts`)
   — validates that the specific contract/function targeted by an operation
   falls within the scope granted.

`createAuthWit` validates both the `from` account and, when the request
carries a `CallIntent`, the target call itself against transaction or
simulation scope. When it carries an `IntentInnerHash`, the `consumer`
contract is validated at wildcard function. Raw message hashes cannot be
validated beyond the account check (no semantic info).

## RPC endpoint as user input

The wallet talks to Aztec nodes over HTTPS-JSON-RPC. The endpoint URL is a
user-controlled input — users add custom endpoints (Settings → Manage Networks
→ chain → Add endpoint), and any added endpoint can be promoted to the
chain's primary. M4.10's network-model rework (executed 2026-04-27, see
`implementations-plan/M4/DECISIONS.md`) split the conflated `Network` entity
into `Network` (chain-level) + nested `NetworkEndpoint[]`, which makes the
endpoint trust boundary explicit.

### Trust posture

- **Endpoints are not authoritative.** They cannot sign on behalf of the
  user, decrypt session material, or write to storage. The threat model
  reduces to: a malicious endpoint can serve crafted RPC responses to a
  PXE / wallet that already trusts the **chain**.
- **Chain-id verification is mandatory at adoption.** `addEndpoint` /
  `updateEndpoint` probe the candidate URL via
  `AztecNode.getNodeInfo()` and reject when `l1ChainId` (or the chain
  identifier carried in the response) doesn't match the parent
  `Network.chainId`. Errors surface as `EndpointChainMismatchError`
  inline in the popup.
- **Duplicate-URL guard per Network.** Adding the same `rpcUrl` twice to
  the same `Network` is rejected (`DuplicateEndpointError`).
- **Per-URL `AztecNode` cache** with 3-strike eviction: each unique URL
  gets its own client; transient failures don't poison neighbours;
  consecutive failures evict.

### Pending-tx polling pin

Once a transaction is submitted, the receipt poller is **pinned to the URL
the tx was sent on** (`Tx.submittedEndpointUrl`). Even if the user swaps the
chain's primary endpoint mid-flight, the poll keeps targeting the original
URL via `getNodeForUrl`. This avoids:

- a freshly-promoted endpoint reporting "tx not found" because it hasn't
  seen the bundle yet, and
- a malicious endpoint shadowing receipts for txs it never received.

Failover happens only after the original URL trips the 3-strike eviction.

### What endpoints can still do

A malicious-but-chain-id-honest endpoint can:

- Serve stale block data (delaying note-discovery sync).
- Refuse to relay user-submitted txs (denial of service; user retries on a
  different endpoint).
- Track which addresses the wallet asks about (privacy, not integrity).

Mitigations are user-driven: the per-Network detail page lists every
endpoint, lets the user promote/demote primary, and surfaces probe failures
inline. There is **no automated reputation system** — endpoint trust is
explicit and per-Network.

### What endpoints cannot do

- Spend or sign without account material the SW already holds.
- Inject arbitrary data into PXE state — every input is bound to a chain
  via the `chainId` check at adoption + reverification on `setPrimaryEndpoint`.
- Read decrypted master secrets or session records (none of these cross
  the wire).
- Trigger storage writes outside the network/endpoint surface.

## Storage privacy

Encrypted at rest:
- `profile.secret` — master secret (AES-GCM)
- `profile.guard` — password verification sentinel (AES-GCM)

Plaintext at rest (`chrome.storage.local`):
- Profile metadata, networks, accounts, contacts, dApp sessions, tokens,
  token balances, tx history, auth registry state, FPC definitions,
  config, storage version.

Expanding the encrypted boundary to cover profile-scoped metadata (contacts,
dApp sessions, tx history) is tracked as M4.11 — large refactor, not a
near-term patch.

### External price feed (CoinGecko)

While a profile session is unlocked (and `showFiatValues` is on — the default,
toggleable in Settings → Appearance), the wallet fetches USD quotes from
CoinGecko's keyless public API every ~3 minutes. Privacy posture:

- The request is ONE batched query for a FIXED id set compiled into the build
  (`price-map.ts`) — it never varies with the user's holdings, accounts, or
  activity, so nothing user-specific is inferable from the query string.
- No fetch is ever triggered by transaction activity (fee-USD reads are
  cache-or-nothing), so request timing does not correlate with transactions.
- What CoinGecko (and any on-path observer) does learn: an IP address running
  Nulo is active while the wallet is unlocked. Turning `showFiatValues` off
  stops all fetching and clears the cache.
- Terms: keyless access is used under CoinGecko's public-API tier with in-app
  attribution ("Token prices by CoinGecko", Settings → About). Revisit the
  plan tier before a public marketplace release (release-checklist item; an
  optional `VITE_COINGECKO_API_KEY` exists for CI/local rate-limit relief and
  MUST NOT be set in release builds — enforced fail-fast in
  `_build-extension.yml`).
- Quotes are display-only except the send screen's fiat-input mode, which is
  bounded by a frozen session quote, round-down bigint conversion, a >1%%
  drift re-confirmation, and the always-visible derived token amount.

## Published packages

The repository publishes three npm packages, `@alejoamiras/nulo-*`, staged from workspaces by `scripts/publish/stage.ts`. Every code-bearing version (`0.1.0` on) is published only by `.github/workflows/publish-packages.yml`, through npm trusted publishing, with a provenance attestation. The one exception is the code-free, deprecated `0.0.0-bootstrap.0` placeholders, published once from a workstation to attach the trusted publisher; npm never frees a version, so they stay listed. No npm token exists in the repository, in Actions or on a workstation after that bootstrap.

- **Where the bytes come from.** The `pack` job builds them from a frozen install that restores no shared Actions cache (any dev- or main-scoped job can write one) and runs no lifecycle script or test code; the tests run in a separate job. The first version is bound to the exact bytes a rehearsal proved against its consumer (`scripts/publish/approved-digests.json`), and no other version can be published before it.
- **Who can publish.** Only the `publish` job holds `id-token: write`, and it runs no repository code. Its gate is the `npm-publish` environment (owner as required reviewer, deployment branches `dev` and `main`), which is repository configuration the owner creates, not something the workflow file enforces: GitHub creates a missing environment with no protection. Each package's trusted-publisher record names that workflow and environment. `publishConfig.provenance` in the staged manifests is only a default, which a command-line flag overrides. The boundary is each package's "require 2FA and disallow tokens" setting: no token can publish, which leaves the trusted publisher and the owner's own interactive 2FA session, and a version published that way carries no provenance, which the `verify` job rejects whenever the workflow meets that version.
- **What is checked afterwards.** The `verify` job reads each version's SLSA provenance from the registry and requires it to name the packed bytes, this repository, this workflow and `dev` or `main`, then runs `npm audit signatures`.
- **Consumers.** The `@aztec/*` packages are exact peer dependencies, never bundled, so a consumer *can* share a single `Fr` and `WalletSchema`; installing one copy is theirs to check (`assertPackageIdentity` with `lockstepVia` from `@alejoamiras/nulo-resolve-asset`).

See [`scripts/publish/README.md`](./scripts/publish/README.md).

## Dependency policy

**Supply-chain age gate.** `bunfig.toml` sets `minimumReleaseAge = 604800`
(7 days). Newly published npm versions are filtered out at install time.
Defends against the npm-token-compromise attack pattern (axios 2026-03,
chalk/debug 2025-09) — those poisoned versions were detected and pulled
within hours.

Originally specified as 14 days, narrowed to 7 because Bun 1.3.x
erroneously applied the gate during `bun install --frozen-lockfile`,
blocking installs of currently-pinned lockfile entries inside the
window. **Retested on Bun 1.4.0 (2026-08-24): that bug is fixed** — a
14-day gate passes frozen installs cleanly against this lockfile
(evidence: `implementations-plan/bun-1.4-bump/lessons/phase-5.md`).
Widening back to 14d is now viable; it is a deliberate policy change to
make on its own PR, not a side effect of a toolchain bump.

**`bun audit`** runs as an advisory step in `_lint-and-typecheck.yml`. It
surfaces npm advisories in the GitHub Action step summary but does not
block PRs (today). Bun 1.4 exits 1 on findings (1.3.x always exited 0),
so exit-code gating is now mechanically possible — the step stays
advisory deliberately: the pre-existing backlog (41 advisories as of
2026-08-24 — every one of the 23 HIGH chains classified as dev/build/test
tooling or the exact-pinned `@aztec` line, none extension-bundle-reachable;
the 15 moderate + 3 low not individually classified) must be triaged to
zero first, or a blocking flip is pure noise.

**Bun pinned** to a specific patch version in `package.json#packageManager`
and in `setup-bun/action.yml` (the commitlint job reuses that composite —
no third pin site since the 1.4.0 bump). Cache keys include the Bun
version so a bump invalidates stale state. Local development requires
bun ≥1.4 (`bun run --parallel` scripts); a future lockfile regeneration
will move `bun.lock` to `lockfileVersion: 2`, unreadable by Bun ≤1.3.

**1.4 pm review workflow** (use these; they exist as of Bun 1.4):

- `bun pm diff <pkg>@<old> <new>` (both versions EXPLICIT) on every
  manual bump and Renovate PR review — un-minified diff, flags new
  install scripts and new `child_process`/`fs`/`net`/`vm` imports.
  On a checked-out Renovate branch the lockfile already holds the NEW
  version, so the unqualified `bun pm diff <pkg>` form (lock → latest)
  reviews the wrong or an empty delta — always name both versions.
- `bun audit fix --dry-run` for advisory triage — shows the in-range
  upgrade set without touching anything; `--latest` previews
  cross-major fixes.
- `bun pm licenses --prod --json` at release prep.
- `bun pm ls --trusted` whenever `trustedDependencies` changes — lists
  exactly which packages may run lifecycle scripts.
- `bun dedupe --check` runs ADVISORY in CI (`_lint-and-typecheck.yml`):
  collapsing resolves to the range intersection, which can DOWNGRADE
  transitives, so a human reviews each collapse (`bun dedupe` locally,
  then read the lockfile diff) instead of CI auto-failing on drift.

**Lockfile is text (`bun.lock`)** — reviewable in PR diffs, no binary
opacity. Migrated from `bun.lockb` once Bun 1.3.13's text-lockfile
behavior was validated against the install + typecheck gates.

## GitHub Actions

Every third-party action is pinned to a **full commit SHA**, with its release
in a trailing comment (`uses: actions/checkout@3d3c42e… # v7.0.1`). A tag is a
mutable pointer held by the action's maintainers, or by whoever takes over
their account: `@v4` re-resolves on every run, so a moved tag runs new code
with the job's token and secrets and leaves no diff to review. A SHA is
content-addressed, so an upgrade is a reviewed line in a PR.

- **Enforced** by `scripts/ci-cd/action-pins.test.ts` (in `test:ci-gating`):
  a tag or branch ref, a SHA without its `# vX.Y.Z` comment, or two
  different SHAs for one action all fail CI.
- **Resolve the SHA from the action's own repository**, never from a search
  result or a fork: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, and
  when `.object.type` is `tag` (annotated), follow it once more through
  `git/tags/<sha>` to the commit. GitHub serves fork commits under the
  parent's URL, so a SHA that was not read off a tag of the real repo
  proves nothing.
- **The 7-day age gate applies here too.** Pin the newest release at least
  7 days old, not what the major tag currently points at; the two differ
  whenever an action shipped this week.
- **Renovate keeps them fresh**: `helpers:pinGitHubActionDigests` pins any
  new tag ref it finds and proposes digest bumps that update the SHA and
  the version comment together, behind the same age gate.

## Binary dependencies

`presto-server` (Linux x86_64 binary from
[`alejoamiras/presto`](https://github.com/alejoamiras/presto))
is installed on every CI runner that executes a prover-ON network-e2e lane, via
the [`setup-presto-server`](./.github/actions/setup-presto-server/action.yml)
composite action. Trust posture:

- **Version + two SHA-256 pins in repo.** The composite action requires
  callers to pass `expected_tarball_sha256` (the release tarball, checked
  before anything is extracted) AND `expected_sha256` (the EXTRACTED
  `presto-server` binary, re-checked on every run, cache hits included,
  because `actions/cache` restores the binary, not the tarball). The
  workflow ([`_extension-network-e2e.yml`](./.github/workflows/_extension-network-e2e.yml))
  pins both as literals. Bumping the version requires updating all three
  fields together in the same PR. Reviewers MUST treat any change to the
  binary URL, version, or either hash as security-relevant.
- **The archive is inspected before extraction.** It must hold exactly one
  member, a regular file named `presto-server` — a link, a duplicate or an
  extra entry fails the step — and only that member is extracted. On a
  cache hit the restored directory must hold exactly that one regular file
  before it is hashed, made executable or put on PATH.
- **The upstream `.sha256` sidecar is a transfer-integrity check, not a
  security boundary.** A release-origin compromise would replace the
  tarball AND the sidecar together. The two repo pins are pins established
  once from the release assets — they are not independent provenance.
- **Bump procedure**:
  1. Download the release tarball and compute both hashes:
     ```bash
     VER=<VER>
     curl -sSfLO "https://github.com/alejoamiras/presto/releases/download/presto-v${VER}/presto-server-${VER}-linux-x86_64.tar.gz"
     sha256sum "presto-server-${VER}-linux-x86_64.tar.gz"            # expected_tarball_sha256
     tar -tvf "presto-server-${VER}-linux-x86_64.tar.gz"             # exactly one regular member: presto-server
     tar -xzf "presto-server-${VER}-linux-x86_64.tar.gz" presto-server && sha256sum presto-server   # expected_sha256
     ```
  2. Update `version`, `expected_tarball_sha256` AND `expected_sha256` in
     `_extension-network-e2e.yml`'s `setup-presto-server` step in one commit.
  3. CI re-verifies on EVERY install (cache-miss + cache-hit); a mismatch
     is loud (workflow goes red).
- **Single-maintainer trust model.** `alejoamiras/presto` is a
  single-maintainer repo. The maintainer is the same person who owns
  Nulo, so the trust model is what it is. Defense: pinning + per-bump
  PR review.

`geckodriver` (Linux x86_64, from
[`mozilla/geckodriver`](https://github.com/mozilla/geckodriver) releases) is
installed on every CI runner that executes a Firefox e2e lane, via the
[`setup-geckodriver`](./.github/actions/setup-geckodriver/action.yml)
composite action, under the same posture: a tarball SHA-256 checked before
extraction, a single-regular-member archive rule, and the extracted binary's
SHA-256 re-checked on every run, cache hits included. Its three pins (version
+ two hashes) live in the action itself rather than in each caller, because
both reusable e2e workflows install it and one bump must reach each; the bump
commands are in the action's description. Mozilla publishes a detached `.asc`
signature rather than a checksum sidecar, and the lanes do not verify it, so
the pins are the integrity check. Firefox itself is
not pinned by hash: the lanes run the revision the locked `puppeteer` pins
(`bun x puppeteer browsers install firefox`), fetched over HTTPS from
Mozilla's archive — the same trust as the Chrome that `puppeteer` downloads
for the required lanes — and the suite refuses to launch below the
manifest's `strict_min_version`.

geckodriver runs with `--allow-system-access`, without which Firefox refuses
remote navigation to `moz-extension://` pages. That flag lets the automation
session reach privileged browser contexts, so the Firefox e2e suite assumes
**trusted co-tenants**: a single-user development host or a single-tenant CI
runner. geckodriver listens on loopback ports the run reserves; any local
process that can reach them can drive that browser. Do not run the suite on
a shared multi-user machine.

**Distribution scope.** We download + execute the binary on ephemeral CI
runners only. We do NOT vendor it into the repo, ship it with the
extension, or expose it on a public network. The binary writes to
`~/.presto/versions/` on the runner (transient — destroyed with the VM)
and listens on `127.0.0.1:59833` only.

**Origin authorization.** presto-server is deny-by-default: with
`ALLOWED_ORIGINS` unset it denies every non-localhost browser origin
(localhost stays auto-approved on the headless build). Our offscreen prover
calls from `chrome-extension://<id>`, whose unpacked-extension id isn't
known until Chrome loads it, so the start step sets `PRESTO_ALLOW_ALL=1` on
the server process only (mutually exclusive with `ALLOWED_ORIGINS`). Safe in
our threat model because (a) CI runners are single-tenant and ephemeral, (b)
`pull_request` workflows from forks do not receive repo secrets, (c) the
server is loopback-only (`127.0.0.1:59833`) and the only call traffic
originates from the wallet we built. It is never set on a self-hosted runner
or at job level.

**Production transport.** The wallet talks to the Presto desktop app over
HTTPS only (`httpsOnly: true` is passed explicitly; plaintext is derived from
the CI proving mode inside the factory and the production build guard greps
the required-mode stamp out). That is a **bounded** guarantee: HTTPS-only
defeats a local process squatting the Presto ports without a
browser-trusted certificate for `127.0.0.1` — TLS fails, the SDK falls back
to WASM, no witness leaves the browser, and the witness-free HTTP diagnostic
never POSTs. It does **not** authenticate the Presto application: the
browser trusts any certificate its store trusts (no CA pinning), and Presto
persists its leaf TLS key on disk in an owner-only directory (the CA key
stays in memory), so same-user malware that can read that key, or a
compromised trust store, can impersonate the server. Those are residual
risks of the loopback-prover model, not solved here. The wallet never offers
Presto's session-only HTTP downgrade to users;
`apps/extension/src/presto/presto-policy.test.ts` drives the real client
and pins that a production configuration never issues an HTTP `/prove`.

**License posture.** The `@alejoamiras/presto` npm packages the extension
bundles are MIT at the pinned versions (relicensed from AGPL-3.0-only;
`apps/extension/src/presto/presto-licence.test.ts` fails if a pin drifts
back, and the third-party notices build refuses AGPL outright). The
`presto-server` binary is a separate artifact that CI invokes as a
build/test tool and never distributes: check its own release for the
licence that applies to it before shipping it anywhere. This is not legal
advice.

**CVE-on-Friday runbook.** When an advisory drops for a package newer than
the 7-day gate window:
1. Identify the patched version from the advisory.
2. Confirm `bun audit` flags it.
3. Open a hand PR:
   - Edit `bunfig.toml`: temporarily add the package name to
     `minimumReleaseAgeExcludes`.
   - Run `bun update <pkg>` (or `bun add <pkg>@<version>`).
   - Run `bun run audit:vue` + `bun run test:e2e`.
   - Commit the lockfile + bunfig change.
4. **Remove the exclude in the same PR, once `bun.lock` holds the patched
   version.** The gate applies whenever `bun install` RESOLVES a version.
   A frozen install never resolves, so CI and deploys need no exclude:
   prove it before committing, with the exclude deleted,
   `bun install --frozen-lockfile --force` must still succeed. An exclude
   left in place "until the window passes" exempts every FUTURE version of
   that name for days, which is the exposure the gate exists to prevent.

   **What removing it costs, until the version is 7 days old:** editing the
   `package.json` of a workspace re-resolves that workspace's dependency
   tree, and a young version in it is gated again even though it is locked
   — the install fails with `was published within minimum release age`
   (verified on Bun 1.4.2: a one-line edit to `apps/extension/package.json`
   three days after the Presto 1.1.0 bump). Workspaces that do not reach
   the young version are unaffected, and so is an install that changes
   nothing. So for that week, a dependency change in an affected workspace
   either waits, or is resolved with the exclude added **locally and not
   committed**: the lockfile it writes is the same, and the frozen install
   proves it. Commit an exclude across PRs only when a later PR of the same
   series must re-resolve the young version; date it, and remove it there.
5. PR description must cite the CVE and link the advisory.

**Bun bug #25305 — closed on Bun 1.4.** On 1.3.x, `bun update --latest`
did not apply `minimumReleaseAge` to transitive deps (workaround was
deleting `bun.lock` first). Verified fixed on 1.4.0 with a
positive-control mock-registry probe: when a gated update actually
re-resolves, direct AND transitive candidates are both held to the gate
(matrix: `implementations-plan/bun-1.4-bump/lessons/phase-5.md`). One
nuance remains by design: update never re-gates versions already in
`bun.lock` — evicting an already-locked too-young version takes a
deliberate lockfile regeneration.

**`bun pm scan`** is a plugin system for third-party scanners (Socket,
Snyk, etc.), not a built-in tool. Not configured today; revisit if/when
we pick a scanner.

**`@aztec/*` outside this policy.** Exact-pinned, bumped manually with
the class-id + address invariant fixture (deferred to a future Aztec
milestone). Renovate disables these packages so no automated PRs land
for them — see `renovate.json` `packageRules`.

**Renovate** runs via the hosted Mend Renovate GitHub App against
`renovate.json` at repo root. Conservative defaults:

- `minimumReleaseAge: "7 days"` mirrors `bunfig.toml`.
- `vulnerabilityAlerts.minimumReleaseAge: "0 days"` — security PRs skip
  the gate (belt-and-suspenders; vuln alerts skip the line by default).
  Pair with the CVE-on-Friday runbook above.
- `prConcurrentLimit: 3`, `prHourlyLimit: 2`, weekly Monday schedule
  (Buenos Aires TZ), no auto-merge anywhere.
- `@aztec/*`, `@alejoamiras/presto`,
  `@alejoamiras/aztec-standards`, `@alejoamiras/private-fee-juice` —
  all disabled (rule at the bottom of `packageRules`; later rules win
  per Renovate semantics).
- `@types/node` capped via `allowedVersions: "<25"` — patch/minor on
  24.x still flow.
- `baseBranchPatterns: ["dev"]` — PRs target `dev`, but Renovate
  always reads its config from the **default branch** (`main`). The
  config must reach `main` (via the standard dev → main promotion PR)
  before installing the Mend App; otherwise Renovate onboards against
  `main` with empty config.

**Schedule.** `["* 0-5 * * 1"]` (cron) — any minute, hours 0-5,
Mondays only. Renovate's `@breejs/later` text syntax (`"before 6am
on monday"`) is deprecated in favor of cron.

**Renovate ↔ Bun-version sync trap.** When Renovate bumps
`package.json#packageManager` (the Bun version), it does NOT touch
`.github/actions/setup-bun/action.yml`. CI workflows still pass
because every job uses the `setup-bun` composite action — they run
with the action-pinned Bun, NOT the new `packageManager` version. The
discrepancy is silent: there's no CI step that verifies the two
pinned values match. Manual review on every Bun-version Renovate PR
until a consistency-check script lands as a CI step.

**Validator step.** `_lint-and-typecheck.yml` runs
`renovate-config-validator --strict --no-global` against
`renovate.json` on every PR. The validator catches malformed/deprecated
keys but NOT semantic issues like `packageRules` precedence bugs or
the Bun-version sync trap above. The `renovate` package is pinned in
the workflow (`renovate@43.150.0` today) so the validator doesn't
fetch arbitrary fresh code on every CI run. Renovate will bump this
pin via its own routing-group PRs going forward.

## Reporting a vulnerability

Please open a private security advisory against the repository on GitHub.
Do not file public issues for security bugs.
