# Verified findings — Phase 4 — Nulo extension security audit (max)

Final reconciled bands after independent cross-family verification. Each material finding was re-read from source by a second family (Codex verifier → `verify-codex.md`; Fable verifier → `verify-fable.md`) that stated its own conclusion before weighing the prior claim. Reduce-stage inputs: `consolidated.md` (Codex coordinator) + `fable-challenge.md` (Fable adversarial meta-review).

## Final table (most severe first)
| ID | Title | Final band | Verdict | Confidence | Found by |
|---|---|---:|---|---|---|
| F-01 | Raw-hash `createAuthWit` silently signs unscopable authwits | **Critical** | CONFIRMED | high | both |
| F-02 | Scope authorizes `call.name` while execution uses `call.selector` (also defeats the approval popup) | **High** | CONFIRMED | high | both¹ |
| F-03 | Tx signing re-fetches unvalidated chain identity after the guard (TOCTOU) | **High** | CONFIRMED | high | both |
| F-04 | dApp discovery can be flooded into unbounded queue / popup work | Medium | CONFIRMED | high | both |
| F-06 | Backup restore can silently disable strict mode and persist the passhash | Medium | CONFIRMED | high | codex+verify |
| F-07 | Approval UI renders dApp method labels/args without wire-string sanitization | Medium | CONFIRMED | moderate→high | claude+verify |
| F-08 | SW dispatcher consumes dApp RPC `unknown[]` with no server-side schema (root enabler of F-01/F-02) | Medium (systemic) | CONFIRMED | high | claude+verify |
| F-05 | dApp `logo` wired to unrestricted `<img src>` + no `img-src` CSP | **Low (latent)** | RECALIBRATED ↓ | high | both |
| F-09 | Offscreen PXE listener lacks sender/context authentication | Low (DiD) | RECALIBRATED ↓ | high | claude |
| F-10 | Firefox offscreen fallback can duplicate PXE listeners after SW restart | Low | CONFIRMED | high | both |
| F-11 | Password/passkey bearer has weak lifetime/recovery properties | Low | CONFIRMED | high | both |
| F-12 | Unsigned `DappSession` rows can mint grants if storage is tampered | Low | CONFIRMED | high | codex |
| F-13 | Malformed `ValueStorage` rows can abort wallet startup/restore | Low | CONFIRMED | high | both |
| F-14 | Seed/private-key export copies secrets to clipboard without clearing | Low | CONFIRMED | high | claude |

¹ F-02 was raised by Codex only in Phase 2; both families confirmed it at Phase 4, and the Fable meta-review + both verifiers additionally confirmed the **approval-popup escalation** (the popup renders the attacker's `call.name` while `call.selector` executes) — raising its impact beyond a silent-path bypass.

## Banding notes / disagreements resolved
- **F-01 Critical vs High.** Codex coordinator + Codex verifier → Critical; Fable meta-review → High (turns on the `canCreateAuthWit` precondition). Adopted **Critical**: the deciding evidence is that `canCreateAuthWit` is bundled into a commonly-requested `accounts` grant and is **invisible in the approval UI** (`popup/windows/capabilities/build-items.ts:32` skips `accounts` cards; `AccountSelectRow.vue:45` renders only account identity), so the user cannot withhold informed consent; after the grant, signing a raw `Fr` is fully silent, and the `unknown[]` message path (F-08) delivers the raw hash the typed SDK would not expose. Fund loss is credible (a forged authwit authorizes a third party/contract to move the user's assets).
- **F-05 Medium → Low (latent).** Two independent Fable passes proved there is **no production writer** for `dappMetadata.logo` (sole constructor `apps/extension/src/wallet/services/wallet-sdk/background.ts:535-541` emits `{name,url}` only; zero `.logo =` writes). The render sinks and the missing `img-src`/`default-src` CSP (`apps/extension/manifest/manifest.config.ts:42`) are real, so this is a **latent** Low: it becomes a live Medium the moment any path plumbs a dApp-supplied logo. Fix is cheap and pre-empts that.
- **F-09 High → Low (DiD).** The offscreen leg's "High via content-script relay" was refuted by three independent reads: no `externally_connectable`, and `content.ts` relays only via `sendMessage` inside a fixed SDK envelope that cannot set a top-level `to` — so a web page cannot reach the `{to:"pxe"}` listener today. Real missing guard, but defense-in-depth.

## Dropped / out-of-scope (not counted as extension findings)
- `packages/bridge-core` event-log emitter-trust issue — imported only by `apps/faucet` (`apps/faucet/package.json`), never the extension. Track in a faucet/bridge audit.
- Build-time iframe origin impersonation — real only if `VITE_NULO_ALLOW_IFRAME_DAPPS=1`, which the shipped Chrome/Firefox builds do not set; SW rejects subframes by default (`background.ts:172`).
- Authwit/entrypoint call-binding + multi-call chunking — Fable traced a 12-call payload end-to-end against upstream `@aztec/entrypoints@5.0.0-rc.2`; the outer signature transitively commits every wrapper's `args_hash`, no hidden call rides along. Sound; not a finding. (Distinct from F-01/F-02, which are authorization/scope bugs, not signature-binding bugs.)
- Fixed `Fr.ZERO` account salt, chain-identity XOR collision, `feePayer` unscoped-but-popup-gated, operation-journal cross-profile reads, logger secret-key redaction gap — real but sub-threshold; folded into fixes/cross-cutting notes.
