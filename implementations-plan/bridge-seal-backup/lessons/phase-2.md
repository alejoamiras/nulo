# P2 - faucet export/restore (lessons)

## 2026-06-11 - P2 COMPLETE
- `useBridgeBackup`: trust-aware key derivation (retained same-session key ⇒ 0 sigs; untrusted wallet ⇒ determinism self-test, 2 sigs once, then `markSealTrusted`; trusted ⇒ 1 sig - a non-deterministic signer ABORTS before any file exists); export = seal + object-URL download; restore = parse ladder → deployment/duplicate checks BEFORE any signature → unseal → addRecordVerified (idle card, no auto-claim).
- Surfaces: card ⤓ top-right (unfinished only; done cards keep the ✕; provisional withdraws hide it), stepper ⤓ beside the headline, journal-header RESTORE + hidden picker + empty-state hint; toasts on both paths.
- `getRetainedSealKey` exported from useDeposit (the pre-finalize sealKeys window).
- Gotchas: vi.fn `mockClear` does NOT reset implementations (a non-deterministic mock leaked into later tests - `mockReset` + re-prime in beforeEach); prototype spies (anchor click) leak across tests without `vi.restoreAllMocks`; the journal re-stamps `updatedAt` on restore-write (assert around it).
- Gates: audit:faucet exit=0, audit:vue exit=0. Suites: faucet 264 ✓ smoke 9 ✓ bridge-core 79 ✓.

LESSONS_FILE=implementations-plan/bridge-seal-backup/lessons/phase-2.md

## 2026-06-11 - post-impl close
- Codex post-impl: **approve**, no high/critical. Added its two missing pins same-round (journal RESTORE flow incl. error toast; stepper ⤓ provisional-hide). Documented LOW: cross-tab duplicate TOCTOU between the post-unseal check and the upsert - a fresher same-id record can be overwritten by a restored snapshot (stale-state resurrection only; ids are identity-bound, no fund redirection). Accept for testnet; an insert-only journal write is the fix if it ever matters.
- jsdom gotcha: `Object.defineProperty(input, "files")` needs `configurable: true` to redefine across a test's second pick.
