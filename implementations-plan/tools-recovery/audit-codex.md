# tools-recovery — codex audit (OpenAI leg, GPT-6 Astra at `high`, read-only)

## Round 1 — on plan v1 + the competing outline (2026-09-11)

**Verdict: reject** (with blocking findings: false completion paths, incorrect deposit matching, unsafe exit attribution and re-keying, and background wallet prompts).

Security
1. **High** — A trusts a journal-supplied `messageHash` as the deposit's identity; a hostile record can pair another consumed message's hash/secret with different displayed facts; an unrelated consumed-fuel error can trigger the check. Recompute the full message commitment from validated record/envelope fields, including the leaf index, before accepting nullification.
2. **High** — `flows.ts:222`: C accepts a match anywhere in `l2ToL1Msgs`, but `consumeWithdrawal`, `expectedWitness` and `consumedElsewhere` always select index zero; if zero is another already-consumed message the catch can falsely complete this exit. Require the expected commitment at index zero and revalidate before consuming/checking consumption.
3. **High** — one remaining transaction does not prove which attempted exit produced it; two hash-less records can share one candidate; an earlier identical exit inside the slack window matches an unsent attempt; `taken` ignores discarded/pruned records and competing provisional records. Refuse competing claims; do not describe window uniqueness as provenance.
4. **High** — `useBridgeJournal.ts:377`: re-keying carries `busy` but transfers neither `inFlight` nor the old-id cleanup; `journal.ts:389` overwrites an existing destination record. Guard source identity/completion and destination absence, serialize cross-tab attachment, preserve fresh fields, hand execution to the canonical-id lock.
5. **High** — the prompt rule is already false along reused paths: automatic receipt resume enters `claimGuards → ensureTokenGrant → retryCapabilities`; the fresh private branch at `:808` ignores `interactive`. Gate both on explicit interaction; test automatic resume with missing grants/secrets.

Assumptions — Facts
6. **High** — `send-flow.ts:158`: B's mapping misses real deposits: private token deposits publish recipient zero; `bridgeWithFuel.totalAmount` = journal token amount + fuel amount; gas records have no `token`; gas does not always use `bridge` (`sendEntrypoint:112`). Mirror the existing mappings; verify both recipients, both secret hashes and the fuel minimum output.
7. **Medium** — the paste outline calls receipt-leaf extraction an identity verifier; it checks router/event structure only. "Identical deposits cannot both be valid" is wrong: `hash.nr:19` includes the leaf index in the message hash. Copying public calldata does not imply knowing its secret.

Assumptions — Inferences
8. **High** — viem's `getLogs` rejects/omits `args` with `events` (`getLogs.ts:60,168`); block bodies need `{ includeTransactions: true }`; encode the real signatures in fakes.
9. **High** — A stays fee-dependent because its probe runs only after the simulate fails; fee construction can stop earlier; the public wording `"L1-to-L2 message is already nullified"` is missed by `isMsgConsumed`. Probe validated material before fee construction; return a distinct completed outcome from `awaitConsumable`.
10. **Medium** — wall time → chain time keeps clock skew; caps, missing history and RPC failures are "search incomplete", not "none"; bound RPC duration/candidate volume; recheck canonical block/receipt identity before attaching (a reorg can latch an orphaned hash).

Assumptions — Asks
11. **High** — "none open" silently accepts RPC honesty, permanence of `latest`, and attribution of identical exits; a fabricated witness can mark unclaimed funds done. Settle the trusted-node/finality boundary explicitly and whether a matching payment destination suffices for C.

Implementation
12. **Medium** — an externally wired dep cannot reach module-private `secretCache`/`publicClaimSecretOf`; pass resolved material explicitly; restrict the hub derivation to hub token records. Three optional deps fit; keep scans app-local.
13. **Medium** — extract classification and attachment control flow rather than growing the runners; add regressions for private matching, multi-message exits, concurrent completion, prompt suppression.
14. **Medium** — prefer corrected B scanning plus a verified-hash fallback; C needs explicit attribution when ambiguous; keep shared verifiers independent so reverting A does not disable B/C.

Confirmed sound: hub/private-secret formula and node-client membership API; additive schema field; tools-only scope; no proposed deposit/burn resubmission.

### Triage (driver, verified against the repo)

| # | Verified? | Call |
|---|---|---|
| 1 | yes — `L1ToL2Message(sender: L1Actor(portal, chainId), recipient: L2Actor(hub, version), content, secretHash, index).hash()` recomputes the commitment from record facts (`messaging.nr:15-27`, stdlib `l1_to_l2_message.d.ts:24-36`); contents at `content-hash.ts:49-54` | **adopted** — A recomputes the message hash and requires it to equal `rec.messageHash` |
| 2 | yes — `flows.ts:222`, `useHubExit.ts:189` read `l2ToL1Msgs[0]` | **adopted** — C requires the recomputed hash at index 0 |
| 3 | yes — `taken` is this journal only; identical exits share a hash | **adopted** — attribution rule rewritten; ambiguity refuses; the residual is an accepted Ask |
| 4 | yes — `rekeyRecord` filters `next.id` (`journal.ts:389-393`); `withRecordLock` keys `inFlight` by id (`:625-642`) | **adopted** — attach returns `{ rekeyedTo }`; the outer runner re-enters under the new id; destination absence guarded |
| 5 | partly — `prepareSendLane`/`resolvePrivateClaimMaterial` on a NON-interactive run happen only for records this page session started (`resumeActionFor` skips the rest) — the journal's stated exception | **rejected as pre-existing and by design**; the new branches take no prompting path; a unit test pins that a non-interactive run with no cached secret returns `null` and asks for nothing |
| 6 | yes — `witnessRecipient` publishes zero for private token deposits (`send-flow.ts:150-154`); `totalAmount: p.amount` (`:180`) with the record's `amount = total − fuel` (`SendWizard.vue:890`); gas-only entrypoints (`:112-116`) | **adopted** — B filters by router + event, post-filters on the decoded secret hash(es), then verifies calldata; scope = hub token records (`claimsThroughHub`) |
| 7 | yes | **adopted** — outline text corrected; leaf-index note |
| 8 | yes — viem 2.55 `getLogs.js:35` | **adopted** — one `event` per call |
| 9 | yes — `public_context.nr:259` wording; probe order | **adopted** — the nullifier is read BEFORE the claim build; `isMsgConsumed` gains the public wording; `awaitConsumable` returns a tri-state |
| 10 | yes | **adopted** — `"incomplete"` outcome; receipt/effect re-check before the write |
| 11 | yes | **adopted as explicit decisions** for the approval gate (trusted node = the app's existing boundary; destination-match suffices for C) |
| 12 | yes | **adopted** — `messageNullified(rec, secretHex)` |
| 13 | yes | **adopted** — helpers + regressions listed per phase |
| 14 | design choice | **partly** — scan ships; paste fallback stays out of scope (fable agrees); ledger records the disagreement |
