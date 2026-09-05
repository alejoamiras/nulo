/**
 * A test-readable projection of a `TxSimulationResult`: which account ran the
 * entrypoint, who pays, and which public calls the kernel filed under setup
 * (non-revertible), app logic (revertible) and teardown. The raw result is
 * kernel output whose `toJSON` is a byte buffer, so the feed cannot expose it.
 */
import type { Fr } from "@aztec/aztec.js/fields"
import type { PrivateCallExecutionResult, TxSimulationResult } from "@aztec/stdlib/tx"
import type { PublicCallRequest } from "@aztec/stdlib/kernel"

export type PublicCallSummary = {
	contract: string
	msgSender: string
	/** First calldata field, resolved through the result's calldata table; `null` when absent. */
	selector: string | null
	isStaticCall: boolean
}

export type PrivateFrameSummary = {
	contract: string
	selector: string
	argsHash: string
	minRevertibleSideEffectCounter: number
	publicCalls: PublicCallSummary[]
	nested: PrivateFrameSummary[]
}

export type SimulationSummary = {
	feePayer: string
	setupCalls: PublicCallSummary[]
	appCalls: PublicCallSummary[]
	teardownCall: PublicCallSummary | null
	entrypoint: PrivateFrameSummary
	gasUsed: { daGas: string; l2Gas: string }
}

type CalldataTable = Map<string, Fr[]>

function calldataTable(result: TxSimulationResult): CalldataTable {
	const table: CalldataTable = new Map()
	for (const hashed of result.privateExecutionResult.publicFunctionCalldata) {
		table.set(hashed.hash.toString(), hashed.values)
	}
	return table
}

function publicCall(req: PublicCallRequest, table: CalldataTable): PublicCallSummary {
	const selector = table.get(req.calldataHash.toString())?.[0]
	return {
		contract: req.contractAddress.toString(),
		msgSender: req.msgSender.toString(),
		selector: selector ? selector.toString() : null,
		isStaticCall: req.isStaticCall,
	}
}

function privateFrame(frame: PrivateCallExecutionResult, table: CalldataTable): PrivateFrameSummary {
	const pi = frame.publicInputs
	return {
		contract: pi.callContext.contractAddress.toString(),
		selector: pi.callContext.functionSelector.toString(),
		argsHash: pi.argsHash.toString(),
		minRevertibleSideEffectCounter: Number(pi.minRevertibleSideEffectCounter.toBigInt()),
		publicCalls: pi.publicCallRequests.getActiveItems().map((c) => publicCall(c.inner, table)),
		nested: frame.nestedExecutionResults.map((n) => privateFrame(n, table)),
	}
}

export function summarizeSimulation(result: TxSimulationResult): SimulationSummary {
	const table = calldataTable(result)
	const forPublic = result.publicInputs.forPublic
	const nonEmpty = (reqs: PublicCallRequest[]) => reqs.filter((r) => !r.isEmpty()).map((r) => publicCall(r, table))
	const teardown = forPublic?.publicTeardownCallRequest
	return {
		feePayer: result.publicInputs.feePayer.toString(),
		setupCalls: forPublic ? nonEmpty(forPublic.nonRevertibleAccumulatedData.publicCallRequests) : [],
		appCalls: forPublic ? nonEmpty(forPublic.revertibleAccumulatedData.publicCallRequests) : [],
		teardownCall: teardown && !teardown.isEmpty() ? publicCall(teardown, table) : null,
		entrypoint: privateFrame(result.privateExecutionResult.entrypoint, table),
		gasUsed: { daGas: String(result.gasUsed.totalGas.daGas), l2Gas: String(result.gasUsed.totalGas.l2Gas) },
	}
}
