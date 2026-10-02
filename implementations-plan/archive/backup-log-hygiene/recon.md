# Recon — extension log safety

Six parallel read-only sweeps (log pipeline, sensitive-data inventory, redaction prior art,
call-site audit, restore-error boundaries, enforcement prior art). Every claim below carries a
file:line. Scope: `apps/extension` + the packages it imports.

## The headline: the threat model is privacy data, not key material

Two independent sweeps searched for secrets reaching a log call and found **none**:

- No `mnemonic`, `password`, `passhash`, `signingKey`, or `encryptedSigningKey` is ever passed
  to `console.*` or `this.log*`. Searches: `console\.[a-z]+\([^)]*password`,
  `log(Debug|Warn|Error|Info)\([^)]*(signingKey|secret\b)`, and the `mnemonic` cross-reference —
  all zero matches.
- The export flows (`export/full.vue`, `export/account.vue`) log only the caught `err`, never
  their secret locals (`masterKey`, `entropyB64`, `dekB64`, `payloadCompact`, `encryptedB64`).
- `ProfileService.restore` takes `RestoreSecret` (plaintext `masterKey`/`entropy`/
  `importedKeysDek`) as a parameter **separate** from the `ProfileInfo` row it spreads on failure
  (`profile/service.ts:2254-2257`, `:2383-2386`), so the master secret never enters the error log.

That is a deliberate, working design. **The plan must not disturb it.**

What IS logged verbatim into persisted, exportable storage is user privacy data — for a privacy
wallet, arguably the thing users care most about.

## The pipeline (why any log line matters)

`console.*` is globally monkey-patched (`utils/console-sniffer.ts:1-32`, loaded in all four
contexts) and forwarded into the same sink as `this.log*`. That sink, `LoggerStore`
(`wallet/logger/store.ts:27-43`), does `trim(data)` then:

- appends to a ring buffer — 1,000 entries, or 10,000 in debug (`store.ts:15`)
- **debounce-flushes the last 2,000 entries to `chrome.storage.session["nulo:logs"]` every 2s**
  (`store.ts:81-92`), rehydrated on SW restart (`store.ts:65-78`)
- emits `onLog` to the viewer, and prints via the saved `console._*` originals

**The flush is NOT developer-gated.** It runs for every user. The CSV export
(`LogsViewer.vue:141-153` → `chrome.downloads.download`, `saveAs:false`) IS gated behind
Developer Mode (`settings/advanced/index.vue:174`), so the viewer is a dev tool — but the
capture it exports is universal. **Fix at capture, not at the viewer.**

One real mitigation: `LoggerStore` drops everything below `Info` when debug mode is off
(`store.ts:28,47`). A Debug-level leak never reaches any sink for a normal user. **This is the
plan's primary triage axis.**

Two pipeline defects found on the way:

- **`clearLogs()` does not clear the persisted copy.** `LoggerStore.clear()` (`store.ts:23-25`)
  resets the ring buffer only; `"nulo:logs"` survives until the next flush overwrites it. A user
  who clicks "Clear logs" still has up to 2,000 entries on disk.
- **Redaction runs too late.** Popup/offscreen `logger.log()` serializes raw `data` into the RPC
  envelope at `base-client.ts:123-127` **before** `trim()` runs (trim executes only in the SW's
  `LoggerStore`). Data crosses the process boundary untrimmed.

Confirmed clean: logs are **not** in the full backup — `buildBackupServices`
(`export/full.vue:96-118`) enumerates exactly 12 clients, neither logger service among them, and
`Service.backup()` defaults to `null`. No Sentry/analytics/network egress exists
(`grep -rln "sentry|analytics|posthog|amplitude|mixpanel"` → 0).

## Findings, ranked

### Tier 0 — always-captured (Warn/Error), decrypted private data

| Site | What leaks |
|---|---|
| `popup/pages/settings/advanced/account-state/notes/index.vue:79` | `console.warn(..., note)` — full `Note` whose `content`/`rawContent` is the **decrypted private note payload** (`note/spec.ts:3-23`) |
| `wallet/services/execution/view-executor.ts:127` | `logError(..., result)` — raw output of `pxe.executeUtility` run **under the user's account scope**: live private contract state |

Both are above the Info gate, so they are captured for **every** user.

### Tier 1 — always-captured, PII / browsing history / financial

- Contact **name + address** on every mutation — `contact/service.ts:149,202,206,210,215,244`,
  `useContactImportExport.ts:219`
- **Browsing history** — `wallet-sdk/background.ts:209-214` logs `sender.tab?.url`;
  `tab-lifecycle.ts:67-71` logs every dApp-tab navigation destination
- **Gas balances** — `gas-balance-reader.ts:195`
- Restore-error log family — `useFullBackupImport.ts:507,886,1021`, `onboarding/pages/import.vue:102`

### Tier 2 — the generic transport envelopes

These log a whole RPC envelope, so they leak whatever the *call* carried:

- `base-service.ts:95` / `:101` — `logWarn("Invalid request received", content)` incl. `params`
- `background/service.ts:68`, `offscreen/service.ts:49` — full message
- `base-client.ts:196` — `logWarn("Invalid response received", content)` incl. `content.result`

Reached only on malformed requests / raced-or-duplicate responses. Under MV3 the SW dies
constantly, so a raced response is routine, not exotic. The correct pattern already exists two
lines away: `base-client.ts:128` logs only the method name, never `params`.

### Tier 3 — restore-error boundary

- `restoreRows` (`restore-rows.ts:31`) spreads the **entire pre-validation input row** on failure.
  8 callers; the sensitive ones are `ImportedAccountKey.encryptedSigningKey` (ciphertext only —
  plaintext `skBytes` is zeroized and never attached, `account/service.ts:753-767`),
  `Network.endpoints[].rpcUrl` and `Tx.submittedEndpointUrl` (**RPC URLs commonly embed provider
  API keys**), and `TokenBalanceRaw.publicBalance`/`.privateBalance`.
- `collectRestoreErrors`' generic branch (`full-backup-helpers.ts:193-194`) does **no runtime
  field stripping** — `GenericRestoreItem` is a TypeScript-only annotation. The `account-state`
  branch (`:161-191`) correctly rebuilds an allowlisted object; the generic one does not.
- `useFullBackupImport.ts:266-309,826-831` writes **raw, schema-unvalidated** token-balance rows
  straight into `restoreErrorLog`, bypassing both `restoreRows` and `collectRestoreErrors`.
- **No size or count bound** anywhere on `restoreErrorLog` or its viewer. `JsonViewer` renders and
  copies the whole thing, and its copy-to-clipboard button has no `v-if` (`JsonViewer.vue:75-86`).

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Object-walking redactor at the log choke point | `trim()` — `wallet/logger/utils.ts:69-113` | **adapt** — right position, wrong denylist |
| Allowlist reconstruction for a known shape | `sanitizeTelemetry` — `offscreen/telemetry.ts:78-90` | **reuse pattern** for the Tier-2 envelopes |
| Allowlist-one-field, placeholder-the-rest | `redactDescriptorForLog` — `bridge-core/src/relay-claim.ts:99-107` | **reuse pattern**; its comment records a codex finding that redacting one field alone still leaked via neighbours |
| Error → loggable shape | `baseErrorJson` — `wallet-core/src/utils/error-json.ts:18-24` | **reuse as-is** inside `trim()` |
| Ban enforcement (walk + grep + allowlist) | `storage-facade-ban.test.ts` | **reuse pattern**, incl. its DENYLIST-over-ALLOWLIST precedence and its self-test |
| Call-surface enforcement | biome `lint/suspicious/noConsole` | **build new (enable)** — exists, is off, verified to fire when forced |
| Wire-safe serialization | `jsonSanitize` — `wallet-core/src/utils/serialization.ts:26-57` | **do not touch** — a type-coercion codec, content-blind by design, on every message's hot path |
| Length capping | `truncateErrorMessage` (200), `NORMALIZED_RAW_MAX_CHARS` (4096) | **defense-in-depth only** — a short secret survives any cap |

## Two bugs in the redaction layer itself

1. **`trim()` destroys Errors.** `Error`'s `name`/`message`/`stack` are non-enumerable, so the
   `Object.entries().reduce()` fallback (`utils.ts:96-110`) returns `{}`. Every Error logged as an
   object loses its message and stack. This is the *same* bug already found and fixed on the RPC
   path — `serialization.test.ts:27-33` documents it — and the fix was never ported.
2. **`trim()` has no test.** `store.test.ts` logs only primitives (`"hello"`, `42`); the
   depth-cap, shape-collapse, and denylist branches are exercised by nothing in the repo.

## The structural finding that shapes the plan

Call-site census across 365 classifiable sites:

| Bucket | Count | Meaning |
|---|---|---|
| **B** — template-interpolated or pre-stringified | **~289 (79%)** | opaque to `trim()`, permanently |
| **A** — raw object argument | ~30 | reachable by `trim()` |
| **C** — constant string | ~46 | inert |

The dominant idiom is `` `${label}: ${value}` `` and `logX("label", getErrorMessage(err))`. Three
sites `JSON.stringify` **before** interpolating (`wallet-sdk/background.ts:808-812`,
`dapp-send-executor.ts:751-752`, `tx-request-builder.ts:426`), actively defeating object redaction.

**Therefore: hardening `trim()` alone reaches at most ~8% of sites.** It is necessary (it is the
only universal choke point) but cannot be the whole plan. The Tier-0/1 leaks must be fixed at the
string-construction site, and enforcement must stop the idiom recurring.

## Absence claims (search trails)

- No general log redactor exists: `\b(redact|sanitiz\w*|scrub\w*|mask\w*)\b` full-repo — the
  complete hit set is the prior art inventoried above; nothing named `redactLog`,
  `sanitizeLogPayload`, `scrubForLogging`.
- No PII classification table: `\bpii\b` whole-word full-repo → **one** hit, a comment in
  `tests/e2e/fixtures/journal.ts:195`.
- No logging policy in CLAUDE.md: grepped `log` lines for `redact|sanitiz|secret|privacy|pii` → 0.
- `trim()` is the only depth-capped key-rewriting object walker: `MAX_LOG_DATA_DEPTH|maxDepth`,
  `Object\.entries\(.*\)\.reduce` → all other hits are unrelated data transforms.
- Only 5 `console.*` sites in `wallet/` bypass `ILogger` entirely (`wallet/index.ts:43`,
  `config/store.ts:34`, `wallet-sdk/content-message-relay.ts:95,100,122`); all log short
  static strings.

## Out of scope, but found — worth separate tickets

- **`scripts/check-no-brand.sh` never runs in CI.** Invoked only from `.githooks/pre-commit:4`, so
  it is local-only: bypassed by `--no-verify`, by anyone who never ran `bun install`, and by
  web-UI/bot commits. The absolute-path/brand guard is weaker than CLAUDE.md implies.
- **`migrations/registry.test.ts:54` is not recursive** — `readdirSync` without descent, so a
  migration nested one directory deeper escapes the authored-but-unregistered scan.
- **`getCapabilityInfo` vs `getSafeDisplay`** (`dapp-session/capability-meta.ts`) export opposite
  guarantees and are each tested as correct — one echoes the raw dApp-controlled string
  (`:98-107`), the other was added to stop exactly that (`:194-215`). A trap for anyone grepping
  for "the safe way to display a wire string".
