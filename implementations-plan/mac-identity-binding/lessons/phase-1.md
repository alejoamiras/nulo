# Lessons — mac-identity-binding

## A self-contained integrity check cannot catch whole-row swaps

The first F-1 fix bound the profile id into the MAC preimage — and codex immediately showed
the bypass: write B's row VERBATIM (embedded `id: "B"` included) under A's storage key, and
every self-contained check verifies because it reads the forged embedded value. The anchor
must be OUTSIDE the attacker-swappable set: either the storage key suffix itself
(EntityStorage guard) or a caller-supplied requested id. Anything stored ON the row travels
WITH the row.

## Generic storage invariants don't generalize

Making the id/key guard universal broke 37 tests across five roots: dapp sessions legitimately
key rows by non-id keys, numeric ids coerce differently (`1 !== "1"`), and `String(1e21)`
aliases. The guard is opt-in per root with an explicit mode ("string" | "numeric") — and the
suite is the only reliable oracle for which roots can enable it.

## Red-team your own fix before shipping it

Every round of the codex loop found something the previous round's fix introduced or left
open (r3 found a hole in r2's own correction path; the finalize snapshot needed `type` added
after r4). A fix arc without an adversarial loop converges on "passes my tests", not "holds".

## Test precision matters as much as test existence

Two of my regression tests asserted less than they claimed: the swap test passed even while
B's master was in use (never asserted the degraded state), and the aliasing test copied row 1
while its name said row 5. Codex caught both by reading, not running. Assert the OBSERVABLE
STATE, and make the setup match the story.

LESSONS_FILE=implementations-plan/mac-identity-binding/lessons/phase-1.md
