# Flake-attribution audit (subagent verdict)

Controlled A/B vs the baseline green run 27477613089 (feat/swap-fuel→dev,
~1h earlier, authwit files absent):

- Shard 1 (authwit-lifecycle, MINE): own failure — CDP protocolTimeout from a
  ~17-min serial-prove marathon. Purely my test's resource profile.
- Shard 3 (concurrent-sendtx, pre-existing): my authwit-consume-smoke
  WORSENED it — HIGH confidence. concurrent-sendtx passed in 19.8s on the
  baseline run WITHOUT my file; timed out (143s) WITH my ~7-min-proving file
  on the same shard host sharing one prover queue. Same-shard contention,
  the exact mechanism phase-7 + _network-e2e.yml comments warn about.
- Shard 5 (multi-account-from, pre-existing): NOT caused by me — deterministic
  SHA-1 sharding put neither new file on shard 5; the byte-identical shard-5
  file set PASSED (23s) on the baseline run 1h earlier. Documented baseline
  flake firing on its own.
- My fixture change (dappConnectedExtensionWithFirstTwoAccountsCap +2nd
  account): CLEAN. multi-account-from failed deep in its BODY
  (waitForSendTxActiveStage, popups.ts:408 ← test:85), after the fixture
  fully succeeded; ZERO fixture-assertion error strings in the shard-5 log.

CONCLUSION: env-gate (00b6886) is the right fix and resolves BOTH my
self-failures AND the concurrent-sendtx aggravation (the heavy tests leave the
shared pool). Fixture change is safe. multi-account-from is independent.
