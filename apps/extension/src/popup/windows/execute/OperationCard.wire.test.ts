/**
 * An `aztec_sendTx` call exactly as a dApp's `FunctionCall.toJSON` sends it — 32-byte hex fields,
 * the deprecated `returnTypes` beside an absent `returnType` — through the real display chain:
 * `displayCallsOf`, `decodeCallForDisplay` against the real standard Token artifact, then the card.
 * A copy whose `isStatic`, `returnType` and `returnTypes` lie must render the same rows, because
 * the rows come from the ABI the selector names.
 */

// @ts-expect-error — raw JSON import via vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
import { flushPromises, mount } from "@vue/test-utils"
import { FunctionSelector, loadContractArtifact } from "@aztec-labs/stdlib/abi"
import { describe, expect, test, vi } from "vitest"
import AddressDisplay from "@/components/AddressDisplay.vue"
import { decodeCallForDisplay } from "@/wallet/services/execution/call-decoder"
import type { TokenInfo } from "@/wallet/services/token/client"
import { displayCallsOf } from "./display-calls"
import OperationCard from "./OperationCard.vue"
import type { DraftUIOperation } from "./types"

vi.mock("@/utils/core", () => ({ managers: { contact: { getContactByAddress: vi.fn(async () => null) } } }))
// The real store's setup opens chrome.storage; the card only needs its account list.
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ accounts: [] }) }))

const OWNER = `0x00${"a".repeat(62)}`
const TO = `0x00${"b".repeat(62)}`
const TOKEN = `0x00${"c".repeat(62)}`
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`
const USDC = { id: 1, chainId: 1, contract: TOKEN, name: "USD Coin", symbol: "USDC", decimals: 6 } as TokenInfo
const TOKEN_ARTIFACT = loadContractArtifact(WonderlandTokenJson as never)

/** `transfer_private_to_private`'s real selector on the standard Token at 6.0.0-rc.1, computed outside
 *  vitest: bb.js's poseidon2 cannot run under jsdom (see vitest.config.ts), so the hash is stood in. */
const SELECTOR = "0xedc09d49"
vi.spyOn(FunctionSelector, "fromNameAndParameters").mockImplementation(async (name) =>
	FunctionSelector.fromString(name === "transfer_private_to_private" ? SELECTOR : "0x00000000"),
)

const honest = {
	name: "transfer_private_to_private",
	to: TOKEN,
	selector: SELECTOR,
	type: "private",
	isStatic: false,
	hideMsgSender: false,
	args: [OWNER, TO, field(5_000_000n), field(0n)],
	returnTypes: [],
}
const hostile = { ...honest, isStatic: true, returnType: { kind: "field" }, returnTypes: [{ kind: "boolean" }] }

const sendTx = (call: unknown) =>
	({
		kind: "aztec_sendTx" as const,
		networkId: "net-1",
		accountAddress: OWNER,
		account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
		network: { id: "net-1", chainId: 1, name: "N" },
		exec: { calls: [call] },
		opts: { from: OWNER },
		feeSettings: { paymentMethod: { kind: "fj" } },
	}) as unknown as DraftUIOperation

const decodeAll = (op: DraftUIOperation) =>
	Promise.all(displayCallsOf(op).map((call) => decodeCallForDisplay(async (a) => (a === TOKEN ? TOKEN_ARTIFACT : undefined), call)))

const mountCard = async (op: DraftUIOperation) => {
	const w = mount(OperationCard, {
		props: { op: op as never, index: 0, tokens: [USDC], decodedCalls: await decodeAll(op) },
		global: {
			stubs: {
				Flex: { inheritAttrs: false, template: '<div v-bind="$attrs"><slot /></div>' },
				Text: { inheritAttrs: false, template: '<span v-bind="$attrs"><slot /></span>' },
				Icon: true,
				FeeSettingsCard: true,
			},
			components: { AddressDisplay },
		},
	})
	await flushPromises()
	return w
}

describe("OperationCard — a call as the wire carries it", () => {
	test("the honest call decodes by its selector and the card reads the ABI's parameters", async () => {
		expect(await decodeAll(sendTx(honest))).toEqual([
			{
				kind: "decoded",
				contract: "Token",
				fn: "transfer_private_to_private",
				params: [
					{ name: "from", value: { kind: "address", value: OWNER } },
					{ name: "to", value: { kind: "address", value: TO } },
					{ name: "amount", value: { kind: "integer", value: "5000000" } },
					{ name: "_nonce", value: { kind: "field", value: field(0n) } },
				],
			},
		])
	})

	test("a copy whose isStatic, returnType and returnTypes lie renders the same rows", async () => {
		const [truth, lies] = await Promise.all([mountCard(sendTx(honest)), mountCard(sendTx(hostile))])

		expect(lies.html()).toBe(truth.html())
		expect(lies.find('[data-testid="execute-op-payload-row"]').attributes("data-intent-kind")).toBe("decoded")
		const params = lies.findAll('[data-testid="execute-op-decoded-param"]').map((p) => p.attributes("data-param"))
		expect(params).toEqual(["from", "to", "amount", "_nonce"])
	})
})
