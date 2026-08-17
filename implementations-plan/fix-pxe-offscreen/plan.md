# Arc 5 — fix-pxe-offscreen (B-07, B-17, B-18)

[light] tier of the 2026-08-16 dual-audit remediation. Three unfenced-continuation / resource-leak findings in the PXE runtime + offscreen lifecycle. Prove-first per finding; one codex xhigh pass over the complete arc diff at the end.

Source of truth: `audit/bugs/2026-08-16-extension-mid/findings/consolidated.md` (B-07, B-17, B-18).

## B-18 — chain purge resurrection (DONE, commit 3682bfac)
`clearChainState` bumped the per-chain purge epoch only BEFORE its destructive awaits (`dispose → removeChainStoreDir → deleteDb`). An op entering `withPxeWrite`/`withPxeRead` DURING that window read the already-incremented value and passed the post-await equality check, recreating the runtime + a fresh OPFS store dir for a chain whose row is gone. **Fix:** a closing `bumpChainPurgeEpoch` right before the guard releases (helper extracted; 2 call sites). **Prove-first:** the epoch-advances-by-2 assertion is RED under the single bump; +a modeled mid-destruction fence test.

## B-17 — offscreen lifecycle: three unfenced-continuation gaps (DONE, commit b213b7fc)
- **Firefox window-create fence:** the hidden-window branch assigned `firefoxOffscreenWindowId` with no `passId===passSeq` check (unlike Chromium). A timed-out pass's late `windows.create` clobbered a successor's live window. **Fix:** fence it — close the orphan, don't clobber/broadcast.
- **Readiness (PONG-before-init):** the offscreen answered a health PING with PONG before PXE init finished, so the SW could adopt a still-initializing document and dispatch a PXE RPC before `PxeService` existed. **Fix:** withhold PONG until `servicesReady` flips after `createPxeOffscreen` (`shouldRespondPong` gate).
- **Dangling close:** `onOffscreenTimeout` closed the document without awaiting it while the single-flight gate cleared, so a successor could create into a document the late close tore down. **Fix:** track the close (`pendingClose`) and join it at the top of `doEnsureOffscreenRunning`.
**Prove-first:** the Firefox-fence + close-join tests are RED without the fixes; +`shouldRespondPong` boundary tests.

## B-07 — openChainStore OPFS-worker timeout (IN PROGRESS — codex design consult)
The 30s open-timeout throws to the caller but the underlying `AztecSQLiteOPFSStore.open()` is unbounded and un-cancellable (the worker handle only exists after init resolves — no AbortSignal). A hung open never releases its OPFS SAH-pool lock, and a same-chain retry (write guard released at 30s) spawns a SECOND worker contending for the same lock → deadlock cascade. **Approach under codex review:** single-flight the in-flight open per `chainDataDir` (URL-independent store, so no stale-URL hazard — unlike the runtime dedup removed at chain-runtime.ts:295) so a retry joins the abandoned open instead of spawning a new worker; open cleanup design (refcount vs claim-flag vs fail-fast) is the codex decision. No existing test coverage — a fake `AztecSQLiteOPFSStore.open` with a controllable never/late-resolving promise.

## Validation
Repo gates (lint, typecheck:all, affected tests) + `NULO_E2E_PROVERLESS=1 e2e:agent` SOLO (arc 5 is in the e2e:agent list). audit:vue before PR.
