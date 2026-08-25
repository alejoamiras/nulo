# Codex plan audit — shell-identity-fences (round 1)

Session `01a03882-ebef-7ee0-bcf9-5e63fc914bc5` (xhigh, fresh, read-only). Verdict on rev 1: **REJECT**. Six findings, all adopted into rev 2:

1. N-05 under-implements the authorized fence — capture the FULL {profileId, networkId/chainId} scope (not chainId alone), compare live scope after every await in addition to the generation, hold the account client locally, guard before the awaited syncTransactions tail. → ADOPTED (extracted `network-switch.ts` takes the captured scope; split-statement discipline; local client; tail guard).
2. Rev 1's N-08 error behavior was FALSE (the generic catch branch silently returns; no toast exists; the outer logger unreachable) and the bootstrap wrap alone leaves the waiter hanging. → ADOPTED via `waitForProfileActive` + discriminated timeout toast + shell-side bootstrap toast (the waiter-signal half adjudicated to fable's smaller shape — logged disagreement).
3. 15 s ungrounded (transport 60 s; import handshake 30 s); null-guard the identity compare; RE-CHECK after `setLastActiveProfileId` (park-and-resume-under-B replaces B's managers). → ADOPTED (30 s; `?.`; post-await re-check).
4. N-23 equality guards are ABA-unsafe; `network.id` is the right identity; NEW: TaskService clears on profile change only, so a same-address NETWORK switch re-accepts the old-network task via address-only isExecutingTask (loadTokens shares the gap). → ADOPTED per-loader generations + loadTokens-in-reload; the cross-network task discrimination logged as OUT-of-scope residual (TransferContent schema change; adjudicated-Low finding) — flagged for final-pass ratification.
5. N-09 safe + complete except core.ts:10's stale header comment; REPLACE (not delete) the new-profile-helpers ordering pin with active-account-storage-before-route. → ADOPTED.
6. The test strategy was silently revertible (primitive pins can't prove app.vue wiring) — extract the watcher orchestration and pin deferred rapid switches, profile drift, ABA. → ADOPTED (the extraction is rev 2's centerpiece).

Sound per codex: mid tier, the owner-authorized removal, N-22's family catch, `network.id`.
