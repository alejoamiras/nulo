# Phase 2 — Thread the name + wire the formatter

## What shipped
Threaded the profile `name` from both create entry points down to the single WebAuthn builder, and set `user.name` = `user.displayName` = `formatPasskeyUserName(name, id)`.

Touched (production):
- `spec.ts` — `PasskeyRequest.create` gained required `name: string`.
- `passkey-ceremony.ts` — `buildCreateOptions(userHandle, name)` uses the formatter; `runCreate` / `runPasskeyCeremony` forward `request.name`.
- `create-passkey-profile.ts` — PATH A passes `name`.
- `service.ts` (`acquireRecovery` create-variant + call site), `passkey-recovery-coordinator.ts` (`createForNewProfile(id, name)`), `passkey/service.ts` (`createKey(id, name)`) — the PATH B chain codex flagged.

New test: `passkey-ceremony.test.ts` — label assertions + a regression guard that the PRF eval input, challenge size, `rp`, `pubKeyCredParams`, `user.id`, and `authenticatorSelection` are byte-identical to the pre-change shape.

## What the "required field" bought us
Making `name` required turned the typechecker into the completeness check. `vue-tsc` flagged **exactly** the sites that needed it — and they were **all test fixtures** (PasskeyCeremonyDialog.test, usePasskeyCeremony.test, passkey-recovery-coordinator.test). **Zero production misses** — confirms the threading reaches every live create path.

## Two things typecheck did NOT catch (caught later)
1. **A runtime assertion**: `create-passkey-profile.test.ts` pinned `runCeremony` was called with `{mode:"create", userHandle}` via `toHaveBeenCalledWith` (exact match) — a vitest failure, not a type error. Updated to include `name:"My Wallet"`, which now positively asserts PATH A threads the name.
2. **Biome format errors**: the longer `acquireRecovery` union line in `service.ts` and the `toHex` helper in the new test exceeded biome's width. The Phase-1 *scoped* extension lint had already passed (these edits came after), so only `audit:vue`'s **root** lint surfaced them. Fixed with `biome check --write` (formatting only, no logic). Lesson: run the root/`audit:vue` lint, not just the scoped one, before declaring lint-green on a multi-file change.

## Gate result — GREEN
- `bun run --cwd packages/extension typecheck` → exit 0 (proves `name` threads to PATH A + the full PATH B chain).
- `bunx vitest run src/wallet/utils/` → 19 green (passkey-label 13 + passkey-ceremony 6); affected suites 98/98.
- `bun run audit:vue` → green (typecheck:all → full unit suite → lint → chrome build all pass).

## Manual smoke — DEFERRED to human
Cannot be run autonomously (needs a real authenticator + Touch ID + iCloud Keychain). Checklist surfaced in the wrap-up. Do NOT mark as passed.
