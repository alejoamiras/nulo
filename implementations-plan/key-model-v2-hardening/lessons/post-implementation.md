# Post-implementation round — `/code-review max --fix` + codex fix loop

The plan's six phases were green before this round started. This file records what the two
review passes found on the FINISHED tree, because both found real defects that every phase gate
had passed over — which is the argument for running them at all.

## Round 1 — `/code-review max --fix` (two parallel reviewers)

The crypto reviewer's verdict was "no correctness bug and no isolation break in the new
primitives", but its MEDIUM was the sharpest finding of the whole arc:

> v1 `sealImportedSigningKey(master, …)` is a live, exported, master-rooted seal for imported
> keys, i.e. exactly the isolation break the DEK design exists to prevent.

**Lesson: a version bump that leaves v1 exported has not removed the vulnerability, it has
added an alternative to it.** Three v1 pairs (imported-key seal, envelope MAC, session bearer)
were still exported with zero production callers. Grep confirmed the dead-ness, then all three
were deleted. A future call site reaching for the shorter name would have silently re-rooted
imported keys at the master.

Deleting them stranded tests that exercised v1. Two shapes of repair, and the distinction
matters: the v1↔v2 domain-separation tests became **moot** (one version left ⇒ nothing to
separate from) and were dropped; the master-only-forgery test was **not** moot — it asserts a
live property of v2 — so it was rebuilt to construct the retired scheme independently with
`node:crypto`. That test is now stronger than before: it no longer proves v2 ≠ v1-as-shipped, it
proves v2 resists a master-only MAC however you build one.

Two service findings, both applied: `changeProfilePassword` persisted a resealed row even when
its own re-unseal returned null (silently skipping the pairing check, the integrity pre-check,
and the MAC re-key ⇒ a self-inflicted degraded profile), and `onImportedKeysDegraded` was emitted
by three paths, declared on the client, and **subscribed by nobody** — while three code comments
and the spec doc all promised "a user-visible warning … never just a log".

**Lesson: an event with no subscriber is a comment, not a feature.** The comments were written
when the wiring was planned and never re-checked. When a doc-comment asserts that some OTHER
layer reacts, that assertion needs a grep, not trust.

## Round 2 — codex `xhigh` on the finished tree

Six findings. Three MEDIUMs shared one root cause worth stating on its own:

> **Only the unlock path verified MAC v2.** Every other site that trusted the DEK — password
> change, both fresh-auth export RPCs — had its own authentication (password round-trip, pairing
> check) and so *looked* safe, but none of them re-asked whether the stored MAC still covered the
> row.

Why that matters here specifically: `IMPORTED_DEK_AAD` is a purpose CONSTANT, not profile-bound,
so a same-password sibling's `dekSealed` transplants cleanly into another profile's row and
unseals there. The whole-envelope MAC is the only check that sees it. The worst path was
`changeProfilePassword`, which re-MACed whatever sat in the slot — laundering a tamper that
unlock had already quarantined into a freshly-valid envelope, after which the profile silently
adopts the attacker's key and every subsequently imported account seals to it.

The fix discards an uncovered DEK into the pre-existing mint-fresh self-heal rather than
refusing the password change: a slot the attacker replaced is already dead, so refusing would
deny a security operation over material that is unrecoverable either way.

**Lesson: a policy enforced at one gate is not a policy.** The degradation state machine was
specified per-path and implemented per-path; the invariant "never trust a DEK the stored MAC does
not cover" was never hoisted into a single helper. It is one now (`envelopeMacValid`), which is
what makes the next new call site inherit the check instead of re-deriving it.

The fourth MEDIUM was a lifetime bug of the same family — `consumeDekRewrapContext` swept stale
entries *excluding* the id it was about to pop, so the TTL never applied to the one entry that
mattered and an abandoned restore's raw source DEK stayed consumable for the whole SW lifetime.

**Every one of the three MEDIUM fixes ships a test that was verified to fail without it** (the
laundering check was reverted, the test watched go red, then restored). A regression test written
after the fix and never seen red is an assumption.

## Accepted, not fixed — and why

**HIGH: a password full-backup carries the long-lived profile DEK.** Real, and confirmed at
`export/full.vue:183`. Accepted for this arc, documented in-code at the export site. The reasoning
is narrower than "it's fine": it applies to PASSWORD blobs only (passkey blobs carry the DEK
sealed under the PRF wrap key); the same blob already hands over the plaintext master, so the
marginal leak is strictly *forward* reach to rows created after the export; and realising that
reach needs a SECOND independent compromise (later storage-read access). It does not weaken the
property the DEK exists for — a same-phrase sibling still cannot reach it. The clean fix is a
per-backup transfer key (rewrap every row at export under a fresh key, carry that instead), which
needs an export-side cross-service handshake mirroring `pendingDekRewraps` in reverse. That is a
follow-up arc, and the in-code note says so.

**LOW: the wallet fingerprint is an offline confirmation oracle.** Verified the arithmetic
independently — 23 known words leave exactly 8 checksum-valid completions (the 24th word carries
3 entropy bits + the 8 checksum bits), and the fingerprint picks the right one instantly. Not
fixed because it is **inherent**: the duplicate check runs pre-unlock against profiles whose
credentials are unavailable, so the comparand must be computable from the candidate master alone.
Cost-hardening the hash would not help — it is the 8-candidate search space, not the per-guess
cost, that makes that case cheap. The header doc now says this outright instead of the earlier
softer claim that it "only confirms a master the holder already possesses".

**Lesson: when a finding is inherent to the design, the deliverable is an honest doc, not a
mitigation theatre.** The previous wording was not false, but it was written from the
designer's threat model and would have let a future reader skip the partial-phrase case.

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/post-implementation.md
