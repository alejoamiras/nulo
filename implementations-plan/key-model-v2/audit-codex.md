# Codex audit — key-model-v2 (Round 1, gpt-5.6-sol xhigh, fresh session)

> Verdict: reject — all blocking findings adopted into plan.md rev 2 (see decision ledger L2/L3/L6/L7/L11/L13). Paths rewritten repo-relative.

reject (with blocking findings: profile entropy/master are not runtime-bound, P2 omits the integrity coordinator, and account-key export/storage lacks service-side authorization and atomic lifecycle rules)

## High

- [plan §C](implementations-plan/key-model-v2/plan.md:53): “store-both” creates a recovery-breaking split-brain. Existing AES-GCM ciphertexts have no purpose/profile AAD, so an attacker can swap the 32-byte `secret` ciphertext into `entropy`; it decrypts successfully and exports valid-looking but useless words. A test-time invariant does nothing at runtime. Make entropy required for password profiles, bind ciphertexts to profile ID and purpose, and verify `PBKDF2(entropy) == master` during unlock/export/restore. Password change must reseal entropy too; P3 omits that path.

- [account-integrity/coordinator.ts:52](apps/extension/src/wallet/services/account-integrity/coordinator.ts:52): P2 changes AccountService to `l1ChainId`, but the coordinator independently reimplements the old composite-chain formula. It is absent from the file map and P2. Every existing derived account would be blocked at unlock. Extract one shared pure account-seed function and update both consumers.

- [plan §E](implementations-plan/key-model-v2/plan.md:69): password confirmation appears UI-only. The export RPC itself must authenticate in the same background operation; otherwise a compromised popup can call it directly. Passkey profiles also need ceremony-bound authorization, not “password confirm.”

- [plan §E storage/signing](implementations-plan/key-model-v2/plan.md:76): two roots introduce torn writes, orphaned secrets, restore-order failures, and missed profile/network purges. Duplicate-address import can overwrite a derived Account row. Specify one AccountService-owned lock/transaction-with-compensation, duplicate rejection, awaited purges, backup referential integrity, and AEAD AAD. Missing row, malformed envelope, decrypt failure, invalid scalar, and address mismatch must all durably block and close—not only the final mismatch.

## Medium

- [plan §A entropy claim](implementations-plan/key-model-v2/plan.md:28): the claim is false. Reduction necessarily caps the master at `log2(r) ≈ 253.6` bits; Poseidon and the Grumpkin scalar similarly cap outputs. The `≤2^-258` modulo-bias argument assumes a uniform 512-bit input, while fixed PBKDF2 is fed only 2²⁵⁶ possible mnemonics. This is not a practical attack—the remaining strength is enormous—but “no narrowing” and “256-bit master” must be removed and gates cannot prove them.

- [plan §B](implementations-plan/key-model-v2/plan.md:46): `l1ChainId` is not a rollup identifier. Same master/type/index on two rollups sharing an L1 produces exactly the same key/address. That is cross-context reuse by construction. The lookup must also be `(profileId, composite)`, not composite-only, and validate a canonical nonnegative safe integer.

- [account/service.ts:151](apps/extension/src/wallet/services/account/service.ts:151): the “free per-type sequence” claim is wrong: when another type exists, `array_max([]) + 1` yields index 1. Fix the calculation. Also, [NuloAccount’s constructor is public](packages/aztec-runtime/src/account/nulo-account.ts:46), contrary to recon; make it private and share a common tail between `new` and `fromSigningKey`.

- Phase gates are not independent: move canary capture repair before P4 deletes its helper; add coordinator work to P2; add password-change/store-tamper tests to P3; and require a live imported-account transaction in P6. P5 smoke cannot prove signing. KATs prove exact outputs, not entropy or domain-separation security.

## Low

- Drop `secretKey` from account exports; it is redundant and invites consumers to mistake a privacy root for an ownership key. A second “guard” inside an authenticated AES-GCM envelope is also unnecessary.

## Assumption attack

**Facts:** I1 is resolved false—`getEntropy` already verifies checksum at [mnemonic.ts:2153](packages/wallet-core/src/utils/mnemonic.ts:2153). “Private ctor,” “per-type index math,” and “no hardcoded mnemonics in tests” are misstated.

**Inferences:** I2 is unsafe because seeded Local Network currently avoids probing; making profile creation depend on anvil availability is unacceptable. I3 is true. I4 needs explicit framing: the carried Trezor seed uses passphrase `TREZOR`, not the empty default. I5 is operational, not an architectural assumption.

**Asks:** A1: cut it. A2 should ask whether any build, backup, or artifact escaped—not merely whether users exist. Also ask whether same-L1 rollup key reuse is intentional, whether account exports may cross L1s, and how passkey-backed export is authorized.

## Outline A vs B

Pick A, conditionally. Real BIP-39 semantics, acceptance of every valid 24-word phrase, and future passphrases outweigh P3’s pre-launch schema cost. It does not increase the final master beyond ~253.6 bits; its justification is interoperability and UX. Without runtime binding of entropy to master, B is safer.

## What looks fine

Keeping the XOR composite for storage scope, persisting exact L1 identity separately, dedicated separators with pinned vectors, the compat-epoch bump, hostile-input size/schema checks, and deriving privacy keys one-way from the signing root are sound.