# mac-identity-binding — F-1/F-2 fixes for the key-model-v2 stack

Fixes the two findings from the adversarial review of #417..#429
(`implementations-plan/adversarial-key-model-review/findings.md` in the
key-model-v2 worktree). Branches off `feat/kdf-v2-assurance` (#429) so it
stacks behind the crypto work.

## Commits

| Commit | What |
|---|---|
| `c63fde9a` | MAC v3: envelope MAC binds the row's own storage id + the plaintext wallet fingerprint; retired v2 grammar deleted outright. |
| `c29873aa` | Embedded-id bypass closure: opt-in EntityStorage `requireKeyIdentityMatch` guard (profile root) + every MAC verify site uses the REQUESTED id; passkey fingerprint binding at unlock/export. |
| `d25f87b7` | Strict guard semantics (missing/non-string ids rejected); numeric mode for the authwit journal (id-aliasing closed). |
| `a55d4fe1` | Passkey finalize consistency snapshot (type/credentialId/dekSealed/pxeGeneration/fingerprint vs restore-time stash); positive-safe-integer numeric mode. |
| `fb77354d` | Explicit passkey-type requirement at finalize; test-precision fixes (`1e+21` suffix pins safeInteger; aliasing test copies genuine row 5). |

## Codex loop (gpt-5.6-sol xhigh, 5 rounds)

r1 BREAKS (4 findings incl. critical embedded-id bypass) → r2 BREAKS
(3 findings incl. authwit aliasing) → r3 HOLDS-with-concerns → r4
HOLDS-with-one-low → r5 **APPROVE, no remaining blockers**. Full transcripts:
`audit-codex-r{1..5}.md`.

## Accepted residuals (documented, owner-adjudicated lineage)

- A detected whole-envelope swap still opens DERIVED-ONLY (loud, non-persistent,
  laundering refused) rather than hard-refusing unlock — hard refusal hands a storage
  writer a one-field DoS lever over derived funds.
- Backup export under an uncovered MAC remains the deliberate non-destructive repair hatch.

## Gates

`audit:vue` green on HEAD (4562 tests / typecheck / lint / build). No UI or dApp-surface
changes; e2e fixtures reference no changed API — CI's required smoke + network gates
verify the PR.
