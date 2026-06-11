# P2 - faucet export/restore (lessons)

## 2026-06-11 - P2 COMPLETE
- `useBridgeBackup`: trust-aware key derivation (retained same-session key ⇒ 0 sigs; untrusted wallet ⇒ determinism self-test, 2 sigs once, then `markSealTrusted`; trusted ⇒ 1 sig - a non-deterministic signer ABORTS before any file exists); export = seal + object-URL download; restore = parse ladder → deployment/duplicate checks BEFORE any signature → unseal → addRecordVerified (idle card, no auto-claim).
- Surfaces: card ⤓ top-right (unfinished only; done cards keep the ✕; provisional withdraws hide it), stepper ⤓ beside the headline, journal-header RESTORE + hidden picker + empty-state hint; toasts on both paths.
- `getRetainedSealKey` exported from useDeposit (the pre-finalize sealKeys window).
- Gotchas: vi.fn `mockClear` does NOT reset implementations (a non-deterministic mock leaked into later tests - `mockReset` + re-prime in beforeEach); prototype spies (anchor click) leak across tests without `vi.restoreAllMocks`; the journal re-stamps `updatedAt` on restore-write (assert around it).
- Gates: audit:faucet exit=0, audit:vue exit=0. Suites: faucet 264 ✓ smoke 9 ✓ bridge-core 79 ✓.

LESSONS_FILE=implementations-plan/bridge-seal-backup/lessons/phase-2.md
