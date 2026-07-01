/**
 * Q-12 behavior pin. Snapshots the CURRENT output of the 9 copy-paste token-function
 * matchers BEFORE they are collapsed into a `TokenFnDescriptor` registry, so the
 * registry (introduced in a later phase) can be proven byte-identical.
 *
 * What is pinned per kind: the `getCandidates(artifact)` result (name / impl / type /
 * isStatic + the full `abi()`), in the matcher's own order, and the `getDefault`
 * selection. A wrong ABI or a mis-scored candidate = the wallet calls the WRONG token
 * function (mis-read balance / mis-routed transfer), so these snapshots are the
 * security-relevant gate for the whole refactor.
 *
 * The fixture is the real `@aztec/noir-contracts.js/Token` artifact (imported live —
 * it is ~11 MB, too large to freeze; Aztec is exact-pinned + manually bumped, so an
 * intentional bump that shifts these snapshots is expected to be re-generated then).
 * The real artifact exposes ONE candidate per kind, so the multi-candidate scoring /
 * tie / duplicate paths are pinned separately below against synthetic artifacts built
 * from cloned real ABIs (valid shapes, varied names).
 */
import type { ContractArtifact, FunctionAbi } from "@aztec/stdlib/abi"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { describe, expect, test } from "vitest"
import type { Fn } from "@/wallet/utils/fn"
import { BalanceOfPrivateFn } from "./balance-of-private"
import { BalanceOfPublicFn } from "./balance-of-public"
import { GetDecimalsFn } from "./get-decimals"
import { GetNameFn } from "./get-name"
import { GetSymbolFn } from "./get-symbol"
import { TransferPrivateFn } from "./transfer-private"
import { TransferPrivateToPublicFn } from "./transfer-private-to-public"
import { TransferPublicFn } from "./transfer-public"
import { TransferPublicToPrivateFn } from "./transfer-public-to-private"

// The 9 abstract matcher classes expose the same static surface (`getCandidates`,
// `getDefault`). Typed structurally so the loop stays honest about that contract.
type Matcher = {
	getCandidates(artifact: ContractArtifact): Fn[]
	getDefault(candidates: Fn[]): Fn | undefined
}

const KINDS: ReadonlyArray<readonly [string, Matcher]> = [
	["getName", GetNameFn as unknown as Matcher],
	["getSymbol", GetSymbolFn as unknown as Matcher],
	["getDecimals", GetDecimalsFn as unknown as Matcher],
	["balanceOfPrivate", BalanceOfPrivateFn as unknown as Matcher],
	["balanceOfPublic", BalanceOfPublicFn as unknown as Matcher],
	["transferPrivate", TransferPrivateFn as unknown as Matcher],
	["transferPublic", TransferPublicFn as unknown as Matcher],
	["transferPrivateToPublic", TransferPrivateToPublicFn as unknown as Matcher],
	["transferPublicToPrivate", TransferPublicToPrivateFn as unknown as Matcher],
]

// `abi()` is protected on Fn; the matchers derive selection + arg-encoding from it, so
// it is exactly what must not drift. Read it the way the refactor's snapshot harness will.
const abiOf = (fn: Fn): FunctionAbi => (fn as unknown as { abi(): FunctionAbi }).abi()

const shapeOf = (fn: Fn) => ({
	name: fn.name,
	impl: fn.getImpl().impl,
	type: fn.type,
	isStatic: fn.isStatic,
	abi: abiOf(fn),
})

const artifact = TokenContractArtifact as ContractArtifact

describe("token-functions characterization — real Token artifact", () => {
	for (const [kind, matcher] of KINDS) {
		test(`${kind}: candidates (name/impl/type/isStatic/abi) in matcher order`, () => {
			const candidates = matcher.getCandidates(artifact)
			expect(candidates.map(shapeOf)).toMatchSnapshot()
		})

		test(`${kind}: default selection`, () => {
			const candidates = matcher.getCandidates(artifact)
			expect(matcher.getDefault(candidates)?.name ?? null).toMatchSnapshot()
		})
	}
})

// The real Token artifact has ONE candidate per kind, so the scoring sort / tie /
// duplicate paths never fire against it. Pin them here by cloning a real (predicate-
// passing) ABI and only varying the NAME — the predicate filters by shape, the score
// by name, so these exercise the sort the registry must reproduce exactly.
describe("token-functions characterization — synthetic multi-candidate scoring", () => {
	// Public function whose SHAPE passes the balance/transfer predicates, cloned + renamed.
	const realBalancePublicAbi = abiOf(BalanceOfPublicFn.getCandidates(artifact)[0])
	const realTransferPublicAbi = abiOf(TransferPublicFn.getCandidates(artifact)[0])
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
		const ordered = (BalanceOfPublicFn as unknown as Matcher).getCandidates(art).map((c) => c.name)
		expect(ordered).toMatchSnapshot()
	})

	test("transferPublic: candidate ordering across name variants", () => {
		const art = publicArtifact([
			rename(realTransferPublicAbi, "zzz_unrelated"),
			rename(realTransferPublicAbi, "transfer_public"),
			rename(realTransferPublicAbi, "transfer_in_public"),
			rename(realTransferPublicAbi, "transfer_public_to_public"),
		])
		const ordered = (TransferPublicFn as unknown as Matcher).getCandidates(art).map((c) => c.name)
		expect(ordered).toMatchSnapshot()
	})
})
