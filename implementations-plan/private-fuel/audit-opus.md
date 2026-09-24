# private-fuel — Opus audit transcripts

Round 1 = independent plan ([draft-opus.md](draft-opus.md)) — adopted as the consolidation skeleton.

## Round 2 — contradiction-check of the consolidated plan (fresh trace; verdict: pass)
- [OK] L5 VERIFIED via full independent trace: faucet `send({fee})` → aztec.js `request()` runs `paymentMethod.getExecutionPayload()` + `mergeExecutionPayloads([fee, fn])` (fee calls FIRST) → Wonderland returns `[claim, mint_and_pay_fee]` feePayer=fpc → merge keeps the single feePayer → `aztec_sendTx` carries the whole ExecutionPayload → `processAztecJsPayload` pushes every `exec.calls` + `detectEmbeddedFeePayment(fpc,user)→"fpc"→EXTERNAL`. EXTERNAL = account does nothing for fees; `mint_and_pay_fee` sets FPC fee-payer + ends setup (the Holonym pattern). Dedicated mode NOT warranted.
- [OK] L5 gate sufficiency — judged P2-sim + P4 dust-canary sufficient before fund movement (note: codex's blocker that the *automated* P2 gate must be network-e2e is the stronger position; adopted).
- [OK] manifest-scope, two-salts (P0/P1/P3/P4 consistent), no-fuel-doesn't-bleed-into-private, privacy/fund-loss invariants all named-gated.
- [SILENT-RESOLVE, minor] L9 explicit-gas understated: Wonderland `getGasSettings()` returns undefined + faucet sends no gasSettings (`useDeposit.ts:270`); the private claim MUST add explicit `maxFeesPerGas`/`teardownGas=0` — deserves a P3 pin, not prose.

verdict: contradiction-check: pass.

### Resolution
L14: explicit-gas made a mandatory P3 pin. (codex's two gate blockers also folded — see audit-codex.md.)

## Round 3 — double audit (FRESH hostile auditor; verdict: reject → fixed)
- [CRITICAL] private insufficient-fuel recovery is UNREACHABLE: `sendStandaloneFjClaim` claims to recipientAddr=user (`useDeposit.ts:144`) but a private deposit set fuelRecipient=FPC (`SwapBridgeRouter` :211) → the user-recipient claim nullifier never matches → stranded FJ, no recovery. P3 must specify a NEW FPC-recipient recovery.
- [HIGH] no-fuel "wallet chooses" attacks the wrong layer: dApp `aztec_sendTx` with no fee injection → `detectEmbeddedFeePayment(undefined,from)→PREEXISTING_FEE_JUICE` (`operation-planner.ts:216,239`), which a cold zero-FJ account can't pay. The popup's Sponsored auto-select is NOT on the dApp path. The guarded Sponsored fallback is MANDATORY, not removable; the proposed e2e would prove the FAILURE. INVERTED posture.
- [HIGH] P2/P3 network-e2e not runnable as written: the harness drives `packages/playground` (fixed buttons, imports `@defi-wonderland/aztec-standards`, NOT `@wonderland/aztec-fee-payment`); building the 2-call private payload needs playground-app changes the plan never scopes.
- [MED] mid-flight Aztec upgrade: classId binds bytecode+version; a deposit-before / claim-after strands; no abort-window named.
- [LOW] "no L1 address leak" overstated: `depositToAztecPublic(FPC)` with `msg.sender=user EOA` makes the EOA→FPC funding link public; the FPC hides which user + the Aztec address, not the L1 funding.
- Verified sound: L1-L5, L4 salt-binding, L14, the keystone DOM_SEP, fee-methods 5/5.
verdict: reject (private insufficient-fuel unreachable; no-fuel inference false for the dApp path; network-e2e unrunnable without playground changes).
