import {
	type DepositEnvelopeV2,
	type DepositJournalRecord,
	type KV,
	type WithdrawJournalRecord,
	isSealTrusted,
	markSealTrusted,
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
	BRIDGE: { toString: () => "0xbridge" },
}))

import {
	__resetJournalForTests,
	activeFlowId,
	addRecord,
	addRecordVerified,
	cacheSecret,
	claimForeground,
	connectJournalDeps,
	discard,
	markApproveOutcome,
	hideCompleted,
	markSessionLive,
	rekeyJournalRecord,
	releaseForeground,
	resumeSessionWork,
	runDepositClaim,
	runOnLane,
	runWithdrawConsume,
	setRecordStep,
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

async function sealEnvelopeFor(rec: DepositJournalRecord, over: Partial<{ recipient: string; amount: string; sealerL1: string }> = {}) {
	const key = await recoveryKeyFromSignature(SIG)
	return sealDepositEnvelope(key, {
		secret: "0xprivatesecret",
		recipient: over.recipient ?? rec.recipient,
		amount: over.amount ?? rec.amount,
		sealerL1: over.sealerL1 ?? SEALER,
		leafIndex: rec.leafIndex,
	})
}

describe("useBridgeJournal engine", () => {
	let kv: KV

	beforeEach(() => {
		__resetJournalForTests()
		kv = memKV()
	})

	it("② rediscovered claimable deposit NEVER auto-claims - zero claim/sign calls", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xrediscovered"))
		resumeSessionWork()
		await new Promise((r) => setTimeout(r, 10))
		expect(claim).not.toHaveBeenCalled()
		expect(deps.signL1).not.toHaveBeenCalled()
	})

	it("③ sessionLive deposit auto-continues through gate → send → receipt → done", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xlive"))
		markSessionLive("0xlive")
		resumeSessionWork()
		await vi.waitFor(() => {
			const { records } = useBridgeJournal()
			expect(records.value.find((r) => r.id === "0xlive")?.completedAt).toBe(999)
		})
		expect(claim).toHaveBeenCalled()
	})

	it("④ same-id double invocation runs once; ⑭ two records' sends serialize on the aztec lane", async () => {
		const deps = baseDeps(kv)
		const order: string[] = []
		let release: () => void = () => {}
		const gate = new Promise<void>((r) => {
			release = r
		})
		const claim = vi.fn(async (rec: DepositJournalRecord) => {
			let sent = false
			return {
				simulate: async () => {
					if (sent) throw new Error("No L1 to L2 message found")
					return {}
				},
				send: async () => {
					order.push(`start:${rec.id}`)
					if (rec.id === "0xa") await gate
					sent = true
					order.push(`end:${rec.id}`)
					return { txHash: `0xtx-${rec.id}` }
				},
			}
		})
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xa"))
		addRecord(mkDeposit("0xb"))

		const first = runDepositClaim("0xa")
		const dup = runDepositClaim("0xa")
		const second = runDepositClaim("0xb")
		await new Promise((r) => setTimeout(r, 20))
		// The duplicate did not build a second interaction for 0xa; 0xb's send waits on the lane.
		expect(order).toEqual(["start:0xa"])
		release()
		await Promise.all([first, dup, second])
		expect(order).toEqual(["start:0xa", "end:0xa", "start:0xb", "end:0xb"])
		expect(claim.mock.calls.filter((c) => (c[0] as DepositJournalRecord).id === "0xa").length).toBeLessThanOrEqual(2)
	})

	it("⑤ a single transient dropped read does NOT clear claimTxHash; three consecutive do", async () => {
		const deps = baseDeps(kv)
		// The claim was already consumed (simulate reverts message-gone) - the probe verifies true.
		const claim = vi.fn(async () => ({
			simulate: async () => {
				throw new Error("No L1 to L2 message found for message hash 0xdead")
			},
			send: async () => ({ txHash: "0xclaimtx" }),
		}))
		const statuses = ["dropped", "success"] as const
		let i = 0
		deps.claimReceiptStatus = vi.fn(async () => statuses[Math.min(i++, statuses.length - 1)])
		connectJournalDeps({ ...deps, claim, connectedAztec: () => RECIPIENT })
		addRecord(mkDeposit("0xdebounce", { claimTxHash: "0xclaimtx" }))
		resumeSessionWork()
		await vi.waitFor(() => {
			const { records } = useBridgeJournal()
			expect(records.value.find((r) => r.id === "0xdebounce")?.completedAt).toBe(999)
		})

		__resetJournalForTests()
		kv = memKV()
		const deps2 = baseDeps(kv)
		deps2.claimReceiptStatus = vi.fn(async () => "dropped" as const)
		connectJournalDeps({ ...deps2, claim: smartClaimFake() })
		addRecord(mkDeposit("0xdropped", { claimTxHash: "0xclaimtx", secret: undefined }))
		resumeSessionWork()
		await vi.waitFor(() => {
			const { records, runtime } = useBridgeJournal()
			expect((records.value.find((r) => r.id === "0xdropped") as DepositJournalRecord).claimTxHash).toBeUndefined()
			expect(runtime.value["0xdropped"]?.attention).toBe("error")
		})
	})

	it("sync countdown: blocks tick down WITHOUT touching the PXE; the simulate gate stays the authority after arrival", async () => {
		const deps = baseDeps(kv)
		const order: string[] = []
		const heights = [100, 101, 102, 103]
		let h = 0
		const l2BlockNumber = vi.fn(async () => {
			order.push("block")
			const v = heights[Math.min(h, heights.length - 1)] ?? 103
			h++
			return v
		})
		const claim = vi.fn(async () => ({
			simulate: async () => {
				order.push("simulate")
				return {}
			},
			send: async () => ({ txHash: "0xclaimtx" }),
		}))
		connectJournalDeps({ ...deps, claim, l2BlockNumber })
		addRecord(mkDeposit("0xcountdown", { depositL2Block: 100 }))
		await runDepositClaim("0xcountdown")
		// Heights 100..102 are below target 103 (snapshot + 3): three countdown polls, ZERO simulates.
		expect(order.slice(0, 4)).toEqual(["block", "block", "block", "block"])
		expect(order.indexOf("simulate")).toBeGreaterThan(3)
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xcountdown")?.completedAt).toBe(999)
	})

	it("sync countdown: no depositL2Block snapshot ⇒ straight to the simulate gate (no block polling)", async () => {
		const deps = baseDeps(kv)
		const l2BlockNumber = vi.fn(async () => 100)
		const claim = vi.fn(async () => ({
			simulate: async () => ({}),
			send: async () => ({ txHash: "0xclaimtx" }),
		}))
		connectJournalDeps({ ...deps, claim, l2BlockNumber })
		addRecord(mkDeposit("0xnosnap"))
		await runDepositClaim("0xnosnap")
		expect(l2BlockNumber).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xnosnap")?.completedAt).toBe(999)
	})

	it("a preGated record (same-session retry, gate already passed) narrates CLAIM from the first probe", async () => {
		const deps = baseDeps(kv)
		const sampledSteps: (string | undefined)[] = []
		const claim = vi.fn(async () => ({
			simulate: async () => {
				sampledSteps.push(useBridgeJournal().runtime.value["0xpg"]?.step)
			},
			send: async () => ({ txHash: "0xclaimtx" }),
		}))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xpg", { depositL2Block: 100 }))
		// A retry within the same session keeps the prior gate's claimable flag - stay on CLAIM.
		const { runtime } = useBridgeJournal()
		runtime.value = { ...runtime.value, "0xpg": { claimable: true } }
		await runDepositClaim("0xpg")
		expect(sampledSteps[0]).toBe("sending") // known-claimable: optimistic CLAIM, never CROSSING.
	})

	it("a fresh (not preGated) claim stays on CROSSING through a not-ready probe - never flashes CLAIM then back", async () => {
		const deps = baseDeps(kv)
		const sampledSteps: (string | undefined)[] = []
		let calls = 0
		const claim = vi.fn(async () => ({
			simulate: async () => {
				sampledSteps.push(useBridgeJournal().runtime.value["0xun"]?.step)
				if (calls++ === 0) throw new Error("No L1 to L2 message found")
			},
			send: async () => ({ txHash: "0xclaimtx" }),
		}))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xun"))
		await runDepositClaim("0xun")
		// The reported bug: CLAIM ("sending") flashed first, then regressed to CROSSING on not-ready.
		// A fresh claim now narrates CROSSING from the very first probe and never moves backward.
		expect(sampledSteps[0]).toBe("syncing")
		expect(sampledSteps.includes("sending")).toBe(false)
	})

	it("a fresh PRIVATE claim (secret cached) stays on CROSSING - no UNSEALING/CLAIM flash before the gate", async () => {
		const deps = baseDeps(kv)
		// The claim is built AFTER the (private) unseal step and BEFORE the sync gate. A fresh in-session
		// deposit has its secret CACHED, so the unseal is instant - a stray UNSEALING step here is the
		// "instant green then rollback" flash (the rail maps UNSEALING → CLAIM). Sample the step there.
		const stepWhenClaimBuilt: (string | undefined)[] = []
		const sampledSteps: (string | undefined)[] = []
		const claim = vi.fn(async () => {
			stepWhenClaimBuilt.push(useBridgeJournal().runtime.value["0xfreshpriv"]?.step)
			return {
				simulate: async () => {
					sampledSteps.push(useBridgeJournal().runtime.value["0xfreshpriv"]?.step)
				},
				send: async () => ({ txHash: "0xclaimtx" }),
			}
		})
		cacheSecret("0xfreshpriv", "0xprivatesecret", {
			secret: "0xprivatesecret",
			recipient: RECIPIENT,
			amount: "100000000",
			sealerL1: SEALER,
			leafIndex: "7",
			v: 2,
		} as unknown as DepositEnvelopeV2)
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xfreshpriv", { isPrivate: true }))
		await runDepositClaim("0xfreshpriv")
		expect(stepWhenClaimBuilt).not.toContain("unsealing") // cached unseal is silent - no CLAIM flash
		expect(sampledSteps[0]).toBe("syncing") // the rail stayed on CROSSING through the gate
	})

	it("⑰ a claim THIS process sent completes on the checkpointed receipt - the lagging PXE cannot block it", async () => {
		const deps = baseDeps(kv)
		// simulate keeps succeeding (PXE lag right after checkpoint) - local provenance wins anyway.
		const claim = vi.fn(async () => ({
			simulate: async () => ({}),
			send: async () => ({ txHash: "0xclaimtx" }),
		}))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xlocal"))
		await runDepositClaim("0xlocal")
		const { records, runtime } = useBridgeJournal()
		expect(records.value.find((r) => r.id === "0xlocal")?.completedAt).toBe(999)
		expect(runtime.value["0xlocal"]?.attention).toBeUndefined()
	})

	it("⑰a a REDISCOVERED record whose message is visibly still claimable keeps polling - no completion, no dead-end", async () => {
		const deps = baseDeps(kv)
		// No provenance (claimTxHash preset), public record so the probe runs prompt-free; the PXE
		// keeps showing the message ⇒ completion is DELAYED, never dead-ended into attention.
		const claim = vi.fn(async () => ({ simulate: async () => ({}), send: async () => ({ txHash: "0x" }) }))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xlagging", { claimTxHash: "0xclaimtx" }))
		await runDepositClaim("0xlagging")
		// Rounds 2..cap run via detached re-entry; the soft cap ends with the gentle note.
		await vi.waitFor(() => {
			expect(useBridgeJournal().runtime.value["0xlagging"]?.note).toMatch(/still confirming/i)
		})
		const { records, runtime } = useBridgeJournal()
		expect(records.value.find((r) => r.id === "0xlagging")?.completedAt).toBeUndefined()
		expect(runtime.value["0xlagging"]?.attention).toBeUndefined()
	})

	it("⑰b a rediscovered private record with a checkpointed receipt completes prompt-free (owner policy: the node's word wins)", async () => {
		const deps = baseDeps(kv)
		// The sweep can't unseal (no signature prompt-free), so the probe is unverifiable (null) -
		// the checkpointed receipt completes the record anyway. Residual risk accepted: planting a
		// forged-but-checkpointed claimTxHash needs localStorage write, which already owns the journal.
		const claim = vi.fn(async () => ({ simulate: async () => ({}), send: async () => ({ txHash: "0x" }) }))
		connectJournalDeps({ ...deps, claim })
		const rec = mkDeposit("0xresumed", { isPrivate: true, secret: undefined, sealerL1: SEALER, claimTxHash: "0xclaimtx" })
		rec.sealedEnvelope = await sealEnvelopeFor(rec)
		addRecord(rec)
		resumeSessionWork()
		await vi.waitFor(() => {
			expect(useBridgeJournal().records.value.find((r) => r.id === "0xresumed")?.completedAt).toBe(999)
		})
		expect(deps.signL1).not.toHaveBeenCalled()
	})

	it("⑰c an explicit CLAIM on that record verifies with ONE signature and completes", async () => {
		const deps = baseDeps(kv)
		// The genuine case: the message is consumed, so the probe's simulate reverts message-gone.
		const claim = vi.fn(async () => ({
			simulate: async () => {
				throw new Error("No L1 to L2 message found")
			},
			send: async () => ({ txHash: "0x" }),
		}))
		connectJournalDeps({ ...deps, claim })
		const rec = mkDeposit("0xverify", { isPrivate: true, secret: undefined, sealerL1: SEALER, claimTxHash: "0xclaimtx" })
		rec.sealedEnvelope = await sealEnvelopeFor(rec)
		addRecord(rec)
		await runDepositClaim("0xverify")
		expect(deps.signL1).toHaveBeenCalledTimes(1)
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xverify")?.completedAt).toBe(999)
	})

	it("⑥ tampered plaintext recipient on a private record: no send, display resynced from the envelope", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		const rec = mkDeposit("0xtamper", { isPrivate: true, secret: undefined, recipient: "0xevil", sealerL1: SEALER })
		rec.sealedEnvelope = await sealEnvelopeFor(rec, { recipient: RECIPIENT })
		connectJournalDeps({ ...deps, claim, connectedAztec: () => "0xevil" })
		addRecord(rec)
		await runDepositClaim("0xtamper")
		const { records, runtime } = useBridgeJournal()
		expect(claim).not.toHaveBeenCalled()
		expect(runtime.value["0xtamper"]?.attention).toBe("tampered")
		expect((records.value.find((r) => r.id === "0xtamper") as DepositJournalRecord).recipient).toBe(RECIPIENT)
	})

	it("⑦ unseal failure revokes trust ONLY for the sealer account and keeps the record", async () => {
		const deps = baseDeps(kv)
		markSealTrusted(kv, DEPLOY.chainId, SEALER, "rabby")
		const rec = mkDeposit("0xfail", { isPrivate: true, secret: undefined, sealerL1: SEALER })
		rec.sealedEnvelope = await sealEnvelopeFor(rec)
		// The wallet now signs DIFFERENTLY than at seal time ⇒ wrong key ⇒ GCM failure.
		connectJournalDeps({ ...deps, claim: smartClaimFake(), signL1: vi.fn(async () => `0x${"b".repeat(130)}`) })
		addRecord(rec)
		await runDepositClaim("0xfail")
		const { records, runtime } = useBridgeJournal()
		expect(runtime.value["0xfail"]?.attention).toBe("unseal-failed")
		expect(isSealTrusted(kv, DEPLOY.chainId, SEALER, "rabby")).toBe(false)
		expect(records.value.find((r) => r.id === "0xfail")).toBeDefined()
	})

	it("⑧ wrong connected L1 account ⇒ pre-unseal mismatch, NO signature, trust intact", async () => {
		const deps = baseDeps(kv)
		markSealTrusted(kv, DEPLOY.chainId, SEALER, "rabby")
		const rec = mkDeposit("0xwrongl1", { isPrivate: true, secret: undefined, sealerL1: SEALER })
		rec.sealedEnvelope = await sealEnvelopeFor(rec)
		const signL1 = vi.fn(async () => SIG)
		connectJournalDeps({ ...deps, claim: smartClaimFake(), signL1, connectedL1: () => "0xsomeoneelse" })
		addRecord(rec)
		await runDepositClaim("0xwrongl1")
		const { runtime } = useBridgeJournal()
		expect(runtime.value["0xwrongl1"]?.attention).toBe("mismatch")
		expect(signL1).not.toHaveBeenCalled()
		expect(isSealTrusted(kv, DEPLOY.chainId, SEALER, "rabby")).toBe(true)
	})

	it("⑧b wrong connected AZTEC account ⇒ mismatch before anything runs", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim, connectedAztec: () => "0xanotheraccount" })
		addRecord(mkDeposit("0xaztecmismatch", { isPrivate: true, secret: undefined, sealedEnvelope: "blob" }))
		await runDepositClaim("0xaztecmismatch")
		const { runtime } = useBridgeJournal()
		expect(runtime.value["0xaztecmismatch"]?.attention).toBe("mismatch")
		expect(claim).not.toHaveBeenCalled()
	})

	it("⑨ same-session cached secret claims with ZERO L1 signatures; rediscovered uses exactly one", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		const rec = mkDeposit("0xsigcount", { isPrivate: true, secret: undefined, sealerL1: SEALER })
		rec.sealedEnvelope = await sealEnvelopeFor(rec)
		connectJournalDeps({ ...deps, claim })
		addRecord(rec)
		cacheSecret("0xsigcount", "0xprivatesecret", {
			v: 2,
			secret: "0xprivatesecret",
			recipient: rec.recipient,
			amount: rec.amount,
			sealerL1: SEALER,
			leafIndex: rec.leafIndex,
		})
		await runDepositClaim("0xsigcount")
		expect(deps.signL1).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xsigcount")?.completedAt).toBe(999)

		__resetJournalForTests()
		kv = memKV()
		const deps2 = baseDeps(kv)
		const rec2 = mkDeposit("0xresume", { isPrivate: true, secret: undefined, sealerL1: SEALER })
		rec2.sealedEnvelope = await sealEnvelopeFor(rec2)
		connectJournalDeps({ ...deps2, claim: smartClaimFake() })
		addRecord(rec2)
		await runDepositClaim("0xresume")
		expect(deps2.signL1).toHaveBeenCalledTimes(1)
	})

	it("⑩ rediscovered consumeTxHash waits on the receipt - consume() never re-prompts", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkWithdraw("0xexit", { consumeTxHash: "0xprior" }))
		await runWithdrawConsume("0xexit")
		expect(deps.consume).not.toHaveBeenCalled()
		expect(deps.waitConsumeReceipt).toHaveBeenCalledWith("0xprior")
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xexit")?.completedAt).toBe(999)
	})

	it("⑩b a consume tx that fails identity verification ⇒ unknown-outcome, never done", async () => {
		const deps = baseDeps(kv)
		deps.verifyConsumeIdentity = vi.fn(async () => false)
		connectJournalDeps(deps)
		addRecord(mkWithdraw("0xforged", { consumeTxHash: "0xunrelated" }))
		await runWithdrawConsume("0xforged")
		const { records, runtime } = useBridgeJournal()
		expect(runtime.value["0xforged"]?.attention).toBe("unknown-outcome")
		expect(records.value.find((r) => r.id === "0xforged")?.completedAt).toBeUndefined()
		expect(deps.waitConsumeReceipt).not.toHaveBeenCalled()
	})

	it("withdraw happy path: consume once, consumeTxHash persisted, receipt ⇒ done", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkWithdraw("0xfresh"))
		await runWithdrawConsume("0xfresh")
		expect(deps.consume).toHaveBeenCalledTimes(1)
		const rec = useBridgeJournal().records.value.find((r) => r.id === "0xfresh") as WithdrawJournalRecord
		expect(rec.consumeTxHash).toBe("0xconsumetx")
		expect(rec.completedAt).toBe(999)
	})

	it("⑮ provisional withdraw (no exitTxHash) ⇒ unknown-outcome, nothing runs", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkWithdraw("wd-pending-abc", { exitTxHash: undefined }))
		await runWithdrawConsume("wd-pending-abc")
		expect(useBridgeJournal().runtime.value["wd-pending-abc"]?.attention).toBe("unknown-outcome")
		expect(deps.consume).not.toHaveBeenCalled()
	})

	it("⑪ stale-deployment record refuses to run (distinct attention)", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xstale", { portal: "0xOLDPORTAL" }))
		await runDepositClaim("0xstale")
		expect(useBridgeJournal().runtime.value["0xstale"]?.attention).toBe("stale-deployment")
		expect(claim).not.toHaveBeenCalled()
	})

	it("write-and-verify aborts when storage drops the record", async () => {
		const blackhole: KV = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
		connectJournalDeps({ ...baseDeps(blackhole), kv: blackhole })
		expect(() => addRecordVerified(mkDeposit("0xlost"))).toThrow(/persist/i)
	})

	it("a claim on a record with NO leafIndex bails without building the interaction (mid-deposit race pin)", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xmidflight", { leafIndex: undefined }))
		await runDepositClaim("0xmidflight")
		expect(claim).not.toHaveBeenCalled()
		expect(useBridgeJournal().runtime.value["0xmidflight"]?.attention).toBeUndefined()
	})

	it("resumeSessionWork skips mid-flight sessionLive records (no-leaf deposit, provisional withdraw)", async () => {
		const deps = baseDeps(kv)
		const claim = smartClaimFake()
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xnoleaf", { leafIndex: undefined }))
		addRecord(mkWithdraw("wd-pending-live", { exitTxHash: undefined }))
		markSessionLive("0xnoleaf")
		markSessionLive("wd-pending-live")
		resumeSessionWork()
		await new Promise((r) => setTimeout(r, 10))
		expect(claim).not.toHaveBeenCalled()
		expect(deps.consume).not.toHaveBeenCalled()
		// The live provisional record is NOT tagged unknown-outcome by the sweep.
		expect(useBridgeJournal().runtime.value["wd-pending-live"]?.attention).toBeUndefined()
	})

	it("P1: the engine narrates - steps observable during the flow, cleared at exit", async () => {
		const deps = baseDeps(kv)
		const seen: (string | undefined)[] = []
		let sent = false
		let gateProbes = 0
		const claim = vi.fn(async () => ({
			simulate: async () => {
				seen.push(useBridgeJournal().runtime.value["0xnarrate"]?.step)
				// A not-ready round then a ready one: CROSSING narrates while waiting, CLAIM once consumable.
				if (gateProbes++ === 0) throw new Error("No L1 to L2 message found")
				if (sent) throw new Error("No L1 to L2 message found")
				return {}
			},
			send: async () => {
				seen.push(useBridgeJournal().runtime.value["0xnarrate"]?.step)
				sent = true
				return { txHash: "0xclaimtx" }
			},
		}))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xnarrate"))
		await runDepositClaim("0xnarrate")
		expect(seen).toContain("syncing")
		expect(seen).toContain("sending")
		const rt = useBridgeJournal().runtime.value["0xnarrate"]
		expect(rt?.step).toBeUndefined()
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xnarrate")?.completedAt).toBe(999)
	})

	it("P1: pending-forever NEVER dead-ends into unknown-outcome - soft note after the round cap", async () => {
		const deps = baseDeps(kv)
		deps.claimReceiptStatus = vi.fn(async () => "pending" as const)
		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		addRecord(mkDeposit("0xslow", { claimTxHash: "0xclaimtx" }))
		await runDepositClaim("0xslow", { interactive: false })
		await vi.waitFor(() => {
			const rt = useBridgeJournal().runtime.value["0xslow"]
			expect(rt?.note).toMatch(/still confirming/i)
		})
		const rt = useBridgeJournal().runtime.value["0xslow"]
		expect(rt?.attention).toBeUndefined()
		expect((useBridgeJournal().records.value.find((r) => r.id === "0xslow") as DepositJournalRecord).claimTxHash).toBe("0xclaimtx")
	})

	it("P1: transport failures narrate as unreachable, never pending, never an attention", async () => {
		const deps = baseDeps(kv)
		const details: (string | undefined)[] = []
		deps.claimReceiptStatus = vi.fn(async () => "unreachable" as const)
		// The unreachable narration is set right before the inter-poll wait - sample it there.
		const waitMs = async () => {
			details.push(useBridgeJournal().runtime.value["0xdeadrpc"]?.stepDetail)
		}
		connectJournalDeps({ ...deps, claim: smartClaimFake(), waitMs })
		addRecord(mkDeposit("0xdeadrpc", { claimTxHash: "0xclaimtx" }))
		await runDepositClaim("0xdeadrpc", { interactive: false })
		await vi.waitFor(() => expect(useBridgeJournal().runtime.value["0xdeadrpc"]?.note).toMatch(/still confirming/i))
		expect(details.some((d) => d?.includes("node unreachable"))).toBe(true)
		expect(useBridgeJournal().runtime.value["0xdeadrpc"]?.attention).toBeUndefined()
	})

	it("P1: discard mid-wait bumps the generation - the chain dies, nothing resurrects", async () => {
		const deps = baseDeps(kv)
		let polls = 0
		deps.claimReceiptStatus = vi.fn(async () => {
			polls++
			if (polls === 3) discard("0xkilled")
			return "pending" as const
		})
		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		addRecord(mkDeposit("0xkilled", { claimTxHash: "0xclaimtx" }))
		await runDepositClaim("0xkilled", { interactive: false })
		await new Promise((r) => setTimeout(r, 20))
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xkilled")).toBeUndefined()
		expect(useBridgeJournal().runtime.value["0xkilled"]).toBeUndefined()
		expect(polls).toBeLessThan(10)
	})

	it("completed cards STAY visible (no auto-hide) - hideCompleted is the receipt path's explicit act", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		addRecord(mkDeposit("0xhide"))
		await runDepositClaim("0xhide")
		const { records: recs } = useBridgeJournal()
		expect(recs.value.find((r) => r.id === "0xhide")?.completedAt).toBe(999)
		// The card remains until the user (or the receipt flow) says otherwise.
		expect(useBridgeJournal().runtime.value["0xhide"]?.hidden).toBeUndefined()
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xhide")).toBe(true)
		expect(useBridgeJournal().lastCompleted.value?.id).toBe("0xhide")
		hideCompleted("0xhide")
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xhide")).toBe(false)
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xhide")?.completedAt).toBe(999)
	})

	it("hideCompleted refuses non-completed records (a live card can never be hidden)", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkDeposit("0xlive"))
		hideCompleted("0xlive")
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xlive")).toBe(true)
	})

	it("a REDISCOVERED completion stays visible with its ✓ card", async () => {
		const deps = baseDeps(kv)
		const claim = vi.fn(async () => ({
			simulate: async () => {
				throw new Error("No L1 to L2 message found")
			},
			send: async () => ({ txHash: "0x" }),
		}))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xredisc", { claimTxHash: "0xclaimtx" }))
		await runDepositClaim("0xredisc")
		await new Promise((r) => setTimeout(r, 20))
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xredisc")?.completedAt).toBe(999)
		expect(useBridgeJournal().runtime.value["0xredisc"]?.hidden).toBeUndefined()
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xredisc")).toBe(true)
	})

	it("code-review pin: a stale soft note never survives a successful completion", async () => {
		const deps = baseDeps(kv)
		const claim = vi.fn(async () => ({
			simulate: async () => {
				throw new Error("No L1 to L2 message found")
			},
			send: async () => ({ txHash: "0x" }),
		}))
		connectJournalDeps({ ...deps, claim })
		const rec = mkDeposit("0xstale-note", { claimTxHash: "0xclaimtx" })
		addRecord(rec)
		// Simulate the 30-min soft-cap note left by an earlier chain.
		connectJournalDeps({ ...deps, claim })
		const { runtime } = useBridgeJournal()
		runtime.value = { "0xstale-note": { note: "Still confirming after ~30 minutes - slow testnet." } }
		await runDepositClaim("0xstale-note")
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xstale-note")?.completedAt).toBe(999)
		expect(useBridgeJournal().runtime.value["0xstale-note"]?.note).toBeUndefined()
	})

	it("withdraw completions stay visible and feed the toast hook", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkWithdraw("0xwdhide"))
		await runWithdrawConsume("0xwdhide")
		expect(useBridgeJournal().records.value.find((r) => r.id === "0xwdhide")?.completedAt).toBe(999)
		expect(useBridgeJournal().runtime.value["0xwdhide"]?.hidden).toBeUndefined()
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xwdhide")).toBe(true)
		expect(useBridgeJournal().lastCompleted.value).toMatchObject({ id: "0xwdhide", direction: "withdraw", txHash: "0xconsumetx" })
	})

	it("a throwing claim SURFACES on the record (UI call sites void the promise) and clears the step", async () => {
		const deps = baseDeps(kv)
		const claim = vi.fn(async () => ({
			simulate: async () => {
				throw new Error("boom - not a sync revert")
			},
			send: async () => ({ txHash: "0x" }),
		}))
		connectJournalDeps({ ...deps, claim })
		addRecord(mkDeposit("0xboom"))
		await runDepositClaim("0xboom") // resolves - the failure lands on the record instead.
		const rt = useBridgeJournal().runtime.value["0xboom"]
		expect(rt?.attention).toBe("error")
		expect(rt?.note).toMatch(/boom.*funds are not lost/i)
		expect(rt?.step).toBeUndefined()
		expect(rt?.busy).toBe(false)
	})

	it("cross-tab pin: a REMOTE discard mid-round neither crashes nor completes the stale runner", async () => {
		const deps = baseDeps(kv)
		let polls = 0
		deps.claimReceiptStatus = vi.fn(async () => {
			polls++
			if (polls === 2) {
				// Another tab removed the record: simulate via direct storage write + storage-event reload
				// (NOT discard(), which would bump the tab-local generation).
				kv.setItem("nulo-bridge:journal:v1", JSON.stringify({ schema: 1, records: [] }))
				window.dispatchEvent(new StorageEvent("storage", { key: "nulo-bridge:journal:v1" }))
			}
			return polls < 2 ? ("pending" as const) : ("success" as const)
		})
		connectJournalDeps({ ...deps, claim: smartClaimFake() })
		const { records: recs } = useBridgeJournal()
		addRecord(mkDeposit("0xremote", { claimTxHash: "0xclaimtx" }))
		await expect(runDepositClaim("0xremote", { interactive: false })).resolves.toBeUndefined()
		await new Promise((r) => setTimeout(r, 20))
		expect(recs.value.find((r) => r.id === "0xremote")).toBeUndefined()
		expect(useBridgeJournal().lastCompleted.value).toBeNull()
	})

	it("cross-tab pin: a REMOTE completion makes the local finisher an idempotent no-op (no double toast)", async () => {
		const deps = baseDeps(kv)
		deps.claimReceiptStatus = vi.fn(async () => {
			// Another tab completed the record while we polled.
			const remote = { ...mkDeposit("0xracedone", { claimTxHash: "0xclaimtx" }), completedAt: 12345 }
			kv.setItem("nulo-bridge:journal:v1", JSON.stringify({ schema: 1, records: [remote] }))
			window.dispatchEvent(new StorageEvent("storage", { key: "nulo-bridge:journal:v1" }))
			return "success" as const
		})
		const claim = vi.fn(async () => ({
			simulate: async () => {
				throw new Error("No L1 to L2 message found")
			},
			send: async () => ({ txHash: "0x" }),
		}))
		connectJournalDeps({ ...deps, claim })
		useBridgeJournal() // ensure the storage listener is registered for the remote write
		addRecord(mkDeposit("0xracedone", { claimTxHash: "0xclaimtx" }))
		await runDepositClaim("0xracedone")
		const rec = useBridgeJournal().records.value.find((r) => r.id === "0xracedone")
		expect(rec?.completedAt).toBe(12345) // The remote completion stands; ours never overwrote it.
		expect(useBridgeJournal().lastCompleted.value).toBeNull() // No local toast for a remote win.
	})

	it("S13: foreground CAS - claim suppresses the card; stale release no-ops; takeover works", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkDeposit("0xfg"))
		addRecord(mkDeposit("0xother"))
		claimForeground("0xfg")
		expect(useBridgeJournal().visibleRecords.value.map((r) => r.id)).toEqual(["0xother"])
		// A stale owner (already superseded) cannot release the new one.
		claimForeground("0xother")
		releaseForeground("0xfg")
		expect(activeFlowId.value).toBe("0xother")
		releaseForeground("0xother")
		expect(activeFlowId.value).toBeNull()
		expect(useBridgeJournal().visibleRecords.value).toHaveLength(2)
	})

	it("S13: a reload-equivalent reset clears foreground (structural fail-open)", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkDeposit("0xfo"))
		claimForeground("0xfo")
		__resetJournalForTests()
		expect(activeFlowId.value).toBeNull()
	})

	it("S13: the provisional→exit rekey transfers foreground ownership", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkWithdraw("wd-pending-z", { exitTxHash: undefined }))
		claimForeground("wd-pending-z")
		rekeyJournalRecord("wd-pending-z", mkWithdraw("0xexitZ"))
		expect(activeFlowId.value).toBe("0xexitZ")
		expect(useBridgeJournal().visibleRecords.value.some((r) => r.id === "0xexitZ")).toBe(false)
	})

	it("S3/S15: setRecordStep + markApproveOutcome land in the per-record runtime", async () => {
		const deps = baseDeps(kv)
		connectJournalDeps(deps)
		addRecord(mkDeposit("0xnarr"))
		setRecordStep("0xnarr", "approving", "confirm the allowance")
		markApproveOutcome("0xnarr", "skipped")
		const rt = useBridgeJournal().runtime.value["0xnarr"]
		expect(rt?.step).toBe("approving")
		expect(rt?.approveOutcome).toBe("skipped")
	})

	it("runOnLane serializes one lane and leaves the other free", async () => {
		const order: string[] = []
		let releaseA: () => void = () => {}
		const gateA = new Promise<void>((r) => {
			releaseA = r
		})
		const a = runOnLane("l1", async () => {
			order.push("a-start")
			await gateA
			order.push("a-end")
		})
		const b = runOnLane("l1", async () => {
			order.push("b-start")
		})
		const c = runOnLane("aztec", async () => {
			order.push("c-start")
		})
		await c
		expect(order).toContain("c-start")
		expect(order).not.toContain("b-start")
		releaseA()
		await Promise.all([a, b])
		expect(order).toEqual(["a-start", "c-start", "a-end", "b-start"])
	})
})
