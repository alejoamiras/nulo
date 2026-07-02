# Codex audit — faucet-receipt-hero (light)

**Session:** `019f19c7-ea1e-7d43-87df-0a78eb236601` · effort xhigh · read-only · 2026-06-30.
**Asks:** adversarial/security, assumption-attack (Facts/Inferences/Asks), plan-soundness (variant matrix, dropped computeds, consumers), re-author-vs-rebase risk.

## Verdict

> **conditional approve** (conditions: guard fuel gas rows with `!isFuel`, make the done mark accessible, and fix the overstated assumptions)

## Findings (paths repo-relative)

- **HIGH — duplicate `receiptFuel` possible.** `hasFuel` is only `isDeposit && !!fuelReceived` (`apps/faucet/src/components/BridgeReceipt.vue:54`), so a valid-by-interface shape `{ direction:"deposit", assetKind:"fee-juice", fuelReceived:"1" }` is both `isFuel` (→ testid on hero) AND `hasFuel` (→ testid on `Gas ready`) = duplicate. Current callers avoid it — token bridge omits `assetKind` (`apps/faucet/src/components/BridgeForm.vue:224`), Fuel omits fuel fields (`apps/faucet/src/components/FuelForm.vue:100`) — but harden with `hasFuel = isDeposit && !isFuel && !!fuelReceived`.
- **MED — a11y.** The current stamp is readable text (`BridgeReceipt.vue:94`); a bare `✓` + `aria-label` on a generic `<span>` is inconsistently exposed. Use visible "Completed", or `role="img" aria-label="completed"`, or sr-only text.
- **MED / Fact 5 false as written.** Dynamic content isn't only numeric + hrefs: `ctaLabel` (`BridgeReceipt.vue:126`) and route/privacy/symbol (`:45`) are dynamic. Not XSS (Vue escapes; hrefs strict-hash-validated at `apps/faucet/src/lib/explorer.ts:18`) — but fix the claim.
- **LOW / Fact 2.** `assetKind` is a `ReceiptSnapshot` interface field (`BridgeReceipt.vue:18`), not a computed.
- **LOW / Inferences.** Keep the `fuelReceived present, fuelUsed absent` test explicit (the `usedDisplay` branch, `BridgeReceipt.vue:56`, covered today at `BridgeReceipt.test.ts:107`).
- **Re-author risk.** #99 touched only the 2 receipt files → low scope loss. But #99's thesis was "left-rule is the ONLY success mark"; keeping a `✓` deviates — don't carry forward stale comments claiming the rule is the single success mark.

**Codex "looks fine":** no `v-html`; tx links hash-gated; `boughtDisplay`/`stampWord` local-only; consumers pass no ignored props beyond the intended `ctaLabel`; the scripts named in the gates exist.

## Triage — all adopted

| # | Finding | Disposition |
|---|---|---|
| HIGH | duplicate `receiptFuel` | **Adopt** — `hasFuel = isDeposit && !isFuel && !!fuelReceived`; + a test asserting no shape yields two `receiptFuel` nodes. |
| MED | bare `✓` a11y | **Adopt** — `role="img" aria-label="completed"` on the eyebrow `✓`. |
| MED | Fact 5 overstated | **Adopt** — corrected to "all dynamic content is escaped text + hash-gated hrefs; not numeric-only". |
| LOW | Fact 2 mis-labels `assetKind` | **Adopt** — corrected to interface field. |
| LOW | keep used-absent test | **Adopt** — retained as an explicit variant in Phase 1's test rewrite. |
| — | don't carry "lone success mark" comments | **Adopt** — ledger note; both rule + `✓` are `--mint` ("mint is the only green", not the only mark). |

No findings rejected.

## Post-impl audit — approve (session `019f19da`)

> **approve**

Verified in the implemented files: all 3 plan conditions folded (`hasFuel` `!isFuel` at `BridgeReceipt.vue:56`; done-mark `role`/name at `:100`; Fact corrections doc-only). No new variant bug — Fuel gets exactly one `receiptFuel` on the hero (`:102`), fueled token deposits one on `Gas ready` (`:106-108`), `hasFuel` excludes withdraw + Fuel; the pathological duplicate is tested (`BridgeReceipt.test.ts:176-192`). Behavior drops are the intended ones (stamp / gross `Gas bought` / `.reserve`); dropping `→ Ethereum` from the withdraw hero is fine (route stays in the eyebrow). No `v-html`; tx links still strict-URL-helper-gated.

- **LOW (adopted):** the `✓` a11y was asserted via `[aria-label="completed"]` + text but not `role="img"`, so a regression dropping the role would pass. Added `expect(done.attributes("role")).toBe("img")` to the deposit test. Re-ran: 9/9 green.

No high/critical findings.
