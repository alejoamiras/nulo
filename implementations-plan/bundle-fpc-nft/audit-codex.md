<!-- Codex CLI command run: -->

```bash
codex exec --sandbox read-only -c model_reasoning_effort=xhigh "$(cat /tmp/codex-prompt-bundle-fpc-nft.txt)"
```

<!-- Prompt sent to codex: -->

```
You are reviewing the implementation plan at `implementations-plan/bundle-fpc-nft/plan-v1.md`. The repo is at `(project root)`. Look at the actual code in the files referenced. Verify:

1. **Slot accuracy**: open both artifact JSONs, confirm PrivateFPC.balances=0x1 and Wonderland-NFT.private_nfts=0x5. Confirm the note shapes (UintNote vs NFTNote) match the storage layout's intent.
2. **Bundle integration**: does adding 2 entries to known-artifacts.ts have any side effect on M4.3 trust enforcement, the artifact-registry resolution chain, or the SponsoredFPC instance map?
3. **Schema-load duplication**: note-schemas.ts and known-artifacts.ts both call `loadContractArtifact()` on the same JSONs. Is this a real problem (state, perf, correctness) or fine?
4. **Smart-tighten behavior shift**: are there any callers/tests/dApps that would break when these classIds become resolvable without dApp-supplied artifact?
5. **Test coverage**: are the storage-layout regression gates sufficient, or is there a missing test (without going through bb.js, which is flaky)?
6. **Missed steps**: anything the plan doesn't mention but should — version bump targets, e2e test impact, related consumers (e.g., `@private-fpc-artifact` is currently aliased but unused; does completing the bundle break some e2e fixture)?
7. **Risks the plan doesn't acknowledge.**

Files to study:
- packages/aztec-runtime/src/pxe/known-artifacts.ts — current 11-entry bundle
- packages/aztec-runtime/src/pxe/note-schemas.ts — current schema map
- packages/aztec-runtime/src/pxe/artifact-registry.ts — M4.3 trust model
- packages/extension/src/wallet/services/note/service.ts — consumer
- packages/extension/src/wallet/services/note/note-schemas.test.ts — test pattern
- packages/extension/vite.config.ts (around line 45) — alias pattern
- packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json
- packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json

Format output as: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / NITS sections. Cite exact file:line where relevant.
```

---

## Full codex output

```
Reading additional input from stdin...
OpenAI Codex v0.120.0 (research preview)
--------
workdir: (project root)
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: xhigh
reasoning summaries: none
session id: 019de04b-4855-7900-9b74-6eed54dbf05d
--------
user
You are reviewing the implementation plan at `implementations-plan/bundle-fpc-nft/plan-v1.md`. The repo is at `(project root)`. Look at the actual code in the files referenced. Verify:

1. **Slot accuracy**: open both artifact JSONs, confirm PrivateFPC.balances=0x1 and Wonderland-NFT.private_nfts=0x5. Confirm the note shapes (UintNote vs NFTNote) match the storage layout's intent.
2. **Bundle integration**: does adding 2 entries to known-artifacts.ts have any side effect on M4.3 trust enforcement, the artifact-registry resolution chain, or the SponsoredFPC instance map?
3. **Schema-load duplication**: note-schemas.ts and known-artifacts.ts both call `loadContractArtifact()` on the same JSONs. Is this a real problem (state, perf, correctness) or fine?
4. **Smart-tighten behavior shift**: are there any callers/tests/dApps that would break when these classIds become resolvable without dApp-supplied artifact?
5. **Test coverage**: are the storage-layout regression gates sufficient, or is there a missing test (without going through bb.js, which is flaky)?
6. **Missed steps**: anything the plan doesn't mention but should — version bump targets, e2e test impact, related consumers (e.g., `@private-fpc-artifact` is currently aliased but unused; does completing the bundle break some e2e fixture)?
7. **Risks the plan doesn't acknowledge.**

Files to study:
- packages/aztec-runtime/src/pxe/known-artifacts.ts — current 11-entry bundle
- packages/aztec-runtime/src/pxe/note-schemas.ts — current schema map
- packages/aztec-runtime/src/pxe/artifact-registry.ts — M4.3 trust model
- packages/extension/src/wallet/services/note/service.ts — consumer
- packages/extension/src/wallet/services/note/note-schemas.test.ts — test pattern
- packages/extension/vite.config.ts (around line 45) — alias pattern
- packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json
- packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json

Format output as: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / NITS sections. Cite exact file:line where relevant.
codex
Reviewing the plan against the current code and bundled artifacts. I’m reading the referenced files first so I can validate the exact behavior and line-level impact before I call out any gaps.
exec
/bin/zsh -lc 'nl -ba implementations-plan/bundle-fpc-nft/plan-v1.md' in (project root)
exec
/bin/zsh -lc 'nl -ba packages/aztec-runtime/src/pxe/known-artifacts.ts' in (project root)
 succeeded in 0ms:
     1	import { Fr } from "@aztec/foundation/curves/bn254"
     2	import { type ContractArtifact, loadContractArtifact } from "@aztec/stdlib/abi"
     3	import { AuthRegistryArtifact } from "@aztec/protocol-contracts/auth-registry"
     4	import { ContractClassRegistryArtifact } from "@aztec/protocol-contracts/class-registry"
     5	import { FeeJuiceArtifact } from "@aztec/protocol-contracts/fee-juice"
     6	import { ContractInstanceRegistryArtifact } from "@aztec/protocol-contracts/instance-registry"
     7	import { MultiCallEntrypointArtifact } from "@aztec/protocol-contracts/multi-call-entrypoint"
     8	import { PublicChecksArtifact } from "@aztec/protocol-contracts/public-checks"
     9	import { FPCContractArtifact } from "@aztec/noir-contracts.js/FPC"
    10	import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
    11	import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
    12	import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
    13	import {
    14		type ContractInstanceWithAddress,
    15		getContractClassFromArtifact,
    16		getContractInstanceFromInstantiationParams,
    17	} from "@aztec/stdlib/contract"
    18	// @ts-expect-error — raw JSON import via vite alias
    19	import WonderlandTokenJson from "@wonderland-token-artifact"
    20	
    21	/** Standard SponsoredFPC deployment uses salt = 0. */
    22	const SPONSORED_FPC_SALT = BigInt(0)
    23	
    24	export type KnownArtifacts = {
    25		artifacts: Map<string, ContractArtifact>
    26		instances: Map<string, ContractInstanceWithAddress>
    27	}
    28	
    29	/** Loader signature. ArtifactRegistry invokes this lazily at first
    30	 *  `ensureKnown()` call. Production returns the real compiled-in set;
    31	 *  unit tests inject an empty or fixture loader to stay free of the
    32	 *  heavy `@aztec/noir-contracts.js` / vite-alias imports. */
    33	export type KnownArtifactsLoader = () => Promise<KnownArtifacts>
    34	
    35	/** Production loader: the frozen 11 compiled-in artifacts + the
    36	 *  SponsoredFPC instance. Invariant: this list stays locally
    37	 *  compiled-in (M2.3 plan architecture invariant #3). */
    38	export const loadProductionKnownArtifacts: KnownArtifactsLoader = async () => {
    39		const WonderlandTokenArtifact = loadContractArtifact(WonderlandTokenJson)
    40		const artifacts = new Map<string, ContractArtifact>()
    41		const instances = new Map<string, ContractInstanceWithAddress>()
    42	
    43		const compiledIn = [
    44			// protocol
    45			AuthRegistryArtifact,
    46			ContractClassRegistryArtifact,
    47			FeeJuiceArtifact,
    48			ContractInstanceRegistryArtifact,
    49			MultiCallEntrypointArtifact,
    50			PublicChecksArtifact,
    51			// other
    52			FPCContractArtifact,
    53			NFTContractArtifact,
    54			SponsoredFPCContractArtifact,
    55			TokenContractArtifact,
    56			// wonderland standards
    57			WonderlandTokenArtifact,
    58		]
    59		for (const artifact of compiledIn) {
    60			const contractClass = await getContractClassFromArtifact(artifact)
    61			artifacts.set(contractClass.id.toString(), artifact)
    62		}
    63		const sponsoredFpcInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    64			salt: new Fr(SPONSORED_FPC_SALT),
    65		})
    66		instances.set(sponsoredFpcInstance.address.toString(), sponsoredFpcInstance)
    67	
    68		return { artifacts, instances }
    69	}

 succeeded in 0ms:
     1	# Plan: Bundle PrivateFPC + Wonderland NFT (extend note-parsing coverage)
     2	
     3	## Context
     4	
     5	PR #31 (note parsing) shipped decoding for the **3 bundled token-shaped contracts**:
     6	- Aztec Token  → slot `0x3` → `UintNote { value: u128 }`
     7	- Aztec NFT    → slot `0x7` → `NFTNote  { token_id: field }`
     8	- Wonderland Token → slot `0x7` → `UintNote { value: u128 }`
     9	
    10	Two known-standard contracts were deliberately deferred from PR #31:
    11	- **PrivateFPC** (`@wonderland/aztec-fee-payment`) — used by Nulo's own private-fee-payment flow
    12	- **Wonderland NFT** (`@defi-wonderland/aztec-standards`) — Wonderland's NFT standard
    13	
    14	This PR completes the original plan-v3 scope: bundle these two so they
    15	also get artifact resolution + named-field decoding without a dApp passing
    16	artifacts via `aztec_registerContract`.
    17	
    18	## Slot verification (re-confirmed against real artifacts)
    19	
    20	| Contract | Storage slot | Field | Schema |
    21	|---|---|---|---|
    22	| PrivateFPC | `0x1` | `balances` | `UintNote { value: u128 }` (verified: `balance_of` returns `u128`) |
    23	| Wonderland NFT | `0x5` | `private_nfts` | `NFTNote { token_id: field }` (mirrors Aztec NFT shape; only slot offset differs) |
    24	
    25	Confirmed via `loadContractArtifact(...).storageLayout` on the pinned
    26	release. PrivateFPC has only ONE storage slot (`balances`). Wonderland
    27	NFT has multiple slots but only `private_nfts` is a private note —
    28	`nft_exists` and `public_owners` are public state.
    29	
    30	## Files touched (5)
    31	
    32	### A. `packages/extension/vite.config.ts`
    33	
    34	Add Wonderland NFT alias (PrivateFPC alias already exists at line 45).
    35	
    36	```ts
    37	"@wonderland-nft-artifact": resolvePackageFile(
    38	  "@defi-wonderland/aztec-standards",
    39	  "target/nft_contract-NFT.json",
    40	),
    41	```
    42	
    43	### B. `packages/extension/vitest.config.ts`
    44	
    45	Mirror the alias for unit tests (matching PrivateFPC's existing pattern).
    46	
    47	### C. `packages/aztec-runtime/src/pxe/known-artifacts.ts`
    48	
    49	Add 2 imports + 2 entries to `loadProductionKnownArtifacts.compiledIn`.
    50	
    51	```ts
    52	// @ts-expect-error — raw JSON import via vite alias
    53	import PrivateFPCJson from "@private-fpc-artifact"
    54	// @ts-expect-error — raw JSON import via vite alias
    55	import WonderlandNFTJson from "@wonderland-nft-artifact"
    56	
    57	// inside loader:
    58	const PrivateFPCArtifact = loadContractArtifact(PrivateFPCJson)
    59	const WonderlandNFTArtifact = loadContractArtifact(WonderlandNFTJson)
    60	
    61	const compiledIn = [
    62	  ...existing 11,
    63	  PrivateFPCArtifact,
    64	  WonderlandNFTArtifact,
    65	]
    66	```
    67	
    68	Bundle grows from **11 → 13** entries.
    69	
    70	### D. `packages/aztec-runtime/src/pxe/note-schemas.ts`
    71	
    72	Append 2 entries to `loadProductionNoteSchemas`.
    73	
    74	```ts
    75	const PrivateFPCArtifact = loadContractArtifact(PrivateFPCJson)
    76	const privateFpcClass = await getContractClassFromArtifact(PrivateFPCArtifact)
    77	map.set(privateFpcClass.id.toString(), new Map([["0x1", UINT_NOTE]]))
    78	
    79	const WonderlandNFTArtifact = loadContractArtifact(WonderlandNFTJson)
    80	const wonderlandNftClass = await getContractClassFromArtifact(WonderlandNFTArtifact)
    81	map.set(wonderlandNftClass.id.toString(), new Map([["0x5", NFT_NOTE]]))
    82	```
    83	
    84	The same JSONs are loaded again here (mirroring the existing pattern
    85	where each loader independently does its own `loadContractArtifact`).
    86	Could share via re-export, but coupling these modules tighter than they
    87	already are isn't worth a deduplication that the JIT will inline anyway.
    88	
    89	### E. `packages/extension/src/wallet/services/note/note-schemas.test.ts`
    90	
    91	Add 2 storage-layout regression gates (same shape as the existing 3).
    92	
    93	```ts
    94	test("PrivateFPC: balances at slot 0x1 (UintNote)", () => {
    95	  const artifact = loadContractArtifact(PrivateFPCJson)
    96	  expect(slotOf(artifact, "balances")).toBe(0x1n)
    97	})
    98	
    99	test("Wonderland NFT: private_nfts at slot 0x5 (NFTNote)", () => {
   100	  const artifact = loadContractArtifact(WonderlandNFTJson)
   101	  expect(slotOf(artifact, "private_nfts")).toBe(0x5n)
   102	})
   103	```
   104	
   105	### F. `packages/extension/package.json`
   106	
   107	Bump `0.13.49` → `0.13.50`.
   108	
   109	## Verification
   110	
   111	- `bun run typecheck` clean
   112	- `bun run lint` clean
   113	- `bun run test` — expect 932 + 2 = **934 unit tests** pass
   114	- `bun run build` clean
   115	- Auto-imports regen automatically; no manual edits
   116	
   117	**Manual QA**
   118	
   119	1. Reload extension. PrivateFPC + Wonderland NFT should appear in
   120	   `getContractInstance` resolutions without requiring `aztec_registerContract`
   121	   to pass an artifact (smart-tighten covers them).
   122	2. Notes viewer (Settings → Advanced → Account State → Notes) on a
   123	   profile that has interacted with PrivateFPC (e.g., the wallet's own
   124	   private-fee-payment flow): notes from PrivateFPC should now render
   125	   as `UintNote` with decoded `value`. Same flow for Wonderland NFT mints.
   126	
   127	## Risks / Invariants preserved
   128	
   129	1. **M4.3 trust enforcement** stays intact: the `known` branch SKIPS
   130	   recompute since the map is keyed by load-time-computed classId.
   131	   Adding entries follows the same trust model.
   132	2. **Smart-tighten** behavior shifts positively: dApps calling
   133	   `aztec_registerContract` for these classes can now omit `artifact`.
   134	   This is a UX improvement, not a regression — existing dApps that
   135	   *do* pass artifacts continue working unchanged.
   136	3. **Bundle size**: +2 contract artifact JSONs in the offscreen bundle
   137	   (~20-50 KB each). Drop in the bucket vs. the existing ~57 MB chunk
   138	   that already includes 11 contracts + bb.js.
   139	4. **Slot collision check**: Wonderland NFT also has slots `0x6`
   140	   (`nft_exists`) and `0x7` (`public_owners`). Neither is a private
   141	   note. Aztec NFT uses `0x7` for `private_nfts` — but the schema map
   142	   is keyed by `(classId, slot)`, so the collision is impossible.
   143	5. **No instances added**: PrivateFPC + Wonderland NFT have no canonical
   144	   "always-deployed" instances (unlike SponsoredFPC). Nothing to add to
   145	   the `instances` map.
   146	6. **No new e2e tests**: PR #31's NoteService tests cover the decode
   147	   path generically (they use synthetic class ids); the new schemas hit
   148	   the same code paths. Storage-layout regression gates protect against
   149	   slot drift in future aztec-packages bumps.
   150	
   151	## Out of scope
   152	
   153	- **Other Wonderland standards** (Dripper, Escrow, GenericProxy,
   154	  TestLogic). They're niche; custom contracts can pass artifacts via
   155	  `aztec_registerContract`. Add later if usage warrants.
   156	- **Decimals badge** on UintNote display (was in plan-v3 originally).
   157	  Decided against during PR #31; the brutalist Notes inspector should
   158	  show raw bigint values, not user-friendly token amounts.
   159	- **bb.js-dependent unit tests** for class-id resolution. Same WASM
   160	  flakiness pattern from PR #31 applies — covered manually + by the
   161	  storage-layout gates instead.
   162	
   163	## Open questions for the user
   164	
   165	1. **Bundle scope**: stick to PrivateFPC + Wonderland NFT, or extend to
   166	   other Wonderland standards (Dripper / Escrow / GenericProxy)? My
   167	   instinct: stay tight (KISS, plan-v3 scope).
   168	
   169	2. **Schema verification depth**: should we add ANY runtime test that
   170	   actually computes a class-id (going through bb.js) to verify our
   171	   slot map keys match real artifacts? Trade-off: catches "wrong
   172	   classId stored against slot" mistakes that the storage-layout
   173	   gates can't, but introduces the WASM flakiness from PR #31.
   174	   My instinct: no — the manual QA on a profile with real notes is
   175	   the better signal.

exec
/bin/zsh -lc 'nl -ba packages/aztec-runtime/src/pxe/note-schemas.ts' in (project root)
exec
/bin/zsh -lc 'nl -ba packages/aztec-runtime/src/pxe/artifact-registry.ts' in (project root)
 succeeded in 0ms:
     1	import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
     2	import { loadContractArtifact } from "@aztec/stdlib/abi"
     3	import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
     4	import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
     5	// @ts-expect-error — raw JSON import via vite alias
     6	import WonderlandTokenJson from "@wonderland-token-artifact"
     7	
     8	/** Field types we know how to decode from a packed note. */
     9	export type NoteFieldType = "u128" | "field" | "address"
    10	
    11	export type NoteFieldSchema = {
    12		/** Field name as it appears in the source struct. */
    13		name: string
    14		/** Decoder type — drives how items[i] is rendered. */
    15		type: NoteFieldType
    16	}
    17	
    18	export type NoteSchema = {
    19		/** Display name for the note type (e.g., "UintNote", "NFTNote"). */
    20		noteName: string
    21		/** Schema fields in items[] order. */
    22		fields: NoteFieldSchema[]
    23	}
    24	
    25	/** Class id (hex) → storage slot (canonical hex `0x<lowercase>`) → schema. */
    26	export type NoteSchemaMap = Map<string, Map<string, NoteSchema>>
    27	
    28	/** Canonicalize a storage-slot Fr-string into the form used as map keys.
    29	 *  Example: `0x0000…0003` → `0x3`. Stripping leading zeros makes the
    30	 *  static schema map readable + matches the storageLayout slots. */
    31	export function canonicalSlotHex(slotString: string): string {
    32		const v = BigInt(slotString)
    33		return `0x${v.toString(16)}`
    34	}
    35	
    36	const UINT_NOTE: NoteSchema = {
    37		noteName: "UintNote",
    38		fields: [{ name: "value", type: "u128" }],
    39	}
    40	
    41	const NFT_NOTE: NoteSchema = {
    42		noteName: "NFTNote",
    43		fields: [{ name: "token_id", type: "field" }],
    44	}
    45	
    46	/**
    47	 * Production schemas for the bundled standards. Class ids are computed
    48	 * lazily on first call (Poseidon hashing the artifact) and the result is
    49	 * cached in a module-level promise — same loader pattern as
    50	 * `loadProductionKnownArtifacts`.
    51	 *
    52	 * Slot numbers verified against each artifact's `storageLayout` at the
    53	 * pinned aztec-packages release. Update this file when storage layouts
    54	 * shift in a future bump.
    55	 */
    56	let cachedSchemas: Promise<NoteSchemaMap> | null = null
    57	
    58	export async function loadProductionNoteSchemas(): Promise<NoteSchemaMap> {
    59		if (cachedSchemas) return cachedSchemas
    60		cachedSchemas = (async () => {
    61			const map: NoteSchemaMap = new Map()
    62	
    63			const tokenClass = await getContractClassFromArtifact(TokenContractArtifact)
    64			map.set(tokenClass.id.toString(), new Map([["0x3", UINT_NOTE]]))
    65	
    66			const nftClass = await getContractClassFromArtifact(NFTContractArtifact)
    67			map.set(nftClass.id.toString(), new Map([["0x7", NFT_NOTE]]))
    68	
    69			const wonderlandTokenArtifact = loadContractArtifact(WonderlandTokenJson)
    70			const wonderlandTokenClass = await getContractClassFromArtifact(wonderlandTokenArtifact)
    71			map.set(wonderlandTokenClass.id.toString(), new Map([["0x7", UINT_NOTE]]))
    72	
    73			return map
    74		})()
    75		try {
    76			return await cachedSchemas
    77		} catch (err) {
    78			// Allow retry after transient failure (matches ArtifactRegistry pattern).
    79			cachedSchemas = null
    80			throw err
    81		}
    82	}
    83	
    84	/** Reset the module-level cache. Test-only. */
    85	export function _resetNoteSchemasForTests(): void {
    86		cachedSchemas = null
    87	}

 succeeded in 0ms:
     1	import type { Fr } from "@aztec/foundation/curves/bn254"
     2	import type { ContractArtifact } from "@aztec/stdlib/abi"
     3	import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
     4	import type { ILogger } from "@nulo/wallet-core/logger"
     5	import { LogLevel } from "@nulo/wallet-core/logger"
     6	import { type ArtifactClassIdVerifier, type ClassIdVerifyLogger, DefaultArtifactClassIdVerifier } from "./artifact-class-id"
     7	import type { KnownArtifacts, KnownArtifactsLoader } from "./known-artifacts"
     8	
     9	/**
    10	 * Minimal structural shape for the network-info argument; declared inline
    11	 * so this file stays decoupled from the extension types.
    12	 */
    13	export interface NetworkInfo {
    14		/** CAIP-like chain identifier; kept on the API for future per-chain
    15		 *  policy hooks even though the current resolver doesn't read it. */
    16		chainId: number
    17	}
    18	
    19	export type ArtifactSource = "pxe-local" | "known"
    20	
    21	/** Resolution policy. Callers get the sensible default via
    22	 *  `defaultPolicy()`. Pinning goes via `byClassId`. */
    23	export type ArtifactPolicy = {
    24		/** Resolution order. Default: `["pxe-local", "known"]`. */
    25		order: ArtifactSource[]
    26		/** Per-class pin. If `byClassId[classId]` is set, resolution SKIPS
    27		 *  all sources except the named one. Use "known" to force the
    28		 *  compiled-in version for a protocol contract. */
    29		byClassId?: Record<string, ArtifactSource>
    30	}
    31	
    32	export function defaultPolicy(): ArtifactPolicy {
    33		return { order: ["pxe-local", "known"] }
    34	}
    35	
    36	/**
    37	 * Artifact resolution with explicit policy + pinning.
    38	 *
    39	 * Holds the compiled-in "known" artifacts + the SponsoredFPC instance,
    40	 * loaded lazily via the injected `KnownArtifactsLoader`. Resolution
    41	 * walks the policy order; a `byClassId` pin overrides the order for a
    42	 * specific class.
    43	 *
    44	 * Resolution sources are bounded to what the wallet ships with or has
    45	 * already registered for this profile — `pxe-local` (already in this
    46	 * PXE) and `known` (compiled-in standards bundle). The HTTP artifact
    47	 * registry was removed; dApps must pass artifacts for non-bundled
    48	 * contracts via `aztec_registerContract({ artifact })`.
    49	 */
    50	export class ArtifactRegistry {
    51		private known: KnownArtifacts | null = null
    52		private initPromise: Promise<void> | null = null
    53		private policy: ArtifactPolicy
    54		/**
    55		 * M4.3: cache of class-ids whose artifact has been recomputed +
    56		 * verified at least once during the current registry lifetime.
    57		 * Skips the ~10-50ms Poseidon recompute for repeat resolves of the
    58		 * same artifact. `clear()` empties this cache too.
    59		 *
    60		 * Cache key: `Fr.toString()` of the verified class-id.
    61		 */
    62		private readonly verifiedClassIds: Set<string> = new Set()
    63	
    64		private readonly verifier: ArtifactClassIdVerifier
    65		private readonly logger?: ILogger
    66		private readonly logSource: string
    67	
    68		public constructor(
    69			private readonly loader: KnownArtifactsLoader,
    70			opts?: {
    71				logger?: ILogger
    72				logSource?: string
    73				/** M4.3: DI seam for class-id verification. Tests pass a fake
    74				 *  that bypasses Poseidon recompute (faster + works with
    75				 *  fixture artifacts that lack the structure needed by
    76				 *  upstream `getContractClassFromArtifact`). */
    77				verifier?: ArtifactClassIdVerifier
    78			},
    79		) {
    80			this.policy = defaultPolicy()
    81			this.verifier = opts?.verifier ?? new DefaultArtifactClassIdVerifier()
    82			this.logger = opts?.logger
    83			this.logSource = opts?.logSource ?? "artifact-registry"
    84		}
    85	
    86		/** Apply a new policy. Callers should only use this for per-class
    87		 *  pinning or custom orders. */
    88		public setPolicy(policy: ArtifactPolicy): void {
    89			this.policy = policy
    90		}
    91	
    92		public getPolicy(): ArtifactPolicy {
    93			return this.policy
    94		}
    95	
    96		/** Lazy-load the compiled-in known artifacts + instances. First
    97		 *  caller pays the cost; subsequent calls are no-ops. Safe across
    98		 *  concurrent calls (shared promise). */
    99		public async ensureKnown(): Promise<void> {
   100			if (this.known) return
   101			if (!this.initPromise) {
   102				this.initPromise = this.loader()
   103					.then((known) => {
   104						this.known = known
   105					})
   106					.catch((err) => {
   107						this.initPromise = null
   108						throw err
   109					})
   110			}
   111			await this.initPromise
   112		}
   113	
   114		public getKnownInstance(address: string): ContractInstanceWithAddress | undefined {
   115			return this.known?.instances.get(address)
   116		}
   117	
   118		/** True if `classId` is in the compiled-in `known` bundle. Loads the
   119		 *  bundle lazily on first call. Used by callers that need to decide
   120		 *  whether the wallet can resolve an artifact without help (e.g.
   121		 *  `aztec_registerContract` smart-tighten check). */
   122		public async hasKnownClassId(classId: Fr): Promise<boolean> {
   123			await this.ensureKnown()
   124			return this.known?.artifacts.has(classId.toString()) ?? false
   125		}
   126	
   127		/** Drop everything loaded. Called during onProfileDeleted so a
   128		 *  stale class-id set doesn't linger if contracts change
   129		 *  between profiles. */
   130		public clear(): void {
   131			this.known = null
   132			this.initPromise = null
   133			this.verifiedClassIds.clear()
   134		}
   135	
   136		/** Resolve an artifact by class id using the policy order. The
   137		 *  `pxeLookup` callback is invoked exactly once if "pxe-local"
   138		 *  appears in the order — callers pass the chain's PXE so the
   139		 *  registry stays PXE-agnostic.
   140		 *
   141		 *  ## M4.3 trust enforcement
   142		 *
   143		 *  Every artifact returned to the caller has its class id
   144		 *  recomputed and compared to `classId`. Mismatches cause the
   145		 *  source to be skipped (resolution falls through to the next).
   146		 *
   147		 *  - **"pxe-local"** branch: PXE database is trusted-to-degree
   148		 *    (chain-data store) but a misconfigured PXE could feed a
   149		 *    wrong artifact. Always recomputes; cached.
   150		 *  - **"known"** branch: SKIPS recompute. The compiled-in
   151		 *    `KnownArtifacts.artifacts` map is keyed by class-id-from-load-
   152		 *    time computation (see `loadProductionKnownArtifacts` in
   153		 *    `known-artifacts.ts`); the `Map.get(classId.toString())`
   154		 *    lookup is by definition a class-id match. Recomputing would
   155		 *    be the same Poseidon hash twice.
   156		 *
   157		 *  Cache: `verifiedClassIds: Set<string>` skips repeat recomputes
   158		 *  for the same `(classId, artifact)` pair. Cleared by `clear()`. */
   159		public async resolve(
   160			classId: Fr,
   161			pxeLookup: (id: Fr) => Promise<ContractArtifact | undefined>,
   162			_network: NetworkInfo,
   163			opts?: { pxeOnly?: boolean },
   164		): Promise<ContractArtifact | undefined> {
   165			const pin = this.policy.byClassId?.[classId.toString()]
   166			const order = pin ? [pin] : this.policy.order
   167			const pxeOnly = opts?.pxeOnly === true
   168	
   169			for (const source of order) {
   170				if (pxeOnly && source !== "pxe-local") continue
   171				switch (source) {
   172					case "pxe-local": {
   173						const found = await pxeLookup(classId)
   174						if (found) {
   175							const verified = await this.verifyAndCache(classId, found)
   176							if (verified) return verified
   177						}
   178						break
   179					}
   180					case "known": {
   181						await this.ensureKnown()
   182						const found = this.known?.artifacts.get(classId.toString())
   183						// "known" branch is keyed by load-time-computed class-id;
   184						// `Map.get(classId.toString())` is itself the class-id
   185						// equality check. Skip recompute.
   186						if (found) return found
   187						break
   188					}
   189				}
   190			}
   191			return undefined
   192		}
   193	
   194		/**
   195		 * M4.3: verify class id, then cache `classId.toString()` in
   196		 * `verifiedClassIds` so repeat resolves skip the recompute.
   197		 *
   198		 * Returns the artifact on match, undefined on mismatch.
   199		 */
   200		private async verifyAndCache(classId: Fr, artifact: ContractArtifact): Promise<ContractArtifact | undefined> {
   201			const key = classId.toString()
   202			if (this.verifiedClassIds.has(key)) return artifact
   203	
   204			const verifyLogger: ClassIdVerifyLogger | undefined = this.logger
   205				? (level, msg, ...rest) => this.logger?.log(this.logSource, level === "warn" ? LogLevel.Warn : LogLevel.Debug, msg, ...rest)
   206				: undefined
   207			const verified = await this.verifier.verify(artifact, classId, verifyLogger)
   208			if (verified) {
   209				this.verifiedClassIds.add(key)
   210			}
   211			return verified
   212		}
   213	}

exec
/bin/zsh -lc 'nl -ba packages/extension/src/wallet/services/note/service.ts' in (project root)
 succeeded in 0ms:
     1	import { AztecAddress } from "@aztec/stdlib/aztec-address"
     2	import { NoteStatus, type NoteDao } from "@aztec/stdlib/note"
     3	import { canonicalSlotHex, type NoteFieldType, type NoteSchema } from "@nulo/aztec-runtime/pxe"
     4	import type { ILogger } from "@/wallet/logger"
     5	import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
     6	import { Service } from "@nulo/extension-messaging/background"
     7	import { NetworkService, networkInfoFrom, type Network } from "@/wallet/services/network/service"
     8	import { PxeServiceClient } from "@/wallet/services/pxe/client"
     9	import { getErrorMessage } from "@nulo/wallet-core/utils"
    10	import { type Methods, type Note, NOTE_SERVICE_NAME } from "./spec"
    11	
    12	export * from "./spec"
    13	
    14	/**
    15	 * Decode a single packed note field. UintNote/NFTNote shapes only need
    16	 * one Fr per field at the current lockfile (`u128 = 1 Fr`); future
    17	 * shapes that pack multiple Frs into one field will need work here.
    18	 */
    19	function decodeField(value: { toString: () => string }, type: NoteFieldType): string {
    20		const raw = value.toString()
    21		switch (type) {
    22			case "u128":
    23				return BigInt(raw).toString()
    24			case "field":
    25				return raw
    26			case "address":
    27				try {
    28					return AztecAddress.fromField({ toString: () => raw } as never).toString()
    29				} catch {
    30					return raw
    31				}
    32		}
    33	}
    34	
    35	export class NoteService extends Service<Methods> implements ServiceSpec<Methods> {
    36		public static name = NOTE_SERVICE_NAME
    37	
    38		private pxeService: PxeServiceClient = null!
    39		private networkService: NetworkService = null!
    40	
    41		public constructor(logger: ILogger) {
    42			super(NOTE_SERVICE_NAME, logger)
    43		}
    44	
    45		protected async init(services: ServiceCollection) {
    46			this.pxeService = new PxeServiceClient(this.logger)
    47			this.networkService = services.get(NetworkService.name)
    48		}
    49	
    50		public async getNotes(networkId: string, account: string, contract?: string): Promise<Note[]> {
    51			await this.ensureInitialized()
    52			const network = await this.networkService.getNetwork(networkId)
    53			let notes: NoteDao[]
    54			try {
    55				notes = contract
    56					? await this.fetchContractNotes(network, account, AztecAddress.fromString(contract))
    57					: await this.fetchKnownContractsNotes(network, account)
    58			} catch (error) {
    59				this.logError("Failed to fetch incoming notes", getErrorMessage(error))
    60				throw new Error("PXE request failed")
    61			}
    62	
    63			// Resolve contract → classId once per unique address; needed to look
    64			// up the matching note schema. PXE caches contract instances, but
    65			// each call still crosses to offscreen — a per-batch cache cuts
    66			// round-trips when many notes share a contract.
    67			const classIdByContract = new Map<string, string | undefined>()
    68			const noteSchemas = await this.loadNoteSchemasSafe()
    69	
    70			// Parse each note in isolation so a single malformed note can't blank
    71			// out the entire page. Failed entries surface as a renderError card on
    72			// the UI instead of an unrecoverable list.
    73			const res: Note[] = []
    74			for (const note of notes) {
    75				try {
    76					res.push(await this.parseNote(network, note, classIdByContract, noteSchemas))
    77				} catch (error) {
    78					const message = getErrorMessage(error)
    79					this.logError("Failed to parse note", message)
    80					res.push({
    81						contract: this.safeContractAddress(note),
    82						storageSlot: this.safeStorageSlot(note),
    83						txHash: this.safeTxHash(note),
    84						rawContent: [],
    85						renderError: message,
    86					})
    87				}
    88			}
    89			return res
    90		}
    91	
    92		/** Schema fetch is best-effort: a failed lookup just leaves notes with
    93		 *  raw rendering. We don't want a transient PXE blip blanking the list. */
    94		private async loadNoteSchemasSafe(): Promise<Record<string, Record<string, NoteSchema>>> {
    95			try {
    96				return await this.pxeService.getNoteSchemas()
    97			} catch (error) {
    98				this.logWarn("Failed to load note schemas; falling back to raw rendering", getErrorMessage(error))
    99				return {}
   100			}
   101		}
   102	
   103		private safeContractAddress(note: NoteDao): string {
   104			try {
   105				return note.contractAddress.toString()
   106			} catch {
   107				return ""
   108			}
   109		}
   110	
   111		private safeStorageSlot(note: NoteDao): string {
   112			try {
   113				return note.storageSlot.toString()
   114			} catch {
   115				return ""
   116			}
   117		}
   118	
   119		private safeTxHash(note: NoteDao): string {
   120			try {
   121				return note.txHash.toString()
   122			} catch {
   123				return ""
   124			}
   125		}
   126	
   127		private async fetchKnownContractsNotes(network: Network, account: string): Promise<NoteDao[]> {
   128			const res = []
   129			const knownContracts = await this.pxeService.getContracts(networkInfoFrom(network))
   130			for (const contract of knownContracts.filter((x) => x.toBigInt() > 6n)) {
   131				res.push(...(await this.fetchContractNotes(network, account, contract)))
   132			}
   133			return res
   134		}
   135	
   136		private async fetchContractNotes(network: Network, account: string, contract: AztecAddress): Promise<NoteDao[]> {
   137			return await this.pxeService.getNotes(networkInfoFrom(network), {
   138				contractAddress: contract,
   139				status: NoteStatus.ACTIVE,
   140				scopes: [AztecAddress.fromString(account)],
   141			})
   142		}
   143	
   144		private async parseNote(
   145			network: Network,
   146			note: NoteDao,
   147			classIdByContract: Map<string, string | undefined>,
   148			noteSchemas: Record<string, Record<string, NoteSchema>>,
   149		): Promise<Note> {
   150			const contract = note.contractAddress.toString()
   151			const storageSlot = note.storageSlot.toString()
   152			const txHash = note.txHash.toString()
   153			const rawContent = note.note.items.map((x) => x.toString())
   154	
   155			const schema = await this.lookupSchema(network, note, classIdByContract, noteSchemas)
   156			const content = this.buildContent(note, schema)
   157	
   158			return {
   159				contract,
   160				storageSlot,
   161				txHash,
   162				rawContent,
   163				...(schema ? { type: schema.noteName } : {}),
   164				...(content ? { content } : {}),
   165			}
   166		}
   167	
   168		/** Look up `(classId, slotHex)` in the static schema map. Returns
   169		 *  `undefined` for any unknown class or slot — caller falls back to
   170		 *  raw items rendering. */
   171		private async lookupSchema(
   172			network: Network,
   173			note: NoteDao,
   174			classIdByContract: Map<string, string | undefined>,
   175			noteSchemas: Record<string, Record<string, NoteSchema>>,
   176		): Promise<NoteSchema | undefined> {
   177			const contract = note.contractAddress.toString()
   178			if (!classIdByContract.has(contract)) {
   179				classIdByContract.set(contract, await this.fetchClassId(network, note.contractAddress))
   180			}
   181			const classId = classIdByContract.get(contract)
   182			if (!classId) return undefined
   183			const slotHex = canonicalSlotHex(note.storageSlot.toString())
   184			return noteSchemas[classId]?.[slotHex]
   185		}
   186	
   187		private async fetchClassId(network: Network, address: AztecAddress): Promise<string | undefined> {
   188			try {
   189				const instance = await this.pxeService.getContractInstance(networkInfoFrom(network), address)
   190				return instance?.currentContractClassId.toString()
   191			} catch (error) {
   192				this.logWarn("Failed to load contract instance for note schema lookup", address.toString(), getErrorMessage(error))
   193				return undefined
   194			}
   195		}
   196	
   197		/** Build the named-fields `content` map. Always includes `owner` and
   198		 *  `randomness` (side-channel from NoteDao). Schema-decoded fields
   199		 *  fill in front; absence of a schema returns `undefined` (caller
   200		 *  renders raw items). */
   201		private buildContent(note: NoteDao, schema: NoteSchema | undefined): Record<string, string> | undefined {
   202			if (!schema) return undefined
   203			const items = note.note.items
   204			const out: Record<string, string> = {}
   205			for (let i = 0; i < schema.fields.length; i++) {
   206				const field = schema.fields[i]
   207				const item = items[i]
   208				if (!item) continue
   209				out[field.name] = decodeField(item, field.type)
   210			}
   211			try {
   212				out.owner = note.owner.toString()
   213			} catch {
   214				// owner missing on malformed daos — skip
   215			}
   216			try {
   217				out.randomness = note.randomness.toString()
   218			} catch {
   219				// randomness missing — skip
   220			}
   221			return out
   222		}
   223	}

exec
/bin/zsh -lc 'nl -ba packages/extension/src/wallet/services/note/note-schemas.test.ts' in (project root)
 succeeded in 0ms:
     1	/**
     2	 * Tests for the production note-schema map.
     3	 *
     4	 * Covers two non-bb.js areas:
     5	 * 1. `canonicalSlotHex` normalization — pure logic.
     6	 * 2. Storage-layout regression gates — read each bundled artifact's
     7	 *    `storageLayout.<field>.slot` and assert it still matches the slot
     8	 *    we hardcoded in `note-schemas.ts`. If a future aztec-packages bump
     9	 *    moves a slot, this test fails loudly instead of the notes viewer
    10	 *    silently falling back to raw-items rendering.
    11	 *
    12	 * The class-id → schema mapping itself goes through `getContractClassFromArtifact`
    13	 * (Poseidon/bb.js). That's exercised end-to-end at runtime + via the
    14	 * NoteService-level tests with synthetic class ids; we don't load real
    15	 * bb.js here because it tends to fault under repeated unit-test calls.
    16	 */
    17	import { describe, expect, test } from "vitest"
    18	import { loadContractArtifact } from "@aztec/stdlib/abi"
    19	import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
    20	import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
    21	// @ts-expect-error — vite alias
    22	import WonderlandTokenJson from "@wonderland-token-artifact"
    23	import { canonicalSlotHex } from "@nulo/aztec-runtime/pxe"
    24	
    25	const slotOf = (artifact: { storageLayout: Record<string, { slot: { value?: bigint } | bigint }> }, field: string): bigint => {
    26		const slot = artifact.storageLayout[field].slot
    27		return BigInt((slot as { value?: bigint }).value ?? (slot as bigint))
    28	}
    29	
    30	describe("canonicalSlotHex", () => {
    31		test("strips leading zeros from a padded Fr-string", () => {
    32			expect(canonicalSlotHex("0x0000000000000000000000000000000000000000000000000000000000000003")).toBe("0x3")
    33			expect(canonicalSlotHex("0x0000000000000000000000000000000000000000000000000000000000000007")).toBe("0x7")
    34		})
    35	
    36		test("preserves a short hex unchanged in canonical form", () => {
    37			expect(canonicalSlotHex("0x3")).toBe("0x3")
    38			expect(canonicalSlotHex("0x7")).toBe("0x7")
    39		})
    40	
    41		test("normalizes a decimal Fr-string to lowercase hex", () => {
    42			expect(canonicalSlotHex("3")).toBe("0x3")
    43		})
    44	
    45		test("handles 2-digit hex slots without re-padding", () => {
    46			expect(canonicalSlotHex("0xff")).toBe("0xff")
    47		})
    48	})
    49	
    50	describe("note-schema storage-slot regression gates", () => {
    51		test("Aztec Token: balances at slot 0x3 (UintNote)", () => {
    52			expect(slotOf(TokenContractArtifact, "balances")).toBe(0x3n)
    53		})
    54	
    55		test("Aztec NFT: private_nfts at slot 0x7 (NFTNote)", () => {
    56			expect(slotOf(NFTContractArtifact, "private_nfts")).toBe(0x7n)
    57		})
    58	
    59		test("Wonderland Token: private_balances at slot 0x7 (UintNote)", () => {
    60			const artifact = loadContractArtifact(WonderlandTokenJson)
    61			expect(slotOf(artifact, "private_balances")).toBe(0x7n)
    62		})
    63	})

exec
/bin/zsh -lc 'nl -ba packages/extension/vite.config.ts' in (project root)
 succeeded in 0ms:
     1	import { existsSync } from "node:fs"
     2	import { dirname, join, relative } from "node:path"
     3	import { fileURLToPath, URL } from "node:url"
     4	import vue from "@vitejs/plugin-vue"
     5	
     6	/** Resolve a file inside an npm package, bypassing its `exports` field.
     7	 *  Walks up from this config file to find the package in any node_modules. */
     8	function resolvePackageFile(pkg: string, file: string): string {
     9		const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
    10		let dir = fileURLToPath(new URL(".", import.meta.url))
    11		while (dir !== dirname(dir)) {
    12			const candidate = join(dir, "node_modules", ...parts, file)
    13			if (existsSync(candidate)) return candidate
    14			dir = dirname(dir)
    15		}
    16		throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
    17	}
    18	import usePages from "vite-plugin-pages"
    19	import useAutoImport from "unplugin-auto-import/vite"
    20	import useComponents from "unplugin-vue-components/vite"
    21	import { defineConfig } from "vite"
    22	import { nodePolyfills } from "vite-plugin-node-polyfills"
    23	import packageJson from "./package.json"
    24	import { viteStaticCopy } from "vite-plugin-static-copy"
    25	
    26	export default defineConfig({
    27		server: {
    28			port: 8088,
    29			strictPort: true,
    30			hmr: {
    31				port: 8088,
    32			},
    33			// Headers needed for bb WASM to work in multithreaded mode
    34			headers: {
    35				"Cross-Origin-Embedder-Policy": "require-corp",
    36				"Cross-Origin-Opener-Policy": "same-origin",
    37			},
    38		},
    39		resolve: {
    40			alias: {
    41				"@": fileURLToPath(new URL("./src", import.meta.url)),
    42				"~": fileURLToPath(new URL("./src", import.meta.url)),
    43				src: fileURLToPath(new URL("./src", import.meta.url)),
    44				"@assets": fileURLToPath(new URL("src/assets", import.meta.url)),
    45				"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
    46				"@wonderland-token-artifact": resolvePackageFile(
    47					"@defi-wonderland/aztec-standards",
    48					"artifacts/target/token_contract-Token.json",
    49				),
    50				"@alejoamiras/aztec-accelerator": resolvePackageFile("@alejoamiras/aztec-accelerator", "dist/index.js"),
    51				// Resolve the polyfill's Buffer shim to an absolute path. Rollup's
    52				// inject (used by `nodePolyfills({ globals: { Buffer: true } })`)
    53				// rewrites naked Buffer references into an import from this path;
    54				// without an alias, resolution fails when the source file lives
    55				// in a workspace package that doesn't directly depend on the
    56				// polyfill plugin (e.g. wallet-core).
    57				"vite-plugin-node-polyfills/shims/buffer": resolvePackageFile("vite-plugin-node-polyfills", "shims/buffer/dist/index.js"),
    58				// Force detect-node to return false so @aztec/foundation's pino logger
    59				// uses the browser transport instead of Node.js worker-thread transport.
    60				// Without this, the node-polyfills process shim makes detect-node think
    61				// we're in Node.js, causing pino.transport() to fail with "window is not defined".
    62				"detect-node": fileURLToPath(new URL("./src/shims/detect-node.ts", import.meta.url)),
    63				comlink: "comlink",
    64				debug: "debug",
    65			},
    66			// Force Vite to resolve these WASM-binding packages to a single copy.
    67			// Multiple nested versions exist in node_modules (rc.2 in simulator/pxe,
    68			// rc.4 hoisted). Without dedup, initAbi() and abiEncode() end up in
    69			// different module scopes, so the WASM instance variable is never shared.
    70			dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
    71		},
    72		css: {
    73			preprocessorOptions: {
    74				scss: {
    75					loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
    76					quietDeps: true,
    77				},
    78			},
    79		},
    80		plugins: [
    81			// Replace bb.js fetchCode module to eliminate dynamic import() of embedded WASM.
    82			// Chrome MV3 service workers forbid import() at runtime. Our shim uses fetch()
    83			// against the WASM files in /assets/ instead.
    84			{
    85				name: "bb-fetch-code-shim",
    86				enforce: "pre",
    87				resolveId(source, importer) {
    88					if (importer?.includes("@aztec/bb.js") && source.includes("fetch_code") && source.endsWith("index.js")) {
    89						return fileURLToPath(new URL("./src/shims/bb-fetch-code.ts", import.meta.url))
    90					}
    91				},
    92			},
    93			vue(),
    94	
    95			usePages({
    96				dirs: [
    97					{
    98						dir: "src/pages",
    99						baseRoute: "common",
   100					},
   101					{
   102						dir: "src/setup/pages",
   103						baseRoute: "setup",
   104					},
   105					{
   106						dir: "src/popup/pages",
   107						baseRoute: "popup",
   108					},
   109					{
   110						dir: "src/popup/windows",
   111						baseRoute: "windows",
   112					},
   113				],
   114			}),
   115	
   116			useAutoImport({
   117				imports: [
   118					"vue",
   119					"vue-router",
   120					{
   121						"webextension-polyfill": [["*", "browser"]],
   122					},
   123				],
   124				dts: "src/types/auto-imports.d.ts",
   125				dirs: ["src/composables/", "src/stores/", "src/utils/"],
   126				// Rewrites compiled _ctx.<name> template references to resolve against the
   127				// auto-import registry so {{ trimAddress(...) }} works without explicit
   128				// imports in every SFC. Plugin runs enforce:"post" internally — must stay
   129				// after vue() in the plugin chain.
   130				vueTemplate: true,
   131				eslintrc: {
   132					enabled: true,
   133					filepath: "src/types/.eslintrc-auto-import.json",
   134				},
   135			}),
   136	
   137			useComponents({
   138				dirs: ["src/components"],
   139				dts: "src/types/components.d.ts",
   140			}),
   141	
   142			{
   143				name: "assets-rewrite",
   144				enforce: "post",
   145				apply: "build",
   146				transformIndexHtml(html, { path }) {
   147					const assetsPath = relative(dirname(path), "/assets").replace(/\\/g, "/")
   148					return html.replace(/"\/assets\//g, `"${assetsPath}/`)
   149				},
   150			},
   151	
   152			{
   153				name: "wasm-content-type",
   154				configureServer(server) {
   155					server.middlewares.use((req, res, next) => {
   156						if (req.url?.endsWith(".wasm")) {
   157							res.setHeader("Content-Type", "application/wasm")
   158						}
   159						next()
   160					})
   161				},
   162			},
   163	
   164			viteStaticCopy({
   165				targets: [
   166					{
   167						src: "./libs/@aztec/bb.js/*.wasm.gz",
   168						dest: "assets/",
   169					},
   170				],
   171			}),
   172	
   173			nodePolyfills({
   174				include: ["buffer", /*"crypto",*/ "net", "path", "stream", "tty", "vm", "util"],
   175				// Make a naked `Buffer` identifier auto-import the polyfill at
   176				// build time. Required because wallet-core's serialization.ts
   177				// uses naked `Buffer` (no import) — see its docstring for why.
   178				globals: { Buffer: true },
   179			}),
   180		],
   181		build: {
   182			// Disable module preload polyfill — it references `window.dispatchEvent`
   183			// which doesn't exist in Chrome MV3 service workers.
   184			modulePreload: false,
   185			target: "esnext",
   186			rollupOptions: {
   187				input: {
   188					offscreen: "src/offscreen/index.html",
   189					popup: "src/popup/index.html",
   190					setup: "src/setup/index.html",
   191				},
   192			},
   193		},
   194		optimizeDeps: {
   195			include: ["pino", "vue", "webextension-polyfill"],
   196			exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "vue-demi"],
   197			esbuildOptions: {
   198				target: "esnext",
   199			},
   200		},
   201		define: {
   202			__VERSION__: JSON.stringify(packageJson.version),
   203			__SENTINEL__: JSON.stringify(packageJson.sentinel),
   204			__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
   205			__NAME__: JSON.stringify(packageJson.name),
   206			__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
   207			"import.meta.env.HTML_TITLE": JSON.stringify(packageJson.displayName),
   208			"process.browser": true,
   209			"process.env": JSON.stringify({
   210				LOG_LEVEL: "verbose",
   211				BB_WASM_PATH: "/assets/barretenberg.wasm.gz",
   212			}),
   213		},
   214	})

codex
I’ve got the plan and the core runtime files. Next I’m validating the actual artifact JSONs, then I’ll trace the class-resolution callers to see whether the proposed bundle change alters trust enforcement or smart-tighten behavior anywhere else.
exec
/bin/zsh -lc "rg -n 'balances|private_nfts|UintNote|NFTNote|balance_of|storageLayout|public_owners|nft_exists' packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json" in (project root)
exec
/bin/zsh -lc "rg -n 'balances|private_nfts|UintNote|NFTNote|balance_of|storageLayout|public_owners|nft_exists' packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json" in (project root)
 succeeded in 0ms:
73:      "source": "//! The `self` contract value for private execution contexts.\n\nuse crate::{\n    context::{calls::{PrivateCall, PrivateStaticCall, PublicCall, PublicStaticCall}, PrivateContext},\n    event::{event_emission::emit_event_in_private, event_interface::EventInterface, EventMessage},\n};\nuse crate::protocol::{address::AztecAddress, traits::{Deserialize, Serialize}};\n\n/// Core interface for interacting with aztec-nr contract features in private execution contexts.\n///\n/// This struct is automatically injected into every [`external`](crate::macros::functions::external) and\n/// [`internal`](crate::macros::functions::internal) contract function marked with `\"private\"` by the Aztec macro\n/// system and is accessible through the `self` variable.\n///\n/// ## Usage in Contract Functions\n///\n/// Once injected, you can use `self` to:\n/// - Access storage: `self.storage.balances.at(owner).read()`\n/// - Call contracts: `self.call(Token::at(address).transfer(recipient, amount))`\n/// - Emit events: `self.emit(event).deliver_to(recipient, delivery_mode)`\n/// - Get the contract address: `self.address`\n/// - Get the caller: `self.msg_sender()`\n/// - Access low-level Aztec.nr APIs through the context: `self.context`\n///\n/// ## Example\n///\n/// ```noir\n/// #[external(\"private\")]\n/// fn withdraw(amount: u128, recipient: AztecAddress) {\n///     // Get the caller of this function\n///     let sender = self.msg_sender();\n///\n///     // Access storage\n///     let token = self.storage.donation_token.get_note().get_address();\n///\n///     // Call contracts\n///     self.call(Token::at(token).transfer(recipient, amount));\n/// }\n/// ```\n///\n/// ## Type Parameters\n///\n/// - `Storage`: The contract's storage struct (defined with [`storage`](crate::macros::storage::storage), or `()` if\n/// the contract has no storage\n/// - `CallSelf`: Macro-generated type for calling contract's own non-view functions\n/// - `EnqueueSelf`: Macro-generated type for enqueuing calls to the contract's own non-view functions\n/// - `CallSelfStatic`: Macro-generated type for calling contract's own view functions\n/// - `EnqueueSelfStatic`: Macro-generated type for enqueuing calls to the contract's own view functions\n/// - `CallInternal`: Macro-generated type for calling internal functions\npub struct ContractSelfPrivate<Storage, CallSelf, EnqueueSelf, CallSelfStatic, EnqueueSelfStatic, CallInternal> {\n    /// The address of this contract\n    pub address: AztecAddress,\n\n    /// The contract's storage instance, representing the struct to which the\n    /// [`storage`](crate::macros::storage::storage) macro was applied in your contract. If the contract has no\n    /// storage, the type of this will be `()`.\n    ///\n    /// This storage instance is specialized for the current execution context (private) and\n    /// provides access to the contract's state variables.\n    ///\n    /// ## Developer Note\n    ///\n    /// If you've arrived here while trying to access your contract's storage while the `Storage` generic type is set\n    /// to unit type `()`, it means you haven't yet defined a Storage struct using the\n    /// [`storage`](crate::macros::storage::storage) macro in your contract. For guidance on setting this up, please\n    /// refer to our docs: https://docs.aztec.network/developers/docs/guides/smart_contracts/storage\n    pub storage: Storage,\n\n    /// The private execution context.\n    pub context: &mut PrivateContext,\n\n    /// Provides type-safe methods for calling this contract's own non-view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.call_self.some_private_function(args)\n    /// ```\n    pub call_self: CallSelf,\n\n    /// Provides type-safe methods for enqueuing calls to this contract's own non-view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.enqueue_self.some_public_function(args)\n    /// ```\n    pub enqueue_self: EnqueueSelf,\n\n    /// Provides type-safe methods for calling this contract's own view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.call_self_static.some_view_function(args)\n    /// ```\n    pub call_self_static: CallSelfStatic,\n\n    /// Provides type-safe methods for enqueuing calls to the contract's own view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.enqueue_self_static.some_public_view_function(args)\n    /// ```\n    pub enqueue_self_static: EnqueueSelfStatic,\n\n    /// Provides type-safe methods for calling internal functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.internal.some_internal_function(args)\n    /// ```\n    pub internal: CallInternal,\n}\n\nimpl<Storage, CallSelf, EnqueueSelf, CallSelfStatic, EnqueueSelfStatic, CallInternal> ContractSelfPrivate<Storage, CallSelf, EnqueueSelf, CallSelfStatic, EnqueueSelfStatic, CallInternal> {\n    /// Creates a new `ContractSelfPrivate` instance for a private function.\n    ///\n    /// This constructor is called automatically by the macro system and should not be called directly.\n    pub fn new(\n        context: &mut PrivateContext,\n        storage: Storage,\n        call_self: CallSelf,\n        enqueue_self: EnqueueSelf,\n        call_self_static: CallSelfStatic,\n        enqueue_self_static: EnqueueSelfStatic,\n        internal: CallInternal,\n    ) -> Self {\n        Self {\n            context,\n            storage,\n            address: context.this_address(),\n            call_self,\n            enqueue_self,\n            call_self_static,\n            enqueue_self_static,\n            internal,\n        }\n    }\n\n    /// The address of the contract address that made this function call.\n    ///\n    /// This is similar to Solidity's `msg.sender` value.\n    ///\n    /// ## Transaction Entrypoints\n    ///\n    /// As there are no EOAs (externally owned accounts) in Aztec, unlike on Ethereum, the first contract function\n    /// executed in a transaction (i.e. transaction entrypoint) does **not** have a caller. This function panics when\n    /// executed in such a context.\n    ///\n    /// If you need to handle these cases, use [`PrivateContext::maybe_msg_sender`].\n    pub fn msg_sender(self) -> AztecAddress {\n        self.context.maybe_msg_sender().unwrap()\n    }\n\n    /// Emits an event privately.\n    ///\n    /// Unlike public events, private events do not reveal their contents publicly. They instead create an\n    /// [`EventMessage`] containing the private event information, which **MUST** be delivered to a recipient via\n    /// [`EventMessage::deliver_to`] in order for them to learn about the event. Multiple recipients can have the same\n    /// message be delivered to them.\n    ///\n    /// # Example\n    /// ```noir\n    /// #[event]\n    /// struct Transfer { from: AztecAddress, to: AztecAddress, amount: u128 }\n    ///\n    /// #[external(\"private\")]\n    /// fn transfer(to: AztecAddress, amount: u128) {\n    ///     let from = self.msg_sender();\n    ///\n    ///     let message: EventMessage = self.emit(Transfer { from, to, amount });\n    ///     message.deliver_to(from, MessageDelivery.OFFCHAIN);\n    ///     message.deliver_to(to, MessageDelivery.ONCHAIN_CONSTRAINED);\n    /// }\n    /// ```\n    ///\n    /// # Cost\n    ///\n    /// Private event emission always results in the creation of a nullifer, which acts as a commitment to the event\n    /// and is used by third parties to verify its authenticity. See [`EventMessage::deliver_to`] for the costs\n    /// associated to delivery.\n    ///\n    /// # Privacy\n    ///\n    /// The nullifier created when emitting a private event leaks nothing about the content of the event - it's a\n    /// commitment that includes a random value, so even with full knowledge of the event preimage determining if an\n    /// event was emitted or not requires brute-forcing the entire `Field` space.\n    pub fn emit<Event>(&mut self, event: Event) -> EventMessage<Event>\n    where\n        Event: EventInterface + Serialize,\n    {\n        emit_event_in_private(self.context, event)\n    }\n\n    /// Makes a private contract call.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the private function to invoke.\n    ///\n    /// # Returns\n    /// * `T` - Whatever data the called function has returned.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.call(Token::at(address).transfer_in_private(recipient, amount));\n    /// ```\n    ///\n    /// This enables contracts to interact with each other while maintaining privacy. This \"composability\" of private\n    /// contract functions is a key feature of the Aztec network.\n    ///\n    /// If a user's transaction includes multiple private function calls, then by the design of Aztec, the following\n    /// information will remain private[1]:\n    /// - The function selectors and contract addresses of all private function calls will remain private, so an\n    /// observer of the public mempool will not be able to look at a tx and deduce which private functions have been\n    /// executed.\n    /// - The arguments and return values of all private function calls will remain private.\n    /// - The person who initiated the tx will remain private.\n    /// - The notes and nullifiers and private logs that are emitted by all private function calls will (if designed\n    /// well) not leak any user secrets, nor leak which functions have been executed.\n    ///\n    /// [1] Caveats: Some of these privacy guarantees depend on how app developers design their smart contracts. Some\n    /// actions _can_ leak information, such as:\n    /// - Calling an internal public function.\n    /// - Calling a public function and not setting msg_sender to Option::none (see\n    /// https://github.com/AztecProtocol/aztec-packages/pull/16433)\n    /// - Calling any public function will always leak details about the nature of the transaction, so devs should be\n    /// careful in their contract designs. If it can be done in a private function, then that will give the best\n    /// privacy.\n    /// - Not padding the side-effects of a tx to some standardized, uniform size. The kernel circuits can take hints\n    /// to pad side-effects, so a wallet should be able to request for a particular amount of padding. Wallets should\n    /// ideally agree on some standard.\n    /// - Padding should include:\n    /// - Padding the lengths of note & nullifier arrays\n    /// - Padding private logs with random fields, up to some standardized size. See also:\n    /// https://docs.aztec.network/developers/resources/considerations/privacy_considerations\n    ///\n    /// # Advanced\n    /// * The call is added to the private call stack and executed by kernel circuits after this function completes\n    /// * The called function can modify its own contract's private state\n    /// * Side effects from the called function are included in this transaction\n    /// * The call inherits the current transaction's context and gas limits\n    ///\n    pub fn call<let M: u32, let N: u32, T>(&mut self, call: PrivateCall<M, N, T>) -> T\n    where\n        T: Deserialize,\n    {\n        call.call(self.context)\n    }\n\n    /// Makes a read-only private contract call.\n    ///\n    /// This is similar to Solidity's `staticcall`. The called function cannot modify state, emit L2->L1 messages, nor\n    /// emit events. Any nested calls are constrained to also be static calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only private function to invoke.\n    ///\n    /// # Returns\n    /// * `T` - Whatever data the called function has returned.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.view(Token::at(address).balance_of_private(recipient));\n    /// ```\n    pub fn view<let M: u32, let N: u32, T>(&mut self, call: PrivateStaticCall<M, N, T>) -> T\n    where\n        T: Deserialize,\n    {\n        call.view(self.context)\n    }\n\n    /// Enqueues a public contract call function.\n    ///\n    /// Unlike private functions which execute immediately on the user's device, public function calls are \"enqueued\"\n    /// and executed some time later by a block proposer.\n    ///\n    /// This means a public function cannot return any values back to a private function, because by the time the\n    /// public function is being executed, the private function which called it has already completed execution. (In\n    /// fact, the private function has been executed and proven, along with all other private function calls of the\n    /// user's tx. A single proof of the tx has been submitted to the Aztec network, and some time later a proposer has\n    /// picked the tx up from the mempool and begun executing all of the enqueued public functions).\n    ///\n    /// # Privacy warning Enqueueing a public function call is an inherently leaky action. Many interesting applications will require some interaction with public state, but smart contract developers should try to use public function calls sparingly, and carefully. _Internal_ public function calls are especially leaky, because they completely leak which private contract made the call. See also: https://docs.aztec.network/developers/resources/considerations/privacy_considerations\n    ///\n    /// # Arguments\n    /// * `call` - The interface representing the public function to enqueue.\n    pub fn enqueue<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.enqueue(self.context)\n    }\n\n    /// Enqueues a read-only public contract call function.\n    ///\n    /// This is similar to Solidity's `staticcall`. The called function cannot modify state, emit L2->L1 messages, nor\n    /// emit events. Any nested calls are constrained to also be static calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only public function to enqueue.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.enqueue_view(MyContract::at(address).assert_timestamp_less_than(timestamp));\n    /// ```\n    pub fn enqueue_view<let M: u32, let N: u32, T>(&mut self, call: PublicStaticCall<M, N, T>) {\n        call.enqueue_view(self.context)\n    }\n\n    /// Enqueues a privacy-preserving public contract call function.\n    ///\n    /// This is the same as [`ContractSelfPrivate::enqueue`], except it hides this calling contract's address from the\n    /// target public function (i.e. [`ContractSelfPrivate::msg_sender`] will panic).\n    ///\n    /// This means the origin of the call (msg_sender) will not be publicly visible to any blockchain observers, nor to\n    /// the target public function. If the target public function reads `self.msg_sender()` the call will revert.\n    ///\n    /// NOTES:\n    /// - Not all public functions will accept a msg_sender of \"none\". Many public functions will require that\n    /// msg_sender is \"some\" and will revert otherwise. Therefore, if using `enqueue_incognito`, you must understand\n    /// whether the function you're calling will accept a msg_sender of \"none\". Lots of public bookkeeping patterns\n    /// rely on knowing which address made the call, so as to ascribe state against the caller's address. (There are\n    /// patterns whereby bookkeeping could instead be done in private-land).\n    /// - If you are enqueueing a call to an _internal_ public function (i.e. a public function that will only accept\n    /// calls from other functions of its own contract), then by definition a call to it cannot possibly be\n    /// \"incognito\": the msg_sender must be its own address, and indeed the called public function will assert this.\n    /// Tl;dr this is not usable for enqueued internal public calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the public function to enqueue.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.enqueue_incognito(Token::at(address).increase_total_supply_by(amount));\n    /// ```\n    ///\n    /// Advanced:\n    /// - The kernel circuits will permit _any_ private function to set the msg_sender field of any enqueued public\n    /// function call to NULL_MSG_SENDER_CONTRACT_ADDRESS.\n    /// - When the called public function calls `PublicContext::msg_sender()`, aztec-nr will translate\n    /// NULL_MSG_SENDER_CONTRACT_ADDRESS into `Option<AztecAddress>::none` for familiarity to devs.\n    ///\n    pub fn enqueue_incognito<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.enqueue_incognito(self.context)\n    }\n\n    /// Enqueues a privacy-preserving read-only public contract call function.\n    ///\n    /// As per `enqueue_view`, but hides this calling contract's address from the target public function.\n    ///\n    /// See `enqueue_incognito` for more details relating to hiding msg_sender.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only public function to enqueue.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.enqueue_view_incognito(MyContract::at(address).assert_timestamp_less_than(timestamp));\n    /// ```\n    ///\n    pub fn enqueue_view_incognito<let M: u32, let N: u32, T>(&mut self, call: PublicStaticCall<M, N, T>) {\n        call.enqueue_view_incognito(self.context)\n    }\n\n    /// Enqueues a call to the public function defined by the `call` parameter, and designates it to be the teardown\n    /// function for this tx. Only one teardown function call can be made by a tx.\n    ///\n    /// Niche function: Only wallet developers and paymaster contract developers (aka Fee-payment contracts) will need\n    /// to make use of this function.\n    ///\n    /// Aztec supports a three-phase execution model: setup, app logic, teardown. The phases exist to enable a fee\n    /// payer to take on the risk of paying a transaction fee, safe in the knowledge that their payment (in whatever\n    /// token or method the user chooses) will succeed, regardless of whether the app logic will succeed. The \"setup\"\n    /// phase ensures the fee payer has sufficient balance to pay the proposer their fees. The teardown phase is\n    /// primarily intended to: calculate exactly how much the user owes, based on gas consumption, and refund the user\n    /// any change.\n    ///\n    /// Note: in some cases, the cost of refunding the user (i.e. DA costs of tx side-effects) might exceed the refund\n    /// amount. For app logic with fairly stable and predictable gas consumption, a material refund amount is unlikely.\n    /// For app logic with unpredictable gas consumption, a refund might be important to the user (e.g. if a hefty\n    /// function reverts very early). Wallet/FPC/Paymaster developers should be mindful of this.\n    ///\n    /// See `enqueue` for more information about enqueuing public function calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the public function to designate as teardown.\n    ///\n    pub fn set_as_teardown<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.set_as_teardown(self.context)\n    }\n\n    /// Enqueues a call to the public function defined by the `call` parameter, and designates it to be the teardown\n    /// function for this tx. Only one teardown function call can be made by a tx.\n    ///\n    /// As per `set_as_teardown`, but hides this calling contract's address from the target public function.\n    ///\n    /// See `enqueue_incognito` for more details relating to hiding msg_sender.\n    ///\n    pub fn set_as_teardown_incognito<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.set_as_teardown_incognito(self.context)\n    }\n}\n"
377:      "source": "use aztec::macros::aztec;\npub mod test;\n\n/// Private Fee Payment Contract\n///\n/// Fully private FPC (no public functions, no owner, no off-chain agent).\n/// Users bridge FeeJuice from L1 via FeeJuicePortal to this contract address,\n/// then call `mint` to convert the bridge claim into private FJ balance.\n/// The FJ balance can then be used to sponsor transactions via `pay_fee`.\n#[aztec]\npub contract PrivateFPC {\n    use aztec::{\n        hash::{\n            compute_l1_to_l2_message_hash, compute_l1_to_l2_message_nullifier, compute_secret_hash,\n        },\n        macros::{functions::{allow_phase_change, external, internal, only_self}, storage::storage},\n        messages::message_delivery::MessageDelivery,\n        nullifier::utils::compute_nullifier_existence_request,\n        protocol::{\n            address::{AztecAddress, EthAddress},\n            constants::FEE_JUICE_ADDRESS,\n            hash::{poseidon2_hash_with_separator, sha256_to_field},\n            traits::ToField,\n        },\n        state_vars::Owned,\n    };\n    use balance_set::BalanceSet;\n    use fpc_lib::get_max_gas_cost;\n\n    // gas-optimized max notes for initial transfer call\n    global INITIAL_TRANSFER_CALL_MAX_NOTES: u32 = 2;\n    // max notes for recursive transfer call if initial max notes are exceeded\n    global RECURSIVE_TRANSFER_CALL_MAX_NOTES: u32 = 8;\n\n    /// Domain separator for bridge secret derivation.\n    /// Avoids collisions with other poseidon2 usages.\n    /// Value: poseidon2_hash_bytes(\"az_dom_sep__fpc_bridge_secret\") as u32\n    global DOM_SEP__FPC_BRIDGE_SECRET: u32 = 3952304070;\n\n    /// @param balances The private note-based balances mapping accounts to their internal FPC balance\n    #[storage]\n    struct Storage<Context> {\n        balances: Owned<BalanceSet<Context>, Context>,\n    }\n\n    /// @notice Sponsors the transaction by deducting max gas cost from sender's balance.\n    /// @dev Does not refund unused gas - the full max_gas_cost is consumed.\n    #[external(\"private\")]\n    #[allow_phase_change]\n    fn pay_fee() {\n        let sender = self.msg_sender();\n        let _max_gas_cost = self.internal._deduct_max_gas_cost(sender);\n\n        // Set the FPC as the fee payer of the tx.\n        self.context.set_as_fee_payer();\n        // End the setup phase.\n        self.context.end_setup();\n    }\n\n    /// @notice Mints internal FJ balance and pays fee in one transaction (cold-start flow).\n    ///\n    /// Combines the bridge claim proof with fee payment: proves the L1->L2 bridge claim,\n    /// credits (amount - max_gas_cost) to the claimer, and sets the FPC as fee payer.\n    ///\n    /// Prerequisites (must execute in the same tx, before this call):\n    ///   - FeeJuice.claim(this_fpc_address, amount, secret, leaf_index) emits the FeeJuice\n    ///     nullifier that this function asserts via assert_nullifier_exists.\n    ///\n    /// Security: same as mint -- only the claimer can reconstruct the correct FeeJuice\n    /// nullifier; FPC-scoped nullifier prevents double-spending.\n    ///\n    /// @param amount     The exact amount bridged (must match the L1 deposit exactly).\n    /// @param salt       The random value chosen by the claimer at deposit time.\n    /// @param leaf_index The L1 message leaf index from the deposit transaction.\n    #[external(\"private\")]\n    #[allow_phase_change]\n    fn mint_and_pay_fee(amount: u128, salt: Field, leaf_index: Field) {\n        let claimer = self.msg_sender();\n\n        let feejuice_nullifier = compute_feejuice_claim_nullifier(\n            self.address,\n            amount,\n            salt,\n            claimer,\n            leaf_index,\n            self.context.chain_id(),\n            self.context.version(),\n        );\n\n        self.context.assert_nullifier_exists(compute_nullifier_existence_request(\n            feejuice_nullifier,\n            FEE_JUICE_ADDRESS,\n        ));\n\n        // FPC-scoped nullifier prevents double-spending this bridge credit.\n        self.context.push_nullifier(feejuice_nullifier);\n\n        // Credit (amount - max_gas_cost) to claimer. The fee is implicitly deducted\n        // since the full amount was bridged but only the remainder is credited.\n        let max_gas_cost = get_max_gas_cost(self.context);\n        assert(amount >= max_gas_cost, \"Amount too low to cover gas cost\");\n        self.storage.balances.at(claimer).add(amount - max_gas_cost).deliver(\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        self.context.set_as_fee_payer();\n        self.context.end_setup();\n    }\n\n    /// @notice Mints internal FJ balance by proving a prior L1->L2 FeeJuice bridge claim.\n    ///\n    /// Prerequisites (must happen before or in the same tx as this call):\n    ///   1. On L1: FeeJuicePortal.depositToAztecPublic(\n    ///        _to        = this_fpc_address,\n    ///        _amount    = amount,\n    ///        _secretHash = compute_secret_hash(derive_bridge_secret(salt, claimer_aztec_address))\n    ///      )\n    ///   2. On L2: FeeJuice.claim(\n    ///        to                 = this_fpc_address,\n    ///        amount             = amount,\n    ///        secret             = derive_bridge_secret(salt, claimer_aztec_address),\n    ///        message_leaf_index = leaf_index\n    ///      )  ->  FJ credited to FPC's public FeeJuice balance; FeeJuice nullifier emitted.\n    ///\n    /// Security:\n    ///   - Auth: only msg_sender == claimer can reconstruct the correct FeeJuice nullifier.\n    ///   - Bridge proof: kernel verifies FeeJuice nullifier exists (pending or settled).\n    ///   - Double-spend: FPC emits its own nullifier (siloed under FPC address), distinct from\n    ///     the FeeJuice-siloed one - preventing the same bridge from being minted twice.\n    ///\n    /// @param amount     The exact amount bridged (must match the L1 deposit exactly).\n    /// @param salt       A random value chosen by the claimer at deposit time.\n    /// @param leaf_index The L1 message leaf index from the deposit transaction.\n    #[external(\"private\")]\n    fn mint(amount: u128, salt: Field, leaf_index: Field) {\n        let claimer = self.msg_sender();\n\n        // Reconstruct the nullifier FeeJuice.claim emitted when consuming the bridge message.\n        // Only the claimer can compute this correctly - derive_bridge_secret binds their address.\n        let feejuice_nullifier = compute_feejuice_claim_nullifier(\n            self.address,\n            amount,\n            salt,\n            claimer,\n            leaf_index,\n            self.context.chain_id(),\n            self.context.version(),\n        );\n\n        // Assert the FeeJuice nullifier exists entirely in private.\n        // The kernel circuit verifies this read request against the nullifier tree - no public call needed.\n        // compute_nullifier_existence_request handles pending (same-tx) vs settled nullifiers.\n        self.context.assert_nullifier_exists(compute_nullifier_existence_request(\n            feejuice_nullifier,\n            FEE_JUICE_ADDRESS,\n        ));\n\n        // Emit an FPC-scoped nullifier to prevent double-minting this bridge credit.\n        // Siloed as poseidon2([FPC_address, feejuice_nullifier]) - distinct from the\n        // FeeJuice-siloed version poseidon2([FeeJuice_address, feejuice_nullifier]).\n        self.context.push_nullifier(feejuice_nullifier);\n\n        // Mint private internal balance to claimer.\n        self.storage.balances.at(claimer).add(amount).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);\n    }\n\n    /// @notice Computes the max gas cost and deducts it from the account's balance.\n    /// @param account The address to deduct the gas cost from\n    /// @return The max gas cost that was deducted\n    #[internal(\"private\")]\n    fn _deduct_max_gas_cost(account: AztecAddress) -> u128 {\n        let max_gas_cost = get_max_gas_cost(self.context);\n\n        let change =\n            self.internal._subtract_balance(account, max_gas_cost, INITIAL_TRANSFER_CALL_MAX_NOTES);\n        self.storage.balances.at(account).add(change).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);\n\n        max_gas_cost\n    }\n\n    /// @notice Subtracts balance from private balance.\n    /// @dev Recurses via `recurse_subtract_balance_internal` if `max_notes` is insufficient.\n    /// @param account   The address of the account to subtract the balance from\n    /// @param amount    The amount of tokens to subtract\n    /// @param max_notes The maximum number of notes to process in a single call\n    /// @return The change to return to the owner\n    #[internal(\"private\")]\n    fn _subtract_balance(account: AztecAddress, amount: u128, max_notes: u32) -> u128 {\n        let subtracted = self.storage.balances.at(account).try_sub(amount, max_notes);\n        if subtracted >= amount {\n            subtracted - amount\n        } else {\n            assert(subtracted > 0, \"Balance too low\");\n\n            let remaining = amount - subtracted;\n            self.call_self.recurse_subtract_balance_internal(account, remaining)\n        }\n    }\n\n    /// @notice Recursively subtracts balance from private balance.\n    /// @param account The address of the account to subtract the balance from\n    /// @param amount  The amount to subtract\n    /// @return The change to return to the owner\n    #[external(\"private\")]\n    #[only_self]\n    fn recurse_subtract_balance_internal(account: AztecAddress, amount: u128) -> u128 {\n        self.internal._subtract_balance(account, amount, RECURSIVE_TRANSFER_CALL_MAX_NOTES)\n    }\n\n    /// @notice Returns the private balance of an account\n    /// @param account The address to query\n    /// @return The private balance of the account\n    #[external(\"utility\")]\n    unconstrained fn balance_of(account: AztecAddress) -> u128 {\n        self.storage.balances.at(account).balance_of()\n    }\n\n    // --- Bridge mint helpers ---\n\n    /// @notice Derives the bridge secret from (salt, claimer).\n    ///\n    /// Only the claimer can compute this, since it binds their Aztec address.\n    /// The corresponding L1 secretHash must be:\n    ///   compute_secret_hash(derive_bridge_secret(salt, claimer_aztec_address))\n    ///\n    /// @param salt    A random value chosen by the claimer at deposit time.\n    /// @param claimer The Aztec address of the claimer.\n    /// @return The bridge secret.\n    #[contract_library_method]\n    pub fn derive_bridge_secret(salt: Field, claimer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator([salt, claimer.to_field()], DOM_SEP__FPC_BRIDGE_SECRET)\n    }\n\n    /// @notice Computes the FeeJuice L1->L2 message content hash for bridging `amount` to `fpc_address`.\n    ///\n    /// Mirrors FeeJuicePortal.depositToAztecPublic on L1:\n    ///   sha256(abi.encodeWithSignature(\"claim(bytes32,uint256)\", fpc_address, amount))\n    ///\n    /// The 4-byte selector keccak256(\"claim(bytes32,uint256)\")[0:4] is computed at compile-time only -\n    /// zero runtime cost.\n    ///\n    /// @param fpc_address The FPC contract address (recipient of the bridge).\n    /// @param amount      The amount of FeeJuice bridged.\n    /// @return The content hash field element.\n    #[contract_library_method]\n    pub fn get_bridge_gas_msg_hash(fpc_address: AztecAddress, amount: u128) -> Field {\n        let mut hash_bytes = [0 as u8; 68];\n        let recipient_bytes: [u8; 32] = fpc_address.to_field().to_be_bytes();\n        let amount_bytes: [u8; 32] = (amount as Field).to_be_bytes();\n\n        // EVM ABI function selector: keccak256(\"claim(bytes32,uint256)\")[0:4]\n        // Must match exactly what FeeJuicePortal.depositToAztecPublic encodes on L1.\n        // Evaluated at compile-time only - zero runtime cost.\n        let selector: [u8; 32] =\n            comptime { keccak256::keccak256(\"claim(bytes32,uint256)\".as_bytes(), 22) };\n\n        for i in 0..4 {\n            hash_bytes[i] = selector[i];\n        }\n        for i in 0..32 {\n            hash_bytes[i + 4] = recipient_bytes[i];\n            hash_bytes[i + 36] = amount_bytes[i];\n        }\n\n        sha256_to_field(hash_bytes)\n    }\n\n    /// @notice Reconstructs the nullifier that FeeJuice.claim emits when consuming the bridge message.\n    ///\n    /// FeeJuice.claim calls consume_l1_to_l2_message which:\n    ///   1. Derives secret_hash = compute_secret_hash(secret)\n    ///   2. Computes message_hash = sha256(portal | chain_id | fee_juice_l2 | version | content | secret_hash | leaf_index)\n    ///   3. Emits nullifier = poseidon2([message_hash, secret], DOM_SEP__MESSAGE_NULLIFIER)\n    ///\n    /// By reconstructing this, the FPC can verify FeeJuice.claim was already executed.\n    ///\n    /// Protocol invariant: FeeJuice portal Eth address == FEE_JUICE_ADDRESS as a Field.\n    /// See FeeJuice.claim_helper: EthAddress::from_field(FEE_JUICE_ADDRESS.to_field())\n    ///\n    /// @param fpc_address The FPC contract address (recipient of the bridge).\n    /// @param amount      The exact amount bridged.\n    /// @param salt        A random value chosen by the claimer at deposit time.\n    /// @param claimer     The Aztec address of the claimer.\n    /// @param leaf_index  The L1 message leaf index.\n    /// @param chain_id    The L1 chain ID.\n    /// @param version     The Aztec protocol version.\n    /// @return The FeeJuice claim nullifier.\n    #[contract_library_method]\n    pub fn compute_feejuice_claim_nullifier(\n        fpc_address: AztecAddress,\n        amount: u128,\n        salt: Field,\n        claimer: AztecAddress,\n        leaf_index: Field,\n        chain_id: Field,\n        version: Field,\n    ) -> Field {\n        let secret = derive_bridge_secret(salt, claimer);\n        let content_hash = get_bridge_gas_msg_hash(fpc_address, amount);\n        let secret_hash = compute_secret_hash(secret);\n\n        let fee_juice_portal = EthAddress::from_field(FEE_JUICE_ADDRESS.to_field());\n\n        let message_hash = compute_l1_to_l2_message_hash(\n            fee_juice_portal,\n            chain_id,\n            FEE_JUICE_ADDRESS,\n            version,\n            content_hash,\n            secret_hash,\n            leaf_index,\n        );\n\n        compute_l1_to_l2_message_nullifier(message_hash, secret)\n    }\n\n}\n"
381:      "source": "use aztec::{\n    context::{PrivateContext, UtilityContext},\n    note::{\n        HintedNote,\n        MaybeNoteMessage,\n        note_getter_options::{NoteGetterOptions, SortOrder},\n        note_interface::NoteProperties,\n        note_viewer_options::NoteViewerOptions,\n    },\n    protocol::{address::AztecAddress, constants::MAX_NOTE_HASH_READ_REQUESTS_PER_CALL, traits::Packable},\n    state_vars::{OwnedStateVariable, PrivateSet},\n};\nuse std::ops::Add;\nuse uint_note::UintNote;\n\npub struct BalanceSet<Context> {\n    set: PrivateSet<UintNote, Context>,\n}\n\n// TODO(#13824): remove this impl once we allow structs to hold state variables.\nimpl<Context> OwnedStateVariable<Context> for BalanceSet<Context> {\n    fn new(context: Context, storage_slot: Field, owner: AztecAddress) -> Self {\n        Self { set: PrivateSet::new(context, storage_slot, owner) }\n    }\n}\n\nimpl BalanceSet<UtilityContext> {\n    pub unconstrained fn balance_of(self: Self) -> u128 {\n        self.balance_of_with_offset(0)\n    }\n\n    pub unconstrained fn balance_of_with_offset(self: Self, offset: u32) -> u128 {\n        let mut balance = 0 as u128;\n        let options = NoteViewerOptions::<UintNote, <UintNote as Packable>::N>::new().set_offset(offset);\n        let notes = self.set.view_notes(options);\n        for i in 0..options.limit {\n            if i < notes.len() {\n                balance = balance + notes.get_unchecked(i).value;\n            }\n        }\n        if (notes.len() == options.limit) {\n            balance = balance + self.balance_of_with_offset(offset + options.limit);\n        }\n\n        balance\n    }\n}\n\nimpl BalanceSet<&mut PrivateContext> {\n    pub fn add(self: Self, addend: u128) -> MaybeNoteMessage<UintNote> {\n        let maybe_new_note = if addend == 0 as u128 {\n            Option::none()\n        } else {\n            let addend_note = UintNote { value: addend };\n\n            Option::some(self.set.insert(addend_note).get_new_note())\n        };\n\n        MaybeNoteMessage::new(maybe_new_note, self.set.context)\n    }\n\n    pub fn sub(self: Self, amount: u128) -> MaybeNoteMessage<UintNote> {\n        let subtracted = self.try_sub(amount, MAX_NOTE_HASH_READ_REQUESTS_PER_CALL);\n\n        // try_sub may have subtracted more or less than amount. We must ensure that we subtracted at least as much as\n        // we needed, and then create a new note for the owner for the change (if any).\n        assert(subtracted >= amount, \"Balance too low\");\n        self.add(subtracted - amount)\n    }\n\n    // Attempts to remove 'target_amount' from the owner's balance. try_sub returns how much was actually subtracted\n    // (i.e. the sum of the value of nullified notes), but this subtracted amount may be more or less than the target\n    // amount. This may seem odd, but is unfortunately unavoidable due to the number of notes available and their\n    // amounts being unknown. What try_sub does is a best-effort attempt to consume as few notes as possible that add\n    // up to more than `target_amount`. The `max_notes` parameter is used to fine-tune the number of constraints\n    // created by this function. The gate count scales relatively linearly with `max_notes`, but a lower `max_notes`\n    // parameter increases the likelihood of `try_sub` subtracting an amount smaller than `target_amount`.\n    pub fn try_sub(self: Self, target_amount: u128, max_notes: u32) -> u128 {\n        // We are using a preprocessor here (filter applied in an unconstrained context) instead of a filter because we\n        // do not need to prove correct execution of the preprocessor. Because the `min_sum` notes is not constrained,\n        // users could choose to e.g. not call it. However, all this might result in is simply higher DA costs due to\n        // more nullifiers being emitted. Since we don't care about proving optimal note usage, we can save these\n        // constraints and make the circuit smaller.\n        let options = NoteGetterOptions::with_preprocessor(preprocess_notes_min_sum, target_amount)\n            .sort(UintNote::properties().value, SortOrder.DESC)\n            .set_limit(max_notes);\n        let notes = self.set.pop_notes(options);\n\n        let mut subtracted = 0 as u128;\n        for i in 0..options.limit {\n            if i < notes.len() {\n                let note = notes.get_unchecked(i);\n                subtracted = subtracted + note.value;\n            }\n        }\n\n        subtracted\n    }\n}\n\n// Computes the partial sum of the notes array, stopping once 'min_sum' is reached. This can be used to minimize the\n// number of notes read that add to some value, e.g. when transferring some amount of tokens. The preprocessor (a\n// filter applied in an unconstrained context) does not check if total sum is larger or equal to 'min_sum' - all it\n// does is remove extra notes if it does reach that value. Note that proper usage of this preprocessor requires for\n// notes to be sorted in descending order.\npub fn preprocess_notes_min_sum(\n    notes: [Option<HintedNote<UintNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL],\n    min_sum: u128,\n) -> [Option<HintedNote<UintNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL] {\n    let mut selected = [Option::none(); MAX_NOTE_HASH_READ_REQUESTS_PER_CALL];\n    let mut sum = 0 as u128;\n    for i in 0..notes.len() {\n        // Because we process notes in retrieved order, notes need to be sorted in descending amount order for this\n        // filter to be useful. Consider a 'min_sum' of 4, and a set of notes with amounts [3, 2, 1, 1, 1, 1, 1]. If\n        // sorted in descending order, the filter will only choose the notes with values 3 and 2, but if sorted in\n        // ascending order it will choose 4 notes of value 1.\n        if notes[i].is_some() & sum < min_sum {\n            let hinted_note = notes[i].unwrap_unchecked();\n            selected[i] = Option::some(hinted_note);\n            sum = sum.add(hinted_note.note.value);\n        }\n    }\n    selected\n}\n"
385:      "source": "use aztec::{\n    context::{PrivateContext, PublicContext},\n    history::nullifier::assert_nullifier_existed_by,\n    keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},\n    macros::notes::custom_note,\n    messages::{\n        logs::partial_note::encode_partial_note_private_message,\n        message_delivery::{do_private_message_delivery, MessageDelivery},\n    },\n    note::{note_interface::{NoteHash, NoteType}, utils::compute_note_nullifier},\n    oracle::random::random,\n    protocol::{\n        address::AztecAddress,\n        constants::{\n            DOM_SEP__NOTE_COMPLETION_LOG_TAG, DOM_SEP__NOTE_HASH, DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n            PRIVATE_LOG_CIPHERTEXT_LEN,\n        },\n        hash::{compute_log_tag, compute_siloed_nullifier, poseidon2_hash_with_separator},\n        traits::{Deserialize, FromField, Hash, Packable, Serialize, ToField},\n    },\n};\n\n// UintNote supports partial notes, i.e. the ability to create an incomplete note in private, hiding certain values\n// (the owner and randomness), and then completing the note in public with the ones missing (the storage slot and\n// amount). Partial notes are being actively developed and are not currently fully supported via macros, and so we\n// rely on the #[custom_note] macro to implement it manually, resulting in some boilerplate. This is expected to be\n// unnecessary once macro support is expanded.\n\n/// A private note representing a numeric value associated to an account (e.g. a token balance).\n// docs:start:uint_note_def\n#[derive(Deserialize, Eq, Serialize, Packable)]\n#[custom_note]\npub struct UintNote {\n    /// The number stored in the note.\n    pub value: u128,\n}\n// docs:end:uint_note_def\n\nimpl NoteHash for UintNote {\n    // docs:start:compute_note_hash\n    fn compute_note_hash(self, owner: AztecAddress, storage_slot: Field, randomness: Field) -> Field {\n        // Partial notes can be implemented by having the note hash be either the result of multiscalar multiplication\n        // (MSM), or two rounds of poseidon. MSM results in more constraints and is only required when multiple\n        // variants of partial notes are supported. Because UintNote has just one variant (where the value is public),\n        // we use poseidon instead.\n\n        // We must compute the same note hash as would be produced by a partial note created and completed with the\n        // same values, so that notes all behave the same way regardless of how they were created. To achieve this, we\n        // perform both steps of the partial note computation.\n\n        // First we create the partial note from a commitment to the private content.\n        let partial_note = PartialUintNote { commitment: compute_partial_commitment(owner, randomness) };\n\n        // Then compute the completion note hash. In a real partial note this step would be performed in public.\n        partial_note.compute_complete_note_hash(storage_slot, self.value)\n    }\n    // docs:end:compute_note_hash\n\n    // The nullifiers are nothing special - this is just the canonical implementation that would be injected by the\n    // #[note] macro.\n\n    fn compute_nullifier(\n        self,\n        context: &mut PrivateContext,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Field {\n        let owner_npk_m = get_public_keys(owner).npk_m;\n        let owner_npk_m_hash = owner_npk_m.hash();\n        let secret = context.request_nhk_app(owner_npk_m_hash);\n        compute_note_nullifier(note_hash_for_nullification, [secret])\n    }\n\n    unconstrained fn compute_nullifier_unconstrained(\n        self,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Option<Field> {\n        try_get_public_keys(owner).map(|public_keys| {\n            let owner_npk_m = public_keys.npk_m;\n            let owner_npk_m_hash = owner_npk_m.hash();\n            let secret = get_nhk_app(owner_npk_m_hash);\n            compute_note_nullifier(note_hash_for_nullification, [secret])\n        })\n    }\n}\n\nimpl UintNote {\n    /// Creates a partial note that will hide the owner but not the value or storage slot, since the note will be\n    /// later completed in public. This is a powerful technique for scenarios in which the value cannot be known in\n    /// private (e.g. because it depends on some public state, such as a DEX).\n    ///\n    /// This function inserts a partial note validity commitment into the nullifier tree to be later on able to verify\n    /// that the partial note and completer are legitimate. See function docs of `compute_validity_commitment` for more\n    /// details.\n    ///\n    /// Each partial note should only be used once, since otherwise multiple notes would be linked together and known\n    /// to belong to the same owner.\n    ///\n    /// As part of the partial note creation process, a log will be sent to `recipient` so that they can discover the\n    /// note. `recipient` will typically be the same as `owner`.\n    pub fn partial(\n        owner: AztecAddress,\n        context: &mut PrivateContext,\n        recipient: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialUintNote {\n        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing, so\n        // a malicious sender could use non-random values to make the note less private. But they already know the full\n        // note pre-image anyway, and so the recipient already trusts them to not disclose this information. We can\n        // therefore assume that the sender will cooperate in the random value generation.\n        let randomness = unsafe { random() };\n\n        // We create a commitment to the private data, which we then use to construct the log we send to the recipient.\n        let commitment = compute_partial_commitment(owner, randomness);\n\n        // Our partial note log encoding scheme includes a field with the tag of the public completion log, and we use\n        // the commitment as the tag. This is good for multiple reasons:\n        //  - the commitment is uniquely tied to this partial note\n        //  - the commitment is already public information, so we're not revealing anything else\n        //  - we don't need to create any additional information, private or public, for the tag\n        //  - other contracts cannot impersonate us and emit logs with the same tag due to public log siloing\n        let private_log_content = UintPartialNotePrivateLogContent {};\n\n        do_private_message_delivery(\n            context,\n            || encode_partial_note_private_message(private_log_content, owner, randomness, commitment),\n            Option::none(),\n            recipient,\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        let partial_note = PartialUintNote { commitment };\n\n        // Now we compute the validity commitment and push it to the nullifier tree. It can be safely pushed to the\n        // nullifier tree since it uses its own separator, making collisions with actual note nullifiers practically\n        // impossible.\n        let validity_commitment = partial_note.compute_validity_commitment(completer);\n        context.push_nullifier(validity_commitment);\n\n        partial_note\n    }\n}\n\n/// Computes a commitment to the private content of a partial UintNote, i.e. the fields that will remain private. All\n/// other note fields will be made public.\n// docs:start:compute_partial_commitment\nfn compute_partial_commitment(owner: AztecAddress, randomness: Field) -> Field {\n    poseidon2_hash_with_separator([owner.to_field(), randomness], DOM_SEP__NOTE_HASH)\n}\n// docs:end:compute_partial_commitment\n\n#[derive(Packable)]\n// This note does not have any non-metadata (i.e. storage slot, owner, randomness) private content, as the only field\n// (value) will be public in the partial note.\nstruct UintPartialNotePrivateLogContent {}\n\nimpl NoteType for UintPartialNotePrivateLogContent {\n    fn get_id() -> Field {\n        UintNote::get_id()\n    }\n}\n\n/// A partial instance of a UintNote. This value represents a private commitment to the owner and randomness, but the\n/// storage slot and value fields have not yet been set. A partial note can be completed in public with the `complete`\n/// function (revealing the storage slot and value to the public), resulting in a UintNote that can be used like any\n/// other one (except of course that its value is known).\n// docs:start:partial_uint_note_def\n#[derive(Packable, Serialize, Deserialize, Eq)]\npub struct PartialUintNote {\n    commitment: Field,\n}\n// docs:end:partial_uint_note_def\n\nglobal NOTE_COMPLETION_PAYLOAD_LENGTH: u32 = 2;\n\nimpl PartialUintNote {\n    /// Completes the partial note, creating a new note that can be used like any other UintNote.\n    pub fn complete(self, context: PublicContext, completer: AztecAddress, storage_slot: Field, value: u128) {\n        // A note with a value of zero is valid, but we cannot currently complete a partial note with such a value\n        // because this will result in the completion log having its last field set to 0. Public logs currently do not\n        // track their length, and so trailing zeros are simply trimmed. This results in the completion log missing its\n        // last field (the value), and note discovery failing. TODO(#11636): remove this\n        assert(value != 0, \"Cannot complete a PartialUintNote with a value of 0\");\n\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // Safety: we're using the existence of the nullifier as proof of the contract having validated the partial\n        // note's preimage, which is safe.\n        assert(\n            context.nullifier_exists_unsafe(validity_commitment, context.this_address()),\n            \"Invalid partial note or completer\",\n        );\n\n        // We need to do two things:\n        //  - emit a public log containing the public fields (the storage slot and value). The contract will later find\n        // it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        // only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        // inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        context.emit_public_log_unsafe(log_tag, [storage_slot, value.to_field()]);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, value));\n    }\n\n    /// Completes the partial note, creating a new note that can be used like any other UintNote. Same as `complete`\n    /// function but works from private context.\n    pub fn complete_from_private(\n        self,\n        context: &mut PrivateContext,\n        completer: AztecAddress,\n        storage_slot: Field,\n        value: u128,\n    ) {\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // `assert_nullifier_existed_by` function expects the nullifier to be siloed (hashed with the address of the\n        // contract that emitted the nullifier) as it checks the value directly against the nullifier tree and all the\n        // nullifiers in the tree are siloed by the protocol.\n        let siloed_validity_commitment = compute_siloed_nullifier(context.this_address(), validity_commitment);\n        assert_nullifier_existed_by(\n            context.get_anchor_block_header(),\n            siloed_validity_commitment,\n        );\n\n        // We need to do two things:\n        //  - emit an unencrypted log containing the public fields (the storage slot and value) via the private log\n        // channel. The contract will later find it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        // only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        // inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        let padded_payload = self.compute_note_completion_payload_padded_for_private_log(storage_slot, value);\n        context.emit_private_log_unsafe(log_tag, padded_payload, NOTE_COMPLETION_PAYLOAD_LENGTH);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, value));\n    }\n\n    /// Computes a validity commitment for this partial note. The commitment cryptographically binds the note's private\n    /// data with the designated completer address. When the note is later completed in public execution, we can load\n    /// this commitment from the nullifier tree and verify that both the partial note (e.g. that the storage slot\n    /// corresponds to the correct owner, and that we're using the correct state variable) and completer are\n    /// legitimate.\n    pub fn compute_validity_commitment(self, completer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator(\n            [self.commitment, completer.to_field()],\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        )\n    }\n\n    fn compute_note_completion_payload_padded_for_private_log(\n        _self: Self,\n        storage_slot: Field,\n        value: u128,\n    ) -> [Field; PRIVATE_LOG_CIPHERTEXT_LEN] {\n        let payload = [storage_slot, value.to_field()];\n        payload.concat([0; PRIVATE_LOG_CIPHERTEXT_LEN - NOTE_COMPLETION_PAYLOAD_LENGTH])\n    }\n\n    // docs:start:compute_complete_note_hash\n    fn compute_complete_note_hash(self, storage_slot: Field, value: u128) -> Field {\n        // Here we finalize the note hash by including the (public) storage slot and value into the partial note\n        // commitment. Note that we use the same separator as we used for the first round of poseidon - this is not\n        // an issue.\n        poseidon2_hash_with_separator(\n            [self.commitment, storage_slot, value.to_field()],\n            DOM_SEP__NOTE_HASH,\n        )\n    }\n    // docs:end:compute_complete_note_hash\n}\n\nimpl ToField for PartialUintNote {\n    fn to_field(self) -> Field {\n        self.commitment\n    }\n}\n\nimpl FromField for PartialUintNote {\n    fn from_field(field: Field) -> Self {\n        Self { commitment: field }\n    }\n}\n\nmod test {\n    use super::{compute_partial_commitment, PartialUintNote, UintNote};\n    use aztec::{note::note_interface::NoteHash, protocol::{address::AztecAddress, traits::FromField}};\n\n    global value: u128 = 17;\n    global randomness: Field = 42;\n    global owner: AztecAddress = AztecAddress::from_field(50);\n    global storage_slot: Field = 13;\n\n    #[test]\n    fn note_hash_matches_completed_partial_note_hash() {\n        // Tests that a UintNote has the same note hash as a PartialUintNote created and then completed with the same\n        // private values. This requires for the same hash function to be used in both flows, with the fields in the\n        // same order.\n        let note = UintNote { value };\n        let note_hash = note.compute_note_hash(owner, storage_slot, randomness);\n\n        let partial_note = PartialUintNote { commitment: compute_partial_commitment(owner, randomness) };\n        let completed_partial_note_hash = partial_note.compute_complete_note_hash(storage_slot, value);\n\n        assert_eq(note_hash, completed_partial_note_hash);\n    }\n}\n"
470:      "name": "balance_of"
8444:                    "name": "balances",
8493:                "path": "PrivateFPC::balance_of_parameters"
8506:          "path": "PrivateFPC::balance_of_abi"

 succeeded in 0ms:
77:      "source": "//! The `self` contract value for private execution contexts.\n\nuse crate::{\n    context::{calls::{PrivateCall, PrivateStaticCall, PublicCall, PublicStaticCall}, PrivateContext},\n    event::{event_emission::emit_event_in_private, event_interface::EventInterface, EventMessage},\n};\nuse crate::protocol::{address::AztecAddress, traits::{Deserialize, Serialize}};\n\n/// Core interface for interacting with aztec-nr contract features in private execution contexts.\n///\n/// This struct is automatically injected into every [`external`](crate::macros::functions::external) and\n/// [`internal`](crate::macros::functions::internal) contract function marked with `\"private\"` by the Aztec macro\n/// system and is accessible through the `self` variable.\n///\n/// ## Usage in Contract Functions\n///\n/// Once injected, you can use `self` to:\n/// - Access storage: `self.storage.balances.at(owner).read()`\n/// - Call contracts: `self.call(Token::at(address).transfer(recipient, amount))`\n/// - Emit events: `self.emit(event).deliver_to(recipient, delivery_mode)`\n/// - Get the contract address: `self.address`\n/// - Get the caller: `self.msg_sender()`\n/// - Access low-level Aztec.nr APIs through the context: `self.context`\n///\n/// ## Example\n///\n/// ```noir\n/// #[external(\"private\")]\n/// fn withdraw(amount: u128, recipient: AztecAddress) {\n///     // Get the caller of this function\n///     let sender = self.msg_sender();\n///\n///     // Access storage\n///     let token = self.storage.donation_token.get_note().get_address();\n///\n///     // Call contracts\n///     self.call(Token::at(token).transfer(recipient, amount));\n/// }\n/// ```\n///\n/// ## Type Parameters\n///\n/// - `Storage`: The contract's storage struct (defined with [`storage`](crate::macros::storage::storage), or `()` if\n/// the contract has no storage\n/// - `CallSelf`: Macro-generated type for calling contract's own non-view functions\n/// - `EnqueueSelf`: Macro-generated type for enqueuing calls to the contract's own non-view functions\n/// - `CallSelfStatic`: Macro-generated type for calling contract's own view functions\n/// - `EnqueueSelfStatic`: Macro-generated type for enqueuing calls to the contract's own view functions\n/// - `CallInternal`: Macro-generated type for calling internal functions\npub struct ContractSelfPrivate<Storage, CallSelf, EnqueueSelf, CallSelfStatic, EnqueueSelfStatic, CallInternal> {\n    /// The address of this contract\n    pub address: AztecAddress,\n\n    /// The contract's storage instance, representing the struct to which the\n    /// [`storage`](crate::macros::storage::storage) macro was applied in your contract. If the contract has no\n    /// storage, the type of this will be `()`.\n    ///\n    /// This storage instance is specialized for the current execution context (private) and\n    /// provides access to the contract's state variables.\n    ///\n    /// ## Developer Note\n    ///\n    /// If you've arrived here while trying to access your contract's storage while the `Storage` generic type is set\n    /// to unit type `()`, it means you haven't yet defined a Storage struct using the\n    /// [`storage`](crate::macros::storage::storage) macro in your contract. For guidance on setting this up, please\n    /// refer to our docs: https://docs.aztec.network/developers/docs/guides/smart_contracts/storage\n    pub storage: Storage,\n\n    /// The private execution context.\n    pub context: &mut PrivateContext,\n\n    /// Provides type-safe methods for calling this contract's own non-view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.call_self.some_private_function(args)\n    /// ```\n    pub call_self: CallSelf,\n\n    /// Provides type-safe methods for enqueuing calls to this contract's own non-view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.enqueue_self.some_public_function(args)\n    /// ```\n    pub enqueue_self: EnqueueSelf,\n\n    /// Provides type-safe methods for calling this contract's own view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.call_self_static.some_view_function(args)\n    /// ```\n    pub call_self_static: CallSelfStatic,\n\n    /// Provides type-safe methods for enqueuing calls to the contract's own view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.enqueue_self_static.some_public_view_function(args)\n    /// ```\n    pub enqueue_self_static: EnqueueSelfStatic,\n\n    /// Provides type-safe methods for calling internal functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.internal.some_internal_function(args)\n    /// ```\n    pub internal: CallInternal,\n}\n\nimpl<Storage, CallSelf, EnqueueSelf, CallSelfStatic, EnqueueSelfStatic, CallInternal> ContractSelfPrivate<Storage, CallSelf, EnqueueSelf, CallSelfStatic, EnqueueSelfStatic, CallInternal> {\n    /// Creates a new `ContractSelfPrivate` instance for a private function.\n    ///\n    /// This constructor is called automatically by the macro system and should not be called directly.\n    pub fn new(\n        context: &mut PrivateContext,\n        storage: Storage,\n        call_self: CallSelf,\n        enqueue_self: EnqueueSelf,\n        call_self_static: CallSelfStatic,\n        enqueue_self_static: EnqueueSelfStatic,\n        internal: CallInternal,\n    ) -> Self {\n        Self {\n            context,\n            storage,\n            address: context.this_address(),\n            call_self,\n            enqueue_self,\n            call_self_static,\n            enqueue_self_static,\n            internal,\n        }\n    }\n\n    /// The address of the contract address that made this function call.\n    ///\n    /// This is similar to Solidity's `msg.sender` value.\n    ///\n    /// ## Transaction Entrypoints\n    ///\n    /// As there are no EOAs (externally owned accounts) in Aztec, unlike on Ethereum, the first contract function\n    /// executed in a transaction (i.e. transaction entrypoint) does **not** have a caller. This function panics when\n    /// executed in such a context.\n    ///\n    /// If you need to handle these cases, use [`PrivateContext::maybe_msg_sender`].\n    pub fn msg_sender(self) -> AztecAddress {\n        self.context.maybe_msg_sender().unwrap()\n    }\n\n    /// Emits an event privately.\n    ///\n    /// Unlike public events, private events do not reveal their contents publicly. They instead create an\n    /// [`EventMessage`] containing the private event information, which **MUST** be delivered to a recipient via\n    /// [`EventMessage::deliver_to`] in order for them to learn about the event. Multiple recipients can have the same\n    /// message be delivered to them.\n    ///\n    /// # Example\n    /// ```noir\n    /// #[event]\n    /// struct Transfer { from: AztecAddress, to: AztecAddress, amount: u128 }\n    ///\n    /// #[external(\"private\")]\n    /// fn transfer(to: AztecAddress, amount: u128) {\n    ///     let from = self.msg_sender();\n    ///\n    ///     let message: EventMessage = self.emit(Transfer { from, to, amount });\n    ///     message.deliver_to(from, MessageDelivery.OFFCHAIN);\n    ///     message.deliver_to(to, MessageDelivery.ONCHAIN_CONSTRAINED);\n    /// }\n    /// ```\n    ///\n    /// # Cost\n    ///\n    /// Private event emission always results in the creation of a nullifer, which acts as a commitment to the event\n    /// and is used by third parties to verify its authenticity. See [`EventMessage::deliver_to`] for the costs\n    /// associated to delivery.\n    ///\n    /// # Privacy\n    ///\n    /// The nullifier created when emitting a private event leaks nothing about the content of the event - it's a\n    /// commitment that includes a random value, so even with full knowledge of the event preimage determining if an\n    /// event was emitted or not requires brute-forcing the entire `Field` space.\n    pub fn emit<Event>(&mut self, event: Event) -> EventMessage<Event>\n    where\n        Event: EventInterface + Serialize,\n    {\n        emit_event_in_private(self.context, event)\n    }\n\n    /// Makes a private contract call.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the private function to invoke.\n    ///\n    /// # Returns\n    /// * `T` - Whatever data the called function has returned.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.call(Token::at(address).transfer_in_private(recipient, amount));\n    /// ```\n    ///\n    /// This enables contracts to interact with each other while maintaining privacy. This \"composability\" of private\n    /// contract functions is a key feature of the Aztec network.\n    ///\n    /// If a user's transaction includes multiple private function calls, then by the design of Aztec, the following\n    /// information will remain private[1]:\n    /// - The function selectors and contract addresses of all private function calls will remain private, so an\n    /// observer of the public mempool will not be able to look at a tx and deduce which private functions have been\n    /// executed.\n    /// - The arguments and return values of all private function calls will remain private.\n    /// - The person who initiated the tx will remain private.\n    /// - The notes and nullifiers and private logs that are emitted by all private function calls will (if designed\n    /// well) not leak any user secrets, nor leak which functions have been executed.\n    ///\n    /// [1] Caveats: Some of these privacy guarantees depend on how app developers design their smart contracts. Some\n    /// actions _can_ leak information, such as:\n    /// - Calling an internal public function.\n    /// - Calling a public function and not setting msg_sender to Option::none (see\n    /// https://github.com/AztecProtocol/aztec-packages/pull/16433)\n    /// - Calling any public function will always leak details about the nature of the transaction, so devs should be\n    /// careful in their contract designs. If it can be done in a private function, then that will give the best\n    /// privacy.\n    /// - Not padding the side-effects of a tx to some standardized, uniform size. The kernel circuits can take hints\n    /// to pad side-effects, so a wallet should be able to request for a particular amount of padding. Wallets should\n    /// ideally agree on some standard.\n    /// - Padding should include:\n    /// - Padding the lengths of note & nullifier arrays\n    /// - Padding private logs with random fields, up to some standardized size. See also:\n    /// https://docs.aztec.network/developers/resources/considerations/privacy_considerations\n    ///\n    /// # Advanced\n    /// * The call is added to the private call stack and executed by kernel circuits after this function completes\n    /// * The called function can modify its own contract's private state\n    /// * Side effects from the called function are included in this transaction\n    /// * The call inherits the current transaction's context and gas limits\n    ///\n    pub fn call<let M: u32, let N: u32, T>(&mut self, call: PrivateCall<M, N, T>) -> T\n    where\n        T: Deserialize,\n    {\n        call.call(self.context)\n    }\n\n    /// Makes a read-only private contract call.\n    ///\n    /// This is similar to Solidity's `staticcall`. The called function cannot modify state, emit L2->L1 messages, nor\n    /// emit events. Any nested calls are constrained to also be static calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only private function to invoke.\n    ///\n    /// # Returns\n    /// * `T` - Whatever data the called function has returned.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.view(Token::at(address).balance_of_private(recipient));\n    /// ```\n    pub fn view<let M: u32, let N: u32, T>(&mut self, call: PrivateStaticCall<M, N, T>) -> T\n    where\n        T: Deserialize,\n    {\n        call.view(self.context)\n    }\n\n    /// Enqueues a public contract call function.\n    ///\n    /// Unlike private functions which execute immediately on the user's device, public function calls are \"enqueued\"\n    /// and executed some time later by a block proposer.\n    ///\n    /// This means a public function cannot return any values back to a private function, because by the time the\n    /// public function is being executed, the private function which called it has already completed execution. (In\n    /// fact, the private function has been executed and proven, along with all other private function calls of the\n    /// user's tx. A single proof of the tx has been submitted to the Aztec network, and some time later a proposer has\n    /// picked the tx up from the mempool and begun executing all of the enqueued public functions).\n    ///\n    /// # Privacy warning Enqueueing a public function call is an inherently leaky action. Many interesting applications will require some interaction with public state, but smart contract developers should try to use public function calls sparingly, and carefully. _Internal_ public function calls are especially leaky, because they completely leak which private contract made the call. See also: https://docs.aztec.network/developers/resources/considerations/privacy_considerations\n    ///\n    /// # Arguments\n    /// * `call` - The interface representing the public function to enqueue.\n    pub fn enqueue<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.enqueue(self.context)\n    }\n\n    /// Enqueues a read-only public contract call function.\n    ///\n    /// This is similar to Solidity's `staticcall`. The called function cannot modify state, emit L2->L1 messages, nor\n    /// emit events. Any nested calls are constrained to also be static calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only public function to enqueue.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.enqueue_view(MyContract::at(address).assert_timestamp_less_than(timestamp));\n    /// ```\n    pub fn enqueue_view<let M: u32, let N: u32, T>(&mut self, call: PublicStaticCall<M, N, T>) {\n        call.enqueue_view(self.context)\n    }\n\n    /// Enqueues a privacy-preserving public contract call function.\n    ///\n    /// This is the same as [`ContractSelfPrivate::enqueue`], except it hides this calling contract's address from the\n    /// target public function (i.e. [`ContractSelfPrivate::msg_sender`] will panic).\n    ///\n    /// This means the origin of the call (msg_sender) will not be publicly visible to any blockchain observers, nor to\n    /// the target public function. If the target public function reads `self.msg_sender()` the call will revert.\n    ///\n    /// NOTES:\n    /// - Not all public functions will accept a msg_sender of \"none\". Many public functions will require that\n    /// msg_sender is \"some\" and will revert otherwise. Therefore, if using `enqueue_incognito`, you must understand\n    /// whether the function you're calling will accept a msg_sender of \"none\". Lots of public bookkeeping patterns\n    /// rely on knowing which address made the call, so as to ascribe state against the caller's address. (There are\n    /// patterns whereby bookkeeping could instead be done in private-land).\n    /// - If you are enqueueing a call to an _internal_ public function (i.e. a public function that will only accept\n    /// calls from other functions of its own contract), then by definition a call to it cannot possibly be\n    /// \"incognito\": the msg_sender must be its own address, and indeed the called public function will assert this.\n    /// Tl;dr this is not usable for enqueued internal public calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the public function to enqueue.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.enqueue_incognito(Token::at(address).increase_total_supply_by(amount));\n    /// ```\n    ///\n    /// Advanced:\n    /// - The kernel circuits will permit _any_ private function to set the msg_sender field of any enqueued public\n    /// function call to NULL_MSG_SENDER_CONTRACT_ADDRESS.\n    /// - When the called public function calls `PublicContext::msg_sender()`, aztec-nr will translate\n    /// NULL_MSG_SENDER_CONTRACT_ADDRESS into `Option<AztecAddress>::none` for familiarity to devs.\n    ///\n    pub fn enqueue_incognito<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.enqueue_incognito(self.context)\n    }\n\n    /// Enqueues a privacy-preserving read-only public contract call function.\n    ///\n    /// As per `enqueue_view`, but hides this calling contract's address from the target public function.\n    ///\n    /// See `enqueue_incognito` for more details relating to hiding msg_sender.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only public function to enqueue.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.enqueue_view_incognito(MyContract::at(address).assert_timestamp_less_than(timestamp));\n    /// ```\n    ///\n    pub fn enqueue_view_incognito<let M: u32, let N: u32, T>(&mut self, call: PublicStaticCall<M, N, T>) {\n        call.enqueue_view_incognito(self.context)\n    }\n\n    /// Enqueues a call to the public function defined by the `call` parameter, and designates it to be the teardown\n    /// function for this tx. Only one teardown function call can be made by a tx.\n    ///\n    /// Niche function: Only wallet developers and paymaster contract developers (aka Fee-payment contracts) will need\n    /// to make use of this function.\n    ///\n    /// Aztec supports a three-phase execution model: setup, app logic, teardown. The phases exist to enable a fee\n    /// payer to take on the risk of paying a transaction fee, safe in the knowledge that their payment (in whatever\n    /// token or method the user chooses) will succeed, regardless of whether the app logic will succeed. The \"setup\"\n    /// phase ensures the fee payer has sufficient balance to pay the proposer their fees. The teardown phase is\n    /// primarily intended to: calculate exactly how much the user owes, based on gas consumption, and refund the user\n    /// any change.\n    ///\n    /// Note: in some cases, the cost of refunding the user (i.e. DA costs of tx side-effects) might exceed the refund\n    /// amount. For app logic with fairly stable and predictable gas consumption, a material refund amount is unlikely.\n    /// For app logic with unpredictable gas consumption, a refund might be important to the user (e.g. if a hefty\n    /// function reverts very early). Wallet/FPC/Paymaster developers should be mindful of this.\n    ///\n    /// See `enqueue` for more information about enqueuing public function calls.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the public function to designate as teardown.\n    ///\n    pub fn set_as_teardown<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.set_as_teardown(self.context)\n    }\n\n    /// Enqueues a call to the public function defined by the `call` parameter, and designates it to be the teardown\n    /// function for this tx. Only one teardown function call can be made by a tx.\n    ///\n    /// As per `set_as_teardown`, but hides this calling contract's address from the target public function.\n    ///\n    /// See `enqueue_incognito` for more details relating to hiding msg_sender.\n    ///\n    pub fn set_as_teardown_incognito<let M: u32, let N: u32, T>(&mut self, call: PublicCall<M, N, T>) {\n        call.set_as_teardown_incognito(self.context)\n    }\n}\n"
81:      "source": "//! The `self` contract value for public execution contexts.\n\nuse crate::{\n    context::{calls::{PublicCall, PublicStaticCall}, PublicContext},\n    event::{event_emission::emit_event_in_public, event_interface::EventInterface},\n};\nuse crate::protocol::{address::AztecAddress, traits::{Deserialize, Serialize}};\n\n/// Core interface for interacting with aztec-nr contract features in public execution contexts.\n///\n/// This struct is automatically injected into every [`external`](crate::macros::functions::external) and\n/// [`internal`](crate::macros::functions::internal) contract function marked with `\"public\"` by the Aztec macro\n/// system and is accessible through the `self` variable.\n///\n/// ## Type Parameters\n///\n/// - `Storage`: The contract's storage struct (defined with [`storage`](crate::macros::storage::storage), or `()` if\n/// the contract has no storage\n/// - `CallSelf`: Macro-generated type for calling contract's own non-view functions\n/// - `CallSelfStatic`: Macro-generated type for calling contract's own view functions\n/// - `CallInternal`: Macro-generated type for calling internal functions\npub struct ContractSelfPublic<Storage, CallSelf, CallSelfStatic, CallInternal> {\n    /// The address of this contract\n    pub address: AztecAddress,\n\n    /// The contract's storage instance, representing the struct to which the\n    /// [`storage`](crate::macros::storage::storage) macro was applied in your contract. If the contract has no\n    /// storage, the type of this will be `()`.\n    ///\n    /// This storage instance is specialized for the current execution context (public) and\n    /// provides access to the contract's state variables.\n    ///\n    /// ## Developer Note\n    ///\n    /// If you've arrived here while trying to access your contract's storage while the `Storage` generic type is set\n    /// to unit type `()`, it means you haven't yet defined a Storage struct using the\n    /// [`storage`](crate::macros::storage::storage) macro in your contract. For guidance on setting this up, please\n    /// refer to our docs: https://docs.aztec.network/developers/docs/guides/smart_contracts/storage\n    pub storage: Storage,\n\n    /// The public execution context.\n    pub context: PublicContext,\n\n    /// Provides type-safe methods for calling this contract's own non-view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.call_self.some_public_function(args)\n    /// ```\n    pub call_self: CallSelf,\n\n    /// Provides type-safe methods for calling this contract's own view functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.call_self_static.some_view_function(args)\n    /// ```\n    pub call_self_static: CallSelfStatic,\n\n    /// Provides type-safe methods for calling internal functions.\n    ///\n    /// Example API:\n    /// ```noir\n    /// self.internal.some_internal_function(args)\n    /// ```\n    pub internal: CallInternal,\n}\n\nimpl<Storage, CallSelf, CallSelfStatic, CallInternal> ContractSelfPublic<Storage, CallSelf, CallSelfStatic, CallInternal> {\n    /// Creates a new `ContractSelfPublic` instance for a public function.\n    ///\n    /// This constructor is called automatically by the macro system and should not be called directly.\n    pub fn new(\n        context: PublicContext,\n        storage: Storage,\n        call_self: CallSelf,\n        call_self_static: CallSelfStatic,\n        internal: CallInternal,\n    ) -> Self {\n        Self { context, storage, address: context.this_address(), call_self, call_self_static, internal }\n    }\n\n    /// The address of the contract address that made this function call.\n    ///\n    /// This is similar to Solidity's `msg.sender` value.\n    ///\n    /// ## Incognito Calls\n    ///\n    /// Contracts can call public functions from private ones hiding their identity (see\n    ///\n    /// [`ContractSelfPrivate::enqueue_incognito`](crate::contract_self::ContractSelfPrivate::enqueue_incognito)).\n    /// This function reverts when executed in such a context.\n    ///\n    /// If you need to handle these cases, use [`PublicContext::maybe_msg_sender`].\n    pub fn msg_sender(self: Self) -> AztecAddress {\n        self.context.maybe_msg_sender().unwrap()\n    }\n\n    /// Emits an event publicly.\n    ///\n    /// Public events are emitted as plaintext and are therefore visible to everyone. This is is the same as Solidity\n    /// events on EVM chains.\n    ///\n    /// Unlike private events, they don't require delivery of an event message.\n    ///\n    /// # Example\n    /// ```noir\n    /// #[event]\n    /// struct Update { value: Field }\n    ///\n    /// #[external(\"public\")]\n    /// fn publish_update(value: Field) {\n    ///     self.emit(Update { value });\n    /// }\n    /// ```\n    ///\n    /// # Cost\n    ///\n    /// Public event emission is achieved by emitting public transaction logs. A total of `N+1` fields are emitted,\n    /// where `N` is the serialization length of the event.\n    pub fn emit<Event>(&mut self, event: Event)\n    where\n        Event: EventInterface + Serialize,\n    {\n        emit_event_in_public(self.context, event);\n    }\n\n    /// Makes a public contract call.\n    ///\n    /// Will revert if the called function reverts or runs out of gas.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the public function to invoke.\n    ///\n    /// # Returns\n    /// * `T` - Whatever data the called function has returned.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.call(Token::at(address).transfer_in_public(recipient, amount));\n    /// ```\n    ///\n    pub unconstrained fn call<let M: u32, let N: u32, T>(self, call: PublicCall<M, N, T>) -> T\n    where\n        T: Deserialize,\n    {\n        call.call(self.context)\n    }\n\n    /// Makes a public read-only contract call.\n    ///\n    /// This is similar to Solidity's `staticcall`. The called function cannot modify state or emit events. Any nested\n    /// calls are constrained to also be static calls.\n    ///\n    /// Will revert if the called function reverts or runs out of gas.\n    ///\n    /// # Arguments\n    /// * `call` - The object representing the read-only public function to invoke.\n    ///\n    /// # Returns\n    /// * `T` - Whatever data the called function has returned.\n    ///\n    /// # Example\n    /// ```noir\n    /// self.view(Token::at(address).balance_of_public(recipient));\n    /// ```\n    ///\n    pub unconstrained fn view<let M: u32, let N: u32, T>(self, call: PublicStaticCall<M, N, T>) -> T\n    where\n        T: Deserialize,\n    {\n        call.view(self.context)\n    }\n}\n"
333:      "source": "use crate::protocol::{storage::map::derive_storage_slot_in_map, traits::ToField};\nuse crate::state_vars::StateVariable;\n\n/// A key-value container for state variables.\n///\n/// A key-value storage container that maps keys to state variables, similar to Solidity mappings.\n///\n/// `Map` enables you to associate keys (like addresses or other identifiers) with state variables in your Aztec smart\n/// contract. This is conceptually similar to Solidity's `mapping(K => V)` syntax, where you can store and retrieve\n/// values by their associated keys.\n///\n/// You can declare a state variable contained within a Map in your contract's\n/// [`storage`](crate::macros::storage::storage) struct.\n///\n/// For example, you might use `Map<AztecAddress, PublicMutable<FieldNote, Context>, Context>` to track token balances\n/// for different users, similar to how you'd use `mapping(address => uint256)` in Solidity.\n///\n/// > Aside: the verbose `Context` in the declaration is a consequence of > leveraging Noir's regular syntax for\n/// generics to ensure that certain > state variable methods can only be called in some contexts (private, > public,\n/// utility).\n///\n/// The methods of Map are:\n/// - `at` (access state variable for a given key) (see the method's own doc comments for more info).\n///\n/// ## Generic Parameters\n/// - `K`: The key type (must implement `ToField` trait for hashing)\n/// - `V`: The value type:\n/// - any Aztec state variable (variable that implements the StateVariable trait):\n/// - `PublicMutable`\n/// - `PublicImmutable`\n/// - `DelayedPublicMutable`\n/// - `Map`\n/// - `Context`: The execution context (handles private/public function contexts)\n///\n/// ## Usage Maps are typically declared in your contract's [`storage`](crate::macros::storage::storage) struct and accessed using the `at(key)` method to get the state variable for a specific key. The resulting state variable can then be read from or written to using its own methods.\n///\n/// Note that maps cannot be used with owned state variables (variables that implement the OwnedStateVariable trait) -\n/// those need to be wrapped in an `Owned` state variable instead.\n///\n/// ## Advanced Internally, `Map` uses a single base storage slot to represent the mapping itself, similar to Solidity's approach. Individual key-value pairs are stored at derived storage slots computed by hashing the base storage slot with the key using Poseidon2. This ensures:\n/// - No storage slot collisions between different keys\n/// - Uniform distribution of storage slots across the storage space\n/// - Compatibility with Aztec's storage tree structure\n/// - Gas-efficient storage access patterns similar to Solidity mappings\n///\n/// The storage slot derivation uses `derive_storage_slot_in_map(base_slot, key)` which computes\n/// `poseidon2_hash([base_slot, key.to_field()])`, ensuring cryptographically secure slot separation.\n///\n/// docs:start:map\npub struct Map<K, V, Context> {\n    pub context: Context,\n    storage_slot: Field,\n}\n\n// Map reserves a single storage slot regardless of what it stores because nothing is stored at said slot: it is only\n// used to derive the storage slots of nested state variables, which is expected to never result in collisions or slots\n// being close to one another due to these being hashes. This mirrors the strategy adopted by Solidity mappings.\nimpl<K, V, Context> StateVariable<1, Context> for Map<K, V, Context> {\n    fn new(context: Context, storage_slot: Field) -> Self {\n        assert(storage_slot != 0, \"Storage slot 0 not allowed. Storage slots must start from 1.\");\n        Map { context, storage_slot }\n    }\n\n    fn get_storage_slot(self) -> Field {\n        self.storage_slot\n    }\n}\n\nimpl<K, V, Context> Map<K, V, Context> {\n    /// Returns the state variable associated with the given key.\n    ///\n    /// This is equivalent to accessing `mapping[`key`]` in Solidity. It returns the state variable instance for the\n    /// specified key, which can then be used to read or write the value at that key.\n    ///\n    /// Unlike Solidity mappings which return the value directly, this returns the state variable wrapper (like\n    /// PublicMutable, nested Map etc.) that you then call methods on to interact with the actual value.\n    ///\n    /// # Arguments\n    ///\n    /// * `key` - The key to look up in the map. Must implement the ToField trait (which most basic Noir & Aztec types\n    /// do).\n    ///\n    /// # Returns\n    ///\n    /// * `V` - The state variable instance for this key. You can then call methods like `.read()`, `.write()`,\n    /// `.get_note()`, etc. on this depending on the specific state variable type.\n    ///\n    /// # Example\n    ///\n    /// ```noir\n    /// // Get a user's balance (assuming PrivateMutable<FieldNote>)\n    /// let user_balance = self.storage.balances.at(user_address);\n    /// let current_note = user_balance.get_note();\n    ///\n    /// // Update the balance\n    /// user_balance.replace(new_note);\n    /// ```\n    ///\n    pub fn at<let N: u32>(self, key: K) -> V\n    where\n        K: ToField,\n        V: StateVariable<N, Context>,\n    {\n        V::new(\n            self.context,\n            derive_storage_slot_in_map(self.storage_slot, key),\n        )\n    }\n}\n"
345:      "source": "use crate::context::{PublicContext, UtilityContext};\nuse crate::protocol::traits::Packable;\nuse crate::state_vars::StateVariable;\n\nmod test;\n\n/// Mutable public values.\n///\n/// This is one of the most basic public state variables. It is equivalent to a non-`immutable` non-`constant` Solidity\n/// state variable.\n///\n/// It represents a public value of type `T` that can be written to repeatedly over the lifetime of the contract,\n/// allowing the last value that was written to be read.\n///\n/// ## Access Patterns\n///\n/// A value stored in a `PublicMutable` can be read and written from public contract functions.\n///\n/// It is not possible to read or write a `PublicMutable` from private contract functions. A common pattern is to have\n/// these functions [enqueue a public self\n/// calls](crate::contract_self::ContractSelfPrivate::enqueue) in which the\n/// required operation is performed.\n///\n/// For an immutable variant which can be read from private functions, see\n/// [`PublicImmutable`](crate::state_vars::PublicImmutable).\n///\n/// For a mutable (with restrictions) variant which can be read from private functions see\n/// [`DelayedPublicMutable`](crate::state_vars::DelayedPublicMutable).\n///\n/// ## Privacy\n///\n/// `PublicMutable` provides zero privacy. All write and read operations are public: the entire network can see these\n/// accesses and the data involved.\n///\n/// ## Use Cases\n///\n/// This is suitable for any kind of global state that needs to be accessible by everyone. For example, a token may\n/// have a public total supply, or a voting contract may have public vote tallies.\n///\n/// Note that contracts having public values does not necessarily mean the actions that update these values must\n/// themselves be wholly public. For example, the token could allow for private minting and burning, and casting a vote\n/// could be kept private: these private functions would enqueue a public function that writes to the `PublicMutable`.\n///\n/// Similarly, private functions can enqueue a public call in which the `PublicMutable` is checked to meet some\n/// condition. For example, a private action might be executable only if the vote count has exceeded some threshold, in\n/// which case the private function would enqueue a public function that reads from the `PublicMutable`.\n///\n/// Such patterns preserve the privacy of the account that executed the action, as well as details related to the\n/// private execution itself, but they _do_ reveal that the transaction interacted with the `PublicMutable` value (and\n/// hence that the contract was called), as all accesses to it are public. The\n/// [`only_self`](crate::macros::functions::only_self) attribute is very useful when implementing this.\n///\n/// ## Examples\n///\n/// Declaring a `PublicMutable` in the contract's [`storage`](crate::macros::storage::storage) struct requires\n/// specifying the type `T` that is stored in the variable:\n///\n/// ```noir\n/// #[storage]\n/// struct Storage<C> {\n///     total_supply: PublicMutable<u128, C>,\n///     public_balances: Map<AztecAddress, PublicMutable<u128, C>, C>,\n///\n///     vote_tallies: Map<ElectionId, PublicMutable<u128, C>, C>,\n/// }\n/// ```\n///\n/// ## Requirements\n///\n/// The type `T` stored in the `PublicMutable` must implement the [`Packable`](crate::protocol::traits::Packable)\n/// trait.\n///\n/// ## Implementation Details\n///\n/// Values are packed and stored directly in the public storage tree, with no overhead. A `PublicMutable` therefore\n/// takes up as many storage slots as the packing length of the stored type `T`.\n///\n/// Private reads are not possible because private functions do not have access to the current network state, only the\n/// _past_ state at the anchor block. They _can_ perform historical reads of `PublicMutable` values at past times, but\n/// they have no way to guarantee that the value has not changed since then.\n/// [`PublicImmutable`](crate::state_vars::PublicImmutable) and\n/// [`DelayedPublicMutable`](crate::state_vars::DelayedPublicMutable) are examples of public state variables that _can_\n/// be read privately by restricting mutation.\npub struct PublicMutable<T, Context> {\n    context: Context,\n    storage_slot: Field,\n}\n\nimpl<T, Context, let M: u32> StateVariable<M, Context> for PublicMutable<T, Context>\nwhere\n    T: Packable<N = M>,\n{\n    fn new(context: Context, storage_slot: Field) -> Self {\n        assert(storage_slot != 0, \"Storage slot 0 not allowed. Storage slots must start from 1.\");\n        PublicMutable { context, storage_slot }\n    }\n\n    fn get_storage_slot(self) -> Field {\n        self.storage_slot\n    }\n}\n\nimpl<T> PublicMutable<T, PublicContext> {\n    /// Returns the current value.\n    ///\n    /// If [`write`](PublicMutable::write) has never been called, then this returns the default empty public storage\n    /// value, which is all zeroes - equivalent to `let t = T::unpack(std::mem::zeroed());`.\n    ///\n    /// It is not possible to detect if a `PublicMutable` has ever been initialized or not other than by testing for\n    /// the zero sentinel value. For a more robust solution, store an `Option<T>` in the `PublicMutable`.\n    ///\n    /// ## Examples\n    ///\n    /// A public getter that returns the current value:\n    /// ```noir\n    /// #[external(\"public\")]\n    /// fn get_total_supply() -> u128 {\n    ///     self.storage.total_supply.read()\n    /// }\n    /// ```\n    ///\n    /// An [`only_self`](crate::macros::functions::only_self) helper that asserts a condition a private function\n    /// requires:\n    /// ```noir\n    /// #[external(\"private\")]\n    /// fn execute_proposal(election_id: ElectionId) {\n    ///     self.enqueue_self._assert_vote_passed(election_id);\n    ///\n    ///     // execute the proposal - this remains private\n    /// }\n    ///\n    /// #[external(\"public\")]\n    /// #[only_self]\n    /// fn _assert_vote_passed(election_id: ElectionId) {\n    ///     assert(self.storage.vote_tallies.at(election_id).read() >= VOTE_PASSED_THRESHOLD);\n    /// }\n    /// ```\n    ///\n    /// ## Cost\n    ///\n    /// The `SLOAD` AVM opcode is invoked a number of times equal to `T`'s packed length.\n    pub fn read(self) -> T\n    where\n        T: Packable,\n    {\n        self.context.storage_read(self.storage_slot)\n    }\n\n    /// Stores a new value.\n    ///\n    /// The old value is overridden and cannot be recovered. The new value can be immediately retrieved by\n    /// [`read`](PublicMutable::read).\n    ///\n    /// ## Examples\n    ///\n    /// A public setter that updates the current value:\n    /// ```noir\n    /// #[external(\"public\")]\n    /// fn mint_tokens(recipient: AztecAddress, amount: u128) {\n    ///     let current_recipient_balance = self.storage.public_balances.at(recipient).read();\n    ///     self.storage.public_balances.at(recipient).write(current_recipient_balance + amount);\n    ///\n    ///     let current_supply = self.storage.total_supply.read();\n    ///     self.storage.total_supply.write(current_supply + amount);\n    /// }\n    /// ```\n    ///\n    /// An [`only_self`](crate::macros::functions::only_self) helper that updates public state triggered by a private\n    /// function:\n    /// ```noir\n    /// #[external(\"private\")]\n    /// fn vote_for_proposal(election_id: ElectionId, votes: u128) {\n    ///     // validate the sender can cast this many votes - this remains private\n    ///\n    ///     self.enqueue_self._tally_vote(election_id, votes);\n    /// }\n    ///\n    /// #[external(\"public\")]\n    /// #[only_self]\n    /// fn _tally_vote(election_id: ElectionId, votes: u128) {\n    ///     let current = self.storage.vote_tallies.at(election_id).read();\n    ///     self.storage.vote_tallies.at(election_id).write(current + votes);\n    /// }\n    /// ```\n    ///\n    /// ## Cost\n    ///\n    /// The `SSTORE` AVM opcode is invoked a number of times equal to `T`'s packed length.\n    pub fn write(self, value: T)\n    where\n        T: Packable,\n    {\n        self.context.storage_write(self.storage_slot, value);\n    }\n}\n\nimpl<T> PublicMutable<T, UtilityContext> {\n    /// Returns the value at the anchor block.\n    ///\n    /// If [`write`](PublicMutable::write) has never been called, then this returns the default empty public storage\n    /// value, which is all zeroes - equivalent to `let t = T::unpack(std::mem::zeroed());`.\n    ///\n    /// It is not possible to detect if a `PublicMutable` has ever been initialized or not other than by testing for\n    /// the zero sentinel value. For a more robust solution, store an `Option<T>` in the `PublicMutable`.\n    ///\n    /// ## Examples\n    ///\n    /// ```noir\n    /// #[external(\"utility\")]\n    /// fn get_total_supply() -> u128 {\n    ///     self.storage.total_supply.read()\n    /// }\n    /// ```\n    pub unconstrained fn read(self) -> T\n    where\n        T: Packable,\n    {\n        self.context.storage_read(self.storage_slot)\n    }\n}\n"
501:      "source": "pub mod types;\npub mod test;\n\nuse aztec::macros::aztec;\n\n#[aztec]\npub contract NFT {\n    // aztec library\n    use aztec::{\n        authwit::auth::{\n            assert_current_call_valid_authwit, assert_current_call_valid_authwit_public,\n        },\n        context::PrivateContext,\n        macros::{\n            events::event,\n            functions::{external, initializer, internal, only_self, view},\n            storage::storage,\n        },\n        messages::message_delivery::MessageDelivery,\n        note::{\n            constants::MAX_NOTES_PER_PAGE, note_getter_options::NoteGetterOptions,\n            note_interface::NoteProperties, note_viewer_options::NoteViewerOptions,\n        },\n        protocol::{address::AztecAddress, traits::{FromField, ToField}},\n        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable, StateVariable},\n        utils::comparison::Comparator,\n    };\n    // compression library\n    use compressed_string::FieldCompressedString;\n    // nft note structs\n    use crate::types::nft_note::{NFTNote, PartialNFTNote};\n\n    /// @param symbol The symbol of the NFT\n    /// @param name The name of the NFT\n    /// @param private_nfts A map from address to a private set of NFTNotes owned by that address\n    /// @param nft_exists A map from token ID to a boolean indicating if the NFT exists\n    /// @param public_owners A map from token ID to the public owner of the NFT\n    /// @param minter The address that can mint\n    #[storage]\n    struct Storage<Context> {\n        symbol: PublicImmutable<FieldCompressedString, Context>,\n        name: PublicImmutable<FieldCompressedString, Context>,\n        private_nfts: Owned<PrivateSet<NFTNote, Context>, Context>,\n        nft_exists: Map<Field, PublicMutable<bool, Context>, Context>,\n        public_owners: Map<Field, PublicMutable<AztecAddress, Context>, Context>,\n        minter: PublicImmutable<AztecAddress, Context>,\n    }\n\n    // Sentinel address used in Transfer events to represent the private side of a balance change.\n    // sha224sum 'PRIVATE_ADDRESS'\n    global PRIVATE_ADDRESS_MAGIC_VALUE: AztecAddress =\n        AztecAddress::from_field(0x1ea7e01501975545617c2e694d931cb576b691a4a867fed81ebd3264);\n\n    #[event]\n    struct Transfer {\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n    }\n\n    /// @dev Initializes the token with a minter\n    /// @param name The name of the NFT\n    /// @param symbol The symbol of the NFT\n    /// @param minter The address of the minter\n    #[external(\"public\")]\n    #[initializer]\n    fn constructor_with_minter(name: str<31>, symbol: str<31>, minter: AztecAddress) {\n        self.storage.name.initialize(FieldCompressedString::from_string(name));\n        self.storage.symbol.initialize(FieldCompressedString::from_string(symbol));\n        self.storage.minter.initialize(minter);\n    }\n\n    /** ==========================================================\n     * ========================= PRIVATE =========================\n     * ======================================================== */\n\n    /// @notice Transfers token by id from private owner to a public owner\n    /// @dev Removes token from private owner, and enqueues a public call to update the public owner\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_private_to_public(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.enqueue_self.update_public_token_owner_from_zero_internal(to, token_id);\n    }\n\n    /// @notice Transfers token by id from private owner to a public owner with a commitment\n    /// @dev Removes token from private owner, enqueues a public call to update the public owner, and returns a commitment\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    /// @return commitment The partial nft note utilized for the transfer commitment (privacy entrance)\n    #[external(\"private\")]\n    fn transfer_private_to_public_with_commitment(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) -> Field {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.enqueue_self.update_public_token_owner_from_zero_internal(to, token_id);\n        let completer = self.msg_sender();\n        let commitment = self.internal._initialize_transfer_commitment(to, completer);\n        commitment.commitment\n    }\n\n    /// @notice Transfers token by id from private owner to another private owner\n    /// @dev Removes token by id from private owner, and sends a nft note with id to the recipient\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_private_to_private(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.internal._update_private_token_owner(to, token_id);\n    }\n\n    /// @notice Transfers token by id from private owner to the recipient commitment (recipient must create a commitment first)\n    /// @dev Removes token by id from private owner, and enqueues a public call to complete the commitment\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to transfer\n    /// @param commitment The commitment to use for the transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_private_to_commitment(\n        from: AztecAddress,\n        token_id: Field,\n        commitment: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        let completer = from;\n        self.enqueue_self.transfer_token_to_commitment_internal(\n            commitment.to_field(),\n            token_id,\n            completer,\n        );\n    }\n\n    /// @notice Transfers token by id from public owner to private owner\n    /// @dev Enqueues a public call to remove the public owner, and emits a nft note with id to the recipient\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_public_to_private(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.enqueue_self.transfer_public_to_private_internal(from, token_id);\n        self.internal._update_private_token_owner(to, token_id);\n    }\n\n    /// @notice Initializes a transfer commitment to be used for transfers\n    /// @dev Returns a partial nft note that can be used to execute transfers\n    /// @param to The address of the recipient\n    /// @param completer The address allowed to complete the partial note\n    /// @return commitment The partial nft note utilized for the transfer commitment (privacy entrance)\n    #[external(\"private\")]\n    fn initialize_transfer_commitment(to: AztecAddress, completer: AztecAddress) -> Field {\n        let commitment = self.internal._initialize_transfer_commitment(to, completer);\n        commitment.commitment\n    }\n\n    /** ==========================================================\n     * ========================= PUBLIC ==========================\n     * ======================================================== */\n\n    /// @notice Transfers a token from one public owner to another public owner\n    /// @dev Public call that asserts that the caller is the token owner, and updates the public owner\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"public\")]\n    fn transfer_public_to_public(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        self.internal._validate_from_public(from);\n        self.internal._validate_public_token_owner(from, token_id);\n\n        self.internal._update_public_token_owner(to, token_id);\n        self.emit(Transfer { from, to, token_id });\n    }\n\n    /// @notice Transfers a token to a commitment\n    /// @dev Public call that asserts that the caller is the token owner, and updates the public owner, and completes the commitment\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to transfer\n    /// @param commitment The commitment to use for the transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"public\")]\n    fn transfer_public_to_commitment(\n        from: AztecAddress,\n        token_id: Field,\n        commitment: Field,\n        _nonce: Field,\n    ) {\n        self.internal._validate_from_public(from);\n        self.internal._validate_public_token_owner(from, token_id);\n\n        self.internal._update_public_token_owner(AztecAddress::zero(), token_id);\n        let completer = self.msg_sender();\n        self.internal._transfer_token_to_commitment(commitment.to_field(), token_id, completer);\n        self.emit(Transfer { from, to: PRIVATE_ADDRESS_MAGIC_VALUE, token_id });\n    }\n\n    /// @notice Stores a commitment in storage\n    /// @param commitment The commitment to store\n    #[external(\"public\")]\n    #[only_self]\n    fn store_commitment_in_storage_internal(commitment: PartialNFTNote) {\n        self.internal._store_commitment_in_storage(commitment);\n    }\n\n    /// @notice Transfers a token to a commitment\n    /// @param commitment The commitment to transfer\n    /// @param token_id The id of the token to transfer\n    /// @param completer The address that is authorized to complete this commitment\n    #[external(\"public\")]\n    #[only_self]\n    fn transfer_token_to_commitment_internal(\n        commitment: Field,\n        token_id: Field,\n        completer: AztecAddress,\n    ) {\n        self.internal._transfer_token_to_commitment(commitment, token_id, completer);\n    }\n\n    /// @notice Clears the public owner and emits a Transfer event for a public-to-private transfer\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to transfer\n    #[external(\"public\")]\n    #[only_self]\n    fn transfer_public_to_private_internal(from: AztecAddress, token_id: Field) {\n        self.internal._validate_public_token_owner(from, token_id);\n        self.internal._update_public_token_owner(AztecAddress::zero(), token_id);\n        self.emit(Transfer { from, to: PRIVATE_ADDRESS_MAGIC_VALUE, token_id });\n    }\n\n    /// @notice Initializes the public token owner from zero address\n    /// @param to The address of the new owner\n    /// @param token_id The id of the token to update\n    #[external(\"public\")]\n    #[only_self]\n    fn update_public_token_owner_from_zero_internal(to: AztecAddress, token_id: Field) {\n        self.internal._update_public_token_owner(to, token_id);\n        self.emit(Transfer { from: PRIVATE_ADDRESS_MAGIC_VALUE, to, token_id });\n    }\n\n    /// @notice Finalizes a mint to private by registering the token and emitting a Transfer event\n    /// @param token_id The id of the token to mint\n    #[external(\"public\")]\n    #[only_self]\n    fn mint_to_private_internal(token_id: Field) {\n        self.internal._set_nft_exists(token_id, true);\n        self.emit(\n            Transfer { from: AztecAddress::zero(), to: PRIVATE_ADDRESS_MAGIC_VALUE, token_id },\n        );\n    }\n\n    /// @notice Finalizes a burn from private by deregistering the token and emitting a Transfer event\n    /// @param token_id The id of the token to burn\n    #[external(\"public\")]\n    #[only_self]\n    fn burn_private_internal(token_id: Field) {\n        self.internal._set_nft_exists(token_id, false);\n        self.emit(\n            Transfer { from: PRIVATE_ADDRESS_MAGIC_VALUE, to: AztecAddress::zero(), token_id },\n        );\n    }\n\n    /** ==========================================================\n     * ====================== VIEW FUNCTIONS =====================\n     * ======================================================== */\n\n    /// @return name The name of the NFT collection\n    #[external(\"public\")]\n    #[view]\n    fn public_get_name() -> pub FieldCompressedString {\n        self.storage.name.read()\n    }\n\n    /// @return symbol The symbol of the NFT collection\n    #[external(\"public\")]\n    #[view]\n    fn public_get_symbol() -> pub FieldCompressedString {\n        self.storage.symbol.read()\n    }\n\n    /// @return owner The owner of a token by id\n    #[external(\"public\")]\n    #[view]\n    fn public_owner_of(token_id: Field) -> pub AztecAddress {\n        self.storage.public_owners.at(token_id).read()\n    }\n\n    /** ==========================================================\n     * ===================== UNCONSTRAINED =======================\n     * ======================================================== */\n\n    /// @notice Returns an array of token IDs owned by `owner` in private and a flag indicating whether a page limit was reached\n    /// @dev Starts getting the notes from page with index `page_index`\n    /// @dev Zero values in the array are placeholder values for non-existing notes\n    /// @param owner The address of the owner\n    /// @param page_index The index of the page to start getting notes from\n    /// @return owned_nft_ids An array of token IDs owned by `owner`\n    /// @return page_limit_reached A flag indicating whether a page limit was reached\n    #[external(\"utility\")]\n    unconstrained fn get_private_nfts(\n        owner: AztecAddress,\n        page_index: u32,\n    ) -> pub ([Field; MAX_NOTES_PER_PAGE], bool) {\n        let offset = page_index * MAX_NOTES_PER_PAGE;\n        let mut options = NoteViewerOptions::new();\n        let nfts = self.storage.private_nfts.at(owner).view_notes(options.set_offset(offset));\n        let mut owned_nft_ids = [0; MAX_NOTES_PER_PAGE];\n        for i in 0..options.limit {\n            if i < nfts.len() {\n                owned_nft_ids[i] = nfts.get_unchecked(i).token_id;\n            }\n        }\n        let page_limit_reached = nfts.len() == options.limit;\n        (owned_nft_ids, page_limit_reached)\n    }\n\n    /** ==========================================================\n    * ======================= MINTABLE ==========================\n    * ======================================================== */\n\n    /// @notice Mints a token to a private address\n    /// @dev Asserts that the caller is an authorized minter\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to mint\n    #[external(\"private\")]\n    fn mint_to_private(to: AztecAddress, token_id: Field) {\n        assert(token_id != 0, \"zero token ID not supported\");\n        _validate_minter(self.msg_sender(), self.storage.minter.read());\n\n        self.enqueue_self.mint_to_private_internal(token_id);\n        self.storage.private_nfts.at(to).insert(NFTNote { token_id }).deliver(\n            MessageDelivery.ONCHAIN_CONSTRAINED,\n        );\n    }\n\n    /// @notice Mints a token to a public address\n    /// @dev Asserts that the caller is an authorized minter\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to mint\n    #[external(\"public\")]\n    fn mint_to_public(to: AztecAddress, token_id: Field) {\n        assert(token_id != 0, \"zero token ID not supported\");\n        _validate_minter(self.msg_sender(), self.storage.minter.read());\n\n        self.internal._set_nft_exists(token_id, true);\n        self.storage.public_owners.at(token_id).write(to);\n        self.emit(Transfer { from: AztecAddress::zero(), to, token_id });\n    }\n\n    /** ==========================================================\n     * ======================= BURNABLE ==========================\n     * ======================================================== */\n\n    /// @notice Burns a token from a private address\n    /// @dev Asserts that the caller is token owner, removes private token owner, and enqueues a public call to burn token\n    /// @param from The address of the owner\n    /// @param token_id The id of the token to burn\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn burn_private(from: AztecAddress, token_id: Field, _nonce: Field) {\n        _validate_from_private::<3>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.enqueue_self.burn_private_internal(token_id);\n    }\n\n    /// @notice Burns a token from a public address\n    /// @dev Asserts that token exists and that the caller is token owner, removes public token owner, and burns token\n    /// @param from The address of the owner\n    /// @param token_id The id of the token to burn\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"public\")]\n    fn burn_public(from: AztecAddress, token_id: Field, _nonce: Field) {\n        self.internal._validate_from_public(from);\n\n        self.internal._validate_public_token_owner(from, token_id);\n        self.internal._update_public_token_owner(AztecAddress::zero(), token_id);\n        self.internal._set_nft_exists(token_id, false);\n        self.emit(Transfer { from, to: AztecAddress::zero(), token_id });\n    }\n\n    /** ==========================================================\n     * ================= TOKEN LIBRARIES =========================\n     * ======================================================== */\n\n    /// @notice Sets the existence of a token\n    /// @dev Asserts token does not exist when setting `exists` to true (minting) and that token exists when setting `exists` to false (burning)\n    /// @param token_id The id of the token to set\n    /// @param exists The new exists value\n    #[internal(\"public\")]\n    fn _set_nft_exists(token_id: Field, exists: bool) {\n        if exists {\n            assert(!self.storage.nft_exists.at(token_id).read(), \"token already exists\");\n        } else {\n            assert(self.storage.nft_exists.at(token_id).read(), \"token does not exist\");\n        }\n        self.storage.nft_exists.at(token_id).write(exists);\n    }\n\n    /// @notice Stores a commitment in storage\n    /// @param commitment The commitment to store\n    #[internal(\"public\")]\n    fn _store_commitment_in_storage(commitment: PartialNFTNote) {\n        self.context.storage_write(commitment.commitment, true);\n    }\n\n    /// @notice Initializes a transfer commitment\n    /// @param to The address of the recipient\n    /// @param completer The address that can complete the commitment\n    /// @return commitment The partial nft note utilized for the transfer commitment (privacy entrance)\n    #[internal(\"private\")]\n    fn _initialize_transfer_commitment(\n        to: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialNFTNote {\n        let commitment = NFTNote::partial(to, self.context, to, completer);\n        self.enqueue_self.store_commitment_in_storage_internal(commitment);\n        commitment\n    }\n\n    /// @notice Updates the private token owner\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to update\n    #[internal(\"private\")]\n    fn _update_private_token_owner(to: AztecAddress, token_id: Field) {\n        let new_note = NFTNote { token_id };\n        self.storage.private_nfts.at(to).insert(new_note).deliver(\n            MessageDelivery.ONCHAIN_CONSTRAINED,\n        );\n    }\n\n    /// @notice Removes the private token owner\n    /// @param from The address of the owner\n    /// @param token_id The id of the token to remove\n    #[internal(\"private\")]\n    fn _remove_private_token_owner(from: AztecAddress, token_id: Field) {\n        let notes = self.storage.private_nfts.at(from).pop_notes(NoteGetterOptions::new()\n            .select(NFTNote::properties().token_id, Comparator.EQ, token_id)\n            .set_limit(1));\n        assert(notes.len() == 1, \"nft not found\");\n    }\n\n    /// @notice Updates the public token owner\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to update\n    #[internal(\"public\")]\n    fn _update_public_token_owner(to: AztecAddress, token_id: Field) {\n        self.storage.public_owners.at(token_id).write(to);\n    }\n\n    /// @notice Transfers a token to a commitment\n    /// @dev Asserts that a commitment is valid, and completes it\n    /// @param commitment The commitment to complete\n    /// @param token_id The id of the token to transfer\n    /// @param completer The address that is authorized to complete this commitment\n    #[internal(\"public\")]\n    fn _transfer_token_to_commitment(commitment: Field, token_id: Field, completer: AztecAddress) {\n        // We verify that the commitment we're completing is valid (i.e. it uses the correct state variable's storage\n        // slot, and it is internally consistent). We *could* clear the storage since each commitment should only be\n        // used once, but since the AVM offers no gas refunds for doing so this would just make the transaction be more\n        // expensive.\n        assert(self.context.storage_read(commitment), \"invalid commitment\");\n        PartialNFTNote { commitment }.complete(\n            self.context,\n            completer,\n            self.storage.private_nfts.get_storage_slot(),\n            token_id,\n        );\n    }\n\n    /// @notice Validates that the caller is the owner of a token\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to validate\n    #[internal(\"public\")]\n    fn _validate_public_token_owner(from: AztecAddress, token_id: Field) {\n        let owner = self.storage.public_owners.at(token_id).read();\n        assert(owner.eq(from), \"caller is not owner\");\n    }\n\n    /// @notice Validates that the caller is an authorized minter\n    /// @param sender The address of the caller\n    /// @param minter The address of the minter\n    #[contract_library_method]\n    fn _validate_minter(sender: AztecAddress, minter: AztecAddress) {\n        assert(minter.eq(sender), \"caller is not minter\");\n    }\n\n    /** ==========================================================\n     * ================== AUTH LIBRARIES =========================\n     * ======================================================== */\n\n    /// @notice Validates that the caller possesses authwit from the `from` address or the caller is the `from` address\n    /// @param context The context of the private call\n    /// @param from The address of the sender\n    #[contract_library_method]\n    fn _validate_from_private<let N: u32>(context: &mut PrivateContext, from: AztecAddress) {\n        if (!from.eq(context.maybe_msg_sender().unwrap())) {\n            assert_current_call_valid_authwit::<N>(context, from);\n        }\n    }\n\n    /// @notice Validates that the caller possesses authwit from the `from` address or the caller is the `from` address\n    /// @param from The address of the sender\n    #[internal(\"public\")]\n    fn _validate_from_public(from: AztecAddress) {\n        if (!from.eq(self.msg_sender())) {\n            assert_current_call_valid_authwit_public(self.context, from);\n        }\n    }\n}\n"
505:      "source": "use aztec::{\n    context::{PrivateContext, PublicContext},\n    keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},\n    macros::notes::custom_note,\n    messages::{\n        logs::partial_note::encode_partial_note_private_message,\n        message_delivery::{do_private_message_delivery, MessageDelivery},\n    },\n    note::{note_interface::{NoteHash, NoteType}, utils::compute_note_nullifier},\n    oracle::random::random,\n    protocol::{\n        address::AztecAddress,\n        constants::{\n            DOM_SEP__NOTE_COMPLETION_LOG_TAG, DOM_SEP__NOTE_HASH,\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        },\n        hash::{compute_log_tag, poseidon2_hash_with_separator},\n        traits::{Deserialize, Hash, Packable, Serialize, ToField},\n    },\n};\n\n// NFTNote supports partial notes, i.e. the ability to create an incomplete note in private, hiding certain values (the\n// owner, storage slot and randomness), and then completing the note in public with the ones missing (the token id).\n// Partial notes are being actively developed and are not currently fully supported via macros, and so we rely on the\n// #[custom_note] macro to implement it manually, resulting in some boilerplate. This is expected to be unnecessary once\n// macro support is expanded.\n\n/// A private note representing a token id associated to an account.\n#[derive(Eq, Serialize, Packable)]\n#[custom_note]\npub struct NFTNote {\n    /// The ID of the token represented by this note.\n    pub token_id: Field,\n}\n\nimpl NoteHash for NFTNote {\n    fn compute_note_hash(\n        self,\n        owner: AztecAddress,\n        storage_slot: Field,\n        randomness: Field,\n    ) -> Field {\n        // Partial notes can be implemented by having the note hash be either the result of multiscalar multiplication\n        // (MSM), or two rounds of poseidon. MSM results in more constraints and is only required when multiple variants\n        // of partial notes are supported. Because NFTNote has just one variant (where the token id is public), we use\n        // poseidon instead.\n\n        // We must compute the same note hash as would be produced by a partial note created and completed with the same\n        // values, so that notes all behave the same way regardless of how they were created. To achieve this, we\n        // perform both steps of the partial note computation.\n\n        // First we create the partial note from a commitment to the private content (including storage slot).\n        let partial_note =\n            PartialNFTNote { commitment: compute_partial_commitment(owner, randomness) };\n\n        // Then compute the completion note hash. In a real partial note this step would be performed in public.\n        partial_note.compute_complete_note_hash(storage_slot, self.token_id)\n    }\n\n    // The nullifiers are nothing special - this is just the canonical implementation that would be injected by the\n    // #[note] macro.\n\n    fn compute_nullifier(\n        self,\n        context: &mut PrivateContext,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Field {\n        let owner_npk_m = get_public_keys(owner).npk_m;\n        let owner_npk_m_hash = owner_npk_m.hash();\n        let secret = context.request_nhk_app(owner_npk_m_hash);\n        compute_note_nullifier(note_hash_for_nullification, [secret])\n    }\n\n    unconstrained fn compute_nullifier_unconstrained(\n        self,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Option<Field> {\n        try_get_public_keys(owner).map(|public_keys| {\n            let owner_npk_m = public_keys.npk_m;\n            let owner_npk_m_hash = owner_npk_m.hash();\n            let secret = get_nhk_app(owner_npk_m_hash);\n            compute_note_nullifier(note_hash_for_nullification, [secret])\n        })\n    }\n}\n\nimpl NFTNote {\n    /// Creates a partial note that will hide the owner and storage slot but not the token id, since the note will be\n    /// later completed in public. This is a powerful technique for scenarios in which the token id cannot be known in\n    /// private (e.g. because it depends on some public state, such as a DEX).\n    ///\n    /// This function inserts a partial note validity commitment into the nullifier tree to be later on able to verify\n    /// that the partial note and completer are legitimate. See function docs of `compute_validity_commitment` for more\n    /// details.\n    ///\n    /// Each partial note should only be used once, since otherwise multiple notes would be linked together and known to\n    /// belong to the same owner.\n    ///\n    /// As part of the partial note creation process, a log will be sent to `recipient` from `sender` so that they can\n    /// discover the note. `recipient` will typically be the same as `owner`.\n    pub fn partial(\n        owner: AztecAddress,\n        context: &mut PrivateContext,\n        recipient: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialNFTNote {\n        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing,\n        // so a malicious sender could use non-random values to make the note less private. But they already know\n        // the full note pre-image anyway, and so the recipient already trusts them to not disclose this\n        // information. We can therefore assume that the sender will cooperate in the random value generation.\n        let randomness = unsafe { random() };\n\n        // We create a commitment to the private data, which we then use to construct the log we send to the recipient.\n        let commitment = compute_partial_commitment(owner, randomness);\n\n        // Our partial note log encoding scheme includes a field with the tag of the public completion log, and we use\n        // the commitment as the tag. This is good for multiple reasons:\n        //  - the commitment is uniquely tied to this partial note\n        //  - the commitment is already public information, so we're not revealing anything else\n        //  - we don't need to create any additional information, private or public, for the tag\n        //  - other contracts cannot impersonate us and emit logs with the same tag due to public log siloing\n        let private_log_content = NFTPartialNotePrivateLogContent {};\n\n        do_private_message_delivery(\n            context,\n            || {\n                encode_partial_note_private_message(\n                    private_log_content,\n                    owner,\n                    randomness,\n                    commitment,\n                )\n            },\n            Option::none(),\n            recipient,\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        let partial_note = PartialNFTNote { commitment };\n\n        // Now we compute the validity commitment and push it to the nullifier tree. It can be safely pushed to\n        // the nullifier tree since it uses its own separator, making collisions with actual note nullifiers\n        // practically impossible.\n        let validity_commitment = partial_note.compute_validity_commitment(completer);\n        context.push_nullifier(validity_commitment);\n\n        partial_note\n    }\n}\n\n/// Computes a commitment to the private content of a partial NFTNote, i.e. the fields that will remain private. All\n/// other note fields will be made public.\nfn compute_partial_commitment(owner: AztecAddress, randomness: Field) -> Field {\n    poseidon2_hash_with_separator([owner.to_field(), randomness], DOM_SEP__NOTE_HASH)\n}\n\n#[derive(Packable)]\n// This note does not have any non-metadata (i.e. storage slot, owner, randomness) private content, as the only field\n// (token_id) will be public in the partial note.\nstruct NFTPartialNotePrivateLogContent {}\n\nimpl NoteType for NFTPartialNotePrivateLogContent {\n    fn get_id() -> Field {\n        NFTNote::get_id()\n    }\n}\n\n/// A partial instance of a NFTNote. This value represents a private commitment to the owner, randomness and storage\n/// slot, but the token id field has not yet been set. A partial note can be completed in public with the `complete`\n/// function (revealing the token id to the public), resulting in a NFTNote that can be used like any other one (except\n/// of course that its token id is known).\n#[derive(Packable, Serialize, Deserialize)]\npub struct PartialNFTNote {\n    pub commitment: Field,\n}\n\nimpl PartialNFTNote {\n    /// Completes the partial note, creating a new note that can be used like any other NFTNote.\n    pub fn complete(\n        self,\n        context: PublicContext,\n        completer: AztecAddress,\n        storage_slot: Field,\n        token_id: Field,\n    ) {\n        // A note with a value of zero is valid, but we cannot currently complete a partial note with such a value\n        // because this will result in the completion log having its last field set to 0. Public logs currently do not\n        // track their length, and so trailing zeros are simply trimmed. This results in the completion log missing its\n        // last field (the value), and note discovery failing.\n        // TODO(#11636): remove this\n        assert(token_id != 0, \"Cannot complete a PartialNFTNote with a value of 0\");\n\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // Safety: we're using the existence of the nullifier as proof of the contract having validated the partial\n        // note's preimage, which is safe.\n        assert(\n            context.nullifier_exists_unsafe(validity_commitment, context.this_address()),\n            \"Invalid partial note or completer\",\n        );\n\n        // We need to do two things:\n        //  - emit a public log containing the public fields (the storage slot and token id). The contract will later\n        //  find it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        //  only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        //  inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        context.emit_public_log_unsafe(log_tag, [storage_slot, token_id]);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, token_id));\n    }\n\n    /// Computes a validity commitment for this partial note. The commitment cryptographically binds the note's private\n    /// data with the designated completer address. When the note is later completed in public execution, we can load\n    /// this commitment from the nullifier tree and verify that both the partial note (e.g. that the storage slot\n    /// corresponds to the correct owner, and that we're using the correct state variable) and completer are\n    /// legitimate.\n    pub fn compute_validity_commitment(self, completer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator(\n            [self.commitment, completer.to_field()],\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        )\n    }\n\n    fn compute_complete_note_hash(self, storage_slot: Field, token_id: Field) -> Field {\n        // Here we finalize the note hash by including the (public) storage slot and token id into the partial note\n        // commitment. Note that we use the same separator as we used for the first round of poseidon - this is not\n        // an issue.\n        poseidon2_hash_with_separator(\n            [self.commitment, storage_slot, token_id],\n            DOM_SEP__NOTE_HASH,\n        )\n    }\n}\n"
2755:      "name": "get_private_nfts"
6820:              "path": "types::nft_note::PartialNFTNote"
14810:            "string": "Cannot complete a PartialNFTNote with a value of 0"
16942:            "string": "Cannot complete a PartialNFTNote with a value of 0"
17248:            "string": "Cannot complete a PartialNFTNote with a value of 0"
17514:                    "name": "private_nfts",
17530:                    "name": "nft_exists",
17546:                    "name": "public_owners",
17812:                "path": "NFT::get_private_nfts_parameters"
17835:          "path": "NFT::get_private_nfts_abi"
18209:                      "path": "types::nft_note::PartialNFTNote"

exec
/bin/zsh -lc "if [ -f packages/extension/vitest.config.ts ]; then nl -ba packages/extension/vitest.config.ts; else echo 'MISSING'; fi" in (project root)
 succeeded in 0ms:
     1	import { existsSync } from "node:fs"
     2	import { dirname, join } from "node:path"
     3	import { fileURLToPath, URL } from "node:url"
     4	import vue from "@vitejs/plugin-vue"
     5	import useAutoImport from "unplugin-auto-import/vite"
     6	import { defineConfig } from "vitest/config"
     7	import packageJson from "./package.json"
     8	
     9	/** Resolve a file inside an npm package bypassing its `exports` field.
    10	 *  Mirrors the helper in vite.config.ts — vitest doesn't share Vite's
    11	 *  plugin pipeline for these artifact aliases, so we re-declare them
    12	 *  here. Keep in sync. */
    13	function resolvePackageFile(pkg: string, file: string): string {
    14		const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
    15		let dir = fileURLToPath(new URL(".", import.meta.url))
    16		while (dir !== dirname(dir)) {
    17			const candidate = join(dir, "node_modules", ...parts, file)
    18			if (existsSync(candidate)) return candidate
    19			dir = dirname(dir)
    20		}
    21		throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
    22	}
    23	
    24	export default defineConfig({
    25		// Vue plugin + auto-import: required so vitest can compile *.vue
    26		// SFCs and resolve auto-imported identifiers (RouterLink from
    27		// vue-router, ref/computed from vue, etc.) the same way the
    28		// production build does. M6 phase 1.
    29		plugins: [
    30			vue(),
    31			useAutoImport({
    32				imports: ["vue", "vue-router"],
    33				dts: false,
    34			}),
    35		],
    36		resolve: {
    37			alias: {
    38				"@": fileURLToPath(new URL("./src", import.meta.url)),
    39				"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
    40				"@wonderland-token-artifact": resolvePackageFile(
    41					"@defi-wonderland/aztec-standards",
    42					"artifacts/target/token_contract-Token.json",
    43				),
    44			},
    45		},
    46		define: {
    47			__VERSION__: JSON.stringify(packageJson.version),
    48			__SENTINEL__: JSON.stringify(packageJson.sentinel),
    49			__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
    50			__NAME__: JSON.stringify(packageJson.name),
    51			__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
    52		},
    53		test: {
    54			globals: true,
    55			environment: "jsdom",
    56			setupFiles: "./tests/vitest.setup.ts",
    57			// Pick up co-located tests in extracted @nulo/* workspace packages
    58			// (same pattern as source-first exports — no per-package vitest
    59			// config, extension remains the single test runner).
    60			include: [
    61				"src/**/*.test.ts",
    62				"../wallet-core/src/**/*.test.ts",
    63				"../wallet-crypto/src/**/*.test.ts",
    64				"../extension-messaging/src/**/*.test.ts",
    65				"../aztec-runtime/src/**/*.test.ts",
    66				"../wallet-bridge/src/**/*.test.ts",
    67			],
    68			exclude: ["tests/e2e/**", "node_modules/**"],
    69			// Inline workspace @nulo/* packages so vite processes their TS
    70			// source entry points instead of externalizing them (default
    71			// vitest behavior for node_modules, which breaks on
    72			// source-first exports with no dist build).
    73			server: {
    74				deps: {
    75					inline: [/^@nulo\//],
    76				},
    77			},
    78		},
    79	})

exec
/bin/zsh -lc "rg -n 'hasKnownClassId|pxeOnly|registerContract|artifact-registry|smart-tighten|getContractInstance\\(|getContractInstanceFrom' packages -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/wallet-bridge/src/dispatcher.ts:126:	registerContract: "aztec_registerContract",
packages/wallet-bridge/src/dispatcher.ts:149:	"aztec_registerContract",
packages/wallet-bridge/src/dispatcher.ts:618:	 *   - registerContract(instance, artifact?, secretKey?): [ContractInstanceWithAddress, ContractArtifact?, Fr?]
packages/wallet-bridge/src/dispatcher.ts:644:			case "aztec_registerContract":
packages/aztec-runtime/src/pxe/service.ts:9:	getContractInstanceFromInstantiationParams,
packages/aztec-runtime/src/pxe/service.ts:34:import { ArtifactRegistry } from "./artifact-registry"
packages/aztec-runtime/src/pxe/service.ts:111:	public async getContractInstance(
packages/aztec-runtime/src/pxe/service.ts:114:		opts?: { pxeOnly?: boolean },
packages/aztec-runtime/src/pxe/service.ts:118:			let instance = await pxe.getContractInstance(address)
packages/aztec-runtime/src/pxe/service.ts:119:			if (!instance && !opts?.pxeOnly) {
packages/aztec-runtime/src/pxe/service.ts:130:	public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
packages/aztec-runtime/src/pxe/service.ts:170:	public async registerContractClass(network: NetworkInfo, artifact: ContractArtifact): Promise<void> {
packages/aztec-runtime/src/pxe/service.ts:171:		return this.withPxeWrite("registerContractClass", network, async (pxe) =>
packages/aztec-runtime/src/pxe/service.ts:172:			pxe.registerContractClass(await ContractArtifactSchema.parseAsync(artifact)),
packages/aztec-runtime/src/pxe/service.ts:176:	public async registerContract(
packages/aztec-runtime/src/pxe/service.ts:180:		return this.withPxeWrite("registerContract", network, async (pxe) =>
packages/aztec-runtime/src/pxe/service.ts:181:			pxe.registerContract({
packages/aztec-runtime/src/pxe/service.ts:240:					const instance = await getContractInstanceFromInstantiationParams(SimulatedSchnorrAccountContractArtifact, {
packages/aztec-runtime/src/account/nulo-account.ts:15:	getContractInstanceFromInstantiationParams,
packages/aztec-runtime/src/account/nulo-account.ts:68:		const instance = await getContractInstanceFromInstantiationParams(SchnorrAccountContractArtifact, {
packages/aztec-runtime/src/account/nulo-account.ts:87:		const instance = await pxe.getContractInstance(this.address)
packages/aztec-runtime/src/account/nulo-account.ts:90:			await pxe.registerContract({ instance: this.instance, artifact: this.artifact })
packages/aztec-runtime/src/pxe/ipxe.ts:21:	getContractInstance(address: AztecAddress): Promise<ContractInstanceWithAddress | undefined>
packages/aztec-runtime/src/pxe/ipxe.ts:28:	registerContractClass(artifact: ContractArtifact): Promise<void>
packages/aztec-runtime/src/pxe/ipxe.ts:29:	registerContract(contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }): Promise<void>
packages/wallet-bridge/src/scope-enforcement.ts:62:		throw new Error(`Scope violation: registerContract targets ${address}, not permitted by granted contracts scope`)
packages/wallet-bridge/src/scope-enforcement.ts:292:	registerContract: checkRegisterContract,
packages/wallet-bridge/src/operation.ts:153:	readonly kind: "aztec_registerContract"
packages/aztec-runtime/src/pxe/index.ts:3:export { ArtifactRegistry, defaultPolicy, type ArtifactPolicy, type ArtifactSource } from "./artifact-registry"
packages/aztec-runtime/src/pxe/artifact-registry.ts:48: * contracts via `aztec_registerContract({ artifact })`.
packages/aztec-runtime/src/pxe/artifact-registry.ts:83:		this.logSource = opts?.logSource ?? "artifact-registry"
packages/aztec-runtime/src/pxe/artifact-registry.ts:121:	 *  `aztec_registerContract` smart-tighten check). */
packages/aztec-runtime/src/pxe/artifact-registry.ts:122:	public async hasKnownClassId(classId: Fr): Promise<boolean> {
packages/aztec-runtime/src/pxe/artifact-registry.ts:163:		opts?: { pxeOnly?: boolean },
packages/aztec-runtime/src/pxe/artifact-registry.ts:167:		const pxeOnly = opts?.pxeOnly === true
packages/aztec-runtime/src/pxe/artifact-registry.ts:170:			if (pxeOnly && source !== "pxe-local") continue
packages/aztec-runtime/src/pxe/proxy.ts:25:	getContractInstance(address: AztecAddress): Promise<ContractInstanceWithAddress | undefined> {
packages/aztec-runtime/src/pxe/proxy.ts:26:		return this.pxeService.getContractInstance(this.network, address)
packages/aztec-runtime/src/pxe/proxy.ts:53:	registerContractClass(artifact: ContractArtifact): Promise<void> {
packages/aztec-runtime/src/pxe/proxy.ts:54:		return this.pxeService.registerContractClass(this.network, artifact)
packages/aztec-runtime/src/pxe/proxy.ts:57:	registerContract(contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }): Promise<void> {
packages/aztec-runtime/src/pxe/proxy.ts:58:		return this.pxeService.registerContract(this.network, contract)
packages/wallet-bridge/src/capability-map.ts:24:	registerContract: "contracts",
packages/aztec-runtime/src/pxe/client.ts:45:	public async getContractInstance(
packages/aztec-runtime/src/pxe/client.ts:48:		opts?: { pxeOnly?: boolean },
packages/aztec-runtime/src/pxe/client.ts:54:	public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
packages/aztec-runtime/src/pxe/client.ts:88:	public async registerContractClass(network: NetworkInfo, artifact: ContractArtifact): Promise<void> {
packages/aztec-runtime/src/pxe/client.ts:89:		await this.request("registerContractClass", network, artifact)
packages/aztec-runtime/src/pxe/client.ts:92:	public async registerContract(
packages/aztec-runtime/src/pxe/client.ts:96:		await this.request("registerContract", network, contract)
packages/aztec-runtime/src/pxe/known-artifacts.ts:16:	getContractInstanceFromInstantiationParams,
packages/aztec-runtime/src/pxe/known-artifacts.ts:63:	const sponsoredFpcInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/wallet-bridge/src/scope-enforcement.test.ts:35:// ── registerContract ──────────────────────────────────────────────────
packages/wallet-bridge/src/scope-enforcement.test.ts:37:describe("registerContract", () => {
packages/wallet-bridge/src/scope-enforcement.test.ts:40:		expect(() => enforceScope("registerContract", [{ address: addr(ADDR_A) }], grants)).not.toThrow()
packages/wallet-bridge/src/scope-enforcement.test.ts:45:		expect(() => enforceScope("registerContract", [{ address: addr(ADDR_A) }], grants)).not.toThrow()
packages/wallet-bridge/src/scope-enforcement.test.ts:50:		expect(() => enforceScope("registerContract", [{ address: addr(ADDR_B) }], grants)).toThrow(/Scope violation/)
packages/wallet-bridge/src/scope-enforcement.test.ts:55:		expect(() => enforceScope("registerContract", [{ address: addr(ADDR_A) }], grants)).toThrow(/Scope violation/)
packages/aztec-runtime/src/pxe/spec.ts:18:	getContractInstance(network: NetworkInfo, address: AztecAddress, opts?: { pxeOnly?: boolean }): ContractInstanceWithAddress | undefined
packages/aztec-runtime/src/pxe/spec.ts:19:	getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): ContractArtifact | undefined
packages/aztec-runtime/src/pxe/spec.ts:29:	registerContractClass(network: NetworkInfo, artifact: ContractArtifact): void
packages/aztec-runtime/src/pxe/spec.ts:30:	registerContract(network: NetworkInfo, contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }): void
packages/extension/src/popup/windows/execute/index.vue:155:				case "aztec_registerContract":
packages/extension/src/popup/windows/execute/index.vue:755:						<template v-else-if="op.kind === 'aztec_registerContract'">
packages/extension/tests/e2e/network/contracts-register.test.ts:11: * Test #21 — registerContract is silent on default sessions
packages/extension/tests/e2e/network/contracts-register.test.ts:59:		const result = await callExpectingNoPopup(dappConnectedExtension, page, "registerContract", async () => {
packages/extension/tests/e2e/network/contracts-register.test.ts:60:			const btn = await page.waitForSelector('[data-testid="pg-btn-registerContract"]', { visible: true })
packages/extension/tests/e2e/fixtures/aztec.ts:15:import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
packages/extension/tests/e2e/fixtures/aztec.ts:112:	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/extension/tests/e2e/fixtures/aztec.ts:120:	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/extension/tests/e2e/fixtures/aztec.ts:126:		await wallet.registerContract(instance, SponsoredFPCContractArtifact)
packages/extension/tests/e2e/fixtures/aztec.ts:357:	// `register` calls `wallet.registerContract` which lives on the parent
packages/extension/src/wallet/services/account-state/service.ts:157:					const instance = await this.pxeService.getContractInstance(nInfo, AztecAddress.fromString(c))
packages/extension/src/wallet/services/account-state/service.ts:217:					await this.pxeService.registerContract(networkInfoFrom(network), {
packages/playground/src/sections/contracts.ts:5: * registerContract needs a real ContractInstance which the test driver passes
packages/playground/src/sections/contracts.ts:31:				<button data-testid="pg-btn-registerContract" type="button" ${dis}>registerContract</button>
packages/playground/src/sections/contracts.ts:83:	root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerContract"]')?.addEventListener(
packages/playground/src/sections/contracts.ts:85:		safe("registerContract", async () => {
packages/playground/src/sections/contracts.ts:91:			return wallet.registerContract(instance)
packages/playground/README.md:43:| Contracts | registerContract, registerSender, getContractMetadata, getContractClassMetadata |
packages/playground/README.md:50:**Note:** `registerToken`, `getCompleteAddress`, and `simulateViews` (Nulo-custom RPCs inherited from the upstream fork) were removed in the canonical refactor. Use `wallet.registerContract()`, the granted capability response, and `simulateUtility` / `BatchCall.simulate()` respectively per the canonical wallet-sdk surface.
packages/extension/src/wallet/services/dapp-interaction/service.ts:229:				case "aztec_registerContract":
packages/extension/src/wallet/services/dapp-interaction/service.ts:286:				case "aztec_registerContract": {
packages/extension/src/wallet/services/dapp-interaction/service.ts:414:			case "aztec_registerContract":
packages/extension/src/wallet/services/execution/service.ts:831:					case "aztec_registerContract": {
packages/extension/src/wallet/services/execution/service.ts:895:			providedInstance ?? (await this.pxeService.getContractInstance(networkInfoFrom(network), AztecAddress.fromString(op.address)))
packages/extension/src/wallet/services/execution/service.ts:917:		await this.pxeService.registerContract(networkInfoFrom(network), { instance, artifact })
packages/extension/src/wallet/services/execution/service.ts:1064:			await pxe.registerContract({ instance, artifact })
packages/extension/src/wallet/services/execution/service.ts:1120:				await pxe.registerContract({
packages/extension/src/wallet/services/execution/service.ts:1419:		const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), op.id, { pxeOnly: true })
packages/extension/src/wallet/services/execution/service.ts:1438:		const localInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), op.address, { pxeOnly: true })
packages/extension/src/wallet/services/execution/service.ts:1444:					pxeOnly: true,
packages/extension/src/wallet/services/execution/service.ts:1457:			const fullInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), op.address)
packages/extension/src/wallet/services/execution/service.ts:1522:					"pass the artifact in aztec_registerContract({ instance, artifact }) for custom contracts.",
packages/extension/src/wallet/services/execution/service.ts:1531:		await this.pxeService.registerContract(networkInfoFrom(network), { instance, artifact })
packages/extension/src/wallet/services/wallet-sdk/background.ts:83:	 * conditions (e.g. executeUtility runs before registerContract completes).
packages/extension/src/wallet/services/token/service.ts:240:		const instance = await pxe.getContractInstance(AztecAddress.fromString(token.contract))
packages/extension/src/wallet/services/token/service.ts:252:			await pxe.registerContract({
packages/extension/src/wallet/services/token/service.ts:325:			const instance = await pxe.getContractInstance(AztecAddress.fromString(contract))
packages/extension/src/wallet/services/token/service.ts:337:				await pxe.registerContract({
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:55:	test("pxeOnly=true skips known", async () => {
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:63:		const got = await reg.resolve(new Fr(1), pxeLookup, makeNetwork(1), { pxeOnly: true })
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:64:		// known has it, but pxeOnly forced the registry to skip the known branch.
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:69:	test("smart-tighten precondition: unknown class-id and pxe-miss → undefined", async () => {
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:70:		// This is the case `aztec_registerContract` relies on: when a
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:169:describe("ArtifactRegistry.hasKnownClassId — smart-tighten support", () => {
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:177:		expect(await reg.hasKnownClassId(classId)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:188:		expect(await reg.hasKnownClassId(unknown)).toBe(false)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:189:		expect(await reg.hasKnownClassId(known)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:194:		expect(await reg.hasKnownClassId(new Fr(99))).toBe(false)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:206:		expect(await reg.hasKnownClassId(classId)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:209:		expect(await reg.hasKnownClassId(classId)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:233:	test("pxeOnly + mismatched pxe-local → undefined (no fall-through)", async () => {
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:239:		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1), { pxeOnly: true })
packages/extension/src/wallet/services/note/service.ts:189:			const instance = await this.pxeService.getContractInstance(networkInfoFrom(network), address)
packages/extension/src/wallet/services/execution/contract-resolver.ts:77:		const instance = await pxe.getContractInstance(AztecAddress.fromString(contract))
packages/extension/src/wallet/services/execution/tx-request-builder.ts:116:					await pxe.registerContract({
packages/extension/src/wallet/services/execution/tx-request-builder.ts:406:					await pxe.registerContract({
packages/extension/src/wallet/services/fpc/service.ts:15:import { getContractInstanceFromInstantiationParams, type ContractInstanceWithAddress } from "@aztec/stdlib/contract"
packages/extension/src/wallet/services/fpc/service.ts:110:				const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/extension/src/wallet/services/fpc/service.ts:118:				const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
packages/extension/src/wallet/services/fpc/service.ts:129:					await pxe.registerContract({ instance: contractInstance, artifact: contractArtifact })
packages/extension/src/wallet/services/fpc/service.ts:191:		const fpcInstance = await pxe.getContractInstance(AztecAddress.fromString(address))
packages/extension/src/wallet/services/fpc/service.ts:203:			await pxe.registerContract({

codex
I’ve confirmed where the artifact internals live; now I’m pulling the exact storage-layout and ABI lines so the review can cite the real slots and note shapes, not just the plan’s summary.
exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json | sed -n '8436,8512p'" in (project root)
 succeeded in 0ms:
  8436	                "value": "PrivateFPC"
  8437	              }
  8438	            },
  8439	            {
  8440	              "name": "fields",
  8441	              "value": {
  8442	                "fields": [
  8443	                  {
  8444	                    "name": "balances",
  8445	                    "value": {
  8446	                      "fields": [
  8447	                        {
  8448	                          "name": "slot",
  8449	                          "value": {
  8450	                            "kind": "integer",
  8451	                            "sign": false,
  8452	                            "value": "0000000000000000000000000000000000000000000000000000000000000001"
  8453	                          }
  8454	                        }
  8455	                      ],
  8456	                      "kind": "struct"
  8457	                    }
  8458	                  }
  8459	                ],
  8460	                "kind": "struct"
  8461	              }
  8462	            }
  8463	          ],
  8464	          "kind": "struct"
  8465	        }
  8466	      ]
  8467	    },
  8468	    "structs": {
  8469	      "functions": [
  8470	        {
  8471	          "fields": [
  8472	            {
  8473	              "name": "parameters",
  8474	              "type": {
  8475	                "fields": [
  8476	                  {
  8477	                    "name": "_account",
  8478	                    "type": {
  8479	                      "fields": [
  8480	                        {
  8481	                          "name": "inner",
  8482	                          "type": {
  8483	                            "kind": "field"
  8484	                          }
  8485	                        }
  8486	                      ],
  8487	                      "kind": "struct",
  8488	                      "path": "aztec::protocol_types::address::aztec_address::AztecAddress"
  8489	                    }
  8490	                  }
  8491	                ],
  8492	                "kind": "struct",
  8493	                "path": "PrivateFPC::balance_of_parameters"
  8494	              }
  8495	            },
  8496	            {
  8497	              "name": "return_type",
  8498	              "type": {
  8499	                "kind": "integer",
  8500	                "sign": "unsigned",
  8501	                "width": 128
  8502	              }
  8503	            }
  8504	          ],
  8505	          "kind": "struct",
  8506	          "path": "PrivateFPC::balance_of_abi"
  8507	        },
  8508	        {
  8509	          "fields": [
  8510	            {
  8511	              "name": "parameters",
  8512	              "type": {

exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json | sed -n '17500,17560p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json | sed -n '8488,8510p'" in (project root)
 succeeded in 0ms:
  8488	                      "path": "aztec::protocol_types::address::aztec_address::AztecAddress"
  8489	                    }
  8490	                  }
  8491	                ],
  8492	                "kind": "struct",
  8493	                "path": "PrivateFPC::balance_of_parameters"
  8494	              }
  8495	            },
  8496	            {
  8497	              "name": "return_type",
  8498	              "type": {
  8499	                "kind": "integer",
  8500	                "sign": "unsigned",
  8501	                "width": 128
  8502	              }
  8503	            }
  8504	          ],
  8505	          "kind": "struct",
  8506	          "path": "PrivateFPC::balance_of_abi"
  8507	        },
  8508	        {
  8509	          "fields": [
  8510	            {

 succeeded in 0ms:
 17500	                      "fields": [
 17501	                        {
 17502	                          "name": "slot",
 17503	                          "value": {
 17504	                            "kind": "integer",
 17505	                            "sign": false,
 17506	                            "value": "0000000000000000000000000000000000000000000000000000000000000003"
 17507	                          }
 17508	                        }
 17509	                      ],
 17510	                      "kind": "struct"
 17511	                    }
 17512	                  },
 17513	                  {
 17514	                    "name": "private_nfts",
 17515	                    "value": {
 17516	                      "fields": [
 17517	                        {
 17518	                          "name": "slot",
 17519	                          "value": {
 17520	                            "kind": "integer",
 17521	                            "sign": false,
 17522	                            "value": "0000000000000000000000000000000000000000000000000000000000000005"
 17523	                          }
 17524	                        }
 17525	                      ],
 17526	                      "kind": "struct"
 17527	                    }
 17528	                  },
 17529	                  {
 17530	                    "name": "nft_exists",
 17531	                    "value": {
 17532	                      "fields": [
 17533	                        {
 17534	                          "name": "slot",
 17535	                          "value": {
 17536	                            "kind": "integer",
 17537	                            "sign": false,
 17538	                            "value": "0000000000000000000000000000000000000000000000000000000000000006"
 17539	                          }
 17540	                        }
 17541	                      ],
 17542	                      "kind": "struct"
 17543	                    }
 17544	                  },
 17545	                  {
 17546	                    "name": "public_owners",
 17547	                    "value": {
 17548	                      "fields": [
 17549	                        {
 17550	                          "name": "slot",
 17551	                          "value": {
 17552	                            "kind": "integer",
 17553	                            "sign": false,
 17554	                            "value": "0000000000000000000000000000000000000000000000000000000000000007"
 17555	                          }
 17556	                        }
 17557	                      ],
 17558	                      "kind": "struct"
 17559	                    }
 17560	                  },

exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json | sed -n '381,460p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json | sed -n '376,430p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json | sed -n '500,560p'" in (project root)
 succeeded in 0ms:
   381	      "source": "use aztec::{\n    context::{PrivateContext, UtilityContext},\n    note::{\n        HintedNote,\n        MaybeNoteMessage,\n        note_getter_options::{NoteGetterOptions, SortOrder},\n        note_interface::NoteProperties,\n        note_viewer_options::NoteViewerOptions,\n    },\n    protocol::{address::AztecAddress, constants::MAX_NOTE_HASH_READ_REQUESTS_PER_CALL, traits::Packable},\n    state_vars::{OwnedStateVariable, PrivateSet},\n};\nuse std::ops::Add;\nuse uint_note::UintNote;\n\npub struct BalanceSet<Context> {\n    set: PrivateSet<UintNote, Context>,\n}\n\n// TODO(#13824): remove this impl once we allow structs to hold state variables.\nimpl<Context> OwnedStateVariable<Context> for BalanceSet<Context> {\n    fn new(context: Context, storage_slot: Field, owner: AztecAddress) -> Self {\n        Self { set: PrivateSet::new(context, storage_slot, owner) }\n    }\n}\n\nimpl BalanceSet<UtilityContext> {\n    pub unconstrained fn balance_of(self: Self) -> u128 {\n        self.balance_of_with_offset(0)\n    }\n\n    pub unconstrained fn balance_of_with_offset(self: Self, offset: u32) -> u128 {\n        let mut balance = 0 as u128;\n        let options = NoteViewerOptions::<UintNote, <UintNote as Packable>::N>::new().set_offset(offset);\n        let notes = self.set.view_notes(options);\n        for i in 0..options.limit {\n            if i < notes.len() {\n                balance = balance + notes.get_unchecked(i).value;\n            }\n        }\n        if (notes.len() == options.limit) {\n            balance = balance + self.balance_of_with_offset(offset + options.limit);\n        }\n\n        balance\n    }\n}\n\nimpl BalanceSet<&mut PrivateContext> {\n    pub fn add(self: Self, addend: u128) -> MaybeNoteMessage<UintNote> {\n        let maybe_new_note = if addend == 0 as u128 {\n            Option::none()\n        } else {\n            let addend_note = UintNote { value: addend };\n\n            Option::some(self.set.insert(addend_note).get_new_note())\n        };\n\n        MaybeNoteMessage::new(maybe_new_note, self.set.context)\n    }\n\n    pub fn sub(self: Self, amount: u128) -> MaybeNoteMessage<UintNote> {\n        let subtracted = self.try_sub(amount, MAX_NOTE_HASH_READ_REQUESTS_PER_CALL);\n\n        // try_sub may have subtracted more or less than amount. We must ensure that we subtracted at least as much as\n        // we needed, and then create a new note for the owner for the change (if any).\n        assert(subtracted >= amount, \"Balance too low\");\n        self.add(subtracted - amount)\n    }\n\n    // Attempts to remove 'target_amount' from the owner's balance. try_sub returns how much was actually subtracted\n    // (i.e. the sum of the value of nullified notes), but this subtracted amount may be more or less than the target\n    // amount. This may seem odd, but is unfortunately unavoidable due to the number of notes available and their\n    // amounts being unknown. What try_sub does is a best-effort attempt to consume as few notes as possible that add\n    // up to more than `target_amount`. The `max_notes` parameter is used to fine-tune the number of constraints\n    // created by this function. The gate count scales relatively linearly with `max_notes`, but a lower `max_notes`\n    // parameter increases the likelihood of `try_sub` subtracting an amount smaller than `target_amount`.\n    pub fn try_sub(self: Self, target_amount: u128, max_notes: u32) -> u128 {\n        // We are using a preprocessor here (filter applied in an unconstrained context) instead of a filter because we\n        // do not need to prove correct execution of the preprocessor. Because the `min_sum` notes is not constrained,\n        // users could choose to e.g. not call it. However, all this might result in is simply higher DA costs due to\n        // more nullifiers being emitted. Since we don't care about proving optimal note usage, we can save these\n        // constraints and make the circuit smaller.\n        let options = NoteGetterOptions::with_preprocessor(preprocess_notes_min_sum, target_amount)\n            .sort(UintNote::properties().value, SortOrder.DESC)\n            .set_limit(max_notes);\n        let notes = self.set.pop_notes(options);\n\n        let mut subtracted = 0 as u128;\n        for i in 0..options.limit {\n            if i < notes.len() {\n                let note = notes.get_unchecked(i);\n                subtracted = subtracted + note.value;\n            }\n        }\n\n        subtracted\n    }\n}\n\n// Computes the partial sum of the notes array, stopping once 'min_sum' is reached. This can be used to minimize the\n// number of notes read that add to some value, e.g. when transferring some amount of tokens. The preprocessor (a\n// filter applied in an unconstrained context) does not check if total sum is larger or equal to 'min_sum' - all it\n// does is remove extra notes if it does reach that value. Note that proper usage of this preprocessor requires for\n// notes to be sorted in descending order.\npub fn preprocess_notes_min_sum(\n    notes: [Option<HintedNote<UintNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL],\n    min_sum: u128,\n) -> [Option<HintedNote<UintNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL] {\n    let mut selected = [Option::none(); MAX_NOTE_HASH_READ_REQUESTS_PER_CALL];\n    let mut sum = 0 as u128;\n    for i in 0..notes.len() {\n        // Because we process notes in retrieved order, notes need to be sorted in descending amount order for this\n        // filter to be useful. Consider a 'min_sum' of 4, and a set of notes with amounts [3, 2, 1, 1, 1, 1, 1]. If\n        // sorted in descending order, the filter will only choose the notes with values 3 and 2, but if sorted in\n        // ascending order it will choose 4 notes of value 1.\n        if notes[i].is_some() & sum < min_sum {\n            let hinted_note = notes[i].unwrap_unchecked();\n            selected[i] = Option::some(hinted_note);\n            sum = sum.add(hinted_note.note.value);\n        }\n    }\n    selected\n}\n"
   382	    },
   383	    "435": {
   384	      "path": "(Aztec packages source tree)/noir-projects/aztec-nr/uint-note/src/uint_note.nr",
   385	      "source": "use aztec::{\n    context::{PrivateContext, PublicContext},\n    history::nullifier::assert_nullifier_existed_by,\n    keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},\n    macros::notes::custom_note,\n    messages::{\n        logs::partial_note::encode_partial_note_private_message,\n        message_delivery::{do_private_message_delivery, MessageDelivery},\n    },\n    note::{note_interface::{NoteHash, NoteType}, utils::compute_note_nullifier},\n    oracle::random::random,\n    protocol::{\n        address::AztecAddress,\n        constants::{\n            DOM_SEP__NOTE_COMPLETION_LOG_TAG, DOM_SEP__NOTE_HASH, DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n            PRIVATE_LOG_CIPHERTEXT_LEN,\n        },\n        hash::{compute_log_tag, compute_siloed_nullifier, poseidon2_hash_with_separator},\n        traits::{Deserialize, FromField, Hash, Packable, Serialize, ToField},\n    },\n};\n\n// UintNote supports partial notes, i.e. the ability to create an incomplete note in private, hiding certain values\n// (the owner and randomness), and then completing the note in public with the ones missing (the storage slot and\n// amount). Partial notes are being actively developed and are not currently fully supported via macros, and so we\n// rely on the #[custom_note] macro to implement it manually, resulting in some boilerplate. This is expected to be\n// unnecessary once macro support is expanded.\n\n/// A private note representing a numeric value associated to an account (e.g. a token balance).\n// docs:start:uint_note_def\n#[derive(Deserialize, Eq, Serialize, Packable)]\n#[custom_note]\npub struct UintNote {\n    /// The number stored in the note.\n    pub value: u128,\n}\n// docs:end:uint_note_def\n\nimpl NoteHash for UintNote {\n    // docs:start:compute_note_hash\n    fn compute_note_hash(self, owner: AztecAddress, storage_slot: Field, randomness: Field) -> Field {\n        // Partial notes can be implemented by having the note hash be either the result of multiscalar multiplication\n        // (MSM), or two rounds of poseidon. MSM results in more constraints and is only required when multiple\n        // variants of partial notes are supported. Because UintNote has just one variant (where the value is public),\n        // we use poseidon instead.\n\n        // We must compute the same note hash as would be produced by a partial note created and completed with the\n        // same values, so that notes all behave the same way regardless of how they were created. To achieve this, we\n        // perform both steps of the partial note computation.\n\n        // First we create the partial note from a commitment to the private content.\n        let partial_note = PartialUintNote { commitment: compute_partial_commitment(owner, randomness) };\n\n        // Then compute the completion note hash. In a real partial note this step would be performed in public.\n        partial_note.compute_complete_note_hash(storage_slot, self.value)\n    }\n    // docs:end:compute_note_hash\n\n    // The nullifiers are nothing special - this is just the canonical implementation that would be injected by the\n    // #[note] macro.\n\n    fn compute_nullifier(\n        self,\n        context: &mut PrivateContext,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Field {\n        let owner_npk_m = get_public_keys(owner).npk_m;\n        let owner_npk_m_hash = owner_npk_m.hash();\n        let secret = context.request_nhk_app(owner_npk_m_hash);\n        compute_note_nullifier(note_hash_for_nullification, [secret])\n    }\n\n    unconstrained fn compute_nullifier_unconstrained(\n        self,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Option<Field> {\n        try_get_public_keys(owner).map(|public_keys| {\n            let owner_npk_m = public_keys.npk_m;\n            let owner_npk_m_hash = owner_npk_m.hash();\n            let secret = get_nhk_app(owner_npk_m_hash);\n            compute_note_nullifier(note_hash_for_nullification, [secret])\n        })\n    }\n}\n\nimpl UintNote {\n    /// Creates a partial note that will hide the owner but not the value or storage slot, since the note will be\n    /// later completed in public. This is a powerful technique for scenarios in which the value cannot be known in\n    /// private (e.g. because it depends on some public state, such as a DEX).\n    ///\n    /// This function inserts a partial note validity commitment into the nullifier tree to be later on able to verify\n    /// that the partial note and completer are legitimate. See function docs of `compute_validity_commitment` for more\n    /// details.\n    ///\n    /// Each partial note should only be used once, since otherwise multiple notes would be linked together and known\n    /// to belong to the same owner.\n    ///\n    /// As part of the partial note creation process, a log will be sent to `recipient` so that they can discover the\n    /// note. `recipient` will typically be the same as `owner`.\n    pub fn partial(\n        owner: AztecAddress,\n        context: &mut PrivateContext,\n        recipient: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialUintNote {\n        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing, so\n        // a malicious sender could use non-random values to make the note less private. But they already know the full\n        // note pre-image anyway, and so the recipient already trusts them to not disclose this information. We can\n        // therefore assume that the sender will cooperate in the random value generation.\n        let randomness = unsafe { random() };\n\n        // We create a commitment to the private data, which we then use to construct the log we send to the recipient.\n        let commitment = compute_partial_commitment(owner, randomness);\n\n        // Our partial note log encoding scheme includes a field with the tag of the public completion log, and we use\n        // the commitment as the tag. This is good for multiple reasons:\n        //  - the commitment is uniquely tied to this partial note\n        //  - the commitment is already public information, so we're not revealing anything else\n        //  - we don't need to create any additional information, private or public, for the tag\n        //  - other contracts cannot impersonate us and emit logs with the same tag due to public log siloing\n        let private_log_content = UintPartialNotePrivateLogContent {};\n\n        do_private_message_delivery(\n            context,\n            || encode_partial_note_private_message(private_log_content, owner, randomness, commitment),\n            Option::none(),\n            recipient,\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        let partial_note = PartialUintNote { commitment };\n\n        // Now we compute the validity commitment and push it to the nullifier tree. It can be safely pushed to the\n        // nullifier tree since it uses its own separator, making collisions with actual note nullifiers practically\n        // impossible.\n        let validity_commitment = partial_note.compute_validity_commitment(completer);\n        context.push_nullifier(validity_commitment);\n\n        partial_note\n    }\n}\n\n/// Computes a commitment to the private content of a partial UintNote, i.e. the fields that will remain private. All\n/// other note fields will be made public.\n// docs:start:compute_partial_commitment\nfn compute_partial_commitment(owner: AztecAddress, randomness: Field) -> Field {\n    poseidon2_hash_with_separator([owner.to_field(), randomness], DOM_SEP__NOTE_HASH)\n}\n// docs:end:compute_partial_commitment\n\n#[derive(Packable)]\n// This note does not have any non-metadata (i.e. storage slot, owner, randomness) private content, as the only field\n// (value) will be public in the partial note.\nstruct UintPartialNotePrivateLogContent {}\n\nimpl NoteType for UintPartialNotePrivateLogContent {\n    fn get_id() -> Field {\n        UintNote::get_id()\n    }\n}\n\n/// A partial instance of a UintNote. This value represents a private commitment to the owner and randomness, but the\n/// storage slot and value fields have not yet been set. A partial note can be completed in public with the `complete`\n/// function (revealing the storage slot and value to the public), resulting in a UintNote that can be used like any\n/// other one (except of course that its value is known).\n// docs:start:partial_uint_note_def\n#[derive(Packable, Serialize, Deserialize, Eq)]\npub struct PartialUintNote {\n    commitment: Field,\n}\n// docs:end:partial_uint_note_def\n\nglobal NOTE_COMPLETION_PAYLOAD_LENGTH: u32 = 2;\n\nimpl PartialUintNote {\n    /// Completes the partial note, creating a new note that can be used like any other UintNote.\n    pub fn complete(self, context: PublicContext, completer: AztecAddress, storage_slot: Field, value: u128) {\n        // A note with a value of zero is valid, but we cannot currently complete a partial note with such a value\n        // because this will result in the completion log having its last field set to 0. Public logs currently do not\n        // track their length, and so trailing zeros are simply trimmed. This results in the completion log missing its\n        // last field (the value), and note discovery failing. TODO(#11636): remove this\n        assert(value != 0, \"Cannot complete a PartialUintNote with a value of 0\");\n\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // Safety: we're using the existence of the nullifier as proof of the contract having validated the partial\n        // note's preimage, which is safe.\n        assert(\n            context.nullifier_exists_unsafe(validity_commitment, context.this_address()),\n            \"Invalid partial note or completer\",\n        );\n\n        // We need to do two things:\n        //  - emit a public log containing the public fields (the storage slot and value). The contract will later find\n        // it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        // only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        // inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        context.emit_public_log_unsafe(log_tag, [storage_slot, value.to_field()]);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, value));\n    }\n\n    /// Completes the partial note, creating a new note that can be used like any other UintNote. Same as `complete`\n    /// function but works from private context.\n    pub fn complete_from_private(\n        self,\n        context: &mut PrivateContext,\n        completer: AztecAddress,\n        storage_slot: Field,\n        value: u128,\n    ) {\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // `assert_nullifier_existed_by` function expects the nullifier to be siloed (hashed with the address of the\n        // contract that emitted the nullifier) as it checks the value directly against the nullifier tree and all the\n        // nullifiers in the tree are siloed by the protocol.\n        let siloed_validity_commitment = compute_siloed_nullifier(context.this_address(), validity_commitment);\n        assert_nullifier_existed_by(\n            context.get_anchor_block_header(),\n            siloed_validity_commitment,\n        );\n\n        // We need to do two things:\n        //  - emit an unencrypted log containing the public fields (the storage slot and value) via the private log\n        // channel. The contract will later find it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        // only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        // inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        let padded_payload = self.compute_note_completion_payload_padded_for_private_log(storage_slot, value);\n        context.emit_private_log_unsafe(log_tag, padded_payload, NOTE_COMPLETION_PAYLOAD_LENGTH);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, value));\n    }\n\n    /// Computes a validity commitment for this partial note. The commitment cryptographically binds the note's private\n    /// data with the designated completer address. When the note is later completed in public execution, we can load\n    /// this commitment from the nullifier tree and verify that both the partial note (e.g. that the storage slot\n    /// corresponds to the correct owner, and that we're using the correct state variable) and completer are\n    /// legitimate.\n    pub fn compute_validity_commitment(self, completer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator(\n            [self.commitment, completer.to_field()],\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        )\n    }\n\n    fn compute_note_completion_payload_padded_for_private_log(\n        _self: Self,\n        storage_slot: Field,\n        value: u128,\n    ) -> [Field; PRIVATE_LOG_CIPHERTEXT_LEN] {\n        let payload = [storage_slot, value.to_field()];\n        payload.concat([0; PRIVATE_LOG_CIPHERTEXT_LEN - NOTE_COMPLETION_PAYLOAD_LENGTH])\n    }\n\n    // docs:start:compute_complete_note_hash\n    fn compute_complete_note_hash(self, storage_slot: Field, value: u128) -> Field {\n        // Here we finalize the note hash by including the (public) storage slot and value into the partial note\n        // commitment. Note that we use the same separator as we used for the first round of poseidon - this is not\n        // an issue.\n        poseidon2_hash_with_separator(\n            [self.commitment, storage_slot, value.to_field()],\n            DOM_SEP__NOTE_HASH,\n        )\n    }\n    // docs:end:compute_complete_note_hash\n}\n\nimpl ToField for PartialUintNote {\n    fn to_field(self) -> Field {\n        self.commitment\n    }\n}\n\nimpl FromField for PartialUintNote {\n    fn from_field(field: Field) -> Self {\n        Self { commitment: field }\n    }\n}\n\nmod test {\n    use super::{compute_partial_commitment, PartialUintNote, UintNote};\n    use aztec::{note::note_interface::NoteHash, protocol::{address::AztecAddress, traits::FromField}};\n\n    global value: u128 = 17;\n    global randomness: Field = 42;\n    global owner: AztecAddress = AztecAddress::from_field(50);\n    global storage_slot: Field = 13;\n\n    #[test]\n    fn note_hash_matches_completed_partial_note_hash() {\n        // Tests that a UintNote has the same note hash as a PartialUintNote created and then completed with the same\n        // private values. This requires for the same hash function to be used in both flows, with the fields in the\n        // same order.\n        let note = UintNote { value };\n        let note_hash = note.compute_note_hash(owner, storage_slot, randomness);\n\n        let partial_note = PartialUintNote { commitment: compute_partial_commitment(owner, randomness) };\n        let completed_partial_note_hash = partial_note.compute_complete_note_hash(storage_slot, value);\n\n        assert_eq(note_hash, completed_partial_note_hash);\n    }\n}\n"
   386	    }
   387	  },
   388	  "functions": [
   389	    {
   390	      "abi": {
   391	        "error_types": {
   392	          "10835759466430049078": {
   393	            "error_kind": "string",
   394	            "string": "Collapse hint vec length mismatch"
   395	          },
   396	          "12913276134398371456": {
   397	            "error_kind": "string",
   398	            "string": "push out of bounds"
   399	          },
   400	          "13049348927268151465": {
   401	            "error_kind": "string",
   402	            "string": "Dirty collapsed vec storage"
   403	          },
   404	          "14990209321349310352": {
   405	            "error_kind": "string",
   406	            "string": "attempt to add with overflow"
   407	          },
   408	          "15764276373176857197": {
   409	            "error_kind": "string",
   410	            "string": "Stack too deep"
   411	          },
   412	          "16431471497789672479": {
   413	            "error_kind": "string",
   414	            "string": "Index out of bounds"
   415	          },
   416	          "18160147074902047180": {
   417	            "error_kind": "string",
   418	            "string": "Out of bounds index hint"
   419	          },
   420	          "18195344559583857168": {
   421	            "error_kind": "string",
   422	            "string": "Wrong collapsed vec length"
   423	          },
   424	          "5955197699778714817": {
   425	            "error_kind": "string",
   426	            "string": "Wrong collapsed vec order"
   427	          },
   428	          "8754864405609694316": {
   429	            "error_kind": "string",
   430	            "string": "Wrong collapsed vec content"
   431	          },
   432	          "992401946138144806": {
   433	            "error_kind": "string",
   434	            "string": "Attempted to read past end of BoundedVec"
   435	          }
   436	        },
   437	        "parameters": [
   438	          {
   439	            "name": "account",
   440	            "type": {
   441	              "fields": [
   442	                {
   443	                  "name": "inner",
   444	                  "type": {
   445	                    "kind": "field"
   446	                  }
   447	                }
   448	              ],
   449	              "kind": "struct",
   450	              "path": "aztec::protocol_types::address::aztec_address::AztecAddress"
   451	            },
   452	            "visibility": "private"
   453	          }
   454	        ],
   455	        "return_type": {
   456	          "abi_type": {
   457	            "kind": "integer",
   458	            "sign": "unsigned",
   459	            "width": 128
   460	          },

 succeeded in 0ms:
   376	      "path": "(fee-payment source tree)/src/nr/private_contract/src/main.nr",
   377	      "source": "use aztec::macros::aztec;\npub mod test;\n\n/// Private Fee Payment Contract\n///\n/// Fully private FPC (no public functions, no owner, no off-chain agent).\n/// Users bridge FeeJuice from L1 via FeeJuicePortal to this contract address,\n/// then call `mint` to convert the bridge claim into private FJ balance.\n/// The FJ balance can then be used to sponsor transactions via `pay_fee`.\n#[aztec]\npub contract PrivateFPC {\n    use aztec::{\n        hash::{\n            compute_l1_to_l2_message_hash, compute_l1_to_l2_message_nullifier, compute_secret_hash,\n        },\n        macros::{functions::{allow_phase_change, external, internal, only_self}, storage::storage},\n        messages::message_delivery::MessageDelivery,\n        nullifier::utils::compute_nullifier_existence_request,\n        protocol::{\n            address::{AztecAddress, EthAddress},\n            constants::FEE_JUICE_ADDRESS,\n            hash::{poseidon2_hash_with_separator, sha256_to_field},\n            traits::ToField,\n        },\n        state_vars::Owned,\n    };\n    use balance_set::BalanceSet;\n    use fpc_lib::get_max_gas_cost;\n\n    // gas-optimized max notes for initial transfer call\n    global INITIAL_TRANSFER_CALL_MAX_NOTES: u32 = 2;\n    // max notes for recursive transfer call if initial max notes are exceeded\n    global RECURSIVE_TRANSFER_CALL_MAX_NOTES: u32 = 8;\n\n    /// Domain separator for bridge secret derivation.\n    /// Avoids collisions with other poseidon2 usages.\n    /// Value: poseidon2_hash_bytes(\"az_dom_sep__fpc_bridge_secret\") as u32\n    global DOM_SEP__FPC_BRIDGE_SECRET: u32 = 3952304070;\n\n    /// @param balances The private note-based balances mapping accounts to their internal FPC balance\n    #[storage]\n    struct Storage<Context> {\n        balances: Owned<BalanceSet<Context>, Context>,\n    }\n\n    /// @notice Sponsors the transaction by deducting max gas cost from sender's balance.\n    /// @dev Does not refund unused gas - the full max_gas_cost is consumed.\n    #[external(\"private\")]\n    #[allow_phase_change]\n    fn pay_fee() {\n        let sender = self.msg_sender();\n        let _max_gas_cost = self.internal._deduct_max_gas_cost(sender);\n\n        // Set the FPC as the fee payer of the tx.\n        self.context.set_as_fee_payer();\n        // End the setup phase.\n        self.context.end_setup();\n    }\n\n    /// @notice Mints internal FJ balance and pays fee in one transaction (cold-start flow).\n    ///\n    /// Combines the bridge claim proof with fee payment: proves the L1->L2 bridge claim,\n    /// credits (amount - max_gas_cost) to the claimer, and sets the FPC as fee payer.\n    ///\n    /// Prerequisites (must execute in the same tx, before this call):\n    ///   - FeeJuice.claim(this_fpc_address, amount, secret, leaf_index) emits the FeeJuice\n    ///     nullifier that this function asserts via assert_nullifier_exists.\n    ///\n    /// Security: same as mint -- only the claimer can reconstruct the correct FeeJuice\n    /// nullifier; FPC-scoped nullifier prevents double-spending.\n    ///\n    /// @param amount     The exact amount bridged (must match the L1 deposit exactly).\n    /// @param salt       The random value chosen by the claimer at deposit time.\n    /// @param leaf_index The L1 message leaf index from the deposit transaction.\n    #[external(\"private\")]\n    #[allow_phase_change]\n    fn mint_and_pay_fee(amount: u128, salt: Field, leaf_index: Field) {\n        let claimer = self.msg_sender();\n\n        let feejuice_nullifier = compute_feejuice_claim_nullifier(\n            self.address,\n            amount,\n            salt,\n            claimer,\n            leaf_index,\n            self.context.chain_id(),\n            self.context.version(),\n        );\n\n        self.context.assert_nullifier_exists(compute_nullifier_existence_request(\n            feejuice_nullifier,\n            FEE_JUICE_ADDRESS,\n        ));\n\n        // FPC-scoped nullifier prevents double-spending this bridge credit.\n        self.context.push_nullifier(feejuice_nullifier);\n\n        // Credit (amount - max_gas_cost) to claimer. The fee is implicitly deducted\n        // since the full amount was bridged but only the remainder is credited.\n        let max_gas_cost = get_max_gas_cost(self.context);\n        assert(amount >= max_gas_cost, \"Amount too low to cover gas cost\");\n        self.storage.balances.at(claimer).add(amount - max_gas_cost).deliver(\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        self.context.set_as_fee_payer();\n        self.context.end_setup();\n    }\n\n    /// @notice Mints internal FJ balance by proving a prior L1->L2 FeeJuice bridge claim.\n    ///\n    /// Prerequisites (must happen before or in the same tx as this call):\n    ///   1. On L1: FeeJuicePortal.depositToAztecPublic(\n    ///        _to        = this_fpc_address,\n    ///        _amount    = amount,\n    ///        _secretHash = compute_secret_hash(derive_bridge_secret(salt, claimer_aztec_address))\n    ///      )\n    ///   2. On L2: FeeJuice.claim(\n    ///        to                 = this_fpc_address,\n    ///        amount             = amount,\n    ///        secret             = derive_bridge_secret(salt, claimer_aztec_address),\n    ///        message_leaf_index = leaf_index\n    ///      )  ->  FJ credited to FPC's public FeeJuice balance; FeeJuice nullifier emitted.\n    ///\n    /// Security:\n    ///   - Auth: only msg_sender == claimer can reconstruct the correct FeeJuice nullifier.\n    ///   - Bridge proof: kernel verifies FeeJuice nullifier exists (pending or settled).\n    ///   - Double-spend: FPC emits its own nullifier (siloed under FPC address), distinct from\n    ///     the FeeJuice-siloed one - preventing the same bridge from being minted twice.\n    ///\n    /// @param amount     The exact amount bridged (must match the L1 deposit exactly).\n    /// @param salt       A random value chosen by the claimer at deposit time.\n    /// @param leaf_index The L1 message leaf index from the deposit transaction.\n    #[external(\"private\")]\n    fn mint(amount: u128, salt: Field, leaf_index: Field) {\n        let claimer = self.msg_sender();\n\n        // Reconstruct the nullifier FeeJuice.claim emitted when consuming the bridge message.\n        // Only the claimer can compute this correctly - derive_bridge_secret binds their address.\n        let feejuice_nullifier = compute_feejuice_claim_nullifier(\n            self.address,\n            amount,\n            salt,\n            claimer,\n            leaf_index,\n            self.context.chain_id(),\n            self.context.version(),\n        );\n\n        // Assert the FeeJuice nullifier exists entirely in private.\n        // The kernel circuit verifies this read request against the nullifier tree - no public call needed.\n        // compute_nullifier_existence_request handles pending (same-tx) vs settled nullifiers.\n        self.context.assert_nullifier_exists(compute_nullifier_existence_request(\n            feejuice_nullifier,\n            FEE_JUICE_ADDRESS,\n        ));\n\n        // Emit an FPC-scoped nullifier to prevent double-minting this bridge credit.\n        // Siloed as poseidon2([FPC_address, feejuice_nullifier]) - distinct from the\n        // FeeJuice-siloed version poseidon2([FeeJuice_address, feejuice_nullifier]).\n        self.context.push_nullifier(feejuice_nullifier);\n\n        // Mint private internal balance to claimer.\n        self.storage.balances.at(claimer).add(amount).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);\n    }\n\n    /// @notice Computes the max gas cost and deducts it from the account's balance.\n    /// @param account The address to deduct the gas cost from\n    /// @return The max gas cost that was deducted\n    #[internal(\"private\")]\n    fn _deduct_max_gas_cost(account: AztecAddress) -> u128 {\n        let max_gas_cost = get_max_gas_cost(self.context);\n\n        let change =\n            self.internal._subtract_balance(account, max_gas_cost, INITIAL_TRANSFER_CALL_MAX_NOTES);\n        self.storage.balances.at(account).add(change).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);\n\n        max_gas_cost\n    }\n\n    /// @notice Subtracts balance from private balance.\n    /// @dev Recurses via `recurse_subtract_balance_internal` if `max_notes` is insufficient.\n    /// @param account   The address of the account to subtract the balance from\n    /// @param amount    The amount of tokens to subtract\n    /// @param max_notes The maximum number of notes to process in a single call\n    /// @return The change to return to the owner\n    #[internal(\"private\")]\n    fn _subtract_balance(account: AztecAddress, amount: u128, max_notes: u32) -> u128 {\n        let subtracted = self.storage.balances.at(account).try_sub(amount, max_notes);\n        if subtracted >= amount {\n            subtracted - amount\n        } else {\n            assert(subtracted > 0, \"Balance too low\");\n\n            let remaining = amount - subtracted;\n            self.call_self.recurse_subtract_balance_internal(account, remaining)\n        }\n    }\n\n    /// @notice Recursively subtracts balance from private balance.\n    /// @param account The address of the account to subtract the balance from\n    /// @param amount  The amount to subtract\n    /// @return The change to return to the owner\n    #[external(\"private\")]\n    #[only_self]\n    fn recurse_subtract_balance_internal(account: AztecAddress, amount: u128) -> u128 {\n        self.internal._subtract_balance(account, amount, RECURSIVE_TRANSFER_CALL_MAX_NOTES)\n    }\n\n    /// @notice Returns the private balance of an account\n    /// @param account The address to query\n    /// @return The private balance of the account\n    #[external(\"utility\")]\n    unconstrained fn balance_of(account: AztecAddress) -> u128 {\n        self.storage.balances.at(account).balance_of()\n    }\n\n    // --- Bridge mint helpers ---\n\n    /// @notice Derives the bridge secret from (salt, claimer).\n    ///\n    /// Only the claimer can compute this, since it binds their Aztec address.\n    /// The corresponding L1 secretHash must be:\n    ///   compute_secret_hash(derive_bridge_secret(salt, claimer_aztec_address))\n    ///\n    /// @param salt    A random value chosen by the claimer at deposit time.\n    /// @param claimer The Aztec address of the claimer.\n    /// @return The bridge secret.\n    #[contract_library_method]\n    pub fn derive_bridge_secret(salt: Field, claimer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator([salt, claimer.to_field()], DOM_SEP__FPC_BRIDGE_SECRET)\n    }\n\n    /// @notice Computes the FeeJuice L1->L2 message content hash for bridging `amount` to `fpc_address`.\n    ///\n    /// Mirrors FeeJuicePortal.depositToAztecPublic on L1:\n    ///   sha256(abi.encodeWithSignature(\"claim(bytes32,uint256)\", fpc_address, amount))\n    ///\n    /// The 4-byte selector keccak256(\"claim(bytes32,uint256)\")[0:4] is computed at compile-time only -\n    /// zero runtime cost.\n    ///\n    /// @param fpc_address The FPC contract address (recipient of the bridge).\n    /// @param amount      The amount of FeeJuice bridged.\n    /// @return The content hash field element.\n    #[contract_library_method]\n    pub fn get_bridge_gas_msg_hash(fpc_address: AztecAddress, amount: u128) -> Field {\n        let mut hash_bytes = [0 as u8; 68];\n        let recipient_bytes: [u8; 32] = fpc_address.to_field().to_be_bytes();\n        let amount_bytes: [u8; 32] = (amount as Field).to_be_bytes();\n\n        // EVM ABI function selector: keccak256(\"claim(bytes32,uint256)\")[0:4]\n        // Must match exactly what FeeJuicePortal.depositToAztecPublic encodes on L1.\n        // Evaluated at compile-time only - zero runtime cost.\n        let selector: [u8; 32] =\n            comptime { keccak256::keccak256(\"claim(bytes32,uint256)\".as_bytes(), 22) };\n\n        for i in 0..4 {\n            hash_bytes[i] = selector[i];\n        }\n        for i in 0..32 {\n            hash_bytes[i + 4] = recipient_bytes[i];\n            hash_bytes[i + 36] = amount_bytes[i];\n        }\n\n        sha256_to_field(hash_bytes)\n    }\n\n    /// @notice Reconstructs the nullifier that FeeJuice.claim emits when consuming the bridge message.\n    ///\n    /// FeeJuice.claim calls consume_l1_to_l2_message which:\n    ///   1. Derives secret_hash = compute_secret_hash(secret)\n    ///   2. Computes message_hash = sha256(portal | chain_id | fee_juice_l2 | version | content | secret_hash | leaf_index)\n    ///   3. Emits nullifier = poseidon2([message_hash, secret], DOM_SEP__MESSAGE_NULLIFIER)\n    ///\n    /// By reconstructing this, the FPC can verify FeeJuice.claim was already executed.\n    ///\n    /// Protocol invariant: FeeJuice portal Eth address == FEE_JUICE_ADDRESS as a Field.\n    /// See FeeJuice.claim_helper: EthAddress::from_field(FEE_JUICE_ADDRESS.to_field())\n    ///\n    /// @param fpc_address The FPC contract address (recipient of the bridge).\n    /// @param amount      The exact amount bridged.\n    /// @param salt        A random value chosen by the claimer at deposit time.\n    /// @param claimer     The Aztec address of the claimer.\n    /// @param leaf_index  The L1 message leaf index.\n    /// @param chain_id    The L1 chain ID.\n    /// @param version     The Aztec protocol version.\n    /// @return The FeeJuice claim nullifier.\n    #[contract_library_method]\n    pub fn compute_feejuice_claim_nullifier(\n        fpc_address: AztecAddress,\n        amount: u128,\n        salt: Field,\n        claimer: AztecAddress,\n        leaf_index: Field,\n        chain_id: Field,\n        version: Field,\n    ) -> Field {\n        let secret = derive_bridge_secret(salt, claimer);\n        let content_hash = get_bridge_gas_msg_hash(fpc_address, amount);\n        let secret_hash = compute_secret_hash(secret);\n\n        let fee_juice_portal = EthAddress::from_field(FEE_JUICE_ADDRESS.to_field());\n\n        let message_hash = compute_l1_to_l2_message_hash(\n            fee_juice_portal,\n            chain_id,\n            FEE_JUICE_ADDRESS,\n            version,\n            content_hash,\n            secret_hash,\n            leaf_index,\n        );\n\n        compute_l1_to_l2_message_nullifier(message_hash, secret)\n    }\n\n}\n"
   378	    },
   379	    "432": {
   380	      "path": "(Aztec packages source tree)/noir-projects/aztec-nr/balance-set/src/balance_set.nr",
   381	      "source": "use aztec::{\n    context::{PrivateContext, UtilityContext},\n    note::{\n        HintedNote,\n        MaybeNoteMessage,\n        note_getter_options::{NoteGetterOptions, SortOrder},\n        note_interface::NoteProperties,\n        note_viewer_options::NoteViewerOptions,\n    },\n    protocol::{address::AztecAddress, constants::MAX_NOTE_HASH_READ_REQUESTS_PER_CALL, traits::Packable},\n    state_vars::{OwnedStateVariable, PrivateSet},\n};\nuse std::ops::Add;\nuse uint_note::UintNote;\n\npub struct BalanceSet<Context> {\n    set: PrivateSet<UintNote, Context>,\n}\n\n// TODO(#13824): remove this impl once we allow structs to hold state variables.\nimpl<Context> OwnedStateVariable<Context> for BalanceSet<Context> {\n    fn new(context: Context, storage_slot: Field, owner: AztecAddress) -> Self {\n        Self { set: PrivateSet::new(context, storage_slot, owner) }\n    }\n}\n\nimpl BalanceSet<UtilityContext> {\n    pub unconstrained fn balance_of(self: Self) -> u128 {\n        self.balance_of_with_offset(0)\n    }\n\n    pub unconstrained fn balance_of_with_offset(self: Self, offset: u32) -> u128 {\n        let mut balance = 0 as u128;\n        let options = NoteViewerOptions::<UintNote, <UintNote as Packable>::N>::new().set_offset(offset);\n        let notes = self.set.view_notes(options);\n        for i in 0..options.limit {\n            if i < notes.len() {\n                balance = balance + notes.get_unchecked(i).value;\n            }\n        }\n        if (notes.len() == options.limit) {\n            balance = balance + self.balance_of_with_offset(offset + options.limit);\n        }\n\n        balance\n    }\n}\n\nimpl BalanceSet<&mut PrivateContext> {\n    pub fn add(self: Self, addend: u128) -> MaybeNoteMessage<UintNote> {\n        let maybe_new_note = if addend == 0 as u128 {\n            Option::none()\n        } else {\n            let addend_note = UintNote { value: addend };\n\n            Option::some(self.set.insert(addend_note).get_new_note())\n        };\n\n        MaybeNoteMessage::new(maybe_new_note, self.set.context)\n    }\n\n    pub fn sub(self: Self, amount: u128) -> MaybeNoteMessage<UintNote> {\n        let subtracted = self.try_sub(amount, MAX_NOTE_HASH_READ_REQUESTS_PER_CALL);\n\n        // try_sub may have subtracted more or less than amount. We must ensure that we subtracted at least as much as\n        // we needed, and then create a new note for the owner for the change (if any).\n        assert(subtracted >= amount, \"Balance too low\");\n        self.add(subtracted - amount)\n    }\n\n    // Attempts to remove 'target_amount' from the owner's balance. try_sub returns how much was actually subtracted\n    // (i.e. the sum of the value of nullified notes), but this subtracted amount may be more or less than the target\n    // amount. This may seem odd, but is unfortunately unavoidable due to the number of notes available and their\n    // amounts being unknown. What try_sub does is a best-effort attempt to consume as few notes as possible that add\n    // up to more than `target_amount`. The `max_notes` parameter is used to fine-tune the number of constraints\n    // created by this function. The gate count scales relatively linearly with `max_notes`, but a lower `max_notes`\n    // parameter increases the likelihood of `try_sub` subtracting an amount smaller than `target_amount`.\n    pub fn try_sub(self: Self, target_amount: u128, max_notes: u32) -> u128 {\n        // We are using a preprocessor here (filter applied in an unconstrained context) instead of a filter because we\n        // do not need to prove correct execution of the preprocessor. Because the `min_sum` notes is not constrained,\n        // users could choose to e.g. not call it. However, all this might result in is simply higher DA costs due to\n        // more nullifiers being emitted. Since we don't care about proving optimal note usage, we can save these\n        // constraints and make the circuit smaller.\n        let options = NoteGetterOptions::with_preprocessor(preprocess_notes_min_sum, target_amount)\n            .sort(UintNote::properties().value, SortOrder.DESC)\n            .set_limit(max_notes);\n        let notes = self.set.pop_notes(options);\n\n        let mut subtracted = 0 as u128;\n        for i in 0..options.limit {\n            if i < notes.len() {\n                let note = notes.get_unchecked(i);\n                subtracted = subtracted + note.value;\n            }\n        }\n\n        subtracted\n    }\n}\n\n// Computes the partial sum of the notes array, stopping once 'min_sum' is reached. This can be used to minimize the\n// number of notes read that add to some value, e.g. when transferring some amount of tokens. The preprocessor (a\n// filter applied in an unconstrained context) does not check if total sum is larger or equal to 'min_sum' - all it\n// does is remove extra notes if it does reach that value. Note that proper usage of this preprocessor requires for\n// notes to be sorted in descending order.\npub fn preprocess_notes_min_sum(\n    notes: [Option<HintedNote<UintNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL],\n    min_sum: u128,\n) -> [Option<HintedNote<UintNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL] {\n    let mut selected = [Option::none(); MAX_NOTE_HASH_READ_REQUESTS_PER_CALL];\n    let mut sum = 0 as u128;\n    for i in 0..notes.len() {\n        // Because we process notes in retrieved order, notes need to be sorted in descending amount order for this\n        // filter to be useful. Consider a 'min_sum' of 4, and a set of notes with amounts [3, 2, 1, 1, 1, 1, 1]. If\n        // sorted in descending order, the filter will only choose the notes with values 3 and 2, but if sorted in\n        // ascending order it will choose 4 notes of value 1.\n        if notes[i].is_some() & sum < min_sum {\n            let hinted_note = notes[i].unwrap_unchecked();\n            selected[i] = Option::some(hinted_note);\n            sum = sum.add(hinted_note.note.value);\n        }\n    }\n    selected\n}\n"
   382	    },
   383	    "435": {
   384	      "path": "(Aztec packages source tree)/noir-projects/aztec-nr/uint-note/src/uint_note.nr",
   385	      "source": "use aztec::{\n    context::{PrivateContext, PublicContext},\n    history::nullifier::assert_nullifier_existed_by,\n    keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},\n    macros::notes::custom_note,\n    messages::{\n        logs::partial_note::encode_partial_note_private_message,\n        message_delivery::{do_private_message_delivery, MessageDelivery},\n    },\n    note::{note_interface::{NoteHash, NoteType}, utils::compute_note_nullifier},\n    oracle::random::random,\n    protocol::{\n        address::AztecAddress,\n        constants::{\n            DOM_SEP__NOTE_COMPLETION_LOG_TAG, DOM_SEP__NOTE_HASH, DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n            PRIVATE_LOG_CIPHERTEXT_LEN,\n        },\n        hash::{compute_log_tag, compute_siloed_nullifier, poseidon2_hash_with_separator},\n        traits::{Deserialize, FromField, Hash, Packable, Serialize, ToField},\n    },\n};\n\n// UintNote supports partial notes, i.e. the ability to create an incomplete note in private, hiding certain values\n// (the owner and randomness), and then completing the note in public with the ones missing (the storage slot and\n// amount). Partial notes are being actively developed and are not currently fully supported via macros, and so we\n// rely on the #[custom_note] macro to implement it manually, resulting in some boilerplate. This is expected to be\n// unnecessary once macro support is expanded.\n\n/// A private note representing a numeric value associated to an account (e.g. a token balance).\n// docs:start:uint_note_def\n#[derive(Deserialize, Eq, Serialize, Packable)]\n#[custom_note]\npub struct UintNote {\n    /// The number stored in the note.\n    pub value: u128,\n}\n// docs:end:uint_note_def\n\nimpl NoteHash for UintNote {\n    // docs:start:compute_note_hash\n    fn compute_note_hash(self, owner: AztecAddress, storage_slot: Field, randomness: Field) -> Field {\n        // Partial notes can be implemented by having the note hash be either the result of multiscalar multiplication\n        // (MSM), or two rounds of poseidon. MSM results in more constraints and is only required when multiple\n        // variants of partial notes are supported. Because UintNote has just one variant (where the value is public),\n        // we use poseidon instead.\n\n        // We must compute the same note hash as would be produced by a partial note created and completed with the\n        // same values, so that notes all behave the same way regardless of how they were created. To achieve this, we\n        // perform both steps of the partial note computation.\n\n        // First we create the partial note from a commitment to the private content.\n        let partial_note = PartialUintNote { commitment: compute_partial_commitment(owner, randomness) };\n\n        // Then compute the completion note hash. In a real partial note this step would be performed in public.\n        partial_note.compute_complete_note_hash(storage_slot, self.value)\n    }\n    // docs:end:compute_note_hash\n\n    // The nullifiers are nothing special - this is just the canonical implementation that would be injected by the\n    // #[note] macro.\n\n    fn compute_nullifier(\n        self,\n        context: &mut PrivateContext,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Field {\n        let owner_npk_m = get_public_keys(owner).npk_m;\n        let owner_npk_m_hash = owner_npk_m.hash();\n        let secret = context.request_nhk_app(owner_npk_m_hash);\n        compute_note_nullifier(note_hash_for_nullification, [secret])\n    }\n\n    unconstrained fn compute_nullifier_unconstrained(\n        self,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Option<Field> {\n        try_get_public_keys(owner).map(|public_keys| {\n            let owner_npk_m = public_keys.npk_m;\n            let owner_npk_m_hash = owner_npk_m.hash();\n            let secret = get_nhk_app(owner_npk_m_hash);\n            compute_note_nullifier(note_hash_for_nullification, [secret])\n        })\n    }\n}\n\nimpl UintNote {\n    /// Creates a partial note that will hide the owner but not the value or storage slot, since the note will be\n    /// later completed in public. This is a powerful technique for scenarios in which the value cannot be known in\n    /// private (e.g. because it depends on some public state, such as a DEX).\n    ///\n    /// This function inserts a partial note validity commitment into the nullifier tree to be later on able to verify\n    /// that the partial note and completer are legitimate. See function docs of `compute_validity_commitment` for more\n    /// details.\n    ///\n    /// Each partial note should only be used once, since otherwise multiple notes would be linked together and known\n    /// to belong to the same owner.\n    ///\n    /// As part of the partial note creation process, a log will be sent to `recipient` so that they can discover the\n    /// note. `recipient` will typically be the same as `owner`.\n    pub fn partial(\n        owner: AztecAddress,\n        context: &mut PrivateContext,\n        recipient: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialUintNote {\n        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing, so\n        // a malicious sender could use non-random values to make the note less private. But they already know the full\n        // note pre-image anyway, and so the recipient already trusts them to not disclose this information. We can\n        // therefore assume that the sender will cooperate in the random value generation.\n        let randomness = unsafe { random() };\n\n        // We create a commitment to the private data, which we then use to construct the log we send to the recipient.\n        let commitment = compute_partial_commitment(owner, randomness);\n\n        // Our partial note log encoding scheme includes a field with the tag of the public completion log, and we use\n        // the commitment as the tag. This is good for multiple reasons:\n        //  - the commitment is uniquely tied to this partial note\n        //  - the commitment is already public information, so we're not revealing anything else\n        //  - we don't need to create any additional information, private or public, for the tag\n        //  - other contracts cannot impersonate us and emit logs with the same tag due to public log siloing\n        let private_log_content = UintPartialNotePrivateLogContent {};\n\n        do_private_message_delivery(\n            context,\n            || encode_partial_note_private_message(private_log_content, owner, randomness, commitment),\n            Option::none(),\n            recipient,\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        let partial_note = PartialUintNote { commitment };\n\n        // Now we compute the validity commitment and push it to the nullifier tree. It can be safely pushed to the\n        // nullifier tree since it uses its own separator, making collisions with actual note nullifiers practically\n        // impossible.\n        let validity_commitment = partial_note.compute_validity_commitment(completer);\n        context.push_nullifier(validity_commitment);\n\n        partial_note\n    }\n}\n\n/// Computes a commitment to the private content of a partial UintNote, i.e. the fields that will remain private. All\n/// other note fields will be made public.\n// docs:start:compute_partial_commitment\nfn compute_partial_commitment(owner: AztecAddress, randomness: Field) -> Field {\n    poseidon2_hash_with_separator([owner.to_field(), randomness], DOM_SEP__NOTE_HASH)\n}\n// docs:end:compute_partial_commitment\n\n#[derive(Packable)]\n// This note does not have any non-metadata (i.e. storage slot, owner, randomness) private content, as the only field\n// (value) will be public in the partial note.\nstruct UintPartialNotePrivateLogContent {}\n\nimpl NoteType for UintPartialNotePrivateLogContent {\n    fn get_id() -> Field {\n        UintNote::get_id()\n    }\n}\n\n/// A partial instance of a UintNote. This value represents a private commitment to the owner and randomness, but the\n/// storage slot and value fields have not yet been set. A partial note can be completed in public with the `complete`\n/// function (revealing the storage slot and value to the public), resulting in a UintNote that can be used like any\n/// other one (except of course that its value is known).\n// docs:start:partial_uint_note_def\n#[derive(Packable, Serialize, Deserialize, Eq)]\npub struct PartialUintNote {\n    commitment: Field,\n}\n// docs:end:partial_uint_note_def\n\nglobal NOTE_COMPLETION_PAYLOAD_LENGTH: u32 = 2;\n\nimpl PartialUintNote {\n    /// Completes the partial note, creating a new note that can be used like any other UintNote.\n    pub fn complete(self, context: PublicContext, completer: AztecAddress, storage_slot: Field, value: u128) {\n        // A note with a value of zero is valid, but we cannot currently complete a partial note with such a value\n        // because this will result in the completion log having its last field set to 0. Public logs currently do not\n        // track their length, and so trailing zeros are simply trimmed. This results in the completion log missing its\n        // last field (the value), and note discovery failing. TODO(#11636): remove this\n        assert(value != 0, \"Cannot complete a PartialUintNote with a value of 0\");\n\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // Safety: we're using the existence of the nullifier as proof of the contract having validated the partial\n        // note's preimage, which is safe.\n        assert(\n            context.nullifier_exists_unsafe(validity_commitment, context.this_address()),\n            \"Invalid partial note or completer\",\n        );\n\n        // We need to do two things:\n        //  - emit a public log containing the public fields (the storage slot and value). The contract will later find\n        // it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        // only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        // inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        context.emit_public_log_unsafe(log_tag, [storage_slot, value.to_field()]);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, value));\n    }\n\n    /// Completes the partial note, creating a new note that can be used like any other UintNote. Same as `complete`\n    /// function but works from private context.\n    pub fn complete_from_private(\n        self,\n        context: &mut PrivateContext,\n        completer: AztecAddress,\n        storage_slot: Field,\n        value: u128,\n    ) {\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // `assert_nullifier_existed_by` function expects the nullifier to be siloed (hashed with the address of the\n        // contract that emitted the nullifier) as it checks the value directly against the nullifier tree and all the\n        // nullifiers in the tree are siloed by the protocol.\n        let siloed_validity_commitment = compute_siloed_nullifier(context.this_address(), validity_commitment);\n        assert_nullifier_existed_by(\n            context.get_anchor_block_header(),\n            siloed_validity_commitment,\n        );\n\n        // We need to do two things:\n        //  - emit an unencrypted log containing the public fields (the storage slot and value) via the private log\n        // channel. The contract will later find it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        // only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        // inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        let padded_payload = self.compute_note_completion_payload_padded_for_private_log(storage_slot, value);\n        context.emit_private_log_unsafe(log_tag, padded_payload, NOTE_COMPLETION_PAYLOAD_LENGTH);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, value));\n    }\n\n    /// Computes a validity commitment for this partial note. The commitment cryptographically binds the note's private\n    /// data with the designated completer address. When the note is later completed in public execution, we can load\n    /// this commitment from the nullifier tree and verify that both the partial note (e.g. that the storage slot\n    /// corresponds to the correct owner, and that we're using the correct state variable) and completer are\n    /// legitimate.\n    pub fn compute_validity_commitment(self, completer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator(\n            [self.commitment, completer.to_field()],\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        )\n    }\n\n    fn compute_note_completion_payload_padded_for_private_log(\n        _self: Self,\n        storage_slot: Field,\n        value: u128,\n    ) -> [Field; PRIVATE_LOG_CIPHERTEXT_LEN] {\n        let payload = [storage_slot, value.to_field()];\n        payload.concat([0; PRIVATE_LOG_CIPHERTEXT_LEN - NOTE_COMPLETION_PAYLOAD_LENGTH])\n    }\n\n    // docs:start:compute_complete_note_hash\n    fn compute_complete_note_hash(self, storage_slot: Field, value: u128) -> Field {\n        // Here we finalize the note hash by including the (public) storage slot and value into the partial note\n        // commitment. Note that we use the same separator as we used for the first round of poseidon - this is not\n        // an issue.\n        poseidon2_hash_with_separator(\n            [self.commitment, storage_slot, value.to_field()],\n            DOM_SEP__NOTE_HASH,\n        )\n    }\n    // docs:end:compute_complete_note_hash\n}\n\nimpl ToField for PartialUintNote {\n    fn to_field(self) -> Field {\n        self.commitment\n    }\n}\n\nimpl FromField for PartialUintNote {\n    fn from_field(field: Field) -> Self {\n        Self { commitment: field }\n    }\n}\n\nmod test {\n    use super::{compute_partial_commitment, PartialUintNote, UintNote};\n    use aztec::{note::note_interface::NoteHash, protocol::{address::AztecAddress, traits::FromField}};\n\n    global value: u128 = 17;\n    global randomness: Field = 42;\n    global owner: AztecAddress = AztecAddress::from_field(50);\n    global storage_slot: Field = 13;\n\n    #[test]\n    fn note_hash_matches_completed_partial_note_hash() {\n        // Tests that a UintNote has the same note hash as a PartialUintNote created and then completed with the same\n        // private values. This requires for the same hash function to be used in both flows, with the fields in the\n        // same order.\n        let note = UintNote { value };\n        let note_hash = note.compute_note_hash(owner, storage_slot, randomness);\n\n        let partial_note = PartialUintNote { commitment: compute_partial_commitment(owner, randomness) };\n        let completed_partial_note_hash = partial_note.compute_complete_note_hash(storage_slot, value);\n\n        assert_eq(note_hash, completed_partial_note_hash);\n    }\n}\n"
   386	    }
   387	  },
   388	  "functions": [
   389	    {
   390	      "abi": {
   391	        "error_types": {
   392	          "10835759466430049078": {
   393	            "error_kind": "string",
   394	            "string": "Collapse hint vec length mismatch"
   395	          },
   396	          "12913276134398371456": {
   397	            "error_kind": "string",
   398	            "string": "push out of bounds"
   399	          },
   400	          "13049348927268151465": {
   401	            "error_kind": "string",
   402	            "string": "Dirty collapsed vec storage"
   403	          },
   404	          "14990209321349310352": {
   405	            "error_kind": "string",
   406	            "string": "attempt to add with overflow"
   407	          },
   408	          "15764276373176857197": {
   409	            "error_kind": "string",
   410	            "string": "Stack too deep"
   411	          },
   412	          "16431471497789672479": {
   413	            "error_kind": "string",
   414	            "string": "Index out of bounds"
   415	          },
   416	          "18160147074902047180": {
   417	            "error_kind": "string",
   418	            "string": "Out of bounds index hint"
   419	          },
   420	          "18195344559583857168": {
   421	            "error_kind": "string",
   422	            "string": "Wrong collapsed vec length"
   423	          },
   424	          "5955197699778714817": {
   425	            "error_kind": "string",
   426	            "string": "Wrong collapsed vec order"
   427	          },
   428	          "8754864405609694316": {
   429	            "error_kind": "string",
   430	            "string": "Wrong collapsed vec content"

 succeeded in 0ms:
   500	      "path": "(aztec-standards source tree)/src/nft_contract/src/main.nr",
   501	      "source": "pub mod types;\npub mod test;\n\nuse aztec::macros::aztec;\n\n#[aztec]\npub contract NFT {\n    // aztec library\n    use aztec::{\n        authwit::auth::{\n            assert_current_call_valid_authwit, assert_current_call_valid_authwit_public,\n        },\n        context::PrivateContext,\n        macros::{\n            events::event,\n            functions::{external, initializer, internal, only_self, view},\n            storage::storage,\n        },\n        messages::message_delivery::MessageDelivery,\n        note::{\n            constants::MAX_NOTES_PER_PAGE, note_getter_options::NoteGetterOptions,\n            note_interface::NoteProperties, note_viewer_options::NoteViewerOptions,\n        },\n        protocol::{address::AztecAddress, traits::{FromField, ToField}},\n        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable, StateVariable},\n        utils::comparison::Comparator,\n    };\n    // compression library\n    use compressed_string::FieldCompressedString;\n    // nft note structs\n    use crate::types::nft_note::{NFTNote, PartialNFTNote};\n\n    /// @param symbol The symbol of the NFT\n    /// @param name The name of the NFT\n    /// @param private_nfts A map from address to a private set of NFTNotes owned by that address\n    /// @param nft_exists A map from token ID to a boolean indicating if the NFT exists\n    /// @param public_owners A map from token ID to the public owner of the NFT\n    /// @param minter The address that can mint\n    #[storage]\n    struct Storage<Context> {\n        symbol: PublicImmutable<FieldCompressedString, Context>,\n        name: PublicImmutable<FieldCompressedString, Context>,\n        private_nfts: Owned<PrivateSet<NFTNote, Context>, Context>,\n        nft_exists: Map<Field, PublicMutable<bool, Context>, Context>,\n        public_owners: Map<Field, PublicMutable<AztecAddress, Context>, Context>,\n        minter: PublicImmutable<AztecAddress, Context>,\n    }\n\n    // Sentinel address used in Transfer events to represent the private side of a balance change.\n    // sha224sum 'PRIVATE_ADDRESS'\n    global PRIVATE_ADDRESS_MAGIC_VALUE: AztecAddress =\n        AztecAddress::from_field(0x1ea7e01501975545617c2e694d931cb576b691a4a867fed81ebd3264);\n\n    #[event]\n    struct Transfer {\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n    }\n\n    /// @dev Initializes the token with a minter\n    /// @param name The name of the NFT\n    /// @param symbol The symbol of the NFT\n    /// @param minter The address of the minter\n    #[external(\"public\")]\n    #[initializer]\n    fn constructor_with_minter(name: str<31>, symbol: str<31>, minter: AztecAddress) {\n        self.storage.name.initialize(FieldCompressedString::from_string(name));\n        self.storage.symbol.initialize(FieldCompressedString::from_string(symbol));\n        self.storage.minter.initialize(minter);\n    }\n\n    /** ==========================================================\n     * ========================= PRIVATE =========================\n     * ======================================================== */\n\n    /// @notice Transfers token by id from private owner to a public owner\n    /// @dev Removes token from private owner, and enqueues a public call to update the public owner\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_private_to_public(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.enqueue_self.update_public_token_owner_from_zero_internal(to, token_id);\n    }\n\n    /// @notice Transfers token by id from private owner to a public owner with a commitment\n    /// @dev Removes token from private owner, enqueues a public call to update the public owner, and returns a commitment\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    /// @return commitment The partial nft note utilized for the transfer commitment (privacy entrance)\n    #[external(\"private\")]\n    fn transfer_private_to_public_with_commitment(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) -> Field {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.enqueue_self.update_public_token_owner_from_zero_internal(to, token_id);\n        let completer = self.msg_sender();\n        let commitment = self.internal._initialize_transfer_commitment(to, completer);\n        commitment.commitment\n    }\n\n    /// @notice Transfers token by id from private owner to another private owner\n    /// @dev Removes token by id from private owner, and sends a nft note with id to the recipient\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_private_to_private(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.internal._update_private_token_owner(to, token_id);\n    }\n\n    /// @notice Transfers token by id from private owner to the recipient commitment (recipient must create a commitment first)\n    /// @dev Removes token by id from private owner, and enqueues a public call to complete the commitment\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to transfer\n    /// @param commitment The commitment to use for the transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_private_to_commitment(\n        from: AztecAddress,\n        token_id: Field,\n        commitment: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        let completer = from;\n        self.enqueue_self.transfer_token_to_commitment_internal(\n            commitment.to_field(),\n            token_id,\n            completer,\n        );\n    }\n\n    /// @notice Transfers token by id from public owner to private owner\n    /// @dev Enqueues a public call to remove the public owner, and emits a nft note with id to the recipient\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn transfer_public_to_private(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        _validate_from_private::<4>(self.context, from);\n\n        self.enqueue_self.transfer_public_to_private_internal(from, token_id);\n        self.internal._update_private_token_owner(to, token_id);\n    }\n\n    /// @notice Initializes a transfer commitment to be used for transfers\n    /// @dev Returns a partial nft note that can be used to execute transfers\n    /// @param to The address of the recipient\n    /// @param completer The address allowed to complete the partial note\n    /// @return commitment The partial nft note utilized for the transfer commitment (privacy entrance)\n    #[external(\"private\")]\n    fn initialize_transfer_commitment(to: AztecAddress, completer: AztecAddress) -> Field {\n        let commitment = self.internal._initialize_transfer_commitment(to, completer);\n        commitment.commitment\n    }\n\n    /** ==========================================================\n     * ========================= PUBLIC ==========================\n     * ======================================================== */\n\n    /// @notice Transfers a token from one public owner to another public owner\n    /// @dev Public call that asserts that the caller is the token owner, and updates the public owner\n    /// @param from The address of the sender\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"public\")]\n    fn transfer_public_to_public(\n        from: AztecAddress,\n        to: AztecAddress,\n        token_id: Field,\n        _nonce: Field,\n    ) {\n        self.internal._validate_from_public(from);\n        self.internal._validate_public_token_owner(from, token_id);\n\n        self.internal._update_public_token_owner(to, token_id);\n        self.emit(Transfer { from, to, token_id });\n    }\n\n    /// @notice Transfers a token to a commitment\n    /// @dev Public call that asserts that the caller is the token owner, and updates the public owner, and completes the commitment\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to transfer\n    /// @param commitment The commitment to use for the transfer\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"public\")]\n    fn transfer_public_to_commitment(\n        from: AztecAddress,\n        token_id: Field,\n        commitment: Field,\n        _nonce: Field,\n    ) {\n        self.internal._validate_from_public(from);\n        self.internal._validate_public_token_owner(from, token_id);\n\n        self.internal._update_public_token_owner(AztecAddress::zero(), token_id);\n        let completer = self.msg_sender();\n        self.internal._transfer_token_to_commitment(commitment.to_field(), token_id, completer);\n        self.emit(Transfer { from, to: PRIVATE_ADDRESS_MAGIC_VALUE, token_id });\n    }\n\n    /// @notice Stores a commitment in storage\n    /// @param commitment The commitment to store\n    #[external(\"public\")]\n    #[only_self]\n    fn store_commitment_in_storage_internal(commitment: PartialNFTNote) {\n        self.internal._store_commitment_in_storage(commitment);\n    }\n\n    /// @notice Transfers a token to a commitment\n    /// @param commitment The commitment to transfer\n    /// @param token_id The id of the token to transfer\n    /// @param completer The address that is authorized to complete this commitment\n    #[external(\"public\")]\n    #[only_self]\n    fn transfer_token_to_commitment_internal(\n        commitment: Field,\n        token_id: Field,\n        completer: AztecAddress,\n    ) {\n        self.internal._transfer_token_to_commitment(commitment, token_id, completer);\n    }\n\n    /// @notice Clears the public owner and emits a Transfer event for a public-to-private transfer\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to transfer\n    #[external(\"public\")]\n    #[only_self]\n    fn transfer_public_to_private_internal(from: AztecAddress, token_id: Field) {\n        self.internal._validate_public_token_owner(from, token_id);\n        self.internal._update_public_token_owner(AztecAddress::zero(), token_id);\n        self.emit(Transfer { from, to: PRIVATE_ADDRESS_MAGIC_VALUE, token_id });\n    }\n\n    /// @notice Initializes the public token owner from zero address\n    /// @param to The address of the new owner\n    /// @param token_id The id of the token to update\n    #[external(\"public\")]\n    #[only_self]\n    fn update_public_token_owner_from_zero_internal(to: AztecAddress, token_id: Field) {\n        self.internal._update_public_token_owner(to, token_id);\n        self.emit(Transfer { from: PRIVATE_ADDRESS_MAGIC_VALUE, to, token_id });\n    }\n\n    /// @notice Finalizes a mint to private by registering the token and emitting a Transfer event\n    /// @param token_id The id of the token to mint\n    #[external(\"public\")]\n    #[only_self]\n    fn mint_to_private_internal(token_id: Field) {\n        self.internal._set_nft_exists(token_id, true);\n        self.emit(\n            Transfer { from: AztecAddress::zero(), to: PRIVATE_ADDRESS_MAGIC_VALUE, token_id },\n        );\n    }\n\n    /// @notice Finalizes a burn from private by deregistering the token and emitting a Transfer event\n    /// @param token_id The id of the token to burn\n    #[external(\"public\")]\n    #[only_self]\n    fn burn_private_internal(token_id: Field) {\n        self.internal._set_nft_exists(token_id, false);\n        self.emit(\n            Transfer { from: PRIVATE_ADDRESS_MAGIC_VALUE, to: AztecAddress::zero(), token_id },\n        );\n    }\n\n    /** ==========================================================\n     * ====================== VIEW FUNCTIONS =====================\n     * ======================================================== */\n\n    /// @return name The name of the NFT collection\n    #[external(\"public\")]\n    #[view]\n    fn public_get_name() -> pub FieldCompressedString {\n        self.storage.name.read()\n    }\n\n    /// @return symbol The symbol of the NFT collection\n    #[external(\"public\")]\n    #[view]\n    fn public_get_symbol() -> pub FieldCompressedString {\n        self.storage.symbol.read()\n    }\n\n    /// @return owner The owner of a token by id\n    #[external(\"public\")]\n    #[view]\n    fn public_owner_of(token_id: Field) -> pub AztecAddress {\n        self.storage.public_owners.at(token_id).read()\n    }\n\n    /** ==========================================================\n     * ===================== UNCONSTRAINED =======================\n     * ======================================================== */\n\n    /// @notice Returns an array of token IDs owned by `owner` in private and a flag indicating whether a page limit was reached\n    /// @dev Starts getting the notes from page with index `page_index`\n    /// @dev Zero values in the array are placeholder values for non-existing notes\n    /// @param owner The address of the owner\n    /// @param page_index The index of the page to start getting notes from\n    /// @return owned_nft_ids An array of token IDs owned by `owner`\n    /// @return page_limit_reached A flag indicating whether a page limit was reached\n    #[external(\"utility\")]\n    unconstrained fn get_private_nfts(\n        owner: AztecAddress,\n        page_index: u32,\n    ) -> pub ([Field; MAX_NOTES_PER_PAGE], bool) {\n        let offset = page_index * MAX_NOTES_PER_PAGE;\n        let mut options = NoteViewerOptions::new();\n        let nfts = self.storage.private_nfts.at(owner).view_notes(options.set_offset(offset));\n        let mut owned_nft_ids = [0; MAX_NOTES_PER_PAGE];\n        for i in 0..options.limit {\n            if i < nfts.len() {\n                owned_nft_ids[i] = nfts.get_unchecked(i).token_id;\n            }\n        }\n        let page_limit_reached = nfts.len() == options.limit;\n        (owned_nft_ids, page_limit_reached)\n    }\n\n    /** ==========================================================\n    * ======================= MINTABLE ==========================\n    * ======================================================== */\n\n    /// @notice Mints a token to a private address\n    /// @dev Asserts that the caller is an authorized minter\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to mint\n    #[external(\"private\")]\n    fn mint_to_private(to: AztecAddress, token_id: Field) {\n        assert(token_id != 0, \"zero token ID not supported\");\n        _validate_minter(self.msg_sender(), self.storage.minter.read());\n\n        self.enqueue_self.mint_to_private_internal(token_id);\n        self.storage.private_nfts.at(to).insert(NFTNote { token_id }).deliver(\n            MessageDelivery.ONCHAIN_CONSTRAINED,\n        );\n    }\n\n    /// @notice Mints a token to a public address\n    /// @dev Asserts that the caller is an authorized minter\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to mint\n    #[external(\"public\")]\n    fn mint_to_public(to: AztecAddress, token_id: Field) {\n        assert(token_id != 0, \"zero token ID not supported\");\n        _validate_minter(self.msg_sender(), self.storage.minter.read());\n\n        self.internal._set_nft_exists(token_id, true);\n        self.storage.public_owners.at(token_id).write(to);\n        self.emit(Transfer { from: AztecAddress::zero(), to, token_id });\n    }\n\n    /** ==========================================================\n     * ======================= BURNABLE ==========================\n     * ======================================================== */\n\n    /// @notice Burns a token from a private address\n    /// @dev Asserts that the caller is token owner, removes private token owner, and enqueues a public call to burn token\n    /// @param from The address of the owner\n    /// @param token_id The id of the token to burn\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"private\")]\n    fn burn_private(from: AztecAddress, token_id: Field, _nonce: Field) {\n        _validate_from_private::<3>(self.context, from);\n\n        self.internal._remove_private_token_owner(from, token_id);\n        self.enqueue_self.burn_private_internal(token_id);\n    }\n\n    /// @notice Burns a token from a public address\n    /// @dev Asserts that token exists and that the caller is token owner, removes public token owner, and burns token\n    /// @param from The address of the owner\n    /// @param token_id The id of the token to burn\n    /// @param _nonce The nonce used for authwitness\n    #[external(\"public\")]\n    fn burn_public(from: AztecAddress, token_id: Field, _nonce: Field) {\n        self.internal._validate_from_public(from);\n\n        self.internal._validate_public_token_owner(from, token_id);\n        self.internal._update_public_token_owner(AztecAddress::zero(), token_id);\n        self.internal._set_nft_exists(token_id, false);\n        self.emit(Transfer { from, to: AztecAddress::zero(), token_id });\n    }\n\n    /** ==========================================================\n     * ================= TOKEN LIBRARIES =========================\n     * ======================================================== */\n\n    /// @notice Sets the existence of a token\n    /// @dev Asserts token does not exist when setting `exists` to true (minting) and that token exists when setting `exists` to false (burning)\n    /// @param token_id The id of the token to set\n    /// @param exists The new exists value\n    #[internal(\"public\")]\n    fn _set_nft_exists(token_id: Field, exists: bool) {\n        if exists {\n            assert(!self.storage.nft_exists.at(token_id).read(), \"token already exists\");\n        } else {\n            assert(self.storage.nft_exists.at(token_id).read(), \"token does not exist\");\n        }\n        self.storage.nft_exists.at(token_id).write(exists);\n    }\n\n    /// @notice Stores a commitment in storage\n    /// @param commitment The commitment to store\n    #[internal(\"public\")]\n    fn _store_commitment_in_storage(commitment: PartialNFTNote) {\n        self.context.storage_write(commitment.commitment, true);\n    }\n\n    /// @notice Initializes a transfer commitment\n    /// @param to The address of the recipient\n    /// @param completer The address that can complete the commitment\n    /// @return commitment The partial nft note utilized for the transfer commitment (privacy entrance)\n    #[internal(\"private\")]\n    fn _initialize_transfer_commitment(\n        to: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialNFTNote {\n        let commitment = NFTNote::partial(to, self.context, to, completer);\n        self.enqueue_self.store_commitment_in_storage_internal(commitment);\n        commitment\n    }\n\n    /// @notice Updates the private token owner\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to update\n    #[internal(\"private\")]\n    fn _update_private_token_owner(to: AztecAddress, token_id: Field) {\n        let new_note = NFTNote { token_id };\n        self.storage.private_nfts.at(to).insert(new_note).deliver(\n            MessageDelivery.ONCHAIN_CONSTRAINED,\n        );\n    }\n\n    /// @notice Removes the private token owner\n    /// @param from The address of the owner\n    /// @param token_id The id of the token to remove\n    #[internal(\"private\")]\n    fn _remove_private_token_owner(from: AztecAddress, token_id: Field) {\n        let notes = self.storage.private_nfts.at(from).pop_notes(NoteGetterOptions::new()\n            .select(NFTNote::properties().token_id, Comparator.EQ, token_id)\n            .set_limit(1));\n        assert(notes.len() == 1, \"nft not found\");\n    }\n\n    /// @notice Updates the public token owner\n    /// @param to The address of the recipient\n    /// @param token_id The id of the token to update\n    #[internal(\"public\")]\n    fn _update_public_token_owner(to: AztecAddress, token_id: Field) {\n        self.storage.public_owners.at(token_id).write(to);\n    }\n\n    /// @notice Transfers a token to a commitment\n    /// @dev Asserts that a commitment is valid, and completes it\n    /// @param commitment The commitment to complete\n    /// @param token_id The id of the token to transfer\n    /// @param completer The address that is authorized to complete this commitment\n    #[internal(\"public\")]\n    fn _transfer_token_to_commitment(commitment: Field, token_id: Field, completer: AztecAddress) {\n        // We verify that the commitment we're completing is valid (i.e. it uses the correct state variable's storage\n        // slot, and it is internally consistent). We *could* clear the storage since each commitment should only be\n        // used once, but since the AVM offers no gas refunds for doing so this would just make the transaction be more\n        // expensive.\n        assert(self.context.storage_read(commitment), \"invalid commitment\");\n        PartialNFTNote { commitment }.complete(\n            self.context,\n            completer,\n            self.storage.private_nfts.get_storage_slot(),\n            token_id,\n        );\n    }\n\n    /// @notice Validates that the caller is the owner of a token\n    /// @param from The address of the sender\n    /// @param token_id The id of the token to validate\n    #[internal(\"public\")]\n    fn _validate_public_token_owner(from: AztecAddress, token_id: Field) {\n        let owner = self.storage.public_owners.at(token_id).read();\n        assert(owner.eq(from), \"caller is not owner\");\n    }\n\n    /// @notice Validates that the caller is an authorized minter\n    /// @param sender The address of the caller\n    /// @param minter The address of the minter\n    #[contract_library_method]\n    fn _validate_minter(sender: AztecAddress, minter: AztecAddress) {\n        assert(minter.eq(sender), \"caller is not minter\");\n    }\n\n    /** ==========================================================\n     * ================== AUTH LIBRARIES =========================\n     * ======================================================== */\n\n    /// @notice Validates that the caller possesses authwit from the `from` address or the caller is the `from` address\n    /// @param context The context of the private call\n    /// @param from The address of the sender\n    #[contract_library_method]\n    fn _validate_from_private<let N: u32>(context: &mut PrivateContext, from: AztecAddress) {\n        if (!from.eq(context.maybe_msg_sender().unwrap())) {\n            assert_current_call_valid_authwit::<N>(context, from);\n        }\n    }\n\n    /// @notice Validates that the caller possesses authwit from the `from` address or the caller is the `from` address\n    /// @param from The address of the sender\n    #[internal(\"public\")]\n    fn _validate_from_public(from: AztecAddress) {\n        if (!from.eq(self.msg_sender())) {\n            assert_current_call_valid_authwit_public(self.context, from);\n        }\n    }\n}\n"
   502	    },
   503	    "499": {
   504	      "path": "(aztec-standards source tree)/src/nft_contract/src/types/nft_note.nr",
   505	      "source": "use aztec::{\n    context::{PrivateContext, PublicContext},\n    keys::getters::{get_nhk_app, get_public_keys, try_get_public_keys},\n    macros::notes::custom_note,\n    messages::{\n        logs::partial_note::encode_partial_note_private_message,\n        message_delivery::{do_private_message_delivery, MessageDelivery},\n    },\n    note::{note_interface::{NoteHash, NoteType}, utils::compute_note_nullifier},\n    oracle::random::random,\n    protocol::{\n        address::AztecAddress,\n        constants::{\n            DOM_SEP__NOTE_COMPLETION_LOG_TAG, DOM_SEP__NOTE_HASH,\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        },\n        hash::{compute_log_tag, poseidon2_hash_with_separator},\n        traits::{Deserialize, Hash, Packable, Serialize, ToField},\n    },\n};\n\n// NFTNote supports partial notes, i.e. the ability to create an incomplete note in private, hiding certain values (the\n// owner, storage slot and randomness), and then completing the note in public with the ones missing (the token id).\n// Partial notes are being actively developed and are not currently fully supported via macros, and so we rely on the\n// #[custom_note] macro to implement it manually, resulting in some boilerplate. This is expected to be unnecessary once\n// macro support is expanded.\n\n/// A private note representing a token id associated to an account.\n#[derive(Eq, Serialize, Packable)]\n#[custom_note]\npub struct NFTNote {\n    /// The ID of the token represented by this note.\n    pub token_id: Field,\n}\n\nimpl NoteHash for NFTNote {\n    fn compute_note_hash(\n        self,\n        owner: AztecAddress,\n        storage_slot: Field,\n        randomness: Field,\n    ) -> Field {\n        // Partial notes can be implemented by having the note hash be either the result of multiscalar multiplication\n        // (MSM), or two rounds of poseidon. MSM results in more constraints and is only required when multiple variants\n        // of partial notes are supported. Because NFTNote has just one variant (where the token id is public), we use\n        // poseidon instead.\n\n        // We must compute the same note hash as would be produced by a partial note created and completed with the same\n        // values, so that notes all behave the same way regardless of how they were created. To achieve this, we\n        // perform both steps of the partial note computation.\n\n        // First we create the partial note from a commitment to the private content (including storage slot).\n        let partial_note =\n            PartialNFTNote { commitment: compute_partial_commitment(owner, randomness) };\n\n        // Then compute the completion note hash. In a real partial note this step would be performed in public.\n        partial_note.compute_complete_note_hash(storage_slot, self.token_id)\n    }\n\n    // The nullifiers are nothing special - this is just the canonical implementation that would be injected by the\n    // #[note] macro.\n\n    fn compute_nullifier(\n        self,\n        context: &mut PrivateContext,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Field {\n        let owner_npk_m = get_public_keys(owner).npk_m;\n        let owner_npk_m_hash = owner_npk_m.hash();\n        let secret = context.request_nhk_app(owner_npk_m_hash);\n        compute_note_nullifier(note_hash_for_nullification, [secret])\n    }\n\n    unconstrained fn compute_nullifier_unconstrained(\n        self,\n        owner: AztecAddress,\n        note_hash_for_nullification: Field,\n    ) -> Option<Field> {\n        try_get_public_keys(owner).map(|public_keys| {\n            let owner_npk_m = public_keys.npk_m;\n            let owner_npk_m_hash = owner_npk_m.hash();\n            let secret = get_nhk_app(owner_npk_m_hash);\n            compute_note_nullifier(note_hash_for_nullification, [secret])\n        })\n    }\n}\n\nimpl NFTNote {\n    /// Creates a partial note that will hide the owner and storage slot but not the token id, since the note will be\n    /// later completed in public. This is a powerful technique for scenarios in which the token id cannot be known in\n    /// private (e.g. because it depends on some public state, such as a DEX).\n    ///\n    /// This function inserts a partial note validity commitment into the nullifier tree to be later on able to verify\n    /// that the partial note and completer are legitimate. See function docs of `compute_validity_commitment` for more\n    /// details.\n    ///\n    /// Each partial note should only be used once, since otherwise multiple notes would be linked together and known to\n    /// belong to the same owner.\n    ///\n    /// As part of the partial note creation process, a log will be sent to `recipient` from `sender` so that they can\n    /// discover the note. `recipient` will typically be the same as `owner`.\n    pub fn partial(\n        owner: AztecAddress,\n        context: &mut PrivateContext,\n        recipient: AztecAddress,\n        completer: AztecAddress,\n    ) -> PartialNFTNote {\n        // Safety: We use the randomness to preserve the privacy of the note recipient by preventing brute-forcing,\n        // so a malicious sender could use non-random values to make the note less private. But they already know\n        // the full note pre-image anyway, and so the recipient already trusts them to not disclose this\n        // information. We can therefore assume that the sender will cooperate in the random value generation.\n        let randomness = unsafe { random() };\n\n        // We create a commitment to the private data, which we then use to construct the log we send to the recipient.\n        let commitment = compute_partial_commitment(owner, randomness);\n\n        // Our partial note log encoding scheme includes a field with the tag of the public completion log, and we use\n        // the commitment as the tag. This is good for multiple reasons:\n        //  - the commitment is uniquely tied to this partial note\n        //  - the commitment is already public information, so we're not revealing anything else\n        //  - we don't need to create any additional information, private or public, for the tag\n        //  - other contracts cannot impersonate us and emit logs with the same tag due to public log siloing\n        let private_log_content = NFTPartialNotePrivateLogContent {};\n\n        do_private_message_delivery(\n            context,\n            || {\n                encode_partial_note_private_message(\n                    private_log_content,\n                    owner,\n                    randomness,\n                    commitment,\n                )\n            },\n            Option::none(),\n            recipient,\n            MessageDelivery.ONCHAIN_UNCONSTRAINED,\n        );\n\n        let partial_note = PartialNFTNote { commitment };\n\n        // Now we compute the validity commitment and push it to the nullifier tree. It can be safely pushed to\n        // the nullifier tree since it uses its own separator, making collisions with actual note nullifiers\n        // practically impossible.\n        let validity_commitment = partial_note.compute_validity_commitment(completer);\n        context.push_nullifier(validity_commitment);\n\n        partial_note\n    }\n}\n\n/// Computes a commitment to the private content of a partial NFTNote, i.e. the fields that will remain private. All\n/// other note fields will be made public.\nfn compute_partial_commitment(owner: AztecAddress, randomness: Field) -> Field {\n    poseidon2_hash_with_separator([owner.to_field(), randomness], DOM_SEP__NOTE_HASH)\n}\n\n#[derive(Packable)]\n// This note does not have any non-metadata (i.e. storage slot, owner, randomness) private content, as the only field\n// (token_id) will be public in the partial note.\nstruct NFTPartialNotePrivateLogContent {}\n\nimpl NoteType for NFTPartialNotePrivateLogContent {\n    fn get_id() -> Field {\n        NFTNote::get_id()\n    }\n}\n\n/// A partial instance of a NFTNote. This value represents a private commitment to the owner, randomness and storage\n/// slot, but the token id field has not yet been set. A partial note can be completed in public with the `complete`\n/// function (revealing the token id to the public), resulting in a NFTNote that can be used like any other one (except\n/// of course that its token id is known).\n#[derive(Packable, Serialize, Deserialize)]\npub struct PartialNFTNote {\n    pub commitment: Field,\n}\n\nimpl PartialNFTNote {\n    /// Completes the partial note, creating a new note that can be used like any other NFTNote.\n    pub fn complete(\n        self,\n        context: PublicContext,\n        completer: AztecAddress,\n        storage_slot: Field,\n        token_id: Field,\n    ) {\n        // A note with a value of zero is valid, but we cannot currently complete a partial note with such a value\n        // because this will result in the completion log having its last field set to 0. Public logs currently do not\n        // track their length, and so trailing zeros are simply trimmed. This results in the completion log missing its\n        // last field (the value), and note discovery failing.\n        // TODO(#11636): remove this\n        assert(token_id != 0, \"Cannot complete a PartialNFTNote with a value of 0\");\n\n        // We verify that the partial note we're completing is valid (i.e. completer is correct, it uses the correct\n        // state variable's storage slot, and it is internally consistent).\n        let validity_commitment = self.compute_validity_commitment(completer);\n        // Safety: we're using the existence of the nullifier as proof of the contract having validated the partial\n        // note's preimage, which is safe.\n        assert(\n            context.nullifier_exists_unsafe(validity_commitment, context.this_address()),\n            \"Invalid partial note or completer\",\n        );\n\n        // We need to do two things:\n        //  - emit a public log containing the public fields (the storage slot and token id). The contract will later\n        //  find it by searching for the domain-separated commitment as the tag.\n        //  - insert the completion note hash (i.e. the hash of the note) into the note hash tree. This is typically\n        //  only done in private to hide the preimage of the hash that is inserted, but completed partial notes are\n        //  inserted in public as the public values are provided and the note hash computed.\n        let log_tag = compute_log_tag(self.commitment, DOM_SEP__NOTE_COMPLETION_LOG_TAG);\n        context.emit_public_log_unsafe(log_tag, [storage_slot, token_id]);\n        context.push_note_hash(self.compute_complete_note_hash(storage_slot, token_id));\n    }\n\n    /// Computes a validity commitment for this partial note. The commitment cryptographically binds the note's private\n    /// data with the designated completer address. When the note is later completed in public execution, we can load\n    /// this commitment from the nullifier tree and verify that both the partial note (e.g. that the storage slot\n    /// corresponds to the correct owner, and that we're using the correct state variable) and completer are\n    /// legitimate.\n    pub fn compute_validity_commitment(self, completer: AztecAddress) -> Field {\n        poseidon2_hash_with_separator(\n            [self.commitment, completer.to_field()],\n            DOM_SEP__PARTIAL_NOTE_VALIDITY_COMMITMENT,\n        )\n    }\n\n    fn compute_complete_note_hash(self, storage_slot: Field, token_id: Field) -> Field {\n        // Here we finalize the note hash by including the (public) storage slot and token id into the partial note\n        // commitment. Note that we use the same separator as we used for the first round of poseidon - this is not\n        // an issue.\n        poseidon2_hash_with_separator(\n            [self.commitment, storage_slot, token_id],\n            DOM_SEP__NOTE_HASH,\n        )\n    }\n}\n"
   506	    }
   507	  },
   508	  "functions": [
   509	    {
   510	      "abi": {
   511	        "error_types": {
   512	          "10522114655416116165": {
   513	            "error_kind": "string",
   514	            "string": "Can't read a transient note with a zero contract address"
   515	          },
   516	          "10835759466430049078": {
   517	            "error_kind": "string",
   518	            "string": "Collapse hint vec length mismatch"
   519	          },
   520	          "11088061827347467743": {
   521	            "error_kind": "string",
   522	            "string": "Note owner mismatch."
   523	          },
   524	          "12236415031589006904": {
   525	            "error_kind": "string",
   526	            "string": "Obtained invalid key validation request"
   527	          },
   528	          "12327971061804302172": {
   529	            "error_kind": "fmtstring",
   530	            "item_types": [],
   531	            "length": 98
   532	          },
   533	          "12469291177396340830": {
   534	            "error_kind": "string",
   535	            "string": "call to assert_max_bit_size"
   536	          },
   537	          "12913276134398371456": {
   538	            "error_kind": "string",
   539	            "string": "push out of bounds"
   540	          },
   541	          "13049348927268151465": {
   542	            "error_kind": "string",
   543	            "string": "Dirty collapsed vec storage"
   544	          },
   545	          "13439285339951107770": {
   546	            "error_kind": "string",
   547	            "string": "Infinite public key points are not allowed"
   548	          },
   549	          "13671158251341025138": {
   550	            "error_kind": "string",
   551	            "string": "Got more notes than limit."
   552	          },
   553	          "14990209321349310352": {
   554	            "error_kind": "string",
   555	            "string": "attempt to add with overflow"
   556	          },
   557	          "15015303112667403944": {
   558	            "error_kind": "fmtstring",
   559	            "item_types": [],
   560	            "length": 17

codex
The storage and note-shape checks line up so far. I’m tracing the smart-tighten and contract-resolution paths now, because that’s where a “just add two artifacts” change can still have a real behavior shift.
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/service.ts | sed -n '1480,1545p'" in (project root)
 succeeded in 0ms:
  1480		}
  1481	
  1482		private async executeAztecRegisterSender(op: AztecRegisterSenderOperation): Promise<AztecAddress> {
  1483			const network = await this.networkService.getNetwork(op.networkId)
  1484			return this.pxeService.registerSender(networkInfoFrom(network), op.address)
  1485		}
  1486	
  1487		private async executeAztecGetAddressBook(_op: AztecGetAddressBookOperation): Promise<Aliased<AztecAddress>[]> {
  1488			// TODO: filter by chainId
  1489			return (await this.contactService.getContacts()).map((x) => ({
  1490				alias: x.name,
  1491				item: AztecAddress.fromString(x.address),
  1492			}))
  1493		}
  1494	
  1495		private async executeAztecRegisterContract(op: AztecRegisterContractOperation): Promise<ContractInstanceWithAddress> {
  1496			const instance = await ContractInstanceWithAddressSchema.parseAsync(op.instance)
  1497			const network = await this.networkService.getNetwork(op.networkId)
  1498	
  1499			const addressNum = instance.address.toBigInt()
  1500			if (addressNum >= 0 && addressNum <= 6) {
  1501				return instance
  1502			}
  1503	
  1504			let providedArtifact: ContractArtifact | undefined
  1505			try {
  1506				providedArtifact = await ContractArtifactSchema.optional().parseAsync(op.artifact)
  1507			} catch {
  1508				// artifact parse failed — will fall back to lookup below
  1509			}
  1510	
  1511			// Smart-tighten: if the dApp didn't pass an artifact, the wallet can
  1512			// still resolve it via the chain's PXE (already-registered) or the
  1513			// compiled-in known bundle (Aztec/Wonderland tokens, FPCs, NFTs,
  1514			// etc.). When neither has it, fail loudly with a message telling
  1515			// the dApp to pass `artifact` — there is no remote registry fallback.
  1516			const classId = instance.currentContractClassId
  1517			const artifact = providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), classId))
  1518			if (!artifact) {
  1519				throw new Error(
  1520					`Contract artifact not found for class ${classId}. ` +
  1521						"The wallet only ships artifacts for the standard bundled contracts; " +
  1522						"pass the artifact in aztec_registerContract({ instance, artifact }) for custom contracts.",
  1523				)
  1524			}
  1525	
  1526			const contractClass = await getContractClassFromArtifact(artifact)
  1527			if (contractClass.id.toString() !== instance.currentContractClassId.toString()) {
  1528				throw new Error("Contract artifact doesn't match instance's current class id")
  1529			}
  1530	
  1531			await this.pxeService.registerContract(networkInfoFrom(network), { instance, artifact })
  1532	
  1533			if (op.secretKey) {
  1534				await this.pxeService.registerAccount(networkInfoFrom(network), op.secretKey, await computePartialAddress(instance))
  1535			}
  1536	
  1537			return instance
  1538		}
  1539	
  1540		private async executeAztecSimulateTx(op: AztecSimulateTxOperation): Promise<TxSimulationResult> {
  1541			if (op.accountAddress !== op.opts?.from?.toString()) {
  1542				throw new Error("Invalid `opts.from`")
  1543			}
  1544	
  1545			const [actions, feePaymentMethod, fee] = await this.planner.processAztecJsPayload(op.exec, op.opts)

exec
/bin/zsh -lc "rg -n '@private-fpc-artifact|@wonderland-nft-artifact|@wonderland-token-artifact|PrivateFPCContractArtifact|WonderlandNFT' packages/extension packages/aztec-runtime -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/aztec-runtime/src/pxe/known-artifacts.ts:19:import WonderlandTokenJson from "@wonderland-token-artifact"
packages/aztec-runtime/src/pxe/note-schemas.ts:6:import WonderlandTokenJson from "@wonderland-token-artifact"
packages/extension/vitest.config.ts:39:			"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
packages/extension/vitest.config.ts:40:			"@wonderland-token-artifact": resolvePackageFile(
packages/extension/vite.config.ts:45:			"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
packages/extension/vite.config.ts:46:			"@wonderland-token-artifact": resolvePackageFile(
packages/extension/src/wallet/services/note/note-schemas.test.ts:22:import WonderlandTokenJson from "@wonderland-token-artifact"
packages/extension/src/wallet/services/fpc/service.ts:19:import PrivateFPCJson from "@private-fpc-artifact"
packages/extension/src/wallet/services/fpc/service.ts:22:const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)
packages/extension/src/wallet/services/fpc/service.ts:118:				const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
packages/extension/src/wallet/services/fpc/service.ts:124:				toDiscover.push({ instance, artifact: PrivateFPCContractArtifact })

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/pxe/artifact-registry.test.ts | sed -n '160,215p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/aztec-runtime/src/pxe/service.ts | sed -n '100,150p'" in (project root)
 succeeded in 0ms:
   160				instances: new Map([["0xabc", instance]]),
   161			})
   162			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
   163			expect(reg.getKnownInstance("0xabc")).toBeUndefined()
   164			await reg.ensureKnown()
   165			expect(reg.getKnownInstance("0xabc")).toBe(instance)
   166		})
   167	})
   168	
   169	describe("ArtifactRegistry.hasKnownClassId — smart-tighten support", () => {
   170		test("returns true for class-id in the bundle", async () => {
   171			const classId = new Fr(1234)
   172			const loader: KnownArtifactsLoader = async () => ({
   173				artifacts: new Map([[classId.toString(), makeArtifact("bundled")]]),
   174				instances: new Map(),
   175			})
   176			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
   177			expect(await reg.hasKnownClassId(classId)).toBe(true)
   178		})
   179	
   180		test("returns false for class-id not in the bundle", async () => {
   181			const known = new Fr(1)
   182			const unknown = new Fr(2)
   183			const loader: KnownArtifactsLoader = async () => ({
   184				artifacts: new Map([[known.toString(), makeArtifact("only-this")]]),
   185				instances: new Map(),
   186			})
   187			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
   188			expect(await reg.hasKnownClassId(unknown)).toBe(false)
   189			expect(await reg.hasKnownClassId(known)).toBe(true)
   190		})
   191	
   192		test("returns false on empty bundle", async () => {
   193			const reg = new ArtifactRegistry(emptyLoader, { verifier: passthroughVerifier })
   194			expect(await reg.hasKnownClassId(new Fr(99))).toBe(false)
   195		})
   196	
   197		test("triggers lazy load of the bundle on first call", async () => {
   198			let loadCount = 0
   199			const classId = new Fr(7)
   200			const loader: KnownArtifactsLoader = async () => {
   201				loadCount++
   202				return { artifacts: new Map([[classId.toString(), makeArtifact("v")]]), instances: new Map() }
   203			}
   204			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
   205			expect(loadCount).toBe(0)
   206			expect(await reg.hasKnownClassId(classId)).toBe(true)
   207			expect(loadCount).toBe(1)
   208			// second call uses the cached bundle
   209			expect(await reg.hasKnownClassId(classId)).toBe(true)
   210			expect(loadCount).toBe(1)
   211		})
   212	})
   213	
   214	/**
   215	 * M4.3 trust-enforcement contract: every artifact returned to the

 succeeded in 0ms:
   100							}
   101						})
   102					}
   103				}
   104			}
   105	
   106			this.profiles.onProfileDeleted.add(this.onProfileDeleted)
   107			this.profiles.onActiveProfileChanged.add(this.onActiveProfileChanged)
   108			await this.profiles.connect()
   109		}
   110	
   111		public async getContractInstance(
   112			network: NetworkInfo,
   113			address: AztecAddress,
   114			opts?: { pxeOnly?: boolean },
   115		): Promise<ContractInstanceWithAddress | undefined> {
   116			address = await AztecAddress.schema.parseAsync(address)
   117			return this.withPxeRead("getContractInstance", network, async (pxe, node) => {
   118				let instance = await pxe.getContractInstance(address)
   119				if (!instance && !opts?.pxeOnly) {
   120					instance = await node.getContract(address)
   121					if (!instance) {
   122						await this.artifacts.ensureKnown()
   123						instance = this.artifacts.getKnownInstance(address.toString())
   124					}
   125				}
   126				return instance
   127			})
   128		}
   129	
   130		public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
   131			id = await Fr.schema.parseAsync(id)
   132			return this.withPxeRead("getContractArtifact", network, async (pxe) => {
   133				return this.artifacts.resolve(id, (classId) => pxe.getContractArtifact(classId), network, opts)
   134			})
   135		}
   136	
   137		public async getNoteSchemas(): Promise<Record<string, Record<string, NoteSchema>>> {
   138			const schemas = await loadProductionNoteSchemas()
   139			const out: Record<string, Record<string, NoteSchema>> = {}
   140			for (const [classId, slots] of schemas) {
   141				out[classId] = Object.fromEntries(slots)
   142			}
   143			return out
   144		}
   145	
   146		public async registerAccount(network: NetworkInfo, secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
   147			return this.withPxeWrite("registerAccount", network, async (pxe) =>
   148				pxe.registerAccount(await Fr.schema.parseAsync(secretKey), await Fr.schema.parseAsync(partialAddress)),
   149			)
   150		}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/fpc/service.ts | sed -n '1,240p'" in (project root)
 succeeded in 0ms:
     1	import { AztecAddress } from "@aztec/stdlib/aztec-address"
     2	import type { ILogger } from "@/wallet/logger"
     3	import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
     4	import { Service } from "@nulo/extension-messaging/background"
     5	import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
     6	import { NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
     7	import { PxeServiceClient } from "@/wallet/services/pxe/client"
     8	import { EntityStorage } from "@/wallet/storage"
     9	import { getRandomHex, Lock } from "@/wallet/utils"
    10	import { resolveNetworkByChainId } from "@/wallet/utils/caip"
    11	import { EventHandler } from "@nulo/wallet-core/utils"
    12	import { Fpc } from "./fpc"
    13	import { getFpcHandler } from "./handlers"
    14	import { type Events, FPC_SERVICE_NAME, type FpcInfo, FpcType, type Methods } from "./spec"
    15	import { getContractInstanceFromInstantiationParams, type ContractInstanceWithAddress } from "@aztec/stdlib/contract"
    16	import { loadContractArtifact, type ContractArtifact } from "@aztec/stdlib/abi"
    17	import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
    18	// @ts-expect-error — raw JSON import via vite alias, bypasses @aztec/aztec.js (which references document/window)
    19	import PrivateFPCJson from "@private-fpc-artifact"
    20	import { Fr } from "@aztec/foundation/curves/bn254"
    21	
    22	const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)
    23	
    24	export * from "./fpc"
    25	export * from "./spec"
    26	
    27	export class FpcService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    28		public static name = FPC_SERVICE_NAME
    29	
    30		public readonly onFpcAdded = new EventHandler<FpcInfo>()
    31		public readonly onFpcUpdated = new EventHandler<FpcInfo>()
    32		public readonly onFpcDeleted = new EventHandler<FpcInfo>()
    33	
    34		private readonly storage = new EntityStorage<FpcInfo>("nulo:core:fpcs", chrome.storage.local)
    35		private readonly lock = new Lock("fpc", this.logger)
    36	
    37		private pxeService: PxeServiceClient = null!
    38		private profileService: ProfileService = null!
    39		private networkService: NetworkService = null!
    40	
    41		public constructor(logger: ILogger) {
    42			super(FPC_SERVICE_NAME, logger)
    43		}
    44	
    45		protected async init(services: ServiceCollection) {
    46			this.pxeService = new PxeServiceClient(this.logger)
    47			this.profileService = services.get(ProfileService.name)
    48			this.networkService = services.get(NetworkService.name)
    49			this.profileService.onProfileDeleted.add(this.onProfileDeleted)
    50			this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))
    51		}
    52	
    53		/**
    54		 * Wipe FPC entries for `(profileId, chainId)`. Emits `onFpcDeleted` per
    55		 * fpc. Called by `NetworkService.purgeChain`.
    56		 */
    57		public async clearChainState(profileId: string, chainId: number): Promise<void> {
    58			await this.ensureInitialized()
    59			const fpcs = (await this.storage.getValues()).filter((f) => f.profileId === profileId && f.chainId === chainId)
    60			for (const fpc of fpcs) {
    61				await this.storage.delete(fpc.id)
    62				this.emit("onFpcDeleted", fpc)
    63			}
    64		}
    65	
    66		public async getFpcs(chainId?: number): Promise<FpcInfo[]> {
    67			await this.ensureInitialized()
    68			const profile = await this.profileService.getActiveProfile()
    69			if (!profile) {
    70				throw new Error("Profile locked")
    71			}
    72			const allFpcs = await this.storage.getValues()
    73			let result = allFpcs.filter((fpc) => fpc.profileId === profile.id && (chainId === undefined || fpc.chainId === chainId))
    74			this.logDebug(
    75				`getFpcs: chainId=${chainId}, allFpcs=${allFpcs.length}, filtered=${result.length}, types=${result.map((f) => `${f.type}:${f.name}`).join(", ")}`,
    76			)
    77			if (chainId === undefined) return result
    78	
    79			// Auto-discover missing protocol FPCs (SponsoredFPC, PrivateFPC)
    80			const missingBeforeLock =
    81				!result.some((f) => f.type === FpcType.DefaultSponsoredFpc) || !result.some((f) => f.type === FpcType.PrivateFpc)
    82			if (!missingBeforeLock) return result
    83	
    84			this.logInfo("Discovering missing protocol FPCs...")
    85			try {
    86				await this.lock.enter()
    87	
    88				// Re-read storage now that we hold the lock. A prior holder in the
    89				// queue may have just completed discovery — if so, skip the PXE
    90				// work entirely. Without this, every queued caller independently
    91				// re-runs the full registration chain against stale state, and
    92				// one wedged PXE call pins ALL of them for up to Lock.MAX_HOLD_MS.
    93				const freshAllFpcs = await this.storage.getValues()
    94				result = freshAllFpcs.filter((fpc) => fpc.profileId === profile.id && fpc.chainId === chainId)
    95				const hasSponsoredFpc = result.some((f) => f.type === FpcType.DefaultSponsoredFpc)
    96				const hasPrivateFpc = result.some((f) => f.type === FpcType.PrivateFpc)
    97				this.logDebug(`getFpcs (under lock): hasSponsoredFpc=${hasSponsoredFpc}, hasPrivateFpc=${hasPrivateFpc}`)
    98				if (hasSponsoredFpc && hasPrivateFpc) {
    99					this.logDebug("Discovery skipped — already completed by concurrent holder")
   100					return result
   101				}
   102	
   103				const network = await resolveNetworkByChainId(this.networkService, chainId)
   104				const node = await this.networkService.getNode(network.chainId)
   105				const pxe = this.pxeService.getPXE(networkInfoFrom(network))
   106	
   107				const toDiscover: { instance: ContractInstanceWithAddress; artifact: ContractArtifact }[] = []
   108	
   109				if (!hasSponsoredFpc) {
   110					const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
   111						constructorArgs: [],
   112						salt: Fr.zero(),
   113					})
   114					this.logDebug(`getFpcs: SponsoredFPC instance address=${instance.address.toString()}`)
   115					toDiscover.push({ instance, artifact: SponsoredFPCContractArtifact })
   116				}
   117				if (!hasPrivateFpc) {
   118					const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
   119						constructorArgs: [],
   120						salt: Fr.zero(),
   121						deployer: AztecAddress.ZERO,
   122					})
   123					this.logDebug(`getFpcs: PrivateFPC instance address=${instance.address.toString()}`)
   124					toDiscover.push({ instance, artifact: PrivateFPCContractArtifact })
   125				}
   126	
   127				for (const { instance: contractInstance, artifact: contractArtifact } of toDiscover) {
   128					try {
   129						await pxe.registerContract({ instance: contractInstance, artifact: contractArtifact })
   130						this.logInfo(`Registered protocol FPC: ${contractInstance.address.toString()}`)
   131	
   132						const type = this.detectFpcType(contractArtifact)
   133						const fpcHandler = getFpcHandler(type)
   134						fpcHandler.validateArtifact(contractArtifact)
   135	
   136						const asset = await fpcHandler.getAsset(contractInstance.address.toString(), pxe, node)
   137						const acceptsPrivate = fpcHandler.acceptsPrivate()
   138						const acceptsPublic = fpcHandler.acceptsPublic()
   139	
   140						let id: string
   141						do {
   142							id = getRandomHex(8)
   143						} while (await this.storage.contains(id))
   144						const fpc: FpcInfo = {
   145							id,
   146							profileId: profile.id,
   147							chainId,
   148							type,
   149							address: contractInstance.address.toString(),
   150							name: type === FpcType.PrivateFpc ? "Private Fee Juice" : undefined,
   151							asset,
   152							acceptsPrivate,
   153							acceptsPublic,
   154						}
   155						await this.storage.set(id, fpc)
   156						result.push(fpc)
   157					} catch (err) {
   158						this.logWarn(`getFpcs: Failed to discover FPC ${contractInstance.address.toString()}:`, err)
   159						this.logError(`Failed to discover FPC ${contractInstance.address.toString()}`, err)
   160					}
   161				}
   162			} finally {
   163				this.lock.leave()
   164			}
   165			return result
   166		}
   167	
   168		public async getFpc(id: string): Promise<FpcInfo> {
   169			await this.ensureInitialized()
   170			const profile = await this.profileService.getActiveProfile()
   171			if (!profile) {
   172				throw new Error("Profile locked")
   173			}
   174			const fpcInfo = await this.storage.get(id)
   175			if (fpcInfo?.profileId !== profile.id) {
   176				throw new Error("Invalid id")
   177			}
   178			return fpcInfo
   179		}
   180	
   181		public async addFpc(networkId: string, type: FpcType, address: string, name?: string): Promise<FpcInfo> {
   182			await this.ensureInitialized()
   183			const profile = await this.profileService.getActiveProfile()
   184			if (!profile) {
   185				throw new Error("Profile locked")
   186			}
   187			const network = await this.networkService.getNetwork(networkId)
   188			const node = await this.networkService.getNode(network.chainId)
   189			const pxe = this.pxeService.getPXE(networkInfoFrom(network))
   190	
   191			const fpcInstance = await pxe.getContractInstance(AztecAddress.fromString(address))
   192			if (!fpcInstance) {
   193				throw new Error("Contract instance not found")
   194			}
   195	
   196			const fpcArtifact = await pxe.getContractArtifact(fpcInstance.currentContractClassId)
   197			if (!fpcArtifact) {
   198				throw new Error("Contract artifact not found")
   199			}
   200	
   201			const registeredContracts = await pxe.getContracts()
   202			if (!registeredContracts.find((x) => x.toString() === address)) {
   203				await pxe.registerContract({
   204					instance: fpcInstance,
   205					artifact: fpcArtifact,
   206				})
   207			}
   208	
   209			const fpcHandler = getFpcHandler(type)
   210			fpcHandler.validateArtifact(fpcArtifact)
   211	
   212			const asset = await fpcHandler.getAsset(address, pxe, node)
   213			const acceptsPrivate = fpcHandler.acceptsPrivate()
   214			const acceptsPublic = fpcHandler.acceptsPublic()
   215	
   216			try {
   217				await this.lock.enter()
   218				let id: string
   219				do {
   220					id = getRandomHex(8)
   221				} while (await this.storage.contains(id))
   222				const fpc: FpcInfo = {
   223					id,
   224					profileId: profile.id,
   225					chainId: network.chainId,
   226					type,
   227					address,
   228					name,
   229					asset,
   230					acceptsPrivate,
   231					acceptsPublic,
   232				}
   233				await this.storage.set(id, fpc)
   234				this.emit("onFpcAdded", fpc)
   235				return fpc
   236			} finally {
   237				this.lock.leave()
   238			}
   239		}
   240	

exec
/bin/zsh -lc "nl -ba packages/extension/package.json | sed -n '1,140p'" in (project root)
 succeeded in 0ms:
     1	{
     2		"name": "@nulo/extension",
     3		"private": true,
     4		"displayName": "Nulo",
     5		"description": "User-friendly self-custody wallet for Aztec network, preserving your privacy and revealing the power of account abstraction.",
     6		"version": "0.13.49",
     7		"sentinel": "7",
     8		"scripts": {
     9			"check:rp-id": "bun run scripts/check-rp-id.ts",
    10			"build:full": "bun run build:chrome && bun run build:firefox",
    11			"build": "bun run check:rp-id && cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build -c vite.chrome.config.mts",
    12			"build:chrome": "bun run check:rp-id && cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build -c vite.chrome.config.mts",
    13			"build:firefox": "bun run check:rp-id && cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build -c vite.firefox.config.mts",
    14			"dev:full": "concurrently \"bun run dev:chrome\" \"bun run dev:firefox\"",
    15			"dev": "vite -c vite.chrome.config.mts",
    16			"dev:chrome": "vite -c vite.chrome.config.mts",
    17			"dev:firefox": "vite build --mode development --watch -c vite.firefox.config.mts",
    18			"preview": "vite preview",
    19			"lint": "biome check src/",
    20			"lint:fix": "biome check src/ --fix",
    21			"format": "biome format src/ --write",
    22			"check": "biome check src/",
    23			"typecheck": "vue-tsc --noEmit",
    24			"test": "vitest",
    25			"test:components": "vitest run src/components",
    26			"test:e2e": "vitest run --config vitest.e2e.config.ts",
    27			"test:e2e:all": "vitest run --config vitest.e2e.all.config.ts",
    28			"storybook": "storybook dev -p 6006 --no-open",
    29			"build-storybook": "storybook build"
    30		},
    31		"dependencies": {
    32			"@alejoamiras/aztec-accelerator": "4.2.0-nightly.20260413.1",
    33			"@aztec/accounts": "4.2.0-nightly.20260413",
    34			"@aztec/aztec.js": "4.2.0-nightly.20260413",
    35			"@aztec/bb.js": "4.2.0-nightly.20260413",
    36			"@aztec/constants": "4.2.0-nightly.20260413",
    37			"@aztec/entrypoints": "4.2.0-nightly.20260413",
    38			"@aztec/foundation": "4.2.0-nightly.20260413",
    39			"@aztec/kv-store": "4.2.0-nightly.20260413",
    40			"@aztec/noir-acvm_js": "4.2.0-nightly.20260413",
    41			"@aztec/noir-contracts.js": "4.2.0-nightly.20260413",
    42			"@aztec/noir-noirc_abi": "4.2.0-nightly.20260413",
    43			"@aztec/protocol-contracts": "4.2.0-nightly.20260413",
    44			"@aztec/pxe": "4.2.0-nightly.20260413",
    45			"@aztec/simulator": "4.2.0-nightly.20260413",
    46			"@aztec/stdlib": "4.2.0-nightly.20260413",
    47			"@aztec/wallet-sdk": "4.2.0-nightly.20260413",
    48			"@codemirror/autocomplete": "^6.0.0",
    49			"@codemirror/commands": "^6.0.0",
    50			"@codemirror/lang-json": "^6.0.2",
    51			"@codemirror/language": "^6.0.0",
    52			"@codemirror/search": "^6.0.0",
    53			"@codemirror/state": "^6.0.0",
    54			"@codemirror/view": "^6.0.0",
    55			"@defi-wonderland/aztec-standards": "4.2.0-aztecnr-rc.2",
    56			"@lezer/highlight": "^1.0.0",
    57			"@nulo/aztec-runtime": "workspace:*",
    58			"@nulo/extension-messaging": "workspace:*",
    59			"@nulo/wallet-bridge": "workspace:*",
    60			"@nulo/wallet-core": "workspace:*",
    61			"@nulo/wallet-crypto": "workspace:*",
    62			"@replit/codemirror-indentation-markers": "^6.5.3",
    63			"@wonderland/aztec-fee-payment": "4.2.0-aztecnr-rc.2",
    64			"bignumber.js": "^9.3.1",
    65			"codemirror": "^6.0.2",
    66			"focus-trap": "^7.6.5",
    67			"lean-qr": "^2.5.0",
    68			"pako": "^2.1.0",
    69			"luxon": "^3.7.1",
    70			"pinia": "^3.0.3",
    71			"vue": "^3.5.18",
    72			"vue-router": "^4.5.1",
    73			"webextension-polyfill": "^0.12.0",
    74			"zod": "^3.23.8"
    75		},
    76		"devDependencies": {
    77			"@aztec/ethereum": "4.2.0-nightly.20260413",
    78			"@aztec/l1-artifacts": "4.2.0-nightly.20260413",
    79			"@aztec/viem": "2.38.2",
    80			"@aztec/wallets": "4.2.0-nightly.20260413",
    81			"@crxjs/vite-plugin": "^2.1.0",
    82			"@pinia/testing": "^1.0.3",
    83			"@storybook/vue3-vite": "^10.3.5",
    84			"@types/node": "^24.2.1",
    85			"@types/webextension-polyfill": "^0.12.3",
    86			"@vitejs/plugin-vue": "^6.0.1",
    87			"@vue/compiler-sfc": "^3.5.18",
    88			"@vue/test-utils": "^2.4.9",
    89			"@webext-core/fake-browser": "^1.3.4",
    90			"chrome-types": "^0.1.370",
    91			"concurrently": "^9.2.0",
    92			"cross-env": "^10.0.0",
    93			"globals": "^16.3.0",
    94			"jsdom": "^26.1.0",
    95			"postcss": "^8.5.6",
    96			"puppeteer": "^24.37.5",
    97			"sass": "^1.90.0",
    98			"storybook": "^10.3.5",
    99			"typescript": "^5.9.2",
   100			"unplugin-auto-import": "^20.0.0",
   101			"unplugin-vue-components": "^29.0.0",
   102			"unplugin-vue-router": "^0.15.0",
   103			"vite": "^7.1.1",
   104			"vite-plugin-node-polyfills": "^0.24.0",
   105			"vite-plugin-pages": "^0.33.1",
   106			"vite-plugin-static-copy": "^3.1.1",
   107			"vite-plugin-vue-devtools": "^8.0.0",
   108			"vitest": "^3.2.4",
   109			"vue-tsc": "^3.0.5",
   110			"webext-bridge": "^6.0.1"
   111		}
   112	}

exec
/bin/zsh -lc "nl -ba packages/extension/tests/e2e/network/contracts-register.test.ts | sed -n '1,180p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/playground/src/sections/contracts.ts | sed -n '1,140p'" in (project root)
 succeeded in 0ms:
     1	import { expect, inject } from "vitest"
     2	import { test } from "../fixtures/extension"
     3	import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
     4	import { waitForPopup, approveCapabilities } from "../fixtures/popups"
     5	import type { AztecTestConfig } from "../fixtures/aztec"
     6	
     7	const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
     8	const hasConfig = aztecConfig !== undefined
     9	
    10	/**
    11	 * Test #21 — registerContract is silent on default sessions
    12	 * (PxeState=3 < confirmationLevel=5).
    13	 *
    14	 * The dApp must pass a real ContractInstance. We fetch it directly from the
    15	 * local Aztec node via createAztecNodeClient + getContract, JSON-stringify it,
    16	 * inject into pg-input-contractInstance, then click the button.
    17	 */
    18	test.skipIf(!hasConfig)(
    19		"contracts-register — silent path registers contract instance",
    20		{ timeout: 120_000 },
    21		async ({ dappConnectedExtension }) => {
    22			const page = dappConnectedExtension.playgroundPage
    23	
    24			// Grant contracts cap with canRegister
    25			await page.evaluate(() => {
    26				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
    27				select.value = "basic"
    28				select.dispatchEvent(new Event("change", { bubbles: true }))
    29			})
    30			const seqGrant = await snapshotResultSeq(page)
    31			const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
    32			;(await page.waitForSelector('[data-testid="pg-btn-requestCapabilities"]', { visible: true }))!.click()
    33			await approveCapabilities(await popupP)
    34			await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)
    35	
    36			// Fetch the deployed token's instance directly from the node
    37			const { createAztecNodeClient } = await import("@aztec/aztec.js/node")
    38			const { AztecAddress } = await import("@aztec/aztec.js/addresses")
    39			const node = createAztecNodeClient(aztecConfig!.nodeUrl)
    40			const instance = await node.getContract(AztecAddress.fromString(aztecConfig!.tokenAddress))
    41			if (!instance) throw new Error("Could not fetch token instance from node")
    42	
    43			// Inject instance JSON into the playground
    44			const instanceJson = JSON.stringify(instance, (_k, v) => {
    45				if (typeof v === "bigint") return v.toString()
    46				if (v && typeof v === "object" && "toString" in v && typeof v.toString === "function") {
    47					const ctor = Object.getPrototypeOf(v)?.constructor?.name
    48					if (ctor === "Fr" || ctor === "AztecAddress" || ctor === "EthAddress") return v.toString()
    49				}
    50				return v
    51			})
    52			await page.evaluate((json: string) => {
    53				const input = document.querySelector<HTMLTextAreaElement>('[data-testid="pg-input-contractInstance"]')!
    54				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
    55				setter?.call(input, json)
    56				input.dispatchEvent(new Event("input", { bubbles: true }))
    57			}, instanceJson)
    58	
    59			const result = await callExpectingNoPopup(dappConnectedExtension, page, "registerContract", async () => {
    60				const btn = await page.waitForSelector('[data-testid="pg-btn-registerContract"]', { visible: true })
    61				await btn!.click()
    62			})
    63			// ok if the wallet accepted the instance; error if our JSON serialization
    64			// missed a field — either way it's silent (no popup).
    65			expect(["ok", "error"]).toContain(result.status)
    66		},
    67	)

 succeeded in 0ms:
     1	/**
     2	 * Contract registration + metadata. Canonical wallet-sdk methods only —
     3	 * registerToken (Nulo-custom) was dropped in the canonical refactor.
     4	 *
     5	 * registerContract needs a real ContractInstance which the test driver passes
     6	 * via the `pg-input-contractInstance` textarea (JSON-stringified instance).
     7	 */
     8	import { Fr } from "@aztec/foundation/curves/bn254"
     9	import { AztecAddress } from "@aztec/aztec.js/addresses"
    10	import { getWallet } from "../lib/wallet"
    11	import { logCall } from "../lib/log"
    12	import { getInput, getState, setState } from "../state"
    13	
    14	export function renderContracts(): string {
    15		const s = getState()
    16		const dis = s.status === "connected" ? "" : "disabled"
    17		return `
    18			<fieldset class="pg-section">
    19				<legend>Contracts</legend>
    20				<div class="pg-row">
    21					<label>Token addr: <input data-testid="pg-input-tokenAddress" name="tokenAddress" type="text" placeholder="0x..." /></label>
    22					<label>Class id: <input data-testid="pg-input-classId" name="classId" type="text" placeholder="0x..." /></label>
    23					<label>Sender addr: <input data-testid="pg-input-senderAddress" name="senderAddress" type="text" placeholder="0x..." /></label>
    24				</div>
    25				<div class="pg-row">
    26					<label>Contract instance JSON:
    27						<textarea data-testid="pg-input-contractInstance" name="contractInstance" rows="3" cols="40" placeholder='{"address":"0x...","contractClassId":"0x...","initializationHash":"0x...","publicKeys":...,"salt":"0x...","deployer":"0x...","version":1}'></textarea>
    28					</label>
    29				</div>
    30				<div class="pg-row">
    31					<button data-testid="pg-btn-registerContract" type="button" ${dis}>registerContract</button>
    32					<button data-testid="pg-btn-registerSender" type="button" ${dis}>registerSender</button>
    33					<button data-testid="pg-btn-getContractMetadata" type="button" ${dis}>getContractMetadata</button>
    34					<button data-testid="pg-btn-getContractClassMetadata" type="button" ${dis}>getContractClassMetadata</button>
    35				</div>
    36			</fieldset>
    37		`
    38	}
    39	
    40	function safe<T>(method: string, fn: () => Promise<T>): () => Promise<void> {
    41		return async () => {
    42			const wallet = getWallet()
    43			if (!wallet) {
    44				setState({ lastError: "Not connected — call connect() first" })
    45				return
    46			}
    47			try {
    48				await logCall(method, fn)
    49			} catch (err) {
    50				setState({ lastError: err instanceof Error ? err.message : String(err) })
    51			}
    52		}
    53	}
    54	
    55	export function bindContracts(root: HTMLElement): void {
    56		root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getContractMetadata"]')?.addEventListener(
    57			"click",
    58			safe("getContractMetadata", async () => {
    59				const wallet = getWallet()!
    60				const addr = AztecAddress.fromString(getInput("tokenAddress"))
    61				return wallet.getContractMetadata(addr)
    62			}),
    63		)
    64	
    65		root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getContractClassMetadata"]')?.addEventListener(
    66			"click",
    67			safe("getContractClassMetadata", async () => {
    68				const wallet = getWallet()!
    69				const id = Fr.fromString(getInput("classId") || getInput("tokenAddress"))
    70				return wallet.getContractClassMetadata(id)
    71			}),
    72		)
    73	
    74		root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerSender"]')?.addEventListener(
    75			"click",
    76			safe("registerSender", async () => {
    77				const wallet = getWallet()!
    78				const addr = AztecAddress.fromString(getInput("senderAddress") || getInput("tokenAddress"))
    79				return wallet.registerSender(addr, "test-sender")
    80			}),
    81		)
    82	
    83		root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerContract"]')?.addEventListener(
    84			"click",
    85			safe("registerContract", async () => {
    86				const wallet = getWallet()!
    87				const raw = getInput("contractInstance")
    88				if (!raw) throw new Error("Empty contractInstance — set the input first")
    89				// biome-ignore lint/suspicious/noExplicitAny: instance shape varies by aztec.js version
    90				const instance = JSON.parse(raw) as any
    91				return wallet.registerContract(instance)
    92			}),
    93		)
    94	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/popup/windows/execute/index.vue | sed -n '730,790p'" in (project root)
 succeeded in 0ms:
   730									<Text size="12" color="secondary">Function:</Text>
   731									<Text size="12" weight="600" color="primary">{{ humanizeMethodName(op.call.name ?? op.call.selector.toString()) }}</Text>
   732								</Flex>
   733							</template>
   734							<template v-else-if="op.kind === 'aztec_profileTx'">
   735								<Flex :class="$style.prop">
   736									<Text size="12" color="secondary">Payload:</Text>
   737									<Flex direction="column" gap="4">
   738										<Text
   739											v-for="(call, j) in op.exec.calls"
   740											:key="`${i}:${j}`"
   741											data-testid="execute-op-payload-row"
   742											:data-call-name="call.name ?? ''"
   743											:data-call-to="call.to?.toString() ?? ''"
   744											size="12"
   745											color="primary"
   746										>
   747											<Text weight="600">{{ humanizeMethodName(call.name ?? call.selector) }}</Text>
   748	
   749											<Text color="secondary"> on </Text>
   750											<AddressDisplay :address="call.to" />
   751										</Text>
   752									</Flex>
   753								</Flex>
   754							</template>
   755							<template v-else-if="op.kind === 'aztec_registerContract'">
   756								<Flex :class="$style.prop">
   757									<Text size="12" color="secondary">Contract address:</Text>
   758									<AddressDisplay :address="op.instance.address.toString()" />
   759								</Flex>
   760								<Flex v-if="op.artifact" :class="$style.prop">
   761									<Text size="12" color="secondary">Artifact:</Text>
   762									<Text size="12" color="primary">{{ op.artifact.name ?? "(custom)" }}</Text>
   763								</Flex>
   764							</template>
   765							<template v-else-if="op.kind === 'aztec_createAuthWit'">
   766								<Flex :class="$style.prop">
   767									<Text size="12" color="secondary">Message type:</Text>
   768									<Text size="12" weight="600" color="primary">
   769										{{ (op.messageHashOrIntent as { innerHash?: unknown }).innerHash !== undefined ? "Inner hash" : "Call intent" }}
   770									</Text>
   771								</Flex>
   772								<template v-if="(op.messageHashOrIntent as { call?: { to: unknown; name?: string; selector?: unknown } }).call">
   773									<Flex :class="$style.prop">
   774										<Text size="12" color="secondary">Target contract:</Text>
   775										<AddressDisplay :address="(op.messageHashOrIntent as { call: { to: { toString(): string } } }).call.to.toString()" />
   776									</Flex>
   777									<Flex :class="$style.prop">
   778										<Text size="12" color="secondary">Function:</Text>
   779										<Text size="12" weight="600" color="primary">
   780											{{ humanizeMethodName((op.messageHashOrIntent as { call: { name?: string; selector?: { toString(): string } } }).call.name ?? (op.messageHashOrIntent as { call: { selector?: { toString(): string } } }).call.selector?.toString() ?? "") }}
   781										</Text>
   782									</Flex>
   783								</template>
   784							</template>
   785						</Flex>
   786					</template>
   787				</Flex>
   788			</Flex>
   789			</Flex>
   790	

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/dapp-interaction/service.ts | sed -n '260,320p'" in (project root)
 succeeded in 0ms:
   260						throw new Error("Invalid operation kind")
   261					}
   262				}
   263			}
   264			await this.profileService.refreshSession()
   265			return await this.executionService.executeOperations(operations, {
   266				type: OriginType.DAPP,
   267				name: payload.session.dappMetadata.name ?? "Unknown dapp",
   268			})
   269		}
   270	
   271		private async validateSession({ sessionId, operations }: ExecutionParams): Promise<DappSession> {
   272			const session = await this.dappSessionService.tryGetDappSession(sessionId)
   273			if (!session) {
   274				throw new Error("Invalid session")
   275			}
   276			// validate permissions
   277			for (const operation of operations) {
   278				switch (operation.kind) {
   279					case "register_contract":
   280					case "register_sender":
   281					case "aztec_getContractClassMetadata":
   282					case "aztec_getContractMetadata":
   283					case "aztec_getChainInfo":
   284					case "aztec_registerSender":
   285					case "aztec_getAddressBook":
   286					case "aztec_registerContract": {
   287						this.checkMethodPermission(session, operation.kind, operation.chain)
   288						break
   289					}
   290					case "aztec_getPrivateEvents": {
   291						this.checkMethodPermission(session, operation.kind, operation.chain)
   292						this.checkScopesPermissions(session, operation.eventFilter.scopes)
   293						break
   294					}
   295					case "get_complete_address":
   296					case "register_token":
   297					case "simulate_utility":
   298					case "aztec_simulateTx":
   299					case "aztec_executeUtility":
   300					case "aztec_profileTx":
   301					case "aztec_sendTx":
   302					case "aztec_createAuthWit": {
   303						const chain = operation.account.substring(0, operation.account.lastIndexOf(":"))
   304						this.checkAccountPermission(session, operation.account)
   305						this.checkMethodPermission(session, operation.kind, chain)
   306						break
   307					}
   308					case "send_transaction":
   309					case "simulate_transaction": {
   310						const chain = operation.account.substring(0, operation.account.lastIndexOf(":"))
   311						this.checkAccountPermission(session, operation.account)
   312						this.checkMethodPermission(session, operation.kind, chain)
   313						operation.actions.forEach((x) => this.checkMethodPermission(session, x.kind, chain))
   314						break
   315					}
   316					case "simulate_views": {
   317						const chain = operation.account.substring(0, operation.account.lastIndexOf(":"))
   318						this.checkAccountPermission(session, operation.account)
   319						this.checkMethodPermission(session, operation.kind, chain)
   320						operation.calls.forEach((x) => this.checkMethodPermission(session, x.kind, chain))

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/dapp-interaction/service.ts | sed -n '400,430p'" in (project root)
 succeeded in 0ms:
   400				case "send_transaction":
   401					return AccessLevel.Transactions
   402				case "aztec_getContractClassMetadata":
   403					return AccessLevel.PxeState
   404				case "aztec_getContractMetadata":
   405					return AccessLevel.PxeState
   406				case "aztec_getPrivateEvents":
   407					return AccessLevel.PrivateData
   408				case "aztec_getChainInfo":
   409					return AccessLevel.PublicData
   410				case "aztec_registerSender":
   411					return AccessLevel.PxeState
   412				case "aztec_getAddressBook":
   413					return AccessLevel.AppState
   414				case "aztec_registerContract":
   415					return AccessLevel.PxeState
   416				case "aztec_simulateTx":
   417					return AccessLevel.PrivateData
   418				case "aztec_executeUtility":
   419					return AccessLevel.PrivateData
   420				case "aztec_profileTx":
   421					return AccessLevel.PrivateData
   422				case "aztec_sendTx":
   423					return AccessLevel.Transactions
   424				case "aztec_createAuthWit":
   425					return AccessLevel.PrivateData
   426				default:
   427					return AccessLevel.None
   428			}
   429		}
   430	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/service.ts | sed -n '1400,1465p'" in (project root)
 succeeded in 0ms:
  1400					}
  1401				}
  1402			} catch (err) {
  1403				this.logDebug(`getGasBalances: Failed to get private FeeJuice balance:`, getErrorMessage(err))
  1404				this.logError("Failed to get private FeeJuice balance", getErrorMessage(err))
  1405			}
  1406			this.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)
  1407	
  1408			const result = { publicFeeJuice, privateFeeJuice }
  1409			this.gasBalanceCache.set(cacheKey, { result, fetchedAt: Date.now() })
  1410			return result
  1411		}
  1412	
  1413		// Aztec.js interface:
  1414	
  1415		private async executeAztecGetContractClassMetadata(
  1416			op: AztecGetContractClassMetadataOperation,
  1417		): Promise<{ isContractClassPubliclyRegistered: boolean; isArtifactRegistered: boolean }> {
  1418			const network = await this.networkService.getNetwork(op.networkId)
  1419			const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), op.id, { pxeOnly: true })
  1420			return {
  1421				isContractClassPubliclyRegistered: !!artifact,
  1422				isArtifactRegistered: !!artifact,
  1423			}
  1424		}
  1425	
  1426		private async executeAztecGetContractMetadata(op: AztecGetContractMetadataOperation): Promise<{
  1427			instance?: ContractInstanceWithAddress
  1428			initializationStatus: ContractInitializationStatus
  1429			isContractPublished: boolean
  1430			isContractUpdated: boolean
  1431			updatedContractClassId?: Fr
  1432		}> {
  1433			const network = await this.networkService.getNetwork(op.networkId)
  1434	
  1435			// Check PXE-local only: simulation requires both instance AND artifact
  1436			// registered in PXE. The full cascade (node/known/registry) finds on-chain
  1437			// data that PXE can't use for simulation.
  1438			const localInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), op.address, { pxeOnly: true })
  1439	
  1440			let hasArtifact = false
  1441			if (localInstance) {
  1442				try {
  1443					const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), localInstance.currentContractClassId, {
  1444						pxeOnly: true,
  1445					})
  1446					hasArtifact = !!artifact
  1447				} catch {
  1448					hasArtifact = false
  1449				}
  1450			}
  1451	
  1452			const isLocallyRegistered = !!localInstance && hasArtifact
  1453	
  1454			// Use full cascade only for isContractPublished (on-chain existence)
  1455			let isPublished = isLocallyRegistered
  1456			if (!isPublished) {
  1457				const fullInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), op.address)
  1458				isPublished = !!fullInstance
  1459			}
  1460	
  1461			return {
  1462				instance: isLocallyRegistered ? localInstance : undefined,
  1463				initializationStatus: isLocallyRegistered ? ContractInitializationStatus.INITIALIZED : ContractInitializationStatus.UNKNOWN,
  1464				isContractPublished: isPublished,
  1465				isContractUpdated: false,

exec
/bin/zsh -lc "rg -n 'schema|classId|renderError|UintNote|NFTNote|getNoteSchemas|getContractInstance|canonicalSlotHex' packages/extension/src/wallet/services/note -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/note/service.ts:3:import { canonicalSlotHex, type NoteFieldType, type NoteSchema } from "@nulo/aztec-runtime/pxe"
packages/extension/src/wallet/services/note/service.ts:15: * Decode a single packed note field. UintNote/NFTNote shapes only need
packages/extension/src/wallet/services/note/service.ts:63:		// Resolve contract → classId once per unique address; needed to look
packages/extension/src/wallet/services/note/service.ts:64:		// up the matching note schema. PXE caches contract instances, but
packages/extension/src/wallet/services/note/service.ts:67:		const classIdByContract = new Map<string, string | undefined>()
packages/extension/src/wallet/services/note/service.ts:71:		// out the entire page. Failed entries surface as a renderError card on
packages/extension/src/wallet/services/note/service.ts:76:				res.push(await this.parseNote(network, note, classIdByContract, noteSchemas))
packages/extension/src/wallet/services/note/service.ts:85:					renderError: message,
packages/extension/src/wallet/services/note/service.ts:96:			return await this.pxeService.getNoteSchemas()
packages/extension/src/wallet/services/note/service.ts:98:			this.logWarn("Failed to load note schemas; falling back to raw rendering", getErrorMessage(error))
packages/extension/src/wallet/services/note/service.ts:147:		classIdByContract: Map<string, string | undefined>,
packages/extension/src/wallet/services/note/service.ts:155:		const schema = await this.lookupSchema(network, note, classIdByContract, noteSchemas)
packages/extension/src/wallet/services/note/service.ts:156:		const content = this.buildContent(note, schema)
packages/extension/src/wallet/services/note/service.ts:163:			...(schema ? { type: schema.noteName } : {}),
packages/extension/src/wallet/services/note/service.ts:168:	/** Look up `(classId, slotHex)` in the static schema map. Returns
packages/extension/src/wallet/services/note/service.ts:174:		classIdByContract: Map<string, string | undefined>,
packages/extension/src/wallet/services/note/service.ts:178:		if (!classIdByContract.has(contract)) {
packages/extension/src/wallet/services/note/service.ts:179:			classIdByContract.set(contract, await this.fetchClassId(network, note.contractAddress))
packages/extension/src/wallet/services/note/service.ts:181:		const classId = classIdByContract.get(contract)
packages/extension/src/wallet/services/note/service.ts:182:		if (!classId) return undefined
packages/extension/src/wallet/services/note/service.ts:183:		const slotHex = canonicalSlotHex(note.storageSlot.toString())
packages/extension/src/wallet/services/note/service.ts:184:		return noteSchemas[classId]?.[slotHex]
packages/extension/src/wallet/services/note/service.ts:189:			const instance = await this.pxeService.getContractInstance(networkInfoFrom(network), address)
packages/extension/src/wallet/services/note/service.ts:192:			this.logWarn("Failed to load contract instance for note schema lookup", address.toString(), getErrorMessage(error))
packages/extension/src/wallet/services/note/service.ts:199:	 *  fill in front; absence of a schema returns `undefined` (caller
packages/extension/src/wallet/services/note/service.ts:201:	private buildContent(note: NoteDao, schema: NoteSchema | undefined): Record<string, string> | undefined {
packages/extension/src/wallet/services/note/service.ts:202:		if (!schema) return undefined
packages/extension/src/wallet/services/note/service.ts:205:		for (let i = 0; i < schema.fields.length; i++) {
packages/extension/src/wallet/services/note/service.ts:206:			const field = schema.fields[i]
packages/extension/src/wallet/services/note/note-schemas.test.ts:2: * Tests for the production note-schema map.
packages/extension/src/wallet/services/note/note-schemas.test.ts:5: * 1. `canonicalSlotHex` normalization — pure logic.
packages/extension/src/wallet/services/note/note-schemas.test.ts:8: *    we hardcoded in `note-schemas.ts`. If a future aztec-packages bump
packages/extension/src/wallet/services/note/note-schemas.test.ts:12: * The class-id → schema mapping itself goes through `getContractClassFromArtifact`
packages/extension/src/wallet/services/note/note-schemas.test.ts:23:import { canonicalSlotHex } from "@nulo/aztec-runtime/pxe"
packages/extension/src/wallet/services/note/note-schemas.test.ts:30:describe("canonicalSlotHex", () => {
packages/extension/src/wallet/services/note/note-schemas.test.ts:32:		expect(canonicalSlotHex("0x0000000000000000000000000000000000000000000000000000000000000003")).toBe("0x3")
packages/extension/src/wallet/services/note/note-schemas.test.ts:33:		expect(canonicalSlotHex("0x0000000000000000000000000000000000000000000000000000000000000007")).toBe("0x7")
packages/extension/src/wallet/services/note/note-schemas.test.ts:37:		expect(canonicalSlotHex("0x3")).toBe("0x3")
packages/extension/src/wallet/services/note/note-schemas.test.ts:38:		expect(canonicalSlotHex("0x7")).toBe("0x7")
packages/extension/src/wallet/services/note/note-schemas.test.ts:42:		expect(canonicalSlotHex("3")).toBe("0x3")
packages/extension/src/wallet/services/note/note-schemas.test.ts:46:		expect(canonicalSlotHex("0xff")).toBe("0xff")
packages/extension/src/wallet/services/note/note-schemas.test.ts:50:describe("note-schema storage-slot regression gates", () => {
packages/extension/src/wallet/services/note/note-schemas.test.ts:51:	test("Aztec Token: balances at slot 0x3 (UintNote)", () => {
packages/extension/src/wallet/services/note/note-schemas.test.ts:55:	test("Aztec NFT: private_nfts at slot 0x7 (NFTNote)", () => {
packages/extension/src/wallet/services/note/note-schemas.test.ts:59:	test("Wonderland Token: private_balances at slot 0x7 (UintNote)", () => {
packages/extension/src/wallet/services/note/spec.ts:19:	renderError?: string
packages/extension/src/wallet/services/note/service.test.ts:7: * surfacing the bad entry as `renderError`.
packages/extension/src/wallet/services/note/service.test.ts:57:	setClassIdForContract: (contract: string, classId: string | undefined) => void
packages/extension/src/wallet/services/note/service.test.ts:66:	let schemas: Record<string, Record<string, unknown>> = {}
packages/extension/src/wallet/services/note/service.test.ts:67:	const classIdByContract = new Map<string, string | undefined>()
packages/extension/src/wallet/services/note/service.test.ts:72:		getNoteSchemas: vi.fn(async () => schemas),
packages/extension/src/wallet/services/note/service.test.ts:73:		getContractInstance: vi.fn(async (_network: unknown, address: { toString: () => string }) => {
packages/extension/src/wallet/services/note/service.test.ts:74:			const classId = classIdByContract.get(address.toString())
packages/extension/src/wallet/services/note/service.test.ts:75:			if (classId === undefined) return undefined
packages/extension/src/wallet/services/note/service.test.ts:76:			return { currentContractClassId: { toString: () => classId } }
packages/extension/src/wallet/services/note/service.test.ts:102:			schemas = s
packages/extension/src/wallet/services/note/service.test.ts:104:		setClassIdForContract: (contract, classId) => {
packages/extension/src/wallet/services/note/service.test.ts:105:			classIdByContract.set(contract, classId)
packages/extension/src/wallet/services/note/service.test.ts:121:		expect(result[0].renderError).toBeUndefined()
packages/extension/src/wallet/services/note/service.test.ts:132:		expect(result[1].renderError).toBeDefined()
packages/extension/src/wallet/services/note/service.test.ts:133:		expect(result[1].renderError).toMatch(/decode failed/)
packages/extension/src/wallet/services/note/service.test.ts:136:		expect(result[0].renderError).toBeUndefined()
packages/extension/src/wallet/services/note/service.test.ts:137:		expect(result[2].renderError).toBeUndefined()
packages/extension/src/wallet/services/note/service.test.ts:150:		expect(result[0].renderError).toBeDefined()
packages/extension/src/wallet/services/note/service.test.ts:165:describe("NoteService.getNotes — schema-decoded content", () => {
packages/extension/src/wallet/services/note/service.test.ts:168:	test("UintNote at known classId+slot decodes value as bigint string", async () => {
packages/extension/src/wallet/services/note/service.test.ts:173:				"0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] },
packages/extension/src/wallet/services/note/service.test.ts:179:		expect(note.type).toBe("UintNote")
packages/extension/src/wallet/services/note/service.test.ts:183:	test("NFTNote at known classId+slot keeps token_id as hex field", async () => {
packages/extension/src/wallet/services/note/service.test.ts:188:				"0x7": { noteName: "NFTNote", fields: [{ name: "token_id", type: "field" }] },
packages/extension/src/wallet/services/note/service.test.ts:194:		expect(note.type).toBe("NFTNote")
packages/extension/src/wallet/services/note/service.test.ts:198:	test("padded storage slot still matches its canonical short-hex schema key", async () => {
packages/extension/src/wallet/services/note/service.test.ts:203:				"0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] },
packages/extension/src/wallet/services/note/service.test.ts:215:		expect(note.type).toBe("UintNote")
packages/extension/src/wallet/services/note/service.test.ts:219:	test("unknown classId leaves note with raw rendering only", async () => {
packages/extension/src/wallet/services/note/service.test.ts:223:			"0xCLASS": { "0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] } },
packages/extension/src/wallet/services/note/service.test.ts:233:	test("known classId, unknown slot leaves note with raw rendering only", async () => {
packages/extension/src/wallet/services/note/service.test.ts:237:			"0xCLASS": { "0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] } },
packages/extension/src/wallet/services/note/service.test.ts:247:	test("classId lookup is batched: single fetch per unique contract", async () => {
packages/extension/src/wallet/services/note/service.test.ts:251:			"0xCLASS": { "0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] } },
packages/extension/src/wallet/services/note/service.test.ts:262:			(service as unknown as { pxeService: { getContractInstance: { mock: { calls: unknown[] } } } }).pxeService.getContractInstance
packages/extension/src/wallet/services/note/service.test.ts:267:	test("schema fetch failure falls back to raw rendering, not list-blanking error", async () => {
packages/extension/src/wallet/services/note/service.test.ts:269:		;(service as unknown as { pxeService: { getNoteSchemas: () => Promise<unknown> } }).pxeService.getNoteSchemas = () =>
packages/extension/src/wallet/services/note/service.test.ts:276:		expect(result[0].renderError).toBeUndefined()

exec
/bin/zsh -lc "rg -n 'loadProductionNoteSchemas|loadProductionKnownArtifacts|getContractClassFromArtifact|getContractArtifact\\(' packages/extension packages/aztec-runtime -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/aztec-runtime/src/pxe/service.ts:35:import { loadProductionKnownArtifacts } from "./known-artifacts"
packages/aztec-runtime/src/pxe/service.ts:36:import { loadProductionNoteSchemas, type NoteSchema } from "./note-schemas"
packages/aztec-runtime/src/pxe/service.ts:67:		this.artifacts = new ArtifactRegistry(loadProductionKnownArtifacts, { logger, logSource: PXE_SERVICE_NAME })
packages/aztec-runtime/src/pxe/service.ts:130:	public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
packages/aztec-runtime/src/pxe/service.ts:133:			return this.artifacts.resolve(id, (classId) => pxe.getContractArtifact(classId), network, opts)
packages/aztec-runtime/src/pxe/service.ts:138:		const schemas = await loadProductionNoteSchemas()
packages/aztec-runtime/src/pxe/ipxe.ts:22:	getContractArtifact(id: Fr): Promise<ContractArtifact | undefined>
packages/aztec-runtime/src/pxe/index.ts:2:export { type KnownArtifacts, type KnownArtifactsLoader, loadProductionKnownArtifacts } from "./known-artifacts"
packages/aztec-runtime/src/pxe/index.ts:5:	loadProductionNoteSchemas,
packages/aztec-runtime/src/pxe/artifact-registry.ts:76:			 *  upstream `getContractClassFromArtifact`). */
packages/aztec-runtime/src/pxe/artifact-registry.ts:152:	 *    time computation (see `loadProductionKnownArtifacts` in
packages/aztec-runtime/src/pxe/proxy.ts:29:	getContractArtifact(id: Fr): Promise<ContractArtifact | undefined> {
packages/aztec-runtime/src/pxe/proxy.ts:30:		return this.pxeService.getContractArtifact(this.network, id)
packages/aztec-runtime/src/pxe/client.ts:54:	public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
packages/aztec-runtime/src/pxe/spec.ts:19:	getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): ContractArtifact | undefined
packages/aztec-runtime/src/pxe/artifact-class-id.ts:15: * compute via upstream `getContractClassFromArtifact`. Tests inject
packages/aztec-runtime/src/pxe/artifact-class-id.ts:21:import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
packages/aztec-runtime/src/pxe/artifact-class-id.ts:29: * lack the structure needed by upstream `getContractClassFromArtifact`).
packages/aztec-runtime/src/pxe/artifact-class-id.ts:58:		const computed = await getContractClassFromArtifact(artifact)
packages/aztec-runtime/src/pxe/known-artifacts.ts:15:	getContractClassFromArtifact,
packages/aztec-runtime/src/pxe/known-artifacts.ts:38:export const loadProductionKnownArtifacts: KnownArtifactsLoader = async () => {
packages/aztec-runtime/src/pxe/known-artifacts.ts:60:		const contractClass = await getContractClassFromArtifact(artifact)
packages/aztec-runtime/src/pxe/note-schemas.ts:1:import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
packages/aztec-runtime/src/pxe/note-schemas.ts:50: * `loadProductionKnownArtifacts`.
packages/aztec-runtime/src/pxe/note-schemas.ts:58:export async function loadProductionNoteSchemas(): Promise<NoteSchemaMap> {
packages/aztec-runtime/src/pxe/note-schemas.ts:63:		const tokenClass = await getContractClassFromArtifact(TokenContractArtifact)
packages/aztec-runtime/src/pxe/note-schemas.ts:66:		const nftClass = await getContractClassFromArtifact(NFTContractArtifact)
packages/aztec-runtime/src/pxe/note-schemas.ts:70:		const wonderlandTokenClass = await getContractClassFromArtifact(wonderlandTokenArtifact)
packages/extension/src/wallet/services/account-state/service.ts:162:					const artifact = await this.pxeService.getContractArtifact(nInfo, instance.currentContractClassId)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:14: * the structure needed by upstream `getContractClassFromArtifact`.
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:291:		// verifier — the load-time `loadProductionKnownArtifacts` step
packages/extension/src/wallet/services/token/service.ts:245:		const artifact = await pxe.getContractArtifact(instance.currentContractClassId)
packages/extension/src/wallet/services/token/service.ts:330:			const artifact = await pxe.getContractArtifact(instance.currentContractClassId)
packages/extension/src/wallet/services/execution/service.ts:24:	getContractClassFromArtifact,
packages/extension/src/wallet/services/execution/service.ts:902:			providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), instance.currentContractClassId))
packages/extension/src/wallet/services/execution/service.ts:907:		const contractClass = await getContractClassFromArtifact(artifact)
packages/extension/src/wallet/services/execution/service.ts:1419:		const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), op.id, { pxeOnly: true })
packages/extension/src/wallet/services/execution/service.ts:1443:				const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), localInstance.currentContractClassId, {
packages/extension/src/wallet/services/execution/service.ts:1517:		const artifact = providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), classId))
packages/extension/src/wallet/services/execution/service.ts:1526:		const contractClass = await getContractClassFromArtifact(artifact)
packages/extension/src/wallet/services/fpc/service.ts:196:		const fpcArtifact = await pxe.getContractArtifact(fpcInstance.currentContractClassId)
packages/extension/src/wallet/services/note/note-schemas.test.ts:12: * The class-id → schema mapping itself goes through `getContractClassFromArtifact`
packages/extension/src/wallet/services/execution/contract-resolver.ts:102:		const artifact = await pxe.getContractArtifact(Fr.fromString(classId))

exec
/bin/zsh -lc 'find packages/extension/src/wallet/services/note -maxdepth 1 -type f | sort' in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/note/service.test.ts | sed -n '1,260p'" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/note/client.ts
packages/extension/src/wallet/services/note/note-schemas.test.ts
packages/extension/src/wallet/services/note/service.test.ts
packages/extension/src/wallet/services/note/service.ts
packages/extension/src/wallet/services/note/spec.ts

 succeeded in 0ms:
     1	/**
     2	 * Coverage focus: a single malformed note must NOT blank out the entire list.
     3	 * The failure mode under test is the silent-render symptom the user reported
     4	 * on `Settings → Advanced → Account State → Notes` — fetch succeeded with
     5	 * non-empty results, but no cards rendered. Root cause class: `parseNote`
     6	 * throwing on one entry crashed the whole list. Fix: per-note try/catch
     7	 * surfacing the bad entry as `renderError`.
     8	 */
     9	
    10	import { describe, expect, test, vi } from "vitest"
    11	import { LoggerStore } from "@/wallet/logger"
    12	import { ConfigStore } from "@/wallet/config"
    13	import { NoteService } from "./service"
    14	import type { Note } from "./spec"
    15	
    16	type Fake<T> = T extends object ? { [K in keyof T]?: Fake<T[K]> } : T
    17	
    18	/** Minimal NoteDao surface NoteService.parseNote touches. */
    19	function fakeNoteDao(
    20		overrides: Partial<{ contract: string; slot: string; tx: string; items: unknown[]; owner: string; randomness: string }> = {},
    21	): unknown {
    22		const contract = overrides.contract ?? "0xc1"
    23		const slot = overrides.slot ?? "0x1"
    24		const tx = overrides.tx ?? "0xabc"
    25		const items = overrides.items ?? ["0x01", "0x02"]
    26		const owner = overrides.owner ?? "0xowner"
    27		const randomness = overrides.randomness ?? "0xrand"
    28		return {
    29			contractAddress: { toString: () => contract, toBigInt: () => BigInt(7) },
    30			storageSlot: { toString: () => slot },
    31			txHash: { toString: () => tx },
    32			owner: { toString: () => owner },
    33			randomness: { toString: () => randomness },
    34			note: { items: items.map((x) => ({ toString: () => String(x) })) },
    35		}
    36	}
    37	
    38	/** Note with a corrupted `note.items` — `.map` throws. Models the real
    39	 *  failure observed in the field where one bad note crashes the whole page. */
    40	function brokenNoteDao(): unknown {
    41		return {
    42			contractAddress: { toString: () => "0xbad" },
    43			storageSlot: { toString: () => "0x9" },
    44			txHash: { toString: () => "0xff" },
    45			note: {
    46				get items(): never {
    47					throw new Error("decode failed")
    48				},
    49			},
    50		}
    51	}
    52	
    53	type ServiceHooks = {
    54		service: NoteService
    55		setNotes: (n: unknown[]) => void
    56		setSchemas: (s: Record<string, Record<string, unknown>>) => void
    57		setClassIdForContract: (contract: string, classId: string | undefined) => void
    58	}
    59	
    60	function makeService(): ServiceHooks {
    61		const config = new ConfigStore()
    62		const logger = new LoggerStore(config)
    63		const service = new NoteService(logger)
    64	
    65		const noteList: unknown[] = []
    66		let schemas: Record<string, Record<string, unknown>> = {}
    67		const classIdByContract = new Map<string, string | undefined>()
    68	
    69		const fakePxe = {
    70			getContracts: vi.fn(async () => [{ toBigInt: () => BigInt(7) }]),
    71			getNotes: vi.fn(async () => noteList),
    72			getNoteSchemas: vi.fn(async () => schemas),
    73			getContractInstance: vi.fn(async (_network: unknown, address: { toString: () => string }) => {
    74				const classId = classIdByContract.get(address.toString())
    75				if (classId === undefined) return undefined
    76				return { currentContractClassId: { toString: () => classId } }
    77			}),
    78		}
    79		const fakeNetworkService = {
    80			getNetwork: vi.fn(async () => ({
    81				id: "n",
    82				profileId: "p",
    83				chainId: 0,
    84				name: "Local",
    85				primaryEndpointId: "e1",
    86				endpoints: [{ id: "e1", rpcUrl: "http://x" }],
    87			})),
    88		}
    89	
    90		;(service as unknown as Fake<{ pxeService: unknown; networkService: unknown }>).pxeService = fakePxe
    91		;(service as unknown as Fake<{ pxeService: unknown; networkService: unknown }>).networkService = fakeNetworkService
    92		;(service as unknown as { isInitialized: boolean }).isInitialized = true
    93		;(service as unknown as { ensureInitialized: () => Promise<void> }).ensureInitialized = async () => {}
    94	
    95		return {
    96			service,
    97			setNotes: (n) => {
    98				noteList.length = 0
    99				noteList.push(...n)
   100			},
   101			setSchemas: (s) => {
   102				schemas = s
   103			},
   104			setClassIdForContract: (contract, classId) => {
   105				classIdByContract.set(contract, classId)
   106			},
   107		}
   108	}
   109	
   110	describe("NoteService.getNotes", () => {
   111		test("returns parsed entries for healthy notes", async () => {
   112			const { service, setNotes } = makeService()
   113			setNotes([fakeNoteDao(), fakeNoteDao({ contract: "0xc2" })])
   114	
   115			const result = await service.getNotes("n", "0x0000000000000000000000000000000000000000000000000000000000000001")
   116	
   117			expect(result).toHaveLength(2)
   118			expect(result[0].contract).toBe("0xc1")
   119			expect(result[1].contract).toBe("0xc2")
   120			expect(result[0].rawContent).toEqual(["0x01", "0x02"])
   121			expect(result[0].renderError).toBeUndefined()
   122		})
   123	
   124		test("a single malformed note does NOT blank out the rest of the list", async () => {
   125			const { service, setNotes } = makeService()
   126			setNotes([fakeNoteDao({ contract: "0xa" }), brokenNoteDao(), fakeNoteDao({ contract: "0xb" })])
   127	
   128			const result = await service.getNotes("n", "0x0000000000000000000000000000000000000000000000000000000000000001")
   129	
   130			expect(result).toHaveLength(3)
   131			expect(result.map((n: Note) => n.contract)).toEqual(["0xa", "0xbad", "0xb"])
   132			expect(result[1].renderError).toBeDefined()
   133			expect(result[1].renderError).toMatch(/decode failed/)
   134			expect(result[1].rawContent).toEqual([])
   135			// healthy entries on either side are unaffected
   136			expect(result[0].renderError).toBeUndefined()
   137			expect(result[2].renderError).toBeUndefined()
   138		})
   139	
   140		test("malformed entry preserves contract/slot/tx fields when those parse ok", async () => {
   141			const { service, setNotes } = makeService()
   142			setNotes([brokenNoteDao()])
   143	
   144			const result = await service.getNotes("n", "0x0000000000000000000000000000000000000000000000000000000000000001")
   145	
   146			expect(result).toHaveLength(1)
   147			expect(result[0].contract).toBe("0xbad")
   148			expect(result[0].storageSlot).toBe("0x9")
   149			expect(result[0].txHash).toBe("0xff")
   150			expect(result[0].renderError).toBeDefined()
   151		})
   152	
   153		test("propagates errors from the upstream PXE fetch", async () => {
   154			const { service } = makeService()
   155			;(service as unknown as { pxeService: { getContracts: () => Promise<unknown[]> } }).pxeService = {
   156				getContracts: () => Promise.reject(new Error("pxe down")),
   157			}
   158	
   159			await expect(service.getNotes("n", "0x0000000000000000000000000000000000000000000000000000000000000001")).rejects.toThrow(
   160				/PXE request failed/,
   161			)
   162		})
   163	})
   164	
   165	describe("NoteService.getNotes — schema-decoded content", () => {
   166		const acc = "0x0000000000000000000000000000000000000000000000000000000000000001"
   167	
   168		test("UintNote at known classId+slot decodes value as bigint string", async () => {
   169			const { service, setNotes, setSchemas, setClassIdForContract } = makeService()
   170			setClassIdForContract("0xtoken", "0xCLASS")
   171			setSchemas({
   172				"0xCLASS": {
   173					"0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] },
   174				},
   175			})
   176			setNotes([fakeNoteDao({ contract: "0xtoken", slot: "0x3", items: ["0x64"], owner: "0xown", randomness: "0xr1" })])
   177	
   178			const [note] = await service.getNotes("n", acc)
   179			expect(note.type).toBe("UintNote")
   180			expect(note.content).toEqual({ value: "100", owner: "0xown", randomness: "0xr1" })
   181		})
   182	
   183		test("NFTNote at known classId+slot keeps token_id as hex field", async () => {
   184			const { service, setNotes, setSchemas, setClassIdForContract } = makeService()
   185			setClassIdForContract("0xnft", "0xNFTCLASS")
   186			setSchemas({
   187				"0xNFTCLASS": {
   188					"0x7": { noteName: "NFTNote", fields: [{ name: "token_id", type: "field" }] },
   189				},
   190			})
   191			setNotes([fakeNoteDao({ contract: "0xnft", slot: "0x7", items: ["0xabc123"], owner: "0xown", randomness: "0xr2" })])
   192	
   193			const [note] = await service.getNotes("n", acc)
   194			expect(note.type).toBe("NFTNote")
   195			expect(note.content).toEqual({ token_id: "0xabc123", owner: "0xown", randomness: "0xr2" })
   196		})
   197	
   198		test("padded storage slot still matches its canonical short-hex schema key", async () => {
   199			const { service, setNotes, setSchemas, setClassIdForContract } = makeService()
   200			setClassIdForContract("0xtoken", "0xCLASS")
   201			setSchemas({
   202				"0xCLASS": {
   203					"0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] },
   204				},
   205			})
   206			setNotes([
   207				fakeNoteDao({
   208					contract: "0xtoken",
   209					slot: "0x0000000000000000000000000000000000000000000000000000000000000003",
   210					items: ["0x05"],
   211				}),
   212			])
   213	
   214			const [note] = await service.getNotes("n", acc)
   215			expect(note.type).toBe("UintNote")
   216			expect(note.content?.value).toBe("5")
   217		})
   218	
   219		test("unknown classId leaves note with raw rendering only", async () => {
   220			const { service, setNotes, setSchemas, setClassIdForContract } = makeService()
   221			setClassIdForContract("0xunknown", "0xUNKNOWNCLASS")
   222			setSchemas({
   223				"0xCLASS": { "0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] } },
   224			})
   225			setNotes([fakeNoteDao({ contract: "0xunknown", slot: "0x3", items: ["0x64"] })])
   226	
   227			const [note] = await service.getNotes("n", acc)
   228			expect(note.type).toBeUndefined()
   229			expect(note.content).toBeUndefined()
   230			expect(note.rawContent).toEqual(["0x64"])
   231		})
   232	
   233		test("known classId, unknown slot leaves note with raw rendering only", async () => {
   234			const { service, setNotes, setSchemas, setClassIdForContract } = makeService()
   235			setClassIdForContract("0xtoken", "0xCLASS")
   236			setSchemas({
   237				"0xCLASS": { "0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] } },
   238			})
   239			setNotes([fakeNoteDao({ contract: "0xtoken", slot: "0x99", items: ["0x42"] })])
   240	
   241			const [note] = await service.getNotes("n", acc)
   242			expect(note.type).toBeUndefined()
   243			expect(note.content).toBeUndefined()
   244			expect(note.rawContent).toEqual(["0x42"])
   245		})
   246	
   247		test("classId lookup is batched: single fetch per unique contract", async () => {
   248			const { service, setNotes, setSchemas, setClassIdForContract } = makeService()
   249			setClassIdForContract("0xtoken", "0xCLASS")
   250			setSchemas({
   251				"0xCLASS": { "0x3": { noteName: "UintNote", fields: [{ name: "value", type: "u128" }] } },
   252			})
   253			setNotes([
   254				fakeNoteDao({ contract: "0xtoken", slot: "0x3", items: ["0x01"], owner: "0xa", randomness: "0xr1" }),
   255				fakeNoteDao({ contract: "0xtoken", slot: "0x3", items: ["0x02"], owner: "0xb", randomness: "0xr2" }),
   256				fakeNoteDao({ contract: "0xtoken", slot: "0x3", items: ["0x03"], owner: "0xc", randomness: "0xr3" }),
   257			])
   258	
   259			const result = await service.getNotes("n", acc)
   260			expect(result).toHaveLength(3)

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/note/service.test.ts | sed -n '260,320p'" in (project root)
 succeeded in 0ms:
   260			expect(result).toHaveLength(3)
   261			expect(
   262				(service as unknown as { pxeService: { getContractInstance: { mock: { calls: unknown[] } } } }).pxeService.getContractInstance
   263					.mock.calls,
   264			).toHaveLength(1)
   265		})
   266	
   267		test("schema fetch failure falls back to raw rendering, not list-blanking error", async () => {
   268			const { service, setNotes } = makeService()
   269			;(service as unknown as { pxeService: { getNoteSchemas: () => Promise<unknown> } }).pxeService.getNoteSchemas = () =>
   270				Promise.reject(new Error("offscreen unreachable"))
   271			setNotes([fakeNoteDao({ items: ["0x07"] })])
   272	
   273			const result = await service.getNotes("n", acc)
   274			expect(result).toHaveLength(1)
   275			expect(result[0].rawContent).toEqual(["0x07"])
   276			expect(result[0].renderError).toBeUndefined()
   277			expect(result[0].type).toBeUndefined()
   278		})
   279	})

codex
I’ve confirmed the runtime behavior paths. One thing I still need to verify is the package layout in `node_modules`, because the existing Wonderland token alias already uses a non-obvious `artifacts/target/...` path and the plan proposes a different pattern for the NFT JSON.
exec
/bin/zsh -lc "find packages/extension/node_modules/@wonderland/aztec-fee-payment -maxdepth 3 -path '*/target/*' | sort" in (project root)
exec
/bin/zsh -lc "find packages/extension/node_modules/@defi-wonderland/aztec-standards -maxdepth 3 \\( -path '*/target/*' -o -path '*/artifacts/target/*' \\) | sort" in (project root)
 succeeded in 0ms:
 succeeded in 0ms:
exec
/bin/zsh -lc "rg -n 'version|sentinel|displayName' packages/extension/src packages/extension/tests packages/aztec-runtime/src -g '"'!**/node_modules/**'"'" in (project root)
exec
/bin/zsh -lc "rg -n 'wonderland.*nft|private fpc|PrivateFPC|SponsoredFPC|DefaultSponsoredFpc|PrivateFpc|@private-fpc-artifact' packages/extension/tests packages/extension/src -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/aztec-runtime/src/account/nulo-account.ts:111:			version: new Fr(rollupVersion),
packages/aztec-runtime/src/pxe/artifact-registry.ts:28:	 *  compiled-in version for a protocol contract. */
packages/extension/tests/e2e/fixtures/aztec.ts:324:	// Use `NO_FROM` sentinel per canonical pattern at @aztec/wallets/testing
packages/extension/tests/e2e/fixtures/aztec.ts:349:	// `Export named 'DEFAULT_TEARDOWN_DA_GAS_LIMIT'` (Aztec version drift between
packages/extension/tests/e2e/fixtures/aztec.ts:359:	// biome-ignore lint/suspicious/noExplicitAny: aztec-stdlib instance mismatch between @wonderland's pinned version and Nulo's
packages/extension/src/utils/files.ts:211:		throw new Error("Compression Streams API is not supported in this browser version")
packages/extension/src/utils/files.ts:244:		// biome-ignore lint/suspicious/noExplicitAny: DOM CompressionStream typings diverge slightly across TS lib versions
packages/extension/src/utils/files.ts:255:		throw new Error("Compression Streams API is not supported in this browser version")
packages/extension/src/utils/core.ts:141:const sentinelPath = "nulo:ui:sentinel"
packages/extension/src/utils/core.ts:144:	await chrome.storage.local.set({ [sentinelPath]: __SENTINEL__ })
packages/extension/src/utils/core.ts:148:	return (await chrome.storage.local.get(sentinelPath))[sentinelPath] === __SENTINEL__
packages/extension/src/utils/contacts-export-format.test.ts:19:		expect(result.version).toBe(1)
packages/extension/src/utils/contacts-export-format.test.ts:26:			version: 2,
packages/extension/src/utils/contacts-export-format.test.ts:30:		expect(result.version).toBe(2)
packages/extension/src/utils/contacts-export-format.test.ts:36:		const result = parseContactsExport(JSON.stringify({ version: 2, contacts: [] }))
packages/extension/src/utils/contacts-export-format.test.ts:37:		expect(result.version).toBe(2)
packages/extension/src/utils/contacts-export-format.test.ts:41:	test("rejects unknown version number", () => {
packages/extension/src/utils/contacts-export-format.test.ts:42:		const raw = JSON.stringify({ version: 99, contacts: [] })
packages/extension/src/utils/contacts-export-format.test.ts:46:	test("rejects string version", () => {
packages/extension/src/utils/contacts-export-format.test.ts:47:		const raw = JSON.stringify({ version: "abc", contacts: [] })
packages/extension/src/utils/contacts-export-format.test.ts:52:		const raw = JSON.stringify({ version: 2, contacts: null })
packages/extension/src/utils/contacts-export-format.test.ts:57:		const raw = JSON.stringify({ version: 2 })
packages/extension/src/utils/contacts-export-format.test.ts:84:			version: 2,
packages/extension/src/utils/contacts-export-format.ts:11: *       version: 2,
packages/extension/src/utils/contacts-export-format.ts:16: * else (`version: 99`, `version: "abc"`, `contacts: null`, `null`,
packages/extension/src/utils/contacts-export-format.ts:33:	version: 1 | 2
packages/extension/src/utils/contacts-export-format.ts:42:		return { version: 1, contacts: parsed as ImportedContactV2[] }
packages/extension/src/utils/contacts-export-format.ts:47:		(parsed as { version?: unknown }).version === 2 &&
packages/extension/src/utils/contacts-export-format.ts:50:		return { version: 2, contacts: (parsed as { contacts: ImportedContactV2[] }).contacts }
packages/extension/src/core/adapters/chrome-browser-api.ts:114:		// @types/chrome version disagreement on connect() overloads across versions.
packages/extension/src/types/typed-router.d.ts:49:	 * Type safe version of `RouteLocationNormalized` (the type of `to` and `from` in navigation guards).
packages/extension/src/types/typed-router.d.ts:56:	 * Type safe version of `RouteLocationNormalizedLoaded` (the return type of `useRoute()`).
packages/extension/src/types/typed-router.d.ts:63:	 * Type safe version of `RouteLocationResolved` (the returned route of `router.resolve()`).
packages/extension/src/types/typed-router.d.ts:70:	 * Type safe version of `RouteLocation` . Allows passing the name of the route to be passed as a generic.
packages/extension/src/types/typed-router.d.ts:75:	 * Type safe version of `RouteLocationRaw` . Allows passing the name of the route to be passed as a generic.
packages/extension/tests/e2e/navigation.test.ts:58:test("about page shows version info", async ({ registeredExtension }) => {
packages/extension/tests/e2e/navigation.test.ts:73:	// About page embeds wallet + Aztec version strings. These are informational
packages/extension/tests/e2e/navigation.test.ts:75:	await page.waitForSelector("text/Wallet version", { visible: true, timeout: 5_000 })
packages/extension/tests/e2e/navigation.test.ts:76:	await page.waitForSelector("text/Aztec version", { visible: true, timeout: 5_000 })
packages/extension/src/composables/notification.js:25:						"Due to breaking changes in the new version of Aztec, please, delete your profile and create a new one to ensure compatibility.",
packages/extension/src/wallet/runtime.ts:96:		// Destructive storage migration (version-gated) must run before any
packages/extension/src/wallet/storage/migrate.ts:13:const STORAGE_VERSION_KEY = "nulo:core:storage-version"
packages/extension/src/wallet/storage/migrate.ts:43:	const version = result[STORAGE_VERSION_KEY] as number | undefined
packages/extension/src/wallet/storage/migrate.ts:44:	if (version === CURRENT_VERSION) {
packages/extension/src/wallet/storage/migrate.ts:47:	log(`Storage version ${version ?? "(none)"} → ${CURRENT_VERSION}; wiping legacy state + PXE DBs.`)
packages/extension/src/popup/pages/import.vue:184:					note: "Windows Hello may not work correctly with some versions of Windows.",
packages/extension/src/popup/pages/import.vue:325:	const schemaVersion = backup["schema-version"]
packages/extension/src/popup/pages/import.vue:331:			"This backup was created by a pre-release build that used custom account contracts. It cannot be imported into the current version. Re-export a backup from the same release you are importing into.",
packages/extension/src/wallet/crypto/key-vectors.test.ts:39: *            version until a migration exists, or write the migration.
packages/extension/src/wallet/crypto/key-vectors.test.ts:93:	// AES-GCM-256, 13-byte prefix [version][iv].
packages/extension/src/popup/pages/profile/new.vue:80:			const note = type.value === "passkey" ? "Windows Hello may not work correctly with some versions of Windows." : undefined
packages/extension/src/components/update.vue:2:const version = __VERSION__
packages/extension/src/components/update.vue:9:			<span>Version: {{ version }}</span>
packages/extension/src/components/composite/send/AmountCard.vue:95:						<span :class="$style.conversion">~ $0.00</span>
packages/extension/src/components/composite/send/AmountCard.vue:137:.conversion {
packages/extension/src/wallet/services/network/service.ts:580:						throw new Error(`${ERR_BACKUP_TOO_OLD}: This backup was created with an older version of Nulo.`)
packages/extension/src/components/composite/send/AmountCard.test.ts:76:	test("renders the conversion line with placeholder dollar amount", () => {
packages/extension/src/popup/pages/settings/about.vue:16:const version = __VERSION__
packages/extension/src/popup/pages/settings/about.vue:41:					<Text @click="handleCopy(version)" size="12" weight="500" color="support" class="copyable">
packages/extension/src/popup/pages/settings/about.vue:42:						Wallet version - {{ version }} - Alpha Testing
packages/extension/src/popup/pages/settings/about.vue:45:						Aztec version - {{ aztecVersion }}
packages/extension/src/popup/windows/passkey/index.vue:45:			displayName: "Nulo Profile",
packages/extension/src/wallet/services/wallet-sdk/background.ts:461: * to numbers and XOR chainId with rollup version, matching the convention
packages/extension/src/wallet/services/wallet-sdk/background.ts:464:function chainInfoToChainId(obj: { chainInfo: { chainId: Fr | string; version: Fr | string } }): number {
packages/extension/src/wallet/services/wallet-sdk/background.ts:467:	const version = typeof raw.version === "string" ? Number(BigInt(raw.version)) : Number(raw.version.toBigInt())
packages/extension/src/wallet/services/wallet-sdk/background.ts:468:	return (chainId ^ version) >>> 0
packages/extension/src/wallet/services/execution/authwit-discoverer.ts:110:		const chainInfo = { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }
packages/extension/src/wallet/services/execution/authwit-discoverer.ts:172:				version: new Fr(nodeInfo.rollupVersion),
packages/extension/src/wallet/services/execution/authwit-discoverer.ts:243:				version: new Fr(nodeInfo.rollupVersion),
packages/extension/src/wallet/services/execution/authwit-discoverer.ts:257:				version: new Fr(nodeInfo.rollupVersion),
packages/extension/src/wallet/services/execution/service.ts:1479:		return { chainId: new Fr(l1ChainId), version: new Fr(rollupVersion) }
packages/extension/src/wallet/services/execution/service.ts:1775:			const chainInfo = { chainId: new Fr(nodeInfo2.l1ChainId), version: new Fr(nodeInfo2.rollupVersion) }
packages/extension/src/wallet/services/execution/service.ts:1840:			version: new Fr(nodeInfo.rollupVersion),
packages/extension/src/popup/pages/settings/contacts/index.vue:142:		version: 2,
packages/extension/src/components/install.vue:2:const displayName = __DISPLAY_NAME__
packages/extension/src/components/install.vue:3:const version = __VERSION__
packages/extension/src/components/install.vue:8:		<h1>installed page {{ displayName }}</h1>
packages/extension/src/components/install.vue:9:		<span>Version: {{ version }}</span>
packages/extension/src/popup/pages/settings/security/export/full.vue:60:const version = __VERSION__
packages/extension/src/popup/pages/settings/security/export/full.vue:101:		"wallet-version": version,
packages/extension/src/popup/pages/settings/security/export/full.vue:102:		"aztec-version": aztecVersion,
packages/extension/src/popup/pages/settings/security/export/full.vue:103:		"schema-version": 2,
packages/extension/src/wallet/services/profile/repository.ts:95:	 * interleave slow external work without inversion risk.

 succeeded in 0ms:
packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:6: * Bridges FeeJuice from L1 to a PrivateFPC with a claimer-bound `secretHash`.
packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:8: * `PrivateFPC.mint(...)` to materialize the FPC's internal balance for the
packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:121:		throw new Error(`L1→L2 message not yet ingested by node for PrivateFPC deposit: ${messageHash.toString()}`)
packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:124:	logger.info(`PrivateFPC deposit ready, leafIndex=${leafIndex.toString()}`)
packages/extension/tests/e2e/fixtures/extension.ts:352:				// Claim FeeJuice on L2 (use SponsoredFPC to pay for the claim tx)
packages/extension/tests/e2e/fixtures/aztec.ts:22:import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
packages/extension/tests/e2e/fixtures/aztec.ts:112:	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/extension/tests/e2e/fixtures/aztec.ts:118:/** Create Sponsored fee payment options. Registers the SponsoredFPC with the wallet's PXE first. */
packages/extension/tests/e2e/fixtures/aztec.ts:120:	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/extension/tests/e2e/fixtures/aztec.ts:124:	// Register the SponsoredFPC contract so the wallet can use it for fee payment
packages/extension/tests/e2e/fixtures/aztec.ts:126:		await wallet.registerContract(instance, SponsoredFPCContractArtifact)
packages/extension/tests/e2e/fixtures/aztec.ts:226:/** Claim bridged FeeJuice on L2. Uses SponsoredFPC to pay for the claim tx itself.
packages/extension/tests/e2e/fixtures/aztec.ts:261: * Why same-secret matters: `PrivateFPC.mint` requires `msg_sender == claimer`
packages/extension/tests/e2e/fixtures/aztec.ts:323:	// Step 3 — Deploy the derived account via SponsoredFPC (so it can sign/send mint later).
packages/extension/tests/e2e/fixtures/aztec.ts:347:	// Step 5 — Private FJ via PrivateFPC.
packages/extension/tests/e2e/fixtures/aztec.ts:351:	const { PrivateFPCContract } = await import("@wonderland/aztec-fee-payment/artifacts/private")
packages/extension/tests/e2e/fixtures/aztec.ts:354:	// PrivateFPC instance salt MUST be Fr.zero() to match Nulo's auto-discovery
packages/extension/tests/e2e/fixtures/aztec.ts:360:	const fpc = await PrivateFPCContract.deploy(wallet as any).register({
packages/extension/tests/e2e/fixtures/aztec.ts:365:	logger.info(`PrivateFPC registered: ${fpc.address.toString()}`)
packages/extension/tests/e2e/fixtures/aztec.ts:375:		// produceL2Block: send a no-op via SponsoredFPC to advance the chain
packages/extension/tests/e2e/fixtures/aztec.ts:386:	logger.info(`PrivateFPC bridge ready: leafIndex=${leafIndex.toString()}`)
packages/extension/tests/e2e/fixtures/aztec.ts:411:	logger.info("PrivateFPC.mint succeeded")
packages/extension/tests/e2e/fixtures/aztec.ts:418:		throw new Error(`PrivateFPC.balance_of returned ${privateBal} after mint — claim/mint flow broken`)
packages/extension/tests/e2e/fixtures/aztec.ts:420:	logger.info(`PrivateFPC.balance_of(account) = ${privateBal}`)
packages/extension/src/wallet/services/execution/service.ts:241:	private fpcService: FpcService = null!
packages/extension/src/wallet/services/execution/service.ts:1379:		// Private FeeJuice balance via balance_of on PrivateFPC
packages/extension/src/wallet/services/execution/service.ts:1383:			const bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
packages/extension/src/wallet/services/execution/spec.ts:36:	 * Returns public FeeJuice balance and private FeeJuice balance (via PrivateFPC).
packages/extension/src/wallet/services/fpc/handlers/index.ts:8:import { DefaultSponsoredFpcHandler } from "./default-sponsored-fpc-handler"
packages/extension/src/wallet/services/fpc/handlers/index.ts:9:import { PrivateFpcHandler } from "./private-fpc-handler"
packages/extension/src/wallet/services/fpc/handlers/index.ts:27:		case FpcType.DefaultSponsoredFpc: {
packages/extension/src/wallet/services/fpc/handlers/index.ts:28:			return new DefaultSponsoredFpcHandler()
packages/extension/src/wallet/services/fpc/handlers/index.ts:30:		case FpcType.PrivateFpc: {
packages/extension/src/wallet/services/fpc/handlers/index.ts:31:			return new PrivateFpcHandler()
packages/extension/src/wallet/services/fpc/handlers/default-sponsored-fpc-handler.ts:7:export class DefaultSponsoredFpcHandler implements IFpcHandler {
packages/extension/src/wallet/services/fpc/handlers/private-fpc-handler.ts:7:export class PrivateFpcHandler implements IFpcHandler {
packages/extension/src/wallet/services/fpc/handlers/private-fpc-handler.ts:51:		// PrivateFPC's pay_fee is heavy private execution — it walks encrypted notes
packages/extension/src/wallet/services/fpc/handlers/private-fpc-handler.ts:53:		// than SponsoredFPC. Empirically measured ~50k L2 gas overhead; pad generously
packages/extension/src/wallet/services/fpc/service.ts:17:import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
packages/extension/src/wallet/services/fpc/service.ts:19:import PrivateFPCJson from "@private-fpc-artifact"
packages/extension/src/wallet/services/fpc/service.ts:22:const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)
packages/extension/src/wallet/services/fpc/service.ts:79:		// Auto-discover missing protocol FPCs (SponsoredFPC, PrivateFPC)
packages/extension/src/wallet/services/fpc/service.ts:81:			!result.some((f) => f.type === FpcType.DefaultSponsoredFpc) || !result.some((f) => f.type === FpcType.PrivateFpc)
packages/extension/src/wallet/services/fpc/service.ts:95:			const hasSponsoredFpc = result.some((f) => f.type === FpcType.DefaultSponsoredFpc)
packages/extension/src/wallet/services/fpc/service.ts:96:			const hasPrivateFpc = result.some((f) => f.type === FpcType.PrivateFpc)
packages/extension/src/wallet/services/fpc/service.ts:97:			this.logDebug(`getFpcs (under lock): hasSponsoredFpc=${hasSponsoredFpc}, hasPrivateFpc=${hasPrivateFpc}`)
packages/extension/src/wallet/services/fpc/service.ts:98:			if (hasSponsoredFpc && hasPrivateFpc) {
packages/extension/src/wallet/services/fpc/service.ts:110:				const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
packages/extension/src/wallet/services/fpc/service.ts:114:				this.logDebug(`getFpcs: SponsoredFPC instance address=${instance.address.toString()}`)
packages/extension/src/wallet/services/fpc/service.ts:115:				toDiscover.push({ instance, artifact: SponsoredFPCContractArtifact })
packages/extension/src/wallet/services/fpc/service.ts:117:			if (!hasPrivateFpc) {
packages/extension/src/wallet/services/fpc/service.ts:118:				const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
packages/extension/src/wallet/services/fpc/service.ts:123:				this.logDebug(`getFpcs: PrivateFPC instance address=${instance.address.toString()}`)
packages/extension/src/wallet/services/fpc/service.ts:124:				toDiscover.push({ instance, artifact: PrivateFPCContractArtifact })
packages/extension/src/wallet/services/fpc/service.ts:150:						name: type === FpcType.PrivateFpc ? "Private Fee Juice" : undefined,
packages/extension/src/wallet/services/fpc/service.ts:298:	 * - `sponsor_unconditionally` → DefaultSponsoredFpc
packages/extension/src/wallet/services/fpc/service.ts:299:	 * - `pay_fee` + `balance_of` (no `sponsor_unconditionally`) → PrivateFpc
packages/extension/src/wallet/services/fpc/service.ts:305:			return FpcType.DefaultSponsoredFpc
packages/extension/src/wallet/services/fpc/service.ts:311:			return FpcType.PrivateFpc
packages/extension/src/wallet/services/fpc/service.ts:318:		return FpcType.DefaultSponsoredFpc
packages/extension/src/wallet/services/fpc/spec.ts:5:	DefaultSponsoredFpc,
packages/extension/src/wallet/services/fpc/spec.ts:6:	PrivateFpc,
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:59:const privateFpc = computed(() => registeredFpcs.value.find((f) => f.type === FpcType.PrivateFpc))
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:78:		if (fpc.type === FpcType.PrivateFpc) {
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:79:		} else if (fpc.type === FpcType.DefaultSponsoredFpc) {
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:316:			const sponsoredMethod = methods.value.find((m) => m.fpc?.type === FpcType.DefaultSponsoredFpc)
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:348:					// No PrivateFPC registered yet
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:382:					// DefaultSponsoredFpc, PrivateFpc
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:521:			<!-- Private Fee Juice (PrivateFPC) details -->
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:537:			<!-- FPC details (DefaultFpc / DefaultSponsoredFpc) -->
packages/extension/tests/e2e/network/fee-methods.test.ts:118:// Phase 2F WS3 follow-up: same fixture, exercise PrivateFPC.pay_fee path.
packages/extension/tests/e2e/network/fee-methods.test.ts:119:// The fixture pre-funded the PrivateFPC's internal balance for the imported
packages/extension/tests/e2e/network/fee-methods.test.ts:134:	// is what's private — paid via PrivateFPC's internal FJ balance).
packages/extension/tests/e2e/network/fee-methods.test.ts:157:	// via PrivateFPC.pay_fee using the FPC's internal balance.
packages/extension/tests/e2e/network/fee-methods.test.ts:186:// private FeeJuice (PrivateFPC.balance_of) without UI claim flow.
packages/extension/tests/e2e/network/tx-sendTx-feePayer.test.ts:66:		// feePayer points at the deployed SponsoredFPC; tx may submit ok or error
packages/extension/tests/e2e/network/transfers.test.ts:110:	// With SponsoredFPC, token balances aren't affected by gas fees.
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:42:// Treat null (PrivateFPC not yet discovered or query errored) as 0 so the
packages/extension/src/popup/components/popups/NewFpcPopup.vue:39:	DefaultSponsoredFpc: { label: "Sponsored FPC", description: "A third party covers your fees" },
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:38:				f.type === FpcType.DefaultSponsoredFpc ||
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:39:				f.type === FpcType.PrivateFpc ||
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:105:	if (fpc.type === FpcType.DefaultSponsoredFpc) {
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:112:	if (fpc.type === FpcType.PrivateFpc) {
packages/extension/src/popup/pages/settings/fpcs/index.vue:37:	const getOrder = (type) => (type === FpcType.DefaultSponsoredFpc ? 0 : 1)
packages/extension/src/popup/pages/settings/fpcs/index.vue:63:				fpc.type === FpcType.DefaultSponsoredFpc ||
packages/extension/src/popup/pages/settings/fpcs/index.vue:64:				fpc.type === FpcType.PrivateFpc ||
packages/extension/src/popup/pages/settings/fpcs/index.vue:85:	if (fpc.type === FpcType.DefaultSponsoredFpc) return "Sponsored"
packages/extension/src/popup/pages/settings/fpcs/index.vue:86:	if (fpc.type === FpcType.PrivateFpc) return "Private"
packages/extension/src/popup/pages/settings/fpcs/index.vue:98:	if (fpc.type === FpcType.DefaultSponsoredFpc) {
packages/extension/src/popup/pages/settings/fpcs/index.vue:106:	if (fpc.type === FpcType.PrivateFpc) {
packages/extension/src/popup/pages/settings/fpcs/index.vue:334:							v-if="fpc.type === FpcType.DefaultSponsoredFpc || fpc.type === FpcType.PrivateFpc || fpc.token?.symbol"
packages/extension/src/popup/pages/settings/fpcs/index.vue:343:							<Tooltip v-if="!(fpc.type === FpcType.DefaultSponsoredFpc || fpc.type === FpcType.PrivateFpc || fpc.token?.symbol)" position="end" delay="350">

exec
/bin/zsh -lc "find packages/extension/node_modules/@defi-wonderland/aztec-standards -maxdepth 4 -type f | rg 'nft_contract-NFT\\.json|token_contract-Token\\.json'" in (project root)
exec
/bin/zsh -lc "find packages/extension/node_modules/@wonderland/aztec-fee-payment -maxdepth 4 -type f | rg 'private_contract-PrivateFPC\\.json'" in (project root)
 exited 1 in 0ms:
 exited 1 in 0ms:
exec
/bin/zsh -lc 'ls -la packages/extension/node_modules/@wonderland/aztec-fee-payment' in (project root)
exec
/bin/zsh -lc 'ls -la packages/extension/node_modules/@defi-wonderland/aztec-standards' in (project root)
 succeeded in 0ms:
lrwxr-xr-x 1 alejoamiras staff 121 Apr 14 10:37 packages/extension/node_modules/@wonderland/aztec-fee-payment -> ../../../../node_modules/.bun/@wonderland+aztec-fee-payment@4.2.0-aztecnr-rc.2/node_modules/@wonderland/aztec-fee-payment

 succeeded in 0ms:
lrwxr-xr-x 1 alejoamiras staff 127 Apr 14 10:37 packages/extension/node_modules/@defi-wonderland/aztec-standards -> ../../../../node_modules/.bun/@defi-wonderland+aztec-standards@4.2.0-aztecnr-rc.2/node_modules/@defi-wonderland/aztec-standards

exec
/bin/zsh -lc "find -L packages/extension/node_modules/@wonderland/aztec-fee-payment -maxdepth 4 -type f | rg 'private_contract-PrivateFPC\\.json'" in (project root)
exec
/bin/zsh -lc "find -L packages/extension/node_modules/@defi-wonderland/aztec-standards -maxdepth 4 -type f | rg 'nft_contract-NFT\\.json|token_contract-Token\\.json'" in (project root)
 succeeded in 0ms:
packages/extension/node_modules/@defi-wonderland/aztec-standards/artifacts/target/token_contract-Token.json
packages/extension/node_modules/@defi-wonderland/aztec-standards/artifacts/target/nft_contract-NFT.json
packages/extension/node_modules/@defi-wonderland/aztec-standards/dist/target/token_contract-Token.json
packages/extension/node_modules/@defi-wonderland/aztec-standards/dist/target/nft_contract-NFT.json
packages/extension/node_modules/@defi-wonderland/aztec-standards/target/token_contract-Token.json
packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json
packages/extension/node_modules/@defi-wonderland/aztec-standards/target/token_contract-Token.json.bak
packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json.bak

 succeeded in 0ms:
packages/extension/node_modules/@wonderland/aztec-fee-payment/dist/target/private_contract-PrivateFPC.json
packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json
packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json.bak

exec
/bin/zsh -lc 'find -L packages/extension/node_modules/@defi-wonderland/aztec-standards -maxdepth 3 -type d | sort' in (project root)
exec
/bin/zsh -lc 'find -L packages/extension/node_modules/@wonderland/aztec-fee-payment -maxdepth 3 -type d | sort' in (project root)
 succeeded in 0ms:
packages/extension/node_modules/@wonderland/aztec-fee-payment
packages/extension/node_modules/@wonderland/aztec-fee-payment/dist
packages/extension/node_modules/@wonderland/aztec-fee-payment/dist/src
packages/extension/node_modules/@wonderland/aztec-fee-payment/dist/src/artifacts
packages/extension/node_modules/@wonderland/aztec-fee-payment/dist/src/ts
packages/extension/node_modules/@wonderland/aztec-fee-payment/dist/target
packages/extension/node_modules/@wonderland/aztec-fee-payment/target

 succeeded in 0ms:
packages/extension/node_modules/@defi-wonderland/aztec-standards
packages/extension/node_modules/@defi-wonderland/aztec-standards/artifacts
packages/extension/node_modules/@defi-wonderland/aztec-standards/artifacts/src
packages/extension/node_modules/@defi-wonderland/aztec-standards/artifacts/src/artifacts
packages/extension/node_modules/@defi-wonderland/aztec-standards/artifacts/target
packages/extension/node_modules/@defi-wonderland/aztec-standards/dist
packages/extension/node_modules/@defi-wonderland/aztec-standards/dist/src
packages/extension/node_modules/@defi-wonderland/aztec-standards/dist/src/artifacts
packages/extension/node_modules/@defi-wonderland/aztec-standards/dist/target
packages/extension/node_modules/@defi-wonderland/aztec-standards/target

exec
/bin/zsh -lc "nl -ba packages/extension/tests/e2e/fixtures/aztec.ts | sed -n '340,430p'" in (project root)
 succeeded in 0ms:
   340		// Step 4 — Public FJ: bridge + claim. Recipient-bound (sender-agnostic), so we
   341		// reuse the existing helpers with the test sandbox wallet for fee payment.
   342		const publicClaim = await bridgeFeeJuice(node, expectedAddress.toString(), publicAmount)
   343		await waitForL1ToL2Message(node, publicClaim.messageHash.toString())
   344		await claimFeeJuice(wallet, expectedAddress.toString(), feePayerAddress, publicClaim, sponsoredFee)
   345		logger.info(`Public FJ claimed: amount=${publicAmount}`)
   346	
   347		// Step 5 — Private FJ via PrivateFPC.
   348		// Top-level import of @wonderland/aztec-fee-payment fails on
   349		// `Export named 'DEFAULT_TEARDOWN_DA_GAS_LIMIT'` (Aztec version drift between
   350		// @wonderland's pinned deps and Nulo's). Sub-path imports work.
   351		const { PrivateFPCContract } = await import("@wonderland/aztec-fee-payment/artifacts/private")
   352		const { bridgeForMint } = await import("./aztec-private-fpc-bridge")
   353	
   354		// PrivateFPC instance salt MUST be Fr.zero() to match Nulo's auto-discovery
   355		// (fpc/service.ts:104-110: salt=Fr.zero(), deployer=AztecAddress.ZERO).
   356		// Mirrors @wonderland's registerPrivateContract (utils/deploy.ts) inline.
   357		// `register` calls `wallet.registerContract` which lives on the parent
   358		// EmbeddedWallet, not on per-account AccountWithSecretKey.
   359		// biome-ignore lint/suspicious/noExplicitAny: aztec-stdlib instance mismatch between @wonderland's pinned version and Nulo's
   360		const fpc = await PrivateFPCContract.deploy(wallet as any).register({
   361			contractAddressSalt: Fr.ZERO,
   362			skipInitialization: true,
   363			deployer: AztecAddress.ZERO,
   364		})
   365		logger.info(`PrivateFPC registered: ${fpc.address.toString()}`)
   366	
   367		// Bridge salt must be RANDOM per invocation (avoids nullifier collision on reruns).
   368		const bridgeSalt = Fr.random()
   369		const { secret: bridgeSecret, leafIndex } = await bridgeForMint(
   370			node,
   371			fpc.address,
   372			expectedAddress,
   373			bridgeSalt,
   374			privateAmount,
   375			// produceL2Block: send a no-op via SponsoredFPC to advance the chain
   376			async () => {
   377				const { Contract } = await import("@aztec/aztec.js/contracts")
   378				const { FeeJuiceArtifact } = await import("@aztec/protocol-contracts/fee-juice")
   379				const feeJuice = await Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)
   380				await feeJuice.methods
   381					.balance_of_public(expectedAddress)
   382					.simulate({ from: feePayerAddress })
   383					.catch(() => undefined)
   384			},
   385		)
   386		logger.info(`PrivateFPC bridge ready: leafIndex=${leafIndex.toString()}`)
   387	
   388		// L2 claim: emits the FeeJuice nullifier. Sender doesn't matter for FJ.claim
   389		// (claim is recipient-bound via the embedded leaf hash). Use the script's main
   390		// EmbeddedWallet (sandbox-funded sender) for fees.
   391		{
   392			const { Contract } = await import("@aztec/aztec.js/contracts")
   393			const { FeeJuiceArtifact } = await import("@aztec/protocol-contracts/fee-juice")
   394			const feeJuice = await Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)
   395			await feeJuice.methods.claim(fpc.address, privateAmount, bridgeSecret, leafIndex).send({
   396				fee: { paymentMethod: sponsoredFee.paymentMethod },
   397				from: feePayerAddress,
   398				wait: { timeout: 120 },
   399			})
   400			logger.info("FJ.claim emitted FeeJuice nullifier")
   401		}
   402	
   403		// L2 mint — MUST be from derivedWallet (msg_sender == claimer == accountAddress).
   404		// `additionalScopes: [fpc.address]` per canonical private.test.ts:103-105.
   405		await fpc.methods.mint(privateAmount, bridgeSalt, leafIndex).send({
   406			from: expectedAddress,
   407			additionalScopes: [fpc.address],
   408			fee: { paymentMethod: sponsoredFee.paymentMethod },
   409			wait: { timeout: 120 },
   410		})
   411		logger.info("PrivateFPC.mint succeeded")
   412	
   413		// Sanity assertion: balance landed before fixture returns.
   414		// `balance_of(...).simulate(...)` returns `{ result: bigint }` per @wonderland's
   415		// canonical pattern (private.test.ts:101-103).
   416		const { result: privateBal } = await fpc.methods.balance_of(expectedAddress).simulate({ from: expectedAddress })
   417		if (typeof privateBal !== "bigint" || privateBal === 0n) {
   418			throw new Error(`PrivateFPC.balance_of returned ${privateBal} after mint — claim/mint flow broken`)
   419		}
   420		logger.info(`PrivateFPC.balance_of(account) = ${privateBal}`)
   421	
   422		const masterBase64 = Buffer.from(master.toBuffer()).toString("base64")
   423		return { masterBase64, accountAddress: expectedAddress }
   424	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/account-state/service.ts | sed -n '150,230p'" in (project root)
 succeeded in 0ms:
   150			for (const n of uniqueNetworks) {
   151				if ((await this.networkService.getNodeStatus(n.id)) === NodeStatus.Active) {
   152					const senders = await this.getSenders(n.id)
   153					const contracts = await this.getContracts(n.id)
   154					const contractsFull: BackupContract[] = []
   155					const nInfo = networkInfoFrom(n)
   156					for (const c of contracts) {
   157						const instance = await this.pxeService.getContractInstance(nInfo, AztecAddress.fromString(c))
   158						if (!instance) continue
   159	
   160						if (!instance.currentContractClassId) continue
   161	
   162						const artifact = await this.pxeService.getContractArtifact(nInfo, instance.currentContractClassId)
   163						if (!artifact) continue
   164	
   165						contractsFull.push({
   166							address: c,
   167							instance,
   168							artifact,
   169						})
   170					}
   171	
   172					result.push({
   173						networkId: n.id,
   174						senders: senders.map((address) => ({ address })),
   175						contracts: contractsFull,
   176					})
   177				}
   178			}
   179	
   180			return result
   181		}
   182	
   183		public async restore(backupAccountState: BackupAccountState[], networks: Network[]): Promise<Restored<BackupAccountState>[]> {
   184			await this.ensureInitialized()
   185	
   186			const result: Restored<BackupAccountState>[] = []
   187	
   188			for (const item of backupAccountState) {
   189				const senders: Restored<BackupSender>[] = []
   190				const contracts: Restored<BackupContract>[] = []
   191				const network = networks.find((n) => n.id === item.networkId)
   192				for (const sender of item.senders) {
   193					try {
   194						if (!network) throw new Error("Network not found")
   195	
   196						await this.pxeService.registerSender(networkInfoFrom(network), AztecAddress.fromString(sender.address))
   197						senders.push(sender)
   198					} catch (err) {
   199						senders.push({
   200							...sender,
   201							restoreError: err instanceof Error ? err.message : err,
   202						})
   203					}
   204				}
   205	
   206				for (const contract of item.contracts) {
   207					try {
   208						if (!network) throw new Error("Network not found")
   209	
   210						const addressNum = AztecAddress.fromString(contract.address).toBigInt()
   211						if (addressNum >= 0 && addressNum <= 6) {
   212							// ignore protocol contracts registration,
   213							// because we cannot validate it due to hardcoded addresses
   214							continue
   215						}
   216	
   217						await this.pxeService.registerContract(networkInfoFrom(network), {
   218							instance: contract.instance,
   219							artifact: contract.artifact,
   220						})
   221						contracts.push(contract)
   222					} catch (err) {
   223						contracts.push({
   224							...contract,
   225							restoreError: err instanceof Error ? err.message : err,
   226						})
   227					}
   228				}
   229	
   230				result.push({

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/token/service.ts | sed -n '228,345p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/contract-resolver.ts | sed -n '1,140p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * ContractResolver — second collaborator extracted from ExecutionService
     3	 * (M2.2-c). Consolidates contract-instance + artifact resolution logic
     4	 * that's duplicated between this service and `PxeService` at the lower
     5	 * level.
     6	 *
     7	 * Today the facade does the same five things in five places:
     8	 *   - walk an `Action[]` to collect every contract address referenced
     9	 *     (authwit targets + call destinations)
    10	 *   - fetch the `ContractInstanceWithAddress` for each (parallel)
    11	 *   - deduplicate by class id and fetch the matching `ContractArtifact`s
    12	 *
    13	 * `ContractResolver` owns those 5 methods and nothing else. No state, no
    14	 * storage, no locks. PXE access is passed per-call (keeps the minimal-
    15	 * diff extraction; future sub-PRs can tighten the contract once M2.2-d
    16	 * is in — see plan M2.2-c).
    17	 *
    18	 * ## Error contract (frozen by call site)
    19	 *
    20	 *   - `resolveInstance` → throws `"Contract instance not found"` when PXE
    21	 *     returns undefined for the address. Callers match on this exact string.
    22	 *   - `resolveArtifact` → throws `"Contract artifact not found for class ${classId}"`.
    23	 *     The formatted variant is load-bearing — auditor flagged M2.2-a's
    24	 *     plan for collapsing it to the bare string. Preserved verbatim.
    25	 *
    26	 * Downstream consumers (`TxRequestBuilder` M2.2-d, `AuthwitDiscoverer`
    27	 * M2.2-e) will take this resolver as a ctor dep and never reach back into
    28	 * the facade's private state.
    29	 */
    30	
    31	import { Fr } from "@aztec/foundation/curves/bn254"
    32	import type { ContractArtifact } from "@aztec/stdlib/abi"
    33	import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
    34	import { AztecAddress } from "@aztec/stdlib/aztec-address"
    35	import { type ILogger, LogLevel } from "@/wallet/logger"
    36	import type { IPXE } from "@nulo/aztec-runtime/pxe"
    37	import type { Action, AddPrivateAuthwitAction, AddPublicAuthwitAction, CallAuthwitContent, EncodedCallAuthwitContent } from "./spec"
    38	
    39	const LOG_SOURCE = "ContractResolver"
    40	
    41	export class ContractResolver {
    42		public constructor(private readonly logger: ILogger) {}
    43	
    44		/** Extract every unique contract address an action list references —
    45		 *  authwit targets (call + encoded_call variants × private + public)
    46		 *  plus direct call destinations. Order-unspecified; dedup via `Set`. */
    47		public extractContracts(actions: Action[]): string[] {
    48			return [
    49				...new Set(
    50					actions
    51						.filter((x) => x.kind === "add_private_authwit" && x.content.kind === "call")
    52						.map((x) => ((x as AddPrivateAuthwitAction).content as CallAuthwitContent).contract)
    53						.concat(
    54							actions
    55								.filter((x) => x.kind === "add_private_authwit" && x.content.kind === "encoded_call")
    56								.map((x) => ((x as AddPrivateAuthwitAction).content as EncodedCallAuthwitContent).to),
    57						)
    58						.concat(
    59							actions
    60								.filter((x) => x.kind === "add_public_authwit" && x.content.kind === "call")
    61								.map((x) => ((x as AddPublicAuthwitAction).content as CallAuthwitContent).contract),
    62						)
    63						.concat(
    64							actions
    65								.filter((x) => x.kind === "add_public_authwit" && x.content.kind === "encoded_call")
    66								.map((x) => ((x as AddPublicAuthwitAction).content as EncodedCallAuthwitContent).to),
    67						)
    68						.concat(actions.filter((x) => x.kind === "call").map((x) => x.contract))
    69						.concat(actions.filter((x) => x.kind === "encoded_call").map((x) => x.to)),
    70				),
    71			]
    72		}
    73	
    74		/** Fetch a single `ContractInstanceWithAddress` from PXE. Throws
    75		 *  `"Contract instance not found"` if PXE returns undefined. */
    76		public async resolveInstance(pxe: IPXE, contract: string): Promise<[string, ContractInstanceWithAddress]> {
    77			const instance = await pxe.getContractInstance(AztecAddress.fromString(contract))
    78			if (!instance) {
    79				throw new Error("Contract instance not found")
    80			}
    81			return [contract, instance]
    82		}
    83	
    84		/** Fetch instances for every address in `contracts`. Parallel fetch.
    85		 *  Returns a `Map` keyed by the original address string. */
    86		public async resolveInstances(pxe: IPXE, contracts: string[]): Promise<Map<string, ContractInstanceWithAddress>> {
    87			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Get instances...")
    88			const instances = new Map<string, ContractInstanceWithAddress>()
    89			this.logger.log(LOG_SOURCE, LogLevel.Debug, `Fetching ${contracts.length} instances...`)
    90			const fetched = await Promise.all(contracts.map((x) => this.resolveInstance(pxe, x)))
    91			this.logger.log(LOG_SOURCE, LogLevel.Debug, `${fetched.length} instances fetched`)
    92			for (const [address, instance] of fetched) {
    93				instances.set(address, instance)
    94			}
    95			return instances
    96		}
    97	
    98		/** Fetch a single artifact by class id. Throws
    99		 *  `"Contract artifact not found for class ${classId}"` — formatted
   100		 *  variant preserved per audit finding. */
   101		public async resolveArtifact(pxe: IPXE, classId: string): Promise<[string, ContractArtifact]> {
   102			const artifact = await pxe.getContractArtifact(Fr.fromString(classId))
   103			if (!artifact) {
   104				throw new Error(`Contract artifact not found for class ${classId}`)
   105			}
   106			return [classId, artifact]
   107		}
   108	
   109		/** Fetch artifacts for every UNIQUE class id referenced by `instances`.
   110		 *  Deduplicates first so we don't refetch a shared artifact. Keyed by
   111		 *  class-id string. */
   112		public async resolveArtifacts(pxe: IPXE, instances: Map<string, ContractInstanceWithAddress>): Promise<Map<string, ContractArtifact>> {
   113			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Get artifacts...")
   114			const artifacts = new Map<string, ContractArtifact>()
   115			const classIds = new Set(
   116				instances
   117					.values()
   118					.filter((x) => !artifacts.has(x.currentContractClassId.toString()))
   119					.map((x) => x.currentContractClassId.toString()),
   120			)
   121			this.logger.log(
   122				LOG_SOURCE,
   123				LogLevel.Debug,
   124				`Fetching ${classIds.size} artifacts for contracts: ${[...instances.keys()].join(", ")}...`,
   125			)
   126			this.logger.log(LOG_SOURCE, LogLevel.Debug, `Class IDs: ${[...classIds].join(", ")}`)
   127			const fetched = await Promise.all(classIds.values().map((x) => this.resolveArtifact(pxe, x)))
   128			this.logger.log(LOG_SOURCE, LogLevel.Debug, `${fetched.length} artifacts fetched`)
   129			for (const [classId, artifact] of fetched) {
   130				artifacts.set(classId, artifact)
   131			}
   132			return artifacts
   133		}
   134	}

 succeeded in 0ms:
   228			const token = await this.tokens.get(`${tokenId}`)
   229			if (!token) {
   230				throw new Error("unknown token id")
   231			}
   232	
   233			const network = await this.networks.getNetwork(networkId)
   234			if (!network) {
   235				throw new Error("unknown network id")
   236			}
   237	
   238			const pxe = this.pxeService.getPXE(networkInfoFrom(network))
   239	
   240			const instance = await pxe.getContractInstance(AztecAddress.fromString(token.contract))
   241			if (!instance) {
   242				throw new Error("contract instance not found")
   243			}
   244	
   245			const artifact = await pxe.getContractArtifact(instance.currentContractClassId)
   246			if (!artifact) {
   247				throw new Error("contract artifact not found")
   248			}
   249	
   250			const registeredContracts = await pxe.getContracts()
   251			if (!registeredContracts.find((x) => x.toString() === token.contract)) {
   252				await pxe.registerContract({
   253					instance,
   254					artifact,
   255				})
   256			}
   257	
   258			const getNameFnCandidates = GetNameFn.getCandidates(artifact).map((x) => x.getImpl())
   259			const getNameFn = token.getNameFn
   260	
   261			const getSymbolFnCandidates = GetSymbolFn.getCandidates(artifact).map((x) => x.getImpl())
   262			const getSymbolFn = token.getSymbolFn
   263	
   264			const getDecimalsFnCandidates = GetDecimalsFn.getCandidates(artifact).map((x) => x.getImpl())
   265			const getDecimalsFn = token.getDecimalsFn
   266	
   267			const balanceOfPrivateFnCandidates = BalanceOfPrivateFn.getCandidates(artifact).map((x) => x.getImpl())
   268			const balanceOfPrivateFn = token.balanceOfPrivateFn
   269	
   270			const balanceOfPublicFnCandidates = BalanceOfPublicFn.getCandidates(artifact).map((x) => x.getImpl())
   271			const balanceOfPublicFn = token.balanceOfPublicFn
   272	
   273			const transferPublicFnCandidates = TransferPublicFn.getCandidates(artifact).map((x) => x.getImpl())
   274			const transferPublicFn = token.transferPublicFn
   275	
   276			const transferPrivateFnCandidates = TransferPrivateFn.getCandidates(artifact).map((x) => x.getImpl())
   277			const transferPrivateFn = token.transferPrivateFn
   278	
   279			const transferPrivateToPublicFnCandidates = TransferPrivateToPublicFn.getCandidates(artifact).map((x) => x.getImpl())
   280			const transferPrivateToPublicFn = token.transferPrivateToPublicFn
   281	
   282			const transferPublicToPrivateFnCandidates = TransferPublicToPrivateFn.getCandidates(artifact).map((x) => x.getImpl())
   283			const transferPublicToPrivateFn = token.transferPublicToPrivateFn
   284	
   285			const ti: TokenInterface = {
   286				chainId: token.chainId,
   287				contract: token.contract,
   288				getNameFn,
   289				getNameFnCandidates,
   290				getSymbolFn,
   291				getSymbolFnCandidates,
   292				getDecimalsFn,
   293				getDecimalsFnCandidates,
   294				balanceOfPublicFn,
   295				balanceOfPublicFnCandidates,
   296				balanceOfPrivateFn,
   297				balanceOfPrivateFnCandidates,
   298				transferPublicFn,
   299				transferPublicFnCandidates,
   300				transferPrivateFn,
   301				transferPrivateFnCandidates,
   302				transferPublicToPrivateFn,
   303				transferPublicToPrivateFnCandidates,
   304				transferPrivateToPublicFn,
   305				transferPrivateToPublicFnCandidates,
   306				isComplete: false,
   307			}
   308			ti.isComplete = isTokenComplete(ti)
   309			return ti
   310		}
   311	
   312		public async parseTokenInterface(networkId: string, contract: string, parentTask?: WrappedTask): Promise<TokenInterface> {
   313			await this.ensureInitialized()
   314			const stepContent = new StepContent("Parsing token interface")
   315			const task = parentTask ? parentTask.startSubtask(stepContent) : this.tasks.startNewTask(stepContent)
   316	
   317			try {
   318				const network = await this.networks.getNetwork(networkId)
   319				if (!network) {
   320					throw new Error("unknown network id")
   321				}
   322	
   323				const pxe = this.pxeService.getPXE(networkInfoFrom(network))
   324	
   325				const instance = await pxe.getContractInstance(AztecAddress.fromString(contract))
   326				if (!instance) {
   327					throw new Error("contract instance not found")
   328				}
   329	
   330				const artifact = await pxe.getContractArtifact(instance.currentContractClassId)
   331				if (!artifact) {
   332					throw new Error("contract artifact not found")
   333				}
   334	
   335				const registeredContracts = await pxe.getContracts()
   336				if (!registeredContracts.find((x) => x.toString() === contract)) {
   337					await pxe.registerContract({
   338						instance,
   339						artifact,
   340					})
   341				}
   342	
   343				const getNameFnCandidates = GetNameFn.getCandidates(artifact)
   344				const getNameFn = GetNameFn.getDefault(getNameFnCandidates)
   345	

exec
/bin/zsh -lc "rg -n 'Contract artifact not found for class|pass the artifact in aztec_registerContract|standard bundled contracts|registerContract\\(instance' packages -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/wallet-bridge/src/dispatcher.ts:618:	 *   - registerContract(instance, artifact?, secretKey?): [ContractInstanceWithAddress, ContractArtifact?, Fr?]
packages/extension/tests/e2e/fixtures/aztec.ts:126:		await wallet.registerContract(instance, SponsoredFPCContractArtifact)
packages/playground/src/sections/contracts.ts:91:			return wallet.registerContract(instance)
packages/extension/src/wallet/services/execution/service.ts:1520:				`Contract artifact not found for class ${classId}. ` +
packages/extension/src/wallet/services/execution/service.ts:1521:					"The wallet only ships artifacts for the standard bundled contracts; " +
packages/extension/src/wallet/services/execution/service.ts:1522:					"pass the artifact in aztec_registerContract({ instance, artifact }) for custom contracts.",
packages/extension/src/wallet/services/execution/contract-resolver.ts:22: *   - `resolveArtifact` → throws `"Contract artifact not found for class ${classId}"`.
packages/extension/src/wallet/services/execution/contract-resolver.ts:99:	 *  `"Contract artifact not found for class ${classId}"` — formatted
packages/extension/src/wallet/services/execution/contract-resolver.ts:104:			throw new Error(`Contract artifact not found for class ${classId}`)
packages/extension/src/wallet/services/execution/contract-resolver.test.ts:8: *     (`"Contract artifact not found for class ${classId}"` — the
packages/extension/src/wallet/services/execution/contract-resolver.test.ts:152:	test("throws the FORMATTED 'Contract artifact not found for class ${classId}' on miss", async () => {
packages/extension/src/wallet/services/execution/contract-resolver.test.ts:154:		await expect(resolver.resolveArtifact(pxe, classId)).rejects.toThrow(/Contract artifact not found for class 0x0a/)

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/pxe/artifact-registry.test.ts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	import { describe, test, expect, vi } from "vitest"
     2	import { Fr } from "@aztec/foundation/curves/bn254"
     3	import type { ContractArtifact } from "@aztec/stdlib/abi"
     4	import type { NetworkInfo } from "@nulo/aztec-runtime/pxe"
     5	import { ArtifactRegistry, defaultPolicy } from "@nulo/aztec-runtime/pxe"
     6	import type { ArtifactClassIdVerifier, KnownArtifactsLoader } from "@nulo/aztec-runtime/pxe"
     7	
     8	const emptyLoader: KnownArtifactsLoader = async () => ({ artifacts: new Map(), instances: new Map() })
     9	
    10	const makeArtifact = (name: string): ContractArtifact => ({ name }) as unknown as ContractArtifact
    11	
    12	/**
    13	 * Pass-through verifier for tests using fake artifacts that don't have
    14	 * the structure needed by upstream `getContractClassFromArtifact`.
    15	 * Treats any artifact as valid for any class id — pre-M4.3 behavior.
    16	 *
    17	 * Tests that exercise the M4.3 verification path itself use
    18	 * `makeMismatchVerifier()` or `makeRecordingVerifier()` below.
    19	 */
    20	const passthroughVerifier: ArtifactClassIdVerifier = {
    21		verify: async (artifact, _expected) => artifact,
    22	}
    23	
    24	/** Verifier that returns undefined for `mismatchClassIds` (simulating
    25	 *  a class-id mismatch) and passes through otherwise. */
    26	const makeMismatchVerifier = (mismatchClassIds: ReadonlySet<string>): ArtifactClassIdVerifier => ({
    27		verify: async (artifact: ContractArtifact, expected: Fr) => (mismatchClassIds.has(expected.toString()) ? undefined : artifact),
    28	})
    29	
    30	/** Verifier that records every (artifact, expected) call, then
    31	 *  delegates to passthrough. Used to assert recompute + cache behavior. */
    32	const makeRecordingVerifier = () => {
    33		const calls: Array<{ artifact: ContractArtifact; expected: string }> = []
    34		const verifier: ArtifactClassIdVerifier = {
    35			verify: async (artifact, expected) => {
    36				calls.push({ artifact, expected: expected.toString() })
    37				return artifact
    38			},
    39		}
    40		return { verifier, calls }
    41	}
    42	
    43	const makeNetwork = (chainId: number): NetworkInfo => ({ profileId: "p1", chainId, rpcUrl: "https://rpc" })
    44	
    45	describe("ArtifactRegistry.resolve", () => {
    46		test("default order: pxe-local → known, first hit wins", async () => {
    47			const reg = new ArtifactRegistry(emptyLoader, { verifier: passthroughVerifier })
    48			const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))
    49			const classId = new Fr(42)
    50			const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
    51			expect((got as { name: string }).name).toBe("pxe-hit")
    52			expect(pxeLookup).toHaveBeenCalledTimes(1)
    53		})
    54	
    55		test("pxeOnly=true skips known", async () => {
    56			const knownArtifact = makeArtifact("known-hit")
    57			const loader: KnownArtifactsLoader = async () => ({
    58				artifacts: new Map([[new Fr(1).toString(), knownArtifact]]),
    59				instances: new Map(),
    60			})
    61			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
    62			const pxeLookup = vi.fn().mockResolvedValue(undefined)
    63			const got = await reg.resolve(new Fr(1), pxeLookup, makeNetwork(1), { pxeOnly: true })
    64			// known has it, but pxeOnly forced the registry to skip the known branch.
    65			expect(got).toBeUndefined()
    66			expect(pxeLookup).toHaveBeenCalledTimes(1)
    67		})
    68	
    69		test("smart-tighten precondition: unknown class-id and pxe-miss → undefined", async () => {
    70			// This is the case `aztec_registerContract` relies on: when a
    71			// dApp doesn't pass an artifact and we can't resolve via PXE
    72			// or the bundled `known` set, resolution returns undefined and
    73			// the caller throws a tightening error.
    74			const reg = new ArtifactRegistry(emptyLoader, { verifier: passthroughVerifier })
    75			const pxeLookup = vi.fn().mockResolvedValue(undefined)
    76			const got = await reg.resolve(new Fr(99), pxeLookup, makeNetwork(1))
    77			expect(got).toBeUndefined()
    78			expect(pxeLookup).toHaveBeenCalledTimes(1)
    79		})
    80	
    81		test("known hit when pxe misses (bundled-standards bypass)", async () => {
    82			// Smart-tighten counterpart: bundled standards still resolve
    83			// without the dApp passing an artifact.
    84			const classId = new Fr(11)
    85			const knownArtifact = makeArtifact("known-hit")
    86			const loader: KnownArtifactsLoader = async () => ({
    87				artifacts: new Map([[classId.toString(), knownArtifact]]),
    88				instances: new Map(),
    89			})
    90			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
    91			const pxeLookup = vi.fn().mockResolvedValue(undefined)
    92			const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
    93			expect(got).toBe(knownArtifact)
    94		})
    95	
    96		test("byClassId pin bypasses order", async () => {
    97			const classId = new Fr(7)
    98			const knownArtifact = makeArtifact("known-hit")
    99			const loader: KnownArtifactsLoader = async () => ({
   100				artifacts: new Map([[classId.toString(), knownArtifact]]),
   101				instances: new Map(),
   102			})
   103			const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
   104			reg.setPolicy({
   105				...defaultPolicy(),
   106				byClassId: { [classId.toString()]: "known" },
   107			})
   108			const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))
   109			const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
   110			// pxe-local would win normally, but pin forces known
   111			expect(got).toBe(knownArtifact)
   112			expect(pxeLookup).not.toHaveBeenCalled()
   113		})
   114	
   115		test("custom order is respected", async () => {
   116			const classId = new Fr(1)
   117			const knownArtifact = makeArtifact("from-known")
   118			const loader: KnownArtifactsLoader = async () => ({
   119				artifacts: new Map([[classId.toString(), knownArtifact]]),
   120				instances: new Map(),

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/pxe/artifact-registry.test.ts | sed -n '214,310p'" in (project root)
 succeeded in 0ms:
   214	/**
   215	 * M4.3 trust-enforcement contract: every artifact returned to the
   216	 * caller has had its class id verified. Mismatches fall through to the
   217	 * next source (or return undefined if no source matched).
   218	 */
   219	describe("ArtifactRegistry.resolve — M4.3 class-id trust enforcement", () => {
   220		test("pxe-local mismatch → falls through to known (or undefined)", async () => {
   221			const classId = new Fr(99)
   222			const verifier = makeMismatchVerifier(new Set([classId.toString()]))
   223			const reg = new ArtifactRegistry(emptyLoader, { verifier })
   224			// pxe-local returns a tampered artifact; verifier rejects.
   225			const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-tampered"))
   226	
   227			const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
   228	
   229			// pxe-local mismatch → fall through to known (no entry) → undefined.
   230			expect(got).toBeUndefined()
   231		})
   232	
   233		test("pxeOnly + mismatched pxe-local → undefined (no fall-through)", async () => {
   234			const classId = new Fr(7)
   235			const verifier = makeMismatchVerifier(new Set([classId.toString()]))
   236			const reg = new ArtifactRegistry(emptyLoader, { verifier })
   237			const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-tampered"))
   238	
   239			const got = await reg.resolve(classId, pxeLookup, makeNetwork(1), { pxeOnly: true })
   240	
   241			expect(got).toBeUndefined()
   242		})
   243	
   244		test("verifier cache: repeat resolve of same classId does NOT recompute", async () => {
   245			const classId = new Fr(123)
   246			const { verifier, calls } = makeRecordingVerifier()
   247			const reg = new ArtifactRegistry(emptyLoader, { verifier })
   248			const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))
   249	
   250			const first = await reg.resolve(classId, pxeLookup, makeNetwork(1))
   251			const second = await reg.resolve(classId, pxeLookup, makeNetwork(1))
   252	
   253			expect((first as { name: string }).name).toBe("pxe-hit")
   254			expect((second as { name: string }).name).toBe("pxe-hit")
   255			// Verifier called exactly once — second resolve hit the
   256			// `verifiedClassIds` cache.
   257			expect(calls).toHaveLength(1)
   258			expect(calls[0].expected).toBe(classId.toString())
   259		})
   260	
   261		test("clear() empties verifiedClassIds cache", async () => {
   262			const classId = new Fr(45)
   263			const { verifier, calls } = makeRecordingVerifier()
   264			const reg = new ArtifactRegistry(emptyLoader, { verifier })
   265			const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))
   266	
   267			await reg.resolve(classId, pxeLookup, makeNetwork(1))
   268			expect(calls).toHaveLength(1)
   269	
   270			reg.clear()
   271			await reg.resolve(classId, pxeLookup, makeNetwork(1))
   272			// Cache cleared → verifier called again.
   273			expect(calls).toHaveLength(2)
   274		})
   275	
   276		test("known branch does NOT recompute (already keyed by load-time class id)", async () => {
   277			const classId = new Fr(11)
   278			const knownArtifact = makeArtifact("known-hit")
   279			const loader: KnownArtifactsLoader = async () => ({
   280				artifacts: new Map([[classId.toString(), knownArtifact]]),
   281				instances: new Map(),
   282			})
   283			const { verifier, calls } = makeRecordingVerifier()
   284			const reg = new ArtifactRegistry(loader, { verifier })
   285			const pxeLookup = vi.fn().mockResolvedValue(undefined)
   286	
   287			const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
   288	
   289			expect(got).toBe(knownArtifact)
   290			// Known branch returned the artifact WITHOUT calling the
   291			// verifier — the load-time `loadProductionKnownArtifacts` step
   292			// already keyed by class-id-from-Poseidon, so the
   293			// `Map.get(classId.toString())` lookup is itself the equality
   294			// check. Recomputing would be hash twice.
   295			expect(calls).toHaveLength(0)
   296		})
   297	})

codex
The remaining question is whether the duplicate `loadContractArtifact()` calls are materially bad or just ugly. I’m checking the actual implementation in the installed Aztec package so I can answer that from code, not assumption.
exec
/bin/zsh -lc "rg -n 'function loadContractArtifact|const loadContractArtifact|export .*loadContractArtifact|loadContractArtifact\\(' node_modules packages -g '"'!**/node_modules/.cache/**'"' | head -n 40" in (project root)
 succeeded in 0ms:
node_modules/@aztec/accounts/src/ecdsa/ecdsa_k/index.ts:14:export const EcdsaKAccountContractArtifact: ContractArtifact = loadContractArtifact(
node_modules/@aztec/accounts/src/stub/schnorr/index.ts:10:export const StubSchnorrAccountContractArtifact = loadContractArtifact(
node_modules/@aztec/accounts/src/stub/schnorr/lazy.ts:15:  return loadContractArtifact(json);
node_modules/@aztec/accounts/src/ecdsa/ecdsa_k/lazy.ts:23:  return loadContractArtifact(ecdsaKAccountContractJson);
node_modules/@aztec/accounts/src/stub/ecdsa/index.ts:10:export const StubEcdsaAccountContractArtifact = loadContractArtifact(SimulatedEcdsaAccountJson as NoirCompiledContract);
node_modules/@aztec/accounts/src/schnorr/index.ts:19:export const SchnorrAccountContractArtifact = loadContractArtifact(SchnorrAccountContractJson as NoirCompiledContract);
node_modules/@aztec/accounts/src/ecdsa/ecdsa_r/index.ts:14:export const EcdsaRAccountContractArtifact: ContractArtifact = loadContractArtifact(
node_modules/@aztec/accounts/src/stub/ecdsa/lazy.ts:15:  return loadContractArtifact(json);
node_modules/@aztec/accounts/src/schnorr/lazy.ts:28:  return loadContractArtifact(schnorrAccountContractJson);
node_modules/@aztec/accounts/src/ecdsa/ecdsa_r/lazy.ts:23:  return loadContractArtifact(ecdsaKAccountContractJson);
packages/aztec-runtime/src/pxe/known-artifacts.ts:39:	const WonderlandTokenArtifact = loadContractArtifact(WonderlandTokenJson)
node_modules/@aztec/accounts/dest/stub/schnorr/lazy.js:11:    return loadContractArtifact(json);
packages/aztec-runtime/src/pxe/note-schemas.ts:69:		const wonderlandTokenArtifact = loadContractArtifact(WonderlandTokenJson)
node_modules/@aztec/accounts/dest/stub/schnorr/index.js:8:export const StubSchnorrAccountContractArtifact = loadContractArtifact(SimulatedSchnorrAccountJson);
node_modules/@aztec/accounts/dest/stub/ecdsa/lazy.js:11:    return loadContractArtifact(json);
node_modules/@aztec/accounts/dest/stub/ecdsa/index.js:8:export const StubEcdsaAccountContractArtifact = loadContractArtifact(SimulatedEcdsaAccountJson);
node_modules/@aztec/accounts/dest/schnorr/lazy.js:20:    return loadContractArtifact(schnorrAccountContractJson);
node_modules/@aztec/accounts/dest/schnorr/index.js:13:export const SchnorrAccountContractArtifact = loadContractArtifact(SchnorrAccountContractJson);
node_modules/@aztec/accounts/dest/ecdsa/ecdsa_k/lazy.js:18:    return loadContractArtifact(ecdsaKAccountContractJson);
node_modules/@aztec/accounts/dest/ecdsa/ecdsa_k/index.js:11:export const EcdsaKAccountContractArtifact = loadContractArtifact(EcdsaKAccountContractJson);
node_modules/@aztec/accounts/dest/ecdsa/ecdsa_r/index.js:11:export const EcdsaRAccountContractArtifact = loadContractArtifact(EcdsaRAccountContractJson);
node_modules/@aztec/accounts/dest/ecdsa/ecdsa_r/lazy.js:18:    return loadContractArtifact(ecdsaKAccountContractJson);
packages/extension/src/wallet/services/note/note-schemas.test.ts:60:		const artifact = loadContractArtifact(WonderlandTokenJson)
packages/extension/src/wallet/services/fpc/service.ts:22:const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)

exec
/bin/zsh -lc "rg -n 'loadContractArtifact\\(' node_modules/.bun -g '*/@aztec*/**/*.ts' | head -n 40" in (project root)
 succeeded in 0ms:
exec
/bin/zsh -lc "rg -n 'loadContractArtifact' node_modules/.bun/@aztec+stdlib@*/node_modules/@aztec/stdlib -g '**/*.{ts,js,mjs,cjs}'" in (project root)
 succeeded in 0ms:
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/tests/fixtures.ts:5:import { type ContractArtifact, loadContractArtifact } from '../abi/index.js';
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/tests/fixtures.ts:12:  return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/tests/fixtures.ts:19:  return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/tests/fixtures.ts:26:  return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:52:export function loadContractArtifact(input: NoirCompiledContract): ContractArtifact {
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:61: * Differs from loadContractArtifact() by retaining all bytecode.
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:65:export function loadContractArtifactForPublic(input: NoirCompiledContract): ContractArtifact {
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/tests/fixtures.ts:5:import { type ContractArtifact, loadContractArtifact } from '../abi/index.js';
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/tests/fixtures.ts:12:  return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/tests/fixtures.ts:19:  return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/tests/fixtures.ts:26:  return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:52:export function loadContractArtifact(input: NoirCompiledContract): ContractArtifact {
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:61: * Differs from loadContractArtifact() by retaining all bytecode.
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:65:export function loadContractArtifactForPublic(input: NoirCompiledContract): ContractArtifact {
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js:23: */ export function loadContractArtifact(input) {
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js:31: * Differs from loadContractArtifact() by retaining all bytecode.
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js:34: */ export function loadContractArtifactForPublic(input) {
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/tests/fixtures.js:4:import { loadContractArtifact } from '../abi/index.js';
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/tests/fixtures.js:9:    return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/tests/fixtures.js:15:    return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/tests/fixtures.js:21:    return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.d.ts:21:export declare function loadContractArtifact(input: NoirCompiledContract): ContractArtifact;
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.d.ts:24: * Differs from loadContractArtifact() by retaining all bytecode.
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.d.ts:28:export declare function loadContractArtifactForPublic(input: NoirCompiledContract): ContractArtifact;
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/tests/fixtures.js:4:import { loadContractArtifact } from '../abi/index.js';
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/tests/fixtures.js:9:    return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/tests/fixtures.js:15:    return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/tests/fixtures.js:21:    return loadContractArtifact(content);
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/abi/contract_artifact.d.ts:21:export declare function loadContractArtifact(input: NoirCompiledContract): ContractArtifact;
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/abi/contract_artifact.d.ts:24: * Differs from loadContractArtifact() by retaining all bytecode.
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/abi/contract_artifact.d.ts:28:export declare function loadContractArtifactForPublic(input: NoirCompiledContract): ContractArtifact;
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js:23: */ export function loadContractArtifact(input) {
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js:31: * Differs from loadContractArtifact() by retaining all bytecode.
node_modules/.bun/@aztec+stdlib@4.2.0-aztecnr-rc.2/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js:34: */ export function loadContractArtifactForPublic(input) {

exec
/bin/zsh -lc "nl -ba node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts | sed -n '1,120p'" in (project root)
exec
/bin/zsh -lc "nl -ba node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/dest/abi/contract_artifact.js | sed -n '1,80p'" in (project root)
 succeeded in 0ms:
     1	import { jsonParseWithSchema, jsonStringify } from '@aztec/foundation/json-rpc';
     2	import { AZTEC_INITIALIZER_ATTRIBUTE, AZTEC_ONLY_SELF_ATTRIBUTE, AZTEC_PRIVATE_ATTRIBUTE, AZTEC_PUBLIC_ATTRIBUTE, AZTEC_UTILITY_ATTRIBUTE, AZTEC_VIEW_ATTRIBUTE } from '../noir/index.js';
     3	import { ContractArtifactSchema, FunctionType } from './abi.js';
     4	/**
     5	 * Serializes a contract artifact to a buffer for storage.
     6	 * @param artifact - Artifact to serialize.
     7	 * @returns A buffer.
     8	 */ export function contractArtifactToBuffer(artifact) {
     9	    return Buffer.from(jsonStringify(artifact), 'utf-8');
    10	}
    11	/**
    12	 * Deserializes a contract artifact from storage.
    13	 * @param buffer - Buffer to deserialize.
    14	 * @returns Deserialized artifact.
    15	 */ export function contractArtifactFromBuffer(buffer) {
    16	    return jsonParseWithSchema(buffer.toString('utf-8'), ContractArtifactSchema);
    17	}
    18	/**
    19	 * Gets nargo build output and returns a valid contract artifact instance.
    20	 * Does not include public bytecode, apart from the public_dispatch function.
    21	 * @param input - Input object as generated by nargo compile.
    22	 * @returns A valid contract artifact instance.
    23	 */ export function loadContractArtifact(input) {
    24	    if (isContractArtifact(input)) {
    25	        return input;
    26	    }
    27	    return generateContractArtifact(input);
    28	}
    29	/**
    30	 * Gets nargo build output and returns a valid contract artifact instance.
    31	 * Differs from loadContractArtifact() by retaining all bytecode.
    32	 * @param input - Input object as generated by nargo compile.
    33	 * @returns A valid contract artifact instance.
    34	 */ export function loadContractArtifactForPublic(input) {
    35	    return generateContractArtifactForPublic(input);
    36	}
    37	/**
    38	 * Checks if the given input looks like a valid ContractArtifact. The check is not exhaustive,
    39	 * and it's just meant to differentiate between nargo raw build artifacts and the ones
    40	 * produced by this compiler.
    41	 * @param input - Input object.
    42	 * @returns True if it looks like a ContractArtifact.
    43	 */ function isContractArtifact(input) {
    44	    if (typeof input !== 'object') {
    45	        return false;
    46	    }
    47	    const maybeContractArtifact = input;
    48	    if (typeof maybeContractArtifact.name !== 'string') {
    49	        return false;
    50	    }
    51	    if (!Array.isArray(maybeContractArtifact.functions)) {
    52	        return false;
    53	    }
    54	    for (const fn of maybeContractArtifact.functions){
    55	        if (typeof fn.name !== 'string') {
    56	            return false;
    57	        }
    58	        if (typeof fn.functionType !== 'string') {
    59	            return false;
    60	        }
    61	        if (!retainBytecode(fn) && fn.bytecode.length) {
    62	            // We want to remove the bytecode of public fns (apart from the dispatch fn) to save space
    63	            // If the input is private-only, we don't need to use generateContractArtifact() below
    64	            return false;
    65	        }
    66	    }
    67	    if (!Array.isArray(maybeContractArtifact.nonDispatchPublicFunctions)) {
    68	        return false;
    69	    }
    70	    for (const fn of maybeContractArtifact.nonDispatchPublicFunctions){
    71	        if (typeof fn.name !== 'string') {
    72	            return false;
    73	        }
    74	        if (typeof fn.functionType !== 'string') {
    75	            return false;
    76	        }
    77	    }
    78	    return true;
    79	}
    80	/**

 succeeded in 0ms:
     1	import { jsonParseWithSchema, jsonStringify } from '@aztec/foundation/json-rpc';
     2	
     3	import {
     4	  AZTEC_INITIALIZER_ATTRIBUTE,
     5	  AZTEC_ONLY_SELF_ATTRIBUTE,
     6	  AZTEC_PRIVATE_ATTRIBUTE,
     7	  AZTEC_PUBLIC_ATTRIBUTE,
     8	  AZTEC_UTILITY_ATTRIBUTE,
     9	  AZTEC_VIEW_ATTRIBUTE,
    10	  type NoirCompiledContract,
    11	} from '../noir/index.js';
    12	import {
    13	  type ABIParameter,
    14	  type ABIParameterVisibility,
    15	  type AbiType,
    16	  type BasicValue,
    17	  type ContractArtifact,
    18	  ContractArtifactSchema,
    19	  type FieldLayout,
    20	  type FunctionAbi,
    21	  type FunctionArtifact,
    22	  FunctionType,
    23	  type IntegerValue,
    24	  type StructValue,
    25	  type TypedStructFieldValue,
    26	} from './abi.js';
    27	
    28	/**
    29	 * Serializes a contract artifact to a buffer for storage.
    30	 * @param artifact - Artifact to serialize.
    31	 * @returns A buffer.
    32	 */
    33	export function contractArtifactToBuffer(artifact: ContractArtifact): Buffer {
    34	  return Buffer.from(jsonStringify(artifact), 'utf-8');
    35	}
    36	
    37	/**
    38	 * Deserializes a contract artifact from storage.
    39	 * @param buffer - Buffer to deserialize.
    40	 * @returns Deserialized artifact.
    41	 */
    42	export function contractArtifactFromBuffer(buffer: Buffer): ContractArtifact {
    43	  return jsonParseWithSchema(buffer.toString('utf-8'), ContractArtifactSchema);
    44	}
    45	
    46	/**
    47	 * Gets nargo build output and returns a valid contract artifact instance.
    48	 * Does not include public bytecode, apart from the public_dispatch function.
    49	 * @param input - Input object as generated by nargo compile.
    50	 * @returns A valid contract artifact instance.
    51	 */
    52	export function loadContractArtifact(input: NoirCompiledContract): ContractArtifact {
    53	  if (isContractArtifact(input)) {
    54	    return input;
    55	  }
    56	  return generateContractArtifact(input);
    57	}
    58	
    59	/**
    60	 * Gets nargo build output and returns a valid contract artifact instance.
    61	 * Differs from loadContractArtifact() by retaining all bytecode.
    62	 * @param input - Input object as generated by nargo compile.
    63	 * @returns A valid contract artifact instance.
    64	 */
    65	export function loadContractArtifactForPublic(input: NoirCompiledContract): ContractArtifact {
    66	  return generateContractArtifactForPublic(input);
    67	}
    68	
    69	/**
    70	 * Checks if the given input looks like a valid ContractArtifact. The check is not exhaustive,
    71	 * and it's just meant to differentiate between nargo raw build artifacts and the ones
    72	 * produced by this compiler.
    73	 * @param input - Input object.
    74	 * @returns True if it looks like a ContractArtifact.
    75	 */
    76	function isContractArtifact(input: any): input is ContractArtifact {
    77	  if (typeof input !== 'object') {
    78	    return false;
    79	  }
    80	  const maybeContractArtifact = input as ContractArtifact;
    81	  if (typeof maybeContractArtifact.name !== 'string') {
    82	    return false;
    83	  }
    84	  if (!Array.isArray(maybeContractArtifact.functions)) {
    85	    return false;
    86	  }
    87	  for (const fn of maybeContractArtifact.functions) {
    88	    if (typeof fn.name !== 'string') {
    89	      return false;
    90	    }
    91	    if (typeof fn.functionType !== 'string') {
    92	      return false;
    93	    }
    94	    if (!retainBytecode(fn) && fn.bytecode.length) {
    95	      // We want to remove the bytecode of public fns (apart from the dispatch fn) to save space
    96	      // If the input is private-only, we don't need to use generateContractArtifact() below
    97	      return false;
    98	    }
    99	  }
   100	  if (!Array.isArray(maybeContractArtifact.nonDispatchPublicFunctions)) {
   101	    return false;
   102	  }
   103	  for (const fn of maybeContractArtifact.nonDispatchPublicFunctions) {
   104	    if (typeof fn.name !== 'string') {
   105	      return false;
   106	    }
   107	    if (typeof fn.functionType !== 'string') {
   108	      return false;
   109	    }
   110	  }
   111	  return true;
   112	}
   113	
   114	/** Parameter in a function from a noir contract compilation artifact */
   115	type NoirCompiledContractFunctionParameter = NoirCompiledContractFunction['abi']['parameters'][number];
   116	
   117	/**
   118	 * Generates a function parameter out of one generated by a nargo build.
   119	 * @param param - Noir parameter.
   120	 * @returns A function parameter.

exec
/bin/zsh -lc "nl -ba packages/extension/vite.chrome.config.mts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	import { defineConfig } from "vite"
     2	import { crx } from "@crxjs/vite-plugin"
     3	
     4	import manifest from "./manifest/manifest.chrome.config"
     5	import viteConfig from "./vite.config"
     6	
     7	viteConfig.plugins?.push(
     8		crx({
     9			manifest,
    10			browser: "chrome",
    11		}),
    12	)
    13	
    14	if (!viteConfig.build) {
    15		viteConfig.build = {}
    16	}
    17	
    18	viteConfig.build.outDir = "dist/chrome"
    19	
    20	export default defineConfig({
    21		...viteConfig,
    22	})

exec
/bin/zsh -lc "nl -ba packages/extension/vite.firefox.config.mts | sed -n '1,120p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/contract-resolver.test.ts | sed -n '140,180p'" in (project root)
 succeeded in 0ms:
     1	import { defineConfig } from "vite"
     2	import { crx } from "@crxjs/vite-plugin"
     3	
     4	import manifest from "./manifest/manifest.firefox.config"
     5	import viteConfig from "./vite.config"
     6	
     7	viteConfig.plugins?.push(
     8		crx({
     9			manifest,
    10			browser: "firefox",
    11		}),
    12	)
    13	
    14	if (!viteConfig.build) {
    15		viteConfig.build = {}
    16	}
    17	
    18	viteConfig.build.outDir = "dist/firefox"
    19	
    20	export default defineConfig({
    21		...viteConfig,
    22	})

 succeeded in 0ms:
   140	describe("ContractResolver.resolveArtifact", () => {
   141		const resolver = new ContractResolver(fakeLogger())
   142		const classId = "0x0a"
   143	
   144		test("returns [classId, artifact] on PXE hit", async () => {
   145			const getContractArtifact = vi.fn(async () => ({ name: "Token" }) as unknown as ContractArtifact)
   146			const pxe = fakePxe({ getContractArtifact })
   147			const [c, art] = await resolver.resolveArtifact(pxe, classId)
   148			expect(c).toBe(classId)
   149			expect((art as unknown as { name: string }).name).toBe("Token")
   150		})
   151	
   152		test("throws the FORMATTED 'Contract artifact not found for class ${classId}' on miss", async () => {
   153			const pxe = fakePxe({ getContractArtifact: async () => undefined })
   154			await expect(resolver.resolveArtifact(pxe, classId)).rejects.toThrow(/Contract artifact not found for class 0x0a/)
   155		})
   156	})
   157	
   158	describe("ContractResolver.resolveArtifacts", () => {
   159		const resolver = new ContractResolver(fakeLogger())
   160	
   161		test("dedupes by class id — one fetch per unique class", async () => {
   162			const instances = new Map<string, ContractInstanceWithAddress>()
   163			instances.set("0xAA", fakeInstance("0x01"))
   164			instances.set("0xBB", fakeInstance("0x01")) // same class id
   165			instances.set("0xCC", fakeInstance("0x02")) // different
   166	
   167			const getContractArtifact = vi.fn(async () => ({}) as ContractArtifact)
   168			const pxe = fakePxe({ getContractArtifact })
   169			const result = await resolver.resolveArtifacts(pxe, instances)
   170	
   171			expect(result.size).toBe(2)
   172			expect(result.has("0x01")).toBe(true)
   173			expect(result.has("0x02")).toBe(true)
   174			// Only 2 unique class ids → only 2 PXE calls despite 3 instances.
   175			expect(getContractArtifact).toHaveBeenCalledTimes(2)
   176		})
   177	
   178		test("returns empty map for empty instances", async () => {
   179			const pxe = fakePxe()
   180			const result = await resolver.resolveArtifacts(pxe, new Map())

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/fpc/service.ts | sed -n '288,324p'" in (project root)
 succeeded in 0ms:
   288			const fpcInfo = await this.storage.get(id)
   289			if (fpcInfo?.profileId !== profile.id) {
   290				throw new Error("Invalid id")
   291			}
   292			const fpcHandler = getFpcHandler(fpcInfo.type)
   293			return new Fpc(fpcInfo, fpcHandler)
   294		}
   295	
   296		/**
   297		 * Detect FPC type from contract artifact by inspecting function signatures.
   298		 * - `sponsor_unconditionally` → DefaultSponsoredFpc
   299		 * - `pay_fee` + `balance_of` (no `sponsor_unconditionally`) → PrivateFpc
   300		 * - `get_accepted_asset` → DefaultFpc
   301		 */
   302		private detectFpcType(artifact: { name: string; functions: { name: string }[] }): FpcType {
   303			const hasSponsorUnconditionally = artifact.functions.some((f) => f.name === "sponsor_unconditionally")
   304			if (hasSponsorUnconditionally) {
   305				return FpcType.DefaultSponsoredFpc
   306			}
   307	
   308			const hasPayFee = artifact.functions.some((f) => f.name === "pay_fee")
   309			const hasBalanceOf = artifact.functions.some((f) => f.name === "balance_of")
   310			if (hasPayFee && hasBalanceOf) {
   311				return FpcType.PrivateFpc
   312			}
   313	
   314			if (artifact.name === "FPC" || artifact.functions.some((f) => f.name === "get_accepted_asset")) {
   315				return FpcType.DefaultFpc
   316			}
   317	
   318			return FpcType.DefaultSponsoredFpc
   319		}
   320	
   321		private readonly onProfileDeleted = async (profile: ProfileInfo) => {
   322			this.logDebug(`Profile ${profile.id} deleted, remove related FPCs`)
   323			try {
   324				await this.lock.enter()

exec
/bin/zsh -lc "nl -ba packages/extension/src/utils/core.ts | sed -n '132,156p'" in (project root)
 succeeded in 0ms:
   132	export function initTransactionService(onTransactionAdded: (tx: Tx) => void, onTransactionUpdated: (tx: Tx) => void): void {
   133		if (managers.transaction) managers.transaction.disconnect()
   134		const transactionService = new TransactionServiceClient()
   135		transactionService.onTransactionAdded.add(onTransactionAdded)
   136		transactionService.onTransactionUpdated.add(onTransactionUpdated)
   137		transactionService.connect()
   138		managers.transaction = transactionService
   139	}
   140	
   141	const sentinelPath = "nulo:ui:sentinel"
   142	
   143	export async function setSentinel(): Promise<void> {
   144		await chrome.storage.local.set({ [sentinelPath]: __SENTINEL__ })
   145	}
   146	
   147	export async function checkSentinel(): Promise<boolean> {
   148		return (await chrome.storage.local.get(sentinelPath))[sentinelPath] === __SENTINEL__
   149	}

exec
/bin/zsh -lc "rg -n '__SENTINEL__|sentinelPath|sentinel' packages/extension/src packages/extension/tests packages/extension -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/extension/tests/e2e/fixtures/aztec.ts:324:	// Use `NO_FROM` sentinel per canonical pattern at @aztec/wallets/testing
packages/extension/vitest.config.ts:48:		__SENTINEL__: JSON.stringify(packageJson.sentinel),
packages/extension/vite.config.ts:203:		__SENTINEL__: JSON.stringify(packageJson.sentinel),
packages/extension/package.json:7:	"sentinel": "7",
packages/extension/tests/e2e/fixtures/aztec.ts:324:	// Use `NO_FROM` sentinel per canonical pattern at @aztec/wallets/testing
packages/extension/src/types/vite-env.d.ts:5:declare const __SENTINEL__: string
packages/extension/src/utils/core.ts:141:const sentinelPath = "nulo:ui:sentinel"
packages/extension/src/utils/core.ts:144:	await chrome.storage.local.set({ [sentinelPath]: __SENTINEL__ })
packages/extension/src/utils/core.ts:148:	return (await chrome.storage.local.get(sentinelPath))[sentinelPath] === __SENTINEL__
packages/extension/src/types/vite-env.d.ts:5:declare const __SENTINEL__: string
packages/extension/src/utils/core.ts:141:const sentinelPath = "nulo:ui:sentinel"
packages/extension/src/utils/core.ts:144:	await chrome.storage.local.set({ [sentinelPath]: __SENTINEL__ })
packages/extension/src/utils/core.ts:148:	return (await chrome.storage.local.get(sentinelPath))[sentinelPath] === __SENTINEL__

exec
/bin/zsh -lc "rg -n 'version bump|sentinel bump|__VERSION__' implementations-plan packages/extension -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
implementations-plan/contacts-rename-export-senders/audit-plan-agent.md:35:The plan proposes `{version: 2, contacts: [...]}` with autodetect on import (lines 89-105). I disagree: the project's storage policy is a destructive wipe-and-reseed at version bumps (`wallet/storage/migrate.ts:1-14`) and the user/runbook explicitly says "never write storage migrations." That policy should logically extend to user-facing JSON exports too.
implementations-plan/registry-stealth-notes/audit-codex.md:32:- **If PR 3 ends up using an explicit slot map, keep that data with the artifact-bundling commit instead of the parser commit.** The current `3.A / 3.B / 3.C` split is reasonable (`implementations-plan/registry-stealth-notes/plan-v1.md:206-206`), but the slot-to-note-schema table is effectively artifact metadata, not parser behavior. Keeping it with the bundle commit will make the parser commit easier to review and easier to diff against future artifact-version bumps.
packages/extension/src/wallet/services/wallet-sdk/background.ts:43:declare const __VERSION__: string
packages/extension/src/wallet/services/wallet-sdk/background.ts:93:			walletVersion: __VERSION__,
implementations-plan/M6/STATUS.md:84:- [x] `.storybook/main.ts` — Vue3-Vite framework, stories glob `src/components/**/*.stories.@(ts|vue)`, viteFinal mirrors `__VERSION__` defines + path aliases
implementations-plan/registry-stealth-notes/plan-v2.md:183:- **Slot-map invariant test**: assert each NOTE_SCHEMAS entry's slot exists in the corresponding artifact's `storageLayout` — so a future artifact-version bump that renumbers slots breaks loud, not silent.
implementations-plan/registry-stealth-notes/audit-plan-agent.md:51:- The map is artifact metadata, not parser logic. Codex's NICE-TO-HAVE about colocating it with the bundle commit is correct — keep it next to `known-artifacts.ts` so artifact-version bumps and slot-map updates land in the same diff.
implementations-plan/registry-stealth-notes/audit-plan-agent.md:123:- Add: artifact-bundle test that asserts the slot-map matches the artifact's `outputs.globals.storage` (so a future artifact-version bump that renumbers slots breaks loud, not silent).
implementations-plan/bundle-fpc-nft/audit-plan-agent.md:20:The plan defers the missing test to "manual QA on a real profile". I agree the WASM flakiness justifies skipping in CI, but the gap is real: **storage-layout tests catch slot drift, they don't catch class-id drift between `known-artifacts.ts` and `note-schemas.ts`.** If the artifact JSON changes (rebuild, version bump) and only one module's cache picks up the new bytes, the schema map will key against a stale class-id and the bundle will key against the new one. The storage gates won't fire because the slot is still 0x1.
implementations-plan/bundle-fpc-nft/audit-plan-agent.md:40:### N1. Plan doesn't mention the version bump rationale
packages/extension/src/popup/pages/settings/about.vue:16:const version = __VERSION__
implementations-plan/M3/audit-agent.md:69:The M3.5 plan correctly identifies `rpc/types.ts` and `background.ts` as importing `packageJson.version`, and proposes `__VERSION__` as the fix. However, `dispatcher.ts` **also** imports `packageJson` at line 73 and uses `packageJson.version` in 3 places (lines 364, 392, 489 — wallet info structs in `requestCapabilities` responses).
implementations-plan/M3/audit-agent.md:71:All three files need the `__VERSION__` substitution. The plan is incomplete on this point.
implementations-plan/M3/audit-agent.md:73:Additionally, vitest for `wallet-bridge` will need `define: { __VERSION__: '"0.0.0"' }` injected (the plan does note this as Risk #1, so the awareness is there, but the fix must cover all three files, not just one).
implementations-plan/M3/audit-agent.md:145:### I6 — M3.5: `__VERSION__` as `declare const` is correct TypeScript
implementations-plan/M3/audit-agent.md:147:`declare const __VERSION__: string` is the standard pattern for Vite global defines. The define is injected at bundle time as a string literal replacement (e.g., `"0.12.3"`). TypeScript sees the ambient declaration and allows the usage without importing. This is well-established and correct.
implementations-plan/M3/audit-agent.md:149:The one gotcha: `declare const` must appear in a `.d.ts` file or at top-level in the source file (not inside a block). The plan's inline example (`declare const __VERSION__: string` at module top-level) is valid. Alternatively, add it to `packages/wallet-bridge/src/env.d.ts` to keep it out of the implementation files.
implementations-plan/M3/audit-agent.md:151:For vitest in wallet-bridge: since `rpc/types.ts` uses `__VERSION__` at module load time (it's in the `NuloWalletInfo` constant initializer), any test that imports `rpc/types.ts` will hit an undefined `__VERSION__` unless vitest's `define` option is set. The M3.5 risk register correctly flags this (Risk #1). Make sure the wallet-bridge `vitest.config.ts` includes `define: { __VERSION__: '"0.0.0-test"' }`.
implementations-plan/M3/audit-agent.md:251:| I6 | `declare const __VERSION__` pattern is correct; needs vitest define | M3.5 | Improvement | Confirm |
packages/extension/src/components/update.vue:2:const version = __VERSION__
implementations-plan/M3/audit-codex.md:29:6. M3.5 __VERSION__ define: Is 'declare const __VERSION__: string' correct TypeScript for a Vite define? Will it work in vitest without special config?
implementations-plan/M3/audit-codex.md:1016:4. Use `__VERSION__` define (already set in vite config: `define: { __VERSION__: ... }`).
implementations-plan/M3/audit-codex.md:1018:**Decision: Option 4** — replace `packageJson.version` with `__VERSION__` (a Vite compile-time define). The extension's `vite.config.ts` already sets this. `wallet-bridge/src/rpc/types.ts` uses `declare const __VERSION__: string` and accesses `__VERSION__` directly. Zero path gymnastics.
implementations-plan/M3/audit-codex.md:1022:declare const __VERSION__: string
implementations-plan/M3/audit-codex.md:1026:  version: __VERSION__,
implementations-plan/M3/audit-codex.md:1030:The `viteStaticCopy` and other vite plugins continue to run in the extension's build context; the `__VERSION__` define is injected at that build time. No per-package build step needed.
implementations-plan/M3/audit-codex.md:1141:3. Patch `__VERSION__` access
implementations-plan/M3/audit-codex.md:1152:| 1 | **`__VERSION__` not available in jest/vitest** without Vite define injection | MED | Add `define: { __VERSION__: '"0.0.0"' }` in wallet-bridge's vitest config if tests use it |
implementations-plan/M3/audit-codex.md:1162:- 0.5 day: `__VERSION__` + NuloWalletInfo patch
implementations-plan/M3/audit-codex.md:1937:/bin/zsh -lc "pwd && rg -n \"bb-fetch-code|useAutoImport|useComponents|dedupe|offscreen|__VERSION__|dependency-cruiser|depcruise|StorageType|wrapParams|unwrapParams|zod-helpers|chrome\\.storage|EntityStorage|ValueStorage|fake-browser|@crxjs/vite-plugin|@aztec/bb\\.js|loadPaths|vite-plugin-pages|@assets\" packages/extension -S" in (project root)
implementations-plan/M3/audit-codex.md:1955:packages/extension/vite.config.ts:191:		__VERSION__: JSON.stringify(packageJson.version),
implementations-plan/M3/audit-codex.md:1963:packages/extension/src/popup/pages/settings/about.vue:16:const version = __VERSION__
implementations-plan/M3/audit-codex.md:1989:packages/extension/src/components/update.vue:2:const version = __VERSION__
implementations-plan/M3/audit-codex.md:1992:packages/extension/src/components/install.vue:3:const version = __VERSION__
implementations-plan/M3/audit-codex.md:2024:packages/extension/src/popup/pages/settings/profile/index.vue:22:const version = __VERSION__
implementations-plan/M3/audit-codex.md:2036:packages/extension/src/popup/pages/settings/security/export/full.vue:57:const version = __VERSION__
implementations-plan/M3/audit-codex.md:2082:packages/extension/src/types/vite-env.d.ts:4:declare const __VERSION__: string
implementations-plan/M3/audit-codex.md:2403:		__VERSION__: JSON.stringify(packageJson.version),
implementations-plan/M3/audit-codex.md:4097:declare const __VERSION__: string
implementations-plan/M3/audit-codex.md:11440:   191			__VERSION__: JSON.stringify(packageJson.version),
implementations-plan/M3/audit-codex.md:11714:     4	declare const __VERSION__: string
implementations-plan/M3/audit-codex.md:13784:- `__VERSION__` is fine for Vite build-time replacement, but current Vitest config does not define it ([vite.config.ts]((project root)/packages/extension/vite.config.ts:190), [vitest.config.ts]((project root)/packages/extension/vitest.config.ts:4)).
implementations-plan/M3/audit-codex.md:13802:6. `declare const __VERSION__: string` is correct TypeScript for a Vite `define`; the repo already uses that pattern ([vite-env.d.ts]((project root)/packages/extension/src/types/vite-env.d.ts:4)). It will not automatically work in Vitest unless that Vitest config also defines `__VERSION__` or stubs it.
implementations-plan/M3/audit-codex.md:13836:- `__VERSION__` is fine for Vite build-time replacement, but current Vitest config does not define it ([vite.config.ts]((project root)/packages/extension/vite.config.ts:190), [vitest.config.ts]((project root)/packages/extension/vitest.config.ts:4)).
implementations-plan/M3/audit-codex.md:13854:6. `declare const __VERSION__: string` is correct TypeScript for a Vite `define`; the repo already uses that pattern ([vite-env.d.ts]((project root)/packages/extension/src/types/vite-env.d.ts:4)). It will not automatically work in Vitest unless that Vitest config also defines `__VERSION__` or stubs it.
implementations-plan/pre-a11-ux-cleanup/plan-v4.md:213:- Each branch ends with patch version bump + commit.
implementations-plan/M3/5/stage-d-handoff.md:93:### Step 5 — packageJson → __VERSION__
implementations-plan/M3/5/stage-d-handoff.md:98:1. Replace `import packageJson` with `declare const __VERSION__: string`.
implementations-plan/M3/5/stage-d-handoff.md:99:2. Replace `packageJson.version` with `__VERSION__`.
implementations-plan/M3/5/stage-d-handoff.md:100:3. Verify extension's vite.config + vitest.config both `define` `__VERSION__` (already done — see vite.config.ts:201-202, vitest.config.ts:33-39).
implementations-plan/M3/5/stage-d-handoff.md:119:1. **Step 5 first** (__VERSION__ swap — smallest, no type surface).
implementations-plan/M3/5/stage-d-handoff.md:136:- **`__VERSION__` in test env**: wallet-bridge tests running under extension's vitest already get `__VERSION__` from extension's `vitest.config.ts:define`. No action needed as long as we don't add a separate wallet-bridge vitest config.
implementations-plan/M3/5/plan.md:101:4. Use `__VERSION__` define (already set in vite config: `define: { __VERSION__: ... }`).
implementations-plan/M3/5/plan.md:103:**Decision: Option 4** — replace `packageJson.version` with `__VERSION__` (a Vite compile-time define). The extension's `vite.config.ts` already sets this. `wallet-bridge/src/rpc/types.ts` uses `declare const __VERSION__: string` and accesses `__VERSION__` directly. Zero path gymnastics.
implementations-plan/M3/5/plan.md:107:declare const __VERSION__: string
implementations-plan/M3/5/plan.md:111:  version: __VERSION__,
implementations-plan/M3/5/plan.md:115:The `viteStaticCopy` and other vite plugins continue to run in the extension's build context; the `__VERSION__` define is injected at that build time. No per-package build step needed.
implementations-plan/M3/5/plan.md:175:    __VERSION__: '"0.0.0-test"',
implementations-plan/M3/5/plan.md:184:## `__VERSION__` substitution in moved files
implementations-plan/M3/5/plan.md:186:Both `rpc/types.ts` AND `dispatcher.ts` import `packageJson.version`. After moving to wallet-bridge, replace all `packageJson.version` usages with `__VERSION__`:
implementations-plan/M3/5/plan.md:188:- `packages/wallet-bridge/src/rpc/types.ts` — replace `packageJson.version` with `__VERSION__`
implementations-plan/M3/5/plan.md:190:- Add `declare const __VERSION__: string` at the top of each file that uses it
implementations-plan/M3/5/plan.md:256:3. Patch `__VERSION__` access in `rpc/types.ts` and `dispatcher.ts`
implementations-plan/M3/5/plan.md:267:| 1 | **`__VERSION__` not available in jest/vitest** without Vite define injection | MED | Add `define: { __VERSION__: '"0.0.0"' }` in wallet-bridge's vitest config if tests use it |
implementations-plan/M3/5/plan.md:277:- 0.5 day: `__VERSION__` + NuloWalletInfo patch
implementations-plan/M4/10-network-rework/plan-v4.md:154:### Storage version bump (PR-1) — TINY
implementations-plan/M4/10-network-rework/plan-v4.md:254:## 5. Storage version bump (no migrator)
implementations-plan/M4/10-network-rework/plan-v4.md:332:- Commit 2: storage version bump (~5 lines in migrate.ts; no test — wipe path is exercised implicitly on every test boot).
implementations-plan/M4/10-network-rework/plan-v4.md:408:### Storage version bump (PR-1)
implementations-plan/M3/audit-diff.md:81:**Fix in M3.5**: Added `dispatcher.ts` to the `__VERSION__` substitution list. All 3 usages in `dispatcher.ts` must be replaced with `__VERSION__`. wallet-bridge's `vitest.config.ts` must include `define: { __VERSION__: '"0.0.0-test"' }`.
implementations-plan/M3/audit-diff.md:158:### C_M1 — All packages: `__VERSION__` not defined in any vitest config
implementations-plan/M3/audit-diff.md:160:**Finding**: The extension's `vitest.config.ts` does not define `__VERSION__`. Any test that imports a file using `__VERSION__` (e.g. `about.vue`, files in wallet-bridge) will fail at test time with `__VERSION__ is not defined`.
implementations-plan/M3/audit-diff.md:165:  __VERSION__: '"0.0.0-test"',
implementations-plan/M3/audit-diff.md:172:Wallet-bridge's `vitest.config.ts` also needs `define: { __VERSION__: '"0.0.0-test"' }` (already planned in B4 fix).
implementations-plan/M3/testing-audit-diff.md:142:**Q4. `__VERSION__` define placement?** Only in packages that reference it at module load (extension + wallet-bridge). Not every package.
packages/extension/src/popup/pages/settings/security/export/full.vue:60:const version = __VERSION__
implementations-plan/M4/7/plan.md:208:1. Empty registry → `migrateAll` no-ops, no version bumps.
implementations-plan/M3/6/plan.md:52:- **No entry-point screen extraction.** `src/components/install.vue` + `update.vue` use `__VERSION__` / `__DISPLAY_NAME__` Vite defines; they stay in extension.
implementations-plan/M3/6/plan.md:102:| `src/components/install.vue` | uses `__DISPLAY_NAME__` / `__VERSION__` Vite defines |
implementations-plan/M3/6/plan.md:103:| `src/components/update.vue` | uses `__VERSION__` Vite define |
packages/extension/vitest.config.ts:47:		__VERSION__: JSON.stringify(packageJson.version),
implementations-plan/M3/1/plan.md:198:Add alias AND define block (fixes `__VERSION__ is not defined` in tests):
implementations-plan/M3/1/plan.md:207:  __VERSION__: '"0.0.0-test"',
implementations-plan/M4/3/plan.md:95:If env-aware enforcement is needed (e.g. dev builds allow `http://localhost`), use the existing `__VERSION__` define pattern in `vite.config.ts` to pass a `__BUILD_ENV__` flag and key the allowlist on it. Keep this OUT of M4.3's first cut unless the codex audit specifically asks.
packages/extension/vite.config.ts:202:		__VERSION__: JSON.stringify(packageJson.version),
packages/extension/src/components/install.vue:3:const version = __VERSION__
packages/extension/src/types/vite-env.d.ts:4:declare const __VERSION__: string

codex
I found one likely user-visible caveat I want to confirm before I write it up: the notes viewer only iterates contracts already registered in PXE. That means “artifact is bundled” and “notes become visible” are not the same thing for Wonderland NFT unless something also registers the instance.
exec
/bin/zsh -lc "rg -n 'getContracts\\(|class GetContracts|public async getContracts|interface .*getContracts' packages/aztec-runtime packages/extension -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/aztec-runtime/src/pxe/service.ts:194:	public async getContracts(network: NetworkInfo): Promise<AztecAddress[]> {
packages/aztec-runtime/src/pxe/service.ts:195:		return this.withPxeRead("getContracts", network, (pxe) => pxe.getContracts())
packages/aztec-runtime/src/pxe/ipxe.ts:31:	getContracts(): Promise<AztecAddress[]>
packages/aztec-runtime/src/pxe/proxy.ts:65:	getContracts(): Promise<AztecAddress[]> {
packages/aztec-runtime/src/pxe/proxy.ts:66:		return this.pxeService.getContracts(this.network)
packages/aztec-runtime/src/pxe/client.ts:103:	public async getContracts(network: NetworkInfo): Promise<AztecAddress[]> {
packages/aztec-runtime/src/pxe/spec.ts:32:	getContracts(network: NetworkInfo): AztecAddress[]
packages/extension/src/wallet/services/account-state/service.ts:124:	public async getContracts(networkId: string): Promise<string[]> {
packages/extension/src/wallet/services/account-state/service.ts:128:			const contracts = await this.pxeService.getContracts(networkInfoFrom(network))
packages/extension/src/wallet/services/account-state/service.ts:153:				const contracts = await this.getContracts(n.id)
packages/extension/src/wallet/services/account-state/client.ts:37:	public getContracts(networkId: string): Promise<string[]> {
packages/extension/src/wallet/services/account-state/spec.ts:64:	getContracts(networkId: string): string[]
packages/extension/src/wallet/services/note/service.ts:129:		const knownContracts = await this.pxeService.getContracts(networkInfoFrom(network))
packages/extension/src/wallet/services/execution/tx-request-builder.ts:112:			const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
packages/extension/src/wallet/services/execution/tx-request-builder.ts:401:			const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
packages/extension/src/wallet/services/token/service.ts:250:		const registeredContracts = await pxe.getContracts()
packages/extension/src/wallet/services/token/service.ts:335:			const registeredContracts = await pxe.getContracts()
packages/extension/src/wallet/services/execution/service.ts:1059:		const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
packages/extension/src/wallet/services/execution/service.ts:1116:		const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
packages/extension/src/wallet/services/fpc/service.ts:201:		const registeredContracts = await pxe.getContracts()
packages/extension/src/popup/pages/settings/advanced/account-state/contracts/index.vue:37:		contracts.value = await accountStateService.getContracts(appStore.network.id)

exec
/bin/zsh -lc "nl -ba packages/aztec-runtime/src/pxe/client.ts | sed -n '56,84p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/aztec-runtime/src/pxe/service.ts | sed -n '150,210p'" in (project root)
 succeeded in 0ms:
    56			return await ContractArtifactSchema.optional().parseAsync(result)
    57		}
    58	
    59		public async getNoteSchemas(): Promise<Record<string, Record<string, NoteSchema>>> {
    60			const result = await this.request("getNoteSchemas")
    61			return (result ?? {}) as Record<string, Record<string, NoteSchema>>
    62		}
    63	
    64		public async registerAccount(network: NetworkInfo, secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
    65			const result = await this.request("registerAccount", network, secretKey, partialAddress)
    66			return await CompleteAddress.schema.parseAsync(result)
    67		}
    68	
    69		public async registerSender(network: NetworkInfo, address: AztecAddress): Promise<AztecAddress> {
    70			const result = await this.request("registerSender", network, address)
    71			return await AztecAddress.schema.parseAsync(result)
    72		}
    73	
    74		public async getSenders(network: NetworkInfo): Promise<AztecAddress[]> {
    75			const result = await this.request("getSenders", network)
    76			return await z.array(AztecAddress.schema).parseAsync(result)
    77		}
    78	
    79		public async removeSender(network: NetworkInfo, address: AztecAddress): Promise<void> {
    80			await this.request("removeSender", network, address)
    81		}
    82	
    83		public async getRegisteredAccounts(network: NetworkInfo): Promise<CompleteAddress[]> {
    84			const result = await this.request("getRegisteredAccounts", network)

 succeeded in 0ms:
   150		}
   151	
   152		public async registerSender(network: NetworkInfo, address: AztecAddress): Promise<AztecAddress> {
   153			return this.withPxeWrite("registerSender", network, async (pxe) =>
   154				pxe.registerSender(await AztecAddress.schema.parseAsync(address)),
   155			)
   156		}
   157	
   158		public async getSenders(network: NetworkInfo): Promise<AztecAddress[]> {
   159			return this.withPxeRead("getSenders", network, (pxe) => pxe.getSenders())
   160		}
   161	
   162		public async removeSender(network: NetworkInfo, address: AztecAddress): Promise<void> {
   163			return this.withPxeWrite("removeSender", network, async (pxe) => pxe.removeSender(await AztecAddress.schema.parseAsync(address)))
   164		}
   165	
   166		public async getRegisteredAccounts(network: NetworkInfo): Promise<CompleteAddress[]> {
   167			return this.withPxeRead("getRegisteredAccounts", network, (pxe) => pxe.getRegisteredAccounts())
   168		}
   169	
   170		public async registerContractClass(network: NetworkInfo, artifact: ContractArtifact): Promise<void> {
   171			return this.withPxeWrite("registerContractClass", network, async (pxe) =>
   172				pxe.registerContractClass(await ContractArtifactSchema.parseAsync(artifact)),
   173			)
   174		}
   175	
   176		public async registerContract(
   177			network: NetworkInfo,
   178			contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact },
   179		): Promise<void> {
   180			return this.withPxeWrite("registerContract", network, async (pxe) =>
   181				pxe.registerContract({
   182					instance: await ContractInstanceWithAddressSchema.parseAsync(contract.instance),
   183					artifact: await ContractArtifactSchema.optional().parseAsync(contract.artifact),
   184				}),
   185			)
   186		}
   187	
   188		public async updateContract(network: NetworkInfo, contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void> {
   189			return this.withPxeWrite("updateContract", network, async (pxe) =>
   190				pxe.updateContract(await AztecAddress.schema.parseAsync(contractAddress), await ContractArtifactSchema.parseAsync(artifact)),
   191			)
   192		}
   193	
   194		public async getContracts(network: NetworkInfo): Promise<AztecAddress[]> {
   195			return this.withPxeRead("getContracts", network, (pxe) => pxe.getContracts())
   196		}
   197	
   198		public async getNotes(network: NetworkInfo, filter: NotesFilter): Promise<NoteDao[]> {
   199			return this.withPxeWrite("getNotes", network, async (pxe) => pxe.debug.getNotes(await NotesFilterSchema.parseAsync(filter)))
   200		}
   201	
   202		public async proveTx(network: NetworkInfo, txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult> {
   203			return this.withPxeWrite("proveTx", network, async (pxe, node) => {
   204				// DEBUG: log PXE sync state before proving
   205				try {
   206					const header = await pxe.getSyncedBlockHeader()
   207					const nodeTip = await node.getBlockNumber()
   208					this.logDebug(`[SYNC-DEBUG] proveTx: PXE anchor block=${header.getBlockNumber()}, node tip=${nodeTip}`)
   209				} catch (e) {
   210					this.logDebug(`[SYNC-DEBUG] proveTx: failed to read sync state: ${e}`)

exec
/bin/zsh -lc "nl -ba packages/aztec-runtime/src/pxe/ipxe.ts | sed -n '1,40p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * `IPXE` — the in-process facade a profile gets for a single network.
     3	 *
     4	 * `PxeServiceClient` in extension is the SW-side RPC transport;
     5	 * `PXEProxy` (also in extension) wraps one PxeServiceClient + a Network
     6	 * pair into an IPXE impl. Moving the interface to aztec-runtime lets
     7	 * aztec-runtime-owned consumers (`IAccountContract`, NuloAccount) type
     8	 * against it without circular-depending on extension.
     9	 */
    10	
    11	import type { Fr } from "@aztec/foundation/curves/bn254"
    12	import type { NotesFilter, PackedPrivateEvent, SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
    13	import type { ContractArtifact, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
    14	import type { AztecAddress } from "@aztec/stdlib/aztec-address"
    15	import type { CompleteAddress, ContractInstanceWithAddress, PartialAddress } from "@aztec/stdlib/contract"
    16	import type { NoteDao } from "@aztec/stdlib/note"
    17	import type { TxExecutionRequest, TxProfileResult, TxProvingResult, TxSimulationResult, UtilityExecutionResult } from "@aztec/stdlib/tx"
    18	import type { PrivateEventFilter } from "@aztec/aztec.js/wallet"
    19	
    20	export interface IPXE {
    21		getContractInstance(address: AztecAddress): Promise<ContractInstanceWithAddress | undefined>
    22		getContractArtifact(id: Fr): Promise<ContractArtifact | undefined>
    23		registerAccount(secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress>
    24		registerSender(address: AztecAddress): Promise<AztecAddress>
    25		getSenders(): Promise<AztecAddress[]>
    26		removeSender(address: AztecAddress): Promise<void>
    27		getRegisteredAccounts(): Promise<CompleteAddress[]>
    28		registerContractClass(artifact: ContractArtifact): Promise<void>
    29		registerContract(contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }): Promise<void>
    30		updateContract(contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void>
    31		getContracts(): Promise<AztecAddress[]>
    32		getNotes(filter: NotesFilter): Promise<NoteDao[]>
    33		proveTx(txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult>
    34		profileTx(txRequest: TxExecutionRequest, opts: ProfileTxOpts): Promise<TxProfileResult>
    35		simulateTx(txRequest: TxExecutionRequest, opts: SimulateTxOpts, stubAccountAddresses?: string[]): Promise<TxSimulationResult>
    36		executeUtility(call: FunctionCall, opts: ExecuteUtilityOpts): Promise<UtilityExecutionResult>
    37		getPrivateEvents<_T>(eventSelector: EventSelector, filter: PrivateEventFilter): Promise<PackedPrivateEvent[]>
    38	}

exec
/bin/zsh -lc "rg -n 'hasKnownClassId\\(' packages -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/aztec-runtime/src/pxe/artifact-registry.ts:122:	public async hasKnownClassId(classId: Fr): Promise<boolean> {
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:177:		expect(await reg.hasKnownClassId(classId)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:188:		expect(await reg.hasKnownClassId(unknown)).toBe(false)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:189:		expect(await reg.hasKnownClassId(known)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:194:		expect(await reg.hasKnownClassId(new Fr(99))).toBe(false)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:206:		expect(await reg.hasKnownClassId(classId)).toBe(true)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:209:		expect(await reg.hasKnownClassId(classId)).toBe(true)

exec
/bin/zsh -lc "nl -ba packages/extension/manifest/manifest.chrome.config.ts | sed -n '1,80p'" in (project root)
 succeeded in 0ms:
     1	import { defineManifest } from "@crxjs/vite-plugin"
     2	
     3	import ManifestConfig from "./manifest.config"
     4	
     5	// @ts-expect-error ManifestConfig provides all required fields
     6	export default defineManifest((_env) => ({
     7		...ManifestConfig,
     8	}))

exec
/bin/zsh -lc "rg -n 'packageJson.version|version:' packages/extension/manifest -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/extension/manifest/manifest.config.ts:11:	version: `${major}.${minor}.${patch}.${label}`,
packages/extension/manifest/manifest.config.ts:13:	manifest_version: 3,

exec
/bin/zsh -lc "nl -ba packages/extension/manifest/manifest.firefox.config.ts | sed -n '1,80p'" in (project root)
 succeeded in 0ms:
     1	import { defineManifest } from "@crxjs/vite-plugin"
     2	import ManifestConfig from "./manifest.config"
     3	
     4	// @ts-expect-error ManifestConfig provides all required fields
     5	export default defineManifest((_env) => ({
     6		...ManifestConfig,
     7		browser_specific_settings: {
     8			gecko: {
     9				id: "{}",
    10			},
    11		},
    12		background: {
    13			scripts: ["src/wallet/index.ts"],
    14			type: "module",
    15			persistent: false,
    16		},
    17		// @ts-expect-error
    18		permissions: ManifestConfig.permissions.filter((permission) => permission !== "background"),
    19	}))

exec
/bin/zsh -lc "nl -ba packages/extension/manifest/manifest.config.ts | sed -n '1,40p'" in (project root)
 succeeded in 0ms:
     1	import type { ManifestV3Export } from "@crxjs/vite-plugin"
     2	import packageJson from "../package.json"
     3	
     4	const { version, name, description, displayName } = packageJson
     5	
     6	const [major, minor, patch, label = "0"] = version.replace(/[^\d.-]+/g, "").split(/[.-]/)
     7	
     8	export default {
     9		name: displayName || name,
    10		description,
    11		version: `${major}.${minor}.${patch}.${label}`,
    12		version_name: version,
    13		manifest_version: 3,
    14		host_permissions: ["https://nulo.sh/"],
    15		action: {
    16			default_popup: "src/popup/index.html#/popup/general",
    17		},
    18		background: {
    19			service_worker: "src/wallet/index.ts",
    20			type: "module",
    21		},
    22		side_panel: {
    23			default_path: "src/popup/index.html",
    24		},
    25		content_scripts: [
    26			{
    27				all_frames: true,
    28				js: ["src/content-script/content.ts"],
    29				matches: ["*://*/*"],
    30				run_at: "document_start",
    31			},
    32		],
    33		permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage"],
    34		optional_permissions: ["downloads"],
    35		content_security_policy: {
    36			extension_pages: "script-src 'self' 'wasm-unsafe-eval'",
    37		},
    38		cross_origin_embedder_policy: {
    39			value: "require-corp",
    40		},

exec
/bin/zsh -lc "rg -n 'executeAztecRegisterContract|aztec_registerContract|registerContract\\(' packages/extension/src/wallet/services/execution -g '*test.ts'" in (project root)
 exited 1 in 0ms:
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/index.ts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * MV3 service-worker shell. All this file does is:
     3	 *   1. Install the shell-level side effects that can't live behind a port
     4	 *      (self.onunhandledrejection, console hijack — both target `self`).
     5	 *   2. Instantiate real-world adapters (RealChromeBrowserApi, SystemClock)
     6	 *      and shared stores (ConfigStore, LoggerStore).
     7	 *   3. Hand them to `createWalletRuntime()` and call `start()`.
     8	 *
     9	 * Everything else — service graph construction, storage migration, BB init,
    10	 * heartbeat, wallet-sdk handler — is inside runtime.ts and consumes the
    11	 * ports passed through `deps`.
    12	 */
    13	
    14	import "@/utils/console-sniffer"
    15	import { RealChromeBrowserApi, SystemClock } from "@/core/adapters"
    16	import { ConfigStore } from "./config"
    17	import { consoleMethods, LoggerStore, LogLevel } from "./logger"
    18	import { createWalletRuntime } from "./runtime"
    19	import { getErrorData } from "@nulo/wallet-core/utils"
    20	
    21	const config = new ConfigStore()
    22	const logger = new LoggerStore(config)
    23	const browserApi = new RealChromeBrowserApi()
    24	const clock = new SystemClock()
    25	
    26	// Console hijack — forward every console.{log,warn,error,...} through the
    27	// LoggerStore so everything ends up in a single log pipe.
    28	for (const [method, level] of consoleMethods) {
    29		// biome-ignore lint/suspicious/noExplicitAny: dynamic console hijack on ServiceWorkerGlobalScope
    30		;(self as any)[`on${method}`] = (...args: unknown[]) => {
    31			logger.log("wallet", level, ...args)
    32		}
    33	}
    34	
    35	// Unhandled rejections. Routed through the logger so we can see them across
    36	// SW restarts via log rehydration.
    37	self.onunhandledrejection = (e: PromiseRejectionEvent) => {
    38		logger.log("wallet", LogLevel.Error, getErrorData(e.reason))
    39	}
    40	
    41	logger.log("wallet", LogLevel.Info, "Runtime configured")
    42	
    43	const runtime = createWalletRuntime({ browserApi, clock, config, logger })
    44	
    45	// Rehydrate logs from the previous SW lifecycle, then start. A failed
    46	// rehydrate (session storage unavailable) is non-fatal — we start anyway.
    47	logger
    48		.rehydrate()
    49		.catch(() => {})
    50		.then(() => {
    51			logger.log("wallet", LogLevel.Info, "Service worker started")
    52			runtime.start().catch((error) => {
    53				logger.log("wallet", LogLevel.Error, "Runtime start failed", getErrorData(error))
    54			})
    55		})

exec
/bin/zsh -lc "nl -ba packages/extension/src/popup/index.ts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	import { consoleMethods, LogLevel } from "@/wallet/logger"
     2	import { LoggerServiceClient } from "@/wallet/services/logger/client"
     3	import { getErrorData } from "@nulo/wallet-core/utils"
     4	
     5	// catch console
     6	const logger = new LoggerServiceClient("popup")
     7	for (const [method, level] of consoleMethods) {
     8		// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
     9		;(self as any)[`on${method}`] = (...args: any[]) => {
    10			logger.log("ui", level, ...args)
    11		}
    12	}
    13	
    14	// catch unhandled errors
    15	self.onunhandledrejection = (e: PromiseRejectionEvent) => {
    16		logger.log("ui", LogLevel.Error, getErrorData(e.reason))
    17	}
    18	
    19	import { createPinia } from "pinia"
    20	import { createApp } from "vue"
    21	import { createRouter, createWebHashHistory, type RouteLocationNormalized, type NavigationGuardNext } from "vue-router"
    22	import App from "./app.vue"
    23	import routes from "~pages"
    24	import "@/assets/styles/_base.scss"
    25	import "./index.scss"
    26	
    27	/** Configure BigNumber format */
    28	import BigNumber from "bignumber.js"
    29	import { getDecimalSeparator, getThousandSeparator } from "@/utils/amount.js"
    30	
    31	BigNumber.config({
    32		DECIMAL_PLACES: 100,
    33		FORMAT: {
    34			decimalSeparator: getDecimalSeparator(),
    35			groupSeparator: getThousandSeparator(),
    36			groupSize: 3,
    37		},
    38	})
    39	
    40	import { initAppServiceContext, managers } from "@/utils/core"
    41	import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
    42	
    43	// Eagerly open profile + contact service-worker ports at boot. Matches the
    44	// timing of the previous module-eval init in core.js so no consumer sees a
    45	// "ports not ready" race. Under the new shape, importers that never call
    46	// this (tests, tooling) get silent ports — they connect only on first
    47	// `managers.*` access, if at all.
    48	initAppServiceContext()
    49	
    50	/** Store */
    51	import { useAppStore } from "@/stores/app.store"
    52	
    53	routes.push({
    54		path: "/",
    55		redirect: "/popup",
    56	})
    57	
    58	const router = createRouter({
    59		history: createWebHashHistory(import.meta.env.BASE_URL),
    60		routes,
    61	})
    62	
    63	router.beforeEach(async (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
    64		const appStore = useAppStore()
    65	
    66		if (to.meta.isPasskeyInteraction) {
    67			next()
    68			return
    69		}
    70	
    71		if (to.name === "popup-register" && appStore.isRegistered) {
    72			next({ name: from.name || "popup-general" })
    73			return
    74		}
    75	
    76		if (to.name === "popup-auth" && appStore.isLogined) {
    77			next({ name: from.name || "popup-general" })
    78			return
    79		}
    80	
    81		if (to.meta.isAuthRequired && !appStore.isLogined && appStore.isSessionChecked) {
    82			next({ name: "popup-auth" })
    83			return
    84		}
    85	
    86		if (to.meta.isAuthRequired && !appStore.isLogined && !appStore.isSessionChecked) {
    87			next({ name: "popup-auth" })
    88			return
    89		}
    90	
    91		if (!appStore.profile && to.name !== "popup-register" && to.name !== "popup-import" && to.name !== "popup-profile-new") {
    92			const profiles = await managers.profile.getProfiles()
    93			if (profiles.length) {
    94				const lastActiveId = await getLastActiveProfileId()
    95				const lastActive = lastActiveId ? profiles.find((p) => p.id === lastActiveId) : undefined
    96				appStore.profile = lastActive ?? profiles[0]
    97			} else {
    98				next({ name: "popup-register" })
    99				return
   100			}
   101		}
   102	
   103		if (to.meta.requirePasswordProfile && appStore.profile?.type === "passkey") {
   104			next({ path: "/popup/settings/profile" })
   105			return
   106		}
   107	
   108		next()
   109	})
   110	
   111	createApp(App).use(router).use(createPinia()).mount("#app")

exec
/bin/zsh -lc "rg -n 'setSentinel\\(|checkSentinel\\(' packages/extension/src -g '"'!**/node_modules/**'"'" in (project root)
 succeeded in 0ms:
packages/extension/src/utils/core.ts:143:export async function setSentinel(): Promise<void> {
packages/extension/src/utils/core.ts:147:export async function checkSentinel(): Promise<boolean> {
packages/extension/src/popup/pages/import.vue:125:	await setSentinel()
packages/extension/src/popup/pages/profile/new.vue:116:	await setSentinel()
packages/extension/src/composables/notification.js:60:	const isSentinelValid = await checkSentinel()

exec
/bin/zsh -lc "nl -ba packages/extension/src/composables/notification.js | sed -n '50,80p'" in (project root)
 succeeded in 0ms:
    50						confirmText: "Delete Profile",
    51						cancelText: "Later",
    52					},
    53				}
    54			default:
    55				break
    56		}
    57	}
    58	
    59	export async function checkNotificationsForShow(router) {
    60		const isSentinelValid = await checkSentinel()
    61		if (!isSentinelValid) {
    62			const template = getTemplate("aztecReset", { router })
    63			notificationStore.create({ ...template })
    64		}
    65	}

exec
/bin/zsh -lc "nl -ba packages/aztec-runtime/src/pxe/proxy.ts | sed -n '20,36p'" in (project root)
 succeeded in 0ms:
    20		public constructor(
    21			private readonly pxeService: PxeServiceClientBase,
    22			private readonly network: NetworkInfo,
    23		) {}
    24	
    25		getContractInstance(address: AztecAddress): Promise<ContractInstanceWithAddress | undefined> {
    26			return this.pxeService.getContractInstance(this.network, address)
    27		}
    28	
    29		getContractArtifact(id: Fr): Promise<ContractArtifact | undefined> {
    30			return this.pxeService.getContractArtifact(this.network, id)
    31		}
    32	
    33		registerAccount(secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
    34			return this.pxeService.registerAccount(this.network, secretKey, partialAddress)
    35		}
    36	

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/execution/service.ts | sed -n '888,915p'" in (project root)
 succeeded in 0ms:
   888				return
   889			}
   890	
   891			const network = await this.networkService.getNetwork(op.networkId)
   892	
   893			const providedInstance = await ContractInstanceWithAddressSchema.optional().parseAsync(op.instance)
   894			const instance =
   895				providedInstance ?? (await this.pxeService.getContractInstance(networkInfoFrom(network), AztecAddress.fromString(op.address)))
   896			if (!instance) {
   897				throw new Error("Contract instance not found")
   898			}
   899	
   900			const providedArtifact = await ContractArtifactSchema.optional().parseAsync(op.artifact)
   901			const artifact =
   902				providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), instance.currentContractClassId))
   903			if (!artifact) {
   904				throw new Error("Contract artifact not found")
   905			}
   906	
   907			const contractClass = await getContractClassFromArtifact(artifact)
   908			if (contractClass.id.toString() !== instance.currentContractClassId.toString()) {
   909				throw new Error("Contract artifact doesn't match instance's current class id")
   910			}
   911	
   912			const contractAddress = await computeContractAddressFromInstance(instance)
   913			if (contractAddress.toString() !== op.address) {
   914				throw new Error("Contract address doesn't match instance address")
   915			}

codex
**BLOCKING**
- The plan’s main QA assertion is checking the wrong behavior. The proposed bundle change affects class-id based artifact fallback in `aztec_registerContract` ([service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1517)), not address-based instance lookup. `getContractInstance` still only falls back to PXE, node, and the explicit known-instance map ([service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:118), [service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:122)), and that map still only hard-codes SponsoredFPC ([known-artifacts.ts]((project root)/packages/aztec-runtime/src/pxe/known-artifacts.ts:63)). So the acceptance text in [plan-v1.md]((project root)/implementations-plan/bundle-fpc-nft/plan-v1.md:119) is not verifying the actual feature.
- The Wonderland NFT notes QA is overstated. The notes page only walks contracts already registered in PXE ([service.ts]((project root)/packages/extension/src/wallet/services/note/service.ts:129), [service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:194)). PrivateFPC gets auto-registered through `FpcService` ([service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:117)), but Wonderland NFT has no equivalent discovery path. Bundling the artifact/schema improves decoding after registration; it does not make Wonderland NFT notes appear by itself.

**SHOULD-FIX**
- I did not find a caller that would break, but the plan should document that this behavior shift is narrow: `aztec_registerContract` benefits from full artifact fallback ([service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1517)), while `aztec_getContractClassMetadata` and `aztec_getContractMetadata` still use `pxeOnly` and will keep reporting “not registered” unless the artifact is actually in local PXE ([service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1419), [service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1438)).
- The proposed tests do not cover the actual behavior change. The slot tests only guard storage drift ([note-schemas.test.ts]((project root)/packages/extension/src/wallet/services/note/note-schemas.test.ts:50)), and the existing `registerContract` e2e accepts either success or error ([contracts-register.test.ts]((project root)/packages/extension/tests/e2e/network/contracts-register.test.ts:59)). Add one focused test for “bundled class, no artifact supplied, register succeeds”.
- The bundle-size/risk note overstates PrivateFPC impact. `@private-fpc-artifact` is already imported today by `FpcService` ([service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:19), [service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:22)), so only Wonderland NFT is definitely new bundle surface. The claim in [plan-v1.md]((project root)/implementations-plan/bundle-fpc-nft/plan-v1.md:136) should be tightened.

**NICE-TO-HAVE**
- The slot and shape claims are correct. PrivateFPC stores `balances` at `0x1` ([private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:8444)); `balance_of` returns `u128` ([private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:8497)); and the storage path is `BalanceSet -> PrivateSet<UintNote>` ([private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:377), [private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:381)). Wonderland NFT stores `private_nfts` at `0x5` ([nft_contract-NFT.json]((project root)/packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json:17514)), and that field is `Owned<PrivateSet<NFTNote>>` while `nft_exists` and `public_owners` are public ([nft_contract-NFT.json]((project root)/packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json:501), [nft_contract-NFT.json]((project root)/packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json:505)).
- The `loadContractArtifact()` duplication itself is not a real correctness problem. The function is pure and either returns the input or generates a derived artifact ([contract_artifact.ts]((project root)/node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:52)). The real duplicated cost is separate class-id hashing in the two loaders ([known-artifacts.ts]((project root)/packages/aztec-runtime/src/pxe/known-artifacts.ts:60), [note-schemas.ts]((project root)/packages/aztec-runtime/src/pxe/note-schemas.ts:63)), which is small and already the current pattern.
- I don’t see any extra version-bump target beyond `packages/extension/package.json` ([package.json]((project root)/packages/extension/package.json:6)); the manifest version is derived from it ([manifest.config.ts]((project root)/packages/extension/manifest/manifest.config.ts:11)). No extra Chrome/Firefox config step is needed because both build configs spread the base Vite config ([vite.chrome.config.mts]((project root)/packages/extension/vite.chrome.config.mts:5), [vite.firefox.config.mts]((project root)/packages/extension/vite.firefox.config.mts:5)).

**NITS**
- `@private-fpc-artifact` is not “aliased but unused”; it is already a live import in `FpcService` ([service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:19)).
- The proposed Wonderland NFT alias path is fine. This package exposes the JSON in `target/`, `artifacts/target/`, and `dist/target/`, so `target/nft_contract-NFT.json` is not a packaging mismatch.
tokens used
213,349
**BLOCKING**
- The plan’s main QA assertion is checking the wrong behavior. The proposed bundle change affects class-id based artifact fallback in `aztec_registerContract` ([service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1517)), not address-based instance lookup. `getContractInstance` still only falls back to PXE, node, and the explicit known-instance map ([service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:118), [service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:122)), and that map still only hard-codes SponsoredFPC ([known-artifacts.ts]((project root)/packages/aztec-runtime/src/pxe/known-artifacts.ts:63)). So the acceptance text in [plan-v1.md]((project root)/implementations-plan/bundle-fpc-nft/plan-v1.md:119) is not verifying the actual feature.
- The Wonderland NFT notes QA is overstated. The notes page only walks contracts already registered in PXE ([service.ts]((project root)/packages/extension/src/wallet/services/note/service.ts:129), [service.ts]((project root)/packages/aztec-runtime/src/pxe/service.ts:194)). PrivateFPC gets auto-registered through `FpcService` ([service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:117)), but Wonderland NFT has no equivalent discovery path. Bundling the artifact/schema improves decoding after registration; it does not make Wonderland NFT notes appear by itself.

**SHOULD-FIX**
- I did not find a caller that would break, but the plan should document that this behavior shift is narrow: `aztec_registerContract` benefits from full artifact fallback ([service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1517)), while `aztec_getContractClassMetadata` and `aztec_getContractMetadata` still use `pxeOnly` and will keep reporting “not registered” unless the artifact is actually in local PXE ([service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1419), [service.ts]((project root)/packages/extension/src/wallet/services/execution/service.ts:1438)).
- The proposed tests do not cover the actual behavior change. The slot tests only guard storage drift ([note-schemas.test.ts]((project root)/packages/extension/src/wallet/services/note/note-schemas.test.ts:50)), and the existing `registerContract` e2e accepts either success or error ([contracts-register.test.ts]((project root)/packages/extension/tests/e2e/network/contracts-register.test.ts:59)). Add one focused test for “bundled class, no artifact supplied, register succeeds”.
- The bundle-size/risk note overstates PrivateFPC impact. `@private-fpc-artifact` is already imported today by `FpcService` ([service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:19), [service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:22)), so only Wonderland NFT is definitely new bundle surface. The claim in [plan-v1.md]((project root)/implementations-plan/bundle-fpc-nft/plan-v1.md:136) should be tightened.

**NICE-TO-HAVE**
- The slot and shape claims are correct. PrivateFPC stores `balances` at `0x1` ([private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:8444)); `balance_of` returns `u128` ([private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:8497)); and the storage path is `BalanceSet -> PrivateSet<UintNote>` ([private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:377), [private_contract-PrivateFPC.json]((project root)/packages/extension/node_modules/@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json:381)). Wonderland NFT stores `private_nfts` at `0x5` ([nft_contract-NFT.json]((project root)/packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json:17514)), and that field is `Owned<PrivateSet<NFTNote>>` while `nft_exists` and `public_owners` are public ([nft_contract-NFT.json]((project root)/packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json:501), [nft_contract-NFT.json]((project root)/packages/extension/node_modules/@defi-wonderland/aztec-standards/target/nft_contract-NFT.json:505)).
- The `loadContractArtifact()` duplication itself is not a real correctness problem. The function is pure and either returns the input or generates a derived artifact ([contract_artifact.ts]((project root)/node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules/@aztec/stdlib/src/abi/contract_artifact.ts:52)). The real duplicated cost is separate class-id hashing in the two loaders ([known-artifacts.ts]((project root)/packages/aztec-runtime/src/pxe/known-artifacts.ts:60), [note-schemas.ts]((project root)/packages/aztec-runtime/src/pxe/note-schemas.ts:63)), which is small and already the current pattern.
- I don’t see any extra version-bump target beyond `packages/extension/package.json` ([package.json]((project root)/packages/extension/package.json:6)); the manifest version is derived from it ([manifest.config.ts]((project root)/packages/extension/manifest/manifest.config.ts:11)). No extra Chrome/Firefox config step is needed because both build configs spread the base Vite config ([vite.chrome.config.mts]((project root)/packages/extension/vite.chrome.config.mts:5), [vite.firefox.config.mts]((project root)/packages/extension/vite.firefox.config.mts:5)).

**NITS**
- `@private-fpc-artifact` is not “aliased but unused”; it is already a live import in `FpcService` ([service.ts]((project root)/packages/extension/src/wallet/services/fpc/service.ts:19)).
- The proposed Wonderland NFT alias path is fine. This package exposes the JSON in `target/`, `artifacts/target/`, and `dist/target/`, so `target/nft_contract-NFT.json` is not a packaging mismatch.
```
