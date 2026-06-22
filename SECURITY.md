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
- **Passkey RP ID** — `nulo.sh`, used at credential creation AND at
  WebAuthn `get` (both literals must match — they're the same crypto
  binding). Changing it invalidates every existing passkey credential.
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
- **`SchnorrAccountContractArtifact`** — the upstream Aztec Schnorr account
  contract; the class id is pinned by the upstream `@aztec/accounts` version.
  Bumping that dependency changes the class id and orphans existing accounts
  unless handled via migration.

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

## Dependency policy

**Supply-chain age gate.** `bunfig.toml` sets `minimumReleaseAge = 604800`
(7 days). Newly published npm versions are filtered out at install time.
Defends against the npm-token-compromise attack pattern (axios 2026-03,
chalk/debug 2025-09) — those poisoned versions were detected and pulled
within hours.

Originally specified as 14 days, but Bun 1.3.x applies the gate during
`bun install --frozen-lockfile` (and during resolution), which blocks
installs of currently-pinned lockfile entries that happen to be within
the window. 7 days is the widest setting that passes against the current
lockfile while still catching the publish-and-pull-within-hours pattern.
Re-evaluate (push toward 14d) once Bun's gate semantics for frozen
installs are confirmed/tweaked upstream.

**`bun audit`** runs as an advisory step in `_lint-and-typecheck.yml`. It
surfaces npm advisories in the GitHub Action step summary but does not
block PRs (today). Bun 1.3.x exits 0 regardless of `--audit-level`, so
exit-code gating isn't useful yet; promotion to required is a follow-up
once we parse the JSON output and tune to actual signal.

**Bun pinned** to a specific patch version in `package.json#packageManager`
and in `setup-bun/action.yml` + the commitlint inline step. Cache keys
include the Bun version so a bump invalidates stale state.

**Lockfile is text (`bun.lock`)** — reviewable in PR diffs, no binary
opacity. Migrated from `bun.lockb` once Bun 1.3.13's text-lockfile
behavior was validated against the install + typecheck gates.

## Binary dependencies

`accelerator-server` (Linux x86_64 binary from
[`alejoamiras/aztec-accelerator`](https://github.com/alejoamiras/aztec-accelerator))
is installed on every CI runner that executes the network-e2e suite, via
the [`setup-accelerator-server`](./.github/actions/setup-accelerator-server/action.yml)
composite action. Trust posture:

- **Version + SHA-256 pinned in repo.** The composite action requires
  callers to pass `expected_sha256`; the workflow
  ([`_network-e2e.yml`](./.github/workflows/_network-e2e.yml)) pins it as
  a literal. Bumping the version requires updating both fields together
  in the same PR. Reviewers MUST treat any change to the binary URL,
  version, or expected hash as security-relevant.
- **SHA-256 sidecar from the same release is a sanity check, not a
  security boundary.** A release-origin compromise would replace the
  tarball AND the sidecar together. The repo-pinned hash is the
  authoritative anchor.
- **Bump procedure** (we pin the EXTRACTED binary hash, not the
  tarball hash — the binary is what `actions/cache` restores so it
  must be the trust anchor on every run; verifying only the tarball
  on download would leave cache-hit runs unverified):
  1. Compute the binary hash from the upstream tarball in one shot:
     ```bash
     curl -sSfL https://github.com/alejoamiras/aztec-accelerator/releases/download/accelerator-v<VER>/accelerator-server-<VER>-linux-x86_64.tar.gz \
       | tar -xzO accelerator-server | shasum -a 256
     ```
  2. Update `version` AND `expected_sha256` in `_network-e2e.yml`'s
     `setup-accelerator-server` step in one commit.
  3. CI re-hashes the binary on EVERY install (cache-miss + cache-hit);
     mismatch is loud (workflow goes red).
- **Single-maintainer trust model.** `alejoamiras/aztec-accelerator` is
  a single-maintainer repo. The maintainer is the same person who owns
  Nulo, so the trust model is what it is. Defense: pinning + per-bump
  PR review.

**Distribution scope.** We download + execute the binary on ephemeral CI
runners only. We do NOT vendor it into the repo, ship it with the
extension, or expose it on a public network. The binary writes to
`~/.aztec-accelerator/versions/` on the runner (transient — destroyed
with the VM) and listens on `127.0.0.1:59833` only.

**Origin authorization.** accelerator-server v1.0.6 (SEC-01c) is
deny-by-default: with `ALLOWED_ORIGINS` unset it denies every non-localhost
browser origin (localhost stays auto-approved). Our offscreen prover calls
from `chrome-extension://<id>`, whose unpacked-extension id isn't known until
Chrome loads it, so CI sets `ACCEL_ALLOW_ALL=1` to approve all origins (the
pre-SEC-01 behavior; mutually exclusive with `ALLOWED_ORIGINS`). Safe in our
threat model because (a) CI runners are single-tenant, (b) `pull_request`
workflows from forks do not receive repo secrets, (c) the server is
loopback-only (`127.0.0.1:59833`) and the only call traffic originates from
the wallet we built. See
[`implementations-plan/accelerator-server-ci/lessons/phase-1.md`](./implementations-plan/accelerator-server-ci/lessons/phase-1.md)
for the original (pre-v1.0.6) source-read.

**License posture.** The `@alejoamiras/aztec-accelerator` npm SDK is
AGPL-3.0-only; the server binary inherits the same license. We invoke
it as a build/test tool — no AGPL §13 (network-access disclosure)
trigger is obvious in this CI-internal use (no end users reached, no
public network endpoint). This is not legal advice; if the integration
scope ever expands (e.g. exposing accelerator-server in a deployed
Nulo service), redo the analysis.

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
4. After the window passes, open a follow-up PR removing the temporary
   exclude.
5. PR description must cite the CVE and link the advisory.

**Bun bug #25305.** `bun update --latest` does not apply
`minimumReleaseAge` to transitive deps. Workaround for bulk re-resolves:
delete `bun.lock` first, then re-install.

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
- `@aztec/*`, `@alejoamiras/aztec-accelerator`,
  `@defi-wonderland/aztec-standards`, `@wonderland/aztec-fee-payment` —
  all disabled (rule at the bottom of `packageRules`; later rules win
  per Renovate semantics).
- `@types/node` capped via `allowedVersions: "<25"` — patch/minor on
  24.x still flow.
- `puppeteer`, `puppeteer-core`, `@puppeteer/browsers`, `chromium-bidi`
  carry a temporary disable mirroring `bunfig.toml`
  `minimumReleaseAgeExcludes`; remove this rule on/after 2026-05-19.
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
