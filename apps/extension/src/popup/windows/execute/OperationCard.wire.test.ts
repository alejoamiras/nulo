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
import { type ContractArtifact, FunctionSelector, loadContractArtifact } from "@aztec-labs/stdlib/abi"
import { beforeEach, describe, expect, test, vi } from "vitest"
import AddressDisplay from "@/components/AddressDisplay.vue"
import { trimAddress } from "@/utils/string"
import { decodeCallForDisplay } from "@/wallet/services/execution/call-decoder"
import type { TokenInfo } from "@/wallet/services/token/client"
import { displayCallsOf } from "./display-calls"
import OperationCard from "./OperationCard.vue"
import type { DraftUIOperation } from "./types"

/** What `AddressDisplay` looks an address up in, set per case: the store's accounts and the contacts. */
const lookups = vi.hoisted(() => ({ accounts: [] as { name: string; address: string }[], contacts: new Map<string, string>() }))
vi.mock("@/utils/core", () => ({
	managers: {
		contact: {
			getContactByAddress: vi.fn(async (address: string) => {
				const name = lookups.contacts.get(address)
				return name ? { name } : null
			}),
		},
	},
}))
// The real store's setup opens chrome.storage; the card only needs its account list.
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ accounts: lookups.accounts }) }))

const OWNER = `0x00${"a".repeat(62)}`
const TO = `0x00${"b".repeat(62)}`
const TOKEN = `0x00${"c".repeat(62)}`
const OTHER = `0x00${"d".repeat(62)}`
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`
const USDC = { id: 1, chainId: 1, contract: TOKEN, name: "USD Coin", symbol: "USDC", decimals: 6 } as TokenInfo
const TOKEN_ARTIFACT = loadContractArtifact(WonderlandTokenJson as never)

/** The standard Token's real selectors at 6.0.0-rc.1, pinned against the real hash by
 *  `token-transfer-vocabulary.real.test.ts`: bb.js's poseidon2 cannot run under jsdom, so the hash
 *  is stood in. */
const SELECTORS = new Map([
	["transfer_private_to_private", "0xedc09d49"],
	["transfer_public_to_public", "0xc47adea0"],
	["transfer_private_to_public", "0xaf28c76f"],
	["transfer_public_to_private", "0x32c5dcf8"],
	["burn_private", "0xc282ed79"],
	["burn_public", "0xc611b0c5"],
	["transfer_private_to_commitment", "0x638d3f00"],
	["transfer_public_to_commitment", "0xd427610c"],
	["transfer_private_to_public_with_commitment", "0x398c27b4"],
])
vi.spyOn(FunctionSelector, "fromNameAndParameters").mockImplementation(async (name) =>
	FunctionSelector.fromString(SELECTORS.get(name) ?? "0x00000000"),
)

const callOf = (name: string, args: string[], extra: Record<string, unknown> = {}) => ({
	name,
	to: TOKEN,
	selector: SELECTORS.get(name),
	type: "private",
	isStatic: false,
	hideMsgSender: false,
	args,
	returnTypes: [],
	...extra,
})
const honest = callOf("transfer_private_to_private", [OWNER, TO, field(5_000_000n), field(0n)])
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

const decodeAll = (op: DraftUIOperation, artifact: ContractArtifact = TOKEN_ARTIFACT) =>
	Promise.all(displayCallsOf(op).map((call) => decodeCallForDisplay(async (a) => (a === TOKEN ? artifact : undefined), call)))

const mountCard = async (op: DraftUIOperation, { tokens = [USDC], artifact = TOKEN_ARTIFACT } = {}) => {
	const w = mount(OperationCard, {
		props: { op: op as never, index: 0, tokens, decodedCalls: await decodeAll(op, artifact) },
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
const one = (w: Awaited<ReturnType<typeof mountCard>>, testid: string) => w.find(`[data-testid="${testid}"]`)
const intentKind = (w: Awaited<ReturnType<typeof mountCard>>) => one(w, "execute-op-payload-row").attributes("data-intent-kind")
const decodedNames = (w: Awaited<ReturnType<typeof mountCard>>) =>
	w.findAll('[data-testid="execute-op-decoded-param"]').map((p) => p.attributes("data-param"))

beforeEach(() => {
	lookups.accounts.splice(0)
	lookups.contacts.clear()
})

describe("OperationCard — a call as the wire carries it", () => {
	test("the honest call decodes by its selector, in the contract's own parameter names", async () => {
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

	test.each([
		["transfer_private_to_private", "Transfer (private)"],
		["transfer_public_to_public", "Transfer (public)"],
		["transfer_private_to_public", "Transfer to public"],
		["transfer_public_to_private", "Transfer to private"],
	])("%s on a registered token reads as the transfer row titled %s, from its explicit sender", async (name, title) => {
		const w = await mountCard(sendTx(callOf(name, [OWNER, TO, field(5_000_000n), field(0n)])))
		expect(intentKind(w)).toBe("transfer")
		expect(one(w, "execute-op-payload-row").text()).toContain(title)
		expect(one(w, "execute-op-transfer-sender").attributes("data-sender-kind")).toBe("explicit")
		expect(one(w, "execute-op-amount").text()).toContain("5 USDC")
		expect(one(w, "execute-op-transfer-nonce").exists()).toBe(false)
	})

	test("a copy whose isStatic, returnType and returnTypes lie renders the same rows", async () => {
		const [truth, lies] = await Promise.all([mountCard(sendTx(honest)), mountCard(sendTx(hostile))])

		expect(lies.html()).toBe(truth.html())
		expect(intentKind(lies)).toBe("transfer")
	})

	test.each([
		["burn_private", [OWNER, field(5n), field(0n)]],
		["burn_public", [OWNER, field(5n), field(0n)]],
		["transfer_private_to_commitment", [OWNER, field(77n), field(5n), field(0n)]],
		["transfer_public_to_commitment", [OWNER, field(77n), field(5n), field(0n)]],
		["transfer_private_to_public_with_commitment", [OWNER, TO, field(5n), field(0n)]],
	])("%s decodes and keeps the contract's own rows", async (name, args) => {
		const op = sendTx(callOf(name, args))
		expect((await decodeAll(op))[0]).toMatchObject({ kind: "decoded", fn: name })
		expect(intentKind(await mountCard(op))).toBe("decoded")
	})

	test("on a contract not registered as a token the honest call keeps the decoded rows", async () => {
		const w = await mountCard(sendTx(honest), { tokens: [] })
		expect(intentKind(w)).toBe("decoded")
		expect(decodedNames(w)).toEqual(["from", "to", "amount", "_nonce"])
	})

	test("a non-zero nonce with from equal to the signing account is shown, so the person sees the call will fail", async () => {
		const w = await mountCard(sendTx(callOf("transfer_private_to_private", [OWNER, TO, field(5_000_000n), field(9n)])))
		expect(one(w, "execute-op-transfer-nonce").text()).toContain("9")
	})

	test("From names another address trimmed, another of the person's accounts by its name, a saved contact first", async () => {
		const read = async () => {
			const w = await mountCard(sendTx(callOf("transfer_public_to_public", [OTHER, TO, field(5_000_000n), field(0n)])))
			const sender = one(w, "execute-op-transfer-sender")
			expect(sender.attributes("data-sender-kind")).toBe("explicit")
			expect(sender.text()).not.toContain("this account")
			return sender.text()
		}
		expect(await read()).toContain(trimAddress(OTHER))
		lookups.accounts.push({ name: "Savings", address: OTHER })
		expect(await read()).toContain("Savings")
		lookups.contacts.set(OTHER, "alice")
		expect(await read()).toContain("@alice")
	})

	test("the real interface with from and to relabeled keeps the decoded rows", async () => {
		const swap = (p: { name: string }) => ({ ...p, name: p.name === "from" ? "to" : p.name === "to" ? "from" : p.name })
		const relabeled = {
			...TOKEN_ARTIFACT,
			functions: TOKEN_ARTIFACT.functions.map((f) =>
				f.name === "transfer_private_to_private" ? { ...f, parameters: f.parameters.map(swap) } : f,
			),
		} as ContractArtifact
		const w = await mountCard(sendTx(honest), { artifact: relabeled })
		expect(intentKind(w)).toBe("decoded")
		expect(decodedNames(w)).toEqual(["to", "from", "amount", "_nonce"])
	})

	test.each([
		["upper-case digits", "0xEDC09D49", "raw"],
		["an upper-case prefix", "0Xedc09d49", "raw"],
		["no prefix", "edc09d49", "raw"],
		["seven digits", "0xedc09d4", "raw"],
		["a number", Number("0xedc09d49"), "raw"],
		["a one-element array", ["0xedc09d49"], "decoded"],
	])("the honest call with its selector as %s never reads the transfer row", async (_spelling, selector, kind) => {
		expect(intentKind(await mountCard(sendTx({ ...honest, selector })))).toBe(kind)
	})
})
