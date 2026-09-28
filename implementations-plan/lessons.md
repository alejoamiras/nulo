# Lessons

Curated gotchas promoted out of closed plans, read at the start of every task so the same dead end is never walked twice. One line per entry, each linking its evidence: an archived lessons log or a permalink. The budget is 8 KiB; a new entry deduplicates against the rest and retires what it supersedes, and anything tied to a tool version carries its date.

## Authorization checks

- Validate both sides before comparing normalised keys: `key(a) === key(b)`, where `key` returns `undefined` for bad input, matches two bad inputs, and plain string equality let a malformed listed contract match an identical call target ([red run](grant-check-address-case/lessons/phase-1.md)).
