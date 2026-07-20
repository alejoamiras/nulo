# Fable leg — key positions (full text in the planning session transcript)

- Root-caused the deadlock chain to file:line (emit at extension-messaging base-service invokes SW-local subscribers synchronously while the ProfileService facade Lock is held; finalizeRestore → sessionManager.open → onChange → emit; the store-key provider re-enters getProfileSecret → runExclusive → FIFO wedge). Also found the Lock 5-min force-release double-release bug.
- A0 diagnosis-first gate: local repro + a composition-test pin that FAILS on head before any fix; STOP if the repro doesn't reproduce.
- A1: deferred-emit queue drained after lock release; lock-free peekProfileSecretForStoreKey; EAGER key provisioning on session open (SW-local onActiveProfileChanged subscriber); ticketed Lock/rw-guard ownership.
- A2: in-memory deletion generation + purging flag (sync bump before first await); typed PXE_PROFILE_PURGED; D3 rebind under chain write via read-release-then-write (no upgrade); D6 barrier retained on failure; D7 sweep removed; dispose propagates stop failures; opfsRoot narrows absence to NotFound + missing API.
- A3: rw-guard ticketed accounting + force-release LOG-ONLY (no corrupting self-heal); Lock keeps force-release but with ticket invalidation.
- B2: KEEP the wipe-on-mismatch stamp mirror (our per-(profile, chainId) scheme already identity-partitions; upstream's partition layout buys nothing pre-production); verify PXE_DATA_SCHEMA_VERSION still greppable/13; adopt SqliteEncryptionError; assert pool-dir layout unchanged; compat-epoch stays 3.
- B4 FPC gate: committed compatibleNodeVersions allowlist (human-curated, NO semver ranges) + hard rollupVersion/l1ChainId identity pins + unchanged digest/address/live-class checks.
- B5.0: STOP-gate to verify the L2-only redeploy path against the existing L1 set before any broadcast (portal binding question).
- Weakest points it declared: deferred emits change the whole event surface's timing; class-elimination on an unproven root cause (A0 mitigates); FPC compat-map adds policy surface; portal reuse question load-bearing; force-release removal trades corruption for visible wedging.
