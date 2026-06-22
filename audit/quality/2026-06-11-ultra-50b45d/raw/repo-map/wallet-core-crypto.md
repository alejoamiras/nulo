# Map — @nulo/wallet-core + @nulo/wallet-crypto

Mapper: Fable Explore subagent. Repo history starts 2026-05-19 → "3 months" git data ≈ 4 commits.

## wallet-core

Zero runtime deps. Subpath exports: `.`(empty), /ports, /testing, /utils, /storage, /base, /logger, /jobs — raw TS.

### Inventory (LOC)
base/index 71 (ServiceCollection + contracts) · base/topology 105 (Kahn's) · jobs/{index 12, types 98, fsm 106, error 77} · logger/interfaces 49 · ports/* (types 6, browser-api 18, storage 44, runtime 68, clock 24, alarms 36, window 29, background-ticker 40) · storage/{entity_storage 143, value-storage 33} · testing/{fake-browser-api 296, mock-clock 96, fake-background-ticker 66} · utils/{arrays 53, errors 3, event-handler 29, lock 69, **mnemonic 2160** (2048-word BIP-39 wordlist inline + ~120 code), queue 60, random 24, rw-guard 155, serialization 61, sleep 1}.

### Consumed (counts)
EventHandler 50 · getErrorMessage 25 · ILogger 14 · LogLevel 13 · FakeBrowserApi 9 · getErrorData 8 · BrowserApi 7 · EventsMap/MethodsMap 6 each · jsonSanitize 5, JobCancelledSentinel/JobStage/JobProgress 5 each · ClockPort/TimerHandle 5 · … EntityStorage/ValueStorage via extension wallet/storage barrel.

### Dead-export candidates (zero external refs, grep-verified)
getRandomElement (random.ts:18) · IEventHandler · topologicalPhases/DependencyCycleError/UnknownDependencyError/ServiceNode (base/index:33-34 re-export; internal-only) · TERMINAL_STAGES/canTransition · MessageSender (ports; externals use chrome.runtime.MessageSender) · MinimalStorageArea (only a comment mention) · LogContext.
Method-level dead: EntityStorage.getVersion/setVersion (:62,:80), EntityStorage.findByPredicate (:137), Queue.dequeueBatch (:47).

### Similarity (incl. within wallet-core itself)
- sleep.ts ↔ extension core/adapters/system-clock.ts:14 inline duplicate.
- Lock ↔ extension execution-mutex.ts — documented deliberate divergence (no timeout/force-release).
- **THREE stringify variants in one package**: jobs/error.ts jsonReplacer (71-77) vs utils/serialization.ts jsonStringify replacer (24-57) vs utils/arrays.ts private safeStringify (23-39).
- errors.ts getErrorMessage/getErrorData ↔ extension-messaging WalletError payload round-trip — same concern split across layers; messaging header describes superseding getErrorMessage, yet 25 import sites remain.
- entity_storage parseOrDelete (47-60) vs getVersion (62-78) — near-identical malformed-payload log+delete blocks in one class.
- extension general.js debounce — stranded timer helper, no wallet-core home.
- EventHandler is the single pub/sub everywhere (50 sites) — no competing emitter.

## wallet-crypto

Deps: @aztec/foundation, **@aztec/stdlib (DECLARED BUT NEVER IMPORTED — dead dep)**, wallet-core. Single export `.`.

### Inventory
index 22 · constants 10 (PASSKEY_PRF_LABEL, frozen) · encryption-key 116 (PBKDF2 600k → AES-GCM-256) · password-secret-box 199 (seal/unseal/reseal + ENCRYPTION_GUARD) · passkey-credential 71 (PRF → HKDF → Fr) · zeroize 49 · globals.d.ts 21.

### Consumed
PasskeyCredentialData 11 · EncryptionKey 6 (incl. bridge-core recovery-crypto) · PasskeyCredential 5 · PASSKEY_PRF_LABEL 2 · zeroize 2 · PasswordSecretBox 1.

### Dead-export candidates
ENCRYPTION_GUARD (index:19) — zero external imports · EncryptedProfileSecret type — consumers pass structural literals instead · Sealed type — consumers destructure.

### Conventions + drift
biome bans upper layers + chrome global per layer. README drift (factual): wallet-crypto README "250k iterations" vs PBKDF2_ITERATIONS=600_000; README mentions recoverFromCredentialData() which doesn't exist; wallet-core README omits src/jobs/; serialization.ts comment claims `"types": []` but tsconfig has `["node"]`.
Key-vector lock: extension/src/wallet/crypto/key-vectors.test.ts (215) — byte-identical derivation pin, both READMEs require it.

### Hotspots
4 commits total; jobs FSM only repeat-change surface in wallet-core; password-secret-box only one in wallet-crypto.

### Size outliers
mnemonic.ts 2160 (49% of wallet-core non-test LOC, 2 consumed exports, 1 import site each) · rw-guard.test 409 (2.6× subject) · fake-browser-api 296 · password-secret-box 199 (half docs). Opposite end: sleep.ts 1, errors.ts 3, logger/index 1, storage/index 2.
