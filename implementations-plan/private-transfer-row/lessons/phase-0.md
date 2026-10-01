# Phase 0 · Planning

- **Worktree.** Planned in a harness-created agent worktree on branch `worktree-private-transfer-row`,
  cut from `origin/dev` at `3452ac3b` (#740); `HEAD` equalled that SHA before the first file.
  `agent-worktree register private-transfer-row` refused it: the directory is not
  `.claude/worktrees/private-transfer-row` and the branch is not `worktree-agent-…`. Not forced; the
  manifest carries no row for this plan, so close-out has no `agent-worktree done` to suggest.
- **`bun install --frozen-lockfile`** at the root: exit 0.
- **Probes, deleted before the plan commit.** Two throwaway vitest files. The first, over the
  installed standard Token interface, confirmed that all four transfers read as decoded rows on a
  registered token today, which descriptor variant picks each, and that the burns and commitment
  transfers are outside the vocabulary (Fact 8). The second, in the node environment, hashed the
  vocabulary's 16 shapes with the descriptors' own types and both installed Tokens' functions
  (Fact 19). Vitest swallows `console` output in this repo's config; the probe wrote its table to a
  file instead.
- **Pictures, not committed.** A throwaway Vite page mounted the real `OperationCard` with the real
  design CSS at the window's width; Puppeteer shot each fixture at 2×, both themes. The "after"
  shots name the decoded fourth parameter `authwit_nonce`, which takes the exact rendering branch
  the alias will. Options that need code that does not exist yet were rendered by rewriting one
  line in memory at transform time: the two O2 nonce cells, and for T, a transfer surface carrying
  the decoded name with `callName` reading it. Capture runs held the host's e2e lock.
- **Audits.** codex round 1 rejected the draft (blocking: the selector-collision argument, and the
  title taken from the dApp's label); the Opus leg approved on six conditions, two of them the same
  findings. A fresh codex session conditionally approved the rewrite on five conditions; resumed on
  the edits that met them, it approved. All are in plan.md's Plan audit ledger with each
  disposition.
- **Live corroboration (not run here).** A store-capture agent on this host reported the same
  symptom on a running V6 wallet on 2026-10-01: the playground's `pg-btn-sendTx-default` public
  transfer read as decoded rows, its amount in base units and a zero `_nonce` row. That is Facts 1,
  4 and 8 on a real network; P4's e2e drives the same button on an imported token. The transfer
  row needs the token registered on the chain: a capture that never imports it keeps the decoded
  rows after the fix too.
