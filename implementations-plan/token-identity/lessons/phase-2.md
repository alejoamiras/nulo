# P2 - the capability-gated RPC + field-diff + consent copy (lessons)

## 2026-06-11 - P2 COMPLETE (`d048c2d`)
- `isTokenRegistered(address) → boolean`: capability-map → `contracts`; `checkIsTokenRegistered` mirrors `checkGetContractMetadata` (gated on `canGetMetadata` + the granted address list - the ONLY transit-safe gate, since grant shapes are upstream-Zod-validated and new fields would be stripped); a DIRECT dispatcher handler (no prompt, no execution op) answering via an injected `ITokenRegistryReader`; background wiring reads `TokenService.getTokens(profileId, chainId)` and compares lowercased contract addresses.
- **Contracts field-diff re-consent** (closes `wallet-sdk-capability-field-diff` for contracts): `contractsRequestCovered` - a request re-prompts iff some requested address/flag is NOT covered by the UNION of stored contracts grants; shrinking requests never re-prompt; approval APPENDS a grant and scope checkers union across grants, so coverage grows monotonically.
- Consent copy: contracts capability description + detail panel now name the registration check (D6 honesty).
- Schema patch ×3 extended (1-arg boolean entry, same upstream-drift guard shape); `dispatcher.test.ts` gains: reachability, the 3-copy CONTENT-EQUALITY drift pin (code lines compared, comments stripped - the copies legitimately name their own mirror paths), the gating matrix (granted ⇒ boolean; ungranted ⇒ scope violation, never silent false; no-metadata-flag ⇒ violation; no grant ⇒ refusal; reader-less build ⇒ explicit "not available"), and the field-diff matrix (covered ⇒ no prompt; new addresses ⇒ prompt - the redeploy path; flag upgrade ⇒ prompt).
- Suites: wallet-bridge 114 ✓ (104 + 10 new), extension typecheck ✓, root lint ✓.

LESSONS_FILE=implementations-plan/token-identity/lessons/phase-2.md
