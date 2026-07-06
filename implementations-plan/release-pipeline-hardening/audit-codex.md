# Codex audit — release-pipeline-hardening (xhigh, read-only)

Session `019f28d2-971c-7670-aa96-2125147f71eb`. Verdict: **conditional approve**.

## Verdict (verbatim)
> conditional approve (conditions: keep the Phase 1 deploy-job `always()` fix, but do not add the proposed `verify-live` success guards unless `status` also fails unexpected deploy skips; rewrite the live-repro risk wording).

## Findings

- **High — `verify-live` strengthening can hide the exact bug class.** Today `verify-live` has `always()` and only requires `attach-assets == success` (release.yml:414-419), so it still runs when `refresh-landing`/`deploy-faucet` skip and catches stale live sites. Adding `needs.refresh-landing.result=='success' && needs.deploy-faucet.result=='success'` makes it skip instead. Since `verify-live` is not in `status` and `status` treats `skipped` as OK (release.yml:552-569), a future deploy-skip regression could go green. → **Leave `verify-live` alone** (or make `status` fail on unexpected stable non-dry-run deploy skips — bigger, out of scope).

- **Medium — mechanism right but over-specified.** `always()` is the documented override for skip-propagation through `needs` (GitHub docs: expressions without a status function get implicit `success()`; skipped ancestors propagate). But the repro doesn't isolate `network-e2e` — on `workflow_dispatch`, `release-please` and `auto-unstick` are ALSO skipped. The fix doesn't depend on which skipped ancestor is responsible.

- **Medium — the live repro is not "harmless idempotent redeploy."** With `dry_run=false`, `attach-assets` runs `gh release upload --clobber` + `gh release edit --notes-file` (release.yml:329-334). No tag mutation, `publish_marketplaces=false` avoids marketplaces, BUT it overwrites release assets/body and fires production deploy hooks. It's a production republish/redeploy.

- **Low — fail-open risk mostly controlled.** The proposed guards block prerelease, dry-run, failed/cancelled `resolve`, failed/cancelled `attach-assets`. `needs.attach-assets.result=='success'` suffices for direct upstream cancellation; for stricter semantics use `always() && !cancelled() && ...` so a user-cancelled run can't later fire deploy hooks.

- **Facts/Inferences/Asks:** F1-F6 materially correct. F7/F8 rely on `gh` state codex can't verify locally. I1 sound (validate live). **I2 unsafe if `AUTO_UNSTICK_ENABLED` is flipped before the fix reaches `main`.** I3 overstated (dispatch mutates release assets/body).

## Looks fine
- Feature-branch dispatch is a valid test: `--ref` supplies the workflow version; reusable jobs checkout `needs.resolve.outputs.sha`. `v0.24.0` has the `apps/` layout.
- Break-glass workflow with `contents: read` + `workflow_dispatch` + `environment: production` + fixed secret-backed hook targets is reasonable; an Actions-write attacker gains easier CF deploy spam, not code-exec/new write power.

## Adopted vs rejected
- **Adopt (High):** drop the `verify-live` change entirely — leave it as-is.
- **Adopt (Low):** add `!cancelled()` to the two deploy-job guards.
- **Adopt (Medium):** re-label the live-repro as a production republish (re-clobbers v0.24.0 assets/body + re-fires hooks). Downgrade the phase gate to actionlint + logic-review as default; the republish is an OPTIONAL live-proof (user reconfirms at the gate given the new risk framing).
- **Adopt (Medium):** soften the mechanism attribution (any skipped ancestor — network-e2e / release-please / auto-unstick — propagates).
- **Clarify (I2):** the var flip is self-correcting — on `push:main`, `network-e2e` runs so deploys fire regardless of the fix; AND the fix reaches `main` via the promote (push:main #1) BEFORE the Release-PR merge where `auto-unstick` acts (push:main #2). So `auto-unstick` never runs on an unfixed `main`. Not a blocker; documented.

## Post-implementation audit (xhigh, session `019f2922…`): **approve**
No blocking findings. Confirmed: both guards run on stable push + stable dispatch (incl. skipped-network-e2e) and skip correctly for prerelease / dry-run / failed-or-cancelled resolve+attach-assets / whole-run cancellation; `verify-live` unchanged (tripwire preserved); `refresh-landing.yml` `inputs.target` conditions valid, curl fails-closed on `000`, no hook-leak path, `contents: read` not a meaningful over-grant; the pre-merge `AUTO_UNSTICK_ENABLED=on` reasoning holds.
- **Low (folded):** `target=faucet` with the faucet hook unset was a green no-op. Now **fails loud** when the faucet is explicitly requested (`TARGET` env + `exit 1`); `target=both` still tolerates the unset hook (dashboard Git-integration covers it). `always() && !cancelled()` noted as slightly redundant but sound — kept for explicitness + repo-pattern consistency.
