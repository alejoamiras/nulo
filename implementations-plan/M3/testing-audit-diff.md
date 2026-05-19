# M3 Testing + Implementation Plan — Post-Audit Diff

## Source of findings

Three review passes, all incorporated:
1. **Pass 1 — general-purpose agent** (Sonnet): caught discovery-queue chrome.action stub, no-chrome.test.ts vacuity, discovery-queue non-pending case.
2. **Pass 2 — Opus via subagent**: extended with M3.4 import issue, test fixture drift concerns.
3. **Pass 3 — codex xhigh (gpt-5.4 high reasoning, actual codex CLI)**: caught FIVE additional blockers missed by passes 1-2, verified with live `tsc`/`vitest` runs. All blockers below are from this pass unless noted.

---

## BLOCKERS (pass 3 — codex xhigh)

### CB1. `Buffer` / `NodeJS.Timeout` globals will fail tsc in extracted packages

**Finding**: Files moving to wallet-core, wallet-crypto, extension-messaging currently rely on Node globals that exist only because `@aztec/*` transitively pulls `@types/node`. Extracted packages have no Aztec deps, so `"types": []` / `"types": ["chrome-types"]` reject these globals. Codex verified with a live `bunx tsc -p` run.

**Concrete usages**:
- `lock.ts:12` — `private forceReleaseTimer?: NodeJS.Timeout` → wallet-core
- `random.ts:2` — `Buffer.from(..).toString("hex")` → wallet-core
- `serialization.ts:6-8` — `Buffer.from`, `Buffer.isBuffer` → wallet-core
- `mnemonic.test.ts` — `Buffer.from(x, "hex")` / `.toString("hex")` → wallet-core
- `base/offscreen/client.ts:20` — `Map<number, NodeJS.Timeout>` → extension-messaging
- `passkey/credential.ts:25-27,39-40` — `Buffer.from`, `Buffer.concat` → wallet-crypto
- `password-secret-box.ts:127-140` — `Buffer.from(..., "base64")` → wallet-crypto

**Fix (pre-extraction step in each affected milestone)**:
- `NodeJS.Timeout` → `ReturnType<typeof setTimeout>` (portable, resolves to `number` in DOM lib)
- `Buffer.*` → `import { Buffer } from "buffer"` at file top (bytes are identical; the `buffer` npm package is a browser-compatible polyfill)
- Alternative: refactor to `Uint8Array` + helpers. Codex's preferred option (clean browser-native) but invasive for crypto files where M2.6 vectors must pass byte-for-byte.

**Applied to plans**: M3.1 Step 0a; M3.2 Step 0; M3.3 pre-extraction refactor section.

---

### CB2. `wallet-bridge` has extensive compile-time deps on extension types (NOT just background.ts)

**Finding**: Earlier plan drafts claimed wallet-bridge uses DI with "no concrete imports" from extension. `dispatcher.ts` lines 43-66 contradict this: 20+ type imports from extension service paths (`NetworkService`, `AccountService`, `ExecutionService`, 12 Operation types, `ProfileService`, `DappInteractionService`, `DappSessionService`, capability/session types, CAIP helpers, `isNoFromRequest`). `scope-enforcement.ts:13-23` also imports capability types from `dapp-session/spec`.

**Fix (M3.5 pre-extraction refactor)**:
1. Move capability/session types from `dapp-session/spec.ts` to new `wallet-bridge/src/capabilities.ts` (with re-export from extension's spec for back-compat).
2. Inline the 4 CAIP helpers in wallet-bridge (caip.ts stays in extension because of its dapp-interaction/spec dep).
3. Introduce `IDispatcherServices` structural interface — dispatcher depends on the interface, real services satisfy it at runtime via `initWalletSdkHandler`.
4. Extract Operation types (pure types) to wallet-bridge.
5. Inline or relocate `isNoFromRequest`.

**Impact**: M3.5 grows from 4-5 days to 6-7 days. Pre-refactor can land as a standalone PR before M3.5.

**Applied**: M3.5 plan rewritten with detailed pre-refactor section.

---

### CB3. M3.4 aztec-runtime SOURCE files import extension types (not just tests)

**Finding**: `chain-runtime.ts:8` imports `Network` from `@/wallet/services/network/client`; `artifact-registry.ts:4-5` imports `Network` + `ConfigServiceClient`. These are SOURCE files (not tests) — the prior audit fix only addressed the test files. The `@/` path won't resolve from inside `@nulo/aztec-runtime`.

**Fix**: Inline minimal structural interfaces in aztec-runtime (Network → `NetworkInfo` with 6 fields; ConfigServiceClient → `IConfigReader` with 1-2 methods). Extension's concrete types structurally satisfy the narrow interfaces automatically. Do as pre-extraction step.

**Applied**: M3.4 plan got a new "Pre-extraction refactor (Step 0)" table with specific line-by-line import replacements.

---

### CB4. 🔥 M3.2 has the WRONG value for `PASSKEY_PRF_LABEL` — would brick wallets if applied literally

**Finding**: M3.2 plan said `PASSKEY_PRF_LABEL = "nulo:kdf:v1"`. Verified actual value in `packey/spec.ts:4`: `"nulo:profile:v1"`. Key-vectors test V8 locks the real value: `expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")`. The `"nulo:kdf:v1"` string is a DIFFERENT internal label (`PASSKEY_KDF_LABEL`) inside `credential.ts:8`, not exported.

**Why this mattered**: A refactor engineer following the plan literally would ship `PASSKEY_PRF_LABEL = "nulo:kdf:v1"`, changing WebAuthn PRF input for every existing passkey wallet → every passkey-wallet user locked out. Crypto-breaking.

**Fix**: M3.2 plan rewritten to clearly distinguish THREE labels:
- `PASSKEY_PRF_LABEL = "nulo:profile:v1"` (exported, WebAuthn PRF input)
- `PASSKEY_KDF_LABEL = "nulo:kdf:v1"` (internal HKDF info, inside credential.ts)
- `PASSKEY_MASTER_LABEL = "nulo:master:v1"` (internal, inside credential.ts)

Only `PASSKEY_PRF_LABEL` is extracted to wallet-crypto's `constants.ts`. The two internal labels stay inline in `credential.ts` (which moves wholesale). All three values are frozen.

**Applied**: M3.2 plan section "Critical: passkey derivation labels" (rewritten).

---

### CB5. M3.7 `*:all` scripts only cover 3 packages, leaving 4 unverified

**Finding**: M3.7 plan's root `test:all` and `typecheck:all` scripts list only wallet-core, wallet-crypto, extension. After all 6 extractions, FOUR packages (extension-messaging, aztec-runtime, wallet-bridge, extension-ui) are silently unverified by the "all" gates.

**Fix**: Expanded both scripts to cover all 7 packages (6 extracted + extension). aztec-runtime and extension-ui get explicit no-op `test` scripts (no unit tests yet; tests stay in extension for aztec-runtime, and Vue tests are deferred to M5.1 for extension-ui).

**Applied**: M3.7 plan — Root `package.json` scripts section rewritten.

---

## CORRECTNESS (pass 3)

### CC1. M3.1 `bip39` risk item is based on a false premise

`mnemonic.ts` inlines the full BIP39 wordlist (2050 entries) as a `const`. No external `bip39` dep. The risk item is nonsense. **Fix**: removed the bogus risk; replaced with the real Step 0a refactor (Buffer/NodeJS.Timeout decoupling).

### CC2. Testing plan claims 15 entries in METHOD_CAPABILITY_MAP; source has 14

Off-by-one. Capability-map has 14 entries, not 15. The `test.each` table listed 14 correctly, but surrounding prose said 15. **Fix**: updated all "15" → "14" references in testing-plan.md and M3/5/plan.md.

### CC3. `NuloWalletInfo` at module load time — M3.5 risk register misstated it as "runtime only"

`rpc/types.ts:4-12` defines `NuloWalletInfo` as a top-level `const` with `chrome.runtime.getURL("/src/assets/logo.png")` evaluated at MODULE LOAD. Any test that imports `rpc/types.ts` (e.g. via the wallet-bridge barrel) crashes immediately in jsdom with `ReferenceError: chrome is not defined`. **Fix**: convert NuloWalletInfo to a factory function; M3.5 risk register updated from LOW to HIGH with the concrete fix.

---

## EARLIER PASSES (incorporated before pass 3)

### Pass 1 + Pass 2 blockers (already fixed in prior iteration)

- **B1-old**: `chrome.action` not mocked in discovery-queue tests → chrome stub added to `beforeEach`/`afterEach`.
- **B2-old**: `no-chrome.test.ts` is vacuous (`typeof` never throws, jsdom never defines chrome) → dropped entirely. Replaced with depcruiser + tsc boundary enforcement only.
- **B3-old**: Missing `status !== "pending"` skip test → added `"drain skips non-pending discovery"`.
- **PE1-old**: M3.4 carry-over tests need import fixes → decided tests STAY in extension (M3.2 pattern); covered further by CB3 for SOURCE file imports.

### Pass 1 + Pass 2 improvements (already applied)

- Queue `priorityPass` value-replacement assertions (Sonnet caught order-only; I added `v: 99` check + renamed misleading "idempotent" title).
- EventHandler `remove()` never-added no-op + error isolation showing the throwing cb did fire.
- Array_max all-negative quirk documentation.
- test.each over all METHOD_CAPABILITY_MAP entries (14, not 15 — see CC2).
- Case-sensitivity test for `getRequiredCapability`.
- `getAccounts` exempt coverage.
- Discovery-queue re-queue order verified by second drain.
- Lock `leave()`-before-`enter()` no-op.
- wrapParams single-element round-trip.
- Flush helper renamed + comment about fake-timer unsafety.
- `makeLogger` cast simplified to `{ log: vi.fn() }` (Pick<> was unnecessary).

### Pass 2 gap closures (applied in prior iteration)

- **G1**: EntityStorage + ValueStorage had ZERO tests; M3.1 refactors them. Added 13 new tests across two files using `FakeBrowserApi` (with the `{ key: undefined }` → `{}` normalization note).
- **G2**: M3.4 test-move pattern inconsistency → switched to "tests stay in extension" (M3.2-consistent).
- **G3**: CircularBuffer + DummyLogger stay in extension (only used by store.ts).

---

## Open questions — answered by codex

**Q1. Lock force-release test under `vi.useFakeTimers`?** ✅ Reliable. Codex verified with live vitest.
**Q2. `vi.stubGlobal("chrome", ...)` parallel-test safety?** ✅ Reliable. Cleanup via `vi.unstubAllGlobals()` is sufficient.
**Q3. `test.each` over all 14 entries vs. 6 reps?** All 14 — appropriate for a security gate.
**Q4. `__VERSION__` define placement?** Only in packages that reference it at module load (extension + wallet-bridge). Not every package.

---

## Files updated this pass

- `implementations-plan/M3/1/plan.md` — Step 0a (Buffer/NodeJS.Timeout pre-refactor), `bip39` risk removed, storage test risk added, mnemonic description fixed
- `implementations-plan/M3/2/plan.md` — PRF_LABEL value corrected (critical crypto fix), two internal labels documented, constants.ts comment clarified, Step 0 Buffer pre-refactor added
- `implementations-plan/M3/3/plan.md` — `NodeJS.Timeout` + Buffer pre-extraction refactor added
- `implementations-plan/M3/4/plan.md` — test pattern aligned with M3.2; NEW source-side pre-refactor table for `chain-runtime.ts` + `artifact-registry.ts`
- `implementations-plan/M3/5/plan.md` — major pre-refactor section for dispatcher + scope-enforcement decoupling; NuloWalletInfo risk promoted to HIGH with factory fix; capability-map count 15→14
- `implementations-plan/M3/7/plan.md` — `typecheck:all` + `test:all` scripts expanded to all 7 packages with intentional-testless annotations
- `implementations-plan/M3/testing-plan.md` — Queue priorityPass value assertions + title fix; makeLogger cast simplified; EntityStorage + ValueStorage tests added (13 cases); M3.4 test-stay pattern; M3.7 smoke tests dropped; capability-map 15→14
