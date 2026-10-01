# Phase 1 lessons — passkey 512-bit reduce + KDF-spec extension

- **Reference-first pinning worked exactly as designed.** The V3 expected value was computed by a
  self-contained reference project (`reference/passkey-master-vector.ts`: node:crypto `hkdfSync` +
  published 5.0.1 `Fr` — a DIFFERENT HKDF implementation than the wallet's WebCrypto) and the
  wallet reproduced it byte-exactly on the first run: `23c252cf…3e79`. The rider then manually
  re-derived RFC 5869 Extract/Expand and confirmed node, WebCrypto, the JSON, and V3 all agree —
  so the pin is now genuinely cross-implementation, closing the "fixture captured from the code it
  tests" self-consistency hole.
- **Rider (codex xhigh, blocking) round 1: FAIL — a real HIGH.** `Buffer.from(new
  Uint8Array(masterBits))` inline in `deriveMasterSecret` minted an anonymous 64-byte
  master-equivalent OKM copy that the `finally` never wiped (only `masterBits`); the new zeroize
  test wipes its own named input and structurally could not catch it. Fix (987cd239): named
  `masterBitsCopy`, both buffers zeroized in `finally` — the `seed64Copy` pattern from
  mnemonic-master.ts. Also corrected the bias comment: the old 256-bit reduce's skew is
  residues-with-5-or-6-preimages ⇒ 20% relative skew, 253.415-bit min-entropy (not "~2^-1.6-scale
  bias"). **Re-verdict: PASS.** Everything else survived attack: full 64-byte BE reduce wired; no
  other sub-512 production reduce in the tree; spec digest independently recomputed to
  `29eca1…166d`; V8/V11 unaffected; no stale V3 pin anywhere.
- **Freeze triple discipline held**: spec clause + digest + rules-text + paired-test literals +
  new passkey substring pin landed as ONE commit (7951ce3b) per the module's own rule; the
  carve-out is now worded as a pre-launch WINDOW that closes at the first shipped build
  (owner-ratified at the plan gate, including the account-export digest invalidation).
- Gate: `bun run audit:vue` exit 0 (re-run over the final state after the rider fix — a gate run
  that predates the last code change doesn't count); wallet-crypto 61/61; aztec-runtime 189/189
  with zero KAT/vector edits.

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-1.md
