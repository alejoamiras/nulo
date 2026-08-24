HOLDS-with-concerns — production fix correct; one test underspecifies.

- Low: the "does not cut the others short" test let the second refresh resolve immediately, so a fail-fast `Promise.all(...).catch()` implementation (disconnecting as soon as one refresh rejects) would still pass. Fix: defer the second refresh, assert disconnect uncalled after the first rejection settles, then release and complete.

Actively verified: all three pins red pre-fix (the third only for the missing logging); the sole production caller is auth.vue's fire-and-forget warm-up (`useProfileBootstrap` does not call it; TokensView's same-named function is local) — no user-visible path newly blocks; `ServiceClient.disconnect()` synchronously rejects every pending request, so the final disconnect cannot race any refresh this function created; the generated token-balance passthroughs return the async base request, so no synchronous throw can strand earlier promises outside allSettled.
