# Phase P4 — lessons

## Pre-existing lint debt surfaced after my edits

After P0–P3 edits, `bun run lint` started failing with `lint/suspicious/noImplicitAnyLet` on:

1. `packages/extension/src/onboarding/pages/create.vue:118:6` — `let profile` without type/initializer. **Fixed in P4** by importing `ProfileInfo` from `wallet/services/profile/spec` and annotating `let profile: ProfileInfo`.
2. `packages/extension/src/popup/components/modules/settings/contacts/useContactImportExport.ts:120:8` — `let res` without type/initializer.

### Why P0/P1/P2/P3 audit:vue runs "passed" (they didn't)

The `audit:vue` script chain (`typecheck:all && test && lint && build`) fails fast on lint. My grep filter in earlier phase verifications was `| grep -E '(error|Error|FAIL|Test Files|Tests |✓ built|warnings)' | tail -10` — this didn't show the trailing `error: script "lint" exited with code 1` line because of the tail-10 truncation order. Net: lint was failing on both files all along; I just didn't see it in the grep output.

### Confirming pre-existence

Stash + lint check on dev base:
```
$ git stash && bun run lint
packages/extension/src/onboarding/pages/create.vue:118:6 lint/suspicious/noImplicitAnyLet
packages/extension/src/popup/components/modules/settings/contacts/useContactImportExport.ts:120:8 lint/suspicious/noImplicitAnyLet
Found 43 warnings.
```

The contacts file was last touched at `5ee8ec1 chore: open-source initial import` — the lint error has been there since day 1.

### Decision

- **Fixed** the onboarding/create.vue one (I was editing the file anyway; type annotation is trivial).
- **Left** the contacts one — it's pre-existing, in unrelated code, and the user's CLAUDE.md says "don't refactor beyond what the task requires."
- Net effect: this PR REDUCES the dev lint error count from 2 to 1.

### Implication for the P7 final gate

`bun run audit:vue` will still exit non-zero at P7 because of the unrelated contacts file. The user (or a separate cleanup PR) should fix that 1-line implicit-any. For this PR's correctness, the relevant gates are:
- typecheck:all — clean
- test (149 composable tests + 1724 total) — clean
- build — clean
- lint of files I touched — clean

### P4-specific gate

Plan §11 P4 validation is `bun run --cwd packages/extension test src/popup/components/popups/EditProfilePopup.test.ts && bun run --cwd packages/extension build-storybook`. EditProfilePopup has no `.test.ts` file in the repo. Running the broader popup test suite + storybook build instead.

**Popup test suite: PASS** — 2 test files, 23 tests passed.

**Storybook build: FAIL — pre-existing.** Vite/Rolldown plugin compatibility breaks the build:

```
Failed to convert builtin plugin 'ViteAlias': StringExpected, Failed to convert
JavaScript value `Object {"find":"@","replacement":"./src"}` into rust type `String`
on BindingViteAliasPluginAlias.replacement
```

Confirmed pre-existing via `git stash` + storybook on dev base — same error. The C6 change (`BrutalistTitle.stories.ts:20` `sub: "Wallet"` → `sub: "Profile"`) is a 1-char string-arg edit; zero impact on the build pipeline. Pre-existing infra debt; not blocking this PR.

### Effective P4 status

- C5 (EditProfilePopup `:maxLength="25"` → `"32"`) — applied, typecheck + test green.
- C5b (cross-profile collision check via `otherProfileNames`) — applied; added populate-on-open + filtered-by-current-id; UX shows "Name in use" inline warning before submit.
- C6 (Storybook story `sub: "Wallet"` → `"Profile"`) — applied; verifiable by reading the .stories.ts file; pre-existing storybook build issue is independent.

Two pre-existing infra issues surfaced during this phase (lint debt + storybook build). Both predate the PR and are out of scope.

### Lint debt — what got fixed incidentally vs deferred (continued in P7)

Biome's diagnostic limit hides errors after a count threshold, so each fix surfaced the next pre-existing error. After 5 incidental fixes I drew the line:

**Fixed (1-line changes, low risk, unblocks one error apiece):**

| File | Rule | Fix |
|---|---|---|
| `onboarding/pages/create.vue:118` | `noImplicitAnyLet` | Added type annotation `let profile: ProfileInfo` + imported the type |
| `popup/components/modules/settings/contacts/useContactImportExport.ts:120` | `noImplicitAnyLet` | Added type `let res: Array<ContactRecord & { isSender?: boolean }>` |
| `wallet/services/execution/fast-path.ts:182` | `noImplicitAnyLet` | Added type `let blockHeader: Awaited<ReturnType<typeof pxe.getSyncedBlockHeader>> \| undefined` |
| `components/composite/capabilities/CapabilityDetailPanel.stories.ts:31` | `suppressions/unused` | Removed orphan `// biome-ignore` line (suppression had no effect — the next line was a plain object literal, no `any` cast) |
| `components/composite/capabilities/CapabilityDetailPanel.test.ts:19` | `suppressions/unused` | Same — removed orphan suppression that didn't gate any `as any` |

**Left for a separate cleanup PR (pre-existing, unrelated to this work):**

| File | Rule | Why deferred |
|---|---|---|
| `onboarding/composables/useAcceleratorStatus.test.ts:6` | `noUnusedVariables` (`flush`) | Unused helper. 1-line delete OR underscore-prefix rename. Pre-existing on dev. |
| `wallet-crypto/src/password-secret-box.ts:78` | `noUnusedPrivateClassMembers` (`logger`) | Unused constructor param. Pre-existing on dev. |

Plus ~38 warnings (`useArrowFunction` in vi.mock, etc.). Net effect: this PR REDUCES the dev error count from 7 to 2.

### Recommendation for the project

A standalone "lint debt cleanup" PR should run `bunx biome check --max-diagnostics=200 --write` against the full repo and triage the resulting fixes. Without that pass, every future PR that touches a file with a latent error will accidentally surface it (as happened here) — distracting from the actual work.
