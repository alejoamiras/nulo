# Phase P1 — client 5.0.1 bump. RESULT: KAT STOP — 5.0.1 SHIFTS ACCOUNT ADDRESSES.

The mechanical bump was clean, but the **derivation-vector KAT failed**, which the plan flags as a
hard STOP ("any shift = protocol break, plan wrong"). Root-caused: 5.0.1 is **NOT address-stable**.

## What was done (clean)
- All 20 `@aztec/*` pins → 5.0.1 (viem independent); `@alejoamiras/aztec-accelerator` → 5.0.1;
  fee-payment + standards correctly HELD at 5.0.0 (P4). Noir patches renamed to `@5.0.1` +
  `patchedDependencies` keys AND the `%2F`-encoded value paths fixed; both patches apply (verified
  the `"module":` target line survives in both 5.0.1 noir packages).
- `bunfig.toml` excludes re-dated (name-based, already cover 5.0.1).
- `rm bun.lock && bun install` clean: 0 `@aztec/*@5.0.0` left, 30 `@aztec/*@5.0.1`, patches applied.
- `typecheck:all` → **0 errors** (no type churn — the client surface is compatible).
- `PXE_DATA_SCHEMA_VERSION` still **13** in 5.0.1 (our pin unchanged, no re-point).
- `SqliteEncryptionError` exported by 5.0.1 kv-store (available to adopt).
- schema-patch tests + wallet-crypto core-KDF tests + `verify:deployments` → **GREEN**.

## The STOP: account addresses shift
`packages/aztec-runtime/src/account/derivation-vectors.test.ts` — 2 of 6 failed, both the full-chain
address KATs (the core KDF `seed → signingKey → secretKey` PASSED — that chain is stable):
```
seed 0x…0000: expected 0x0d93d648… (regime-B, pinned from 5.0.0 tarballs)
              received 0x11c3937b… (under 5.0.1)
```
Root cause pinned by comparing the SchnorrAccount contract class-id:
- 5.0.0 (regime-B pinned node_modules): `0x2fcf070c3938eb6796b3777b350d211ee623225f43cd8061a0d72027fe2a62c4`
- 5.0.1 (installed):                     `0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5`

**`@aztec/accounts`'s SchnorrAccount bytecode changed 5.0.0 → 5.0.1**, so its class-id — and every
account address derived from it — shifts. This is un-documented (the 5.0.1 migration notes claim
client-only, no contract redeploy; they are silent on the account contract).

## Why this is a real blocker (not a stale test)
1. Deterministic (node env, two seeds, both shift) — not flake.
2. The live testnet is still `nodeVersion 5.0.0` (rollupVersion 1821665230). A 5.0.1 CLIENT derives
   addresses that **do not exist on the 5.0.0 network** — existing deployed accounts become
   unreachable via re-derivation.
3. It directly breaks the RESTORE flow (this arc's focus): restoring a 5.0.0 backup re-derives
   accounts → new 5.0.1 addresses → `NuloAccount.ensureRegistered`'s address-match assert
   (nulo-account.ts:83) fires, or the account points at an undeployed address.

## Decision needed (the bump-first premise is challenged)
The user's bump-first rationale was "5.0.1 fixes the store-lifecycle area #281 hardens." But 5.0.1
shifting account addresses against a still-5.0.0 network is a fundamental incompatibility. Options:
1. **Hold `@aztec/accounts` at 5.0.0** while bumping the rest to 5.0.1 (mixed-version — risky, and
   only viable if the account class-id is the ONLY shift; needs verification that no other
   identity-bearing artifact moved).
2. **Defer the 5.0.1 client bump** until the Labs testnet upgrades to 5.0.1 (then addresses match
   the network) — and in the meantime fix the restore bug (P2) on the current 5.0.0 line.
3. **Full account-migration story** (redeploy/alias accounts under 5.0.1) — large, and pointless
   while the network is 5.0.0.

Given P2 (import-page recovery) is the actual restore fix and is independent of the dep line, and
the 5.0.1 store-lifecycle fixes are a NICE-TO-HAVE not a MUST for P2, **option 2 (defer the bump,
land P2 on 5.0.0) is the low-risk recommendation** — surfaced to the user.

## STOP
Bump reverted to a clean 5.0.0 tree pending the user's decision. The KAT STOP gate fired exactly as
designed. This is a probe-contradiction-class stop (the "5.0.1 is address-stable" inference was
FALSE), adjacent to the plan's conditional-ask #3.
