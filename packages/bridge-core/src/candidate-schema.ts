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
						maxWholePerTx: z.number().positive(),
					})
					.strict(),
				fuel: z
					.object({
						router: evmAddress,
						swapTarget: evmAddress,
						poolManager: evmAddress,
						quoter: evmAddress,
						permit2: evmAddress,
						weth: evmAddress,
						feeJuice: evmAddress,
						feeJuicePortal: evmAddress,
						pools: z.record(z.string(), poolSchema),
						slippageBps: z.number().int().min(0).max(10_000),
						minFuelFj: decimalString,
					})
					.strict()
					.optional(),
				feeJuice: z
					.object({
						portal: evmAddress,
						asset: evmAddress,
						feeAssetHandler: evmAddress,
						minFj: decimalString,
					})
					.strict()
					.optional(),
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
