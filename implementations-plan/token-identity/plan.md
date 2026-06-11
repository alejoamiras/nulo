# Token identity cleanup (NULO/OLUN faucet, AZLO bridge, capability-gated registration check)

Blueprint tier: `mid` (auto-fire: cross-package + a new wallet RPC = protocol surface). Branch: `feat/token-identity` off dev.

Driving ask (user): the faucet and the bridge currently both say "USDC" - confusing. Faucet drips become **NULO** (6 dec) + **OLUN** (18 dec); the bridged pair becomes **AZLO** (18 dec, L1 ERC20 + L2 token symmetric). Frontends + footer adapt. Plus ONE new custom wallet RPC - `isTokenRegistered` - **gated under the capabilities manifest** (user's call: an app must not probe registration state without an approved grant), so the frontends can hide "Add to wallet" buttons for already-registered tokens.

## Design

### D1 - Three tokens, fresh deployments, no aliases
On-chain names/symbols are constructor args - display-only renames would lie. New testnet deployments:
- Faucet (L2 drip tokens via the existing `packages/faucet/scripts/deploy.ts` + `deploy-config.ts`): **NULO** (6 decimals, USDC-shaped drip amounts) and **OLUN** (18 decimals - like-for-like with the existing ETH drip config) replacing USDC/ETH. `TokenSymbol` union + `FAUCET_TOKENS` config updated; per-token decimals already flow through `TokenCard`/`formatBigInt`.
- Bridge (via `packages/bridge-core/scripts/deploy-bridge-testnet.ts`): **AZLO** - a fresh L1 ERC20 (18 decimals, the existing MintableERC20 artifact - mint cap auto-scales) + L2 token (18 decimals) + portal + token_bridge + proxy wiring. The script hardcodes `6` in THREE places today and never asserts symmetry - it gains a single `DECIMALS` param + an explicit L1==L2 assert before wiring (the portal moves raw units; asymmetry mints wrong magnitudes).
- Old journal records bind to the old deployment → the existing `stale-deployment` attention with honest copy (by design; testnet).
- Deployment constants refreshed: `packages/faucet/src/contracts/deployments.ts` (drip pair) + `bridge-deployments.ts` (AZLO pair) + playground equivalents if present.

### D2 - 18-decimal AZLO forces real amount parameterization
The bridge frontend hardcodes 6-dec math beyond a `1e6` grep (both auditors). The EXPLICIT sweep list:
- **Parse (validation-critical)**: `BridgeForm.vue:83` `BigInt(Math.round(Number(amount) * 1e6))` - lossy at 18 dec; replaced by a new `parseAmount(text, decimals)` (string-split on the decimal point, BigInt math, truncate excess places - `Number()` never touches base units).
- **Display (seven sites)**: BridgeForm balances, BridgeReceipt, BridgeStepper headline, BridgeJournal toast, BridgeJournalCard amount - all `Number(x)/1e6`; replaced by the EXISTING `formatBigInt` (`lib/format.ts` - already decimals-parameterized and used by the faucet tab; a new formatter would duplicate it, fable MEDIUM-2). Only `parseAmount` is new.
- **L1 mint flow**: `useL1Usdc.ts` `MINT_AMOUNT = 100_000_000n` (a 6-dec literal a 1e6 grep misses - at 18 dec it mints 1e-10 AZLO) → `100n * 10n ** 18n`; `MintTestUsdc.vue` copy → "MINT 100 AZLO".
- One `BRIDGE_TOKEN_DECIMALS = 18` constant beside the deployment constants; the faucet tab keeps per-token decimals from `FAUCET_TOKENS` (note: the ETH drip is ALREADY 18-dec, so OLUN is like-for-like).
- Copy sweep "USDC" → "AZLO" across all bridge surfaces.

### D3 - `isTokenRegistered`: gated by the EXISTING `contracts` capability (dual-audit redesign)
Both auditors killed the draft's gating: a NEW capability type is impossible upstream (`AppCapabilitiesSchema` in aztec.js is a CLOSED Zod discriminated union - new types are rejected dApp-side, new fields on `accounts` are silently stripped, fable CRITICAL-1), and `registerToken` was the wrong template anyway (it routes through the PROMPTING popup path; there is no token-address scope checker today, codex). The redesign:
- **Enforcement = the granted `contracts` address list.** The manifests ALREADY list the token addresses under `contracts.contracts` (faucet `capabilities.ts`), `checkGetContractMetadata` is the exact per-address checker shape to mirror (`checkIsTokenRegistered` in `scope-enforcement.ts`), and the capabilities popup ALREADY renders contracts lists - informed consent for free (fable's fix; resolves codex's enforcement-point blocker and fable's HIGH-2 popup gap in one stroke).
- **Routing**: a NON-prompting read via the dispatcher's silent execution route (`METHOD_TO_KIND` / a reader injected at the background wiring) answering from `TokenService.getTokens(profileId, chainId)` (verified synchronous-readable). It does NOT mirror registerToken's interaction flow.
- **Schema patch ×3** (extension/faucet/playground, identical side-effect-only files) gains `isTokenRegistered: { params: [address], result: boolean }`; `dispatcher.test.ts` gains the paired reachability assertion AND a 3-copy CONTENT-EQUALITY drift test (the existing pin imports only the extension copy - faucet/playground drift was invisible, fable MEDIUM-1/codex).
- **Refusal semantics**: ungranted address ⇒ scope-violation error (never a silent `false` - a fake false would lie to fail-open UI and leak via behavior anyway).
- **Frontend use**: `useFaucetAddToken` + `BridgeAddToken.vue` (it exists - fable) check once per token on connect; registered ⇒ hide the add button; session-cached; RPC failure/scope-violation ⇒ fail OPEN (show the button).

### D5 - Grant lifecycle after the redeploy (fable HIGH-1)
The wallet's re-consent delta is TYPE-only for non-accounts capabilities (the filed `wallet-sdk-capability-field-diff` limitation): adding NEW token addresses to an already-granted `contracts` capability never re-prompts and never updates the stored grant - after the redeploy, existing sessions would be refused on the new addresses forever. **Decision: bump the faucet's `APP_ID` (e.g. `nulo-faucet#2`) with the redeploy** - a fresh app identity forces full re-consent with the new manifest. Heavy-handed but honest and testnet-cheap; the durable fix (field-level delta + UI) stays out of scope as the filed limitation.

### D4 - Footer + copy
`Footer.vue` lists the three tokens (symbol, decimals, addresses with explorer links where applicable) so the testnet identity is self-documenting. No em-dashes; brutalist mono.

## Phases

### P1 - Deployments + constants ⬜
Files: `packages/faucet/scripts/deploy-config.ts`/`deploy.ts` (NULO/OLUN), `packages/bridge-core/scripts/deploy-bridge-testnet.ts` (AZLO 18-dec pair), run both against testnet, refresh `deployments.ts` + `bridge-deployments.ts` (+ playground constants).
Smallest proof: deploy scripts run green on testnet; `verify-deployments.ts` (faucet) passes; the rebuild-instance address-match check passes for every new constant (the offline `rebuild* === constant` probe that caught nothing drifting last time).
Validate: script runs + `bun run --cwd packages/faucet test && typecheck`.

### P2 - The capability-gated RPC ⬜
Files: wallet-bridge (`scope-enforcement.ts` `checkIsTokenRegistered` mirroring `checkGetContractMetadata`; the silent read route in `dispatcher.ts`/`METHOD_TO_KIND`; `capability-map.ts` entry → `contracts`), the background wiring for the `TokenService.getTokens` reader, schema patch ×3, `dispatcher.test.ts` (reachability + gating matrix + the 3-copy content-equality drift test), faucet manifest `capabilities.ts` (tokens already listed under contracts - verify coverage) + APP_ID bump (D5), playground schema-patch copy.
Smallest proof: reachability; gating matrix - granted address ⇒ true/false from the registry without prompting, ungranted address ⇒ scope-violation (never silent false), no contracts grant ⇒ refusal; 3-copy equality; the popup's contracts card lists the token addresses (existing rendering - manual-check item).
Validate: `bun run --cwd packages/wallet-bridge test` + extension typecheck + `bun run lint`.

### P3 - Frontends + footer ⬜
Files: `lib/amount.ts` (+tests incl. 18-dec precision pins), the 1e6 sweep across bridge surfaces, `constants/tokens.ts` (NULO/OLUN), copy sweep USDC→AZLO, `useFaucetAddToken` registration check + button hiding (fail-open pin), `Footer.vue`, component test updates.
Smallest proof: amount round-trip pins (18-dec edge: "1.5" ⇒ 1500000000000000000n; sub-unit truncation; bigint-safe formatting of >2^53 units); add-token button hidden when registered / shown when not / shown on RPC failure; bridge copy pins updated; footer renders the three tokens.
Gates: `bun run audit:faucet` + `bun run audit:vue` + extension `audit:vue` scope as applicable → codex post-impl audit → manual checklist.

### NEEDS MANUAL TEST (testnet)
1. Faucet tab: drip NULO (6-dec amounts render right) + OLUN (18-dec); "Add to wallet" appears only for unregistered tokens and disappears after registering.
2. Bridge: mint test AZLO on L1, deposit public + private (18-dec amounts correct end-to-end incl. receipt + toast), withdraw back.
3. Old pending bridges (pre-redeploy) show the stale-deployment copy, not crashes.
4. The wallet prompt for the new manifest shows the registration-check capability; a build without the grant gets refused (scope violation in console, buttons stay visible).

## Decision ledger
| # | Decision | Source | Rejected |
|---|---|---|---|
| T1 | Fresh deployments with real on-chain names | main | UI-only aliases - lies about on-chain state |
| T2 | AZLO 18-dec both sides; amount math parameterized via BigInt-safe helpers | user (18) + L1/L2 symmetry requirement | keeping 6-dec to avoid the sweep |
| T3 | `isTokenRegistered` per-token, capability-gated, need-to-know address list in the grant | user (capability gating) + privacy | ungated query; full-registry list (leaks other dApps' tokens) |
| T4 | Fail OPEN on probe failure (button shows) | main | fail closed - a broken RPC silently removes functionality |
| T5 | NULO 6 / OLUN 18 replacing USDC/ETH drips | user | keeping ETH alongside |
| T6 | `isTokenRegistered` enforced via the EXISTING `contracts` capability address list (checker mirrors `checkGetContractMetadata`; popup renders it already) | fable CRITICAL-1 fix + codex (overruling the draft) | a new capability type - upstream Zod-closed; new `accounts` fields - silently stripped; ungated - forbidden |
| T7 | Silent dispatcher read route answering from `TokenService.getTokens`; refusals are scope-violations, never silent falses | codex + fable (verified route + registry) | mirroring registerToken's popup interaction route |
| T8 | APP_ID bump with the redeploy forces full re-consent (type-only delta would strand new addresses forever) | fable HIGH-1 | silently extending the granted contracts list - never re-prompts, never backfills |
| T9 | 3-copy schema-patch CONTENT-EQUALITY test joins the reachability pin | fable MEDIUM-1 + codex | trusting the extension-copy-only pin |

## Security & Adversarial Considerations
- **The new RPC is a read on wallet state** - the privacy surface IS the point of gating: per-token need-to-know in the GRANT (an app can only query addresses it was approved for); enforcement in wallet-bridge scope checks, mirroring the existing patterns; refusals are scope-violations, not silent falses (a silent false would leak via timing anyway and break fail-open UX honesty).
- **Decimals symmetry**: L1 ERC20 and L2 token MUST both be 18 - asymmetry mints wrong magnitudes through the portal. Pinned in the deploy script (assert both sides' decimals before wiring).
- **BigInt discipline**: 18-dec base units exceed 2^53 for >9.007 tokens-ish at full precision - all parsing/formatting via string/BigInt math, never `Number()` on base units. Precision pins required.
- **No new crypto, no new deps.** Schema-patch drift across the 3 copies pinned by the existing reachability test contract.
- Old-deployment journals degrade to the audited `stale-deployment` path.

## Assumptions
**Facts (verified):** `registerToken` maps to the `accounts` capability (`wallet-bridge/capability-map.ts:24`) and routes via DappInteractionService; the 3-copy schema-patch contract + reachability test exist (CLAUDE.md + `dispatcher.test.ts`); faucet drips deploy via `packages/faucet/scripts/deploy.ts`/`deploy-config.ts` (`TokenSymbol = "USDC" | "ETH"`, `tokens.ts:9-19`); the bridge pair deploys via `bridge-core/scripts/deploy-bridge-testnet.ts`; `Footer.vue` exists; bridge math hardcodes 1e6 (BridgeForm/Receipt/Stepper/Journal/cards).
**Verified by the dual audit (former inferences):** `TokenService.getTokens(profileId?, chainId?)` is the synchronous-readable registry; the playground carries a schema-patch copy (it does NOT carry a faucet-style manifest - only the patch copy updates there); `MintableERC20` is the L1 artifact and its mint cap auto-scales; the silent read route exists (`METHOD_TO_KIND`/ExecutionService) - the draft's GATING inference was wrong and is redesigned (T6).
**Asks:** the testnet deploys need the same funded deployer env the previous deploy scripts used (run before P3 starts); everything else resolved at Phase 0 + the fold.

## Out of scope
Swap/fuel; Playwright arc; release cut; recipient-commitment; any mainnet/extension-release work.

## Audit verdicts
- Dual audit (parallel, both outlines): **codex: reject** (accounts-gating unenforceable - no checker, type-only re-consent, no popup card; 18-dec sweep must include parse + L1 mint) · **fable: reject** (CRITICAL: new capability types are Zod-closed upstream / new fields stripped ⇒ redesign onto the `contracts` capability; HIGH: grant-upgrade dead end, popup consent gap, MINT_AMOUNT literal; MEDIUM: 3-copy drift, formatter duplication). CONVERGENT fix folded: T6-T9 + D2/D3/D5 rewrites. Both picked the redeploy outline.
- Final fresh-context codex pass: PENDING.

## Seeds
Drafts in eli5.html after the audits; finalized post-approval.

---

## Competing outline (alternative: display-alias without redeploys)
Keep all deployments; rename only in frontend constants + copy ("USDC" renders as "AZLO" etc.). Pros: zero deploy risk, one-day change. Cons: wallets and explorers show the REAL on-chain name/symbol (USDC) while our UI says AZLO - the exact confusion this arc exists to kill, now with gaslighting; the 18-dec ask is impossible (decimals are on-chain); "professional from day 1" dies. Main recommends the primary emphatically; the alias outline goes to the auditors for due diligence.
