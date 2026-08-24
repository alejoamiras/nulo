# export-integrity — batch 1 of audit-448-remediation

Fixes **N-01 (Critical)** — the full-backup export page has no re-entry latch, no error boundary, and a stale-checksum window — and **N-13** — backup/account file readers lack size caps (decompression-bomb surface). Spec: `implementations-plan/audit-448-remediation/runbook.md`; verdicts: `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; recon: [recon.md](./recon.md); audits: [audit-codex.md](./audit-codex.md), [audit-fable.md](./audit-fable.md). Base: dev `ea9be876`. Tier: **mid** (rubric: security-sensitivity HIGH; 1 high → mid). Revision 2 (post round-1 dual audit).

**Success criterion:** a user can no longer produce a self-rejecting backup or a stranded export screen by any combination of clicks/Enter/navigation (password AND passkey profiles); a mis-picked huge or gzip-bomb file is rejected with clear copy instead of crashing the popup, on every `pickFile` flow; preserved behavior pinned by tests; `bun run audit:vue` + `bun run test:e2e` green; PR squash-merged to dev.

**Scope:** N-01 + N-13 per the runbook, plus ONE codex-raised in-scope-adjacent line: the contacts `pickFile` call site passes its existing cap (closes the same bomb class through the same new plumbing). OUT: import-side refactors, `seed.vue`'s missing latch, backup-format crypto changes (AAD/domain separation — explicitly deferred, see ledger), UI redesign.

**eli5_mode:** Artifact — published at https://claude.ai/code/artifact/00f1880f-7df2-4e0c-8633-bb91afab7a3d (source: `implementations-plan/export-integrity/eli5.html`).

---

## Architecture & Implementation

### N-01 — chosen shape (revised): thin extraction + in-place latch (middle path between Outlines A and B, converged by both auditors)

**New pure assembly function** — `assembleFullBackup` in `apps/extension/src/utils/full-backup-helpers.ts` (the file's charter — "no vue, no chrome.*, no service clients" — holds: it receives duck-typed sources, imports nothing service-shaped):

```ts
export type BackupSource = { name: string; backup: () => Promise<unknown> }
export async function assembleFullBackup(
  envelope: Record<string, unknown>,       // all top-level fields, checksum absent
  sources: BackupSource[],
  onSlice?: (i: number) => boolean,        // gen-fence probe: return false → abort (AssemblyAbortedError)
): Promise<{ compact: string; pretty: string; checksum: string }>
```

Rejects an `envelope` that already carries a `checksum` key (throw — callers must not forge it). Builds a LOCAL draft `{...envelope, data:{}}`, awaits each source in order (skipping null/undefined results), consults `onSlice` between slices, then seals via an **exact canonical snapshot** (codex final-pass): `const unsigned = JSON.stringify(draft)` ONCE → `checksum = getHashHex(unsigned)` → `const sealed = JSON.parse(unsigned); sealed.checksum = checksum` → `compact = JSON.stringify(sealed)`, `pretty = JSON.stringify(sealed, null, 2)`. Hashing and both outputs derive from the SAME serialized bytes, so a caller mutating its envelope/slice object graphs mid-hash cannot skew the artifact. Nothing mutable escapes — the import contract (strip-`checksum` → compact restringify → SHA-256, `useFullBackupImport.ts:117,126`) is satisfied by construction, and the function is unit-testable against 12 fakes with zero mounting (resolves fable's "12-module mock wall" + codex's "prove single execution via call counts").

**`full.vue` changes** (all in place; SFC ordering + testids verbatim):

1. **State**: `const isBusy = ref(false)`, `const isDownloading = ref(false)`, `let generation = 0`, `let activeRunClients: { disconnect(): void }[] | null = null`, and three payload holders replacing the mutable `backup` object: `let payloadPretty = null`, `let payloadCompact = null`, `let encryptedB64 = null` (immutable strings once set — codex's shipped-artifact boundary).
2. **`handleBackup`**: sync prefix `if (isBusy.value) return; isBusy.value = true; const gen = generation;` then `backupStatus.value = "progress"` — flipped BEFORE the ceremony/KDF awaits (runbook-literal; the status card now covers the 0.5–3 s KDF gap too). Whole body in `try/catch/finally`:
   - Passkey ceremony + `exportPlain`/`exportBackupMaterial` inside the try; their existing per-branch catches keep their semantics but now also reset `backupStatus = ""` (and the wrong-password path re-renders the unlock form as today).
   - **Gen check after EVERY await** (codex R2): after the ceremony, after each export/KDF call, and after `await assembleFullBackup` — `if (gen !== generation) return` BEFORE constructing clients or publishing anything. Unmount during KDF/hash can neither start clients nor republish scrubbed secrets.
   - **Per-run clients**: construct the 12 `{name, client}` pairs INSIDE the run (moved from setup scope, only reached gen-checked), register `activeRunClients = clients`, call `assembleFullBackup(envelope, sources, () => gen === generation)` (probe consulted before the FIRST slice too).
   - Success (gen-checked): `payloadCompact/pretty = result…; backupStatus = "finished"; showRecommendation = true`.
   - **catch** (covers ceremony, KDF, slices, AND checksum — codex): if `gen !== generation` → silent return (unmounted; no writes). `UserRejectedError` keeps its `isAgreed=false` reset. Otherwise `backupStatus = ""`, **`if (isPasskeyProfile.value) isAgreed.value = false`** (fable HIGH — otherwise passkey profiles land on a blank page), toast `"Failed to create the backup"` (LONG), `console.error`.
   - **finally**: `disconnectAll(clients)` — a small local helper that try/catches EACH `disconnect()` so one bad client cannot block the rest of teardown (codex R2) — then `activeRunClients = null`, `if (gen === generation) isBusy.value = false`. `onBeforeUnmount` uses the same helper for the same reason.
3. **`handleEncrypt`**: same discipline as creation (codex final-pass) — `if (isBusy.value) return; isBusy.value = true; const gen = generation`, snapshot `payloadCompact` synchronously, gen-check after the KDF/encrypt awaits before ANY write; success stores `encryptedB64` + `"encrypted"`; error reverts to `"finished"`; stale (gen-mismatched) success/error writes suppressed; `finally` releases the latch gen-checked.
4. **`handleDownloadBackup`**: `isDownloading` latch (account.vue `:182-197` shape) + gen check after the download await; content = `encryptedB64 ?? payloadPretty` — both derived from the one sealed snapshot.
4b. **Export-side size invariant** (codex final-pass — prevents a NEW self-rejecting class): after assembly, `if (pretty.length > MAX_BACKUP_FILE_BYTES)` → treat as failure (status `""`, explicit toast "Backup is too large to create — contact support/export accounts individually") instead of shipping a file the importer would reject; same check on `encryptedB64.length` post-encrypt. The constant is IMPORTED from `full-backup-helpers.ts` on both sides; a unit test pins export-gate == import-gate so they cannot drift. (Realistically unreachable pre-production; the gate turns a silent latent failure into a loud immediate one.)
5. **`onKeydown`**: explicit cases — `""` → `handleBackup()`; `"finished"` → `handleEncrypt()`; `"encrypted"` → `handleDownloadBackup()`; **`default` (covers `"progress"`/`"encrypting"`) → no-op** (fable: keep a default arm; do NOT add a `!password` guard — it breaks the passkey auto-fire at `:97`).
6. **CTA guards**: `unlock-submit-btn` `:disabled="!password || isWrongPassword || isBusy"`; `download-backup-btn` gains `|| isDownloading`.
7. **`onBeforeUnmount`** (cleanup-order rule: services first): `generation++`; `for (c of activeRunClients ?? []) c.disconnect()` — actively rejects the in-flight RPC so the run unwinds NOW, not at the 60 s timeout (codex); **scrub** `payloadPretty = payloadCompact = encryptedB64 = null; password.value = null; repeatedPassword.value = null` (fable/codex — account.vue `:209-216` precedent; the plaintext master-key/entropy/DEK strings must not outlive the page); then the existing keydown-listener removal.

### N-13 — byte caps at the real choke points

1. **`apps/extension/src/utils/files.ts`**:
   - `export class FileTooLargeError extends Error { constructor(public limitBytes: number) … }`.
   - `decompressData(data, format, maxBytes?)`: replace the one-shot drain with a `getReader()` loop + running total; over cap → `await reader.cancel(); throw new FileTooLargeError(maxBytes)`; belt: assert final blob size ≤ cap. No `maxBytes` → unchanged. **Producer promises must settle on cancellation** (codex R2): feed the input via `blob.stream().pipeThrough(ds)` (or explicitly await/catch `writer.write()`/`close()`), so an over-cap cancel yields ONLY `FileTooLargeError` — a test pins "no unhandled rejection" on that path.
   - `pickFile(accept?, delay?, autoDecompress?, maxBytes?)` (4th positional — options-object conversion rejected as churn on 3 call sites; ledger): (a) after file obtained: `if (maxBytes && file.size > maxBytes) { reject(new FileTooLargeError(maxBytes)); return }` — **explicit reject-and-return inside the async `onchange` callback; a `throw` there would leave the outer Promise pending forever** (codex); (b) thread `maxBytes` to `decompressData`; (c) decompress catch: `if (err instanceof FileTooLargeError) { reject(err); return }` — everything else keeps warn-and-fallback.
2. **`full-backup-helpers.ts`**: `export const MAX_BACKUP_FILE_BYTES = 16 * 1024 * 1024` (16 MiB — revised down from 64 MiB after codex's memory-amplification attack: JSON parse multiplies ~3–6×, so 16 MiB bounds worst-case parse well under the popup-crash band while sitting ≥10× above any plausible real backup); `readBackupFile` pre-checks `file.size` → parseError `"Backup File Too Large"` / `"The backup file is too large to import. Please select a correct backup file."` through the existing parseError channel.
3. **Wiring + surfacing** (fable conditions 2): `useProfileImportFlow.ts` injects `() => pickFile(undefined, false, true, MAX_BACKUP_FILE_BYTES)` AND its wrapper catches `FileTooLargeError` → `fillError("full_backup", "Backup File Too Large", …)` → returns undefined (flow exits via the existing `if (!file) return`); `settings/accounts/import.vue` passes `MAX_ACCOUNT_FILE_BYTES = 256 * 1024` (coarse pre-read gate; the authoritative 64 KiB STRING-length check at `account/service.ts:660` is untouched — 256 KiB covers worst-case UTF-8-bytes-vs-UTF-16-units skew ×4) and its currently-bare `catch {}` gains `instanceof FileTooLargeError → error.value = "Account file is too large."`; **contacts** call site passes its existing `MAX_CONTACT_IMPORT_BYTES` as `maxBytes` (codex: `.json` accept is UI guidance, not a boundary — one line, existing constant, existing toast already covers the caller-side path).

### Data & control flow (critical path after fix)

Create: click/Enter → latch + `"progress"` (sync) → ceremony/KDF → per-run clients constructed → `assembleFullBackup` (gen-probed between slices) → immutable `{compact, pretty, checksum}` → publish strings → `"finished"`. Any throw anywhere → gen-checked catch → status `""` (+ `isAgreed=false` on passkey) + toast; finally disconnects the run's clients. Unmount → gen++ + active disconnect (in-flight RPC rejects, run unwinds through the same catch silently) + secret scrub.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/utils/full-backup-helpers.ts` | `assembleFullBackup` + `BackupSource` + `MAX_BACKUP_FILE_BYTES` + `readBackupFile` size gate |
| `apps/extension/src/utils/full-backup-helpers.test.ts` | assembly tests (single-execution call counts on 12 fakes, checksum ↔ import-recompute round-trip, onSlice abort, null-slice skip) + size-gate cases |
| `apps/extension/src/popup/pages/settings/security/export/full.vue` | latch + status-first flip + per-run clients + immutable payloads + widened catch + keydown cases + CTA guards + unmount disconnect/scrub |
| `apps/extension/src/popup/pages/settings/security/export/full.test.ts` | NEW: latch/keydown/UI-state/scrub/unmount-disconnect (assembly + clients mocked thin) |
| `apps/extension/src/utils/files.ts` | `FileTooLargeError`, chunk-capped `decompressData`, `maxBytes` in `pickFile` with explicit rejects |
| `apps/extension/src/utils/files.test.ts` | cap tests (node-env pragma file if jsdom lacks streams — no mocks) |
| `apps/extension/src/composables/useProfileImportFlow.ts` | capped injection + `FileTooLargeError` → `fillError` |
| `apps/extension/src/popup/pages/settings/accounts/import.vue` | capped call + `instanceof` branch in the bare catch |
| `apps/extension/src/popup/components/modules/settings/contacts/useContactImportExport.ts` | pass `MAX_CONTACT_IMPORT_BYTES` to `pickFile` |
| `apps/extension/tests/e2e/backup-roundtrip.test.ts` | synchronized double-Enter poke (see Phase 3) |

### Algorithms / non-obvious mechanics

- Chunk-capped inflate: reader loop, `total += value.byteLength`, over-cap → `cancel()` + typed throw; chunks → `new Blob(chunks)`.
- Checksum-by-construction: `checksum` set last on the local draft; both output strings derived after; import's strip-and-recompute reproduces the compact string exactly (key insertion order preserved through parse→stringify; whitespace discarded).
- Gen probe (`onSlice`) bounds abandoned work to ≤1 in-flight RPC; unmount's active disconnect collapses even that to immediate rejection.

### Trade-offs & alternatives not taken

- **Outline B (full `useFullBackupExport` composable)**: rejected — the middle path captures its testability without the module/wiring churn; page stays the L6 orchestrator.
- **Pure Outline A (everything inline)**: superseded — both auditors independently showed its test cost (12-module mock wall) and weaker single-execution proof.
- Options-object `pickFile` signature (codex suggestion): rejected — 3 call sites, positional 4th is the smallest diff; revisit if a 5th param ever appears.
- Compact-only download: rejected (recon-proven checksum-neutral; pretty is the shipped UX pinned by e2e).
- Route-leave/`beforeunload` guard: rejected (repo has none by design; unmount fence + active disconnect + scrub make abandonment safe instead).
- AAD/domain-separated backup encryption, authenticated backup format: **explicitly deferred** — crypto-format change, never-migratable class per CLAUDE.md; out of this remediation's scope.
- Contacts flow beyond the one cap line: deferred (already caller-capped; parser double-checks).

## Security & Adversarial Considerations

- **Threat model**: (1) integrity of the user's own backup artifact (N-01 checksum window — closed by construction); (2) hostile/mis-picked files → decompression bomb / JSON memory amplification (bounded at 16 MiB pre-parse; residual: a legitimate-looking 16 MiB JSON still parses in-popup — accepted, ~10× under the crash band); (3) plaintext master-key/entropy/DEK in page memory — now scrubbed on unmount and never parked in a wedged page; same trust domain as the unlocked wallet otherwise (popup XSS = game over regardless — no new surface added, copy is static strings).
- **Crypto**: no new crypto; SHA-256 checksum stays accidental-integrity ONLY (attacker-recomputable on plain backups — wording in code comments must not imply authentication); AES-GCM encrypted path untouched.
- **Input validation**: caps at the trust boundary BEFORE unbounded materialization; typed error prevents the swallow-fallback from reclassifying a bomb as a plain file; all three `pickFile` flows covered.
- **Least privilege / supply chain**: no new deps, no workflow/token changes.

## Assumptions

**Facts (verified; recon.md + audit cites):** import checksum contract (`useFullBackupImport.ts:117,126`); pretty/gzip checksum-neutral; `backupServices` has **12** entries (`full.vue:64-82` — recon's "11" corrected by codex); keydown default-arm re-entry (`:245-259`); unguarded CTA (`:437-444`); bare slice loop (`:193-198`); decompress-inside-pickFile unbounded + swallow-fallback (`files.ts:79-123,249-273,111-114`); clients auto-reconnect after `disconnect()` (`packages/extension-messaging/src/background/client.ts:101-121` — promoted from inference by fable; moot for the run path now that clients are per-run, still relevant for retry); passkey template renders nothing when `isAgreed && !backupStatus` (`full.vue:300,313,437,447` — fable); unit env is **jsdom** (`apps/extension/vitest.config.ts:27`); contacts `.json` accept is not a decompress boundary (name-based format detection, `files.ts:97`); required smoke spec drives this page (`tests/e2e/backup-roundtrip.test.ts`).
**Inferences (attack these):** (1) Web streams (`CompressionStream`/`DecompressionStream`) reach jsdom tests via Node ≥18 globals leak-through — if not, the cap test file carries `// @vitest-environment node` (real streams, no mocks; codex's "don't mock" adopted). (2) 16 MiB / 256 KiB caps: no measured corpus exists pre-production; derived from amplification math + precedent ratios; revisit post-launch with telemetry. (3) Constructing 12 client objects per run is negligible overhead (plain objects + lazy ports). (4) The smoke spec's button-transition polls are insensitive to the status-first flip (the card appears earlier; the polls key on `protect-password-btn`/`download-backup-btn` which appear at the same states as before).
**Asks:** none open — scope/tier/gates pre-authorized by the goal + runbook; runbook-fidelity interpretations and the one adjacent line are logged in the ledger for codex round-2 ratification (the contract's decision mechanism).

## Phases

### Phase 1 — N-01: assembly extraction + page hardening
Implement §N-01. Tests: `full-backup-helpers.test.ts` — assembly calls each of 12 fakes exactly once (single-execution proof), checksum verifies via the import-side recompute (strip checksum → compact stringify → `getHashHex`), canonical-snapshot immunity (mutating the envelope/slice objects AFTER the sources resolve does not change the outputs), envelope carrying a `checksum` key → throws, `onSlice` false → typed abort + no further source calls, null/undefined slices skipped, envelope `undefined` fields dropped; `full.test.ts` — second click/Enter during busy is a no-op (assembly called once), Enter during `"progress"`/`"encrypting"` no-ops, assembly rejection → status `""` + toast + (passkey) `isAgreed` reset, unmount mid-run → clients disconnected + payload/password scrubbed, double-`handleEncrypt` is a no-op (latch) + stale encrypt writes suppressed after gen bump, oversized assembly output → failure toast not a download (export-side gate), checksum pinned via mocked-`downloadFile` capture (parse pretty payload → strip → recompute — fable condition 3). Shared-constant drift pin: export gate and import gate reference the SAME `MAX_BACKUP_FILE_BYTES` export.
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test apps/extension/src/utils/full-backup-helpers.test.ts apps/extension/src/popup/pages/settings/security/export/full.test.ts`. Pass: exit 0, new cases green. Layers: lint/typecheck + unit/component.

### Phase 2 — N-13: caps at the choke points
Implement §N-13. Tests: `files.test.ts` (or `files.caps.test.ts` with node-env pragma) — compressed-input pre-cap rejects; chunk cap rejects a real gzip bomb (tiny input inflating past a small test cap) with `FileTooLargeError` REJECTED not swallowed; uncapped path byte-identical behavior; `full-backup-helpers.test.ts` — oversized `file.size` → `"Backup File Too Large"` parseError, at-limit passes.
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test apps/extension/src/utils/files.test.ts apps/extension/src/utils/full-backup-helpers.test.ts`. Pass: exit 0. Layers: lint/typecheck + unit.

### Phase 3 — integration proof
Extend `backup-roundtrip.test.ts`: the create-click AND two synthetic Enter keydowns execute inside ONE `page.evaluate` task (codex final-pass — separate driver commands are not atomic; in one JS task the click handler's synchronous `"progress"` flip has run before the Enters dispatch, so both land in the keydown no-op arm deterministically). Then the existing flow proceeds unchanged; the import round-trip passing is the UI-level checksum-integrity pin; one-download capture kept as a secondary. Single-execution proof is owned by the component call-count test. Then the full battery.
**Validation gate** — commands: `bun run audit:vue && bun run test:e2e`. Pass: both exit 0. Layers: all except network e2e (not warranted — no dApp/PXE surface).

## Post-implementation (self-contained — the implementing session runs THIS, in order)

1. Run `/code-review max --fix` on the implementation diff. Skim applied fixes; commit them SEPARATELY from implementation commits.
2. Codex post-impl audit (`/codex xhigh`, fresh session): send the net diff from `ea9be876`, a summary of code-review commits, this plan.md + decision ledger, the adversarial/security ask, and this rule verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. Iterative fix loop: verify codex's factual claims against the repo first; apply accepted fixes; commit; log the round in `lessons/`; RESUME the same codex session with the fix diff; repeat until a round yields no new material findings. Still churning after 3 rounds → park the batch per the runbook.
4. Delivery per below; after checks are green and codex has signed off on the final diff, squash-merge per the runbook (`gh pr merge --squash --delete-branch`; never `--admin`).

## Delivery

**Single arc, one PR** to dev from `worktree-export-integrity`: `fix(export): full-backup re-entry latch + error boundary + file-size caps` (77 chars). No stack. Squash-merge after green + codex diff sign-off, per the autonomy contract.

## Decision ledger

| Decision | Source | Disposition |
|---|---|---|
| Middle-path shape: `assembleFullBackup` extraction + in-place latch (not pure A, not full B) | codex R1 + fable R1 (converged independently) | **adopted** — testability without composable churn |
| Status flips to `"progress"` before ceremony/KDF | codex R1 (runbook-fidelity) | **adopted** — also covers the KDF gap with the status card |
| Widened catch incl. checksum generation; gen-checked writes | codex R1 | **adopted** |
| Passkey catch resets `isAgreed` (blank-page dead-end) | fable R1 HIGH | **adopted** |
| Unmount: active disconnect of run clients + secret scrub | codex R1 + fable R1 | **adopted** (cleanup-order rule respected) |
| Immutable payload strings replace mutable `backup` holder | codex R1 | **adopted** |
| Per-run client construction | codex R1 | **adopted** — kills reconnect assumption, isolates runs |
| `FileTooLargeError` explicit `reject(err); return` in onchange; instanceof branches at both import call sites | codex R1 + fable R1 | **adopted** |
| Contacts call site passes existing cap (1 line) | codex R1 | **adopted** as in-scope-adjacent (goal contract: codex-agreed + logged) |
| Caps 64 MiB→**16 MiB** backup; 1 MiB→**256 KiB** account pre-cap | codex R1 (amplification attack) | **adopted**; values re-derived, post-launch telemetry revisit noted |
| Cap tests: real streams via node-env pragma, never mocks | codex R1 | **adopted** |
| Test 1(e) via `downloadFile` capture | fable R1 | **adopted** |
| E2E poke synchronized on `backup-status-card`, Enter-based | fable R1 + codex R1 | **adopted** |
| Options-object `pickFile` signature | codex R1 | **rejected** — churn on 3 call sites; positional 4th is smaller |
| AAD/authenticated backup format | codex R1 | **rejected for this batch, explicitly deferred** — crypto-format change is the never-migratable class (CLAUDE.md); separate owner-level decision |
| "1 MiB contradicts 64 KiB precedent" | codex R1 | **partially adopted** — pre-cap is a coarse byte gate over a UTF-16 string-length check; 256 KiB aligns them (×4 skew bound) |
| `!password` guard in `handleBackup` | (would-be A port) | **rejected** — fable: breaks passkey auto-fire |
| Runbook-fidelity interpretations: single-snapshot satisfied via one-draft-two-derivations (pretty download retained); "64KB precedent" read as pattern-precedent not value; status-first now literal | self + codex R1 | logged for R2 ratification |

| Gen check after EVERY await (not just between slices) | codex R2 c1 | **adopted** |
| Non-throwing per-client `disconnectAll` | codex R2 c2 | **adopted** |
| Settle decompress producer promises on cancel + no-unhandled-rejection test | codex R2 c3 | **adopted** (pipeThrough form) |
| E2E: immediate double-Enter after click, drop card-persist assertion | codex R2 c4 | **adopted — supersedes** fable's wait-for-card + persist (flaky on fast assembly; sync status flip makes immediate-Enter deterministic) |
| Export/import size invariant: export-side gate + shared constant + drift-pin test | codex final-pass c1 | **adopted** — kills the new self-rejecting class the cap could have created; "16 MiB unvalidated" residual now fails LOUD at export, telemetry revisit post-launch |
| Assembly seals via exact canonical snapshot (serialize once → hash → parse → derive both outputs); reject incoming `checksum` key | codex final-pass c2 | **adopted** |
| `handleEncrypt` (+download) get latch + gen discipline; stale writes suppressed on all nested paths | codex final-pass c3 | **adopted** |
| E2E poke atomic: click + 2×Enter in ONE `page.evaluate` | codex final-pass c4 | **adopted** — replaces "immediate after click" (driver commands aren't atomic) |

Unresolved disputes: none carried — every R1/R2/final item is adopted, deferred-with-reason, or rejected-with-reason above.

## Audit verdicts

- Codex round 1 (session `01a03417-ff28-7903-a62b-ab6d169cd305`): **reject** — blocking findings: incomplete error boundary; no cancellation/scrub; unsupported caps; contacts gap; mutable artifact boundary; weak single-execution proof. All addressed in revision 2 (ledger).
- Fable round 1: **conditional approve** (5 conditions) — all five adopted (ledger).
- Codex round 2 (resumed, on revision 2): **conditional approve** (4 conditions) — all four adopted (ledger; revision 3 folds them in).
- Final fresh-context codex pass (session `01a03428-6572-7eb2-960c-1e2b7ec88ae2`): **conditional approve** (4 conditions: export/import size invariant; exact canonical snapshot; encrypt latch+fence; atomic e2e poke) — all four adopted (revision 4). **GATE PASSED** — approval delegated to this verdict per the goal contract; conditions are implementation-level and folded into the phases.

## Seeds

Not used by the active pipeline run (the parent `/goal` governs it). For a standalone re-run of THIS plan only:

```
/goal All 3 phases marked ✓ in implementations-plan/export-integrity/plan.md, each ✓ backed by its validation gate reported passing in the transcript; /code-review max --fix applied+committed; codex post-impl loop converged (quoted); PR to dev green (gh pr checks output in transcript); bun run audit:vue and bun run test:e2e both exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/export-integrity forward per plan.md. Reality-check plan.md + lessons/ + git status first; pick the next pending phase step; validate with the phase's gate commands after each meaningful edit; mark ✓ only when the written gate passes; decisions via /codex xhigh (never idle waiting for the user); log consults in lessons/; after all phases ✓ run the plan's Post-implementation section verbatim.
```
