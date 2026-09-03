<script setup lang="ts">
/** Services */
import { awaitL1Receipt } from "@nulo/bridge-core"
import { computed, ref } from "vue"

/** Composables */
import { useL1Wallet } from "@/composables/useL1Wallet"

/** Utils */
import { MANIFEST_TOKENS } from "@/contracts/bridge-generation"
import { MINTABLE_ERC20_ABI } from "@/lib/erc20-abi"
import { NETWORK } from "@/lib/network"
import { TESTIDS } from "@/lib/testids"

/**
 * One-tap Ethereum mints for the test tokens the manifest publishes as permissionless. It renders
 * for nothing else: only a token the generation itself lists can be trusted to expose `mint`, the
 * amount is capped by the per-transaction limit that token was published with, and a mainnet
 * manifest lists none — so this strip is the whole difference between the networks on this step.
 */
const emit = defineEmits<{ minted: [erc20: string] }>()

const WHOLE_PER_MINT = 100n

interface Mintable {
	erc20: `0x${string}`
	symbol: string
	decimals: number
	whole: bigint
}

function wholeOf(cap: number | undefined): bigint {
	if (cap === undefined) return WHOLE_PER_MINT
	const capped = BigInt(Math.floor(cap))
	return capped < WHOLE_PER_MINT ? capped : WHOLE_PER_MINT
}

const mintable = computed<Mintable[]>(() =>
	MANIFEST_TOKENS.filter((t) => t.source === "permissionless-mint").map((t) => ({
		erc20: t.erc20 as `0x${string}`,
		symbol: t.displaySymbol,
		decimals: t.decimals,
		whole: wholeOf(t.maxWholePerTx),
	})),
)

const l1 = useL1Wallet()
/** The token being minted; every button waits while one is in flight. */
const minting = ref<string | null>(null)
const error = ref<string | null>(null)

const status = computed(() => error.value ?? (minting.value ? "Minting — confirm in your Ethereum wallet…" : null))

async function mint(token: Mintable): Promise<void> {
	if (minting.value) return
	const wallet = l1.ensureWalletClient()
	const owner = l1.address.value
	if (!wallet || !owner) {
		error.value = "Connect your Ethereum wallet first."
		return
	}
	minting.value = token.erc20
	error.value = null
	try {
		const hash = await wallet.writeContract({
			address: token.erc20,
			abi: MINTABLE_ERC20_ABI,
			functionName: "mint",
			args: [owner, token.whole * 10n ** BigInt(token.decimals)],
			chain: NETWORK.viemChain,
			account: owner,
		})
		// viem RESOLVES the receipt even on an on-chain revert - check status so a mined revert
		// surfaces as an error rather than a false "minted".
		const receipt = await awaitL1Receipt(l1.publicClient, hash)
		if (receipt.status !== "success") throw new Error("Mint transaction reverted on-chain.")
		emit("minted", token.erc20)
	} catch (e) {
		error.value = e instanceof Error ? e.message : "Mint failed"
	} finally {
		minting.value = null
	}
}
</script>

<template>
	<div v-if="mintable.length > 0" class="strip" :data-testid="TESTIDS.mintL1Card">
		<div class="row">
			<span class="tag">Testnet</span>
			<span class="lead">Free test tokens:</span>
			<span class="buttons">
				<button
					v-for="token in mintable"
					:key="token.erc20"
					type="button"
					class="mint"
					:disabled="minting !== null"
					:data-testid="TESTIDS.mintL1"
					:data-symbol="token.symbol"
					@click="mint(token)"
				>
					{{ minting === token.erc20 ? "MINTING…" : `+${token.whole} ${token.symbol}` }}
				</button>
			</span>
		</div>
		<p v-if="status" class="status" aria-live="polite" :data-testid="TESTIDS.mintL1Status" :data-error="error ? 'true' : undefined">
			{{ status }}
		</p>
	</div>
</template>

<style scoped>
.strip {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 10px 12px;
	border: 1px dashed var(--nulo-outline);
}

.row {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.tag {
	font: 600 10px/1 var(--font-mono);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--yellow);
}

.lead {
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-secondary);
}

.buttons {
	display: flex;
	gap: 6px;
	margin-left: auto;
	flex-wrap: wrap;
}

.mint {
	padding: 8px 12px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	font: 600 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	cursor: pointer;
}

.mint:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.mint:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.status {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}

.status[data-error] {
	color: var(--red);
}
</style>
