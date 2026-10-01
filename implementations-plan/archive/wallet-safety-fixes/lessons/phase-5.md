# Phase 5 · The journal id comment (A5)

- Checked against the allocator again: `nextRandomId(storage, 16)` calls `getRandomHex(16)`,
  which draws `ceil(16 / 2)` = 8 bytes and returns 16 hex characters (64 bits). The default
  length is 8 (`id-allocators.ts:48`, `wallet-core/src/utils/random.ts:9-15`).
- The plan asks for one line. At this indent that line is 141 columns, past CLAUDE.md's
  100-character soft cap for comments, so the sentence, unchanged, wraps over two lines.
- Gate: `bun run lint` exit 0 (29 warnings, 3 infos; complexity baseline OK). `git diff -U0`
  for the file: 3 comment lines out, 2 comment lines in, 0 other lines.
