# C6 — Round 2 push-back (Claude-side self-critique)

## Missed

- **`openOnboarding()` / `openPopupOnce()` page-bootstrap duplication** — verified: both do `newPage → patchPagePolling → setViewport → bringToFront → reset ctx.consoleErrors/pageErrors → attach identical console/pageerror listeners` (`packages/extension/tests/e2e/fixtures/extension.ts:115-130` vs `:997-1018`). Plain Duplicate Code in the hottest scoped file; missed by both Claude instances and by the Claude rebuttal. Codex round 2 found it first.
- **Cap-grant fixture choreography** (codex-1 F5: phase wrapper ×4, setup ladder ×4, grant branches ×3) — conceded in the rebuttal, but it was a round-1 miss in the exact file both instances were already dissecting (F5/F8).
- Auto-imports caveat audit: the one `src/utils` dead-code claim (claude-1 F4, `isValidAmount`, `amount.ts:189`) survives re-verification — only the generated registry and its own test reference it; zero `.ts`/`.vue` usage. No miss there.

## Over-asserted

- **claude-1 F4 cites a phantom symbol**: `isTerminalStage` does not exist; the real export is `isTerminal` (`packages/wallet-core/src/jobs/index.ts:4`), and it has a live external consumer — `packages/extension/src/wallet/services/operation-journal/service.ts:4` imports it. The repo-map (`wallet-core-crypto.md:16`) lists only `TERMINAL_STAGES/canTransition`; claude-1 garbled an extra name onto the map's row without a fresh grep. The dead claim holds only for `TERMINAL_STAGES` + `canTransition` (claude-2 F6 had it right).
- **claude-1 F10 (README drift) is partly out of scope** — cluster scope is `packages/{wallet-core,wallet-crypto}/src/**`; both READMEs sit outside it. Codex's rebuttal was right; only the `serialization.ts:6-7` docstring-vs-tsconfig claim is in-scope.
- **claude-1 F6 over-counts and over-reaches**: 10 files / 11 occurrences, not "11 files"; 8 of the cited files are `*.test.ts` + `tests/e2e/scripts/` — outside the fixtures-only harness scope. The in-scope core (unexported `TEST_PASSWORD` at `helpers.ts:20`, literals at `extension.ts:170,808`) stands.
- Minor: instance counts disagree (71 vs 68 e2e importers; actual 71) — cosmetic, but one of them didn't run the grep.

## Anchoring

- 8 of claude-1's 10 findings map one-to-one onto `clusters.md`'s C6 focus list ("3 stringify variants", "console-hijack ×4", "general.js", "@aztec/stdlib" verbatim); the non-findings lists likewise adjudicate the hint items. The two genuinely cold-read harness smells (both above) were exactly the unhinted ones — the anchor bought recall on pre-labeled families at the cost of fresh reading.
- claude-1 F4's dead-export list reproduces `repo-map/wallet-core-crypto.md:16-17` nearly verbatim; the phantom `isTerminalStage` is the fingerprint of transcribing the map instead of independently re-deriving — the one F4 row not on the map's list is the one that's wrong.
