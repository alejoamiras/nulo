# Cross-arc pass — codex over the whole migration (2026-09-15)

Reviewer: `/codex` (GPT-6 Astra, `high`, read-only sandbox), a fresh session over `git diff 323380f6..HEAD` with the cross-arc prompt (seam contracts, duplication across arcs, drift, whole-diff security, tests that cannot fail; both verbatim rules; "do not re-litigate the per-arc loops"; no vitest e2e configs).

## Round 1 — "Changes requested", 1 finding + 6 nits

| # | sev | finding | verdict | fix |
|---|---|---|---|---|
| 1 | MED | `tests/e2e/network/tx-sendTx-default.test.ts`: an unset `VITE_NULO_PRESTO_REQUIRED` was read as "the browser backend", but the flag only governs enforcement — a plain build still proves natively when a healthy HTTPS Presto answers, so the file times out on any box with Presto running (the owner's Mac) | accepted — codex confirmed the SDK emits the native sequence under production options | `waitForAwaitingCardBackend` takes the accepted `{backend, subtitle}` pairs (`PRESTO_AWAITING_CARD`, `BROWSER_AWAITING_CARD`): required mode accepts Presto only; a plain build accepts either, each with its own exact subtitle |
| n1 | — | `ProveBackend` defined twice (`aztec-runtime/pxe/chain-runtime.ts`, `wallet-core/jobs/types.ts`); `ProvePhaseName` hand-copied the SDK's phase union | accepted | `chain-runtime.ts` re-exports wallet-core's; `ProvePhaseName = PrestoPhase` (type import); the coordinator's `z.enum` list still pins the wire vocabulary |
| n2 | — | the health URLs repeated `src/presto/config.ts`'s host/ports; `https://presto.build` declared in both pages | accepted | `fixtures/presto.ts` builds the URLs from the config module; `PRESTO_SITE_URL` in `config.ts` |
| n3 | — | `implementations-plan/index.md` still said "implementing arc 1"; `CLAUDE.md` said every network shard installs Presto (the proverless pool and a `disable_presto` run do not) | accepted | both reworded |
| n4 | — | `aztec-update` skill's local prover-ON recipe omitted `PRESTO_ALLOW_ALL=1` and checked `Received /prove request`, which is logged before authorization | accepted | recipe matches the workflow; requires `Proving succeeded` |
| n5 | — | `presto-ui-state.ts` said every `PrestoInfo` field is absent on the minimal body (`protocol` is not); `wallet-core/jobs/types.ts` said `presto` means the witness left (`transmit` precedes the POST) | accepted | both corrected |
| n6 | — | `usePrestoStatus.ts` header carried review vocabulary ("C1 shape") and repeated the factory's cache doc | accepted | one constraint kept: dispose drops a late result, never cancels the probe |

Codex also reported the whole-diff security checks clean (the in-memory SDK check passed; no unescaped health-body string, no non-offscreen phase injection, CI pins and the fail-closed policy untouched by arc 2).

Gates after the fixes:

| gate | result |
|---|---|
| `bun run typecheck:all` | exit 0 |
| `bun run lint` | exit 0 |
| `aztec-runtime` / `wallet-core` `bun run test` | 29 files / 21 files, exit 0 |
| extension: `execution/`, `presto-ui-state`, `usePrestoStatus` | 43 files, exit 0 |
| armed build | exit 0 |
| smoke: `onboarding-tab`, `settings-proving` | 2 files, exit 0 |
| local network canary `bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts` (plain build, no Presto on this box → browser backend) | 1 file passed, exit 0 |

## Round 2 — converged

Resumed the round-1 session with the fix summary. Codex, verbatim: "Verified at `ab67d5ca`. **High confidence:** the material finding and all six nits are addressed. Eight in-memory checks against the actual helper callback passed: required mode rejects browser proving; plain mode accepts either backend; incorrect subtitles, missing evidence, and wrong stages fail. Type imports add no runtime dependency, and the config reuse preserves transport policy. […] No new material findings". Two rounds; the cross-arc pass is closed.

## Rebase onto the moved `dev` (2026-09-15)

`dev` advanced by eight commits while the loops ran — the harden 2026-09 remediation stack (#591–#596), the passkey RP worker (#598, #599) and the plan-index flip (#597). Both branches were rebased (arc 1 onto `dev`, arc 2 onto the new arc 1); `gh stack` linearity kept, no merge commits.

- **Messaging sender gate — superseded, not merged.** Harden b3 (#595) shipped its own design for the problem arc 1 solved in P4 and its codex loop: a generic `isSenderAtUrl(sender, documentUrl)` + `isBackgroundSender` in `core/sender-auth.ts`, the offscreen `ServiceClient` gating every inbound message through a protected `isAcceptedSender` (default: any same-extension context), and the extension narrowing it in `pxe/client.ts` (`isOffscreenDocumentSender` over the wallet-owned `offscreenUrl()`). That covers what `OFFSCREEN_PAGE_PATH` / `isOffscreenPageSender` / the client-level page gate did, including the arc-1 loop's finding 1 (an addressed event bypassing the gate — under `dev` the gate runs before any routing) and finding 4. Resolution: `dev`'s versions of `sender-auth.ts`, `offscreen/client.ts`, `offscreen/index.ts`, `testing/transport-harness.ts` and `wallet/utils/offscreen.ts` were taken whole; arc 1's `client.test.ts` event-gate block was rewritten onto `dev`'s idiom (an `isAcceptedSender` override in the test subclass, `emitMessage(message, sender)`): the default policy drops a foreign extension and a content script and passes a same-extension page; the exact-URL override feeds events only from the offscreen document (bare, `?instance=`, tab-hosted), addressed or not. The package suite is 216/216. `lessons/phase-4.md` and `post-impl-arc-1.md` describe the pre-rebase design; this entry is the correction.
- **Manifest.** `dev` moved the passkey origin to `https://passkey.nulo.sh/`; the branch keeps that plus both loopback schemes.
- **`execution/models`, `execution/spec`, `implementations-plan/index.md`.** Additive on both sides; both kept.
