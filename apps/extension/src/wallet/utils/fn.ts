import type { Fr } from "@aztec/foundation/curves/bn254"
import { type AbiType, encodeArguments, type FunctionAbi, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import type { CallAction, EncodedCallAction } from "@nulo/wallet-bridge"

export class FnImpl {
	constructor(
		public readonly name: string,
		public readonly impl: number,
	) {}
}

export abstract class Fn extends FnImpl {
	public readonly isStatic: boolean
	public readonly type: FunctionType

	constructor(name: string, impl: number) {
		super(name, impl)

		const abi = this.abi()
		this.isStatic = abi.isStatic
		this.type = abi.functionType
	}

	protected abstract abi(): FunctionAbi

	public abstract buildArgs(...args: unknown[]): unknown[]

	public async getSelector(): Promise<FunctionSelector> {
		const abi = this.abi()
		return await FunctionSelector.fromNameAndParameters(abi.name, abi.parameters)
	}

	public encodeArgs(args: unknown[]): Fr[] {
		return encodeArguments(this.abi(), args)
	}

	public getReturnTypes(): AbiType[] {
		return this.abi().returnTypes
	}

	public getImpl(): FnImpl {
		return new FnImpl(this.name, this.impl)
	}
}

export abstract class ViewFn extends Fn {
	public abstract unpackResult(values: Fr[]): unknown
}

/** The `batchedViewSimulation` call for `viewFn` on `contract`. A utility goes by name with plain
 *  args (the helper resolves it against the artifact); anything tx-shaped goes pre-encoded by
 *  selector, so it needs no artifact lookup by name. */
export async function buildViewCall(contract: string, viewFn: ViewFn, args: unknown[]): Promise<CallAction | EncodedCallAction> {
	if (viewFn.type === FunctionType.UTILITY) return { kind: "call", contract, method: viewFn.name, args }
	const selector = await viewFn.getSelector()
	return {
		kind: "encoded_call",
		to: contract,
		selector: selector.toString(),
		args: viewFn.encodeArgs(args).map((x) => x.toString()),
		name: viewFn.name,
		type: viewFn.type,
		isStatic: viewFn.isStatic,
		returnTypes: viewFn.getReturnTypes(),
	}
}
