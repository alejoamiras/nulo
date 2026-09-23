# Owner recommendation — arc 9 (`pxe-service-split`) and the remaining god-services

_Written per the remediation charter's OWNER-GATED section: this is a recommendation only; nothing here was started._

## Arc 9: the #281-D4 fence extraction (F-Q01 continued) — RECOMMEND: do it next, as a solo [deep] arc, with one precondition

The prior extraction (the epoch fence) succeeded precisely because it had zero op-path read-coupling. Arc 9's subject is different in kind: `storeKeys` is read at every `registry.ensure`, so the extraction moves state that sits ON the hot op path. Recommendation:

1. **Precondition — pin the read-coupling first.** Before any code moves, land a characterization suite for the exact `profileLifecycles`/`storeKeys`/`assertGenerationCurrent`/`provisionChainStoreKey` interplay (the profile-reimport-matrix suite from the BUG-FENCE fix is the seed — it already caught `assertGenerationCurrent` collapsing non-`live` states into marker-less rejections). The arc-8 pilot's central finding applies directly here: the risk lives in the pin gap, not the structure.
2. **Shape**: same discipline as the pilot — explicit typed deps, caller-owned assignment, the fence record's single writer kept at the composition root. NOT a service split in one step: extract the fence MODULE first, split the service only if the module extraction proves clean.
3. **Sizing**: [deep] with the full three-plan ceremony; the dual-audit rounds in this remediation repeatedly changed designs (arcs 4, 7, 8) — the ceremony pays for itself on PXE-lifecycle code.

## The remaining 4 god-services (network, profile, token, execution) — RECOMMEND: architecture session, not arcs

The arc-8 pilot's evidence, generalized:

- **Extraction is the cheap part; the pin gap is the risk.** Both pilot pieces moved with zero behavior change; the material discovery was that a core init product (`feeStrategies`) was entirely unpinned. Expect the same across the four services: the highest-value first investment is composition-level "field populated + consumer resolves" pins per `= null!` field, which requires NO code movement and de-risks everything after.
- **Dependency-DAG before any further decomposition** (codex's framing, adopted in the pilot write-up): inventory every `= null!` field across the god-inits, classify every edge eager vs invocation-time, then choose a representation that makes invalid states unrepresentable. Type improvement (`= null!` elimination) falls out of that design; done in isolation it is an unchecked assertion swap.
- **Sequencing if/when approved**: execution's `init()` tail and wallet-sdk's leaf wirings are proven-extractable shapes (the pilot); profile/network/token each carry facade-lock and event-fanout semantics that the pilot deliberately did not assess — treat each as its own [deep] arc with recon-first, and keep the standing REJECTED list (sessionQueues split-release; BlockingBarrierFrame) rejected.
- **This is an owner decision about architecture direction** — per the charter these belong to a planning session with you in the loop, not an autonomous loop.
