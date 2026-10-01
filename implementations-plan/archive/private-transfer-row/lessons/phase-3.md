# Phase 3 · The standard Token's transfers read as the transfer row

- **Built.** `AUTHWIT_NONCE_NAMES` in the descriptors leaf, read by `transfer4Predicate` (the same
  two names as before, so the characterization snapshot is unchanged); the header no longer names
  the deleted `registry-equivalence.test.ts`. `abiNameFitsRole` in the vocabulary; `corroborates`
  fits each decoded name to its role through it and looks the kind up by the role.
  `transfer-intent.ts`'s header now says the arguments are read at the shape's role positions.
- **Tests.** The parity case renames the transfer descriptor's fourth parameter over four names and
  compares `candidatePredicate` with `abiNameFitsRole` (the first unit test of the predicate's
  `_nonce` branch). The node test now also pins that the installed Tokens' parameter names fit the
  roles, and the exact selectors of the standard Token's burns and commitment transfers, which the
  jsdom wire test stands in for the hash. The wire test runs the four standard transfers, the burns
  and the commitment transfers through the real decoder and the real standard interface, the
  unregistered contract, a non-zero nonce, `from` as another address, another account and a
  contact (lookups mocked per case), the relabeled interface, the lying-metadata copy, and six
  selector spellings. The discovered and createAuthWit files gained the alias cases.
- **Mutation checks, reverted by hand.** With the gate back on name equality, 14 cases red across
  four files. With an alias that fills any role, only the vocabulary's unit test redded at first:
  the call-surface case's two-argument fixture carried `_nonce` as a field, so the kind check
  refused it before the name rule mattered. The fixture now gives `_nonce` an address, and the
  broad alias reds it too.
- **Facts confirmed on the way.** The standard Token has no function named like an
  `Object.prototype` member; its commitment parameter is a plain `Field`.
- **Gate.** `bun run --cwd apps/extension test src/utils src/popup/windows/execute
  src/wallet/services/token/functions`: 80 files, 1129 tests passed. `bun run typecheck:all`: every
  workspace exit 0. `bun run lint`: exit 0 (28 pre-existing warnings). `bun run audit:vue`: its
  parallel stage passed and the build completed. The build rewrote the auto-imports for
  `abiNameFitsRole`; committed.
