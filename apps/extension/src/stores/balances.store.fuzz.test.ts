/**
 * Randomized interleaving explorer for the balances store (fast-check).
 *
 * The example-based suite pins the interleavings we THOUGHT of; every review
 * round of this store found one nobody wrote down. This test drives the real
 * store with a random operation tape — subscribes/releases with random caps,
 * ensures, tx-settle forced refreshes, profile fences, and crucially a random
 * SETTLEMENT ORDER for every in-flight RPC — and checks machine-wide
 * invariants after every step instead of example outcomes:
 *
 *  A. PROVENANCE: gating-grade `gas.verified` data (and retained `fpc.data`)
 *     always comes from an RPC issued for the entry's own account AND after
 *     the owning profile's most recent fence — a cross-epoch commit is an
 *     instant fail. (Payloads are tagged with a call id; a side table records
 *     each call's account + fence count at issue time.)
 *  B. COHERENCE: `degraded` ⇒ no verified data; `ready` ⇒ verified present.
 *  C. QUIESCENCE: once every RPC has settled and timers are drained, no slice
 *     is stuck `fetching`, no retry debt survives a successful drain, and a
 *     further 70s of virtual time produces ZERO new client calls — orphaned
 *     backoff timers and stranded forced counters both fail here.
 *
 * Failures print fast-check's seed + shrunk counterexample tape; replay by
 * passing `{ seed, path }` to fc.assert. Deepen locally with
 * NULO_FUZZ_RUNS=2000.
 */
import { createHash } from "node:crypto"
import { appendFileSync } from "node:fs"
import fc from "fast-check"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getGasBalances: vi.fn(),
	peekGasBalances: vi.fn(),
	getFpcs: vi.fn(),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			getGasBalances: mocks.getGasBalances,
			peekGasBalances: mocks.peekGasBalances,
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getFpcs: mocks.getFpcs }
	}),
}))
const txAdd = vi.hoisted(() => vi.fn())
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTransactionUpdated: { add: txAdd, remove: vi.fn() },
			onTransactionAdded: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({ profile: undefined })
	return { useAppStore: () => fake }
})

import { TxStatus } from "@/wallet/services/transaction/spec"
import { type BalanceScope, type SubscribeCaps, useBalancesStore } from "./balances.store"

// Account addresses AND chainIds are PROFILE-UNIQUE so the mock (which only
// sees RPC args, never the profile) can attribute every call — gas/peek by
// account, fpc by chainId — to its owning profile.
const SCOPES: BalanceScope[] = [
	{ profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xa1" },
	{ profileId: "p1", networkId: "n1", chainId: 111, accountAddress: "0xa2" },
	{ profileId: "p2", networkId: "n1", chainId: 222, accountAddress: "0xb1" },
	{ profileId: "p2", networkId: "n1", chainId: 222, accountAddress: "0xb2" },
]
const PROFILE_OF_ACCOUNT = new Map(SCOPES.map((s) => [s.accountAddress, s.profileId]))
const PROFILE_OF_CHAIN = new Map(SCOPES.map((s) => [s.chainId, s.profileId]))

interface PendingCall {
	id: number
	kind: "gas" | "fpc" | "peek"
	account?: string
	settle: (ok: boolean, stale?: boolean) => void
}
interface CallMeta {
	kind: "gas" | "fpc" | "peek"
	account?: string
	profile: string
	fencesAtCall: number
}

const TIMER_STEPS = [0, 50, 5_000, 20_000]

// ── Replay + equivalence tooling (inert unless the env is set) ──────────────
/** fast-check seed from `NULO_FUZZ_SEED`, parsed only when defined. Blank, non-finite,
 *  non-integer or outside int32 throws — a silent fallback to a random seed would defeat the
 *  replay the variable exists for. `0` is a valid seed. */
function fuzzSeed(): number | undefined {
	const raw = process.env.NULO_FUZZ_SEED
	if (raw === undefined) return undefined
	const seed = raw.trim() === "" ? Number.NaN : Number(raw)
	if (!Number.isInteger(seed) || seed < -2_147_483_648 || seed > 2_147_483_647) {
		throw new Error(`NULO_FUZZ_SEED must be an int32, got ${JSON.stringify(raw)}`)
	}
	return seed
}

/** Per-run trace for the pre/post refactor equivalence proof. With `NULO_FUZZ_TRACE=<file>`
 *  every completed run appends `{ tape, digest }`, the digest hashing the canonical event
 *  stream (decoded ops, RPC issue + settlement order, post-flush store snapshots, pending ids,
 *  counters, fences, checkpoints). Every method is synchronous and the unset form is a no-op
 *  (the event payloads are still built), so the property's timing is untouched either way. */
interface TraceRecorder {
	event(kind: string, data: unknown): void
	finish(tape: number[]): void
}
const NO_TRACE: TraceRecorder = { event() {}, finish() {} }
function createTraceRecorder(): TraceRecorder {
	const file = process.env.NULO_FUZZ_TRACE
	if (!file) return NO_TRACE
	const hash = createHash("sha256")
	return {
		event(kind, data) {
			hash.update(`${kind}:${JSON.stringify(data)}\n`)
		},
		finish(tape) {
			const tapeId = createHash("sha256").update(tape.join(",")).digest("hex").slice(0, 16)
			appendFileSync(file, `${JSON.stringify({ tape: tapeId, digest: hash.digest("hex") })}\n`)
		},
	}
}

/** Canonical, key-sorted projection of `store.entries` for the trace. */
function snapshotEntries(store: ReturnType<typeof useBalancesStore>): unknown {
	return Object.entries(store.entries)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([key, e]) => [
			key,
			{
				stale: e.stale,
				gas: {
					status: e.gas.status,
					debt: e.gas.retryDebt,
					verified: e.gas.verified?.publicFeeJuice ?? null,
					display: e.gas.display?.publicFeeJuice ?? null,
				},
				fpc: { status: e.fpc.status, ids: (e.fpc.data ?? []).map((f) => f.id) },
			},
		])
}

// ── The per-run world ────────────────────────────────────────────────────────
type Store = ReturnType<typeof useBalancesStore>
type Entry = Store["entries"][string]
type TxHandler = (tx: unknown) => void
interface ModelSub {
	scope: BalanceScope
	caps: SubscribeCaps
	release: () => void
	released: boolean
}

/** Everything one tape run touches. Mutable scalars are read and written as `world.<field>` —
 *  the RPC mocks close over this object and their executors must see the same counters. */
interface FuzzWorld {
	trace: TraceRecorder
	pending: PendingCall[]
	callMeta: Map<number, CallMeta>
	fences: Record<string, number>
	nextCallId: number
	totalCalls: number
	store: Store
	subs: ModelSub[]
	txHandler: TxHandler | undefined
	/** Keys whose ensure resolved DEGRADED while a retry-capable covering subscriber was live —
	 *  the store armed (or re-armed) a backoff loop, so a clean drain must recover them. Dropped
	 *  when the key's retry capability dies (loop dies with it) or a fence clears the entry. */
	expectGasRecovery: Set<string>
}

const scopeKey = (s: BalanceScope) => JSON.stringify([s.profileId, s.networkId, s.chainId, s.accountAddress])
const flush = () => vi.advanceTimersByTimeAsync(0)

const retryCoves = (world: FuzzWorld, s: BalanceScope, leg: "gas" | "fpc") =>
	world.subs.some((x) => !x.released && x.caps.retry && x.caps.legs.includes(leg) && scopeKey(x.scope) === scopeKey(s))
const liveSubs = (world: FuzzWorld) => world.subs.filter((s) => !s.released)
const lastOfProfile = (world: FuzzWorld, profileId: string, releasing: ModelSub) =>
	liveSubs(world).filter((s) => s.scope.profileId === profileId).length === 1 && releasing.scope.profileId === profileId

/** Fresh Pinia, fresh counters, the three RPC mocks installed, THEN the store — the same order
 *  the inline world used (the mocks must be in place before anything can issue a call). */
function createFuzzWorld(): FuzzWorld {
	setActivePinia(createPinia())
	const world: FuzzWorld = {
		trace: createTraceRecorder(),
		pending: [],
		callMeta: new Map<number, CallMeta>(),
		fences: { p1: 0, p2: 0 },
		nextCallId: 1,
		totalCalls: 0,
		// Assigned right after the mocks are installed; the mocks never touch it.
		store: null as unknown as Store,
		subs: [],
		txHandler: undefined,
		expectGasRecovery: new Set<string>(),
	}
	installGasMock(world)
	installFpcMock(world)
	installPeekMock(world)
	world.store = useBalancesStore()
	return world
}

function installGasMock(world: FuzzWorld): void {
	mocks.getGasBalances.mockReset().mockImplementation(
		(_net: string, account: string) =>
			new Promise((resolve, reject) => {
				const id = world.nextCallId++
				world.totalCalls++
				const profile = PROFILE_OF_ACCOUNT.get(account) ?? "p1"
				world.callMeta.set(id, { kind: "gas", account, profile, fencesAtCall: world.fences[profile] ?? 0 })
				world.trace.event("issue", { id, kind: "gas", account, fencesAtCall: world.fences[profile] ?? 0 })
				world.pending.push({
					id,
					kind: "gas",
					account,
					settle: (ok) => {
						world.trace.event("settle", { id, ok })
						if (ok) resolve({ publicFeeJuice: String(id), privateFeeJuice: null })
						else reject(new Error(`gas ${id} down`))
					},
				})
			}),
	)
}

function installFpcMock(world: FuzzWorld): void {
	mocks.getFpcs.mockReset().mockImplementation(
		(chainId: number) =>
			new Promise((resolve, reject) => {
				const id = world.nextCallId++
				world.totalCalls++
				const profile = PROFILE_OF_CHAIN.get(chainId) ?? "p1"
				world.callMeta.set(id, { kind: "fpc", profile, fencesAtCall: world.fences[profile] ?? 0 })
				world.trace.event("issue", { id, kind: "fpc", chainId, fencesAtCall: world.fences[profile] ?? 0 })
				world.pending.push({
					id,
					kind: "fpc",
					settle: (ok) => {
						world.trace.event("settle", { id, ok })
						if (ok) resolve([{ id: `fpc-${id}`, type: 1, name: "S" }])
						else reject(new Error(`fpc ${id} down`))
					},
				})
			}),
	)
}

function installPeekMock(world: FuzzWorld): void {
	mocks.peekGasBalances.mockReset().mockImplementation(
		(_net: string, account: string) =>
			new Promise((resolve, reject) => {
				const id = world.nextCallId++
				world.totalCalls++
				const profile = PROFILE_OF_ACCOUNT.get(account) ?? "p1"
				world.callMeta.set(id, { kind: "peek", account, profile, fencesAtCall: world.fences[profile] ?? 0 })
				world.trace.event("issue", { id, kind: "peek", account, fencesAtCall: world.fences[profile] ?? 0 })
				world.pending.push({
					id,
					kind: "peek",
					account,
					settle: (ok, stale) => {
						world.trace.event("settle", { id, ok, stale: stale ?? null })
						if (ok) {
							resolve({
								balances: { publicFeeJuice: `${id}`, privateFeeJuice: null },
								stale: stale ?? id % 2 === 0,
							})
						} else reject(new Error(`peek ${id}`))
					},
				})
			}),
	)
}

// ── The operation grammar ────────────────────────────────────────────────────
interface DecodedOp {
	op: number
	p1: number
	p2: number
}
const decodeOp = (n: number): DecodedOp => ({ op: n % 100, p1: Math.floor(n / 100) % 4, p2: Math.floor(n / 400) % 4 })

/** One tape entry. Every arm but the timer advance is SYNCHRONOUS and returns nothing, so the
 *  caller proceeds straight to its `flush()` exactly as the inline ladder did — only the timer
 *  arm hands back the promise the caller awaits. */
function applyOp(world: FuzzWorld, n: number, { op, p1, p2 }: DecodedOp): Promise<unknown> | undefined {
	if (op < 20) opSubscribe(world, n, p1, p2)
	else if (op < 35) opRelease(world, p1)
	else if (op < 60) opEnsure(world, p1, p2)
	else if (op < 70) opTxSettled(world, p1)
	else if (op < 78) opFence(world, p1)
	else if (op < 98) opSettle(world, n)
	else return vi.advanceTimersByTimeAsync(TIMER_STEPS[p1])
	return undefined
}

function opSubscribe(world: FuzzWorld, n: number, p1: number, p2: number): void {
	const caps: SubscribeCaps = {
		legs: p2 % 3 === 0 ? ["gas"] : p2 % 3 === 1 ? ["gas", "fpc"] : ["fpc"],
		retry: p2 % 2 === 0,
		txRefresh: p1 % 2 === 0,
		peek: n % 3 === 0,
	}
	const scope = SCOPES[p1]
	const handle = world.store.subscribe(scope, caps)
	world.subs.push({ scope, caps, release: handle.release, released: false })
	world.txHandler = txAdd.mock.calls.at(-1)?.[0] as TxHandler | undefined
}

function opRelease(world: FuzzWorld, p1: number): void {
	const live = liveSubs(world)
	if (live.length > 0) {
		const target = live[p1 % live.length]
		const wasLast = lastOfProfile(world, target.scope.profileId, target)
		target.released = true
		target.release()
		// Shadow the suspenders: the last release of a profile
		// fences it inside the store.
		if (wasLast) world.fences[target.scope.profileId] += 1
		// The retry loop dies with the key's last retry-capable
		// lease — recovery is no longer owed.
		if (!retryCoves(world, target.scope, "gas")) world.expectGasRecovery.delete(scopeKey(target.scope))
	}
}

function opEnsure(world: FuzzWorld, p1: number, p2: number): void {
	const scope = SCOPES[p1]
	const legs: ("gas" | "fpc")[] = p2 % 2 === 0 ? ["gas"] : ["gas", "fpc"]
	void world.store
		.ensure(scope, { legs })
		.then(() => {
			// Model hook: a GAS-degraded resolution with live retry
			// coverage means the store owes a recovery (checked at
			// the slice, not the combined flag — an fpc-only
			// degradation owes nothing for gas).
			if (legs.includes("gas") && world.store.entry(scope)?.gas.status === "degraded" && retryCoves(world, scope, "gas")) {
				world.expectGasRecovery.add(scopeKey(scope))
			}
		})
		.catch(() => {})
}

function opTxSettled(world: FuzzWorld, p1: number): void {
	if (world.txHandler) world.txHandler({ account: SCOPES[p1].accountAddress, status: TxStatus.Proven })
}

function opFence(world: FuzzWorld, p1: number): void {
	const profileId = p1 % 2 === 0 ? "p1" : "p2"
	world.store.invalidateProfile(profileId)
	world.fences[profileId] += 1
	for (const s of SCOPES) {
		if (s.profileId === profileId) world.expectGasRecovery.delete(scopeKey(s))
	}
}

function opSettle(world: FuzzWorld, n: number): void {
	if (world.pending.length > 0) {
		// Full-span pick so ANY in-flight call can settle next.
		const idx = Math.floor(n / 1600) % world.pending.length
		const call = world.pending.splice(idx, 1)[0]
		call.settle(n % 5 !== 0) // ~20% of settlements are failures
	}
}

// ── The oracle (A provenance, B coherence) ───────────────────────────────────
function assertWorldInvariants(world: FuzzWorld): void {
	for (const [key, entry] of Object.entries(world.store.entries)) {
		const [profileId, , , accountAddress] = JSON.parse(key) as [string, string, number, string]
		assertGasInvariants(world, key, entry, profileId, accountAddress)
		assertFpcInvariants(world, key, entry, profileId)
	}
}

function assertGasInvariants(world: FuzzWorld, key: string, entry: Entry, profileId: string, accountAddress: string): void {
	// B — coherence.
	if (entry.gas.status === "degraded") {
		expect(entry.gas.verified, `degraded gas slice of ${key} must not carry verified data`).toBeUndefined()
	}
	if (entry.gas.status === "ready") {
		expect(entry.gas.verified, `ready gas slice of ${key} must carry verified data`).toBeDefined()
	}
	// A — provenance of gating-grade data.
	if (entry.gas.verified?.publicFeeJuice != null) {
		const meta = world.callMeta.get(Number(entry.gas.verified.publicFeeJuice))
		expect(meta, `verified payload of ${key} must come from a tracked RPC`).toBeDefined()
		expect(meta?.kind, `verified payload of ${key} must come from a real fetch, never a peek`).toBe("gas")
		expect(meta?.account, `verified payload of ${key} fetched for the wrong account`).toBe(accountAddress)
		expect(
			meta?.fencesAtCall,
			`verified payload of ${key} was fetched BEFORE the last fence of ${profileId} — cross-epoch commit`,
		).toBe(world.fences[profileId])
	}
	// Display is SWR/peek-primed (fence-exempt by design), but it
	// must never carry another ACCOUNT's figures.
	if (entry.gas.display?.publicFeeJuice != null) {
		const meta = world.callMeta.get(Number(entry.gas.display.publicFeeJuice))
		expect(meta, `display payload of ${key} must come from a tracked RPC`).toBeDefined()
		expect(meta?.account, `display payload of ${key} leaked from another account`).toBe(accountAddress)
	}
}

function assertFpcInvariants(world: FuzzWorld, key: string, entry: Entry, profileId: string): void {
	if (entry.fpc.data?.[0]) {
		const meta = world.callMeta.get(Number(String(entry.fpc.data[0].id).replace("fpc-", "")))
		expect(meta, `fpc data of ${key} must come from a tracked RPC`).toBeDefined()
		expect(meta?.profile, `fpc data of ${key} fetched for the wrong profile`).toBe(profileId)
		expect(meta?.fencesAtCall, `fpc data of ${key} was fetched BEFORE the last fence of ${profileId} — cross-epoch commit`).toBe(
			world.fences[profileId],
		)
	}
}

// ── Drain + the post-drain probes (C) ────────────────────────────────────────
async function drainToQuiescence(world: FuzzWorld): Promise<void> {
	for (let i = 0; i < 60 && world.pending.length > 0; i++) {
		world.pending.splice(0).forEach((c) => c.settle(true))
		await flush()
	}
	for (let i = 0; i < 5; i++) {
		await vi.advanceTimersByTimeAsync(35_000)
		world.pending.splice(0).forEach((c) => c.settle(true))
		await flush()
	}
	expect(world.pending.length, "drain must reach quiescence — a call is wedged").toBe(0)
	assertWorldInvariants(world)
	world.trace.event("drain", { calls: world.totalCalls, entries: snapshotEntries(world.store) })
	for (const [key, entry] of Object.entries(world.store.entries)) {
		expect(entry.gas.status, `gas slice of ${key} stuck fetching after drain`).not.toBe("fetching")
		expect(entry.fpc.status, `fpc slice of ${key} stuck fetching after drain`).not.toBe("fetching")
	}
}

/** C1 — owed recoveries happened: every key whose ensure resolved gas-degraded under live retry
 *  coverage must have recovered through the all-success drain (debt cleared, slice ready). */
function assertOwedRecoveries(world: FuzzWorld): void {
	for (const key of world.expectGasRecovery) {
		const entry = world.store.entries[key]
		expect(entry, `recovery-owed entry ${key} vanished before recovering`).toBeDefined()
		expect(entry?.gas.retryDebt, `recovery-owed key ${key} still carries retry debt after a clean drain`).toBe(false)
		expect(entry?.gas.status, `recovery-owed key ${key} never recovered`).toBe("ready")
	}
	world.trace.event("c1", { owed: [...world.expectGasRecovery].sort() })
}

/** C2 — post-drain silence: every retry resolved successfully, so no timer may produce further
 *  calls. */
async function assertPostDrainSilence(world: FuzzWorld): Promise<void> {
	const callsAfterDrain = world.totalCalls
	await vi.advanceTimersByTimeAsync(35_000)
	await vi.advanceTimersByTimeAsync(35_000)
	expect(world.totalCalls, "client calls after a clean drain — an orphaned timer is firing").toBe(callsAfterDrain)
	world.trace.event("c2", { calls: world.totalCalls })
}

/** C3 — stranded-forced probe: with no forced run live, a stale peek must COMMIT (a stranded
 *  forced counter discards it) and a plain successful fetch afterwards must un-dim. Per-profile
 *  holder subs keep the last-release fence from firing mid-loop — releasing one probe must not
 *  delete a sibling key before its turn. */
async function assertStrandedForcedProbe(world: FuzzWorld): Promise<void> {
	const { store, pending } = world
	const holders = SCOPES.filter((s, i) => SCOPES.findIndex((x) => x.profileId === s.profileId) === i).map((s) =>
		store.subscribe(s, { legs: ["gas"], retry: false, txRefresh: false, peek: false }),
	)
	await flush()
	pending.splice(0).forEach((c) => c.settle(true))
	await flush()
	for (const scope of SCOPES) {
		if (!store.entries[scopeKey(scope)]) continue
		const probeSub = store.subscribe(scope, { legs: ["gas"], retry: false, txRefresh: false, peek: true })
		await flush()
		const peek = pending.find((c) => c.kind === "peek" && c.account === scope.accountAddress)
		peek?.settle(true, true)
		await flush()
		expect(
			store.entries[scopeKey(scope)]?.stale,
			`stale peek on ${scope.accountAddress} was discarded with no force live — stranded forced counter`,
		).toBe(true)
		const probeEnsure = store.ensure(scope, { legs: ["gas"] }).catch(() => {})
		await flush()
		pending.splice(0).forEach((c) => c.settle(true))
		await flush()
		await probeEnsure
		expect(
			store.entries[scopeKey(scope)]?.stale,
			`plain fetch on ${scope.accountAddress} failed to clear peek-stale — stranded forced counter`,
		).toBe(false)
		probeSub.release()
	}
	holders.forEach((h) => h.release())
	world.trace.event("c3", { calls: world.totalCalls, entries: snapshotEntries(store) })
}

/** C4 — every timer dies with its lease: release everything, then further virtual time must be
 *  silent. */
async function assertReleaseSilence(world: FuzzWorld): Promise<void> {
	for (const s of liveSubs(world)) {
		s.released = true
		s.release()
	}
	await flush()
	const callsAfterRelease = world.totalCalls
	await vi.advanceTimersByTimeAsync(35_000)
	await vi.advanceTimersByTimeAsync(35_000)
	expect(world.totalCalls, "client calls after releasing every lease — an orphaned timer survived release").toBe(callsAfterRelease)
	world.trace.event("c4", { calls: world.totalCalls })
}

/** C5 — a retry ARMED at release time dies with its last lease: arm a backoff deliberately (sole
 *  retry-capable sub + a failed fetch), release before the tick, and demand silence. This is the
 *  behavioral invariant — whichever internal guard provides it (release-time stop or the
 *  dead-caps check at the tick). */
async function assertArmedRetryDiesWithLease(world: FuzzWorld): Promise<void> {
	const { store, pending } = world
	const armedScope = SCOPES[0]
	const armedSub = store.subscribe(armedScope, { legs: ["gas"], retry: true, txRefresh: false, peek: false })
	const armedEnsure = store.ensure(armedScope, { legs: ["gas"] }).catch(() => {})
	await flush()
	pending.splice(0).forEach((c) => c.settle(false))
	await flush()
	await armedEnsure
	armedSub.release()
	await flush()
	const callsAfterArmedRelease = world.totalCalls
	await vi.advanceTimersByTimeAsync(35_000)
	await vi.advanceTimersByTimeAsync(35_000)
	expect(world.totalCalls, "a retry armed at release time fired after its last lease died").toBe(callsAfterArmedRelease)
	world.trace.event("c5", { calls: world.totalCalls })
}

/** One tape: build the world, interpret every entry with the per-step flush + oracle, drain,
 *  then the five probes in their fixed order. Each helper is awaited at a quiescent point (all
 *  calls settled, timers drained, the previous probe's silence just asserted). */
async function runTape(tape: number[]): Promise<void> {
	const world = createFuzzWorld()
	for (const n of tape) {
		const decoded = decodeOp(n)
		const timer = applyOp(world, n, decoded)
		if (timer) await timer
		await flush()
		assertWorldInvariants(world)
		world.trace.event("step", {
			n,
			op: decoded.op,
			p1: decoded.p1,
			p2: decoded.p2,
			pending: world.pending.map((c) => c.id),
			calls: world.totalCalls,
			next: world.nextCallId,
			fences: { ...world.fences },
			subs: world.subs.map((s) => [scopeKey(s.scope), s.caps, s.released]),
			owed: [...world.expectGasRecovery].sort(),
			entries: snapshotEntries(world.store),
		})
	}
	await drainToQuiescence(world)
	assertOwedRecoveries(world)
	await assertPostDrainSilence(world)
	await assertStrandedForcedProbe(world)
	await assertReleaseSilence(world)
	await assertArmedRetryDiesWithLease(world)
	world.trace.finish(tape)
}

describe("balances store — randomized interleavings (fuzz)", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("invariants hold under arbitrary operation/settlement schedules", async () => {
		const numRuns = Number(process.env.NULO_FUZZ_RUNS ?? 120)
		const seed = fuzzSeed()
		await fc.assert(
			fc.asyncProperty(fc.array(fc.nat({ max: 999_983 }), { minLength: 40, maxLength: 120 }), async (tape) => {
				try {
					await runTape(tape)
				} finally {
					// A run that FAILED mid-tape leaves armed store timers and its
					// tx handler behind; without this, shrink attempts inherit them
					// and the printed seed/path may not reproduce in isolation.
					vi.clearAllTimers()
					txAdd.mockClear()
				}
			}),
			{ numRuns, ...(seed !== undefined ? { seed } : {}) },
		)
	}, 120_000)
})
