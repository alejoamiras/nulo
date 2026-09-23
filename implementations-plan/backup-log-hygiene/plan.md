# Extension log safety

Make every log line in `apps/extension` safe to persist and export. Evidence base:
[`recon.md`](recon.md) — six parallel sweeps, every claim file:line-cited.

**Scope (owner, 2026-08-27):** extension only (all four contexts) plus the packages it imports.
**Strategy:** hybrid — extend the `trim()` denylist AND add explicit redaction at the trust
boundaries. **Enforcement:** guard test + lint rule. **Delivery:** a `gh stack`, all-or-nothing.

## The problem in one paragraph

`console.*` is globally hijacked and funnels into `LoggerStore`, which flushes the last 2,000
entries to `chrome.storage.session["nulo:logs"]` every 2 seconds **for every user, not just
developers** (`wallet/logger/store.ts:81-92`). The only redaction is `trim()`, whose denylist is
five Aztec proof-material keys and which cannot see inside a pre-formatted string. 79% of the
365 call sites build a string. The result: decrypted private note content, live private contract
state, contact PII, browsing history, and balances are captured verbatim.

**Two corrections from audit, both load-bearing:**

1. **`chrome.storage.session` is memory-backed** — cleared on browser restart, extension update,
   and reload; it is NOT written to disk (codex C1). The earlier "2,000 entries on disk" framing
   was wrong. What remains real: retention **across SW restarts within a browsing session** (which
   is the entire point of `rehydrate()`), and the CSV export, which writes to actual disk.
2. **Key material DOES reach a log — via the transport, not via any call site.**
   `base-client.ts:196` logs the full response `content` (incl. `result`) at Warn on any unmatched
   `requestId`, i.e. any 60s timeout or duplicate; `exportMnemonic`/`exportPlain`/
   `exportBackupMaterial` resolve through it. The hand-written call sites are clean, and
   `ProfileService.restore`'s secret-parameter separation is correct and stays untouched — but the
   "no key material leaks" headline was wrong and is retracted.

## Architecture

Three layers, deliberately redundant, because each has a failure mode the others cover:

```
call site ──► this.log*/console.*  ──► [RPC hop for popup/offscreen] ──► LoggerStore
                    │                            │                          │
              (L3) discipline            (L2) envelope allowlist       (L1) trim()
              enforced by lint            hand-written per shape       universal walker
              + guard test                                            key denylist + shapes
```

- **L1 `trim()`** is the only universal choke point — but reaches objects only (~8% of sites).
- **L2 envelope allowlists** cover the generic transport paths, where the leak is not the call
  site's fault and no denylist could anticipate the payload.
- **L3 enforcement** stops the 79% string idiom from recurring, because no runtime layer can fix it.

**Triage axis: log level, not just bucket.** `LoggerStore` drops sub-`Info` entries when debug
mode is off (`store.ts:28,47`), so a Debug-level leak never reaches a normal user's disk.
Warn/Error sites are urgent; Debug sites are hygiene. Every arc below is ordered by that.

## Arcs — a `gh stack`, merged as a unit

`gh stack merge` is genuinely atomic (codex C6b), so partial landing is not a hazard. Ordering is
still load-bearing for a different reason: **arc 1's denylist must not exist before arc 2's
redaction is correctly placed**, or live RPC params get rewritten (see arc 2).

### Arc 0 — Stop retaining what we don't need (NEW — promoted from outline B)

Both audits independently concluded the filtering approach is secondary to the retention decision.
Gate `scheduleFlush` (`store.ts:81-92`) behind the same Developer Mode flag that already gates the
viewer, so a normal user's logs live in memory and die with the service worker. Keep the ring
buffer (it powers the live viewer and the failure dot).

This kills most of Tier 0/1 for non-developers **without touching a call site**, and composes with
— rather than replaces — the arcs below, which cover the paths B cannot: the transport envelopes,
the restore-error path, the dApp egress, and developers' own machines (who hold the real keys).

**Owner decision required** — see the gate. The cost is real: enabling the flag after a bug is not
retroactive, so field diagnosis of an already-occurred crash is lost.

### Arc 1 — Close the key-material and envelope leaks (bottom of the stack)

Promoted from arc 2/3 because this is the only path where **plaintext key material** reaches a log.

- `base-client.ts:196` — `handleResponse` logs full `content` incl. `result` on any unmatched
  `requestId`. Log the `requestId` and method only.
- `background/client.ts:87`, `offscreen/client.ts:74` — whole envelope at **Warn** (missed by recon).
- `base-service.ts:95,101`; `background/service.ts:68`; `offscreen/service.ts:49` — whole envelope
  incl. `params`.

Rebuild an allowlisted shape following `sanitizeTelemetry` (`offscreen/telemetry.ts:78-90`). The
correct pattern already exists at `base-client.ts:128`, which logs only the method name.

**Do NOT put `trim()` in `BaseServiceClient.request`.** `base-client.ts:123-127` is the generic
request path for every client; redacting there rewrites **live** `RestoreSecret` params and breaks
restore/unlock/export. Redaction belongs in `LoggerServiceClient.log` only.

**Gate:** a test asserting a crafted `params`/`result` value never appears in the emitted record,
modelled on `client.test.ts:424-438`'s `.not.toContain("rm -rf")`.

### Arc 2 — Fix and prove the redactor

1. **Replace the `Error` handling — carefully.** `trim(new Error("x"))` returns `{}` because
   `name`/`message`/`stack` are non-enumerable (`logger/utils.ts:96-110`). This is
   **over**-redaction (a diagnostics bug), and naively reusing `baseErrorJson` would swing it into
   *under*-redaction: messages and stacks can carry RPC credentials, input values, and paths
   (codex C5). Define a log-specific projection instead — stable name/code, capped and scrubbed
   message, stack only under explicit diagnostic capture. Test it with secret-bearing URLs.
2. **Collapse non-plain objects, not just names.** `Object.entries(new Uint8Array([1,2,3]))` yields
   indexed entries, so `trim()` currently **expands** a 32-byte key into a 32-key object; `Map`/
   `Set` collapse to `{}`. Handle `ArrayBuffer.isView`, `Map`, `Set` explicitly.
3. **Extend the denylist** to the privacy and secret names from recon's inventory, **in both
   casings** (in-memory `masterKey`, backup JSON `master-key`). **Do NOT add the bare key
   `secret`** — it names ciphertext in `Profile.secret` and plaintext `Fr` in
   `ActiveSession.secret`; blanket redaction costs diagnostic value, which C8 shows is the scarce
   resource. Redact those plaintext-bearing shapes by shape instead.
4. **Add shape-collapse for `Note`** — the Tier-0 leak at `notes/index.vue:79` is an object, so
   this fixes it without touching the call site. Collapse to type + content arity + error class,
   never `content`/`rawContent`.
5. **Write `trim()`'s first tests.** It has none. Pin the five existing keys, the shape-collapses,
   the depth cap, the new names, the typed-array/Map/Set handling, and the error projection.

**Gate:** `bun run test:all` + `bun run lint` exit 0; tests fail if any denylist entry is removed.

### Arc 3 — Always-captured call sites

Triage by **measured** level. Arc 6's original claim that the `getErrorMessage` family is sub-Info
was wrong — 83 of those matches are Warn/Error (codex C4b), so that family cannot be deferred
wholesale. Re-measure before deferring anything.

- **Tier 0:** `notes/index.vue:79` (decrypted note payload — mostly fixed by arc 2's `Note`
  collapse); `view-executor.ts:127` (private contract state under the user's scope);
  `batched-view-simulation.ts:380,411,424` (raw simulation `values` at Error — missed by recon);
  `wallet-core/src/storage/entity_storage.ts:85` (first 200 chars of ANY malformed stored row at
  Error — contact, network, transaction, profile, or attacker-supplied, and in a different package
  so arc 5's lint cannot see it).
- **Tier 1:** contact name/address (`contact/service.ts:149,202,206,210,215,244`,
  `useContactImportExport.ts:219`); browsing history (`wallet-sdk/background.ts:209-214`,
  `tab-lifecycle.ts:67-71`); gas balances (`gas-balance-reader.ts:195`); the restore-error log
  family (`useFullBackupImport.ts:507,886,1021`, `onboarding/pages/import.vue:102`).
- **Event-payload pair:** `background/client.ts:94`, `offscreen/client.ts:81` —
  `logDebug("Event received", event, payload)` carries every balance, profile, tx and transfer
  payload in the wallet. Debug-level, but it dwarfs everything else here by volume.
- **The three deliberate defeats:** `wallet-sdk/background.ts:808-812`,
  `dapp-send-executor.ts:751-752`, `tx-request-builder.ts:426` pre-`JSON.stringify` before
  interpolating. Convert to object arguments so arc 2 applies.

**"Log the identifier, not the payload" needs per-site rules, not one rule** (codex C8): a `txHash`
links private activity; an unsalted origin hash is dictionary-reversible; a contact UUID is useless
to support without the database. Prefer note type + content arity + render-error class; function
name + return-type count; operation + count + outcome; per-session keyed fingerprints only where
correlation is genuinely needed.

### Arc 3b — dApp egress (NEW)

`wallet-sdk/error-envelope.ts:106` returns `error.message` verbatim to an arbitrary dApp. Recon's
"no network egress" check only looked for telemetry SDKs. Same interpolation idiom, but remote,
silent, and off-machine — arguably the highest-severity egress in the audit. Map internal errors to
a stable code + safe message before they cross the boundary.

### Arc 4 — Restore-error boundary

- **Allowlist the generic branch** of `collectRestoreErrors` (`full-backup-helpers.ts:193-194`),
  which today strips nothing at runtime. The `account-state` branch (`:161-191`) already rebuilds
  an allowlisted object — copy it. Per-service allowlists keep an identifier + `restoreError`.
- **`restoreRows` (`restore-rows.ts:31`)** — stop spreading the pre-validation row. Highest-value
  fields: `Network.endpoints[].rpcUrl` and `Tx.submittedEndpointUrl` (**RPC URLs commonly embed
  provider API keys**), `encryptedSigningKey` (ciphertext), balances.
- **The bypass path** — `useFullBackupImport.ts:266-309,826-831` writes raw, schema-unvalidated
  rows straight into `restoreErrorLog`. Route it through the same allowlist.
- **Bound the error log.** No cap exists; `JsonViewer` renders and copies all of it.
- **Fix `clearLogs()`** — `LoggerStore.clear()` (`store.ts:23-25`) leaves `"nulo:logs"` intact, so
  "Clear logs" doesn't. Clear the session key too.

### Arc 5 — Enforcement (top of the stack) — RESCOPED

Both audits independently judged the lint half weak: `noConsole` covers 69 of ~365 sites,
constrains neither `this.log*` nor imported packages, and says nothing about content. It mostly
pushes authors from `console.*` toward `this.log*`, which the rule does not cover. So it is a
**hygiene nudge, not a control**, and the plan must not claim it makes coverage "complete."

- **Guard test** (the real control), modelled on `storage-facade-ban.test.ts`: walk the tree,
  allowlist logger internals, flag sensitive identifiers interpolated into `console.*`/`this.log*`
  template literals. Copy its DENYLIST-over-ALLOWLIST precedence and its self-test. State its
  textual false-negative class in the header, as that file does.
- **`noConsole`** as the cheap structural nudge, honestly labelled.
- **Document the policy in CLAUDE.md.** None exists today (grepped: zero matches).
- **STRUCK:** "key enforcement on the branded types." Brands erase at emit, so biome has no type
  information — the mitigation is not buildable as written. A `tsc`-based checker on direct
  arguments is a possible future arc, re-costed separately.

### Arc 6 — Deferred hygiene (NOT in this stack)

Debug-level address/id interpolation across ~25 wallet-sdk sites. **Re-measure before deferring** —
the original claim that the `getErrorMessage` family is sub-Info was wrong (83 Warn/Error matches),
and that family therefore moves into arc 3.

Also here: the `console-sniffer.ts:2` shared queue — one buffer across every console method means
pre-wiring `console.debug` arguments can replay through the first later Info/Warn/Error handler
(codex C4). Small, self-contained, no user-visible behavior.

## Security & adversarial considerations

- **Threat:** a user shares a CSV export or an attacker reads `chrome.storage.session`. Today that
  yields decrypted note content, contract state, contacts, and browsing history.
- **Deliberately NOT touched:** `ProfileService.restore`'s secret-parameter separation
  (`profile/service.ts:2254-2257`) and `jsonSanitize` (a content-blind type codec on every
  message's hot path — overloading it with redaction conflates two concerns).
- **Over-redaction is a real cost.** Logs exist to debug. Every redaction must keep a correlating
  identifier, and arc 1's Error fix is a net *increase* in useful content.
- **Denylists fail open** on names nobody enumerated. Accepted, mitigated by L2/L3 and by keying
  enforcement on the branded types in `wallet-crypto/src/secret-types.ts`, which are minted through
  one grep-auditable boundary.
- **A cap is not redaction** — a short secret survives any length cap. Length bounds are
  defense-in-depth only.

## Decision ledger

| # | Decision | Source | Rationale |
|---|---|---|---|
| D1 | **Arc 0 (retention gate) promoted from rejected-alternative to the primary control** | both audits | Bigger risk reduction per line changed than any filtering arc, and composes with them. My original rejection of outline B rested partly on a factual error (D4). |
| D2 | **"Move `trim()` earlier" CUT** | both audits, verified | `base-client.ts:123-127` is the generic request path; redacting there rewrites live `RestoreSecret` params and breaks restore/unlock/export. Redact in `LoggerServiceClient.log` only. |
| D3 | **"No key material leaks" RETRACTED** | both audits, verified | True of call sites, false at `base-client.ts:196`. Promoted to arc 1. |
| D4 | **Outline B rejection reason #4 was wrong** | Claude audit | Restore-error data DOES traverse `LoggerStore` (`useFullBackupImport.ts:507` is a `console.warn`, and `console.*` is hijacked). Reasons 1–3 stand. |
| D5 | **`chrome.storage.session` is memory-backed, not disk** | codex C1 | Severity framing corrected throughout. CSV export and cross-SW-restart retention remain real. |
| D6 | **Do NOT denylist the bare key `secret`** — codex over Claude | conflict resolved | `Profile.secret` is ciphertext appearing in legitimate diagnostics. Claude's "over-redacting is free" is wrong: the cost is diagnostic value, already the scarce resource (C8). Redact plaintext-bearing *shapes* instead. |
| D7 | **Branded-types enforcement STRUCK, not softened** | both audits | Brands erase at emit; biome has no type info. Not buildable as written. |
| D8 | **Arc 5 rescoped from "control" to "nudge + guard test"** | both audits | `noConsole` covers 69/365 sites and no content. Claiming it completes coverage would be the plan's own security theater. |
| D9 | **The Error fix must not be a naive `baseErrorJson` port** | codex C5 | Current state is *over*-redaction; the naive fix swings to under-redaction, since messages/stacks carry credentials and paths. |

## Open questions for the approval gate

1. **Arc 0 — gate log persistence behind Developer Mode?** The single biggest risk reduction here,
   and the one real cost in the whole plan: enabling the flag *after* a bug is not retroactive, so
   diagnosing an already-occurred crash from a user's logs becomes impossible. **Owner's call.**
2. **`packages/aztec-runtime` scope.** It defines the account-export envelope with a plaintext
   `signingKey` and was outside the four packages scoped. Recommend folding in.
3. **CSV export: keep, gate harder, or remove?** Owner has never used it; it is already
   developer-gated. Note removal does NOT fully close the egress — `LogsViewer.vue:216-228` is a
   CodeMirror view, so select-all-copy still works. **Owner's call — feature removal is never an
   autonomous decision.**
4. **`JsonViewer`'s unconditional copy button** (`JsonViewer.vue:75-86`) — gate it on the
   restore-error path, or leave it?

## Out of scope, filed separately

`scripts/check-no-brand.sh` never runs in CI (local hook only); `migrations/registry.test.ts:54`
is non-recursive; `getCapabilityInfo` vs `getSafeDisplay` export contradictory guarantees.
