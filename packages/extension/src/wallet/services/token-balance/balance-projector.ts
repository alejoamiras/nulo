/**
 * Balance projection: given raw balance records, batch their `balance_of_*`
 * reads via the `batchedViewSimulation` helper and unpack the results into
 * `{ privateBalance, publicBalance }`.
 *
 * Groups by `(account, chainId)` internally — the caller does NOT need to
 * pre-group. Max-12-per-network-call batch size.
 *
 * Return shape lets the caller (`BalanceJobQueue`) decide whether to write
 * each balance (success) or surface an error on its task record.
 */

import { FunctionType } from "@aztec/stdlib/abi"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import type { AccountService } from "@/wallet/services/account/service"
import type { CallAction, EncodedCallAction, ExecutionService } from "@/wallet/services/execution/service"
import { batchedViewSimulation } from "@/wallet/services/execution/helpers/batched-view-simulation"
import { getViewSimulationDeps } from "@/wallet/services/execution/helpers/get-view-simulation-deps"
import type { NetworkService } from "@/wallet/services/network/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { PxeServiceClient } from "@/wallet/services/pxe/client"
import { BalanceOfPrivateFn, BalanceOfPublicFn } from "@/wallet/services/token/functions"
import type { TokenService, Token } from "@/wallet/services/token/service"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { ViewFn } from "@/wallet/utils/fn"
import type { TokenBalanceRaw } from "./spec"

/** Per-balance projection outcome. */
export type ProjectedBalance =
	| { kind: "ok"; id: number; privateBalance: string; publicBalance: string }
	| { kind: "error"; id: number; error: string }

const BATCH_SIZE = 12

type GroupKey = string // `${account}:${chainId}`
type BalanceGroup = { account: string; chainId: number; balances: TokenBalanceRaw[] }

export class BalanceProjector {
	public constructor(
		private readonly execution: ExecutionService,
		private readonly networks: NetworkService,
		private readonly tokens: TokenService,
		private readonly profiles: ProfileService,
		private readonly accounts: AccountService,
		private readonly pxeService: PxeServiceClient,
		private readonly logger?: ILogger,
		private readonly logSource: string = "balance-projector",
	) {}

	/** Project any set of balances. Groups by (account, chainId) and
	 *  chunks each group into batches of up to 12, mirroring today's
	 *  `syncBatch` flow. Every input balance produces exactly one entry
	 *  in the output (`ok` or `error`). */
	public async project(balances: TokenBalanceRaw[]): Promise<ProjectedBalance[]> {
		if (balances.length === 0) return []

		// Resolve token metadata for every balance up-front so we can
		// filter out balances whose token has been deleted (those become
		// `error: Unknown token #<id>` entries, mirroring service.ts:280-283).
		const results: ProjectedBalance[] = []
		const resolvable: { balance: TokenBalanceRaw; token: Token }[] = []
		for (const balance of balances) {
			const token = await this.tokens.getTokenRaw(balance.token).catch(() => undefined)
			if (!token) {
				this.logger?.log(this.logSource, LogLevel.Error, `Unknown token #${balance.token}`)
				results.push({ kind: "error", id: balance.id, error: `Unknown token #${balance.token}` })
				continue
			}
			resolvable.push({ balance, token })
		}

		// Group by (account, chainId).
		const groups = new Map<GroupKey, BalanceGroup>()
		for (const { balance, token } of resolvable) {
			const key: GroupKey = `${balance.account}:${token.chainId}`
			let group = groups.get(key)
			if (!group) {
				group = { account: balance.account, chainId: token.chainId, balances: [] }
				groups.set(key, group)
			}
			group.balances.push(balance)
		}

		for (const group of groups.values()) {
			// Chunk into batches of 12 inside the group.
			for (let offset = 0; offset < group.balances.length; offset += BATCH_SIZE) {
				const chunk = group.balances.slice(offset, offset + BATCH_SIZE)
				const chunkResults = await this.projectChunk(group.account, group.chainId, chunk)
				results.push(...chunkResults)
			}
		}

		return results
	}

	private async projectChunk(account: string, chainId: number, balances: TokenBalanceRaw[]): Promise<ProjectedBalance[]> {
		try {
			const calls: [CallAction | EncodedCallAction, number, boolean, ViewFn][] = []
			const perBalance: Record<number, { privateBalance: string; publicBalance: string }> = {}
			// Cache so the two passes below don't re-fetch the same token metadata.
			const tokenCache = new Map<number, Awaited<ReturnType<typeof this.tokens.getTokenRaw>>>()

			// Pass 0: initialize perBalance entries + populate the token cache.
			for (let i = 0; i < balances.length; i++) {
				const balance = balances[i]
				perBalance[balance.id] = {
					privateBalance: balance.privateBalance ?? "0",
					publicBalance: balance.publicBalance ?? "0",
				}
				tokenCache.set(balance.id, await this.tokens.getTokenRaw(balance.token))
			}

			// Pass 1: enqueue every PUBLIC call across all balances first.
			// Two-pass produces a chunk shape [pub_0..pub_{N-1}, priv_0..priv_{N-1}]
			// so the leading PUBLIC+isStatic prefix in `batchedViewSimulation`
			// covers the whole public arm. A per-token swap WOULD NOT work — it
			// produces [pub_0, priv_0, pub_1, priv_1, …], breaking the prefix
			// at the first private call and reducing fast-path coverage to one
			// call total.
			for (let i = 0; i < balances.length; i++) {
				const balance = balances[i]
				const token = tokenCache.get(balance.id)
				if (!token) continue // unreachable: pass 0 populated for every balance
				if (token.balanceOfPublicFn) {
					const fn = BalanceOfPublicFn.new(token.balanceOfPublicFn.name, token.balanceOfPublicFn.impl)
					await this.enqueueCall(calls, fn, token, account, i, false)
				} else {
					perBalance[balance.id].publicBalance = "0"
				}
			}

			// Pass 2: enqueue every PRIVATE call across all balances second.
			for (let i = 0; i < balances.length; i++) {
				const balance = balances[i]
				const token = tokenCache.get(balance.id)
				if (!token) continue // unreachable: pass 0 populated for every balance
				if (token.balanceOfPrivateFn) {
					const fn = BalanceOfPrivateFn.new(token.balanceOfPrivateFn.name, token.balanceOfPrivateFn.impl)
					await this.enqueueCall(calls, fn, token, account, i, true)
				} else {
					perBalance[balance.id].privateBalance = "0"
				}
			}

			const network = (await this.networks.getNetworks(chainId))[0]
			if (!network) {
				throw new Error(`Failed to find network #${chainId}`)
			}

			if (calls.length > 0) {
				const deps = await getViewSimulationDeps(
					{
						profiles: this.profiles,
						networks: this.networks,
						accounts: this.accounts,
						pxeService: this.pxeService,
						contractResolver: this.execution.contractResolver,
						logger: this.logger,
					},
					network.id,
					account,
				)
				const results = await batchedViewSimulation(
					calls.map((x) => x[0]),
					deps,
				)

				for (let i = 0; i < calls.length; i++) {
					const [_, tbIndex, isPrivate, viewFn] = calls[i]
					const balance = (viewFn.unpackResult(results.encoded[i]) as bigint).toString()
					const target = perBalance[balances[tbIndex].id]
					if (isPrivate) {
						target.privateBalance = balance
					} else {
						target.publicBalance = balance
					}
				}
			}

			return balances.map((b) => ({
				kind: "ok" as const,
				id: b.id,
				privateBalance: perBalance[b.id].privateBalance,
				publicBalance: perBalance[b.id].publicBalance,
			}))
		} catch (err) {
			const errorMessage = getErrorMessage(err)
			this.logger?.log(this.logSource, LogLevel.Error, `Failed to sync chunk: ${errorMessage}`)
			return balances.map((b) => ({ kind: "error" as const, id: b.id, error: errorMessage }))
		}
	}

	private async enqueueCall(
		calls: [CallAction | EncodedCallAction, number, boolean, ViewFn][],
		fn: ViewFn,
		token: Token,
		account: string,
		tbIndex: number,
		isPrivate: boolean,
	): Promise<void> {
		if (fn.type === FunctionType.UTILITY) {
			calls.push([
				{
					kind: "call",
					contract: token.contract,
					method: fn.name,
					args: fn.buildArgs(account),
				},
				tbIndex,
				isPrivate,
				fn,
			])
		} else {
			const selector = await fn.getSelector()
			const encodedArgs = fn.encodeArgs(fn.buildArgs(account))
			calls.push([
				{
					kind: "encoded_call",
					to: token.contract,
					selector: selector.toString(),
					args: encodedArgs.map((x) => x.toString()),
					name: fn.name,
					type: fn.type,
					isStatic: fn.isStatic,
					returnTypes: fn.getReturnTypes(),
				},
				tbIndex,
				isPrivate,
				fn,
			])
		}
	}
}
