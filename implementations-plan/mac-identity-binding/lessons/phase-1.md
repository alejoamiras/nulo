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

## CI-starvation flake vs real breakage — discriminate by failure MOVEMENT

The first CI run failed three backup/MAC tests; the rerun failed two COMPLETELY DIFFERENT
tests (opfs purge budget, multicall fee timeout); every one of them passed locally on the
exact commit, some 3× faster than CI (401s vs 42s). Moving failure sets + healthy parked
states (`gotoAccounts` timing out while the wallet rendered fine beneath it) = runner
starvation, not logic. What made it safe to conclude that: the FULL local network suite
(99 tests incl. every CI-failing file) green on HEAD, plus #433's identical content passing
the same suites hours earlier. Two same-named failures in a row still demanded the local
reproduction before trusting "flake" — the repo rule holds: red means flake→rerun or
breakage→fix, and only a local run distinguishes them.

Also: `-rln` is not "recursive + line numbers" in ripgrep — bare `-r` CONSUMES the next
letters as its replace-with value and silently mangles output ("v2" printed as "ln"). Use
`-n` alone.

LESSONS_FILE=implementations-plan/mac-identity-binding/lessons/phase-1.md
