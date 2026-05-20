# Fix-up re-review — bug-fixes batch #1

## Verdict
APPROVE

## Items
- #1 (helper returns to `/popup/general`): fixed. `switchToNetwork()` now sets `window.location.hash = "/popup/general"` after the `network-set-active` click and waits for the hash to include `/popup/general` before continuing (`packages/extension/tests/e2e/fixtures/helpers.ts:173-180`). The existing header-text wait still runs after that (`helpers.ts:182-190`), so it now correctly gates on the general-page `network-button`.
- #2 (dispatchEvent in both surfaces): fixed. `helpers.ts::switchToNetwork()` now dispatches a synthetic `MouseEvent("click", ...)` on the `network-row` (`helpers.ts:167-170`), and `check-derivation-parity.ts` does the same (`packages/extension/tests/e2e/scripts/check-derivation-parity.ts:172-177`), matching the established `openNetworkDetail()` contract.
- #3 (deliberate omissions): accept. The commit-subject complaint is not material if the actual configured commitlint passed, and the `CLAUDE.md` wording is stricter than enforcement. The pre-existing milestone/phase tags were not introduced by this branch; leaving them alone in this fix-up is reasonable judgment, though the doc/enforcement mismatch is worth cleaning separately.

## New bugs (if any)
none

## Greenlight to merge
GO