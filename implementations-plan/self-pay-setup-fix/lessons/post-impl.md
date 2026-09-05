# Post-implementation — codex fix loop

`code_review: off` — `/code-review` not run. Reviewer: codex (GPT-6 Astra) at `high`, fresh
session `01a073d5-2b8a-7180-8542-2b0b53d24218`, over the net diff from `898a3b99`, the plan
with its ledger, the adversarial ask and the two rules.

## Round 1 — VERDICT: conditional approve (findings 1–3 + the retry-0 CI evidence)

| # | Finding | Verified | Action |
|---|---|---|---|
| 1 MED | simulate cells never checked selector / argsHash / the mint's enqueue, nor that state stayed put | yes | `expectedMintCall` computes the selector, `computeVarArgsHash(encodeArguments(…))` and the finalisation selector from the artifact, the way the SDK does; every simulate cell asserts them and that the payer's public FJ + the recipient's private balance are unchanged |
| 2 MED | the transfer send oracle allowed a successful no-op; fee defaulted to 0 | yes | sender −1 / minter +1 via `readPublicTokenBalance`; every send requires a positive receipt fee |
| 3 MED | the refusal pin named an address the wallet did not hold | yes | the wallet fake holds a third account outside the session in both the sendTx block and the new block |
| 4 LOW | playground buttons disagreed on which FPC they target | yes | the section targets the canonical instance everywhere and refuses a `phaseFpc` naming another address |
| 5 LOW | the negative control accepted a retained older rejection | yes | only entries newer than the call count |
| 6 LOW | a click failure could leave `resultP` rejecting unobserved | yes | observer attached immediately |
| 7 LOW | four comments: "every claim" (false — the bridge simulates only after a registration), the summary header, "tolerate 1" (contradicted the throw), a reference to a removed helper | yes | rewritten / deleted |

Codex's security read: account selection stays bounded by profile, chain, session membership and
the capability/scope checks; a refusal does not disclose whether an ungranted address is a
wallet account; naming a fee payer is routing, not authority; the stubbed simulate proves
neither signing nor funds (as designed); the dev key stays in fixtures. It also noted the
PrivateFPC debits max gas cost, so the credit oracle is "decreased", never "equals the fee".

Applied in `ccfc935c` (post-rebase hash). The retry-0 CI evidence: `lessons/phase-4.md`.

## Round 2 — resumed session, the fix diff (`ccfc935c`, `fbf0a52c`) — VERDICT: approve

> No new material findings. Confidence: high from source review.
> The strengthened assertions bind the mint's selector, arguments and finalisation, verify
> transfer balances, and exercise refusal of wallet-owned accounts outside the session. The FPC
> guard and promise/log fixes are sound.
> VERDICT: approve. Required CI checks should pass on the rebased HEAD before merge.

Loop converged after two rounds. The PR is opened after this entry; its `network-e2e-status`
on the rebased HEAD is the CI evidence codex asked for.
