# Audit — Faucet → Bridge plan (fresh hostile R2, Opus)

Auditor stance: fresh, unanchored, no prior-round context. Verified the load-bearing claims
against the installed packages, the Nulo repo, and the two reference repos ([holonym],
[wonderland-fee]) read-only. Findings below are ground-truth-checked except where marked
"unverified". Path convention: repo-relative · `[holonym]` · `[wonderland-fee]`.

## Verdict

`conditional approve (with conditions: (1) fix the FeeAssetHandler access-control Fact — it is PERMISSIONLESS, not onlyMinter-gated — and re-derive the Phase-1 go/no-go on the corrected mechanism; (2) add a "why not deploy the canonical @aztec/l1-artifacts TokenPortal verbatim" decision to P2 — the upstream portal already ships the exact gross-amount + Epoch-withdraw clean spec the plan hand-writes, and the deployed testnet uses it; (3) specify the bridge recovery key-derivation SOURCE — @nulo/wallet-crypto's EncryptionKey is PASSWORD-based, but the bridge has no password UX and Holonym derived the key from an L1 signature; resolve before P4/P6; (4) demote the "COOP/COEP injected-wallet is NOT a risk" Fact to a P0.5 gate — poseidon2-under-COEP is proven, injected-wallet-provider-under-require-corp is proven NOWHERE in this repo; (5) add an explicit phase/deliverable for the parallel-safe L1 (anvil + Sepolia round-trip) e2e harness — the current faucet suite is a no-network smoke test only, and CLAUDE.md mandates parallel-safe external-service e2e))`

Rationale for not rejecting: the plan's two scariest *recent* decisions — keeping `isPrivate`
in the witness, and the Phase-0.5 spike — are sound on inspection (details below). The
private-content-hash path does not open a hole. The conditions are factual corrections and
two unscoped work items, not architectural reversals.

## Critical

### C1 — The Phase-1 go/no-go is built on a FALSE Fact: `FeeAssetHandler.mint` is permissionless, not `onlyMinter`-gated

Plan Decision #5, Assumptions "Facts" ("`FeeAssetHandler.mint` is fixed-size + `onlyMinter`"),
research artifact 5 ("`onlyMinter`-gated"), and the P1 validate step ("`FeeAssetHandler.mint`
mints FJ to us") all rest on the claim that minting FeeJuice requires a minter role Nulo's
deployer might not hold — hence the "hard go/no-go: is it callable **by us**".

The real source (`node_modules/@aztec/l1-artifacts/l1-contracts/src/mock/FeeAssetHandler.sol`)
refutes this:

```solidity
function mint(address _recipient) external override(IFeeAssetHandler) {
    FEE_ASSET.mint(_recipient, mintAmount);          // NO modifier — anyone can call
}
function setMintAmount(uint256 _amount) external onlyOwner { ... }   // only THIS is gated
```

`mint()` has **no access control**. The only `onlyOwner` function is `setMintAmount`, and that
owner is the FeeAssetHandler deployer (the Aztec protocol), not Nulo. Consequences:

- The "callable by us" framing is a phantom risk. If a handler is deployed, *anyone* mints.
- `mintAmount` is a mutable storage var Nulo **cannot** set, not a ~1000 constant. The plan's
  "fixed-size (~1000/call)" is wrong-by-coincidence: the size is whatever the protocol owner
  last set, readable via the storage getter, unknown until P1.
- The REAL go/no-go is narrower and different: (a) is `feeAssetHandlerAddress` non-null in the
  target net's `getNodeInfo()` (does a handler exist at all), and (b) what is its current
  `mintAmount` (sets seeding call-count + the "fixed-size mint UX" copy). Both are reads, not
  permission probes.

**Why Critical, not Medium:** the entire swap branch (Decision #5/#D, P9) and the FeeJuice-mint
UX are gated on a risk that doesn't exist, while the actual blocker (handler may be *absent* on
the live 4.2.0 net — research artifact 5 open-Q #1 and artifact 0 open-Q #1 both admit the public
testnet may still be 4.1.x) is under-weighted. A planner could "pass" P1 by confirming mint
works, then discover seeding throughput is throttled by an unsettable `mintAmount`, or that the
handler isn't wired on the net they actually target.

**Fix:** Rewrite the Fact to "permissionless `mint(recipient)`; mints a protocol-set `mintAmount`
per call; Nulo cannot change the amount." Re-state the P1 go/no-go as "(a) handler present in
`getNodeInfo`, (b) read `mintAmount`, (c) confirm a 4.2.0 net exists at all." Drop "onlyMinter"
everywhere. Re-derive the "fixed-size FJ mint UX" copy from the *read* amount, not a guess.

## High

### H1 — P2 hand-writes a "FRESH" `NuloTokenPortal.sol` that the canonical `@aztec/l1-artifacts` TokenPortal already is

`@aztec/l1-artifacts` ships a canonical, compiled `TokenPortal` whose ABI I verified:

- `depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) → (bytes32,uint256)`
  — exactly 3 args, **no fee param** (gross amount).
- `depositToAztecPrivate(...)` present.
- `withdraw(address _recipient, uint256 _amount, bool _withCaller, Epoch _epoch, uint256 _leafIndex, bytes32[] _path)`
  — already **Epoch-shaped**, already gross.

This is the upstream reference Holonym forked and then *added* fee+attestation to. The plan's P2
("FRESH code, ABI-reconciled" — `constructor(owner)` + `initialize` + the three deposit/withdraw
fns + gross hash + epoch) reinvents, line-for-line, what the canonical artifact already provides
and what the **deployed testnet already runs**. Research artifact 2 open-Q #4 raised this exact
question ("is there any reason Nulo's portal isn't just the upstream canonical TokenPortal.sol?
If no bridge fee, it likely is"). The plan never answers it; it silently chose the fork.

The only plausible justifications for a custom portal are: (a) public+private on one portal with
pause/sweep, (b) the `l2Bridge`+`token_minter_proxy` wiring, (c) owner sweep. None of these are
stated as the reason, and (a) may already be satisfied by the canonical contract. Writing,
testing, and auditing a bespoke Solidity portal is the single largest net-new attack surface in
the plan (it's the cross-chain content-hash boundary — get a selector wrong and funds strand).
Reusing the audited upstream contract eliminates that surface.

**Fix:** Add a P2 decision paragraph that explicitly diffs the canonical `TokenPortal` against the
desired Nulo portal. Default to **deploying the canonical artifact verbatim** unless a concrete
missing feature is named. If a custom portal is truly needed, justify each deviation and keep the
keystone hash-equality test (it's still cheap insurance). This is also a security win: less
hand-rolled cross-chain Solidity.

### H2 — Recovery crypto reuse is mis-specified: `@nulo/wallet-crypto` is PASSWORD-based; the bridge has no password

Plan ("reuse `@nulo/wallet-crypto`'s PBKDF2(600k)+AES-GCM"), Decision ledger, and Security
section all treat the recovery-crypto reuse as a drop-in. The actual class
(`packages/wallet-crypto/src/encryption-key.ts`) keys **only** off a user password:
`EncryptionKey.fromPassword(password)` / `fromPasshash(passhash = SHA-256(password))`. There is
no signature-based or wallet-derived entry point.

Holonym's recovery (research artifact 1, "Key derivation") derives the AES key from an **L1
wallet signature** — deterministic, password-free: "sign a deterministic message … derive an
AES-GCM key via PBKDF2(signature, address)". The bridge UX has no password concept anywhere in
the plan. So "reuse `@nulo/wallet-crypto`" silently implies one of:

- **(a)** Introduce a password prompt in the bridge (new UX surface, new failure mode "forgot
  password → permanent L1 lock" stacked on top of "lost secret → permanent L1 lock"). Unplanned.
- **(b)** Feed an L1 `personal_sign` signature into `fromPasshash(SHA-256(sig))`. Workable, but:
  the plan never says this; signature determinism across wallet implementations is not guaranteed
  (some wallets add prefixes/normalize differently); and binding the recovery key to an L1
  signature couples L2 claim-secret recovery to the L1 wallet, which the threat model never states.

Either way the "reuse" is not a no-op, and the choice has security and UX consequences the plan
hides. This is a P4/P6 dependency (the recovery module and the P6 destructive-recovery exit gate
both need a decided key source).

**Fix:** State the key-derivation source explicitly. If (b), specify the exact message string,
the wallet (`personal_sign` vs `eth_signTypedData`), and add a test that the same wallet+message
yields the same key across reconnects. If (a), add the password UX to the relevant phase and to
the threat model. Note that `@nulo/wallet-crypto` gives you the AES-GCM framing for free regardless
— it's the *key source* that's unspecified, not the cipher.

## Medium

### M1 — "COOP/COEP is NOT an open risk" conflates two risks and downgrades both on evidence for one

Assumptions "Facts": "COOP/COEP + in-browser poseidon2 already run in faucet + extension at 4.2.0
(so NOT an open risk — R1 downgrade)." Verified: the faucet `_headers` does set
`Cross-Origin-Embedder-Policy: require-corp`, and poseidon2/bb.js threaded WASM does run under it.
**But:** there is **zero** L1 injected-wallet code in the entire repo — no `window.ethereum`, no
EIP-6963 listener, no `@wagmi` in any `package.json` (grep-confirmed). So "injected wallet works
under `require-corp`" is proven **nowhere**. Research artifact 6 open-Q #6 flags exactly this
("Some MetaMask iframe injection patterns have historically had issues with strict COEP").

`require-corp` blocks cross-origin subresources lacking CORP/CORS headers. EIP-6963 provider
announcement is in-page (`window.dispatchEvent`) so it's *probably* fine, but this is the kind of
boundary COEP is known to disturb, and "probably" is not "proven in this repo." The plan
pre-declares it a non-risk in the Facts bucket — the strongest possible epistemic claim — on the
basis of an unrelated proof (WASM isolation).

**Fix:** Move "injected wallet provider functions under `require-corp`" from Facts to an explicit
**P0.5 gate** (it's already partly there as P0.5(a), but the Facts line contradicts P0.5 by
saying it's settled). If it fails, the fallback is documented in research artifact 6
(scope SharedArrayBuffer to a Worker, relax top-level COEP) — but that fallback weakens the WASM
isolation the faucet depends on, so it's not free. Keep the two risks separate.

### M2 — No phase builds the parallel-safe L1 e2e harness; P6/P7/P8/P9 assume one exists

P6 ("real Sepolia→Aztec round-trip e2e"), P8 ("real Aztec→Sepolia"), P9 ("Sepolia fork + real
`bridgeWithFuel`") all require an L1 test harness: anvil (or a Sepolia fork), deployed-contract
fixtures, and a way to drive real testnet round-trips. The current faucet e2e is a **single
no-network smoke test** (`packages/faucet/tests/e2e/faucet-smoke.test.ts` + `vitest.e2e.config.ts`)
— it does not spin anvil, fork, or touch L1 (grep-confirmed: no `anvil`/`--fork`/`createAnvil`).
The extension's parallel-safe agent runner referenced in CLAUDE.md did not surface where expected
(`resolve-ports`/`agent.sh` under `packages/extension/tests/e2e` returned nothing), so the plan
cannot assume it's lift-and-shift either.

CLAUDE.md (global + project) mandates parallel-safe e2e for external services: ephemeral ports,
worktree-local PID lockfile, path-scoped cleanup, isolated data dirs. Adding anvil + a forked
Sepolia + Aztec testnet round-trips to the suite is substantial, unscoped work hiding inside
"Validate: real round-trip e2e" bullets. Two agents running bridge e2e simultaneously will
collide on anvil's default 8545 unless this is designed in.

**Fix:** Add an explicit phase (or fold into P5/P6) for the parallel-safe L1 e2e harness:
ephemeral anvil port allocation, a deploy-fixtures step, and the cleanup/lockfile discipline.
Decide upfront: forked Sepolia vs live Sepolia vs anvil-with-deployed-mocks (live Sepolia round
trips are 20-60 min per the timing research — too slow for CI gating; fork or mock for CI, live
for manual). This is a prerequisite for P6, not a footnote.

### M3 — Cold-start private-fuel: the "bootstrap-seed the FPC public balance" runbook may be either unnecessary or load-bearing, and the plan doesn't know which

P7 lists "Operator runbook: bootstrap-seed the FPC public balance (a full bridge op)" as the
funding path, and the Security section calls the seed "partially drainable — seed conservatively."
But the verified `PrivateMintAndPayFeePaymentMethod` flow ([wonderland-fee] `private.js`,
confirmed) bundles, in ONE tx's setup phase: (1) `FeeJuice.claim(fpc, amount, secret, leafIndex)`
which credits the FPC's **public** balance, THEN (2) `mint_and_pay_fee` which sets the FPC as fee
payer. If step 1's credit is available to the sequencer in the same tx (it's in the setup/
non-revertible phase), the FPC **self-funds atomically** and the operator seed is unnecessary for
the happy path. The extension's `fpc/service.ts` (verified) only *registers* the PrivateFPC
instance — it performs **no** public-balance seeding — which strongly suggests the extension
relies on this self-funding and never bootstraps.

So the plan carries an operator-seed runbook that is either (a) dead weight (self-funding covers
it) or (b) genuinely required for some edge (e.g. the very first claim when the rollup hasn't yet
processed the FJ message into the FPC's *spendable* public balance at fee-charge time). The plan
asserts the seed is needed without proving the cold-start tx-phase ordering.

**Fix:** In P7, prove the cold-start case explicitly: a brand-new FPC (zero public balance) +
a single user's private-fuel deposit → does `mint_and_pay_fee` succeed with no operator seed?
If yes, delete the bootstrap-seed runbook (and the "partially drainable seed" attack surface
with it). If no, document *why* (which phase boundary fails) and keep the seed. This is the
"negative test (wrong claimer secret → revert)" test's sibling and belongs in the same phase.

### M4 — Clean private router branch (`isPrivate` → clean `depositToAztecPrivate`) is unproven; Holonym never tested it

Decision #12 keeps `isPrivate` in `SwapBridgeRouter` and rewires the private branch from
Holonym's `depositToAztecPrivateFor(msg.sender, ..., cleanHands, passport)` (verified at
`[holonym] SwapBridgeRouter.sol:278,351`) to the clean `depositToAztecPrivate(amount, secretHash)`.
The reasoning (research artifact 2, lines 327-331) is sound: the router holds the Permit2-pulled
tokens, approves the portal, and the portal's `safeTransferFrom(msg.sender=router, ...)` pulls
from the router — "identical to the public flow." **But:** Holonym's router NEVER exercised this
path — it always used the `*For` variant for private. So the "router calls clean
`depositToAztecPrivate` and the portal pulls from the router" flow has zero test coverage in the
reference, and the plan inherits no test for it. The witness binding itself is fine (see Assumption
attack below — keeping `isPrivate` is correct). The risk is purely the untested router↔clean-portal
private wiring.

**Fix:** P9's test matrix must include a router-driven **private** `bridgeWithFuel` where the
clean portal pulls from the router (not just a direct user-called `depositToAztecPrivate`). The
plan says "real `bridgeWithFuel` (both public + private token)" — make explicit that the private
case routes through the clean portal's router-pull path, and add a unit test with `MockTokenPortal`
asserting the portal's `transferFrom` source is the router address.

### M5 — `_validateRoute` hop-continuity gap is named but its severity is understated; also no per-hop hooks check

Verified `[holonym] UniswapFuelSwap.sol:226-249`: `_validateRoute` checks **only** first-hop
input and last-hop output. It does **not** check (a) `hooks == address(0)` on any pool, nor (b)
hop-continuity (hop[i] output token == hop[i+1] input token). The plan lists both as "Mandatory
contract edits" in P9 — good, confirmed real. But it files them under V4 settlement hygiene. The
missing-continuity gap is sharper than that: an unchecked intermediate hop lets a crafted `path`
route through an **attacker-controlled pool** with a malicious `hooks` contract, or through a pool
pairing the intermediate against an attacker token, draining the router's mid-swap balance. The
`minFuelOutput` slippage guard does NOT protect against this — it only bounds the *final* FJ
output, and a malicious hook can manipulate intermediate deltas while still delivering nominal
final output. With `isPrivate` and Permit2 witness keeping the user safe from param substitution,
the route-validation hole is the residual swap-path attack surface.

**Fix:** Keep both edits (correct). Additionally enforce `hooks == address(0)` for **every** hop,
not just presence-check, and assert hop-continuity. Add an explicit P9 test: a `path` with a
non-zero `hooks` on hop 1 must revert; a discontinuous `path` (hop0 out ≠ hop1 in) must revert.
Frame this as a security-critical validation, not settlement plumbing.

## Low

### L1 — Stale research artifacts are cited as live "Research outcomes" while simultaneously flagged stale

The plan's "Research outcomes" section cites artifact 4 (`aztec-4.2.0-portals-fees.md`) and
artifact 7 (`wonderland-aztec-fee-payment.md`) as sources, then the Decision ledger says both are
"annotated stale." I verified the plan's correction is RIGHT: artifact 4 flatly claims "There is
no `PrivateMintAndPayFeePaymentMethod` at 4.2.0" and "A separate PRIVATE_FPC is not needed" —
both **false** against the installed tarball (`prerelease-215fd08`), which exports the class with
constructor `(fpcAddress, amount, secret, salt, leafIndex)` and bundles `FeeJuice.claim` +
`mint_and_pay_fee` exactly as the plan describes. Good catch by R1. But leaving a flatly-wrong
artifact in `research/` without an in-file correction banner is a trap for the next contributor
who reads the artifacts directly (they're committed). Artifact 7 also still says the package is an
npm `4.2.0-aztecnr-rc.2` install (line 267, 312) when it's actually the GitHub tarball — minor but
misleading.

**Fix:** Prepend a one-line "SUPERSEDED — see plan R1 correction" banner to the wrong sections of
artifacts 4 and 7. Cheap, prevents re-litigation.

### L2 — `additionalScopes`/PXE-registration mechanics for the static app are asserted but not de-risked beyond "mirror the extension"

The extension threads `additionalScopes:[fpc.address]` through simulate/prove/send
(verified `execution/service.ts:1605-1855`) and registers the PrivateFPC via
`pxe.registerContract` with `salt=Fr.zero(), deployer=AztecAddress.ZERO`
(verified `fpc/service.ts:90-94,172-180`). The bridge-frontend is a *static dApp* talking to the
**wallet** over the wallet-sdk channel, not an extension with its own execution service. Whether
the dApp can pass `additionalScopes` through the wallet-sdk request boundary (vs the extension
setting them internally) is the actual integration question, and P0.5(c) covers it — but the
plan's "mirror this integration; don't build fresh" elides that the dApp side is a *different*
integration point than the extension's internal service. Likely fine (the manifest declares the
FPC scope, per the wonderland artifact's capability-manifest note), but "mirror the extension" is
the wrong mental model for a dApp-over-channel call.

**Fix:** In P0.5(c)/P7, state that the dApp passes `additionalScopes` via the wallet-sdk
request/capability path (not by mirroring the extension's internal `execution/service.ts`), and
that the capability manifest must declare `mint`/`mint_and_pay_fee`/`pay_fee` as transaction
scope + `balance_of` as simulation utility for the FPC address (per [wonderland-fee] usage).

### L3 — PrivateFPC recovery: the `salt` is the binding secret, not the `secret`, and the localStorage schema must store BOTH

Verified: `PrivateMintAndPayFeePaymentMethod`'s `mint_and_pay_fee(amount, salt, leafIndex)` does
NOT take the `secret` — the FPC re-derives it in-circuit from `poseidon2([salt, msg_sender], DOM_SEP)`.
The `secret` is used only by step-1 `FeeJuice.claim`. So for private-fuel recovery, the
load-bearing persisted values are `{salt, amount, leafIndex}` (plus the user address, which is
`msg_sender` at claim time). The recovery schema in research artifact 1 stores a generic
`claimSecret` but the private-fuel record needs the **salt** specifically. If a resumed flow has
the secret but not the salt, the private claim is unrecoverable (the FPC can't reconstruct the
nullifier). The plan's "happy-path localStorage + manual export" must capture the salt.

**Fix:** P7's localStorage/export schema for private-fuel deposits must persist `salt` (and
`amount`, `leafIndex`) explicitly, distinct from the public-path random `claimSecret`. Add to the
P6 destructive-recovery exit-gate test a private-fuel variant: close tab → reimport → the salt is
present → `mint_and_pay_fee` reconstructs and succeeds.

## Assumption attack

### Facts — which are wrong/overstated

- **WRONG:** "`FeeAssetHandler.mint` is fixed-size + `onlyMinter`." It is **permissionless**; the
  size is a protocol-owner-set mutable `mintAmount`. See C1. This is the most damaging factual
  error because a whole decision branch hangs on it.
- **OVERSTATED:** "COOP/COEP … so NOT an open risk." True for WASM/poseidon2, unproven for
  injected-wallet provider under `require-corp` (no such code exists in the repo). See M1.
- **MISLEADING (artifact, carried into plan):** artifact 7's "npm `4.2.0-aztecnr-rc.2`" — it's a
  GitHub tarball `prerelease-215fd08`. The plan's Facts section gets this right; the artifact
  doesn't. See L1.
- **CORRECT (verified):** viem is one forked identity (`bun.lock:2446` → `@aztec/viem@2.38.2`);
  `bun why viem` is a tautology — confirmed, and it correctly overrides artifact 7's
  "needs a bun why viem check." Outbox.consume takes `Epoch _epoch` — confirmed. Canonical
  TokenPortal hashes gross + 3-arg deposit — confirmed (and see H1). aztec-standards Token has a
  single immutable minter, no `set_minter` — confirmed; `deployments.test.ts:19` asserts
  `minter==DRIPPER` (verified at that line) → P3's update to `minter==proxy` is correct.
  `@nulo/wallet-crypto` ships PBKDF2(600k)+AES-GCM — confirmed (but see H2 re: key source).
  `PrivateMintAndPayFeePaymentMethod` exists + bundles claim+mint — confirmed against the tarball.

### Inferences — which are unsafe

- "Live net is 4.2.0-compatible" — correctly bucketed as a Phase-1 inference, but C1 shows the
  *binding* sub-question (does a FeeAssetHandler exist on that net at all) is more likely to be the
  blocker than the access-control question the plan emphasizes. Safe to defer, wrong emphasis.
- "The chosen wagmi stack functions against the `@aztec/viem` fork" — reasonable Phase-0.5
  inference. Residual risk the plan doesn't name: `@wagmi/core`'s viem **peer-dependency version
  range** may not be satisfied by the pinned fork `2.38.2`, or wagmi may reach into viem internals
  the fork diverged on. The spike covers behavior; add a peer-range check to it.
- "Clean portal + canonical content-hash lib interop with a fresh `token_bridge`" — only the
  Phase-6 round-trip proves it. Fine. But H1 (use canonical portal) would shrink this risk.

### Asks — which decisions hide an unsurfaced Ask

- **Hidden Ask in H2:** "reuse `@nulo/wallet-crypto`" hides the unsurfaced decision of *what keys
  the recovery cipher* (password vs L1-signature). This is a real product/threat-model Ask
  masquerading as a settled implementation detail.
- **Hidden Ask in H1:** "write FRESH NuloTokenPortal" hides the unsurfaced "custom vs canonical
  portal" Ask that research artifact 2 open-Q #4 explicitly raised and the plan never answered.
- **Hidden Ask in M3:** "operator runbook: bootstrap-seed the FPC public balance" hides whether
  the seed is needed at all — an unsurfaced "does the cold-start self-fund?" question.
- The four labeled Asks (A-D) are genuinely resolved and resolved well. Keeping `isPrivate`
  (Ask C) is the right call: the witness typehash binds it (`[holonym] SwapBridgeRouter.sol:85`),
  dropping it would change the EIP-712 domain and force a parallel public-only typehash, and the
  clean `depositToAztecPrivate` path is reachable. No hole in the witness binding or the
  private-content-hash path (`mint_to_private(uint256)` omits the recipient by design, supplied
  privately at claim — that's the intended unlinkability, not a bug).

## Contradictions & blind spots

- **Plan vs its own research (resolved correctly):** artifact 4 says no PrivateFPC / no
  `PrivateMintAndPayFeePaymentMethod`; plan says mirror the extension's PrivateFPC. Plan wins on
  ground truth (verified). But the contradiction lives on uncorrected in the committed artifact
  (L1).
- **Facts vs P0.5 (internal contradiction):** Facts declares COOP/COEP "NOT an open risk" while
  P0.5(a)/(c) treats the wallet-stack-under-isolation as something to *prove*. Can't be both
  settled and a gate. (M1)
- **Over-fit to the two reference repos:** H1 is the clearest instance — the plan copies Holonym's
  *fork* of TokenPortal instead of noticing the canonical upstream (which Holonym forked) is
  already installed and already matches the clean spec. Similarly, the recovery model is copied
  from Holonym's L1-signature scheme conceptually but mapped onto Nulo's password-based crypto
  without reconciling the mismatch (H2). The plan reasons "what did Holonym do" more than "what
  does 4.2.0 / this repo already give me."
- **Settled-too-fast:** "swap demoted to demo-until-proven" leans entirely on the FeeAssetHandler
  Fact that C1 shows is wrong. The demotion is probably still right (handler may be absent on the
  live net), but for the wrong reason — re-derive it on M3/C1's corrected mechanism.
- **Sequencing:** the critical path (P0.5/P1 → P2 → P6 → P7 → P8 → P9) is sound; front-loading the
  two HIGHEST-risk spikes (P0.5, P1) is correct. M2's missing e2e-harness phase is the sequencing
  gap — it's an implicit prerequisite of P6 with no slot.
- **UX/copy surface — under-addressed:** "fixed-size FeeJuice mint UX" copy is derived from a wrong
  Fact (C1) — the size is a runtime read, so the copy must be dynamic ("you'll receive ~N FJ" from
  the handler's `mintAmount`), not a baked "~1000." The dual-failure-mode UX from H2 (lost
  secret AND/OR forgot password → permanent L1 lock) needs copy that the plan's "prominent export/
  import" gate doesn't yet cover.
- **Deploy/rollback — thin:** the plan retires `@nulo/faucet` and merges two subdomains into one
  Pages project (P10), but there's no rollback story if the bridge-frontend regresses the faucet
  (which currently has a working deploy). The faucet is live; folding it into a bigger app and
  flipping the domain is a one-way move in the plan. Add a rollback note (keep the old faucet Pages
  project warm until the unified app is proven).
- **Operational keys — named but not concretized:** Security section says "document separate
  operator keys now" for the owner/sweep powers, but no phase produces that doc, and the owner of
  the `token_minter_proxy` is `PublicImmutable` (research artifact 2, line 408 + open-Q #5) — set
  once, non-transferable. If the operator key is compromised or rotated, the proxy owner cannot
  change. The plan picks `PublicImmutable` ("Decided (planner)") without weighing that a testnet
  faucet/bridge may well want to rotate operators. Surface this as a real trade-off, not a
  one-liner.
- **Not a blind spot (credit where due):** the keystone hash-equality test (P1, incl. withdraw),
  the private-fuel-before-swap reorder (P7 before P9 — correct, swap depends on nothing in P7 but
  proving the FPC path early de-risks the headline UX), and the `salt=Fr.zero()` + address-assert
  policy are all well-judged. The `isPrivate` retention is correct. The plan's instincts on the
  cross-chain security boundary are good; its factual grounding on FeeAssetHandler and its
  repo-awareness on TokenPortal + wallet-crypto are where it slips.
