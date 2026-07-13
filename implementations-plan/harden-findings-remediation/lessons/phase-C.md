# Phase C — Chain-identity TOCTOU (F-03, High) — MID

Branch: `fix/hf-c-chain-toctou` off `fix/harden-findings`.

## The bug (grounded)
`tx-request-builder.ts:119` fetches `nodeInfo = await node.getNodeInfo()` and `:124` `assertLiveChainIdentity(network, nodeInfo)` — the guard that throws if the live node's chain identity drifted from the user-selected network. But then `nulo-account.ts:buildTxExecutionRequest` (`:103`) **re-fetches** `await node.getNodeInfo()` *unvalidated* and builds the `chainInfo` used to hash authwits (`:127 chunkHead(current, chainInfo)`) and construct the **signed** `TxExecutionRequest`. Between the guard fetch and the signing re-fetch, a drifted/malicious RPC can return a different `(l1ChainId, rollupVersion)` → **user validates chain A, signs chain B** (TOCTOU).

The codebase already documents this exact gap as intended future work: `chain-identity.ts:20-22` — *"NOT applied at nulo-account.ts:buildTxExecutionRequest — no networkInfo parameter in scope. Would require an interface change (deferred follow-up)."* **Unit C is that deferred follow-up.**

## Design — thread the validated identity in, DROP the re-fetch (required param)
Add a **required** `chainInfo: { chainId: Fr; version: Fr }` param to `buildTxExecutionRequest` (`account/index.ts` interface + `nulo-account.ts` impl) and **delete** the internal `:103` `await node.getNodeInfo()` → `chainInfo` construction entirely:
- **Signing path** (`tx-request-builder.ts:350`): pass the identity derived from the **already-validated** `nodeInfo` (`{ chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }`).
- **View/sim paths** (`fn.ts:94`, `batched-view-simulation.ts:439`): they already have `node` in scope → fetch `getNodeInfo()` + build the same `chainInfo` **at the call site** and pass it. Behavior is byte-identical to today (the fetch just moves out of the adapter); chain identity is **not trust-load-bearing** on read-only paths per `chain-identity.ts:23`.

Blast radius: 3 callers + the interface decl. **Aligns with plan.md Unit C** ("drop the internal `getNodeInfo()` re-fetch in `nulo-account.ts:103`").

## Open Q — RESOLVED (required, not optional; codex unavailable → own judgment)
**Codex CLI produced no usable output** on this consult (blwfttk4z, exit 0 but empty — same failure as the F consult; the `codex exec … -o` + background+pipe invocation isn't capturing). Per the AFK rule (codex dies → log + proceed on own judgment within plan scope), resolved myself:
- **Required over optional.** Optional would leave the vulnerable re-fetch as a fallback → a *future* signing caller could silently omit `chainInfo` and regress the TOCTOU. **Required + deleting the re-fetch removes the vulnerable code path entirely** — nothing to regress to. Worth the 2 extra view-call-site lines for a **High** TOCTOU. This is also what plan.md's "drop the re-fetch" wording implies.
- View/sim relocation of the fetch is behavior-preserving (unvalidated there today, unvalidated there after — but not load-bearing).

## Invariants
- On the signing path, the chain identity that is **hashed into authwits + signed** equals the identity that passed `assertLiveChainIdentity` — there is **no second, unvalidated `getNodeInfo()`** between guard and signature.
- View/simulation behavior is byte-unchanged (no new required arg; chain identity not load-bearing there).

## Negative tests (unit — `@nulo/aztec-runtime`)
- `buildTxExecutionRequest` **with** a passed `chainInfo`: spy on `node.getNodeInfo` → asserts it is **not** called for identity; the built request's chain identity == the passed one.
- Drift test: a node whose `getNodeInfo()` returns identity **B**, but caller passes validated identity **A** → the signed request commits **A** (the validated one), proving the re-fetch no longer leaks into the signature.
- `chainInfo` omitted → falls back to the node value (view/sim path preserved).

## Gate (plan.md Unit C): `bun run --filter '@nulo/aztec-runtime' --if-present test` + `bun run test` + `bun run typecheck:all` + `bun run lint` + `bun run e2e:agent`. Layers: typecheck · lint · unit · network-e2e.
