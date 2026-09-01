/**
 * PRE-EXTRACTION pins for the journal claim engine — the equivalence complement the
 * journal-engine-decomposition plan requires committed BEFORE any refactor (codex blueprint
 * audit, response-11). Drives the CURRENT engine over the same injected-deps style as
 * useBridgeJournal.test.ts (scaffolding duplicated — no vi.mock sharing across files).
 */
import {
	type DepositJournalRecord,
	type KV,
	type WithdrawJournalRecord,
	recoveryKeyFromSignature,
	sealDepositEnvelope,
} from "@nulo/bridge-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: undefined,
	L1_USDC: "0xl1token",
	BRIDGE_TOKEN_SYMBOL: "USDC",
	BRIDGE_TOKEN_DECIMALS: 6,
	L1_PORTAL: "0xportal",
	FUEL_PORTAL: "0xfjportal",
	FUEL_ASSET: "0xfjasset",
	FUEL_MIN_FJ: 11000000000000000000n,
	BRIDGE: { toString: () => "0xbridge" },
}))

import {
	__resetJournalForTests,
	addRecord,
	cacheSecret,
	connectJournalDeps,
	runDepositClaim,
	runWithdrawConsume,
	updateRecord,
	useBridgeJournal,
} from "./useBridgeJournal"

function memKV(): KV {
	const store = new Map<string, string>()
	return {
		getItem: (k) => store.get(k) ?? null,
		setItem: (k, v) => void store.set(k, v),
		removeItem: (k) => void store.delete(k),
	}
}

const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }
const SEALER = "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"
const RECIPIENT = "0x1018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d"
const SIG = `0x${"a".repeat(130)}`

function mkDeposit(id: string, over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id,
		direction: "deposit",
		isPrivate: false,
		amount: "100000000",
		createdAt: 1,
		updatedAt: 1,
		recipient: RECIPIENT,
		secret: "0xpublicsecret",
		secretHashHex: id,
		leafIndex: "7",
		...DEPLOY,
		...over,
	}
}

function mkWithdraw(id: string, over: Partial<WithdrawJournalRecord> = {}): WithdrawJournalRecord {
	return {
		schema: 1,
		id,
		direction: "withdraw",
		isPrivate: false,
		amount: "40000000",
		createdAt: 1,
		updatedAt: 1,
		recipientL1: SEALER,
		exitTxHash: id,
		...DEPLOY,
		...over,
	}
}

/** A claim fake: simulate succeeds until send fires, then reverts msg-not-found (consumed). */
function smartClaimFake() {
	let sent = false
	const claim = vi.fn(async () => ({
		simulate: async () => {
			if (sent) throw new Error("No L1 to L2 message found for message hash 0xdead")
			return {}
		},
		send: async () => {
			sent = true
			return { txHash: "0xclaimtx" }
		},
	}))
	return claim
}

function baseDeps(kv: KV) {
	return {
		kv,
		now: () => 999,
		waitMs: async () => {},
		connectedL1: () => SEALER,
		connectedAztec: () => RECIPIENT,
		signL1: vi.fn(async () => SIG),
		claimReceiptStatus: vi.fn<() => Promise<"success" | "dropped" | "reverted" | "pending" | "unreachable">>(async () => "success"),
		waitConsumeReceipt: vi.fn(async () => true),
		verifyConsumeIdentity: vi.fn(async () => true),
		consume: vi.fn(async () => ({ consumeTxHash: "0xconsumetx" })),
	}
}

async function _sealEnvelopeFor(rec: DepositJournalRecord, over: Partial<{ recipient: string; amount: string; sealerL1: string }> = {}) {
	const key = await recoveryKeyFromSignature(SIG)
	return sealDepositEnvelope(key, {
		secret: "0xprivatesecret",
		recipient: over.recipient ?? rec.recipient,
		amount: over.amount ?? rec.amount,
		sealerL1: over.sealerL1 ?? SEALER,
		leafIndex: rec.leafIndex,
	})
}

import { SYNC_TARGET_MARGIN_BLOCKS } from "@/lib/bridge-steps"
import { RECEIPT_RECORD_MISMATCH_MSG } from "@/lib/fuel-claim-state"

describe("journal engine — pre-extraction pins", () => {
	let kv: KV

	beforeEach(() => {
		__resetJournalForTests()
		kv = memKV()
	})

	const notReady = () => new Error("No L1 to L2 message found for message hash 0xdead")

	it("(a) shared budget off-by-one: N countdown ticks leave exactly 300−N simulate polls", async () => {
		const deps = baseDeps(kv)
		const target = 100 + SYNC_TARGET_MARGIN_BLOCKS
		// 5 below-target reads, then arrived.
		const seq = [target - 5, target - 4, target - 3, target - 2, target - 1]
		let call = 0
		const l2BlockNumber = vi.fn(async () => (call < seq.length ? seq[call++] : target))
		let simulateCalls = 0
		const claim = vi.fn(async () => ({
			simulate: async () => {
				simulateCalls++
				throw notReady()
			},
			send: async () => ({ txHash: "0xnever" }),
		}))
		connectJournalDeps({ ...deps, claim, l2BlockNumber })
		addRecord(mkDeposit("0xbudget", { depositL2Block: 100 }))
		await runDepositClaim("0xbudget")
		// 5 countdown iterations consumed → 295 simulate polls remain, then the never-consumable error.
		expect(simulateCalls).toBe(295)
		const { runtime } = useBridgeJournal()
		expect(runtime.value["0xbudget"]?.note).toMatch(/never became consumable/)
	})

	it("(a) all 300 consumed by the countdown ⇒ ZERO simulate attempts", async () => {
		const deps = baseDeps(kv)
		const l2BlockNumber = vi.fn(async () => 1) // forever below target
		let simulateCalls = 0
		const claim = vi.fn(async () => ({
			simulate: async () => {
				simulateCalls++
				throw notReady()
			},
			send: async () => ({ txHash: "0xnever" }),
		}))
		connectJournalDeps({ ...deps, claim, l2BlockNumber })
		addRecord(mkDeposit("0xexhaust", { depositL2Block: 100 }))
		await runDepositClaim("0xexhaust")
		expect(l2BlockNumber).toHaveBeenCalledTimes(300)
		expect(simulateCalls).toBe(0)
	})

	it("(b) full order: claim-build → countdown → token+fuel checkpoint gate → simulate → send; checkpoint waiting sets the arrived narration", async () => {
		const deps = baseDeps(kv)
		const order: string[] = []
		const { runtime } = useBridgeJournal()
		const target = 100 + SYNC_TARGET_MARGIN_BLOCKS
		const l2BlockNumber = vi.fn(async () => {
			order.push("countdown")
			return target
		})
		let readinessCall = 0
		const messageReadiness = vi.fn(async (h: string) => {
			order.push(`gate:${h}`)
			readinessCall++
			// First sweep: token message not yet anchored past the checkpoint → waits once.
			return readinessCall === 1 ? { checkpoint: 5, anchor: 4 } : { checkpoint: 5, anchor: 5 }
		})
		let narrationAtSimulate = ""
		const claim = vi.fn(async () => {
			order.push("build")
			return {
				simulate: async () => {
					order.push("simulate")
					narrationAtSimulate = runtime.value["0xorder"]?.stepDetail ?? ""
				},
				send: async () => {
					order.push("send")
					return { txHash: "0xsent" }
				},
			}
		})
		connectJournalDeps({ ...deps, claim, l2BlockNumber, messageReadiness })
		addRecord(mkDeposit("0xorder", { depositL2Block: 100, messageHash: "0xTOK", fuel: { messageHash: "0xFUEL" } as never }))
		await runDepositClaim("0xorder")
		expect(order[0]).toBe("build")
		expect(order[1]).toBe("countdown")
		expect(order.slice(2, 4)).toEqual(["gate:0xTOK", "gate:0xTOK"]) // blocked once, re-swept
		expect(order[4]).toBe("gate:0xFUEL")
		expect(order.indexOf("simulate")).toBeGreaterThan(order.lastIndexOf("gate:0xFUEL"))
		expect(order.indexOf("send")).toBeGreaterThan(order.indexOf("simulate"))
		// Checkpoint waiting set counted=true → the simulate phase narrates "message arrived".
		expect(narrationAtSimulate).toMatch(/message arrived - waiting for your wallet to sync it/)
	})

	it("(b) legacy record with no messageHash skips the checkpoint gate entirely", async () => {
		const deps = baseDeps(kv)
		const messageReadiness = vi.fn(async () => ({ checkpoint: 1, anchor: 1 }))
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim, messageReadiness })
		addRecord(mkDeposit("0xlegacy"))
		await runDepositClaim("0xlegacy")
		expect(messageReadiness).not.toHaveBeenCalled()
	})

	it("(c) preGated retry: countdown deps untouched; claimable latches after simulate, before a rejected send", async () => {
		const deps = baseDeps(kv)
		const { runtime } = useBridgeJournal()
		let sendRejects = true
		const claim = vi.fn(async () => ({
			simulate: async () => {},
			send: async () => {
				if (sendRejects) throw new Error("wallet closed")
				return { txHash: "0xsent2" }
			},
		}))
		const l2BlockNumber = vi.fn(async () => 100 + SYNC_TARGET_MARGIN_BLOCKS)
		connectJournalDeps({ ...deps, claim, l2BlockNumber })
		addRecord(mkDeposit("0xpregate", { depositL2Block: 100 }))
		await runDepositClaim("0xpregate")
		// claimable latched by the successful simulate even though the send rejected.
		expect(runtime.value["0xpregate"]?.claimable).toBe(true)
		const countdownCalls = l2BlockNumber.mock.calls.length
		sendRejects = false
		await runDepositClaim("0xpregate")
		// The preGated retry consults NO countdown dep.
		expect(l2BlockNumber.mock.calls.length).toBe(countdownCalls)
		const { records } = useBridgeJournal()
		expect(records.value.find((r) => r.id === "0xpregate")?.completedAt).toBe(999)
	})

	it("(d) claim-material conservation: the claim receives the recovery-patched record + exact private material", async () => {
		const deps = baseDeps(kv)
		const seen: Array<{
			leafIndex?: string
			messageHash?: string
			fuelLeaf?: string
			fuelReceived?: string
			secretHex: string
			envelopeSecret?: string
		}> = []
		const claim = vi.fn(async (rec: DepositJournalRecord, secretHex: string, envelope?: { secret?: string }) => {
			seen.push({
				leafIndex: rec.leafIndex,
				messageHash: rec.messageHash,
				fuelLeaf: rec.fuel?.leafIndex,
				fuelReceived: rec.fuel?.received,
				secretHex,
				envelopeSecret: envelope?.secret,
			})
			return { simulate: async () => {}, send: async () => ({ txHash: "0xdone" }) }
		})
		const recoverDepositLeg = vi.fn(async (rec: DepositJournalRecord) => {
			updateRecord(rec.id, {
				leafIndex: "77",
				messageHash: "0xTOKKEY",
				fuel: { ...(rec.fuel ?? {}), leafIndex: "78", messageHash: "0xFUELKEY", received: "4444" } as never,
			})
			return "recovered" as const
		})
		const base = mkDeposit("0xmaterial", {
			isPrivate: true,
			secret: undefined,
			schema: 2,
			leafIndex: undefined,
			depositTxHash: "0xdep",
			fuel: { amount: "1", secret: "0xf", secretHashHex: "0xfh", minOutput: "1", bridgeSecretSalt: "0xsalt" } as never,
		})
		connectJournalDeps({ ...deps, claim, recoverDepositLeg })
		addRecord(base)
		// Same-session cached secret (the in-session path): the claim must receive EXACTLY this
		// material alongside the recovery-patched record.
		cacheSecret("0xmaterial", "0xprivatesecret", {
			v: 2,
			secret: "0xprivatesecret",
			recipient: base.recipient,
			amount: base.amount,
			sealerL1: SEALER,
		} as never)
		await runDepositClaim("0xmaterial")
		expect(recoverDepositLeg).toHaveBeenCalledTimes(1)
		const first = seen[0]
		expect(first).toMatchObject({
			leafIndex: "77",
			messageHash: "0xTOKKEY",
			fuelLeaf: "78",
			fuelReceived: "4444",
			secretHex: "0xprivatesecret",
			envelopeSecret: "0xprivatesecret",
		})
	})

	it("(d) terminal receipt-mismatch classifies as receipt-mismatch; a generic recovery throw as error", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		const recoverDepositLeg = vi.fn(async () => {
			throw new Error(`This bridge's Ethereum ${RECEIPT_RECORD_MISMATCH_MSG} - unrecoverable`)
		})
		connectJournalDeps({ ...deps, claim, recoverDepositLeg })
		addRecord(mkDeposit("0xmm", { leafIndex: undefined, depositTxHash: "0xdep" }))
		await runDepositClaim("0xmm")
		const { runtime } = useBridgeJournal()
		expect(runtime.value["0xmm"]?.attention).toBe("receipt-mismatch")

		const recover2 = vi.fn(async () => {
			throw new Error("rpc exploded")
		})
		connectJournalDeps({ ...deps, claim, recoverDepositLeg: recover2 })
		addRecord(mkDeposit("0xgen", { leafIndex: undefined, depositTxHash: "0xdep2" }))
		await runDepositClaim("0xgen")
		expect(runtime.value["0xgen"]?.attention).toBe("error")
	})

	it("(e) sent-claim monotonicity: an existing hash goes to ITS receipt; deps.claim/send never invoked", async () => {
		const deps = baseDeps(kv)
		const claim = vi.fn()
		const hashesChecked: string[] = []
		deps.claimReceiptStatus.mockImplementation((async (h: string) => {
			hashesChecked.push(h)
			return "success"
		}) as never)
		connectJournalDeps({ ...deps, claim: claim as never })
		addRecord(mkDeposit("0xsentalready", { claimTxHash: "0xtheclaim" }))
		// Forge-resistant completion needs provenance OR the probe; without provenance the probe
		// needs the secret — public record has one, so recordMessageConsumed builds a probe claim.
		// Use a probe-friendly claim: consumed shape.
		claim.mockImplementation(async () => ({
			simulate: async () => {
				throw new Error("No non-nullified L1 to L2 message found")
			},
			send: async () => {
				throw new Error("send must never fire on the sent path")
			},
		}))
		await runDepositClaim("0xsentalready")
		expect(hashesChecked).toEqual(["0xtheclaim"])
		const { records } = useBridgeJournal()
		expect(records.value.find((r) => r.id === "0xsentalready")?.completedAt).toBe(999)
	})

	it("(e) (BUG PIN) the reverted-hash trap: a terminal revert RETAINS claimTxHash — every retry rechecks, none can resend", async () => {
		const deps = baseDeps(kv)
		const claim = vi.fn(async () => ({ simulate: async () => {}, send: async () => ({ txHash: "0xnew" }) }))
		deps.claimReceiptStatus.mockResolvedValue("reverted")
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xrevtrap", { claimTxHash: "0xreverted" }))
		await runDepositClaim("0xrevtrap")
		const { records, runtime } = useBridgeJournal()
		// The copy says "retry" but the hash survives, so the next run re-enters the receipt
		// path and can never resend. Preserved verbatim; owner follow-up candidate.
		expect(runtime.value["0xrevtrap"]?.note).toMatch(/reverted on Aztec/)
		expect((records.value.find((r) => r.id === "0xrevtrap") as DepositJournalRecord | undefined)?.claimTxHash).toBe("0xreverted")
		await runDepositClaim("0xrevtrap")
		expect(claim).not.toHaveBeenCalled()
	})

	it("(f) dropped debounce: any non-dropped status resets the streak; three straight drops clear the hash", async () => {
		const deps = baseDeps(kv)
		const claim = vi.fn()
		const seq: Array<"dropped" | "pending" | "success"> = ["dropped", "dropped", "pending", "dropped", "dropped", "dropped"]
		let n = 0
		deps.claimReceiptStatus.mockImplementation(async () => (n < seq.length ? seq[n++] : "pending"))
		connectJournalDeps({ ...deps, claim: claim as never })
		addRecord(mkDeposit("0xstreak", { claimTxHash: "0xdroppy" }))
		claim.mockImplementation(async () => ({ simulate: async () => {}, send: async () => ({ txHash: "0xx" }) }))
		await runDepositClaim("0xstreak")
		const { records, runtime } = useBridgeJournal()
		// The pending at position 3 reset the first two drops; drops 4-6 hit the threshold.
		expect(deps.claimReceiptStatus).toHaveBeenCalledTimes(6)
		expect((records.value.find((r) => r.id === "0xstreak") as DepositJournalRecord | undefined)?.claimTxHash).toBeUndefined()
		expect(runtime.value["0xstreak"]?.note).toMatch(/dropped - claim again/)
	})

	it("(f) quiet flip: a proposed receipt lands confirmLandedTxHash for exactly the sent hash", async () => {
		const deps = baseDeps(kv)
		const seq: Array<"proposed" | "success"> = ["proposed", "proposed", "success"]
		let n = 0
		deps.claimReceiptStatus.mockImplementation((async () => (n < seq.length ? seq[n++] : "success")) as never)
		const claim = vi.fn(async () => ({ simulate: async () => {}, send: async () => ({ txHash: "0xfliptx" }) }))
		connectJournalDeps({ ...deps, claim })
		const { runtime } = useBridgeJournal()
		addRecord(mkDeposit("0xflip"))
		await runDepositClaim("0xflip")
		// The send established forge-resistant provenance; the proposed polls quietly flipped the
		// hash-scoped landed marker before the success completed the record.
		expect(runtime.value["0xflip"]?.confirmLandedTxHash).toBe("0xfliptx")
		const { records } = useBridgeJournal()
		expect(records.value.find((r) => r.id === "0xflip")?.completedAt).toBe(999)
	})

	it("(f) round accounting: exactly ten 45-poll rounds, then the soft cap re-arms RETRY (no round 11)", async () => {
		const deps = baseDeps(kv)
		deps.claimReceiptStatus.mockResolvedValue("pending")
		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		const { runtime } = useBridgeJournal()
		addRecord(mkDeposit("0xrounds", { claimTxHash: "0xslow" }))
		await runDepositClaim("0xrounds")
		// Rounds 2-10 chain detached between lock releases; waitMs is a no-op so they finish fast.
		await vi.waitFor(() => {
			expect(deps.claimReceiptStatus.mock.calls.length).toBe(450)
			expect(runtime.value["0xrounds"]?.note).toMatch(/Still confirming after ~30 minutes/)
		})
		// Soft cap: no round 11 fires on its own.
		await new Promise((r) => setTimeout(r, 30))
		expect(deps.claimReceiptStatus.mock.calls.length).toBe(450)
	})

	it("(g) recipient guard fails CLOSED: absent connected account AND empty recipient both refuse", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim, connectedAztec: () => null as never })
		addRecord(mkDeposit("0xnoacct"))
		await runDepositClaim("0xnoacct")
		const { runtime } = useBridgeJournal()
		expect(runtime.value["0xnoacct"]?.attention).toBe("mismatch")
		expect(claim).not.toHaveBeenCalled()

		connectJournalDeps({ ...deps, claim, connectedAztec: () => RECIPIENT })
		addRecord(mkDeposit("0xemptyrec", { recipient: "" }))
		await runDepositClaim("0xemptyrec")
		expect(runtime.value["0xemptyrec"]?.attention).toBe("mismatch")
		expect(claim).not.toHaveBeenCalled()
	})

	it("(h) withdraw latch: the fresh consumeTxHash is journaled BEFORE the receipt wait; a failed wait clears with its copy", async () => {
		const deps = baseDeps(kv)
		const { records, runtime } = useBridgeJournal()
		let hashAtWait: string | undefined
		deps.waitConsumeReceipt.mockImplementation(async () => {
			hashAtWait = (records.value.find((r) => r.id === "0xwd") as WithdrawJournalRecord | undefined)?.consumeTxHash
			return false
		})
		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		addRecord(mkWithdraw("0xwd"))
		await runWithdrawConsume("0xwd")
		expect(hashAtWait).toBe("0xconsumetx")
		expect((records.value.find((r) => r.id === "0xwd") as WithdrawJournalRecord | undefined)?.consumeTxHash).toBeUndefined()
		expect(runtime.value["0xwd"]?.note).toMatch(/The finish transaction failed/)
	})

	it("(h) absent verifier defaults open (?? true) on a rediscovered consume; progress ?? fallbacks derive proven", async () => {
		const deps = baseDeps(kv)
		const { runtime } = useBridgeJournal()
		const noVerify = { ...deps, claim: smartClaimFake() } as Record<string, unknown>
		noVerify.verifyConsumeIdentity = undefined
		deps.consume.mockImplementation((async (_rec: unknown, onProgress: (p: Record<string, number>) => void) => {
			onProgress({ targetBlock: 10 })
			onProgress({ provenBlock: 10 })
			return { consumeTxHash: "0xc2" }
		}) as never)
		connectJournalDeps(noVerify as never)
		addRecord(mkWithdraw("0xwd2", { consumeTxHash: "0xrediscovered" }))
		await runWithdrawConsume("0xwd2")
		// ?? true: the prior hash completes without a verifier.
		const { records } = useBridgeJournal()
		expect(records.value.find((r) => r.id === "0xwd2")?.completedAt).toBe(999)

		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		addRecord(mkWithdraw("0xwd3"))
		await runWithdrawConsume("0xwd3")
		// The second progress call lacked targetBlock — the ?? fallback against runtime derives proven=true.
		expect(runtime.value["0xwd3"]?.proven).toBe(true)
	})
})
