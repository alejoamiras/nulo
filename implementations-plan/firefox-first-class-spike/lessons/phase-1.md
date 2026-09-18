# Phase 1 — PRF fallback fix

## What shipped

`runCreate` in `apps/extension/src/wallet/utils/passkey-ceremony.ts` returns the create-time PRF when the authenticator gives one, and otherwise runs a `get` pinned to the credential it just created, verifies the assertion's id equals that credential's, and returns the caller's minted `userHandle`. Six unit cases drive the exported `runPasskeyCeremony` against a stubbed `navigator.credentials`.

## Consult — 38-agent verification workflow (Claude, 2026-09-18)

Four independent read-only audits (lint baseline · credential consumers · PATH A/B ceremony hosts · break-the-fix), each finding then judged by two adversarial lenses (correctness, consequence) with refute-by-default. 17 findings: 1 survived both, 11 contested, 5 refuted by both.

**Verdict on the survivor — adopted.** `bun run lint` was red, and it was **this phase's own fault**, not a pre-existing baseline. Three untracked spike scripts (`apps/extension/scripts/firefox-{hybrid-spike,webauthn-probe,passkey-ui-spike}.mjs`) were unformatted, and biome reports `format` diagnostics at severity **error**, so they failed the gate. Fixed by `biome check --write` on the three.

**The mistake that cost the round.** I read `bun run lint`'s output, saw diagnostics in `PopupManager.test.ts`, `mnemonic.test.ts`, `fee-helpers.ts`, `EditFpcPopup.test.ts` and `balances.store.fuzz.test.ts` — none of them files this change touches — and concluded the repo's lint baseline was red. It is not. Those five are `warning`/`info`, deliberately downgraded in `biome.json`, and biome exits non-zero on **errors only**. The 30 warnings and 5 infos are a curated baseline; leave them alone.

- `biome check --reporter=json` + `jq 'select(.severity=="error")'` is the way to read a red lint run. The human-readable output interleaves all three severities and invites exactly this misreading.
- `bun run lint` is `biome check && bun scripts/complexity-baseline/check.ts`. Under `&&` a red biome half means the complexity half never runs — check which half failed before assuming.
- No biome version drift: the repo pins 2.5.9 (`package.json:45`) and both `bunx biome` and `./node_modules/.bin/biome` resolve to it. CI is green on `dev` because CI checks out tracked files, and the three offenders are untracked.
- The spike scripts are untracked but **not** gitignored, so a `git add -A` would commit them and red `quality-status`. They stay formatted while they remain useful as reference for the Phase 4 driver, and are deleted in Phase 5 per the plan's change map.

**Adopted from the contested set (1 of 11).** The case "throws when the fallback assertion carries no PRF output either" passed against the pre-fallback code too — that code threw the same message straight from `create`, never calling `get`. One added line (`expect(get).toHaveBeenCalledTimes(1)`) makes it pin the fallback. Refuted on consequence, adopted anyway: strictly stronger, one line, zero risk.

**Rejected — `if (ext.prf.results && ext.prf.enabled !== false)`.** Two findings proposed guarding the shape where an authenticator reports `results` with a falsy `enabled`, which the old `enabled`-gated code would have re-derived through a second `get`. Rejected: the shape is unreachable for a conforming client, PRF is deterministic per (credential, salt) so both legs yield identical key material, and both legs already demand `userVerification: "required"`. Adding a branch for an unreachable case is the speculative surface the no-over-engineering rule forbids.

**Deferred to arc 4.** A doc comment in the e2e passkey fixture attributes the "Passkey PRF not available" throw to `src/popup/windows/passkey/index.vue`; it now lives at `passkey-ceremony.ts:107`. Arc 4 owns that file — fixing it here would be scope creep in a `fix(passkey)` PR.

**Carried into the PR body, not the code.** On the fallback path the user answers two passkey prompts with no UI change between them (owner ruled out copy, A6). If they cancel the second, `UserRejectedError` returns silently and a resident credential labelled `nulo-<slug>-<id>` is orphaned in their authenticator with no profile behind it — pre-existing cancel behaviour, but the fallback makes it reachable one prompt later.

**Refuted and dropped (5):** second prompt unverified in the browser-action popup host · session-TTL auto-lock unmounting PATH A mid-fallback · PATH B's unawaited `rejectPasskeyRequest` · stubs using `Uint8Array` where the DOM hands `ArrayBuffer` (`encodeBase64` and `Buffer.from` both accept either) · a zero-length `rawId` un-pinning the fallback.

## Gate

`bun run lint` → 0 · `bun run typecheck` → 0 · `vitest run src/wallet/utils/passkey-ceremony.test.ts` → 11 passed (5 pre-existing + 6 new) · `bun run audit:vue` → 0. Phase 1 green 2026-09-18.

`audit:vue` runs a full 16 GB vite build and outlives the agent shell's 10-minute cap — run it detached (`setsid nohup … > log`) and watch the log for the exit line, never in the foreground.
