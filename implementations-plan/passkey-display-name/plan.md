# Passkey display-name branding

**Tier:** `/blueprint light` · **Scope:** `packages/extension` only · **Status:** awaiting approval

## Summary

New passkeys currently register under the opaque label `profile-<8-hex-id>` (e.g. `profile-a3f29b14`) in iCloud Keychain / Google Password Manager / 1Password. Change the WebAuthn registration so they register as **`nulo-{name}-{id}`** (e.g. `nulo-alice-a3f29b14`) — readable *and* unique. The work is: thread the profile name (already known at create time) down into the one WebAuthn options builder, run it through a pure sanitizing formatter, and set `user.name` + `user.displayName`. Cosmetic metadata only — no key, credential-id, or address change.

## Tier rationale (light)

Rubric (HIGH count = 0):
- **Novelty** LOW — the passkey ceremony + profile-name flow already exist and are mapped.
- **Blast radius** LOW — affects only the display label of *newly* created passkeys; existing passkeys and all key material are untouched.
- **Irreversibility** LOW — format is a code constant; can be changed again. (Existing passkeys keep their old label regardless — inherent to WebAuthn, not caused by us.)
- **Migration cost** NONE — no key/address/storage migration (see Fact 9).
- **External coupling** LOW — WebAuthn is already a dependency; no new surface.
- **Security sensitivity** LOW — verified cosmetic-only; one privacy trade-off, surfaced + user-accepted (see Security section).

Single-package, bounded, low-risk → `light` confirmed.

## Scope

**In:** the WebAuthn `user.name` / `user.displayName` produced at passkey *registration*, in `packages/extension`.

**Out:**
- Renaming **existing** passkeys (WebAuthn exposes no RP-controlled rename; metadata is fixed at credential creation).
- The faucet — it registers **zero** passkeys (`packages/faucet/src` has no WebAuthn; Fact 7). The user's "faucet/extension" framing was a misconception; nothing to change there.
- `rp.name` ("Nulo") / `RP_ID` ("nulo.sh") — untouched (crypto-bound; out of scope).
- Any create-flow UI copy (a "your profile name will be visible to your password manager" notice is a possible *optional* follow-up, not in this plan).

## Resolved decisions (from clarifying questions)

| Decision | Resolution | Source |
|---|---|---|
| Label format | **`nulo-{name}-{id}`** | user (AskUserQuestion) |
| Validation depth | **unit + lint/typecheck + manual smoke** | user (AskUserQuestion) |
| Sanitization + `displayName` + empty-name fallback | **decided by default, veto-able at gate** — see Phase 1 + Open question O1 | author |

## Assumptions

### Facts (verified against the repo)
1. The display name is built in exactly one place: `packages/extension/src/wallet/utils/passkey-ceremony.ts:40-44` — today `user.name = ` `` `profile-${userHandle}` ``, `user.displayName = "Nulo Profile"`.
2. `userHandle` is the profile id = 8 random hex chars (`packages/extension/src/wallet/services/profile/repository.ts:30` `PROFILE_ID_HEX_LENGTH = 8`, `:104`). Today's label is `profile-<8hex>`.
3. `PasskeyRequest`'s create variant is `{ mode: "create"; userHandle: string }` — no name field (`packages/extension/src/wallet/services/passkey/spec.ts:29-33`).
4. The profile name is in scope at the only **live** create site: `createPasskeyProfileWithRetry(name, …)` (`packages/extension/src/wallet/utils/create-passkey-profile.ts:42,46`), called from `packages/extension/src/composables/useProfileCreateFlow.ts:70`.
5. There are two create paths, and **both are reachable** (codex correction — PATH B is *not* dead, only "no current production caller"):
   - **PATH A** (live, popup in-page modal): `useProfileCreateFlow.ts:70` → `createPasskeyProfileWithRetry(name, …)` → `runCeremony({ mode:"create", userHandle })` (`create-passkey-profile.ts:46`), which runs `buildCreateOptions` popup-side; then `createPasskeyProfile(name, credentialData)` persists with the collected credential.
   - **PATH B** (SW-driven window): `createPasskeyProfile(name, undefined)` (`service.ts:215`) → `acquireRecovery({ ceremony:"create", userHandle:id }, undefined)` (`service.ts:227`, def `:365-374`) → `passkeyCoordinator.createForNewProfile(userHandle)` → `passkey.createKey(userHandle)` (`service.ts:61`) → `openWindowAndWait({ mode:"create", userHandle })`. The `name` is in scope at `createPasskeyProfile` (its first param) but is dropped at every hop today.
6. Both paths construct the WebAuthn options through the single helper `runPasskeyCeremony → buildCreateOptions`: the SW window reads the full `PasskeyRequest` from `getPendingRequest` and passes it to `runPasskeyCeremony` (`packages/extension/src/popup/windows/passkey/index.vue:49-50`). So a field added to the type reaches both paths' builder — but PATH B requires threading `name` through `acquireRecovery` + `createForNewProfile` + `createKey` to *populate* that field (see Phase 2).
7. The faucet registers no passkeys — `packages/faucet/src` has no `credentials.create`/WebAuthn references (grep-based, not a semantic proof, but the faucet is a dapp that talks to a wallet, not an authenticator host). Extension-only scope.
8. No existing test pins `user.name` / `displayName` / `buildCreateOptions` (repo grep empty) → the test added here is net-new, nothing to update.
9. **Cosmetic-only (narrowed per codex — repo proves only what's stated):** the PRF eval input is the constant `SHA-256("nulo:profile:v1")` (`packages/wallet-crypto/src/constants.ts:10`, `passkey-ceremony.ts:25-28`); the master-secret derivation (`packages/wallet-crypto/src/passkey-credential.ts:36-69`) and the account-address derivation (`account/service.ts:187`) **never read** `user.name`/`displayName`. So changing those fields cannot change the derived master secret or the account address — this is repo-provable, and `key-vectors.test.ts` is the tripwire. (Note: the HKDF salt *does* use `credentialId` — see Inference I4 for why that's still safe.)
10. Only **new** registrations are affected; existing credentials keep their baked-in label.
11. The relying party already surfaces as "Nulo" / `nulo.sh` (`passkey-ceremony.ts:37-38`, `spec.ts:21`), so the credential is grouped under Nulo regardless of `user.name`.

### Inferences (unverified — please attack)
- I1: iCloud Keychain, Google Password Manager, and 1Password surface `user.name` as the per-credential account label under the RP. Display behaviour is platform-specific; the manual smoke confirms iCloud Keychain specifically. Setting `user.name === user.displayName` makes the rendering consistent regardless of which field a given manager prefers.
- I2: A profile name that sanitizes to empty under an ASCII-slug rule (all-emoji, all-symbol, or fully non-Latin scripts like CJK/Arabic) is uncommon; the `nulo-profile-{id}` fallback covers it without leaking unrenderable bytes.
- I3 (revised per codex): Making `name` a *required* field is safe because the name is in scope at **every** create entry point (PATH A `createPasskeyProfileWithRetry`, PATH B `createPasskeyProfile`). The compiler will flag *all* sites needing it — `PasskeyRequest.create`, `acquireRecovery`'s create variant, `createForNewProfile`, and `createKey` — so completeness is machine-checked, not eyeballed. The `name` survives the PATH B RPC/serialization boundary (it's a plain string on `PasskeyRequest`).
- I4: The authenticator-generated `credentialId` is independent of `user.name`/`displayName` (it's a random/key-wrapped handle minted by the authenticator). This is **authenticator behavior, not repo-provable**. It doesn't matter for migration regardless: we change only **new** registrations, each of which already mints a fresh `credentialId`; no existing credential or its HKDF salt is touched.

### Asks (resolved — none silent)
- A1 (format) → resolved: `nulo-{name}-{id}`.
- A2 (validation) → resolved: unit + lint/typecheck + manual smoke.
- A3 (sanitization strategy) → **surfaced as Open question O1**; defaulted to ASCII-slug with `nulo-profile-{id}` fallback. Not silent — called out in the gate + ELI5 for explicit confirmation.

## Security & Adversarial Considerations

- **Privacy (the one real trade-off).** The profile name is user-chosen free text. Embedding it in `user.name`/`displayName` means a normalized form **syncs to iCloud Keychain / Google Password Manager cloud** — leaving the device. Today's opaque `profile-<id>` leaks nothing. For a privacy-focused wallet this is a deliberate regression, surfaced to and **accepted by the user** in exchange for disambiguating same-named profiles. Mitigations: (a) only a sanitized slug leaves (lower-cased, reduced to `[a-z0-9-]`, length-capped) — not arbitrary raw text; (b) it is the user's own self-chosen label, not a secret the wallet generated; (c) the fallback for empty/non-Latin names is the personal-data-free `nulo-profile-{id}`. Residual: users who want *zero* leakage would need a name-free label — tracked as optional follow-up (UI notice), not in scope.
- **Label spoofing / homograph in the authenticator picker.** `user.name`/`displayName` are rendered by native authenticator UIs. The sanitizer strips Unicode bidi/override controls (U+202A–202E, U+2066–2069), other control chars, zero-width characters, and newlines, and collapses whitespace — preventing a crafted profile name from rendering a misleading credential label (e.g. impersonating another entry). Length is capped to avoid truncation games.
- **No cryptographic surface touched (Fact 9).** No change to the secret, credentialId, address, PRF input, or HKDF salt → no replay/derivation/migration risk. The `key-vectors.test.ts` vectors remain green (and are the canary if this assumption is ever violated).
- **Least privilege / supply chain.** No new dependencies, no new host permissions, no network calls, no new manifest entries. The change is pure local string construction over an existing API.

## Phase 1 — Pure label formatter + exhaustive unit tests ✓

Create the sanitizing formatter as a **pure, WebAuthn-free** module so all the edge-case logic is unit-testable in isolation (no jsdom/WebAuthn needed).

- New file `packages/extension/src/wallet/utils/passkey-label.ts`:
  - `formatPasskeyUserName(name: string, userHandle: string): string`
    - `slug = sanitize(name)`; return `slug ? ` `` `nulo-${slug}-${userHandle}` `` ` : ` `` `nulo-profile-${userHandle}` ``.
  - `sanitize(name)`: `normalize("NFKD")` → **strip combining marks `\p{M}` (`/\p{M}/gu`)** → lowercase → replace every run of chars outside `[a-z0-9]` with `-` → collapse `-{2,}` → trim leading/trailing `-` → cap to 24 chars → re-trim trailing `-`. (Stripping bidi/control/zero-width is subsumed by the allow-list. The `\p{M}` strip — **codex fix** — is what turns `Élodie`→`elodie` instead of the broken `e-lodie`: NFKD splits `É` into `E`+combining-acute, and without removing the mark the allow-list would replace it with a stray `-`.)
  - `userHandle` is assumed already hex (Fact 2); the formatter does not re-validate it (caller invariant), but is defensive against an empty slug only.
  - The 24-char slug cap is a deliberate "keep the authenticator label compact" choice (input is already UI-capped at 32 chars, `useProfileNameField.ts:102`); it only truncates names of 25–32 chars. Tunable — see Open question O2.
- New file `packages/extension/src/wallet/utils/passkey-label.test.ts` (`bun:test` or vitest — match the util's neighbours; these utils are plain TS so `bun:test` is fine, but the extension runs vitest, so use vitest for consistency with `audit:vue`). Cases (≥8):
  1. basic: `("Alice","a3f29b14") → "nulo-alice-a3f29b14"`.
  2. spaces → hyphens: `("My Wallet","id") → "nulo-my-wallet-id"`.
  3. uppercase folded: `("ALICE","id") → "nulo-alice-id"`.
  4. emoji/symbols stripped: `("Alice 🚀!!!","id") → "nulo-alice-id"`.
  4b. **accent folded (codex case): `("Élodie","id") → "nulo-elodie-id"`** (NOT `nulo-e-lodie-id`).
  5. bidi/control/zero-width stripped (assert no U+202E etc. survive).
  6. length cap: a 100-char name yields a slug ≤24 chars, no trailing `-`.
  7. empty / whitespace-only / all-symbol / non-Latin → fallback `nulo-profile-id`.
  8. id preserved verbatim; leading/trailing hyphens never doubled (`"-x-"` style names).

### Validation gate — Phase 1
- **Commands:** `bun run --cwd packages/extension typecheck` · `bun run --cwd packages/extension lint` · `cd packages/extension && bunx vitest run src/wallet/utils/passkey-label.test.ts`
- **Pass criteria:** typecheck exit 0; biome clean; all new unit cases green (incl. the accent-fold case 4b).
- **Layers:** typecheck/lint · unit.

## Phase 2 — Thread the name + wire the formatter + regression test + manual smoke ✓ (automated gates; manual smoke deferred to human)

**Type-driven threading (make `name` required so the compiler finds every site):**
- `packages/extension/src/wallet/services/passkey/spec.ts`: `PasskeyRequest` create variant → `{ mode: "create"; userHandle: string; name: string }`.
- `packages/extension/src/wallet/utils/passkey-ceremony.ts`: `buildCreateOptions(userHandle, name)` → `user.name = formatPasskeyUserName(name, userHandle)`, `user.displayName` = same value (per I1 + O2); `runCreate(userHandle, name, signal?)` and `runPasskeyCeremony` forward `request.name`.
- **PATH A:** `create-passkey-profile.ts:46` → add `name` to the create request (already a param of `createPasskeyProfileWithRetry`).
- **PATH B chain (the codex condition — all carry `name`, all in scope from `createPasskeyProfile`'s param):**
  - `service.ts` `acquireRecovery` opts union: create variant → `{ ceremony:"create"; userHandle: string; name: string }`; the `createPasskeyProfile` call at `:227` passes `name`. (The `getById`/`getAny` variants are unchanged — no name needed.)
  - `service.ts` `acquireRecovery` `:374` → `createForNewProfile(opts.userHandle, opts.name)`.
  - `passkey-recovery-coordinator.ts:55` `createForNewProfile(userHandle, name)` → `passkey.createKey(userHandle, name)`.
  - `passkey/service.ts:61` `createKey(userHandle, name)` → `openWindowAndWait({ mode:"create", userHandle, name })`. Keep the "no current production caller" note (now accurate).
- Verify PATH B window (`windows/passkey/index.vue`) needs **no** change (it forwards the whole `PasskeyRequest`; Fact 6).
- **Completeness check is the typechecker**: with `name` required, `bun run --cwd packages/extension typecheck` fails until every site above is threaded — no site can be silently missed.
- Test `packages/extension/src/wallet/utils/passkey-ceremony.test.ts` (net-new, Fact 8): assert `(await buildCreateOptions("a3f29b14","Alice")).user.name === "nulo-alice-a3f29b14"` and `.user.displayName` matches; **regression guard** that the PRF eval input bytes, the 32-byte challenge length, `rp.id`, `pubKeyCredParams`, and `user.id` (still hex→bytes of the handle) are unchanged vs the prior shape (proves we touched only the label).

### Validation gate — Phase 2
- **Commands:** `bun run --cwd packages/extension typecheck` (compiler proves every create site — both paths — passes `name`) · `bun run --cwd packages/extension lint` · `cd packages/extension && bunx vitest run src/wallet/utils/` · then the cumulative `bun run audit:vue` · then **manual smoke** (below).
- **Pass criteria:** typecheck exit 0 (no missing-`name` errors); biome clean; unit tests green; `audit:vue` green; manual smoke confirms the label.
- **Layers:** typecheck/lint · unit · manual real-authenticator.

### Manual smoke checklist (Phase 2)
1. `bun run --cwd packages/extension build:chrome`; load unpacked in Chrome.
2. Create a **passkey** profile named e.g. `Smoke Test`. Complete the Touch-ID/passkey ceremony.
3. macOS **System Settings → Passwords** (or iCloud Keychain) → find the `nulo.sh` passkey → confirm it reads **`nulo-smoke-test-<id>`** (not `profile-<id>`).
4. Sanity: lock → unlock-via-passkey still works (same credential; label change is cosmetic). Confirm the account address is unchanged from before (Fact 9 in practice).

> **PATH B note:** the smoke exercises PATH A (the in-page modal — the only production create trigger). PATH B (SW-window) has no production caller, so it can't be smoke-triggered; it's covered by the typechecker (proves `name` threads to its `buildCreateOptions`) + the shared `buildCreateOptions` unit test. Acceptable per the "no current production caller" status.

## Open questions (confirm at gate)
- **O1 (sanitization scope).** Default is an **ASCII slug** — non-Latin names (CJK/Arabic/Cyrillic) fall back to `nulo-profile-{id}` rather than transliterating or embedding raw Unicode. Alternative: a **Unicode-preserving** sanitizer (keep letters/digits of any script, strip only bidi/control) so e.g. a name "山田" shows as `nulo-山田-{id}`. ASCII is safer/more predictable and matches the Latin examples you chose; Unicode is more inclusive but harder to reason about across authenticators. Default = ASCII unless you say otherwise.
- **O2 (`displayName` + slug cap — surfaced per codex's silent-ask flag).** Two small UX defaults you should bless or override:
  - **`displayName`**: default = the **same** `nulo-{slug}-{id}` as `user.name` (consistent label whether a manager shows `name` or `displayName`). Alternative = the trimmed raw profile name "Alice" (friendlier, but then different managers show different things). Recommend: keep them identical.
  - **Slug cap = 24 chars.** Only bites names 25–32 chars long. Recommend: keep 24. (Veto either at approval.)

## Codex audit

**Verdict:** `conditional approve` (conditions: fix dormant PATH B name-threading; narrow Fact 9 so it stops claiming `credentialId` invariance; sanitizer must strip combining marks before ASCII slugging). Session `019eebcc-8913-7c40-b43c-913ff73277e9`.

**Adopted:**
1. **PATH B is not dead** — reachable via `createPasskeyProfile(name, undefined)` → `acquireRecovery` → `createForNewProfile` → `createKey`. Verified in `service.ts:215-227,365-374`. → Fact 5 rewritten; Phase 2 expanded to thread `name` through the full chain (I3 revised).
2. **Fact 9 over-claimed** `credentialId` invariance (authenticator behavior, not repo-provable). → Narrowed to master-secret + address (repo-proven); `credentialId` moved to Inference I4 with the "only new credentials affected" mitigation.
3. **Sanitizer combining-mark bug** (`Élodie`→`e-lodie`). → Added `strip \p{M}` after NFKD; added test case 4b (`Élodie`→`nulo-elodie-id`).
4. **Lint scope** — root `bun run lint` is broader than the change. → All gates use `bun run --cwd packages/extension lint`.
5. **Silent asks** (24-char cap; lowercased `displayName`). → Surfaced as O2.
6. **Fact 7** grep-based, not semantic. → Wording softened.

**Rejected / no-op:** none. Codex confirmed the rest looks fine: one builder owns the label; `RP_ID` / PRF input / HKDF salt / `user.id` untouched; the separate `passkey-label.ts` is justified; `user.name === user.displayName` is WebAuthn-correct; input length already bounded (no ReDoS).

**Net effect:** all three conditions resolved in-plan; no High/Critical left open. Re-audit not required for a light-tier doc change of this size, but the post-impl codex pass (Phase 5) will see the final diff.

### Post-impl codex audit (session `019eebcc`-derived `L12b4hB5`)
**Verdict:** `no high/critical`. Confirmed the sanitizer is sound (no bidi/zero-width survival, no doubled/edge hyphens, linear regex / no ReDoS), threading complete on both create paths (vue-tsc passed), cosmetic-only invariant holds (`user.id` / PRF input / HKDF salt / account-secret derivation untouched), privacy scope correct (only the sanitized slug leaves), and `mode:"get"` unlock/import/restore untouched. Three minor findings, all fixed:
- **Low** — length-cap test didn't exercise the slice-lands-on-hyphen path → added a dedicated case (`passkey-label.test.ts`, 23×`a` + sep).
- **Low** — the PATH B integration fake ignored the new `name` arg → `FakePasskeyService.createKey` now records it + a new test asserts `createPasskeyProfile("My Wallet")` threads `"My Wallet"` to `createKey` (`service.integration.test.ts`).
- **Nit** — comment drift `createKey(id)` → `createKey(id, name)` (`service.ts`).

## Seeds
_Finalized post-approval. Draft `/goal` + `/loop` in `eli5.html`._
