/**
 * The emoji check's header labels. They come from wallet-local data only (the session row and the
 * profile's networks and accounts), never from the dApp's metadata, so a dApp cannot put words in
 * the strip the person reads as the wallet's.
 */
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { parseCaipAccount } from "@/wallet/utils/caip"
import { trimAddress } from "@/utils/string"
import { resolveDappChain } from "../capabilities/chain-mismatch"

export interface VerifyHeaderInput {
	/** The session row's chain id, a decimal string. */
	sessionChainId: string
	/** The CAIP account ids the session shares. */
	sharedAccounts: readonly string[]
	/** The shared accounts found in this profile. */
	resolvedAccounts: readonly Pick<Account, "name">[]
	networks: readonly Network[]
}

export interface VerifyHeaderLabels {
	account: string
	/** The session's network, by the profile's name for it. */
	network: string
	/** A shared account sits on another chain than the session's. */
	warn: boolean
}

export function verifyHeaderLabels(input: VerifyHeaderInput): VerifyHeaderLabels {
	const chain = resolveDappChain(input.sessionChainId, input.networks, undefined)
	if (input.sharedAccounts.length === 0) return { account: "No account shared", network: chain.name, warn: false }
	const onAnotherChain = input.sharedAccounts.some((caip) => {
		const parsed = tryParse(caip)
		return parsed !== undefined && parsed.chainId !== chain.chainId
	})
	return { account: sharedAccountLabel(input), network: chain.name, warn: onAnotherChain }
}

function sharedAccountLabel({ sharedAccounts, resolvedAccounts }: VerifyHeaderInput): string {
	if (resolvedAccounts.length === 1) return resolvedAccounts[0].name
	if (resolvedAccounts.length > 1) return `${resolvedAccounts.length} accounts`
	return trimAddress(sharedAccounts[0].split(":")[2] ?? "", 6, 4, "...")
}

function tryParse(caip: string): { chainId: number } | undefined {
	try {
		return parseCaipAccount(caip)
	} catch {
		return undefined
	}
}
