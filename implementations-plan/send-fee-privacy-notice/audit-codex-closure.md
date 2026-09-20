approve

The blocking finding is closed as written. **Confidence: high.** Keeping the overlay from before the first fetch through unmount preserves deletion knowledge across initialization, recovery commits, and account/profile/network switches (`implementations-plan/send-fee-privacy-notice/plan.md:246`). The added switch-back tests cover the reproduced failure, including both selection and dropdown offerings (`:540`).

An update received while its row is absent cannot introduce that row because `applyFpcEdits` never adds entries. If a later snapshot contains it, the retained update applies. Subsequent updates replace earlier edits, including edits received while viewing another identity. I found no ordinary event-ordering defect requiring profile/chain partitioning.

- **[Low] Non-blocking: ID uniqueness is across currently stored rows, not all historical rows. Confidence: high.** `apps/extension/src/wallet/services/id-allocators.ts:48` generates eight hex characters and checks only current storage membership. Deletion removes that membership (`packages/wallet-core/src/storage/entity_storage.ts:192`). Consequently, a deleted ID could randomly recur—even in another profile—and its retained tombstone would hide the new row. This requires a random collision, not a normal switch or re-registration sequence; I found no deterministic reuse path. **Smallest fix:** qualify D29’s absolute “globally unique” claim and acknowledge this negligible collision residual. Partitioning would not eliminate reuse within the same profile/chain.

The queue-bound correction (`plan.md:198`), latency qualification (`:457`), D10 rationale (`:627`), and protocol-PrivateFPC regression fixture (`:527`) address the remaining findings. D27, D29, and round 5 now agree on overlay lifetime. I found no new material defect or contradiction introduced by these edits.

No files modified.