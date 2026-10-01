# Phase 1 — Relocate PasskeyCeremonyDialog + runPasskeyCeremony

## What changed
- `git mv src/popup/components/popups/PasskeyCeremonyDialog.{vue,test.ts}` → `src/components/passkey/`.
- `git mv src/popup/utils/passkey-ceremony.ts` → `src/wallet/utils/passkey-ceremony.ts` (wallet-coupled: imports `@/wallet/services/passkey/spec`).
- Rewrote imports: 6 dialog importers (popup import/auth/export-full/profile-new + onboarding create/import) → `@/components/passkey/...`; PATH B (`popup/windows/passkey/index.vue`) + the dialog test `vi.mock` → `@/wallet/utils/passkey-ceremony`; the dialog's own util import → `@/wallet/...`.
- Rewrote 3 doc-comment path strings (`passkey/spec.ts`, `passkey/service.ts`, `profile/spec.ts`).
- Deleted the "Used by …" caller enumeration in the dialog header AND the PATH-A/PATH-B file-path enumeration in the util header (CLAUDE.md comment policy); kept the WHY (cancel-path contract, single-source-of-truth-for-WebAuthn rationale).
- PATH B window file did NOT move (its route is pinned by `passkey/service.ts:113` getURL); only its util import line changed. `service.ts:113` untouched.

## Gate result
| Check | Exit | Result |
|---|---|---|
| stale-path grep (`popup/utils/passkey-ceremony`, `popup/components/popups/PasskeyCeremonyDialog`) | — | empty (OK) |
| typecheck | 0 | clean |
| lint | 0 | 42 warnings (baseline, no new) |
| `bunx vitest run` (full) | 0 | 196 files / 2398 tests — **identical to baseline** |
| `bunx vitest run src/components/passkey` | 0 | dialog test 11/11 (now covered by `test:components`) |

## Notes
- Used `perl -pi -e` for the mechanical multi-file import rewrites (verified exact strings first); idempotent — the dialog's own import was already hand-edited so it fell out of the `@/popup/utils` grep set.
- Auto-import (`vite.config` `dirs:["src/components"]`) now also auto-registers the dialog; explicit imports kept (harmless; biome doesn't flag unused in `.vue`). Minimizes diff.

LESSONS_FILE=implementations-plan/profile-flow-dedup-q2/lessons/phase-1.md
