# Round-2 fable/opus audits

## R7 fresh-context confidence pass (fresh Fable subagent, hostile, read-only)

**VERDICT: SHIP-WITH-NOTES** — no untrusted-reachable regression; one arc-introduced resilience
asymmetry (FIXED, #245) + coverage/honesty notes.

**Finding 1 [HIGH note] — arc-introduced balance-list fragility (Q-01×Q-13) → FIXED in #245.**
`getTokenBalances` (`token-balance/service.ts:120`) mapped every row through `getTokenBalanceInfo`,
which THROWS `"unknown token"` when the token is absent from the active-profile-only `tokens` map.
The arc newly makes a token absent (R1.4 requireOwnedRow; Q-01 codec-hiding); the sibling PROJECTOR
(`balance-projector.ts:111`) was hardened in-arc for exactly this, the display path was not → one
foreign/stale/hidden token white-screens the whole account list. Fable rated NOTE (no fully-traced
live caller — the accountAddress filter usually excludes foreign balances). **Fixed R6.5/#245**:
`.filter(x => this.tokens.has(x.token))` mirrors the projector; pinned failing-first in the isolation gate.

**Finding 2 [MED note] — Q-13 residual + isolation-gate over-claim → OWNER ITEM.** Unmigrated by-id/
arg-scoped methods still trust the CALLER's profileId (`token/service.ts:214` updateToken;
`account/service.ts:152,165` changeAccountName/Visibility; `auth-registry:124,250` getAuthwits/enabled;
`transaction/service.ts:91,95` getTransactions). **Fable confirmed ALL first-party-only** — none in
`wallet-bridge/services-contract.ts`, so no dApp can inject a foreign profileId; arc edits to these
files are strict improvements. This CORROBORATES the codex R7 adjudication (`audit-codex.md`). Separate
honesty note: `cross-profile-isolation.test.ts:3-5` states a broad invariant while covering a subset —
the docstring over-claims vs coverage. → owner decides fail-closed hardening (round-3 candidate);
optionally narrow the docstring.

**Finding 3 [LOW] — codec-gate fixture realism (Q-01).** `storage-codecs.test.ts` fixtures diverge from
real producers on TOLERANT `z.custom` fields (gasDetails/transfers-token). Those fields are pass-through-
verbatim (uncodec'd), so divergence doesn't affect codec correctness — but the gate can't catch real
producer drift on the VALIDATED fields beyond what it hand-authors. (The R5b canary catch is the live
detector for that class.) Low.

**Finding 4 [LOW] — P16b discover unpinned.** `discover/index.test.ts` is a pre-existing component test,
not part of the frozen 37; its shell-injected connect/disconnect order isn't pinned per-window. Extraction
itself verbatim-preserving (Fable confirmed). Low.

**Finding 5 [INFO] — migrate.ts KEYS_TO_WIPE** uses exact keys but rows live at `root@id`; legacy rows
survive a version bump into the new codecs. Pre-existing, mooted by no-production-users.

**ATTACKED AND HELD (Fable):** Q-02 widening (scope-checkers/capability-map/scope-enforcement byte-
unchanged; argSchema pass/fail; derive* identical with/without it); Q-02 legit-rejection (guards match
canonical WalletSchema+patch arities; only under-arity rejected; zero-arg requestCapabilities rejection
intentional+pinned); Q-02 ordering (guard only ADDS rejection post-assertKnownMethod; batch legs
re-guarded); Q-13 dApp path (finding-methods absent from services-contract; cascade only via
onProfileDeleted; by-id getters throw via requireOwnedRow; ids globally unique); Q-01 session DoS
(capability records z.custom tolerate passthrough; codec-fail hides+KEEPS row, recoverable); P18b
(generated proxy = identical 18-method ipxe subset; SW-only trio compile-excluded); P16b (no
double-reject, stable listener identity, no fast-cancel race, no param-spoof).

## Cross-leg synthesis
codex (`audit-codex.md`) and Fable INDEPENDENTLY converged: no dApp-reachable cross-profile regression;
the residual by-id/arg-scoped first-party surface is pre-existing + owner-gated (round-3). Fable's unique
catch (the projector/display asymmetry) is FIXED (#245). Both = SHIP-WITH-NOTES.
