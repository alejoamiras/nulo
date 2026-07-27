/**
 * STRICT schema for the bridge deployment manifest (`testnet-bridge.json` and its `.candidate.json`
 * precursor). Every consumer parses through this instead of casting: a stale carried field, a
 * missing block, an absurd numeric, or an unknown key fails LOUDLY at write/read time — never
 * ships silently. (The rc.2 arc shipped a stale carried `feeJuicePortal` exactly because the
 * candidate's `fuel` block was untyped and the reader casted.)
 */
import z from "zod"

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte 0x hex address")
const aztecAddress = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte 0x hex address")
/** Wei/base-unit amounts travel as decimal strings (BigInt-safe). */
const decimalString = z.string().regex(/^\d+$/, "expected a base-10 integer string")

const poolSchema = z
	.object({
		fee: z.number().int().min(0).max(1_000_000),
		tickSpacing: z.number().int().min(1),
	})
	.strict()

const l2RecordSchema = z
	.object({
		address: aztecAddress,
		salt: z.number().int().nonnegative(),
		constructorArtifact: z.string().min(1),
		constructorArgs: z.array(z.unknown()),
	})
	.strict()

export const candidateManifestSchema = z
	.object({
		network: z.string().min(1),
		// The chain this manifest is FOR. The startup assertion checks these agree with BOTH the build
		// target and the live node (fail-closed). Optional for back-compat; the runtime assertion treats
		// their absence as a hard error.
		l1ChainId: z.number().int().positive().optional(),
		walletChainId: z.number().int().positive().optional(),
		l1: z
			.object({
				usdc: evmAddress,
				portal: evmAddress,
				portalSource: z.literal("forked-v1"),
				token: z
					.object({
						name: z.string().min(1),
						symbol: z.string().min(1),
						decimals: z.number().int().min(0).max(36),
						// Token provenance discriminant. `permissionless-mint` = our own mintable test ERC20
						// (has mint(), starts at ZERO Permit2 allowance so the approve path is exercised).
						// `circle-proxy` = the official Circle USDC proxy (no mint, real allowance). Verification
						// keys the contract-logic path off this — a mainnet manifest need not carry test fields.
						source: z.enum(["permissionless-mint", "circle-proxy"]).optional(),
						// WHICH of our mintable contracts a permissionless-mint token is (verify-l1 source-verifies
						// against it): the legacy auto-Permit2 MintableERC20 (default) or the DP7 TestUsdc (no
						// auto-allowance). Irrelevant for circle-proxy (never source-verified).
						sourceContract: z.enum(["MintableERC20", "TestUsdc"]).optional(),
						// Per-tx display cap — a test-token affordance. A `circle-proxy` (mainnet) token has no
						// such cap and omits it; required for any other source (see refine).
						maxWholePerTx: z.number().positive().optional(),
					})
					.strict()
					.refine((t) => t.source === "circle-proxy" || t.maxWholePerTx !== undefined, {
						message: "token.maxWholePerTx is required unless token.source is circle-proxy",
					}),
				// Split so a bridge-only (mainnet) deployment validates WITHOUT the swap stack. `core` (the
				// router + its constructor deps — permit2, swapTarget, feeJuicePortal) is what `bridge()` and
				// the Permit2 witness need, required whenever `fuel` is present. `swap` (the Uniswap→FeeJuice
				// quoting stack) is swap-fuel-only and optional — a mainnet manifest carries `core`, omits
				// `swap` (swap-fuel disabled there, DP2).
				fuel: z
					.object({
						core: z
							.object({
								router: evmAddress,
								permit2: evmAddress,
								swapTarget: evmAddress,
								feeJuicePortal: evmAddress,
							})
							.strict(),
						swap: z
							.object({
								poolManager: evmAddress,
								quoter: evmAddress,
								weth: evmAddress,
								feeJuice: evmAddress,
								pools: z.record(z.string(), poolSchema),
								slippageBps: z.number().int().min(0).max(10_000),
								minFuelFj: decimalString,
							})
							.strict()
							.optional(),
					})
					.strict()
					.optional(),
				feeJuice: z
					.object({
						portal: evmAddress,
						asset: evmAddress,
						// Optional: mainnet has no permissionless FeeAssetHandler (BYO-$AZTEC); testnet mints via one.
						feeAssetHandler: evmAddress.optional(),
						minFj: decimalString,
					})
					.strict()
					.optional(),
				// The pinned PrivateFPC identity for private fee-juice on this network. Its `address` MUST equal
				// the deterministic artifact/salt derivation the extension + planPrivateFuelDeposit compute
				// (verified at deploy — Phase 5/7); schema-valid alone is insufficient. Absent ⇒ private fuel
				// resolves to the compiled-in PRIVATE_FPC_ADDRESS default.
				privateFpc: z
					.object({
						address: aztecAddress,
						version: z.string().min(1).optional(),
						artifactDigest: z.string().min(1).optional(),
					})
					.strict()
					.optional(),
				// L9 interlock: the recipient-committed cutover writes this into the candidate so the deposit
				// code will build private deposits; absent on bearer manifests. (deploy-bridge-testnet.ts)
				privateClaimMode: z.literal("salt-v2").optional(),
			})
			.strict(),
		l2: z
			.object({
				proxy: l2RecordSchema,
				token: l2RecordSchema,
				bridge: l2RecordSchema,
			})
			.strict(),
	})
	.strict()
	// Cross-field SEMANTIC invariants (codex bug-bash r1): syntactic strictness alone still admits a
	// coherent-looking but unusable manifest. Each failure names its path.
	.superRefine((m, ctx) => {
		// A permissionless-mint token must name WHICH of our contracts it is — verify-l1 source-verifies
		// against it, and the smokes select the mint ABI by it.
		if (m.l1.token.source === "permissionless-mint" && !m.l1.token.sourceContract) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["l1", "token", "sourceContract"],
				message: "required when token.source is permissionless-mint (verify-l1 needs the contract name)",
			})
		}
		// The L1 token identity and the L2 token's constructor identity must agree — a drift mints an
		// L2 asset with the wrong name/symbol/decimals (decimals mis-scales every bridged amount).
		const args = m.l2.token.constructorArgs
		if (args.length < 3) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["l2", "token", "constructorArgs"],
				message:
					"L2 token constructorArgs must carry [name, symbol, decimals, ...] — an empty/short list bypasses the identity invariant",
			})
		} else if (args[0] !== m.l1.token.name || args[1] !== m.l1.token.symbol || args[2] !== m.l1.token.decimals) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["l2", "token", "constructorArgs"],
				message: `L2 token constructor identity [${String(args[0])}, ${String(args[1])}, ${String(args[2])}] != l1.token [${m.l1.token.name}, ${m.l1.token.symbol}, ${m.l1.token.decimals}]`,
			})
		}
		// 10_000 bps would be a ZERO min-output floor — the swap could be sandwiched to dust.
		if (m.l1.fuel?.swap && m.l1.fuel.swap.slippageBps >= 10_000) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["l1", "fuel", "swap", "slippageBps"],
				message: "slippageBps must be < 10000 (10000 = a zero min-output floor)",
			})
		}
	})

export type ValidatedCandidateManifest = z.infer<typeof candidateManifestSchema>

/** Parse-or-throw with a path-annotated error message (for scripts and readers alike). */
export function parseCandidateManifest(raw: unknown): ValidatedCandidateManifest {
	const result = candidateManifestSchema.safeParse(raw)
	if (!result.success) {
		const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
		throw new Error(`bridge manifest failed strict validation — ${issues}`)
	}
	return result.data
}
