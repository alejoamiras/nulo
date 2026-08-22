# Cluster F1b — KDF-v2 crypto core (data/validation lens)

> Scanner: general agent, 2026-08-22. **0 findings** — nothing met the bar.

Verified clean, by lens item:

- Input validation/canonicalization: canonicalizeMnemonic (mnemonic.ts:2109-2113) applied identically at validation and derivation; NBSP/ideographic-space collapse via NFKD+\s+; exotic separators fail closed at bip39Words.indexOf. Empty-sentence path unreachable (all four deriveMasterFromMnemonic call sites validate first). 24-words-only import documented policy, code matches doc.
- Wordlist/checksum: bit math exact for all %3-valid lengths; Fq/Fr constructor throws ≥ modulus (field.js:69-71), so fromBufferReduce only used on intended 64-byte low-skew inputs; official KAT pins all 24 rows.
- Buffer/base64/hex: all encrypt sites return fresh byteOffset-0 buffers; standard padded base64 alphabet both directions; lenient-vs-strict decode inconsistency exists but every path fails closed (GCM auth or length check); GrumpkinScalar type alias of Fq so export→parse round-trips.
- AAD/version bytes: guard/secret/entropy/dek AADs symmetric at every seal/unseal pair; frame version 0x00 (EncryptionKey) vs 0x01 (dek/key boxes) never cross; session bearer AAD = profile.id both sides.
- Integer coercion: deriveAccountSeed rejects non-safe-int/negative/>u32 before poseidon2; row-carried values re-validated inside; AccountSchema bounds index/l1ChainId.
- Round-trip symmetry: MAC preimage built from verbatim stored strings at compute and verify; pairing checks compare-then-zeroize in correct order; unwrapPair v2-only gate + 64-byte length check upstream of Fr.fromBuffer.
- Duplicate fingerprint: full-hash equality over sha256(label‖master) — no partial matching; offline partial-phrase oracle explicitly documented as inherent + accepted.
