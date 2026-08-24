# Codex audits — export-integrity

Session `01a03417-ff28-7903-a62b-ab6d169cd305`, xhigh, read-only, cwd = this worktree. Dispositions live in plan.md's Decision ledger.

## Round 1 — on revision 1 (Outline A as originally drafted)

Verdict: **reject** (blocking: incomplete error boundary; no active cancellation/secret scrubbing; unsupported and runbook-conflicting caps; contacts choke-point gap; mutable shipped-artifact boundary; tests that do not prove single execution).

### Adversarial / security
- Hostile file targets decompression, JSON memory amplification, deep/large slice structures, expensive downstream restore. A 64 MiB JSON can consume several times that after `text()`, parse, copies — unsafe for a popup.
- SHA-256 checksum attacker-recomputable for plaintext backups — accidental-corruption detection only; wording must not imply authentication. Encrypted backups use AES-GCM but lack domain-separated AAD.
- "No new dependency" ≠ least privilege: popup's trusted surface includes 12 client instances + serializers + crypto + download code while holding master key/entropy/DEK/password material. Popup XSS or a compromised existing dep gets the wallet.
- Plan (rev 1) didn't scrub `backup`/passwords on unmount and declined to disconnect the active RPC — plaintext could remain captured until timeout.
- Contacts remained gzip-bomb reachable: `accept=".json"` is UI guidance, not a boundary; `pickFile` auto-decompresses before the caller's cap.

### Assumption attack
- Facts: recon's "11-client" count wrong — the array has 12 entries (`full.vue:64`). Vitest env is jsdom (stream globals may leak through Node 24 — runner-dependent). "Contacts already capped" only true post-`pickFile`. Client reconnect after disconnect is source-backed (not an inference) — but the proposed mocked retry test couldn't verify it. Rev 1 silently deviated from the runbook (status-before-crypto; 64 KiB precedent; one checksum/download snapshot).
- Inferences: 64 MiB/1 MiB caps had no measurement basis; 64 MiB dangerously high after amplification; dropping in-loop disconnects lengthens key-bearing port lifetimes; gen fence limits new slices but doesn't cancel the current RPC ("abandonment safe" overstated); mocked streams would weaken the bomb-test proof.
- Asks: measured legitimate sizes; abort-and-scrub vs suppress-late-writes; authorization for runbook deviations; whether contacts + AAD hardening are explicitly deferred.

### Implementation critique
- Outline A smaller but the page is an oversized security orchestrator — extract a narrow injected `assembleFullBackup()` returning immutable serialized text (not necessarily full Outline B); per-run client construction avoids reconnect assumptions and makes tests cheap.
- Generation fence is a commit fence, not teardown — track active clients, disconnect on unmount, stale-check catches, scrub secrets.
- Publishing after checksum correct, but retaining a mutable object/type-union for encrypt/download is not — store immutable strings, snapshot synchronously in guarded handlers.
- Catch must cover checksum generation too (loop-only catch can still strand `"progress"`).
- Caps belong in `pickFile` AND domain readers; use post-inflate check; `FileTooLargeError` must `reject(err); return` — a throw inside the async `onchange` leaves the outer promise pending.
- Component mock surface brittle; e2e second click can't fire through the enabled-only helper once the latch disables the button; "one download" doesn't prove one assembly — assert ceremony/KDF and all 12 backup-call counts in controlled tests.

## Round 2 — resumed, on revision 2

Verdict: **conditional approve** (with conditions:)
1. Generation checks immediately after EVERY awaited ceremony/KDF/profile call and after `await assembleFullBackup`, before publishing payload strings or UI state; probe before the first slice and after checksum generation — else unmount during KDF/hash can still start clients or republish scrubbed secrets.
2. Teardown non-throwing and exhaustive: shared `disconnectAll()` catches per-client failures so one bad disconnect can't block remaining disconnects, scrubbing, listener removal, or `activeRunClients = null`.
3. Decompression producer promises must settle when the reader is cancelled (piped input stream, or explicitly settle `writer.write()`/`close()`); test proves over-cap cancellation produces ONLY `FileTooLargeError`, no unhandled rejection.
4. Remove the e2e card-persists assertion (flaky when assembly finishes concurrently); component call-count test proves non-reentry; e2e only injects Enter and verifies the round-trip.

All four adopted in plan revision 3 (ledger).

## Final fresh-context pass — session `01a03428-6572-7eb2-960c-1e2b7ec88ae2` (NEW session, no prior context)

Verdict: **conditional approve** (with conditions: enforce and test an export/import size invariant; make assembly an exact canonical snapshot; latch and generation-fence encryption and all nested error paths; make the e2e re-entry poke atomic). All four adopted in plan revision 4 — GATE PASSED (approval delegated per the goal contract).

Key findings beyond the conditions:
- Largest missed issue across prior rounds: export had no matching size invariant — a spam-inflated wallet could export >16 MiB pretty/base64 that its own importer then rejects (a NEW self-rejecting class introduced by the remediation). → export-side gate + shared constant + drift-pin test.
- Attacker maximizes object count/depth within the cap; the 3–6× JSON amplification figure is unsupported (could be worse with tiny objects + restore work). Cap still bounds decompression; residual accepted.
- `assembleFullBackup` (as then specified) trusted callers not to supply `checksum` and trusted object graphs to stay stable during the async hash → "single snapshot by construction" wasn't yet true. → serialize-once/hash/parse/derive + reject incoming checksum.
- `handleEncrypt` lacked latch + gen fencing (two clicks before Vue disables the CTA; navigation scrubs globals while the old handler later publishes). → same discipline as creation.
- Assumption corrections: "no asks open" was wrong (16 MiB unvalidated — now fails loud at export, telemetry revisit noted); the smoke-race inference was false across separate driver commands (→ atomic single-evaluate poke); "secrets must not outlive the page" overstates JS scrubbing (best-effort — in-flight closures + GC remain; accepted as best-effort); "auto-reconnect" is lazy-on-next-request, not immediate (moot with per-run clients).
- Shape endorsement: pure assembler + page orchestration + per-run clients + typed cap errors "appropriate and smaller than a composable rewrite"; ledger's card-wait supersession explicitly done, not silent; options-object rejection defensible.

## Cap recalibration (resumed final-pass session, post-implementation)

Prompted by e2e measurement (fresh-wallet encrypted artifact = 23,443,420 B ≈ 22.4 MiB; the 16 MiB cap fired on legitimate backups — loud at export, per the invariant's design). Question: MAX_BACKUP_FILE_BYTES = 64 MiB. Verdict: **approve** — "justified by the measured 23.4 MiB fresh-wallet artifact and the shared export/import invariant. A 32 MiB cap leaves inadequate growth margin, while 64 MiB still converts an unbounded decompression surface into a finite one and guarantees oversized legitimate backups fail loudly during export. The 2–4× parse-amplification estimate should remain documented as an estimate, not a proven ceiling." (Documented in the constant's docblock.)

## Post-implementation audit — session `01a034d9-0c55-7473-a35b-2474736a3677` (fresh)

Package: net diff `ea9be876..HEAD` + the code-review commit as a distinct artifact + plan/ledger + the no-over-engineering rule.

**Round 1: conditional approve** (conditions: fence stale decrypt publication; add generation/probe checks between every sensitive await). Findings: (M) the code-review commit's selection-clear opened a stale-decrypt publication race in `decryptBackup` (superseded run could resurrect a selection husk from `{...null}` and wipe the too-large error); (M) work-abandonment fence gaps — credential→ceremony, exportPlain→sealed-DEK, each encrypt KDF step, assembler post-hash derive; (L) Protect CTA enabled-but-inert during download. Verified-correct notes: checksum contract a fixed point end-to-end; all publication fences present; disconnect idempotent; pickFile onchange settles exactly once. Attacker focus: crafted files at the 64 MiB boundary (bounded, not cheap); checksum correctly not treated as authentication.

**Round 2 (resumed, on the fix commit): approve** — "All three conditions are correctly resolved… No new material bugs or regressions found in the fix commit." Loop converged (1 fix round). This approve, given on the final HEAD, doubles as the pre-merge diff sign-off required by the autonomy contract.
