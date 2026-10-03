---
plan: harden-dedupe / chain-id (arc 7 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/07-chain-id, stacked on harden-dedupe
---

# chain-id: one definition of the wallet's composite chain id

Finding Q-01 (a), from `audit/quality/2026-09-30-dedup-high/`. The wallet's chain id, `(l1ChainId ^ rollupVersion) >>> 0`, is written out six times across `aztec-runtime` and the extension. This batch keeps one definition and one decoder for the SDK's `chainInfo`. Every site computes the same `number` from the same inputs, in the same place in its guard sequence. Q-01 (b), the `ChainInfo` literals, belongs to execution-guards; Q-01 (c), the `NO_FROM` sender rule, belongs to dapp-grant-planning.

## Outcome & Quality Bar

- **For whom:** whoever next touches chain identity (the next protocol rollup redeploy, a mainnet seed, a new probe). Today a change to the composite has to land at six sites, and two of them are kept equal only by a comment, one of which already names the wrong file.
- **Excellent:**
  - The formula has one definition, which sits below every consumer.
  - The SDK `chainInfo` decoder has one definition.
  - Each site's output is pinned by literal values on the inputs where `>>> 0`, `| 0` and a bigint XOR disagree, before and after the refactor.
- **Good enough:** each call site keeps its own guards, carve-outs and error handling, line for line. Only the arithmetic expression is replaced.

## Architecture & Implementation

Read on `harden-dedupe` at `61260efc`.

### Sites today

- **Owner:** `apps/extension/src/utils/chain-ids.ts:12-14`, `walletChainId(l1ChainId: number, rollupVersion: number): number`. It is used for `CHAIN_IDS.TESTNET` (`:31`) and by `apps/extension/src/core/testing/fake-node-factory.ts:22,51`, and it is auto-imported (`src/types/auto-imports.d.ts:342,867`, `.eslintrc-auto-import.json:496`).
- **A1** `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`, inside `probeChainId` (`:92-102`).
- **A2** `packages/aztec-runtime/src/utils/chain-identity.ts:59`, inside `assertLiveChainIdentity` (`:46-65`).
- **E1** `apps/extension/src/wallet/services/network/service.ts:1016`, inside `_probeChainIdentity` (`:1009-1021`). `:24` already imports the constants from `@/utils/chain-ids`.
- **E2** `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16-21`, the exported `chainInfoToChainId` (an `Fr | string` decoder plus the formula). It is used at `session-established.ts:71` and `background.ts:646, 761, 1281` (import at `:87`).
- **E3** `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:44-56`, a private byte-for-byte copy of E2. It has a stale "mirror of background.ts" comment at `:44-49` and an `import type { Fr }` stranded mid-file at `:50`, and it is used at `:128`.
- `seed-preflight.ts` no longer computes the formula (recon). The doc-comments at `node-factory-port.ts:37`, `chain-identity.ts:37` and `chain-ids.ts:6` state the formula as a contract; they stay.

### Guard set per site (identical after the change)

| site | input source | guards, in order | position of the formula |
|---|---|---|---|
| A1 | RPC reply, schema-checked non-negative ints by the SDK client | URL allowlist refusal before any client exists (`:93-96`); single-attempt fetch (`:99`) | after `getNodeInfo`, no other check |
| A2 | RPC reply | canonical `l1ChainId` (`:47`, wallet-crypto); canonical u32 `rollupVersion` (`:48-52`); exact L1 equality (`:53-57`); local `chainId === 0` return (`:58`) | only after all four; its value appears in the mismatch message (`:62`) |
| E1 | RPC reply | `createNode` (adapter allowlist); `kindHint === "local"` → 0 (`:1014`); seeded local URL → 0 (`:1015`); everything inside `try`, so a failure becomes the generic `"Failed to fetch node info"` (`:1017-1020`) | last, non-local only |
| E2 | dApp-supplied `chainInfo` (`Fr` or string, any size) | none. A malformed string throws `SyntaxError`. At `:71` it runs before the handler's `try`, so the throw escapes before any marker read | the whole function |
| E3 | same as E2 | runs after the active-profile and stamp checks (`:116-121`) and the epoch capture (`:126`), inside the `try` whose catch logs and returns `undefined` (`:222-225`) | `:128` |

The formula holds no guard, so unifying it cannot drop or loosen one. The only risk is wiring: passing the wrong field, or moving the call across a guard. The per-site literal tests below catch both.

### What changes

1. **New leaf `packages/wallet-core/src/utils/chain-id.ts`:** `walletChainId`, moved verbatim, with one TSDoc sentence stating the invariant: it is the persisted storage-scoping and dApp-session key, so its value is frozen (unsigned 32-bit, a `number`). `packages/wallet-core/src/utils/index.ts` gains `export * from "./chain-id"` (alphabetical, after `arrays`). The README's pure-helpers file-map row adds `chain-id.ts`.
2. **`apps/extension/src/utils/chain-ids.ts`:** delete `:12-14`, then `import { walletChainId } from "@nulo/wallet-core/utils"` and `export { walletChainId }`. That keeps `CHAIN_IDS`, `fake-node-factory.ts`, `chain-ids.test.ts` and the auto-import entry unedited. `unimport` 6.4.0's `scanExports` records a named re-export under the re-exporting file, so `auto-imports.d.ts` stays byte-identical; Phase 2 proves it with a build.
3. **A1, A2:** `walletChainId(info.l1ChainId, info.rollupVersion)` and `walletChainId(nodeInfo.l1ChainId, nodeInfo.rollupVersion)`, imported from `@nulo/wallet-core/utils`. aztec-runtime already depends on wallet-core.
4. **E1:** `walletChainId(info.l1ChainId, info.rollupVersion)`, added to the existing `@/utils/chain-ids` import at `:24`. Everything else in `_probeChainIdentity` stays.
5. **E2:** `return walletChainId(chainId, version)` replaces `:20`, imported from `@/utils/chain-ids`. The two decode lines (`:18-19`) stay verbatim. That keeps `Number(BigInt(...))` precision loss above 2^53, `ToInt32` wrapping above u32, `chainId` decoding before `version` (so which malformed field throws first), and the signature.
6. **E3:** delete `:44-56`, the stale comment, the stranded `Fr` import and the copy. Import `chainInfoToChainId` from `./session-established`. `:128` stays unchanged.

### What stays

Every call site's surrounding lines, the port contract (`probeChainId(): Promise<number>`), `chainInfoFrom`, the canonical-range checks, all six `background.ts` and `session-established.ts` call expressions (including their `String(...)` wrapping), and every export name. No test file changes in Phase 2.

**Alternatives not taken:**

- *The audit's home, `aztec-runtime/src/utils/chain-identity.ts`.* `chain-ids.ts` would then re-export from `@nulo/aztec-runtime/utils`. That barrel pulls in `fetch.ts`, `Fr` and `@nulo/wallet-crypto` (whose `package.json` declares no `sideEffects: false`, and whose barrel imports `@aztec-labs/accounts`). It would reach every importer of `chain-ids.ts`: the popup (`components/ui/utils.ts:1`), the Node e2e helpers and `scripts/seed-preflight-node.ts`. wallet-core has no dependencies, and its `utils` barrel is already in the popup graph. See Asks.
- *Moving the decoder into `chain-ids.ts`.* That would add a `chainInfoToChainId` auto-import global and put an SDK wire decoder in a popup-shared constants file. E3 imports it from `session-established.ts` instead. That module was extracted from `background.ts` for exactly this reason, and its own imports (window-manager, pending-verification, wallet-bridge, logger) are light.

### Complexity

None of the touched functions is in `scripts/complexity-baseline/manifest.json`. Each edit replaces an expression or deletes code.

### Coupling with neighbouring arcs

- **dapp-grant-planning (arc 6, lands first):** it moves `extractSendFrom` (`queued-journal.ts:84-89`, Q-01 (c)). This arc's hunk at `:44-56` and its new top-of-file import neighbour that region, so this arc is drafted against `harden-dedupe` and replayed onto arc 6's head at restack.
- **execution-guards (arc 8, lands after):** it adds `liveChainInfo(node, network)` to `chain-identity.ts`, wrapping `assertLiveChainIdentity` and `chainInfoFrom`. It needs nothing new from this arc: `walletChainId` stays internal to A2's body, and A2's signature, messages and order are unchanged. Arc 8 also owns the stale "noop for local" comment at `apps/extension/src/wallet/services/execution/authwit-discoverer.ts:116`, because its fetch-and-assert clump replaces those lines. If arc 8 or a later arc wants the composite (in `wallet-bridge` too, which cannot import aztec-runtime), the wallet-core home serves it without a move.
- **network-endpoints (arc 9):** it edits `network/service.ts` for Q-04. This arc touches only `:24` and `:1016` there.

## Security & Adversarial Considerations

- **Who controls the inputs:**
  - A1, A2 and E1 read a node reply. A hostile or drifted endpoint picks `l1ChainId` and `rollupVersion`; the SDK's `NodeInfoSchema` admits any non-negative integer, including values above u32.
  - E2 and E3 read the wallet-sdk session or discovery `chainInfo`, which a dApp, or a compromised page posing as one, sets to any `Fr` or string.
- **Where the output goes, so why it is byte-frozen (a `number`, unsigned 32-bit, rendered decimal by the callers' own `String()`):**
  - the persisted network row's `chainId` and every per-chain storage scope and purge keyed by it;
  - the `(origin, chainId)` dApp-session lookup, whose row stores `chainId` as a string inside a MAC'd record (`dapp-session/integrity.ts`);
  - `SessionContext.chainId` (`background.ts:1281`), which the dispatcher resolves to a network and embeds in CAIP accounts (`aztec:<chainId>:<address>`) returned to dApps;
  - `InvalidChain` status (`network/service.ts:741, 760`);
  - the signing-boundary drift check (A2).

  A helper that returned a signed, bigint or hex value would re-key persisted rows and break MAC'd lookups, so the tests pin `typeof` and literal values at the boundary rows.
- **Account-address freeze:** the composite feeds no address, regime or key derivation. Derivation consumes the exact `l1ChainId` (`network/service.ts:1006-1008`; `LOCAL_L1_CHAIN_ID` at `chain-ids.ts:26-28`), which this arc does not touch.
- **No guard moves or merges.** Each site keeps its guard set from the table. A2's composite is still computed only after the canonical-range checks that defeat the above-u32 alias (`chain-identity.test.ts` already pins that alias and the two-coordinate collision). E2 still throws outside the handler's `try`; E3 still swallows inside its own.
- **Preserved, not fixed:** the E2/E3 decoder accepts non-canonical dApp `chainInfo` and maps it many-to-one, via `ToInt32` above u32 and `Number` rounding above 2^53. For example, `(l1 + 2^32, v)` lands on the same composite as `(l1, v)`. Rejecting it would change which sessions a dApp can address, so it goes under Drift as a follow-up lead.
- **Layering:** wallet-core sits below aztec-runtime and the extension. The new leaf imports nothing, so biome's wallet-core bans stay satisfied.
- **npm surface:** wallet-core is not published, but `scripts/publish/stage.ts` inlines workspace source into `@alejoamiras/nulo-wallet-crypto`, whose modules import `@nulo/wallet-core/utils`. A probe that added this exact leaf and barrel line staged all three packages byte-identical to the unchanged tree (`diff -r` clean, scratch only, reverted). Phase 2 repeats that diff.
- **Logging:** no log line changes. The decoder's output already appears in `session-established.ts` warn lines as a chain number, unchanged.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `61260efc`):

1. `git grep ">>> 0"` over `apps` and `packages` finds the formula in production code only at the six sites above. Every other hit is a test, a PRNG (`landing/feed.ts`, test helpers) or a doc-comment.
2. `NodeInfoSchema` (stdlib 6.0.0-rc.1, `contract/interfaces/node-info.js:6-7`) types both fields as `z.number().int().nonnegative()`.
3. E2 and E3 are byte-identical apart from E3's `function` keyword lacking `export` (`session-established.ts:16-21`, `queued-journal.ts:51-56`).
4. `@nulo/wallet-core` has no runtime dependencies (`packages/wallet-core/package.json`). The extension and aztec-runtime both declare it. `@nulo/wallet-core/utils` is already imported by popup files, by the e2e helpers (`tests/e2e/fixtures/aztec.ts`) and by wallet-crypto.
5. Staging all three npm packages with the probe leaf gives output byte-identical to the unchanged tree.
6. `unimport` 6.4.0 `scanExports` maps a `named` export to the scanned file (`dist/shared/unimport.BPLt6Ctw.mjs:297-301`).
7. Literal vectors, computed with today's formula: `(11155111, 2914217885) → 2904119610`; `(1, 1) → 0`; `(1, 2^31) → 2147483649`; `(1, 2^32 + 5) → 4`; `(11155111, 2914217885 + 2^32) → 2904119610`; `(11155111, 4127419662) → 4138294185`; `(31337, Number(2^64 + 3)) → 31337`.

**Inferences:**

- The popup bundle and `THIRD-PARTY-NOTICES.txt` stay unchanged, because the only module newly reachable from `chain-ids.ts` is a dependency-free file in a package the popup already loads. The Phase 2 build confirms it.
- Bun's and V8's `BigInt` parse errors differ in text, so tests pin the error class only.

**Asks** (for the plan panel):

1. **Home of `walletChainId`: wallet-core (this plan) or aztec-runtime (the audit writer's call).** The writer chose aztec-runtime because "nothing below aztec-runtime computes it". This plan's counter is the import graph above: the extension's popup-shared `chain-ids.ts` must re-export it, and re-exporting from aztec-runtime's barrel drags wallet-crypto and Aztec packages into the popup, the Node e2e helpers and the dev scripts. wallet-core costs one new file and nothing else.

## Phases

### Phase 1: pin today's values (test only)

Each row uses distinct `l1ChainId` and `rollupVersion` values, so a swapped or duplicated field fails. Every expected value is a literal from Facts 7, never derived from the production function.

- **`apps/extension/src/utils/chain-ids.test.ts`:** a `walletChainId` table over the five pairs from Facts 7 that `>>> 0`, `| 0` and a bigint XOR would split (testnet, equal pair, high bit, above u32, the above-u32 alias of testnet). Each row also asserts `typeof === "number"`. This file pins the moved function through its re-export, so it also fails if the re-export goes missing.
- **`packages/aztec-runtime/src/utils/chain-identity.test.ts`:** one row. Stored Sepolia with a live `rollupVersion` of `4127419662` throws a message containing the literal `composite=4138294185`, which pins A2's value as unsigned.
- **New `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.probe.test.ts`:** it `vi.mock`s `createAztecNodeClient` (spreading the real module) to return a node whose `getNodeInfo` answers a fixed pair. A separate file is needed because a hoisted mock would break the existing file's real-transport tests.
  - `probeChainId` resolves `2904119610` on the testnet pair and `2147483649` on the high-bit pair.
  - A non-allowlisted URL rejects with `refused to probe` and never constructs a client.
- **`apps/extension/src/wallet/services/network/service.test.ts:264-276`:** the existing formula assertion gains the literal `4138294185`.
- **`apps/extension/src/wallet/services/wallet-sdk/session-established.test.ts`:** a `chainInfoToChainId` table:
  - lowercase hex strings for the testnet pair → `2904119610`;
  - an uppercase `0X` prefix → the same;
  - decimal `"1"`/`"1"` → `0`;
  - `Fr` instances on the high-bit pair → `2147483649`;
  - mixed `Fr` and string → the same;
  - `Fr(2n ** 64n + 3n)` as `version` with `l1ChainId` 31337 → `31337`, which pins `Number` rounding against a bigint XOR (that would give `31338`);
  - a malformed string → throws `SyntaxError`.
- **`apps/extension/src/wallet/services/wallet-sdk/queued-journal.test.ts`:** a `test.each` over the high-bit `Fr` session and the testnet hex session. Each asserts that `tryGetDappSessionByOriginAndChain` receives the decimal string (`"2147483649"`, `"2904119610"`), and that `getAccounts` and `getNetworksRaw` receive the same `number`. A third row with a malformed `chainInfo` resolves `undefined` with no lookup made, which pins E3's swallow.

The phase is green against the unchanged code, in its own commit, so the test files are frozen before Phase 2.

**Mutation check** (scratch, reverted, logged in the arc's lessons file):

- Replace `>>> 0` with `| 0` in the moved function: the high-bit rows fail at every site.
- Make E2's decode bigint-exact: the 2^64 row fails.
- Pass `info.l1ChainId` twice at A1 or E1: their rows fail.
- Delete A1's allowlist check: the refusal row fails.
- Point E3 at a decoder returning a string: the `getAccounts` assertion fails.

### Phase 2: one definition

Make the six edits under "What changes", leaving every test file untouched.

**Validation gate (after each phase):**

- **Commands:**
  - the tests: `bun run --cwd packages/aztec-runtime test`, `bun run --cwd packages/wallet-core test`, `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run test:release`, `bun run audit:vue`;
  - `bun run build`, then `git diff --exit-code apps/extension/src/types/`;
  - from `apps/extension`, `bun -e` importing `./src/utils/chain-ids.ts` prints `2904119610` for `CHAIN_IDS.TESTNET`, which proves resolution outside Vite, as the seed-preflight scripts run it;
  - `bun scripts/publish/stage.ts --all --version 0.1.0 --out <scratch>`, run at the base and at the head, then `diff -r` between the two.
- **Pass criteria:**
  - every command exits 0;
  - the generated `auto-imports.d.ts`, `components.d.ts` and `.eslintrc-auto-import.json` are byte-identical;
  - `THIRD-PARTY-NOTICES.txt` from the build is unchanged;
  - the staged packages are identical;
  - Phase 2's `git diff --stat` lists no test file.
- **Screenshots:** none. No `.vue` or CSS file changes.
- **Layers:** unit and lint locally; the e2e lanes run in CI per the program gates. The network suite exercises E1, E2 and A2 for real.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, plus an independent Opus pass, as a MID batch requires. Each gets the adversarial, assumption-attack and implementation-critique asks; both must confirm the per-site guard table. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/arc-07-chain-id.md`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the gh stack, then add both e2e labels. When the program gates are green on the head SHA, with the run attempt and shards recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/07-chain-id`, stacked on `harden-dedupe` above dapp-grant-planning (the driver sets the parent at delivery). Code review: off.

## UI impact

None. No `.vue` or CSS file changes, and no copy changes. Every displayed chain id and `InvalidChain` badge is computed from the same value.

## Drift left for the alignment arc

- **No behavioural drift.** All six copies compute the same value today.
- **Stale comments:** `queued-journal.ts:44-49` is removed in this arc, because its lines are deleted. `authwit-discoverer.ts:116` ("noop for local") goes to execution-guards with the clump it describes.
- **Follow-up lead, not a dedup item:** the SDK `chainInfo` decoder accepts non-canonical fields (above u32, above 2^53, any `Fr`) and folds them onto canonical composites. A stricter decoder would change which dApp sessions resolve, so it is a security or behaviour decision, recorded for the program's follow-ups.

## Decisions (delegated)
