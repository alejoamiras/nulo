import type { DepositJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import { type ResumeContext, type ResumeHashers, resumeEligibleShape, resumeVariantOf, validateResume } from "./resume-validator"

/** Fake hashers (hex-preserving): secretHash(secret) = secret + "beef"; derive = salt + claimer-tail. */
const hashers: ResumeHashers = {
	computeSecretHashHex: async (secret) => `${secret}beef`,
	privateFuelSecretHashHex: async (salt, claimer) => `${salt}${claimer.slice(-4)}beef`,
}

const RECIPIENT = `0x${"ab".repeat(32)}`
const DEPLOY = { chainId: 11155111, portal: "0xPortal", bridge: "0xBridge" }
const ALL_VARIANTS = new Set(["direct-fuel-public", "direct-fuel-private", "plain-token", "fueled-public"] as const)

function ctx(over: Partial<ResumeContext> = {}): ResumeContext {
	return { connectedAztec: RECIPIENT, deployment: DEPLOY, enabledVariants: ALL_VARIANTS as ResumeContext["enabledVariants"], ...over }
}

/** A resumable PUBLIC direct-fuel record: id == secretHash == hash(fuel.secret). */
function fuelRecord(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	const secret = `0x${"11".repeat(20)}`
	const id = `${secret}beef`
	return {
		schema: 2,
		id,
		direction: "deposit",
		isPrivate: false,
		assetKind: "fee-juice",
		amount: "60000000000000000000",
		createdAt: 1,
		updatedAt: 1,
		chainId: DEPLOY.chainId,
		portal: DEPLOY.portal,
		bridge: DEPLOY.bridge,
		recipient: RECIPIENT,
		secretHashHex: id,
		secret,
		fuel: { amount: "60000000000000000000", secret, secretHashHex: id, minOutput: "0" },
		failedLeg: "approving",
		failedOutcome: "no-funds-moved",
		failedAt: 5,
		...over,
	}
}

describe("validateResume — eligibility matrix", () => {
	it("the golden record resumes (public direct fuel)", async () => {
		expect(await validateResume(fuelRecord(), ctx(), hashers)).toEqual({ ok: true, variant: "direct-fuel-public" })
	})

	it("a recorded depositTxHash routes to recovery, never resume", async () => {
		const v = await validateResume(fuelRecord({ depositTxHash: "0xd" }), ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "none" })
	})

	it("an existing resumeAttemptAt is permanent review-only (one attempt per record, L15)", async () => {
		const v = await validateResume(fuelRecord({ resumeAttemptAt: 42 }), ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "review-only" })
	})

	it("unknown-outcome is review-only — never resumable, never redo", async () => {
		const v = await validateResume(fuelRecord({ failedLeg: "depositing", failedOutcome: "unknown-outcome" }), ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "review-only" })
	})

	it("legacy records (no persisted failure facts) get NO affordance", async () => {
		const v = await validateResume(fuelRecord({ failedLeg: undefined, failedOutcome: undefined }), ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "none" })
	})

	it("fueled-private is redo-only (seal gap, L10)", async () => {
		const rec = fuelRecord({ assetKind: undefined, isPrivate: true, sealedEnvelope: "blob" })
		const v = await validateResume(rec, ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "redo" })
		expect(resumeVariantOf(rec)).toBe("fueled-private")
	})

	it("a disabled variant is redo (proven-safe death, runner not landed)", async () => {
		const v = await validateResume(fuelRecord(), ctx({ enabledVariants: new Set() }), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "redo" })
	})
})

describe("validateResume — hostile-field fuzz (every tampered field must reject)", () => {
	const cases: Array<[string, Partial<DepositJournalRecord>, "none" | "redo"]> = [
		["tampered amount (not an int)", { amount: "60e18" }, "none"],
		["tampered amount (negative)", { amount: "-5" }, "none"],
		["tampered amount (absurd)", { amount: (2n ** 200n).toString() }, "none"],
		["tampered recipient (shape)", { recipient: "0xdeadbeef" }, "none"],
		["tampered recipient (valid shape, wrong account)", { recipient: `0x${"cd".repeat(32)}` }, "none"],
		[
			"tampered secret (recompute misses the id)",
			{ secret: "0xffff", fuel: { amount: "1", secret: "0xffff", secretHashHex: "x", minOutput: "0" } },
			"none",
		],
		["tampered id/secretHash split", { secretHashHex: "0x9999" }, "none"],
		["tampered chainId", { chainId: 1 }, "redo"],
		["tampered portal", { portal: "0xEvilPortal" }, "redo"],
		["tampered bridge", { bridge: "0xEvilBridge" }, "redo"],
	]
	for (const [name, over, affordance] of cases) {
		it(name, async () => {
			const v = await validateResume(fuelRecord(over), ctx(), hashers)
			expect(v).toMatchObject({ ok: false, affordance })
		})
	}

	it("disconnected wallet rejects (intent guard needs the connected account)", async () => {
		const v = await validateResume(fuelRecord(), ctx({ connectedAztec: null }), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "none" })
	})
})

describe("validateResume — private records", () => {
	function privateFuelRecord(): DepositJournalRecord {
		const salt = `0x${"22".repeat(20)}`
		const id = `${salt}${RECIPIENT.slice(-4)}beef`
		return fuelRecord({
			isPrivate: true,
			id,
			secretHashHex: id,
			secret: undefined,
			sealedEnvelope: "blob",
			fuel: { amount: "1", secret: "0xunused", secretHashHex: id, minOutput: "0", bridgeSecretSalt: salt },
		})
	}

	it("private direct fuel resumes when the salt derives the record id", async () => {
		expect(await validateResume(privateFuelRecord(), ctx(), hashers)).toEqual({ ok: true, variant: "direct-fuel-private" })
	})

	it("a missing sealed envelope is redo-only (re-sealing would authenticate tamper, L17)", async () => {
		const rec = privateFuelRecord()
		rec.sealedEnvelope = undefined
		const v = await validateResume(rec, ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "redo" })
	})

	it("a tampered salt fails the derive→hash binding", async () => {
		const rec = privateFuelRecord()
		if (rec.fuel) rec.fuel.bridgeSecretSalt = `0x${"33".repeat(20)}`
		const v = await validateResume(rec, ctx(), hashers)
		expect(v).toMatchObject({ ok: false, affordance: "none" })
	})
})

describe("validateResume — plain token", () => {
	it("resumes on the top-level secret binding", async () => {
		const secret = `0x${"44".repeat(20)}`
		const id = `${secret}beef`
		const rec = fuelRecord({ assetKind: undefined, fuel: undefined, secret, id, secretHashHex: id })
		expect(await validateResume(rec, ctx(), hashers)).toEqual({ ok: true, variant: "plain-token" })
	})
})

describe("resumeEligibleShape — the sync button-visibility predicate", () => {
	it("true for a pre-deposit, proven-safe, not-yet-attempted record", () => {
		expect(resumeEligibleShape(fuelRecord())).toBe(true)
	})
	it("false once attempted / has a hash / unknown-outcome / completed / legacy", () => {
		expect(resumeEligibleShape(fuelRecord({ resumeAttemptAt: 1 }))).toBe(false)
		expect(resumeEligibleShape(fuelRecord({ depositTxHash: "0xd" }))).toBe(false)
		expect(resumeEligibleShape(fuelRecord({ leafIndex: "7" }))).toBe(false)
		expect(resumeEligibleShape(fuelRecord({ completedAt: 9 }))).toBe(false)
		expect(resumeEligibleShape(fuelRecord({ failedOutcome: "unknown-outcome" }))).toBe(false)
		expect(resumeEligibleShape(fuelRecord({ failedLeg: undefined, failedOutcome: undefined }))).toBe(false)
	})
})
