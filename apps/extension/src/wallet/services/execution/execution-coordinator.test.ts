/**
 * `ExecutionCoordinator.proveAndSend` contract tests.
 *
 * The frozen sequence:
 *   checkCancelled → journal(proving) → prove → checkCancelled →
 *   assertAuthorization → [offchain hook] → toTx → journal(submitting) →
 *   checkCancelled → assertLive + send → record → journal(succeeded)
 *
 * The cancel-before-send contract ("a cancel during prove drops the
 * proof artifact silently — nothing is broadcast") is the 4001 promise
 * `cancel-mid-prove` pins end-to-end; here it's pinned at unit level.
 */

import { describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { IPXE } from "@/wallet/services/pxe/client"
import type { TaskService, WrappedTask } from "@/wallet/services/task/service"
import { DuplicateInitializationError, SessionEndedError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import type { LegalAdmission } from "@/wallet/services/legal/spec"
import { ExecutionCoordinator, type ProveAndSendContext } from "./execution-coordinator"

const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() } as unknown as WrappedTask
;(fakeTask.startSubtask as ReturnType<typeof vi.fn>).mockReturnValue(fakeTask)

const ACCEPTED: LegalAdmission = { assertCurrent: async () => {} }

function makeCoordinator(legal: LegalAdmission = ACCEPTED) {
	const tasks = { startNewTask: () => fakeTask } as unknown as TaskService
	return new ExecutionCoordinator(tasks, new LoggerStore(new ConfigStore()), legal)
}

function makeHarness(overrides: Partial<ProveAndSendContext> = {}) {
	const calls: string[] = []
	const tx = {
		getTxHash: () => ({ toString: () => "0xhash" }),
	}
	const provedTx = {
		toTx: vi.fn(async () => {
			calls.push("toTx")
			return tx
		}),
		marker: "provedTx",
	}
	const pxe = {
		proveTx: vi.fn(async () => {
			calls.push("prove")
			return provedTx
		}),
	} as unknown as IPXE
	const node = {
		sendTx: vi.fn(async () => {
			calls.push("send")
		}),
	} as unknown as AztecNode
	const scopes = [{ toString: () => "0xscope" }] as unknown as ProveAndSendContext["scopes"]
	const ctx: ProveAndSendContext = {
		pxe,
		node,
		txRequest: { marker: "txRequest" } as unknown as ProveAndSendContext["txRequest"],
		scopes,
		parentTask: fakeTask,
		checkCancelled: vi.fn(() => {
			calls.push("checkCancelled")
		}),
		assertAuthorization: vi.fn(async () => {}),
		assertLive: vi.fn(() => {}),
		markJournal: vi.fn(async (patch: { stage: string }) => {
			calls.push(`journal:${patch.stage}`)
		}),
		recordTransaction: vi.fn(async () => {
			calls.push("record")
		}),
		...overrides,
	}
	return { ctx, calls, pxe, node, provedTx, scopes }
}

describe("proveAndSend: frozen sequence", () => {
	test("ordering: cancel → proving → prove → cancel → toTx → submitting → cancel → send → record → succeeded", async () => {
		const { ctx, calls } = makeHarness()
		const result = await makeCoordinator().proveAndSend(ctx)
		expect(calls).toEqual([
			"checkCancelled",
			"journal:proving",
			"prove",
			"checkCancelled",
			"toTx",
			"journal:submitting",
			"checkCancelled",
			"send",
			"record",
			"journal:succeeded",
		])
		expect(result.txHash.toString()).toBe("0xhash")
		expect(result.offchainOutput).toBeUndefined()
	})

	test("scopes passthrough: prove receives the EXACT array — the coordinator never computes scopes", async () => {
		const { ctx, pxe, scopes } = makeHarness()
		await makeCoordinator().proveAndSend(ctx)
		const proveArgs = (pxe.proveTx as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(proveArgs[1]).toBe(scopes)
	})

	test("offchain hook runs BETWEEN prove and toTx, receives provedTx, lands in the result", async () => {
		const hookOrder: string[] = []
		const { ctx, calls, provedTx } = makeHarness({
			wantOffchainOutput: vi.fn((p: unknown) => {
				hookOrder.push("hook")
				expect(p).toBe(provedTx)
				return { effects: ["x"] }
			}) as ProveAndSendContext["wantOffchainOutput"],
		})
		const result = await makeCoordinator().proveAndSend(ctx)
		expect(result.offchainOutput).toEqual({ effects: ["x"] })
		// hook fired after prove but before toTx
		const proveIdx = calls.indexOf("prove")
		const toTxIdx = calls.indexOf("toTx")
		expect(proveIdx).toBeGreaterThanOrEqual(0)
		expect(toTxIdx).toBeGreaterThan(proveIdx)
		expect(hookOrder).toEqual(["hook"])
	})

	test("cancel-before-send: a throw at the post-prove checkpoint means NO broadcast, NO record, NO success journal", async () => {
		let checks = 0
		const { ctx, node, calls } = makeHarness({
			checkCancelled: vi.fn(() => {
				checks += 1
				calls.push("checkCancelled")
				// First check (pre-prove) passes; second (post-prove) cancels.
				if (checks === 2) throw new Error("cancelled-sentinel")
			}),
		})
		await expect(makeCoordinator().proveAndSend(ctx)).rejects.toThrow("cancelled-sentinel")
		expect((node.sendTx as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
		expect(calls).not.toContain("record")
		expect(calls).not.toContain("journal:succeeded")
		expect(calls).not.toContain("journal:submitting")
	})

	test("cancel-before-broadcast: a throw at the post-submitting checkpoint still means NO broadcast", async () => {
		let checks = 0
		const { ctx, node, calls } = makeHarness({
			checkCancelled: vi.fn(() => {
				checks += 1
				calls.push("checkCancelled")
				if (checks === 3) throw new Error("cancelled-sentinel")
			}),
		})
		await expect(makeCoordinator().proveAndSend(ctx)).rejects.toThrow("cancelled-sentinel")
		expect((node.sendTx as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
		expect(calls).not.toContain("send")
	})

	test("send failure propagates without record or success journal (failure shaping is caller-side)", async () => {
		const { ctx, calls } = makeHarness()
		;(ctx.node.sendTx as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("mempool full"))
		await expect(makeCoordinator().proveAndSend(ctx)).rejects.toThrow("mempool full")
		expect(calls).not.toContain("record")
		expect(calls).not.toContain("journal:succeeded")
	})
})

describe("proveAndSend: the session checks", () => {
	test("ordering: assertAuthorization right after the post-prove cancel check; assertLive right before the send", async () => {
		const { ctx, calls } = makeHarness({
			wantOffchainOutput: vi.fn(() => {
				calls.push("offchain")
				return {}
			}) as ProveAndSendContext["wantOffchainOutput"],
		})
		ctx.assertAuthorization = vi.fn(async () => {
			calls.push("assertAuthorization")
		})
		ctx.assertLive = vi.fn(() => {
			calls.push("assertLive")
		})
		await makeCoordinator().proveAndSend(ctx)
		expect(calls).toEqual([
			"checkCancelled",
			"journal:proving",
			"prove",
			"checkCancelled",
			"assertAuthorization",
			"offchain",
			"toTx",
			"journal:submitting",
			"checkCancelled",
			"assertLive",
			"send",
			"record",
			"journal:succeeded",
		])
	})

	test("assertAuthorization rejecting after the proof: no toTx, no submitting, no send", async () => {
		const { ctx, calls, node, provedTx } = makeHarness({
			assertAuthorization: vi.fn(async () => {
				throw new SessionEndedError()
			}),
		})
		await expect(makeCoordinator().proveAndSend(ctx)).rejects.toBeInstanceOf(SessionEndedError)
		expect(calls).toContain("prove")
		expect(provedTx.toTx).not.toHaveBeenCalled()
		expect(calls).not.toContain("journal:submitting")
		expect(node.sendTx).not.toHaveBeenCalled()
	})

	test("a cancel committed before the submitting write still stops at its own check; the session check never runs", async () => {
		let checks = 0
		const { ctx, node } = makeHarness({
			checkCancelled: vi.fn(() => {
				checks += 1
				if (checks === 3) throw new Error("cancelled-sentinel")
			}),
		})
		await expect(makeCoordinator().proveAndSend(ctx)).rejects.toThrow("cancelled-sentinel")
		expect(ctx.assertLive).not.toHaveBeenCalled()
		expect(node.sendTx).not.toHaveBeenCalled()
	})

	test("assertLive throwing in the send step: the node is never called, the step fails with it, nothing is recorded", async () => {
		const { ctx, calls, node } = makeHarness({
			assertLive: vi.fn(() => {
				throw new SessionEndedError()
			}),
		})
		;(fakeTask.fail as ReturnType<typeof vi.fn>).mockClear()
		await expect(makeCoordinator().proveAndSend(ctx)).rejects.toBeInstanceOf(SessionEndedError)
		expect(node.sendTx).not.toHaveBeenCalled()
		expect((fakeTask.fail as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBeInstanceOf(SessionEndedError)
		expect(calls).toContain("journal:submitting")
		expect(calls).not.toContain("record")
		expect(calls).not.toContain("journal:succeeded")
	})

	test("a session end while node.sendTx is pending does not undo the send: record and succeeded follow", async () => {
		let live = true
		let finishSend: () => void = () => {}
		const { ctx, calls } = makeHarness({
			assertLive: vi.fn(() => {
				if (!live) throw new SessionEndedError()
			}),
		})
		;(ctx.node.sendTx as ReturnType<typeof vi.fn>).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					calls.push("send")
					finishSend = resolve
				}),
		)
		const run = makeCoordinator().proveAndSend(ctx)
		await vi.waitFor(() => expect(calls).toContain("send"))
		live = false
		finishSend()
		await expect(run).resolves.toMatchObject({})
		expect(calls.slice(-2)).toEqual(["record", "journal:succeeded"])
		expect(ctx.assertLive).toHaveBeenCalledTimes(1)
	})
})

describe("sendTxTask — duplicate-initialization classification (N-15)", () => {
	const NULLIFIER_REJECTION = new Error("Invalid tx: Existing nullifier")

	function makeSendHarness(sendError: Error) {
		const coordinator = makeCoordinator()
		const node = { sendTx: vi.fn(async () => Promise.reject(sendError)) } as unknown as AztecNode
		return { coordinator, node }
	}

	test("initializing build + existing-nullifier rejection → typed error with the honest copy, task fails with it", async () => {
		const { coordinator, node } = makeSendHarness(NULLIFIER_REJECTION)
		;(fakeTask.fail as ReturnType<typeof vi.fn>).mockClear()
		const run = coordinator.sendTxTask(node, {} as never, () => {}, fakeTask, true)
		await expect(run).rejects.toBeInstanceOf(DuplicateInitializationError)
		await expect(coordinator.sendTxTask(node, {} as never, () => {}, fakeTask, true)).rejects.toThrow(
			/wait for network sync, then retry/,
		)
		const failedWith = (fakeTask.fail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
		expect(failedWith).toBeInstanceOf(DuplicateInitializationError) // honest text reaches the task, not the raw validator string
	})

	test("NON-initializing build + the same rejection stays GENERIC (double-spend false-positive guard)", async () => {
		const { coordinator, node } = makeSendHarness(NULLIFIER_REJECTION)
		const run = coordinator.sendTxTask(node, {} as never, () => {}, fakeTask, false)
		await expect(run).rejects.toBe(NULLIFIER_REJECTION)
	})

	test("unknown provenance (undefined flag) stays GENERIC", async () => {
		const { coordinator, node } = makeSendHarness(NULLIFIER_REJECTION)
		await expect(coordinator.sendTxTask(node, {} as never, () => {}, fakeTask, undefined)).rejects.toBe(NULLIFIER_REJECTION)
	})

	test("initializing build + an UNRELATED rejection stays GENERIC", async () => {
		const other = new Error("Node unreachable")
		const { coordinator, node } = makeSendHarness(other)
		await expect(coordinator.sendTxTask(node, {} as never, () => {}, fakeTask, true)).rejects.toBe(other)
	})
})

describe("sendTxTask — the Terms wall", () => {
	const refusing: LegalAdmission = {
		assertCurrent: async () => {
			throw new TermsAcceptanceRequiredError()
		},
	}

	test("without a current acceptance nothing reaches the node and the task fails with the typed error", async () => {
		const node = { sendTx: vi.fn() } as unknown as AztecNode
		const assertLive = vi.fn()
		;(fakeTask.fail as ReturnType<typeof vi.fn>).mockClear()
		await expect(makeCoordinator(refusing).sendTxTask(node, {} as never, assertLive, fakeTask)).rejects.toBeInstanceOf(
			TermsAcceptanceRequiredError,
		)
		expect(node.sendTx).not.toHaveBeenCalled()
		expect(assertLive).not.toHaveBeenCalled()
		expect(fakeTask.fail).toHaveBeenCalledWith(expect.any(TermsAcceptanceRequiredError))
	})

	test("proveAndSend stops at the wall: proved, never sent, never recorded, never marked succeeded", async () => {
		const harness = makeHarness()
		await expect(makeCoordinator(refusing).proveAndSend(harness.ctx)).rejects.toBeInstanceOf(TermsAcceptanceRequiredError)
		expect(harness.calls).toContain("prove")
		expect(harness.calls).not.toContain("send")
		expect(harness.ctx.recordTransaction).not.toHaveBeenCalled()
		expect(harness.ctx.markJournal).not.toHaveBeenCalledWith(expect.objectContaining({ stage: "succeeded" }))
	})

	test("the acceptance read comes before the liveness check, which still has the last word", async () => {
		// A session that ends while the storage read is in flight must still stop the send: the read
		// resolves as accepted, and only then does assertLive run — synchronously, in the send's tick.
		const order: string[] = []
		let release!: () => void
		const held: LegalAdmission = {
			assertCurrent: () =>
				new Promise<void>((resolve) => {
					order.push("legal:start")
					release = () => {
						order.push("legal:resolved")
						resolve()
					}
				}),
		}
		const node = { sendTx: vi.fn() } as unknown as AztecNode
		let live = true
		const assertLive = () => {
			order.push("assertLive")
			if (!live) throw new SessionEndedError()
		}
		const run = makeCoordinator(held).sendTxTask(node, {} as never, assertLive, fakeTask)
		await Promise.resolve()
		live = false
		release()
		await expect(run).rejects.toBeInstanceOf(SessionEndedError)
		expect(order).toEqual(["legal:start", "legal:resolved", "assertLive"])
		expect(node.sendTx).not.toHaveBeenCalled()
	})
})
