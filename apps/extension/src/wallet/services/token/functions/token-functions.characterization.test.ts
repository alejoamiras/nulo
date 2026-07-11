/**
 * Q-12 behavior pin (post-migration). Snapshots the output of the `TokenFnDescriptor`
 * registry that replaced the 9 copy-paste token-function modules. The `.snap` was captured
 * from the ORIGINAL modules (P13.1); this test now drives it through the REGISTRY API — the
 * snapshots staying byte-identical is the proof the registry reproduces the old matchers
 * exactly (the equivalence test that compared registry-vs-old is retired now the old modules
 * are gone; this remains the ongoing pin).
 *
 * What is pinned per kind: `getTokenFnCandidates` (name / impl / type / isStatic + the full
 * `abi()`), in matcher order, and `getDefaultTokenFn`. A wrong ABI or a mis-scored candidate =
 * the wallet calls the WRONG token function (mis-read balance / mis-routed transfer).
 *
 * Fixture: the real `@aztec/noir-contracts.js/Token` artifact (imported live — ~11 MB, too
 * large to freeze; Aztec is exact-pinned + manually bumped). The real artifact exposes ONE
 * candidate per kind, so the multi-candidate scoring / tie paths are pinned separately below
 * against synthetic artifacts (cloned real ABIs, varied names).
 */
import type { ContractArtifact, FunctionAbi } from "@aztec/stdlib/abi"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { describe, expect, test } from "vitest"
import type { Fn } from "@/wallet/utils/fn"
import { TOKEN_FN_DESCRIPTORS } from "./descriptors"
import { getDefaultTokenFn, getTokenFnCandidates } from "./runtime"
import type { TokenFnDescriptor, TokenFnKind } from "./types"

const KINDS: readonly TokenFnKind[] = [
	"getName",
	"getSymbol",
	"getDecimals",
	"balanceOfPrivate",
	"balanceOfPublic",
	"transferPrivate",
	"transferPublic",
	"transferPrivateToPublic",
	"transferPublicToPrivate",
]

// `abi()` is protected on Fn; the matchers derive selection + arg-encoding from it, so it is
// exactly what must not drift.
const abiOf = (fn: Fn): FunctionAbi => (fn as unknown as { abi(): FunctionAbi }).abi()

const shapeOf = (fn: Fn) => ({
	name: fn.name,
	impl: fn.getImpl().impl,
	type: fn.type,
	isStatic: fn.isStatic,
	abi: abiOf(fn),
})

const artifact = TokenContractArtifact as ContractArtifact
const descriptorFor = (kind: TokenFnKind): TokenFnDescriptor => TOKEN_FN_DESCRIPTORS[kind]

describe("token-functions characterization — real Token artifact", () => {
	for (const kind of KINDS) {
		test(`${kind}: candidates (name/impl/type/isStatic/abi) in matcher order`, () => {
			const candidates = getTokenFnCandidates(descriptorFor(kind), artifact)
			expect(candidates.map(shapeOf)).toMatchSnapshot()
		})

		test(`${kind}: default selection`, () => {
			const candidates = getTokenFnCandidates(descriptorFor(kind), artifact)
			expect(getDefaultTokenFn(descriptorFor(kind), candidates)?.name ?? null).toMatchSnapshot()
		})
	}
})

// The real Token artifact has ONE candidate per kind, so the scoring sort / tie / duplicate
// paths never fire against it. Pin them by cloning a real (predicate-passing) ABI and only
// varying the NAME — the predicate filters by shape, the score by name.
describe("token-functions characterization — synthetic multi-candidate scoring", () => {
	const realBalancePublicAbi = abiOf(getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.balanceOfPublic, artifact)[0])
	const realTransferPublicAbi = abiOf(getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPublic, artifact)[0])
	const rename = (abi: FunctionAbi, name: string): FunctionAbi => ({ ...abi, name })
	const publicArtifact = (fns: FunctionAbi[]): ContractArtifact =>
		({ nonDispatchPublicFunctions: fns, functions: fns }) as unknown as ContractArtifact

	test("balanceOfPublic: exact canonical wins, keyword partials ordered, unrelated-but-valid kept last", () => {
		const art = publicArtifact([
			rename(realBalancePublicAbi, "zzz_unrelated"),
			rename(realBalancePublicAbi, "public_balance"),
			rename(realBalancePublicAbi, "balance_of_public"),
			rename(realBalancePublicAbi, "my_balance"),
		])
		const ordered = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.balanceOfPublic, art).map((c) => c.name)
		expect(ordered).toMatchSnapshot()
	})

	test("transferPublic: candidate ordering across name variants", () => {
		const art = publicArtifact([
			rename(realTransferPublicAbi, "zzz_unrelated"),
			rename(realTransferPublicAbi, "transfer_public"),
			rename(realTransferPublicAbi, "transfer_in_public"),
			rename(realTransferPublicAbi, "transfer_public_to_public"),
		])
		const ordered = getTokenFnCandidates(TOKEN_FN_DESCRIPTORS.transferPublic, art).map((c) => c.name)
		expect(ordered).toMatchSnapshot()
	})
})
