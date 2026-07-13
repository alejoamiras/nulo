CLUSTER: bridge-core-channel

## Scope reconciliation (read first)

The cluster brief described `bridge-core` as "the shared bridge transport/channel between the
dApp page and the wallet — the postMessage-bridged (possibly encrypted) channel, key exchange,
protocol framing." **That description is wrong for this package.** `@nulo/bridge-core`
(`packages/bridge-core/src/**`) is a framework-agnostic **L1↔L2 asset-bridge library** (Ethereum
`viem` + Aztec `aztec.js`) — cross-chain deposit/withdraw/swap orchestration, Permit2 witness
hashing, content-hash keystones, and a no-server recovery-secret sealing scheme. The repo-map
author conflated "bridge" (cross-chain) with "bridge" (dApp↔wallet transport). The actual
dApp↔wallet postMessage channel / key-exchange / framing lives in `wallet-bridge` (cluster 4) and
`extension-messaging` (cluster 3); `content-script` origin/source validation is cluster 7. **None
of the properties the brief asked me to scrutinize (postMessage origin/source validation, channel
key-exchange, cross-origin protocol framing) exist in this cluster.** I audited what is actually
here: the recovery-secret crypto, the sealed-envelope integrity model, untrusted-input parsing
(recovery backup files, localStorage journal, on-chain event logs), and the bearer-secret handling.

**Reachability caveat (affects blast radius of every finding below):** `@nulo/bridge-core` is
imported **only by `apps/faucet`** (verified: `grep` shows zero importers under `apps/extension`;
all consumers are `apps/faucet/src/**`). The faucet is listed OUT OF SCOPE in the repo-map. So
nothing here reaches the wallet extension's private keys or the dApp→wallet RPC path; the blast
radius is the **faucet bridge user's own in-flight bridge funds**, not the wallet. The cluster is
nonetheless in the Phase-2 plan (#5), so it is audited on its own terms.

One handoff hop was spent inward on `@nulo/wallet-crypto`'s `EncryptionKey`
(`packages/wallet-crypto/src/encryption-key.ts`) to verify IV/integrity behavior of the sealing
primitive. That hop is now spent; the faucet-side reachability of Finding 1's precondition is
flagged for the coordinator to resolve against cluster 12 / the faucet, not crossed here.

## Findings

### [1] Bridge flows trust `events[0]` from an address-unfiltered `parseEventLogs`, so any contract executing inside the deposit/bridge tx can spoof the leaf index and `fuelReceived`

1. **Title** — Event-log source spoofing: `parseEventLogs(...)[0]` over a whole tx receipt is not
   filtered by the expected emitter address, letting an in-transaction contract (notably an
   untrusted ERC-20 whose `transfer`/`transferFrom` runs mid-tx) emit a topic0-colliding event that
   is picked ahead of the real one.

2. **Impact factors** — Property: **Integrity** (the persisted recovery `leafIndex` and the
   returned `fuelReceived` are attacker-chosen) and **Availability** (an L2 claim built against a
   forged leaf index reverts forever; a spoofed high `fuelReceived` defeats the caller's self-pay
   floor check → the bridged Fee Juice cannot cover its own claim and strands). **No fund theft** —
   the on-chain L1→L2 message binds the real funds; a forged client-side index cannot redirect them.
   Blast radius: **single user** (the person bridging), their own in-flight bridge amount. Data
   sensitivity: low (no secret exposed). Exploitability: attack vector **network** (attacker deploys
   an ERC-20 / is a token in the route), attack complexity **high** (must be a contract in the tx's
   call path — see preconditions), privileges required **none**, user interaction **required** (the
   victim must initiate a bridge that routes through the attacker's contract).

3. **Evidence confidence** — moderate. The in-cluster source→sink trace is concrete; the real-world
   reachability of the precondition (an untrusted token contract in the flow) depends on the
   faucet's token configuration, which is out of this cluster (see caveat).

4. **OWASP / CWE mapping** — OWASP **A08:2021 Software and Data Integrity Failures** (trusting
   unverified externally-sourced event data). CWE-**345** Insufficient Verification of Data
   Authenticity (primary); CWE-**346** Origin Validation Error (secondary — the emitter address is
   the missing origin check).

5. **Trace** —
   - Source: exported flow inputs carry a caller-supplied token address —
     `runSwapBridge` `p.bridgeToken` (`packages/bridge-core/src/flows.ts:224`), `runDeposit`
     `p.usdc`/`p.portalAbi` (`packages/bridge-core/src/flows.ts:34-36`), and the FeeJuicePortal path
     `parseFeeJuiceDeposit(logs)` (`packages/bridge-core/src/fuel.ts:67`). A contract at any of these
     addresses executes during the bridge tx.
   - Sink A — `packages/bridge-core/src/flows.ts:115-118`:
     `parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: depositReceipt.logs })` then
     `const event = sent[0]`, `const leafIndex = event.args.index`. No filter on `log.address`.
   - Sink B — `packages/bridge-core/src/flows.ts:359-371`:
     `parseEventLogs({ abi: p.routerAbi, eventName: "BridgeWithFuel", logs: receipt.logs })` then
     `const ev = events[0]`, using `ev.args.tokenIndex`, `ev.args.fuelIndex`, `ev.args.fuelAmount`.
   - Sink C — `packages/bridge-core/src/fuel.ts:67-74`:
     `parseEventLogs({ abi: FeeJuicePortalAbi, eventName: "DepositToAztecPublic", logs })` then
     `const e = events[0]`, using `e.args.index` / `e.args.amount`.
   - Harm: `leafIndex` flows to `recovery?.onDeposited?.(leafIndex)` (`flows.ts:119`) and the L2
     claim `new Fr(leafIndex)` (`flows.ts:125`); `fuelReceived` is returned to the caller
     (`flows.ts:371`) and gates `assertFuelClearsFloor(received, floor)`
     (`packages/bridge-core/src/fuel.ts:80-87`).

6. **Missing control** — `parseEventLogs` decodes every log whose `topic0` matches the ABI event
   signature **regardless of which contract emitted it**; the flows never restrict to
   `log.address === expectedEmitter` (the Inbox / router / FeeJuicePortal), and they take `[0]` (the
   first-in-execution-order log, which for a mid-tx token callback precedes the real terminal event).
   No emitter-address allow-list; no "exactly one expected event" assertion.

7. **Exploit story** — A user bridges token `T` whose contract the attacker controls (or that is
   listed in the fuel route). During `bridgeWithFuel`, the router pulls `T` via Permit2; `T`'s
   `transferFrom` runs and does `emit BridgeWithFuel(aztecRecipient, …, tokenIndex=99999,
   fuelIndex=88888, fuelAmount=<huge>, …)` with the exact ABI-encoded shape. This log lands in
   `receipt.logs` **before** the router's own terminal `BridgeWithFuel`. `events[0]` is the forged
   one. The victim persists `tokenLeafIndex=99999` as recovery state and the L2 `claim_*` proves
   membership against leaf 99999 → the L1→L2 message tree has the token at the real index → the
   membership proof fails → the claim retries 200×3s and reports "never succeeded"
   (`flows.ts:123-134`), i.e. apparent stranding. Separately, the spoofed `fuelAmount` passes the
   caller's `assertFuelClearsFloor`, so the user proceeds believing gas is covered while the real
   bridged FJ is below the self-pay floor → the private claim's `mint_and_pay_fee` asserts and the
   Fee Juice strands at the FPC.

8. **Preconditions** — A contract the attacker controls (or influences) must execute within the
   deposit/bridge transaction and be able to emit a log — realistically an untrusted **bridge token**
   (`p.bridgeToken`/`p.usdc`) or **fee asset** (FeeJuicePortal input), or an attacker-controlled hook
   in the swap route. If the faucet hard-pins the bridge token / fee asset to a trusted contract and
   the route pins `hooks=address(0)` (which `route.ts:38-52` does for the two fixed hops), the
   precondition is not met and the finding is not reachable **for that configuration**. The library
   API itself imposes no such pin.

9. **Why mitigations fail** — The witness/Permit2 binding (`l1.ts`) protects the on-chain
   `bridgeWithFuel` parameters (recipient/amount/route) from a relayer, but it does **not** authenticate
   the client-side *reading* of the resulting receipt logs; the leaf index and `fuelReceived` are
   read from `receipt.logs`, not from the signed witness. The "leaf index from the mined event, never
   a preflight simulate" invariant (README) defends against concurrent-deposit index races, not
   against a same-tx forged event. `parseEventLogs` `strict` mode only skips *malformed* logs; a
   well-formed forged event decodes fine.

10. **Instances** — `packages/bridge-core/src/flows.ts:115-118`,
    `packages/bridge-core/src/flows.ts:359-364`, `packages/bridge-core/src/fuel.ts:67-74`. Same root
    cause (address-unfiltered `parseEventLogs(...)[0]`); fix all three by filtering
    `receipt.logs` to the expected emitter address before parsing (and asserting a single match).

## Notes — checked and judged non-findings (with reasoning)

- **Recovery-secret crypto is sound (no finding).** `recovery-crypto.ts` reuses
  `@nulo/wallet-crypto`'s `EncryptionKey`. Verified at the source (`encryption-key.ts:34-47`):
  every `encrypt` draws a **fresh random 12-byte IV** (`crypto.getRandomValues`), derives the
  AES-GCM key with `salt = SHA-256(iv)` and PBKDF2-SHA256 **600 000 iterations**, and outputs
  `[version|iv|ct+tag]`. AES-GCM supplies integrity (decrypt throws on tamper). My leading
  hypothesis — that `sealDepositRecord`/`sealDepositRecord.key` reuse (returning the in-memory key
  to re-seal the finalized envelope with `leafIndex`, `recovery-crypto.ts:168-187`) causes GCM
  nonce reuse — is **false**: each `encrypt` derives a new (salt,key,iv) from a new random IV, so
  no (key,nonce) pair repeats. Per-record keys are derived from a domain-separated per-record
  signature (`recoveryKeyMessage`, `recovery-crypto.ts:27-33`), so a leaked signature exposes one
  record only.
- **Sealed-envelope integrity + no-downgrade is correctly enforced (no finding).**
  `openDepositEnvelope` (`recovery-crypto.ts:129-149`) rejects any non-v2 plaintext with no legacy
  fallback; the GCM tag covers `{secret,recipient,amount,sealerL1,leafIndex,salt}`, so browser
  storage cannot redirect a claim by editing plaintext. `backup.ts openBridgeBackup:186-217`
  decrypts first (GCM) then cross-checks every unauthenticated header field against the sealed copy.
  A malicious backup file handed to a victim fails GCM decryption (attacker lacks the victim's
  signature-derived key) and throws — no injection into `validateBackupRecord`.
- **No prototype-pollution sink (no finding).** All untrusted-input parsers (`backup.ts:30-63`,
  `backup.ts:73-154`, `journal.ts:160-176`, `seal-trust.ts:44-56`, `recovery-crypto.ts:129-149`)
  use `JSON.parse` + explicit per-field `typeof` guards and object spreads (`{...rec}`), never a
  recursive merge of attacker keys into a shared object. `JSON.parse` places `__proto__` as an own
  property, not on the prototype; the spreads use `CreateDataProperty` semantics, so no
  `Object.prototype` write path exists.
- **`seal-trust.ts` un-MAC'd trust cache (Note, not finding).** Explicitly documented + accepted
  (module header, "plan L14"): a forged positive entry in localStorage skips the sign-twice
  self-test and can strand a *future* deposit on a non-deterministic wallet. But writing the
  victim's faucet-origin localStorage requires XSS or physical access — capabilities that already
  grant strictly more (read the plaintext public-deposit secrets, read/exfiltrate sealed blobs,
  drive the UI). The forgery adds no marginal attacker capability, and the damage is self-DoS, not
  theft. Provider-fingerprint + generic-fingerprint exclusion (`seal-trust.ts:34-38`) + revoke-on-
  unseal-failure bound it.
- **Bearer secret + signature-derived key + user-exportable backup (Note, residual by-design
  risk).** The private claim is **bearer** (documented F-007, `flows.ts:44-58,251-260`), and the
  seal key is the user's `personal_sign` over a fully-public binding (chainId/portal/bridge are
  public; `secretHashHex` is on-chain). A phishing site that gets the victim to upload a backup blob
  and then sign the exact `recoveryKeyMessage` can derive the key, decrypt the bearer secret, and
  front-run the claim to any recipient. This is the accepted tradeoff of a no-server bearer-recovery
  scheme; the stated mitigations (domain separation, export-time UI warning) are not bypassed by any
  code path I found. Recipient-commitment (removing the bearer property) is noted as backlog.
  Surfacing for the coordinator as a design-level residual, not a code defect in this cluster.
- **Public-deposit / private-fuel plaintext in the localStorage journal (no finding).**
  `journal.ts` stores public-deposit `secret` (`:110`) and private-fuel `bridgeSecretSalt` (`:90`)
  in plaintext. Public secrets are recipient-bound by the L1 content hash (`content-hash.ts:48-51`)
  and private-fuel is claimer-bound via `deriveBridgeSecret(salt, claimer)`
  (`private-fuel.ts:52-53`, re-derived from `msg_sender`), so a plaintext leak lets an attacker at
  most trigger the claim to the already-bound recipient/claimer — no redirect, no theft. The
  bearer private-token secret is never journaled in plaintext (it lives in `sealedEnvelope`).
- **`l2.ts assertExitRecipient` + `assertFuelClearsFloor` fail-closed (defenses, not gaps).**
  `l2.ts:65-69` rejects the zero L1 recipient; `fuel.ts:80-87` hard-fails on a missing/non-positive
  floor (fail-closed, contrasted with the fail-open swap guard). Correct.
- **Permit2 witness hashing (`l1.ts`) is the mitigation, not a gap.** Every bridge field incl.
  `swapTarget` (F-004) is witness-bound and cross-pinned to the Solidity router by `l1.test.ts`; a
  post-signature tamper reverts on-chain. `runSwapBridge` fails closed on the private-fuel
  invariants before signing (`flows.ts:282-293`).
- **Availability of the claim retry loop (`flows.ts:123-134`) swallows all errors for 200×3s** — a
  UX/retry design over slow sandboxes, not an attacker-exploitable path; no external actor drives it.
- Files with no untrusted-input or secret surface: `progress.ts`, `status.ts`, `route.ts`,
  `quote.ts` (display/floor-only, on-chain `minFuelOutput` is authoritative), `router-abi.ts`,
  `content-hash.ts` (internal inputs, `/^\d+$/` and fixed-width hex — no ReDoS), `artifacts.ts`,
  `private-fpc-artifact.ts` (pinned address/artifact, fail-closed drift tripwire).
