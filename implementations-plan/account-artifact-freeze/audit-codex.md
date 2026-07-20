# Codex audits — account-artifact-freeze (mid tier: r1 + final fresh-context pass)

Both sessions: gpt-5.6-sol @ xhigh, read-only sandbox, repo cwd at `dev` @ `cff0ba2`.

---

## Round 1 — fresh session, on draft v1 (session `019f80c5-efd9-7723-9cb1-d90db2285e05`)

### Verdict

`reject (with blocking findings: the rotation model is self-contradictory, old-artifact
compatibility is unproved, and the mismatch state is underspecified)`

### Response (verbatim)

#### (1) Adversarial/security

- A non-empty `ROTATION_ACK` is ceremonial: an attacker can update artifact, constants, vectors,
  and prose coherently. The real controls are immutable history, CODEOWNERS/review, and
  provenance. Make V5 manifests append-only; rotation adds V6 rather than editing V5. Editing the
  tuple contradicts "V6 is never an in-place upgrade."
- Vendoring the raw compiler JSON does not fully freeze its runtime meaning: current
  `loadContractArtifact`, class-id hashing, ABI encoding, and instance hashing still interpret
  it. Pin both raw provenance and the canonical loaded-artifact/class preimage.
- `@aztec/accounts` still feeds addresses through `deriveSecretKeyFromSigningKey`; Outline B also
  retains constructor construction, and both retain upstream Schnorr witness behavior. The "npm
  no longer feeds address derivation at all" claim is false.
- A green address KAT says nothing about executability. New entrypoint payloads, signature-limb
  encoding, simulator semantics, proving system/VKs, constructor handling, or node verification
  can reject the frozen bytecode while preserving the old address.
- "Funds are safe" and "seed still recovers" are too categorical. Recovery also requires an
  authentic V5 implementation and protocol compatibility. The UI must never solicit the seed,
  link to an import site, recommend deletion, or leak internal details to dApps.

#### (2) Assumption attack

**Facts**

- F1 omits the second upstream constructor-args read in `nulo-account.ts:206`. Phase 2 must
  replace both paths with one shared value.
- `getImmutablesHash()` currently merely inherits `undefined`, which stdlib converts to
  `Fr.ZERO`; there is no substantial immutable-construction algorithm to copy.
- F2's provenance documentation is inconsistent: the KAT comments and reference-project
  description say 5.0.0, while its pins, tarball digests, and vectors say 5.0.1. Fix this before
  treating it as authoritative.
- F3–F5 and F7 are substantially correct. F6 is only a superficial precedent:
  `IMPORT_BLOCKING_ACK` acknowledges migration versions, not consensus identity rotation.

**Inferences**

- I1 is unsafe: "node never re-derives the address" does not establish that current
  PXE/simulator/prover/node accepts old circuits and entrypoint semantics.
- I2 understates B's risk; a constructor-helper change defeats the goal even without a protocol
  reset.
- I3 needs measurement. Importing `SchnorrAccountContract` may retain the npm artifact too,
  producing duplicate bundle/startup cost.

**Asks**

- Define what "new V6 extension" operationally means: separate extension ID/store listing,
  coexistence, backup import, persisted regime, and recovery availability.
- Decide the mandatory response to compatibility failure: hold the Aztec bump or ship V6.
- Choose and document artifact provenance: npm integrity, upstream commit/tag, extraction
  procedure, and ideally reproducible build evidence.

#### (3) Outline A vs B

Choose revised A. The current frozen inputs are just constructor name, `[publicKey.x,
publicKey.y]`, and zero immutables. Implement one small local instantiation descriptor and reuse
its exact args for both address derivation and first-tx constructor execution. Do not create a
50-line shadow account class. B is tripwire-only and is not acceptable for the stated production
guarantee.

#### (4) Phases/gates

- Replace `bun run test` with `bun run test:all` or the aztec-runtime suite: the extension runner
  explicitly excludes `derivation-vectors.test.ts`; `audit:vue` therefore also misses the KAT.
- Add a required per-Aztec-bump network compatibility canary: frozen V5 stored address, current
  libraries/node, first-account initialization, simulation, real proof and node acceptance,
  subsequent transaction/auth witness, and restart/recovery.
- Phase 4 must cover RPC subclass reconstruction plus every consumer path. Mismatch can arise
  during fee estimation, send, dApp execution, and views; one component test does not prove a
  handled state. Prefer a centralized blocking state with sanitized dApp errors.
- Gate Chrome and Firefox builds and measure bundle duplication.

#### Looks fine

Vendoring, raw digest plus class-id plus KAT defense-in-depth, no automatic deletion, explicit
policy documentation, and build/smoke validation are all sound directions.

---

## Final fresh-context pass — new session, on consolidated v2 + decision ledger
(session `019f80d0-a7d2-7510-a2ab-c598da06f87d`)

### Verdict

`conditional approve (with conditions: add a dedicated execution canary, define atomic
integrity-state ownership and regime persistence, harden append-only enforcement, and correct the
gates)`

### Response (verbatim)

1. Phase 4 is still partly resolved in name only. `tx-sendTx-multicall` stops after entering
   proving; `authwit-variants` accepts either `ok` or `error`. Only `transfers` and
   `tx-sendTx-default` currently exercise real proof submission, and none explicitly establishes
   "initialization nullifier absent → frozen ctor executed → simulate → real prove → node
   acceptance → restart/recovery." Add a dedicated frozen-account canary with those assertions,
   including an authwit-consuming transaction. Run it prover-on for every Aztec bump. The CI path
   filter correctly includes Aztec-runtime source, manifests, and `bun.lock`.
2. Phase 5 needs an ownership/lifecycle design. Unlock currently opens the session before popup
   bootstrap, while `AccountService` depends on `ProfileService`; simply calling account
   integrity from unlock creates layering/cycle problems and a potential dApp execution window.
   Use a background-owned integrity coordinator/delegate that checks every stored account across
   networks before session activation, persists the blocking state across service-worker
   restarts, closes/withholds the session on failure, and sanitizes all dApp paths. The check is
   deterministic and PXE-independent, so transient PXE state should not cause false positives.
   Full-backup import must check only after account restoration and before `finalizeRestore`.
3. Regime rotation is underspecified. `REGIMES` omits the descriptor identity, although
   constructor name/arguments/salt/deployer/immutables are address inputs. Include a descriptor
   version/digest. Hardcoding only `nulo-v5` does not make later entries append-only;
   independently pin every historical entry and validate unique IDs, valid active pointer, and
   ACK-to-digest binding.
4. Moving `ACTIVE_REGIME` makes existing stored accounts ambiguous unless each account/backup
   records its regime. Either make each extension major compile-time single-regime and forbid an
   in-place pointer move, or persist `regimeId` and reconstruct old accounts through their
   recorded regime. A1 must define whether V5 backup accounts are preserved under V5 derivation
   or rebuilt from seed as V6 accounts.
5. The descriptor-consistency test should cover more than argument equality: both paths must use
   the descriptor's constructor name and all fixed fields, and the emitted constructor
   `FunctionCall` selector/arguments should correspond to the same initialization hash used for
   address derivation.
6. Gate contradictions remain: root `bun run typecheck` checks the extension, not all
   workspaces—use `typecheck:all`. Phase 7 requires Firefox but its command omits
   `build:firefox`. Also confirm required CODEOWNER review is enabled; the current default
   CODEOWNER already covers every file, so adding same-owner paths alone adds no enforcement.

Resolved properly: raw-artifact vendoring plus digest/class-ID/KAT tripwires; the dual-site
shared descriptor; separation of address drift from execution compatibility; typed, sanitized
mismatch handling without deletion or seed solicitation; and the corrected `test:all`/network-E2E
framing.

---

## Post-audit verification + disposition (by the drafting agent)

Checkable claims verified in-tree before adoption: the KAT's absence from root `test`/`audit:vue`
(root `test` is extension-only; the KAT rides `test:all`); the regime-b 5.0.0-prose/5.0.1-pins
drift; `typecheck:all` + `build:firefox` script names; raw `SchnorrAccount.json` in
`@aztec/accounts/artifacts/`; upstream ctor-args/immutables dist code. Disposition of every
finding is recorded in plan.md's Decision ledger; all r1 blocking findings and all six final-pass
conditions are folded into v3 (append-only one-regime-per-major record, dedicated Phase 4 canary,
background integrity coordinator, hardened consistency test, corrected gates).
