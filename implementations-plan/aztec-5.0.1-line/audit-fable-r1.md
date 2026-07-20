# Fresh hostile fable audit — round 1 (conditional-approve, 8 findings)

1. HIGH — @aztec-foundation STOP-gate spoofable as written (repository field publisher-controlled; registry signatures vacuous; tag existence unrelated to npm bytes). Fix: provenance attestation subject == AztecProtocol/aztec-standards @ peeled tag (STOP if absent) + reverse anchor (repo package.json at tag declares the scoped name) + surface the scope-legitimacy Ask.
2. MEDIUM — A2 resurrection window: offscreen restart resets lifecycle to `unseen`; a stale provision carrying a deleted profile's generation re-arms store access. Fix: provision-on-unseen consults durable tombstone/row state; explicitly reject in `deleted`; add stale-provision-after-restart to the gate matrix.
3. MEDIUM — `npm audit signatures` cannot run in a bun-only repo as positioned (ENOLOCK). Fix: scratch npm-lockfile method specified.
4. MEDIUM — stamp inputs unpinned: initStoreVersionStamp's rollupAddress is node-derived → lying RPC = wipe-loop DoS. Fix: config-sourced stamp inputs (superseded by the D-B2 flip to refuse-and-preserve).
5. LOW — A0 pinned to stale head 03affd2 (now 906639f). Reword to "pre-fix code".
6. LOW — "atomic" two-file promote overstated; state the real invariant (verify → write both → re-verify → commit; no partial state committed).
7. LOW — diagnostic-only force-release: "deletion can wait ~30 min behind a prove, no cancel" is a UX consequence with no surfaced work item.
8. LOW — zero sizing anywhere; the only calendar anchor is the exclude-removal date.

Verified-clean under attack: all sampled file:line Facts; the FPC compat map; the A1 fail-typed-then-retry shape; the eager-provision fast-path; Phase R vs the runbook.
