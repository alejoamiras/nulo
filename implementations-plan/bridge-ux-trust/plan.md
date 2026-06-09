# Bridge UX + trust arc (`feat/bridge-ux-trust`)

Branch: `feat/bridge-ux-trust` off dev `d3b20bf` (the merged private bridge, PR #78). Packages: `faucet`, `bridge-core`. **No contract changes** (recipient-commitment stays deferred), **no swap** (next arc). Blueprint tier: `deep` — three independent plans (main + codex `019eae00` + fable subagent) consolidated here; their full drafts live in [audit-codex.md](audit-codex.md) and [audit-fable.md](audit-fable.md).

Goal, user-visible: (1) private deposits stop double/triple-signing — first-ever per wallet = 2 L1 signatures, every later one = 1, same-session claims = 0; (2) the two bridge cards become ONE swap-style form — From/To with live balances, one-click flip, private toggle; (3) in-flight bridges become explicit journal cards — nothing auto-claims after a refresh, every dangling bridge is visible with a Claim/Finish/Discard action; (4) the two HIGH findings from the PV5 audit are closed structurally.

## Design decisions

### D1 — Journal: one key, milestone facts, derived stages
`nulo-bridge:journal:v1` → `{ schema: 1, records: [...] }`, parse-capped at `MAX_RECORDS = 100` (flood guard). Deposits keyed by `secretHashHex` (exists before any irreversible tx); withdraws by `exitTxHash`, with a provisional `wd-pending-<rand>` id between send and receipt (a tab killed mid-send leaves an `unknown-outcome` card instead of nothing). **Stages are never persisted — they derive from milestone facts** (`depositTxHash`, `leafIndex`, `claimTxHash`, `consumeTxHash`, `completedAt`), so storage cannot lie about progress, only about facts whose tampering is individually analyzed (§Security).

```ts
interface JournalBase {
  schema: 1
  id: string
  direction: "deposit" | "withdraw"
  isPrivate: boolean
  amount: string            // base units; DISPLAY-ONLY for private deposits (authoritative copy sealed)
  createdAt: number
  updatedAt: number
  completedAt?: number      // terminal: the SPECIFIC tx observed successful
  migratedFromLegacy?: boolean
  // deployment binding — refuse resume against a different deployment (testnet redeploys happen)
  chainId: number
  portal: string
  bridge: string
}
interface DepositRecord extends JournalBase {
  direction: "deposit"
  recipient: string          // display + pre-unseal guard for private; claim arg for public (self-authenticating)
  secret?: string            // PUBLIC only — recipient-bound by the L1 content hash (tamper ⇒ claim fails)
  sealedEnvelope?: string    // PRIVATE only — D2
  secretHashHex: string      // == id
  sealerL1?: string          // L1 account that sealed — unseal must use it
  depositTxHash?: string     // persisted the moment writeContract returns (leafIndex chain-recoverable)
  leafIndex?: string
  claimTxHash?: string
}
interface WithdrawRecord extends JournalBase {
  direction: "withdraw"
  recipientL1: string        // bound in the L2→L1 message (tamper ⇒ consume reverts)
  exitTxHash?: string        // absent only on provisional records
  exitBlock?: number
  consumeTxHash?: string     // existing recovery, per-record
}
```
Canonical stages (closed sets, e2e-stable): deposit `depositing → syncing|claimable → claiming → done`; withdraw `exiting → proving|consumable → consuming → done`. Runtime-only `attention` substate: `mismatch | tampered | unseal-failed | stale | unknown-outcome | error` (rendered as `data-attention`).

### D2 — Authenticated metadata: the sealed envelope (closes HIGH-a)
AES-GCM already authenticates its plaintext (`@nulo/wallet-crypto` `EncryptionKey`, PBKDF2-600k → AES-256-GCM; no AAD parameter — so metadata goes INSIDE the sealed plaintext; no second MAC format invented).

- Envelope v2 plaintext: `{"v":2, "secret":"0x…", "recipient":"0x…", "amount":"…", "leafIndex"?:"…"}`.
- **Seal #1** before any irreversible L1 tx (key-first ordering preserved): envelope without leafIndex.
- **Re-seal #2** after the deposit receipt yields the `MessageSent` index: same envelope + leafIndex, encrypted with the **in-memory `EncryptionKey` retained from seal #1** — **zero additional signatures** (fresh IV per encryption; the key never persists).
- Open + verify on claim/resume: one signature → decrypt → (legacy bare-secret fallback for pre-arc blobs) → enforce `envelope.recipient === record.recipient && envelope.amount === record.amount` (+ leafIndex when both present). Mismatch ⇒ **stop before any send**, `attention: tampered`, rewrite the display from the envelope (the authenticated truth), require a second explicit Claim. **Claim args always come from the envelope** — localStorage plaintext never reaches `claim_private`.
- leafIndex resolution order: envelope → L1 receipt of `depositTxHash` (`parseEventLogs(InboxAbi, "MessageSent")` — chain-authoritative, covers the crash-between-receipt-and-reseal window) → never bare localStorage.
- **Public deposits and withdraws get NO envelope and no signatures**: their L1/L2 messages bind recipient+amount on-chain, so metadata tamper yields a failed claim/consume (DoS-only, deletion-equivalent), not redirection.

### D3 — Seal-trust cache + signature economics (closes the double-sign; kills a third one)
- `nulo-bridge:seal-trust:v1` → `{ schema: 1, entries: { "<chainId>:<l1addr-lower>": { verifiedAt } } }` — bridge-core module with injected KV. **Positive verdicts only**; absence ⇒ the full two-signature self-test (existing `sealRecordSecret` semantics); presence ⇒ single signature. Never negative-cache (a failing wallet aborts the deposit and re-tests next attempt).
- Invalidation: any later GCM unseal failure for that account ⇒ revoke entry + `attention: unseal-failed` + **record untouched** (never delete on crypto failure) + Claim re-armed. No TTL (determinism doesn't decay).
- **The discovered third signature dies**: today the same-session claim re-unseals from storage seconds after sealing (`useDeposit.ts:173-180`). A module-level in-memory `Map<id, {secretHex, key}>` (never persisted; cleared on done/discard) makes same-session claims sign **zero** times.
- **Allowance-skip**: read `allowance(owner, L1_PORTAL)` first; skip the approve prompt when sufficient (deposit reverts safely if a race undercuts it).
- Net (private deposit): first-ever per wallet = 2 signs + (approve) + deposit + 1 Aztec claim; subsequent = 1 sign; post-refresh resume = 1 sign (the unavoidable unseal).

### D4 — Completion by the specific tx (closes HIGH-b)
- Deposit: capture `claimTxHash` from the send result (the proven exit-capture shape), persist immediately (stage → claiming), poll `node.getTxReceipt`: `success` ⇒ `completedAt`; `dropped` ⇒ clear `claimTxHash`, back to claimable, manual retry only; `reverted` ⇒ `attention: error` with the receipt error. **The entire preBalance/isCredited machinery is deleted.**
- Withdraw: already consume-receipt-anchored — ported per-record verbatim.
- A rediscovered record holding `claimTxHash`/`consumeTxHash` auto-FINISHES by waiting on that receipt — prompt-free, the send already happened (today's consume recovery, generalized). This does not violate the no-auto-claim rule.

### D5 — Journal policy: same-session auto-continue, explicit everything else
- `inFlight: Set<recordId>` per-record dedup (replaces the global booleans); different records progress concurrently.
- **`promptLanes`**: promptful actions serialize per wallet lane (one L1 lane, one Aztec lane — a promise chain each), so two same-session bridges can't race two wallet popups into the user; prompt-free polling runs freely. (codex)
- `sessionLive: Set<recordId>` — populated only by `deposit()`/`withdraw()` this page session. Auto-driven: sessionLive records + prompt-free receipt-waits. Everything else: read-only stage pollers only — withdraw proving countdown (`getProvenBlockNumber` 5s) and the public-deposit simulate-gate may pre-run (prompt-free, honest); a **private** rediscovered deposit shows `claimable` ("Resume claim") once `leafIndex` exists — the gate needs the secret and unsealing costs a signature, so the sync wait runs after the click (a dummy-secret probe is impossible: wrong secret yields the same "No L1 to L2 message found" revert).
- Account-mismatch refusal per-record, enforced pre-click (plaintext) AND post-unseal (envelope — the binding check).
- **Write-and-verify before irreversible txs**: the journal upsert is read back before `depositToAztec*` is sent; storage failure aborts the flow (today `persistPending` swallows exceptions and would proceed into stranding).
- The 870b300 second-deposit block is removed — per-record isolation replaces it (its test pin is removed with it, intentionally).
- Done cards retain data (including the sealed blob) until explicit **Clear** (distinct from Discard), auto-pruned after 7 days — downgrades claimTxHash forgery from blob-destruction to recoverable. (Disputed by codex — see Ledger L2.)
- Migration (runs once at journal init, parse-isolated per record, write-before-delete): legacy public deposit ⇒ keyed by computed `secretHashHex`; legacy private (`sealedSecret`) ⇒ `legacy-unauthenticated` attention, never auto-continues, manual accept-and-finish with a loud warning; secret-less/garbage ⇒ `stale` (discard-only); legacy withdraw ⇒ keyed by `exitTxHash`, `consumeTxHash` carried (its prompt-free wait auto-finishes). Migrated records are never `sessionLive`. Toast the count.

### D6 — Composables + components
- **Born:** `useBridgeJournal.ts` (module singleton: reactive records, runtime map, migration, watchers, `runDepositClaim(id)`, `runWithdrawConsume(id)`, `discard`, `clearDone`); `useL1Usdc.ts` (module singleton: `balance` 15s-poll + refresh hooks, `mint`, `allowance` — the ERC20 ABI moves here, gains `balanceOf`/`allowance`); components `BridgeForm.vue`, `MintTestUsdc.vue`, `BridgeJournal.vue`, `BridgeJournalCard.vue` (+ tests).
- **Rewritten:** `useDeposit.ts` → `useDepositFlow` (validation + trust-aware seal + record creation + L1 legs allowance→approve?→deposit, **mint removed** + milestone persists + sessionLive + hand-off); `useWithdraw.ts` → `useWithdrawFlow` (provisional record → burn/exit branches untouched → id upgrade → hand-off); `views/BridgeView.vue` (new tree).
- **Die:** `DepositCard.vue`, `WithdrawCard.vue` + their tests. `bridge-core/src/recovery.ts` + test (unused scaffold, grep-verified) — replaced by `journal.ts`.
- **Logging policy** (new code): record ids (secretHash is public on L1), stages, tx hashes. Never: secrets, envelopes, signatures, keys. (The repo-wide verbose-log cleanup remains a separate deferred pass.)
- Form behavior: direction state + flip swaps panels/balances/submit copy (`BRIDGE TO AZTEC` ⇄ `BRIDGE TO ETHEREUM`); privacy toggle switches the Aztec side between public/private balance + the per-direction note; progress lives on journal cards, not the form. Copy deck: fable's (audit-fable.md §2) — brutalist register, the load-bearing MintTestUsdc faucet-contrast block, seal-note first-time vs trusted, attention copy, two-step `DISCARD → CONFIRM DISCARD` with bearer-destruction warning.
- Testids (replace the `fa-deposit-*`/`fa-withdraw-*` block; verified unconsumed outside the dying components): `fa-bridge-form/from/to/flip/amount/balance-l1/balance-l2/privacy-toggle/privacy-note/seal-note/submit/form-error`, `fa-mint-l1`, `fa-mint-l1-status`, `fa-bridge-journal`, `fa-journal-empty/card/stage/claim/finish/discard/discard-confirm/clear/error/attention`; cards carry `data-id/direction/stage/privacy/attention`.

## Phases

### P1 — bridge-core foundations (pure TS, no UI, no signatures) ⬜
Files: `journal.ts`(+test) NEW; `recovery.ts`(+test) DELETE; `recovery-crypto.ts`(+test) EXTEND (`sealDepositEnvelope`/`openDepositEnvelope` v2+legacy-fallback, `sealDepositRecord({sign, binding, meta, trusted}) → {blob, key}` — trusted ⇒ 1 sign, untrusted ⇒ 2-sign self-test); `seal-trust.ts`(+test) NEW; `index.ts` exports.
Smallest proof: multi-record upsert isolation; parse cap; stage-derivation table (every milestone combo → canonical stage); envelope round-trip + **tamper rejection** (flipped byte ⇒ throws) + field-mismatch detection + legacy-blob fallback; trust: untrusted signs exactly 2× + aborts on the counter-signer, trusted signs exactly 1×, revoke/mark idempotent.
Validate: `bun run --cwd packages/bridge-core test && bun run --cwd packages/bridge-core typecheck && bun run lint`.

### P2 — faucet journal + flow rewiring (compat veneer keeps old cards green) ⬜
Files: `useBridgeJournal.ts`(+test) NEW; `useDeposit.ts`/`useWithdraw.ts` REWRITE (+ temporary compat exports mapping the newest live record to the old card API so `DepositCard`/`WithdrawCard` still compile this phase — every commit shippable); `useL1Usdc.ts`(+test) NEW; drop the 870b300 pin from `DepositCard.test.ts`.
Smallest proof (jsdom localStorage + mocked Contract/node/wallet, fake timers): ① migration of all legacy shapes + corrupt JSON; ② **no-auto-claim regression** — rediscovered claimable deposit + connected wallets ⇒ zero send/sign calls; ③ sessionLive record auto-continues through gate→send; ④ per-record dedup + two-id concurrency; ⑤ claimTxHash persisted → receipt success ⇒ completedAt; dropped ⇒ re-claimable; **unrelated balance change clears nothing** (HIGH-b pin); ⑥ envelope-recipient swap ⇒ no send, `tampered`, display resynced (HIGH-a pin); ⑦ unseal failure ⇒ trust revoked + record intact; ⑧ per-record mismatch refusal; ⑨ **signature counting**: first private deposit exactly 2 signs then 0 at claim; second deposit exactly 1; post-refresh resume exactly 1; ⑩ rediscovered consumeTxHash ⇒ receipt awaited, `writeContract` never called.
Validate: `bun run --cwd packages/faucet test && bun run --cwd packages/faucet typecheck && bun run lint`.

### P3 — UI swap (form + journal cards; old cards die) ⬜
Files: `testids.ts` block swap; `BridgeForm.vue`(+test), `MintTestUsdc.vue`(+test), `BridgeJournal.vue`, `BridgeJournalCard.vue`(+test) NEW; `BridgeView.vue` reassembled + hero copy; `DepositCard`/`WithdrawCard`(+tests) + P2 compat exports DELETED.
Smallest proof: flip swaps `data-chain` + balance positions + submit copy; privacy ON shows private L2 balance + bearer note; seal-note first-time vs trusted off mocked trust; submit threads `(amount, isPrivate)` per direction; disabled states (disconnect/zero/over-balance); mint fires + contrast copy renders; card stage matrix renders exactly the right action button per stage; two-step discard; mismatch disables claim.
Validate: `bun run --cwd packages/faucet test && bun run --cwd packages/faucet typecheck && bun run lint && bun run --cwd packages/faucet build`, then root `bun run audit:vue`.

### P4 — e2e smoke + polish + gates ⬜
Files: `packages/faucet/tests/e2e/bridge-smoke.test.ts` NEW (jsdom, mirrors faucet-smoke mock strategy + fake EIP-1193 provider): seeded legacy + journal records ⇒ migration produces cards, **no wallet call fires** (no auto-claim), explicit claim drives mocked flow to done, flip swaps `data-chain`, selectors testid-only. Logging sweep; copy proofread; lessons.
Validate: `bun run --cwd packages/faucet test:e2e && bun run audit:faucet && bun run audit:vue`, then `/code-review max --fix` → codex post-impl audit.

### NEEDS MANUAL TEST (testnet, signature-gated — the loop stops with these, never fakes a pass)
1. First-ever private deposit (fresh L1 account): exactly 2 signMessage + (approve) + deposit + 1 Aztec prompt, **no unseal prompt at claim**; card walks depositing→syncing→claiming→done.
2. Second private deposit, same account: exactly 1 signMessage.
3. Refresh mid-sync (private): card sits at `claimable`, nothing auto-fires; Claim ⇒ 1 unseal sign → sync → Aztec prompt → done. Repeat with hand-tampered localStorage `recipient` ⇒ `tampered` attention, no send, sealed values shown.
4. Two concurrent deposits (1 public + 1 private): independent cards, claims serialize per wallet lane, neither clobbers the other.
5. Withdraws (public + private): proving countdown live; refresh mid-proving resumes prompt-free; Finish ⇒ one consume prompt; tab killed right after Finish ⇒ reopen waits on consumeTxHash, no second prompt.
6. Mint: zero-balance hint → MINT 100 → balance updates → bridge does approve+deposit only; repeat deposit with leftover allowance skips approve.
7. Account-mismatch: deposit as account A, reconnect as B ⇒ claim disabled with mismatch copy.
8. Legacy migration: hand-written old keys (pre-private deposit shape + withdraw with consumeTxHash) ⇒ both migrate, old keys deleted, withdraw auto-finishes prompt-free, deposit waits for explicit Claim.

## Decision ledger

| # | Decision | Source | Rejected alternative + why |
|---|---|---|---|
| L1 | Stages DERIVED from milestone facts, never persisted | fable + main | codex persisted a `stage` field — rejected: persisted stage is one more tamperable bit and can contradict the facts it summarizes |
| L2 | Done cards retain the sealed blob until explicit Clear + 7-day prune | fable | codex scrubs secrets on done — rejected for testnet: a forged `claimTxHash` would then destroy the blob (deletion-equivalent attack made worse); retention keeps it recoverable; blob is GCM ciphertext under a ~256-bit-entropy key. **DISPUTED — revisit before any mainnet posture** |
| L3 | Per-wallet prompt lanes serialize promptful actions | codex | fable relied on per-record dedup + the wallet's own popup mutex — adopted codex's because the dApp shouldn't depend on wallet-side queuing for UX |
| L4 | Records carry deployment binding (chainId/portal/bridge) + stale-deployment refusal | codex | main/fable had it only for private (via the recovery-key message) — extended to public records; testnet redeploys are routine |
| L5 | Envelope re-seal (prepared → finalized w/ leafIndex) with the retained in-memory key | fable + codex (convergent) | main's plaintext-leafIndex (DoS-only) — superseded: authenticated leafIndex costs zero signatures, so take it; receipt-fallback kept for the crash window |
| L6 | In-memory secret cache ⇒ same-session claims sign 0× | fable | (no opposition — main/codex missed the third signature entirely) |
| L7 | Fresh `journal.ts`; DELETE `recovery.ts` | fable + main | codex upgraded `recovery.ts` in place — rejected on naming/clarity; same surface either way, grep-verified unused |
| L8 | ONE `useL1Usdc` composable (balance+mint+allowance) | fable + main | codex split into `useL1TokenBalance` + `useL1UsdcMint` — one ERC-20, one module |
| L9 | Public deposits stay envelope-free (no added signature) | all three | uniform sealing — rejected: public records are self-authenticating on-chain; +1 signature buys nothing |
| L10 | Validation commands: root `bun run lint` (no faucet-local lint script exists); `audit:faucet` + `audit:vue` as final gates | codex + fable (both caught main's wrong command) | adding a faucet-local lint script — unnecessary |
| L11 | Same-session-only auto-continue; receipt-waits exempt (prompt-free) | all three + user | time-window variant — rejected by user in Phase 0 |
| L12 | Mint = fixed 100, separate CTA with explicit L1-vs-L2 contrast copy | user + all three | embedded mint — rejected by user; user-entered amount — unnecessary for a test faucet |

Unresolved disputes carried to the audits: **L2** (retention vs scrub).

## Security & Adversarial Considerations
Assets in attack-value order: (1) the private bearer secret; (2) journal metadata steering resumed flows; (3) the seal-trust verdict; (4) the user's signing attention.

- **Attacker with localStorage write** (XSS or local access — can always simply DELETE records, so the bar is: no tamper achieves MORE than deletion): recipient/amount swap on a private record — CLOSED (envelope-authoritative claim args; mismatch halts pre-send). preBalance forgery — CLOSED structurally (field gone). claimTxHash forgery — DOWNGRADED to recoverable (L2 retention; capability ≡ deletion). leafIndex/depositTxHash/secretHashHex tamper — liveness-only (wrong leaf fails the message check; secretHashHex changes the derived key ⇒ loud unseal failure). Withdraw recipientL1/amount tamper — consume reverts (message-bound). Seal-trust poisoning — stranding-DoS, deletion-equivalent; revoke-on-failure + record-preserving UX; the cache is deliberately un-MAC'd (no key exists without spending the signature the cache saves). Journal flooding — `MAX_RECORDS` parse cap. Forged stale records baiting Discard — two-step confirm + nothing real to destroy.
- **Active XSS** (script exec on origin): can request signMessage and exfiltrate post-unseal — out of scope to fully stop here; mitigations: the per-record self-describing signed message is visibly odd out of context (anti-blind-signing copy), secrets never touch logs/reactive surfaces, the secret cache is module-scoped + non-reactive. CSP/security headers for the static host: separate hardening pass (user-deferred). Passive storage theft gets GCM ciphertext under a signature-derived ~256-bit-entropy key.
- **Crypto**: no new primitives — `@nulo/wallet-crypto` PBKDF2-600k + AES-256-GCM via the existing `EncryptionKey`; the envelope only changes the sealed plaintext. Per-record key derivation (chain+portal+bridge+secretHash message binding) untouched.
- **Copy/phishing surface**: the mint CTA must never read as value ("test", "no real value"); CLEAR (safe) vs DISCARD→CONFIRM DISCARD (destructive, armed) are distinct labels AND testids so habituation can't destroy a bearer blob; attention states explain rather than auto-resolve.
- **Prompt-flood**: per-record dedup + per-wallet prompt lanes; manual test 4 proves it.
- **Supply chain**: zero new dependencies.
- Red-team targets acknowledged: the migration path (parse-isolated per record, write-before-delete), dropped-claim retry (manual-only on rediscovered records), concurrent prompt racing (lanes + wallet mutex).

## Assumptions
**Facts (verified, file:line — full citations in the two audit transcripts):** triple-sign today (`recovery-crypto.ts:70-84` + `useDeposit.ts:173-180`); single-pending keys + 870b300 guard + auto-resume watchers (`useDeposit.ts:49,264-270,401-410`; `useWithdraw.ts:31,287-296`); HIGH-a/b mechanics (`useDeposit.ts:168-198,184-192,236-243`; `content-hash.ts:55-57`); GCM-without-AAD (`wallet-crypto/src/encryption-key.ts:34-47`); `recovery.ts` unused (grep); receipt/`TxStatus` surfaces incl. DROPPED enum; no L1 ERC-20 reader exists; capabilities already scope everything needed (`capabilities.ts:191-259`); `App.vue` v-show keeps both views mounted; old testids unconsumed outside the dying components; faucet has no package-local lint script; `audit:faucet` exists; decimals 6 both sides; legacy shapes incl. pre-private dev (`git show 5470839`); design tokens + `computeProgress`/`withdrawStatus` + explorer helper available.
**Inferences (unverified — audits attack these):** `node.getTxReceipt` yields a DROPPED-status receipt rather than throwing for unknown/evicted hashes (confirm early in P2; fallback: sustained-failure budget ⇒ treat as dropped); MetaMask/Rabby EOA EIP-191 signing is deterministic in practice (the self-test exists because it isn't guaranteed); the Aztec wallet queues concurrent prompts without corruption (extension-side mutex work suggests yes; manual test 4 proves); a switched-account simulate failure is classifiable as mismatch for rediscovered public records.
**Asks (user):** resolved in Phase 0 — multi-entry ✓, separate L1-mint CTA with explicit L1-vs-L2 copy ✓, fold HIGHs ✓, same-session-only auto ✓, branch off dev post-#78 ✓. Remaining at the approval gate: **A1** done-card retention (L2 — retain-until-Clear recommended) · **A2** legacy private records get manual accept-and-finish with a loud warning (recommended) vs discard-only · **A3** CSP/security headers stay a separate hardening pass (recommended).

## Out of scope
Recipient-commitment (contract change — the decided end-state, next contract revision); swap/fuel (next arc); repo-wide verbose-log hardening (deferred pass); real-browser Playwright bridge flows (follow-up once the UI settles); CSP headers (A3).

## Audit verdicts
- Round 0 drafts: [audit-codex.md](audit-codex.md) §Round 0 · [audit-fable.md](audit-fable.md) §Round 0.
- Contradiction-check, double audit, final codex pass: appended to the same files as they complete. PENDING.

## Seeds
Filled at the approval gate together with `eli5.html` (the recommended seed will be `/loop` self-paced — manual-test handoffs make completion not fully transcript-observable).
