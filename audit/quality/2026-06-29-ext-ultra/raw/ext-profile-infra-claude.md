# QUALITY findings — `extension/wallet-services-profile` + `extension/wallet-infra`

Scope: `packages/extension/src/wallet/services/profile/**`, `wallet/storage/**`,
`wallet/config/**`, `wallet/logger/**` (excl. `*.test.ts`). Lens: typing + dedup.

---

### PI-1 Secret/key material flows as bare `string` / `ArrayBuffer` / `Uint8Array`; `masterKey` is an overloaded string
- Smell: Primitive Obsession (+ Stringly-Typed for the overloaded `masterKey`)
- Lens: typing
- Maintenance impact: architectural
- Blast radius: `profile/service.ts`, `profile/session-manager.ts`, `profile/spec.ts`, `profile/passkey-recovery-coordinator.ts` (+ the `@nulo/wallet-crypto` API they consume — coordinate with the wallet-crypto cluster on where the brands live)
- Instances:
  - Passhash as bare `ArrayBuffer`: `service.ts:817` (`importPasswordProfile(... passhash: ArrayBuffer)`), `service.ts:924` (`let passhash: ArrayBuffer | undefined`); `session-manager.ts:79-82` (`SessionSecretUnsealer` `passhash: ArrayBuffer`), `session-manager.ts:202` (`open(..., passhash?: ArrayBuffer)`).
  - Master-secret bytes as bare `Uint8Array<ArrayBuffer>` / `Buffer<ArrayBuffer>`: `service.ts:80` (`pendingRestoreSecrets: Map<string, Uint8Array<ArrayBuffer>>`), `service.ts:817/847`, `session-manager.ts:202`; `passkey-recovery-coordinator.ts:38-43` (`PasskeyRecovery.secret: Buffer<ArrayBuffer>`).
  - Secret-bearing `string` fields, all undifferentiated: `spec.ts:22-23` (`Profile.guard: string`, `Profile.secret: string` = base64 ciphertext), `spec.ts:27` (`credentialId: string`), `spec.ts:35` (`Session.passhash?: string` = base64 passhash).
  - **Overloaded `masterKey: string`**: `spec.ts:262` + `service.ts:888`. Documented at `spec.ts:250-254` — for password profiles it is "base64 32-byte plain master key", for passkey profiles it is "the original credentialId". One string param means two unrelated domain concepts, disambiguated only by the sibling `profile.type`.
  - Casts these bare types force: `service.ts:159` (`Fr.random().toBuffer() as Buffer<ArrayBuffer>`), `service.ts:628` (`Buffer.from(secret, "base64") as Uint8Array<ArrayBuffer>`), `service.ts:928` (`plainSecret as Uint8Array<ArrayBuffer>`).
- Evidence: nothing in the type system distinguishes a passhash from a master-secret buffer from a base64 ciphertext from a credentialId — they are all `ArrayBuffer` / `Uint8Array` / `string`. The `masterKey` overload is the sharpest case: `restore(profile, masterKey, ...)` accepts the credentialId in the same slot a 32-byte key normally occupies.
- Why it harms future change: a transposition bug (passing `Profile.secret` ciphertext where a plain master is expected, or a credentialId where master bytes are expected) compiles cleanly and only fails at decrypt-time — exactly the class of error that branding catches for free. Every new secret-handling method must re-document "which kind of string/buffer is this" in prose (see the eight JSDoc blocks already doing so) instead of letting the signature say it. The owner explicitly asked for branded secret/key types.
- Refactoring: Introduce Branded Types (`Passhash`, `MasterSecretBytes`, `Base64Ciphertext`, `CredentialId`) — ideally minted in `@nulo/wallet-crypto` so the seal/unseal API hands them out already-branded — and split `restore`'s `masterKey` into a discriminated payload (`{ type:"password"; masterKey: Base64MasterKey } | { type:"passkey"; credentialId: CredentialId }`) aligned with the existing `Profile` union. Removes the cross-method "which string is this" ambiguity and the three secret-material casts.
- Effort: days (cross-package; gate on the wallet-crypto cluster's branded-type decision)
- Confidence: high

---

### DUP-1 `runExclusive` helper exists but 22 facade lock sites hand-roll its body
- Smell: Duplicate Code (with a Middle-Man twist — the de-dup helper is defined, then bypassed)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: `profile/service.ts` (the 1109-LOC facade)
- Instances: `runExclusive` is defined at `service.ts:113-120` as exactly `try { await this.lock.enter(); return await fn() } finally { this.lock.leave() }`, but is passed **only** to `SessionManager` (`service.ts:97`). The facade's own 22 lock acquisitions all paste that same `try { await this.lock.enter() … } finally { this.lock.leave() }` skeleton inline: lines 143/148, 162/181, 203/213, 232/250, 282/308, 323/330, 340/353, 377/393, 440/443, 450/453, 460/476, 483/529, 543/550, 589/616, 674/695, 805/808, 819/834, 851/873, 926/960, 988/1021, 1057/1106 (the `enter()`/`leave()` pairs).
- Evidence: 22 copies of an idiom for which an identical private helper already lives in the same class. The crypto methods additionally interleave `zeroize(secret); zeroize(passhash)` in the same `finally` (30 `zeroize(` calls total in this file), but those can wrap `runExclusive` with an outer `try/finally` since the buffers are allocated before the lock is entered (e.g. `createProfile` at `service.ts:159-188`).
- Why it harms future change: any change to the locking discipline (timeout, telemetry, re-entrancy guard, switching `Lock` impl) must be applied 22 times by hand; one missed `finally` leaks the facade lock and wedges every subsequent profile RPC. The hand-rolled form also obscures that all these methods share one concurrency contract.
- Refactoring: Extract Method already done — just *apply* it. Route the simple single-phase methods (`getActiveProfile`, `getPasskeyCredentialId`, `lockActiveProfile`, `refreshSession`, `changeProfileName`, `deleteProfile`, `exportEncrypted`, `getProfileSecret`, each locked phase of the multi-phase ones) through `runExclusive`; wrap the crypto methods as `try { return await this.runExclusive(...) } finally { zeroize(...) }`. ~22 try/finally skeletons collapse to call sites.
- Effort: hours
- Confidence: high

---

### DUP-2 `getProfileInfo` / `toInfo` — byte-identical projection duplicated across two files
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: local
- Blast radius: `profile/service.ts`, `profile/session-manager.ts`
- Instances: `service.ts:878-880` `private getProfileInfo(profile): ProfileInfo { return { id, name, type } }` and `session-manager.ts:459-461` `private toInfo(profile): ProfileInfo { return { id, name, type } }` — same three-field `Profile → ProfileInfo` projection, two names, two classes. `getProfileInfo` is called 14× in the facade; `toInfo` 1× in the manager (`session-manager.ts:221`).
- Evidence: identical bodies; the only difference is the method name.
- Why it harms future change: `ProfileInfo` is the wire-facing shape (it crosses the RPC boundary and feeds `onActiveProfileChanged`). When a field is added/removed (e.g. an `avatar` or `createdAt`), both projections must change in lockstep or the manager's emitted `ProfileInfo` silently diverges from the facade's returned one — a drift that types won't catch because both produce a valid `ProfileInfo`.
- Refactoring: Pull Up / Move Function — export one `toProfileInfo(profile: Profile): ProfileInfo` from `spec.ts` (where `ProfileInfo`/`Profile` already live) and have both consumers call it.
- Effort: hours
- Confidence: high

---

### DUP-3 Three-phase passkey/password unlock + credentialId-binding checks duplicated
- Smell: Duplicate Code (structural template)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: `profile/service.ts`
- Instances:
  - Three-phase "snapshot under lock → slow credential op unlocked → refetch + revalidate under lock → open": `unlockProfile` (`service.ts:197-256`, password/PBKDF2) and `unlockPasskeyProfile` (`service.ts:334-397`, passkey/WebAuthn) are the same scaffold with a different middle step.
  - "recover credential → bind `recovery.credentialId !== expected` → throw → refetch → re-check rotation" repeated 4×: `unlockPasskeyProfile:371-373` + `385-389`, `exportPlain:723-725` + `739-741`, `restore` passkey arm `981-984`, plus the bind comment cross-refs at `service.ts:366-373` pointing back to the other copies.
- Evidence: the same lock/unlock/relock + credentialId-equality-guard sequence reimplemented per entry point; the in-code comments ("Mirrors the existing check in exportPlain (line ~656) and restore() (~916)", `service.ts:366-368`) are an admission of the duplication and a hard-coded line-number cross-reference that rots.
- Why it harms future change: a fix to the TOCTOU revalidation (e.g. also checking a future `credentialVersion`, or tightening the rotation guard) is a Shotgun-Surgery edit across 4 sites; the prose line-number references go stale the moment any of these methods grows. This is the highest-risk duplication because it guards key-material binding.
- Refactoring: Template Method / Extract — a `withCredentialReverify(id, recover, revalidate, open)` helper that owns the snapshot/unlock/refetch/rotation-check skeleton, with the credential mechanism + predicate passed in. The four bind/rotation checks collapse to one guarded path.
- Effort: days
- Confidence: moderate

---

### TYP-1 `config/store.ts` — reflective double-casts + hand-rolled typeof validation (no zod, unlike every sibling spec)
- Smell: Primitive Obsession / Reflective-access analog (mapping: the class instance is treated as an untyped `Record<string, unknown>` bag, discarding the `Config` field types to iterate it, which then forces escape-hatch casts to put the types back)
- Lens: typing
- Maintenance impact: local
- Blast radius: `wallet/config/store.ts`, `wallet/config/config.ts`
- Instances: `store.ts:47-48` (`config as unknown as Record<string, unknown>`, `this.config as unknown as Record<string, unknown>` — the only two `as unknown as` in the whole cluster), plus three `as ConfigProp` correlation-recovery casts at `store.ts:14`, `store.ts:35`, `store.ts:52`. Validation of persisted config is the hand-rolled `if (storedConfig && typeof storedConfig === "object")` (`store.ts:19`) + per-field `typeof src[key] === typeof dst[key]` reflection (`store.ts:50`).
- Evidence: the `apply` loop (`store.ts:46-56`) erases `Config`'s static types to a string-keyed bag, validates each field by runtime `typeof` comparison against the default instance, then re-asserts the union with `as ConfigProp`. The sibling background services validate persisted/RPC shapes with zod (`spec.ts` across the service graph); config alone validates by reflection.
- Why it harms future change: the `typeof`-match rule silently *drops* any stored field whose JS `typeof` differs from the default (e.g. a `number → string` shape change from a botched prior write is ignored, not surfaced), and unions of literal types (`theme: "dark"|"light"|"system"`) are validated only as `typeof === "string"`, so a corrupt `theme: "blue"` loads unchecked. The `as ConfigProp` casts mean a refactor of `ConfigProp` won't be type-checked at these emit sites.
- Refactoring: Replace the `Config` class + reflection with a zod schema (matching the rest of the service graph): `Config` type is `z.infer`, `load()` does `schema.safeParse(storedConfig)`, and `props` is derived from the schema's keys. Removes both `as unknown as` casts, gives real per-field validation (literal unions included), and aligns config with the zod-everywhere convention.
- Effort: hours
- Confidence: moderate

---

## Out-of-focus notes (not scored — correctness/security, for the relevant focus)
- `session-manager.ts:374-384` documents a latent `Buffer.from(base64).buffer` pooled-ArrayBuffer bug that is *worked around* by an explicit `.slice`. The workaround is correct, but the same `Buffer.from(x, "base64")` pattern recurs unguarded at `service.ts:628`, `654`, `913` — worth a correctness pass to confirm those paths never feed `crypto.subtle.importKey("raw", …)` with a pooled buffer.
- `config.ts:18` `strictSecurityMode` default is security-load-bearing (frozen by `config.test.ts`); the silent-drop behavior in TYP-1's `apply` could, if a stored config carried a wrong-typed value, fall back to the default — benign here but a reason to prefer explicit zod validation.

## Summary
5 findings (2 high-value). Highest value: **DUP-1** — a `runExclusive` de-dup helper is defined in `profile/service.ts` but bypassed by 22 hand-rolled `lock.enter()/leave()` try-finally blocks in the same class; tied closely with **PI-1**, the bare-`string`/`ArrayBuffer` secret/key primitive obsession (incl. the overloaded `masterKey: string`) the owner explicitly flagged for branding.
