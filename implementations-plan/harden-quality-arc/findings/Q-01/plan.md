# P19 / Q-01 — boundary codecs at persistence/RPC/dApp/backup seams

**Tier:** mega-deep, TRUST-BOUNDARY (registry cluster P15/P18/P19/P20).
**Status:** BLUEPRINT CONSOLIDATED (main leg + codex `bg0v9z0zg` xhigh + Explore `a9a53645` storage/messaging + Explore `a15253dc` backup/dApp/PXE; opus leg env-blocked). Impl NEXT on `dev-quality` (HEAD `a24531a`).

## Finding
Storage + messaging return `JSON.parse(...) as T` / `res as T`; dApp payloads are `unknown` asserted to a caller-supplied generic; backup import reconstructs the envelope with `Record<string,unknown>` casts + 7 `as never`. aztec-runtime pxe/client.ts proves zod rehydration then skips it on some methods. Refactor: storage takes a parser/schema; messaging/dApp/backup decode by method/kind; PXE uniform.

## STEP 1 (verified HEAD a24531a — all casts persist)
`entity_storage.ts:49`, `value-storage.ts:21`, `decode.ts:15`, `utils.ts:22,28`, `pxe/client.ts:92,194`, `useDappInteractionPayload.ts:86`, `useFullBackupImport.ts` (7 `as never`).

## THE central risk (codex — do not lose this)
`entity_storage.parseOrDelete` DROPS a row on parse-throw (fire-and-forget `remove`). A stricter codec that rejects a shape the app FRESHLY WROTE → the row VANISHES as a silent empty read = WORSE than the cast. **Rule (codex #1,#6): SPLIT JSON-SYNTAX failure (may keep today's delete policy) from CODEC-VALIDATION failure (must NEVER delete — "present but unreadable": throw / explicit-invalid / quarantine).** A codec exception must NOT flow through the delete path. Round-trip corpus is necessary but NOT sufficient (only proves known writes). A decoder must NEVER be LAXER than the cast it replaces (trust boundary; frozen `method-descriptors` oracle UNEDITED).

## Re-scope (the finding is "weeks"/5 seams → shrinks to a safe core; codex: "don't run as one mega-phase")
- **P19a = STORAGE policy split + injected-parser codec (THE safe core, high value).** codex + Explore #1. Steps: (1) PIN ValueStorage's currently-UNPINNED throw-on-bad-JSON (value-storage.test.ts has no malformed-row test). (2) `EntityStorage<T>`/`ValueStorage<T>` take an optional injected `parse?: (raw: unknown) => T` (wallet-core has ZERO zod by design → the parser is INJECTED; zod schemas stay in apps/extension; `(root, area)` ctor is the injection point, `MinimalStorageArea` DI is the precedent). (3) SPLIT error semantics: JSON-syntax-fail → today's policy (EntityStorage drop / ValueStorage throw); validator-fail → NEVER delete. (4) Migrate **operation-journal FIRST** — it ALREADY hand-rolls the exact layer-2 (`_loadValidated`/`_loadAllValidated`: `OperationRecordSchema.safeParse` → drop+delete), so injecting its schema is BEHAVIOR-PRESERVING + proves the shape + a write→read round-trip corpus. (5) Other namespaces incrementally (own PRs).
- **PXE-uniform = DEMOTED to optional/marginal.** Explore #2: 13/15 methods already `parseAsync`; the 2 casts are JUSTIFIED — `getNoteSchemas` returns plain data (`NoteSchema` is a plain TS type, no branded fields, no zod schema exists → lossless cast) and `getBlockTimestamp` uses `Number()` coercion (strict `z.number()` = a BEHAVIOR CHANGE, rejects a malformed timestamp instead of coercing). Not worth the behavior-change risk. **SKIP** (or a tiny follow-on only if a NoteSchema zod is written).
- **P19b RPC method-level decode = DEFER.** decode.ts binds T=`unknown` (zero narrowing); per-method result schemas would attach at `handleResponse` (`entry.method` in scope) but that's a big surface coupling to method-descriptors; malformed already rejects (fail-closed). Keep correlator behavior; no fallback defaults. Separate PR.
- **dApp discriminated decoder = DEFER (SW change + trust-boundary behavior change).** Explore #2: the 3 payloads have NO envelope discriminant (Execution/Capability structurally identical top-level); the SW-computed `type` is DISCARDED before the client (`DappInteraction` record has no kind). A decoder needs threading `type` onto the record FIRST — a real SW-service change. The route is the de-facto discriminant today (each window supplies its generic). Desirable fail-closed, but its own phase.
- **Backup import = DEFER (compat-sensitive; heterogeneous restore typing).** Explore #2: only v2 exists (no v3 — writer emits 2, reader rejects else); NO envelope schema; checksum key-order is load-bearing; the 7 `as never` erase genuinely DISTINCT `restore` signatures (account-state takes 2 args — now a MANUAL loop invariant). A schema must accept every real v2 export (fixture first). Preserve raw for checksum; `.passthrough()` service slices. Its own careful phase — do NOT risk a user unable to restore.

## Oracle / trust-boundary proof (P19a)
- ValueStorage throw-on-bad-JSON PINNED first (new test) before touching it.
- EntityStorage: a test proving CODEC-VALIDATION failure NEVER deletes (distinct from the existing JSON-syntax drop test which stays green).
- operation-journal: behavior-preserving — its existing `_loadValidated` drop+delete tests stay green after migrating to the injected codec.
- write→read round-trip corpus for the migrated namespace(s).
- Frozen `method-descriptors.test.ts` FROZEN_* UNEDITED (git diff --exit-code) + wallet-bridge adversarial-bypass re-run (registry-cluster rule).

## Security & Adversarial
Threat: malformed/hostile persisted data or a wrong-shape RPC/dApp payload treated as a trusted domain object. The codec must FAIL-CLOSED (reject) NOT fail-open (default/empty). The silent-data-loss trap is the inverse risk (a too-strict codec deleting valid data) — guarded by the syntax/validation split + round-trip corpus. Serializers DIFFER per seam (storage raw `JSON.stringify` vs RPC `jsonSanitize`) → PER-SEAM codecs; do NOT standardize serializers (BigInt/Date/AztecAddress/Fr wire shapes differ).

## Assumptions
- Facts: file:line + surface from both Explore maps (HEAD a24531a).
- Inferences (attack at impl): (a) injecting operation-journal's schema is byte-behavior-preserving (verify vs its tests); (b) the storage serializer round-trips every entity shape the app writes (the corpus proves it); (c) demoting PXE-uniform loses no real safety (the 2 casts are justified plain-data).
- Asks: none for owner now. Backup/dApp deferrals are documented follow-ons (not owner-gated unless a persisted-shape change is forced).

## Ordered steps (P19a)
1. Pin ValueStorage throw-on-bad-JSON. Gate: wallet-core test.
2. Add optional injected `parse?: (raw)=>T` to EntityStorage/ValueStorage; split syntax-vs-validation error semantics (validation-fail never deletes). Gate: wallet-core units (incl. the never-delete-on-validation-fail test) + typecheck:all.
3. Migrate operation-journal to inject `OperationRecordSchema` (absorb `_loadValidated`); its existing tests stay green + add the round-trip corpus. Gate: operation-journal units + full ext.
4. Per-arc tail: `/code-review max --fix` → codex post-impl audit → fix loop.
5. Gate PR `qa/Q-01-storage-codec`: frozen oracle UNEDITED + adversarial-bypass + units + smoke + full network → plain squash-merge (no --admin).
6. Re-run P15 adversarial-bypass + frozen oracle vs new HEAD (registry-cluster).
   PXE-uniform SKIPPED (justified casts); RPC decode / dApp / backup = deferred follow-ons.

## Decision ledger (main + codex bg0v9z0zg + Explore a9a53645 + a15253dc)
- **central rule** → split JSON-syntax-failure (keep policy) from codec-validation-failure (NEVER delete). Round-trip corpus necessary-not-sufficient.
- **codec shape** → INJECTED `parse: (raw:unknown)=>T` (wallet-core has no zod); zod schemas stay in apps/extension. Per-seam (serializers differ).
- **first seam** → STORAGE policy-split + operation-journal migration (behavior-preserving, high value). NOT PXE (marginal).
- **PXE-uniform** → SKIP (2 casts justified: plain-data / coercion; strict validation = behavior change on getBlockTimestamp).
- **RPC decode** → defer (big surface; malformed already rejects).
- **dApp** → defer (needs threading the SW `type` onto the record; fail-closed behavior change).
- **backup** → defer (v2-only, no schema, checksum key-order load-bearing, heterogeneous restore typing; rejecting a restorable backup is worse than the casts).
