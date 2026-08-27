# Adversarial Review — key-model-v2 stack (#417..#429)

Read-only black-hat audit of the NULO-ACCOUNT-KDF v2 stack. Report-only: no fixes land on the
stack branches. No external-model consults. Findings live in `findings.md`; per-step notes in
`lessons/`.

## Scope

Branches `feat/kdf-v2-core` (#417), `feat/kdf-v2-profile-cuts` (#418), `feat/kdf-v2-account-io`
(#419), `feat/kdf-v2-passkey-512` (#426), `feat/kdf-v2-dek-isolation` (#427),
`feat/kdf-v2-assurance` (#429), plus merged plumbing arcs #421–#425 where they touch crypto
seams. All present in this worktree's HEAD (`feat/account-file-ux`).

## Attacker personas

| ID | Attacker | Wins if they can… |
|---|---|---|
| A1 | Storage reader/writer malware | decrypt/tamper rows, forge envelope, launder via password-change |
| A2 | Sibling-profile holder (same phrase, knows profile B credential) | reach profile A's keys |
| A3 | Backup-file thief | use exported material beyond its grant |
| A4 | Malicious dApp | trigger ceremonies, replay payloads, confuse identity |
| A5 | Extension-context injector | forge internal messages into the background |
| A6 | Race driver | TOCTOU windows, double-persist, half-migrated states |
| A7 | Partial-phrase holder (23/24) | cheap completion via stored oracle |
| A8 | Lying RPC / chain-id confusion | mis-derive or collide account identities |

## Hypotheses → verdicts

| ID | Hypothesis | Verdict |
|---|---|---|
| H1 | Generated phrases are guessable / weakly sourced / reusable | pending |
| H2 | Unsalted passhash fast-path downgrades offline crack cost | pending |
| H3 | Passkey ceremony semantics abusable (wrong credential, dup, cross-profile) | pending |
| H4 | Messaging seam accepts forged/replayed payloads into derivation paths | pending |
| H5 | Parsers (export envelope, backup) adopt hostile input silently | pending |
| H6 | Storage tamper matrix escapes the degradation state machine | pending |
| H7 | Race interleavings break seal/session invariants | pending |
| H8 | v2 reduces security vs v1 somewhere concrete | pending |
| H9 | Secrets survive in heap/clipboard beyond policy | pending |
| H10 | Chain-id confusion derivable (fail-open path exists) | pending |
| H11 | An accepted risk is actually exploitable beyond its acceptance argument | pending |
| H12 | Full-chain derivation diverges from independent reimplementation | pending |

## Method

Every hypothesis ends exploited (PoC), refuted (executable evidence), or
accepted-with-argument. Harnesses run from this dir, never committed as fixes.
