
---

# Fable leg — PR-scoped bug hunt (tri-audit round)

Verdict: `conditional approve (with conditions: fix the false-pass window in the ship-gate
e2e's zero-sender assertion; close the two canonicalization escapes or document them)`.
Findings (all adopted; dispositions in audit-codex.md's tri-audit section): (1-M) ship-gate
zero-sender assertions ran against an unsettled/possibly-errored list; (2-L) import-staging save
skipped lowercase canonicalization; (3-L) export union membership was the one un-canonicalized
compare left; (4-L) lowercase-on-save was unpinned by tests; (5-L) no-network outcome toasted
"failed" though the banner promised "skipped". Cleared as sound: import pipeline bounds/order,
adds-only sender semantics + its pins, Enter dirty gate, seq-guarded chip sync, fresh-identity
advanced tests, transferPrivateTokens fixture semantics.
