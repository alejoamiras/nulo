# Codex audit transcripts — profile-service-dedup

## Round 1 — blueprint audit (xhigh, gpt-5.6-sol, verdict: reject)

### Independent positions

1. **(a) Private `ProfileService` methods.** Stateful or lock-assuming helpers belong on the service with `…HoldingLock`; a separate module would expose too many internals. Pure projections need not become helpers merely to satisfy jscpd.
2. **(b) Decompose unlock phase-3 per method.** Password ciphertext equality and passkey fingerprint recomputation are different security algorithms; parameterizing them would hide invariants.
3. **(c) Preserve zeroization per site.** Keep password DEK cleanup after lock release and passkey cleanup inside the locked callback. Changing either is outside a behavior-preserving refactor.

Ledger reconciliation: I agree with all three ledger choices (`plan.md:123-125`). The conclusions are sound independently, though “everything becomes a private method” is broader than necessary.

## Security

- **[blocker] `unsealForExport` is not behavior-preserving and has an unsafe ownership contract.** The plan includes `assertEntropyMasterPair` for all four callers (`plan.md:33`), but `exportImportedKeysDek` performs no pairing check (`service.ts:1740-1763`), while `exportMnemonic` derives words *before* pairing validation (`service.ts:1816-1817`). Moving the assertion changes tampered-storage behavior and error precedence. Worse, if the helper unseals, asserts, then throws before returning, the caller never receives the buffers its `finally` must wipe (`service.ts:1764-1769`, `1826-1834`). A storage attacker would target exactly these failure paths.

- **[high] The proposed error matrix is wrong.** `exportPlain` internally throws `InvalidPasswordError` but deliberately flattens it to plain `Error(message)` (`service.ts:1576-1617`). Only `exportBackupMaterial` and `exportImportedKeysDek` expose the typed error (`service.ts:1651-1654`, `1746-1749`); `exportMnemonic` exposes its special plain error. The existing test checks only `exportPlain`’s message (`service.integration.test.ts:387-391`) and the backup test checks neither type nor message (`:762-766`). Pin exact constructors and messages before extraction.

- **[high] Restore has an omitted lock-boundary deviation.** Password restore converts failures with `toRestoreError` inside the locked callback (`service.ts:2254-2267`); passkey restore converts after `runExclusive` releases (`service.ts:2387-2394`). A shared branch/marker abstraction could silently move this boundary. The suite does not exercise side-effectful error conversion.

- **[high] The concurrency suite is being overtrusted.** Password and passkey tests accept either race outcome without controlling phase-2 (`service.integration.test.ts:251-318`, `851-868`); the confirm test explicitly settles for “no deadlock” (`:351-370`). They do not prove PBKDF2/WebAuthn remains outside the lock, exact acquisition count, or stale-generation rejection at a forced interleaving. Add deterministic phase barriers.

- **[medium] Event-order evidence contradicts itself.** Current creation/import order is `repo.set → onProfileAdded → openSessionVerified` (`service.ts:413-417`, `2009-2012`), yet recon says “commit/open then emit” (`recon.md:48`). No integration test pins `onProfileAdded` versus `onActiveProfileChanged`, including when integrity verification rejects.

## Assumptions

### Facts

- **[high] Fact 2/F7 are misstated.** F5 is not five byte-identical blocks: some refetch inside a lock (`service.ts:1091-1095`, `1820-1824`), while others prefetch outside it (`:1595-1597`). F7 falsely includes a pairing assertion in `exportImportedKeysDek` (`recon.md:37-39` versus `service.ts:1746-1755`).

- **[medium] Fact 3’s rationale is unsupported.** Repository-wide, the visible string consumer is the change-password UI handling `changeProfilePassword` (`change-password.vue:41-42`, `75-80`), not an import flow. Preserve the string, but correct the claim.

- **[high] Fact 5 overstates coverage.** This is the only real-service test file, but its named race suites do not “pin exactly” the phase shapes (`recon.md:54`).

- **[nit] Facts 1, 4, and 6-8 hold.** The manifest records 8+3 (`manifest.json:58`, `132`), the zeroize positions differ, commit `3f6a0528` added only directives, and the shrink-only rules are explicit (`CLAUDE.md:80-86`).

### Inferences

- **[high] Residual suppressions are not an allowed fallback.** `plan.md:65` permits “justified residue,” contradicting the stated task and zero-directive target at `plan.md:94`.

- **[medium] Calling the F4 tombstone omission “incidental” is evidence-free.** Both mutation methods omit the check (`service.ts:869-895`). Under the owner’s rule, preserve it and add `(BUG PIN)` coverage; do not encode it as an optional security boolean.

### Asks

- **[high] Surface and resolve zero residue versus permitted residue.**
- **[medium] Explicitly record the F4 omission as pinned behavior, or move any intended fix to another PR.** “No asks open” (`plan.md:70`) is premature.

## Implementation

- **[high] Drop the error-factory abstraction.** Share only `sealedTriple`; keep null-error selection, pairing order, revalidation, and zeroization in each export caller.
- **[high] Use separate `getProfileRowHoldingLock` and `getLiveProfileRowHoldingLock` methods rather than a `checkReserved` flag.**
- **[high] Do not use `commitProfileRowHoldingLock` inside restore’s compensation bracket unless it excludes event emission; compensation currently catches only `repo.set`, then emits (`service.ts:2225-2235`).
- **[medium] Restore/finalize last is correct, but split password change, delete, and resume into separate gated steps. Add final `audit:dup`; the phases currently never verify the 13-clone goal despite `CLAUDE.md:87`.

**Verdict: reject (with blocking findings: redesign `unsealForExport` and its secret ownership; pin the real error/lock/event contracts; require all 11 suppressions removed).**

## Round 2 — resumed with the v2 plan + adjudications (verdict: conditional approve)

V2 resolves the round-1 blockers. The export, restore-catch, F1 compensation, F4, event-order, and F5 designs now match the current behavior.

Remaining helper-contract findings:

- **[high] `unsealTrustedDekHoldingLock` still has a pre-return ownership hole.** Today the caller assigns `dek` before MAC verification, so its outer `finally` wipes it if verification throws (`service.ts:512-549`, `2506-2542`). In the proposed helper, the DEK remains local until return. `verifyEnvelopeMacV3` can reject during `macKeyV3`, outside its internal catch (`entropy-mac.ts:99-110`), leaving the caller’s `dek` null. The helper must catch every exception after successful unseal, zeroize its local DEK, then rethrow unchanged. Apply the same rule to the proposed change-password “prologue-unseal” helper: allocation must either occur in the caller before fallible work or be cleaned by the helper on pre-return failure.

- **[medium] `fenceStillCurrent` has contradictory polarity.** Its name is positive, while `plan.md:32` describes the negative broken-fence expression. Define it explicitly as `row exists && !reserved && isCurrent`, with callers negating it, or rename it `profileFenceBroken`. This avoids a five-site inversion error.

- **[medium] Make the passkey barrier pin mandatory.** The disposition says it is adopted and the existing stub supports it, but `plan.md:79` still permits omitting it if not “cheap.” The held position against a password harness is reasonable; the adopted passkey pin should not remain optional.

The other contracts hold under attack:

- `captureRowFence`: whole-lock capture preserves atomicity and acquisition count.
- `snapshotForUnlock`: preserves the asymmetric type arms, including hypothetical third-type behavior.
- `writeMarkerThenRowHoldingLock`: correctly limits compensation to `repo.set`; emit remains outside.
- `persistNewProfileHoldingLock`: safe only at the four specified create/import sites.
- Log-context parameterization is acceptable if it produces the existing messages byte-for-byte.

Held positions:

1. **Residue policy accepted as adjudicated.** Explicit owner-authorized, targeted zero, sign-off required.
2. **Password deterministic harness accepted as adjudicated.** A prototype spy could technically provide a seam without production changes, but requiring it is not justified once the passkey barrier and lock-boundary diff audit are mandatory.

**Verdict: conditional approve (with conditions: close every pre-return secret/DEK cleanup path in extracted helpers; make fence-helper polarity explicit; make the deterministic passkey pin mandatory).**

## Round 3 — post-implementation audit on the final diff (verdict: approve)

No behavior-preservation or security defect found. The lock ownership, fences, event sequence, error identities, and secret cleanup hold after attack:

- `captureRowFence` and `snapshotForUnlock` acquire the whole critical section (`service.ts:314-360`).
- Fence polarity and locked/lock-free call-site wrapping remain exact (`service.ts:328-329,1165-1169,1644,1759,1843,1897-1901`).
- Extracted crypto helpers wipe allocations before rethrow (`service.ts:397-400,986-990,1029-1033`).
- Restore scratch fields are populated immediately after allocation and ownership transfer (`service.ts:2305-2313,2351-2356,2516-2532`), with cleanup still post-lock-release.
- Every `…HoldingLock` invocation is under `runExclusive`; `writeMarkerThenRowHoldingLock` preserves marker → row → compensation with no emit (`service.ts:1354-1361`).
- The overloads/`Extract<>` parameters are sound against the current two-member `Profile` union, and the unlock phase-3 checks still independently revalidate live rows.

Findings:

- **[nit]** The wrong-password comment is factually misleading: `exportMnemonic` claims “the import flow” string-matches its error, while the verified consumer is the change-password flow consuming `changeProfilePassword`. The new test repeats the conflation. Say only that the legacy identity is intentionally pinned, and attribute the UI consumer solely to password change. `service.ts:1885-1886`; `service.integration.test.ts:2668-2669`.

- **[nit]** Several production comments retain review archaeology instead of durable rationale: “codex audit round 2,” “final-audit blocker/fact correction,” “round-1 audit HIGH,” and “P3/P4 rider.” Remove those labels while retaining the actual invariant. `service.ts:1293,2307,2483,2512,2604,2623`.

- **[nit]** Some new comments narrate the refactor rather than the resulting contract—especially “pre-split/byte-equivalent” scratch commentary—and `sealedTriple`’s comment mostly restates its one-line body. Condense to ownership and lock requirements. `service.ts:63-68,291-294,2283-2285,2364-2384`.

- **[nit]** Four surviving clones are technically justified; forcing any of the proposed mergers would recreate rejected or high-parameter abstractions. However, the permanent plan still states `≤3` as a passed gate while the lessons record four. Reconcile the gate as an explicitly accepted exception. `plan.md:105`; `lessons/phase-1-5.md:9`.

**Verdict: approve.**