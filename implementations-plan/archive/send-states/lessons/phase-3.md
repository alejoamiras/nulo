# Phase 3 · The token card's load error

## Step 1 · Red on `85c4d20f`

The step-1 tests, run against `SelectTokenCard.vue` and `send.vue`'s token load as they are on
`85c4d20f` (P2's only `send.vue` edit is the fee card's `txShape`):

`apps/extension`: `bun --bun vitest run src/popup/components/modules/send/SelectTokenCard.test.ts src/popup/pages/`
→ exit 1; 2 files and 15 tests failed, 247 passed.

- `SelectTokenCard.test.ts` (2): no `failed` state (`expected { … } to match object
  { 'data-state': 'failed', … }`) and no `retry` event (`Target cannot be null or undefined` on
  `emitted("retry")`).
- `send.test.ts` (13): the four refused-read cases (five rows) end on the empty card, not the
  failed one (`expected 'false' to be 'true'` on the stub's `data-failed`), and a token added after
  B's refusal re-reads only the tokens, so the card never shows the load (`expected { loading:
  'false', … } to deeply equal { loading: 'true', … }`); tokens read with contacts refused, and an
  incomplete identity after a failure, the same; no Retry exists, so the retry cases never read
  again (`expected "vi.fn()" to be called 2 times, but got 1 times`) and the real card's tap on a
  failed load reads `empty`, not `failed`; a cold tab opened with `?tokenId=` for the second token
  lands on the first (`expected { …, symbol: 'TST' } to deeply equal { …, symbol: 'OTH' }`), the
  mount's preselect having run before the identity settled and `awaitingNewToken` then moving the
  active token to `tokens[0]`.

Controls, green on `85c4d20f`: a successful empty read stays empty and not failed; a refusal from
a superseded identity fetch leaves the newer fetch's card alone; loading wins over failed and a
token over both (the base has no failed state, so these guard the precedence the change adds).

## Step 2 · Implementation notes

- **`awaitingNewToken` follows the read, not the caller.** § S2 has the mount, and a Retry, arm
  it when their load succeeded empty. Built: every load that reads tokens sets it to whether the
  list came back empty, so a non-empty load also disarms it. A cold tab is why: its mount reads
  nothing (the identity is incomplete) and the identity watch's fetch is the first read, so a rule
  tied to the mount either never arms there (a token added to the settled empty list would not
  become active, which the base does) or arms on the incomplete return (the late identity's list
  then moves the active token off `?tokenId=`, Fact 28).
- One consequence reaches past the table: on a profile or network with no tokens, the first token
  added now becomes the active one. The base did that only after an empty mount; after a switch
  there, the card kept "No available tokens" beside the added token. Tokens are stored per
  profile and network (`getTokens`, `apps/extension/src/wallet/services/token/service.ts:220-224`),
  so an account switch alone never gets there. Pinned by the two-row `test.each` "a token added
  becomes the active token", added after the red run and checked against `send.vue` as of `7d53b775`
  (the base's token load): the cold-tab row passes there (a control: base behaviour kept), the
  switch row fails (`expected { loading: 'false', symbol: undefined } to deeply equal { loading:
  'false', symbol: 'OTH' }`). Listed for the owner's blanket sign-off; the panel's delegated call
  is in `plan.md` § Decided while the owner was away.
- `applyQueryToken` does not clear `awaitingNewToken` itself (§ S2 says it does): it applies only
  to a token in a non-empty list, which the line before it has already disarmed.
- No page-level guard against a second Retry: the real card is inert while loading, and the test
  for it mounts the real `SelectTokenCard` (the stub would pass without the card's guard).
- The three cold-tab tests share one `mountSend({ cold: true })` and `setIdentity` instead of
  three copies of the mount.

## Gate ✓

| Command | Exit | Counts |
|---|---|---|
| `apps/extension`: `bun --bun vitest run src/popup/components/modules/send/SelectTokenCard.test.ts src/popup/pages/` | 0 | 24 files, 264 tests passed |
| `bun run lint` | 0 | 29 warnings and 3 infos, as on the base; complexity baseline OK |
| `bun run typecheck:all` | 0 | 15 workspaces |
| `bun run test:all` | 0 | extension 608 files passed, 3 skipped; 8094 tests passed, 4 skipped, 8 todo (14 more than P2: 12 new tests and the pin's 2 rows). aztec-runtime 255 passed, 2 skipped; passkey-rp 5 passed, 6 skipped; every other workspace passed with no skip |
