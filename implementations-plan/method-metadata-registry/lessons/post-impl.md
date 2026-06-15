# Post-implementation — code-review + codex audit + fixes

## Pre-codex self-review (`/code-review max --fix` equivalent)
The project code-review skill is an interactive human tour (would stall an autonomous loop), so I did the Anthropic-family critical self-review inline. One nit found + fixed: dead `_typeProbe` in `method-descriptors.test.ts` (the `MethodDescriptor` import is now used by the Phase-3 add-a-method proof). Committed separately: `3c2fbfd`.

## Codex post-impl audit (`/codex xhigh`, adversarial on the authz boundary + exhaustiveness guard)
Prompt: `/tmp/codex-q1-postimpl-audit.md`. **Verdict: safe as shipped — no live authz regression.** Critical/High: None.

Codex independently VERIFIED:
- No method lost a capability gate or scope checker (the 18 rows are parity-clean vs the deleted `dev` literals).
- Leaf extraction behavior-preserving (checker bodies verbatim; the 3 lifted wrappers delegate identically).
- Routing/kind derivation matches the old tables + the active build switches.
- Unknown-method guard preserves the historical `Unsupported wallet method` behavior for ordinary names.

Two hardening gaps (not lost gates) — all addressed in `68fcc62`:
- **Low — prototype-bearing lookup.** `METHOD_REGISTRY[methodName]` (+ the derived-map accessors) made prototype names (`toString`/`constructor`) truthy → they bypassed the unknown-method guard and failed with a misleading `CapabilityNotGrantedError`. **Fix:** `Object.hasOwn` at the dispatch-entry guard, `getRequiredCapability`, and `enforceScope`. Now prototype names hit `Unsupported wallet method` (fails closed AND honors the error contract).
- **Medium — exhaustiveness weaker than claimed.**
  - The `scopeCheck || note` rule was documentary (a bogus free-text `note` would pass CI). **Fix:** explicit `SCOPE_EXEMPT_BY_DESIGN` allowlist (only `registerToken`) + an anti-rot check (allowlisted methods must exist, be non-exempt, and genuinely lack a scopeCheck). Skipping scope is now a deliberate, reviewable edit.
  - `DISPATCH_HANDLER_LITERALS` is a second hand-maintained list (drift risk). **Attempted fix + reverted:** a source-grep sync test (read `dispatcher.ts`, match `methodName === "x"`) — it threw `TypeError: The URL must be of scheme file` under the extension vitest config (`import.meta.url` isn't `file://` there) while passing under `--filter`. A unit test that reads source from disk is config-fragile, so I dropped it and reframed honestly: the **runtime dispatch-entry guard** (`Object.hasOwn(METHOD_REGISTRY)`) is the operational catch for ANY dispatchable method lacking a descriptor — that covers the drift codex flagged, robustly.

## Lessons
- `harden(...)` is NOT a valid conventional-commit type (commitlint rejected it twice → silent commit failure with HEAD unchanged). Valid types: build/chore/ci/deps/docs/feat/fix/infra/perf/refactor/revert/style/test. Used `fix(...)`.
- Disk-reading unit tests are config-fragile — `import.meta.url` resolution differs across vitest configs (`--filter` package config vs the root extension config). Avoid reading source files in unit tests; prefer importing values or relying on runtime guards.

## Final state
149 wallet-bridge tests (green under both `--filter` and root configs); the full extension suite + typecheck:all + lint green (the dropped fragile test removed the only failure). PR #91 opened to dev.

## Network-e2e attribution investigation (PR #91 CI)

PR #91's **Quality gate (required on dev) is GREEN**. The **Network e2e (advisory on dev)** failed 3 of 5 Aztec-agent shards — and **failed the same shards again on a `--failed` re-run** (consistent, NOT random flake; shard 1 ran 21m6s = a hung sandbox). Shards 2/4 + heavy(`concurrent-sendtx-confirm`,`fee-methods`) + canary(`real-proving`) + smoke PASSED.

**All failures are TIMEOUTS** (`waitForPopup` 30s, `waitForPgResult`/`waitForSendTxActiveStage` 120s/240s) — ZERO `Scope violation`/`CapabilityNotGranted`/assertion errors. Concrete failing test (shard 5): `multi-account-from — sendTx via first session account reaches active stage`, hanging at `waitForSendTxActiveStage` (popups.ts:408) — a sendTx proving-stage wait. Failing set spans unrelated tests (multi-account-from, meta-getChainInfo, sim-methods, tokens, transfers).

**Critical context:** the proverless network suite (PR #86) + the un-gating of authwit tests to proverless (PR #85) landed on `dev` TODAY. The last GREEN dev network-e2e runs are from May (pre-proverless). So current-dev proverless network behavior was never validated by a clean run — this PR may just be the first to exercise the freshly-landed proverless suite at full breadth.

**Codex consult #2 (`/tmp/codex-q1-network-help.md`, xhigh) — verdict: `not your change` (85%).** Reasoning:
- The `Object.hasOwn` sites are not hang primitives: a miss → `null`/`[]`/no-op + dispatch CONTINUES (capability-map.ts:23-27, scope-enforcement.ts:59-64). `METHOD_TO_KIND`/kind-sets don't affect the popup methods (their handler branches run before the kind lookup). Module-load is synchronous (no async/IO/cycle) — a broken import would fail from the FIRST call, not mid-shard after passes.
- The guard does NOT false-negative `sendTx`/`registerToken`/`grantPublicAuthwit` (own properties; exact spellings match the schema-patch + playground callers).
- **The decisive point:** the only refactor-specific timeout mechanism (popup rejected before handler → `waitForPopup` hangs) fits ONLY popup tests. The no-popup failures (`meta-getChainInfo`, `sim-methods`) wait on the result row directly → a bad registry/guard would surface as a FAST error, not a 120s hang. And `concurrent-sendtx-confirm` PASSED on CI — impossible if `sendTx` were mis-keyed at dispatch entry.

**Sharpest experiment (codex):** run `register-token.test.ts` via `bun run e2e:agent` on the branch vs `dev` — the cheapest direct probe of the one plausible refactor-specific mechanism (popup-open). Branch-arm in progress.

