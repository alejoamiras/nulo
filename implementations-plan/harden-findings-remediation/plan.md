# Plan — Harden findings remediation

Remediate all 14 findings from the `/harden security max` run (`audit/security/2026-07-06-max/`) on the integration branch **`fix/harden-findings`**, as a sequence of independently-reviewable per-unit PRs, driven autonomously with Codex as the advisory tie-breaker.

- **Source of truth for findings:** [`audit/security/2026-07-06-max/findings/verified.md`](../../audit/security/2026-07-06-max/findings/verified.md).
- **Blueprint tier (campaign):** `mid`. Dual audit complete (codex + fable), both **conditional approve**; all conditions folded in below (see Decision ledger). Risky units A and L each get a **deep per-unit design pass** during execution.
- **Autonomy:** fully autonomous to a finished set of PRs. Codex advisory; hard limits hold (no merge to `dev`/`main`/release, no publish/deploy, no scope-expansion).

## Branch / PR / CI strategy  *(revised per audit condition 1)*

- `fix/harden-findings` — long-lived **integration branch** off `dev`. The audit dir + this plan land here as the first commit.
- Each **work unit** → short child branch off `fix/harden-findings` (e.g. `fix/hf-a-dispatcher-authz`) → **PR into `fix/harden-findings`**. Autonomous-merge of a unit PR into the integration branch is allowed (neither `dev` nor release).
- **CI reality (verified):** the PR workflows trigger only on `pull_request.branches: [main, dev]` (`.github/workflows/{pr-quick,pr-smoke-e2e,pr-network-e2e}.yml`). **PRs into `fix/harden-findings` get NO GitHub CI.** Therefore:
  - Every unit PR **must run its full local validation gate** (below) and paste the results into the transcript + `lessons/phase-<unit>.md`. Local green is the merge criterion for a unit PR.
  - The **single promote PR `fix/harden-findings → dev`** runs the real GitHub CI (`quality-status`, `smoke-e2e-status`, `network-e2e-status`) and must be green. Open it and STOP — the user merges to `dev` (hard limit: never merge to `dev`).
  - Do NOT edit workflow branch filters to add the temp branch (a CI change out of scope).
- Conventional-commit unit titles (`fix(bridge): …`), lower-case, ≤ ~93 chars.

## Per-unit "blueprint tier" — design rigor inside the loop

Tier = rigor applied before coding, NOT a separate approval gate (one campaign approval; 12 nested blueprints would defeat autonomy):

- **DIRECT** — mechanical, mirrors an existing pattern. Implement + validate. (F-05, F-13)
- **LIGHT** — small, contained. One-paragraph approach note in `lessons/`; one Codex sanity consult if a real open question exists. (F-07/F-14)
- **MID** — real design choice. Approach + open-questions note in `lessons/phase-<unit>.md`; resolve open questions with a `/codex xhigh` consult (log verdict); implement + validate. (C, D, E, G, I)
- **DEEP** — auth-boundary or frozen-crypto (Units A, L). Before coding: write a **design artifact with explicit invariants + the negative tests that must pass**, and go back-and-forth with `/codex xhigh` until a defensible design is agreed (log every round). Only then implement. Network-e2e gated.

Codex is **advisory**: if a Codex suggestion conflicts with this plan's scope, a hard limit, or a prior user instruction → STOP and surface.

## Work units (11)  *(G+H merged per audit; F-02 is a 3-sink bug)*

| Unit | Findings | Title | Tier | Primary files |
|---|---|---|---|---|
| **A** | F-01, F-02(authz), F-08 | Dispatcher trust-boundary: reject raw authwit hashes, **bind name↔selector in execution at all 3 sinks**, server-side arg validation | **DEEP** | `packages/wallet-bridge/src/{dispatcher,method-scope-checkers,method-descriptors}.ts`; `apps/extension/src/wallet/services/execution/{tx-request-builder,operation-planner,service,contract-resolver}.ts`; `wallet-sdk/content-script-validator.ts` |
| **B** | F-02(display), F-07, F-01(UI) | Approval UI: sanitized labels (security via A's execution-reject) + **surface `canCreateAuthWit`** | LIGHT→MID | `apps/extension/src/popup/windows/execute/OperationCard.vue`; `src/utils/tx-enrichment.ts`; `popup/windows/capabilities/{build-items.ts,AccountSelectRow.vue}` |
| **C** | F-03 | Chain-identity TOCTOU: sign over validated chain info, not a re-fetch | MID | `apps/extension/src/wallet/services/execution/tx-request-builder.ts`; `packages/aztec-runtime/src/account/nulo-account.ts` |
| **D** | F-04 | Discovery-flood rate limit + chain allowlist + locked-queue cap | MID | `apps/extension/src/wallet/services/wallet-sdk/background.ts`; `packages/wallet-bridge/src/discovery-queue.ts` |
| **E** | F-06 | Backup-restore config allowlist; never silently disable strict mode | MID | `apps/extension/src/composables/useFullBackupImport.ts`; `src/wallet/services/config/service.ts`; `profile/session-manager.ts` |
| **F** | F-05 | CSP `img-src`/`default-src` hardening (closes latent logo beacon) | DIRECT | `apps/extension/manifest/manifest.config.ts` |
| **G** | F-09, F-10 | Offscreen/messaging **sender authentication** + Firefox durable instance token | MID | `packages/extension-messaging/src/{offscreen/service,offscreen/client,background/service}.ts`; `apps/extension/src/offscreen/index.ts`; `src/wallet/utils/offscreen.ts` |
| **I** | F-12 | `DappSession` row integrity: validate + clamp + **MAC** on load (wipe-reseed existing) | MID | `packages/wallet-core/src/storage/entity_storage.ts`; `apps/extension/src/wallet/services/dapp-session/service.ts` |
| **J** | F-13 | `ValueStorage.get()` parse containment (mirror `EntityStorage`) | DIRECT | `packages/wallet-core/src/storage/value-storage.ts` |
| **K** | F-14 | Clipboard secret hygiene: warn + delayed clear on seed/key copy | LIGHT | `apps/extension/src/popup/pages/settings/security/export/{seed,key}.vue` |
| **L** | F-11 | Password/passkey bearer redesign (**session-only wrapped-secret**) + memory hygiene — **no storage bump / no wipe** | **DEEP** | `packages/wallet-crypto/src/{encryption-key,password-secret-box,passkey-credential,zeroize}.ts`; `apps/extension/src/wallet/services/profile/{session-manager,spec}.ts` |

**F-11 (Unit L) scope RESOLVED at approval (2026-07-06): option (a) full fix under a SESSION-ONLY invariant** — redesign the ephemeral silent-restore bearer only; **NO storage-version bump, NO destructive wipe, existing profiles/accounts preserved** (at most a one-time re-unlock for non-strict-mode users). See Unit L for the invariant + its stop-and-surface guard.

## Execution order (dependencies + risk)

1. **A** (deep) → 2. **B** (relies on A's execution-layer reject) → 3. **F, J** (DIRECT quick wins) → 4. **C** → 5. **K** → 6. **D, G, I** (MID, independent) → 7. **E** → 8. **L** (deep; **must be after E** — both edit `session-manager.ts`, and L relies on strict-mode suppression from E).

Hard edges: **B after A**, **L after E**, **L last**. Others independent.

---

## Per-unit detail

### Unit A — Dispatcher trust-boundary hardening (DEEP) — F-01, F-02(authz), F-08

**Problem.** The dApp→wallet dispatcher validates message *shape* but not *semantics*: accepts `args: unknown[]` (F-08); a raw `Fr` authwit hash bypasses scope + popup and is signed (F-01, Critical); and authorization gates on dApp-supplied `call.name` while execution/signing uses `call.selector` (F-02) — at **three** sinks.

**Reconciled design (both audits — bind in EXECUTION, do NOT make scope-checks async or inject PXE into the dispatcher):**
1. **Bind name↔selector in execution, reject on mismatch**, at all three F-02 sinks — the artifact is resolvable there via `ContractResolver` (`contract-resolver.ts:50`, `tx-request-builder.ts:127`):
   - sendTx standard: `tx-request-builder.ts:294-328` (already calls `findFunctionBySelector` at :300-304 — add `resolved.name === action.name` assertion, reject mismatch).
   - sendTx NO_FROM: `tx-request-builder.ts:437-452`.
   - **createAuthWit CallIntent: `service.ts:657-672`** — currently loads no artifact; resolve `call.to`'s artifact, assert `findFunctionBySelector(call.selector).name === call.name`, reject mismatch BEFORE `computeAuthWitMessageHash`.
   Keep the existing synchronous name-based scope check (`method-scope-checkers.ts`) as-is — the execution-layer mismatch-reject makes it sound.
2. **Reject dApp-origin raw authwit hashes** structurally (F-01): in `checkCreateAuthWit`, require `isCallIntent`/`isIntentInnerHash` (reuse guards at `method-scope-checkers.ts:239-253`); reject anything else — fail closed, no primitive-sniffing. Raw `Fr` is not even a valid SDK type (`base_wallet.d.ts:99`), so this is pure upside.
3. **IntentInnerHash → explicit per-request confirmation popup** (NOT hard-reject): its `innerHash` is attacker-chosen and only `consumer` is scope-checked at wildcard (`service.ts:673-679`, `method-scope-checkers.ts:296-297`). Hard-reject would regress inner-hash-authwit dApps; the faucet doesn't use it, so confirmation is safe.
4. **Server-side per-method arg validation** (F-08): dispatcher-side schema parsing `args` before capability/scope checks + casts (`dispatcher.ts:275,328`). Author fresh server-side schemas (do NOT trust the client `WalletSchema`).

**Pre-code DEEP design artifact** (`lessons/phase-A.md`, Codex-reviewed) must state the **invariants** ("no signing/execution path consumes an unresolved dApp `name`"; "every dApp-origin authwit is either a scope-checked structured intent or an explicitly-confirmed inner-hash") and the **negative tests** (name/selector-mismatch rejected at each sink; raw `Fr` rejected; malformed args rejected pre-authz).

**Open questions for Codex (`/codex xhigh`, log in `lessons/phase-A.md`):** exact artifact-resolution call for the createAuthWit path; whether NO_FROM has an artifact at that point; server-side schema shape/coverage; confirm no regression to the sound `accounts`-scope enforcement or the verified-sound authwit signature binding / entrypoint chunking (do NOT touch those).

**Validation gate.**
- `bun run --filter '@nulo/wallet-bridge' --if-present test` (dispatcher + scope-checker units, incl. new reject/mismatch cases) → green.
- `bun run test` (extension units, incl. new execution-layer binding tests at all 3 sinks) → green.
- **Faucet serialization coverage** (audit condition): `bun run test:faucet` OR a targeted fixture proving a serialized `createAuthWit` `CallIntent` arrives with `{name,selector,type,args,returnTypes}` intact and passes.
- `bun run typecheck:all` + `bun run lint` → exit 0.
- `bun run e2e:agent` (network — MUST NOT regress real dApp connect/execute/authwit flows) + `bun run test:e2e` (smoke) → green.
- Layers: typecheck · lint · unit · faucet-serialization · network-e2e.

### Unit B — Approval-display truthfulness (LIGHT→MID) — F-02(display), F-07, F-01(UI)
**Scope decision (audit condition — chosen: display + execution-reject, NOT pre-popup PXE resolution):** the popup may render the dApp `name`; security rests on Unit A's execution-layer mismatch-reject (a spoofed approval → rejection at execution, never a wrong signature). So B is display-hardening + capability visibility:
- Route method labels/args through `sanitizeWireString` in `OperationCard.vue` (not applied to method names today — `:29,232`) + clamp lengths.
- Make `parseTransferIntent` selector-verified rather than `name`-keyed (`:179,192,199`).
- **Surface `canCreateAuthWit`** in the capabilities approval UI (`build-items.ts:36` currently `continue`s on `accounts`; `AccountSelectRow.vue`) — closes F-01's UI-invisibility half.
**Depends on A.**
**Gate:** `bun run --cwd apps/extension test:components` (OperationCard bidi/RLO/overlong + capabilities cases) + `bun run test` + `bun run lint` + `bun run test:e2e` (smoke). Layers: lint · unit/component · smoke-e2e.

### Unit C — Chain-identity TOCTOU (MID) — F-03
Thread the validated `chainInfo` (`tx-request-builder.ts:116-124`) into `account.buildTxExecutionRequest`; drop the internal `getNodeInfo()` re-fetch in `nulo-account.ts:103` (or re-`assertLiveChainIdentity` on it). Open Q (Codex): pass-in vs re-assert; least-invasive to the account adapter signature.
**Gate:** `bun run --filter '@nulo/aztec-runtime' --if-present test` + `bun run test` + `bun run typecheck:all` + `bun run lint` + `bun run e2e:agent`. Layers: typecheck · lint · unit · network-e2e.

### Unit D — Discovery-flood rate limiting (MID) — F-04
Global + per-(origin,tab) cap on pending discoveries; reject unknown `chainId` before popup; coalesce locked-state by `(origin,chainId)` in `discovery-queue.ts`. Open Q (Codex): cap values + eviction; enforce at `background.ts` intake vs `discovery-queue`.
**Gate:** `bun run --filter '@nulo/wallet-bridge' --if-present test` + `bun run test` + `bun run lint` + `bun run e2e:agent` (discovery is a dApp path). Layers: lint · unit · network-e2e.

### Unit E — Backup-restore config allowlist (MID) — F-06
Validate restored config against a schema/allowlist in `useFullBackupImport.ts`; never silently apply `strictSecurityMode=false`/`sessionTtl` — default strict unless the user explicitly confirms a downgrade during import. Open Q (Codex): downgrade-confirm UX; which keys restore verbatim.
**Note:** E is a **prerequisite of L** (both edit `session-manager.ts`; L's new token bearer must also be strict-mode-suppressed).
**Gate:** `bun run test` (config + import composable) + `bun run --cwd apps/extension test:components` + `bun run lint` + `bun run test:e2e` (restore smoke). Layers: lint · unit/component · smoke-e2e.

### Unit F — CSP hardening (DIRECT) — F-05
Add `img-src 'self' data: blob:` + a `default-src` floor to `manifest.config.ts`. Confirm no legit remote-image load (audit found none).
**Gate:** `bun run build` (CSP must not break the app) + `bun run test:e2e` (smoke) + `bun run lint`. Layers: build · lint · smoke-e2e.

### Unit G — Offscreen/messaging sender-auth + Firefox instance token (MID) — F-09, F-10
*(G+H merged — both touch offscreen sender/token routing.)*
- **Sender authentication** (audit condition — `sender.id` alone is insufficient): in the offscreen service listener (`offscreen/service.ts:36`) and messaging `Service.onConnect`/`onMessage` (`background/service.ts:36`), require `sender.id === chrome.runtime.id` **AND reject `sender.tab`-present senders** (content scripts/pages), allowlisting SW/popup/offscreen contexts (mirror `content-script-validator.ts:88-90`). Add **Firefox `sender`-shape parity tests**.
- **Durable instance token** for `{to:"pxe"}` requests so stale Firefox windows self-close / ignore mismatched tokens (F-10) — this is stale-instance separation, **NOT** the sender-auth control (keep both).
**Gate:** `bun run --filter '@nulo/extension-messaging' --if-present test` (sender-accept/reject + Firefox-shape) + `bun run test` + `bun run build:firefox` + `bun run lint` + `bun run e2e:agent` (offscreen/PXE path). Layers: build(firefox) · lint · unit · network-e2e.

### Unit I — DappSession row integrity (MID) — F-12
- On load: Zod-validate + clamp enum/range (`confirmationLevel`); **wipe-and-reseed** existing rows rather than migrate (no prod users → simplest, least error-prone — Codex).
- **MAC** new writes over canonical fields (`sessionId, origin, chainId, profileId, accounts, grants, confirmationLevel, version`) with a key **derived from the active profile master secret** (a non-exported derived key — NEVER stored beside the tamperable rows). If locked at load, drop rows until unlock.
**Gate (strengthened — audit condition):** `bun run --filter '@nulo/wallet-core' --if-present test` + `bun run test` + `bun run lint` + **a real dApp grant→reconnect check** via `bun run e2e:agent` (a bad MAC/key can brick every reconnect — smoke-only is too weak). Layers: lint · unit · network-e2e.

### Unit J — ValueStorage parse containment (DIRECT) — F-13
Mirror `EntityStorage`'s `parseOrDelete` in `ValueStorage.get()`: try/catch the `JSON.parse`, log bounded metadata, quarantine/delete the bad row, return default/undefined.
**Gate:** `bun run --filter '@nulo/wallet-core' --if-present test` (malformed-row test) + `bun run lint`. Layers: lint · unit.

### Unit K — Clipboard secret hygiene (LIGHT) — F-14
Warn on both seed + key copy; attempt a delayed clipboard clear only if it still equals the copied secret; add the seed page's warning to the key page.
**Gate:** `bun run --cwd apps/extension test:components` + `bun run test:e2e` (smoke) + `bun run lint`. Layers: lint · component · smoke-e2e.

### Unit L — Bearer redesign + memory hygiene (DEEP) — F-11
**Scope (RESOLVED at approval — option (a), session-only): full fix WITHOUT a storage-version bump or wipe.** The vulnerable bearer (`passhash`) lives only in the ephemeral `Session` record, not the persistent `Profile {guard, secret}` — so the redesign is confined to the session and existing profiles/accounts survive (hard invariant below).
**Reconciled design (both audits):**
1. **Passkey memory hygiene is a code change, not a `finally`:** `Fr` cannot be zeroized (`zeroize.ts:19`). Keep the HKDF master-secret in a wipeable `Uint8Array` and zeroize it *before* it is wrapped into an `Fr` (`passkey-credential.ts:60`); wipe the `fromPassword` passhash scratch (`password-secret-box.ts`).
2. **Bearer redesign is a session-record change, not a value-swap:** replace the password-equivalent unsalted `SHA-256` bearer with a **random token**; store `wrappedSecret = encrypt(masterSecret, token)` in the **session** record and unwrap with the token on `restore()`. Touches the `Session` shape (`profile/spec.ts`), `open()` (`session-manager.ts:202-218`), `restore()` (`:335-413`), the `SessionSecretUnsealer` contract, and `PasswordSecretBox`. **Do NOT touch the AES-GCM/PBKDF2 core** (verified sound).
3. **Strict-mode suppression still applies** to the new token bearer (so E is required and L rebases on E).
4. **NO `CURRENT_VERSION` bump, NO wipe (the no-re-registration invariant).** The `Profile` record `{guard, secret}` (`profile/spec.ts:18-29`) is encrypted via `password → getPasshash → PBKDF2 → AES-GCM` and is **left byte-identical** — the password still decrypts existing profiles. The `passhash` bearer lives ONLY in the ephemeral `Session` (`profile/spec.ts:31-54`, `chrome.storage.session`); old-format sessions are simply invalidated (one re-unlock for non-strict users; default strict mode persists no bearer). So `key-vectors.test.ts` stays **byte-identical** (profile chain untouched); add only a new bearer-mechanism test.

**HARD INVARIANT — L's deep pass PROVES this before any code:** existing profiles/accounts survive the upgrade with zero re-registration. Prove it with an e2e that unlocks a **pre-existing** profile after the change (extend `tests/e2e/.../sw-resilience`). **If** the deep pass finds the profile-encryption chain unavoidably must change (forcing a wipe) → **STOP and surface to the user**; never wipe autonomously.
**Threat property to prove (design artifact + negative tests, Codex-reviewed):** "a session-storage read can restore the session until TTL, but cannot offline-crack the password and cannot unlock after session deletion." (Net gain is no-password-equivalence / no-offline-crack — NOT secret-safe-from-a-session-reader, since token + wrapped secret co-locate; state this explicitly.)
**Open questions for Codex (deep):** random-token vs salted-KDF; exact `Session` field additions + TTL/lock deletion of the token+wrappedSecret; wipe-key set + reseed path; interaction with E's strict-mode suppression; battle-tested Web Crypto primitives only (no custom crypto).
**Gate:** `bun run --filter '@nulo/wallet-crypto' --if-present test` (wipeable-buffer/zeroize + new-bearer tests; **profile vectors UNCHANGED**) + `bun run test` + `bun run typecheck:all` + `bun run lint` + **the no-re-registration e2e** (a **pre-existing** profile unlocks after the change) via `bun run e2e:agent` (also covers unlock/session/restore across an SW restart — `tests/e2e/.../sw-resilience`) + `bun run test:e2e`. Layers: typecheck · lint · unit · no-reg-invariant · network-e2e.

---

## Security & Adversarial Considerations

- **Threat model:** primary adversary = a malicious/compromised connected dApp; secondary = local malware / shared clipboard (F-11, F-14) and tampered local storage / backup files (F-06, F-12). Each unit is checked for *regressing* the boundary it hardens.
- **Do not weaken while fixing:** Unit A must keep the sound `accounts`-scope enforcement and MUST NOT touch the verified-sound authwit signature binding / entrypoint chunking; it must not make scope-checks async or inject PXE into the dispatcher (preserve the FIFO/execution-mutex contract). Unit G must not break legit popup↔SW↔offscreen messaging. Unit L must use only Web Crypto primitives — no custom crypto — and leave AES-GCM/PBKDF2 untouched.
- **Fail closed:** raw-hash + arg rejection (A) key on structure via existing type guards, never primitive-sniffing. Unit I drops/wipes rows it cannot authenticate rather than trusting them.
- **Least privilege / input validation:** A/F-08 is input-validation-at-the-boundary; F tightens CSP; I adds integrity (MAC) to persisted authorization state; keep the manifest free of `externally_connectable` (do not introduce a new reachable surface via G).
- **Supply chain:** no new runtime deps expected; any needed dep goes through the 7-day min-age gate + frozen lockfile — surface it, don't add silently.
- **Every Codex consult prompt** must carry the adversarial + assumption-attack asks.

## Assumptions  *(updated post-audit)*

**Facts** (verified against source):
- All 14 findings + traces verified at `audit/security/2026-07-06-max/findings/verified.md`.
- Real tooling per `package.json`: `lint,typecheck:all,test,test:e2e,e2e:agent,build,build:firefox,test:faucet`; per-package `bun run --filter '@nulo/<pkg>' --if-present test`.
- **F-02 is a 3-sink bug**: `tx-request-builder.ts:294-328`, `:437-452`, `service.ts:657-672`. (Audit-verified.)
- **The contract ABI is NOT reachable at authorization time** — only in execution (`tx-request-builder.ts:127`, `contract-resolver.ts:50`); the scope-checker is a synchronous leaf; the dispatcher has no PXE. → binding lives in execution.
- **Rejecting raw authwit hashes does NOT break the faucet**: faucet passes a structured `CallIntent` (`useWithdraw.ts:230`), the typed SDK forbids raw `Fr` (`base_wallet.d.ts:99`), `FunctionCall.name` survives the wire (`function_call.js:42`). Pure upside.
- **PRs into `fix/harden-findings` get NO GitHub CI** (workflows trigger only on PRs to `main`/`dev`). → local gates per unit; full CI on the promote PR.
- **`Fr` cannot be zeroized** (`zeroize.ts:19`) → Unit L's passkey secret needs a wipeable buffer before Fr-wrapping.
- **Silent restore decrypts the profile secret via the passhash** (`session-manager.ts:387`) → Unit L needs a session-stored `wrappedSecret`, not a value-swap; **Unit E remains required** and E and L both edit `session-manager.ts` (not independent).
- `@nulo/bridge-core` is faucet-only (out of scope). `dev`/`main` protected, squash + required checks (`CLAUDE.md`).

**Inferences** (unverified — attack during execution):
- Wipe-and-reseed of dApp sessions (Unit I) is acceptable UX (users re-approve). *No prod users → low risk; confirm no silent auto-reconnect assumption breaks.*
- The createAuthWit path (`service.ts:657-672`) can resolve `call.to`'s artifact synchronously enough at execution time. *Verify during Unit A's deep pass.*

**Asks** (RESOLVED at approval 2026-07-06):
- **F-11 (Unit L) scope** — ✅ **option (a) full fix, session-only**: NO storage-version bump, NO wipe, NO re-registration (worst case one re-unlock for non-strict users). L's deep pass proves the invariant first + stop-and-surfaces if a profile-chain change proves unavoidable.
- Integration-branch + per-unit-PR-into-it structure ✅ confirmed (unit PRs local-gated, one CI-gated promote PR to `dev`).

## Decision ledger

- **Dual-audit verdicts:** codex `conditional approve`, fable `conditional approve` (`audit-codex.md`, `audit-fable.md`). All conditions folded in; see below. **Final fresh-context codex pass: `approve`** (`audit-codex-final.md`) — prior conditions verified substantively closed; ready to execute after the F-11 scope decision.
- **Unit A binding layer (both audits, code-verified):** moved from the synchronous scope-checker to **execution** (ABI unreachable at authz; making scope-checks async + PXE-in-dispatcher would enlarge the trust surface). Keep the name-based scope check; add execution-layer selector↔name mismatch-reject at **all three** F-02 sinks incl. `createAuthWit` CallIntent. *Rejected:* the scope-checker approach in the original draft.
- **Raw hash vs inner hash (fable):** hard-reject dApp-origin raw `Fr` (not a valid SDK type); **confirm** (not reject) `IntentInnerHash` (avoid capability regression). Reject via existing type guards, fail closed.
- **Unit B scope (both):** display + execution-reject (chosen) over pre-popup PXE artifact resolution (heavier, needs PXE at popup-build). A spoofed approval → execution rejection, so display need not be authoritative; still sanitize + surface `canCreateAuthWit`.
- **G+H merged (codex):** one offscreen-auth-plus-instance-token unit (same files). Sender-auth ≠ instance token — keep both; `sender.id` alone insufficient → also reject `sender.tab` senders.
- **Unit I (both):** wipe-and-reseed existing rows (no migration); MAC key derived from the profile master secret, never stored beside rows; gate with a real reconnect network-e2e (bricking risk).
- **Unit L (both):** real session-record redesign (wrapped-secret), passkey secret in a wipeable buffer before Fr-wrapping; strict-mode suppression retained → **E is a prerequisite of L**. Threat property stated honestly (no password-equivalence / no offline-crack, NOT secret-safe-from-session-reader).
- **CI strategy (codex):** unit PRs into `fix/harden-findings` have no GitHub CI → local gates + one fully-gated promote PR; do not edit workflow triggers.
- **Competing sequencing:** risk-first-with-quick-wins chosen over cheapest-first (don't delay the Critical for momentum) and over pure risk-first (don't block trivial isolated fixes). A→B, then quick wins, MID units, E, L-last.
- **Tier = design-rigor (both approve):** DEEP units A/L produce a pre-code design artifact (invariants + negative tests), Codex-reviewed — not merely advisory notes.
- **F-11 RESOLVED (2026-07-06 approval) = option (a) full fix under the session-only invariant.** Grounded: the vulnerable bearer is the `passhash`, which lives in the ephemeral `Session` record, not the persistent `Profile {guard, secret}` (`profile/spec.ts` — confirmed by reading the code). Confining the redesign to the session leaves profile encryption byte-identical → no `CURRENT_VERSION` bump → no wipe → **no re-registration** (worst case one re-unlock for non-strict users). The deep pass proves the invariant first and stop-and-surfaces if a profile-chain change proves unavoidable, rather than wiping. *Rejected:* the reflexive "bump + wipe" default.
- **Approval verdict (2026-07-06):** user `approve` + F-11 = (a) session-only invariant. Autonomy = fully autonomous to the promote PR; user launches via the `/goal` seed.

## Unit status (source of truth for `/goal`)

A unit is ✓ when its child-branch PR has merged into `fix/harden-findings` with its full local validation gate pasted green in the transcript and a `lessons/phase-<unit>.md` filed.

- [x] A — Dispatcher trust-boundary (F-01, F-02 authz, F-08) — **PR #261 merged**; gate green: audit:vue 2649 · faucet 423 · wallet-bridge 165 · e2e:agent 70/1-skip
- [x] B — Approval-display truthfulness + `canCreateAuthWit` surfacing (F-02 display, F-07, F-01 UI) — **PR #262 merged**; gate green: units 2649 · lint/typecheck 0-err · smoke 69-pass (1 CI-skipped passkey load-flake, unrelated)
- [ ] C — Chain-identity TOCTOU (F-03)
- [ ] D — Discovery-flood rate limit (F-04)
- [ ] E — Backup-restore config allowlist (F-06)  *(prerequisite of L)*
- [ ] F — CSP hardening (F-05)
- [ ] G — Offscreen/messaging sender-auth + Firefox token (F-09, F-10)
- [ ] I — DappSession row integrity (F-12)
- [ ] J — ValueStorage parse containment (F-13)
- [ ] K — Clipboard secret hygiene (F-14)
- [ ] L — Bearer redesign + memory hygiene (F-11)  *(after E; option (a) session-only — no wipe, no re-registration)*
- [ ] PROMOTE — open `fix/harden-findings → dev` PR, full CI green, STOP (user merges)

## Seeds

**Approved 2026-07-06** (F-11 = option (a), session-only). Recommended: **`/goal`** (completion is transcript-observable). Use exactly ONE per session — they don't compose. Start the session in your intended permission mode + AFK authorization so `bun run e2e:agent` and Codex consults don't stall on a prompt.

### `/goal` (recommended)
```
/goal Every unit in implementations-plan/harden-findings-remediation/plan.md is ✓ in the "Unit status" checklist (A,B,C,D,E,F,G,I,J,K,L), each ✓ backed by that unit's validation gate (as defined in plan.md) pasted passing in the transcript and a lessons/phase-<unit>.md filed and printed as LESSONS_FILE=implementations-plan/harden-findings-remediation/lessons/phase-<unit>.md; the two DEEP units (A, L) each logged a Codex-reviewed design artifact BEFORE coding (for L the design MUST first prove the no-re-registration invariant — a pre-existing profile still unlocks after the change — or STOP and surface); `/code-review max --fix` applied + committed separately on fix/harden-findings; a `/codex xhigh` post-impl audit done with high/critical findings addressed; and the PROMOTE item done — a fix/harden-findings → dev PR opened with `gh pr checks` showing quality-status + smoke-e2e-status + network-e2e-status green — then STOP without merging (hard limit: never merge to dev). F-11 = option (a), session-only: NO storage-version bump, NO wipe, NO re-registration (per plan.md Unit L).
```

### `/loop 15m` (fallback — cron-style)
```
/loop 15m Drive implementations-plan/harden-findings-remediation forward; never idle. Each firing: (1) read plan.md — the "Unit status" checklist is authoritative — + lessons/; run git status / git branch --show-current / git log --oneline -5; ensure fix/harden-findings exists (create off dev + commit the plan+audit as the first commit if not). (2) No unit in hand? take the next unresolved unit respecting edges (B after A, L after E, L last); DEEP unit (A/L) → write the design artifact (invariants + negative tests) to lessons/phase-<unit>.md and go back-and-forth with `/codex xhigh` before coding (for L the design MUST first prove the no-re-registration invariant or STOP-and-surface); MID → approach note + one `/codex xhigh` consult; DIRECT/LIGHT → code. (3) Work on a child branch fix/hf-<unit>-<slug> off fix/harden-findings; after each edit run `bun run lint` + the touched package test; commit + push. (4) Stuck or a real decision? `/codex xhigh` with full context, resolve, act, log the consult+verdict in lessons/phase-<unit>.md — hard limits stay hard (never merge to dev/main/release, never publish/deploy, never expand scope beyond plan.md; if a decision needs crossing one, surface and hold). (5) Same step failed 5×? stop; reassess with codex; continue the agreed path. (6) Unit gate green (the FULL local gate in plan.md incl. `bun run e2e:agent` where listed — unit PRs have NO GitHub CI)? paste it, open the unit PR into fix/harden-findings, merge it (integration branch only), tick the unit ✓ in plan.md, file lessons, print LESSONS_FILE=…, advance. (7) All units ✓? `/code-review max --fix` → commit separately → `/codex xhigh` post-impl audit → address high/critical → open the promote PR fix/harden-findings → dev, watch its real CI via `gh pr checks --watch`, STOP without merging, write the wrap-up. Keep the Unit-status checklist visible. F-11 = option (a) session-only (no storage bump / no wipe / no re-registration) per plan.md Unit L.
```
