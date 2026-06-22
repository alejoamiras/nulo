# C2 round 2 — Claude-side self-critique

## Missed

1. **NetworkService is a Large Class and neither Claude instance said so.** 781 LOC (verified `wc -l`); one class owns seed bootstrapping, endpoint validation, node caches, active-network persistence, backup/restore, and purge (network/service.ts:143-166, :604-690, :751-758). Codex round-2 caught it; we audited the file three separate times (F2/F3/F6 instances) without naming the outlier.
2. **ProfileService Large Class never became a Claude finding.** 1053 LOC. Claude-1 F9 sliced the password/passkey twins; neither instance named the class-level smell. Codex-1/2 F5 did; our rebuttal only conceded it reactively.
3. Minor: the session-expiry predicate `session.expiry < Date.now()` is hand-repeated at dapp-session/service.ts:59, :292, :315 — belongs in claude-2 F10's patchSession family; nobody cited it.

## Over-asserted

1. **Both F3s inflate the guard family with account/service.ts:189.** That `"unauthorized"` throw is inside `deriveAccountSecret` after `getProfileSecret(profileId)` (account/service.ts:186-191) — a different contract, not an active-profile lock guard. Codex's refutation holds; "four divergent strings" is really three.
2. **The rebuttal's headline refutation of codex-2 overstates.** "Cold-start null-deref path" at transaction/service.ts:109/:131: the `this.networkService.getNetworks` deref sits inside a swallowing try/catch (:125-135), so a cold-start TypeError silently becomes `submittedEndpointUrl = undefined`. Data-quality degradation, not a crash path.
3. **Claude-2 F4's mechanism claim is contradicted by a pinned test.** "A raw `Error` does not survive `jsonSanitize` the way a string does" — serialization.test.ts:88-91 pins that `jsonSanitize(new Error("boom"))` preserves `{name, message}`. The contact drift is real but the consequence is shape mismatch (object vs string), not loss.
4. **Claude-2 F5's "enter() inside try is a footgun on 66 sites"** — `Lock.enter()` (wallet-core/src/utils/lock.ts:19-28) has no throw path; the footgun is speculative. Codex's objection stands.

## Anchoring

1. Both instances organized the audit along clusters.md / repo-map "fleet pattern" axes (backup/restore, purge cascade, guards, locks, storage seam, PXE client). That horizontal frame is exactly why both missed the vertical plain-read findings (NetworkService/ProfileService Large Class) — the same confessed Codex blind spot, uncorrected on our side.
2. Change-frequency and test-coverage evidence is recycled map narrative, not measured: claude-1 F5 ("hottest file, 9 commits/3mo") and F6 ("matches the map's observation" that hard-coded-chrome services have zero tests) import the map's causal story despite the header claiming "counts are from fresh greps, not the map". Correlation presented as cause.
