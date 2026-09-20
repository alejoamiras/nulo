/**
 * The dApp ingress refuses every request while the Terms acceptance is not current: the dispatcher
 * never sees the method, the dApp gets the typed envelope, and a queued record does not strand.
 */
import { describe, expect, test, vi } from "vitest"
import { TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import { LogLevel } from "@/wallet/logger"

vi.mock("@aztec/wallet-sdk/extension/handlers", () => ({ BackgroundConnectionHandler: class {} }))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { handleWalletMessage } from "./background"

const SESSION = { sessionId: "s1", origin: "https://dapp.example", chainInfo: { chainId: "1", version: "1" } } as never

function harness(assertCurrent: () => Promise<void>) {
	const dispatch = vi.fn(async () => "ok")
	const sendResponse = vi.fn(async (_sessionId: string, _response: unknown) => {})
	const transitionIfStage = vi.fn(async () => {})
	const log = vi.fn()
	const legal = { assertCurrent: vi.fn(assertCurrent) }
	const run = (type: string, args: unknown[] = [], queuedJournalId?: string) =>
		handleWalletMessage(
			SESSION,
			{ messageId: "m1", type, args } as never,
			{ sendResponse, terminateSession: vi.fn() } as never,
			{ dispatch } as never,
			{ captureExecutionFence: async () => ({ profileId: "p1" }) } as never,
			{ transitionIfStage } as never,
			new Map([["s1", "p1"]]),
			{ current: () => 0 } as never,
			{ log } as never,
			legal,
			queuedJournalId ? { queuedJournalId } : undefined,
		)
	return { run, dispatch, sendResponse, transitionIfStage, log, legal }
}

const refuse = async () => {
	throw new TermsAcceptanceRequiredError()
}

describe("handleWalletMessage — Terms admission", () => {
	test("a refused request never reaches the dispatcher and answers with the 4100 envelope", async () => {
		const h = harness(refuse)
		await h.run("getAccounts")

		expect(h.dispatch).not.toHaveBeenCalled()
		expect(h.sendResponse).toHaveBeenCalledTimes(1)
		expect(h.sendResponse.mock.calls[0]?.[1]).toMatchObject({
			messageId: "m1",
			error: { code: 4100, data: { walletErrorCode: TermsAcceptanceRequiredError.CODE } },
		})
	})

	test("the refusal is logged at debug, because a connected dApp polls", async () => {
		const h = harness(refuse)
		await h.run("getChainInfo")

		expect(h.log.mock.calls.map((call) => call[1])).toEqual([LogLevel.Debug])
	})

	test("a refused sendTx settles its pre-created queued record instead of stranding it", async () => {
		const h = harness(refuse)
		await h.run("sendTx", [{}, {}], "journal-1")

		expect(h.dispatch).not.toHaveBeenCalled()
		expect(h.transitionIfStage).toHaveBeenCalledWith("journal-1", ["queued"], { stage: "failed" }, expect.anything())
	})

	test("a batch costs one acceptance read, however many legs it carries", async () => {
		const h = harness(async () => {})
		await h.run("batch", [[{ name: "getAccounts" }, { name: "getChainInfo" }, { name: "sendTx" }]])

		expect(h.legal.assertCurrent).toHaveBeenCalledTimes(1)
		expect(h.dispatch).toHaveBeenCalledTimes(1)
		expect(h.sendResponse.mock.calls[0]?.[1]).toMatchObject({ result: "ok" })
	})
})
