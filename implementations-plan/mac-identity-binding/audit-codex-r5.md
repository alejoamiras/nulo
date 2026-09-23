APPROVE — no remaining blockers.

Verified `fb77354d` closes the invalid-type clean-finalize path, correctly snapshots and compares `type`, regression-pins unsafe numeric IDs using `1e+21`, and exercises the exact row-5→key-9 authwit transplant.

Across `c63fde9a..fb77354d`, I cannot construct an A1/A2 transplant, embedded-ID substitution, slot swap, fingerprint blinding, restore/finalize drift, or MAC laundering path that produces silent persistent adoption outside the explicitly adjudicated export/derived-only semantics.

One non-blocking hygiene note: an invalid-type finalize throws before consuming and zeroizing the pending restore entry, leaving it until retry, deletion, or TTL sweep. A1 cannot read process memory, so this does not weaken F-1/F-2.