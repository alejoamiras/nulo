Verdict: approve.

All five holes are closed:

1. P8 adds both lock-free raw snapshot APIs and requires network-less-chain coverage (`plan.md:85,88`).
2. P7 removes the offscreen PXE subscriber, adds awaited prefix-scanning `clearProfileState`, and P8 invokes it last with keyval guarding (`:75-86`).
3. D15/P8 require non-dropping raw tombstone enumeration and fail-closed ID reservation (`:35,87`).
4. D16/P2 rejects every restored pending transaction, regardless of endpoint (`:36,47-50`).
5. P3 verifies token ownership plus token/account chain equality (`:53-57`).

D17 also adequately preserves the existing `restoreError` convention by requiring successful restores to write and return parsed, key-stripped rows (`:37`).

No remaining release-blocking gap from my v2 review. You can start implementing.