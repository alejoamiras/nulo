/**
 * Central state for the playground.
 *
 * All UI mutations go through `setState()` which triggers a `render()` call
 * registered by `main.ts`. No reactivity framework — plain DOM updates keyed
 * off the result feed's monotonic `seq`.
 */
import { safeJsonStringify } from "./lib/formatters"

export type Status = "idle" | "discovering" | "verifying" | "connected" | "error" | "disconnected"

export type ResultRow = {
	seq: number
	method: string
	status: "pending" | "ok" | "error"
	resultJson?: string
	errorJson?: string
	ts: number
}

export type AccountInfo = {
	address: string
	name: string
}

export interface PgState {
	status: Status
	chainId: number | null
	accounts: AccountInfo[]
	selectedAccount: string | null
	results: ResultRow[]
	inputs: Record<string, string>
	protocolLog: Array<{ direction: "send" | "recv"; type: string; ts: number }>
	lastError: string | null
}

const initialState: PgState = {
	status: "idle",
	chainId: null,
	accounts: [],
	selectedAccount: null,
	results: [],
	inputs: {},
	protocolLog: [],
	lastError: null,
}

let state: PgState = { ...initialState }
let renderFn: (() => void) | null = null
let nextSeq = 1

export function getState(): Readonly<PgState> {
	return state
}

export function setState(patch: Partial<PgState>): void {
	state = { ...state, ...patch }
	renderFn?.()
}

export function setRenderFn(fn: () => void): void {
	renderFn = fn
}

export function setInput(name: string, value: string): void {
	setState({ inputs: { ...state.inputs, [name]: value } })
}

export function getInput(name: string): string {
	return state.inputs[name] ?? ""
}

/**
 * Append a pending result row and return its seq.
 * Tests snapshot the feed length before invocation and wait for the matching seq.
 */
export function appendPendingResult(method: string): number {
	const seq = nextSeq++
	const row: ResultRow = { seq, method, status: "pending", ts: Date.now() }
	setState({ results: [...state.results, row] })
	return seq
}

/**
 * Settle a previously-appended pending row. Result is JSON-stringified via the
 * safe formatter (handles bigint, Fr, AztecAddress).
 */
export function settleResult(seq: number, status: "ok" | "error", payload: unknown): void {
	const results = state.results.map((r) => {
		if (r.seq !== seq) return r
		if (status === "ok") {
			return { ...r, status, resultJson: safeJsonStringify(payload) }
		}
		const message = payload instanceof Error ? payload.message : String(payload)
		return { ...r, status, errorJson: safeJsonStringify({ message }) }
	})
	setState({ results })
}

export function resetState(): void {
	state = { ...initialState }
	nextSeq = 1
	renderFn?.()
}
