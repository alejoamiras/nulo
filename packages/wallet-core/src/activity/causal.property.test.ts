/**
 * Property tests for the durable causal reducer.
 *
 * These run BEFORE the protocol is wired into anything: the failure modes here
 * (a resurrected record, a snapshot clobbering a newer event, a retired
 * incarnation painting over a live one) are exactly the kind that survive
 * example-based tests and only surface under an unlucky interleaving.
 *
 * Each property states an invariant that must hold for EVERY ordering, so the
 * generator is free to deliver events in any sequence.
 */

import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { applyMutation, applySnapshot, compareCounter, emptySourceState, liveRecords, resetScope } from "./causal"
import type { ActivityIncarnation, ActivityMutation, ActivityRevision, ActivitySnapshot, SourceState } from "./model"
import { type ActivityScope, activityScopeKey } from "./scope"

const RUNS = 1000

const SCOPE: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xabc" }
const OTHER_SCOPE: ActivityScope = { ...SCOPE, profileId: "p2" }

const inc = (generation: number, nonce = `nonce-${generation}`): ActivityIncarnation => ({ generation: String(generation), nonce })
const GEN1 = inc(1)
const rev = (seq: number, incarnation: ActivityIncarnation = GEN1): ActivityRevision => ({ incarnation, seq: String(seq) })

type Payload = { v: number }

const upsert = (recordId: string, seq: number, v = seq, incarnation = GEN1): ActivityMutation<Payload> => ({
	source: "transaction",
	scope: SCOPE,
	recordId,
	revision: rev(seq, incarnation),
	kind: "upsert",
	record: { v },
})

const remove = (recordId: string, seq: number, incarnation = GEN1): ActivityMutation<Payload> => ({
	source: "transaction",
	scope: SCOPE,
	recordId,
	revision: rev(seq, incarnation),
	kind: "remove",
})

/** A slice that already knows its incarnation (the steady state after a first snapshot). */
function established(incarnation: ActivityIncarnation = GEN1): SourceState<Payload> {
	const empty = emptySourceState<Payload>()
	const { state } = applySnapshot(empty, {
		source: "transaction",
		scope: SCOPE,
		incarnation,
		watermark: "0",
		records: [],
		tombstones: [],
	})
	return state
}

function applyAll(state: SourceState<Payload>, mutations: ActivityMutation<Payload>[]): SourceState<Payload> {
	let current = state
	for (const mutation of mutations) current = applyMutation(current, mutation).state
	return current
}

/** What the state should look like: the highest-sequence mutation per record wins. */
function referenceRecords(mutations: ActivityMutation<Payload>[]): Map<string, Payload> {
	const winner = new Map<string, ActivityMutation<Payload>>()
	for (const mutation of mutations) {
		const held = winner.get(mutation.recordId)
		if (!held || compareCounter(mutation.revision.seq, held.revision.seq) > 0) winner.set(mutation.recordId, mutation)
	}
	const out = new Map<string, Payload>()
	for (const [recordId, mutation] of winner) {
		if (mutation.kind === "upsert" && mutation.record) out.set(recordId, mutation.record)
	}
	return out
}

/** Mutations over a small id space with unique sequences, so "newest" is unambiguous. */
const mutationsArb = fc
	.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 12 })
	.chain((seqs) =>
		fc.tuple(
			...seqs.map((seq) =>
				fc.record({
					recordId: fc.constantFrom("r1", "r2", "r3"),
					seq: fc.constant(seq),
					kind: fc.constantFrom<"upsert" | "remove">("upsert", "remove"),
				}),
			),
		),
	)
	.map((specs) => specs.map((s) => (s.kind === "upsert" ? upsert(s.recordId, s.seq) : remove(s.recordId, s.seq))))

describe("causal reducer — properties", () => {
	test("P1: convergence — any delivery order yields the highest-sequence winner per record", () => {
		fc.assert(
			fc.property(mutationsArb, (mutations) => {
				const inOrder = applyAll(established(), mutations)
				const shuffled = applyAll(established(), [...mutations].reverse())

				const expected = referenceRecords(mutations)
				for (const state of [inOrder, shuffled]) {
					expect(new Set(state.records.keys())).toEqual(new Set(expected.keys()))
					for (const [recordId, payload] of expected) {
						expect(state.records.get(recordId)?.payload).toEqual(payload)
					}
				}
			}),
			{ numRuns: RUNS },
		)
	})

	test("P2: no resurrection — nothing at or below a deletion can bring a record back", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 50 }),
				fc.array(fc.integer({ min: 1, max: 50 }), { maxLength: 8 }),
				(deleteSeq, revivals) => {
					let state = applyMutation(established(), remove("r1", deleteSeq)).state
					for (const seq of revivals) {
						state = applyMutation(state, upsert("r1", seq)).state
					}
					// Only a strictly newer revision may reinstate it.
					const shouldLive = revivals.some((seq) => seq > deleteSeq)
					expect(state.records.has("r1")).toBe(shouldLive)
				},
			),
			{ numRuns: RUNS },
		)
	})

	test("P3: a snapshot never clobbers an event newer than its watermark", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 }), (watermark, eventSeq) => {
				const state = applyMutation(established(), upsert("r1", eventSeq, 999)).state
				const snapshot: ActivitySnapshot<Payload> = {
					source: "transaction",
					scope: SCOPE,
					incarnation: GEN1,
					watermark: String(watermark),
					records: [{ recordId: "r1", revision: rev(Math.min(watermark, eventSeq)), record: { v: 1 } }],
					tombstones: [],
				}
				const { state: merged } = applySnapshot(state, snapshot)

				if (eventSeq > watermark) {
					// The event is newer than anything the snapshot could have seen.
					expect(merged.records.get("r1")?.payload).toEqual({ v: 999 })
				}
			}),
			{ numRuns: RUNS },
		)
	})

	test("P3b: a delete newer than the watermark survives the snapshot that omits it", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 20 }), (watermark) => {
				const deleteSeq = watermark + 5
				const state = applyMutation(established(), remove("r1", deleteSeq)).state
				const { state: merged } = applySnapshot(state, {
					source: "transaction",
					scope: SCOPE,
					incarnation: GEN1,
					watermark: String(watermark),
					records: [{ recordId: "r1", revision: rev(watermark), record: { v: 1 } }],
					tombstones: [],
				})
				// The snapshot predates the deletion, so it must not revive the row.
				expect(merged.records.has("r1")).toBe(false)
			}),
			{ numRuns: RUNS },
		)
	})

	test("P4: snapshot absence is authoritative at or below the watermark", () => {
		fc.assert(
			fc.property(fc.integer({ min: 2, max: 30 }), (watermark) => {
				const below = watermark - 1
				const state = applyMutation(established(), upsert("gone", below)).state
				const { state: merged } = applySnapshot(state, {
					source: "transaction",
					scope: SCOPE,
					incarnation: GEN1,
					watermark: String(watermark),
					records: [],
					tombstones: [],
				})
				expect(merged.records.has("gone")).toBe(false)
			}),
			{ numRuns: RUNS },
		)
	})

	test("P5: snapshot application is idempotent", () => {
		fc.assert(
			fc.property(fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 6 }), (seqs) => {
				const snapshot: ActivitySnapshot<Payload> = {
					source: "transaction",
					scope: SCOPE,
					incarnation: GEN1,
					watermark: String(Math.max(...seqs)),
					records: seqs.map((seq, i) => ({ recordId: `r${i}`, revision: rev(seq), record: { v: seq } })),
					tombstones: [],
				}
				const once = applySnapshot(established(), snapshot).state
				const twice = applySnapshot(once, snapshot).state
				expect(liveRecords(twice)).toEqual(liveRecords(once))
				expect(twice.snapshotCoverage).toBe(once.snapshotCoverage)
			}),
			{ numRuns: RUNS },
		)
	})

	test("P6: a retired incarnation can never write into a newer one", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), (oldSeq, newGen) => {
				const older = inc(1)
				const newer = inc(1 + newGen)
				const state = resetScope(established(older), newer)

				const { state: after, decision } = applyMutation(state, upsert("r1", oldSeq, 1, older))

				expect(decision).toBe("stale-incarnation")
				expect(after.records.has("r1")).toBe(false)
			}),
			{ numRuns: RUNS },
		)
	})

	test("P7: a cold slice holds events until an incarnation is established, then drops retired ones", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 30 }), (seq) => {
				const retired = inc(1)
				const live = inc(2)

				// Event from the retired incarnation arrives while the slice is cold.
				const cold = emptySourceState<Payload>()
				const { state: held, decision } = applyMutation(cold, upsert("ghost", seq, 1, retired))
				expect(decision).toBe("buffered")
				expect(held.records.size).toBe(0)

				// The authoritative snapshot establishes the LIVE incarnation.
				const { state: settled } = applySnapshot(held, {
					source: "transaction",
					scope: SCOPE,
					incarnation: live,
					watermark: "0",
					records: [],
					tombstones: [],
				})

				// The buffered ghost belonged to the retired incarnation — it must not render.
				expect(settled.records.has("ghost")).toBe(false)
				expect(settled.buffered).toHaveLength(0)
			}),
			{ numRuns: RUNS },
		)
	})

	test("P8: a buffered event for the established incarnation is replayed, not lost", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 30 }), (seq) => {
				const live = inc(7)
				const cold = emptySourceState<Payload>()
				const { state: held } = applyMutation(cold, upsert("kept", seq, seq, live))

				const { state: settled } = applySnapshot(held, {
					source: "transaction",
					scope: SCOPE,
					incarnation: live,
					watermark: "0",
					records: [],
					tombstones: [],
				})

				expect(settled.records.get("kept")?.payload).toEqual({ v: seq })
			}),
			{ numRuns: RUNS },
		)
	})

	test("P9: a stale snapshot is refused outright", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 20 }), (gen) => {
				const live = inc(gen + 1)
				const state = established(live)
				const { accepted } = applySnapshot(state, {
					source: "transaction",
					scope: SCOPE,
					incarnation: inc(gen),
					watermark: "99",
					records: [{ recordId: "ghost", revision: rev(99, inc(gen)), record: { v: 1 } }],
					tombstones: [],
				})
				expect(accepted).toBe(false)
			}),
			{ numRuns: RUNS },
		)
	})

	test("P10: a reused generation with a different nonce is not the same incarnation", () => {
		const original = inc(5, "nonce-a")
		const impostor = inc(5, "nonce-b")
		const state = established(original)

		const { accepted } = applySnapshot(state, {
			source: "transaction",
			scope: SCOPE,
			incarnation: impostor,
			watermark: "10",
			records: [{ recordId: "x", revision: rev(10, impostor), record: { v: 1 } }],
			tombstones: [],
		})

		expect(accepted).toBe(false)
	})

	test("P10: restart is transparent — rehydrating serialized state reproduces every decision", () => {
		fc.assert(
			fc.property(mutationsArb, (mutations) => {
				const straight = applyAll(established(), mutations)

				// Same trace, but the state is serialized and rebuilt midway.
				const split = Math.floor(mutations.length / 2)
				const before = applyAll(established(), mutations.slice(0, split))
				const rehydrated: SourceState<Payload> = {
					incarnation: before.incarnation,
					records: new Map(JSON.parse(JSON.stringify([...before.records]))),
					tombstones: new Map(JSON.parse(JSON.stringify([...before.tombstones]))),
					snapshotCoverage: before.snapshotCoverage,
					maxEventSeen: before.maxEventSeen,
					buffered: [],
				}
				const after = applyAll(rehydrated, mutations.slice(split))

				expect(liveRecords(after).sort((a, b) => a.v - b.v)).toEqual(liveRecords(straight).sort((a, b) => a.v - b.v))
			}),
			{ numRuns: RUNS },
		)
	})

	test("P11: the reducer only ever touches the state it was handed", () => {
		fc.assert(
			fc.property(mutationsArb, (mutations) => {
				const foreign = established()
				const foreignBefore = JSON.stringify([...foreign.records])

				applyAll(established(), mutations)

				expect(JSON.stringify([...foreign.records])).toBe(foreignBefore)
			}),
			{ numRuns: RUNS },
		)
	})
})

describe("activity scope keys", () => {
	/** Identifiers are non-blank: a blank one is rejected outright, covered separately. */
	const identifierArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0)

	test("the same scope always encodes to the same key", () => {
		fc.assert(
			fc.property(identifierArb, identifierArb, (profileId, networkId) => {
				const a = activityScopeKey({ ...SCOPE, profileId, networkId })
				const b = activityScopeKey({ ...SCOPE, profileId, networkId })
				expect(a).toBe(b)
			}),
			{ numRuns: RUNS },
		)
	})

	test("distinct profiles never share a key, whatever the identifiers contain", () => {
		fc.assert(
			fc.property(identifierArb, identifierArb, (left, right) => {
				fc.pre(left !== right)
				expect(activityScopeKey({ ...SCOPE, profileId: left })).not.toBe(activityScopeKey({ ...SCOPE, profileId: right }))
			}),
			{ numRuns: RUNS },
		)
	})

	test("a blank identifier is refused rather than silently keyed", () => {
		expect(() => activityScopeKey({ ...SCOPE, profileId: "   " })).toThrow(/empty profileId/)
		expect(() => activityScopeKey({ ...SCOPE, accountAddress: "" })).toThrow(/empty accountAddress/)
		expect(() => activityScopeKey({ ...SCOPE, chainId: -1 })).toThrow(/chainId/)
	})

	test("a separator inside an identifier cannot forge another scope's key", () => {
		const sneaky = activityScopeKey({ ...SCOPE, profileId: `p1", "n1` })
		expect(sneaky).not.toBe(activityScopeKey(SCOPE))
	})

	test("scopes differing only by profile are different keys", () => {
		expect(activityScopeKey(SCOPE)).not.toBe(activityScopeKey(OTHER_SCOPE))
	})

	test("address casing does not fork a scope", () => {
		expect(activityScopeKey({ ...SCOPE, accountAddress: "0xABC" })).toBe(activityScopeKey({ ...SCOPE, accountAddress: "0xabc" }))
	})
})
