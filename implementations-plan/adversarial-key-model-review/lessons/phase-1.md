# Lessons — adversarial-key-model-review

## Harness correctness is adversarial too

Three of my own checks failed for harness reasons, not target reasons — each worth recording
because the same trap eats real audits:

1. **Birthday-paradox blind spot**: asserting "no duplicate words in 9600 draws over a 2048
   vocabulary" fails by design (~22k expected collision pairs). The correct wordlist check is
   structural (extract + assert 2048 unique/sorted), not statistical.
2. **JSON cannot carry -0**: `JSON.stringify(-0) === "0"` — any "-0 slips through validation"
   hypothesis is dead at the serialization layer before the parser runs.
3. **Whitespace mutations produce semantically identical accepts**: a garbage-storm fuzz that
   counts string-level accepts flags JSON whitespace-insensitivity as a "hit". Compare parsed
   content, not input strings.

## Runner discipline

`bun test <file>` on wallet-crypto fails (`expect.addEqualityTesters` missing at
`@aztec/foundation` import time). The packages run under **vitest** (`bun run --cwd <pkg>
test`). Extension-tree tests need the app's vitest config for the `@/` alias.

## Reproducing a documented residual beats citing it

T5 (full-envelope swap identity adoption) was a codex MEDIUM sitting in a lessons file with an
owner decision pending. Reproducing it took one integration-style test and turned the
documented risk into executable evidence with exact observable behavior. Fix-arguments decay;
reproductions don't. (Same session: T4/T6 confirmed the *defenses* live, which matters just as
much — a fix verified to fail without the change is only half proven.)

## Read the ledger before hunting

Two planned findings died on contact with the code: the passhash persistence I came to attack
was already removed (F-11, pre-dating this stack), and the "does v2 downgrade security"
question had its v1 baseline documented inside #417's own plan body ("the words stop being a
raw re-encoding of the master"). Grep the history/plan docs first; spend the budget on the gaps.

LESSONS_FILE=implementations-plan/adversarial-key-model-review/lessons/phase-1.md
