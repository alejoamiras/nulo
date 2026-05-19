# M4.2 — Harden session secret (DECISION MEMO + PREWORK; 4-7d execution after decision)

> **STATUS: PIVOT TO OPT-IN "Strict Security Mode"** (2026-04-26 user decision — see `../DECISIONS.md`). User's UX concern about Design B (re-auth on every SW restart) is real — under MV3 the SW idles ~30s between events, so users would re-enter password constantly. Final approach: **opt-in toggle**. Default OFF preserves today's bearer behavior. Users / compliance contexts can enable strict mode for the full Design B threat-model fix. Plan v1 (when scheduled) integrates Design B behind the toggle, not as default.
>
> **Audit tier**: dual (codex xhigh + Plan agent). Audited as decision memo.
>
> **Status**: NOT a step-by-step execution plan. M4.2 has a product/security decision gate (M0.5 passhash question) that must close before execution. This document is the **decision memo**: design constraints, prework that's safe to do now, and branch-explanation of the two viable designs.

## Why this is a memo, not an execution plan

**Codex audit BLOCKING**: M4.2 must not be written as a normal implementation plan with default `(a)`. The current `SECURITY.md:73` security contract explicitly requires the replacement to be "a session token that cannot itself decrypt the secret." If we default to design `(a)` (device-local session key wrap) **and** the wrap-key is co-located with the wrapped secret in `chrome.storage.session`, design `(a)` is just "passhash with different packaging" — the threat model doesn't shift.

**Plan agent audit BLOCKING**: same conclusion via different reasoning — wrap-key extraction makes design `(a)` no better than today.

The decision is product/security, not engineering. Engineering can document constraints + the prework, but cannot pick the design alone.

## Current state (verified at `55f88a4`)

The vulnerability surface in `packages/extension/src/wallet/services/profile/session-manager.ts`:

- **Line 157 (`open`)**: `passhash` (32-byte SHA-256(password)) gets persisted as base64 into `chrome.storage.session`:
  ```ts
  passhash: passhash ? Buffer.from(passhash).toString("base64") : undefined,
  ```
- **Line 242 (`restore`)**: `passhash = Buffer.from(session.passhash, "base64")` — read back, used to derive PBKDF2 key, then unseal the encrypted profile secret.
- **Line 19 (JSDoc)**: documents that the in-memory `ActiveSession` has the raw `Fr` master secret, but the persisted `Session` mirrors `passhash` only.

`SECURITY.md:62-86` already documents this as a known gap:
> "**M4.2**: replace `passhash` with a session token that cannot itself decrypt the secret. Candidates: device-local session key wrap, or require re-auth on SW restart."

The threat model entry ("Can read `chrome.storage.session` … during an active session: **Full compromise of the password-unlocked master secret**") is the load-bearing claim M4.2 must address.

## Two viable designs (each must address the BLOCKER constraint)

### Design A — Device-local session key wrap

**Idea**: At unlock, generate a random 32-byte session key. Store **only** the encryption of the master secret under the session key in `chrome.storage.session`. Keep the session key out of `chrome.storage.session`.

**Critical constraint (from audits)**: the session key MUST NOT live anywhere an attacker reading `chrome.storage.session` can extract.

**Candidate stores for the session key:**

1. **In-memory only.** Session key generated in the SW, kept on the SessionManager instance. SW suspension wipes it; restore requires re-auth. *This is design (B) in disguise.*
2. **`crypto.subtle.generateKey(..., extractable=false)`.** Non-extractable CryptoKey stored in IndexedDB via `crypto.subtle.wrapKey` to a separate storage key, where the wrap key itself comes from PRF/passhash. *Doesn't help — same problem at a different layer.*
3. **WebAuthn PRF-derived key.** On every SW restart, prompt the user for passkey PRF (or password) → derive session key. *Equivalent to design (B) for the user; same UX cost.*
4. **A non-extractable CryptoKey stored in a separate IndexedDB DB that requires user interaction to access.** Doesn't exist as a Chrome primitive.

**Conclusion from audits**: design (A) only works as **strict in-memory + re-auth on SW restart for the session key**, which converges with design (B). Engineering cannot find a way to make (A) work as a "stays unlocked across SW suspension" design without re-introducing the bearer pattern.

### Design B — Re-auth on SW restart

**Idea**: Don't persist anything that can decrypt the master secret. SW restart drops the in-memory secret + clears `chrome.storage.session.nulo:core:session`. User re-authenticates (password or passkey PRF) on next popup interaction.

**Pros**:
- Threat model satisfied. `chrome.storage.session` reads expose nothing actionable.
- Symmetric with passkey profile behavior today (passkey users already re-PRF on SW restart per `SECURITY.md` "Session secret (passkey profiles)").
- Simpler: no key management, no wrap design.

**Cons**:
- UX regression: ~1s PBKDF2 cost every time the SW restarts (more frequent than browser sessions; can be every 5 minutes during active use under MV3 lifecycle).
- Mitigations: keep popup-side service clients alive while the popup is open (already the case); the SW restart cost only hits when both SW is suspended AND popup re-opens cold. Acceptable for security sensitivity.

## Which design ships?

**Recommendation, pending product decision**: **Design B**. Audit consensus + cleanest threat model match. Design A's variants either (1) re-introduce the same risk under a different name, or (2) converge with B.

Edge case: if the user/product decides "passkey profiles re-PRF on SW restart is acceptable, but password profiles must NOT re-PBKDF2 on SW restart" (UX requirement), then design A becomes mandatory and must be paired with M4.8 — and the wrap key must derive from a per-installation **non-extractable** CryptoKey stored in a separate IndexedDB DB (Aztec-canonical pattern; verify if Chrome supports the necessary primitive).

## Prework (safe to do now, regardless of decision)

These items don't depend on the decision and tighten the existing surface immediately. Each could ship as its own small PR, OR as the first commits of the M4.2 PR once the decision lands.

1. **Centralize passhash handling** — currently `EncryptionKey.getPasshash` is called from multiple sites (`profile/service.ts:149, 432, 453, 463`, `password-secret-box.ts:83, 100, 117, 122`). Inventory + consolidate into a single helper. Reduces the surface where M4.2 needs to apply changes.
2. **Annotate every `passhash`-touching line** with a `// SECURITY: M4.2-pending` comment. Compile-time visibility: if someone adds a new passhash callsite during M4.7's churn, code review catches it.
3. **Sketch the `SessionToken` interface** that both designs would implement. Land the type-only file now; designs diverge at the implementation:
   ```ts
   // packages/wallet-crypto/src/session-token.ts
   export interface SessionToken {
     // Returns the master secret if the token is still valid. Throws
     // SessionExpiredError if not (caller re-auths).
     decryptMasterSecret(): Promise<Uint8Array<ArrayBuffer>>
   }
   ```
4. **`SECURITY.md` update** — clarify that M4.2 has converged on Design B as the recommended path, pending product sign-off. Refer engineers to this memo.
5. **M2.6 vector for `SessionToken`** — once Design B is approved, the vector pins the round-trip: encrypt master secret with X (where X is the design-specific input — none in B), decrypt back. Pre-write the test fixture; populate the body when design is final.

## What execution looks like (Design B)

When the decision lands and Design B is approved:

### Step 1 — Drop the persisted passhash
- `session-manager.ts:161` — `passhash` field deleted from persisted `Session`.
- `session-manager.ts:215-255` (`restore`) — short-circuits for password profiles same as it does today for passkey profiles: leave the persisted record alone, let the popup's lock screen handle re-auth.
- Migration: M4.7 migrator drops the `passhash` field from any pre-M4.2 persisted session (set to `undefined`).

### Step 2 — Lock-screen UX for SW restart
- Popup detects "session not active, but persisted profile exists" → shows lock screen.
- Lock screen accepts password (existing flow) → ProfileService runs `unlockProfile` → SessionManager opens.
- For passkey profiles: M4.8 owns the symmetric path.

### Step 3 — Clean up the bearer infrastructure
- `EncryptionKey.getPasshash` stays (still used during unlock to derive PBKDF2 key — but the result is no longer persisted).
- `PasswordSecretBox.unsealWithPasshash` (line 108) stays for in-flight unlock; remove only if no callers need a "pre-derived" path post-M4.2.
- Update `SECURITY.md` threat-model row: "Can read `chrome.storage.session` during an active session: NO master-secret compromise (only encrypted profile + opaque session record)."

### Step 4 — Tests
1. **No persisted passhash**: write `Session` post-unlock; assert `passhash` field absent.
2. **SW restart drops session**: simulate SW restart with a persisted Session; SessionManager.restore short-circuits; popup lock screen presented.
3. **Re-unlock works**: user enters password; new session opens cleanly.
4. **M2.6 vectors unchanged**: KDF chain invariants hold.

(M4.2 is small once Design B is the picked direction. Most of the cost was in deciding.)

## Verification commands (post-execution)

```bash
bun run --filter '@nulo/extension' test    # session-manager M4.2 tests
bun run typecheck:all
bun run test:all                           # M2.6 unaffected
bun run check:imports
bun run build
```

Manual QA: unlock, suspend SW (chrome://serviceworker-internals), open popup, verify lock screen, re-enter password, verify wallet unlocks. Repeat for passkey profile per M4.8.

## Risks tracked (by design)

**Design B risks:**
1. **UX regression** during heavy SW churn. Quantify in beta; if too aggressive, evaluate moving to Design A's (constrained) variant.
2. **Passkey profile asymmetry** today already exists (passkey users re-PRF). M4.8 makes both flows symmetric.
3. **Breakage of any external assumption that the wallet stays unlocked across SW restarts.** Search the codebase for "passhash" pre-execution; verify no other consumer.

**Design A risks (if chosen):**
1. **Wrap-key co-location** is the BLOCKER. Any Design A proposal must pin the wrap-key store + show that an attacker reading `chrome.storage.session` cannot also read it.
2. **Complexity**. Design A introduces a wrap layer with its own M2.6 vector. Design B drops a layer.

## Audit prep

When this memo goes to codex + Plan agent for audit:
- Both audits already flagged "don't default to Design A." This memo absorbs that.
- The audit now focuses on: (1) is Design B the right pick? (2) is the prework correct? (3) is the execution sketch missing anything?
