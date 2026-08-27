# Phase 3 lessons — DEK crypto primitives

- **Additive-v2 strategy kept every gate green mid-arc**: the new primitives (dek box, key-box v2,
  MAC v2, pair bearer) landed BESIDE the v1 exports whose call sites P4 migrates-then-deletes —
  `typecheck:all` never broke. The V2 name suffixes are permanent (they match the bumped
  `:v2` label strings), not migration scaffolding.
- **Cross-implementation tests instead of hand-captured fixtures**: both the MAC v2 tag and the
  passkey DEK wrap key are verified against node:crypto (`hkdfSync`/`createHmac`) INSIDE the test —
  a shared misunderstanding of HKDF/HMAC semantics cannot self-consistently pass. (WebCrypto
  detail: HMAC `deriveKey` with no explicit length defaults to the hash BLOCK size — 64 bytes for
  SHA-256 — so the node reference derives 64 bytes; this matched first run.)
- **Rider (codex xhigh, blocking) round 1: FAIL — the fixed-size-contract class.** Brands erase at
  runtime, so: (M1) `wrapPair` accepted a 1-byte DEK and silently ZERO-PADDED it — unwrap then
  returned a "valid" branded 32-byte DEK of mostly zeros; (M2) `macKeyV2` concatenated unchecked
  lengths, letting distinct (master,dek) splits of identical bytes derive the same key; (L1) the
  pair copy was populated before the try/finally, so an early throw leaked it un-zeroized. All
  fixed in 8432bd07: 32-byte guards before any allocation, copy inside the protected block,
  31/33-byte boundary tests. **Re-verdict: PASS ("No new material findings").** Everything else
  survived: hierarchy, HKDF labels, AAD, v1↔v2 key domains, constant-time verify, both independent
  KATs, master-with-wrong-DEK rejection (the rider probed them directly).
- **Lesson for the package**: every fixed-size secret contract needs a RUNTIME guard at the
  primitive boundary, not just a brand — the brand stops call-site confusion, the guard stops
  crafted/truncated inputs. (The v1 boxes got this right via explicit length checks; the v2
  additions initially leaned on brands alone.)
- Gate (evaluated on the P3 state, commit 8432bd07): `bun run lint` exit 0 post-fix (whole repo);
  the rider-fix commit touched ONLY two wallet-crypto files, so the post-fix package gates carry
  the delta — wallet-crypto typecheck 0 + 94/94, extension-messaging typecheck 0 + 188/188 (incl.
  the DuplicateWalletError transport round-trip) — while `typecheck:all` 0 + extension 4425 from
  the pre-fix run remain valid (the fix touched no surface the extension consumes yet). A naive
  whole-repo gate re-run at this point red-hered on the already-in-flight P4 spec edits — a gate
  must be evaluated against its phase's commit, not a mid-next-phase tree.

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-3.md
