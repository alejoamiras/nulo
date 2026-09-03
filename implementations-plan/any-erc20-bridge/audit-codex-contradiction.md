1. `plan.md:57,147` → `TokenPortalImpl` is described as having 65-byte runtime, while §Non-obvious mechanics correctly assigns 65 bytes to the clone runtime. → Fix: change line 57 to “clone runtime 65 bytes; implementation has normal contract runtime.”

2. `plan.md:21,151,186` → D2 deploys factory then hub, but P6 says `predict factory → hub → factory → … → hub`, implying two hub steps. → Fix: write `predict factory → derive hub address → deploy factory → publish Token class → deploy hub`.

3. `plan.md:123-124,185,209`; `drafts/plan-codex.md` §“TypeScript manifest and journal” → The recovery-key domain excludes token identity, yet Security/tests promise token-inclusive seal rejection. This silently rejects Codex’s `{factory,hub,kind,erc20,portal,l2Token}` domain and loses cryptographic cross-token binding. → Fix: adopt that full domain consistently in journal, backup, recovery, and tests.

4. `plan.md:157-159,171,185-186,196` → The file map omits required phase artifacts: `Keystone.t.sol`, `promotion.ts`, `SeedTokenPool.s.sol`, and the v2/generalized `smoke-existing-testnet.ts` and `fuel-testnet.ts`. → Fix: add them to Add/Modify, or remove the corresponding phase dependencies.

5. `plan.md:9,169,194,221` → Budget says `/code-review medium` per arc, but Arcs 0 and 5 are assigned `low`. → Fix: use `medium` for every arc, including the unmerged spike review.

6. `plan.md:225,245` → “P0–P10” is eleven phases, not ten; “arc N of 5” conflicts with Arcs 0–5 unless distinguishing five PR arcs from six work arcs. → Fix: state “eleven phases, six work arcs, five PR arcs” everywhere.

7. `plan.md:93-100,206` → The declared hub API has eight non-constructor external functions plus `_register` (or nine plus `_register` if constructor is counted), not “7 externals + 1 only-self.” → Fix: correct the count or describe the surface without a brittle number.

8. `plan.md:23,112,190,216` → I2 says the runtime list is exercised for real only on mainnet, while D4 prevents mounting `SendView` there. → Fix: state that production list behavior remains unexercised until mainnet SEND is enabled; testnet only exercises fetch/fallback mechanics.

9. `plan.md:74,202-203` → Security says a front-run produces identical metadata, but metadata is sampled on the first call and may be time- or caller-dependent. → Fix: say front-running cannot change portal/token identity but can freeze the first observed sanitized metadata.

10. `plan.md:59-74`; `drafts/plan-codex.md` §“Proposed architecture”/“Solidity”; `drafts/plan-fable.md` §2.1 → `createPortalAndDeposit…` helpers were retained by two drafts but silently removed, losing direct-EOA one-transaction creation/deposit. → Fix: restore the helpers or record their explicit rejection in the ledger.

11. `plan.md:33,130,152`; `drafts/plan-main.md` §bridge-core; `drafts/plan-fable.md` §2.7 → D14 attributes the proposal to main but selects fable’s 50% cap; main specified 40%. → Fix: ledger the 40%-versus-50% decision and use the selected value consistently.

12. `plan.md:182`; `drafts/plan-main.md` P4; `drafts/plan-fable.md` P2.3 → The drafts disagreed on TXE minimums (≥40 versus ≥33); the ledger omits this and silently chooses 33, losing main’s additive-test-count guard. → Fix: decide the threshold explicitly, preferably ≥40 or a named-test manifest.

D3–D5 residue: none found; no expiring pause, legacy-exit path, or FoT delta-accounting remains.

CONTRADICTIONS: 9  
SILENT_RESOLUTIONS: 4