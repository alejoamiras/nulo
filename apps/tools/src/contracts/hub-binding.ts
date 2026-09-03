/**
 * The hub's binding for an ERC-20, read from the node's public storage. No Aztec wallet is involved:
 * a token registered on the hub reads as registered on a plain Ethereum wallet too, so the wizard
 * never shows a first-time path for a token that has none.
 */
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { hubBindingAt } from "@nulo/bridge-core"
import { HUB } from "@/contracts/bridge-generation"
import { NETWORK } from "@/lib/network"

type NodeClient = ReturnType<typeof createAztecNodeClient>

let node: NodeClient | undefined

export async function readHubBinding(erc20: string): Promise<string | undefined> {
	if (!HUB) return undefined
	node ??= createAztecNodeClient(NETWORK.nodeUrl)
	return hubBindingAt(node, HUB.toString(), erc20)
}
