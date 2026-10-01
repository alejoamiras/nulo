# balance-durable-jobs — lessons (both PRs)

## Recon

- Two Explore agents (sonnet) mapped 13 functions in ~5 min each: await maps,
  fences, coverage per function, seam candidates. The single most useful output
  was the coverage absence claim with its grep trail (`onTransactionUpdated` never
  invoked in `service.test.ts`) — it decided the BL/C pin list before codex asked.
- **Nesting rent explained two of the three clusters.** The store's score-60 arrow
  and the incoming service's three score-47/35 arrows were ordinary bodies paying
  +1–2 per branch for living inside closures-in-closures. Hoisting to nesting 0
  (a module-level class; private methods invoked directly by the lock callback)
  did most of the work before any seam was cut.

## PR-a (#508, 100→93)

- **Pinia setup store → module-level core class** is a clean, mechanical shape:
  method bodies verbatim, closure `let`s become fields, the setup body only
  constructs + installs the Pinia-context watcher + returns bound methods and the
  same `ref`. The 28-test suite + the fuzz property test ran zero-edit. An async
  method call runs synchronously to its first await exactly like the IIFE it
  replaces, so `const run = this.runGasFetch(...)` then `legFlights.set(run)`
  keeps the single-flight registration where it was — pinned by the same-turn
  duplicate-ensure pin codex asked for.
- **The generator inserted 1× (projectChunk at 21)** — the plan's "keep the loops
  inline, move only the guarded tail" cut was NOT enough (codex's audit had
  claimed it removed the finding; Biome disagreed). The hop-free deeper cut:
  pass 0 moves whole (it always awaits — chunks are never empty), and each arm's
  enqueue plan becomes a SYNC builder consumed by the same one-await-per-job loop.
- **Codex catch: a deterministic factory is not a total one.** Building every
  job's view fn up front would let a later job's invalid-impl throw pre-empt an
  earlier job's enqueue error — a different persisted `syncFailure`. Lazy
  instantiation inside the consuming loop restores the per-iteration throw
  order. Rule: when hoisting a call out of a loop, ask what it can THROW, not
  just what it returns.
- **Enum names bite silently in vitest**: `TxStatus.Success` / `OriginType.DApp`
  don't exist (`Finalized` / `DAPP`), evaluate to `undefined`, and the pins still
  passed by accident (`undefined !== Pending`). tsc caught it, the runner did not
  — run tsc on new pin files before trusting a green.

## PR-b (93→87)

- **Codex's five seam pins were all writable against the existing harnesses**
  without touching existing tests: `vi.spyOn(map, "set")` +
  `mock.invocationCallOrder` proves write-before-write / write-before-emit
  order across the in-memory repo mock and event listeners; the fresh-`isCurrent`
  pin parks the drain inside `await repo.getOutbox` (spying the Map's `get` to
  return a controllable promise — `await` unwraps it) and advances fake timers
  past the lock watchdog so the ticket is revoked before the row resolves.
- **Journal storage key shape**: `api.storage.local.get(null)` does not hand back
  the row under `nulo:journal@<id>` as a plain object — read persisted state
  back through the service (`getOperation`) instead.
- **The drain's anchored branch needed a sync classifier, not a helper**: the
  pending case takes zero awaits, so an awaited settle helper would add a hop on
  every waiting row. `anchoredRowAction(readTaskState(...))` → `"delete" | "clear" | "wait"`,
  then `if (action !== "wait" && isCurrent()) await settle(...)` — one ticket
  read immediately before the write dispatch, exactly as before.
- **Worktree guard**: heredoc appends and `$VAR`-computed sed in one command are
  refused; write the block to a scratchpad file and `cat file >> target`.
- **Type narrowing does not survive extraction**: `progress.txHash` only existed
  inside `if (progress.stage === "succeeded")`; the helpers take
  `Extract<JobProgress, { stage: "succeeded" }>`. Likewise a stage-keyed record
  indexed after a terminal-skip needs the narrowed key type (`ActiveStage`).
