import { type AztecNode, createAztecNodeClient } from "@aztec-labs/stdlib/interfaces/client"
import { DEFAULT_REQUEST_TIMEOUT_MS, makeSingleAttemptFetch } from "@nulo/aztec-runtime/utils"
import packageJson from "../package.json"
import { TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION } from "../src/utils/chain-ids"
import { scrubUrls } from "../src/utils/scrub-urls"

/** The Aztec line the wallet is built against; a node on any other version is a hold, never a pass. */
const AZTEC_VERSION = packageJson.dependencies["@aztec-labs/pxe"]

/** The wallet's single-attempt transport, its errors reduced to the endpoint's origin: upstream's
 *  fetch, retry and client loggers print whole URLs, and the Testnet endpoint carries its API key
 *  in the path. */
export function createPreflightNodeClient(url: string): AztecNode {
	const once = makeSingleAttemptFetch(DEFAULT_REQUEST_TIMEOUT_MS)
	return createAztecNodeClient(url, {
		fetch: (host, ...rest) =>
			once(host, ...rest).catch((err: unknown) => {
				throw new Error(scrubUrls(err instanceof Error ? err.message : String(err)))
			}),
	})
}

/**
 * Compares the node's version, L1 chain id and rollup version with the wallet's pins, each on its
 * own: the composite chain id is their XOR, which a version move leaves unchanged.
 */
export async function readPinnedTestnetIdentity(node: Pick<AztecNode, "getNodeInfo">): Promise<{ matches: boolean; line: string }> {
	const { nodeVersion, l1ChainId, rollupVersion } = await node.getNodeInfo()
	const matches = nodeVersion === AZTEC_VERSION && l1ChainId === TESTNET_L1_CHAIN_ID && rollupVersion === TESTNET_ROLLUP_VERSION
	const line =
		`nodeInfo: nodeVersion=${nodeVersion} l1ChainId=${l1ChainId} rollupVersion=${rollupVersion} ` +
		`(pinned ${AZTEC_VERSION}, ${TESTNET_L1_CHAIN_ID}, ${TESTNET_ROLLUP_VERSION})`
	return { matches, line }
}
