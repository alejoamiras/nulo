import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import JournalDetail from "./[id].vue"

const mocks = vi.hoisted(() => ({
	getOperation: vi.fn(),
	updated: [] as Array<(op: OperationRecord) => void>,
}))

vi.mock("vue-router", () => ({
	useRoute: () => ({ params: { id: "j1" } }),
	useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock("@/composables/toast.js", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("@/composables/usePrices", () => ({ usePrices: () => ({ tokenFiatLabel: () => null, dispose: vi.fn() }) }))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return { disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { getProps: vi.fn(async () => []), disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { getTokens: vi.fn(async () => [{ id: 7, symbol: "TST", decimals: 0 }]), disconnect: vi.fn() }
	}),
}))
// The app store opens its own journal client for the in-flight rows; it reads none here.
vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(async () => {}),
			getOperation: mocks.getOperation,
			getOperations: vi.fn(async () => []),
			onOperationAdded: { add: vi.fn(), remove: vi.fn() },
			onOperationDeleted: { add: vi.fn(), remove: vi.fn() },
			onOperationUpdated: { add: (fn: (op: OperationRecord) => void) => mocks.updated.push(fn), remove: vi.fn() },
			onConnected: { add: vi.fn(), remove: vi.fn() },
			disconnect: vi.fn(),
		}
	}),
}))

// The stores read `chrome.storage.local` through the migration-aware facade on setup.
beforeEach(() => {
	vi.stubGlobal("chrome", {
		storage: {
			local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	mocks.updated.length = 0
})

const ACCOUNT = `0x${"0a".repeat(32)}`

/** A transfer that failed at the send line, shaped as the journal stores it. */
function failedSend(check?: "sent" | "reverted" | "unconfirmed"): OperationRecord {
	return {
		id: "j1",
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		networkId: "n1",
		accountAddress: ACCOUNT,
		tokenId: 7,
		amountRaw: "1",
		progress: {
			stage: "failed",
			from: "submitting",
			txHash: `0x${"2b".repeat(32)}`,
			submittedEndpointUrl: "https://rpc.example",
			check,
		},
		error: { kind: "transfer", message: "fetch failed", normalizedRaw: null },
		terminalAt: 1_000,
		attempts: 0,
		createdAt: 0,
		updatedAt: 1_000,
	}
}

async function mountPage(record: OperationRecord) {
	mocks.getOperation.mockResolvedValue(record)
	const w = mount(JournalDetail, {
		global: {
			plugins: [
				createTestingPinia({
					createSpy: vi.fn,
					initialState: { app: { profile: { id: "p1" }, network: { id: "n1", chainId: 1 }, account: { address: ACCOUNT } } },
				}),
			],
			stubs: {
				SubPageHeader: true,
				Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
			},
		},
	})
	await flushPromises()
	return w
}

const row = (w: Awaited<ReturnType<typeof mountPage>>, id: string) => w.find(`[data-testid="journal-detail-${id}"]`)

describe("the journal page of a failed send its wallet checks", () => {
	test("while the check asks, State reads Checking and no Ended row shows; the answer brings it back", async () => {
		const w = await mountPage(failedSend())
		expect(row(w, "state").text()).toBe("Checking")
		expect(row(w, "ended").exists()).toBe(false)

		const answered = failedSend("sent")
		mocks.getOperation.mockResolvedValue(answered)
		for (const onUpdated of mocks.updated) onUpdated(answered)
		await flushPromises()
		expect(row(w, "state").text()).toBe("Sent")
		expect(row(w, "ended").exists()).toBe(true)
	})

	test("an unconfirmed send reads State Unconfirmed, and its Outcome row, which would repeat it, is hidden", async () => {
		const w = await mountPage(failedSend("unconfirmed"))
		expect(row(w, "state").text()).toBe("Unconfirmed")
		expect(row(w, "context").text()).toBe(
			"Your wallet couldn't confirm this. It may still go through, so check History before sending it again.",
		)
		expect(row(w, "category").exists()).toBe(false)
		expect(row(w, "ended").exists()).toBe(true)
	})
})
