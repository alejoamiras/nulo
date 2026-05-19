# Audit: bundle-fpc-nft plan-v1 (strategic critique)

> Audit by Plan agent (Opus 4.7), parallel pair to the codex xhigh static
> analysis. Agent ran read-only and returned this content inline; written
> here for the audit trail.

## DISAGREE-WITH-PLAN

### D1. PrivateFPC bundling has a non-obvious second-order consequence worth flagging
PrivateFPC is used by Nulo's own private-fee-payment flow. Today, that flow presumably works because the wallet itself (or the fee-payment dApp surface) is registering the artifact. Once it's bundled:
- Smart-tighten will let *any* dApp call `aztec_registerContract` with PrivateFPC's class-id minus the `artifact` and succeed — even dApps that have nothing to do with Nulo's fee-payment integration. That's the intended UX win, but it also means a malicious dApp can now construct an FPC instance and reference PrivateFPC's class-id without ever showing the user an artifact. The trust model in `artifact-registry.ts` (M4.3) handles this correctly because the `known` branch is keyed by load-time-computed classId — so this is safe — but the plan should explicitly call out: **"bundling PrivateFPC means the wallet now implicitly trusts dApps to hand it ANY PrivateFPC instance without showing the artifact prompt"**, and confirm the simulation/auth path treats those instances exactly like Aztec Token instances. The plan's risk #2 ("UX improvement") undersells this — it's not just UX, it's a small expansion of the wallet's "implicit trust surface" for that classId.

### D2. The "no instances" claim for PrivateFPC deserves a sentence more
SponsoredFPC has a canonical `salt=0` instance compiled in. PrivateFPC does **not** have a canonical instance — every deployment is per-admin/per-token with a unique salt. Good. But the plan's risk #5 reads as a throwaway. Worth being explicit: **PrivateFPC instances are user/dApp-specific; the bundle only resolves the class, not the instance. That means `getKnownInstance(address)` will still return undefined for any PrivateFPC, and dApps must still pass the instance via `aztec_registerContract` (just without the artifact).** This is exactly the right design but should be stated, otherwise a future reader will wonder "why no instance?" and re-derive it.

### D3. The duplicated JSON imports across `known-artifacts.ts` and `note-schemas.ts` is a real (small) smell — disagree with "fine as-is"
The plan says: *"Could share via re-export, but coupling these modules tighter than they already are isn't worth a deduplication that the JIT will inline anyway."* I'd push back gently: this isn't about JIT inlining, it's about **invariants drifting**. The two modules now both have to be edited together every time we add a contract, and the schema map is keyed by `getContractClassFromArtifact(...).id` — if one module loads a different artifact version than the other (e.g. someone changes the alias path in `vite.config.ts` for one but not the other, or rebuilds artifacts and only re-runs one cache), the schema map silently keys against a class-id that the known-artifacts bundle never produces. The notes-viewer would just fall back to raw rendering — silent failure. Not a blocker, but I'd file a follow-up: a tiny `bundled-artifacts.ts` module that exports `{ artifact, classId }` per contract, consumed by both. Don't do it in this PR — but track it.

### D4. The decision to skip bb.js class-id tests is correct, but the storage-layout gates don't replace the test that's missing
The plan defers the missing test to "manual QA on a real profile". I agree the WASM flakiness justifies skipping in CI, but the gap is real: **storage-layout tests catch slot drift, they don't catch class-id drift between `known-artifacts.ts` and `note-schemas.ts`.** If the artifact JSON changes (rebuild, version bump) and only one module's cache picks up the new bytes, the schema map will key against a stale class-id and the bundle will key against the new one. The storage gates won't fire because the slot is still 0x1.

Mitigation that doesn't require bb.js in unit tests: a single **integration smoke test** that runs once at extension startup (or in a dev-only `npm run verify-bundles` script) that loads both modules and asserts every classId in the schema map exists in the known-artifacts map. That's a one-line invariant check; it just can't run in unit tests. The plan should at least acknowledge this gap.

## SHOULD-FIX

### S1. Manual QA pathway is underspecified
The plan says "a profile that has interacted with PrivateFPC (e.g., the wallet's own private-fee-payment flow)". For PrivateFPC that's plausible — Nulo can dogfood. For **Wonderland NFT**, the QA path is much less clear. Where does a tester actually mint a Wonderland NFT? Is there a deployed instance on the testnet Nulo currently targets? If not, the manual-QA step for the NFT half of this PR is effectively "trust me, the storage-layout test passes". That's weak. Either:
- Identify a concrete Wonderland NFT deployment to mint against, or
- Add a temporary dev-script that deploys a Wonderland NFT to the local sandbox and mints to the active profile, or
- Acknowledge in the risks section that Wonderland NFT decoding is shipped on the strength of the storage-layout test plus manual code review only.

### S2. Slot collision invariant deserves a unit test, not just a comment
Plan risk #4 is correct: schema map is keyed by `(classId, slot)`, so Wonderland NFT's `0x5` and Aztec NFT's `0x7` can't collide. But there's no test asserting "no two contracts share `(classId, slot)`". Easy to add (iterate the loaded map, check uniqueness — actually it's a Map so uniqueness is structural, but you could assert "every contract has at least one slot entry" and "no slot map is empty"). Cheap insurance.

### S3. Bundle-size estimate is hand-wavy
"~20-50 KB each. Drop in the bucket vs. the existing ~57 MB chunk." For a Chrome extension where the offscreen document is loaded fresh per session, every KB matters more than it sounds — especially since the artifact JSONs are read once and held in memory. I'd want an actual `ls -la` on the two new artifact JSONs in the SHOULD-FIX category just to know the real number. If they're each 200KB+ (NFT contracts can be), the plan's "~20-50 KB" claim is wrong by 4-10x and the bundle-size note becomes load-bearing.

## NITS

### N1. Plan doesn't mention the version bump rationale
0.13.49 → 0.13.50 — consistent with the pattern, fine, but the plan doesn't say why this is a patch bump and not a minor. A user-visible behavior change (more contracts decode their notes, more dApps don't need to pass artifacts) arguably warrants minor under semver. Pre-launch so it doesn't matter, but worth noting the convention.

### N2. "expect 932 + 2 = 934 unit tests" is brittle reporting
This will be wrong by the time you write the PR if anyone else lands a test in between. Just say "two new tests, total count goes up by 2".

### N3. Out-of-scope item "Decimals badge" reference to plan-v3 is opaque
A reader without the plan-v3 history won't know what the "Decimals badge" is. One sentence of context.

## NOT BLOCKING — scope question

### Stay tight or extend?
The plan's instinct to stay tight is correct. **Reasoning the plan doesn't make explicitly enough**: each contract added to the bundle is a permanent commitment — once shipped, removing it is a breaking change for any dApp that started relying on smart-tighten resolving that classId without an artifact. Dripper, Escrow, GenericProxy, TestLogic are all "maybe useful later" — they have *zero* current usage by the wallet itself, unlike PrivateFPC. Adding them speculatively grows the bundle, the trust surface, and the maintenance burden (every aztec-packages bump means re-verifying their slots). Default-bundle should be: **(a) contracts the wallet itself uses, (b) contracts so widespread that not bundling them creates user friction**. PrivateFPC is (a). Wonderland NFT is (b)-ish. Dripper et al. are neither.

So: stick to 2. Disagree with anyone who argues for more. (Codex may push back on this — fine, the trust-surface argument is the strong counter.)

## Ordering / sequencing
Nothing needs to ship before this. The 3 prior PRs are landed. There's no migration, no profile schema change, no deletion. Independent and serial-applicable.
